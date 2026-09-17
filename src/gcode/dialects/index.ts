/**
 * Slicer/dialect katmani.
 *
 * Farkli slicer'lar katman sinirini yorum satirinda farkli yazar:
 *   Cura         -> ";LAYER:12"
 *   PrusaSlicer  -> ";LAYER_CHANGE" + ";Z:0.4"
 *   Simplify3D   -> "; layer 12, Z = 0.4"
 *   Bambu/Orca   -> "; CHANGE_LAYER" + "; Z_HEIGHT: 0.4"
 * CNC dosyalarinda katman kavrami yoktur; Z degisimi ile turetilir.
 *
 * Bu ipuclari, Z degisimine dayali tahminden DAHA guvenilirdir: Z-hop,
 * ironing ve degisken katman yuksekligi gibi durumlarda dogru sonucu verir.
 */
export interface LayerHint {
  /** Varsa slicer'in bildirdigi katman indeksi. */
  layerIndex?: number;
  /** Varsa katmanin Z yuksekligi (mm). */
  z?: number;
}

export interface Dialect {
  name: string;
  /** Dosyanin ilk N satirina bakarak bu dialect mi diye karar verir. */
  detect(headLines: string[]): boolean;
  /** Yorum satirindan katman degisimi cikarir; degilse null. */
  parseLayerHint(comment: string): LayerHint | null;
}

const CURA: Dialect = {
  name: 'cura',
  detect: (headLines) =>
    headLines.some((l) => /generated\s+with\s+cura/i.test(l) || /^;LAYER_COUNT:/i.test(l.trim())),
  parseLayerHint: (comment) => {
    const match = /^LAYER:\s*(-?\d+)/i.exec(comment.trim());
    if (!match) return null;
    const index = Number(match[1]);
    // Cura, skirt/brim icin ";LAYER:-1" gibi negatif degerler yazabilir.
    return { layerIndex: Math.max(0, index) };
  },
};

const PRUSA: Dialect = {
  name: 'prusaslicer',
  detect: (headLines) =>
    headLines.some((l) => /generated\s+by\s+(prusaslicer|slic3r|superslicer)/i.test(l)),
  parseLayerHint: (comment) => {
    const trimmed = comment.trim();
    if (/^LAYER_CHANGE$/i.test(trimmed)) return {};
    const z = /^Z:\s*(-?\d+\.?\d*)/i.exec(trimmed);
    if (z) return { z: Number(z[1]) };
    return null;
  },
};

const SIMPLIFY3D: Dialect = {
  name: 'simplify3d',
  detect: (headLines) => headLines.some((l) => /simplify3d/i.test(l)),
  parseLayerHint: (comment) => {
    const match = /^layer\s+(\d+)\s*,\s*Z\s*=\s*(-?\d+\.?\d*)/i.exec(comment.trim());
    if (!match) return null;
    return { layerIndex: Math.max(0, Number(match[1]) - 1), z: Number(match[2]) };
  },
};

const BAMBU: Dialect = {
  name: 'bambustudio',
  detect: (headLines) =>
    headLines.some((l) => /generated\s+by\s+(bambustudio|orcaslicer)/i.test(l)),
  parseLayerHint: (comment) => {
    const trimmed = comment.trim();
    if (/^CHANGE_LAYER$/i.test(trimmed)) return {};
    const z = /^Z_HEIGHT:\s*(-?\d+\.?\d*)/i.exec(trimmed);
    if (z) return { z: Number(z[1]) };
    return null;
  },
};

export const DIALECTS: Dialect[] = [CURA, PRUSA, BAMBU, SIMPLIFY3D];

/** Hicbiri eslesmezse kullanilacak fallback (sadece Z degisimine bakar). */
export const GENERIC_DIALECT_NAME = 'generic';

/** Dialect tespitinde taranacak bas satir sayisi. */
export const DIALECT_SNIFF_LINES = 200;

export function detectDialect(headLines: string[]): Dialect | null {
  // 1) Uretici imzasi (en guvenilir).
  const bySignature = DIALECTS.find((d) => d.detect(headLines));
  if (bySignature) return bySignature;

  // 2) Imza yoksa katman yorumu bicimine bak (imzasiz/kirpilmis dosyalar icin).
  for (const line of headLines) {
    const semi = line.indexOf(';');
    if (semi < 0) continue;
    const comment = line.slice(semi + 1);
    for (const dialect of DIALECTS) {
      if (dialect.parseLayerHint(comment)) return dialect;
    }
  }

  return null;
}
