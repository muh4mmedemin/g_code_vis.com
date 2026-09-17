import type { StateCreator } from 'zustand';
import type { AppStore } from '../store';

/**
 * Editor <-> 3D cift yonlu secim koprusu.
 * Editorde satira tiklaninca 3D'de ilgili segment vurgulanir; 3D'de bir
 * segmente tiklaninca editor o satira kayar.
 */
export interface SelectionSlice {
  /** Editorde secili satir (0-tabanli) veya null. */
  selectedLine: number | null;
  /** 3D'de vurgulanan hareket indeksi veya null. */
  hoveredMove: number | null;

  selectLine(lineIndex: number | null): void;
  selectMove(moveIndex: number | null): void;
}

export const createSelectionSlice: StateCreator<AppStore, [], [], SelectionSlice> = (set) => ({
  selectedLine: null,
  hoveredMove: null,

  selectLine(lineIndex) {
    set({ selectedLine: lineIndex });
  },

  selectMove(moveIndex) {
    set({ hoveredMove: moveIndex });
  },
});
