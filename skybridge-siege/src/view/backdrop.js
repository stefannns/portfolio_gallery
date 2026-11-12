// The painted sky, drawn as a full-screen quad behind the 3D arena so the art keeps its exact
// composition. It is the still painting: the generated starfield clip lost too much detail.

import * as THREE from 'three';
import { floorPan } from './floorPan.mjs';

// The sky is the furthest layer, so it only drifts. The slight crop leaves it room to do that.
const SKY_CROP = 0.97;
const SKY_PAN_PER_METRE = 0.006;

export function createBackdrop(url = './assets/scene/sky-clean.png') {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0xfb8137, // the sky's horizon orange until the painting loads
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  let texture = null;
  new THREE.TextureLoader().load(url, loaded => {
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.minFilter = THREE.LinearMipmapLinearFilter;
    loaded.anisotropy = 4;
    texture = loaded;
    material.map = loaded;
    material.color.set(0xffffff);
    material.needsUpdate = true;
  }, undefined, error => console.warn('[sky] could not load', url, error));

  return {
    scene,
    camera,
    mesh,
    start() {},
    /** look: 0 level, 1 looking up (the title): the sky zooms in toward its starry top. */
    update(cameraX = 0, look = 0) {
      if (!texture) return;
      // Cover the viewport without distorting the painting: crop the overflowing axis.
      const textureAspect = texture.image.width / texture.image.height;
      const viewAspect = this.aspect ?? 16 / 9;
      const zoom = 1 + 0.45 * look;
      let repeatX = SKY_CROP / zoom;
      let repeatY = SKY_CROP / zoom;
      if (textureAspect > viewAspect) {
        repeatX *= viewAspect / textureAspect;
      } else {
        repeatY *= textureAspect / viewAspect;
      }
      texture.repeat.set(repeatX, repeatY);
      texture.offset.set((1 - repeatX) / 2 + cameraX * SKY_PAN_PER_METRE, (1 - repeatY) * (0.5 + 0.5 * look));
    },
    resize(aspect) { this.aspect = aspect; },
  };
}

// The painted floor and balustrade. Its sky area is transparent, so the sky shows through.
// It is pinned so the Warden stands just inside the ring's far edge at any window shape.
const FLOOR_ANCHOR_Y = 0.635; // where his feet go, as a fraction of the painting from the top
const FLOOR_RAIL_Y = 0.51; // the balustrade rail, same units
// Also crops the painting's worn paper edge off the screen, and leaves enough painting off each
// side for the nearest floor to slide a full 2 m lane change (1.16 ran out at 1.2 m).
const FLOOR_ZOOM = 1.3;

export function createPaintedFloor(scene, url = './assets/scene/floor.png') {
  const uniforms = {
    map: { value: null },
    uvScale: { value: new THREE.Vector2(1, 1) },
    uvOffset: { value: new THREE.Vector2() },
    feetV: { value: 0.4 },
    railV: { value: 0.55 },
    panFar: { value: 0 },
    panBack: { value: 0 },
    panFront: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vScreen;
      void main() {
        vScreen = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec2 uvScale;
      uniform vec2 uvOffset;
      uniform float feetV;
      uniform float railV;
      uniform float panFar;
      uniform float panBack;
      uniform float panFront;
      varying vec2 vScreen;
      void main() {
        // Each row of the painting slides by its distance: the foreground most, the rail least.
        float towardPlayer = clamp((feetV - vScreen.y) / feetV, 0.0, 1.0);
        float towardRail = clamp((vScreen.y - feetV) / max(railV - feetV, 0.001), 0.0, 1.0);
        float pan = vScreen.y < feetV ? mix(panBack, panFront, towardPlayer) : mix(panBack, panFar, towardRail);
        vec2 st = vScreen * uvScale + uvOffset;
        st.x += pan;
        gl_FragColor = texture2D(map, st);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10; // under the Warden and every spell
  mesh.visible = false;
  scene.add(mesh);

  let floorAspect = 1672 / 941; // replaced by the real image's shape once it loads
  let view = { aspect: 16 / 9, feetY: 0.6, halfWidthAtEnemy: 16 };
  let panPerMetre = 0, panLimit = 0;

  function layout() {
    const { aspect, feetY, halfWidthAtEnemy } = view;
    const cover = Math.max(1, aspect / floorAspect);
    const height = Math.max(cover * FLOOR_ZOOM, (1 - feetY) / (1 - FLOOR_ANCHOR_Y)); // height in screens
    const top = feetY - FLOOR_ANCHOR_Y * height;
    const scaleX = aspect / floorAspect / height;
    const offsetX = 0.5 - 0.5 * scaleX;
    uniforms.uvScale.value.set(scaleX, 1 / height);
    uniforms.uvOffset.value.set(offsetX, 1 - (1 - top) / height);
    uniforms.feetV.value = 1 - feetY;
    uniforms.railV.value = 1 - (top + FLOOR_RAIL_Y * height);
    panPerMetre = (0.5 / halfWidthAtEnemy) * scaleX;
    panLimit = offsetX * 0.98; // the spare painting on each side; a wider floor allows more
  }

  new THREE.TextureLoader().load(url, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    uniforms.map.value = texture;
    floorAspect = texture.image.width / texture.image.height;
    layout();
    mesh.visible = true;
  }, undefined, error => console.warn('[floor] could not load', url, error));

  return {
    /** feetY: where the Warden's feet land on screen, as a fraction from the top. */
    resize(aspect, feetY, halfWidthAtEnemy) {
      view = { aspect, feetY, halfWidthAtEnemy };
      layout();
    },
    update(cameraX) {
      const pan = floorPan(cameraX, panPerMetre, panLimit);
      uniforms.panFar.value = pan.far;
      uniforms.panBack.value = pan.back;
      uniforms.panFront.value = pan.front;
    },
  };
}
