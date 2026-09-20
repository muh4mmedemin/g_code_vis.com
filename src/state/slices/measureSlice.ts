import type { StateCreator } from 'zustand';
import type { Vec3 } from '@/core/types';
import type { AppStore } from '../store';

/**
 * Olcum araci durumu.
 *
 * Kullanici islenmis parca uzerinde iki nokta secer; aradaki mesafe ve eksen
 * farklari gosterilir ("cep gercekten 26 mm cikmis mi, delikler 32 mm arayla
 * mi?"). Noktalar sahneden raycast ile alinir (bkz. SceneManager.pickPoint).
 */
export interface MeasureSlice {
  measureActive: boolean;
  /** En fazla iki nokta tutulur; ucuncu tiklama yeni olcume baslar. */
  measurePoints: Vec3[];

  toggleMeasure(active?: boolean): void;
  addMeasurePoint(point: Vec3): void;
  clearMeasure(): void;
}

export const createMeasureSlice: StateCreator<AppStore, [], [], MeasureSlice> = (set) => ({
  measureActive: false,
  measurePoints: [],

  toggleMeasure(active) {
    set((state) => {
      const next = active ?? !state.measureActive;
      return { measureActive: next, measurePoints: next ? state.measurePoints : [] };
    });
  },

  addMeasurePoint(point) {
    set((state) => ({
      measurePoints:
        state.measurePoints.length >= 2 ? [point] : [...state.measurePoints, point],
    }));
  },

  clearMeasure() {
    set({ measurePoints: [] });
  },
});
