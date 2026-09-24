import type { Move, ToolDefinition } from '@/core/types';
import type { VoxelGrid } from './VoxelGrid';
import { tipHeightAtRadius, toolRadius } from './toolProfile';

/**
 * Talas kaldirma cekirdegi (Faz 6).
 *
 * MODEL: Duz alin frezesi (flat end mill). Takim, ucundan YUKARI dogru
 * uzanan bir silindirdir; bir hareket boyunca supurdugu hacim, XY'de yol
 * cevresinde takim yaricapi kadar genisleyen bir "stadyum" (kapsul) ve
 * Z'de takim ucundan stokun ustune kadar olan bolgedir.
 *
 * Bu "2.5D" kabul, gercek isleme ile ortusur: freze bir cebi acarken sap
 * kismi da malzemeden gecer, dolayisiyla ucun uzerindeki her sey kalkar.
 *
 * UC SEKLI: Takimin tabani her zaman duz degildir. Kure uclu takim yuvarlak
 * bir taban, matkap/V uc ise konik bir taban birakir. Bunu, eksenden uzaklasan
 * her nokta icin ucun ne kadar YUKARIDA oldugunu veren profil fonksiyonuyla
 * modelleriz (bkz. toolProfile.ts): kolonun bosalma sinirI
 *   tipZ + tipHeightAtRadius(uzaklik)
 * olur. Duz frezede bu ek yukseklik her yerde 0'dir, yani eski davranis
 * aynen korunur.
 */

/** Hizli (G0) hareketler ve home talas kaldirmaz. */
function isCuttingMove(move: Move): boolean {
  return !move.rapid && move.kind !== 'home' && move.distance > 0;
}

/**
 * Takimin belirli bir XY kolonunda ULASTIGI en dusuk yuzey Z'si.
 * Yol disinda kalan kolonlarda null doner.
 *
 * Yalnizca en yakin noktanin Z'sine bakmak yanlis olur: dikey bir dalmada
 * (delik delme) XY izdusumu sifir uzunluktadir, en yakin nokta hep
 * baslangictir ve hicbir talas kalkmazdi. Dogrusu, takimin bu kolonun
 * yaricapi icinde kaldigi [tMin, tMax] araligina bakmaktir; Z dogrusal
 * degistigi icin en dusuk deger uclardan biridir.
 */
function toolSurfaceZ(
  move: Move,
  tool: ToolDefinition,
  cx: number,
  cy: number,
  radius: number,
): number | null {
  const { from, to } = move;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const lengthSq = dx * dx + dy * dy;
  const lengthXY = Math.sqrt(lengthSq);
  const radiusSq = radius * radius;

  let t = 0;
  if (lengthSq > 1e-12) {
    t = ((cx - from.x) * dx + (cy - from.y) * dy) / lengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const px = from.x + dx * t;
  const py = from.y + dy * t;
  const distSq = (cx - px) * (cx - px) + (cy - py) * (cy - py);
  if (distSq > radiusSq) return null;

  let tMin = 0;
  let tMax = 1;
  if (lengthXY > 1e-9) {
    const halfSpan = Math.sqrt(Math.max(0, radiusSq - distSq)) / lengthXY;
    tMin = Math.max(0, t - halfSpan);
    tMax = Math.min(1, t + halfSpan);
  }
  const tipZ = Math.min(from.z + dz * tMin, from.z + dz * tMax);

  // Ucun sekli: eksenden uzaklastikca taban yukselir (kure/koni ucta).
  const profileLift = tipHeightAtRadius(tool, Math.sqrt(distSq));
  if (!Number.isFinite(profileLift)) return null;
  return tipZ + profileLift;
}

/**
 * Islenmis yuzey alanini (purüzsuz gosterim) gunceller.
 *
 * NEDEN AYRI DONGU: Yuzey alani voxel grid'inden daha incedir; kesim
 * kenarlarinin XY'de basamakli gorunmemesi icin gereken cozunurluk budur
 * (bkz. VoxelGrid.surfaceFactor).
 */
function carveSurface(grid: VoxelGrid, move: Move, tool: ToolDefinition, radius: number): void {
  const { from, to } = move;
  const [si0, sj0] = grid.worldToSurfaceCell(
    Math.min(from.x, to.x) - radius,
    Math.min(from.y, to.y) - radius,
  );
  const [si1, sj1] = grid.worldToSurfaceCell(
    Math.max(from.x, to.x) + radius,
    Math.max(from.y, to.y) + radius,
  );

  const iStart = Math.max(0, si0);
  const iEnd = Math.min(grid.surfaceDims.nx - 1, si1);
  const jStart = Math.max(0, sj0);
  const jEnd = Math.min(grid.surfaceDims.ny - 1, sj1);

  const size = grid.surfaceCellSize;
  for (let si = iStart; si <= iEnd; si++) {
    const cx = grid.min.x + (si + 0.5) * size;
    for (let sj = jStart; sj <= jEnd; sj++) {
      const cy = grid.min.y + (sj + 0.5) * size;
      const surfaceZ = toolSurfaceZ(move, tool, cx, cy, radius);
      if (surfaceZ === null) continue;
      if (grid.lowerSurface(si, sj, surfaceZ)) {
        grid.markDirtyAt(
          Math.floor(si / grid.surfaceFactor),
          Math.floor(sj / grid.surfaceFactor),
          0,
        );
      }
    }
  }
}

/**
 * Tek bir kesme hareketinin supurdugu hacmi bosaltir.
 * @returns kaldirilan hucre sayisi
 */
export function carveMove(grid: VoxelGrid, move: Move, tool: ToolDefinition): number {
  if (!isCuttingMove(move)) return 0;

  const radius = Math.max(toolRadius(tool), grid.cellSize * 0.5);
  const { from, to } = move;

  // Supurulen bolgenin XY sinir kutusu (takim yaricapi kadar genisletilmis).
  const minX = Math.min(from.x, to.x) - radius;
  const maxX = Math.max(from.x, to.x) + radius;
  const minY = Math.min(from.y, to.y) - radius;
  const maxY = Math.max(from.y, to.y) + radius;

  const [i0] = grid.worldToCell(minX, 0, 0);
  const [i1] = grid.worldToCell(maxX, 0, 0);
  const [, j0] = grid.worldToCell(0, minY, 0);
  const [, j1] = grid.worldToCell(0, maxY, 0);

  const iStart = Math.max(0, i0);
  const iEnd = Math.min(grid.dims.nx - 1, i1);
  const jStart = Math.max(0, j0);
  const jEnd = Math.min(grid.dims.ny - 1, j1);
  if (iStart > iEnd || jStart > jEnd) return 0;

  let removed = 0;

  carveSurface(grid, move, tool, radius);

  for (let i = iStart; i <= iEnd; i++) {
    const cx = grid.min.x + (i + 0.5) * grid.cellSize;
    for (let j = jStart; j <= jEnd; j++) {
      const cy = grid.min.y + (j + 0.5) * grid.cellSize;
      const surfaceZ = toolSurfaceZ(move, tool, cx, cy, radius);
      if (surfaceZ === null) continue;

      // Ucun uzerindeki her sey kalkar: uc yuzeyinden grid'in tepesine kadar.
      let kStart = Math.floor((surfaceZ - grid.min.z) / grid.cellSize);
      if (kStart < 0) kStart = 0;
      for (let k = kStart; k < grid.dims.nz; k++) {
        if (grid.clearCell(i, j, k)) removed++;
      }
    }
  }

  return removed;
}

/**
 * Bir hareket araligini toplu isler (simulasyon adimlari icin).
 * @param from dahil, @param to haric
 */
export function carveRange(
  grid: VoxelGrid,
  moves: Move[],
  from: number,
  to: number,
  tool: ToolDefinition,
): number {
  const start = Math.max(0, from);
  const end = Math.min(moves.length, to);
  let removed = 0;
  for (let i = start; i < end; i++) {
    const move = moves[i];
    if (move) removed += carveMove(grid, move, tool);
  }
  return removed;
}
