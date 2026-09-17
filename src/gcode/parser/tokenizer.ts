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

const PARAM_LETTERS = 'XYZEFIJKRSPT';

/**
 * Bir satiri tokenize eder.
 *
 * Desteklenenler:
 *  - ';' ile satir sonu yorumlari
 *  - '(' ... ')' ile inline yorumlar (CNC dosyalarinda yaygin)
 *  - checksum'lu satirlar: "N123 G1 X10 *45" (N.. ve *.. atilir)
 *  - bosluksuz yazim: "G1X10Y20"
 *  - buyuk/kucuk harf karisimi
 */
export function tokenizeLine(line: string, lineIndex: number): GcodeToken {
  let comment: string | null = null;

  // Once parantezli yorumlari cikar (birden fazla olabilir).
  let working = line.replace(/\(([^)]*)\)/g, (_match, inner: string) => {
    comment = comment ? `${comment} ${inner.trim()}` : inner.trim();
    return ' ';
  });

  // ';' sonrasi tamami yorumdur.
  const semiIndex = working.indexOf(';');
  if (semiIndex >= 0) {
    const trailing = working.slice(semiIndex + 1).trim();
    comment = comment ? `${comment} ${trailing}` : trailing;
    working = working.slice(0, semiIndex);
  }

  working = working.trim();
  if (working.length === 0) {
    return { command: null, params: {}, comment: comment || null, lineIndex };
  }

  // Checksum: "*NN" satir sonunda olur, atilir.
  working = working.replace(/\*\d+\s*$/, '').trim();

  // Satir numarasi: "N123 ..." — komut degil, atilir.
  working = working.replace(/^N\d+\s*/i, '');

  working = working.toUpperCase();

  // Harf + sayi ciftlerini yakala (bosluksuz da calisir): G1X10.5Y-2
  const wordRe = /([A-Z])\s*(-?\d+\.?\d*|\.\d+)/g;
  let command: string | null = null;
  const params: Partial<Record<ParamLetter, number>> = {};

  let match: RegExpExecArray | null;
  let first = true;
  while ((match = wordRe.exec(working)) !== null) {
    const letter = match[1];
    const numStr = match[2];
    if (!letter || numStr === undefined) continue;
    const value = Number(numStr);

    if (first && (letter === 'G' || letter === 'M' || letter === 'T')) {
      // G/M/T komut kodu her zaman tam sayi olarak normalize edilir (G1, G01 -> G1),
      // fakat G0.5 gibi ondalik komut yok, bu yuzden guvenle formatlayabiliriz.
      command = `${letter}${value}`;
      first = false;
      continue;
    }
    first = false;

    if (PARAM_LETTERS.includes(letter)) {
      params[letter as ParamLetter] = value;
    }
  }

  return { command, params, comment: comment || null, lineIndex };
}
