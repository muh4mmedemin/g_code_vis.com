/**
 * Satir seviyesinde tokenizer.
 *
 * Gorev: ham bir G-code satirini "komutlar + parametre sozlugu + yorum"
 * uclusune ayirmak. Hicbir semantik yorum yapmaz (modal state bilmez).
 *
 * Ornek: "G1 X10.5 Y2 E0.04 ; wall-outer"
 *   -> { commands: ['G1'], params: { X: 10.5, Y: 2, E: 0.04 }, comment: 'wall-outer' }
 */

export type ParamLetter =
  | 'X' | 'Y' | 'Z' | 'E' | 'F'
  | 'I' | 'J' | 'K' | 'R'
  | 'S' | 'P' | 'T'
  /** Delme cevrimlerinde gagalama adimi (G83/G73). */
  | 'Q'
  /** Tekrar sayisi (delme cevrimleri, alt program cagrilari). */
  | 'L'
  /** Doner eksenler — konum hesabinda kullanilmaz, yalnizca uyari uretir. */
  | 'A' | 'B' | 'C';

export interface GcodeToken {
  /**
   * Satirdaki TUM G/M/T komut sozcukleri, yazildiklari sirayla.
   * Tek satirda birden fazla komut yasaldir ve CNC dosyalarinda yaygindir:
   * "G90 G21 G17", "G0 G90 X10".
   */
  commands: string[];
  /** Kolaylik: ilk komut. Yalnizca komutsuz satirda null. */
  command: string | null;
  params: Partial<Record<ParamLetter, number>>;
  /**
   * Sayisiz yazilmis harfler (ornek: "G28 X Y" -> ['X','Y']).
   * params icinde bunlar 0 olarak da yer alir; ayrimi gerekiyorsa buraya bakilir.
   */
  bare: ParamLetter[];
  /** ';' veya '()' icindeki metin, trim'lenmis. Yoksa null. */
  comment: string | null;
  lineIndex: number;
}

const PARAM_LETTERS = 'XYZEFIJKRSPTQLABC';

/**
 * Harf + (opsiyonel) sayi ciftleri.
 * Sayi formatlari: 10, -10, +10, 10.5, .5, -.5, 10.
 * Sayinin opsiyonel olmasi "G28 X Y" gibi ciplak eksen harflerini yakalar.
 */
const WORD_RE = /([A-Z])[ \t]*([-+]?(?:\d+\.?\d*|\.\d+))?/g;

/**
 * Bir satiri tokenize eder.
 *
 * Desteklenenler:
 *  - ';' ile satir sonu yorumlari
 *  - '(' ... ')' ile inline yorumlar (CNC'de yaygin), kapanmamis parantez dahil
 *  - '%' program sinirlayicisi (CNC) — yok sayilir
 *  - checksum'lu satirlar: "N123 G1 X10 *45" (N.. ve *.. atilir)
 *  - bosluksuz yazim: "G1X10Y20"
 *  - tek satirda birden fazla komut: "G90 G21", "G0 G90 X10"
 *  - buyuk/kucuk harf karisimi
 */
export function tokenizeLine(line: string, lineIndex: number): GcodeToken {
  const empty = (comment: string | null): GcodeToken => ({
    commands: [],
    command: null,
    params: {},
    bare: [],
    comment,
    lineIndex,
  });

  let comment: string | null = null;
  const addComment = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    comment = comment ? `${comment} ${trimmed}` : trimmed;
  };

  // Parantezli yorumlar (birden fazla olabilir).
  let working = line.replace(/\(([^)]*)\)/g, (_match, inner: string) => {
    addComment(inner);
    return ' ';
  });

  // Kapanmamis parantez: acilistan satir sonuna kadarki kisim yorumdur.
  const openParen = working.indexOf('(');
  if (openParen >= 0) {
    addComment(working.slice(openParen + 1));
    working = working.slice(0, openParen);
  }

  // ';' sonrasi tamami yorumdur.
  const semiIndex = working.indexOf(';');
  if (semiIndex >= 0) {
    addComment(working.slice(semiIndex + 1));
    working = working.slice(0, semiIndex);
  }

  working = working.trim();
  if (working.length === 0) return empty(comment);

  // '%' program basi/sonu isareti (CNC): satirda baska bir sey yoksa yok say.
  if (working === '%') return empty(comment);

  // Checksum: "*NN" satir sonunda olur, atilir.
  working = working.replace(/\*\s*\d+\s*$/, '').trim();
  // Satir numarasi: "N123 ..." — komut degil, atilir.
  working = working.replace(/^N\s*\d+\s*/i, '');

  working = working.toUpperCase();
  if (working.length === 0) return empty(comment);

  const commands: string[] = [];
  const params: Partial<Record<ParamLetter, number>> = {};
  const bare: ParamLetter[] = [];

  WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let wordIndex = 0;

  while ((match = WORD_RE.exec(working)) !== null) {
    const letter = match[1];
    const numStr = match[2];
    if (!letter) continue;

    const hasNumber = numStr !== undefined && numStr !== '' && numStr !== '+' && numStr !== '-';
    const value = hasNumber ? Number(numStr) : 0;

    // G ve M her zaman komuttur. T ise yalnizca satirin ILK sozcuguyse komuttur
    // ("T0" = takim degisimi); aksi halde parametredir ("M104 S200 T0" -> T
    // sicaklik komutunun hedef extruder'i, takim degisimi degil).
    const isCommandWord =
      hasNumber && (letter === 'G' || letter === 'M' || (letter === 'T' && wordIndex === 0));

    wordIndex++;

    if (isCommandWord) {
      // G01 -> G1 normalizasyonu; G90.1 gibi ondalikli kodlar korunur.
      commands.push(`${letter}${value}`);
      continue;
    }

    if (PARAM_LETTERS.includes(letter)) {
      params[letter as ParamLetter] = value;
      if (!hasNumber) bare.push(letter as ParamLetter);
    }
  }

  return {
    commands,
    command: commands[0] ?? null,
    params,
    bare,
    comment,
    lineIndex,
  };
}
