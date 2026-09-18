import * as THREE from 'three';
import type { LayerContext, PlaybackFrame, SceneLayer } from '../core/SceneLayer';
import type { Move, MoveKind, ParseResult, ViewSettings } from '@/core/types';

/** Onceki konumdan yeni konuma geciste kullanilan yumusatma katsayisi. */
const POSITION_SMOOTHING = 0.35;
/** onProgress bu sure icinde tekrar cagrilmazsa hareket durmus sayilir (ms). */
const MOVE_TIMEOUT_MS = 180;
/** Kesim/ekstrude sirasinda takimin saniyedeki don hizi (radyan). */
const SPIN_SPEED_CUTTING = 26;
/** Bos hareket (travel) sirasinda takimin saniyedeki don hizi (radyan). */
const SPIN_SPEED_TRAVEL = 6;

/**
 * Simulasyon sirasinda nozzle/kesici takimin anlik konumunu gosteren isaretci
 * (koni + govde). Konum, moveCursor'un tam sayi kismindaki hareketten bir
 * sonrakine dogru DOGRUSAL olarak interpole edilir (kesirli kisim), boylece
 * playbackLoop her karede kucuk adimlar attikca hareket pursuzsuz gorunur.
 *
 * Ek olarak: takim govdesi surekli doner (spindle hissi) ve kesim/travel
 * durumuna gore renk/parlaklik degistirir, boylece "cidden isliyormus" hissi
 * guclenir. Konum hedefi de hafifce yumusatilir (smoothing) — ani sicrama
 * yerine kisa bir "yakalama" hareketi olur.
 */
export class ToolHeadLayer implements SceneLayer {
  readonly id = 'tool-head';
  private ctx: LayerContext | null = null;
  private group: THREE.Group | null = null;
  private moves: Move[] | null = null;

  private tip: THREE.Mesh | null = null;
  private shaft: THREE.Mesh | null = null;
  private spinGroup: THREE.Group | null = null;
  private tipMaterial: THREE.MeshStandardMaterial | null = null;

  private targetPosition = new THREE.Vector3();
  private hasPosition = false;

  private spinAngle = 0;
  private lastProgressAt = 0;
  private currentKind: MoveKind = 'travel';

  init(ctx: LayerContext): void {
    this.ctx = ctx;

    const group = new THREE.Group();
    const spinGroup = new THREE.Group();
    group.add(spinGroup);
    this.spinGroup = spinGroup;

    // Kesici ucu: asagi bakan koni (Z-up sahnede tepe -Z yonunde).
    const tipHeight = 8;
    const tipRadius = 2.2;
    const tipGeometry = new THREE.ConeGeometry(tipRadius, tipHeight, 16);
    // ConeGeometry'nin ekseni varsayilan olarak Y'dir (apex +Y'de). rotateX(PI)
    // yalnizca Y ekseni uzerinde ters cevirir (konu hala yan yatirir!) —
    // ekseni Z'ye tasimak icin -90 derece dondurmek gerekir; sonucta apex
    // -Z'ye (asagi) bakar.
    tipGeometry.rotateX(-Math.PI / 2);
    tipGeometry.translate(0, 0, tipHeight / 2);
    const tipMaterial = new THREE.MeshStandardMaterial({
      color: 0xff3b6b,
      emissive: 0x4a0014,
      emissiveIntensity: 1,
      metalness: 0.3,
      roughness: 0.4,
    });
    const tip = new THREE.Mesh(tipGeometry, tipMaterial);
    spinGroup.add(tip);
    this.tip = tip;
    this.tipMaterial = tipMaterial;

    // Govde: koninin ustunde ince bir silindir (mil/spindle hissi). Hafif
    // yiv gorunumu icin radyal segment sayisi dusuk tutulup donme animasyonu
    // ile "mil donuyor" izlenimi verilir.
    const shaftHeight = 30;
    const shaftGeometry = new THREE.CylinderGeometry(1.4, 1.4, shaftHeight, 8);
    shaftGeometry.rotateX(Math.PI / 2);
    shaftGeometry.translate(0, 0, tipHeight + shaftHeight / 2);
    const shaftMaterial = new THREE.MeshStandardMaterial({
      color: 0xd9dde3,
      metalness: 0.6,
      roughness: 0.3,
    });
    const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
    spinGroup.add(shaft);
    this.shaft = shaft;

    group.visible = false;
    this.group = group;
    ctx.scene.add(group);
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
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      this.group = null;
    }
    this.tip = null;
    this.shaft = null;
    this.spinGroup = null;
    this.tipMaterial = null;
  }
}
