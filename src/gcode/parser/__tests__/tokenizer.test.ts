import { describe, expect, it } from 'vitest';
import { tokenizeLine } from '../tokenizer';

describe('tokenizeLine', () => {
  it('temel komut ve parametreleri ayristirir', () => {
    const t = tokenizeLine('G1 X10.5 Y2 E0.04 F1500', 0);
    expect(t.command).toBe('G1');
    expect(t.commands).toEqual(['G1']);
    expect(t.params).toEqual({ X: 10.5, Y: 2, E: 0.04, F: 1500 });
    expect(t.comment).toBeNull();
  });

  it('G01 gibi sifir dolgulu kodlari normalize eder', () => {
    expect(tokenizeLine('G01 X1', 0).command).toBe('G1');
    expect(tokenizeLine('G00 X1', 0).command).toBe('G0');
  });

  it('bosluksuz yazimi cozer', () => {
    const t = tokenizeLine('G1X10Y-20Z0.3', 0);
    expect(t.command).toBe('G1');
    expect(t.params).toEqual({ X: 10, Y: -20, Z: 0.3 });
  });

  it('kucuk harfleri kabul eder', () => {
    const t = tokenizeLine('g1 x5 y6', 0);
    expect(t.command).toBe('G1');
    expect(t.params).toEqual({ X: 5, Y: 6 });
  });

  it('noktali virgul yorumlarini ayirir', () => {
    const t = tokenizeLine('G1 X1 ; wall-outer', 0);
    expect(t.params.X).toBe(1);
    expect(t.comment).toBe('wall-outer');
  });

  it('parantezli yorumlari ayirir', () => {
    const t = tokenizeLine('G1 (ilk) X1 (ikinci) Y2', 0);
    expect(t.params).toEqual({ X: 1, Y: 2 });
    expect(t.comment).toBe('ilk ikinci');
  });

  it('kapanmamis parantezi satir sonuna kadar yorum sayar', () => {
    const t = tokenizeLine('G1 X1 (kapanmadi Y99', 0);
    expect(t.params).toEqual({ X: 1 });
    expect(t.params.Y).toBeUndefined();
    expect(t.comment).toBe('kapanmadi Y99');
  });

  it('satir numarasi ve checksum atar', () => {
    const t = tokenizeLine('N123 G1 X10 *45', 0);
    expect(t.command).toBe('G1');
    expect(t.params).toEqual({ X: 10 });
  });

  it('tek satirdaki birden fazla komutu yakalar', () => {
    const t = tokenizeLine('G90 G21 G17', 0);
    expect(t.commands).toEqual(['G90', 'G21', 'G17']);
  });

  it('hareket ve modal komutu ayni satirda birlikte dondurur', () => {
    const t = tokenizeLine('G0 G90 X10 Y20', 0);
    expect(t.commands).toEqual(['G0', 'G90']);
    expect(t.params).toEqual({ X: 10, Y: 20 });
  });

  it('isaretli ve noktayla baslayan sayilari cozer', () => {
    const t = tokenizeLine('G1 X+10 Y-.5 Z.25 E-0.8', 0);
    expect(t.params).toEqual({ X: 10, Y: -0.5, Z: 0.25, E: -0.8 });
  });

  it('sayisiz eksen harflerini yakalar (G28 X Y)', () => {
    const t = tokenizeLine('G28 X Y', 0);
    expect(t.command).toBe('G28');
    expect(t.params.X).toBe(0);
    expect(t.params.Y).toBe(0);
    expect(t.params.Z).toBeUndefined();
    expect(t.bare).toEqual(['X', 'Y']);
  });

  it('T yalnizca ilk sozcukse takim komutudur', () => {
    expect(tokenizeLine('T1', 0).commands).toEqual(['T1']);
    // M104 S200 T0 -> T burada hedef extruder parametresi, takim degisimi degil
    const t = tokenizeLine('M104 S200 T0', 0);
    expect(t.commands).toEqual(['M104']);
    expect(t.params.T).toBe(0);
  });

  it('% program sinirlayicisini yok sayar', () => {
    const t = tokenizeLine('%', 0);
    expect(t.commands).toEqual([]);
    expect(t.command).toBeNull();
  });

  it('bos ve yalniz yorum satirlarinda komut dondurmez', () => {
    expect(tokenizeLine('', 0).command).toBeNull();
    expect(tokenizeLine('   ', 0).command).toBeNull();
    const only = tokenizeLine('; sadece yorum', 0);
    expect(only.command).toBeNull();
    expect(only.comment).toBe('sadece yorum');
  });
});
