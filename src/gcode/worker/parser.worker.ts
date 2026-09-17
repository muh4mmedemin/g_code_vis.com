/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from './protocol';

/**
 * Parser Web Worker'i.
 * Buyuk dosyalarda UI'nin donmamasi icin parse islemi burada calisir.
 * TODO(sonnet): parseGcode cagrisi + ilerleme bildirimi + transferable ile
 * ToolpathBuffers gonderimi (bkz. collectTransferables).
 */
self.onmessage = (_event: MessageEvent<WorkerRequest>) => {
  const reply = (msg: WorkerResponse, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(msg, transfer);
  reply({ type: 'error', id: _event.data.id, message: 'NOT_IMPLEMENTED: parser.worker' });
};

export {};
