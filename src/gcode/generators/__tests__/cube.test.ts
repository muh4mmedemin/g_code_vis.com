import { describe, expect, it } from 'vitest';
import { generateCubeGcode, normalizeCubeJob } from '../cube';
import { parseGcode } from '@/gcode/parser';

describe('generateCubeGcode', () => {
  it('bitmis parca olculerini takim yaricapiyla telafi eder', () => {
    const gcode = generateCubeGcode({ width: 40, depth: 30, height: 10, toolDiameter: 6 });
    const r = parseGcode(gcode);
    const { bounds } = r.stats;
    // Kontur, parcadan yaricap (3mm) kadar disarida gezmeli
    expect(bounds.max.x).toBeCloseTo(40 / 2 + 3, 3);
    expect(bounds.min.x).toBeCloseTo(-(40 / 2 + 3), 3);
    expect(bounds.max.y).toBeCloseTo(30 / 2 + 3, 3);
    expect(bounds.min.y).toBeCloseTo(-(30 / 2 + 3), 3);
  });

  it('istenen derinlige kadar paso paso iner', () => {
    const r = parseGcode(generateCubeGcode({ height: 10, stepDown: 2 }));
    expect(r.stats.bounds.min.z).toBeCloseTo(-10, 3);
    const depths = new Set(
      r.moves.filter((m) => m.to.z < 0).map((m) => Number(m.to.z.toFixed(3))),
    );
    expect(depths.size).toBe(5);
  });

  it('tam bolunmeyen derinlikte son pasoyu tam olcude bitirir', () => {
    const r = parseGcode(generateCubeGcode({ height: 7, stepDown: 3 }));
    expect(r.stats.bounds.min.z).toBeCloseTo(-7, 3);
  });

  it('kesim hareketleri kesim, G0 hareketleri travel olarak siniflanir', () => {
    const r = parseGcode(generateCubeGcode({}));
    const cuts = r.moves.filter((m) => m.kind === 'extrude');
    const travels = r.moves.filter((m) => m.kind === 'travel');
    expect(cuts.length).toBeGreaterThan(0);
    expect(travels.length).toBeGreaterThan(0);
    // E kullanilmadigi halde kesim hareketleri dogru siniflanmali
    expect(cuts.every((m) => m.e === 0)).toBe(true);
    expect(cuts.every((m) => !m.rapid)).toBe(true);
  });

  it('uretilen program uyarisiz ayristirilir', () => {
    const r = parseGcode(generateCubeGcode({}));
    expect(r.diagnostics.filter((d) => d.severity === 'warning')).toHaveLength(0);
  });

  it('gecersiz/asiri degerleri guvenli araliga ceker', () => {
    const o = normalizeCubeJob({ width: -5, height: 0, stepDown: 0, toolDiameter: 1e9 });
    expect(o.width).toBeGreaterThan(0);
    expect(o.height).toBeGreaterThan(0);
    expect(o.stepDown).toBeGreaterThan(0);
    expect(o.toolDiameter).toBeLessThanOrEqual(50);
    expect(() => parseGcode(generateCubeGcode(o))).not.toThrow();
  });

  it('NaN girdide cokmez', () => {
    const gcode = generateCubeGcode({ width: NaN, depth: NaN, height: NaN });
    expect(gcode).not.toContain('NaN');
  });
});
