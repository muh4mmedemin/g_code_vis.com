import type { LayerContext, SceneLayer } from '../core/SceneLayer';
import type { BuildVolume } from '@/core/types';

/**
 * Yazici tablasi/calisma hacmi tel kafes kutusu.
 * CNC modunda ham malzeme sinirlarini gostermek icin de kullanilabilir.
 * TODO(sonnet).
 */
export class BuildVolumeLayer implements SceneLayer {
  readonly id = 'build-volume';
  constructor(private _volume: BuildVolume) {}
  init(_ctx: LayerContext): void {
    throw new Error('NOT_IMPLEMENTED: BuildVolumeLayer.init');
  }
  setVolume(_volume: BuildVolume): void {
    throw new Error('NOT_IMPLEMENTED: BuildVolumeLayer.setVolume');
  }
  dispose(): void {}
}
