import type { StateCreator } from 'zustand';
import type { BuildVolume, ViewSettings } from '@/core/types';
import { DEFAULT_BUILD_VOLUME, DEFAULT_VIEW_SETTINGS } from '@/core/constants';
import type { AppStore } from '../store';

/** Gorunum ayarlari + kamera komutlari. */
export interface ViewSlice {
  view: ViewSettings;
  buildVolume: BuildVolume;

  setView(patch: Partial<ViewSettings>): void;
  setBuildVolume(volume: BuildVolume): void;
}

export const createViewSlice: StateCreator<AppStore, [], [], ViewSlice> = (set) => ({
  view: { ...DEFAULT_VIEW_SETTINGS },
  buildVolume: { ...DEFAULT_BUILD_VOLUME },

  setView(patch) {
    set((state) => ({ view: { ...state.view, ...patch } }));
  },

  setBuildVolume(volume) {
    set({ buildVolume: volume });
  },
});
