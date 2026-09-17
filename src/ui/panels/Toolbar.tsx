import { FileDropZone } from './FileDropZone';
import { useStore } from '@/state/store';

/** Ust serit: dosya ac, Print/CNC mod secici, kamera preset'leri. */
export function Toolbar() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);

  return (
    <header className="toolbar">
      <strong className="toolbar__title">G-code Visualizer</strong>
      <FileDropZone />
      <div className="toolbar__spacer" />
      <div className="mode-switch" role="tablist" aria-label="Makine modu">
        <button
          type="button"
          className={mode === 'print' ? 'mode-switch__btn is-active' : 'mode-switch__btn'}
          onClick={() => setMode('print')}
        >
          Print
        </button>
        <button
          type="button"
          className={mode === 'cnc' ? 'mode-switch__btn is-active' : 'mode-switch__btn'}
          onClick={() => setMode('cnc')}
          title="CNC modu: talas kaldirma simulasyonu (Faz 6, henuz aktif degil)"
          disabled
        >
          CNC
        </button>
      </div>
    </header>
  );
}
