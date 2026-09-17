import type { GcodeStats, Layer, Move } from '@/core/types';

/**
 * Hareket listesinden istatistik uretir (Faz 4 tam paneli sonra gelecek;
 * bu fonksiyon veri modelinin bir parcasi oldugu icin simdiden dolduruldu).
 */
export function computeStats(moves: Move[], layers: Layer[]): GcodeStats {
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };

  let filamentLength = 0;
  let distanceExtrude = 0;
  let distanceTravel = 0;
  let estimatedDuration = 0;

  for (const move of moves) {
    for (const p of [move.from, move.to]) {
      if (p.x < bounds.min.x) bounds.min.x = p.x;
      if (p.y < bounds.min.y) bounds.min.y = p.y;
      if (p.z < bounds.min.z) bounds.min.z = p.z;
      if (p.x > bounds.max.x) bounds.max.x = p.x;
      if (p.y > bounds.max.y) bounds.max.y = p.y;
      if (p.z > bounds.max.z) bounds.max.z = p.z;
    }

    if (move.kind === 'extrude') {
      distanceExtrude += move.distance;
      if (move.e > 0) filamentLength += move.e;
    } else if (move.kind === 'travel') {
      distanceTravel += move.distance;
    }

    estimatedDuration += move.duration;
  }

  if (!Number.isFinite(bounds.min.x)) {
    bounds.min = { x: 0, y: 0, z: 0 };
    bounds.max = { x: 0, y: 0, z: 0 };
  }

  return {
    totalMoves: moves.length,
    layerCount: layers.length,
    estimatedDuration,
    filamentLength,
    distanceExtrude,
    distanceTravel,
    bounds,
  };
}

/**
 * Tek bir hareketin tahmini suresi (saniye).
 *
 * Basit model: distance / (feedrate / 60). Ivme/jerk hesaba katilmaz —
 * slicer tahminiyle birebir tutmayabilir, UI'da bu not edilmeli.
 */
export function estimateMoveDuration(distanceMm: number, feedrateMmPerMin: number): number {
  if (feedrateMmPerMin <= 0) return 0;
  return (distanceMm / feedrateMmPerMin) * 60;
}
