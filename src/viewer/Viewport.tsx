import { useEffect, useRef } from 'react';
import { SceneManager } from './core/SceneManager';
import { GridLayer } from './layers/GridLayer';
import { BuildVolumeLayer } from './layers/BuildVolumeLayer';
import { ToolpathLayer } from './layers/ToolpathLayer';
import { SolidPrintLayer } from './layers/SolidPrintLayer';
import { ToolHeadLayer } from './layers/ToolHeadLayer';
import { StockLayer } from '@/cnc/StockLayer';
import { useStore } from '@/state/store';

/** Bir hareketin animasyon suresi (saniye). Feedrate=0 veya cok kisa
 * hareketlerde bile goze carpan bir ilerleme olsun diye alt sinir konur. */
const MIN_MOVE_DURATION = 0.05;

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
    const solidPrintLayer = new SolidPrintLayer();
    const toolHeadLayer = new ToolHeadLayer();
    const stockLayer = new StockLayer();
    /**
     * Kadraj: CNC modunda ham blok toolpath'ten cok daha buyuk olabilir
     * (ornegin 40x50x70 blokta 24x16 bir cep). Yalnizca toolpath'e gore
     * kadraj alinirsa blok ekrana sigmaz; bu yuzden blok varken iki sinir
     * birlestirilir.
     */
    const frameWithStock = (
      min: [number, number, number],
      max: [number, number, number],
    ) => {
      const state = useStore.getState();
      if (state.mode === 'cnc') {
        const { size, origin } = state.stock;
        const stockMin: [number, number, number] = [
          origin.x - size.x / 2,
          origin.y - size.y / 2,
          origin.z - size.z,
        ];
        const stockMax: [number, number, number] = [
          origin.x + size.x / 2,
          origin.y + size.y / 2,
          origin.z,
        ];
        manager.frameBounds(
          [
            Math.min(min[0], stockMin[0]),
            Math.min(min[1], stockMin[1]),
            Math.min(min[2], stockMin[2]),
          ],
          [
            Math.max(max[0], stockMax[0]),
            Math.max(max[1], stockMax[1]),
            Math.max(max[2], stockMax[2]),
          ],
        );
        return;
      }
      manager.frameBounds(min, max);
    };

    toolpathLayer.onFrameRequested = frameWithStock;

    manager.addLayer(gridLayer);
    manager.addLayer(buildVolumeLayer);
    manager.addLayer(toolpathLayer);
    manager.addLayer(solidPrintLayer);
    manager.addLayer(toolHeadLayer);
    manager.addLayer(stockLayer);

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

    // CNC modunda ham blok: stok tanimi degistiginde blok yeniden kurulur,
    // mod degisiminde yalnizca gorunurluk degisir (blok korunur).
    const unsubStock = useStore.subscribe((state, prev) => {
      if (state.stock !== prev.stock) {
        stockLayer.setStock(state.stock, state.tool, state.voxelResolution);
        // Yeni blok olusturuldugunda kadraji bloga gore ayarla.
        const bounds = state.parseResult?.stats.bounds;
        frameWithStock(
          bounds ? [bounds.min.x, bounds.min.y, bounds.min.z] : [0, 0, 0],
          bounds ? [bounds.max.x, bounds.max.y, bounds.max.z] : [0, 0, 0],
        );
      }
      if (state.mode !== prev.mode) {
        stockLayer.setVisible(state.mode === 'cnc');
      }
    });

    // Baslangic durumunu uygula (ilk yuklemede zaten veri varsa).
    manager.broadcastViewSettings(useStore.getState().view);
    stockLayer.setVisible(useStore.getState().mode === 'cnc');

    // --- Simulasyon/oynatma dongusu (Faz 3) ---------------------------------
    // isPlaying acikken moveCursor'u gercek zamana gore ilerletir. Store'un
    // kendisi degil, bu tek rAF dongusu "saat" gorevi gorur; boylece birden
    // fazla bilesen ayni animasyona farkli hizlarda abone olmaya calismaz.
    let rafId = requestAnimationFrame(tick);
    let lastTime = performance.now();

    function tick(now: number) {
      rafId = requestAnimationFrame(tick);
      const deltaSeconds = (now - lastTime) / 1000;
      lastTime = now;

      const state = useStore.getState();
      if (!state.isPlaying) return;

      const moves = state.parseResult?.moves;
      if (!moves || moves.length === 0) {
        useStore.setState({ isPlaying: false });
        return;
      }

      const currentIndex = Math.min(Math.floor(state.moveCursor), moves.length - 1);
      const currentMove = moves[currentIndex];
      const duration = Math.max(currentMove?.duration ?? 0, MIN_MOVE_DURATION);
      const nextCursor = state.moveCursor + (deltaSeconds * state.speed) / duration;

      if (nextCursor >= moves.length) {
        useStore.setState({ moveCursor: moves.length, isPlaying: false });
      } else {
        useStore.setState({ moveCursor: nextCursor });
      }
    }

    return () => {
      cancelAnimationFrame(rafId);
      unsubData();
      unsubView();
      unsubVolume();
      unsubProgress();
      unsubStock();
      manager.dispose();
    };
  }, []);

  return <div ref={containerRef} className="viewport" />;
}
