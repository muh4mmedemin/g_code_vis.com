import type { SceneLayer } from './SceneLayer';

/**
 * Three.js yasam dongusunun sahibi: renderer, scene, camera, controls,
 * resize gozlemcisi ve render dongusu.
 *
 * Tasarim karari: "on-demand rendering" — surekli requestAnimationFrame
 * yerine yalnizca degisiklik oldugunda cizim yapilir (bkz. requestRender).
 * Animasyonlu bir katman varken surekli moda gecilir.
 *
 * TODO(sonnet): implementasyon.
 */
export class SceneManager {
  /** Canvas'i DOM'a baglar, sahneyi kurar. */
  mount(_container: HTMLElement): void {
    throw new Error('NOT_IMPLEMENTED: SceneManager.mount');
  }

  /** Katman ekler ve init eder. */
  addLayer(_layer: SceneLayer): void {
    throw new Error('NOT_IMPLEMENTED: SceneManager.addLayer');
  }

  removeLayer(_id: string): void {
    throw new Error('NOT_IMPLEMENTED: SceneManager.removeLayer');
  }

  getLayer<T extends SceneLayer>(_id: string): T | undefined {
    throw new Error('NOT_IMPLEMENTED: SceneManager.getLayer');
  }

  /** Bir sonraki karede cizim talep eder. */
  requestRender(): void {
    throw new Error('NOT_IMPLEMENTED: SceneManager.requestRender');
  }

  /** Kamerayi verilen sinirlara sigacak sekilde konumlandirir. */
  frameBounds(_min: [number, number, number], _max: [number, number, number]): void {
    throw new Error('NOT_IMPLEMENTED: SceneManager.frameBounds');
  }

  /** Hazir kamera acilari: ust, on, izometrik. */
  setCameraPreset(_preset: 'top' | 'front' | 'right' | 'iso'): void {
    throw new Error('NOT_IMPLEMENTED: SceneManager.setCameraPreset');
  }

  /** Tum katmanlari dispose eder, canvas'i kaldirir. */
  dispose(): void {
    throw new Error('NOT_IMPLEMENTED: SceneManager.dispose');
  }
}
