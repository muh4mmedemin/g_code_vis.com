import { useStore } from '@/state/store';
import { formatDuration } from '@/utils/format';

/** Alt serit: parse durumu/ilerlemesi, satir sayisi, aktif katman ve Z, uyari sayisi. */
export function StatusBar() {
  const fileName = useStore((s) => s.fileName);
  const source = useStore((s) => s.source);
  const parseStatus = useStore((s) => s.parseStatus);
  const parseProgress = useStore((s) => s.parseProgress);
  const parseError = useStore((s) => s.parseError);
  const parseResult = useStore((s) => s.parseResult);
  const visibleLayer = useStore((s) => s.visibleLayer);

  const lineCount = source ? source.split(/\r\n|\r|\n/).length : 0;
  const layers = parseResult?.layers ?? [];
  const activeLayer = layers[visibleLayer];
  const warningCount =
    parseResult?.diagnostics.filter((d) => d.severity !== 'info').length ?? 0;

  return (
    <footer className="statusbar">
      <span>{fileName ?? 'dosya yuklenmedi'}</span>
      <span>{lineCount} satir</span>
      {parseStatus === 'parsing' && (
        <span>Parse ediliyor… {Math.round(parseProgress * 100)}%</span>
      )}
      {parseStatus === 'error' && <span className="statusbar__error">Hata: {parseError}</span>}
      {parseStatus === 'ready' && parseResult && (
        <>
          <span>
            Katman {layers.length > 0 ? visibleLayer + 1 : 0}/{layers.length}
            {activeLayer ? ` (Z=${activeLayer.z.toFixed(2)}mm)` : ''}
          </span>
          <span>{parseResult.stats.totalMoves} hareket</span>
          <span>~{formatDuration(parseResult.stats.estimatedDuration)}</span>
          {warningCount > 0 && (
            <span className="statusbar__warning">{warningCount} uyari</span>
          )}
        </>
      )}
    </footer>
  );
}
