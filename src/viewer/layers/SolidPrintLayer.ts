import * as THREE from 'three';
import type { LayerContext, PlaybackFrame, SceneLayer } from '../core/SceneLayer';
import type { ParseResult, ViewSettings } from '@/core/types';
import { COLORS, SOLID_EXTRUSION_WIDTH, SOLID_LAYER_HEIGHT_FALLBACK } from '@/core/constants';

const tmpFrom = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpMid = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();
const tmpBasis = new THREE.Matrix4();
const WORLD_Z = new THREE.Vector3(0, 0, 1);
const WORLD_Y = new THREE.Vector3(0, 1, 0);

function rainbow(t: number): THREE.Color {
  const h = t * 6;
  const x = 1 - Math.abs((h % 2) - 1);
  let r = 0,
    g = 0,
    b = 0;
  if (h < 1) [r, g, b] = [1, x, 0];
  else if (h < 2) [r, g, b] = [x, 1, 0];
  else if (h < 3) [r, g, b] = [0, 1, x];
  else if (h < 4) [r, g, b] = [0, x, 1];
  else if (h < 5) [r, g, b] = [x, 0, 1];
  else [r, g, b] = [1, 0, x];
  return new THREE.Color(r, g, b);
}

/**
 * Print malzemesinin "dolu/yuzeyli" 3D gorunumu (ToolpathLayer'in cizgi
 * gorunumune ek bir mod). Her extrude hareketi, hareket yonune hizalanmis
 * kucuk bir kutu (extrusion "bead"i) olarak cizilir.
 *
 * Performans: tum bead'ler TEK bir THREE.InstancedMesh'te tutulur. Katman
 * indeksi parser tarafindan hareketlerle birlikte MONOTONIK olarak arttigi
 * icin (bkz. gcode/parser/commands.ts beginLayer), "su ana kadar gorunur"
 * kismi tek bir on-ek (prefix) olur — bu da InstancedMesh.count'u
 * ayarlamaktan ibarettir; geometri yeniden kurulmaz.
 */
export class SolidPrintLayer implements SceneLayer {
  readonly id = 'solid-print';
  private ctx: LayerContext | null = null;
  private mesh: THREE.InstancedMesh | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  /** Instance sirasiyla hizali: o bead'in ait oldugu orijinal hareket indeksi. */
  private instanceMoveIndex: Uint32Array | null = null;
  /** Instance sirasiyla hizali: o bead'in katman indeksi. */
  private instanceLayerIndex: Uint32Array | null = null;
  private colorMode: ViewSettings['colorMode'] = 'kind';
  private visible = false;
  private layerCount = 0;

  init(ctx: LayerContext): void {
    this.ctx = ctx;
  }

  onData(data: ParseResult | null): void {
    this.clear();
    if (!data) return;

    const { moves, layers } = data;
    this.layerCount = layers.length;

    const extrudeIndices: number[] = [];
    for (let i = 0; i < moves.length; i++) {
      if (moves[i]?.kind === 'extrude') extrudeIndices.push(i);
    }
    if (extrudeIndices.length === 0) return;

    // Katman basina kalinlik: ardisik katmanlarin Z farki; ilki ve tekil
    // katmanlar icin sabit varsayilan kullanilir.
    const layerHeights = new Float32Array(layers.length);
    for (let i = 0; i < layers.length; i++) {
      const z = layers[i]?.z ?? 0;
      const prevZ = i > 0 ? (layers[i - 1]?.z ?? 0) : 0;
      const h = z - prevZ;
      layerHeights[i] = h > 0.001 ? h : SOLID_LAYER_HEIGHT_FALLBACK;
    }

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: COLORS.extrude,
      metalness: 0.05,
      roughness: 0.75,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, extrudeIndices.length);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(extrudeIndices.length * 3),
      3,
    );

    const instanceMoveIndex = new Uint32Array(extrudeIndices.length);
    const instanceLayerIndex = new Uint32Array(extrudeIndices.length);

    for (let n = 0; n < extrudeIndices.length; n++) {
      const moveIndex = extrudeIndices[n];
      if (moveIndex === undefined) continue;
      const move = moves[moveIndex];
      if (!move) continue;

      instanceMoveIndex[n] = moveIndex;
      instanceLayerIndex[n] = move.layerIndex;

      tmpFrom.set(move.from.x, move.from.y, move.from.z);
      tmpTo.set(move.to.x, move.to.y, move.to.z);
      const length = Math.max(tmpFrom.distanceTo(tmpTo), 0.01);

      tmpDir.subVectors(tmpTo, tmpFrom).normalize();
      // Yon dunya Z eksenine cok yakinsa (dikey plunge/travel), referans
      // "yukari" vektoru olarak Y kullan ki capraz carpim dejenere olmasin.
      const reference = Math.abs(tmpDir.dot(WORLD_Z)) > 0.99 ? WORLD_Y : WORLD_Z;
      tmpRight.crossVectors(tmpDir, reference).normalize();
      // Sag-el kurali: Z (up) = X (dir) x Y (right) olmali; aksi halde
      // makeBasis bir yansima (determinant -1) uretir ve setFromRotationMatrix
      // gecersiz/carpitilmis bir quaternion'a yol acar.
      tmpUp.crossVectors(tmpDir, tmpRight).normalize();

      tmpBasis.makeBasis(tmpDir, tmpRight, tmpUp);
      tmpQuat.setFromRotationMatrix(tmpBasis);

      tmpMid.addVectors(tmpFrom, tmpTo).multiplyScalar(0.5);

      const height = layerHeights[move.layerIndex] ?? SOLID_LAYER_HEIGHT_FALLBACK;
      tmpScale.set(length, SOLID_EXTRUSION_WIDTH, height);

      tmpMatrix.compose(tmpMid, tmpQuat, tmpScale);
      mesh.setMatrixAt(n, tmpMatrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = extrudeIndices.length;
    mesh.visible = this.visible;

    this.mesh = mesh;
    this.material = material;
    this.instanceMoveIndex = instanceMoveIndex;
    this.instanceLayerIndex = instanceLayerIndex;
    this.applyColors();

    this.ctx?.scene.add(mesh);
    this.ctx?.requestRender();
  }

  private applyColors(): void {
    if (!this.mesh || !this.instanceLayerIndex) return;
    const color = new THREE.Color(COLORS.extrude);
    const attr = this.mesh.instanceColor;
    if (!attr) return;

    for (let n = 0; n < this.instanceLayerIndex.length; n++) {
      const c =
        this.colorMode === 'layer' && this.layerCount > 1
          ? rainbow((this.instanceLayerIndex[n] ?? 0) / Math.max(this.layerCount - 1, 1))
          : color;
      attr.setXYZ(n, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
    this.ctx?.requestRender();
  }

  onViewSettings(settings: ViewSettings): void {
    this.visible = settings.renderMode === 'solid';
    if (this.mesh) this.mesh.visible = this.visible;

    if (this.colorMode !== settings.colorMode) {
      this.colorMode = settings.colorMode;
      this.applyColors();
    }
    this.ctx?.requestRender();
  }

  onProgress(state: PlaybackFrame): void {
    if (!this.mesh || !this.instanceMoveIndex || !this.instanceLayerIndex) return;

    // Her iki dizi de instance sirasinda MONOTONIK arttigi icin (parser
    // hareketleri sirali isler), "gorunur" kisim tek bir on-ek: ikisinden
    // kucuk olan sinira kadar olan instance sayisi.
    const cursorCount = upperBound(this.instanceMoveIndex, state.moveCursor);
    const layerCount = upperBound(this.instanceLayerIndex, state.visibleLayer + 0.5);
    this.mesh.count = Math.min(cursorCount, layerCount);
    this.ctx?.requestRender();
  }

  private clear(): void {
    if (this.mesh) {
      this.ctx?.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.material?.dispose();
    this.material = null;
    this.instanceMoveIndex = null;
    this.instanceLayerIndex = null;
  }

  dispose(): void {
    this.clear();
  }
}

/** Sirali (monotonik artan) bir dizide, degeri `limit`i asan ilk indeksi bulur. */
function upperBound(sorted: Uint32Array, limit: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const value = sorted[mid] ?? 0;
    if (value <= limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
