import type { StockDefinition } from '@/core/types';

/**
 * Ham malzeme blogunun voxel temsili (Faz 6).
 *
 * Bellek: Uint8Array (1 byte/hucre, 0 = bos, 255 = dolu). 256^3 = 16 MB —
 * cozunurluk kullanici tarafindan ayarlanabilir olmali.
 * TODO(sonnet).
 */
export class VoxelGrid {
  constructor(
    public readonly dims: { nx: number; ny: number; nz: number },
    public readonly stock: StockDefinition,
  ) {}

  /** Tum hucreleri dolu yapar. */
  fill(): void {
    throw new Error('NOT_IMPLEMENTED: VoxelGrid.fill');
  }

  /** Hucre indeksinden dunya koordinatina. */
  cellToWorld(_i: number, _j: number, _k: number): [number, number, number] {
    throw new Error('NOT_IMPLEMENTED: VoxelGrid.cellToWorld');
  }

  /** Dunya koordinatindan hucre indeksine. */
  worldToCell(_x: number, _y: number, _z: number): [number, number, number] {
    throw new Error('NOT_IMPLEMENTED: VoxelGrid.worldToCell');
  }
}
