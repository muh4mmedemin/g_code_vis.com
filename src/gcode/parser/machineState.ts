import type { PositioningMode, Unit, Vec3 } from '@/core/types';
import { MM_PER_INCH } from '@/core/constants';

/** Yay (G2/G3) komutlarinin calistigi duzlem: G17/G18/G19. */
export type ArcPlane = 'XY' | 'XZ' | 'YZ';

/**
 * Parser'in modal (kalici) durumu. Her satir bu durumu okur ve/veya gunceller.
 * Yeni modal komut destegi eklemek = buraya alan eklemek + commands.ts altina
 * bir handler yazmak.
 */
export interface MachineState {
  position: Vec3;
  /** Mutlak E degeri (mm). */
  e: number;
  feedrate: number;
  positioning: PositioningMode;
  /** E ekseni bagimsiz olarak relative olabilir (M83/M82). */
  ePositioning: PositioningMode;
  /**
   * M82/M83 ile E modu ACIKCA ayarlandi mi?
   * Ayarlanmadiysa G90/G91 E eksenini de etkiler (Marlin/RRF davranisi).
   */
  eModeExplicit: boolean;
  unit: Unit;
  /** Aktif takim/extruder indeksi (T komutu). */
  tool: number;
  /** Aktif yay duzlemi (G17/G18/G19). */
  plane: ArcPlane;
  /** G4 ile biriken toplam bekleme suresi (saniye). */
  dwellSeconds: number;
}

export function createInitialState(): MachineState {
  return {
    position: { x: 0, y: 0, z: 0 },
    e: 0,
    feedrate: 0,
    positioning: 'absolute',
    ePositioning: 'absolute',
    eModeExplicit: false,
    unit: 'mm',
    tool: 0,
    plane: 'XY',
    dwellSeconds: 0,
  };
}

/** Girilen deger birim moduna gore mm'ye cevrilir. */
export function toMillimeters(value: number, unit: Unit): number {
  return unit === 'inch' ? value * MM_PER_INCH : value;
}
