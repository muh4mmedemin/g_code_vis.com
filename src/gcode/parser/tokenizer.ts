/**
 * Satir seviyesinde tokenizer.
 *
 * Gorev: ham bir G-code satirini "komut + parametre sozlugu + yorum" uclusune
 * ayirmak. Hicbir semantik yorum yapmaz (modal state bilmez).
 *
 * Ornek: "G1 X10.5 Y2 E0.04 ; wall-outer"
 *   -> { command: 'G1', params: { X: 10.5, Y: 2, E: 0.04 }, comment: 'wall-outer' }
 */

export type ParamLetter = 'X' | 'Y' | 'Z' | 'E' | 'F' | 'I' | 'J' | 'K' | 'R' | 'S' | 'P' | 'T';

export interface GcodeToken {
  /** 'G1', 'M104', 'T0' ... Sadece yorum satirinda null. */
  command: string | null;
  params: Partial<Record<ParamLetter, number>>;
  /** ';' veya '()' icindeki metin, trim'lenmis. Yoksa null. */
  comment: string | null;
  lineIndex: number;
}

/**
 * TODO(sonnet): Regex tabanli implementasyon.
 * Dikkat edilecekler:
 *  - '(' ... ')' seklindeki inline yorumlar (CNC dosyalarinda yaygin)
 *  - checksum'lu satirlar: "N123 G1 X10 *45"
 *  - bosluksuz yazim: "G1X10Y20"
 *  - buyuk/kucuk harf karisimi
 */
export function tokenizeLine(_line: string, _lineIndex: number): GcodeToken {
  throw new Error('NOT_IMPLEMENTED: tokenizeLine');
}
