import { useStore } from '@/state/store';
import type { ColorMode } from '@/core/types';

/** Gorunum anahtarlari: travel goster/gizle, renk modu, grid, calisma hacmi. */
export function ViewOptionsPanel() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  return (
    <div className="panel panel--view-options">
      <label className="view-options__row">
        <input
          type="checkbox"
          checked={view.showTravel}
          onChange={(e) => setView({ showTravel: e.target.checked })}
        />
        Travel hareketleri
      </label>
      <label className="view-options__row">
        <input
          type="checkbox"
          checked={view.showGrid}
          onChange={(e) => setView({ showGrid: e.target.checked })}
        />
        Grid
      </label>
      <label className="view-options__row">
        <input
          type="checkbox"
          checked={view.showBuildVolume}
          onChange={(e) => setView({ showBuildVolume: e.target.checked })}
        />
        Calisma hacmi
      </label>
      <label className="view-options__row">
        <span>Renk:</span>
        <select
          value={view.colorMode}
          onChange={(e) => setView({ colorMode: e.target.value as ColorMode })}
        >
          <option value="kind">Hareket tipi</option>
          <option value="layer">Katman (rainbow)</option>
        </select>
      </label>
    </div>
  );
}
