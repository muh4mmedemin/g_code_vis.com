import { describe, expect, it } from 'vitest';
import { computeBeadHeights, detectSpiralPitch } from '../SolidPrintLayer';
import { parseGcode } from '@/gcode/parser';

const parse = (lines: string[]) => parseGcode(lines.join('\n'));

/** Yaricapi r olan, sides kenarli, tur basina pitch kadar yukselen spiral. */
function spiralGcode(sides: number, turns: number, radius: number, pitch: number): string[] {
  const lines = ['G90', 'M83', `G1 X${radius.toFixed(3)} Y0 Z0.2 F1500`];
  for (let i = 1; i <= sides * turns; i++) {
    const a = (2 * Math.PI * i) / sides;
    const z = 0.2 + (pitch * i) / sides;
    lines.push(
      `G1 X${(radius * Math.cos(a)).toFixed(3)} Y${(radius * Math.sin(a)).toFixed(3)} ` +
        `Z${z.toFixed(3)} E0.5 F900`,
    );
  }
  return lines;
}

describe('detectSpiralPitch', () => {
  it('spiralde turlar arasi dikey mesafeyi bulur', () => {
    const r = parse(spiralGcode(8, 5, 15, 1.0));
    expect(detectSpiralPitch(r.moves, r.stats.bounds)).toBeCloseTo(1.0, 3);
  });

  it('gercekci ince pitch degerlerini de bulur', () => {
    const r = parse(spiralGcode(32, 10, 20, 0.3));
    expect(detectSpiralPitch(r.moves, r.stats.bounds)).toBeCloseTo(0.3, 3);
  });

  it('duz (yatay) kapali konturda spiral tespit etmez', () => {
    const r = parse([
      'G90',
      'M83',
      'G1 Z0.2 F600',
      'G1 X10 Y10 F1500',
      'G1 X30 Y10 E1 F900',
      'G1 X30 Y30 E1',
      'G1 X10 Y30 E1',
      'G1 X10 Y10 E1',
    ]);
    expect(detectSpiralPitch(r.moves, r.stats.bounds)).toBe(0);
  });

  it('katmanli (yatay konturlarin ust uste yigildigi) baskida 0 doner', () => {
    const lines = ['G90', 'M83'];
    for (let layer = 1; layer <= 3; layer++) {
      const z = (0.2 * layer).toFixed(2);
      lines.push(
        `G1 Z${z} F600`,
        'G1 X10 Y10 F1500',
        `G1 X30 Y10 E1 F900`,
        `G1 X30 Y30 E1`,
        `G1 X10 Y30 E1`,
        `G1 X10 Y10 E1`,
      );
    }
    const r = parse(lines);
    expect(detectSpiralPitch(r.moves, r.stats.bounds)).toBe(0);
  });

  it('extrusion olmayan dosyada (CNC) 0 doner', () => {
    const r = parse(['G90', 'G0 X10 Y10', 'G1 Z-2 F300', 'G1 X30 F800', 'G1 Y30']);
    expect(detectSpiralPitch(r.moves, r.stats.bounds)).toBe(0);
  });

  it('bos hareket listesinde 0 doner', () => {
    const r = parse(['G90']);
    expect(detectSpiralPitch(r.moves, r.stats.bounds)).toBe(0);
  });

  it('asiri buyuk (anlamsiz) pitch degerlerini reddeder', () => {
    // Tur basina 50mm yukselen "spiral": bu bir cidar degil, bead kalinligi
    // olarak kullanilmamali.
    const r = parse(spiralGcode(8, 3, 15, 50));
    expect(detectSpiralPitch(r.moves, r.stats.bounds)).toBe(0);
  });
});

describe('computeBeadHeights', () => {
  it('duz katmanlarda katman araligini kullanir', () => {
    const lines = ['G90', 'M83'];
    for (let layer = 1; layer <= 3; layer++) {
      lines.push(
        `G1 Z${(0.2 * layer).toFixed(2)} F600`,
        'G1 X10 Y10 F1500',
        'G1 X30 Y10 E1 F900',
        'G1 X30 Y30 E1',
        'G1 X10 Y30 E1',
        'G1 X10 Y10 E1',
      );
    }
    const r = parse(lines);
    const heights = computeBeadHeights(r.moves, r.layers, r.stats.bounds);
    const extrudeHeights = r.moves
      .map((m, i) => ({ m, h: heights[i]! }))
      .filter((x) => x.m.kind === 'extrude')
      .map((x) => x.h);
    expect(extrudeHeights.every((h) => Math.abs(h - 0.2) < 1e-6)).toBe(true);
  });

  it('spiralde katman araligi yerine pitch kullanir', () => {
    const r = parse(spiralGcode(16, 6, 12, 0.4));
    const heights = computeBeadHeights(r.moves, r.layers, r.stats.bounds);
    const spiralHeights = r.moves
      .map((m, i) => ({ m, h: heights[i]! }))
      .filter((x) => x.m.kind === 'extrude')
      .map((x) => x.h);
    // Hareket basina Z artisi 0.4/16 = 0.025mm; bead ise tur araligi kadar olmali
    expect(Math.min(...spiralHeights)).toBeCloseTo(0.4, 2);
  });

  it('ayni dosyadaki duz ve helis bolumlerini ayri ele alir', () => {
    // Once duz kapali kontur (0.5mm katman), sonra helis (0.4mm pitch)
    const lines = ['G90', 'M83', 'G1 Z0.5 F600', 'G1 X12 Y0 F1500'];
    for (const [x, y] of [[0, 12], [-12, 0], [0, -12], [12, 0]]) {
      lines.push(`G1 X${x} Y${y} E1 F900`);
    }
    const flatCount = lines.length;
    lines.push(...spiralGcode(16, 5, 12, 0.4).slice(2));

    const r = parse(lines);
    const heights = computeBeadHeights(r.moves, r.layers, r.stats.bounds);

    const flat: number[] = [];
    const helix: number[] = [];
    r.moves.forEach((m, i) => {
      if (m.kind !== 'extrude') return;
      const rising = Math.abs(m.to.z - m.from.z) > 1e-4;
      (rising ? helix : flat).push(heights[i]!);
    });

    expect(flat.length).toBeGreaterThan(0);
    expect(helix.length).toBeGreaterThan(0);
    // Helis bolumu pitch'i (0.4) kullanmali, hareket basina 0.025'i degil
    expect(Math.min(...helix)).toBeCloseTo(0.4, 2);
    expect(flatCount).toBeGreaterThan(0);
  });

  it('kalinligi makul bir tavanda sinirlar', () => {
    const r = parse(spiralGcode(8, 3, 15, 50));
    const heights = computeBeadHeights(r.moves, r.layers, r.stats.bounds);
    expect(Math.max(...Array.from(heights))).toBeLessThanOrEqual(5);
  });
});
