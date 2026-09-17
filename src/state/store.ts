import { create } from 'zustand';
import { createDocumentSlice, type DocumentSlice } from './slices/documentSlice';
import { createViewSlice, type ViewSlice } from './slices/viewSlice';
import { createPlaybackSlice, type PlaybackSlice } from './slices/playbackSlice';
import { createMachineSlice, type MachineSlice } from './slices/machineSlice';
import { createSelectionSlice, type SelectionSlice } from './slices/selectionSlice';

/**
 * Tek global store, slice'lara bolunmus (zustand).
 * Kural: React bileşenleri store'u SELECTOR ile okur — tum store'u abone
 * olmak buyuk dosyalarda gereksiz render'a yol acar.
 */
export type AppStore = DocumentSlice & ViewSlice & PlaybackSlice & MachineSlice & SelectionSlice;

export const useStore = create<AppStore>()((...a) => ({
  ...createDocumentSlice(...a),
  ...createViewSlice(...a),
  ...createPlaybackSlice(...a),
  ...createMachineSlice(...a),
  ...createSelectionSlice(...a),
}));
