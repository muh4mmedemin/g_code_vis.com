import { useStore } from '@/state/store';
import type { ColorMode } from '@/core/types';

/** Gorunum anahtarlari: travel goster/gizle, renk modu, grid, calisma hacmi. */
export function ViewOptionsPanel() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  return (
    <div className="panel panel--view-options">
      <div className="view-options__row view-options__row--segmented">
        <span>Gorunum:</span>
        <div className="segmented">
          <button
            type="button"
            className={view.renderMode === 'lines' ? 'segmented__btn is-active' : 'segmented__btn'}
            onClick={() => setView({ renderMode: 'lines' })}
          >
            Cizgi
          </button>
          <button
            type="button"
            className={view.renderMode === 'solid' ? 'segmented__btn is-active' : 'segmented__btn'}
            onClick={() => setView({ renderMode: 'solid' })}
          >
            Yuzey
          </button>
        </div>
      </div>
      <div className="view-options__row view-options__row--segmented">
        <span>Islenmis yuzey:</span>
        <div className="segmented">
          <button
            type="button"
            className={
              view.stockSurface === 'smooth' ? 'segmented__btn is-active' : 'segmented__btn'
            }
            onClick={() => setView({ stockSurface: 'smooth' })}
            title="Kesilen yerler purüzsuz gosterilir (tezgahtan cikan parca gibi)"
          >
            Purüzsuz
          </button>
          <button
            type="button"
            className={
              view.stockSurface === 'voxel' ? 'segmented__btn is-active' : 'segmented__btn'
            }
            onClick={() => setView({ stockSurface: 'voxel' })}
            title="Simulasyon hucreleri oldugu gibi gosterilir"
          >
            Hucreli
          </button>
        </div>
      </div>
      <label className="view-options__row">
        <input
          type="checkbox"
          checked={view.showToolpath}
          onChange={(e) => setView({ showToolpath: e.target.checked })}
        />
        Takim yolu
      </label>
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
