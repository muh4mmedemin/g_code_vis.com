import { CHUNK_SIZE, type VoxelGrid } from './VoxelGrid';

/**
 * Voxel grid -> goruntulenebilir mesh (Faz 6).
 *
 * YONTEM: Yuzey cikarma (exposed-face meshing). Dolu bir hucrenin bos bir
 * komsuya bakan her yuzu icin bir dortgen uretilir. Marching cubes'a gore
 * daha "kutu" gorunur ama CNC icin dogru his budur: freze duz yuzey ve
 * keskin kose birakir.
 *
 * PERFORMANS: Grid chunk'lara bolunmustur ve yalnizca KIRLI chunk'lar
 * yeniden mesh'lenir. Boylece bir kesme hareketi tum blogu degil, yalnizca
 * dokundugu birkac chunk'i yeniden hesaplatir.
 */

export interface MeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** Alti yon: [di, dj, dk, nx, ny, nz] */
const FACES: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [1, 0, 0, 1, 0, 0],
  [-1, 0, 0, -1, 0, 0],
  [0, 1, 0, 0, 1, 0],
  [0, -1, 0, 0, -1, 0],
  [0, 0, 1, 0, 0, 1],
  [0, 0, -1, 0, 0, -1],
];

/**
 * Her yon icin dortgenin 4 kosesi (birim kup icinde, 0..1).
 * Sira, disa bakan normal ile saat yonunun tersi olacak sekilde secildi.
 */
const FACE_CORNERS: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  // +X
  [
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
    [1, 0, 1],
  ],
  // -X
  [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
  ],
  // +Y
  [
    [0, 1, 0],
    [0, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
  ],
  // -Y
  [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
  ],
  // +Z
  [
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ],
  // -Z
  [
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [1, 0, 0],
  ],
];

/**
 * Tek bir chunk'i mesh'ler.
 * @returns bos chunk icin null
 */
export function meshChunk(grid: VoxelGrid, chunkIndex: number): MeshBuffers | null {
  const [cx, cy, cz] = grid.chunkCoords(chunkIndex);
  const iStart = cx * CHUNK_SIZE;
  const jStart = cy * CHUNK_SIZE;
  const kStart = cz * CHUNK_SIZE;
  const iEnd = Math.min(iStart + CHUNK_SIZE, grid.dims.nx);
  const jEnd = Math.min(jStart + CHUNK_SIZE, grid.dims.ny);
  const kEnd = Math.min(kStart + CHUNK_SIZE, grid.dims.nz);

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const cell = grid.cellSize;

  for (let k = kStart; k < kEnd; k++) {
    for (let j = jStart; j < jEnd; j++) {
      for (let i = iStart; i < iEnd; i++) {
        if (!grid.isSolid(i, j, k)) continue;

        for (let f = 0; f < FACES.length; f++) {
          const face = FACES[f]!;
          if (grid.isSolid(i + face[0], j + face[1], k + face[2])) continue;

          const baseIndex = positions.length / 3;
          const corners = FACE_CORNERS[f]!;
          for (const corner of corners) {
            positions.push(
              grid.min.x + (i + corner[0]) * cell,
              grid.min.y + (j + corner[1]) * cell,
              grid.min.z + (k + corner[2]) * cell,
            );
            normals.push(face[3], face[4], face[5]);
          }
          indices.push(
            baseIndex,
            baseIndex + 1,
            baseIndex + 2,
            baseIndex,
            baseIndex + 2,
            baseIndex + 3,
          );
        }
      }
    }
  }

  if (indices.length === 0) return null;

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

/** Tum grid'i tek parca mesh'ler (test ve kucuk gridler icin). */
export function meshVoxels(grid: VoxelGrid): MeshBuffers {
  const total = grid.chunkDims.nx * grid.chunkDims.ny * grid.chunkDims.nz;
  const parts: MeshBuffers[] = [];
  for (let c = 0; c < total; c++) {
    const part = meshChunk(grid, c);
    if (part) parts.push(part);
  }

  const vertexCount = parts.reduce((n, p) => n + p.positions.length, 0);
  const indexCount = parts.reduce((n, p) => n + p.indices.length, 0);

  const positions = new Float32Array(vertexCount);
  const normals = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const part of parts) {
    positions.set(part.positions, vertexOffset);
    normals.set(part.normals, vertexOffset);
    for (let i = 0; i < part.indices.length; i++) {
      indices[indexOffset + i] = part.indices[i]! + vertexOffset / 3;
    }
    vertexOffset += part.positions.length;
    indexOffset += part.indices.length;
  }

  return { positions, normals, indices };
}
