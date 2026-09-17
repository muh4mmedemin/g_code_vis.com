import type { GcodeToken } from './tokenizer';
import type { MachineState } from './machineState';
import { toMillimeters } from './machineState';
import type { Move, MoveKind, ParseDiagnostic, Vec3 } from '@/core/types';
import { estimateMoveDuration } from '../stats';
import { segmentArc } from './arcs';

/**
 * Komut handler kayit defteri (registry).
 *
 * Yeni bir G/M kodu desteklemek icin: bir handler yaz, COMMAND_HANDLERS'a ekle.
 * Parser'in govdesini degistirmek gerekmez.
 *
 * Katman indeksi burada BELIRLENMEZ: hareketler layerIndex=0 ile uretilir,
 * katman sinirlari parse sonunda (index.ts) extrusion ve slicer yorumlarina
 * bakilarak atanir — boylece Z-hop sahte katman uretmez.
 */

export interface HandlerContext {
  state: MachineState;
  /** Uretilen hareketi cikti akisina yazar. */
  emitMove: (move: Move) => void;
  diagnostic: (d: Omit<ParseDiagnostic, 'lineIndex'>) => void;
}

export type CommandHandler = (token: GcodeToken, ctx: HandlerContext) => void;

/** Bir eksenin yeni mutlak degerini modal positioning'e gore hesaplar. */
function resolveAxis(
  paramValue: number | undefined,
  current: number,
  positioning: 'absolute' | 'relative',
  unit: MachineState['unit'],
): number {
  if (paramValue === undefined) return current;
  const mm = toMillimeters(paramValue, unit);
  return positioning === 'relative' ? current + mm : mm;
}

/** Hedef E degerini ve bu hareketteki delta'yi hesaplar (state'i DEGISTIRMEZ). */
function resolveExtrusion(token: GcodeToken, state: MachineState): { newE: number; delta: number } {
  if (token.params.E === undefined) return { newE: state.e, delta: 0 };
  const eMm = toMillimeters(token.params.E, state.unit);
  const newE = state.ePositioning === 'relative' ? state.e + eMm : eMm;
  return { newE, delta: newE - state.e };
}

function classifyMove(distance: number, deltaE: number): MoveKind {
  if (distance === 0 && deltaE !== 0) return 'retract';
  if (deltaE > 0) return 'extrude';
  return 'travel';
}

function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** G0/G1 — dogrusal hareket. */
function handleLinearMove(token: GcodeToken, ctx: HandlerContext): void {
  const { state } = ctx;
  const from: Vec3 = { ...state.position };

  const to: Vec3 = {
    x: resolveAxis(token.params.X, state.position.x, state.positioning, state.unit),
    y: resolveAxis(token.params.Y, state.position.y, state.positioning, state.unit),
    z: resolveAxis(token.params.Z, state.position.z, state.positioning, state.unit),
  };

  if (token.params.F !== undefined) {
    state.feedrate = toMillimeters(token.params.F, state.unit);
  }

  const { newE, delta: deltaE } = resolveExtrusion(token, state);
  state.e = newE;

  const distance = distanceBetween(from, to);
  state.position = to;

  ctx.emitMove({
    lineIndex: token.lineIndex,
    kind: classifyMove(distance, deltaE),
    from,
    to,
    e: deltaE,
    f: state.feedrate,
    layerIndex: 0,
    tool: state.tool,
    distance,
    duration: estimateMoveDuration(distance, state.feedrate),
  });
}

/** G2 (saat yonu) / G3 (saat yonunun tersi) — yay hareketi. */
function handleArcMove(clockwise: boolean): CommandHandler {
  return (token, ctx) => {
    const { state } = ctx;
    const from: Vec3 = { ...state.position };

    const to: Vec3 = {
      x: resolveAxis(token.params.X, state.position.x, state.positioning, state.unit),
      y: resolveAxis(token.params.Y, state.position.y, state.positioning, state.unit),
      z: resolveAxis(token.params.Z, state.position.z, state.positioning, state.unit),
    };

    if (token.params.F !== undefined) {
      state.feedrate = toMillimeters(token.params.F, state.unit);
    }

    const hasOffset =
      token.params.I !== undefined || token.params.J !== undefined || token.params.K !== undefined;

    const arc = segmentArc({
      from,
      to,
      plane: state.plane,
      clockwise,
      offset: hasOffset
        ? {
            i: token.params.I !== undefined ? toMillimeters(token.params.I, state.unit) : undefined,
            j: token.params.J !== undefined ? toMillimeters(token.params.J, state.unit) : undefined,
            k: token.params.K !== undefined ? toMillimeters(token.params.K, state.unit) : undefined,
          }
        : undefined,
      radius:
        token.params.R !== undefined ? toMillimeters(token.params.R, state.unit) : undefined,
    });

    const { newE, delta: totalDeltaE } = resolveExtrusion(token, state);
    state.e = newE;

    if (!arc || arc.points.length === 0) {
      // Gecersiz yay tanimi: duz cizgi olarak isle, kullaniciyi uyar.
      ctx.diagnostic({
        severity: 'warning',
        code: 'INVALID_ARC',
        message: 'Yay tanimi cozulemedi (I/J/K veya R eksik/gecersiz); duz cizgi cizildi.',
      });
      const distance = distanceBetween(from, to);
      state.position = to;
      ctx.emitMove({
        lineIndex: token.lineIndex,
        kind: classifyMove(distance, totalDeltaE),
        from,
        to,
        e: totalDeltaE,
        f: state.feedrate,
        layerIndex: 0,
        tool: state.tool,
        distance,
        duration: estimateMoveDuration(distance, state.feedrate),
      });
      return;
    }

    // Yay, dogru parcalarina bolunur; E ve sure parcalar arasinda uzunluga
    // gore dagitilir.
    const segmentCount = arc.points.length;
    let cursor: Vec3 = from;
    for (let n = 0; n < segmentCount; n++) {
      const point = arc.points[n];
      if (!point) continue;
      const distance = distanceBetween(cursor, point);
      const deltaE = totalDeltaE / segmentCount;
      ctx.emitMove({
        lineIndex: token.lineIndex,
        kind: classifyMove(distance, deltaE),
        from: cursor,
        to: point,
        e: deltaE,
        f: state.feedrate,
        layerIndex: 0,
        tool: state.tool,
        distance,
        duration: estimateMoveDuration(distance, state.feedrate),
      });
      cursor = point;
    }

    state.position = { ...cursor };
  };
}

/** G28 — home. Belirtilen eksenler (veya hepsi) 0'a gider. */
function handleHome(token: GcodeToken, ctx: HandlerContext): void {
  const { state } = ctx;
  const from: Vec3 = { ...state.position };
  const hasAxisParam =
    token.params.X !== undefined || token.params.Y !== undefined || token.params.Z !== undefined;

  const to: Vec3 = {
    x: !hasAxisParam || token.params.X !== undefined ? 0 : state.position.x,
    y: !hasAxisParam || token.params.Y !== undefined ? 0 : state.position.y,
    z: !hasAxisParam || token.params.Z !== undefined ? 0 : state.position.z,
  };

  const distance = distanceBetween(from, to);
  state.position = to;

  ctx.emitMove({
    lineIndex: token.lineIndex,
    kind: 'home',
    from,
    to,
    e: 0,
    f: state.feedrate,
    layerIndex: 0,
    tool: state.tool,
    distance,
    duration: 0,
  });
}

function handleAbsolutePositioning(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.positioning = 'absolute';
  // M82/M83 gorulmediyse E ekseni de G90/G91'i izler (Marlin/RRF davranisi).
  if (!ctx.state.eModeExplicit) ctx.state.ePositioning = 'absolute';
}

function handleRelativePositioning(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.positioning = 'relative';
  if (!ctx.state.eModeExplicit) ctx.state.ePositioning = 'relative';
}

/** G92 — pozisyon reset. Parametresiz cagri tum eksenleri sifirlar. */
function handleSetPosition(token: GcodeToken, ctx: HandlerContext): void {
  const { state } = ctx;
  const { X, Y, Z, E } = token.params;
  const noParams = X === undefined && Y === undefined && Z === undefined && E === undefined;

  if (noParams) {
    state.position = { x: 0, y: 0, z: 0 };
    state.e = 0;
    return;
  }

  if (X !== undefined) state.position.x = toMillimeters(X, state.unit);
  if (Y !== undefined) state.position.y = toMillimeters(Y, state.unit);
  if (Z !== undefined) state.position.z = toMillimeters(Z, state.unit);
  if (E !== undefined) state.e = toMillimeters(E, state.unit);
}

/** G4 — bekleme. P milisaniye, S saniye cinsindendir. */
function handleDwell(token: GcodeToken, ctx: HandlerContext): void {
  const { state } = ctx;
  if (token.params.S !== undefined) state.dwellSeconds += token.params.S;
  else if (token.params.P !== undefined) state.dwellSeconds += token.params.P / 1000;
}

function handleUnitsMm(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.unit = 'mm';
}

function handleUnitsInch(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.unit = 'inch';
}

function handleEAbsolute(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.ePositioning = 'absolute';
  ctx.state.eModeExplicit = true;
}

function handleERelative(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.ePositioning = 'relative';
  ctx.state.eModeExplicit = true;
}

function setPlane(plane: MachineState['plane']): CommandHandler {
  return (_token, ctx) => {
    ctx.state.plane = plane;
  };
}

/** T0/T1... — takim (extruder) degisimi. */
function handleToolChange(token: GcodeToken, ctx: HandlerContext): void {
  const command = token.commands.find((c) => c.startsWith('T'));
  if (!command) return;
  const index = Number(command.slice(1));
  if (Number.isFinite(index)) ctx.state.tool = index;
}

function noop(): void {}

/**
 * Geometriyi etkilemeyen, bilincli olarak yok sayilan komutlar.
 * Bunlar "bilinmeyen komut" uyarisi uretmemeli — gercek bir slicer ciktisinda
 * yuzlercesi bulunur ve uyari listesini anlamsizca doldururlar.
 */
const IGNORED_COMMANDS = [
  // Sicaklik / fan / motor / ekran
  'M104', 'M109', 'M140', 'M190', 'M191', 'M106', 'M107', 'M84', 'M18',
  'M17', 'M117', 'M118', 'M73', 'M201', 'M203', 'M204', 'M205', 'M220',
  'M221', 'M400', 'M420', 'M500', 'M501', 'M502', 'M900', 'M905',
  // Program akisi
  'M0', 'M1', 'M2', 'M30', 'M108', 'M110',
  // CNC: is mili / sogutma / program
  'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9',
  // Is koordinat sistemleri ve telafi (geometriyi kabaca etkilemez)
  'G53', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59',
  'G40', 'G43', 'G49', 'G61', 'G64', 'G80', 'G94', 'G95',
] as const;

export const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  // Hareket
  G0: handleLinearMove,
  G1: handleLinearMove,
  G2: handleArcMove(true),
  G3: handleArcMove(false),
  G28: handleHome,
  G4: handleDwell,
  // Modal durum
  G90: handleAbsolutePositioning,
  G91: handleRelativePositioning,
  G92: handleSetPosition,
  G20: handleUnitsInch,
  G21: handleUnitsMm,
  G17: setPlane('XY'),
  G18: setPlane('XZ'),
  G19: setPlane('YZ'),
  M82: handleEAbsolute,
  M83: handleERelative,
  // Takim degisimi (T0..T9)
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`T${i}`, handleToolChange as CommandHandler]),
  ),
  // Bilincli olarak yok sayilanlar
  ...Object.fromEntries(IGNORED_COMMANDS.map((c) => [c, noop as CommandHandler])),
};

/**
 * Hareket/konum uretin komutlar. Ayni satirda modal komutlarla birlikte
 * gelebilirler ("G0 G90 X10"); modal olanlar ONCE uygulanmalidir.
 */
export const MOTION_COMMANDS = new Set(['G0', 'G1', 'G2', 'G3', 'G28', 'G92', 'G4']);
