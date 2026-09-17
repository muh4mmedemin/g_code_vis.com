import { Viewport } from './Viewport';
import { ViewportOverlay } from './ViewportOverlay';

/**
 * Sag yari: 3D sahne. Canvas'in uzerine mutlak konumlu overlay UI binder
 * (katman slider'i, oynatma kontrolleri, kamera preset'leri, istatistikler).
 */
export function ViewerPane() {
  return (
    <section className="pane pane--viewer">
      <Viewport />
      <ViewportOverlay />
    </section>
  );
}
