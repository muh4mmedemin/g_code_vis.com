import * as THREE from 'three';
import type { LayerContext, PlaybackFrame, SceneLayer } from '../core/SceneLayer';
import type { MachineMode, Move, MoveKind, ParseResult, ToolDefinition, ViewSettings } from '@/core/types';
import { DEFAULT_TOOL } from '@/core/constants';
import { profileSamples, tipLength, toolRadius } from '@/cnc/toolProfile';

/** Onceki konumdan yeni konuma geciste kullanilan yumusatma katsayisi. */
const POSITION_SMOOTHING = 0.35;
/** onProgress bu sure icinde tekrar cagrilmazsa hareket durmus sayilir (ms). */
const MOVE_TIMEOUT_MS = 180;
/** Kesim/ekstrude sirasinda takimin saniyedeki don hizi (radyan). */
const SPIN_SPEED_CUTTING = 26;
/** Bos hareket (travel) sirasinda takimin saniyedeki don hizi (radyan). */
const SPIN_SPEED_TRAVEL = 6;

/**
 * Simulasyon sirasinda nozzle/kesici takimin anlik konumunu gosteren isaretci.
 *
 * CNC modunda gosterilen sekil, SECILEN TAKIMIN gercek profilidir: kure uclu
 * takim yuvarlak, matkap konik, havsa frezesi genis acili gorunur. Profil,
 * talas kaldirma cekirdeginin kullandigi ayni fonksiyondan uretilir
 * (cnc/toolProfile), dolayisiyla ekranda gordugunuz uc ile kesen uc ayni
 * seydir. Print modunda ise klasik nozzle konisi cizilir.
 *
 * Konum, moveCursor'un tam sayi kismindaki hareketten bir sonrakine dogru
 * DOGRUSAL olarak interpole edilir; ayrica takim doner ve kesim/travel
 * durumuna gore renk degistirir.
 */
export class ToolHeadLayer implements SceneLayer {
  readonly id = 'tool-head';
  private ctx: LayerContext | null = null;
  private group: THREE.Group | null = null;
  private moves: Move[] | null = null;

  private spinGroup: THREE.Group | null = null;
  private tipMaterial: THREE.MeshStandardMaterial | null = null;
  private shaftMaterial: THREE.MeshStandardMaterial | null = null;

  private targetPosition = new THREE.Vector3();
  private hasPosition = false;

  private spinAngle = 0;
  private lastProgressAt = 0;
  private currentKind: MoveKind = 'travel';

  private mode: MachineMode = 'print';
  private tool: ToolDefinition = { ...DEFAULT_TOOL };

  init(ctx: LayerContext): void {
    this.ctx = ctx;

    const group = new THREE.Group();
    const spinGroup = new THREE.Group();
    group.add(spinGroup);
    this.spinGroup = spinGroup;

    this.tipMaterial = new THREE.MeshStandardMaterial({
      color: 0xff3b6b,
      emissive: 0x4a0014,
      emissiveIntensity: 1,
      metalness: 0.3,
      roughness: 0.4,
    });
    this.shaftMaterial = new THREE.MeshStandardMaterial({
      color: 0xd9dde3,
      metalness: 0.6,
      roughness: 0.3,
    });

    group.visible = false;
    this.group = group;
    ctx.scene.add(group);

    this.rebuild();
  }

  setMachineMode(mode: MachineMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.rebuild();
  }

  setTool(tool: ToolDefinition): void {
    this.tool = tool;
    if (this.mode === 'cnc') this.rebuild();
  }

  /** Takim/mod degisince govdeyi yeniden kurar (konum ve donus korunur). */
  private rebuild(): void {
    const spinGroup = this.spinGroup;
    if (!spinGroup || !this.tipMaterial || !this.shaftMaterial) return;

    for (const child of [...spinGroup.children]) {
      spinGroup.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }

    if (this.mode === 'cnc') {
      this.buildCncTool(spinGroup);
    } else {
      this.buildPrintNozzle(spinGroup);
    }
    this.ctx?.requestRender();
  }

  /**
   * CNC takimi: profilden uretilen donel yuzey (uc) + silindirik sap.
   *
   * LatheGeometry Y ekseni etrafinda doner; sahne Z-up oldugu icin +90 derece
   * dondurulur, boylece ucun tepe noktasi grubun origin'ine (takim ucu) oturur.
   */
  private buildCncTool(parent: THREE.Group): void {
    const radius = toolRadius(this.tool);
    const tip = tipLength(this.tool);
    const flute = Math.max(this.tool.fluteLength || 20, tip + radius);

    const points = profileSamples(this.tool).map(([r, h]) => new THREE.Vector2(Math.max(r, 1e-4), h));
    // Ucun bitiminden sapa kadar silindirik govde.
    points.push(new THREE.Vector2(radius, flute));

    const tipGeometry = new THREE.LatheGeometry(points, 24);
    tipGeometry.rotateX(Math.PI / 2);
    const tipMesh = new THREE.Mesh(tipGeometry, this.tipMaterial!);
    parent.add(tipMesh);

    // Takim tutucu: sapin uzerinde daha kalin, kisa bir govde.
    const holderHeight = 24;
    const holderRadius = Math.max(radius * 1.8, 4);
    const holderGeometry = new THREE.CylinderGeometry(
      holderRadius,
      holderRadius * 0.85,
      holderHeight,
      16,
    );
    holderGeometry.rotateX(Math.PI / 2);
    holderGeometry.translate(0, 0, flute + holderHeight / 2);
    parent.add(new THREE.Mesh(holderGeometry, this.shaftMaterial!));
  }

  /** Print modu: asagi bakan nozzle konisi + ince govde. */
  private buildPrintNozzle(parent: THREE.Group): void {
    const tipHeight = 8;
    const tipRadius = 2.2;
    const tipGeometry = new THREE.ConeGeometry(tipRadius, tipHeight, 16);
    // ConeGeometry'nin ekseni Y'dir (apex +Y'de); -90 derece donus apex'i
    // asagi (-Z) bakacak sekilde Z eksenine tasir.
    tipGeometry.rotateX(-Math.PI / 2);
    tipGeometry.translate(0, 0, tipHeight / 2);
    parent.add(new THREE.Mesh(tipGeometry, this.tipMaterial!));

    const shaftHeight = 30;
    const shaftGeometry = new THREE.CylinderGeometry(1.4, 1.4, shaftHeight, 8);
    shaftGeometry.rotateX(Math.PI / 2);
    shaftGeometry.translate(0, 0, tipHeight + shaftHeight / 2);
    parent.add(new THREE.Mesh(shaftGeometry, this.shaftMaterial!));
  }

  private enabled = true;

  onData(data: ParseResult | null): void {
    this.moves = data?.moves ?? null;
    this.hasPosition = false;
    this.applyVisibility();
    this.ctx?.requestRender();
  }

  onViewSettings(settings: ViewSettings): void {
    this.enabled = settings.showToolpath;
    this.applyVisibility();
    this.ctx?.requestRender();
  }

  private applyVisibility(): void {
    if (this.group) {
      this.group.visible = this.enabled && !!this.moves && this.moves.length > 0;
    }
  }

  onProgress(state: PlaybackFrame): void {
    if (!this.group || !this.moves || this.moves.length === 0) return;

    const lastIndex = this.moves.length - 1;
    const clampedCursor = Math.max(0, Math.min(state.moveCursor, this.moves.length));
    const index = Math.min(Math.floor(clampedCursor), lastIndex);
    const fraction = Math.min(1, Math.max(0, clampedCursor - index));

    const move = this.moves[index];
    if (!move) return;

    this.targetPosition.set(
      move.from.x + (move.to.x - move.from.x) * fraction,
      move.from.y + (move.to.y - move.from.y) * fraction,
      move.from.z + (move.to.z - move.from.z) * fraction,
    );
    this.currentKind = move.kind;
    this.lastProgressAt = performance.now();

    // Buyuk sicramalarda (scrub/geri sarma) yumusatmayi atla, dogrudan zipla.
    if (!this.hasPosition || this.targetPosition.distanceToSquared(this.group.position) > 400) {
      this.group.position.copy(this.targetPosition);
      this.hasPosition = true;
    }

    this.ctx?.requestRender();
  }

  update(deltaSeconds: number): void {
    if (!this.group || !this.group.visible) return;

    // Konumu yumusatarak hedefe yaklastir (kritik-sonumlu benzeri yakalama).
    if (this.hasPosition) {
      const t = 1 - Math.pow(1 - POSITION_SMOOTHING, Math.max(deltaSeconds, 0) * 60);
      this.group.position.lerp(this.targetPosition, t);
    }

    const isMoving = performance.now() - this.lastProgressAt < MOVE_TIMEOUT_MS;
    const isCutting = this.currentKind === 'extrude';
    const spinSpeed = isCutting ? SPIN_SPEED_CUTTING : SPIN_SPEED_TRAVEL;

    if (isMoving && this.spinGroup) {
      this.spinAngle += deltaSeconds * spinSpeed;
      this.spinGroup.rotation.z = this.spinAngle;
    }

    if (this.tipMaterial) {
      const targetIntensity = isMoving && isCutting ? 2.4 : isMoving ? 1.2 : 0.6;
      this.tipMaterial.emissiveIntensity +=
        (targetIntensity - this.tipMaterial.emissiveIntensity) * Math.min(1, deltaSeconds * 8);

      const targetColor = isCutting ? 0xff8a2b : 0xff3b6b;
      this.tipMaterial.color.lerp(new THREE.Color(targetColor), Math.min(1, deltaSeconds * 6));
    }

    this.ctx?.requestRender();
  }

  dispose(): void {
    if (this.group) {
      this.ctx?.scene.remove(this.group);
      this.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      });
      this.group = null;
    }
    this.tipMaterial?.dispose();
    this.shaftMaterial?.dispose();
    this.tipMaterial = null;
    this.shaftMaterial = null;
    this.spinGroup = null;
  }
}
