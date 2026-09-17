import type { ParseResult } from '@/core/types';

/** Yuklenen dosya + editordeki metin + parse sonucu. */
export interface DocumentSlice {
  fileName: string | null;
  /** Editordeki ham G-code metni (tek dogruluk kaynagi). */
  source: string;
  parseResult: ParseResult | null;
  parseStatus: 'idle' | 'parsing' | 'ready' | 'error';
  parseProgress: number;
  parseError: string | null;

  loadFile(file: File): Promise<void>;
  setSource(source: string): void;
  /** Mevcut source'u (yeniden) parse eder — editor degisiminde debounce ile. */
  reparse(): Promise<void>;
  closeDocument(): void;
}

/** TODO(sonnet): createDocumentSlice implementasyonu. */
