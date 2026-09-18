import type { Vec3 } from '@/core/types';
import type { ArcPlane } from './machineState';

/**
 * Yay (G2/G3) segmentlestirme yardimcilari.
 *
 * G-code'da yay iki sekilde tanimlanir:
 *  - I/J/K: merkez ofseti (baslangic noktasina GORE, firmware'lerin cogunda)
 *  - R    : yaricap; iki olasi merkezden birini secer (R<0 => uzun yay)
 *
 * Yaylar, viewer'in tek bir cizgi/kutu boru hattini kullanabilmesi icin
 * kucuk dogru parcalarina bolunur.
 */

/** Bir segmentin sapmasinin (sagitta) asmamasi gereken deger (mm). */
const CHORD_TOLERANCE = 0.02;
/** Segment basina izin verilen en buyuk aci (radyan). */
const MAX_SEGMENT_ANGLE = Math.PI / 12; // 15 derece
const MIN_SEGMENTS = 1;
const MAX_SEGMENTS = 2000;

export interface ArcSpec {
  from: Vec3;
  to: Vec3;
  plane: ArcPlane;
  clockwise: boolean;
  /** Merkez ofseti (baslangica gore, mm). R kullanildiysa undefined. */
  offset?: { i?: number; j?: number; k?: number };
  /**
   * I/J/K'nin anlami: 'incremental' (G91.1, varsayilan) baslangica gore ofset,
   * 'absolute' (G90.1) merkezin mutlak koordinati.
   */
  offsetMode?: 'incremental' | 'absolute';
  /** Yaricap formu (mm). Negatif ise 180 dereceden buyuk yay secilir. */
  radius?: number;
}

export interface ArcResult {
  /** Baslangictan sonraki ara noktalar + bitis noktasi. */
  points: Vec3[];
  /** Yayin yaklasik uzunlugu (mm, helis yuksekligi dahil). */
  length: number;
  /** Merkezin baslangic noktasina uzakligi (mm). */
  radiusStart: number;
  /**
   * Merkezin bitis noktasina uzakligi (mm).
   *
   * Saglikli bir yayda radiusStart ile esittir. Elle yazilmis G-code'da I/J
   * degerleri tutmadiginda ikisi ayrisir; kontrol uniteleri bu durumda alarm
   * verir, biz uyari uretiriz (bkz. commands.ts / ARC_RADIUS_MISMATCH).
   */
  radiusEnd: number;
}

/** Duzleme gore (eksen1, eksen2, dik eksen) uclusu. */
function planeAxes(plane: ArcPlane): ['x' | 'y' | 'z', 'x' | 'y' | 'z', 'x' | 'y' | 'z'] {
  if (plane === 'XZ') return ['x', 'z', 'y'];
  if (plane === 'YZ') return ['y', 'z', 'x'];
  return ['x', 'y', 'z'];
}

/** Ofset harfini duzlem eksenine esler: XY -> I,J / XZ -> I,K / YZ -> J,K. */
function planeOffsets(
  plane: ArcPlane,
  offset: { i?: number; j?: number; k?: number },
): [number, number] {
  if (plane === 'XZ') return [offset.i ?? 0, offset.k ?? 0];
  if (plane === 'YZ') return [offset.j ?? 0, offset.k ?? 0];
  return [offset.i ?? 0, offset.j ?? 0];
}

/**
 * Yayi dogru parcalarina boler.
 * Gecersiz tanimlarda (sifir yaricap, R yayina sigmayan mesafe vb.) null doner;
 * cagiran taraf bu durumda hareketi duz cizgi olarak isleyebilir.
 */
export function segmentArc(spec: ArcSpec): ArcResult | null {
  const [a1, a2, aPerp] = planeAxes(spec.plane);

  const startU = spec.from[a1];
  const startV = spec.from[a2];
  const endU = spec.to[a1];
  const endV = spec.to[a2];

  let centerU: number;
  let centerV: number;

  if (spec.offset && (spec.offset.i !== undefined || spec.offset.j !== undefined || spec.offset.k !== undefined)) {
    const [offU, offV] = planeOffsets(spec.plane, spec.offset);
    if (spec.offsetMode === 'absolute') {
      // G90.1: I/J/K dogrudan merkezin mutlak koordinatlaridir.
      centerU = offU;
      centerV = offV;
    } else {
      centerU = startU + offU;
      centerV = startV + offV;
    }
  } else if (spec.radius !== undefined && spec.radius !== 0) {
    const r = spec.radius;
    const du = endU - startU;
    const dv = endV - startV;
    const chord = Math.hypot(du, dv);
    if (chord === 0) return null; // R formunda tam cember tanimlanamaz
    const halfChord = chord / 2;
    const discriminant = r * r - halfChord * halfChord;
    if (discriminant < 0) return null; // yaricap mesafeye yetmiyor
    const height = Math.sqrt(discriminant);
    const midU = (startU + endU) / 2;
    const midV = (startV + endV) / 2;
    // Kirise dik birim vektor.
    const perpU = -dv / chord;
    const perpV = du / chord;
    // R>0 kisa yay, R<0 uzun yay; saat yonu ile birlikte merkez tarafini belirler.
    const sign = spec.clockwise === r > 0 ? -1 : 1;
    centerU = midU + sign * height * perpU;
    centerV = midV + sign * height * perpV;
  } else {
    return null;
  }

  const radiusStart = Math.hypot(startU - centerU, startV - centerV);
  if (!Number.isFinite(radiusStart) || radiusStart < 1e-9) return null;

  let startAngle = Math.atan2(startV - centerV, startU - centerU);
  let endAngle = Math.atan2(endV - centerV, endU - centerU);

  // Tam cember: baslangic ve bitis ayni nokta ve I/J verilmis.
  const sameStartEnd =
    Math.abs(startU - endU) < 1e-9 && Math.abs(startV - endV) < 1e-9 && spec.offset !== undefined;

  let sweep = endAngle - startAngle;
  if (spec.clockwise) {
    while (sweep >= 0) sweep -= 2 * Math.PI;
    if (sameStartEnd) sweep = -2 * Math.PI;
  } else {
    while (sweep <= 0) sweep += 2 * Math.PI;
    if (sameStartEnd) sweep = 2 * Math.PI;
  }

  const absSweep = Math.abs(sweep);

  // Segment sayisi: hem acidan hem kiris toleransindan gelen ihtiyacin buyugu.
  const angleForTolerance = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - CHORD_TOLERANCE / radiusStart)));
  const stepAngle = Math.max(1e-3, Math.min(MAX_SEGMENT_ANGLE, angleForTolerance));
  const segments = Math.max(
    MIN_SEGMENTS,
    Math.min(MAX_SEGMENTS, Math.ceil(absSweep / stepAngle)),
  );

  const perpStart = spec.from[aPerp];
  const perpDelta = spec.to[aPerp] - perpStart;

  const points: Vec3[] = [];
  for (let n = 1; n <= segments; n++) {
    const t = n / segments;
    const angle = startAngle + sweep * t;
    const point = { x: 0, y: 0, z: 0 } as Vec3;
    point[a1] = centerU + radiusStart * Math.cos(angle);
    point[a2] = centerV + radiusStart * Math.sin(angle);
    point[aPerp] = perpStart + perpDelta * t;
    points.push(point);
  }

  // Son noktayi tam olarak hedefe sabitle (yuvarlama kaymasini onler).
  const last = points[points.length - 1];
  if (last && !sameStartEnd) {
    last.x = spec.to.x;
    last.y = spec.to.y;
    last.z = spec.to.z;
  }

  const arcLength = Math.hypot(absSweep * radiusStart, perpDelta);
  const radiusEnd = Math.hypot(endU - centerU, endV - centerV);

  return { points, length: arcLength, radiusStart, radiusEnd };
}

export { CHORD_TOLERANCE, MAX_SEGMENT_ANGLE };
