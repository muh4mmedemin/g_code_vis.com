import type { GcodeStats, Layer, Move, ParseDiagnostic, ParseResult } from '@/core/types';
import { LAYER_Z_EPSILON } from '@/core/constants';
import { tokenizeLine } from './tokenizer';
import { createInitialState, toMillimeters } from './machineState';
import { COMMAND_HANDLERS, MOTION_COMMANDS } from './commands';
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

    if (token.commands.length === 0) {
      // Komutsuz ama parametreli satir: "F3000" gibi modal feedrate atamalari.
      if (token.params.F !== undefined) {
        state.feedrate = toMillimeters(token.params.F, state.unit);
      }
      continue;
    }

    const ctx = {
      state,
      emitMove,
      diagnostic: (d: Omit<ParseDiagnostic, 'lineIndex'>) =>
        pushDiagnostic({ ...d, lineIndex: i }),
    };

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

function dispatch(
  command: string,
  token: ReturnType<typeof tokenizeLine>,
  ctx: Parameters<(typeof COMMAND_HANDLERS)[string]>[1],
  pushDiagnostic: (d: ParseDiagnostic) => void,
  lineIndex: number,
): void {
  const handler = COMMAND_HANDLERS[command];
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
