import * as THREE from 'three';
import type { LayerContext, SceneLayer } from '../core/SceneLayer';
import type { Vec3 } from '@/core/types';
import { COLORS } from '@/core/constants';

/**
 * CNC modunda hedef is parcasinin (bitmis olcunun) yari saydam onizlemesi.
 *
 * NEDEN GEREKLI: CNC'de toolpath, malzemenin KALDIRILDIGI yeri gosterir;
 * parcanin kendisi geriye kalan bosluktur. Sadece toolpath cizilirse
 * "hangi parcayi uretiyorum" gorunmez. Bu katman, girilen olculerdeki
 * parcayi dogrudan bir kutu olarak gosterir.
 *
 * Konum: XY'de origin'de merkezli, stokun ust yuzeyi Z=0 kabul edilerek
 * asagi dogru (0 -> -height) uzanir — generators/cube.ts ile ayni kabul.
 */
export class PartPreviewLayer implements SceneLayer {
  readonly id = 'cnc-part';
  private ctx: LayerContext | null = null;
  private group: THREE.Group | null = null;
  private size: Vec3 = { x: 0, y: 0, z: 0 };
  private visible = false;

  init(ctx: LayerContext): void {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.visible = false;
    ctx.scene.add(this.group);
  }

  /** Parca olcusunu (mm) ve gorunurlugunu gunceller. */
  setPart(size: Vec3, visible: boolean): void {
    const changed =
      size.x !== this.size.x || size.y !== this.size.y || size.z !== this.size.z;
    this.size = { ...size };
    this.visible = visible;

    if (changed) this.rebuild();
    if (this.group) this.group.visible = visible && size.x > 0 && size.y > 0 && size.z > 0;
    this.ctx?.requestRender();
  }

  private rebuild(): void {
    if (!this.group) return;
    this.disposeChildren();

    const { x, y, z } = this.size;
    if (x <= 0 || y <= 0 || z <= 0) return;

    const geometry = new THREE.BoxGeometry(x, y, z);
    // Ust yuzey Z=0'da olacak sekilde asagi indir.
    geometry.translate(0, 0, -z / 2);

    const body = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: COLORS.stock,
        metalness: 0.15,
        roughness: 0.65,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: COLORS.stock }),
    );

    this.group.add(body, edges);
  }

  private disposeChildren(): void {
    if (!this.group) return;
    for (const child of [...this.group.children]) {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
      this.group.remove(child);
    }
  }

  dispose(): void {
    this.disposeChildren();
    if (this.group) {
      this.ctx?.scene.remove(this.group);
      this.group = null;
    }
  }
}
