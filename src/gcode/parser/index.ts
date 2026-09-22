import type { GcodeStats, Layer, Move, ParseDiagnostic, ParseResult } from '@/core/types';
import { LAYER_Z_EPSILON } from '@/core/constants';
import { numericParam, tokenizeLine } from './tokenizer';
import { createInitialState, toMillimeters, type MachineState } from './machineState';
import {
  COMMAND_HANDLERS,
  MODAL_MOTION_COMPANIONS,
  MODAL_REPEATABLE,
  MOTION_COMMANDS,
  getHandler,
} from './commands';
import { buildToolpathBuffers } from '../buffers';
import { computeStats } from '../stats';
import {
  DIALECTS,
  DIALECT_SNIFF_LINES,
  GENERIC_DIALECT_NAME,
  detectDialect,
  type Dialect,
} from '../dialects';

export interface ParseOptions {
  /** Ilerleme bildirimi (0..1). Worker bunu main thread'e aktarir. */
  onProgress?: (ratio: number) => void;
  /** Otomatik tespit yerine zorlanan dialect adi. */
  forceDialect?: string;
  /** Uretilecek en fazla tani kaydi (bellek korumasi). */
  maxDiagnostics?: number;
}

/** Cok buyuk dosyalarda tani listesinin bellegi doldurmasini engeller. */
const DEFAULT_MAX_DIAGNOSTICS = 500;

/** Ic ice alt program cagrisi siniri (dongusel cagrilara karsi). */
const MAX_SUBPROGRAM_DEPTH = 10;
/** Tek bir M98 cagrisinin en fazla tekrar sayisi. */
const MAX_SUBPROGRAM_REPEAT = 1000;

function clampRepeat(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(MAX_SUBPROGRAM_REPEAT, Math.floor(value));
}

/** "O1000" / "N10 O1000" satirindaki program numarasi, yoksa null. */
function parseProgramLabel(line: string): number | null {
  const match = /^\s*(?:N\s*\d+\s*)?O\s*(\d+)/i.exec(line);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Dosyadaki alt program tanimlarini bulur: "O1000" satirindan M99'a
 * (veya bir sonraki O etiketine / dosya sonuna) kadar olan aralik.
 */
function scanSubprograms(lines: string[]): Map<number, { start: number; end: number }> {
  const result = new Map<number, { start: number; end: number }>();
  let current: { number: number; start: number } | null = null;

  const close = (end: number): void => {
    if (current && !result.has(current.number)) {
      result.set(current.number, { start: current.start, end });
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const label = parseProgramLabel(line);
    if (label !== null) {
      close(i);
      current = { number: label, start: i + 1 };
      continue;
    }
    if (current && /\bM\s*0*99\b/i.test(line)) {
      close(i);
    }
  }
  close(lines.length);

  return result;
}

/** Slicer yorumundan gelen katman sinyali. */
interface RawLayerHint {
  lineIndex: number;
  z?: number;
}

/**
 * Parser giris noktasi (facade).
 *
 * Akis:
 *   1) dialect tespiti (dosya basindaki uretici imzasi / yorum bicimi)
 *   2) satir satir tokenize -> COMMAND_HANDLERS uzerinden state guncelle
 *   3) katman sinirlarini ata (slicer ipucu > extrusion Z'si > ham Z degisimi)
 *   4) istatistikleri hesapla (stats.ts) ve buffer'lari kur (buffers.ts)
 */
export function parseGcode(source: string, options: ParseOptions = {}): ParseResult {
  const lines = source.split(/\r\n|\r|\n/);
  const state = createInitialState();
  const moves: Move[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  const layerHints: RawLayerHint[] = [];

  const maxDiagnostics = options.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS;
  let suppressedDiagnostics = 0;
  const pushDiagnostic = (d: ParseDiagnostic): void => {
    if (diagnostics.length >= maxDiagnostics) {
      suppressedDiagnostics++;
      return;
    }
    diagnostics.push(d);
  };

  const dialect = resolveDialect(lines, options.forceDialect);

  /** A/B/C (doner eksen) sozcugu goren ilk satir — tani icin. */
  let rotaryLine: number | null = null;
  /** M30/M2 ile programin bittigi satir (varsa). */
  let programEndLine: number | null = null;

  const emitMove = (move: Move): void => {
    // Referans donusleri (G28/G30/G53) icin "guvenli yukseklik" olcutu:
    // programin gercekte kullandigi en yuksek Z.
    if (move.to.z > state.maxZ) state.maxZ = move.to.z;
    if (move.from.z > state.maxZ) state.maxZ = move.from.z;

    // Is mili durumu hareketin YAPILDIGI anda onemlidir (program sonundaki
    // M5 sonradan bayragi kapatir), bu yuzden burada yakalanir.
    if (
      state.spindleOffCutLine === null &&
      !state.spindleOn &&
      !move.rapid &&
      move.distance > 0
    ) {
      state.spindleOffCutLine = move.lineIndex;
    }
    moves.push(move);
  };

  const totalLines = lines.length;
  const progressStep = Math.max(1, Math.floor(totalLines / 50));

  // Alt program (M98) etiketleri: "O1000" satirindan M99'a kadarki aralik.
  const subprograms = scanSubprograms(lines);

  /**
   * Satir araligini calistirir.
   *
   * ANA PROGRAM ve ALT PROGRAM ayni koddan gecer; fark yalnizca `depth`tir.
   * M98 bir alt programi burada yeniden cagirir (Fanuc/LinuxCNC davranisi),
   * M99 alt programdan doner, M30/M2 ise ana programi bitirir.
   *
   * @returns 'end' ana programin bittigini bildirir (sonrasi alt program
   *          tanimlaridir ve ana akista CALISTIRILMAMALIDIR).
   */
  const execute = (from: number, to: number, depth: number): 'end' | 'return' | 'done' => {
    for (let i = from; i < to; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      if (line.trim().length === 0) continue;

      const token = tokenizeLine(line, i);

      // G53 modal DEGILDIR: yalnizca yazildigi blokta gecerlidir. Bayrak her
      // satirin basinda temizlenir, G53 handler'i ayni satirda (hareketten
      // once) yeniden kurar.
      state.machineCoordBlock = false;

      // Slicer'in katman yorumlari (varsa) sinir olarak kaydedilir.
      // Alt program tekrarlarinda ayni satir birden fazla gecebilir; ipucu
      // yalnizca ilk geciste kaydedilir (assignLayers sirali bekler).
      if (token.comment && dialect && depth === 0) {
        const hint = dialect.parseLayerHint(token.comment);
        if (hint) layerHints.push({ lineIndex: i, z: hint.z });
      }

      if (token.params.A !== undefined || token.params.B !== undefined || token.params.C !== undefined) {
        if (rotaryLine === null) rotaryLine = i;
      }

      const ctx = {
        state,
        emitMove,
        diagnostic: (d: Omit<ParseDiagnostic, 'lineIndex'>) =>
          pushDiagnostic({ ...d, lineIndex: i }),
      };

      // --- Akis kontrolu: M98 / M99 / M30 / M2 ve O etiketleri -------------
      const label = parseProgramLabel(line);
      if (label !== null) {
        // Dosya basindaki O numarasi programin ADIDIR; ilerideki O satirlari
        // ise alt program tanimlarinin basidir ve ana akista calistirilmaz.
        if (depth === 0 && moves.length > 0) return 'end';
        continue;
      }

      if (token.commands.includes('M99')) {
        if (depth > 0) return 'return';
        continue;
      }

      if (token.commands.includes('M98')) {
        runSubprogram(token, i, depth, ctx);
        continue;
      }

      if (token.commands.includes('M30') || token.commands.includes('M2')) {
        if (depth === 0) {
          programEndLine = i;
          return 'end';
        }
        continue;
      }

      if (token.commands.length === 0) {
        // Komutsuz ama parametreli satir: "F3000" gibi modal feedrate atamalari.
        const feed = numericParam(token, 'F');
        if (feed !== undefined) {
          state.feedrate = toMillimeters(feed, state.unit);
        }

        // MODAL HAREKET: G-code'da hareket komutu kalicidir. "G1 X10 F300"
        // satirindan sonra gelen "X20 Y5" satiri da bir G1 hareketidir. Gercek
        // CNC programlari (ozellikle elle yazilanlar ve Fanuc/Heidenhain post
        // ciktilari) komut sozcugunu tekrar etmez; bu dal olmadan takim
        // yolunun buyuk bolumu sessizce kaybolurdu.
        if (hasAxisWord(token) && state.motionMode && MODAL_REPEATABLE.has(state.motionMode)) {
          dispatch(state.motionMode, token, ctx, pushDiagnostic, i);
        }
        continue;
      }

      // Modal komutlar (G90, G21, G17, T0 ...) ayni satirdaki hareket
      // komutundan ONCE uygulanmalidir: "G0 G90 X10" once mutlak moda gecer.
      for (const command of token.commands) {
        if (MOTION_COMMANDS.has(command)) continue;
        dispatch(command, token, ctx, pushDiagnostic, i);
      }
      let hasMotionCommand = false;
      for (const command of token.commands) {
        if (!MOTION_COMMANDS.has(command)) continue;
        hasMotionCommand = true;
        dispatch(command, token, ctx, pushDiagnostic, i);
      }

      if (!hasMotionCommand) {
        // Hareket komutu olmayan satirdaki F yine de modaldir:
        // "G94 F600." sonraki hareketlerin hizini belirler.
        const feed = numericParam(token, 'F');
        if (feed !== undefined) {
          state.feedrate = toMillimeters(feed, state.unit);
        }

        // MODAL HAREKET (komutlu satir): satirdaki komutlarin hicbiri hareket
        // uretmiyor ama eksen sozcugu var:
        //   "G43 H1 Z15. M8"  -> guvenli Z'ye hizli cikis (Fusion/Fanuc posti)
        //   "G53 G0" disindaki "G53 Z0." yazimi
        // Gercek tezgah bu satirlari modal G0/G1 ile hareket ettirir; bu dal
        // olmadan takim yolunda kopukluk olusur (ozellikle her takim
        // degisiminden sonraki guvenli yukseklige cikis kaybolur).
        const companionsOnly = token.commands.every((c) => MODAL_MOTION_COMPANIONS.has(c));
        if (
          companionsOnly &&
          hasAxisWord(token) &&
          state.motionMode &&
          MODAL_REPEATABLE.has(state.motionMode)
        ) {
          dispatch(state.motionMode, token, ctx, pushDiagnostic, i);
        }
      }

      if (options.onProgress && depth === 0 && i % progressStep === 0) {
        options.onProgress(i / totalLines);
      }
    }
    return 'done';
  };

  /** M98 P#### L# — alt programi L kez calistirir. */
  function runSubprogram(
    token: ReturnType<typeof tokenizeLine>,
    lineIndex: number,
    depth: number,
    ctx: { diagnostic: (d: Omit<ParseDiagnostic, 'lineIndex'>) => void },
  ): void {
    if (depth >= MAX_SUBPROGRAM_DEPTH) {
      ctx.diagnostic({
        severity: 'error',
        code: 'SUBPROGRAM_TOO_DEEP',
        message: `Alt program cagrilari ${MAX_SUBPROGRAM_DEPTH} seviyeyi asti; dongu olabilir.`,
      });
      return;
    }

    const programNumber = token.params.P;
    if (programNumber === undefined) {
      ctx.diagnostic({
        severity: 'error',
        code: 'SUBPROGRAM_NO_P',
        message: 'M98 cagrisinda alt program numarasi (P) yok.',
      });
      return;
    }

    const target = subprograms.get(programNumber);
    if (!target) {
      ctx.diagnostic({
        severity: 'error',
        code: 'SUBPROGRAM_NOT_FOUND',
        message: `O${programNumber} alt programi bu dosyada bulunamadi; cagri atlandi.`,
      });
      return;
    }

    const repeats = clampRepeat(token.params.L ?? token.params.K ?? 1);
    for (let n = 0; n < repeats; n++) {
      execute(target.start, target.end, depth + 1);
    }
    void lineIndex;
  }

  execute(0, totalLines, 0);

  // Program sonundan (M30/M2) sonra kod varsa kullanici bunu bilmeli:
  // editorde yazdigi satirin neden hicbir sey yapmadigi aksi halde belirsiz
  // kalir. Alt program tanimlari bu uyariyi tetiklemez.
  if (programEndLine !== null) {
    const strayLine = findCodeAfterProgramEnd(lines, programEndLine, subprograms);
    if (strayLine !== null) {
      diagnostics.push({
        lineIndex: strayLine,
        severity: 'warning',
        code: 'CODE_AFTER_PROGRAM_END',
        message: `Program ${programEndLine + 1}. satirda (M30/M2) bitiyor; bu satir calistirilmadi.`,
      });
    }
  }

  if (suppressedDiagnostics > 0) {
    diagnostics.push({
      lineIndex: totalLines - 1,
      severity: 'info',
      code: 'DIAGNOSTICS_TRUNCATED',
      message: `${suppressedDiagnostics} ek tani kaydi gosterilmedi.`,
    });
  }

  if (rotaryLine !== null) {
    diagnostics.push({
      lineIndex: rotaryLine,
      severity: 'warning',
      code: 'ROTARY_AXIS_IGNORED',
      message:
        'Doner eksen (A/B/C) komutlari simule edilmiyor; yalnizca XYZ hareketi gosteriliyor.',
    });
  }

  reclassifyCncMoves(moves);
  checkSemantics(moves, state, diagnostics);
  diagnostics.sort((a, b) => a.lineIndex - b.lineIndex);

  const layers = assignLayers(moves, layerHints);
  const stats: GcodeStats = computeStats(moves, layers, state.dwellSeconds);
  const buffers = buildToolpathBuffers(moves);

  options.onProgress?.(1);

  return {
    moves,
    layers,
    stats,
    diagnostics,
    dialect: dialect?.name ?? GENERIC_DIALECT_NAME,
    buffers,
  };
}

/**
 * Program sonundan sonra kalan, alt program tanimina ait OLMAYAN ilk kod
 * satiri. Yoksa null.
 */
function findCodeAfterProgramEnd(
  lines: string[],
  programEndLine: number,
  subprograms: Map<number, { start: number; end: number }>,
): number | null {
  const ranges = [...subprograms.values()];
  for (let i = programEndLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim().length === 0) continue;
    if (parseProgramLabel(line) !== null) continue;
    if (ranges.some((range) => i >= range.start && i < range.end)) continue;
    const token = tokenizeLine(line, i);
    if (token.commands.length === 0 && !hasAxisWord(token)) continue;
    if (token.commands.includes('M99')) continue;
    return i;
  }
  return null;
}

function resolveDialect(lines: string[], forced?: string): Dialect | null {
  if (forced) return DIALECTS.find((d) => d.name === forced) ?? null;
  return detectDialect(lines.slice(0, DIALECT_SNIFF_LINES));
}

/** Satirda konum/yay belirten bir harf var mi? (modal hareket tekrari icin) */
function hasAxisWord(token: ReturnType<typeof tokenizeLine>): boolean {
  // Ciplak harfler (sayisiz) sayilmaz: makro/metin satirlarindaki rastgele
  // harfler ("IF [#1 EQ 1] GOTO 100" icindeki I) sahte hareket uretmemeli.
  return (['X', 'Y', 'Z', 'E', 'I', 'J', 'K', 'R'] as const).some(
    (letter) => numericParam(token, letter) !== undefined,
  );
}

function dispatch(
  command: string,
  token: ReturnType<typeof tokenizeLine>,
  ctx: Parameters<(typeof COMMAND_HANDLERS)[string]>[1],
  pushDiagnostic: (d: ParseDiagnostic) => void,
  lineIndex: number,
): void {
  const handler = getHandler(command);
  if (handler) {
    handler(token, ctx);
    return;
  }

  // Bilinmeyen M kodlari genelde sicaklik/fan/ekran gibi geometriyi
  // etkilemeyen seylerdir -> 'info'. Bilinmeyen G kodlari ise hareketi
  // etkileyebilir -> 'warning'.
  pushDiagnostic({
    lineIndex,
    severity: command.startsWith('M') ? 'info' : 'warning',
    code: 'UNKNOWN_COMMAND',
    message: `Bilinmeyen komut: ${command}`,
  });
}

/**
 * E (extrusion) bilgisi HIC bulunmayan dosyalarda hareketleri yeniden
 * siniflandirir.
 *
 * NEDEN: Kesim/travel ayrimi normalde E artisina bakilarak yapilir. Gercek
 * CNC dosyalarinda E diye bir eksen yoktur; orada ayrim G-code'un kendi
 * semantigindedir: G0 = hizli bos konumlanma, G1/G2/G3 = isleme (kesim)
 * hareketi. Bu fonksiyon olmadan butun CNC dosyalari bastan sona "travel"
 * sayilir ve varsayilan ayarlarda gorunmez olurdu.
 *
 * Yalnizca dosyada hic E yoksa devreye girer; FDM dosyalarinin E'siz
 * (travel) G1 hareketleri etkilenmez.
 */
function reclassifyCncMoves(moves: Move[]): void {
  if (moves.length === 0) return;
  const hasExtrusionData = moves.some((m) => m.e !== 0);
  if (hasExtrusionData) return;

  for (const move of moves) {
    if (move.kind === 'home') continue;
    if (move.distance === 0) continue;
    move.kind = move.rapid ? 'travel' : 'extrude';
  }
}

/**
 * Parse SONRASI anlamsal denetimler.
 *
 * Tokenizer/handler seviyesindeki hatalar "bu satir anlasilmadi" der; buradaki
 * denetimler ise satirlar tek tek dogru olsa bile programin BUTUNUNDE tehlikeli
 * veya eksik olan seyleri yakalar. Atolyede pahaliya mal olan hatalar
 * genellikle bu turdendir: birim beyan edilmemistir, is mili calistirilmadan
 * kesime girilmistir, ya da takim malzemenin icinde hizli hareket etmektedir.
 */
function checkSemantics(moves: Move[], state: MachineState, out: ParseDiagnostic[]): void {
  if (moves.length === 0) {
    out.push({
      lineIndex: 0,
      severity: 'error',
      code: 'NO_MOTION',
      message: 'Dosyada hicbir hareket komutu bulunamadi.',
    });
    return;
  }

  const isCnc = !moves.some((m) => m.e !== 0);
  const cutting = moves.filter((m) => m.kind === 'extrude' && m.distance > 0);
  const firstCut = cutting[0];

  if (!state.unitsDeclared) {
    out.push({
      lineIndex: 0,
      severity: 'warning',
      code: 'NO_UNITS',
      message: 'Birim komutu (G21 mm / G20 inc) yok; milimetre varsayildi.',
    });
  }

  if (!state.positioningDeclared) {
    out.push({
      lineIndex: 0,
      severity: 'warning',
      code: 'NO_POSITIONING_MODE',
      message: 'Konumlandirma modu (G90 mutlak / G91 artimli) yok; mutlak varsayildi.',
    });
  }

  if (isCnc && firstCut && state.spindleOffCutLine !== null) {
    out.push({
      lineIndex: state.spindleOffCutLine,
      severity: 'warning',
      code: 'SPINDLE_NOT_STARTED',
      message: 'Is mili calistirilmadan (M3/M4) kesme hareketi yapiliyor.',
    });
  }

  const zeroFeed = cutting.find((m) => m.f <= 0);
  if (zeroFeed) {
    out.push({
      lineIndex: zeroFeed.lineIndex,
      severity: 'warning',
      code: 'ZERO_FEEDRATE',
      message: 'Kesme hareketinde ilerleme hizi (F) tanimli degil; tezgah alarm verebilir.',
    });
  }

  if (isCnc && cutting.length > 0) {
    // Malzemenin ust yuzeyi: her kesme hareketinin ULASTIGI derinliklerin
    // (yani uclarinin dusugunun) en yuksegi.
    //
    // Hareketin YUKARI ucuna bakmak yanlis olurdu: guvenli yukseklikten
    // yapilan her dalis (G0 Z5 -> G1 Z-3) o yuksekligi "kesim seviyesi"
    // sanip, parcanin ustunden gecen normal hizli hareketleri tehlikeli
    // gosterirdi.
    let topCutZ = -Infinity;
    for (const m of cutting) topCutZ = Math.max(topCutZ, Math.min(m.to.z, m.from.z));

    let firstUnsafe: Move | null = null;
    let unsafeCount = 0;
    for (const m of moves) {
      if (!m.rapid || m.kind === 'home') continue;
      const movesInXY = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) > 0.01;
      if (!movesInXY) continue;
      if (m.from.z <= topCutZ + 1e-6 && m.to.z <= topCutZ + 1e-6) {
        unsafeCount++;
        if (!firstUnsafe) firstUnsafe = m;
      }
    }

    if (firstUnsafe) {
      out.push({
        lineIndex: firstUnsafe.lineIndex,
        severity: 'warning',
        code: 'RAPID_INSIDE_STOCK',
        message:
          `Malzeme seviyesinin altinda hizli (G0) yatay hareket (${unsafeCount} adet). ` +
          'Takim malzemeye carpabilir; once guvenli Z yuksekligine cikin.',
      });
    }
  }

  if (!isCnc) {
    const belowBed = moves.find((m) => m.kind === 'extrude' && (m.to.z < 0 || m.from.z < 0));
    if (belowBed) {
      out.push({
        lineIndex: belowBed.lineIndex,
        severity: 'error',
        code: 'EXTRUDE_BELOW_BED',
        message: 'Tabla seviyesinin altinda (Z<0) extrude hareketi var.',
      });
    }
  }

  if (state.cannedCycle) {
    out.push({
      lineIndex: moves[moves.length - 1]?.lineIndex ?? 0,
      severity: 'info',
      code: 'CYCLE_NOT_CANCELLED',
      message: 'Delme cevrimi G80 ile iptal edilmeden program bitti.',
    });
  }
}

/**
 * Katman sinirlarini belirler.
 *
 * Oncelik sirasi:
 *   1) Slicer'in katman yorumlari (;LAYER:, ;LAYER_CHANGE, ...) — en guvenilir
 *   2) Extrusion yapan hareketlerin Z'si — Z-hop ve travel'lar katman acmaz
 *   3) Hicbir extrusion yoksa (CNC) ham Z degisimi — derinlik pasolari
 */
function assignLayers(moves: Move[], hints: RawLayerHint[]): Layer[] {
  if (moves.length === 0) return [];

  const boundaries: number[] = []; // katmanin basladigi hareket indeksi

  if (hints.length > 0) {
    let hintCursor = 0;
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      if (!move) continue;
      while (hintCursor < hints.length && (hints[hintCursor]?.lineIndex ?? 0) <= move.lineIndex) {
        if (boundaries[boundaries.length - 1] !== i) boundaries.push(i);
        hintCursor++;
      }
    }
  } else {
    const hasExtrusion = moves.some((m) => m.kind === 'extrude');
    let currentZ: number | null = null;
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      if (!move) continue;
      if (hasExtrusion && move.kind !== 'extrude') continue;
      const z = move.to.z;
      if (currentZ === null || Math.abs(z - currentZ) > LAYER_Z_EPSILON) {
        boundaries.push(i);
        currentZ = z;
      }
    }
  }

  if (boundaries.length === 0) boundaries.push(0);
  // Ilk sinir 0'dan buyukse, oncesindeki hareketler (isinma, home) ilk katmana katilir.
  boundaries[0] = 0;

  const layers: Layer[] = [];
  for (let n = 0; n < boundaries.length; n++) {
    const start = boundaries[n] ?? 0;
    const end = n + 1 < boundaries.length ? (boundaries[n + 1] ?? moves.length) : moves.length;
    // Katmanin Z'si: icindeki ilk extrusion hareketinin Z'si, yoksa ilk hareketin Z'si.
    let z = moves[start]?.to.z ?? 0;
    for (let i = start; i < end; i++) {
      const move = moves[i];
      if (move && move.kind === 'extrude') {
        z = move.to.z;
        break;
      }
    }
    layers.push({ index: n, z, startMove: start, endMove: end });
    for (let i = start; i < end; i++) {
      const move = moves[i];
      if (move) move.layerIndex = n;
    }
  }

  return layers;
}

export * from './tokenizer';
export * from './machineState';
export * from './commands';
export * from './arcs';
