import type { LayerContext, PlaybackFrame, SceneLayer } from '../core/SceneLayer';
import type { ParseResult, ViewSettings } from '@/core/types';

/**
 * Ana toolpath gorsellestirmesi (Faz 1-3).
 *
 * Yaklasim: TEK bir THREE.LineSegments + BufferGeometry. Katman filtreleme ve
 * simulasyon ilerlemesi geometriyi yeniden kurmadan yapilir:
 *   - hizli yol: geometry.setDrawRange(0, count*2) — hareketler sirali oldugu
 *     icin hem katman hem simulasyon kesme islemi bir drawRange'e dusurulebilir
 *   - renklendirme: per-vertex attribute (kind/layer/feedrate) + shader uniform
 * Boylece 1M+ segmentte bile slider akici kalir.
 *
 * TODO(sonnet).
 */
export class ToolpathLayer implements SceneLayer {
  readonly id = 'toolpath';
  init(_ctx: LayerContext): void {
    throw new Error('NOT_IMPLEMENTED: ToolpathLayer.init');
  }
  onData(_data: ParseResult | null): void {
    throw new Error('NOT_IMPLEMENTED: ToolpathLayer.onData');
  }
  onViewSettings(_settings: ViewSettings): void {
    throw new Error('NOT_IMPLEMENTED: ToolpathLayer.onViewSettings');
  }
  onProgress(_state: PlaybackFrame): void {
    throw new Error('NOT_IMPLEMENTED: ToolpathLayer.onProgress');
  }
  dispose(): void {}
}
