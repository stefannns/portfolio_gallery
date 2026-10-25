import React, {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef} from 'react';
import {useFrame, useThree} from '@react-three/fiber';
import {Color, HalfFloatType, NormalBlending, ShaderMaterial, Vector2, WebGLRenderTarget} from 'three';
import {OutlinePass} from 'three/addons/postprocessing/OutlinePass.js';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {getSceneUiScale} from './scene-ui-scale.js';

const TaskOutlineContext = createContext(null);

// OutlinePass uses a combined flat mask, so touching meshes in one prop share
// one silhouette instead of outlining their individual triangles and seams.
// https://threejs.org/docs/pages/OutlinePass.html
class VisibleTaskOutlinePass extends OutlinePass {
  constructor(resolution, scene, camera, ignoredObjects) {
    super(resolution, scene, camera, []);
    this.ignoredObjects = ignoredObjects;
    this.ignoredVisibility = new Map();
    this.hiddenEdgeColor.set(0x000000);
    this.visibleEdgeColor.set('#ffd54a');
    this.usePatternTexture = false;
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    // Raycast helpers have invisible materials, but an override depth material
    // would turn them into occluders. Exclude only those registered helpers.
    for (const object of this.ignoredObjects) {
      this.ignoredVisibility.set(object, object.visible);
      object.visible = false;
    }
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const shadowNeedsUpdate = renderer.shadowMap.needsUpdate;
    // The beauty RenderPass already updated real shadows for this frame.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
      for (const [object, visible] of this.ignoredVisibility) object.visible = visible;
      this.ignoredVisibility.clear();
    }
  }
}

export function useTaskOutline(object, objective, highlighted) {
  const registry = useContext(TaskOutlineContext);
  const record = useMemo(() => ({object, objective, highlighted}), [object]);
  useLayoutEffect(() => {
    record.objective = objective;
    record.highlighted = highlighted;
  }, [record, objective, highlighted]);
  useLayoutEffect(() => {
    if (!registry) return;
    registry.models.add(record);
    return () => registry.models.delete(record);
  }, [registry, record]);
}

export function useTaskOutlineIgnore() {
  const registry = useContext(TaskOutlineContext);
  const previous = useRef(null);
  return useCallback(object => {
    if (previous.current) registry?.ignored.delete(previous.current);
    previous.current = object;
    if (object) registry?.ignored.add(object);
  }, [registry]);
}

function TaskOutlineRenderer({registry, reducedMotion}) {
  const {gl, scene, camera} = useThree();
  const resources = useRef(null);
  useEffect(() => {
    const outline = new VisibleTaskOutlinePass(new Vector2(1, 1), scene, camera, registry.ignored);
    const target = new WebGLRenderTarget(1, 1, {type: HalfFloatType, depthBuffer: false});
    target.texture.name = 'KitchenTaskOutline.overlay';
    const material = new ShaderMaterial({
      uniforms: {edgeTexture: {value: target.texture}, outlineColor: {value: new Color('#ffd54a')}, outlineOpacity: {value: .7}},
      vertexShader: `varying vec2 vUv;
        void main() {vUv = uv;gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);}`,
      fragmentShader: `varying vec2 vUv;uniform sampler2D edgeTexture;
        uniform vec3 outlineColor;uniform float outlineOpacity;
        void main() {
          vec3 edge = texture2D(edgeTexture, vUv).rgb;
          float coverage = clamp(max(max(edge.r, edge.g), edge.b), 0.0, 1.0);
          gl_FragColor = vec4(outlineColor, coverage * outlineOpacity);
          #include <colorspace_fragment>
        }`,
      blending: NormalBlending, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    });
    const quad = new FullScreenQuad(material);
    resources.current = {outline, target, material, quad, clearColor: new Color(), width: 0, height: 0, pixelRatio: 0};
    return () => {
      resources.current = null;
      outline.dispose();
      target.dispose();
      material.dispose();
      quad.dispose();
    };
  }, [gl, scene, camera, registry]);

  useFrame(({clock, size: frameSize}, delta) => {
    const state = resources.current;
    if (!state) {gl.render(scene, camera);return;}
    const {outline, target, quad} = state;
    const pixelRatio = gl.getPixelRatio();
    if (state.width !== frameSize.width || state.height !== frameSize.height || state.pixelRatio !== pixelRatio) {
      const width = Math.max(1, Math.round(frameSize.width * pixelRatio));
      const height = Math.max(1, Math.round(frameSize.height * pixelRatio));
      target.setSize(width, height);
      outline.setSize(width, height);
      state.width = frameSize.width;state.height = frameSize.height;state.pixelRatio = pixelRatio;
    }
    const selected = outline.selectedObjects;
    selected.length = 0;
    let nearby = false;
    for (const record of registry.models) {
      if ((!record.objective && !record.highlighted) || !record.object.visible) continue;
      selected.push(record.object);
      nearby ||= record.highlighted;
    }
    // Keep the original beauty render on the default framebuffer: lighting,
    // ACES exposure, sRGB, clear background and canvas MSAA stay untouched.
    gl.render(scene, camera);
    if (!selected.length) return;
    const breath = reducedMotion ? .5 : .5 + Math.sin(clock.elapsedTime * 2.6) * .5;
    const sceneScale = getSceneUiScale(camera, frameSize);
    outline.edgeThickness = Math.min(4, Math.max(.75, (nearby ? 1.7 : 1.4 + breath * .5) * sceneScale * pixelRatio));
    outline.edgeStrength = nearby ? 4 : 2.2 + breath * 1.1;
    outline.edgeGlow = .25 + breath * .25;
    state.material.uniforms.outlineOpacity.value = nearby ? .92 : .52 + breath * .26;
    const autoClear = gl.autoClear;
    const clearAlpha = gl.getClearAlpha();
    gl.getClearColor(state.clearColor);
    try {
      gl.setRenderTarget(target);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      gl.setClearColor(state.clearColor, clearAlpha);
      outline.render(gl, null, target, delta, false);
      gl.setRenderTarget(null);
      gl.autoClear = false;
      // Treat the edge-only texture as coverage, then alpha-composite yellow.
      // Additive light would wash out to white against the cream background.
      // Convert only the overlay color; never re-tone-map the beauty image.
      quad.render(gl);
    } finally {
      gl.setRenderTarget(null);
      gl.setClearColor(state.clearColor, clearAlpha);
      gl.autoClear = autoClear;
    }
    // Priority 1 owns rendering after movement (-1) and camera updates,
    // preventing R3F from drawing another beauty frame over the silhouette.
  }, 1);
  return null;
}

export default function TaskOutline({children, reducedMotion}) {
  const registry = useMemo(() => ({models: new Set(), ignored: new Set()}), []);
  return <TaskOutlineContext.Provider value={registry}>
    {children}
    <TaskOutlineRenderer registry={registry} reducedMotion={reducedMotion}/>
  </TaskOutlineContext.Provider>;
}
