import * as THREE from 'three';
import type { LayerContext, SceneLayer } from '../core/SceneLayer';
import type { BuildVolume, ViewSettings } from '@/core/types';
import { COLORS } from '@/core/constants';

/**
 * Blender tarzi zemin gridi + eksen cizgileri (X kirmizi / Y yesil).
 * Z-up koordinat sistemine gore XY duzlemine yatirilir.
 */
export class GridLayer implements SceneLayer {
  readonly id = 'grid';
  private group: THREE.Group | null = null;
  private ctx: LayerContext | null = null;

  constructor(private volume: BuildVolume) {}

  init(ctx: LayerContext): void {
    this.ctx = ctx;
    this.build();
  }

  private build(): void {
    if (this.group) {
      this.ctx?.scene.remove(this.group);
      disposeGroup(this.group);
    }

    const group = new THREE.Group();
    const size = Math.max(this.volume.width, this.volume.depth) * 1.5;
    const divisions = Math.max(10, Math.round(size / 10));

    const grid = new THREE.GridHelper(size, divisions, COLORS.gridAccent, COLORS.grid);
    // GridHelper varsayilan olarak XZ duzleminde (Y-up); sahnemiz Z-up oldugu
    // icin XY duzlemine yatiriyoruz.
    grid.rotation.x = Math.PI / 2;
    group.add(grid);

    const axes = new THREE.AxesHelper(Math.max(this.volume.width, this.volume.depth) * 0.15);
    group.add(axes);

    this.group = group;
    this.ctx?.scene.add(group);
  }

  setVolume(volume: BuildVolume): void {
    this.volume = volume;
    this.build();
    this.ctx?.requestRender();
  }

  onViewSettings(settings: ViewSettings): void {
    if (this.group) this.group.visible = settings.showGrid;
  }

  dispose(): void {
    if (this.group) {
      this.ctx?.scene.remove(this.group);
      disposeGroup(this.group);
      this.group = null;
    }
  }
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Line || obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const material = obj.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
  });
}
