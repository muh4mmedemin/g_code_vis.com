import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * OrbitControls sarmalayicisi (orbit / pan / zoom) + kamera preset'leri.
 * SceneManager tarafindan kullanilir; disariya sizmaz.
 */
export class CameraRig {
  readonly controls: OrbitControls;

  constructor(
    private camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    onChange: () => void,
  ) {
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 5000;
    this.controls.addEventListener('change', onChange);
  }

  update(): void {
    this.controls.update();
  }

  /** Hazir kamera acilari: ust, on, sag, izometrik. Mevcut hedefe gore mesafeyi korur. */
  setPreset(preset: 'top' | 'front' | 'right' | 'iso'): void {
    const target = this.controls.target;
    const distance = this.camera.position.distanceTo(target) || 300;

    const directions: Record<typeof preset, THREE.Vector3> = {
      top: new THREE.Vector3(0, 0, 1),
      front: new THREE.Vector3(0, -1, 0.35),
      right: new THREE.Vector3(1, -0.3, 0.35),
      iso: new THREE.Vector3(1, -1, 1),
    };

    const dir = directions[preset].normalize();
    this.camera.position.copy(target).addScaledVector(dir, distance);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(target);
    this.controls.update();
  }

  frameBounds(min: THREE.Vector3, max: THREE.Vector3): void {
    const center = min.clone().add(max).multiplyScalar(0.5);
    const size = max.clone().sub(min);
    const radius = Math.max(size.length() * 0.5, 10);

    this.controls.target.copy(center);

    const dir = new THREE.Vector3(1, -1, 0.8).normalize();
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = radius / Math.sin(fov / 2);

    this.camera.position.copy(center).addScaledVector(dir, distance);
    this.camera.up.set(0, 0, 1);
    this.camera.near = Math.max(0.1, distance / 100);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(center);
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
