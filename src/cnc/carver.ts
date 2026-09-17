import type { Move, ToolDefinition } from '@/core/types';
import type { VoxelGrid } from './VoxelGrid';

/**
 * Talas kaldirma cekirdegi (Faz 6).
 *
 * Her kesme hareketi icin takim hacminin supurdugu bolge (swept volume)
 * hesaplanir ve o bolgedeki voxel'ler bosaltilir.
 * - flat end mill  -> silindir supurmesi (capsule, XY'de dikdortgen+yariay)
 * - ball nose      -> kure supurmesi
 * TODO(sonnet).
 */
export function carveMove(_grid: VoxelGrid, _move: Move, _tool: ToolDefinition): void {
  throw new Error('NOT_IMPLEMENTED: carveMove');
}

/** Bir hareket araligini toplu isler (simulasyon adimlari icin). */
export function carveRange(
  _grid: VoxelGrid,
  _moves: Move[],
  _from: number,
  _to: number,
  _tool: ToolDefinition,
): void {
  throw new Error('NOT_IMPLEMENTED: carveRange');
}
