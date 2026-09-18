import type { GcodeStats, Layer, Move, ParseDiagnostic, ParseResult } from '@/core/types';
import { LAYER_Z_EPSILON } from '@/core/constants';
import { tokenizeLine } from './tokenizer';
import { createInitialState, toMillimeters, type MachineState } from './machineState';
import { COMMAND_HANDLERS, MODAL_REPEATABLE, MOTION_COMMANDS, getHandler } from './commands';
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

  const emitMove = (move: Move): void => {
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

  for (let i = 0; i < totalLines; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.trim().length === 0) continue;

    const token = tokenizeLine(line, i);

    // Slicer'in katman yorumlari (varsa) sinir olarak kaydedilir.
    if (token.comment && dialect) {
      const hint = dialect.parseLayerHint(token.comment);
      if (hint) layerHints.push({ lineIndex: i, z: hint.z });
    }

    const ctx = {
      state,
      emitMove,
      diagnostic: (d: Omit<ParseDiagnostic, 'lineIndex'>) =>
        pushDiagnostic({ ...d, lineIndex: i }),
    };

    if (token.commands.length === 0) {
      // Komutsuz ama parametreli satir: "F3000" gibi modal feedrate atamalari.
      if (token.params.F !== undefined) {
        state.feedrate = toMillimeters(token.params.F, state.unit);
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
    for (const command of token.commands) {
      if (!MOTION_COMMANDS.has(command)) continue;
      dispatch(command, token, ctx, pushDiagnostic, i);
    }

    if (options.onProgress && i % progressStep === 0) {
      options.onProgress(i / totalLines);
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

function resolveDialect(lines: string[], forced?: string): Dialect | null {
  if (forced) return DIALECTS.find((d) => d.name === forced) ?? null;
  return detectDialect(lines.slice(0, DIALECT_SNIFF_LINES));
}

/** Satirda konum/yay belirten bir harf var mi? (modal hareket tekrari icin) */
function hasAxisWord(token: ReturnType<typeof tokenizeLine>): boolean {
  const p = token.params;
  return (
    p.X !== undefined ||
    p.Y !== undefined ||
    p.Z !== undefined ||
    p.E !== undefined ||
    p.I !== undefined ||
    p.J !== undefined ||
    p.K !== undefined ||
    p.R !== undefined
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
    // Malzemenin "ust yuzeyi" olarak kesimin yapildigi en yuksek Z alinir.
    // Bundan ASAGIDA yapilan hizli (G0) XY hareketi, takimin malzeme icinde
    // hizli surunmesi demektir: kirilan takimlarin klasik sebebi.
    let topCutZ = -Infinity;
    for (const m of cutting) topCutZ = Math.max(topCutZ, m.to.z, m.from.z);

    let firstUnsafe: Move | null = null;
    let unsafeCount = 0;
    for (const m of moves) {
      if (!m.rapid || m.kind === 'home') continue;
      const movesInXY = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) > 0.01;
      if (!movesInXY) continue;
      if (m.from.z < topCutZ - 1e-6 && m.to.z < topCutZ - 1e-6) {
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
