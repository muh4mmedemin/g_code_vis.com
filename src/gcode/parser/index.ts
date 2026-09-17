import type { GcodeStats, Layer, Move, ParseDiagnostic, ParseResult } from '@/core/types';
import { tokenizeLine } from './tokenizer';
import { createInitialState } from './machineState';
import { COMMAND_HANDLERS } from './commands';
import { buildToolpathBuffers } from '../buffers';
import { computeStats } from '../stats';
import { GENERIC_DIALECT_NAME } from '../dialects';

export interface ParseOptions {
  /** Ilerleme bildirimi (0..1). Worker bunu main thread'e aktarir. */
  onProgress?: (ratio: number) => void;
  /** Otomatik tespit yerine zorlanan dialect adi. */
  forceDialect?: string;
}

/**
 * Parser giris noktasi (facade).
 *
 * Akis:
 *   1) satir satir tokenize -> COMMAND_HANDLERS uzerinden state guncelle
 *   2) katman sinirlari Z degisimine gore handler'lar tarafindan belirlenir
 *   3) istatistikleri hesapla (stats.ts) ve buffer'lari kur (buffers.ts)
 *
 * Dialect (slicer) tespiti Faz 5'te eklenecek; simdilik generic kabul edilir.
 */
export function parseGcode(source: string, options: ParseOptions = {}): ParseResult {
  const lines = source.split(/\r\n|\r|\n/);
  const state = createInitialState();
  const moves: Move[] = [];
  const layers: Layer[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  const beginLayer = (z: number): number => {
    const prev = layers[layers.length - 1];
    if (prev) prev.endMove = moves.length;
    const index = layers.length;
    layers.push({ index, z, startMove: moves.length, endMove: moves.length });
    return index;
  };

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
    if (token.command === null) continue;

    const handler = COMMAND_HANDLERS[token.command];
    if (!handler) {
      diagnostics.push({
        lineIndex: i,
        severity: 'warning',
        code: 'UNKNOWN_COMMAND',
        message: `Bilinmeyen komut: ${token.command}`,
      });
      continue;
    }

    handler(token, {
      state,
      emitMove,
      beginLayer,
      diagnostic: (d) => diagnostics.push({ ...d, lineIndex: i }),
    });

    if (options.onProgress && i % progressStep === 0) {
      options.onProgress(i / totalLines);
    }
  }

  const lastLayer = layers[layers.length - 1];
  if (lastLayer) lastLayer.endMove = moves.length;

  const stats: GcodeStats = computeStats(moves, layers);
  const buffers = buildToolpathBuffers(moves);

  options.onProgress?.(1);

  return {
    moves,
    layers,
    stats,
    diagnostics,
    dialect: options.forceDialect ?? GENERIC_DIALECT_NAME,
    buffers,
  };
}

export * from './tokenizer';
export * from './machineState';
export * from './commands';
