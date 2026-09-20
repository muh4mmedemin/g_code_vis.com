import type { GcodeToken } from './tokenizer';
import type { CannedCycleState, MachineState } from './machineState';
import { feedDuration, toMillimeters } from './machineState';
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

/** G0/G1 — dogrusal hareket. `rapid` yalnizca G0 icin true'dur. */
function linearMove(rapid: boolean): CommandHandler {
  return (token, ctx) => {
  const { state } = ctx;
  // Hareket komutu modaldir: sonraki komutsuz satirlar bunu tekrarlar.
  state.motionMode = rapid ? 'G0' : 'G1';
  state.cannedCycle = null;
  const from: Vec3 = { ...state.position };

  const to: Vec3 = {
    x: resolveAxis(token.params.X, state.position.x, state.positioning, state.unit),
    y: resolveAxis(token.params.Y, state.position.y, state.positioning, state.unit),
    z: resolveAxis(token.params.Z, state.position.z, state.positioning, state.unit),
  };

  if (token.params.F !== undefined) {
    state.feedrate = toMillimeters(token.params.F, state.unit);
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

    if (token.params.F !== undefined) {
      state.feedrate = toMillimeters(token.params.F, state.unit);
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

/** G28 — home. Belirtilen eksenler (veya hepsi) 0'a gider. */
function handleHome(token: GcodeToken, ctx: HandlerContext): void {
  const { state } = ctx;
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

    if (token.params.F !== undefined) {
      state.feedrate = toMillimeters(token.params.F, state.unit);
    }

    // Cevrim baslamadan onceki Z (G98'de buraya donulur) yalnizca cevrimin
    // ILK satirinda belirlenir; tekrarlarda korunur.
    const initialZ = prev ? prev.initialZ : state.position.z;

    const qRaw =
      token.params.Q !== undefined ? toMillimeters(token.params.Q, state.unit) : undefined;
    const q = Math.abs(qRaw ?? prev?.q ?? 0);
    const dwell = token.params.P ?? prev?.dwell ?? 0;

    const needsPeck = command === 'G83' || command === 'G73';
    if (needsPeck && q <= 0) {
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
      if (needsPeck && q > 0) {
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
      if ((command === 'G82' || command === 'G89') && dwell > 0) {
        state.dwellSeconds += dwell;
      }

      // 5) Geri cekilme. G85/G89 isleme feed'iyle cikar (raybalama/bore).
      const feedOut = command === 'G85' || command === 'G89';
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
  'G40', 'G43', 'G49', 'G61', 'G64',
  // Ofset/telafi tablosu yazar; geometriyi dogrudan uretmez.
  'G10', 'G92.1', 'G92.2', 'G92.3',
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
  if (ctx.state.machineCoordReported) return;
  ctx.state.machineCoordReported = true;
  ctx.diagnostic({
    severity: 'warning',
    code: 'MACHINE_COORDINATES',
    message:
      'G53 makine koordinati kullaniliyor; makine sifiri bilinmedigi icin hareket is ' +
      'sifirina gore cizildi (gercek tezgahta farkli bir noktaya gider).',
  });
}

function handleCutterComp(token: GcodeToken, ctx: HandlerContext): void {
  const which = token.commands.find((c) => c === 'G41' || c === 'G42') ?? 'G41';
  ctx.diagnostic({
    severity: 'info',
    code: 'CUTTER_COMP_IGNORED',
    message: `${which} kesici telafisi uygulanmadi; takim merkez hatti gosteriliyor.`,
  });
}

export const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  // Hareket
  G0: linearMove(true),
  G1: linearMove(false),
  G2: handleArcMove(true),
  G3: handleArcMove(false),
  G28: handleHome,
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
  G41: handleCutterComp,
  G42: handleCutterComp,
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
  'G0', 'G1', 'G2', 'G3', 'G28', 'G92', 'G4',
  // Delme cevrimleri de hareket uretir: ayni satirdaki G98/G99, G90/G91,
  // takim ve duzlem komutlari onlardan ONCE uygulanmalidir.
  'G81', 'G82', 'G83', 'G73', 'G85', 'G86', 'G89',
]);

/**
 * Komut sozcugu icermeyen bir satirda tekrarlanabilen (modal) hareketler.
 * Ornek: "G1 X10 F200" satirindan sonra gelen "X20" satiri yine G1'dir.
 */
export const MODAL_REPEATABLE = new Set([
  'G0', 'G1', 'G2', 'G3',
  'G81', 'G82', 'G83', 'G73', 'G85', 'G86', 'G89',
]);
