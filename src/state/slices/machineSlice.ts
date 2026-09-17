import type { StateCreator } from 'zustand';
import type { MachineMode, StockDefinition, ToolDefinition } from '@/core/types';
import { DEFAULT_STOCK, DEFAULT_TOOL } from '@/core/constants';
import type { AppStore } from '../store';

/** Print / CNC modu ve CNC'ye ozel ayarlar (Faz 6). */
export interface MachineSlice {
  mode: MachineMode;
  stock: StockDefinition;
  tool: ToolDefinition;
  /** Voxel grid'in en uzun kenardaki hucre sayisi. */
  voxelResolution: number;

  setMode(mode: MachineMode): void;
  setStock(patch: Partial<StockDefinition>): void;
  setTool(patch: Partial<ToolDefinition>): void;
  setVoxelResolution(n: number): void;
}

export const createMachineSlice: StateCreator<AppStore, [], [], MachineSlice> = (set) => ({
  mode: 'print',
  stock: { ...DEFAULT_STOCK },
  tool: { ...DEFAULT_TOOL },
  voxelResolution: 128,

  setMode(mode) {
    set({ mode });
  },

  setStock(patch) {
    set((state) => ({ stock: { ...state.stock, ...patch } }));
  },

  setTool(patch) {
    set((state) => ({ tool: { ...state.tool, ...patch } }));
  },

  setVoxelResolution(n) {
    set({ voxelResolution: n });
  },
});
