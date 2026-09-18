import type { PositioningMode, Unit, Vec3 } from '@/core/types';
import { MM_PER_INCH } from '@/core/constants';

/** Yay (G2/G3) komutlarinin calistigi duzlem: G17/G18/G19. */
export type ArcPlane = 'XY' | 'XZ' | 'YZ';

/**
 * Yay merkezinin nasil verildigi:
 *  - incremental (G91.1, varsayilan): I/J/K baslangic noktasina GORE ofset
 *  - absolute    (G90.1): I/J/K merkezin MUTLAK koordinatlari
 */
export type ArcDistanceMode = 'incremental' | 'absolute';

/** Delme cevriminden (G81/G83...) sonra donulecek Z duzlemi: G98/G99. */
export type RetractMode = 'initial' | 'rPlane';

/** Aktif delme/delik cevrimi (canned cycle) modal durumu. */
export interface CannedCycleState {
  /** Cevrim komutu: 'G81' | 'G82' | 'G83' | 'G73' | 'G85' | 'G86' | 'G89' */
  command: string;
  /** Delik dibi (mutlak Z, mm). */
  z: number;
  /** R duzlemi (mutlak Z, mm) — hizli inisin bittigi, kesmenin basladigi yer. */
  r: number;
  /** Gagalama adimi (G83/G73, mm). */
  q: number;
  /** Dipte bekleme (G82/G89, saniye). */
  dwell: number;
  /** Cevrim baslamadan onceki Z — G98'de buraya donulur. */
  initialZ: number;
}

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

  /**
   * Son hareket komutu (G0/G1/G2/G3 veya bir delme cevrimi).
   *
   * NEDEN: G-code'da hareket komutu MODAL'dir. Gercek CNC programlarinda
   * "G1 X10 Y10" satirindan sonra gelen satirlar cogu zaman komut sozcugu
   * icermez: "X20 Y30", "X40". Bu alan olmadan o satirlar sessizce yok
   * sayilir ve takim yolunun buyuk bolumu kaybolur.
   */
  motionMode: string | null;
  /** I/J/K'nin ofset mi mutlak mi oldugu (G91.1 / G90.1). */
  arcDistanceMode: ArcDistanceMode;
  /** G98/G99 — delme cevrimi sonrasi donulecek duzlem. */
  retractMode: RetractMode;
  /** Aktif delme cevrimi (G80 ile temizlenir). */
  cannedCycle: CannedCycleState | null;

  // --- Yalnizca tani (diagnostic) uretimi icin izlenen bayraklar ----------
  /** G20/G21 goruldu mu? */
  unitsDeclared: boolean;
  /** G90/G91 goruldu mu? */
  positioningDeclared: boolean;
  /** M3/M4 ile is mili calistirildi mi? */
  spindleOn: boolean;
  /**
   * Is mili DURURKEN yapilan ilk kesme hareketinin satiri.
   *
   * Program sonundaki M5 bayragi tekrar kapattigi icin "spindleOn"in son
   * degerine bakmak yaniltir; bu alan hareketin YAPILDIGI andaki durumu
   * kaydeder.
   */
  spindleOffCutLine: number | null;
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
    motionMode: null,
    arcDistanceMode: 'incremental',
    retractMode: 'initial',
    cannedCycle: null,
    unitsDeclared: false,
    positioningDeclared: false,
    spindleOn: false,
    spindleOffCutLine: null,
  };
}

/** Girilen deger birim moduna gore mm'ye cevrilir. */
export function toMillimeters(value: number, unit: Unit): number {
  return unit === 'inch' ? value * MM_PER_INCH : value;
}
