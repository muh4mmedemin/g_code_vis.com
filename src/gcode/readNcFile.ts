/**
 * NC program dosyasini metne cevirir.
 *
 * NEDEN AYRI BIR ADIM: Atolyede dosyanin uzantisi hicbir sey soylemez. Ayni
 * tezgahin programi ".nc", ".dat", ".prt" ya da uzantisiz durabilir; buna
 * karsilik ".prt" cogu zaman CAD MODELIDIR (NX/Creo) ve ikili bir dosyadir.
 * Karar uzantiya degil ICERIGE gore verilir:
 *
 *  - Ikili dosya ise: parse etmeye calismak yerine ne oldugu soylenir.
 *  - Metin ise: kodlama tespit edilir. Tezgahlardan gelen dosyalar cogu zaman
 *    UTF-8 degildir; Turkce yorum satirlari (windows-1254) UTF-8 okunursa
 *    bozulur. Bu, yalnizca yorumlarin gorunumunu etkiler ama kullanici
 *    dosyanin "bozuk" geldigini dusunur.
 */

export interface NcFileReadResult {
  /** Dosyanin metin hali; ikili dosyalarda null. */
  text: string | null;
  /** Kullanilan kodlama adi. */
  encoding: 'utf-8' | 'windows-1254';
  /** Ikili dosyada kullaniciya gosterilecek aciklama. */
  error: string | null;
}

/** Ilk bu kadar byte'a bakilarak ikili/metin karari verilir. */
const SNIFF_BYTES = 8192;

/** NUL byte ve kontrol karakteri orani bu esigi asarsa dosya ikilidir. */
const BINARY_CONTROL_RATIO = 0.05;

/**
 * Ikili mi? NC programlari ASCII'dir; NUL byte tek basina yeterli kanittir
 * (CAD dosyalari, sikistirilmis arsivler ve ofis belgeleri NUL icerir).
 */
function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, SNIFF_BYTES);
  let control = 0;
  for (let i = 0; i < limit; i++) {
    const byte = bytes[i]!;
    if (byte === 0) return true;
    // Tab, LF, CR ve normal yazdirilabilir araligin disi.
    if (byte < 9 || (byte > 13 && byte < 32)) control++;
  }
  return limit > 0 && control / limit > BINARY_CONTROL_RATIO;
}

/** Bilinen ikili dosya imzalari — kullaniciya NE oldugunu soyleyebilmek icin. */
function describeBinary(bytes: Uint8Array, fileName: string): string {
  const ascii = String.fromCharCode(...bytes.slice(0, 64));
  const lower = fileName.toLowerCase();

  if (ascii.startsWith('PK')) {
    return 'Bu bir arsiv/ofis dosyasi (ZIP tabanli), NC programi degil.';
  }
  if (ascii.includes('UGII') || ascii.includes('Unigraphics')) {
    return 'Bu bir Siemens NX parca dosyasi (CAD modeli), NC programi degil.';
  }
  if (ascii.includes('Pro/ENGINEER') || ascii.includes('Creo')) {
    return 'Bu bir Creo/Pro-E parca dosyasi (CAD modeli), NC programi degil.';
  }
  if (ascii.startsWith('%PDF')) return 'Bu bir PDF dosyasi.';
  if (lower.endsWith('.prt')) {
    return (
      'Bu ".prt" dosyasi ikili (metin degil): buyuk olasilikla CAD parca ' +
      'modeli (NX/Creo/SolidWorks). Tezgaha giden NC program dosyasini secin.'
    );
  }
  return 'Dosya metin degil (ikili). NC programi ISO G-code metni olmalidir.';
}

/**
 * Dosyayi okur. Hicbir sey sunucuya gitmez; okuma tarayicida yapilir.
 */
export async function readNcFile(file: File): Promise<NcFileReadResult> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (looksBinary(bytes)) {
    return { text: null, encoding: 'utf-8', error: describeBinary(bytes, file.name) };
  }

  const utf8 = new TextDecoder('utf-8').decode(bytes);
  // Gecersiz UTF-8 dizileri "�" olur. Cok sayida varsa dosya eski bir
  // Windows kod sayfasindadir (tezgah ve CAM ciktilarinda yaygin).
  const replacements = (utf8.match(/�/g) ?? []).length;
  if (replacements > 0 && replacements / Math.max(1, utf8.length) > 0.0005) {
    return {
      text: new TextDecoder('windows-1254').decode(bytes),
      encoding: 'windows-1254',
      error: null,
    };
  }

  return { text: utf8, encoding: 'utf-8', error: null };
}
