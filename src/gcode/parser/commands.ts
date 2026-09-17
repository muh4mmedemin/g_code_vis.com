import type { GcodeToken } from './tokenizer';
import type { MachineState } from './machineState';
import { toMillimeters } from './machineState';
import type { Move, MoveKind, ParseDiagnostic, Vec3 } from '@/core/types';
import { LAYER_Z_EPSILON } from '@/core/constants';

/**
 * Komut handler kayit defteri (registry).
 *
 * Yeni bir G/M kodu desteklemek icin: bir handler yaz, COMMAND_HANDLERS'a ekle.
 * Parser'in govdesini degistirmek gerekmez.
 */

export interface HandlerContext {
  state: MachineState;
  /** Uretilen hareketi cikti akisina yazar. */
  emitMove: (move: Move) => void;
  /** Yeni katman baslatir; layerIndex donmesi beklenir. */
  beginLayer: (z: number) => number;
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

/** G0/G1 — dogrusal hareket. isExtrusion, E artisina gore belirlenir. */
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

  let deltaE = 0;
  if (token.params.E !== undefined) {
    const eValueMm = toMillimeters(token.params.E, state.unit);
    const newE = state.ePositioning === 'relative' ? state.e + eValueMm : eValueMm;
    deltaE = newE - state.e;
    state.e = newE;
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Katman degisimi: Z, mevcut katmanin yuksekliginden farklilastiginda
  // (ilk hareket dahil) yeni katman baslatilir.
  if (!state.hasLayer || Math.abs(to.z - state.layerZ) > LAYER_Z_EPSILON) {
    state.currentLayer = ctx.beginLayer(to.z);
    state.layerZ = to.z;
    state.hasLayer = true;
  }

  state.position = to;

  let kind: MoveKind;
  if (distance === 0 && deltaE !== 0) {
    kind = 'retract';
  } else if (deltaE > 0) {
    kind = 'extrude';
  } else {
    kind = 'travel';
  }

  // Feedrate mm/dk; sure hesabi saniye cinsinden.
  const duration = state.feedrate > 0 ? (distance / state.feedrate) * 60 : 0;

  ctx.emitMove({
    lineIndex: token.lineIndex,
    kind,
    from,
    to,
    e: deltaE,
    f: state.feedrate,
    layerIndex: state.currentLayer,
    distance,
    duration,
  });
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

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  state.position = to;

  ctx.emitMove({
    lineIndex: token.lineIndex,
    kind: 'home',
    from,
    to,
    e: 0,
    f: state.feedrate,
    layerIndex: state.currentLayer,
    distance,
    duration: 0,
  });
}

function handleAbsolutePositioning(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.positioning = 'absolute';
}

function handleRelativePositioning(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.positioning = 'relative';
}

/** G92 — pozisyon reset (offset yerine dogrudan state atamasi ile uygulanir). */
function handleSetPosition(token: GcodeToken, ctx: HandlerContext): void {
  const { state } = ctx;
  if (token.params.X !== undefined) state.position.x = toMillimeters(token.params.X, state.unit);
  if (token.params.Y !== undefined) state.position.y = toMillimeters(token.params.Y, state.unit);
  if (token.params.Z !== undefined) state.position.z = toMillimeters(token.params.Z, state.unit);
  if (token.params.E !== undefined) state.e = toMillimeters(token.params.E, state.unit);
}

function handleUnitsMm(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.unit = 'mm';
}

function handleUnitsInch(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.unit = 'inch';
}

function handleEAbsolute(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.ePositioning = 'absolute';
}

function handleERelative(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.ePositioning = 'relative';
}

function notImplemented(code: string): CommandHandler {
  return (token, ctx) => {
    ctx.diagnostic({
      severity: 'info',
      code: 'UNSUPPORTED_COMMAND',
      message: `${code} henuz desteklenmiyor, atlandi.`,
    });
  };
}

function noop(): void {}

export const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  G0: handleLinearMove,
  G1: handleLinearMove,
  G28: handleHome,
  G90: handleAbsolutePositioning,
  G91: handleRelativePositioning,
  G92: handleSetPosition,
  G20: handleUnitsInch,
  G21: handleUnitsMm,
  M82: handleEAbsolute,
  M83: handleERelative,
  // Faz 5 — arc destegi (I/J/K veya R ile, segmentlere bolunerek)
  G2: notImplemented('G2 (arc)'),
  G3: notImplemented('G3 (arc)'),
  // Bilgi amacli, gorsel etkisi yok
  M104: noop,
  M109: noop,
  M140: noop,
  M190: noop,
};
