import { describe, expect, it } from 'vitest';
import { VoxelGrid } from '../VoxelGrid';
import { carveMove } from '../carver';
import { meshSurface } from '../surfaceMesher';
import { meshVoxels } from '../mesher';
import type { Move, StockDefinition, ToolDefinition } from '@/core/types';

const stock: StockDefinition = {
  shape: 'box',
  size: { x: 40, y: 40, z: 20 },
  origin: { x: 0, y: 0, z: 0 },
  material: 'aluminyum',
};

const tool: ToolDefinition = { type: 'flat', diameter: 6, fluteLength: 25 };

const cut = (
  from: [number, number, number],
  to: [number, number, number],
): Move => ({
  lineIndex: 0,
  kind: 'extrude',
  from: { x: from[0], y: from[1], z: from[2] },
  to: { x: to[0], y: to[1], z: to[2] },
  e: 0,
  f: 500,
  layerIndex: 0,
  tool: 0,
  rapid: false,
  distance: Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]),
  duration: 1,
});

/** Mesh'teki en dusuk Z (islenmis taban). */
const minZ = (positions: Float32Array): number => {
  let min = Infinity;
  for (let i = 2; i < positions.length; i += 3) min = Math.min(min, positions[i]!);
  return min;
};

describe('purüzsuz islenmis yuzey', () => {
  it('hucre boyuna yuvarlamadan, ucun indigi gercek derinligi gosterir', () => {
    const grid = VoxelGrid.fromStock(stock, 64);
    grid.fill();
    // Hucre boyunun (40/64 = 0.625) katı olmayan bir derinlik secilir.
    carveMove(grid, cut([-15, 0, -1.3], [15, 0, -1.3]), tool);

    const [si, sj] = grid.worldToSurfaceCell(0, 0);
    expect(grid.surfaceAt(si, sj)).toBeCloseTo(-1.3, 6);

    const smooth = meshSurface(grid);
    // Kanal tabani gercek derinlikte olmali (voxel mesh'i asagi yuvarlar).
    const smoothFloor = Math.min(
      ...Array.from({ length: smooth.positions.length / 3 }, (_, n) => smooth.positions[n * 3 + 2]!)
        .filter((z) => z > grid.bottomZ + 1e-6),
    );
    expect(smoothFloor).toBeCloseTo(-1.3, 3);
  });

  it('kesilmemis blok, tam olarak blok olculerinde kapali bir yuzey verir', () => {
    const grid = VoxelGrid.fromStock(stock, 32);
    grid.fill();
    const mesh = meshSurface(grid);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(minZ(mesh.positions)).toBeCloseTo(grid.bottomZ, 6);
    let maxZ = -Infinity;
    for (let i = 2; i < mesh.positions.length; i += 3) maxZ = Math.max(maxZ, mesh.positions[i]!);
    expect(maxZ).toBeCloseTo(grid.topZ, 6);
  });

  it('cep duvarlari dik kalir (yumusatma duvari eritmez)', () => {
    const grid = VoxelGrid.fromStock(stock, 64);
    grid.fill();
    carveMove(grid, cut([-10, 0, -4], [10, 0, -4]), tool);
    const mesh = meshSurface(grid);

    // Kanalin dibi (-4) ile blogun ustu (0) arasindaki gecis, egimli bir
    // rampa degil DIK bir duvar olmali: dortgenlerden en az biri bu araligi
    // neredeyse tamamen kapsamali. (Yumusatma duvari eritseydi gecis birkac
    // hucreye yayilir, hicbir dortgen bu acikligi tek basina kapsamazdi.)
    let hasWallSpan = false;
    const quadCount = mesh.positions.length / 12;
    for (let q = 0; q < quadCount; q++) {
      let min = Infinity;
      let max = -Infinity;
      for (let n = 0; n < 4; n++) {
        const z = mesh.positions[(q * 4 + n) * 3 + 2]!;
        min = Math.min(min, z);
        max = Math.max(max, z);
      }
      if (min > grid.bottomZ + 1e-6 && max - min > 3.5) hasWallSpan = true;
    }
    expect(hasWallSpan).toBe(true);
  });

  it('purüzsuz yuzey, voxel mesh"inden daha az ucgen uretir', () => {
    const grid = VoxelGrid.fromStock(stock, 64);
    grid.fill();
    carveMove(grid, cut([-15, -5, -2], [15, -5, -2]), tool);
    carveMove(grid, cut([-15, 5, -3.5], [15, 5, -3.5]), tool);
    const smooth = meshSurface(grid);
    const voxel = meshVoxels(grid);
    expect(smooth.indices.length).toBeLessThan(voxel.indices.length);
  });

  it('her yuzey disa bakar: sarim yonu normalle uyusur', () => {
    // Ters sarilmis tek bir dortgen bile on yuzunu ice cevirir ve blogun
    // icinden disarisi gorunur (delik gibi). Butun mesh icin denetlenir.
    const grid = VoxelGrid.fromStock(stock, 48);
    grid.fill();
    carveMove(grid, cut([-12, -6, -3], [12, -6, -3]), tool);
    carveMove(grid, cut([12, 6, -6], [-12, 6, -6]), tool);
    carveMove(grid, cut([0, 0, -20], [0, 0, -20]), { ...tool, diameter: 8 });
    const mesh = meshSurface(grid);

    const p = mesh.positions;
    const n = mesh.normals;
    let inverted = 0;
    for (let q = 0; q < p.length / 12; q++) {
      const v = (k: number, c: number) => p[(q * 4 + k) * 3 + c]!;
      const ux = v(1, 0) - v(0, 0);
      const uy = v(1, 1) - v(0, 1);
      const uz = v(1, 2) - v(0, 2);
      const wx = v(2, 0) - v(1, 0);
      const wy = v(2, 1) - v(1, 1);
      const wz = v(2, 2) - v(1, 2);
      const gx = uy * wz - uz * wy;
      const gy = uz * wx - ux * wz;
      const gz = ux * wy - uy * wx;
      if (Math.hypot(gx, gy, gz) < 1e-12) continue; // dejenere (sifir alan)
      const dot = gx * n[q * 4 * 3]! + gy * n[q * 4 * 3 + 1]! + gz * n[q * 4 * 3 + 2]!;
      if (dot < 0) inverted++;
    }
    expect(inverted).toBe(0);
  });

  it('komsu hucreler ortak kosede ayni normali uretir (fasetsiz golgeleme)', () => {
    const grid = VoxelGrid.fromStock(stock, 48);
    grid.fill();
    // Egimli bir yuzey: her kolon farkli derinlikte.
    for (let n = 0; n < 40; n++) {
      const x = -15 + n * 0.75;
      carveMove(grid, cut([x, -10, -2 - n * 0.05], [x, 10, -2 - n * 0.05]), tool);
    }
    const mesh = meshSurface(grid);

    // Ayni noktada bulusan koselerde normal farki olmamali.
    const key = (i: number) =>
      `${mesh.positions[i * 3]!.toFixed(4)},${mesh.positions[i * 3 + 1]!.toFixed(4)},${mesh.positions[i * 3 + 2]!.toFixed(4)}`;
    const seen = new Map<string, [number, number, number]>();
    let mismatched = 0;
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const nx = mesh.normals[i * 3]!;
      const ny = mesh.normals[i * 3 + 1]!;
      const nz = mesh.normals[i * 3 + 2]!;
      // Dik duvarlar bilincli olarak farkli normal tasir; yalnizca ust
      // yuzeye (yukari bakan) ait kosler karsilastirilir.
      if (nz < 0.2) continue;
      const k = key(i);
      const prev = seen.get(k);
      if (!prev) seen.set(k, [nx, ny, nz]);
      else if (Math.hypot(prev[0] - nx, prev[1] - ny, prev[2] - nz) > 1e-6) mismatched++;
    }
    expect(mismatched).toBe(0);
  });

  it('blok sifirlandiginda yuzey de ham blok seviyesine doner', () => {
    const grid = VoxelGrid.fromStock(stock, 32);
    grid.fill();
    carveMove(grid, cut([-10, 0, -5], [10, 0, -5]), tool);
    const [si, sj] = grid.worldToSurfaceCell(0, 0);
    expect(grid.surfaceAt(si, sj)).toBeCloseTo(-5, 6);
    grid.fill();
    expect(grid.surfaceAt(si, sj)).toBeCloseTo(grid.topZ, 6);
  });
});
