import { useStore } from '@/state/store';

/** Editor ust seridi: dosya adi ve parse durumu ozeti. */
export function EditorToolbar() {
  const fileName = useStore((s) => s.fileName);
  const parseStatus = useStore((s) => s.parseStatus);

  const statusLabel: Record<typeof parseStatus, string> = {
    idle: '',
    parsing: 'parse ediliyor…',
    ready: 'hazir',
    error: 'hata',
  };

  return (
    <div className="pane__header">
      <span>{fileName ?? 'Adsiz G-code'}</span>
      {statusLabel[parseStatus] && (
        <span className="pane__header-status">{statusLabel[parseStatus]}</span>
      )}
    </div>
  );
}
