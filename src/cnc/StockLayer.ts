import type { LayerContext, PlaybackFrame, SceneLayer } from '@/viewer/core/SceneLayer';
import type { ParseResult, StockDefinition, ToolDefinition } from '@/core/types';

/**
 * "Kesilen parcanin 3D modeli" katmani (Faz 6).
 *
 * Diger katmanlarla ayni SceneLayer arayuzunu uygular; bu yuzden viewer'a
 * eklenmesi tek satirdir:  sceneManager.addLayer(new StockLayer(...))
 *
 * Akis: VoxelGrid.fill() -> simulasyon ilerledikce carveRange() -> remeshRegion()
 *       -> mesh guncelle.
 * TODO(sonnet).
 */
export class StockLayer implements SceneLayer {
  readonly id = 'cnc-stock';

  constructor(
    private _stock: StockDefinition,
    private _tool: ToolDefinition,
    private _resolution: number,
  ) {}

  init(_ctx: LayerContext): void {
    throw new Error('NOT_IMPLEMENTED: StockLayer.init');
  }
  onData(_data: ParseResult | null): void {
    throw new Error('NOT_IMPLEMENTED: StockLayer.onData');
  }
  onProgress(_state: PlaybackFrame): void {
    throw new Error('NOT_IMPLEMENTED: StockLayer.onProgress');
  }
  dispose(): void {}
}
