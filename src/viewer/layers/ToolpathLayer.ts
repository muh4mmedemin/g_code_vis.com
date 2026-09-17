import * as THREE from 'three';
import type { LayerContext, PlaybackFrame, SceneLayer } from '../core/SceneLayer';
import type { ParseResult, ViewSettings } from '@/core/types';
import { COLORS } from '@/core/constants';

const VERTEX_SHADER = /* glsl */ `
  attribute float aKind;
  attribute float aLayer;
  varying float vKind;
  varying float vLayer;
  void main() {
    vKind = aKind;
    vLayer = aLayer;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  varying float vKind;
  varying float vLayer;

  uniform vec3 uExtrudeColor;
  uniform vec3 uTravelColor;
  uniform vec3 uRetractColor;
  uniform vec3 uHomeColor;
  uniform float uShowTravel;
  uniform float uMinLayer;
  uniform float uMaxLayer;
  uniform float uColorMode; // 0 = kind, 1 = layer
  uniform float uLayerCount;

  vec3 rainbow(float t) {
    // basit HSV->RGB (hue = t)
    float h = t * 6.0;
    float x = 1.0 - abs(mod(h, 2.0) - 1.0);
    vec3 c;
    if (h < 1.0) c = vec3(1.0, x, 0.0);
    else if (h < 2.0) c = vec3(x, 1.0, 0.0);
    else if (h < 3.0) c = vec3(0.0, 1.0, x);
    else if (h < 4.0) c = vec3(0.0, x, 1.0);
    else if (h < 5.0) c = vec3(x, 0.0, 1.0);
    else c = vec3(1.0, 0.0, x);
    return c;
  }

  void main() {
    // kind kodlari: 0 extrude, 1 travel, 2 retract, 3 home (bkz. MOVE_KIND_CODE)
    if (vLayer < uMinLayer - 0.5 || vLayer > uMaxLayer + 0.5) discard;
    if (uShowTravel < 0.5 && (vKind > 0.5 && vKind < 1.5)) discard;

    vec3 color;
    if (uColorMode > 0.5 && uLayerCount > 0.0) {
      color = rainbow(vLayer / max(uLayerCount - 1.0, 1.0));
    } else if (vKind < 0.5) {
      color = uExtrudeColor;
    } else if (vKind < 1.5) {
      color = uTravelColor;
    } else if (vKind < 2.5) {
      color = uRetractColor;
    } else {
      color = uHomeColor;
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

function colorUniform(hex: number): THREE.Vector3 {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

/**
 * Ana toolpath gorsellestirmesi (Faz 1-3).
 *
 * Yaklasim: TEK bir THREE.LineSegments + BufferGeometry + ozel shader.
 * Katman filtreleme, travel gizleme ve renk modu, geometriyi yeniden kurmadan
 * fragment shader'da (discard) uygulanir — boylece 1M+ segmentte bile
 * slider/toggle etkilesimleri akici kalir.
 */
export class ToolpathLayer implements SceneLayer {
  readonly id = 'toolpath';
  private ctx: LayerContext | null = null;
  private lines: THREE.LineSegments | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private layerCount = 0;

  init(ctx: LayerContext): void {
    this.ctx = ctx;
  }

  onData(data: ParseResult | null): void {
    this.clear();
    if (!data || data.buffers.count === 0) return;

    const { buffers } = data;
    this.layerCount = data.layers.length;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));

    // Segment basina 1 deger olan kind/layer, per-vertex (2 vertex/segment) hale getirilir.
    const vertexKind = new Float32Array(buffers.count * 2);
    const vertexLayer = new Float32Array(buffers.count * 2);
    for (let i = 0; i < buffers.count; i++) {
      const kind = buffers.kinds[i] ?? 0;
      const layer = buffers.layerIndices[i] ?? 0;
      vertexKind[i * 2] = kind;
      vertexKind[i * 2 + 1] = kind;
      vertexLayer[i * 2] = layer;
      vertexLayer[i * 2 + 1] = layer;
    }
    geometry.setAttribute('aKind', new THREE.BufferAttribute(vertexKind, 1));
    geometry.setAttribute('aLayer', new THREE.BufferAttribute(vertexLayer, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uExtrudeColor: { value: colorUniform(COLORS.extrude) },
        uTravelColor: { value: colorUniform(COLORS.travel) },
        uRetractColor: { value: colorUniform(COLORS.retract) },
        uHomeColor: { value: colorUniform(COLORS.home) },
        uShowTravel: { value: 0 },
        uMinLayer: { value: 0 },
        uMaxLayer: { value: this.layerCount },
        uColorMode: { value: 0 },
        uLayerCount: { value: this.layerCount },
      },
    });

    this.lines = new THREE.LineSegments(geometry, this.material);
    this.ctx?.scene.add(this.lines);

    const { bounds } = data.stats;
    this.ctx?.requestRender();
    // Ilk yuklemede kamerayi modele sigacak sekilde konumlandir.
    if (this.onFrameRequested) {
      this.onFrameRequested([bounds.min.x, bounds.min.y, bounds.min.z], [
        bounds.max.x,
        bounds.max.y,
        bounds.max.z,
      ]);
    }
  }

  /** Viewport.tsx tarafindan atanir; veri geldiginde kamerayi kadraja oturtur. */
  onFrameRequested: ((min: [number, number, number], max: [number, number, number]) => void) | null =
    null;

  onViewSettings(settings: ViewSettings): void {
    if (!this.material) return;
    this.material.uniforms.uShowTravel!.value = settings.showTravel ? 1 : 0;
    this.material.uniforms.uColorMode!.value = settings.colorMode === 'layer' ? 1 : 0;
    if (!settings.isolateLayer) {
      this.material.uniforms.uMinLayer!.value = 0;
    }
    this.ctx?.requestRender();
  }

  onProgress(state: PlaybackFrame): void {
    if (!this.material) return;
    this.material.uniforms.uMaxLayer!.value = state.visibleLayer;
    this.material.uniforms.uMinLayer!.value = state.minVisibleLayer;
    this.ctx?.requestRender();
  }

  private clear(): void {
    if (this.lines) {
      this.ctx?.scene.remove(this.lines);
      this.lines.geometry.dispose();
      this.lines = null;
    }
    this.material?.dispose();
    this.material = null;
  }

  dispose(): void {
    this.clear();
  }
}
