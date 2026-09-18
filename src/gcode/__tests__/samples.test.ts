import { describe, expect, it } from 'vitest';
import { parseGcode } from '../parser';

/**
 * public/samples altindaki hazir dosyalarin saglik kontrolu.
 *
 * NEDEN: Ornekler uygulamanin vitrinidir; bozulduklarinda hata kullaniciya
 * dogrudan yansir. Ayrica bu test, parser'in gercek programlarla (elle
 * yazilmis modal CNC kodu, delme cevrimleri, inc birimi) calistiginin
 * uctan uca kanitidir.
 */
const modules = import.meta.glob('../../../public/samples/*.gcode', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const samples: Array<[string, string]> = Object.entries(modules)
  .map(([path, source]) => [path.split('/').pop() ?? path, source] as [string, string])
  .sort((a, b) => a[0].localeCompare(b[0]));

const cncSamples = samples.filter(([name]) => name.startsWith('cnc-') || name.includes('holder'));

describe('ornek dosyalar', () => {
  it('ornek klasoru bos degil', () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  it.each(samples)('%s hatasiz parse edilir', (_name, source) => {
    const result = parseGcode(source);

    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors, `beklenmeyen hata: ${JSON.stringify(errors.slice(0, 3))}`).toHaveLength(0);
    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.stats.bounds.min.x).toBeLessThan(result.stats.bounds.max.x);
  });

  it.each(samples)('%s uyari uretmeyen temiz bir programdir', (_name, source) => {
    const result = parseGcode(source);
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings.map((w) => `satir ${w.lineIndex + 1}: ${w.code}`)).toEqual([]);
  });

  it.each(cncSamples)('%s gercekten kesim yapar ve malzeme icinde kalir', (_name, source) => {
    const result = parseGcode(source);
    const cutting = result.moves.filter((m) => m.kind === 'extrude');
    expect(cutting.length).toBeGreaterThan(10);
    expect(cutting.every((m) => m.to.z <= 1e-6)).toBe(true);
  });
});
