import { useStore } from '@/state/store';

/**
 * Olcum paneli: iki nokta arasindaki mesafe ve eksen farklari.
 *
 * "Cep gercekten 26 mm cikmis mi, delik merkezleri 32 mm arayla mi?" sorusunu
 * tezgaha gitmeden ekranda cevaplar. Noktalar islenmis parca yuzeyinden
 * secilir; ham blok da islenmis yuzey de olculebilir.
 */
export function MeasurePanel() {
  const active = useStore((s) => s.measureActive);
  const points = useStore((s) => s.measurePoints);
  const toggle = useStore((s) => s.toggleMeasure);
  const clear = useStore((s) => s.clearMeasure);

  const [a, b] = points;
  const delta =
    a && b ? { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z } : null;
  const distance = delta ? Math.hypot(delta.x, delta.y, delta.z) : null;

  return (
    <div className="panel panel--measure">
      <div className="panel__title">Olcum</div>

      <button
        type="button"
        className={active ? 'measure__toggle is-active' : 'measure__toggle'}
        onClick={() => toggle()}
      >
        {active ? 'Olcum acik — kapat' : 'Olcumu baslat'}
      </button>

      {active && points.length < 2 && (
        <p className="measure__hint">
          {points.length === 0
            ? 'Parca uzerinde birinci noktaya tiklayin.'
            : 'Simdi ikinci noktaya tiklayin.'}
        </p>
      )}

      {distance !== null && delta && (
        <>
          <div className="measure__result">{distance.toFixed(2)} mm</div>
          <div className="measure__axes">
            <span>ΔX {delta.x.toFixed(2)}</span>
            <span>ΔY {delta.y.toFixed(2)}</span>
            <span>ΔZ {delta.z.toFixed(2)}</span>
          </div>
          <button type="button" className="measure__clear" onClick={() => clear()}>
            Temizle
          </button>
        </>
      )}
    </div>
  );
}
