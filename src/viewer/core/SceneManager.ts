import * as THREE from 'three';
import { CameraRig } from './CameraRig';
import type { LayerContext, PlaybackFrame, SceneLayer } from './SceneLayer';
import type { ParseResult, ViewSettings } from '@/core/types';
import { COLORS } from '@/core/constants';

/**
 * Three.js yasam dongusunun sahibi: renderer, scene, camera, controls,
 * resize gozlemcisi ve render dongusu.
 *
 * Tasarim karari: "on-demand rendering" — surekli requestAnimationFrame
 * yerine yalnizca degisiklik oldugunda cizim yapilir (bkz. requestRender).
 */
export class SceneManager {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private cameraRig!: CameraRig;
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private layers = new Map<string, SceneLayer>();
  private renderRequested = false;
  private rafHandle: number | null = null;
  private lastFrameTime = 0;

  mount(container: HTMLElement): void {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.background);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(200, -250, 220);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    const directional = new THREE.DirectionalLight(0xffffff, 0.6);
    directional.position.set(1, -1, 2);
    this.scene.add(ambient, directional);

    this.cameraRig = new CameraRig(this.camera, this.renderer.domElement, () =>
      this.requestRender(),
    );
    this.cameraRig.setPreset('iso');

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();

    this.startLoop();
    this.requestRender();
  }

  private handleResize(): void {
    if (!this.container) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.requestRender();
  }

  private startLoop(): void {
    const loop = (time: number) => {
      this.rafHandle = requestAnimationFrame(loop);
      const delta = this.lastFrameTime ? (time - this.lastFrameTime) / 1000 : 0;
      this.lastFrameTime = time;

      this.cameraRig.update();

      let needsUpdate = false;
      for (const layer of this.layers.values()) {
        if (layer.update) {
          layer.update(delta);
          needsUpdate = true;
        }
      }

      if (this.renderRequested || needsUpdate) {
        this.renderRequested = false;
        this.renderer.render(this.scene, this.camera);
      }
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  addLayer(layer: SceneLayer): void {
    const ctx: LayerContext = {
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      requestRender: () => this.requestRender(),
    };
    layer.init(ctx);
    this.layers.set(layer.id, layer);
    this.requestRender();
  }

  removeLayer(id: string): void {
    const layer = this.layers.get(id);
    if (!layer) return;
    layer.dispose();
    this.layers.delete(id);
    this.requestRender();
  }

  getLayer<T extends SceneLayer>(id: string): T | undefined {
    return this.layers.get(id) as T | undefined;
  }

  broadcastData(data: ParseResult | null): void {
    for (const layer of this.layers.values()) layer.onData?.(data);
    this.requestRender();
  }

  broadcastViewSettings(settings: ViewSettings): void {
    for (const layer of this.layers.values()) layer.onViewSettings?.(settings);
    this.requestRender();
  }

  broadcastProgress(frame: PlaybackFrame): void {
    for (const layer of this.layers.values()) layer.onProgress?.(frame);
    this.requestRender();
  }

  requestRender(): void {
    this.renderRequested = true;
  }

  frameBounds(min: [number, number, number], max: [number, number, number]): void {
    this.cameraRig.frameBounds(new THREE.Vector3(...min), new THREE.Vector3(...max));
    this.requestRender();
  }

  setCameraPreset(preset: 'top' | 'front' | 'right' | 'iso'): void {
    this.cameraRig.setPreset(preset);
    this.requestRender();
  }

  dispose(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.resizeObserver?.disconnect();
    for (const layer of this.layers.values()) layer.dispose();
    this.layers.clear();
    this.cameraRig.dispose();
    this.renderer.dispose();
    if (this.container && this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
