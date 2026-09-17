import type { ParseResult } from '@/core/types';

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
 *   1) dialect tespiti (dialects/detect.ts)
 *   2) satir satir tokenize -> COMMAND_HANDLERS uzerinden state guncelle
 *   3) katman sinirlarini belirle (dialect ipuclari + Z degisimi)
 *   4) istatistikleri hesapla (stats.ts) ve buffer'lari kur (buffers.ts)
 *
 * TODO(sonnet): implementasyon.
 */
export function parseGcode(_source: string, _options: ParseOptions = {}): ParseResult {
  throw new Error('NOT_IMPLEMENTED: parseGcode');
}

export * from './tokenizer';
export * from './machineState';
export * from './commands';
