// The sky bridge: three paintings, one from each lane's eye, projected onto a few simple shapes
// (deck, landing, parapet faces and tops, the landing's round rim walls, the gatehouse front,
// and a card per lamp), as if cast by projectors at those eyes. Standing in a lane you see that
// lane's painting exactly; while dodging, the middle lane's painting and the side one the camera
// is heading for are mixed by how far it has come, each still projected from its own eye, so
// both show the bridge in the same place and parallax carries the move. Each painting comes as
// layers (tools/build-bridge.mjs): the set with the lamps painted out, so a lamp never smears
// onto the stone behind it, and the lamps alone, their cages empty; each lamp gets an animated
// cartoon flame (cartoonFlame.js) just behind it, seen through its cage. Layout and
// measurements: bridgeLayout.mjs.

import * as THREE from 'three';
import { BRIDGE, LAMPS, PAINTING, RIM, flameSpot, lampCard, parapetTopAt, rimOutline } from './bridgeLayout.mjs';
import { FLAME_BOX, FLAME_SHEET, createFlameSheet, showFrame } from './cartoonFlame.js';

// The painting's edges are soft (keyed from green), and drawn with alpha to coverage: the
// antialiased canvas covers as much of each edge pixel as the painting does, so a cut edge is as
// smooth as the painting's own ink line rather than stepped. Only nearly clear pixels are dropped.
const CUT = '0.02';
const EDGE = 0.15; // metres: the strips catching the painted edge along the parapets' and rims' tops

const VERTEX = `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

// The painting pixel under this fragment, seen from a painting's eye eyeX metres across. From an
// outer lane, or in a very wide window, you can see paving nearer than a painting shows (beside
// it or below its bottom edge). There it steps back along the bridge, a stone length at a time,
// and shows that stretch instead, so the paving carries on rather than smearing the edge.
// A is always the middle lane's painting; B is the side lane's the camera is heading for.
const PROJECT = `
  uniform sampler2D paintingA;
  uniform sampler2D paintingB;
  uniform sampler2D holesB; // where B's lamps were painted out
  uniform float eyeB; // B's eye, metres across
  uniform float mixB; // how far the camera has come from the middle lane toward B: 0 to 1
  uniform vec2 size;
  uniform vec2 vanish;
  uniform float focal;
  uniform float eye;
  varying vec3 vWorld;
  vec2 pixelOf(vec3 p, float eyeX) {
    float depth = max(0.01, -p.z);
    return vec2(vanish.x + focal * (p.x - eyeX) / depth, vanish.y - focal * (p.y - eye) / depth);
  }
  bool inPainting(vec2 pixel) {
    return pixel.x >= 0.0 && pixel.x <= size.x && pixel.y <= size.y;
  }
  vec2 uvOf(vec2 pixel) {
    return clamp(vec2(pixel.x / size.x, 1.0 - pixel.y / size.y), vec2(0.0005), vec2(0.9995));
  }
  vec2 steppedPixel(vec3 p, float eyeX) {
    vec2 pixel = pixelOf(p, eyeX);
    for (int i = 0; i < 8; i++) {
      if (inPainting(pixel)) break;
      p.z -= ${BRIDGE.repeatStep.toFixed(2)};
      pixel = pixelOf(p, eyeX);
    }
    return pixel;
  }
  // How fully a painting covers a pixel. Once the camera has moved off a painting's eye, its side
  // edges come into view; there it fades out over its last few dozen columns, so where it runs
  // out and another painting (or plain stone) takes over, they blend. At its own eye the camera
  // frames it exactly (paintingFrame), its edges are the screen's, and it covers fully to them.
  float coverage(vec2 pixel, float fromEye) {
    if (pixel.y > size.y) return 0.0;
    float fade = 48.0 * clamp(fromEye / 0.5, 0.0, 1.0);
    float inside = min(pixel.x, size.x - pixel.x);
    return fade > 0.0 ? clamp(inside / fade, 0.0, 1.0) : step(0.0, inside);
  }
  float coverageA(vec2 pixel) { return coverage(pixel, abs(mixB * eyeB)); }
  float coverageB(vec2 pixel) { return coverage(pixel, abs((1.0 - mixB) * eyeB)); }
  // The two paintings' views of one point, mixed by how far the camera has come. Each takes its
  // share as far as it covers the point, and whatever share one cannot cover goes to the other.
  // B also leaves out where a lamp was painted out of it (the middle lane's painting sees what
  // stood behind that lamp), unless A cannot see the point either. seen: how fully the two
  // together cover it, for blending into plain stone where neither does.
  vec4 mixViews(vec4 a, float covA, vec4 b, float covB, float hole, out float seen) {
    if (covA + covB * (1.0 - hole) > 0.001) covB *= 1.0 - hole;
    seen = max(covA, covB);
    if (covA + covB <= 0.0) return vec4(0.0);
    float wa = (1.0 - mixB) * covA, wb = mixB * covB;
    float left = 1.0 - wa - wb, share = left / (covA + covB);
    wa += share * covA;
    wb += share * covB;
    float alpha = wa * a.a + wb * b.a;
    return vec4((wa * a.a * a.rgb + wb * b.a * b.rgb) / max(alpha, 0.0001), alpha);
  }
  float holeAt(vec2 pixel) {
    return texture2D(holesB, uvOf(pixel)).r;
  }`;

// Where neither painting reaches (the parapet right beside you, before the side lane's painting
// has faded in, or the edges of a very wide window), the stone is drawn as plain comic stone in
// the painting's colours: halftoned pink blocks under a cream capstone, with inked joints.
const PARAPET = `
  float parapetTopAt(float depth) {
    return min(${BRIDGE.parapetTop.toFixed(3)}, ${BRIDGE.parapetTop.toFixed(3)} - ${BRIDGE.parapetSlope.toFixed(4)} * (depth - ${BRIDGE.parapetSlopeFrom.toFixed(3)}));
  }`;

const STONE = `${PARAPET}
  uniform float surface; // 0: deck, landing or gatehouse; 1: parapet face; 2: capstone
  uniform vec3 facePaint;
  uniform vec3 faceShade;
  uniform vec3 capPaint;
  float inkLine(float distanceToLine, float width) {
    float w = fwidth(distanceToLine);
    return 1.0 - smoothstep(width * 0.5 - w, width * 0.5 + w, abs(distanceToLine));
  }
  float joints(float along, float spacing, float width) {
    return inkLine(along - spacing * floor(along / spacing + 0.5), width);
  }
  vec3 stone() {
    vec3 ink = vec3(0.0144, 0.0084, 0.0070);
    float along = -vWorld.z;
    if (surface < 1.5) {
      vec2 cell = fract(vec2(along, vWorld.y) / 0.035) - 0.5;
      float dot = 1.0 - smoothstep(0.36, 0.44, length(cell));
      float lines = max(joints(along, 0.9, 0.025), max(inkLine(vWorld.y - (parapetTopAt(along) - 0.13), 0.03), inkLine(vWorld.y - 0.015, 0.03)));
      return mix(mix(facePaint, faceShade, dot), ink, lines);
    }
    float across = abs(vWorld.x);
    float lines = max(joints(along, 0.7, 0.025), max(inkLine(across - ${BRIDGE.deckHalf.toFixed(2)}, 0.035), inkLine(across - ${BRIDGE.capOuter.toFixed(2)}, 0.035)));
    return mix(capPaint, ink, lines);
  }`;

const SET_FRAGMENT = `${PROJECT}${STONE}
  void main() {
    bool ground = surface < 0.5;
    vec2 pa = ground ? steppedPixel(vWorld, 0.0) : pixelOf(vWorld, 0.0);
    vec2 pb = ground ? steppedPixel(vWorld, eyeB) : pixelOf(vWorld, eyeB);
    float seen;
    vec4 c = mixViews(texture2D(paintingA, uvOf(pa)), coverageA(pa), texture2D(paintingB, uvOf(pb)), coverageB(pb), holeAt(pb), seen);
    if (ground) {
      if (seen <= 0.0) c = texture2D(paintingA, uvOf(pa)); // nothing better: the nearest of A
    } else if (seen < 1.0) {
      c = mix(vec4(stone(), 1.0), c, seen);
    }
    if (c.a < ${CUT}) discard;
    gl_FragColor = c; // a soft edge covers part of the pixel (alpha to coverage), so cut edges stay smooth
    #include <colorspace_fragment>
  }`;

// A lamp: the lamps' layers, so only the lamp itself, with its empty cage showing the flame
// behind. Each card shows only its own lamp (the owner maps), so where lamps overlap in one
// painting the nearer one does not carry the farther one's pixels along with it.
const LAMP_VERTEX = `
  attribute float lamp;
  varying vec3 vWorld;
  varying float vLamp;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vLamp = lamp;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const LAMP_FRAGMENT = `${PROJECT}
  uniform sampler2D ownersA;
  uniform sampler2D ownersB;
  varying float vLamp;
  float ownerAt(sampler2D owners, vec2 pixel) {
    return floor(texture2D(owners, uvOf(pixel)).r * 255.0 / 20.0 + 0.5) - 1.0;
  }
  void main() {
    vec2 pa = pixelOf(vWorld, 0.0), pb = pixelOf(vWorld, eyeB);
    vec4 a = texture2D(paintingA, uvOf(pa)), b = texture2D(paintingB, uvOf(pb));
    if (abs(ownerAt(ownersA, pa) - vLamp) > 0.5) a.a = 0.0;
    if (abs(ownerAt(ownersB, pb) - vLamp) > 0.5) b.a = 0.0;
    float seen;
    vec4 c = mixViews(a, coverageA(pa), b, coverageB(pb), 0.0, seen);
    if (c.a < ${CUT}) discard;
    gl_FragColor = c;
    #include <colorspace_fragment>
  }`;

// The thin strips along the parapets' and rims' outer top edges: the paintings only, straight
// from their eyes, so the few rows of painted edge above the simple shapes have something to land
// on. Where neither painting reaches there is nothing to show.
const EDGE_FRAGMENT = `${PROJECT}
  void main() {
    vec2 pa = pixelOf(vWorld, 0.0), pb = pixelOf(vWorld, eyeB);
    float seen;
    vec4 c = mixViews(texture2D(paintingA, uvOf(pa)), coverageA(pa), texture2D(paintingB, uvOf(pb)), coverageB(pb), holeAt(pb), seen);
    c.a *= seen;
    if (c.a < ${CUT}) discard;
    gl_FragColor = c;
    #include <colorspace_fragment>
  }`;

// The landing's rim walls. Where a painting's eye sees them they carry that painting, like the
// rest of the set. Their front stretch hides behind the parapet's end from the middle lane, so
// that painting has the parapet in its place; where no painting's eye sees the rim, it is drawn
// as comic stone.
const RIM_VERTEX = `
  attribute vec2 rim;
  varying vec3 vWorld;
  varying vec2 vRim;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vRim = rim;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const RIM_FRAGMENT = `${PROJECT}${PARAPET}
  uniform float surface; // 1: a face, 2: the top
  uniform vec3 facePaint;
  uniform vec3 faceShade;
  uniform vec3 capPaint;
  varying vec2 vRim; // metres along the rim, and across its top (0 outer edge, 1 inner)
  float inkLine(float distanceToLine, float width) {
    float w = fwidth(distanceToLine);
    return 1.0 - smoothstep(width * 0.5 - w, width * 0.5 + w, abs(distanceToLine));
  }
  float joints(float along, float spacing, float width) {
    return inkLine(along - spacing * floor(along / spacing + 0.5), width);
  }
  // Whether the parapet stands between a painting's eye, eyeX metres across, and this point.
  bool behindParapet(vec3 p, float eyeX) {
    if (abs(p.x) <= ${BRIDGE.deckHalf.toFixed(2)}) return false;
    float side = sign(p.x), span = p.x - eyeX;
    float inner = (side * ${BRIDGE.deckHalf.toFixed(2)} - eyeX) / span, outer = min(1.0, (side * ${BRIDGE.capOuter.toFixed(2)} - eyeX) / span);
    for (int i = 0; i <= 6; i++) {
      float t = mix(inner, outer, float(i) / 6.0); // the fraction of the way from the eye
      float depth = -p.z * t;
      if (depth < ${(-BRIDGE.landingZ).toFixed(2)} && eye + (p.y - eye) * t < parapetTopAt(depth)) return true;
    }
    return false;
  }
  vec3 rimStone() {
    vec3 ink = vec3(0.0144, 0.0084, 0.0070);
    if (surface < 1.5) {
      vec2 cell = fract(vec2(vRim.x, vWorld.y) / 0.035) - 0.5;
      float dot = 1.0 - smoothstep(0.36, 0.44, length(cell));
      float lines = max(joints(vRim.x, 0.9, 0.025), max(inkLine(vWorld.y - ${(RIM.height - 0.1).toFixed(2)}, 0.03), inkLine(vWorld.y - 0.015, 0.03)));
      return mix(mix(facePaint, faceShade, dot), ink, lines);
    }
    float lines = max(joints(vRim.x, 0.7, 0.025), max(inkLine(vRim.y * ${RIM.thickness.toFixed(2)}, 0.035), inkLine((1.0 - vRim.y) * ${RIM.thickness.toFixed(2)}, 0.035)));
    return mix(capPaint, ink, lines);
  }
  void main() {
    vec2 pa = pixelOf(vWorld, 0.0), pb = pixelOf(vWorld, eyeB);
    float covA = behindParapet(vWorld, 0.0) ? 0.0 : coverageA(pa), covB = behindParapet(vWorld, eyeB) ? 0.0 : coverageB(pb);
    float seen;
    vec4 c = mixViews(texture2D(paintingA, uvOf(pa)), covA, texture2D(paintingB, uvOf(pb)), covB, holeAt(pb), seen);
    if (seen < 1.0) c = mix(vec4(rimStone(), 1.0), c, seen);
    if (c.a < ${CUT}) discard;
    gl_FragColor = c;
    #include <colorspace_fragment>
  }`;

/**
 * A band between two lines of points (same count), each point [x, y, z], with each point's
 * [along, across] for the rim shader.
 */
function band(lineA, lineB, rimA, rimB) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...lineA, ...lineB].flat(), 3));
  geometry.setAttribute('rim', new THREE.Float32BufferAttribute([...rimA, ...rimB].flat(), 2));
  const index = [], n = lineA.length;
  for (let i = 0; i < n - 1; i += 1) index.push(i, i + 1, n + i + 1, i, n + i + 1, n + i);
  geometry.setIndex(index);
  return geometry;
}

/** One side's rim wall: outer face, top and inner face, and the end behind the towers. */
function rimWall(side) {
  const { height, thickness } = RIM;
  const outer = rimOutline(side, 0), inner = rimOutline(side, thickness);
  let run = 0;
  const along = outer.map(([x, z], i) => (run += i ? Math.hypot(x - outer[i - 1][0], z - outer[i - 1][1]) : 0));
  const at = (line, y) => line.map(([x, z]) => [x, y, z]);
  const rimAt = across => along.map(a => [a, across]);
  const last = outer.length - 1;
  return {
    faces: [
      band(at(outer, 0), at(outer, height), rimAt(0), rimAt(0)),
      band(at(inner, 0), at(inner, height), rimAt(1), rimAt(1)),
      band([[outer[last][0], 0, outer[last][1]], [outer[last][0], height, outer[last][1]]],
        [[inner[last][0], 0, inner[last][1]], [inner[last][0], height, inner[last][1]]],
        [[along[last], 0], [along[last], 0]], [[along[last], 1], [along[last], 1]]),
    ],
    top: band(at(outer, height), at(inner, height), rimAt(0), rimAt(1)),
    edge: band(at(outer, height), at(outer, height + EDGE), rimAt(0), rimAt(0)),
  };
}

/** A flat four-cornered shape from its corners, in order around the edge. */
function quad(corners) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

// The three paintings' layers, by lane: the middle lane's is A; a side lane's becomes B as the
// camera heads that way.
const LANE_PAINTINGS = { centre: 'bridge', right: 'bridge-right', left: 'bridge-left' };
const SIDE_EYE = 2; // metres: the side lanes' paintings were painted from config.lanes.offset across

export function createBridge(scene, { base = './assets/scene/' } = {}) {
  const loader = new THREE.TextureLoader();
  const colour = url => {
    const texture = loader.load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  };
  const data = (url, filter) => {
    const texture = loader.load(url);
    texture.minFilter = texture.magFilter = filter;
    texture.generateMipmaps = false;
    return texture;
  };
  const layers = Object.fromEntries(Object.entries(LANE_PAINTINGS).map(([lane, name]) => [lane, {
    set: colour(`${base}${name}.png`),
    lamps: colour(`${base}${name}-lamps.png`),
    owners: data(`${base}${name}-lamps-owner.png`, THREE.NearestFilter),
    holes: data(`${base}${name}-holes.png`, THREE.LinearFilter),
  }]));

  const shared = {
    paintingA: { value: layers.centre.set },
    paintingB: { value: layers.right.set },
    holesB: { value: layers.right.holes },
    eyeB: { value: SIDE_EYE },
    mixB: { value: 0 },
    size: { value: new THREE.Vector2(PAINTING.width, PAINTING.height) },
    vanish: { value: new THREE.Vector2(PAINTING.vanish.x, PAINTING.vanish.y) },
    focal: { value: PAINTING.focal },
    eye: { value: PAINTING.eye },
  };
  // The lamp cards' own: the lamps' layers in place of the sets.
  const lampUniforms = {
    paintingA: { value: layers.centre.lamps },
    paintingB: { value: layers.right.lamps },
    ownersA: { value: layers.centre.owners },
    ownersB: { value: layers.right.owners },
  };
  // The parapet's colours, sampled from the painting (sRGB), for the stone it cannot cover.
  const linear = hex => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
  const stoneColours = {
    facePaint: { value: linear('#ec7883') },
    faceShade: { value: linear('#b22c43') },
    capPaint: { value: linear('#fdcf97') },
  };
  const material = (fragmentShader, extra = {}) => new THREE.ShaderMaterial({
    uniforms: { ...shared, ...extra },
    vertexShader: VERTEX,
    fragmentShader,
    side: THREE.DoubleSide,
    alphaToCoverage: true,
  });

  const group = new THREE.Group();
  const { deckHalf: d, capOuter: cap, landingZ: land, landingHalf: wide, gateZ: gate, gateHalf, gateTop, parapetSlopeFrom } = BRIDGE;
  const ground = material(SET_FRAGMENT, { ...stoneColours, surface: { value: 0 } });
  const face = material(SET_FRAGMENT, { ...stoneColours, surface: { value: 1 } });
  const capstone = material(SET_FRAGMENT, { ...stoneColours, surface: { value: 2 } });
  const near = 1; // just behind the player, so the deck runs off the bottom of the screen
  const landingFront = rimOutline(1)[0][1]; // where the rim leaves the parapet's side
  const pieces = [
    [ground, [[-d, 0, near], [d, 0, near], [d, 0, landingFront], [-d, 0, landingFront]]], // deck
    [ground, [[-wide, 0, landingFront], [wide, 0, landingFront], [wide, 0, gate], [-wide, 0, gate]]], // landing
    [ground, [[-gateHalf, 0, gate], [gateHalf, 0, gate], [gateHalf, gateTop, gate], [-gateHalf, gateTop, gate]]], // gatehouse
  ];
  // The parapets: level near the player, then sloping down to their end.
  const stretches = [[near, -parapetSlopeFrom], [-parapetSlopeFrom, land]];
  for (const side of [-1, 1]) {
    for (const [from, to] of stretches) {
      const top = z => parapetTopAt(-z);
      pieces.push([face, [[side * d, 0, from], [side * d, 0, to], [side * d, top(to), to], [side * d, top(from), from]]]);
      pieces.push([capstone, [[side * d, top(from), from], [side * cap, top(from), from], [side * cap, top(to), to], [side * d, top(to), to]]]);
    }
  }
  // A strip along each parapet's outer top edge, EDGE metres tall.
  const edge = material(EDGE_FRAGMENT);
  for (const side of [-1, 1]) {
    for (const [from, to] of stretches) {
      const top = z => parapetTopAt(-z);
      pieces.push([edge, [[side * cap, top(from), from], [side * cap, top(to), to], [side * cap, top(to) + EDGE, to], [side * cap, top(from) + EDGE, from]]]);
    }
  }
  for (const [surface, corners] of pieces) group.add(new THREE.Mesh(quad(corners), surface));

  const rimMaterial = surface => new THREE.ShaderMaterial({
    uniforms: { ...shared, ...stoneColours, surface: { value: surface } },
    vertexShader: RIM_VERTEX,
    fragmentShader: RIM_FRAGMENT,
    side: THREE.DoubleSide,
    alphaToCoverage: true,
  });
  const rimFace = rimMaterial(1), rimTop = rimMaterial(2);
  for (const side of [-1, 1]) {
    const wall = rimWall(side);
    for (const geometry of wall.faces) group.add(new THREE.Mesh(geometry, rimFace));
    group.add(new THREE.Mesh(wall.top, rimTop));
    group.add(new THREE.Mesh(wall.edge, edge));
  }

  const lampMaterial = new THREE.ShaderMaterial({
    uniforms: { ...shared, ...lampUniforms },
    vertexShader: LAMP_VERTEX,
    fragmentShader: LAMP_FRAGMENT,
    side: THREE.DoubleSide,
    alphaToCoverage: true,
  });
  const sheet = createFlameSheet();
  const flames = LAMPS.map((box, index) => {
    const card = lampCard(box);
    // A little larger than the lamp, since the side lanes' painters drew some lamps a touch
    // larger; each card only shows its own lamp's pixels.
    const half = card.width * 0.75, height = card.top - card.bottom;
    const bottom = card.bottom - 0.08 * height, top = card.top + 0.12 * height;
    const corners = [[card.x - half, bottom, card.z], [card.x + half, bottom, card.z], [card.x + half, top, card.z], [card.x - half, top, card.z]];
    const geometry = quad(corners);
    geometry.setAttribute('lamp', new THREE.Float32BufferAttribute([index, index, index, index], 1));
    group.add(new THREE.Mesh(geometry, lampMaterial));

    // The flame stands just behind the lamp, on the same line of sight, so the cage and cup
    // stay in front of it. Painting pixels become metres at the lamp's depth.
    const spot = flameSpot(box);
    const perPixel = -card.z / PAINTING.focal;
    const unit = spot.unit * perPixel;
    const texture = sheet.clone();
    const flame = new THREE.Mesh(
      new THREE.PlaneGeometry((FLAME_BOX.right - FLAME_BOX.left) * unit, (FLAME_BOX.bottom - FLAME_BOX.top) * unit),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }),
    );
    const behind = 1.004; // a few centimetres further along the same line of sight
    const baseY = PAINTING.eye - (spot.base - PAINTING.vanish.y) * perPixel;
    flame.position.set(
      ((spot.x - PAINTING.vanish.x) * perPixel) * behind,
      PAINTING.eye + (baseY - (FLAME_BOX.bottom + FLAME_BOX.top) / 2 * unit - PAINTING.eye) * behind,
      card.z * behind,
    );
    flame.scale.setScalar(behind);
    group.add(flame);
    // Each lamp burns at its own pace, from its own starting drawing.
    return { texture, fps: 9 + (index % 3), start: (index * 0.37) % 1 };
  });
  scene.add(group);

  let side = 'right';
  return {
    group,
    /** cameraX: metres across; the paintings are mixed by how far it is from the middle lane. */
    update(now = performance.now(), cameraX = 0) {
      const heading = cameraX < 0 ? 'left' : 'right';
      if (heading !== side) {
        side = heading;
        shared.paintingB.value = layers[side].set;
        shared.holesB.value = layers[side].holes;
        lampUniforms.paintingB.value = layers[side].lamps;
        lampUniforms.ownersB.value = layers[side].owners;
        shared.eyeB.value = side === 'left' ? -SIDE_EYE : SIDE_EYE;
      }
      shared.mixB.value = Math.min(1, Math.abs(cameraX) / SIDE_EYE);
      for (const flame of flames) {
        const frame = Math.floor((now / 1000) * flame.fps + flame.start * FLAME_SHEET.frames) % FLAME_SHEET.frames;
        showFrame(flame.texture, frame);
      }
    },
  };
}
