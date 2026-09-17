import type { BuildVolume, StockDefinition, ToolDefinition, ViewSettings } from './types';

export const DEFAULT_BUILD_VOLUME: BuildVolume = { width: 220, depth: 220, height: 250 };

export const DEFAULT_STOCK: StockDefinition = {
  shape: 'box',
  size: { x: 100, y: 100, z: 30 },
  origin: { x: 0, y: 0, z: 0 },
};

export const DEFAULT_TOOL: ToolDefinition = { type: 'flat', diameter: 6, fluteLength: 25 };

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  colorMode: 'kind',
  showTravel: false,
  showGrid: true,
  showBuildVolume: true,
  showAxes: true,
  isolateLayer: false,
  renderMode: 'lines',
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
