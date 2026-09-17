import type { DocumentSlice } from './slices/documentSlice';
import type { ViewSlice } from './slices/viewSlice';
import type { PlaybackSlice } from './slices/playbackSlice';
import type { MachineSlice } from './slices/machineSlice';
import type { SelectionSlice } from './slices/selectionSlice';

/**
 * Tek global store, slice'lara bolunmus (zustand).
 * Kural: React bileşenleri store'u SELECTOR ile okur — tum store'u abone
 * olmak buyuk dosyalarda gereksiz render'a yol acar.
 */
export type AppStore = DocumentSlice & ViewSlice & PlaybackSlice & MachineSlice & SelectionSlice;

/**
 * TODO(sonnet):
 *   export const useStore = create<AppStore>()((...a) => ({
 *     ...createDocumentSlice(...a),
 *     ...createViewSlice(...a),
 *     ...
 *   }));
 */
export declare const useStore: {
  <T>(selector: (state: AppStore) => T): T;
  getState(): AppStore;
  setState(patch: Partial<AppStore>): void;
  subscribe(listener: (state: AppStore, prev: AppStore) => void): () => void;
};
