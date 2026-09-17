import type { StateCreator } from 'zustand';
import type { AppStore } from '../store';

/** Katman slider'i + simulasyon durumu (Faz 2-3). */
export interface PlaybackSlice {
  isPlaying: boolean;
  speed: number;
  /** Gorunur en ust katman. */
  visibleLayer: number;
  /** Izole modda gorunur en alt katman. */
  minVisibleLayer: number;
  /** Simulasyon imleci (hareket indeksi). */
  moveCursor: number;

  play(): void;
  pause(): void;
  stepForward(n?: number): void;
  stepBackward(n?: number): void;
  seekToMove(index: number): void;
  seekToTime(seconds: number): void;
  setVisibleLayer(index: number): void;
  setSpeed(speed: number): void;
}

/**
 * Oynatma dongusunun kendisi viewer/Viewport.tsx icindeki tek bir rAF
 * dongusunde yasar (bkz. o dosyadaki 'tick'); bu slice yalnizca durumu
 * tutar. play() moveCursor sonda ise basa sarar, boylece "Baslat" her
 * zaman basindan itibaren adim adim oynatir.
 */
export const createPlaybackSlice: StateCreator<AppStore, [], [], PlaybackSlice> = (
  set,
  get,
) => ({
  isPlaying: false,
  speed: 1,
  visibleLayer: 0,
  minVisibleLayer: 0,
  moveCursor: 0,

  play() {
    const total = get().parseResult?.moves.length ?? 0;
    if (total === 0) return;
    set((state) => ({
      isPlaying: true,
      moveCursor: state.moveCursor >= total ? 0 : state.moveCursor,
    }));
  },

  pause() {
    set({ isPlaying: false });
  },

  stepForward(n = 1) {
    const total = get().parseResult?.moves.length ?? 0;
    set((state) => ({ moveCursor: Math.min(total, state.moveCursor + n) }));
  },

  stepBackward(n = 1) {
    set((state) => ({ moveCursor: Math.max(0, state.moveCursor - n) }));
  },

  seekToMove(index) {
    const total = get().parseResult?.moves.length ?? 0;
    set({ moveCursor: Math.max(0, Math.min(total, index)) });
  },

  seekToTime(seconds) {
    const moves = get().parseResult?.moves ?? [];
    let cursor = moves.length;
    let elapsed = 0;
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      if (!move) continue;
      if (elapsed + move.duration > seconds) {
        cursor = i;
        break;
      }
      elapsed += move.duration;
    }
    set({ moveCursor: cursor });
  },

  setVisibleLayer(index) {
    const layerCount = get().parseResult?.layers.length ?? 0;
    set({ visibleLayer: Math.max(0, Math.min(layerCount - 1, index)) });
  },

  setSpeed(speed) {
    set({ speed });
  },
});
