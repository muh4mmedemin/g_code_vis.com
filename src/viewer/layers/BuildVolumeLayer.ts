import * as THREE from 'three';
import type { LayerContext, SceneLayer } from '../core/SceneLayer';
import type { BuildVolume, ViewSettings } from '@/core/types';
import { COLORS } from '@/core/constants';

/**
 * Yazici tablasi/calisma hacmi tel kafes kutusu.
 * Kutunun tabani Z=0 duzlemine oturur, merkezi XY origin'de kabul edilir
 * (yazicilarin coguyla tutarli). CNC modunda ham malzeme sinirlarini
 * gostermek icin de kullanilabilir.
 */
export class BuildVolumeLayer implements SceneLayer {
  readonly id = 'build-volume';
  private mesh: THREE.LineSegments | null = null;
  private ctx: LayerContext | null = null;

  constructor(private volume: BuildVolume) {}

  init(ctx: LayerContext): void {
    this.ctx = ctx;
    this.build();
  }

  private build(): void {
    if (this.mesh) {
      this.ctx?.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
    }

    const { width, depth, height } = this.volume;
    const geometry = new THREE.BoxGeometry(width, depth, height);
    geometry.translate(0, 0, height / 2);
    const edges = new THREE.EdgesGeometry(geometry);
    geometry.dispose();

    const material = new THREE.LineBasicMaterial({ color: COLORS.gridAccent, opacity: 0.8, transparent: true });
    this.mesh = new THREE.LineSegments(edges, material);
    this.ctx?.scene.add(this.mesh);
  }

  setVolume(volume: BuildVolume): void {
    this.volume = volume;
    this.build();
    this.ctx?.requestRender();
  }

  onViewSettings(settings: ViewSettings): void {
    if (this.mesh) this.mesh.visible = settings.showBuildVolume;
  }

  dispose(): void {
    if (this.mesh) {
      this.ctx?.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
  }
}
