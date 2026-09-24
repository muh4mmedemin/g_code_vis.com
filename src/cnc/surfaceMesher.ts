import type { VoxelGrid } from './VoxelGrid';
import type { MeshBuffers } from './mesher';

/**
 * Purüzsuz islenmis yuzey mesh'i (voxel kutuculari yerine).
 *
 * NEDEN: Voxel mesh'i yuzeyi hucre boyuna yuvarlar; 0.2 mm inen bir paso
 * ekranda hucre boyu kadar basamak olarak gorunur ve isleme izleri gercekte
 * olmayan bir "merdiven" gibi okunur. Oysa kesim modelimiz 2.5D'dir (takim
 * ucunun uzerindeki her sey kalkar), yani islenmis blok matematiksel olarak
 * bir YUKSEKLIK ALANIDIR: her XY kolonunda ucun indigi gercek Z (bkz.
 * VoxelGrid.surface). Bu modul dogrudan o alandan mesh uretir.
 *
 * Purüzsuzlugun uc ayagi:
 *  1. Yukseklik hucre boyuna yuvarlanmaz (alanin kendisi zaten gercek Z).
 *  2. Alan XY'de voxel grid'inden daha incedir (VoxelGrid.surfaceFactor):
 *     kesim kenarlari basamakli gorunmez.
 *  3. Normaller KOSE BASINA, yukseklik egiminden hesaplanir; komsu hucreler
 *     ayni kosede ayni normali urettigi icin golgeleme sureklidir (hucre
 *     basina tek normal verilseydi yuzey fasetli/koseli gorunurdu).
 *
 * Duvarlar bilincli olarak yumusatilmaz: komsu kolonlar arasindaki fark
 * buyukse araya DIK bir yuzey konur — freze dik duvar birakir, yuvarlak
 * degil.
 */

/**
 * Komsu kolon "ayni yuzeyin devami" sayilmasi icin izin verilen en buyuk
 * yukseklik farki (yuzey hucresi carpani). Bunun ustu duvar kabul edilir.
 */
const WALL_THRESHOLD_CELLS = 1.5;

type Vec3Tuple = readonly [number, number, number];

interface Accumulator {
  positions: number[];
  normals: number[];
  indices: number[];
}

function pushQuad(
  acc: Accumulator,
  quad: ReadonlyArray<Vec3Tuple>,
  normals: ReadonlyArray<Vec3Tuple>,
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

/** Yuzey alanindan okuma; sinir disinda referans deger doner. */
function sampleHeight(grid: VoxelGrid, si: number, sj: number, fallback: number): number {
  if (si < 0 || sj < 0 || si >= grid.surfaceDims.nx || sj >= grid.surfaceDims.ny) return fallback;
  return grid.surfaceAt(si, sj);
}

/**
 * Bir kose noktasinin yuksekligi: koseye degen kolonlarin ortalamasi, ama
 * yalnizca referans yukseklige YAKIN olanlar. Uzak olanlar (duvarin obur
 * tarafi) disarida birakilir; boylece yumusatma duvari eritmez.
 */
function cornerHeight(
  grid: VoxelGrid,
  si: number,
  sj: number,
  cornerI: number,
  cornerJ: number,
  reference: number,
  tolerance: number,
): number {
  let sum = 0;
  let count = 0;
  for (let dj = -1; dj <= 0; dj++) {
    for (let di = -1; di <= 0; di++) {
      const ci = si + cornerI + di;
      const cj = sj + cornerJ + dj;
      if (ci < 0 || cj < 0 || ci >= grid.surfaceDims.nx || cj >= grid.surfaceDims.ny) continue;
      const h = grid.surfaceAt(ci, cj);
      if (Math.abs(h - reference) > tolerance) continue;
      sum += h;
      count++;
    }
  }
  return count === 0 ? reference : sum / count;
}

/**
 * KOSE normali: kosenin iki yanindaki kolonlarin ortalamalarindan egim.
 *
 * Ayni kose, ona degen dort hucrenin hepsinde ayni degeri urettigi icin
 * golgeleme hucre sinirlarinda kirilmaz — yuzeyin "koseli" gorunmesinin
 * sebebi tam olarak hucre basina tek normal kullanmaktir.
 */
function cornerNormal(
  grid: VoxelGrid,
  si: number,
  sj: number,
  cornerI: number,
  cornerJ: number,
  tolerance: number,
): Vec3Tuple {
  const ci = si + cornerI;
  const cj = sj + cornerJ;

  // Referans, koseye degen dort kolonun ortalamasidir: HUCREYE degil yalnizca
  // KOSEYE bagli oldugu icin ayni koseyi paylasan dort hucre birebir ayni
  // normali uretir. Hucrenin kendi yuksekligi referans alinsaydi komsu
  // hucreler ayni kosede farkli normal verir, yuzey fasetli gorunurdu.
  const raw = [
    sampleHeight(grid, ci - 1, cj - 1, NaN),
    sampleHeight(grid, ci, cj - 1, NaN),
    sampleHeight(grid, ci - 1, cj, NaN),
    sampleHeight(grid, ci, cj, NaN),
  ];
  let sum = 0;
  let count = 0;
  for (const value of raw) {
    if (Number.isNaN(value)) continue;
    sum += value;
    count++;
  }
  if (count === 0) return [0, 0, 1];
  const reference = sum / count;

  /** Kose etrafindaki kolon; duvarin obur tarafi ise referansa sabitlenir. */
  const near = (index: number): number => {
    const value = raw[index]!;
    if (Number.isNaN(value) || Math.abs(value - reference) > tolerance) return reference;
    return value;
  };

  const left = (near(0) + near(2)) / 2;
  const right = (near(1) + near(3)) / 2;
  const back = (near(0) + near(1)) / 2;
  const front = (near(2) + near(3)) / 2;

  const dx = (right - left) / grid.surfaceCellSize;
  const dy = (front - back) / grid.surfaceCellSize;
  const length = Math.hypot(dx, dy, 1);
  return [-dx / length, -dy / length, 1 / length];
}

/** Bir hucrenin ust yuzey koseleri (yukseklik + normal). */
interface TopCell {
  h00: number;
  h10: number;
  h11: number;
  h01: number;
  n00: Vec3Tuple;
  n10: Vec3Tuple;
  n11: Vec3Tuple;
  n01: Vec3Tuple;
}

/** Yukari bakan duz normal — duz bolgelerin hizli yolu icin paylasilir. */
const FLAT_NORMAL: Vec3Tuple = [0, 0, 1];

/**
 * Hucrenin 3x3 komsulugu tamamen ayni yukseklikte mi?
 *
 * Islenmemis ust yuzey ve duz cep tabanlari blogun buyuk bolumudur; bu
 * hucrelerde kose/normal hesabi hep ayni sonucu verir. Hizli yol, yuzey
 * uretimini bu bolgelerde tek karsilastirmaya indirir.
 */
function isFlatNeighborhood(grid: VoxelGrid, si: number, sj: number, h: number): boolean {
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const ci = si + di;
      const cj = sj + dj;
      if (ci < 0 || cj < 0 || ci >= grid.surfaceDims.nx || cj >= grid.surfaceDims.ny) continue;
      if (Math.abs(grid.surfaceAt(ci, cj) - h) > 1e-9) return false;
    }
  }
  return true;
}

function topCell(grid: VoxelGrid, si: number, sj: number, h: number, tolerance: number): TopCell {
  if (isFlatNeighborhood(grid, si, sj, h)) {
    return {
      h00: h, h10: h, h11: h, h01: h,
      n00: FLAT_NORMAL, n10: FLAT_NORMAL, n11: FLAT_NORMAL, n01: FLAT_NORMAL,
    };
  }
  return {
    h00: cornerHeight(grid, si, sj, 0, 0, h, tolerance),
    h10: cornerHeight(grid, si, sj, 1, 0, h, tolerance),
    h11: cornerHeight(grid, si, sj, 1, 1, h, tolerance),
    h01: cornerHeight(grid, si, sj, 0, 1, h, tolerance),
    n00: cornerNormal(grid, si, sj, 0, 0, tolerance),
    n10: cornerNormal(grid, si, sj, 1, 0, tolerance),
    n11: cornerNormal(grid, si, sj, 1, 1, tolerance),
    n01: cornerNormal(grid, si, sj, 0, 1, tolerance),
  };
}

/** Iki kose ayni mi? (birlestirme kararinda kullanilir) */
function sameCorner(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

function sameNormal(a: Vec3Tuple, b: Vec3Tuple): boolean {
  return (
    Math.abs(a[0] - b[0]) < 1e-6 &&
    Math.abs(a[1] - b[1]) < 1e-6 &&
    Math.abs(a[2] - b[2]) < 1e-6
  );
}

/**
 * Yukseklik alanindan purüzsuz mesh uretir: ust yuzey + kesim duvarlari +
 * blogun dis yanlari ve tabani.
 */
export function meshSurface(grid: VoxelGrid): MeshBuffers {
  const acc: Accumulator = { positions: [], normals: [], indices: [] };
  const cell = grid.surfaceCellSize;
  const tolerance = cell * WALL_THRESHOLD_CELLS;
  const { nx, ny } = grid.surfaceDims;
  const bottom = grid.bottomZ;

  const worldX = (si: number): number => grid.min.x + si * cell;
  const worldY = (sj: number): number => grid.min.y + sj * cell;

  for (let sj = 0; sj < ny; sj++) {
    for (let si = 0; si < nx; si++) {
      const h = grid.surfaceAt(si, sj);
      // Tamamen delinip gecilmis kolon: ust yuzey yok.
      if (h <= bottom + 1e-9) continue;

      const top = topCell(grid, si, sj, h, tolerance);

      // Degismeyen komsu hucreleri tek dortgende birlestir: islenmemis ust
      // yuzey ve duz cep tabanlari boylece binlerce degil birkac ucgen olur.
      let runEnd = si;
      let last = top;
      while (runEnd + 1 < nx) {
        const nextH = grid.surfaceAt(runEnd + 1, sj);
        if (nextH <= bottom + 1e-9) break;
        const next = topCell(grid, runEnd + 1, sj, nextH, tolerance);
        const continuous =
          sameCorner(next.h00, last.h10) &&
          sameCorner(next.h01, last.h11) &&
          sameNormal(next.n00, last.n10) &&
          sameNormal(next.n01, last.n11);
        // Yalnizca X boyunca DUZ olan hucreler birlesebilir; aksi halde
        // aradaki yukseklik degisimi kaybolurdu.
        const flatInX =
          sameCorner(next.h00, next.h10) &&
          sameCorner(next.h01, next.h11) &&
          sameCorner(last.h00, last.h10) &&
          sameCorner(last.h01, last.h11);
        if (!continuous || !flatInX) break;
        runEnd++;
        last = next;
      }

      const x0 = worldX(si);
      const x1 = worldX(runEnd + 1);
      const y0 = worldY(sj);
      const y1 = worldY(sj + 1);

      pushQuad(
        acc,
        [
          [x0, y0, top.h00],
          [x1, y0, last.h10],
          [x1, y1, last.h11],
          [x0, y1, top.h01],
        ],
        [top.n00, last.n10, last.n11, top.n01],
      );

      // Birlesen hucrelerin duvarlari tek tek eklenir (komsu yukseklikleri
      // hucre basina degisir).
      for (let k = si; k <= runEnd; k++) {
        addWalls(acc, grid, k, sj, tolerance);
      }

      si = runEnd;
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

/**
 * Hucrenin +X ve +Y komsulariyla arasindaki basamagi kapatan dik duvarlar.
 *
 * SARIM: Koseler her iki durumda da AYNI sirayla yazilir (once bu hucrenin
 * koseleri, sonra komsununkiler). Bu sira, hangi taraf yuksekse yuzun
 * normalini kendiliginden o tarafa cevirir; biz yalnizca normal vektorunu
 * ayni yone ayarlariz. Sarim ile normalin ters dusmesi, yuzun on tarafini
 * ice cevirir ve blogun icinden disarisi gorunur (delik gibi) — bu yuzden
 * sira ve isaret tek yerde, birlikte belirlenir.
 */
function addWalls(
  acc: Accumulator,
  grid: VoxelGrid,
  si: number,
  sj: number,
  tolerance: number,
): void {
  const cell = grid.surfaceCellSize;
  const h = grid.surfaceAt(si, sj);
  const x0 = grid.min.x + si * cell;
  const x1 = x0 + cell;
  const y0 = grid.min.y + sj * cell;
  const y1 = y0 + cell;

  // --- +X komsusu ---------------------------------------------------------
  if (si + 1 < grid.surfaceDims.nx) {
    const other = grid.surfaceAt(si + 1, sj);
    if (Math.abs(other - h) > 1e-9) {
      const h10 = cornerHeight(grid, si, sj, 1, 0, h, tolerance);
      const h11 = cornerHeight(grid, si, sj, 1, 1, h, tolerance);
      const oh00 = cornerHeight(grid, si + 1, sj, 0, 0, other, tolerance);
      const oh01 = cornerHeight(grid, si + 1, sj, 0, 1, other, tolerance);
      const n: Vec3Tuple = h > other ? [1, 0, 0] : [-1, 0, 0];
      pushQuad(
        acc,
        [
          [x1, y0, h10],
          [x1, y0, oh00],
          [x1, y1, oh01],
          [x1, y1, h11],
        ],
        [n, n, n, n],
      );
    }
  }

  // --- +Y komsusu ---------------------------------------------------------
  if (sj + 1 < grid.surfaceDims.ny) {
    const other = grid.surfaceAt(si, sj + 1);
    if (Math.abs(other - h) > 1e-9) {
      const h01 = cornerHeight(grid, si, sj, 0, 1, h, tolerance);
      const h11 = cornerHeight(grid, si, sj, 1, 1, h, tolerance);
      const oh00 = cornerHeight(grid, si, sj + 1, 0, 0, other, tolerance);
      const oh10 = cornerHeight(grid, si, sj + 1, 1, 0, other, tolerance);
      const n: Vec3Tuple = h > other ? [0, 1, 0] : [0, -1, 0];
      pushQuad(
        acc,
        [
          [x0, y1, h01],
          [x1, y1, h11],
          [x1, y1, oh10],
          [x0, y1, oh00],
        ],
        [n, n, n, n],
      );
    }
  }
}

/** Blogun dort dis yani: yuzeyden tabana inen dikey seritler. */
function addBlockSides(acc: Accumulator, grid: VoxelGrid): void {
  const cell = grid.surfaceCellSize;
  const { nx, ny } = grid.surfaceDims;
  const bottom = grid.bottomZ;
  const worldX = (si: number): number => grid.min.x + si * cell;
  const worldY = (sj: number): number => grid.min.y + sj * cell;

  for (let si = 0; si < nx; si++) {
    const hFront = grid.surfaceAt(si, 0);
    if (hFront > bottom + 1e-9) {
      const n: Vec3Tuple = [0, -1, 0];
      pushQuad(
        acc,
        [
          [worldX(si), worldY(0), bottom],
          [worldX(si + 1), worldY(0), bottom],
          [worldX(si + 1), worldY(0), hFront],
          [worldX(si), worldY(0), hFront],
        ],
        [n, n, n, n],
      );
    }
    const hBack = grid.surfaceAt(si, ny - 1);
    if (hBack > bottom + 1e-9) {
      const n: Vec3Tuple = [0, 1, 0];
      pushQuad(
        acc,
        [
          [worldX(si + 1), worldY(ny), bottom],
          [worldX(si), worldY(ny), bottom],
          [worldX(si), worldY(ny), hBack],
          [worldX(si + 1), worldY(ny), hBack],
        ],
        [n, n, n, n],
      );
    }
  }

  for (let sj = 0; sj < ny; sj++) {
    const hLeft = grid.surfaceAt(0, sj);
    if (hLeft > bottom + 1e-9) {
      const n: Vec3Tuple = [-1, 0, 0];
      pushQuad(
        acc,
        [
          [worldX(0), worldY(sj + 1), bottom],
          [worldX(0), worldY(sj), bottom],
          [worldX(0), worldY(sj), hLeft],
          [worldX(0), worldY(sj + 1), hLeft],
        ],
        [n, n, n, n],
      );
    }
    const hRight = grid.surfaceAt(nx - 1, sj);
    if (hRight > bottom + 1e-9) {
      const n: Vec3Tuple = [1, 0, 0];
      pushQuad(
        acc,
        [
          [worldX(nx), worldY(sj), bottom],
          [worldX(nx), worldY(sj + 1), bottom],
          [worldX(nx), worldY(sj + 1), hRight],
          [worldX(nx), worldY(sj), hRight],
        ],
        [n, n, n, n],
      );
    }
  }
}

/** Blogun tabani (tek dortgen). */
function addBottom(acc: Accumulator, grid: VoxelGrid): void {
  const cell = grid.surfaceCellSize;
  const n: Vec3Tuple = [0, 0, -1];
  const x0 = grid.min.x;
  const y0 = grid.min.y;
  const x1 = grid.min.x + grid.surfaceDims.nx * cell;
  const y1 = grid.min.y + grid.surfaceDims.ny * cell;
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
