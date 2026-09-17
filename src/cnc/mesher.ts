import type { VoxelGrid } from './VoxelGrid';

/**
 * Voxel grid -> goruntulenebilir mesh (Faz 6).
 *
 * Secenek A: greedy meshing (kutu goruntusu, hizli, keskin kenarlar — CNC icin
 *            genelde daha dogru bir his verir)
 * Secenek B: marching cubes (puruzsuz yuzey)
 * Baslangic icin greedy meshing onerilir; arayuz ayni kaldigi icin sonradan
 * degistirmek tek dosyayi etkiler.
 *
 * NOT: Bu islem pahalidir — kendi Web Worker'inda calistirilmali
 * (bkz. src/cnc/worker/).
 * TODO(sonnet).
 */
export interface MeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export function meshVoxels(_grid: VoxelGrid): MeshBuffers {
  throw new Error('NOT_IMPLEMENTED: meshVoxels');
}

/** Sadece degisen bolgeyi yeniden mesh'ler (simulasyon sirasinda sart). */
export function remeshRegion(
  _grid: VoxelGrid,
  _min: [number, number, number],
  _max: [number, number, number],
): MeshBuffers {
  throw new Error('NOT_IMPLEMENTED: remeshRegion');
}
