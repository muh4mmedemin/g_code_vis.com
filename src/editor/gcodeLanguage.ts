import { StreamLanguage } from '@codemirror/language';
import type { StringStream } from '@codemirror/language';

/**
 * CodeMirror icin minimal G-code dil tanimi (StreamLanguage yeterli).
 * Token siniflari: komut (G/M/T), parametre harfi, sayi, yorum, satir numarasi.
 */
function token(stream: StringStream): string | null {
  if (stream.eatSpace()) return null;

  if (stream.match(';')) {
    stream.skipToEnd();
    return 'comment';
  }

  if (stream.match('(')) {
    while (!stream.eol() && stream.peek() !== ')') stream.next();
    if (stream.peek() === ')') stream.next();
    return 'comment';
  }

  if (stream.match(/^N\d+/i)) return 'lineNumber';

  if (stream.match(/^[GMT]\d+(\.\d+)?/i)) return 'keyword';

  if (stream.match(/^[XYZEFIJKRSPT](-?\d+\.?\d*|-?\.\d+)/i)) return 'variableName';

  if (stream.match(/^\*\d+/)) return 'number';

  stream.next();
  return null;
}

export function gcodeLanguage() {
  return StreamLanguage.define({ token });
}
