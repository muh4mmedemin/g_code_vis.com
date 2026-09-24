import * as THREE from 'three';
import type { LayerContext, PlaybackFrame, SceneLayer } from '@/viewer/core/SceneLayer';
import type { Move, ParseResult, StockDefinition, ToolDefinition } from '@/core/types';
import { getStockMaterial } from '@/core/constants';
import { VoxelGrid } from './VoxelGrid';
import { carveRange } from './carver';
import { meshChunk } from './mesher';
import { meshSurface } from './surfaceMesher';

/** Purüzsuz yuzey mesh'inin en sik yeniden uretilme araligi (ms). */
const SURFACE_REBUILD_MS = 80;

/**
 * Ham malzeme blogu ve uzerinde talas kaldirma simulasyonu (Faz 6).
 *
 * CALISMA MANTIGI (gercek atolyedeki sirayla):
 *   1. Testereden cikmis gibi TAM DOLU bir blok olusturulur (kullanicinin
 *      girdigi X/Y/Z olculerinde).
 *   2. Editordeki G-code simulasyon imleci ilerledikce, her kesme hareketi
 *      bu bloktan malzeme kaldirir (cep acar, delik deler).
 *
 * Diger katmanlarla ayni SceneLayer arayuzunu uygular; viewer govdesine
 * dokunulmadan sahneye eklenir.
 */
export class StockLayer implements SceneLayer {
  readonly id = 'cnc-stock';

  private ctx: LayerContext | null = null;
  private group: THREE.Group | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private grid: VoxelGrid | null = null;
  /** chunkIndex -> mesh */
  private chunkMeshes = new Map<number, THREE.Mesh>();
  /** Purüzsuz mod: tek parca yuzey mesh'i. */
  private surfaceMesh: THREE.Mesh | null = null;
  /**
   * Yuzey gosterimi:
   *  - 'voxel'  : hucre kutuculari (freze izini oldugu gibi, basamakli)
   *  - 'smooth' : kesilen yerler purüzsuz (bkz. surfaceMesher.ts)
   */
  private surfaceMode: 'voxel' | 'smooth' = 'voxel';
  /** Purüzsuz mesh'in son uretim zamani (throttle icin). */
  private lastSurfaceBuild = 0;
  private pendingSurfaceBuild: ReturnType<typeof setTimeout> | null = null;

  private moves: Move[] = [];
  /** Su ana kadar islenmis hareket sayisi (imlecin tamsayi kismi). */
  private carvedUpTo = 0;
  /** Simulasyonun son bilinen konumu; blok her zaman buna gore islenir. */
  private lastCursor = 0;
  private visible = false;

  private stock: StockDefinition | null = null;
  private tool: ToolDefinition = { type: 'flat', diameter: 6, fluteLength: 25 };
  private resolution = 128;

  init(ctx: LayerContext): void {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.visible = false;
    const defaultMaterial = getStockMaterial(undefined);
    this.material = new THREE.MeshStandardMaterial({
      color: defaultMaterial.color,
      metalness: defaultMaterial.metalness,
      roughness: defaultMaterial.roughness,
      // Blogun ic yuzeyleri (cep duvarlari) de dogru gorunsun.
      side: THREE.FrontSide,
    });
    ctx.scene.add(this.group);
  }

  /** Blogu (yeniden) olusturur: tam dolu ham malzeme. */
  setStock(stock: StockDefinition, tool: ToolDefinition, resolution: number): void {
    this.stock = stock;
    this.tool = tool;
    this.resolution = resolution;
    this.applyMaterial(stock);

    this.grid = VoxelGrid.fromStock(stock, resolution);
    this.grid.fill();
    this.carvedUpTo = 0;

    this.disposeChunks();
    this.disposeSurface();
    this.recarveFromStart(this.carveTarget());
    this.updateMesh();
    this.ctx?.requestRender();
  }

  /**
   * Blogun malzemesini uygular. Voxel verisi degismez — yalnizca yuzeyin
   * rengi ve cinsi degisir, bu yuzden mesh'leri yeniden kurmaya gerek yoktur.
   */
  private applyMaterial(stock: StockDefinition): void {
    if (!this.material) return;
    const material = getStockMaterial(stock.material);
    this.material.color.setHex(material.color);
    this.material.roughness = material.roughness;
    this.material.metalness = material.metalness;
    this.material.needsUpdate = true;
  }

  /** Yuzey gosterimini degistirir (mevcut kesim korunur, yalnizca mesh yenilenir). */
  setSurfaceMode(mode: 'voxel' | 'smooth'): void {
    if (mode === this.surfaceMode) return;
    this.surfaceMode = mode;
    this.disposeChunks();
    this.disposeSurface();
    this.grid?.markAllDirty();
    this.updateMesh();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.group) this.group.visible = visible && this.grid !== null;
    this.ctx?.requestRender();
  }

  onData(data: ParseResult | null): void {
    this.moves = data?.moves ?? [];
    // Yeni program: blogu sifirla ve imlece kadar yeniden isle.
    if (this.grid && this.stock) {
      this.grid.fill();
      this.carvedUpTo = 0;
      this.recarveFromStart(this.carveTarget());
      this.updateMesh();
    }
    this.ctx?.requestRender();
  }

  onProgress(state: PlaybackFrame): void {
    this.lastCursor = state.moveCursor;
    if (!this.grid || this.moves.length === 0) return;

    const target = this.carveTarget();
    if (target === this.carvedUpTo) return;

    if (target < this.carvedUpTo) {
      // Geri sarildi: blok geri "dolmaz", bastan isletmek gerekir.
      this.grid.fill();
      this.carvedUpTo = 0;
    }

    carveRange(this.grid, this.moves, this.carvedUpTo, target, this.tool);
    this.carvedUpTo = target;
    this.updateMesh();
  }

  /** Blogun islenmesi gereken nokta: simulasyon imlecinin bulundugu yer. */
  private carveTarget(): number {
    return Math.max(0, Math.min(this.moves.length, Math.floor(this.lastCursor)));
  }

  private recarveFromStart(target: number): void {
    if (!this.grid) return;
    carveRange(this.grid, this.moves, 0, target, this.tool);
    this.carvedUpTo = target;
  }

  /** Aktif gosterime gore mesh'i tazeler. */
  private updateMesh(): void {
    if (this.surfaceMode === 'smooth') this.updateSurfaceMesh();
    else this.updateDirtyChunks();
  }

  /**
   * Purüzsuz mod: yukseklik alanindan tek parca yuzey. Kesim degistiginde
   * bastan uretilir — chunk'lara bolunmez, cunku yuzey normalleri komsu
   * kolonlara bakar ve parca sinirlarinda dikis izi olusurdu.
   */
  private updateSurfaceMesh(): void {
    const grid = this.grid;
    const group = this.group;
    if (!grid || !group || !this.material) return;
    if (grid.dirtyChunks.size === 0 && this.surfaceMesh) return;

    // Yuzey tek parca uretildigi icin her kesme adiminda yeniden kurmak
    // oynatmayi yavaslatir. Hizli oynatmada uretim kisilir; son durum her
    // zaman kuyruga alinan bir cagriyla yakalanir.
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.surfaceMesh && now - this.lastSurfaceBuild < SURFACE_REBUILD_MS) {
      if (this.pendingSurfaceBuild === null) {
        this.pendingSurfaceBuild = setTimeout(() => {
          this.pendingSurfaceBuild = null;
          this.updateSurfaceMesh();
        }, SURFACE_REBUILD_MS);
      }
      return;
    }
    this.lastSurfaceBuild = now;

    const buffers = meshSurface(grid);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));

    if (this.surfaceMesh) {
      this.surfaceMesh.geometry.dispose();
      this.surfaceMesh.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.userData.measurable = true;
      this.surfaceMesh = mesh;
      group.add(mesh);
    }

    grid.dirtyChunks.clear();
    group.visible = this.visible;
    this.ctx?.requestRender();
  }

  private disposeSurface(): void {
    if (this.pendingSurfaceBuild !== null) {
      clearTimeout(this.pendingSurfaceBuild);
      this.pendingSurfaceBuild = null;
    }
    if (this.surfaceMesh && this.group) {
      this.group.remove(this.surfaceMesh);
      this.surfaceMesh.geometry.dispose();
    }
    this.surfaceMesh = null;
  }

  /** Kirli chunk'lari yeniden mesh'ler (temiz olanlara dokunmaz). */
  private updateDirtyChunks(): void {
    const grid = this.grid;
    const group = this.group;
    if (!grid || !group || !this.material) return;

    for (const chunkIndex of grid.dirtyChunks) {
      const existing = this.chunkMeshes.get(chunkIndex);
      const buffers = meshChunk(grid, chunkIndex);

      if (!buffers) {
        if (existing) {
          group.remove(existing);
          existing.geometry.dispose();
          this.chunkMeshes.delete(chunkIndex);
        }
        continue;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));

      if (existing) {
        existing.geometry.dispose();
        existing.geometry = geometry;
      } else {
        const mesh = new THREE.Mesh(geometry, this.material);
        // Olcum araci yalnizca isaretli yuzeyleri hedefler.
        mesh.userData.measurable = true;
        this.chunkMeshes.set(chunkIndex, mesh);
        group.add(mesh);
      }
    }

    grid.dirtyChunks.clear();
    group.visible = this.visible && this.chunkMeshes.size > 0;
    this.ctx?.requestRender();
  }

  private disposeChunks(): void {
    if (!this.group) return;
    for (const mesh of this.chunkMeshes.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunkMeshes.clear();
  }

  dispose(): void {
    this.disposeChunks();
    this.disposeSurface();
    this.material?.dispose();
    this.material = null;
    if (this.group) {
      this.ctx?.scene.remove(this.group);
      this.group = null;
    }
    this.grid = null;
  }
}
