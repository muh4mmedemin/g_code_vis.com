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
    // 'G1 X0 Y0' baslangic noktasini degistirmez ve hareket uretmez;
    // yaya ait segmentler satir indeksiyle secilir.
    const arcMoves = r.moves.filter((m) => m.lineIndex === 2);
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
    expect(r.moves.filter((m) => m.lineIndex === 2)).toHaveLength(1);
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
    const r = parseGcode(
      g('M104 S200', 'M106 S255', 'M107', 'M84', 'G21', 'G90', 'M83', 'G1 X1 E0.1 F1200'),
    );
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
    expect(r.diagnostics.filter((d) => d.code === 'UNKNOWN_COMMAND').length).toBeLessThanOrEqual(
      10,
    );
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

describe('parseGcode — modal hareket (komut tekrari)', () => {
  it('komutsuz satirlarda son hareket komutunu tekrarlar', () => {
    const r = parseGcode(g('G21', 'G90', 'G1 X10 Y0 F300', 'X20', 'X30 Y5'));
    expect(r.moves).toHaveLength(3);
    expect(r.moves[1]?.to).toEqual({ x: 20, y: 0, z: 0 });
    expect(r.moves[2]?.to).toEqual({ x: 30, y: 5, z: 0 });
    expect(r.moves.every((m) => !m.rapid)).toBe(true);
  });

  it('G0 modalligini korur ve rapid bayragini tasir', () => {
    const r = parseGcode(g('G21', 'G90', 'G0 X5', 'X15'));
    expect(r.moves[1]?.rapid).toBe(true);
  });

  it('yalnizca F veya S iceren satirlar hareket uretmez', () => {
    const r = parseGcode(g('G21', 'G90', 'G1 X10 F300', 'F600', 'S1200'));
    expect(r.moves).toHaveLength(1);
  });

  it('modal G2 yay tekrarini destekler', () => {
    const r = parseGcode(g('G21', 'G90', 'G2 X10 Y0 I5 J0 F400', 'X0 Y0 I-5 J0'));
    const lines = new Set(r.moves.map((m) => m.lineIndex));
    expect(lines.size).toBe(2);
  });
});

describe('parseGcode — delme cevrimleri (canned cycles)', () => {
  it('G81 ile delik deler ve R duzlemine geri ceker', () => {
    const r = parseGcode(g('G21', 'G90', 'G0 X10 Y10 Z5', 'G99 G81 X10 Y10 Z-8 R2 F120', 'G80'));
    const cuts = r.moves.filter((m) => !m.rapid && m.distance > 0);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]?.from.z).toBeCloseTo(2);
    expect(cuts[0]?.to.z).toBeCloseTo(-8);
    // G99: R duzlemine donulur, baslangic Z'sine degil.
    expect(r.moves[r.moves.length - 1]?.to.z).toBeCloseTo(2);
  });

  it('G98 ile baslangic Z yuksekligine geri doner', () => {
    const r = parseGcode(g('G21', 'G90', 'G0 X0 Y0 Z10', 'G98 G81 X0 Y0 Z-5 R1 F100', 'G80'));
    expect(r.moves[r.moves.length - 1]?.to.z).toBeCloseTo(10);
  });

  it('cevrim modaldir: sonraki X/Y satirlari yeni delik acar', () => {
    const r = parseGcode(
      g('G21', 'G90', 'G0 Z5', 'G99 G81 X0 Y0 Z-6 R2 F120', 'X20 Y0', 'X20 Y20', 'G80'),
    );
    const plunges = r.moves.filter((m) => !m.rapid && m.to.z < 0);
    expect(plunges).toHaveLength(3);
    expect(plunges.map((m) => [m.to.x, m.to.y])).toEqual([
      [0, 0],
      [20, 0],
      [20, 20],
    ]);
  });

  it('G80 sonrasi X/Y satirlari delik acmaz', () => {
    const r = parseGcode(g('G21', 'G90', 'G0 Z5', 'G81 X0 Y0 Z-6 R2 F120', 'G80', 'X50 Y50'));
    const plunges = r.moves.filter((m) => !m.rapid && m.to.z < 0);
    expect(plunges).toHaveLength(1);
  });

  it('G83 gagalamayi Q adimlarina boler', () => {
    const r = parseGcode(g('G21', 'G90', 'G0 Z5', 'G99 G83 X0 Y0 Z-9 R1 Q3 F100', 'G80'));
    const plunges = r.moves.filter((m) => !m.rapid && m.distance > 0);
    expect(plunges).toHaveLength(4); // 1 -> -2 -> -5 -> -8 -> -9
    expect(plunges[plunges.length - 1]?.to.z).toBeCloseTo(-9);
    // Her gagalamadan sonra R duzlemine tam geri cekilme olmali (talas bosaltma).
    expect(r.moves.filter((m) => m.rapid && Math.abs(m.to.z - 1) < 1e-6).length).toBeGreaterThan(2);
  });

  it('G85 delikten isleme hiziyla cikar', () => {
    const r = parseGcode(g('G21', 'G90', 'G0 Z5', 'G99 G85 X0 Y0 Z-4 R1 F80', 'G80'));
    const feeds = r.moves.filter((m) => !m.rapid && m.distance > 0);
    expect(feeds).toHaveLength(2); // dalis + isleme hiziyla cikis
    expect(feeds[1]?.to.z).toBeCloseTo(1);
  });

  it('R veya Z eksikse hata uretir ve hareket olusturmaz', () => {
    const r = parseGcode(g('G21', 'G90', 'G81 X0 Y0 F100'));
    expect(r.diagnostics.some((d) => d.code === 'CANNED_CYCLE_INCOMPLETE')).toBe(true);
    expect(r.moves).toHaveLength(0);
  });

  it('G82 bekleme suresini tahmine ekler', () => {
    const withDwell = parseGcode(g('G21', 'G90', 'G0 Z5', 'G82 X0 Y0 Z-3 R1 P1.5 F100', 'G80'));
    const without = parseGcode(g('G21', 'G90', 'G0 Z5', 'G81 X0 Y0 Z-3 R1 F100', 'G80'));
    expect(withDwell.stats.estimatedDuration - without.stats.estimatedDuration).toBeCloseTo(1.5);
  });
});

describe('parseGcode — CNC komut bicimleri', () => {
  it('M6 T2 bicimindeki takim degisimini uygular', () => {
    const r = parseGcode(g('G21', 'G90', 'M6 T2', 'G1 X10 F200'));
    expect(r.moves[0]?.tool).toBe(2);
  });

  it('T2 M6 bicimini de uygular', () => {
    const r = parseGcode(g('G21', 'G90', 'T2 M6', 'G1 X10 F200'));
    expect(r.moves[0]?.tool).toBe(2);
  });

  it('tek haneyi asan takim numaralarini destekler (T12)', () => {
    const r = parseGcode(g('G21', 'G90', 'T12 M6', 'G1 X10 F200'));
    expect(r.moves[0]?.tool).toBe(12);
    expect(r.diagnostics.some((d) => d.code === 'UNKNOWN_COMMAND')).toBe(false);
  });

  it('G90.1 ile I/J mutlak merkez olarak yorumlanir', () => {
    const abs = parseGcode(g('G21', 'G90', 'G90.1', 'G0 X10 Y0', 'G3 X0 Y10 I0 J0 F300'));
    const last = abs.moves[abs.moves.length - 1];
    expect(last?.to.x).toBeCloseTo(0);
    expect(last?.to.y).toBeCloseTo(10);
    // Merkez (0,0) oldugundan tum noktalar 10mm yaricapta olmali.
    const arcPoints = abs.moves.filter((m) => !m.rapid);
    for (const m of arcPoints) {
      expect(Math.hypot(m.to.x, m.to.y)).toBeCloseTo(10, 3);
    }
    expect(abs.diagnostics.some((d) => d.code === 'ARC_RADIUS_MISMATCH')).toBe(false);
  });

  it('tutarsiz yay yaricapinda uyarir ama cizmeye devam eder', () => {
    const r = parseGcode(g('G21', 'G90', 'G1 X10 Y0 F300', 'G2 X0 Y30 I-5 J0'));
    expect(r.diagnostics.some((d) => d.code === 'ARC_RADIUS_MISMATCH')).toBe(true);
    expect(r.moves.length).toBeGreaterThan(2);
  });
});

describe('parseGcode — anlamsal uyarilar', () => {
  it('birim ve konumlandirma modu bildirilmediginde uyarir', () => {
    const r = parseGcode(g('G1 X10 F200'));
    expect(r.diagnostics.some((d) => d.code === 'NO_UNITS')).toBe(true);
    expect(r.diagnostics.some((d) => d.code === 'NO_POSITIONING_MODE')).toBe(true);
  });

  it('is mili calistirilmadan kesim yapilirsa uyarir', () => {
    const r = parseGcode(g('G21', 'G90', 'G1 X10 F200'));
    expect(r.diagnostics.some((d) => d.code === 'SPINDLE_NOT_STARTED')).toBe(true);

    const ok = parseGcode(g('G21', 'G90', 'M3 S1000', 'G1 X10 F200'));
    expect(ok.diagnostics.some((d) => d.code === 'SPINDLE_NOT_STARTED')).toBe(false);
  });

  it('F tanimsiz kesme hareketinde uyarir', () => {
    const r = parseGcode(g('G21', 'G90', 'M3 S1000', 'G1 X10'));
    expect(r.diagnostics.some((d) => d.code === 'ZERO_FEEDRATE')).toBe(true);
  });

  it('malzeme icinde hizli yatay hareketi yakalar', () => {
    const r = parseGcode(
      g('G21', 'G90', 'M3 S1000', 'G1 Z-5 F100', 'G1 X20', 'G0 X40 Y10', 'G0 Z5'),
    );
    expect(r.diagnostics.some((d) => d.code === 'RAPID_INSIDE_STOCK')).toBe(true);
  });

  it('guvenli Z yuksekliginden yapilan hizli hareketleri uyarmaz', () => {
    const r = parseGcode(
      g('G21', 'G90', 'M3 S1000', 'G0 Z5', 'G1 Z-5 F100', 'G1 X20', 'G0 Z5', 'G0 X40 Y10'),
    );
    expect(r.diagnostics.some((d) => d.code === 'RAPID_INSIDE_STOCK')).toBe(false);
  });

  it('baski dosyasinda tabla altina extrude yapilmasini hata sayar', () => {
    const r = parseGcode(g('G21', 'G90', 'M83', 'G1 Z-1 F300', 'G1 X10 E1'));
    expect(r.diagnostics.some((d) => d.code === 'EXTRUDE_BELOW_BED')).toBe(true);
  });

  it('hicbir hareket yoksa hata uretir', () => {
    const r = parseGcode(g('; sadece yorum', 'M104 S200'));
    expect(r.diagnostics.some((d) => d.code === 'NO_MOTION')).toBe(true);
  });

  it('tanilar satir sirasina gore siralanir', () => {
    const r = parseGcode(g('G1 X10 F200', 'G9999', 'M9999'));
    const lines = r.diagnostics.map((d) => d.lineIndex);
    expect([...lines].sort((a, b) => a - b)).toEqual(lines);
  });
});

describe('parseGcode — program akisi ve alt programlar', () => {
  it('M30 sonrasindaki kodu calistirmaz', () => {
    const r = parseGcode(g('G21', 'G90', 'M3 S1000', 'G1 X10 F200', 'M30', 'G1 X999'));
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0]?.to.x).toBe(10);
    expect(r.diagnostics.some((d) => d.code === 'CODE_AFTER_PROGRAM_END')).toBe(true);
  });

  it('M98 alt programi cagri yerinde calistirir', () => {
    const r = parseGcode(
      g(
        'G21', 'G90', 'M3 S1000',
        'G0 X0 Y0',
        'M98 P1000',
        'G0 Z50',
        'M30',
        'O1000',
        'G1 X10 F100',
        'G1 Y10',
        'M99',
      ),
    );

    // Alt programin hareketleri, cagri ile Z50 arasinda olmali.
    const kinds = r.moves.map((m) => `${m.to.x},${m.to.y},${m.to.z}`);
    // 'G0 X0 Y0' takim zaten oradayken hareket uretmez.
    expect(kinds).toEqual(['10,0,0', '10,10,0', '10,10,50']);
    expect(r.diagnostics.some((d) => d.code === 'UNKNOWN_COMMAND')).toBe(false);
  });

  it('L ile alt programi birden fazla kez calistirir', () => {
    const r = parseGcode(
      g(
        'G21', 'G90', 'M3 S1000', 'G0 X0 Y0',
        'M98 P200 L3',
        'M30',
        'O200',
        'G91', 'G1 X5 F100', 'G90',
        'M99',
      ),
    );
    const cuts = r.moves.filter((m) => !m.rapid);
    expect(cuts).toHaveLength(3);
    expect(cuts[2]?.to.x).toBeCloseTo(15);
  });

  it('bulunmayan alt program cagrisini hata olarak bildirir', () => {
    const r = parseGcode(g('G21', 'G90', 'M3 S1000', 'G1 X1 F100', 'M98 P4242', 'M30'));
    expect(r.diagnostics.some((d) => d.code === 'SUBPROGRAM_NOT_FOUND')).toBe(true);
  });

  it('kendini cagiran alt programda sonsuz donguye girmez', () => {
    const r = parseGcode(
      g('G21', 'G90', 'M3 S1000', 'M98 P1', 'M30', 'O1', 'G1 X1 F100', 'M98 P1', 'M99'),
    );
    expect(r.diagnostics.some((d) => d.code === 'SUBPROGRAM_TOO_DEEP')).toBe(true);
    expect(r.moves.length).toBeLessThan(50);
  });

  it('dosya basindaki O numarasini program adi sayar', () => {
    const r = parseGcode(g('O1234', 'G21', 'G90', 'M3 S1000', 'G1 X10 F100', 'M30'));
    expect(r.moves).toHaveLength(1);
  });
});

describe('parseGcode — ilerleme (feed) modlari', () => {
  it('G93 ters zamanda sureyi 1/F dakika alir', () => {
    const r = parseGcode(g('G21', 'G90', 'M3 S1000', 'G93', 'G1 X100 F2'));
    // F2 => hareket 1/2 dakika = 30 saniye (mesafeden bagimsiz)
    expect(r.moves[0]?.duration).toBeCloseTo(30);
  });

  it('G94 mm/dakika varsayilanina doner', () => {
    const r = parseGcode(g('G21', 'G90', 'M3 S1000', 'G93', 'G1 X10 F2', 'G94', 'G1 X20 F600'));
    expect(r.moves[1]?.duration).toBeCloseTo(1);
  });

  it('G95 mm/devir suresini is mili hizindan hesaplar', () => {
    const r = parseGcode(g('G21', 'G90', 'M3 S1000', 'G95', 'G1 X100 F0.2'));
    // 0.2 mm/devir * 1000 dev/dk = 200 mm/dk => 100mm = 30 saniye
    expect(r.moves[0]?.duration).toBeCloseTo(30);
  });
});

describe('parseGcode — ek CNC komutlari', () => {
  it('G53 makine koordinatini bir kez uyarir', () => {
    const r = parseGcode(
      g('G21', 'G90', 'M3 S1000', 'G1 X10 F200', 'G53 G0 Z0', 'G53 G0 X0'),
    );
    expect(r.diagnostics.filter((d) => d.code === 'MACHINE_COORDINATES')).toHaveLength(1);
  });

  it('G10 ve G92.1 icin bilinmeyen komut uyarisi vermez', () => {
    const r = parseGcode(
      g('G21', 'G90', 'M3 S1000', 'G10 L2 P1 X0 Y0 Z0', 'G1 X5 F100', 'G92.1'),
    );
    expect(r.diagnostics.some((d) => d.code === 'UNKNOWN_COMMAND')).toBe(false);
  });

  it('doner eksen (A/B/C) kullanimini uyarir', () => {
    const r = parseGcode(g('G21', 'G90', 'M3 S1000', 'G1 X10 A90 F100'));
    expect(r.diagnostics.some((d) => d.code === 'ROTARY_AXIS_IGNORED')).toBe(true);
  });

  it('G91 + L ile delme cevrimini bir sira delik olarak tekrarlar', () => {
    const r = parseGcode(
      g('G21', 'G90', 'M3 S1000', 'G0 Z5', 'G91', 'G99 G81 X10 Y0 Z-5 R-3 L3 F100', 'G80'),
    );
    const plunges = r.moves.filter((m) => !m.rapid && m.distance > 0);
    expect(plunges).toHaveLength(3);
    expect(plunges.map((m) => m.to.x)).toEqual([10, 20, 30]);
    // Her delik AYNI derinlikte olmali (tekrarlar ust uste inmemeli).
    const depths = plunges.map((m) => Number(m.to.z.toFixed(3)));
    expect(new Set(depths).size).toBe(1);
  });
});

describe('parseGcode — CAM (N satir numarali, modal) programlari', () => {
  it('N numarali ve komutu her satirda tekrarlayan konturu cizer', () => {
    const r = parseGcode(
      g(
        'N7701 G21 G90 G94',
        'N7703 M3 S8000',
        'N7705 G1 X17.863 Y-18.3 F600.',
        'N7707 G1 Y-18.9',
        'N7709 G1 X17.936 Y-19.159',
        'N7711 G1 X18.187 Y-19.279',
        'N7713 G1 X18.434 Y-19.172',
      ),
    );
    expect(r.moves).toHaveLength(5);
    expect(r.moves[1]?.to).toEqual({ x: 17.863, y: -18.9, z: 0 });
    expect(r.moves[4]?.to.x).toBeCloseTo(18.434);
    expect(r.moves.every((m) => m.f === 600)).toBe(true);
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('"G43 H1 Z15. M8" satirini modal G0 ile guvenli yukseklige cikarir', () => {
    const r = parseGcode(
      g('G21', 'G90', 'M3 S5000', 'G0 X10 Y10', 'G43 H1 Z15. M8', 'Z2.', 'G1 Z-1 F100'),
    );
    const retract = r.moves[1];
    expect(retract?.to).toEqual({ x: 10, y: 10, z: 15 });
    expect(retract?.rapid).toBe(true);
    // Sonraki satir yine modal G0: guvenli yukseklikten yaklasma.
    expect(r.moves[2]?.from.z).toBe(15);
    expect(r.moves[2]?.to.z).toBe(2);
  });

  it('eksen sozcugu tasiyan ama hareket etmeyen M kodlarini hareket saymaz', () => {
    // M600 (filament degisimi) X/Y tasir ama takimi programlanan yola goturmez.
    const r = parseGcode(g('G21', 'G90', 'G1 X10 Y10 F600', 'M600 X0 Y0', 'G1 X20'));
    expect(r.moves).toHaveLength(2);
    expect(r.moves[1]?.to).toEqual({ x: 20, y: 10, z: 0 });
  });

  it('G53/G28 referans donusunu parcaya dalan hareket olarak cizmez', () => {
    const r = parseGcode(
      g(
        'G21', 'G90', 'M3 S5000',
        'G0 X0 Y0',
        'G0 Z15',
        'G1 Z-3 F100',
        'G1 X20',
        'G0 Z15',
        'G53 G0 Z0.',
        'G91 G28 Z0.',
        'G90',
      ),
    );
    // Referans donusleri asagi inmez: en dusuk Z yalnizca kesim seviyesidir.
    expect(Math.min(...r.moves.map((m) => m.to.z))).toBe(-3);
    expect(r.moves[r.moves.length - 1]?.to.z).toBe(15);
    expect(r.diagnostics.some((d) => d.code === 'MACHINE_COORDINATES')).toBe(true);
  });

  it('G30 ikinci referans donusunu bilinmeyen komut saymaz', () => {
    const r = parseGcode(
      g('G21', 'G90', 'M3 S5000', 'G0 Z10', 'G1 Z-2 F100', 'G0 Z10', 'G91 G30 Z0.', 'G90'),
    );
    expect(r.diagnostics.some((d) => d.code === 'UNKNOWN_COMMAND')).toBe(false);
    expect(r.moves.every((m) => m.to.z >= -2)).toBe(true);
  });

  it('yalnizca F degistiren satir hareket uretmez ama ilerlemeyi gunceller', () => {
    const r = parseGcode(g('G21', 'G90', 'G1 X10 F300', 'G1 F900', 'G1 X20'));
    expect(r.moves).toHaveLength(2);
    expect(r.moves[1]?.f).toBe(900);
  });

  it('sayisiz F harfi (makro satiri) ilerleme hizini sifirlamaz', () => {
    const r = parseGcode(g('G21', 'G90', 'G1 X10 F500', 'IF [#1 EQ 1] GOTO 100', 'G1 X20'));
    expect(r.moves[r.moves.length - 1]?.f).toBe(500);
    expect(r.diagnostics.some((d) => d.code === 'ZERO_FEEDRATE')).toBe(false);
  });
});
