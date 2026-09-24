import type { VoxelGrid } from './VoxelGrid';
import type { MeshBuffers } from './mesher';

/**
 * Purüzsuz islenmis yuzey mesh'i (voxel kutuculari yerine).
 *
 * NEDEN: Voxel mesh'i yuzeyi hucre boyuna yuvarlar; 0.2 mm inen bir paso
 * ekranda 0.6 mm'lik basamak olarak gorunur ve isleme izleri gercekte
 * olmayan bir "merdiven" gibi okunur. Oysa kesim modelimiz 2.5D'dir (takim
 * ucunun uzerindeki her sey kalkar), yani islenmis blok matematiksel olarak
 * bir YUKSEKLIK ALANIDIR: her XY kolonunda ucun indigi gercek Z (bkz.
 * VoxelGrid.surface). Bu modul dogrudan o alandan mesh uretir:
 *
 *  - Taban ve egimli yuzeyler ara degerlerle, basamaksiz cikar.
 *  - Komsu kolonlar arasindaki fark BUYUKSE (cep duvari, delik kenari) yuzey
 *    yumusatilmaz; araya dik bir duvar (etek) konur. Boylece duvarlar keskin
 *    kalir — freze dik duvar birakir, yuvarlak degil.
 *  - Normaller yukseklik egiminden hesaplanir; gorsel olarak surekli bir
 *    yuzey elde edilir.
 */

/**
 * Komsu kolon "ayni yuzeyin devami" sayilmasi icin izin verilen en buyuk
 * yukseklik farki (hucre boyu carpani). Bunun ustu duvar kabul edilir.
 */
const WALL_THRESHOLD_CELLS = 1.5;

interface Accumulator {
  positions: number[];
  normals: number[];
  indices: number[];
}

function pushQuad(
  acc: Accumulator,
  quad: ReadonlyArray<readonly [number, number, number]>,
  normals: ReadonlyArray<readonly [number, number, number]>,
): void {
  const base = acc.positions.length / 3;
  for (let n = 0; n < 4; n++) {
    const p = quad[n]!;
    const nor = normals[n]!;
    acc.positions.push(p[0], p[1], p[2]);
    acc.normals.push(nor[0], nor[1], nor[2]);
  }
  acc.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Bir kose noktasinin yuksekligi: kosege degen kolonlarin ortalamasi, ama
 * yalnizca referans yukseklige YAKIN olanlar. Uzak olanlar (duvarin obur
 * tarafi) disarida birakilir; boylece yumusatma duvari eritmez.
 */
function cornerHeight(
  grid: VoxelGrid,
  i: number,
  j: number,
  cornerI: number,
  cornerJ: number,
  reference: number,
  tolerance: number,
): number {
  let sum = 0;
  let count = 0;
  for (let dj = -1; dj <= 0; dj++) {
    for (let di = -1; di <= 0; di++) {
      const ci = i + cornerI + di;
      const cj = j + cornerJ + dj;
      if (ci < 0 || cj < 0 || ci >= grid.dims.nx || cj >= grid.dims.ny) continue;
      const h = grid.surfaceAt(ci, cj);
      if (Math.abs(h - reference) > tolerance) continue;
      sum += h;
      count++;
    }
  }
  return count === 0 ? reference : sum / count;
}

/** Yukseklik egiminden yuzey normali (yalnizca yakin komsular kullanilir). */
function surfaceNormal(
  grid: VoxelGrid,
  i: number,
  j: number,
  reference: number,
  tolerance: number,
): [number, number, number] {
  const sample = (di: number, dj: number): number => {
    const ci = i + di;
    const cj = j + dj;
    if (ci < 0 || cj < 0 || ci >= grid.dims.nx || cj >= grid.dims.ny) return reference;
    const h = grid.surfaceAt(ci, cj);
    return Math.abs(h - reference) > tolerance ? reference : h;
  };

  const dx = (sample(1, 0) - sample(-1, 0)) / (2 * grid.cellSize);
  const dy = (sample(0, 1) - sample(0, -1)) / (2 * grid.cellSize);
  const length = Math.hypot(dx, dy, 1);
  return [-dx / length, -dy / length, 1 / length];
}

/**
 * Yukseklik alanindan purüzsuz mesh uretir: ust yuzey + kesim duvarlari +
 * blogun dis yanlari ve tabani.
 */
export function meshSurface(grid: VoxelGrid): MeshBuffers {
  const acc: Accumulator = { positions: [], normals: [], indices: [] };
  const cell = grid.cellSize;
  const tolerance = cell * WALL_THRESHOLD_CELLS;
  const { nx, ny } = grid.dims;
  const bottom = grid.bottomZ;

  const worldX = (i: number): number => grid.min.x + i * cell;
  const worldY = (j: number): number => grid.min.y + j * cell;

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const h = grid.surfaceAt(i, j);
      // Tamamen delinip gecilmis kolon: ust yuzey yok.
      if (h <= bottom + 1e-9) continue;

      const h00 = cornerHeight(grid, i, j, 0, 0, h, tolerance);
      const h10 = cornerHeight(grid, i, j, 1, 0, h, tolerance);
      const h11 = cornerHeight(grid, i, j, 1, 1, h, tolerance);
      const h01 = cornerHeight(grid, i, j, 0, 1, h, tolerance);

      const n00 = surfaceNormal(grid, i, j, h, tolerance);
      const x0 = worldX(i);
      const x1 = worldX(i + 1);
      const y0 = worldY(j);
      const y1 = worldY(j + 1);

      pushQuad(
        acc,
        [
          [x0, y0, h00],
          [x1, y0, h10],
          [x1, y1, h11],
          [x0, y1, h01],
        ],
        [n00, n00, n00, n00],
      );

      // Komsuyla arasindaki basamak duvardir: dik yuzey olarak kapatilir.
      // (+X ve +Y yonlerine bakilir; her sinir bir kez islenir.)
      const right = i + 1 < nx ? grid.surfaceAt(i + 1, j) : null;
      if (right !== null && Math.abs(right - h) > 1e-9) {
        const other = right;
        const oh00 = cornerHeight(grid, i + 1, j, 0, 0, other, tolerance);
        const oh01 = cornerHeight(grid, i + 1, j, 0, 1, other, tolerance);
        const n: [number, number, number] = h > other ? [1, 0, 0] : [-1, 0, 0];
        const quad: Array<[number, number, number]> =
          h > other
            ? [
                [x1, y0, h10],
                [x1, y0, oh00],
                [x1, y1, oh01],
                [x1, y1, h11],
              ]
            : [
                [x1, y0, oh00],
                [x1, y0, h10],
                [x1, y1, h11],
                [x1, y1, oh01],
              ];
        pushQuad(acc, quad, [n, n, n, n]);
      }

      const front = j + 1 < ny ? grid.surfaceAt(i, j + 1) : null;
      if (front !== null && Math.abs(front - h) > 1e-9) {
        const other = front;
        const oh00 = cornerHeight(grid, i, j + 1, 0, 0, other, tolerance);
        const oh10 = cornerHeight(grid, i, j + 1, 1, 0, other, tolerance);
        const n: [number, number, number] = h > other ? [0, 1, 0] : [0, -1, 0];
        const quad: Array<[number, number, number]> =
          h > other
            ? [
                [x0, y1, h01],
                [x1, y1, h11],
                [x1, y1, oh10],
                [x0, y1, oh00],
              ]
            : [
                [x0, y1, oh00],
                [x1, y1, oh10],
                [x1, y1, h11],
                [x0, y1, h01],
              ];
        pushQuad(acc, quad, [n, n, n, n]);
      }
    }
  }

  addBlockSides(acc, grid);
  addBottom(acc, grid);

  return {
    positions: new Float32Array(acc.positions),
    normals: new Float32Array(acc.normals),
    indices: new Uint32Array(acc.indices),
  };
}

/** Blogun dort dis yani: yuzeyden tabana inen dikey seritler. */
function addBlockSides(acc: Accumulator, grid: VoxelGrid): void {
  const cell = grid.cellSize;
  const { nx, ny } = grid.dims;
  const bottom = grid.bottomZ;
  const worldX = (i: number): number => grid.min.x + i * cell;
  const worldY = (j: number): number => grid.min.y + j * cell;

  for (let i = 0; i < nx; i++) {
    const hFront = grid.surfaceAt(i, 0);
    if (hFront > bottom + 1e-9) {
      const n: [number, number, number] = [0, -1, 0];
      pushQuad(
        acc,
        [
          [worldX(i), worldY(0), bottom],
          [worldX(i + 1), worldY(0), bottom],
          [worldX(i + 1), worldY(0), hFront],
          [worldX(i), worldY(0), hFront],
        ],
        [n, n, n, n],
      );
    }
    const hBack = grid.surfaceAt(i, ny - 1);
    if (hBack > bottom + 1e-9) {
      const n: [number, number, number] = [0, 1, 0];
      pushQuad(
        acc,
        [
          [worldX(i + 1), worldY(ny), bottom],
          [worldX(i), worldY(ny), bottom],
          [worldX(i), worldY(ny), hBack],
          [worldX(i + 1), worldY(ny), hBack],
        ],
        [n, n, n, n],
      );
    }
  }

  for (let j = 0; j < ny; j++) {
    const hLeft = grid.surfaceAt(0, j);
    if (hLeft > bottom + 1e-9) {
      const n: [number, number, number] = [-1, 0, 0];
      pushQuad(
        acc,
        [
          [worldX(0), worldY(j + 1), bottom],
          [worldX(0), worldY(j), bottom],
          [worldX(0), worldY(j), hLeft],
          [worldX(0), worldY(j + 1), hLeft],
        ],
        [n, n, n, n],
      );
    }
    const hRight = grid.surfaceAt(nx - 1, j);
    if (hRight > bottom + 1e-9) {
      const n: [number, number, number] = [1, 0, 0];
      pushQuad(
        acc,
        [
          [worldX(nx), worldY(j), bottom],
          [worldX(nx), worldY(j + 1), bottom],
          [worldX(nx), worldY(j + 1), hRight],
          [worldX(nx), worldY(j), hRight],
        ],
        [n, n, n, n],
      );
    }
  }
}

/** Blogun tabani (tek dortgen). */
function addBottom(acc: Accumulator, grid: VoxelGrid): void {
  const cell = grid.cellSize;
  const n: [number, number, number] = [0, 0, -1];
  const x0 = grid.min.x;
  const y0 = grid.min.y;
  const x1 = grid.min.x + grid.dims.nx * cell;
  const y1 = grid.min.y + grid.dims.ny * cell;
  pushQuad(
    acc,
    [
      [x0, y0, grid.bottomZ],
      [x0, y1, grid.bottomZ],
      [x1, y1, grid.bottomZ],
      [x1, y0, grid.bottomZ],
    ],
    [n, n, n, n],
  );
}
