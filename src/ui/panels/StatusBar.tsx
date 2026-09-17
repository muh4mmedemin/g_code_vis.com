import { useStore } from '@/state/store';
import { formatDuration } from '@/utils/format';

/**
 * Alt serit: parse durumu/ilerlemesi, satir sayisi, uyari sayisi.
 * Print modunda aktif katman + Z gosterilir; CNC modunda katman kavrami
 * yaniltici oldugu icin bunun yerine takim ucunun anlik XYZ konumu
 * gosterilir (bkz. LayerSlider'daki ayni gerekce).
 */
export function StatusBar() {
  const mode = useStore((s) => s.mode);
  const fileName = useStore((s) => s.fileName);
  const source = useStore((s) => s.source);
  const parseStatus = useStore((s) => s.parseStatus);
  const parseProgress = useStore((s) => s.parseProgress);
  const parseError = useStore((s) => s.parseError);
  const parseResult = useStore((s) => s.parseResult);
  const visibleLayer = useStore((s) => s.visibleLayer);
  const moveCursor = useStore((s) => s.moveCursor);
  const selectLine = useStore((s) => s.selectLine);

  const lineCount = source ? source.split(/\r\n|\r|\n/).length : 0;
  const layers = parseResult?.layers ?? [];
  const activeLayer = layers[visibleLayer];
  // Bilgi seviyesindeki kayitlar (yok sayilan M kodlari gibi) sayaca girmez;
  // kullaniciyi ilgilendiren gercek sorunlar uyari ve hatalardir.
  const problems = parseResult?.diagnostics.filter((d) => d.severity !== 'info') ?? [];
  const errorCount = problems.filter((d) => d.severity === 'error').length;
  const warningCount = problems.length - errorCount;
  const firstProblem = problems[0];

  const moves = parseResult?.moves ?? [];
  const currentMove = moves[Math.min(Math.floor(moveCursor), Math.max(moves.length - 1, 0))];

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
          {mode === 'cnc' ? (
            <span>
              Takim ucu: X{currentMove ? currentMove.to.x.toFixed(2) : '0.00'} Y
              {currentMove ? currentMove.to.y.toFixed(2) : '0.00'} Z
              {currentMove ? currentMove.to.z.toFixed(2) : '0.00'}
            </span>
          ) : (
            <span>
              Katman {layers.length > 0 ? visibleLayer + 1 : 0}/{layers.length}
              {activeLayer ? ` (Z=${activeLayer.z.toFixed(2)}mm)` : ''}
            </span>
          )}
          <span>{parseResult.stats.totalMoves} hareket</span>
          <span>~{formatDuration(parseResult.stats.estimatedDuration)}</span>
          {problems.length > 0 && (
            <button
              type="button"
              className={
                errorCount > 0
                  ? 'statusbar__problems statusbar__problems--error'
                  : 'statusbar__problems'
              }
              title="Ilk soruna git"
              onClick={() => firstProblem && selectLine(firstProblem.lineIndex)}
            >
              {errorCount > 0 && `${errorCount} hata`}
              {errorCount > 0 && warningCount > 0 && ', '}
              {warningCount > 0 && `${warningCount} uyari`}
            </button>
          )}
        </>
      )}
    </footer>
  );
}
