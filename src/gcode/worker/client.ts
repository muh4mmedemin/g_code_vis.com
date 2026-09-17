import type { ParseResult } from '@/core/types';

/**
 * Worker'i saran, Promise tabanli istemci. UI katmani yalnizca bunu gorur;
 * ilerde worker'siz (senkron) bir yola donmek istenirse tek dosya degisir.
 * TODO(sonnet): Worker yasam dongusu, id eslestirme, iptal (cancel) destegi.
 */
export interface ParseHandle {
  promise: Promise<ParseResult>;
  cancel(): void;
}

export function parseInWorker(
  _source: string,
  _onProgress?: (ratio: number) => void,
): ParseHandle {
  throw new Error('NOT_IMPLEMENTED: parseInWorker');
}
