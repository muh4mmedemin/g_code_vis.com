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
  material: 'derlin-dogal',
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

describe('delme cevrimleri (canned cycles) ile oyma', () => {
  /** Verilen dunya noktasindaki hucre dolu mu? */
  const solidAt = (grid: VoxelGrid, x: number, y: number, z: number): boolean => {
    const [cx, cy, cz] = grid.worldToCell(x, y, z);
    return grid.isSolid(cx, cy, cz);
  };

  const carveProgram = (source: string, resolution = 60) => {
    const grid = gridFor(resolution);
    const r = parseGcode(source);
    carveRange(grid, r.moves, 0, r.moves.length, TOOL);
    return { grid, result: r };
  };

  it('G81 cevrimi blogu gercekten deler', () => {
    const { grid } = carveProgram(
      ['G21', 'G90', 'M3 S2000', 'G0 Z5', 'G99 G81 X0 Y0 Z-20 R2 F120', 'G80'].join('\n'),
    );

    // Delik ekseni bosalmis olmali...
    expect(solidAt(grid, 0, 0, -5)).toBe(false);
    expect(solidAt(grid, 0, 0, -18)).toBe(false);
    // ...delik dibinin altindaki malzeme ve cevre saglam kalmali.
    expect(solidAt(grid, 0, 0, -25)).toBe(true);
    expect(solidAt(grid, 12, 0, -5)).toBe(true);
  });

  it('modal tekrar ile acilan her delik islenir', () => {
    const { grid } = carveProgram(
      [
        'G21', 'G90', 'M3 S2000', 'G0 Z5',
        'G99 G83 X-10 Y-10 Z-15 R2 Q4 F120',
        'X10 Y-10',
        'X10 Y10',
        'G80',
      ].join('\n'),
    );

    for (const [x, y] of [
      [-10, -10],
      [10, -10],
      [10, 10],
    ] as const) {
      expect(solidAt(grid, x, y, -10), `delik (${x},${y}) acilmadi`).toBe(false);
    }
    // Cevrimde yer almayan dorduncu kose dolu kalmali.
    expect(solidAt(grid, -10, 10, -10)).toBe(true);
  });

  it('G83 gagalamasi tek pasolu G81 ile ayni deligi acar', () => {
    const peck = carveProgram(
      ['G21', 'G90', 'M3 S2000', 'G0 Z5', 'G99 G83 X0 Y0 Z-18 R2 Q3 F120', 'G80'].join('\n'),
    ).grid;
    const single = carveProgram(
      ['G21', 'G90', 'M3 S2000', 'G0 Z5', 'G99 G81 X0 Y0 Z-18 R2 F120', 'G80'].join('\n'),
    ).grid;

    expect(peck.countSolid()).toBe(single.countSolid());
  });
});

/**
 * Ornek holder programinin ISLENMIS PARCASI dogru mu?
 *
 * Ekran goruntusu "bir sey oyulmus" der; bu test parcanin GEREKEN yerlerinin
 * bosaldigini, gerekmeyen yerlerinin ise saglam kaldigini olcerek soyler.
 */
describe('holder-konnektor ornegi', () => {
  const source = Object.values(
    import.meta.glob('../../../public/samples/holder-konnektor.gcode', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  )[0] as string;

  const HOLDER_STOCK: StockDefinition = {
    shape: 'box',
    size: { x: 45, y: 60, z: 80 },
    origin: { x: 0, y: 0, z: 0 },
    material: 'derlin-mavi',
  };

  const carved = (() => {
    const grid = VoxelGrid.fromStock(HOLDER_STOCK, 90);
    grid.fill();
    const r = parseGcode(source);
    carveRange(grid, r.moves, 0, r.moves.length, TOOL);
    return grid;
  })();

  const solidAt = (x: number, y: number, z: number): boolean => {
    const [cx, cy, cz] = carved.worldToCell(x, y, z);
    return carved.isSolid(cx, cy, cz);
  };

  it('konnektor cebi acilmis, taban saglam kalmis', () => {
    expect(solidAt(0, 0, -7)).toBe(false);
    expect(solidAt(10, 5, -7)).toBe(false);
    expect(solidAt(0, 0, -20)).toBe(true);
  });

  it('dort vida deligi delinmis, dibinin altinda malzeme kalmis', () => {
    for (const [x, y] of [
      [-16, -22],
      [16, -22],
      [16, 22],
      [-16, 22],
    ] as const) {
      expect(solidAt(x, y, -12), `vida deligi (${x},${y})`).toBe(false);
      expect(solidAt(x, y, -30), `delik dibi (${x},${y})`).toBe(true);
    }
  });

  it('kablo kanali Y boyunca acilmis', () => {
    expect(solidAt(0, 25, -3)).toBe(false);
    expect(solidAt(0, -25, -3)).toBe(false);
    // Kanal 6mm derin: altinda malzeme durmali.
    expect(solidAt(0, 25, -12)).toBe(true);
  });

  it('blogun govdesi ve alt yarisi el degmeden kalmis', () => {
    expect(solidAt(0, 0, -50)).toBe(true);
    expect(solidAt(-20, -28, -60)).toBe(true);
    expect(solidAt(20, 28, -75)).toBe(true);
  });
});

describe('uc sekli oymaya yansir', () => {
  // Uc sekli milimetrenin altinda fark yaratir; hucre boyutu bunu cozecek
  // kadar kucuk olmali (70mm blok / 160 = 0.44mm).
  const plunge = (t: ToolDefinition, resolution = 160) => {
    const grid = gridFor(resolution);
    const r = parseGcode(['G21', 'G90', 'M3 S1000', 'G0 X0 Y0 Z1', 'G1 Z-10 F200'].join('\n'));
    carveRange(grid, r.moves, 0, r.moves.length, t);
    return grid;
  };

  /** Deligin tabanindaki en dusuk dolu hucrenin Z'si (belirtilen XY'de). */
  const floorZ = (grid: VoxelGrid, x: number, y: number): number => {
    const [cx, cy] = grid.worldToCell(x, y, 0);
    for (let k = grid.dims.nz - 1; k >= 0; k--) {
      if (grid.isSolid(cx, cy, k)) {
        const [, , z] = grid.cellToWorld(cx, cy, k);
        return z;
      }
    }
    return grid.min.z;
  };

  it('duz freze duz taban birakir', () => {
    const grid = plunge({ type: 'flat', diameter: 6, fluteLength: 25 });
    const center = floorZ(grid, 0, 0);
    const edge = floorZ(grid, 2.5, 0);
    expect(Math.abs(edge - center)).toBeLessThan(grid.cellSize * 1.5);
  });

  it('kure uclu takim yuvarlak taban birakir', () => {
    const grid = plunge({ type: 'ball', diameter: 6, fluteLength: 25 });
    const center = floorZ(grid, 0, 0);
    const edge = floorZ(grid, 2.5, 0);
    // Kenar merkeze gore YUKARIDA kalir (kure yuzeyi): d=2.5mm'de
    // 3 - sqrt(9 - 6.25) = 1.34mm.
    expect(edge - center).toBeGreaterThan(1);
    expect(edge - center).toBeLessThan(1.8);
  });

  it('matkap konik taban birakir ve aci derinligi belirler', () => {
    const sharp = plunge({ type: 'drill', diameter: 6, fluteLength: 25, angle: 118 });
    const blunt = plunge({ type: 'spot', diameter: 6, fluteLength: 25, angle: 90 });
    const sharpEdge = floorZ(sharp, 2.5, 0) - floorZ(sharp, 0, 0);
    const bluntEdge = floorZ(blunt, 2.5, 0) - floorZ(blunt, 0, 0);
    // 90 derece punta matkabinin ucu daha uzundur (dar aci = uzun koni),
    // dolayisiyla kenar ile merkez arasindaki fark daha buyuktur.
    expect(bluntEdge).toBeGreaterThan(sharpEdge);
    expect(sharpEdge).toBeGreaterThan(0.5);
  });

  it('sekilli uc, duz frezeden daha az malzeme kaldirir', () => {
    const flat = plunge({ type: 'flat', diameter: 6, fluteLength: 25 });
    const ball = plunge({ type: 'ball', diameter: 6, fluteLength: 25 });
    expect(ball.countSolid()).toBeGreaterThan(flat.countSolid());
  });
});
