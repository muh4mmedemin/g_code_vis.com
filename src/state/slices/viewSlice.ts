import type { BuildVolume, ViewSettings } from '@/core/types';

/** Gorunum ayarlari + kamera komutlari. */
export interface ViewSlice {
  view: ViewSettings;
  buildVolume: BuildVolume;

  setView(patch: Partial<ViewSettings>): void;
  setBuildVolume(volume: BuildVolume): void;
}

/** TODO(sonnet): createViewSlice implementasyonu. */
