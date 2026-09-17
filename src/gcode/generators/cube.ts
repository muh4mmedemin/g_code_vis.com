/**
 * Parametrik CNC is parcasi ureticileri.
 *
 * Amac: kullanicinin elinde hazir bir G-code dosyasi olmadan, sadece olcu
 * girerek bir parca programi uretip gorsellestirebilmesi.
 */

export interface CubeJobOptions {
  /** Parcanin X boyutu (mm). */
  width: number;
  /** Parcanin Y boyutu (mm). */
  depth: number;
  /** Kesim derinligi = parcanin Z yuksekligi (mm). */
  height: number;
  /** Kesici takim capi (mm). */
  toolDiameter: number;
  /** Paso basina inilen derinlik (mm). */
  stepDown: number;
  /** Kesim ilerlemesi (mm/dk). */
  feedRate: number;
  /** Dalma (Z) ilerlemesi (mm/dk). */
  plungeRate: number;
  /** Guvenli yukseklik (mm, stok ustunde). */
  safeZ: number;
}

export const DEFAULT_CUBE_JOB: CubeJobOptions = {
  width: 40,
  depth: 40,
  height: 20,
  toolDiameter: 6,
  stepDown: 2,
  feedRate: 800,
  plungeRate: 300,
  safeZ: 5,
};

/** Sinir degerler — UI'da da ayni araliklar kullanilir. */
export const CUBE_JOB_LIMITS = {
  width: { min: 1, max: 500 },
  depth: { min: 1, max: 500 },
  height: { min: 0.1, max: 200 },
  toolDiameter: { min: 0.1, max: 50 },
  stepDown: { min: 0.1, max: 50 },
  feedRate: { min: 1, max: 20000 },
  plungeRate: { min: 1, max: 20000 },
  safeZ: { min: 0.1, max: 100 },
} as const;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Girdileri guvenli araliklara cekip normalize eder. */
export function normalizeCubeJob(options: Partial<CubeJobOptions>): CubeJobOptions {
  const merged = { ...DEFAULT_CUBE_JOB, ...options };
  return {
    width: clamp(merged.width, CUBE_JOB_LIMITS.width.min, CUBE_JOB_LIMITS.width.max),
    depth: clamp(merged.depth, CUBE_JOB_LIMITS.depth.min, CUBE_JOB_LIMITS.depth.max),
    height: clamp(merged.height, CUBE_JOB_LIMITS.height.min, CUBE_JOB_LIMITS.height.max),
    toolDiameter: clamp(
      merged.toolDiameter,
      CUBE_JOB_LIMITS.toolDiameter.min,
      CUBE_JOB_LIMITS.toolDiameter.max,
    ),
    stepDown: clamp(merged.stepDown, CUBE_JOB_LIMITS.stepDown.min, CUBE_JOB_LIMITS.stepDown.max),
    feedRate: clamp(merged.feedRate, CUBE_JOB_LIMITS.feedRate.min, CUBE_JOB_LIMITS.feedRate.max),
    plungeRate: clamp(
      merged.plungeRate,
      CUBE_JOB_LIMITS.plungeRate.min,
      CUBE_JOB_LIMITS.plungeRate.max,
    ),
    safeZ: clamp(merged.safeZ, CUBE_JOB_LIMITS.safeZ.min, CUBE_JOB_LIMITS.safeZ.max),
  };
}

const f3 = (n: number) => n.toFixed(3);

/**
 * Dikdortgen prizma (kup) bir is parcasini stoktan cikaran kontur (profil)
 * programi uretir.
 *
 * Parca XY duzleminde ORIGIN'de merkezlenir; stokun ust yuzeyi Z=0 kabul
 * edilir ve kesim asagi dogru (negatif Z) ilerler — CNC'nin standart
 * kabulu budur.
 *
 * Takim yolu, bitmis parca olculeri tam istenen degerler olsun diye parca
 * sinirindan takim YARICAPI kadar DISARI otelenir.
 */
export function generateCubeGcode(input: Partial<CubeJobOptions> = {}): string {
  const o = normalizeCubeJob(input);
  const radius = o.toolDiameter / 2;

  // Kontur, parca sinirindan takim yaricapi kadar disarida gezer.
  const x0 = -o.width / 2 - radius;
  const x1 = o.width / 2 + radius;
  const y0 = -o.depth / 2 - radius;
  const y1 = o.depth / 2 + radius;

  const passCount = Math.max(1, Math.ceil(o.height / o.stepDown));

  const lines: string[] = [
    `; Kup is parcasi — ${f3(o.width)} x ${f3(o.depth)} x ${f3(o.height)} mm`,
    `; Takim capi ${f3(o.toolDiameter)} mm, paso derinligi ${f3(o.stepDown)} mm (${passCount} paso)`,
    '; Kontur, bitmis olcu tam cikacak sekilde takim yaricapi kadar disari otelendi.',
    '; Stokun ust yuzeyi Z=0; kesim asagi (negatif Z) yonunde ilerler.',
    'G21', // mm
    'G90', // mutlak
    'G17', // XY duzlemi
    `G0 Z${f3(o.safeZ)}`,
    `G0 X${f3(x0)} Y${f3(y0)}`,
  ];

  for (let pass = 1; pass <= passCount; pass++) {
    const z = -Math.min(o.height, pass * o.stepDown);
    lines.push(`; --- paso ${pass}/${passCount} (Z${f3(z)}) ---`);
    lines.push(`G1 Z${f3(z)} F${f3(o.plungeRate)}`);
    lines.push(`G1 X${f3(x1)} Y${f3(y0)} F${f3(o.feedRate)}`);
    lines.push(`G1 X${f3(x1)} Y${f3(y1)}`);
    lines.push(`G1 X${f3(x0)} Y${f3(y1)}`);
    lines.push(`G1 X${f3(x0)} Y${f3(y0)}`);
  }

  lines.push(`G0 Z${f3(o.safeZ)}`, 'G0 X0 Y0', 'M30');

  return lines.join('\n') + '\n';
}
