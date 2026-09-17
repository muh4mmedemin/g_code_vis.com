import type { Move, ToolpathBuffers } from '@/core/types';

/**
 * Move[] -> typed array paketi.
 * Render performansinin kalbi: Three.js tarafi yalnizca bu buffer'lari tuketir.
 * TODO(sonnet): implementasyon.
 */
export function buildToolpathBuffers(_moves: Move[]): ToolpathBuffers {
  throw new Error('NOT_IMPLEMENTED: buildToolpathBuffers');
}

/** postMessage(transfer) icin buffer listesi. */
export function collectTransferables(buffers: ToolpathBuffers): Transferable[] {
  return [
    buffers.positions.buffer,
    buffers.kinds.buffer,
    buffers.layerIndices.buffer,
    buffers.timeOffsets.buffer,
  ];
}
