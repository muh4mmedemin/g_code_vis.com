import { describe, expect, it } from 'vitest';
import { parseGcode } from '../index';

const g = (...lines: string[]) => lines.join('\n');

/** Kare kontur: disaridan yaklasma, 4 kenar, G40 ile cikis. */
const square = (comp: string, ...corners: string[]) =>
  g(
    'G21 G90 G17',
    'M3 S3000',
    'G0 X-5 Y0',
    'G0 Z1',
    'G1 Z-1 F200',
    `${comp} G1 X0 Y0 F500`,
    ...corners,
    'G40 G1 X-5 Y0',
    'G0 Z10',
    'M5',
    'M30',
  );

/**
 * Konturun XY sinirlari. Yaklasma/cikis noktasi (X-5) haric tutulur: telafi
 * orada kurulur/kapanir, kontur olcusune ait degildir.
 */
const cutBounds = (moves: { kind: string; to: { x: number; y: number } }[]) => {
  const pts = moves.filter((m) => m.kind === 'extrude' && m.to.x > -4).map((m) => m.to);
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
};

describe('kesici yaricap telafisi (G41/G42)', () => {
  it('G41 ile saat yonundeki konturu takim yaricapi kadar disa kaydirir', () => {
    // 10x10 kare, saat yonunde: G41 (solda) takimi parcanin DISINDA tutar.
    const r = parseGcode(square('G41 D1', 'G1 X0 Y10', 'G1 X10 Y10', 'G1 X10 Y0', 'G1 X0 Y0'), {
      toolRadius: 1,
    });
    const b = cutBounds(r.moves);
    // Kenarlar bir takim yaricapi kadar disarida olmali.
    expect(b.minX).toBeCloseTo(-1, 3);
    expect(b.maxX).toBeCloseTo(11, 3);
    expect(b.minY).toBeCloseTo(-1, 3);
    expect(b.maxY).toBeCloseTo(11, 3);
    expect(r.diagnostics.some((d) => d.code === 'CUTTER_COMP_NO_RADIUS')).toBe(false);
  });

  it('G42 ayni konturda takimi parcanin icinde tutar', () => {
    const r = parseGcode(square('G42 D1', 'G1 X0 Y10', 'G1 X10 Y10', 'G1 X10 Y0', 'G1 X0 Y0'), {
      toolRadius: 1,
    });
    const b = cutBounds(r.moves);
    // Kontur icerden islenir: uzak kenarlar bir yaricap iceri gelir.
    // (Yaklasma tarafinda takim disaridan giris yaptigi icin o kenar olcut
    // alinmaz — tezgahta da rampa disaridan baslar.)
    expect(b.maxX).toBeCloseTo(9, 3);
    expect(b.maxY).toBeCloseTo(9, 3);
    expect(b.minX).toBeGreaterThanOrEqual(-1e-6);
  });

  it('yol kopuksuz kalir: her hareket bir oncekinin bittigi yerden baslar', () => {
    const r = parseGcode(square('G41 D1', 'G1 X0 Y10', 'G1 X10 Y10', 'G1 X10 Y0', 'G1 X0 Y0'), {
      toolRadius: 1.5,
    });
    for (let i = 1; i < r.moves.length; i++) {
      const prev = r.moves[i - 1]!;
      const cur = r.moves[i]!;
      expect(Math.hypot(cur.from.x - prev.to.x, cur.from.y - prev.to.y, cur.from.z - prev.to.z))
        .toBeLessThan(1e-9);
    }
  });

  it('dis kosede takim kose etrafindan yay cizerek doner', () => {
    const r = parseGcode(square('G41 D1', 'G1 X0 Y10', 'G1 X10 Y10', 'G1 X10 Y0', 'G1 X0 Y0'), {
      toolRadius: 2,
    });
    // (0,10) kosesinin etrafinda, kose merkezli yaricap 2 uzerinde noktalar olmali.
    const onCorner = r.moves.filter(
      (m) => Math.abs(Math.hypot(m.to.x - 0, m.to.y - 10) - 2) < 1e-6,
    );
    expect(onCorner.length).toBeGreaterThan(2);
  });

  it('G10 L12 ile programda tanimlanan yaricapi kullanir', () => {
    const r = parseGcode(
      g(
        'G21 G90 G17',
        'G10 L12 P1 R3.',
        'M3 S3000',
        'G0 X-5 Y0',
        'G1 Z-1 F200',
        'G41 D1 G1 X0 Y0 F500',
        'G1 X0 Y10',
        'G40 G1 X-5 Y10',
        'M30',
      ),
      // Panel capi bilinse bile programdaki tablo onceliklidir.
      { toolRadius: 1 },
    );
    const cutting = r.moves.filter((m) => m.kind === 'extrude' && m.to.x > -4);
    expect(Math.min(...cutting.map((m) => m.to.x))).toBeCloseTo(-3, 3);
  });

  it('yaricap bilinmiyorsa merkez hattini cizer ve uyarir', () => {
    const r = parseGcode(square('G41 D1', 'G1 X0 Y10', 'G1 X10 Y10', 'G1 X10 Y0', 'G1 X0 Y0'));
    const b = cutBounds(r.moves);
    expect(b.maxX).toBeCloseTo(10, 6);
    expect(r.diagnostics.some((d) => d.code === 'CUTTER_COMP_NO_RADIUS')).toBe(true);
  });

  it('G40 sonrasi hareketler kaydirilmaz', () => {
    const r = parseGcode(square('G41 D1', 'G1 X0 Y10', 'G1 X10 Y10', 'G1 X10 Y0', 'G1 X0 Y0'), {
      toolRadius: 1,
    });
    const last = r.moves.filter((m) => m.kind === 'extrude').pop();
    expect(last?.to.x).toBeCloseTo(-5, 6);
    expect(last?.to.y).toBeCloseTo(0, 6);
  });
});
