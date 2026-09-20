import type { ToolDefinition } from '@/core/types';

/**
 * Takim ucu profili — simulasyonun "takim nasil bir sey" bilgisi tek yerde.
 *
 * FIKIR: Bir takimi, ucundan yukari dogru yaricapi degisen bir donel yuzey
 * olarak dusunuruz. Iki yonde de kullanilabilen tek bir fonksiyon yeter:
 *
 *   tipHeightAtRadius(d) -> ucun ekseninden d kadar uzakta, takim yuzeyi
 *                           uc noktasindan KAC MM YUKARIDADIR
 *
 * Duz frezede bu her yerde 0'dir (duz taban). Kure uclu takimda kure
 * yuzeyini, matkapta/V uclu takimda koniyi verir. Oyma (carver) ve ekrandaki
 * takim gorseli AYNI fonksiyonu kullanir; boylece gordugunuz uc ile kesen uc
 * birbirinden ayrilamaz.
 */

/** Koni acisindan (tepe acisi, derece) yaricap basina yukseklik katsayisi. */
function coneSlope(includedAngleDeg: number): number {
  const half = (Math.max(1, Math.min(179, includedAngleDeg)) / 2) * (Math.PI / 180);
  const tan = Math.tan(half);
  // tan(half) = yaricap / yukseklik  =>  yukseklik = yaricap / tan(half)
  return tan > 1e-6 ? 1 / tan : 0;
}

/** Takimin efektif yaricapi (mm). */
export function toolRadius(tool: ToolDefinition): number {
  return Math.max(tool.diameter / 2, 1e-6);
}

/**
 * Eksenden `distance` mm uzakta, takim yuzeyinin uc noktasina gore
 * yuksekligi (mm). Takim yaricapi disinda Infinity doner (malzemeye dokunmaz).
 */
export function tipHeightAtRadius(tool: ToolDefinition, distance: number): number {
  const radius = toolRadius(tool);
  const d = Math.abs(distance);
  if (d > radius) return Infinity;

  switch (tool.type) {
    case 'ball': {
      // Yarim kure: uc, kurenin en alt noktasidir.
      const inside = Math.max(0, radius * radius - d * d);
      return radius - Math.sqrt(inside);
    }
    case 'bull': {
      // Kose radyuslu: merkezde duz taban, kenarda radyus.
      const corner = Math.max(0, Math.min(tool.cornerRadius ?? 0, radius));
      const flat = radius - corner;
      if (d <= flat || corner === 0) return 0;
      const dx = d - flat;
      const inside = Math.max(0, corner * corner - dx * dx);
      return corner - Math.sqrt(inside);
    }
    case 'vbit':
    case 'drill':
    case 'spot': {
      // Sivri koni: uc tam merkezde.
      return d * coneSlope(tool.angle ?? 118);
    }
    case 'chamfer': {
      // Havsa/pah frezesi: ucta kucuk bir duz alan, sonra koni.
      const tipRadius = Math.max(0, Math.min((tool.tipDiameter ?? 0) / 2, radius));
      if (d <= tipRadius) return 0;
      return (d - tipRadius) * coneSlope(tool.angle ?? 90);
    }
    case 'flat':
    case 'reamer':
    case 'tap':
    default:
      return 0;
  }
}

/** Ucun en alt noktasindan silindirik sapa kadar olan yukseklik (mm). */
export function tipLength(tool: ToolDefinition): number {
  const radius = toolRadius(tool);
  const atEdge = tipHeightAtRadius(tool, radius);
  return Number.isFinite(atEdge) ? atEdge : 0;
}

/**
 * Takim profilinin donel kesiti: [yaricap, yukseklik] ciftleri, ucdan
 * kenara dogru. Gorsel (LatheGeometry) icin kullanilir.
 */
export function profileSamples(tool: ToolDefinition, steps = 16): Array<[number, number]> {
  const radius = toolRadius(tool);
  const points: Array<[number, number]> = [];
  const curved = tool.type === 'ball' || tool.type === 'bull';
  const count = curved ? Math.max(4, steps) : 2;

  for (let i = 0; i <= count; i++) {
    const d = (radius * i) / count;
    const h = tipHeightAtRadius(tool, d);
    points.push([d, Number.isFinite(h) ? h : 0]);
  }
  return points;
}
