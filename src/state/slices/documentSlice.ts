import type { StateCreator } from 'zustand';
import type { ParseResult } from '@/core/types';
import { parseInWorker } from '@/gcode/worker/client';
import type { AppStore } from '../store';

/** Yuklenen dosya + editordeki metin + parse sonucu. */
export interface DocumentSlice {
  fileName: string | null;
  /** Editordeki ham G-code metni (tek dogruluk kaynagi). */
  source: string;
  parseResult: ParseResult | null;
  parseStatus: 'idle' | 'parsing' | 'ready' | 'error';
  parseProgress: number;
  parseError: string | null;

  loadFile(file: File): Promise<void>;
  setSource(source: string): void;
  /** Mevcut source'u (yeniden) parse eder — editor degisiminde debounce ile. */
  reparse(): Promise<void>;
  closeDocument(): void;
}

let activeParse: { cancel: () => void } | null = null;

export const createDocumentSlice: StateCreator<AppStore, [], [], DocumentSlice> = (
  set,
  get,
) => ({
  fileName: null,
  source: '',
  parseResult: null,
  parseStatus: 'idle',
  parseProgress: 0,
  parseError: null,

  async loadFile(file) {
    const text = await file.text();
    set({ fileName: file.name, source: text });
    await get().reparse();
  },

  setSource(source) {
    set({ source });
  },

  async reparse() {
    activeParse?.cancel();

    const source = get().source;
    if (source.trim().length === 0) {
      set({ parseResult: null, parseStatus: 'idle', parseProgress: 0, parseError: null });
      return;
    }

    set({ parseStatus: 'parsing', parseProgress: 0, parseError: null });

    // Kesici telafisi (G41/G42) tezgahta ofset tablosundan okunur; burada
    // kullanicinin CNC panelinde tanimladigi takim capi o rolu ustlenir.
    // Boylece G41/G42 iceren programlarda parca gercek olcusunde cikar.
    const toolRadius = get().tool.diameter > 0 ? get().tool.diameter / 2 : undefined;

    const handle = parseInWorker(
      source,
      (ratio) => {
        set({ parseProgress: ratio });
      },
      { toolRadius },
    );
    activeParse = handle;

    try {
      const result = await handle.promise;
      set({
        parseResult: result,
        parseStatus: 'ready',
        parseProgress: 1,
        // Varsayilan: tum katmanlar ve tum hareketler gorunur (tam toolpath).
        visibleLayer: Math.max(0, result.layers.length - 1),
        minVisibleLayer: 0,
        moveCursor: result.moves.length,
      });
    } catch (err) {
      set({
        parseStatus: 'error',
        parseError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  closeDocument() {
    activeParse?.cancel();
    set({
      fileName: null,
      source: '',
      parseResult: null,
      parseStatus: 'idle',
      parseProgress: 0,
      parseError: null,
    });
  },
});
