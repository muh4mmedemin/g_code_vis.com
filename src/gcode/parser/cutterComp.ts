import type { Move, ParseDiagnostic, Vec3 } from '@/core/types';

/**
 * Kesici yaricap telafisi (G41/G42) — yol kaydirmasi.
 *
 * NEDEN GEREKLI: G41/G42 aktifken programda yazan koordinatlar PARCANIN
 * KENARIDIR, takim merkezi degil. Tezgah bu hatta takim yaricapi kadar
 * solda (G41) veya sagda (G42) yurur. Telafi uygulanmazsa simulasyondan
 * cikan parca her kenarda bir takim yaricapi kadar farkli olur — program
 * "hatasiz" okunur ama urun tutmaz.
 *
 * NEDEN PARSE SONUNDA: Bir hareketin kaydirilmis bitis noktasi, BIR SONRAKI
 * hareketin yonune baglidir (kose birlesimi). Satir satir yorumlanirken bu
 * bilgi henuz yoktur; bu yuzden telafi, hareket listesi tamamlandiktan sonra
 * arali arali uygulanir.
 *
 * MODEL (tezgah davranisi):
 *  - Telafinin ACILDIGI ilk hareket "rampa"dir: programlanan noktadan baslar,
 *    kaydirilmis noktada biter.
 *  - Aradaki tum noktalar kaydirilir.
 *  - G40 ile kapanan hareket programlanan noktaya geri rampalar.
 *  - Dis kosede takim kosenin etrafindan yay cizerek doner (yay araya
 *    eklenir); ic kosede iki kaydirilmis dogrunun kesisimi kullanilir.
 */

/** Parser'in biriktirdigi "su hareketler telafi altindaydi" araligi. */
export interface CompRun {
  side: 'left' | 'right';
  /** D sozcugu (ofset numarasi); yaricap tablosu bununla okunur. */
  d: number | null;
  /** moves dizisinde [start, end) araligi. */
  start: number;
  end: number;
  /** Telafinin acildigi satir — tani mesajlari icin. */
  lineIndex: number;
}

export interface CutterCompOptions {
  /** Kullanicinin secili takiminin yaricapi (mm) — D tablosu yoksa kullanilir. */
  defaultRadius?: number;
  /** Programda G10 L12/L13 ile tanimlanan D no -> yaricap (mm). */
  radiusOffsets?: Map<number, number>;
}

/** Dis kosede yay uzerinde en fazla bu kadar derecelik adim atilir. */
const CORNER_STEP_DEG = 15;
/** Bu uzunlugun altindaki XY yer degistirmesi "yon yok" sayilir. */
const EPSILON = 1e-6;

interface Vec2 {
  x: number;
  y: number;
}

function sub(a: Vec3, b: Vec3): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/** Birim vektorun soluna (CCW 90 derece) dik. */
function leftNormal(v: Vec2): Vec2 {
  const len = length(v);
  if (len < EPSILON) return { x: 0, y: 0 };
  return { x: -v.y / len, y: v.x / len };
}

/**
 * Telafiyi uygular. `moves` YERINDE degistirilir; dis kosede yeni hareketler
 * eklenebilecegi icin yeni dizi dondurulur.
 */
export function applyCutterCompensation(
  moves: Move[],
  runs: CompRun[],
  options: CutterCompOptions,
  diagnostics: ParseDiagnostic[],
): Move[] {
  if (runs.length === 0) return moves;

  let unresolved: CompRun | null = null;
  const inserted = new Map<number, Move[]>(); // hareket indeksi -> oncesine eklenecekler

  for (const run of runs) {
    const radius = resolveRadius(run, options);
    if (radius === undefined || radius <= 0) {
      if (!unresolved) unresolved = run;
      continue;
    }
    offsetRun(moves, run, radius, inserted);
  }

  if (unresolved) {
    diagnostics.push({
      lineIndex: unresolved.lineIndex,
      severity: 'warning',
      code: 'CUTTER_COMP_NO_RADIUS',
      message:
        'Kesici telafisi (G41/G42) aktif ama takim yaricapi bilinmiyor; takim merkez ' +
        'hatti cizildi. Takim capini CNC panelinden girin ya da programda G10 L12 ile ' +
        'tanimlayin — aksi halde parca her kenarda bir yaricap kadar farkli cikar.',
    });
  }

  if (inserted.size === 0) return moves;

  const result: Move[] = [];
  for (let i = 0; i < moves.length; i++) {
    const extra = inserted.get(i);
    if (extra) result.push(...extra);
    const move = moves[i];
    if (move) result.push(move);
  }
  return result;
}

function resolveRadius(run: CompRun, options: CutterCompOptions): number | undefined {
  if (run.d !== null) {
    const fromTable = options.radiusOffsets?.get(run.d);
    if (fromTable !== undefined && fromTable > 0) return fromTable;
  }
  return options.defaultRadius;
}

/**
 * Tek bir telafi araligini kaydirir.
 *
 * Yol noktalari: P0 = ilk hareketin baslangici (rampa; kaydirilmaz),
 * P1..Pn = hareketlerin bitis noktalari (hepsi kaydirilir). Iki hareket
 * arasindaki kose ya "ic" (iki ofset dogrusunun kesisimi) ya da "dis"
 * (kose noktasinin etrafinda yay) olarak birlestirilir.
 */
function offsetRun(
  moves: Move[],
  run: CompRun,
  radius: number,
  inserted: Map<number, Move[]>,
): void {
  const span: Move[] = [];
  for (let i = run.start; i < run.end; i++) {
    const move = moves[i];
    if (move) span.push(move);
  }
  if (span.length === 0) return;

  // Kaydirma hesabi PROGRAMLANAN noktalar uzerinden yapilir; hareketler
  // yerinde degistirildigi icin once kopyalanir.
  const orig = span.map((m) => ({ from: { ...m.from }, to: { ...m.to } }));
  const sign = run.side === 'left' ? 1 : -1;

  /** i. hareketin XY yonu; yalnizca Z inen hareketlerde en yakin yatay yon. */
  const directionAt = (index: number): Vec2 | null => {
    for (let i = index; i < orig.length; i++) {
      const o = orig[i];
      if (!o) continue;
      const dir = sub(o.to, o.from);
      if (length(dir) > EPSILON) return dir;
    }
    for (let i = index - 1; i >= 0; i--) {
      const o = orig[i];
      if (!o) continue;
      const dir = sub(o.to, o.from);
      if (length(dir) > EPSILON) return dir;
    }
    return null;
  };

  /** i. hareketin kenara dik kayma vektoru. */
  const offsets: Vec2[] = orig.map((_, i) => {
    const dir = directionAt(i);
    if (!dir) return { x: 0, y: 0 };
    const n = leftNormal(dir);
    return { x: n.x * radius * sign, y: n.y * radius * sign };
  });

  // Her hareketin baslangic/bitis kaymasi ve koselerin turu.
  const endShift: Vec2[] = [];
  const startShift: Vec2[] = [];
  const outerCorner: boolean[] = [];
  startShift[0] = { x: 0, y: 0 }; // rampa: telafi ilk harekette kurulur

  for (let i = 0; i < orig.length; i++) {
    const own = offsets[i] ?? { x: 0, y: 0 };
    const next = i + 1 < orig.length ? offsets[i + 1] : undefined;
    outerCorner[i] = false;
    if (!next) {
      endShift[i] = own;
      continue;
    }
    const cross = own.x * next.y - own.y * next.x;
    const dot = own.x * next.x + own.y * next.y;

    if (Math.abs(cross) < EPSILON && dot >= 0) {
      // Duz devam: kose yok.
      endShift[i] = own;
      startShift[i + 1] = own;
    } else if (cross * sign < 0) {
      // Dis kose: takim kose noktasinin etrafindan doner.
      endShift[i] = own;
      startShift[i + 1] = next;
      outerCorner[i] = true;
    } else {
      const join = innerJoin(own, next, radius);
      endShift[i] = join;
      startShift[i + 1] = join;
    }
  }

  for (let i = 0; i < span.length; i++) {
    const move = span[i];
    const source = orig[i];
    const from = startShift[i] ?? { x: 0, y: 0 };
    const to = endShift[i] ?? { x: 0, y: 0 };
    if (!move || !source) continue;

    move.from = { x: source.from.x + from.x, y: source.from.y + from.y, z: source.from.z };
    move.to = { x: source.to.x + to.x, y: source.to.y + to.y, z: source.to.z };
    retime(move);

    if (outerCorner[i]) {
      const nextShift = startShift[i + 1] ?? to;
      const arcEnd: Vec3 = {
        x: source.to.x + nextShift.x,
        y: source.to.y + nextShift.y,
        z: source.to.z,
      };
      const arc = cornerArc(move, source.to, move.to, arcEnd, radius);
      if (arc.length > 0) inserted.set(run.start + i + 1, arc);
    }
  }

  // Telafi kapandiktan (G40) sonraki hareket kaydirilmis noktadan baslar:
  // tezgah da programlanan noktaya o harekette geri rampalar.
  const last = span[span.length - 1];
  const after = moves[run.end];
  if (last && after) {
    after.from = { ...last.to };
    retime(after);
  }
}

/** Kaydirma sonrasi uzunlugu ve suresini yeniden hesaplar. */
function retime(move: Move): void {
  move.distance = Math.hypot(
    move.to.x - move.from.x,
    move.to.y - move.from.y,
    move.to.z - move.from.z,
  );
  if (move.f > 0) move.duration = (move.distance / move.f) * 60;
}

/**
 * Ic kose: iki kaydirilmis dogrunun kesisim noktasinin kose noktasina gore
 * kayma vektoru. Bisektor uzerinde, |r| / cos(yarim aci) uzakliktadir.
 */
function innerJoin(incoming: Vec2, outgoing: Vec2, radius: number): Vec2 {
  const bisector = { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y };
  const bisectorLength = length(bisector);
  if (bisectorLength < EPSILON) return incoming; // 180 derece donus
  const cosHalf = bisectorLength / (2 * radius);
  if (cosHalf < 1e-3) return incoming; // cok dar kose: kesisim cok uzakta
  const scale = radius / cosHalf;
  return { x: (bisector.x / bisectorLength) * scale, y: (bisector.y / bisectorLength) * scale };
}

/**
 * Dis kosede kose noktasi etrafinda donen yay segmentleri: takim kenardan
 * ayrilmadan donerken merkezi bu yayi cizer.
 */
function cornerArc(
  template: Move,
  corner: Vec2,
  fromPoint: Vec3,
  toPoint: Vec3,
  radius: number,
): Move[] {
  const startAngle = Math.atan2(fromPoint.y - corner.y, fromPoint.x - corner.x);
  const endAngle = Math.atan2(toPoint.y - corner.y, toPoint.x - corner.x);
  let sweep = endAngle - startAngle;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  if (Math.abs(sweep) < 1e-4) return [];

  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ((CORNER_STEP_DEG * Math.PI) / 180)));
  const out: Move[] = [];
  let cursor: Vec3 = fromPoint;
  for (let n = 1; n <= steps; n++) {
    const angle = startAngle + (sweep * n) / steps;
    const point: Vec3 =
      n === steps
        ? { ...toPoint }
        : {
            x: corner.x + Math.cos(angle) * radius,
            y: corner.y + Math.sin(angle) * radius,
            z: fromPoint.z,
          };
    const distance = Math.hypot(point.x - cursor.x, point.y - cursor.y, point.z - cursor.z);
    out.push({
      ...template,
      from: cursor,
      to: point,
      e: 0,
      distance,
      duration: template.f > 0 ? (distance / template.f) * 60 : 0,
    });
    cursor = point;
  }
  return out;
}
