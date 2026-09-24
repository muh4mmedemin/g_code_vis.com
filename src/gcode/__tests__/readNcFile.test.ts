import { describe, expect, it } from 'vitest';
import { readNcFile } from '../readNcFile';

/** Tarayicidaki File nesnesini taklit eden kucuk yardimci. */
const fileOf = (name: string, bytes: Uint8Array): File =>
  ({
    name,
    size: bytes.length,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  }) as unknown as File;

const ascii = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)));

describe('NC dosyasi okuma (uzantidan bagimsiz)', () => {
  it('".dat" uzantili ISO programini metin olarak okur', async () => {
    const result = await readNcFile(fileOf('ERKEK.dat', ascii('N1 ERKEK\nN3 G40 G17 G80 G90\n')));
    expect(result.error).toBeNull();
    expect(result.text).toContain('G40 G17 G80 G90');
  });

  it('ikili ".prt" dosyasini parse etmeye calismaz, ne oldugunu soyler', async () => {
    const bytes = new Uint8Array(512);
    bytes.set(ascii('UGII'), 0);
    const result = await readNcFile(fileOf('kalip.prt', bytes));
    expect(result.text).toBeNull();
    expect(result.error).toMatch(/NX|CAD/i);
  });

  it('metin ".prt" dosyasini normal sekilde okur', async () => {
    const result = await readNcFile(fileOf('parca.prt', ascii('%\nO1000\nG21 G90\nG1 X10 F200\n')));
    expect(result.error).toBeNull();
    expect(result.text).toContain('O1000');
  });

  it('eski Windows kod sayfasindaki Turkce yorumlari bozmadan okur', async () => {
    // "(PARÇA)" — windows-1254'te Ç = 0xC7.
    const bytes = new Uint8Array([
      ...ascii('(PAR'), 0xc7, ...ascii('A)\nG21 G90\n'),
    ]);
    const result = await readNcFile(fileOf('program.dat', bytes));
    expect(result.encoding).toBe('windows-1254');
    expect(result.text).toContain('(PARÇA)');
  });

  it('ZIP/ofis dosyasini ayirt eder', async () => {
    const bytes = new Uint8Array(256);
    bytes.set(ascii('PK\u0003\u0004'), 0);
    const result = await readNcFile(fileOf('liste.xlsx', bytes));
    expect(result.text).toBeNull();
    expect(result.error).toMatch(/arsiv|ofis/i);
  });
});
