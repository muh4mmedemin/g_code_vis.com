/**
 * Slicer/dialect katmani.
 *
 * Farkli slicer'lar katman sinirini yorum satirinda farkli yazar:
 *   Cura         -> ";LAYER:12"
 *   PrusaSlicer  -> ";LAYER_CHANGE" + ";Z:0.4"
 *   Simplify3D   -> "; layer 12, Z = 0.4"
 *   Bambu Studio -> "; CHANGE_LAYER" / "; Z_HEIGHT: 0.4"
 * CNC dosyalarinda katman kavrami yoktur; Z degisimi ile turetilir.
 */
export interface Dialect {
  name: string;
  /** Dosyanin ilk N satirina bakarak bu dialect mi diye karar verir. */
  detect(headLines: string[]): boolean;
  /** Yorum satirindan katman degisimi cikarir; degilse null. */
  parseLayerHint(comment: string): { layerIndex?: number; z?: number } | null;
}

export const DIALECTS: Dialect[] = [
  // TODO(sonnet): cura.ts, prusa.ts, simplify3d.ts, bambu.ts, generic.ts
];

/** Hicbiri eslesmezse kullanilacak fallback (sadece Z degisimine bakar). */
export const GENERIC_DIALECT_NAME = 'generic';

export function detectDialect(_headLines: string[]): Dialect | null {
  throw new Error('NOT_IMPLEMENTED: detectDialect');
}
