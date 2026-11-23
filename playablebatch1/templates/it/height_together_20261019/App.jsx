import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as T2 from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as T3 from 'three';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
// Older hosts can still size the scene on mount and window resize.
function observeGameSize(callback) {
  if (typeof ResizeObserver === 'function') return new ResizeObserver(callback);

  const targets = new Set();
  let frame;
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const entries = Array.from(targets, target => ({
        target,
        contentRect: { width: target.clientWidth, height: target.clientHeight }
      }));
      if (entries.length) callback(entries);
    });
  }
  return {
    observe(target) {
      targets.add(target);
      window.addEventListener('resize', schedule);
      schedule();
    },
    disconnect() {
      targets.clear();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
    }
  };
}

const DEFAULT_CONFIG = {
  "config_version": "2.0",
  "tweaks": [],
  "texts": [{
    "id": "HINT_TEXT",
    "label": "Camera guide",
    "value": "Ruota trascinando, zoom con due dita",
    "default": "Ruota trascinando, zoom con due dita",
    "max_length": 42
  }],
  "images": [],
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "it",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
let runtimeConfig = DEFAULT_CONFIG;
async function requestGameConfig() {
  let deadline;
  try {
    const request = fetch('./game.config.json', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .catch(() => null);
    const timeout = new Promise(resolve => {
      deadline = setTimeout(() => resolve(null), 1200);
    });
    const config = await Promise.race([request, timeout]);
    if (config && typeof config === 'object' && !Array.isArray(config)) runtimeConfig = config;
    return { ok: true, json: async () => runtimeConfig };
  } finally {
    clearTimeout(deadline);
  }
}
const GAME_STYLES = `@font-face{font-family:DM;src:url('./assets/fonts/DMSans.woff') format('woff');font-weight:100 1000;font-display:swap}
:root{font-family:DM,system-ui,sans-serif;color:#243640;background:#edf2f4;font-synthesis:none;--ink:#243640;--muted:#52656f;--line:#afbec6;--primary:#2a5968;--surface:rgba(255,255,255,.88)}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{overscroll-behavior:none}button,input,select{font:inherit}button,select{cursor:pointer;touch-action:manipulation}button{min-width:44px;min-height:44px;color:inherit;border:0;background:transparent;border-radius:14px;transition:background .15s,color .15s}button:active{background:#d1e1e7}button:focus-visible,select:focus-visible,input:focus-visible,#stage:focus-visible{outline:3px solid #296e8b;outline-offset:3px}button svg{width:21px;height:21px;stroke:currentColor;stroke-width:1.7;fill:none;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
#game{width:100%;height:100%;display:grid;grid-template-rows:auto minmax(80px,1fr) auto;padding:30px 30px 50px;gap:10px;background:radial-gradient(ellipse at 45% 35%,#fbfcfc 0,#edf2f4 75%);position:relative}
#top{z-index:2;text-align:center}#difference{display:block;font-size:28px;font-weight:750;line-height:1.25;font-variant-numeric:tabular-nums;margin:0 0 14px}#difference small{font-size:14px;font-weight:550;color:var(--muted)}#views{display:grid;grid-template-columns:1fr 1fr 1fr;background:#dce6ea;border-radius:16px;padding:4px;gap:4px}#views button{font-size:14px;font-weight:650;white-space:nowrap;min-width:0}#views button[aria-pressed=true]{background:white;box-shadow:0 2px 5px #26404b12;color:var(--primary)}
#stage{position:relative;min-height:0;touch-action:none;outline-offset:-3px;border-radius:12px;isolation:isolate}#stage canvas{width:100%;height:100%;display:block;cursor:grab;touch-action:none}#stage canvas:active{cursor:grabbing}#labels{position:absolute;inset:0;pointer-events:none;overflow:hidden}.person-label{position:absolute;max-width:42%;padding:4px 7px;border-radius:9px;font-size:14px;font-weight:700;background:#f8fbfbe8;line-height:1.3;overflow-wrap:anywhere;box-shadow:0 1px 4px #17333d0a;transform:translate(-50%,-100%)}.person-label small{display:block;font-size:12px;font-weight:550;color:var(--muted)}#label-a{border-bottom:2px solid #ab6476}#label-b{border-bottom:2px solid #337794}
.person-label{width:max-content;min-width:72px}#leaders{position:absolute;inset:0;width:100%;height:100%;overflow:hidden}#leaders line{stroke-width:1;opacity:.65}#guide{position:absolute;bottom:2px;left:0;right:0;text-align:center;font-size:18px;line-height:1.5;margin:0;pointer-events:none;color:var(--muted);transition:opacity .18s}#game[data-started=true] #guide{visibility:hidden;opacity:0}
#toolbar{z-index:3;display:grid;gap:8px}.scene-picker{display:block;min-width:0}#scene{width:100%;height:46px;border:1px solid #a5b8c2;border-radius:14px;background:var(--surface);color:var(--ink);font-size:16px;font-weight:650;padding:0 14px;text-overflow:ellipsis}#toolbar .actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}#toolbar button{display:flex;align-items:center;justify-content:center;gap:7px;font-size:14px;font-weight:650;border:1px solid #bccbd2;background:#ffffffaa}#toolbar #photo{color:white;background:var(--primary);border-color:var(--primary)}#photo:disabled{opacity:.55;cursor:wait}
.sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}dialog{border:1px solid #bdcbd1;border-radius:24px;padding:22px;width:min(calc(100% - 48px),360px);max-height:calc(100% - 60px);overflow:auto;color:var(--ink);background:#f8fbfc;box-shadow:0 18px 65px #1a38482a}dialog::backdrop{background:#1e344270}dialog form{display:grid;gap:18px}.dialog-heading{display:flex;justify-content:space-between;align-items:center;gap:8px}h2{font-size:24px;line-height:1.25;margin:0}.dialog-heading button{font-size:28px;flex:0 0 44px}fieldset{margin:0;padding:0;border:0;display:grid;grid-template-columns:minmax(0,1fr) 100px;gap:6px 12px}legend{font-size:14px;font-weight:750;margin:0 0 8px;color:#79515c}fieldset+fieldset legend{color:#326d87}fieldset label{display:block;font-size:14px;font-weight:650}fieldset label span{font-weight:400;color:var(--muted)}input{display:block;margin-top:6px;width:100%;min-width:0;height:46px;border:1px solid #a5b8c2;background:white;border-radius:10px;padding:0 10px;font-size:16px;color:var(--ink)}input[aria-invalid=true]{border:2px solid #ae3046}.field-error{grid-column:1/-1;min-height:0;font-size:14px;color:#9f263c;margin:0}.field-error:empty{display:none}#apply{color:white;background:var(--primary);font-weight:700;font-size:16px}.privacy{text-align:center;font-size:12px;color:var(--muted);margin:-8px 0 0}#error{position:absolute;inset:100px 30px 130px;display:grid;place-content:center;text-align:center;z-index:5;background:#edf2f4e8}#error[hidden]{display:none}#error button{background:var(--primary);color:white}
#game[data-feed-preview=true]{grid-template-rows:minmax(80px,1fr);padding:60px 30px 120px}#game[data-feed-preview=true] #top,#game[data-feed-preview=true] #toolbar{display:none}#game[data-feed-preview=true] #labels{display:none}#game[data-feed-preview=true] #guide{bottom:0;color:#243640}
@media(max-width:350px){#game{padding-left:26px;padding-right:26px}#views button{font-size:13px}#toolbar button{gap:4px;font-size:13px}#toolbar button svg{width:18px;height:18px}}
@media(max-height:530px){#game{gap:6px;padding-top:24px;padding-bottom:36px}#difference{margin-bottom:8px}#toolbar{gap:6px}#guide{font-size:18px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root #game#game#game p#guide{position:fixed!important;top:0%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root #game #stage{margin-top:36px}
html:root:root:root #game#game#game p#guide{position:absolute!important;top:-36px!important;translate:-50% 0!important}
html:root:root:root #game[data-feed-preview="true"] #stage{margin-top:0}
html:root:root:root #game#game#game[data-feed-preview="true"] p#guide{top:8%!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(#game p#guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(#game p#guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(#game p#guide){animation:none!important}}

/* Italian copy keeps the approved role sizes and may wrap instead of clipping. */
html[lang="it"] :is(.meeting-guide,.feed-first-action,.melody-guide,.particle-guide,.dive-guide,.sandbox-guide,.koi-guide,.ui-guide,.bead-guide,.coloring-guide,.look-guide,.time-print-guide){white-space:normal;overflow-wrap:normal;word-break:normal;line-height:1.4}
html[lang="it"] :is(button,.btn,.btn-neon){overflow-wrap:normal;word-break:normal}
html[lang="it"] .melody-controls button{font-size:18px;padding-inline:12px}
html[lang="it"] .meeting-sand-ball-count{gap:6px!important}
html[lang="it"] #people-dialog fieldset label{min-width:0}
html[lang="it"] #people-dialog input{max-width:100%;min-width:0}
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
document.documentElement.lang = 'it';
function startGame() {
  // ./guide-breathing.js
  /* Decorative guide visibility only: no inputs, timers, sound or game state. */
  (() => {
    const root = document.documentElement;
    let intersecting = true;
    const update = () => root.toggleAttribute('data-guide-breathing-paused', document.hidden || !intersecting);
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      intersecting = entries.some(entry => entry.isIntersecting);
      update();
    }) : null;
    if (document.body) observer?.observe(document.body);
    document.addEventListener('visibilitychange', update);
    update();
    window.addEventListener('pagehide', () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', update);
    }, {
      once: true
    });
  })();

  // A closed, softly edged cloth band, not a round rope. Allocated on scene changes only.
  const SCENES = Object.freeze([{
    id: 'together',
    name: "Fianco a fianco"
  }, {
    id: 'umbrella',
    name: "Sotto l’ombrello"
  }, {
    id: 'cafe',
    name: "Un caffè insieme"
  }, {
    id: 'shelf',
    name: "Raggiungi il ripiano"
  }, {
    id: 'hug',
    name: "Un abbraccio"
  }, {
    id: 'scarf',
    name: "Una sciarpa per due"
  }, {
    id: 'piggyback',
    name: "Sulle spalle"
  }, {
    id: 'carry',
    name: "In braccio"
  }]);
  const DEFAULTS = Object.freeze({
    a: {
      name: "Tu",
      height: 162,
      color: '#cf8e9c'
    },
    b: {
      name: 'Partner',
      height: 180,
      color: '#68a8c4'
    },
    scene: 'together'
  });
  function initialState() {
    return structuredClone(DEFAULTS);
  }
  function cleanName(value, fallback) {
    return String(value ?? '').trim().slice(0, 20) || fallback;
  }
  function parseHeight(value) {
    if (String(value).trim() === '') return {
      error: "Inserisci l’altezza in cm."
    };
    const value2 = Number(value);
    if (!Number.isFinite(value2) || value2 < 50 || value2 > 500) return {
      error: "Inserisci un’altezza tra 50 e 500 cm."
    };
    return {
      value: Math.round(value2 * 10) / 10
    };
  }
  function formatHeight(value) {
    return Number(value).toLocaleString("it-IT", {
      maximumFractionDigits: 1
    });
  }
  function difference(state) {
    return Math.round(Math.abs(state.a.height - state.b.height) * 10) / 10;
  }
  function swapPeople(state) {
    return {
      ...state,
      a: {
        ...state.b
      },
      b: {
        ...state.a
      }
    };
  }
  function validatePeople(values, state) {
    const value = parseHeight(values.aHeight);
    const value2 = parseHeight(values.bHeight);
    const errors = {};
    if (value.error) errors.aHeight = value.error;
    if (value2.error) errors.bHeight = value2.error;
    if (Object.keys(errors).length) return {
      errors
    };
    return {
      state: {
        ...state,
        a: {
          ...state.a,
          name: cleanName(values.aName, "Tu"),
          height: value.value
        },
        b: {
          ...state.b,
          name: cleanName(values.bName, 'Partner'),
          height: value2.value
        }
      }
    };
  }
  function sceneLayout(state) {
    const value = state.a.height / 100;
    const value2 = state.b.height / 100;
    const value3 = Math.max(value, value2); // Seated elbows need their own space between the chairs, not the tighter
    // standing gap. Scale with both bodies so swapping or resizing stays safe.
    const value4 = state.scene === 'cafe' ? (value + value2) * 0.2 + 0.14 : (value + value2) * 0.115 + 0.15;
    const options = {
      x: -value4 / 2,
      y: 0,
      z: 0,
      yaw: 0.07,
      tilt: 0,
      mode: 'stand'
    };
    const options2 = {
      x: value4 / 2,
      y: 0,
      z: 0,
      yaw: -0.07,
      tilt: 0,
      mode: 'stand'
    };
    if (state.scene === 'cafe') {
      options.mode = options2.mode = 'sit';
      for (const [pose, h] of [[options, value], [options2, value2]]) {
        pose.y = (value3 - h) * 0.4;
        pose.z = (value3 - h) * 0.14;
      }
    }
    if (state.scene === 'hug') {
      const separation = (value + value2) * 0.06 + Math.min(value, value2) * 0.02;
      options.x = -separation / 2;
      options2.x = separation / 2;
      options.yaw = Math.PI / 2;
      options2.yaw = -Math.PI / 2;
      options.mode = options2.mode = 'hug';
    }
    if (state.scene === 'piggyback') {
      const tall = value >= value2 ? options : options2;
      const short = tall === options ? options2 : options;
      const value5 = Math.max(value, value2);
      const value6 = Math.min(value, value2);
      tall.x = 0;
      tall.mode = 'carrier';
      short.x = 0;
      short.z = -value5 * 0.12 - value6 * 0.06;
      short.y = value5 * 0.46;
      short.mode = 'rider';
      short.legSpread = Math.min(value5 * 0.19 / value6, 0.19);
    }
    if (state.scene === 'carry') {
      const tall = value >= value2 ? options : options2;
      const short = tall === options ? options2 : options;
      const value5 = Math.max(value, value2);
      const value6 = Math.min(value, value2);
      tall.x = 0;
      tall.mode = 'carry';
      short.x = -value6 * 0.37;
      short.y = value5 * 0.7 - value6 * 0.43 * Math.cos(Math.PI * 0.36);
      short.z = value5 * 0.1;
      short.tilt = -Math.PI * 0.36;
      short.mode = 'cradle';
    }
    if (state.scene === 'shelf') {
      options.yaw = options2.yaw = Math.PI;
      options.mode = options2.mode = 'reach';
      options.z = -0.3 * value3 + 0.155 + 0.16 * value;
      options2.z = -0.3 * value3 + 0.155 + 0.16 * value2;
    }
    if (state.scene === 'umbrella') {
      (value >= value2 ? options : options2).mode = 'umbrella';
    }
    return {
      a: options,
      b: options2,
      max: value3,
      gap: value4,
      hA: value,
      hB: value2
    };
  }
  // Target is clamped to the real arm reach; both bone lengths remain constant.
  function solveArm(shoulder, target, upper, lower, bend = 1, pole) {
    const value = target.x - shoulder.x;
    const value2 = target.y - shoulder.y;
    const value3 = target.z - shoulder.z;
    const value4 = Math.hypot(value, value2, value3);
    const value5 = Math.min(upper + lower - 0.00001, Math.max(Math.abs(upper - lower) + 0.00001, value4));
    const value6 = value4 > 1e-8 ? value / value4 : 0;
    const value7 = value4 > 1e-8 ? value2 / value4 : -1;
    const value8 = value4 > 1e-8 ? value3 / value4 : 0;
    const along = (upper * upper - lower * lower + value5 * value5) / (2 * value5);
    const value9 = Math.sqrt(Math.max(0, upper * upper - along * along));
    let value10 = -value7;
    let value11 = value6;
    let value12 = 0;
    if (pole) {
      const x = pole.x - shoulder.x;
      const y = pole.y - shoulder.y;
      const z = pole.z - shoulder.z;
      const value13 = x * value6 + y * value7 + z * value8;
      value10 = x - value6 * value13;
      value11 = y - value7 * value13;
      value12 = z - value8 * value13;
      bend = 1;
    }
    let plen = Math.hypot(value10, value11, value12);
    if (plen < 0.0001) {
      value10 = -value7;
      value11 = value6;
      value12 = 0;
      plen = Math.hypot(value10, value11);
      if (plen < 0.0001) {
        value10 = 1;
        value11 = 0;
        plen = 1;
      }
    }
    return {
      elbow: {
        x: shoulder.x + value6 * along + value10 / plen * value9 * bend,
        y: shoulder.y + value7 * along + value11 / plen * value9 * bend,
        z: shoulder.z + value8 * along + value12 / plen * value9 * bend
      },
      hand: {
        x: shoulder.x + value6 * value5,
        y: shoulder.y + value7 * value5,
        z: shoulder.z + value8 * value5
      }
    };
  }
  // A closed, softly edged cloth band, not a round rope. Allocated on scene changes only.
  function clothBand(curve, width, thickness, {
    segments = 48,
    closed = false,
    axis = new T3.Vector3(0, 1, 0)
  } = {}) {
    const vertices = [];
    const indices = [];
    const point = new T3.Vector3();
    const tangent = new T3.Vector3();
    const across = new T3.Vector3();
    const normal = new T3.Vector3();
    for (let value = 0; value <= segments; value++) {
      const value2 = closed && value === segments ? 0 : value / segments;
      curve.getPoint(value2, point);
      curve.getTangent(value2, tangent).normalize();
      across.copy(axis).addScaledVector(tangent, -axis.dot(tangent));
      if (across.lengthSq() < 1e-8) across.set(0, 0, 1).addScaledVector(tangent, -tangent.z);
      across.normalize();
      normal.crossVectors(tangent, across).normalize();
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) vertices.push(point.x + across.x * a * width / 2 + normal.x * b * thickness / 2, point.y + across.y * a * width / 2 + normal.y * b * thickness / 2, point.z + across.z * a * width / 2 + normal.z * b * thickness / 2);
      if (value < segments) for (let side = 0; side < 4; side++) {
        const value3 = value * 4 + side;
        const value4 = value * 4 + (side + 1) % 4;
        const value5 = value4 + 4;
        const value6 = value3 + 4;
        indices.push(value3, value4, value6, value4, value5, value6);
      }
    }
    if (!closed) indices.push(0, 2, 1, 0, 3, 2, segments * 4, segments * 4 + 1, segments * 4 + 2, segments * 4, segments * 4 + 2, segments * 4 + 3);
    const geometry = new T3.BufferGeometry();
    geometry.setAttribute('position', new T3.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    if (closed) {
      const normals = geometry.attributes.normal;
      for (let value = 0; value < 4; value++) {
        normal.fromBufferAttribute(normals, value).add(tangent.fromBufferAttribute(normals, segments * 4 + value)).normalize();
        normals.setXYZ(value, normal.x, normal.y, normal.z);
        normals.setXYZ(segments * 4 + value, normal.x, normal.y, normal.z);
      }
    }
    return geometry;
  }
  function scarfNeckPoints(height) {
    return Array.from({
      length: 16
    }, (value, otherValue) => {
      const angle = otherValue / 16 * Math.PI * 2;
      return new T3.Vector3(Math.cos(angle) * height * 0.046, height * 0.807, Math.sin(angle) * height * 0.046);
    });
  }
  const V = (x = 0, y = 0, z = 0) => new T2.Vector3(x, y, z);
  const accessoryRed = '#c62828';
  function buildWorld(state) {
    const group = new T2.Group();
    const layout = sceneLayout(state);
    const geometries = [];
    const materials = [];
    const actors = [];
    const contacts = [];
    const targets = new Map();
    const props = {
      books: [],
      seats: []
    };
    const roundedBoxGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.065);
    const sphere = new T2.SphereGeometry(1, 24, 18);
    const cylinder = new T2.CylinderGeometry(1, 1, 1, 16);
    geometries.push(roundedBoxGeometry, sphere, cylinder);
    const cache = new Map();
    function mat(color, roughness = 0.65) {
      const value3 = color + roughness;
      if (!cache.has(value3)) {
        const meshStandardMaterial = new T2.MeshStandardMaterial({
          color,
          roughness
        });
        cache.set(value3, meshStandardMaterial);
        materials.push(meshStandardMaterial);
      }
      return cache.get(value3);
    }
    function mesh(geometry, material, parent = group) {
      const mesh2 = new T2.Mesh(geometry, material);
      mesh2.castShadow = true;
      mesh2.receiveShadow = true;
      parent.add(mesh2);
      return mesh2;
    }
    function cube(parent, position, size, color) {
      const value3 = mesh(roundedBoxGeometry, mat(color), parent);
      value3.position.copy(position);
      value3.scale.copy(size);
      return value3;
    }
    function ball(parent, position, radius, color) {
      const value3 = mesh(sphere, mat(color), parent);
      value3.position.copy(position);
      value3.scale.setScalar(radius);
      return value3;
    }
    function rod(parent, otherValue, argument3, width, depth, color, round = false) {
      const delta = argument3.clone().sub(otherValue);
      const value3 = mesh(round ? cylinder : roundedBoxGeometry, mat(color), parent);
      value3.position.copy(otherValue).add(argument3).multiplyScalar(0.5);
      value3.scale.set(width, delta.length(), depth);
      value3.quaternion.setFromUnitVectors(V(0, 1, 0), delta.normalize());
      return value3;
    }
    function actor(person, pose, index) {
      const value3 = person.height / 100;
      const group2 = new T2.Group();
      group.add(group2);
      group2.position.set(pose.x, pose.y, pose.z);
      group2.rotation.set(0, pose.yaw, pose.tilt);
      const color = person.color;
      const value4 = pose.mode === 'sit' || pose.mode === 'rider' || pose.mode === 'cradle';
      const drop = value4 ? value3 * 0.25 : 0;
      const handleAction = (x, y, z = 0) => V(x * value3, y * value3 - drop, z * value3);
      cube(group2, handleAction(0, 0.645), V(0.215 * value3, 0.27 * value3, 0.12 * value3), color);
      cube(group2, handleAction(0, 0.475), V(0.19 * value3, 0.07 * value3, 0.12 * value3), color);
      rod(group2, handleAction(0, 0.795), handleAction(0, 0.84), 0.036 * value3, 0.036 * value3, color, true);
      const head = ball(group2, handleAction(0, 0.915), value3 * 0.085, color);
      const headGroup = new T2.Group();
      group2.add(headGroup);
      headGroup.position.copy(head.position);
      const value5 = mat('#24333a');
      for (const x of [-0.029, 0.029]) {
        const value6 = mesh(sphere, value5, headGroup);
        value6.position.set(x * value3, 0.004 * value3, 0.079 * value3);
        value6.scale.set(0.009 * value3, 0.012 * value3, 0.008 * value3);
      }
      const feet = [];
      const knees = [];
      const hips = [];
      for (const sign of [-1, 1]) {
        const spread = pose.legSpread ?? 0.054;
        const value6 = handleAction(sign * 0.054, 0.44);
        let knee = value4 ? handleAction(sign * spread, 0.425, 0.22) : handleAction(sign * 0.054, 0.235);
        let ankle = value4 ? handleAction(sign * spread, 0.285, 0.235) : handleAction(sign * 0.054, 0.035);
        if (pose.mode === 'cradle') {
          knee = handleAction(sign * 0.054, 0.25, 0.11);
          ankle = handleAction(sign * 0.054, 0.075, 0.12);
        }
        if (value4) {
          const solved = solveArm(value6, ankle, 0.205 * value3, 0.2 * value3, sign, knee);
          knee = V(solved.elbow.x, solved.elbow.y, solved.elbow.z);
          ankle = V(solved.hand.x, solved.hand.y, solved.hand.z);
        }
        rod(group2, value6, knee, 0.073 * value3, 0.078 * value3, color);
        rod(group2, knee, ankle, 0.063 * value3, 0.07 * value3, color);
        const foot = cube(group2, ankle.clone().add(V(0, -0.017 * value3, 0.025 * value3)), V(0.075 * value3, 0.035 * value3, 0.13 * value3), color);
        feet.push(foot);
        knees.push(knee);
        hips.push(value6);
      }
      const options = {
        group: group2,
        head,
        headGroup,
        h: value3,
        pose,
        feet,
        knees,
        hips,
        person,
        index,
        p: handleAction,
        arms: []
      };
      actors.push(options);
      return options;
    }
    actor(state.a, layout.a, 0);
    actor(state.b, layout.b, 1);
    group.updateMatrixWorld(true);
    const point = (value3, x, y, z = 0) => value3.group.localToWorld(value3.p(x, y, z));
    const target = (value3, sign, position, kind) => targets.set(value3.index + ':' + sign, {
      position,
      kind
    });
    const value = layout.max;
    const value2 = layout.gap;
    const wood = '#c3a177';
    const dark = '#46545b';
    if (state.scene === 'umbrella') {
      const value3 = value + 0.24;
      const radius = Math.max(value2 * 0.85, value * 0.32);
      const poleX = 0;
      const poleZ = 0.11 * value;
      const geometry = new T2.SphereGeometry(radius, 40, 12, 0, Math.PI * 2, 0, Math.PI * 0.47);
      geometries.push(geometry);
      const canopyMaterial = mat(accessoryRed);
      canopyMaterial.side = T2.DoubleSide;
      const canopy = mesh(geometry, canopyMaterial);
      canopy.position.set(poleX, value3 - radius * 0.23, poleZ);
      canopy.scale.y = 0.28;
      rod(group, V(poleX, value * 0.35, poleZ), V(poleX, value3, poleZ), 0.013, 0.013, '#718087', true);
      const holder = actors.find(item => item.pose.mode === 'umbrella');
      props.umbrella = {
        poleX,
        poleZ,
        canopy,
        ribs: []
      };
      target(holder, holder.index === 0 ? 1 : -1, V(poleX, holder.h * 0.68, poleZ), 'umbrella-grip');
      const curve = new T2.CatmullRomCurve3([V(0, value * 0.35, poleZ), V(0.01, value * 0.31, poleZ), V(0.055, value * 0.31, poleZ), V(0.07, value * 0.35, poleZ)]);
      const tubeGeometry = new T2.TubeGeometry(curve, 20, 0.012, 7, false);
      geometries.push(tubeGeometry);
      mesh(tubeGeometry, mat(dark));
      for (let value4 = 0; value4 < 8; value4++) {
        const angle = value4 / 8 * Math.PI * 2;
        props.umbrella.ribs.push(rod(group, V(poleX, value3 + 0.04, poleZ), V(Math.cos(angle) * radius * 0.96, value3 - radius * 0.23 + radius * 0.025, poleZ + Math.sin(angle) * radius * 0.96), 0.004, 0.004, '#8f1b1b', true));
      }
    }
    if (state.scene === 'cafe') {
      const tableY = value * 0.4;
      const tableW = value2 + value * 0.48;
      const tableZ = value * 0.26;
      const depth = value * 0.24;
      props.table = cube(group, V(0, tableY, tableZ), V(tableW, 0.06, depth), wood);
      for (const x of [-tableW * 0.43, tableW * 0.43]) for (const z of [-depth * 0.4, depth * 0.4]) cube(group, V(x, tableY / 2, tableZ + z), V(0.035, tableY, 0.035), dark);
      for (const value3 of actors) {
        const {
          h: value4
        } = value3;
        const point2 = value3.group.position;
        const seatY = point2.y + value4 * 0.19 - 0.0275;
        props.seats.push(cube(group, V(point2.x, seatY, point2.z - 0.025), V(value4 * 0.26, 0.055, value4 * 0.26), wood));
        cube(group, V(point2.x, point2.y + value4 * 0.37, point2.z - value4 * 0.15), V(value4 * 0.26, value4 * 0.4, 0.04), wood);
        for (const sign of [-1, 1]) for (const z of [-0.09, 0.09]) cube(group, V(point2.x + sign * value4 * 0.1, seatY / 2, point2.z + z * value4), V(0.027, seatY, 0.027), dark);
        if (point2.y > 0.015) rod(group, V(point2.x - value4 * 0.11, point2.y + value4 * 0.01, point2.z + value4 * 0.23), V(point2.x + value4 * 0.11, point2.y + value4 * 0.01, point2.z + value4 * 0.23), 0.018, 0.035, dark);
        for (const sign of [-1, 1]) target(value3, sign, V(point2.x + sign * value4 * 0.12, tableY + 0.03 + value4 * 0.032, tableZ - depth * 0.5 + value4 * 0.06), 'table-rest');
        const value5 = mesh(cylinder, mat('#f7f2e9'));
        value5.scale.set(0.055, 0.075, 0.055);
        value5.position.set(point2.x, tableY + 0.068, tableZ + 0.01);
        const coffee = mesh(cylinder, mat('#76513d'));
        coffee.scale.set(0.047, 0.004, 0.047);
        coffee.position.set(point2.x, tableY + 0.107, tableZ + 0.01);
      }
    }
    if (state.scene === 'shelf') {
      const width = value2 + value * 0.55;
      const height = value * 1.08;
      const z = -0.3 * value;
      cube(group, V(0, height / 2, z - 0.08), V(width, height, 0.055), '#b69872');
      for (const x of [-width / 2, width / 2]) cube(group, V(x, height / 2, z + 0.03), V(0.055, height, 0.23), wood);
      for (let value3 = 0; value3 < 5; value3++) {
        const y = 0.1 + value3 * (height - 0.1) / 4;
        cube(group, V(0, y, z + 0.03), V(width, 0.045, 0.25), wood);
        if (value3 < 4) for (let value4 = 0; value4 < 9; value4++) {
          const value5 = height / 5 * (0.65 + value4 % 3 * 0.1);
          const value6 = width * 0.055;
          props.books.push(cube(group, V(-width * 0.42 + value4 * width * 0.1, y + value5 / 2 + 0.03, z + 0.035), V(value6, value5, 0.14), ['#93a9a5', '#bfb08d', '#718c9a', '#bd8c85'][value4 % 4]));
        }
      }
      group.updateMatrixWorld(true);
      for (const value3 of actors) {
        const sign = value3.index === 0 ? 1 : -1;
        const wanted = point(value3, sign * 0.139, 0.91, 0.1);
        let best;
        let distance = Infinity;
        for (const book of props.books) {
          const bounds = new T2.Box3().setFromObject(book);
          const value4 = V(T2.MathUtils.clamp(wanted.x, bounds.min.x, bounds.max.x), T2.MathUtils.clamp(wanted.y, bounds.min.y, bounds.max.y), z + 0.105);
          const value5 = value4.distanceTo(wanted);
          if (value5 < distance) {
            distance = value5;
            best = value4;
          }
        }
        target(value3, sign, best, 'book-reach');
      }
    }
    if (state.scene === 'scarf') {
      const width = Math.min(layout.hA, layout.hB) * 0.048;
      const thickness = width * 0.14;
      const cloth = mat(accessoryRed, 0.88);
      cloth.side = T2.DoubleSide;
      props.scarf = {
        wraps: [],
        tails: [],
        width
      };
      const band = (curve, parent, options = {}) => {
        const value4 = clothBand(curve, width, thickness, options);
        geometries.push(value4);
        return mesh(value4, cloth, parent);
      };
      for (const value4 of actors) {
        const curve = new T2.CatmullRomCurve3(scarfNeckPoints(value4.h), true, 'centripetal');
        const wrap = band(curve, value4.group, {
          closed: true,
          segments: 64
        });
        props.scarf.wraps.push(wrap);
        const sign = value4.index === 0 ? -1 : 1;
        const x = sign * value4.h * 0.0325;
        const length = Math.min(layout.hA, layout.hB) * 0.26;
        const tail = new T2.CatmullRomCurve3([V(x, value4.h * 0.807, value4.h * 0.0325), V(x, value4.h * 0.765, value4.h * 0.078), V(x * 1.25, value4.h * 0.807 - length * 0.65, value4.h * 0.078), V(x * 1.35, value4.h * 0.807 - length, value4.h * 0.079)]);
        props.scarf.tails.push(band(tail, value4.group, {
          axis: V(1, 0, 0)
        }));
        const point2 = tail.getPoint(1);
        for (let value5 = 0; value5 < 6; value5++) rod(value4.group, point2.clone().add(V((value5 - 2.5) * width / 6, 0, 0)), point2.clone().add(V((value5 - 2.5) * width / 6, -width * 0.27, 0)), width * 0.08, thickness, accessoryRed);
      }
      const left = point(actors[0], 0.0325, 0.807, 0.0325);
      const right = point(actors[1], -0.0325, 0.807, 0.0325);
      const value3 = Math.min(layout.hA, layout.hB) * 0.065;
      const front = value * 0.09; // Bring the shared span in front of both chests, including a giant-height
      // mismatch: a direct neck-to-neck diagonal would cut through the taller torso.
      const leftFront = left.clone().add(V(0, -value3 * 0.15, front - left.z));
      const rightFront = right.clone().add(V(0, -value3 * 0.15, front - right.z));
      const middle = leftFront.clone().lerp(rightFront, 0.5).add(V(0, -value3, 0));
      const curve = new T2.CatmullRomCurve3([left, leftFront, middle, rightFront, right]);
      props.scarf.bridge = band(curve, group);
    }
    if (state.scene === 'hug') for (const value3 of actors) {
      const other = actors[1 - value3.index];
      for (const sign of [-1, 1]) {
        const shoulder = point(value3, sign * 0.139, 0.755);
        const value4 = point(other, -sign * 0.105, 0.66, -0.075);
        value4.y = T2.MathUtils.clamp(shoulder.y - value3.h * 0.08, other.h * 0.51, other.h * 0.74);
        target(value3, sign, value4, 'hug-back');
      }
    }
    if (state.scene === 'piggyback') {
      const carrier = actors.find(item => item.pose.mode === 'carrier');
      const rider = actors.find(item => item.pose.mode === 'rider');
      for (const sign of [-1, 1]) {
        const knee = rider.group.localToWorld(rider.knees[sign === -1 ? 0 : 1].clone());
        target(carrier, sign, knee.add(V(0, -rider.h * 0.04, 0)), 'rider-knee-support');
        target(rider, sign, point(carrier, sign * 0.09, 0.77, 0.055), 'carrier-shoulder');
      }
    }
    if (state.scene === 'carry') {
      const carrier = actors.find(item => item.pose.mode === 'carry');
      const carried = actors.find(item => item.pose.mode === 'cradle');
      const thigh = carried.hips[0].clone().lerp(carried.knees[0], 0.6);
      target(carrier, -1, carried.group.localToWorld(thigh).add(V(0, -carried.h * 0.035, 0)), 'cradle-thighs');
      target(carrier, 1, point(carried, 0, 0.68, -0.08), 'cradle-back');
      for (const sign of [-1, 1]) target(carried, sign, point(carrier, sign * 0.1, 0.7, 0.1), 'carrier-chest');
    }
    // Solve actual world-space contacts only after both bodies and the props exist.
    for (const value3 of actors) for (const sign of [-1, 1]) {
      const {
        h: value4,
        p: value5
      } = value3;
      const shoulder = value5(sign * 0.139, 0.755);
      const goal = targets.get(value3.index + ':' + sign);
      let hand = value5(sign * 0.15, 0.435, 0.012);
      let pole = value5(sign * 0.19, 0.6, 0.04);
      if (goal) {
        hand = value3.group.worldToLocal(goal.position.clone());
        // Keep coffee elbows near their own chair instead of flaring across the
        // neighbour's forearm. Hands still use the real tabletop contacts.
        pole = state.scene === 'cafe' ? value5(sign * 0.16, 0.6, 0.1) : value5(sign * 0.22, ['reach'].includes(value3.pose.mode) ? 0.86 : 0.6, 0.13);
      }
      const solved = solveArm(shoulder, hand, 0.16 * value4, 0.16 * value4, sign, pole);
      const elbow = V(solved.elbow.x, solved.elbow.y, solved.elbow.z);
      hand = V(solved.hand.x, solved.hand.y, solved.hand.z);
      rod(value3.group, shoulder, elbow, 0.055 * value4, 0.065 * value4, value3.person.color);
      rod(value3.group, elbow, hand, 0.05 * value4, 0.058 * value4, value3.person.color);
      ball(value3.group, elbow, 0.032 * value4, value3.person.color);
      const handMesh = ball(value3.group, hand, 0.032 * value4, value3.person.color);
      value3.arms.push({
        sign,
        shoulder,
        elbow,
        hand,
        mesh: handMesh
      });
      if (goal) contacts.push({
        actor: value3.index,
        sign,
        kind: goal.kind,
        target: goal.position.clone(),
        hand: handMesh
      });
    }
    // A simple real-scale ruler at the rear, never an invented score.
    if (state.scene === 'together') {
      const x = -value2 * 0.5 - value * 0.28;
      const z = -0.12;
      rod(group, V(x, 0, z), V(x, value + 0.1, z), 0.005, 0.005, '#b9c7ce', true);
      for (let y = 0; y <= value + 0.05; y += 0.1) rod(group, V(x, y, z), V(x + (Math.round(y * 10) % 5 === 0 ? 0.075 : 0.035), y, z), 0.004, 0.004, '#a6b8c2', true);
    }
    group.updateMatrixWorld(true);
    const bounds = new T2.Box3().setFromObject(group);
    return {
      group,
      actors,
      layout,
      bounds,
      contacts,
      props,
      dispose() {
        for (const value3 of geometries) value3.dispose();
        for (const material of materials) material.dispose();
      }
    };
  }
  const queryElement = value => document.querySelector(value);
  const root2 = queryElement('#game');
  const stage = queryElement('#stage');
  const dialog = queryElement('#people-dialog');
  let state2 = initialState();
  let view = 'free';
  let renderer;
  let scene;
  let camera;
  let controls;
  let world;
  let light;
  let floor;
  let observer2;
  let raf = 0;
  let last = 0;
  let clock = 0;
  let disposed = false;
  let lost = false;
  let started = false;
  let transition = null;
  let baseDistance = 5;
  let downloadUrl;
  let audio;
  let inDraw = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const feed = new URLSearchParams(location.search).has('review') || new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !feed;
  root2.dataset.feedPreview = String(!active);
  root2.dataset.started = 'false';
  const eyePointers = new Map();
  let eyeYaw = 0;
  let eyePitch = 0;
  let eyeBase = new T.Quaternion();
  let eyeOrigin = new T.Vector3();
  const freePointers = new Map();
  function feedback(text) {
    queryElement('#status').textContent = text;
  }
  function tickSound() {
    if (!active || document.hidden) return;
    try {
      const value = window.AudioContext || window.webkitAudioContext;
      if (!value) return;
      audio ??= new value();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const currentTime = audio.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(620, currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(420, currentTime + 0.07);
      gain.gain.setValueAtTime(0.018, currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.08);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(currentTime);
      oscillator.stop(currentTime + 0.09);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    } catch {}
  }
  function meaningful() {
    if (!active) return;
    started = true;
    root2.dataset.started = 'true';
  }
  function updateText() {
    queryElement('#difference').replaceChildren(document.createTextNode(`${formatHeight(difference(state2))} `));
    const small = document.createElement('small');
    small.textContent = "cm di differenza";
    queryElement('#difference').append(small);
    queryElement('#difference').setAttribute('aria-label', "Differenza di altezza: " + formatHeight(difference(state2)) + " cm");
    for (const value of ['a', 'b']) {
      const label = queryElement('#label-' + value);
      const name = document.createTextNode(state2[value].name);
      const height = document.createElement('small');
      height.textContent = formatHeight(state2[value].height) + ' cm';
      label.replaceChildren(name, height);
      label.style.borderBottomColor = state2[value].color;
    }
    root2.dataset.scene = state2.scene;
    root2.dataset.view = view;
    root2.dataset.heightA = state2.a.height;
    root2.dataset.heightB = state2.b.height;
    stage.setAttribute('aria-label', `${SCENES.find(item => item.id === state2.scene).name}. A: ${state2.a.name}, ${formatHeight(state2.a.height)} cm. B: ${state2.b.name}, ${formatHeight(state2.b.height)} cm.`);
  }
  function rebuild() {
    if (world) {
      scene.remove(world.group);
      world.dispose();
    }
    world = buildWorld(state2);
    scene.add(world.group);
    const value = world.layout.max;
    floor.scale.setScalar(Math.max(8, value * 5));
    light.shadow.camera.left = light.shadow.camera.bottom = -value * 2;
    light.shadow.camera.right = light.shadow.camera.top = value * 2;
    light.shadow.camera.far = value * 12;
    light.shadow.camera.updateProjectionMatrix();
    light.position.set(-value * 2, value * 4, value * 3);
    light.target.position.set(0, value * 0.4, 0);
    updateText();
    setView(view, {
      animate: false
    });
  }
  function freePose() {
    const size = world.bounds.getSize(new T.Vector3());
    const center = world.bounds.getCenter(new T.Vector3());
    center.y = Math.max(center.y, 0.6);
    const value = T.MathUtils.degToRad(35);
    const distance = Math.max(size.y * 1.42 / (2 * Math.tan(value / 2)), (size.x + 0.45) * 1.2 / (2 * Math.tan(value / 2) * camera.aspect)) + size.z * 0.5;
    baseDistance = distance;
    return {
      target: center,
      position: center.clone().add(new T.Vector3(0.28, 0.12, 1).normalize().multiplyScalar(distance))
    };
  }
  function setView(next, {
    animate = true
  } = {}) {
    if (!camera || !world) return;
    view = next;
    eyePointers.clear();
    eyeYaw = eyePitch = 0;
    for (const value2 of world.actors) {
      value2.head.visible = true;
      value2.headGroup.visible = true;
    }
    const from = camera.position.clone();
    const fromTarget = controls.target.clone();
    let value;
    let target;
    camera.fov = 35;
    if (view === 'free') {
      const pose = freePose();
      value = pose.position;
      target = pose.target;
      controls.minDistance = baseDistance * 0.5;
      controls.maxDistance = baseDistance * 2;
      controls.enabled = active;
    } else {
      camera.fov = 68;
      const index = view === 'a' ? 0 : 1;
      const actor = world.actors[index];
      const other = world.actors[1 - index];
      world.group.updateMatrixWorld(true);
      value = actor.head.getWorldPosition(new T.Vector3());
      value.z += actor.h * 0.025;
      target = other.head.getWorldPosition(new T.Vector3());
      actor.head.visible = false;
      actor.headGroup.visible = false;
      controls.enabled = false;
      eyeOrigin.copy(value);
      const look = new T.Matrix4().lookAt(value, target, new T.Vector3(0, 1, 0));
      eyeBase.setFromRotationMatrix(look);
    }
    camera.updateProjectionMatrix();
    transition = animate && !reduced.matches ? {
      from,
      fromTarget,
      to: value,
      target,
      start: performance.now()
    } : null;
    if (!transition) {
      camera.position.copy(value);
      controls.target.copy(target);
      camera.lookAt(target);
    }
    controls.saveState();
    for (const value2 of document.querySelectorAll('button[data-view]')) value2.setAttribute('aria-pressed', String(value2.dataset.view === view));
    root2.dataset.view = view;
    render();
    wake();
  }
  function resize() {
    if (!renderer || disposed) return;
    const {
      width,
      height
    } = stage.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (world) setView(view, {
      animate: false
    });
  }
  function updateLabels() {
    if (!world) return;
    const clientWidth = stage.clientWidth;
    const clientHeight = stage.clientHeight;
    world.group.updateMatrixWorld(true);
    const entries = [];
    for (let value = 0; value < 2; value++) {
      const item = world.actors[value];
      const value2 = queryElement('#label-' + (value ? 'b' : 'a'));
      const line = queryElement('#leader-' + (value ? 'b' : 'a'));
      line.style.display = 'none';
      if (view === (value ? 'b' : 'a')) {
        value2.hidden = true;
        continue;
      }
      const point = item.head.getWorldPosition(new T.Vector3());
      point.y += item.h * 0.13;
      point.project(camera);
      value2.hidden = point.z < -1 || point.z > 1 || point.x < -1.2 || point.x > 1.2 || point.y < -1.1 || point.y > 1.15;
      const half = Math.min(value2.offsetWidth / 2, clientWidth * 0.21);
      const x = Math.max(half + 3, Math.min(clientWidth - half - 3, (point.x * 0.5 + 0.5) * clientWidth));
      const y = Math.max(value2.offsetHeight + 3, Math.min(clientHeight - 35, (-point.y * 0.5 + 0.5) * clientHeight));
      entries.push({
        el: value2,
        x,
        y,
        line,
        anchorX: (point.x * 0.5 + 0.5) * clientWidth,
        anchorY: (-point.y * 0.5 + 0.5) * clientHeight + 8,
        color: item.person.color
      });
    }
    if (entries.length === 2 && Math.abs(entries[0].x - entries[1].x) < (entries[0].el.offsetWidth + entries[1].el.offsetWidth) / 2 + 12 && Math.abs(entries[0].y - entries[1].y) < 52) {
      entries[0].x = clientWidth * 0.24;
      entries[1].x = clientWidth * 0.76;
    }
    for (const point of entries) {
      point.el.style.left = point.x + 'px';
      point.el.style.top = point.y + 'px';
      if (!point.el.hidden) {
        point.line.style.display = '';
        point.line.setAttribute('stroke', point.color);
        for (const [k, v] of Object.entries({
          x1: point.x,
          y1: point.y + 2,
          x2: point.anchorX,
          y2: point.anchorY
        })) point.line.setAttribute(k, String(v));
      }
    }
  }
  function render() {
    if (renderer && !lost && !disposed) {
      renderer.render(scene, camera);
      updateLabels();
      stage.dataset.camera = [...camera.position.toArray(), ...camera.quaternion.toArray()].map(item => item.toFixed(4)).join(',');
    }
  }
  function draw(value) {
    raf = 0;
    if (disposed || lost || document.hidden) return;
    inDraw = true;
    const value2 = last ? Math.min((value - last) / 1000, 0.05) : 0;
    last = value;
    clock += value2;
    let moving = false;
    if (transition) {
      const value3 = Math.min(1, (value - transition.start) / 360);
      const value4 = value3 * value3 * (3 - 2 * value3);
      camera.position.lerpVectors(transition.from, transition.to, value4);
      controls.target.lerpVectors(transition.fromTarget, transition.target, value4);
      camera.lookAt(controls.target);
      if (value3 === 1) transition = null;
    } else if (view === 'free') moving = controls.update();
    const idle = world && !started && !reduced.matches && clock < 8;
    // Rock the connected scene as one unit: idle motion must not separate neck wraps,
    // supporting hands or seated people from their shared props.
    if (world) world.group.rotation.y = idle ? Math.sin(clock * 1.5) * 0.012 : 0;
    render();
    inDraw = false;
    if (idle || transition || moving) raf = requestAnimationFrame(draw);
  }
  function wake() {
    if (!raf && !inDraw && !disposed && !lost && !document.hidden) {
      last = 0;
      raf = requestAnimationFrame(draw);
    }
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    for (const value of eyePointers.keys()) if (stage.hasPointerCapture(value)) stage.releasePointerCapture(value);
    eyePointers.clear();
    for (const value of freePointers.keys()) if (renderer?.domElement.hasPointerCapture(value)) renderer.domElement.releasePointerCapture(value);
    freePointers.clear();
    controls?.disconnect();
    if (controls && renderer && !disposed) {
      controls.connect(renderer.domElement);
      controls.enabled = active && view === 'free' && !document.hidden;
    }
    audio?.suspend().catch(() => {});
  }
  function resume() {
    if (disposed || document.hidden || lost) return;
    controls.enabled = active && view === 'free';
    wake();
  }
  function zoom(direction) {
    if (!active) return;
    meaningful();
    transition = null;
    if (view === 'free') {
      const offset = camera.position.clone().sub(controls.target);
      const distance = T.MathUtils.clamp(offset.length() * Math.exp(direction * 0.14), controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(offset.setLength(distance));
      controls.update();
    } else {
      camera.fov = T.MathUtils.clamp(camera.fov + direction * 5, 25, 85);
      camera.updateProjectionMatrix();
    }
    render();
    wake();
  }
  function eyeDown(event) {
    if (!active || view === 'free' || event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    transition = null;
    eyePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });
    stage.setPointerCapture(event.pointerId);
  }
  function eyeMove(event) {
    const prev = eyePointers.get(event.pointerId);
    if (!prev || view === 'free') return;
    const value = event.clientX - prev.x;
    const value2 = event.clientY - prev.y;
    if (Math.hypot(value, value2) < 1) return;
    meaningful();
    const before = [...eyePointers.values()];
    eyePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });
    if (eyePointers.size === 1) {
      eyeYaw -= value * 0.006;
      eyePitch = T.MathUtils.clamp(eyePitch - value2 * 0.006, -0.65, 0.65);
      camera.position.copy(eyeOrigin);
      camera.quaternion.copy(eyeBase).multiply(new T.Quaternion().setFromEuler(new T.Euler(eyePitch, eyeYaw, 0, 'YXZ')));
    } else if (eyePointers.size === 2) {
      const after = [...eyePointers.values()];
      const oldDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
      const distance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
      if (distance > 4 && oldDistance > 4) {
        camera.fov = T.MathUtils.clamp(camera.fov * oldDistance / distance, 25, 85);
        camera.updateProjectionMatrix();
      }
    }
    render();
  }
  function eyeUp(event) {
    eyePointers.delete(event.pointerId);
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  }
  function openPeople() {
    if (!active) return;
    for (const value of ['a', 'b']) {
      queryElement('#' + value + '-name').value = state2[value].name;
      queryElement('#' + value + '-height').value = state2[value].height;
      queryElement('#' + value + '-error').textContent = '';
      queryElement('#' + value + '-height').removeAttribute('aria-invalid');
    }
    stop();
    dialog.showModal();
  }
  function closePeople() {
    dialog.close();
    queryElement('#edit').focus({
      preventScroll: true
    });
    resume();
  }
  function submitPeople(event) {
    event.preventDefault();
    const result = validatePeople(Object.fromEntries(new FormData(event.currentTarget)), state2);
    let first;
    for (const value of ['a', 'b']) {
      const error = result.errors?.[value + 'Height'] || '';
      queryElement('#' + value + '-error').textContent = error;
      queryElement('#' + value + '-height').setAttribute('aria-invalid', String(!!error));
      if (error && !first) first = queryElement('#' + value + '-height');
    }
    if (first) {
      first.focus();
      return;
    }
    state2 = result.state;
    meaningful();
    rebuild();
    closePeople();
    tickSound();
    feedback("Altezze aggiornate. " + formatHeight(difference(state2)) + " centimetri di differenza.");
  }
  async function photo() {
    if (!active || lost) return;
    const button = queryElement('#photo');
    button.disabled = true;
    meaningful();
    try {
      await document.fonts.ready;
      render();
      const canvas = document.createElement('canvas');
      const value = 900;
      const value2 = 1200;
      canvas.width = value;
      canvas.height = value2;
      const context = canvas.getContext('2d');
      context.fillStyle = '#edf2f4';
      context.fillRect(0, 0, value, value2);
      const dimensions = renderer.domElement;
      const scale = Math.min(820 / dimensions.width, 930 / dimensions.height);
      const value3 = dimensions.width * scale;
      const value4 = dimensions.height * scale;
      context.drawImage(dimensions, (value - value3) / 2, 140 + (930 - value4) / 2, value3, value4);
      context.textAlign = 'center';
      context.fillStyle = '#243640';
      context.font = '700 38px DM';
      context.fillText(`${formatHeight(difference(state2))} cm di differenza`, value / 2, 80);
      context.font = '600 24px DM';
      context.fillText(`${state2.a.name} · ${formatHeight(state2.a.height)} cm`, value / 2, 1110, 800);
      context.fillText(`${state2.b.name} · ${formatHeight(state2.b.height)} cm`, value / 2, 1152, 800);
      const saved = await saveGameImage(canvas.toDataURL('image/png'), 'height-together');
      feedback(saved ? 'Foto salvata.' : 'Anteprima foto.');
      tickSound();
    } catch {
      feedback("Impossibile salvare la foto. Riprova.");
    } finally {
      button.disabled = false;
    }
  }
  function receive(value) {
    if (value.source !== parent || value.origin !== location.origin || value.data?.type !== 'playable-active') return;
    active = value.data.active === true;
    root2.dataset.feedPreview = String(!active);
    if (!active) {
      dialog.close();
      stop();
    } else resume();
    resize();
  }
  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
    observer2?.disconnect();
    controls?.dispose();
    world?.dispose();
    floor?.geometry.dispose();
    floor?.material.dispose();
    renderer?.dispose();
    audio?.close().catch(() => {});
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('message', receive);
    window.removeEventListener('blur', stop);
    window.removeEventListener('focus', resume);
    reduced.removeEventListener('change', motionChange);
  }
  function visibility() {
    if (document.hidden) {
      stop();
    } else {
      resume();
    }
  }
  function motionChange() {
    cancelAnimationFrame(raf);
    raf = 0;
    render();
    wake();
  }
  async function init() {
    try {
      let config;
      try {
        config = await (await requestGameConfig()).json();
      } catch {
        config = runtimeConfig;
      }
      queryElement('#guide').textContent = config.texts?.find(value => value.id === 'HINT_TEXT')?.value || "Ruota trascinando, zoom con due dita";
      renderer = new T.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
        preserveDrawingBuffer: true
      });
      renderer.setClearColor(0, 0);
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFShadowMap;
      renderer.domElement.setAttribute('aria-hidden', 'true');
      stage.prepend(renderer.domElement);
      scene = new T.Scene();
      camera = new T.PerspectiveCamera(35, 1, 0.01, 150);
      scene.add(new T.HemisphereLight('#ffffff', '#91a0aa', 2.5));
      light = new T.DirectionalLight('#fff4e6', 3);
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.0003;
      light.shadow.normalBias = 0.015;
      scene.add(light, light.target);
      const fill = new T.DirectionalLight('#e5f2ff', 1.2);
      fill.position.set(3, 2, -3);
      scene.add(fill);
      floor = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShadowMaterial({
        color: '#49616d',
        opacity: 0.17
      }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.008;
      floor.receiveShadow = true;
      scene.add(floor);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      controls.enablePan = false;
      controls.minPolarAngle = 0.35;
      controls.maxPolarAngle = Math.PI * 0.55;
      controls.rotateSpeed = 0.65;
      controls.zoomSpeed = 0.7;
      controls.addEventListener('start', () => {
        if (active) {
          transition = null;
          wake();
        }
      });
      controls.addEventListener('change', () => {
        render();
        wake();
      });
      renderer.domElement.addEventListener('pointerdown', event => {
        if (active && view === 'free') freePointers.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY
        });
      });
      renderer.domElement.addEventListener('pointermove', event => {
        const point = freePointers.get(event.pointerId);
        if (point && Math.hypot(event.clientX - point.x, event.clientY - point.y) > 3) meaningful();
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) renderer.domElement.addEventListener(type, event => freePointers.delete(event.pointerId));
      renderer.domElement.addEventListener('wheel', () => {
        if (active) meaningful();
      }, {
        passive: true
      });
      rebuild();
      observer2 = observeGameSize(resize);
      observer2.observe(stage);
      resize();
      stage.dataset.ready = 'true';
      stage.addEventListener('pointerdown', eyeDown);
      stage.addEventListener('pointermove', eyeMove);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(type, eyeUp);
      stage.addEventListener('keydown', event => {
        if (!active || event.altKey || event.ctrlKey || event.metaKey) return;
        if (['+', '=', '-', '_'].includes(event.key)) {
          event.preventDefault();
          zoom(['-', '_'].includes(event.key) ? 1 : -1);
          return;
        }
        if (!event.key.startsWith('Arrow')) return;
        event.preventDefault();
        meaningful();
        transition = null;
        if (view === 'free') {
          const value = camera.position.clone().sub(controls.target);
          const spherical = new T.Spherical().setFromVector3(value);
          if (event.key === 'ArrowLeft') spherical.theta -= 0.12;
          if (event.key === 'ArrowRight') spherical.theta += 0.12;
          if (event.key === 'ArrowUp') spherical.phi = Math.max(0.35, spherical.phi - 0.1);
          if (event.key === 'ArrowDown') spherical.phi = Math.min(Math.PI * 0.55, spherical.phi + 0.1);
          camera.position.copy(controls.target).add(new T.Vector3().setFromSpherical(spherical));
          camera.lookAt(controls.target);
        } else {
          eyeYaw += event.key === 'ArrowLeft' ? 0.1 : event.key === 'ArrowRight' ? -0.1 : 0;
          eyePitch = T.MathUtils.clamp(eyePitch + (event.key === 'ArrowUp' ? 0.1 : event.key === 'ArrowDown' ? -0.1 : 0), -0.65, 0.65);
          camera.quaternion.copy(eyeBase).multiply(new T.Quaternion().setFromEuler(new T.Euler(eyePitch, eyeYaw, 0, 'YXZ')));
        }
        render();
        wake();
      });
      for (const value of document.querySelectorAll('button[data-view]')) value.addEventListener('click', () => {
        if (active) {
          meaningful();
          setView(value.dataset.view);
          tickSound();
        }
      });
      queryElement('#scene').addEventListener('change', event => {
        if (!active || !SCENES.some(item => item.id === event.target.value)) return;
        state2.scene = event.target.value;
        meaningful();
        rebuild();
        tickSound();
        feedback("Scena selezionata: " + event.target.selectedOptions[0].textContent + ".");
      });
      queryElement('#edit').addEventListener('click', openPeople);
      queryElement('#close').addEventListener('click', closePeople);
      dialog.addEventListener('close', resume);
      dialog.addEventListener('click', event => {
        if (event.target === dialog) {
          const bounds = dialog.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closePeople();
        }
      });
      queryElement('#people-form').addEventListener('submit', submitPeople);
      // FYP frames do not grant form navigation; apply edits through the button.
      queryElement('#apply').addEventListener('click', event => {
        event.preventDefault();
        submitPeople({
          preventDefault() {},
          currentTarget: queryElement('#people-form')
        });
      });
      queryElement('#swap').addEventListener('click', () => {
        if (active) {
          state2 = swapPeople(state2);
          meaningful();
          rebuild();
          tickSound();
          feedback("Persone scambiate.");
        }
      });
      queryElement('#photo').addEventListener('click', photo);
      renderer.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        lost = true;
        stop();
        queryElement('#error').hidden = false;
      });
      renderer.domElement.addEventListener('webglcontextrestored', () => {
        lost = false;
        queryElement('#error').hidden = true;
        resize();
        resume();
      });
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('message', receive);
      window.addEventListener('blur', stop);
      window.addEventListener('focus', resume);
      window.addEventListener('pagehide', dispose, {
        once: true
      });
      reduced.addEventListener('change', motionChange);
      wake();
    } catch (value) {
      console.warn('Height comparison could not start', value);
      queryElement('#error').hidden = false;
    }
  }
  queryElement('#retry').addEventListener('click', () => {
    queryElement('#error').hidden = true;
    disposed = false;
    init();
  });
  init();

  // playable-cta-breathing-20261030

  /* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
  (() => {
    const selectors = ["#game p#guide"];
    const copy = new Set(["Ruota trascinando, zoom con due dita"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const running = new Map();
    let queued = false;
    let visible = true;
    const action = /^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;
    function scan() {
      queued = false;
      for (const [el, a] of running) if (!el.isConnected) {
        a.cancel();
        running.delete(el);
      }
      if (motion.matches) {
        for (const value of running.values()) value.cancel();
        running.clear();
        return;
      }
      const targets = new Set();
      for (const selector of selectors) {
        try {
          document.querySelectorAll(selector).forEach(item => targets.add(item));
        } catch {}
      }
      for (const value of document.querySelectorAll('p,span,div,label,text')) {
        if (value.children.length || value.closest('button,a,input,select,textarea,[role="button"]')) continue;
        const text = (value.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length >= 5 && text.length <= 140 && (copy.has(text.toLowerCase()) || !selectors.length && action.test(text))) targets.add(value);
      }
      for (const value of targets) {
        if (running.has(value) || typeof value.animate !== 'function') continue;
        if ([...targets].some(child => child !== value && value.contains(child))) continue;
        const style = getComputedStyle(value);
        if (/breath/i.test(style.animationName)) continue;
        const base = style.filter.replace(/opacity\([^)]*\)/g, '').replace(/^none$/, '').trim();
        const filter = value3 => (base ? base + ' ' : '') + 'opacity(' + value3 + ')';
        const value2 = value.animate([{
          filter: filter(1)
        }, {
          filter: filter(0.65)
        }, {
          filter: filter(1)
        }], {
          duration: 2400,
          iterations: Infinity,
          easing: 'ease-in-out'
        });
        running.set(value, value2);
        if (document.hidden || !visible) value2.pause();
      }
    }
    const schedule = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(scan);
      }
    };
    const pause = () => {
      for (const value of running.values()) {
        if (document.hidden || !visible) {
          value.pause();
        } else {
          value.play();
        }
      }
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      visible = entries.some(item => item.isIntersecting);
      pause();
    }) : null;
    if (document.body) intersection?.observe(document.body);else document.addEventListener('DOMContentLoaded', () => intersection?.observe(document.body), {
      once: true
    });
    document.addEventListener('visibilitychange', pause);
    motion.addEventListener?.('change', schedule);
    schedule();
    window.addEventListener('pagehide', () => {
      observer.disconnect();
      intersection?.disconnect();
      for (const value of running.values()) value.cancel();
      running.clear();
    }, {
      once: true
    });
  })();
}
function App() {
  React.useEffect(() => {
    startGame();
  }, []);
  return <><main id={"game"} aria-label={"Simulatore di altezze"}><header id={"top"}><output id={"difference"} aria-label={"Differenza di altezza"}>{"18 "}<small>{"cm di differenza"}</small></output><nav id={"views"} aria-label={"Punto di vista"}><button data-view={"free"} aria-pressed={"true"}>{"Vista libera"}</button><button data-view={"a"} aria-pressed={"false"}>{"Vista A"}</button><button data-view={"b"} aria-pressed={"false"}>{"Vista B"}</button></nav></header><section id={"stage"} tabIndex={"0"} aria-label={"Confronto delle altezze in 3D"} aria-describedby={"keyboard-help"}><div id={"labels"} aria-hidden={"true"}><svg id={"leaders"}><line id={"leader-a"}></line><line id={"leader-b"}></line></svg><span id={"label-a"} className={"person-label"}></span><span id={"label-b"} className={"person-label"}></span></div><p id={"guide"}>{"Ruota trascinando, zoom con due dita"}</p></section><footer id={"toolbar"}><label className={"scene-picker"}><span className={"sr-only"}>{"Scena condivisa"}</span><select id={"scene"}><option value={"together"}>{"Fianco a fianco"}</option><option value={"umbrella"}>{"Sotto l’ombrello"}</option><option value={"cafe"}>{"Un caffè insieme"}</option><option value={"shelf"}>{"Raggiungi il ripiano"}</option><option value={"hug"}>{"Un abbraccio"}</option><option value={"scarf"}>{"Una sciarpa per due"}</option><option value={"piggyback"}>{"Sulle spalle"}</option><option value={"carry"}>{"In braccio"}</option></select></label><div className={"actions"}><button id={"edit"}><svg viewBox={"0 0 24 24"} aria-hidden={"true"}><circle cx={"8"} cy={"7"} r={"3"}></circle><path d={"M2 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m1 4a5 5 0 0 1 5 5v2"}></path></svg>{"Persone"}</button><button id={"swap"}><svg viewBox={"0 0 24 24"} aria-hidden={"true"}><path d={"M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"}></path></svg>{"Scambia"}</button><button id={"photo"}><svg viewBox={"0 0 24 24"} aria-hidden={"true"}><path d={"M3 6h4l2-3h6l2 3h4v15H3z"}></path><circle cx={"12"} cy={"13"} r={"4"}></circle></svg>{"Foto"}</button></div></footer><p id={"status"} className={"sr-only"} role={"status"} aria-live={"polite"}></p><p id={"keyboard-help"} className={"sr-only"}>{"Trascina o usa le frecce per ruotare. Per lo zoom, usa due dita oppure i tasti + e −. Cambia prospettiva con Vista libera, Vista A o Vista B."}</p><div id={"error"} hidden={true} role={"alert"}><p>{"Impossibile avviare il 3D. Ricarica per riprovare."}</p><button id={"retry"}>{"Riprova"}</button></div><dialog id={"people-dialog"} aria-labelledby={"people-title"}><form id={"people-form"} novalidate={""}><div className={"dialog-heading"}><h2 id={"people-title"}>{"Le vostre altezze"}</h2><button type={"button"} id={"close"} aria-label={"Annulla le modifiche"}>{"×"}</button></div><fieldset><legend>{"Persona A"}</legend><label>{"Nome"}<input id={"a-name"} name={"aName"} maxLength={"20"} autoComplete={"off"} /></label><label>{"Altezza "}<span>{"cm"}</span><input id={"a-height"} name={"aHeight"} type={"number"} inputMode={"decimal"} min={"50"} max={"500"} step={"0.1"} required={true} aria-describedby={"a-error"} /></label><p className={"field-error"} id={"a-error"}></p></fieldset><fieldset><legend>{"Persona B"}</legend><label>{"Nome"}<input id={"b-name"} name={"bName"} maxLength={"20"} autoComplete={"off"} /></label><label>{"Altezza "}<span>{"cm"}</span><input id={"b-height"} name={"bHeight"} type={"number"} inputMode={"decimal"} min={"50"} max={"500"} step={"0.1"} required={true} aria-describedby={"b-error"} /></label><p className={"field-error"} id={"b-error"}></p></fieldset><button id={"apply"} type={"submit"}>{"Confronta le altezze"}</button><p className={"privacy"}>{"Resta su questo dispositivo."}</p></form></dialog></main></>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
function saveGameImage(dataURL, filename, extension = 'png') {
  return new Promise(resolve => {
    if (window.tt && typeof window.tt.saveDataURL === 'function') {
      window.tt.saveDataURL({
        dataURL,
        filename,
        extension,
        saveToAlbum: 'image',
        success() {
          resolve(true);
        },
        fail(error) {
          console.warn('Image save failed', error);
          resolve(false);
        },
        complete() {}
      });
      return;
    }
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'padding:16px;border:0;border-radius:18px;background:#fff;color:#222;max-width:90vw;max-height:90vh';
    const image = document.createElement('img');
    image.src = dataURL;
    image.alt = 'Immagine creata';
    image.style.cssText = 'display:block;max-width:76vw;max-height:65vh;object-fit:contain';
    const label = document.createElement('p');
    label.textContent = 'Tieni premuta l’immagine per salvarla.';
    const close = document.createElement('button');
    close.textContent = 'Chiudi';
    close.style.cssText = 'min-height:44px;padding:8px 20px';
    close.onclick = () => {
      dialog.close();
      dialog.remove();
      resolve(false);
    };
    dialog.append(image, label, close);
    document.body.append(dialog);
    dialog.showModal();
  });
}
