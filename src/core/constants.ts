import type {
  BuildVolume,
  StockDefinition,
  StockMaterialId,
  ToolDefinition,
  ToolType,
  ViewSettings,
} from './types';

export const DEFAULT_BUILD_VOLUME: BuildVolume = { width: 220, depth: 220, height: 250 };

/**
 * Secilebilir ham malzemeler.
 *
 * `color` sahnedeki blogun rengi, `roughness`/`metalness` ise yuzey cinsi:
 * derlin mat plastiktir (pürüzlü, metalik degil), aluminyum ve pirinc ise
 * isigi metal gibi yansitir.
 */
export interface StockMaterial {
  id: StockMaterialId;
  label: string;
  color: number;
  roughness: number;
  metalness: number;
}

export const STOCK_MATERIALS: StockMaterial[] = [
  { id: 'derlin-dogal', label: 'Derlin (dogal)', color: 0xe8e3d8, roughness: 0.85, metalness: 0.02 },
  { id: 'derlin-mavi', label: 'Derlin (mavi)', color: 0x2f6fd0, roughness: 0.8, metalness: 0.02 },
  { id: 'derlin-kirmizi', label: 'Derlin (kirmizi)', color: 0xc0392b, roughness: 0.8, metalness: 0.02 },
  { id: 'derlin-siyah', label: 'Derlin (siyah)', color: 0x2b2f36, roughness: 0.78, metalness: 0.03 },
  { id: 'derlin-yesil', label: 'Derlin (yesil)', color: 0x2e8b57, roughness: 0.8, metalness: 0.02 },
  { id: 'aluminyum', label: 'Aluminyum', color: 0xb8bec6, roughness: 0.35, metalness: 0.75 },
  { id: 'pirinc', label: 'Pirinc', color: 0xc9a227, roughness: 0.4, metalness: 0.7 },
];

export const DEFAULT_STOCK_MATERIAL: StockMaterialId = 'derlin-dogal';

/** Id'den malzeme tanimi; bilinmeyen id'de varsayilana duser. */
export function getStockMaterial(id: StockMaterialId | undefined): StockMaterial {
  return (
    STOCK_MATERIALS.find((m) => m.id === id) ??
    STOCK_MATERIALS.find((m) => m.id === DEFAULT_STOCK_MATERIAL) ??
    (STOCK_MATERIALS[0] as StockMaterial)
  );
}

export const DEFAULT_STOCK: StockDefinition = {
  shape: 'box',
  size: { x: 100, y: 100, z: 30 },
  origin: { x: 0, y: 0, z: 0 },
  material: DEFAULT_STOCK_MATERIAL,
};

export const DEFAULT_TOOL: ToolDefinition = { type: 'flat', diameter: 6, fluteLength: 25 };

/**
 * Takim tipleri ve atolyedeki tipik degerleri.
 *
 * `defaults` bir tip secildiginde forma doldurulur; kullanici capi/aciyi
 * degistirebilir. `needsAngle` / `needsCornerRadius` hangi alanin anlamli
 * oldugunu soyler — havsa frezesine kose radyusu sormanin anlami yok.
 */
export interface ToolTypeInfo {
  id: ToolType;
  label: string;
  /** Kisa aciklama (panelde ipucu olarak gosterilir). */
  hint: string;
  defaults: Partial<ToolDefinition>;
  needsAngle?: boolean;
  needsCornerRadius?: boolean;
  needsTipDiameter?: boolean;
}

export const TOOL_TYPES: ToolTypeInfo[] = [
  {
    id: 'flat',
    label: 'Duz parmak freze',
    hint: 'Duz tabanli; cep, kanal ve kontur icin standart takim.',
    defaults: { diameter: 6, fluteLength: 25 },
  },
  {
    id: 'ball',
    label: 'Kure uclu (ball nose)',
    hint: 'Yarim kure uc; egrisel yuzey ve 3B tarama isleri.',
    defaults: { diameter: 6, fluteLength: 25 },
  },
  {
    id: 'bull',
    label: 'Kose radyuslu (bull nose)',
    hint: 'Duz taban + kose radyusu; kaba islemede kose dayanimi saglar.',
    defaults: { diameter: 8, fluteLength: 25, cornerRadius: 1 },
    needsCornerRadius: true,
  },
  {
    id: 'vbit',
    label: 'V uclu gravur',
    hint: 'Sivri koni; yazi/gravur ve keskin pah.',
    defaults: { diameter: 6, fluteLength: 15, angle: 60 },
    needsAngle: true,
  },
  {
    id: 'drill',
    label: 'Matkap (helisel)',
    hint: 'Tepe acisi 118 derece (celik) veya 135 derece (paslanmaz/derin).',
    defaults: { diameter: 5, fluteLength: 40, angle: 118 },
    needsAngle: true,
  },
  {
    id: 'spot',
    label: 'Punta matkabi',
    hint: 'Kisa ve rijit; matkabin kacmamasi icin once yer isaretler.',
    defaults: { diameter: 8, fluteLength: 10, angle: 90 },
    needsAngle: true,
  },
  {
    id: 'chamfer',
    label: 'Havsa / pah frezesi',
    hint: 'Vida basi yuvasi ve kenar pahi; genelde 90 derece.',
    defaults: { diameter: 10, fluteLength: 12, angle: 90, tipDiameter: 1 },
    needsAngle: true,
    needsTipDiameter: true,
  },
  {
    id: 'reamer',
    label: 'Rayba',
    hint: 'Delinmis deligi olcusune getirir; silindirik keser.',
    defaults: { diameter: 6, fluteLength: 30 },
  },
  {
    id: 'tap',
    label: 'Kilavuz (dis cekme)',
    hint: 'Dis acar; simulasyonda silindirik kabul edilir.',
    defaults: { diameter: 5, fluteLength: 20 },
  },
];

export function getToolTypeInfo(id: ToolType): ToolTypeInfo {
  return TOOL_TYPES.find((t) => t.id === id) ?? (TOOL_TYPES[0] as ToolTypeInfo);
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  colorMode: 'kind',
  showToolpath: true,
  showTravel: false,
  showGrid: true,
  showBuildVolume: true,
  showAxes: true,
  isolateLayer: false,
  renderMode: 'lines',
  // Varsayilan purüzsuz: kullanicinin gordugu sey tezgahtan cikacak parcadir,
  // simulasyonun hucre yapisi degil.
  stockSurface: 'smooth',
};

/** Solid render'daki extrusion "bead"inin genislik/yukseklik varsayilanlari (mm). */
export const SOLID_EXTRUSION_WIDTH = 0.45;
export const SOLID_LAYER_HEIGHT_FALLBACK = 0.2;

/** Kabul edilen dosya uzantilari. */
export const ACCEPTED_EXTENSIONS = ['.gcode', '.gco', '.g', '.nc', '.ngc', '.tap'] as const;

/** Bu boyutun ustunde kullaniciya "uzun surebilir" uyarisi gosterilir (byte). */
export const LARGE_FILE_WARNING_BYTES = 50 * 1024 * 1024;

/** Ayni Z degerini ayni katman saymak icin tolerans (mm). */
export const LAYER_Z_EPSILON = 1e-4;

export const MM_PER_INCH = 25.4;

/** Simulasyon hiz kademeleri. */
export const PLAYBACK_SPEEDS = [0.5, 1, 2, 5, 10, 50] as const;

/** Sahne renk paleti — tek kaynak. */
export const COLORS = {
  background: 0x14161a,
  grid: 0x2a2f38,
  gridAccent: 0x3d4450,
  extrude: 0xff8a2b,
  travel: 0x3aa0ff,
  retract: 0xff3b6b,
  home: 0x7d8694,
  stock: 0xb9a383,
  cut: 0x8fa2b8,
} as const;
