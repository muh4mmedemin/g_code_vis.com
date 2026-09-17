import { describe, expect, it } from 'vitest';
import { parseGcode } from '../index';
import { MM_PER_INCH } from '@/core/constants';

const g = (...lines: string[]) => lines.join('\n');

describe('parseGcode — temel hareket', () => {
  it('G1 hareketlerini extrude/travel olarak siniflandirir', () => {
    const r = parseGcode(g('G90', 'G1 X10 Y0 F1200', 'G1 X20 E1.0'));
    expect(r.moves.map((m) => m.kind)).toEqual(['travel', 'extrude']);
    expect(r.moves[1]?.e).toBeCloseTo(1.0);
  });

  it('XYZ yer degistirmesi olmadan E degisimini retract sayar', () => {
    const r = parseGcode(g('G90', 'M83', 'G1 X10 E1', 'G1 E-2'));
    expect(r.moves[1]?.kind).toBe('retract');
    expect(r.moves[1]?.e).toBeCloseTo(-2);
  });

  it('relative konumlandirmayi (G91) uygular', () => {
    const r = parseGcode(g('G91', 'G1 X5 Y5', 'G1 X5'));
    expect(r.moves[1]?.to).toEqual({ x: 10, y: 5, z: 0 });
  });

  it('G92 ile pozisyonu sifirlar ve parametresiz cagriyi destekler', () => {
    const r = parseGcode(g('G90', 'G1 X10 Y10', 'G92 X0 Y0', 'G1 X5'));
    expect(r.moves[1]?.from).toEqual({ x: 0, y: 0, z: 0 });

    const r2 = parseGcode(g('G90', 'G1 X10 Y10 Z5', 'G92', 'G1 X1'));
    expect(r2.moves[1]?.from).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('G28 belirtilen ekseni home eder, parametresizse hepsini', () => {
    const r = parseGcode(g('G90', 'G1 X10 Y20 Z5', 'G28 X'));
    const home = r.moves[1];
    expect(home?.kind).toBe('home');
    expect(home?.to).toEqual({ x: 0, y: 20, z: 5 });

    const r2 = parseGcode(g('G90', 'G1 X10 Y20 Z5', 'G28'));
    expect(r2.moves[1]?.to).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('inch modunda (G20) degerleri mm-ye cevirir', () => {
    const r = parseGcode(g('G20', 'G90', 'G1 X1'));
    expect(r.moves[0]?.to.x).toBeCloseTo(MM_PER_INCH);
  });

  it('komutsuz F satirini modal feedrate olarak uygular', () => {
    const r = parseGcode(g('G90', 'F600', 'G1 X10'));
    expect(r.moves[0]?.f).toBe(600);
    expect(r.moves[0]?.duration).toBeCloseTo(1); // 10mm / 600mm-dk = 1sn
  });
});

describe('parseGcode — tek satirda birden fazla komut', () => {
  it('modal komutu ayni satirdaki hareketten once uygular', () => {
    // G91 satirin sonunda yazilmis olsa bile hareketten ONCE uygulanmali
    const r = parseGcode(g('G90', 'G1 X10', 'G1 G91 X5'));
    expect(r.moves[1]?.to.x).toBeCloseTo(15);
  });

  it('birlesik modal satirlarini isler (G90 G21)', () => {
    const r = parseGcode(g('G20 G91', 'G1 X1'));
    // inch + relative: 0 + 25.4
    expect(r.moves[0]?.to.x).toBeCloseTo(MM_PER_INCH);
  });
});

describe('parseGcode — E modu', () => {
  it('M83 ile relative E kullanir', () => {
    const r = parseGcode(g('G90', 'M83', 'G1 X10 E1', 'G1 X20 E1'));
    expect(r.moves[0]?.e).toBeCloseTo(1);
    expect(r.moves[1]?.e).toBeCloseTo(1);
  });

  it('M82 ile absolute E kullanir', () => {
    const r = parseGcode(g('G90', 'M82', 'G1 X10 E1', 'G1 X20 E3'));
    expect(r.moves[1]?.e).toBeCloseTo(2);
  });

  it('M82/M83 yoksa E ekseni G91 ile relative olur', () => {
    const r = parseGcode(g('G91', 'G1 X10 E1', 'G1 X10 E1'));
    expect(r.moves[0]?.e).toBeCloseTo(1);
    expect(r.moves[1]?.e).toBeCloseTo(1);
  });

  it('acik M82 sonrasi G91 E modunu bozmaz', () => {
    const r = parseGcode(g('M82', 'G91', 'G1 X10 E5', 'G1 X10 E7'));
    expect(r.moves[1]?.e).toBeCloseTo(2);
  });
});

describe('parseGcode — yaylar (G2/G3)', () => {
  it('G2 yayini segmentlere boler ve hedefte bitirir', () => {
    // (10,0) -> (0,10), merkez (0,0): ceyrek cember, saat yonu tersi yonunde degil
    const r = parseGcode(g('G90', 'G1 X10 Y0', 'G3 X0 Y10 I-10 J0'));
    const arcMoves = r.moves.slice(1);
    expect(arcMoves.length).toBeGreaterThan(3);
    const last = arcMoves[arcMoves.length - 1];
    expect(last?.to.x).toBeCloseTo(0, 6);
    expect(last?.to.y).toBeCloseTo(10, 6);
    // Tum ara noktalar yaricap 10 cemberi uzerinde olmali
    for (const m of arcMoves) {
      expect(Math.hypot(m.to.x, m.to.y)).toBeCloseTo(10, 3);
    }
  });

  it('yay uzunlugu kirisin uzunlugundan buyuktur', () => {
    const r = parseGcode(g('G90', 'G1 X10 Y0', 'G3 X0 Y10 I-10 J0'));
    const arcLength = r.moves.slice(1).reduce((sum, m) => sum + m.distance, 0);
    const chord = Math.hypot(10, 10);
    expect(arcLength).toBeGreaterThan(chord);
    // Ceyrek cember: 2*pi*10/4 ~= 15.7
    expect(arcLength).toBeCloseTo((Math.PI * 10) / 2, 1);
  });

  it('R formunu destekler', () => {
    const r = parseGcode(g('G90', 'G1 X0 Y0', 'G2 X10 Y0 R5'));
    const arcMoves = r.moves.slice(1);
    const last = arcMoves[arcMoves.length - 1];
    expect(last?.to.x).toBeCloseTo(10, 6);
    expect(last?.to.y).toBeCloseTo(0, 6);
    const arcLength = arcMoves.reduce((sum, m) => sum + m.distance, 0);
    expect(arcLength).toBeCloseTo(Math.PI * 5, 1); // yarim cember
  });

  it('G2/G3 yonlerini ayirt eder', () => {
    const cw = parseGcode(g('G90', 'G1 X10 Y0', 'G2 X0 Y10 I-10 J0'));
    const ccw = parseGcode(g('G90', 'G1 X10 Y0', 'G3 X0 Y10 I-10 J0'));
    const cwLen = cw.moves.slice(1).reduce((s, m) => s + m.distance, 0);
    const ccwLen = ccw.moves.slice(1).reduce((s, m) => s + m.distance, 0);
    // Saat yonu ayni iki nokta arasinda uzun yolu (3/4 cember) izler
    expect(cwLen).toBeGreaterThan(ccwLen);
    expect(cwLen).toBeCloseTo((3 / 4) * 2 * Math.PI * 10, 0);
  });

  it('helis (Z degisen yay) destekler', () => {
    const r = parseGcode(g('G90', 'G1 X10 Y0 Z0', 'G3 X0 Y10 Z5 I-10 J0'));
    const last = r.moves[r.moves.length - 1];
    expect(last?.to.z).toBeCloseTo(5, 6);
  });

  it('G18/G19 duzlemlerinde calisir', () => {
    const r = parseGcode(g('G90', 'G18', 'G1 X10 Z0', 'G3 X0 Z10 I-10 K0'));
    const last = r.moves[r.moves.length - 1];
    expect(last?.to.x).toBeCloseTo(0, 6);
    expect(last?.to.z).toBeCloseTo(10, 6);
  });

  it('yay E miktarini segmentlere dagitir', () => {
    const r = parseGcode(g('G90', 'M83', 'G1 X10 Y0', 'G3 X0 Y10 I-10 J0 E4'));
    const arcMoves = r.moves.slice(1);
    const totalE = arcMoves.reduce((s, m) => s + m.e, 0);
    expect(totalE).toBeCloseTo(4, 6);
    expect(arcMoves.every((m) => m.kind === 'extrude')).toBe(true);
  });

  it('gecersiz yayda duz cizgi cizip uyarir', () => {
    const r = parseGcode(g('G90', 'G1 X0 Y0', 'G2 X10 Y0'));
    expect(r.moves).toHaveLength(2);
    expect(r.diagnostics.some((d) => d.code === 'INVALID_ARC')).toBe(true);
  });

  it('tam cember (baslangic=bitis, I/J ile) uretir', () => {
    const r = parseGcode(g('G90', 'G1 X10 Y0', 'G2 X10 Y0 I-10 J0'));
    const arcMoves = r.moves.slice(1);
    const arcLength = arcMoves.reduce((s, m) => s + m.distance, 0);
    expect(arcLength).toBeCloseTo(2 * Math.PI * 10, 0);
  });
});

describe('parseGcode — katman tespiti', () => {
  it('Z-hop icin sahte katman acmaz', () => {
    const r = parseGcode(
      g(
        'G90',
        'M83',
        'G1 Z0.2',
        'G1 X10 E1', // katman 1
        'G1 Z0.6', // Z-hop (travel)
        'G1 X20',
        'G1 Z0.2', // hop'tan don
        'G1 X30 E1', // hala katman 1
        'G1 Z0.4',
        'G1 X40 E1', // katman 2
      ),
    );
    expect(r.layers).toHaveLength(2);
    expect(r.layers[0]?.z).toBeCloseTo(0.2);
    expect(r.layers[1]?.z).toBeCloseTo(0.4);
  });

  it('extrusion yoksa (CNC) Z degisimlerini paso olarak katmanlar', () => {
    const r = parseGcode(g('G90', 'G1 Z-2', 'G1 X10', 'G1 Z-4', 'G1 X20'));
    expect(r.layers.length).toBeGreaterThanOrEqual(2);
  });

  it('Cura ;LAYER: yorumlarini katman siniri olarak kullanir', () => {
    const r = parseGcode(
      g(
        ';Generated with Cura_SteamEngine 5.0',
        'G90',
        'M83',
        ';LAYER:0',
        'G1 Z0.2',
        'G1 X10 E1',
        ';LAYER:1',
        'G1 Z0.4',
        'G1 X20 E1',
        ';LAYER:2',
        'G1 Z0.6',
        'G1 X30 E1',
      ),
    );
    expect(r.dialect).toBe('cura');
    expect(r.layers).toHaveLength(3);
  });

  it('PrusaSlicer ;LAYER_CHANGE yorumlarini tanir', () => {
    const r = parseGcode(
      g(
        '; generated by PrusaSlicer 2.7.0',
        'G90',
        'M83',
        ';LAYER_CHANGE',
        ';Z:0.2',
        'G1 X10 E1',
        ';LAYER_CHANGE',
        ';Z:0.4',
        'G1 X20 E1',
      ),
    );
    expect(r.dialect).toBe('prusaslicer');
    expect(r.layers).toHaveLength(2);
  });

  it('her hareketi bir katmana atar', () => {
    const r = parseGcode(g('G90', 'M83', 'G1 Z0.2', 'G1 X10 E1', 'G1 Z0.4', 'G1 X20 E1'));
    for (const move of r.moves) {
      expect(move.layerIndex).toBeGreaterThanOrEqual(0);
      expect(move.layerIndex).toBeLessThan(r.layers.length);
    }
    // Katman araliklari tum hareketleri kapsar
    expect(r.layers[0]?.startMove).toBe(0);
    expect(r.layers[r.layers.length - 1]?.endMove).toBe(r.moves.length);
  });
});

describe('parseGcode — takim, bekleme, tanilar', () => {
  it('T komutuyla aktif takimi degistirir', () => {
    const r = parseGcode(g('G90', 'G1 X1', 'T1', 'G1 X2'));
    expect(r.moves[0]?.tool).toBe(0);
    expect(r.moves[1]?.tool).toBe(1);
    expect(r.diagnostics.some((d) => d.message.includes('T1'))).toBe(false);
  });

  it('G4 beklemesini sure tahminine ekler', () => {
    const withDwell = parseGcode(g('G90', 'G1 X10 F600', 'G4 P2000'));
    const without = parseGcode(g('G90', 'G1 X10 F600'));
    expect(withDwell.stats.estimatedDuration - without.stats.estimatedDuration).toBeCloseTo(2);
  });

  it('bilinen yardimci M kodlari icin uyari uretmez', () => {
    const r = parseGcode(g('M104 S200', 'M106 S255', 'M107', 'M84', 'G90', 'G1 X1'));
    expect(r.diagnostics.filter((d) => d.severity === 'warning')).toHaveLength(0);
  });

  it('bilinmeyen M kodunu info, bilinmeyen G kodunu warning yapar', () => {
    const r = parseGcode(g('M9999', 'G9999'));
    const m = r.diagnostics.find((d) => d.message.includes('M9999'));
    const gc = r.diagnostics.find((d) => d.message.includes('G9999'));
    expect(m?.severity).toBe('info');
    expect(gc?.severity).toBe('warning');
  });

  it('tani sayisini sinirlar', () => {
    const many = Array.from({ length: 1000 }, () => 'G8888').join('\n');
    const r = parseGcode(many, { maxDiagnostics: 10 });
    expect(r.diagnostics.length).toBeLessThanOrEqual(11); // 10 + kirpma bilgisi
    expect(r.diagnostics.some((d) => d.code === 'DIAGNOSTICS_TRUNCATED')).toBe(true);
  });
});

describe('parseGcode — dayaniklilik', () => {
  it('bos girdiyi cokmeden isler', () => {
    const r = parseGcode('');
    expect(r.moves).toHaveLength(0);
    expect(r.layers).toHaveLength(0);
    expect(r.stats.totalMoves).toBe(0);
    expect(r.buffers.count).toBe(0);
  });

  it('sadece yorumdan olusan dosyayi isler', () => {
    const r = parseGcode(g('; sadece', '; yorumlar', '%'));
    expect(r.moves).toHaveLength(0);
  });

  it('CRLF ve tek CR satir sonlarini isler', () => {
    const r = parseGcode('G90\r\nG1 X10\rG1 X20');
    expect(r.moves).toHaveLength(2);
  });

  it('bozuk/yarim satirlarda cokmez', () => {
    const r = parseGcode(g('G1 X', 'G', 'X10', '@@@', 'G1 X10 Y'));
    expect(() => r.buffers).not.toThrow();
    expect(r.moves.length).toBeGreaterThanOrEqual(1);
  });

  it('buffers hareket sayisiyla tutarlidir', () => {
    const r = parseGcode(g('G90', 'M83', 'G1 X10 E1', 'G1 Y10 E1', 'G1 Z1'));
    expect(r.buffers.count).toBe(r.moves.length);
    expect(r.buffers.positions).toHaveLength(r.moves.length * 6);
    expect(r.buffers.kinds).toHaveLength(r.moves.length);
    expect(r.buffers.layerIndices).toHaveLength(r.moves.length);
    // timeOffsets kumulatif ve azalmayan olmali
    for (let i = 1; i < r.buffers.timeOffsets.length; i++) {
      expect(r.buffers.timeOffsets[i]!).toBeGreaterThanOrEqual(r.buffers.timeOffsets[i - 1]!);
    }
  });

  it('istatistikleri dogru toplar', () => {
    const r = parseGcode(g('G90', 'M83', 'G1 X10 F600', 'G1 X20 E2 F600'));
    expect(r.stats.distanceTravel).toBeCloseTo(10);
    expect(r.stats.distanceExtrude).toBeCloseTo(10);
    expect(r.stats.filamentLength).toBeCloseTo(2);
    expect(r.stats.bounds.max.x).toBeCloseTo(20);
  });

  it('ilerleme bildirimini 1 ile bitirir', () => {
    const ratios: number[] = [];
    parseGcode(g('G90', 'G1 X1', 'G1 X2'), { onProgress: (r) => ratios.push(r) });
    expect(ratios[ratios.length - 1]).toBe(1);
  });
});
