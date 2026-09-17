import { useStore } from '@/state/store';

/**
 * Dikey katman slider'i (Faz 2): "1..N katmani goster" + izole mod anahtari.
 *
 * Sadece Print modunda gosterilir: CNC'de Z degisimleri gercek baski
 * katmanlarini degil, rastgele derinlik/pas gecislerini temsil eder, bu
 * yuzden "Katman" kavrami CNC'de yaniltici olur. CNC'de toolpath'in
 * tamami gorunur kalir, ilerleme yalnizca simulasyon (takim ucu) ile
 * takip edilir.
 */
export function LayerSlider() {
  const mode = useStore((s) => s.mode);
  const parseResult = useStore((s) => s.parseResult);
  const layers = parseResult?.layers;
  const visibleLayer = useStore((s) => s.visibleLayer);
  const setVisibleLayer = useStore((s) => s.setVisibleLayer);

  if (mode === 'cnc') return null;
  if (!layers || layers.length === 0) return null;

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
