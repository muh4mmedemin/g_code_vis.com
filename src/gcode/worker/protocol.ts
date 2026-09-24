import type { ParseResult } from '@/core/types';

/**
 * Main thread <-> parser worker mesaj sozlesmesi.
 * Iki taraf da SADECE bu tipleri kullanir.
 */

export type WorkerRequest = {
  type: 'parse';
  id: number;
  source: string;
  forceDialect?: string;
  /** Kesici yaricap telafisi (G41/G42) icin secili takimin yaricapi (mm). */
  toolRadius?: number;
};

export type WorkerResponse =
  | { type: 'progress'; id: number; ratio: number }
  | { type: 'done'; id: number; result: ParseResult }
  | { type: 'error'; id: number; message: string };
