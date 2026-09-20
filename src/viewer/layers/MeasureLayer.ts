import * as THREE from 'three';
import type { LayerContext, SceneLayer } from '../core/SceneLayer';
import type { Vec3 } from '@/core/types';

const POINT_COLOR = 0x3aa0ff;
const LINE_COLOR = 0x8fd0ff;

/**
 * Olcum isaretcileri: secilen noktalar ve aralarindaki cizgi.
 *
 * Sayisal sonuc panelde yazilir; buradaki is yalnizca kullanicinin nereye
 * tikladigini sahnede gostermektir. Isaretci boyutu kamera uzakligina gore
 * ayarlanir, aksi halde buyuk blokta gorunmez, kucuk parcada devasa olur.
 */
export class MeasureLayer implements SceneLayer {
  readonly id = 'measure';
  private ctx: LayerContext | null = null;
  private group: THREE.Group | null = null;
  private markers: THREE.Mesh[] = [];
  private line: THREE.Line | null = null;

  init(ctx: LayerContext): void {
    this.ctx = ctx;
    const group = new THREE.Group();
    group.visible = false;

    const geometry = new THREE.SphereGeometry(1, 16, 12);
    const material = new THREE.MeshBasicMaterial({ color: POINT_COLOR, depthTest: false });
    for (let i = 0; i < 2; i++) {
      const marker = new THREE.Mesh(geometry, material);
      marker.visible = false;
      marker.renderOrder = 999;
      this.markers.push(marker);
      group.add(marker);
    }

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const lineMaterial = new THREE.LineBasicMaterial({ color: LINE_COLOR, depthTest: false });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.visible = false;
    line.renderOrder = 999;
    this.line = line;
    group.add(line);

    this.group = group;
    ctx.scene.add(group);
  }

  setPoints(points: Vec3[]): void {
    const group = this.group;
    if (!group) return;

    group.visible = points.length > 0;
    for (let i = 0; i < this.markers.length; i++) {
      const marker = this.markers[i];
      const point = points[i];
      if (!marker) continue;
      marker.visible = !!point;
      if (point) marker.position.set(point.x, point.y, point.z);
    }

    if (this.line) {
      const [a, b] = points;
      this.line.visible = !!a && !!b;
      if (a && b) {
        const positions = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
        positions.setXYZ(0, a.x, a.y, a.z);
        positions.setXYZ(1, b.x, b.y, b.z);
        positions.needsUpdate = true;
        this.line.geometry.computeBoundingSphere();
      }
    }

    this.ctx?.requestRender();
  }

  /** Isaretcileri kamera uzakligina gore olcekler (ekranda sabit buyuklukte). */
  update(): void {
    if (!this.group?.visible || !this.ctx) return;
    const camera = this.ctx.camera;
    for (let i = 0; i < this.markers.length; i++) {
      const marker = this.markers[i];
      if (!marker?.visible) continue;
      const distance = camera.position.distanceTo(marker.position);
      const scale = Math.max(0.4, distance * 0.008);
      marker.scale.setScalar(scale);
    }
  }

  dispose(): void {
    if (!this.group) return;
    this.ctx?.scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.group = null;
    this.markers = [];
    this.line = null;
  }
}
