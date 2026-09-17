import { useEffect, useRef } from 'react';
import { SceneManager } from './core/SceneManager';
import { GridLayer } from './layers/GridLayer';
import { BuildVolumeLayer } from './layers/BuildVolumeLayer';
import { ToolpathLayer } from './layers/ToolpathLayer';
import { useStore } from '@/state/store';

/**
 * SceneManager'i bir DOM konteynerine baglayan ince React kabugu.
 *
 * ONEMLI KURAL: Three.js nesneleri React state'inde TUTULMAZ. Bu bilesen
 * yalnizca mount/unmount ve store -> SceneManager yonunde tek yonlu kopru
 * kurar (store.subscribe ile), boylece her karede React render olmaz.
 */
export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const manager = new SceneManager();
    manager.mount(container);

    const { buildVolume } = useStore.getState();
    const gridLayer = new GridLayer(buildVolume);
    const buildVolumeLayer = new BuildVolumeLayer(buildVolume);
    const toolpathLayer = new ToolpathLayer();
    toolpathLayer.onFrameRequested = (min, max) => manager.frameBounds(min, max);

    manager.addLayer(gridLayer);
    manager.addLayer(buildVolumeLayer);
    manager.addLayer(toolpathLayer);

    // store -> SceneManager: tek yonlu kopru. Sadece ilgili dilim degistiginde tetiklenir.
    const unsubData = useStore.subscribe((state, prev) => {
      if (state.parseResult !== prev.parseResult) {
        manager.broadcastData(state.parseResult);
      }
    });

    const unsubView = useStore.subscribe((state, prev) => {
      if (state.view !== prev.view) {
        manager.broadcastViewSettings(state.view);
      }
    });

    const unsubVolume = useStore.subscribe((state, prev) => {
      if (state.buildVolume !== prev.buildVolume) {
        gridLayer.setVolume(state.buildVolume);
        buildVolumeLayer.setVolume(state.buildVolume);
      }
    });

    const unsubProgress = useStore.subscribe((state, prev) => {
      if (
        state.visibleLayer !== prev.visibleLayer ||
        state.minVisibleLayer !== prev.minVisibleLayer ||
        state.moveCursor !== prev.moveCursor
      ) {
        manager.broadcastProgress({
          visibleLayer: state.visibleLayer,
          minVisibleLayer: state.minVisibleLayer,
          moveCursor: state.moveCursor,
          time: 0,
        });
      }
    });

    // Baslangic durumunu uygula (ilk yuklemede zaten veri varsa).
    manager.broadcastViewSettings(useStore.getState().view);

    return () => {
      unsubData();
      unsubView();
      unsubVolume();
      unsubProgress();
      manager.dispose();
    };
  }, []);

  return <div ref={containerRef} className="viewport" />;
}
