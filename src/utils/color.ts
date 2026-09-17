import type { ColorMode } from '@/core/types';

/**
 * Renk yardimcilari: katman indeksi -> rainbow gradient, feedrate -> isi
 * haritasi, hareket tipi -> sabit renk (COLORS).
 * TODO(sonnet).
 */
export function colorFor(_mode: ColorMode, _value: number, _max: number): [number, number, number] {
  throw new Error('NOT_IMPLEMENTED: colorFor');
}
