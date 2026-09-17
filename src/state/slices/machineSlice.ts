import type { MachineMode, StockDefinition, ToolDefinition } from '@/core/types';

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

/** TODO(sonnet): createMachineSlice implementasyonu. */
