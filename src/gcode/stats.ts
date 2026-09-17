import type { GcodeStats, Layer, Move } from '@/core/types';

/**
 * Hareket listesinden istatistik uretir (Faz 4).
 * TODO(sonnet): bounds, toplam mesafe, filament, sure toplami.
 */
export function computeStats(_moves: Move[], _layers: Layer[]): GcodeStats {
  throw new Error('NOT_IMPLEMENTED: computeStats');
}

/**
 * Tek bir hareketin tahmini suresi (saniye).
 *
 * Basit model: distance / (feedrate / 60). Ivme/jerk hesaba katilmaz —
 * slicer tahminiyle birebir tutmayabilir, UI'da bu not edilmeli.
 * TODO(sonnet): implementasyon (ve ilerde opsiyonel trapez hiz profili).
 */
export function estimateMoveDuration(_distanceMm: number, _feedrateMmPerMin: number): number {
  throw new Error('NOT_IMPLEMENTED: estimateMoveDuration');
}
