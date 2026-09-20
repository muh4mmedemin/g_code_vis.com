import { useMemo } from 'react';
import { useStore } from '@/state/store';
import { formatDuration, formatLength } from '@/utils/format';

/**
 * Istatistik paneli: dosyanin ozeti.
 *
 * Print ve CNC'de ayni sayilar anlamli degildir — baskida filament ve katman,
 * CNC'de kesim mesafesi ve derinlik onemlidir — bu yuzden panel moda gore
 * farkli satirlar gosterir.
 *
 * PERFORMANS NOTU: burada `moveCursor` gibi her karede degisen alanlara abone
 * OLUNMAZ; aksi halde simulasyon boyunca saniyede 60 kez React render'i
 * tetiklenirdi. Anlik konum/ilerleme alt seritte (StatusBar) gosterilir.
 */
export function StatsPanel() {
  const mode = useStore((s) => s.mode);
  const parseResult = useStore((s) => s.parseResult);
  const parseStatus = useStore((s) => s.parseStatus);

  const derived = useMemo(() => {
    if (!parseResult) return null;
    const { moves, layers, stats } = parseResult;

    const tools = new Set<number>();
    for (const move of moves) tools.add(move.tool);

    // Ortalama katman yuksekligi: ardisik katman Z farklarinin ortalamasi.
    let layerHeight = 0;
    if (layers.length > 1) {
      let total = 0;
      let count = 0;
      for (let i = 1; i < layers.length; i++) {
        const delta = Math.abs((layers[i]?.z ?? 0) - (layers[i - 1]?.z ?? 0));
        if (delta > 1e-6) {
          total += delta;
          count++;
        }
      }
      layerHeight = count > 0 ? total / count : 0;
    }

    const size = {
      x: stats.bounds.max.x - stats.bounds.min.x,
      y: stats.bounds.max.y - stats.bounds.min.y,
      z: stats.bounds.max.z - stats.bounds.min.z,
    };

    const problems = parseResult.diagnostics.filter((d) => d.severity !== 'info');
    const errorCount = problems.filter((d) => d.severity === 'error').length;

    return {
      tools: tools.size,
      layerHeight,
      size,
      errorCount,
      warningCount: problems.length - errorCount,
      deepestZ: stats.bounds.min.z,
    };
  }, [parseResult]);

  if (parseStatus === 'parsing') {
    return (
      <div className="panel panel--stats">
        <div className="panel__title">Istatistikler</div>
        <p className="stats__empty">Parse ediliyor…</p>
      </div>
    );
  }

  if (!parseResult || !derived) {
    return (
      <div className="panel panel--stats">
        <div className="panel__title">Istatistikler</div>
        <p className="stats__empty">Bir G-code dosyasi yukleyin.</p>
      </div>
    );
  }

  const { stats, layers, dialect } = parseResult;

  const row = (label: string, value: string, title?: string) => (
    <div className="stats__row" key={label} title={title}>
      <span className="stats__label">{label}</span>
      <span className="stats__value">{value}</span>
    </div>
  );

  return (
    <div className="panel panel--stats">
      <div className="panel__title">Istatistikler</div>

      {row('Format', dialect)}
      {row(
        // CNC'de blogun olculeri hemen yukaridaki panelde yazar; buradaki
        // kutu takim yolunun kapladigi alandir, karismasin diye adi farkli.
        mode === 'cnc' ? 'Isleme alani (mm)' : 'Olculer (mm)',
        `${derived.size.x.toFixed(1)} × ${derived.size.y.toFixed(1)} × ` +
          `${derived.size.z.toFixed(1)}`,
        'Takim yolunun kapladigi kutu (bounding box)',
      )}
      {row('Hareket', `${stats.totalMoves}`)}
      {row(
        'Tahmini sure',
        `~${formatDuration(stats.estimatedDuration)}`,
        'Ivme ve jerk hesaba katilmaz; tezgah/slicer tahmininden sapabilir.',
      )}

      <div className="stats__divider" />

      {mode === 'print' ? (
        <>
          {row('Katman', `${layers.length}`)}
          {derived.layerHeight > 0 &&
            row('Katman yuksekligi', `${derived.layerHeight.toFixed(2)} mm`, 'Ortalama')}
          {row('Filament', formatLength(stats.filamentLength))}
          {row('Extrude mesafesi', formatLength(stats.distanceExtrude))}
          {row('Bos hareket', formatLength(stats.distanceTravel))}
        </>
      ) : (
        <>
          {row('Z seviyesi', `${layers.length}`, 'Farkli derinlikteki paso sayisi')}
          {row('En derin Z', `${derived.deepestZ.toFixed(2)} mm`)}
          {row('Kesim mesafesi', formatLength(stats.distanceExtrude))}
          {row('Bos hareket', formatLength(stats.distanceTravel))}
          {row('Takim', `${derived.tools}`)}
        </>
      )}

      {(derived.errorCount > 0 || derived.warningCount > 0) && (
        <>
          <div className="stats__divider" />
          <div className="stats__row">
            <span className="stats__label">Sorun</span>
            <span
              className={
                derived.errorCount > 0 ? 'stats__value stats__value--error' : 'stats__value'
              }
            >
              {derived.errorCount > 0 && `${derived.errorCount} hata`}
              {derived.errorCount > 0 && derived.warningCount > 0 && ', '}
              {derived.warningCount > 0 && `${derived.warningCount} uyari`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
