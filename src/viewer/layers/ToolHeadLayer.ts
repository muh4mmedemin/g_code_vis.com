import type { LayerContext, PlaybackFrame, SceneLayer } from '../core/SceneLayer';

/**
 * Simulasyon sirasinda nozzle/kesici takimin anlik konumunu gosteren isaretci
 * (koni/silindir). CNC modunda takim capina gore olceklenir.
 * TODO(sonnet).
 */
export class ToolHeadLayer implements SceneLayer {
  readonly id = 'tool-head';
  init(_ctx: LayerContext): void {
    throw new Error('NOT_IMPLEMENTED: ToolHeadLayer.init');
  }
  onProgress(_state: PlaybackFrame): void {
    throw new Error('NOT_IMPLEMENTED: ToolHeadLayer.onProgress');
  }
  dispose(): void {}
}
