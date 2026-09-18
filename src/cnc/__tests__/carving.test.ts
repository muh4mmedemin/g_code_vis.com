import { describe, expect, it } from 'vitest';
import { VoxelGrid } from '../VoxelGrid';
import { carveMove, carveRange } from '../carver';
import { meshVoxels } from '../mesher';
import { parseGcode } from '@/gcode/parser';
import type { StockDefinition, ToolDefinition } from '@/core/types';

const STOCK: StockDefinition = {
  shape: 'box',
  size: { x: 40, y: 50, z: 70 },
  origin: { x: 0, y: 0, z: 0 },
};

const TOOL: ToolDefinition = { type: 'flat', diameter: 6, fluteLength: 25 };

const gridFor = (resolution = 40) => {
  const grid = VoxelGrid.fromStock(STOCK, resolution);
  grid.fill();
  return grid;
};

describe('VoxelGrid', () => {
  it('blogu XY merkezli, ust yuzeyi Z=0 olacak sekilde yerlestirir', () => {
    const grid = VoxelGrid.fromStock(STOCK, 40);
    expect(grid.min.x).toBeCloseTo(-20, 6);
    expect(grid.min.y).toBeCloseTo(-25, 6);
    expect(grid.min.z).toBeCloseTo(-70, 6);

    const [, , topZ] = grid.cellToWorld(0, 0, grid.dims.nz - 1);
    // En ust hucrenin merkezi, ust yuzeyin yarim hucre altinda olmali
    expect(topZ).toBeCloseTo(-grid.cellSize / 2, 6);
  });

  it('kose noktasi sifir modunda blogu pozitif bolgeye tasir', () => {
    const grid = VoxelGrid.fromStock(
      { ...STOCK, origin: { x: 20, y: 25, z: 0 } },
      40,
    );
    expect(grid.min.x).toBeCloseTo(0, 6);
    expect(grid.min.y).toBeCloseTo(0, 6);
  });

  it('fill() tum hucreleri doldurur', () => {
    const grid = gridFor();
    expect(grid.countSolid()).toBe(grid.cellCount);
  });

  it('hucre sayisini bellek tavaninin altinda tutar', () => {
    const huge = VoxelGrid.fromStock(
      { ...STOCK, size: { x: 500, y: 500, z: 500 } },
      320,
    );
    expect(huge.cellCount).toBeLessThanOrEqual(20_000_000);
  });

  it('dunya <-> hucre donusumu tutarlidir', () => {
    const grid = gridFor();
    const [wx, wy, wz] = grid.cellToWorld(5, 6, 7);
    expect(grid.worldToCell(wx, wy, wz)).toEqual([5, 6, 7]);
  });
});

describe('carveMove', () => {
  it('kesme hareketi ucun USTUNDEKI malzemeyi kaldirir, altini birakir', () => {
    const grid = gridFor();
    const r = parseGcode(['G90', 'G0 X-15 Y0 Z0', 'G1 X15 Y0 Z-10 F300'].join('\n'));
    const cut = r.moves.find((m) => !m.rapid && m.distance > 0);
    expect(cut).toBeDefined();
    carveMove(grid, cut!, TOOL);

    // Yolun uzerinde, ucun ustunde kalan bir nokta bosalmali
    const [i, j, kAbove] = grid.worldToCell(0, 0, -2);
    expect(grid.isSolid(i, j, kAbove)).toBe(false);

    // Ucun altinda kalan malzeme durmali
    const [, , kBelow] = grid.worldToCell(0, 0, -30);
    expect(grid.isSolid(i, j, kBelow)).toBe(true);
  });

  it('takim capinin disinda kalan malzemeye dokunmaz', () => {
    const grid = gridFor();
    const r = parseGcode(['G90', 'G0 X0 Y0 Z0', 'G1 X0 Y0 Z-10 F300'].join('\n'));
    const cut = r.moves.find((m) => !m.rapid && m.distance > 0)!;
    carveMove(grid, cut, TOOL);

    // Merkez bosalmali (takim yaricapi 3mm)
    const [ci, cj, ck] = grid.worldToCell(0, 0, -5);
    expect(grid.isSolid(ci, cj, ck)).toBe(false);

    // 10mm uzakta hicbir sey kalkmamali
    const [fi, fj, fk] = grid.worldToCell(10, 0, -5);
    expect(grid.isSolid(fi, fj, fk)).toBe(true);
  });

  it('hizli (G0) hareketler talas kaldirmaz', () => {
    const grid = gridFor();
    const before = grid.countSolid();
    const r = parseGcode(['G90', 'G0 X0 Y0 Z-20'].join('\n'));
    for (const move of r.moves) carveMove(grid, move, TOOL);
    expect(grid.countSolid()).toBe(before);
  });

  it('kaldirilan hacim, takim supurme hacmiyle makul olcude ortusur', () => {
    const grid = gridFor(80);
    const before = grid.countSolid();
    // 20mm boyunca, 5mm derinlikte kesim
    const r = parseGcode(
      ['G90', 'G0 X-10 Y0 Z-5', 'G1 X10 Y0 Z-5 F300'].join('\n'),
    );
    const cut = r.moves.find((m) => !m.rapid && m.distance > 0)!;
    carveMove(grid, cut, TOOL);

    const cellVolume = grid.cellSize ** 3;
    const removed = (before - grid.countSolid()) * cellVolume;
    // Beklenen: (dikdortgen 20x6 + iki yarim daire r=3) alani x 5mm derinlik
    const sweptArea = 20 * 6 + Math.PI * 3 * 3;
    const expected = sweptArea * 5;
    expect(removed).toBeGreaterThan(expected * 0.85);
    expect(removed).toBeLessThan(expected * 1.15);
  });

  it('degisiklik yapilan chunk kirli isaretlenir', () => {
    const grid = gridFor();
    grid.dirtyChunks.clear();
    const r = parseGcode(['G90', 'G0 X0 Y0 Z0', 'G1 X0 Y0 Z-5 F300'].join('\n'));
    carveMove(grid, r.moves.find((m) => !m.rapid && m.distance > 0)!, TOOL);
    expect(grid.dirtyChunks.size).toBeGreaterThan(0);
  });
});

describe('carveRange', () => {
  it('yalnizca verilen aralikdaki hareketleri isler', () => {
    const program = [
      'G90',
      'G0 X-10 Y0 Z0',
      'G1 Z-5 F300',
      'G1 X10 F800',
      'G0 Z5',
      'G0 X0 Y15',
      'G1 Z-5 F300',
    ].join('\n');
    const r = parseGcode(program);

    const partial = gridFor();
    carveRange(partial, r.moves, 0, 3, TOOL);

    const full = gridFor();
    carveRange(full, r.moves, 0, r.moves.length, TOOL);

    expect(partial.countSolid()).toBeGreaterThan(full.countSolid());
  });

  it('adim adim isleme, tek seferde islemeyle ayni sonucu verir', () => {
    const r = parseGcode(
      ['G90', 'G0 X-10 Y0 Z0', 'G1 Z-5 F300', 'G1 X10 F800', 'G1 Y10'].join('\n'),
    );

    const stepwise = gridFor();
    for (let i = 0; i < r.moves.length; i++) carveRange(stepwise, r.moves, i, i + 1, TOOL);

    const atOnce = gridFor();
    carveRange(atOnce, r.moves, 0, r.moves.length, TOOL);

    expect(stepwise.countSolid()).toBe(atOnce.countSolid());
  });
});

describe('meshVoxels', () => {
  it('dolu blok icin kapali bir kutu yuzeyi uretir', () => {
    const grid = VoxelGrid.fromStock(
      { ...STOCK, size: { x: 10, y: 10, z: 10 } },
      10,
    );
    grid.fill();
    const mesh = meshVoxels(grid);

    const faceCount = mesh.indices.length / 6; // 2 ucgen = 1 yuz
    const { nx, ny, nz } = grid.dims;
    const expectedFaces = 2 * (nx * ny + nx * nz + ny * nz);
    expect(faceCount).toBe(expectedFaces);
    expect(mesh.positions.length).toBe(faceCount * 4 * 3);
  });

  it('kesim sonrasi yuzey sayisi artar (cep duvarlari olusur)', () => {
    const grid = gridFor(30);
    const before = meshVoxels(grid).indices.length;

    const r = parseGcode(['G90', 'G0 X0 Y0 Z0', 'G1 Z-10 F300'].join('\n'));
    carveMove(grid, r.moves.find((m) => !m.rapid && m.distance > 0)!, TOOL);

    const after = meshVoxels(grid).indices.length;
    expect(after).toBeGreaterThan(before);
  });

  it('tamamen bosaltilmis grid bos mesh verir', () => {
    const grid = VoxelGrid.fromStock({ ...STOCK, size: { x: 5, y: 5, z: 5 } }, 10);
    // fill cagrilmadi -> hepsi bos
    const mesh = meshVoxels(grid);
    expect(mesh.indices.length).toBe(0);
  });
});
