document.documentElement.lang = "it";
// Editable Batch 2 game. Rebuild using the platform app/h5_build/build.js.
const PACKAGE_CONFIG_FALLBACK = {
  "tweaks": [{
    "id": "MAX_HEALTH",
    "kind": "number",
    "label": "Health",
    "value": 100,
    "default": 100,
    "min": 20,
    "max": 200,
    "step": 10
  }, {
    "id": "MAX_STAMINA",
    "kind": "number",
    "label": "Stamina",
    "value": 100,
    "default": 100,
    "min": 40,
    "max": 200,
    "step": 10
  }, {
    "id": "PLAYER_DAMAGE",
    "kind": "number",
    "label": "Player damage",
    "value": 25,
    "default": 25,
    "min": 5,
    "max": 100,
    "step": 5
  }, {
    "id": "AI_DAMAGE",
    "kind": "number",
    "label": "Opponent damage",
    "value": 34,
    "default": 34,
    "min": 5,
    "max": 100,
    "step": 5
  }, {
    "id": "ATTACK_RANGE",
    "kind": "number",
    "label": "Attack range",
    "value": 1.75,
    "default": 1.75,
    "min": 1,
    "max": 3,
    "step": 0.05
  }, {
    "id": "MOVE_SPEED",
    "kind": "number",
    "label": "Movement speed",
    "value": 2.8,
    "default": 2.8,
    "min": 1,
    "max": 5,
    "step": 0.1
  }],
  "texts": [{
    "id": "DRAW_HINT",
    "label": "Drawing hint",
    "value": "Disegna il tuo lottatore",
    "default": "Disegna il tuo lottatore",
    "max_length": 30
  }, {
    "id": "BATTLE_HINT",
    "label": "Battle hint",
    "value": "Muoviti, para, attacca",
    "default": "Muoviti, para, attacca",
    "max_length": 30
  }, {
    "id": "UNDO",
    "label": "Annulla",
    "value": "Annulla",
    "default": "Annulla",
    "max_length": 20
  }, {
    "id": "CLEAR",
    "label": "Cancella",
    "value": "Cancella",
    "default": "Cancella",
    "max_length": 20
  }, {
    "id": "FIGHT",
    "label": "Combatti",
    "value": "Combatti",
    "default": "Combatti",
    "max_length": 20
  }, {
    "id": "GUARD",
    "label": "Para",
    "value": "Para",
    "default": "Para",
    "max_length": 20
  }, {
    "id": "ATTACK",
    "label": "Attacca",
    "value": "Attacca",
    "default": "Attacca",
    "max_length": 20
  }, {
    "id": "WIN",
    "label": "Win",
    "value": "Hai vinto",
    "default": "Hai vinto",
    "max_length": 25
  }, {
    "id": "LOSE",
    "label": "Lose",
    "value": "Al tappeto",
    "default": "Al tappeto",
    "max_length": 25
  }, {
    "id": "REPLAY",
    "label": "Replay",
    "value": "Rigioca",
    "default": "Rigioca",
    "max_length": 20
  }, {
    "id": "EDIT",
    "label": "Edit",
    "value": "Modifica lottatore",
    "default": "Modifica lottatore",
    "max_length": 20
  }],
  "images": [],
  "config_version": "2.0",
  "playable": {
    "post_id": "112333418872032316",
    "version_id": "112333418871938216",
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "it",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const PACKAGE_HTML_STYLES = "\n    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }\n    body { background: #050510; -webkit-tap-highlight-color: transparent; }\n  ";
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';

// Keep startup usable when the host stalls the local config request.
async function loadGameConfig() {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let deadline;
  try {
    const request = fetch('./game.config.json', {
      signal: controller?.signal
    }).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    const timeout = new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('timed out')), 1200);
    });
    const config = await Promise.race([request, timeout]);
    if (!config || typeof config !== 'object' || Array.isArray(config) || ['tweaks', 'texts', 'images'].some(key => config[key] != null && !Array.isArray(config[key]))) {
      throw new Error('invalid config');
    }
    return config;
  } catch (error) {
    console.warn('[playable] Using packaged defaults:', error.message);
    return null;
  } finally {
    clearTimeout(deadline);
    controller?.abort();
  }
}

// Some hosts only notify the game through the window resize event.
function watchGameSize(container, resize) {
  resize();
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }
  window.addEventListener('resize', resize);
  return () => window.removeEventListener('resize', resize);
}

// The feed cover can animate without touching the real game state.
let inFeedCover = window.parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
if (inFeedCover) {
  document.documentElement.dataset.feedCover = 'true';
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    inFeedCover = event.data.active !== true;
    document.documentElement.dataset.feedCover = String(inFeedCover);
  });
}
const defaults = {
  MAX_HEALTH: 100,
  MAX_STAMINA: 100,
  PLAYER_DAMAGE: 25,
  AI_DAMAGE: 25,
  ATTACK_RANGE: 1.75,
  MOVE_SPEED: 2.8,
  DRAW_HINT: "Disegna il tuo lottatore",
  BATTLE_HINT: "Muoviti, para, attacca",
  UNDO: "Annulla",
  CLEAR: "Cancella",
  FIGHT: "Combatti",
  GUARD: "Para",
  ATTACK: "Attacca",
  WIN: "Hai vinto",
  LOSE: "Al tappeto",
  REPLAY: "Rigioca",
  EDIT: "Modifica lottatore"
};
if (window.SFX) window.SFX.register({
  click: './assets/sfx_click.mp3',
  draw: 'buzzer',
  swoosh: 'buzzer',
  hit: './assets/sfx_punch.mp3',
  block: './assets/sfx_guard.mp3',
  footstep: './assets/sfx_footstep.mp3',
  result: './assets/sfx_result.mp3',
  unusedBlock: './assets/sfx_block.mp3',
  unusedDraw: './assets/sfx_draw.mp3',
  unusedHit: './assets/sfx_hit.mp3',
  unusedStep: './assets/sfx_step.mp3',
  unusedSwoosh: './assets/sfx_swoosh.mp3'
}); // click: selections, draw: stroke, swoosh: attack, hit: fist impact, block: guard cue, footstep: movement, result: round end
const sound = (name, once = false) => {
  try {
    if (document.visibilityState === 'visible' && window.SFX) {
      once ? window.SFX.playOnce(name) : window.SFX.play(name);
    }
  } catch (e) {}
};
const inkColors = [{
  name: "Blu ardesia",
  value: '#4e648b'
}, {
  name: "Corallo",
  value: '#ed7163'
}, {
  name: "Oro",
  value: '#f4b94d'
}, {
  name: "Azzurro",
  value: '#72b7d3'
}, {
  name: "Menta",
  value: '#8abf9d'
}, {
  name: "Lavanda",
  value: '#ad8ad2'
}];
const defaultInk = inkColors[0].value;
function paint(ctx, strokes, strokeWidth = 9) {
  ctx.clearRect(0, 0, 340, 340);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = strokeWidth;
  for (const {
    points,
    color = defaultInk
  } of strokes) {
    if (!points.length) continue;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, strokeWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
}

// Fill every region surrounded by drawn strokes, including regions formed
// across multiple strokes. Unenclosed strokes stay as solid 3D lines.
function fillEnclosedRegions(ctx) {
  const width = ctx.canvas.width,
    height = ctx.canvas.height;
  const pixels = ctx.getImageData(0, 0, width, height);
  const data = pixels.data;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0,
    tail = 0;
  const enqueue = index => {
    if (visited[index] || data[index * 4 + 3] >= 128) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  const visitAdjacent = (index, visit) => {
    const x = index % width;
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index < width * (height - 1)) visit(index + width);
  };
  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    enqueue((y + 1) * width - 1);
  }
  while (head < tail) visitAdjacent(queue[head++], enqueue);

  // Use the most common outline color for each enclosed shape. Keep any
  // accents drawn inside the shape, and leave the canvas exterior transparent.
  for (let index = 0; index < width * height; index++) {
    if (visited[index] || data[index * 4 + 3] >= 128) continue;
    head = 0;
    tail = 0;
    enqueue(index);
    const counts = new Map();
    let fill = Number.parseInt(defaultInk.slice(1), 16);
    let largestCount = 0;
    const inspect = neighbor => {
      const pixel = neighbor * 4;
      if (data[pixel + 3] < 128) {
        enqueue(neighbor);
        return;
      }
      const rgb = data[pixel] << 16 | data[pixel + 1] << 8 | data[pixel + 2];
      const count = (counts.get(rgb) ?? 0) + 1;
      counts.set(rgb, count);
      if (count > largestCount) {
        fill = rgb;
        largestCount = count;
      }
    };
    while (head < tail) visitAdjacent(queue[head++], inspect);
    for (let i = 0; i < tail; i++) {
      const pixel = queue[i] * 4;
      data[pixel] = fill >> 16;
      data[pixel + 1] = fill >> 8 & 255;
      data[pixel + 2] = fill & 255;
      data[pixel + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
}
// Turn the painted silhouette into a single rounded volume. Open strokes
// become solid ink, while the empty space between strokes stays open.
function makePlayer(strokes) {
  const source = document.createElement('canvas');
  source.width = source.height = 340;
  const sourceContext = source.getContext('2d');
  paint(sourceContext, strokes, 14);
  fillEnclosedRegions(sourceContext);
  let left = 340,
    top = 340,
    right = 0,
    bottom = 0;
  for (const {
    points
  } of strokes) {
    for (const {
      x,
      y
    } of points) {
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const size = 88;
  const sample = document.createElement('canvas');
  sample.width = sample.height = size;
  const ctx = sample.getContext('2d');
  const scale = (size - 8) / Math.max(right - left + 24, bottom - top + 24);
  ctx.drawImage(source, size / 2 - (left + right) / 2 * scale, size / 2 - (top + bottom) / 2 * scale, 340 * scale, 340 * scale);
  const rgba = ctx.getImageData(0, 0, size, size).data;
  const filled = (x, y) => x >= 0 && y >= 0 && x < size && y < size && rgba[(y * size + x) * 4 + 3] > 84;
  let base = 0;
  let distances = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (filled(x, y)) {
        base = y + 1;
        distances[y * size + x] = size;
      }
    }
  }
  // A distance field rounds the sides and gives wider regions more volume.
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      distances[i] = Math.min(distances[i], distances[i - 1] + 1, distances[i - size] + 1, distances[i - size - 1] + 1.414, distances[i - size + 1] + 1.414);
    }
  }
  for (let y = size - 2; y >= 1; y--) {
    for (let x = size - 2; x >= 1; x--) {
      const i = y * size + x;
      distances[i] = Math.min(distances[i], distances[i + 1] + 1, distances[i + size] + 1, distances[i + size - 1] + 1.414, distances[i + size + 1] + 1.414);
    }
  }

  // Soften ridges where distances from different edges meet.
  let softenedDistances = new Float32Array(distances.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        if (distances[i] === 0) continue;
        softenedDistances[i] = distances[i] * .5 + .125 * (distances[i - 1] + distances[i + 1] + distances[i - size] + distances[i + size]);
      }
    }
    [distances, softenedDistances] = [softenedDistances, distances];
  }
  let positions = [];
  const colors = [],
    faces = [];
  const vertices = new Map();
  const outline = new Map();
  const color = new THREE.Color();
  function vertex(x, y, side) {
    const key = (y * (size + 1) + x) * 2 + (side > 0 ? 1 : 0);
    if (vertices.has(key)) return vertices.get(key);
    let red = 0,
      green = 0,
      blue = 0,
      weight = 0;
    let distance = 0;
    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -1; dx <= 0; dx++) {
        const px = x + dx,
          py = y + dy;
        if (!filled(px, py)) continue;
        const sampleIndex = py * size + px;
        distance += distances[sampleIndex];
        const i = sampleIndex * 4;
        red += rgba[i];
        green += rgba[i + 1];
        blue += rgba[i + 2];
        weight++;
      }
    }
    const index = positions.length / 3;
    const unit = 2.17 / (size - 8);
    // Bring both sides together at the rim and let the center bow outward.
    const inset = weight === 4 ? Math.max(0, distance * .25 - .5) : 0;
    const depth = .012 + .55 * (1 - Math.exp(-inset / 9.5));
    positions.push((x - size / 2) * unit, (base - y) * unit + .025, side * depth);
    color.setRGB(red / (weight * 255), green / (weight * 255), blue / (weight * 255), THREE.SRGBColorSpace);
    colors.push(color.r, color.g, color.b);
    vertices.set(key, index);
    return index;
  }
  function connectOutline(a, b) {
    if (!outline.has(a)) outline.set(a, []);
    if (!outline.has(b)) outline.set(b, []);
    outline.get(a).push(b);
    outline.get(b).push(a);
  }
  function wall(ax, ay, bx, by) {
    const frontA = vertex(ax, ay, 1),
      frontB = vertex(bx, by, 1);
    const backA = vertex(ax, ay, -1),
      backB = vertex(bx, by, -1);
    faces.push(frontB, frontA, backA, frontB, backA, backB);
    connectOutline(frontA, frontB);
    connectOutline(backA, backB);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!filled(x, y)) continue;
      const a = vertex(x, y, 1),
        b = vertex(x, y + 1, 1);
      const c = vertex(x + 1, y + 1, 1),
        d = vertex(x + 1, y, 1);
      faces.push(a, b, c, a, c, d);
      const backA = vertex(x, y, -1),
        backB = vertex(x, y + 1, -1);
      const backC = vertex(x + 1, y + 1, -1),
        backD = vertex(x + 1, y, -1);
      faces.push(backA, backC, backB, backA, backD, backC);
      if (!filled(x - 1, y)) wall(x, y, x, y + 1);
      if (!filled(x, y + 1)) wall(x, y + 1, x + 1, y + 1);
      if (!filled(x + 1, y)) wall(x + 1, y + 1, x + 1, y);
      if (!filled(x, y - 1)) wall(x + 1, y, x, y);
    }
  }
  let smoothed = positions.slice();
  for (let pass = 0; pass < 3; pass++) {
    for (const [index, neighbors] of outline) {
      if (neighbors.length !== 2) continue;
      const [a, b] = neighbors;
      for (let axis = 0; axis < 2; axis++) {
        smoothed[index * 3 + axis] = positions[index * 3 + axis] * .56 + (positions[a * 3 + axis] + positions[b * 3 + axis]) * .22;
      }
    }
    [positions, smoothed] = [smoothed, positions];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: .83
  }));
}
function blob(color, x, y, z, sx, sy, sz) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshToonMaterial({
    color
  }));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}
function outlineCat(mesh) {
  const edge = new THREE.Mesh(mesh.geometry.clone(), new THREE.MeshBasicMaterial({
    color: 0x304252,
    side: THREE.BackSide
  }));
  edge.scale.setScalar(1.047);
  mesh.add(edge);
  return mesh;
}
function makeImpactTexture(guarded) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 144;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#343946';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  function polygon(points, fill, lineWidth) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  const spark = guarded ? '#d4f1ff' : '#f4a079';
  polygon([[14, 27], [29, 36], [24, 43]], spark, 3.5);
  polygon([[106, 15], [103, 31], [96, 25]], spark, 3.5);
  polygon([[130, 112], [115, 110], [121, 103]], spark, 3.5);
  polygon([[22, 117], [29, 104], [34, 112]], spark, 3.5);
  polygon([[68, 17], [82, 47], [105, 37], [103, 59], [129, 71], [104, 82], [111, 108], [88, 101], [76, 129], [62, 104], [41, 116], [45, 92], [17, 82], [43, 68], [32, 48], [56, 52]], guarded ? '#97cfeb' : '#ffd16a', 5);
  polygon([[69, 52], [77, 65], [92, 62], [85, 75], [95, 84], [79, 85], [72, 101], [65, 86], [50, 85], [59, 75], [51, 64], [64, 66]], guarded ? '#effbff' : '#fff5cf', 2.5);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function createImpactEffects(scene) {
  const hitTexture = makeImpactTexture(false);
  const guardTexture = makeImpactTexture(true);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const duration = .34;
  const effects = Array.from({
    length: 2
  }, () => {
    const material = new THREE.SpriteMaterial({
      map: hitTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.renderOrder = 5;
    scene.add(sprite);
    return {
      sprite,
      material,
      age: duration,
      size: 1
    };
  });
  return {
    pop(target, x, y, z, guarded = false) {
      const effect = effects[target === 'player' ? 0 : 1];
      effect.age = 0;
      effect.size = guarded ? 1.08 : 1.55;
      effect.sprite.position.set(x, y, z);
      effect.material.map = guarded ? guardTexture : hitTexture;
      effect.material.rotation = (Math.random() - .5) * .5;
      effect.sprite.visible = true;
    },
    update(dt) {
      for (const effect of effects) {
        if (!effect.sprite.visible) continue;
        effect.age += dt;
        const expansion = THREE.MathUtils.smoothstep(effect.age, 0, .105);
        const fade = THREE.MathUtils.smoothstep(effect.age, .125, duration);
        effect.sprite.visible = effect.age < duration;
        effect.sprite.scale.setScalar(effect.size * (reducedMotion.matches ? .92 : .60 + .40 * expansion));
        effect.material.opacity = 1 - fade;
      }
    },
    dispose() {
      for (const {
        sprite,
        material
      } of effects) {
        scene.remove(sprite);
        material.dispose();
      }
      hitTexture.dispose();
      guardTexture.dispose();
    }
  };
}
function makeCat() {
  const cat = new THREE.Group();
  const fur = 0xf5fafc,
    blue = 0xaacfe4,
    ink = 0x304252;
  function part(parent, color, x, y, z, sx, sy, sz, outlined = true) {
    const mesh = blob(color, x, y, z, sx, sy, sz);
    parent.add(outlined ? outlineCat(mesh) : mesh);
    return mesh;
  }
  function stroke(parent, points, radius = .011, color = ink) {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, radius, 5, false), new THREE.MeshBasicMaterial({
      color
    }));
    parent.add(mesh);
    return mesh;
  }
  const tailCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(.29, .55, -.23), new THREE.Vector3(.66, .51, -.12), new THREE.Vector3(.77, .79, -.08), new THREE.Vector3(.65, .94, -.06)]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 20, .105, 10, false), new THREE.MeshToonMaterial({
    color: blue
  }));
  cat.add(outlineCat(tail));
  part(cat, fur, 0, .94, 0, .47, .60, .36);
  part(cat, 0xffffff, 0, .93, .325, .31, .40, .055, false);
  for (const side of [-1, 1]) {
    part(cat, blue, side * .28, .17, .07, .25, .17, .31);
    for (const offset of [-.06, .06]) stroke(cat, [[side * .28 + offset, .23, .337], [side * .28 + offset, .19, .362], [side * .28 + offset, .16, .367]], .008);
    const arm = new THREE.Group();
    arm.position.set(side * .43, 1.11, .03);
    arm.rotation.z = side * .5;
    part(arm, blue, 0, -.07, 0, .18, .27, .20);
    part(arm, 0xe3f0f8, 0, -.28, .07, .20, .19, .22);
    for (const offset of [-.055, .055]) stroke(arm, [[offset, -.30, .271], [offset, -.26, .284], [offset, -.23, .269]], .008);
    cat.add(arm);
    if (side === -1) cat.userData.arm = arm;
  }
  const head = new THREE.Group();
  head.position.y = 1.67;
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-.19, 0);
    shape.lineTo(0, .43);
    shape.lineTo(.19, 0);
    shape.closePath();
    const ear = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {
      depth: .15,
      bevelEnabled: true,
      bevelSize: .045,
      bevelThickness: .045,
      bevelSegments: 3,
      steps: 1
    }), new THREE.MeshToonMaterial({
      color: fur
    }));
    ear.position.set(side * .34, .22, -.035);
    ear.rotation.z = -side * .18;
    head.add(outlineCat(ear));
    const inner = new THREE.Shape();
    inner.moveTo(-.10, .045);
    inner.lineTo(0, .30);
    inner.lineTo(.10, .045);
    inner.closePath();
    const inside = new THREE.Mesh(new THREE.ShapeGeometry(inner), new THREE.MeshBasicMaterial({
      color: 0xe8b8c3
    }));
    inside.position.set(side * .34, .23, .177);
    inside.rotation.z = -side * .18;
    head.add(inside);
  }
  part(head, fur, 0, 0, .015, .53, .43, .36);
  for (const side of [-1, 1]) {
    part(head, blue, side * .34, .015, .24, .18, .15, .12, false);
    part(head, 0xffffff, side * .15, -.15, .34, .16, .105, .06, false);
    part(head, ink, side * .185, .005, .365, .053, .087, .027, false);
    part(head, 0xffffff, side * .174, .037, .390, .016, .023, .009, false);
    part(head, 0xe5b2bf, side * .32, -.115, .352, .078, .032, .014, false);
    stroke(head, [[side * .15, .14, .347], [side * .19, .16, .344], [side * .235, .14, .332]], .013);
    for (const offset of [-1, 1]) stroke(head, [[side * .29, -.16, .352], [side * .43, -.15 + offset * .05, .32], [side * .58, -.14 + offset * .075, .23]], .008);
    stroke(head, [[0, -.19, .407], [side * .055, -.23, .405], [side * .105, -.20, .389]], .009);
  }
  part(head, 0xc78597, 0, -.135, .402, .047, .032, .022, false);
  stroke(head, [[0, -.15, .420], [0, -.18, .421], [0, -.195, .411]], .009);
  cat.add(head);
  part(cat, 0x75aaca, 0, 1.27, .29, .31, .045, .065, false);
  part(cat, 0xf0cb76, 0, 1.20, .367, .055, .065, .025, false);
  return cat;
}
function useSubmission() {
  const [sub, setSub] = useState(false);
  const lock = useRef(false);
  const can = typeof tt !== 'undefined' && typeof tt.playableRecordingSubmission === 'function';
  useEffect(() => {
    const restore = () => {
      lock.current = false;
      setSub(false);
    };
    const vis = () => {
      if (document.visibilityState === 'visible') restore();
    };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pageshow', restore);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('pageshow', restore);
    };
  }, []);
  const submit = () => {
    if (lock.current || !can) return;
    lock.current = true;
    setSub(true);
    sound('click');
    tt.playableRecordingSubmission({
      success() {},
      fail(err) {
        console.error('[post_my_play] failed', err?.errMsg || err?.message);
        lock.current = false;
        setSub(false);
      },
      complete() {}
    });
  };
  return {
    can,
    sub,
    submit
  };
}
function App() {
  const [cfg, setCfg] = useState(defaults);
  const [stage, setStage] = useState('draw');
  const [strokes, setStrokes] = useState([]);
  const [inkColor, setInkColor] = useState(defaultInk);
  const strokesRef = useRef([]);
  const [drawHint, setDrawHint] = useState(true);
  const [battleHint, setBattleHint] = useState(true);
  const [result, setResult] = useState('');
  const [round, setRound] = useState(0);
  const paper = useRef(null);
  const previewHost = useRef(null);
  const previewEngine = useRef(null);
  const liveStroke = useRef(null);
  const arena = useRef(null);
  const game = useRef(null);
  const missHint = useRef(null);
  const hp1 = useRef(null),
    hp2 = useRef(null),
    sp1 = useRef(null),
    sp2 = useRef(null);
  const joy = useRef(null),
    knob = useRef(null);
  const input = useRef({
    x: 0,
    z: 0,
    guard: false,
    joyId: null,
    guardId: null
  });
  const submission = useSubmission();
  useEffect(() => {
    loadGameConfig().then(j => {
      if (!j) return;
      const o = {
        ...defaults
      };
      for (const a of [...(j.tweaks || []), ...(j.texts || []), ...(j.images || [])]) o[a.id] = a.value ?? a.path;
      setCfg(o);
    });
  }, []);
  useEffect(() => {
    if (stage === 'draw' && paper.current) paint(paper.current.getContext('2d'), strokes);
  }, [strokes, stage]);
  const hasDrawing = strokes.length > 0;
  useEffect(() => {
    if (stage !== 'draw' || !hasDrawing || !previewHost.current) return;
    const host = previewHost.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true
      });
    } catch (_) {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9ba7b2, 1.6));
    const light = new THREE.DirectionalLight(0xffffff, 1.5);
    light.position.set(-2, 4, 5);
    scene.add(light);
    const camera = new THREE.OrthographicCamera(-1.48, 1.48, 1.48, -1.48, .1, 20);
    const resize = () => {
      const width = host.clientWidth,
        height = host.clientHeight;
      if (width && height) renderer.setSize(width, height, false);
    };
    const unwatch = watchGameSize(host, resize);
    const preview = {
      scene,
      camera,
      mesh: null
    };
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    previewEngine.current = preview;
    let animation;
    const frame = time => {
      animation = requestAnimationFrame(frame);
      if (document.hidden || inFeedCover) return;
      if (preview.mesh) preview.mesh.rotation.y = reducedMotion.matches ? 0 : Math.sin(time * .0013) * .55;
      renderer.render(scene, camera);
    };
    animation = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(animation);
      unwatch();
      previewEngine.current = null;
      if (preview.mesh) {
        preview.mesh.geometry.dispose();
        preview.mesh.material.dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [stage, hasDrawing]);
  useEffect(() => {
    const preview = previewEngine.current;
    if (!preview || !strokes.length) return;
    if (preview.mesh) {
      preview.scene.remove(preview.mesh);
      preview.mesh.geometry.dispose();
      preview.mesh.material.dispose();
    }
    preview.mesh = makePlayer(strokes);
    preview.scene.add(preview.mesh);
    const bounds = new THREE.Box3().setFromObject(preview.mesh);
    const centerY = (bounds.min.y + bounds.max.y) / 2;
    preview.camera.position.set(0, centerY + .15, 5);
    preview.camera.lookAt(0, centerY, 0);
  }, [stage, strokes]);
  const coords = e => {
    const r = paper.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(340, (e.clientX - r.left) * 340 / r.width)),
      y: Math.max(0, Math.min(340, (e.clientY - r.top) * 340 / r.height))
    };
  };
  const drawDown = e => {
    if (inFeedCover || e.isPrimary === false || e.button > 0 || liveStroke.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = {
      color: inkColor,
      points: [coords(e)]
    };
    liveStroke.current = {
      id: e.pointerId,
      stroke: s
    };
    strokesRef.current = [...strokesRef.current, s];
    setStrokes([...strokesRef.current]);
    setDrawHint(false);
  };
  const drawMove = e => {
    if (liveStroke.current?.id !== e.pointerId) return;
    liveStroke.current.stroke.points.push(coords(e));
    paint(paper.current.getContext('2d'), strokesRef.current);
  };
  const drawEnd = e => {
    if (liveStroke.current?.id !== e.pointerId) return;
    liveStroke.current = null;
    setStrokes([...strokesRef.current]);
    sound('draw');
  };
  const start = () => {
    if (!strokesRef.current.length) return;
    sound('click');
    window.SFX?.reset();
    input.current = {
      x: 0,
      z: 0,
      guard: false,
      joyId: null,
      guardId: null
    };
    setResult('');
    setBattleHint(round === 0);
    setRound(r => r + 1);
    setStage('battle');
    console.log('[fight] round started');
  };
  const showControls = () => setBattleHint(false);
  const joyDown = e => {
    if (input.current.joyId !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    input.current.joyId = e.pointerId;
    input.current.moveSound = false;
    joyMove(e);
  };
  const joyMove = e => {
    if (input.current.joyId !== e.pointerId) return;
    const r = joy.current.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width * .35),
      z = (e.clientY - (r.top + r.height / 2)) / (r.height * .35);
    const d = Math.hypot(x, z);
    if (d > .1 && !input.current.moveSound) {
      input.current.moveSound = true;
      showControls();
      sound('footstep');
    }
    if (d > 1) {
      x /= d;
      z /= d;
    }
    input.current.x = x;
    input.current.z = z;
    if (knob.current) knob.current.style.transform = `translate(${x * 32}px,${z * 32}px)`;
  };
  const joyEnd = e => {
    if (input.current.joyId !== e.pointerId) return;
    input.current.joyId = null;
    input.current.x = 0;
    input.current.z = 0;
    if (knob.current) knob.current.style.transform = 'translate(0,0)';
  };
  const guardDown = e => {
    if (input.current.guardId !== null || !game.current || game.current.end || game.current.ps < 5) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    input.current.guardId = e.pointerId;
    input.current.guard = true;
    showControls();
    sound('click');
    e.currentTarget.classList.add('pressed');
  };
  const guardEnd = e => {
    if (input.current.guardId !== e.pointerId) return;
    input.current.guardId = null;
    input.current.guard = false;
    e.currentTarget.classList.remove('pressed');
  };
  const attack = () => {
    const s = game.current;
    if (!s || s.end || s.pa > 0 || s.ps < 15) return;
    showControls();
    s.started = true;
    s.pa = .72;
    s.pHit = false;
    s.ps -= 15;
    sound('swoosh');
    console.log('[fight] player attack', s.px, s.ax);
  };
  useEffect(() => {
    if (stage !== 'battle' || !arena.current) return;
    const host = arena.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8f4e9);
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    camera.position.set(0, 5.8, 10.6);
    camera.lookAt(0, .55, 0);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xf8fcff, 0xa9a4a2, 1.5));
    const light = new THREE.DirectionalLight(0xffffff, 1.5);
    light.position.set(-3, 7, 5);
    scene.add(light);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.8, 80), new THREE.MeshBasicMaterial({
      color: 0xd9eef2
    }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const lines = [];
    for (let i = -7; i <= 7; i++) {
      let x = i * .48;
      let z = Math.sqrt(Math.max(0, 3.8 * 3.8 - x * x));
      lines.push(x, .012, -z, x, .012, z, -z, .012, x, z, .012, x);
    }
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    const grid = new THREE.LineSegments(lineGeom, new THREE.LineBasicMaterial({
      color: 0xb0d4de,
      transparent: true,
      opacity: .7
    }));
    scene.add(grid);
    const rim = new THREE.Mesh(new THREE.RingGeometry(3.78, 3.84, 80), new THREE.MeshBasicMaterial({
      color: 0xaed4de,
      side: THREE.DoubleSide
    }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = .02;
    scene.add(rim);
    const player = makePlayer(strokesRef.current),
      cat = makeCat();
    scene.add(player, cat);
    function shadow() {
      const sh = new THREE.Mesh(new THREE.CircleGeometry(.58, 32), new THREE.MeshBasicMaterial({
        color: 0x829eaa,
        transparent: true,
        opacity: .18
      }));
      sh.rotation.x = -Math.PI / 2;
      sh.position.y = .025;
      scene.add(sh);
      return sh;
    }
    const sh1 = shadow(),
      sh2 = shadow();
    const impacts = createImpactEffects(scene);
    const playerImpactY = new THREE.Box3().setFromObject(player).getCenter(new THREE.Vector3()).y;
    const s = {
      px: -1.32,
      pz: 0,
      ax: 1.32,
      az: 0,
      ph: cfg.MAX_HEALTH,
      ah: cfg.MAX_HEALTH,
      ps: cfg.MAX_STAMINA,
      as: cfg.MAX_STAMINA,
      pa: 0,
      pHit: false,
      miss: 0,
      aa: 0,
      aHit: false,
      aiCool: .7,
      started: false,
      end: false,
      pk: 0,
      ak: 0
    };
    game.current = s;
    let raf,
      last = 0;
    const resize = () => {
      const w = host.clientWidth,
        h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const horizontalHalfFov = THREE.MathUtils.degToRad(16.5);
      camera.fov = Math.max(38, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontalHalfFov) / camera.aspect)));
      camera.updateProjectionMatrix();
    };
    const unwatchSize = watchGameSize(host, resize);
    const finish = win => {
      if (s.end) return;
      s.end = true;
      input.current.guard = false;
      input.current.x = 0;
      input.current.z = 0;
      setResult(win ? 'win' : 'lose');
      sound('result', true);
      console.log('[fight] result', win ? 'win' : 'lose');
    };
    const frame = now => {
      raf = requestAnimationFrame(frame);
      if (!last) last = now;
      let dt = Math.min((now - last) / 1000, .05);
      last = now;
      if (document.visibilityState !== 'visible') return;
      const inp = input.current;
      if (!s.end) {
        if (Math.hypot(inp.x, inp.z) > .1 || inp.guard) s.started = true;
        if (s.started) {
          let dx = s.ax - s.px,
            dz = s.az - s.pz,
            dist = Math.hypot(dx, dz) || 1;
          const mv = Math.hypot(inp.x, inp.z);
          if (mv > .05) {
            s.px += inp.x * cfg.MOVE_SPEED * dt;
            s.pz += inp.z * cfg.MOVE_SPEED * dt;
          }
          if (dist > 1.48 && s.aa <= 0) {
            s.ax -= dx / dist * 1.35 * dt;
            s.az -= dz / dist * 1.35 * dt;
          }
          for (const key of ['px', 'ax']) s[key] = Math.max(-1.75, Math.min(1.75, s[key]));
          for (const key of ['pz', 'az']) s[key] = Math.max(-2.2, Math.min(2.2, s[key]));
          dx = s.ax - s.px;
          dz = s.az - s.pz;
          dist = Math.hypot(dx, dz) || 1;
          if (dist < .95) {
            const fix = (.95 - dist) / 2;
            s.px -= dx / dist * fix;
            s.pz -= dz / dist * fix;
            s.ax += dx / dist * fix;
            s.az += dz / dist * fix;
          }
          s.aiCool -= dt;
          if (s.aiCool <= 0 && s.aa <= 0 && dist < 2.1 && s.as >= 15) {
            s.aa = 1.05;
            s.aHit = false;
            s.as -= 15;
            s.aiCool = 1.25;
          }
          if (s.pa > 0) {
            s.pa = Math.max(0, s.pa - dt);
            if (s.pa <= .43 && !s.pHit) {
              s.pHit = true;
              if (dist <= cfg.ATTACK_RANGE) {
                s.ah = Math.max(0, s.ah - cfg.PLAYER_DAMAGE);
                s.ak = .26;
                impacts.pop('cat', s.ax - dx / dist * .32, 1.18, s.az - dz / dist * .32);
                s.ax += dx / dist * .4;
                s.az += dz / dist * .4;
                sound('hit');
                if (s.ah <= 0) finish(true);
              } else {
                s.miss = .78;
              }
            }
          }
          if (s.aa > 0) {
            s.aa = Math.max(0, s.aa - dt);
            if (s.aa <= .38 && !s.aHit) {
              s.aHit = true;
              if (dist <= cfg.ATTACK_RANGE) {
                const blocked = inp.guard && s.ps >= 8;
                s.ph = Math.max(0, s.ph - (blocked ? cfg.AI_DAMAGE * .2 : cfg.AI_DAMAGE));
                if (blocked) s.ps -= 8;
                s.pk = .25;
                impacts.pop('player', s.px + dx / dist * .24, playerImpactY * (blocked ? .91 : 1), s.pz + dz / dist * .24, blocked);
                const knockback = blocked ? .15 : .38;
                s.px -= dx / dist * knockback;
                s.pz -= dz / dist * knockback;
                sound(blocked ? 'block' : 'hit');
                if (s.ph <= 0) finish(false);
              }
            }
          }
          s.ps = Math.min(cfg.MAX_STAMINA, s.ps + dt * (inp.guard ? 2 : 13));
          s.as = Math.min(cfg.MAX_STAMINA, s.as + dt * 12);
          s.pk = Math.max(0, s.pk - dt);
          s.ak = Math.max(0, s.ak - dt);
          s.miss = Math.max(0, s.miss - dt);
        }
      }
      const facing = s.ax < s.px ? -1 : 1;
      const strike = s.pa > .43 ? 0 : Math.sin(Math.PI * s.pa / .43);
      player.position.set(s.px + facing * strike * .24, 0, s.pz);
      player.rotation.z = s.pk * 1.5 + facing * (inp.guard ? .16 : s.pa > .43 ? .13 : -strike * .22);
      player.rotation.y = facing * .35;
      player.scale.set(1 + strike * .08, inp.guard ? .91 : 1 - strike * .04, 1);
      if (missHint.current) missHint.current.hidden = s.miss <= 0;
      cat.position.set(s.ax, 0, s.az);
      cat.rotation.z = -s.ak * 1.5;
      cat.rotation.y = s.px < s.ax ? -.25 : .25;
      cat.userData.arm.rotation.z = s.aa > .38 ? -1.8 : s.aa > 0 ? 1.1 : -.5;
      cat.scale.setScalar(s.aa > .38 ? 1 + .07 * Math.sin(now * .025) : 1);
      sh1.position.x = s.px;
      sh1.position.z = s.pz;
      sh2.position.x = s.ax;
      sh2.position.z = s.az;
      impacts.update(dt);
      if (hp1.current) {
        hp1.current.style.width = s.ph / cfg.MAX_HEALTH * 100 + '%';
        hp2.current.style.width = s.ah / cfg.MAX_HEALTH * 100 + '%';
        sp1.current.style.width = s.ps / cfg.MAX_STAMINA * 100 + '%';
        sp2.current.style.width = s.as / cfg.MAX_STAMINA * 100 + '%';
        host.dataset.playerHp = Math.round(s.ph);
        host.dataset.aiHp = Math.round(s.ah);
        host.dataset.distance = distLabel(s);
        host.dataset.guard = String(inp.guard);
        host.dataset.started = String(s.started);
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      unwatchSize();
      game.current = null;
      impacts.dispose();
      scene.traverse(o => {
        o.geometry?.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
            m.map?.dispose();
            m.dispose();
          });
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [stage, round, cfg]);
  return <div className="app"><style>{`@font-face {
  font-family: 'Bangers';
  src: url('./assets/fonts/bangers/Bangers-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

:root {
  --font-display: "Bangers", "PingFang SC", system-ui, sans-serif;
  --font-body:    -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
  --font-mono:    ui-monospace, Menlo, monospace;
}
*{box-sizing:border-box} .app{position:relative;width:100%;height:100%;container-type:size;overflow:clip;background:#f8f4e9;color:#303440;font-family:var(--font-body);touch-action:none}.draw-stage{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10% 30px 50px}.hint{font-family:var(--font-display);font-size:18px;letter-spacing:.5px;text-align:center;color:#343946;text-shadow:0 2px #fff;line-height:1.2;max-width:100%}.draw-hint{margin-bottom:16px;animation:breathe 2.4s ease-in-out infinite}.paper-wrap{width:min(100%,340px,48cqb);aspect-ratio:1;position:relative;background:#fffdf8;border:3px solid #343946;border-radius:9px;box-shadow:6px 7px 0 #e1d9ca, 7px 8px 0 #343946;overflow:hidden}.paper{width:100%;height:100%;display:block;touch-action:none;background-image:radial-gradient(#e9e6de 1px,transparent 1px);background-size:16px 16px}.paper-mark{position:absolute;right:12px;bottom:10px;color:#d4d0c7;font-family:var(--font-display);font-size:14px;pointer-events:none}.tools{width:min(100%,340px);margin-top:22px}.fighter-preview{width:64px;height:64px;flex:none;border:2px solid #c5d9dd;border-radius:12px;background:#e6f2f3;overflow:hidden}.fighter-preview canvas{display:block;width:100%;height:100%}button{font-family:var(--font-display);letter-spacing:.5px;cursor:pointer;touch-action:none}.actions{display:flex;gap:9px;align-items:center}.btn{border:2px solid #353944;border-radius:13px;background:#fffdf8;color:#353944;box-shadow:0 3px 0 #353944;font-size:18px;padding:10px 14px;min-height:46px}.actions .btn{flex:1}.btn.primary{background:#b9dfe9}.btn:disabled{opacity:.35;box-shadow:none}.arena{position:absolute;inset:0}.arena canvas{display:block;width:100%;height:100%}.hud{position:absolute;top:max(22px,env(safe-area-inset-top));left:24px;right:24px;display:flex;gap:22px;pointer-events:none}.meter{flex:1}.bar{height:17px;background:#e1c9bd;border:2px solid #363d46;border-radius:20px;overflow:hidden;box-shadow:0 2px 0 #fff}.bar>div{height:100%;background:#7ab7d4;transition:width .12s}.meter.cat .bar>div{background:#efa574}.stamina{height:7px;margin:5px 8px 0;background:#d6e1cf;border-radius:8px;overflow:hidden}.stamina>div{height:100%;width:100%;background:#78bb82}.meter.cat .bar>div,.meter.cat .stamina>div{float:right}.battle-hint{position:absolute;top:16%;left:0;right:0;font-size:20px;pointer-events:none}.controls{position:absolute;left:24px;right:24px;bottom:50px;display:flex;justify-content:space-between;align-items:end;gap:15px}.joystick{width:120px;height:120px;border-radius:50%;border:2px solid #9db5b9;background:#e4f1f0bb;display:grid;place-items:center;touch-action:none}.knob{width:52px;height:52px;border-radius:50%;background:#a9ced8;border:2px solid #526772;box-shadow:0 3px 0 #526772;pointer-events:none}.fight-buttons{display:flex;gap:10px;align-items:end}.fight-btn{width:72px;height:72px;border-radius:50%;border:2px solid #343946;background:#f7d2aa;color:#343946;box-shadow:0 4px 0 #343946;font-size:17px;touch-action:none}.fight-btn.guard{background:#c5e0e7;width:66px;height:66px}.fight-btn:active,.fight-btn.pressed{transform:translateY(3px);box-shadow:0 1px 0 #343946}.result-layer{position:absolute;inset:0;background:#f8f4e9a8;display:flex;align-items:center;justify-content:center}.result-box{text-align:center;padding:25px}.result-title{font:400 42px var(--font-display);color:#343946;text-shadow:2px 3px #fff;margin:0 0 20px}.result-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}.result-actions .btn{min-width:120px}.edit{display:block;margin:16px auto 0;background:transparent;border:0;text-decoration:underline;color:#4d5d63;font:400 18px var(--font-display)}[data-feed-cover="true"] .draw-stage{justify-content:flex-start;padding-top:22%}
.palette{display:flex;justify-content:center;gap:2px;margin-bottom:6px}
.swatch{flex:0 1 44px;min-width:0;height:44px;display:grid;place-items:center;background:transparent;border:0;padding:0}
.swatch::before{content:'';width:26px;height:26px;background:var(--swatch-ink);border:2px solid #343946;border-radius:50%;box-shadow:0 2px 0 #343946}
.swatch[aria-pressed="true"]::before{outline:2px solid #55728b;outline-offset:3px}
.swatch:focus-visible{outline:2px solid #343946;outline-offset:-2px;border-radius:8px}
.preview-sketch{display:none;position:absolute;inset:0;width:100%;height:100%;color:${defaultInk};pointer-events:none}
[data-feed-cover="true"] .preview-sketch{display:block}
[data-feed-cover="true"] .tools{visibility:hidden}
.preview-sketch>path{fill:none;stroke:currentColor;stroke-width:9;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;animation:sketch-outline 4.8s ease-in-out infinite}
.preview-sketch-face{fill:currentColor;animation:sketch-face 4.8s ease-in-out infinite}
.battle-hint{animation:breathe 2.4s ease-in-out infinite}.range-hint{position:absolute;top:16%;left:24px;right:24px;color:#934837;pointer-events:none}
@media(max-width:350px){.controls{gap:8px}.joystick{width:94px;height:94px}.fight-btn,.fight-btn.guard{width:57px;height:57px}.fighter-preview{width:54px;height:54px}}
@keyframes sketch-outline{0%,8%{stroke-dashoffset:1;opacity:0}12%{opacity:1}54%,82%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
@keyframes sketch-face{0%,52%,100%{opacity:0}63%,82%{opacity:1}}
@media(prefers-reduced-motion:reduce){.preview-sketch>path,.preview-sketch-face,.battle-hint{animation:none}}
@keyframes breathe{50%{transform:scale(1.04);opacity:.8}}@media(prefers-reduced-motion:reduce){.draw-hint{animation:none}*{transition:none!important}}@media(max-height:500px){.draw-stage{padding-top:12px;padding-bottom:15px}.paper-wrap{width:min(100%,340px,46cqb)}.tools{margin-top:10px}.fighter-preview{height:52px;width:52px}.draw-hint{margin-bottom:8px}.joystick{width:95px;height:95px}}`}</style>
{stage === 'draw' ? <div className="draw-stage"><div className="hint draw-hint" style={{
        visibility: drawHint ? "visible" : "hidden"
      }}>{cfg.DRAW_HINT}</div><div className="paper-wrap"><canvas ref={paper} className="paper" width="340" height="340" aria-label="Foglio da disegno" onPointerDown={drawDown} onPointerMove={drawMove} onPointerUp={drawEnd} onPointerCancel={drawEnd} onLostPointerCapture={drawEnd} />
        <svg className="preview-sketch" viewBox="0 0 340 340" aria-hidden="true">
          <path pathLength="1" d="M93 171Q78 151 99 128L111 72Q115 60 128 71L157 101Q181 94 204 103L235 75Q246 68 250 84L254 140Q269 167 253 183Q267 213 251 245Q244 268 220 265L207 239Q184 250 160 239L145 264Q122 270 110 253Q96 232 104 207Q69 211 65 191Q64 172 93 171Z" />
          <g className="preview-sketch-face"><circle cx="145" cy="149" r="6" /><circle cx="211" cy="149" r="6" /><path d="M167 169Q177 179 188 169" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" /></g>
        </svg></div><div className="tools">
          <div className="palette" role="group" aria-label="Colore del tratto">
            {inkColors.map(({
            name,
            value
          }) => <button key={value} type="button" className="swatch" aria-label={name} aria-pressed={inkColor === value} style={{
            '--swatch-ink': value
          }} onClick={() => {
            if (inkColor !== value) {
              setInkColor(value);
              sound('click');
            }
          }} />)}
          </div>
          <div className="actions">{hasDrawing && <div className="fighter-preview" ref={previewHost} role="img" aria-label="Anteprima del lottatore in 3D" />}<button className="btn" disabled={!strokes.length} onClick={() => {
            strokesRef.current = strokesRef.current.slice(0, -1);
            setStrokes([...strokesRef.current]);
            sound('click');
          }}>{cfg.UNDO}</button><button className="btn" disabled={!strokes.length} onClick={() => {
            strokesRef.current = [];
            setStrokes([]);
            sound('click');
          }}>{cfg.CLEAR}</button><button className="btn primary" disabled={!strokes.length} onClick={start}>{cfg.FIGHT}</button></div></div></div> : <><div className="arena" ref={arena} aria-label="Arena di combattimento" /><div className="hint range-hint" ref={missHint} hidden role="status">Avvicinati</div><div className="hud"><div className="meter"><div className="bar"><div ref={hp1} /></div><div className="stamina"><div ref={sp1} /></div></div><div className="meter cat"><div className="bar"><div ref={hp2} /></div><div className="stamina"><div ref={sp2} /></div></div></div>{battleHint && !result && <div className="hint battle-hint">{cfg.BATTLE_HINT}</div>}<div className="controls"><div className="joystick" ref={joy} aria-label="Muoviti" onPointerDown={joyDown} onPointerMove={joyMove} onPointerUp={joyEnd} onPointerCancel={joyEnd}><div className="knob" ref={knob} /></div><div className="fight-buttons"><button className="fight-btn guard" onPointerDown={guardDown} onPointerUp={guardEnd} onPointerCancel={guardEnd}>{cfg.GUARD}</button><button className="fight-btn" onClick={attack}>{cfg.ATTACK}</button></div></div>{result && <div className="result-layer"><div className="result-box"><h1 className="result-title">{result === 'win' ? cfg.WIN : cfg.LOSE}</h1><div className="result-actions"><button className="btn primary" onClick={start}>{cfg.REPLAY}</button>{submission.can && <button className="btn primary" disabled={submission.sub} style={{
              opacity: submission.sub ? .55 : 1,
              pointerEvents: submission.sub ? 'none' : 'auto'
            }} onClick={submission.submit}>Pubblica la partita</button>}</div><button className="edit" onClick={() => {
            sound('click');
            setStage('draw');
            setDrawHint(false);
          }}>{cfg.EDIT}</button></div></div>}</>}
</div>;
}
function distLabel(s) {
  return Math.hypot(s.ax - s.px, s.az - s.pz).toFixed(2);
}
createRoot(document.getElementById('root')).render(<><style>{PACKAGE_HTML_STYLES}</style>{<App />}</>);
