/// <reference lib="webworker" />
import { parseGcode } from '../parser';
import { collectTransferables } from '../buffers';
import type { WorkerRequest, WorkerResponse } from './protocol';

/**
 * Parser Web Worker'i.
 * Buyuk dosyalarda UI'nin donmamasi icin parse islemi burada calisir.
 */
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { data } = event;
  const reply = (msg: WorkerResponse, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(msg, transfer);

  if (data.type !== 'parse') return;

  try {
    const result = parseGcode(data.source, {
      forceDialect: data.forceDialect,
      onProgress: (ratio) => reply({ type: 'progress', id: data.id, ratio }),
      toolRadius: data.toolRadius,
    });
    reply({ type: 'done', id: data.id, result }, collectTransferables(result.buffers));
  } catch (err) {
    reply({
      type: 'error',
      id: data.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

export {};
