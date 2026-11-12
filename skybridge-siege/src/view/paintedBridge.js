// The sky bridge as the paintings themselves: each lane's painting, only its green cut out
// (tools/build-bridge.mjs, *-cut.png), drawn flat behind the 3D scene, framed exactly as the
// game camera is (paintingFrame), so standing in a lane the screen shows that lane's painting as
// it is. Animated cartoon flames (cartoonFlame.js) burn in the empty cages, with the lamps' own
// brass drawn again over them (*-lamps.png) so the cages stay in front.
//
// While dodging, the painting being left and the one being reached are cross-faded by how far
// the camera has come, each slid sideways as the gatehouse would move from where it was painted,
// so the Warden (3D, drawn on top) stays in the gateway. Where one painting has slid off the
// screen's edge, the other covers that strip alone.

import * as THREE from 'three';
import { PAINTING, flameSpot, paintingFrame } from './bridgeLayout.mjs';
import { FLAME_BOX, FLAME_SHEET, createFlameSheet, showFrame } from './cartoonFlame.js';

const LANES = [
  { name: 'bridge-left', eyeX: -2 },
  { name: 'bridge', eyeX: 0 },
  { name: 'bridge-right', eyeX: 2 },
];
const SLIDE_DEPTH = 16.6; // metres: slide each painting as things this far away move (the Warden)

// Both paintings (or both lamp layers) at once, mixed. Coordinates are painting pixels, y up.
const MIX_VERTEX = `
  varying vec2 vAt;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vAt = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;
const MIX_FRAGMENT = `
  uniform sampler2D mapA;
  uniform sampler2D mapB;
  uniform vec2 slideA;
  uniform vec2 slideB;
  uniform float mixB;
  uniform vec2 size;
  varying vec2 vAt;
  float inside(vec2 pixel) {
    return step(0.0, pixel.x) * step(pixel.x, size.x) * step(0.0, pixel.y) * step(pixel.y, size.y);
  }
  void main() {
    vec2 pa = vec2(vAt.x - slideA.x, -(vAt.y - slideA.y)), pb = vec2(vAt.x - slideB.x, -(vAt.y - slideB.y));
    float covA = inside(pa), covB = inside(pb);
    if (covA + covB <= 0.0) discard;
    vec4 a = texture2D(mapA, vec2(pa.x / size.x, 1.0 - pa.y / size.y));
    vec4 b = texture2D(mapB, vec2(pb.x / size.x, 1.0 - pb.y / size.y));
    // Each takes its share where it covers; a share it cannot cover goes to the other.
    float wa = (1.0 - mixB) * covA, wb = mixB * covB;
    float rest = (1.0 - wa - wb) / (covA + covB);
    wa += rest * covA;
    wb += rest * covB;
    float alpha = wa * a.a + wb * b.a;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4((wa * a.a * a.rgb + wb * b.a * b.rgb) / alpha, alpha);
    #include <colorspace_fragment>
  }`;

export function createPaintedBridge({ base = './assets/scene/' } = {}) {
  const loader = new THREE.TextureLoader();
  const colour = url => {
    const texture = loader.load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  };
  const lanes = LANES.map(lane => ({ ...lane, cut: colour(`${base}${lane.name}-cut.png`), lamps: colour(`${base}${lane.name}-lamps.png`) }));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, PAINTING.width, 0, -PAINTING.height, -10, 10);
  const size = new THREE.Vector2(PAINTING.width, PAINTING.height);
  const mixLayer = (key, order) => {
    const uniforms = {
      mapA: { value: lanes[1][key] }, mapB: { value: lanes[2][key] },
      slideA: { value: new THREE.Vector2() }, slideB: { value: new THREE.Vector2() },
      mixB: { value: 0 }, size: { value: size },
    };
    const material = new THREE.ShaderMaterial({
      uniforms, vertexShader: MIX_VERTEX, fragmentShader: MIX_FRAGMENT,
      transparent: true, depthTest: false, depthWrite: false,
    });
    // Larger than the painting, so it still covers the screen while a painting slides.
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PAINTING.width * 1.5, PAINTING.height * 1.5), material);
    mesh.position.set(PAINTING.width / 2, -PAINTING.height / 2, 0);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return uniforms;
  };
  const paintings = mixLayer('cut', 0);
  const brass = mixLayer('lamps', 2);

  // The flames, per painting, where its lamps were painted (bridge-lamps.json).
  const sheet = createFlameSheet();
  const flames = [];
  for (const lane of lanes) {
    lane.group = new THREE.Group();
    scene.add(lane.group);
  }
  fetch(`${base}bridge-lamps.json`).then(response => response.json()).then(boxes => {
    for (const lane of lanes) {
      (boxes[lane.name] ?? []).forEach((box, index) => {
        if (!box) return;
        const spot = flameSpot(box);
        const texture = sheet.clone();
        const flame = new THREE.Mesh(
          new THREE.PlaneGeometry((FLAME_BOX.right - FLAME_BOX.left) * spot.unit, (FLAME_BOX.bottom - FLAME_BOX.top) * spot.unit),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
        );
        flame.position.set(spot.x, -(spot.base + ((FLAME_BOX.bottom + FLAME_BOX.top) / 2) * spot.unit), 0);
        flame.renderOrder = 1;
        lane.group.add(flame);
        // Each lamp burns at its own pace, from its own starting drawing, the same in every painting.
        flames.push({ texture, material: flame.material, lane, fps: 9 + (index % 3), start: (index * 0.37) % 1 });
      });
    }
  }).catch(error => console.warn('[bridge] could not load lamp positions', error));

  let view = { x: 0, y: 0, width: PAINTING.width, height: PAINTING.height }; // painting pixels, y down
  return {
    scene,
    camera,
    /** aspect: the window's. Frames the paintings exactly as the game camera does. */
    resize(aspect) {
      const frame = paintingFrame(aspect);
      view = { x: frame.x, y: frame.y - (frame.fullHeight / 2 - PAINTING.vanish.y), width: frame.width, height: frame.height };
    },
    /** cameraX: metres across; pitch and roll: the game camera's, so shakes move the paintings too. */
    update(now, cameraX = 0, pitch = 0, roll = 0) {
      // The two paintings either side of the camera, and how far it has come from one to the other.
      const from = cameraX >= 0 ? lanes[1] : lanes[0], to = cameraX >= 0 ? lanes[2] : lanes[1];
      const t = Math.min(1, Math.max(0, (cameraX - from.eyeX) / (to.eyeX - from.eyeX)));
      const slide = lane => new THREE.Vector2((-PAINTING.focal * (cameraX - lane.eyeX)) / SLIDE_DEPTH, -PAINTING.focal * Math.tan(pitch));
      for (const [layer, key] of [[paintings, 'cut'], [brass, 'lamps']]) {
        layer.mapA.value = from[key];
        layer.mapB.value = to[key];
        layer.slideA.value.copy(slide(from));
        layer.slideB.value.copy(slide(to));
        layer.mixB.value = t;
      }
      const weights = new Map([[from, 1 - t], [to, t]]);
      for (const lane of lanes) {
        const s = slide(lane);
        lane.group.position.set(s.x, s.y, 0);
        lane.group.visible = (weights.get(lane) ?? 0) > 0.001;
      }
      for (const flame of flames) {
        flame.material.opacity = weights.get(flame.lane) ?? 0;
        const frame = Math.floor((now / 1000) * flame.fps + flame.start * FLAME_SHEET.frames) % FLAME_SHEET.frames;
        showFrame(flame.texture, frame);
      }
      // The view, turned with the camera's roll about its middle.
      camera.left = -view.width / 2;
      camera.right = view.width / 2;
      camera.top = view.height / 2;
      camera.bottom = -view.height / 2;
      camera.position.set(view.x + view.width / 2, -(view.y + view.height / 2), 0);
      camera.rotation.z = roll;
      camera.updateProjectionMatrix();
    },
  };
}
