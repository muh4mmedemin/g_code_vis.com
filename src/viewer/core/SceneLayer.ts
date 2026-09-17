import type * as THREE from 'three';
import type { ParseResult, ViewSettings } from '@/core/types';

/**
 * *** Mimarinin en onemli sozlesmesi ***
 *
 * Sahnedeki her gorsel alt sistem bir SceneLayer'dir. Toolpath cizgileri,
 * build plate, grid ve ilerde CNC voxel blogu (Faz 6) ayni arayuzu uygular.
 * Boylece "kesilen parcanin 3D modeli" eklenirken viewer govdesine
 * dokunulmaz — sadece yeni bir SceneLayer yazilip registry'ye eklenir.
 */
export interface SceneLayer {
  readonly id: string;

  /** Sahneye eklenirken bir kez cagrilir. */
  init(ctx: LayerContext): void;

  /** Yeni parse sonucu geldiginde. null => dosya kapatildi. */
  onData?(data: ParseResult | null): void;

  /** Gorunum ayarlari degistiginde. */
  onViewSettings?(settings: ViewSettings): void;

  /**
   * Simulasyon/katman durumu degistiginde.
   * Pahali islem yapilmamali; mumkunse shader uniform'u guncellenmeli.
   */
  onProgress?(state: PlaybackFrame): void;

  /** Her karede (opsiyonel animasyon icin). */
  update?(deltaSeconds: number): void;

  /** Sahneden cikarilirken: geometry/material dispose. */
  dispose(): void;
}

export interface LayerContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** Bir sonraki karede yeniden cizim talep eder (on-demand rendering). */
  requestRender: () => void;
}

/** Katman/simulasyon ilerlemesinin tek kaynagi. */
export interface PlaybackFrame {
  /** Gorunur en ust katman indeksi. */
  visibleLayer: number;
  /** Izole mod acikken gorunur en alt katman; degilse 0. */
  minVisibleLayer: number;
  /** Simulasyonda su ana kadar islenen hareket sayisi. */
  moveCursor: number;
  /** Simulasyon zamani (saniye). */
  time: number;
}
