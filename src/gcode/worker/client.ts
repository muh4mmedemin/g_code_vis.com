import type { ParseResult } from '@/core/types';
import type { WorkerRequest, WorkerResponse } from './protocol';

/**
 * Worker'i saran, Promise tabanli istemci. UI katmani yalnizca bunu gorur;
 * ilerde worker'siz (senkron) bir yola donmek istenirse tek dosya degisir.
 */
export interface ParseHandle {
  promise: Promise<ParseResult>;
  cancel(): void;
}

let requestCounter = 0;

export interface ParseRequestOptions {
  /** G41/G42 telafisinde kullanilacak takim yaricapi (mm). */
  toolRadius?: number;
}

export function parseInWorker(
  source: string,
  onProgress?: (ratio: number) => void,
  options: ParseRequestOptions = {},
): ParseHandle {
  const worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
  const id = ++requestCounter;
  let settled = false;

  const promise = new Promise<ParseResult>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.id !== id) return;

      if (msg.type === 'progress') {
        onProgress?.(msg.ratio);
        return;
      }

      settled = true;
      if (msg.type === 'done') {
        resolve(msg.result);
      } else {
        reject(new Error(msg.message));
      }
      worker.terminate();
    };

    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      reject(new Error(event.message || 'Worker hatasi'));
      worker.terminate();
    };

    const request: WorkerRequest = { type: 'parse', id, source, toolRadius: options.toolRadius };
    worker.postMessage(request);
  });

  return {
    promise,
    cancel: () => {
      if (!settled) {
        settled = true;
        worker.terminate();
      }
    },
  };
}
