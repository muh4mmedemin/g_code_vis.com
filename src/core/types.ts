/**
 * Projenin merkezi veri sozlesmesi (data contract).
 *
 * Buradaki tipler hem parser'in cikti formatini hem de viewer/state
 * katmanlarinin girdi formatini tanimlar. Yeni bir ozellik eklerken once
 * BU DOSYA guncellenir, sonra uygulayan modul yazilir.
 */

// ---------------------------------------------------------------------------
// Genel
// ---------------------------------------------------------------------------

/** Uygulamanin G-code'u nasil yorumladigi. Varsayilan: 'print'. */
export type MachineMode = 'print' | 'cnc';

/** Olcu birimi (G20 / G21). Dahili her sey milimetre cinsinden tutulur. */
export type Unit = 'mm' | 'inch';

/** Konumlandirma modu (G90 / G91). */
export type PositioningMode = 'absolute' | 'relative';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Hareket (Move) modeli
// ---------------------------------------------------------------------------

/**
 * Hareket tipi. Render tarafinda renk/gorunurluk kararlari bu alana bakar.
 * - extrude : malzeme birakan hareket (print) veya kesen hareket (cnc)
 * - travel  : malzemesiz bos hareket
 * - retract : sadece E ekseni geri cekilmesi (XYZ degismez)
 * - home    : G28
 */
export type MoveKind = 'extrude' | 'travel' | 'retract' | 'home';

/**
 * Tek bir hareket segmenti: [from -> to].
 *
 * NOT (performans): Buyuk dosyalarda bu nesnelerin dizisi cok yer kaplar.
 * Nihai render icin `ToolpathBuffers` (typed array) kullanilir; bu arayuz
 * parser'in mantiksal ciktisi ve UI'da tekil hareket incelemesi icindir.
 */
export interface Move {
  /** Kaynak dosyadaki 0-tabanli satir indeksi (editor ile senkron icin). */
  lineIndex: number;
  kind: MoveKind;
  from: Vec3;
  to: Vec3;
  /** Bu hareketteki E delta'si (mm). Negatif ise retract. */
  e: number;
  /** Feedrate (mm/dk), modal olarak tasinir. */
  f: number;
  /** Hareketin ait oldugu katman indeksi (0-tabanli). */
  layerIndex: number;
  /** Segment uzunlugu (mm, XYZ). Istatistik icin parser tarafindan doldurulur. */
  distance: number;
  /** Tahmini sure (saniye). Bkz. gcode/estimator. */
  duration: number;
}

export interface Layer {
  index: number;
  /** Katmanin Z yuksekligi (mm). */
  z: number;
  /** moves dizisinde bu katmanin [start, end) araligi. */
  startMove: number;
  endMove: number;
}

// ---------------------------------------------------------------------------
// Parse sonucu
// ---------------------------------------------------------------------------

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

export interface GcodeStats {
  totalMoves: number;
  layerCount: number;
  /** Tahmini toplam sure (saniye) — slicer tahminiyle birebir olmayabilir. */
  estimatedDuration: number;
  /** Toplam extrude edilen filament (mm). */
  filamentLength: number;
  distanceExtrude: number;
  distanceTravel: number;
  bounds: BoundingBox;
}

/** Parser'in ureteci uyari/hata kaydi (desteklenmeyen komut vb.). */
export interface ParseDiagnostic {
  lineIndex: number;
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface ParseResult {
  moves: Move[];
  layers: Layer[];
  stats: GcodeStats;
  diagnostics: ParseDiagnostic[];
  /** Tespit edilen slicer/dialect adi (bkz. gcode/dialects). */
  dialect: string;
  /** Render icin hazirlanmis typed array paketi. */
  buffers: ToolpathBuffers;
}

/**
 * Render'a dogrudan verilebilen, GC baskisi olusturmayan veri paketi.
 * Worker'dan main thread'e transferable olarak gecirilir.
 */
export interface ToolpathBuffers {
  /** Segment basina 6 float: x1,y1,z1,x2,y2,z2 (LineSegments formati). */
  positions: Float32Array;
  /** Segment basina 1 deger: MoveKind'in sayisal karsiligi. */
  kinds: Uint8Array;
  /** Segment basina 1 deger: katman indeksi. */
  layerIndices: Uint32Array;
  /** Segment basina kumulatif sure (saniye) — simulasyon scrub'i icin. */
  timeOffsets: Float32Array;
  /** Segment sayisi. */
  count: number;
}

/** MoveKind <-> sayisal kodlama (ToolpathBuffers.kinds). */
export const MOVE_KIND_CODE: Record<MoveKind, number> = {
  extrude: 0,
  travel: 1,
  retract: 2,
  home: 3,
};

// ---------------------------------------------------------------------------
// Makine / sahne ayarlari
// ---------------------------------------------------------------------------

export interface BuildVolume {
  width: number; // X (mm)
  depth: number; // Y (mm)
  height: number; // Z (mm)
}

/** CNC modu icin ham malzeme blogu tanimi (Faz 6). */
export interface StockDefinition {
  shape: 'box' | 'cylinder';
  size: Vec3;
  /** Blogun sahne origin'ine gore konumu. */
  origin: Vec3;
}

/** CNC kesici takim tanimi (Faz 6). */
export interface ToolDefinition {
  type: 'flat' | 'ball' | 'vbit';
  diameter: number; // mm
  fluteLength: number; // mm
}

// ---------------------------------------------------------------------------
// Gorunum ayarlari
// ---------------------------------------------------------------------------

export type ColorMode = 'kind' | 'layer' | 'feedrate' | 'tool';

/** Toolpath'in nasil cizilecegi: ince cizgiler mi, dolgun/yuzeyli 3D mi. */
export type RenderMode = 'lines' | 'solid';

export interface ViewSettings {
  colorMode: ColorMode;
  showTravel: boolean;
  showGrid: boolean;
  showBuildVolume: boolean;
  showAxes: boolean;
  /** Tek katman izole modu. */
  isolateLayer: boolean;
  renderMode: RenderMode;
}
