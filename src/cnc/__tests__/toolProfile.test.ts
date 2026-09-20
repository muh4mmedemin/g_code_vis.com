import { describe, expect, it } from 'vitest';
import { profileSamples, tipHeightAtRadius, tipLength, toolRadius } from '../toolProfile';
import type { ToolDefinition } from '@/core/types';

const tool = (patch: Partial<ToolDefinition>): ToolDefinition => ({
  type: 'flat',
  diameter: 6,
  fluteLength: 25,
  ...patch,
});

describe('takim ucu profili', () => {
  it('duz frezede taban her yerde duzdur', () => {
    const t = tool({ type: 'flat' });
    expect(tipHeightAtRadius(t, 0)).toBe(0);
    expect(tipHeightAtRadius(t, 3)).toBe(0);
    expect(tipLength(t)).toBe(0);
  });

  it('kure uclu takimda uc yarim kuredir', () => {
    const t = tool({ type: 'ball', diameter: 6 });
    expect(tipHeightAtRadius(t, 0)).toBeCloseTo(0);
    // Kenarda yukseklik yaricapa esittir (yarim kure).
    expect(tipHeightAtRadius(t, 3)).toBeCloseTo(3);
    // Ara nokta kure denklemini saglamali.
    expect(tipHeightAtRadius(t, 1.5)).toBeCloseTo(3 - Math.sqrt(9 - 2.25));
  });

  it('kose radyuslu takimda merkez duz, kenar radyusludur', () => {
    const t = tool({ type: 'bull', diameter: 8, cornerRadius: 1 });
    expect(tipHeightAtRadius(t, 2)).toBe(0); // duz bolge (r <= 4-1)
    expect(tipHeightAtRadius(t, 4)).toBeCloseTo(1); // kenarda radyus kadar
  });

  it('matkapta uc konitir ve tepe acisi yuksekligi belirler', () => {
    const drill = tool({ type: 'drill', diameter: 6, angle: 118 });
    const half = (118 / 2) * (Math.PI / 180);
    expect(tipHeightAtRadius(drill, 3)).toBeCloseTo(3 / Math.tan(half));
    // Daha DAR aci daha uzun uc demektir: 90 derece punta matkabinin ucu,
    // 118 derece matkabinkinden uzundur.
    const spot = tool({ type: 'spot', diameter: 6, angle: 90 });
    expect(tipLength(spot)).toBeGreaterThan(tipLength(drill));
    expect(tipLength(spot)).toBeCloseTo(3);
    expect(tipLength(drill)).toBeCloseTo(3 / Math.tan(half));
  });

  it('havsa frezesinde ucun duz kismi hesaba katilir', () => {
    const t = tool({ type: 'chamfer', diameter: 10, angle: 90, tipDiameter: 2 });
    expect(tipHeightAtRadius(t, 1)).toBe(0); // duz uc (r <= 1)
    expect(tipHeightAtRadius(t, 5)).toBeCloseTo(4); // 90 derece => 1:1 egim
  });

  it('takim yaricapinin disinda malzemeye dokunmaz', () => {
    expect(tipHeightAtRadius(tool({ type: 'ball' }), 3.5)).toBe(Infinity);
    expect(toolRadius(tool({ diameter: 6 }))).toBeCloseTo(3);
  });

  it('gorsel profil ucdan kenara dogru artan yukseklik verir', () => {
    const points = profileSamples(tool({ type: 'ball', diameter: 6 }));
    expect(points[0]?.[1]).toBeCloseTo(0);
    expect(points[points.length - 1]?.[1]).toBeCloseTo(3);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]![1]).toBeGreaterThanOrEqual(points[i - 1]![1]);
    }
  });
});
