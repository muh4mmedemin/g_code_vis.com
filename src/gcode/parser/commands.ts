import { numericParam, type GcodeToken } from './tokenizer';
import type { CannedCycleState, MachineState } from './machineState';
import { createIdentityTransform, feedDuration, toMillimeters } from './machineState';
import type { Move, MoveKind, ParseDiagnostic, Vec3 } from '@/core/types';
import { segmentArc } from './arcs';

/**
 * Komut handler kayit defteri (registry).
 *
 * Yeni bir G/M kodu desteklemek icin: bir handler yaz, COMMAND_HANDLERS'a ekle.
 * Parser'in govdesini degistirmek gerekmez.
 *
 * Katman indeksi burada BELIRLENMEZ: hareketler layerIndex=0 ile uretilir,
 * katman sinirlari parse sonunda (index.ts) extrusion ve slicer yorumlarina
 * bakilarak atanir — boylece Z-hop sahte katman uretmez.
 */

export interface HandlerContext {
  state: MachineState;
  /** Uretilen hareketi cikti akisina yazar. */
  emitMove: (move: Move) => void;
  diagnostic: (d: Omit<ParseDiagnostic, 'lineIndex'>) => void;
}

export type CommandHandler = (token: GcodeToken, ctx: HandlerContext) => void;

/** Bir eksenin yeni mutlak degerini modal positioning'e gore hesaplar. */
function resolveAxis(
  paramValue: number | undefined,
  current: number,
  positioning: 'absolute' | 'relative',
  unit: MachineState['unit'],
): number {
  if (paramValue === undefined) return current;
  const mm = toMillimeters(paramValue, unit);
  return positioning === 'relative' ? current + mm : mm;
}

/** Hedef E degerini ve bu hareketteki delta'yi hesaplar (state'i DEGISTIRMEZ). */
function resolveExtrusion(token: GcodeToken, state: MachineState): { newE: number; delta: number } {
  if (token.params.E === undefined) return { newE: state.e, delta: 0 };
  const eMm = toMillimeters(token.params.E, state.unit);
  const newE = state.ePositioning === 'relative' ? state.e + eMm : eMm;
  return { newE, delta: newE - state.e };
}

function classifyMove(distance: number, deltaE: number): MoveKind {
  if (distance === 0 && deltaE !== 0) return 'retract';
  if (deltaE > 0) return 'extrude';
  return 'travel';
}

function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/**
 * Makine koordinatli referans donusu (G53 blogu, G28/G30 reference return).
 *
 * NEDEN AYRI: Bu hareketlerin hedefi MAKINE sifirina goredir; is sifirinin
 * makineye gore nerede oldugu dosyada yazmaz. Hedefi is koordinati sanip
 * cizmek, "G53 G0 Z0" / "G91 G28 Z0." gibi program sonu geri cekilmelerini
 * parcanin icine dalan bir hareket gibi gosterir (tipik CAM ciktilarinda her
 * takim degisiminde bir tane vardir; takim yolu bu yuzden "bozuk" gorunur).
 *
 * Bunun yerine, bilinen tek guvenli yukseklige — programin kendi kullandigi
 * en yuksek Z'ye — cikis olarak cizilir; XY hic oynatilmaz. Hicbir zaman
 * ASAGI inmez.
 */
function referenceRetract(token: GcodeToken, ctx: HandlerContext): void {
  const { state } = ctx;
  const targetZ = Math.max(state.position.z, state.maxZ);
  if (targetZ - state.position.z <= 1e-9) return;

  const from: Vec3 = { ...state.position };
  const to: Vec3 = { x: from.x, y: from.y, z: targetZ };
  const distance = distanceBetween(from, to);
  state.position = to;

  ctx.emitMove({
    lineIndex: token.lineIndex,
    kind: 'home',
    from,
    to,
    e: 0,
    f: state.feedrate,
    layerIndex: 0,
    tool: state.tool,
    rapid: true,
    distance,
    duration: 0,
  });
}

/** G0/G1 — dogrusal hareket. `rapid` yalnizca G0 icin true'dur. */
function linearMove(rapid: boolean): CommandHandler {
  return (token, ctx) => {
  const { state } = ctx;
  // Hareket komutu modaldir: sonraki komutsuz satirlar bunu tekrarlar.
  state.motionMode = rapid ? 'G0' : 'G1';
  state.cannedCycle = null;

  // Ayni satirda G53 varsa koordinatlar MAKINE sifirina goredir.
  if (state.machineCoordBlock) {
    referenceRetract(token, ctx);
    return;
  }

  const from: Vec3 = { ...state.position };

  const to: Vec3 = {
    x: resolveAxis(token.params.X, state.position.x, state.positioning, state.unit),
    y: resolveAxis(token.params.Y, state.position.y, state.positioning, state.unit),
    z: resolveAxis(token.params.Z, state.position.z, state.positioning, state.unit),
  };

  const feed = numericParam(token, 'F');
  if (feed !== undefined) {
    state.feedrate = toMillimeters(feed, state.unit);
  }

  const { newE, delta: deltaE } = resolveExtrusion(token, state);
  state.e = newE;

  const distance = distanceBetween(from, to);
  state.position = to;

  ctx.emitMove({
    lineIndex: token.lineIndex,
    kind: classifyMove(distance, deltaE),
    from,
    to,
    e: deltaE,
    f: state.feedrate,
    layerIndex: 0,
    tool: state.tool,
    rapid,
    distance,
    duration: feedDuration(state, distance),
  });
  };
}

/** G2 (saat yonu) / G3 (saat yonunun tersi) — yay hareketi. */
function handleArcMove(clockwise: boolean): CommandHandler {
  return (token, ctx) => {
    const { state } = ctx;
    state.motionMode = clockwise ? 'G2' : 'G3';
    state.cannedCycle = null;
    const from: Vec3 = { ...state.position };

    const to: Vec3 = {
      x: resolveAxis(token.params.X, state.position.x, state.positioning, state.unit),
      y: resolveAxis(token.params.Y, state.position.y, state.positioning, state.unit),
      z: resolveAxis(token.params.Z, state.position.z, state.positioning, state.unit),
    };

    const feed = numericParam(token, 'F');
    if (feed !== undefined) {
      state.feedrate = toMillimeters(feed, state.unit);
    }

    const hasOffset =
      token.params.I !== undefined || token.params.J !== undefined || token.params.K !== undefined;

    const arc = segmentArc({
      from,
      to,
      plane: state.plane,
      clockwise,
      offset: hasOffset
        ? {
            i: token.params.I !== undefined ? toMillimeters(token.params.I, state.unit) : undefined,
            j: token.params.J !== undefined ? toMillimeters(token.params.J, state.unit) : undefined,
            k: token.params.K !== undefined ? toMillimeters(token.params.K, state.unit) : undefined,
          }
        : undefined,
      offsetMode: state.arcDistanceMode,
      radius:
        token.params.R !== undefined ? toMillimeters(token.params.R, state.unit) : undefined,
    });

    if (arc) {
      // Kontrol uniteleri, baslangic ve bitis yaricapi tutmadiginda alarm
      // verir. Biz yayi baslangic yaricapiyla cizip kullaniciyi uyaririz:
      // sessizce bozuk bir yay cizmek, hatayi gorunmez kilar.
      const tolerance = Math.max(0.01, arc.radiusStart * 0.001);
      if (Math.abs(arc.radiusStart - arc.radiusEnd) > tolerance) {
        ctx.diagnostic({
          severity: 'warning',
          code: 'ARC_RADIUS_MISMATCH',
          message:
            `Yay yaricapi tutarsiz: baslangicta ${arc.radiusStart.toFixed(3)} mm, ` +
            `bitiste ${arc.radiusEnd.toFixed(3)} mm. I/J/K degerlerini kontrol edin ` +
            '(tezgah bu satirda alarm verebilir).',
        });
      }
    }

    const { newE, delta: totalDeltaE } = resolveExtrusion(token, state);
    state.e = newE;

    if (!arc || arc.points.length === 0) {
      // Gecersiz yay tanimi: duz cizgi olarak isle, kullaniciyi uyar.
      ctx.diagnostic({
        severity: 'warning',
        code: 'INVALID_ARC',
        message: 'Yay tanimi cozulemedi (I/J/K veya R eksik/gecersiz); duz cizgi cizildi.',
      });
      const distance = distanceBetween(from, to);
      state.position = to;
      ctx.emitMove({
        lineIndex: token.lineIndex,
        kind: classifyMove(distance, totalDeltaE),
        from,
        to,
        e: totalDeltaE,
        f: state.feedrate,
        layerIndex: 0,
        tool: state.tool,
        rapid: false,
        distance,
        duration: feedDuration(state, distance),
      });
      return;
    }

    // Yay, dogru parcalarina bolunur; E ve sure parcalar arasinda uzunluga
    // gore dagitilir.
    const segmentCount = arc.points.length;
    let cursor: Vec3 = from;
    for (let n = 0; n < segmentCount; n++) {
      const point = arc.points[n];
      if (!point) continue;
      const distance = distanceBetween(cursor, point);
      const deltaE = totalDeltaE / segmentCount;
      ctx.emitMove({
        lineIndex: token.lineIndex,
        kind: classifyMove(distance, deltaE),
        from: cursor,
        to: point,
        e: deltaE,
        f: state.feedrate,
        layerIndex: 0,
        tool: state.tool,
        rapid: false,
        distance,
        duration: feedDuration(state, distance),
      });
      cursor = point;
    }

    state.position = { ...cursor };
  };
}

/**
 * G28 — home / referans donusu.
 *
 * Iki farkli dunyada ayni kod iki farkli sey demektir:
 *  - 3B yazicida (G90 ile) "G28 X Y" eksenleri is sifirina, yani 0'a goturur.
 *  - CNC tezgahinda tipik yazim "G91 G28 Z0." seklindedir ve MAKINE referans
 *    noktasina (tablanin en ustune) donustur; is koordinatinda 0'a gitmek
 *    degildir. Artimli modu olcut aliyoruz: bu yazim yalnizca CNC post
 *    ciktilarinda gorulur.
 */
function handleHome(token: GcodeToken, ctx: HandlerContext): void {
  const { state } = ctx;
  if (state.positioning === 'relative' || state.machineCoordBlock) {
    referenceRetract(token, ctx);
    return;
  }
  const from: Vec3 = { ...state.position };
  const hasAxisParam =
    token.params.X !== undefined || token.params.Y !== undefined || token.params.Z !== undefined;

  const to: Vec3 = {
    x: !hasAxisParam || token.params.X !== undefined ? 0 : state.position.x,
    y: !hasAxisParam || token.params.Y !== undefined ? 0 : state.position.y,
    z: !hasAxisParam || token.params.Z !== undefined ? 0 : state.position.z,
  };

  const distance = distanceBetween(from, to);
  state.position = to;

  ctx.emitMove({
    lineIndex: token.lineIndex,
    kind: 'home',
    from,
    to,
    e: 0,
    f: state.feedrate,
    layerIndex: 0,
    tool: state.tool,
    rapid: true,
    distance,
    duration: 0,
  });
}

/**
 * G30 — ikinci/ucuncu referans noktasina donus (yalnizca CNC).
 * Hedef makine koordinatidir; G28'in CNC yazimiyla ayni sekilde ele alinir.
 */
function handleSecondReference(token: GcodeToken, ctx: HandlerContext): void {
  referenceRetract(token, ctx);
}

/** Verilen eksen sozcugunu mm'ye cevirir (yoksa undefined). */
function axisMm(token: GcodeToken, letter: 'X' | 'Y' | 'Z', state: MachineState): number | undefined {
  const value = numericParam(token, letter);
  return value === undefined ? undefined : toMillimeters(value, state.unit);
}

/**
 * G52 — yerel koordinat sistemi kaymasi.
 * "G52 X50 Y0" sonrasi programlanan her koordinat 50 mm saga kayar; "G52 X0"
 * iptal eder. Ayni programla ayni parcayi tablanin baska bir yerinde islemek
 * icin kullanilir.
 */
function handleLocalOffset(token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.transformVersion++;
  const t = ctx.state.transform;
  const x = axisMm(token, 'X', ctx.state);
  const y = axisMm(token, 'Y', ctx.state);
  const z = axisMm(token, 'Z', ctx.state);
  if (x !== undefined) t.offset.x = x;
  if (y !== undefined) t.offset.y = y;
  if (z !== undefined) t.offset.z = z;
}

/** G68 — koordinat dondurme (R = derece, merkez X/Y aktif duzlemde). */
function handleRotationOn(token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.transformVersion++;
  const { state } = ctx;
  const t = state.transform;
  const angle = numericParam(token, 'R');
  if (angle === undefined) {
    ctx.diagnostic({
      severity: 'warning',
      code: 'ROTATION_NO_ANGLE',
      message: 'G68 dondurme acisi (R) verilmemis; dondurme uygulanmadi.',
    });
    return;
  }
  t.rotationDeg = angle;
  t.rotationPlane = state.plane;
  t.rotationCenter = {
    x: axisMm(token, 'X', state) ?? state.position.x,
    y: axisMm(token, 'Y', state) ?? state.position.y,
    z: axisMm(token, 'Z', state) ?? state.position.z,
  };
}

/** G69 — dondurmeyi iptal eder. */
function handleRotationOff(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.transformVersion++;
  ctx.state.transform.rotationDeg = 0;
}

/** G51 — olcekleme (P: tum eksenler, X/Y/Z: eksen basina carpan). */
function handleScalingOn(token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.transformVersion++;
  const { state } = ctx;
  const t = state.transform;
  t.scaleCenter = {
    x: axisMm(token, 'X', state) ?? 0,
    y: axisMm(token, 'Y', state) ?? 0,
    z: axisMm(token, 'Z', state) ?? 0,
  };
  // Fanuc'ta P olcek carpani 1/1000 birimindedir: P2000 = 2 kat.
  const p = numericParam(token, 'P');
  const factor = p !== undefined ? (Math.abs(p) > 100 ? p / 1000 : p) : undefined;
  const i = numericParam(token, 'I');
  const j = numericParam(token, 'J');
  const k = numericParam(token, 'K');
  const perAxis = (value: number | undefined): number | undefined =>
    value === undefined ? undefined : Math.abs(value) > 100 ? value / 1000 : value;

  t.scale = {
    x: perAxis(i) ?? factor ?? 1,
    y: perAxis(j) ?? factor ?? 1,
    z: perAxis(k) ?? factor ?? 1,
  };

  if (t.scale.x === 0 || t.scale.y === 0 || t.scale.z === 0) {
    ctx.diagnostic({
      severity: 'error',
      code: 'SCALING_ZERO',
      message: 'G51 olcek carpani 0; olcekleme yok sayildi.',
    });
    t.scale = { x: 1, y: 1, z: 1 };
  }
}

/** G50 — olceklemeyi iptal eder. */
function handleScalingOff(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.transformVersion++;
  ctx.state.transform.scale = { x: 1, y: 1, z: 1 };
}

/**
 * G51.1 — programlanabilir ayna. "G51.1 X0" X=0 duzlemine gore aynalar.
 * Eslesen parca ciftleri (ERKEK/DISI, sag/sol) genelde boyle uretilir.
 */
function handleMirrorOn(token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.transformVersion++;
  const { state } = ctx;
  const t = state.transform;
  const x = axisMm(token, 'X', state);
  const y = axisMm(token, 'Y', state);
  const z = axisMm(token, 'Z', state);
  if (x !== undefined) { t.mirror.x = -1; t.mirrorCenter.x = x; }
  if (y !== undefined) { t.mirror.y = -1; t.mirrorCenter.y = y; }
  if (z !== undefined) { t.mirror.z = -1; t.mirrorCenter.z = z; }
}

/** G50.1 — aynayi iptal eder (eksen verilirse yalnizca o ekseni). */
function handleMirrorOff(token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.transformVersion++;
  const t = ctx.state.transform;
  const hasAxis =
    numericParam(token, 'X') !== undefined ||
    numericParam(token, 'Y') !== undefined ||
    numericParam(token, 'Z') !== undefined;
  if (!hasAxis) {
    t.mirror = { x: 1, y: 1, z: 1 };
    return;
  }
  if (numericParam(token, 'X') !== undefined) t.mirror.x = 1;
  if (numericParam(token, 'Y') !== undefined) t.mirror.y = 1;
  if (numericParam(token, 'Z') !== undefined) t.mirror.z = 1;
}

/**
 * G10 — ofset tablosuna yazar.
 * Yalnizca yaricap tablosunu (L12 kesici / L13 asinma) okuyoruz: kesici
 * telafisi bu degerlerle hesaplanir. Is sifiri yazan L2/L20 satirlari
 * parcanin sekline degil yalnizca yerine etki ettigi icin yok sayilir.
 */
function handleOffsetTableWrite(token: GcodeToken, ctx: HandlerContext): void {
  const { state } = ctx;
  const l = numericParam(token, 'L');
  if (l !== 12 && l !== 13) return;
  const p = numericParam(token, 'P');
  const r = numericParam(token, 'R');
  if (p === undefined || r === undefined) return;
  const radius = toMillimeters(r, state.unit);
  if (l === 12) state.radiusOffsets.set(p, radius);
  else state.radiusOffsets.set(p, (state.radiusOffsets.get(p) ?? 0) + radius);
}

function handleAbsolutePositioning(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.positioning = 'absolute';
  ctx.state.positioningDeclared = true;
  // M82/M83 gorulmediyse E ekseni de G90/G91'i izler (Marlin/RRF davranisi).
  if (!ctx.state.eModeExplicit) ctx.state.ePositioning = 'absolute';
}

function handleRelativePositioning(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.positioning = 'relative';
  ctx.state.positioningDeclared = true;
  if (!ctx.state.eModeExplicit) ctx.state.ePositioning = 'relative';
}

/** G92 — pozisyon reset. Parametresiz cagri tum eksenleri sifirlar. */
function handleSetPosition(token: GcodeToken, ctx: HandlerContext): void {
  const { state } = ctx;
  const { X, Y, Z, E } = token.params;
  const noParams = X === undefined && Y === undefined && Z === undefined && E === undefined;

  if (noParams) {
    state.position = { x: 0, y: 0, z: 0 };
    state.e = 0;
    return;
  }

  if (X !== undefined) state.position.x = toMillimeters(X, state.unit);
  if (Y !== undefined) state.position.y = toMillimeters(Y, state.unit);
  if (Z !== undefined) state.position.z = toMillimeters(Z, state.unit);
  if (E !== undefined) state.e = toMillimeters(E, state.unit);
}

/** G4 — bekleme. P milisaniye, S saniye cinsindendir. */
function handleDwell(token: GcodeToken, ctx: HandlerContext): void {
  const { state } = ctx;
  if (token.params.S !== undefined) state.dwellSeconds += token.params.S;
  else if (token.params.P !== undefined) state.dwellSeconds += token.params.P / 1000;
}

function handleUnitsMm(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.unit = 'mm';
  ctx.state.unitsDeclared = true;
}

function handleUnitsInch(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.unit = 'inch';
  ctx.state.unitsDeclared = true;
}

function handleEAbsolute(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.ePositioning = 'absolute';
  ctx.state.eModeExplicit = true;
}

function handleERelative(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.ePositioning = 'relative';
  ctx.state.eModeExplicit = true;
}

function setPlane(plane: MachineState['plane']): CommandHandler {
  return (_token, ctx) => {
    ctx.state.plane = plane;
  };
}

/** T0/T1... — takim (extruder) degisimi. */
function handleToolChange(token: GcodeToken, ctx: HandlerContext): void {
  const command = token.commands.find((c) => c.startsWith('T'));
  if (!command) return;
  const index = Number(command.slice(1));
  if (Number.isFinite(index)) ctx.state.tool = index;
}

/**
 * M6 — takim degisimi (CNC).
 *
 * NEDEN AYRI: CNC post-processor'lari takimi cogunlukla "M6 T1" sirasiyla
 * yazar. Bu bicimde T ilk sozcuk olmadigi icin tokenizer onu komut degil
 * parametre sayar; takim numarasi buradan okunur. "T1 M6" bicimi ise
 * handleToolChange tarafindan zaten karsilanir.
 */
function handleToolChangeM6(token: GcodeToken, ctx: HandlerContext): void {
  if (token.params.T === undefined) return;
  const index = token.params.T;
  if (Number.isFinite(index)) ctx.state.tool = index;
}

function handleSpindleOn(token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.spindleOn = true;
  // S degeri G95 (mm/devir) suresi icin gerekir.
  if (token.params.S !== undefined && token.params.S > 0) {
    ctx.state.spindleRpm = token.params.S;
  }
}

/** G93/G94/G95 — F degerinin anlamini degistirir (bkz. feedDuration). */
function setFeedMode(mode: MachineState['feedMode']): CommandHandler {
  return (_token, ctx) => {
    ctx.state.feedMode = mode;
  };
}

function handleSpindleOff(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.spindleOn = false;
}

/** G90.1 / G91.1 — yay merkezinin (I/J/K) mutlak mi ofset mi oldugu. */
function setArcDistanceMode(mode: MachineState['arcDistanceMode']): CommandHandler {
  return (_token, ctx) => {
    ctx.state.arcDistanceMode = mode;
  };
}

/** G98/G99 — delme cevrimi sonrasi donulecek duzlem. */
function setRetractMode(mode: MachineState['retractMode']): CommandHandler {
  return (_token, ctx) => {
    ctx.state.retractMode = mode;
  };
}

/** G80 — aktif delme cevrimini iptal eder. */
function handleCancelCycle(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.cannedCycle = null;
  // Cevrim iptal edildikten sonra yeni bir hareket komutu gelene kadar
  // modal hareket yoktur (aksi halde sonraki X/Y satirlari delik delmeye
  // devam ederdi).
  ctx.state.motionMode = null;
}

/**
 * Delme cevrimleri (canned cycles): G81, G82, G83, G73, G85, G86, G89.
 *
 * NEDEN ONEMLI: Gercek CNC programlarinda vida/pim delikleri neredeyse her
 * zaman bu cevrimlerle delinir. Cevrim tek satirdir ("G83 X10 Y20 Z-15 R2
 * Q3 F120") ama tezgahta ONLARCA hareket uretir. Bu kodlar desteklenmezse
 * delikler ne cizilir ne de simulasyonda malzemeden talas kaldirir.
 *
 * Cevrim MODAL'dir: kendisinden sonraki her X/Y satiri ayni delmeyi yeni
 * koordinatta tekrarlar; G80 iptal eder.
 */
function cannedCycle(command: string): CommandHandler {
  return (token, ctx) => {
    const { state } = ctx;
    const prev = state.cannedCycle;
    const relative = state.positioning === 'relative';

    const feed = numericParam(token, 'F');
    if (feed !== undefined) {
      state.feedrate = toMillimeters(feed, state.unit);
    }

    // Cevrim baslamadan onceki Z (G98'de buraya donulur) yalnizca cevrimin
    // ILK satirinda belirlenir; tekrarlarda korunur.
    const initialZ = prev ? prev.initialZ : state.position.z;

    const qRaw =
      token.params.Q !== undefined ? toMillimeters(token.params.Q, state.unit) : undefined;
    const q = Math.abs(qRaw ?? prev?.q ?? 0);
    const dwell = token.params.P ?? prev?.dwell ?? 0;

    const needsPeck = command === 'G83' || command === 'G73';
    // Kilavuz cevrimi: adim (Q) verilse bile gagalama yapmaz, tek pasoda iner.
    const isTapping = command === 'G84' || command === 'G74';
    if (needsPeck && !isTapping && q <= 0) {
      ctx.diagnostic({
        severity: 'warning',
        code: 'CANNED_CYCLE_NO_Q',
        message: `${command} gagalama adimi (Q) verilmemis; tek pasoda delindi.`,
      });
    }

    /**
     * L/K tekrar sayisi. G91'de her tekrar, X/Y artislari kadar kayarak yeni
     * bir delik acar — bir sira delik tek satirda bu sekilde programlanir.
     * G90'da tekrar ayni deligi yeniden delmek olurdu; Fanuc bu durumda L'yi
     * dikkate almaz, biz de almiyoruz.
     */
    const repeatParam = token.params.L ?? token.params.K;
    const repeats = relative
      ? Math.min(1000, Math.max(1, Math.floor(repeatParam ?? 1)))
      : 1;

    const step = (to: Vec3, rapid: boolean): void => {
      const from: Vec3 = { ...state.position };
      const distance = distanceBetween(from, to);
      state.position = { ...to };
      if (distance === 0) return;
      ctx.emitMove({
        lineIndex: token.lineIndex,
        kind: rapid ? 'travel' : 'extrude',
        from,
        to: { ...to },
        e: 0,
        f: state.feedrate,
        layerIndex: 0,
        tool: state.tool,
        rapid,
        distance,
        duration: feedDuration(state, distance),
      });
    };

    // R ve Z duzlemleri cevrimin BASINDAKI seviyeye gore bir kez cozulur.
    // Tekrarlarda (L) takim ayni duzleme geri dondugu icin bu degerler
    // degismez; dongu icinde yeniden hesaplanirsa her delik bir oncekinden
    // daha derine iner (yanlis).
    const rParam =
      token.params.R !== undefined ? toMillimeters(token.params.R, state.unit) : undefined;
    const r = rParam !== undefined ? (relative ? state.position.z + rParam : rParam) : prev?.r;

    const zParam =
      token.params.Z !== undefined ? toMillimeters(token.params.Z, state.unit) : undefined;
    // G91'de Z, R duzleminden itibaren olculur (Fanuc/LinuxCNC davranisi).
    const zBottom =
      zParam !== undefined ? (relative ? (r ?? state.position.z) + zParam : zParam) : prev?.z;

    if (r === undefined || zBottom === undefined) {
      ctx.diagnostic({
        severity: 'error',
        code: 'CANNED_CYCLE_INCOMPLETE',
        message: `${command} cevrimi eksik: R (guvenlik duzlemi) ve Z (delik dibi) gerekli.`,
      });
      return;
    }

    for (let n = 0; n < repeats; n++) {
      // Artimli modda her tekrar bir onceki DELIGIN XY'sinden kayar.
      const x = resolveAxis(token.params.X, state.position.x, state.positioning, state.unit);
      const y = resolveAxis(token.params.Y, state.position.y, state.positioning, state.unit);

      if (n === 0 && zBottom > r) {
        ctx.diagnostic({
          severity: 'warning',
          code: 'CANNED_CYCLE_Z_ABOVE_R',
          message: `${command}: delik dibi (Z${zBottom}) guvenlik duzleminin (R${r}) ustunde; delme olusmaz.`,
        });
      }

      // 1) Guvenli yukseklige cik (takim R duzleminin altindaysa) ve XY'ye git.
      if (state.position.z < r) step({ x: state.position.x, y: state.position.y, z: r }, true);
      step({ x, y, z: state.position.z }, true);
      // 2) R duzlemine hizli in.
      step({ x, y, z: r }, true);

      // 3) Delme.
      if (needsPeck && !isTapping && q > 0) {
        let depth = r;
        while (depth > zBottom + 1e-9) {
          const next = Math.max(zBottom, depth - q);
          step({ x, y, z: next }, false);
          if (next <= zBottom + 1e-9) break;
          if (command === 'G83') {
            // Tam geri cekilme: talas bosaltma.
            step({ x, y, z: r }, true);
            // Bir onceki derinligin hemen ustune hizli don.
            step({ x, y, z: Math.min(r, next + 0.5) }, true);
          } else {
            // G73: yalnizca talas kirma icin kisa geri cekilme.
            step({ x, y, z: Math.min(r, next + Math.min(q, 1)) }, true);
          }
          depth = next;
        }
      } else {
        step({ x, y, z: zBottom }, false);
      }

      // 4) Dipte bekleme (G82/G89). P saniye kabul edilir (LinuxCNC davranisi).
      if ((command === 'G82' || command === 'G89' || command === 'G88') && dwell > 0) {
        state.dwellSeconds += dwell;
      }

      // 5) Geri cekilme. G85/G89 isleme feed'iyle cikar (raybalama/bore).
      // Kilavuz (G84/G74) ve raybalama/bara (G85/G89/G76/G88) geri cikisi
    // ISLEME ilerlemesiyle yapar; matkap cevrimleri hizli cikar.
    const feedOut =
      command === 'G85' || command === 'G89' || command === 'G84' ||
      command === 'G74' || command === 'G88' || command === 'G76';
      step({ x, y, z: r }, !feedOut);
      if (state.retractMode === 'initial' && initialZ > r) {
        step({ x, y, z: initialZ }, true);
      }

    }

    const cycleState: CannedCycleState = { command, z: zBottom, r, q, dwell, initialZ };
    state.cannedCycle = cycleState;
    state.motionMode = command;
  };
}

function noop(): void {}

/**
 * Geometriyi etkilemeyen, bilincli olarak yok sayilan komutlar.
 * Bunlar "bilinmeyen komut" uyarisi uretmemeli — gercek bir slicer ciktisinda
 * yuzlercesi bulunur ve uyari listesini anlamsizca doldururlar.
 */
const IGNORED_COMMANDS = [
  // Sicaklik / fan / motor / ekran
  'M104', 'M109', 'M140', 'M190', 'M191', 'M106', 'M107', 'M84', 'M18',
  'M17', 'M117', 'M118', 'M73', 'M201', 'M203', 'M204', 'M205', 'M220',
  'M221', 'M400', 'M420', 'M500', 'M501', 'M502', 'M900', 'M905',
  // Program akisi
  'M0', 'M1', 'M2', 'M30', 'M108', 'M110',
  // CNC: is mili / sogutma / program
  'M7', 'M8', 'M9',
  // Is koordinat sistemleri ve telafi (geometriyi kabaca etkilemez)
  'G54', 'G55', 'G56', 'G57', 'G58', 'G59',
  'G43', 'G44', 'G49', 'G60', 'G61', 'G63', 'G64', 'G9',
  // Genisletilmis is sifirlari ve makro cagrilari: geometriyi dogrudan
  // uretmezler (makro govdesi dosyada yoksa hesaplanamaz da).
  'G54.1', 'G65', 'G66', 'G67',
  'G92.1', 'G92.2', 'G92.3',
  // Program akisi / alt program: index.ts akis kontrolunde ele alinir.
  'M98', 'M99',
] as const;

/**
 * G41/G42 — kesici yaricap telafisi.
 *
 * Tezgah, programlanan hattin SAGINA/SOLUNA takim yaricapi kadar kayar. Bu
 * kaymayi simule etmiyoruz (takim merkez hatti cizilir), ama sessiz kalmak
 * yaniltici olur: parcanin gercekte 1 takim yaricapi daha buyuk/kucuk
 * cikacagini kullanici bilmeli.
 */
/**
 * G53 — bu satir icin MAKINE koordinat sistemi.
 *
 * Tezgahta "G53 G0 Z0" takimi en ust noktaya cekmektir; is sifirina gore
 * yorumlanirsa ayni satir parcanin ust yuzeyine dalmak gibi gorunur. Makine
 * sifirinin nerede oldugunu dosyadan bilemeyiz, bu yuzden hareketi is
 * koordinatiyla cizip kullaniciyi bir kez uyaririz.
 */
function handleMachineCoordinates(_token: GcodeToken, ctx: HandlerContext): void {
  // G53 modal DEGILDIR: yalnizca bu blokta gecerli (index.ts her satir sonunda
  // bayragi temizler).
  ctx.state.machineCoordBlock = true;
  if (ctx.state.machineCoordReported) return;
  ctx.state.machineCoordReported = true;
  ctx.diagnostic({
    severity: 'warning',
    code: 'MACHINE_COORDINATES',
    message:
      'G53 makine koordinati kullaniliyor; makine sifiri bilinmedigi icin bu hareketler ' +
      'gercek hedeflerine degil, programin en yuksek Z seviyesine geri cekilme olarak cizildi.',
  });
}

/**
 * G41/G42 — kesici yaricap telafisi ACIK.
 *
 * Tezgah, programlanan hattin SOLUNA (G41) / SAGINA (G42) takim yaricapi
 * kadar kayarak isler: programlanan cizgi parcanin KENARIDIR, takim merkezi
 * degil. Telafi yok sayilirsa simulasyondan parca her kenarda bir takim
 * yaricapi kadar farkli cikar. Burada yalnizca durum kaydedilir; yol
 * kaydirmasi parse sonunda uygulanir (cutterComp.ts).
 */
function handleCutterComp(token: GcodeToken, ctx: HandlerContext): void {
  const { state } = ctx;
  const which = token.commands.find((c) => c === 'G41' || c === 'G42') ?? 'G41';
  state.cutterComp = which === 'G41' ? 'left' : 'right';
  const d = numericParam(token, 'D');
  if (d !== undefined) state.cutterCompD = d;
}

/** G40 — kesici telafisini kapatir. */
function handleCutterCompOff(_token: GcodeToken, ctx: HandlerContext): void {
  ctx.state.cutterComp = null;
}

export const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  // Hareket
  G0: linearMove(true),
  G1: linearMove(false),
  G2: handleArcMove(true),
  G3: handleArcMove(false),
  G28: handleHome,
  G30: handleSecondReference,
  G4: handleDwell,
  // Modal durum
  G90: handleAbsolutePositioning,
  G91: handleRelativePositioning,
  G92: handleSetPosition,
  G20: handleUnitsInch,
  G21: handleUnitsMm,
  G17: setPlane('XY'),
  G18: setPlane('XZ'),
  G19: setPlane('YZ'),
  M82: handleEAbsolute,
  M83: handleERelative,
  'G90.1': setArcDistanceMode('absolute'),
  'G91.1': setArcDistanceMode('incremental'),
  // CNC: is mili ve delme cevrimleri
  M3: handleSpindleOn,
  M4: handleSpindleOn,
  M5: handleSpindleOff,
  M6: handleToolChangeM6,
  G53: handleMachineCoordinates,
  G40: handleCutterCompOff,
  G41: handleCutterComp,
  G42: handleCutterComp,
  G52: handleLocalOffset,
  G68: handleRotationOn,
  G69: handleRotationOff,
  G51: handleScalingOn,
  G50: handleScalingOff,
  'G51.1': handleMirrorOn,
  'G50.1': handleMirrorOff,
  G10: handleOffsetTableWrite,
  G93: setFeedMode('inverseTime'),
  G94: setFeedMode('perMinute'),
  G95: setFeedMode('perRevolution'),
  G98: setRetractMode('initial'),
  G99: setRetractMode('rPlane'),
  G80: handleCancelCycle,
  G81: cannedCycle('G81'),
  G82: cannedCycle('G82'),
  G83: cannedCycle('G83'),
  G73: cannedCycle('G73'),
  G85: cannedCycle('G85'),
  G86: cannedCycle('G86'),
  G89: cannedCycle('G89'),
  // Kilavuz (dis cekme): ici ve disi ISLEME ilerlemesiyle gider.
  G84: cannedCycle('G84'),
  G74: cannedCycle('G74'),
  // Hassas bara (fine boring) ve geri bara.
  G76: cannedCycle('G76'),
  G87: cannedCycle('G87'),
  G88: cannedCycle('G88'),
  // Takim degisimi (T0..T9)
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`T${i}`, handleToolChange as CommandHandler]),
  ),
  // Bilincli olarak yok sayilanlar
  ...Object.fromEntries(IGNORED_COMMANDS.map((c) => [c, noop as CommandHandler])),
};

/**
 * Bir komut sozcugu icin handler bulur.
 *
 * Dogrudan eslesme disinda T komutlari genel olarak karsilanir: bir tezgahta
 * takim numarasi 9'dan buyuk olabilir (T12, T101), bunlarin her birini tek tek
 * kaydetmek anlamsizdir.
 */
export function getHandler(command: string): CommandHandler | undefined {
  const direct = COMMAND_HANDLERS[command];
  if (direct) return direct;
  if (/^T\d+$/.test(command)) return handleToolChange;
  return undefined;
}

/**
 * Hareket/konum uretin komutlar. Ayni satirda modal komutlarla birlikte
 * gelebilirler ("G0 G90 X10"); modal olanlar ONCE uygulanmalidir.
 */
export const MOTION_COMMANDS = new Set([
  'G0', 'G1', 'G2', 'G3', 'G28', 'G30', 'G92', 'G4',
  // Delme cevrimleri de hareket uretir: ayni satirdaki G98/G99, G90/G91,
  // takim ve duzlem komutlari onlardan ONCE uygulanmalidir.
  'G81', 'G82', 'G83', 'G73', 'G85', 'G86', 'G89',
  'G84', 'G74', 'G76', 'G87', 'G88',
]);

/**
 * Komut sozcugu icermeyen bir satirda tekrarlanabilen (modal) hareketler.
 * Ornek: "G1 X10 F200" satirindan sonra gelen "X20" satiri yine G1'dir.
 */
export const MODAL_REPEATABLE = new Set([
  'G0', 'G1', 'G2', 'G3',
  'G81', 'G82', 'G83', 'G73', 'G85', 'G86', 'G89',
  'G84', 'G74', 'G76', 'G87', 'G88',
]);

/**
 * Hareket URETMEYEN ama ayni satirdaki MODAL hareketin calismasina engel
 * olmayan komutlar.
 *
 * NEDEN: Gercek CAM ciktilarinda hareket komutu cogu zaman satirda yazmaz ama
 * satir bos da degildir:
 *   G43 H1 Z15. M8      -> takim boyu telafisi + guvenli Z'ye HIZLI CIKIS
 *   G54 X0. Y0.         -> is sifiri + konumlanma
 * Bu satirlar modal G0/G1 ile hareket eder. Liste bilincli olarak dardir:
 * "M600 X10 Y10" (yazici filament degisim konumu) gibi eksen sozcugu tasiyan
 * ama HAREKET ETMEYEN M kodlarinin sahte hareket uretmemesi gerekir.
 */
export const MODAL_MOTION_COMPANIONS = new Set([
  'G17', 'G18', 'G19', 'G20', 'G21',
  'G40', 'G41', 'G42', 'G43', 'G44', 'G49',
  'G53', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59',
  'G61', 'G64', 'G90', 'G91', 'G93', 'G94', 'G95', 'G98', 'G99',
  'G54.1', 'G9', 'G60', 'G63',
  'M3', 'M4', 'M5', 'M7', 'M8', 'M9',
]);
