import { useStore } from '@/state/store';

/** Dikey katman slider'i (Faz 2): "1..N katmani goster" + izole mod anahtari. */
export function LayerSlider() {
  const layers = useStore((s) => s.parseResult?.layers ?? []);
  const visibleLayer = useStore((s) => s.visibleLayer);
  const setVisibleLayer = useStore((s) => s.setVisibleLayer);

  if (layers.length === 0) return null;

  const activeLayer = layers[visibleLayer];

  return (
    <div className="panel panel--layer-slider">
      <div className="layer-slider__value">
        {visibleLayer + 1}/{layers.length}
      </div>
      <input
        type="range"
        className="layer-slider__input"
        min={0}
        max={layers.length - 1}
        value={visibleLayer}
        onChange={(e) => setVisibleLayer(Number(e.target.value))}
      />
      <div className="layer-slider__z">{activeLayer ? `${activeLayer.z.toFixed(2)}mm` : ''}</div>
    </div>
  );
}
