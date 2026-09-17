import type { GcodeToken } from './tokenizer';
import type { MachineState } from './machineState';
import type { Move, ParseDiagnostic } from '@/core/types';

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

/**
 * TODO(sonnet): Her handler'in govdesi.
 * Oncelik sirasi: G0/G1 -> G90/G91 -> G92 -> G28 -> G20/G21 -> M82/M83 -> G2/G3.
 */
export const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  // Faz 1
  G0: notImplemented('G0'),
  G1: notImplemented('G1'),
  G28: notImplemented('G28'),
  G90: notImplemented('G90'),
  G91: notImplemented('G91'),
  G92: notImplemented('G92'),
  G20: notImplemented('G20'),
  G21: notImplemented('G21'),
  M82: notImplemented('M82'),
  M83: notImplemented('M83'),
  // Faz 5 — arc destegi (I/J/K veya R ile, segmentlere bolunerek)
  G2: notImplemented('G2'),
  G3: notImplemented('G3'),
  // Bilgi amacli, gorsel etkisi yok
  M104: noop,
  M109: noop,
  M140: noop,
  M190: noop,
};

function noop(): void {}

function notImplemented(code: string): CommandHandler {
  return () => {
    throw new Error(`NOT_IMPLEMENTED: command handler ${code}`);
  };
}
