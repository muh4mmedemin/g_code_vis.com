import type { PositioningMode, Unit, Vec3 } from '@/core/types';
import { MM_PER_INCH } from '@/core/constants';

/**
 * Parser'in modal (kalici) durumu. Her satir bu durumu okur ve/veya gunceller.
 * Yeni modal komut destegi eklemek = buraya alan eklemek + commands/ altina
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
  unit: Unit;
  /** Aktif takim/extruder indeksi (T komutu). */
  tool: number;
  /** G92 ile uygulanan offset. */
  offset: Vec3;
  currentLayer: number;
  /** Aktif katmanin Z degeri. */
  layerZ: number;
  /** Ilk hareketten once false; ilk katmanin lazy baslatilmasi icin. */
  hasLayer: boolean;
}

export function createInitialState(): MachineState {
  return {
    position: { x: 0, y: 0, z: 0 },
    e: 0,
    feedrate: 0,
    positioning: 'absolute',
    ePositioning: 'absolute',
    unit: 'mm',
    tool: 0,
    offset: { x: 0, y: 0, z: 0 },
    currentLayer: 0,
    layerZ: 0,
    hasLayer: false,
  };
}

/** Girilen deger birim moduna gore mm'ye cevrilir. */
export function toMillimeters(value: number, unit: Unit): number {
  return unit === 'inch' ? value * MM_PER_INCH : value;
}
