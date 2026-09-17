import type { LayerContext, SceneLayer } from '../core/SceneLayer';
import type { BuildVolume } from '@/core/types';

/**
 * Blender tarzi zemin gridi + eksen cizgileri (X kirmizi / Y yesil).
 * 10 mm kucuk, 100 mm buyuk bolme onerilir.
 * TODO(sonnet): GridHelper veya custom shader grid (sonsuz grid daha sik).
 */
export class GridLayer implements SceneLayer {
  readonly id = 'grid';
  constructor(private _volume: BuildVolume) {}
  init(_ctx: LayerContext): void {
    throw new Error('NOT_IMPLEMENTED: GridLayer.init');
  }
  dispose(): void {}
}
