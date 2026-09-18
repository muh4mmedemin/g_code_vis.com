import type { StockDefinition, Vec3 } from '@/core/types';

/**
 * Ham malzeme blogunun voxel temsili (Faz 6).
 *
 * Blok, testereden cikmis gibi TAM DOLU baslar; G-code'daki her kesme
 * hareketi bu hucrelerden talas kaldirir.
 *
 * Bellek: 1 byte/hucre (0 = bos, 1 = dolu). Cozunurluk en uzun kenardaki
 * hucre sayisiyla verilir; toplam hucre sayisi MAX_CELLS ile sinirlanir.
 *
 * Yeniden mesh'leme maliyetini dusurmek icin grid "chunk"lara bolunur ve
 * yalnizca degisen chunk'lar kirli (dirty) isaretlenir.
 */

/** Chunk kenar uzunlugu (hucre). Daha buyuk = daha az draw call, daha pahali remesh. */
export const CHUNK_SIZE = 32;

/** Bellek/performans tavani. 20M hucre ~ 20MB. */
const MAX_CELLS = 20_000_000;

export interface GridDims {
  nx: number;
  ny: number;
  nz: number;
}

export class VoxelGrid {
  /** 0 = bos, 1 = dolu. */
  readonly data: Uint8Array;
  readonly dims: GridDims;
  readonly chunkDims: GridDims;
  /** Kup hucre kenari (mm). */
  readonly cellSize: number;
  /** Grid'in dunya koordinatindaki MIN kosesi (mm). */
  readonly min: Vec3;
  /** Yeniden mesh'lenmesi gereken chunk indeksleri. */
  readonly dirtyChunks = new Set<number>();

  constructor(dims: GridDims, cellSize: number, min: Vec3) {
    this.dims = dims;
    this.cellSize = cellSize;
    this.min = min;
    this.data = new Uint8Array(dims.nx * dims.ny * dims.nz);
    this.chunkDims = {
      nx: Math.ceil(dims.nx / CHUNK_SIZE),
      ny: Math.ceil(dims.ny / CHUNK_SIZE),
      nz: Math.ceil(dims.nz / CHUNK_SIZE),
    };
  }

  /**
   * Stok tanimindan grid kurar.
   *
   * KONUM KABULU: blok XY'de `stock.origin`de merkezlenir, UST yuzeyi
   * `stock.origin.z` seviyesindedir ve asagi dogru uzanir. CNC'de Z sifiri
   * genelde stokun ust yuzeyidir; boylece kullanicinin G-code'undaki negatif
   * Z degerleri dogrudan malzemenin icine girer.
   */
  static fromStock(stock: StockDefinition, resolution: number): VoxelGrid {
    const size = {
      x: Math.max(stock.size.x, 0.001),
      y: Math.max(stock.size.y, 0.001),
      z: Math.max(stock.size.z, 0.001),
    };
    const longest = Math.max(size.x, size.y, size.z);
    let cellSize = longest / Math.max(8, Math.floor(resolution));

    // Bellek tavani: gerekirse hucreyi buyut.
    const cellCount = () =>
      Math.ceil(size.x / cellSize) * Math.ceil(size.y / cellSize) * Math.ceil(size.z / cellSize);
    while (cellCount() > MAX_CELLS) cellSize *= 1.25;

    const dims: GridDims = {
      nx: Math.max(1, Math.ceil(size.x / cellSize)),
      ny: Math.max(1, Math.ceil(size.y / cellSize)),
      nz: Math.max(1, Math.ceil(size.z / cellSize)),
    };

    const min: Vec3 = {
      x: stock.origin.x - size.x / 2,
      y: stock.origin.y - size.y / 2,
      z: stock.origin.z - size.z,
    };

    return new VoxelGrid(dims, cellSize, min);
  }

  get cellCount(): number {
    return this.data.length;
  }

  index(i: number, j: number, k: number): number {
    return i + this.dims.nx * (j + this.dims.ny * k);
  }

  inBounds(i: number, j: number, k: number): boolean {
    return (
      i >= 0 && j >= 0 && k >= 0 && i < this.dims.nx && j < this.dims.ny && k < this.dims.nz
    );
  }

  isSolid(i: number, j: number, k: number): boolean {
    if (!this.inBounds(i, j, k)) return false;
    return this.data[this.index(i, j, k)] === 1;
  }

  /** Tum hucreleri dolu yapar (testereden cikmis ham blok). */
  fill(): void {
    this.data.fill(1);
    this.markAllDirty();
  }

  /** Tek hucreyi bosaltir; degisiklik olduysa chunk'i kirli isaretler. */
  clearCell(i: number, j: number, k: number): boolean {
    if (!this.inBounds(i, j, k)) return false;
    const index = this.index(i, j, k);
    if (this.data[index] === 0) return false;
    this.data[index] = 0;
    this.markDirtyAt(i, j, k);
    return true;
  }

  markDirtyAt(i: number, j: number, k: number): void {
    const cx = Math.floor(i / CHUNK_SIZE);
    const cy = Math.floor(j / CHUNK_SIZE);
    const cz = Math.floor(k / CHUNK_SIZE);
    this.dirtyChunks.add(this.chunkIndex(cx, cy, cz));

    // Chunk sinirindaki hucreler komsu chunk'in yuzeylerini de etkiler.
    if (i % CHUNK_SIZE === 0 && cx > 0) this.dirtyChunks.add(this.chunkIndex(cx - 1, cy, cz));
    if (i % CHUNK_SIZE === CHUNK_SIZE - 1 && cx + 1 < this.chunkDims.nx)
      this.dirtyChunks.add(this.chunkIndex(cx + 1, cy, cz));
    if (j % CHUNK_SIZE === 0 && cy > 0) this.dirtyChunks.add(this.chunkIndex(cx, cy - 1, cz));
    if (j % CHUNK_SIZE === CHUNK_SIZE - 1 && cy + 1 < this.chunkDims.ny)
      this.dirtyChunks.add(this.chunkIndex(cx, cy + 1, cz));
    if (k % CHUNK_SIZE === 0 && cz > 0) this.dirtyChunks.add(this.chunkIndex(cx, cy, cz - 1));
    if (k % CHUNK_SIZE === CHUNK_SIZE - 1 && cz + 1 < this.chunkDims.nz)
      this.dirtyChunks.add(this.chunkIndex(cx, cy, cz + 1));
  }

  markAllDirty(): void {
    const total = this.chunkDims.nx * this.chunkDims.ny * this.chunkDims.nz;
    for (let c = 0; c < total; c++) this.dirtyChunks.add(c);
  }

  chunkIndex(cx: number, cy: number, cz: number): number {
    return cx + this.chunkDims.nx * (cy + this.chunkDims.ny * cz);
  }

  chunkCoords(chunkIndex: number): [number, number, number] {
    const cx = chunkIndex % this.chunkDims.nx;
    const cy = Math.floor(chunkIndex / this.chunkDims.nx) % this.chunkDims.ny;
    const cz = Math.floor(chunkIndex / (this.chunkDims.nx * this.chunkDims.ny));
    return [cx, cy, cz];
  }

  /** Hucre MERKEZININ dunya koordinati. */
  cellToWorld(i: number, j: number, k: number): [number, number, number] {
    return [
      this.min.x + (i + 0.5) * this.cellSize,
      this.min.y + (j + 0.5) * this.cellSize,
      this.min.z + (k + 0.5) * this.cellSize,
    ];
  }

  /** Dunya koordinatini iceren hucre (sinir disi olabilir). */
  worldToCell(x: number, y: number, z: number): [number, number, number] {
    return [
      Math.floor((x - this.min.x) / this.cellSize),
      Math.floor((y - this.min.y) / this.cellSize),
      Math.floor((z - this.min.z) / this.cellSize),
    ];
  }

  /** Kalan dolu hucre sayisi (test/istatistik icin). */
  countSolid(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] === 1) n++;
    return n;
  }
}
