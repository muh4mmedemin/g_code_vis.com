import * as THREE from 'three';
import type { LayerContext, PlaybackFrame, SceneLayer } from '../core/SceneLayer';
import type { Move, ParseResult } from '@/core/types';

/**
 * Simulasyon sirasinda nozzle/kesici takimin anlik konumunu gosteren isaretci
 * (koni + govde). Konum, moveCursor'un tam sayi kismindaki hareketten bir
 * sonrakine dogru DOGRUSAL olarak interpole edilir (kesirli kisim), boylece
 * playbackLoop her karede kucuk adimlar attikca hareket pursuzsuz gorunur.
 *
 * "Detayli olmasina gerek yok, smooth olsun yeterli" — geometri kasten basit
 * tutuldu (tek koni + ince govde), vurgu hareketin akicilignda.
 */
export class ToolHeadLayer implements SceneLayer {
  readonly id = 'tool-head';
  private ctx: LayerContext | null = null;
  private group: THREE.Group | null = null;
  private moves: Move[] | null = null;

  init(ctx: LayerContext): void {
    this.ctx = ctx;

    const group = new THREE.Group();

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
      metalness: 0.3,
      roughness: 0.4,
    });
    const tip = new THREE.Mesh(tipGeometry, tipMaterial);
    group.add(tip);

    // Govde: koninin ustunde ince bir silindir (mil/spindle hissi).
    const shaftHeight = 30;
    const shaftGeometry = new THREE.CylinderGeometry(1.4, 1.4, shaftHeight, 12);
    shaftGeometry.rotateX(Math.PI / 2);
    shaftGeometry.translate(0, 0, tipHeight + shaftHeight / 2);
    const shaftMaterial = new THREE.MeshStandardMaterial({
      color: 0xd9dde3,
      metalness: 0.6,
      roughness: 0.3,
    });
    const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
    group.add(shaft);

    group.visible = false;
    this.group = group;
    ctx.scene.add(group);
  }

  onData(data: ParseResult | null): void {
    this.moves = data?.moves ?? null;
    if (this.group) this.group.visible = !!this.moves && this.moves.length > 0;
    this.ctx?.requestRender();
  }

  onProgress(state: PlaybackFrame): void {
    if (!this.group || !this.moves || this.moves.length === 0) return;

    const lastIndex = this.moves.length - 1;
    const clampedCursor = Math.max(0, Math.min(state.moveCursor, this.moves.length));
    const index = Math.min(Math.floor(clampedCursor), lastIndex);
    const fraction = Math.min(1, Math.max(0, clampedCursor - index));

    const move = this.moves[index];
    if (!move) return;

    this.group.position.set(
      move.from.x + (move.to.x - move.from.x) * fraction,
      move.from.y + (move.to.y - move.from.y) * fraction,
      move.from.z + (move.to.z - move.from.z) * fraction,
    );

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
  }
}
