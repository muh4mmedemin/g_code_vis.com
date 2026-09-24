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

/**
 * Ilerleme (feed) modu:
 *  - perMinute    (G94, varsayilan): F = mm/dakika
 *  - inverseTime  (G93): F = 1/dakika, yani hareket 1/F dakikada tamamlanir
 *  - perRevolution(G95): F = mm/devir, sure is mili hizina baglidir
 */
export type FeedMode = 'perMinute' | 'inverseTime' | 'perRevolution';

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
 * Programlanan koordinatlari GERCEK (is koordinat sistemindeki) noktaya
 * ceviren modal donusum yigini.
 *
 * NEDEN: Fanuc/ISO kontrollerde parca, programin yazildigi yerden baska bir
 * yerde/olcude/yonde islenebilir:
 *   G52  yerel koordinat kaymasi (ayni parcayi baska bir noktada islemek)
 *   G68  koordinat dondurme (ayni cebi 30 derece donuk acmak)
 *   G51  olcekleme (ayni programi %98 kuculterek islemek)
 *   G51.1 programlanabilir ayna (ERKEK parcadan DISI parca cikarmak)
 * Bunlar yok sayilirsa program hatasiz "parse" edilir ama SIMULASYONDAN
 * BASKA BIR PARCA cikar. Donusum tek noktada (emitMove) uygulanir; boylece
 * yaylar, delme cevrimleri ve modal hareketler otomatik olarak kapsanir.
 */
export interface CoordTransform {
  /** G52 yerel koordinat sistemi kaymasi (mm). */
  offset: Vec3;
  /** G51 olcek carpani (1 = kapali). Negatif deger ayna etkisi yapar. */
  scale: Vec3;
  /** G51'de verilen olcekleme merkezi (mm). */
  scaleCenter: Vec3;
  /** G51.1 ayna: eksen basina 1 veya -1. */
  mirror: Vec3;
  /** G51.1'de verilen ayna ekseni merkezi (mm). */
  mirrorCenter: Vec3;
  /** G68 dondurme acisi (derece, saat yonunun tersi). 0 = kapali. */
  rotationDeg: number;
  /** G68 dondurme merkezi (mm). */
  rotationCenter: Vec3;
  /** Dondurmenin yapildigi duzlem (G68 verildigi andaki G17/G18/G19). */
  rotationPlane: ArcPlane;
}

export function createIdentityTransform(): CoordTransform {
  return {
    offset: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    scaleCenter: { x: 0, y: 0, z: 0 },
    mirror: { x: 1, y: 1, z: 1 },
    mirrorCenter: { x: 0, y: 0, z: 0 },
    rotationDeg: 0,
    rotationCenter: { x: 0, y: 0, z: 0 },
    rotationPlane: 'XY',
  };
}

/** Donusum hicbir sey yapmiyor mu? (sicak yolda gereksiz hesabi atlamak icin) */
export function isIdentityTransform(t: CoordTransform): boolean {
  return (
    t.offset.x === 0 && t.offset.y === 0 && t.offset.z === 0 &&
    t.scale.x === 1 && t.scale.y === 1 && t.scale.z === 1 &&
    t.mirror.x === 1 && t.mirror.y === 1 && t.mirror.z === 1 &&
    t.rotationDeg === 0
  );
}

/**
 * Programlanan noktayi gercek konuma cevirir.
 *
 * Sira (Fanuc): ayna -> olcekleme -> dondurme -> yerel kayma (G52).
 */
export function applyTransform(t: CoordTransform, p: Vec3): Vec3 {
  let { x, y, z } = p;

  if (t.mirror.x < 0) x = 2 * t.mirrorCenter.x - x;
  if (t.mirror.y < 0) y = 2 * t.mirrorCenter.y - y;
  if (t.mirror.z < 0) z = 2 * t.mirrorCenter.z - z;

  x = t.scaleCenter.x + (x - t.scaleCenter.x) * t.scale.x;
  y = t.scaleCenter.y + (y - t.scaleCenter.y) * t.scale.y;
  z = t.scaleCenter.z + (z - t.scaleCenter.z) * t.scale.z;

  if (t.rotationDeg !== 0) {
    const rad = (t.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // Dondurme aktif duzlemde yapilir; ucuncu eksen degismez.
    const [ax, ay]: [number, number] =
      t.rotationPlane === 'XY' ? [x - t.rotationCenter.x, y - t.rotationCenter.y]
      : t.rotationPlane === 'XZ' ? [z - t.rotationCenter.z, x - t.rotationCenter.x]
      : [y - t.rotationCenter.y, z - t.rotationCenter.z];
    const rx = ax * cos - ay * sin;
    const ry = ax * sin + ay * cos;
    if (t.rotationPlane === 'XY') {
      x = t.rotationCenter.x + rx;
      y = t.rotationCenter.y + ry;
    } else if (t.rotationPlane === 'XZ') {
      z = t.rotationCenter.z + rx;
      x = t.rotationCenter.x + ry;
    } else {
      y = t.rotationCenter.y + rx;
      z = t.rotationCenter.z + ry;
    }
  }

  return { x: x + t.offset.x, y: y + t.offset.y, z: z + t.offset.z };
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
  /** G93/G94/G95 — F degerinin nasil yorumlanacagi. */
  feedMode: FeedMode;
  /** M3/M4'teki S degeri (dev/dk) — G95 suresi icin gerekir. */
  spindleRpm: number;
  /** Aktif delme cevrimi (G80 ile temizlenir). */
  cannedCycle: CannedCycleState | null;
  /** G52/G68/G51/G51.1 donusum yigini (bkz. CoordTransform). */
  transform: CoordTransform;
  /**
   * Donusum her degistiginde artan sayac.
   *
   * NEDEN: G52/G68/G51 degistiginde takim YERINDE durur ama programlanan ayni
   * koordinat artik baska bir noktaya karsilik gelir. Bir sonraki hareket bu
   * yuzden ESKI gercek noktadan baslamalidir; aksi halde yol sessizce
   * sicrar. (G92 farklidir: orada koordinat sistemi degil, sayac degismez.)
   */
  transformVersion: number;
  /** Son uretilen hareketin gercek bitis noktasi (donusum uygulanmis). */
  lastRealPosition: Vec3 | null;
  /** lastRealPosition uretilirken gecerli olan donusum surumu. */
  lastRealVersion: number;
  /**
   * Aktif kesici yaricap telafisi: G41 (solda) / G42 (sagda) / null (G40).
   * Yol kaydirmasi parse sonunda tek seferde uygulanir (bkz. cutterComp.ts).
   */
  cutterComp: 'left' | 'right' | null;
  /** Aktif telafi numarasi (D sozcugu). */
  cutterCompD: number | null;
  /** G10 L12/L13 ile programda tanimlanan yaricap tablosu (D no -> mm). */
  radiusOffsets: Map<number, number>;
  /**
   * Bu SATIR icin G53 (makine koordinati) gecerli mi?
   *
   * G53 modal degildir; yalnizca yazildigi blokta gecerlidir. Ayni satirdaki
   * hareket komutu bunu okuyup makine koordinatli hareketi is koordinatina
   * gore cizmemek icin kullanir (bkz. commands.ts / referenceRetract).
   */
  machineCoordBlock: boolean;
  /**
   * Program boyunca ulasilan en yuksek Z (mm).
   *
   * G28/G30/G53 referans donuslerinde takimin nereye gittigini dosyadan
   * bilemeyiz (makine sifiri bize kapali). Bilinen tek guvenli yukseklik
   * programin kendi kullandigi en yuksek Z'dir; referans donusu bu seviyeye
   * cikis olarak cizilir.
   */
  maxZ: number;

  // --- Yalnizca tani (diagnostic) uretimi icin izlenen bayraklar ----------
  /** G20/G21 goruldu mu? */
  unitsDeclared: boolean;
  /** G90/G91 goruldu mu? */
  positioningDeclared: boolean;
  /** G53 uyarisi verildi mi? (satir basina degil, dosya basina bir kez) */
  machineCoordReported: boolean;
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
    feedMode: 'perMinute',
    spindleRpm: 0,
    cannedCycle: null,
    transform: createIdentityTransform(),
    transformVersion: 0,
    lastRealPosition: null,
    lastRealVersion: 0,
    cutterComp: null,
    cutterCompD: null,
    radiusOffsets: new Map(),
    machineCoordBlock: false,
    maxZ: 0,
    unitsDeclared: false,
    positioningDeclared: false,
    machineCoordReported: false,
    spindleOn: false,
    spindleOffCutLine: null,
  };
}

/**
 * Bir hareketin suresi (saniye) — aktif feed moduna gore.
 *
 * G93'te F, hareketin kendisini tanimlar: hareket 1/F dakikada biter, mesafe
 * hesaba girmez. G95'te F mm/devir'dir, dolayisiyla is mili hizi bilinmeden
 * sure hesaplanamaz.
 */
export function feedDuration(state: MachineState, distanceMm: number): number {
  if (state.feedMode === 'inverseTime') {
    return state.feedrate > 0 ? 60 / state.feedrate : 0;
  }
  if (state.feedMode === 'perRevolution') {
    const mmPerMin = state.feedrate * state.spindleRpm;
    return mmPerMin > 0 ? (distanceMm / mmPerMin) * 60 : 0;
  }
  if (state.feedrate <= 0) return 0;
  return (distanceMm / state.feedrate) * 60;
}

/** Girilen deger birim moduna gore mm'ye cevrilir. */
export function toMillimeters(value: number, unit: Unit): number {
  return unit === 'inch' ? value * MM_PER_INCH : value;
}
