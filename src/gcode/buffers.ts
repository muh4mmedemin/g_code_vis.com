import { MOVE_KIND_CODE } from '@/core/types';
import type { Move, ToolpathBuffers } from '@/core/types';

/**
 * Move[] -> typed array paketi.
 * Render performansinin kalbi: Three.js tarafi yalnizca bu buffer'lari tuketir.
 */
export function buildToolpathBuffers(moves: Move[]): ToolpathBuffers {
  const count = moves.length;
  const positions = new Float32Array(count * 6);
  const kinds = new Uint8Array(count);
  const layerIndices = new Uint32Array(count);
  const timeOffsets = new Float32Array(count);

  let cumulativeTime = 0;
  for (let i = 0; i < count; i++) {
    const move = moves[i];
    if (!move) continue;
    const base = i * 6;
    positions[base] = move.from.x;
    positions[base + 1] = move.from.y;
    positions[base + 2] = move.from.z;
    positions[base + 3] = move.to.x;
    positions[base + 4] = move.to.y;
    positions[base + 5] = move.to.z;

    kinds[i] = MOVE_KIND_CODE[move.kind];
    layerIndices[i] = move.layerIndex;
    timeOffsets[i] = cumulativeTime;
    cumulativeTime += move.duration;
  }

  return { positions, kinds, layerIndices, timeOffsets, count };
}

/** postMessage(transfer) icin buffer listesi. */
export function collectTransferables(buffers: ToolpathBuffers): Transferable[] {
  return [
    buffers.positions.buffer as ArrayBuffer,
    buffers.kinds.buffer as ArrayBuffer,
    buffers.layerIndices.buffer as ArrayBuffer,
    buffers.timeOffsets.buffer as ArrayBuffer,
  ];
}
