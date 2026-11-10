import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CanvasTexture, SRGBColorSpace, RepeatWrapping, MeshPhysicalMaterial } from 'three';
import { Vector3, Quaternion } from 'three';
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
    "label": "Spin instruction",
    "value": "Trascina le perline per farle girare",
    "default": "Trascina le perline per farle girare",
    "max_length": 40
  }],
  "images": [{
    "id": "CAT_TEXTURE",
    "label": "Cat bead texture",
    "path": "assets/textures/tabby-face.jpg"
  }],
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
const GAME_STYLES = `@font-face{font-family:"DM Sans";src:url("./assets/fonts/DMSans.woff") format("woff");font-weight:100 1000;font-style:normal;font-display:swap}
:root{font-family:"DM Sans",system-ui,sans-serif;color:#293c34;background:#edf2ee;font-synthesis:none;font-optical-sizing:auto;-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{overscroll-behavior:none;-webkit-tap-highlight-color:transparent;user-select:none}
button{font:inherit;color:inherit;cursor:pointer}button:focus-visible,#stage:focus-visible{outline:2px solid #426a58;outline-offset:5px}
#stage[data-input="pointer"]:focus-visible{outline:none}
#game{position:relative;isolation:isolate;display:flex;flex-direction:column;gap:12px;width:100%;height:100%;padding:30px 30px 50px;background:radial-gradient(ellipse at 63% 28%,#fff 0%,#f4f7f3 43%,#e7eeea 100%)}
#counter{position:relative;z-index:1;display:block;flex:0 0 36px;height:36px;margin:0;text-align:center;font-size:28px;font-weight:600;line-height:36px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
#stage{position:relative;flex:1;min-height:0;width:calc(100% + 60px);margin-left:-30px;touch-action:none;cursor:grab;outline-offset:0}
#stage[data-dragging="true"]{cursor:grabbing}#stage canvas{display:block;position:absolute;inset:0;width:100%;height:100%}
#guide{flex:0 0 auto;min-height:27px;margin:0;text-align:center;font-size:18px;line-height:27px;font-weight:500;color:#425c50;transition:opacity .18s ease-out;pointer-events:none}
#guide[data-dismissed="true"]{opacity:0;visibility:hidden}
#materials{display:flex;flex:none;flex-direction:column;align-items:stretch;gap:4px;min-height:84px}
#material-name{display:block;min-height:24px;text-align:center;font-size:14px;font-weight:500;line-height:24px}
#material-grid{display:flex;gap:12px;padding:6px;overflow-x:auto;overscroll-behavior-x:contain;touch-action:pan-x;scrollbar-width:none;scroll-snap-type:x proximity}
.material{position:relative;flex:0 0 48px;min-width:48px;min-height:48px;padding:3px;border:0;background:transparent;display:grid;place-items:center;border-radius:12px;transition:opacity .15s ease-out;scroll-snap-align:center}
.material>span:not(.swatch){position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.material:active{opacity:.65}.swatch{position:relative;width:42px;height:42px;border-radius:50%;box-shadow:inset -5px -6px 9px #0002,inset 5px 5px 9px #fff5,0 3px 5px #31403515}
.material:disabled{cursor:wait;opacity:.65}
.swatch::before{content:"";position:absolute;inset:-5px;border:1.5px solid transparent;border-radius:50%;transition:border-color .18s ease-out}
.material[aria-pressed="true"] .swatch::before{border-color:#426a58}
.swatch::after{content:"";position:absolute;inset:0;border-radius:50%;background:radial-gradient(ellipse at 29% 23%,#fff9 0%,#fff0 26%)}
.jade{background:radial-gradient(ellipse at 30% 30%,#b7caa0 0%,#4d8a6b 46%,#2b614d 100%)}
.wood{background:repeating-linear-gradient(104deg,#89512e 0px,#a66c42 2px,#6e3d25 3px,#9d6438 5px)}
.stone{background:repeating-linear-gradient(130deg,#858f87 0px,#a5aea0 12px,#4a5750 13px,#849084 15px,#9ca997 25px)}
.cat{background:#c5ad94 url("./assets/textures/tabby-face.jpg") center/cover}
.pearl{background:radial-gradient(ellipse at 28% 26%,#fffdfa,#f2e4e8 35%,#dfdfed 65%,#d3d9d8)}
.amber{background:repeating-radial-gradient(ellipse at 30% 10%,#d68a20 0px,#f6b83b 6px,#a95714 8px,#e99d26 14px)}
.porcelain{background:radial-gradient(circle at 33% 36%,#fff 0 6%,#345998 7% 11%,#fff0 12%),radial-gradient(circle at 70% 75%,#fff 0 9%,#345998 10% 14%,#fff0 15%),#f7f4eb}
.amethyst{background:repeating-linear-gradient(130deg,#623b91 0px,#b88bd6 9px,#e6cff4 10px,#7349a0 13px,#9762c1 20px)}
.gold{background:linear-gradient(115deg,#9b6117,#f1c956 28%,#ffe6a0 39%,#b87f27 64%,#e7b54a 90%)}
.obsidian{background:repeating-linear-gradient(120deg,#111a23 0px,#25323d 15px,#61747b 16px,#19242e 17px,#111a23 32px)}
#material-feedback{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
#error{position:absolute;z-index:5;inset:28% 30px auto;text-align:center;color:#293c34;padding:20px;background:#f3f6f1f5;border-radius:18px}
#error[hidden]{display:none}#error p{font-size:18px;line-height:1.4;margin:0 0 16px}#retry{min-height:44px;padding:10px 20px;border:1px solid #577261;border-radius:22px;background:transparent;font-size:16px}
#game[data-feed-preview="true"] #counter,#game[data-feed-preview="true"] #materials{visibility:hidden;pointer-events:none}
#game[data-feed-preview="true"] #materials{display:none}
#game[data-feed-preview="true"] #stage{position:absolute;top:18%;bottom:17%;left:0;width:100%;margin:0}
#game[data-feed-preview="true"] #guide{position:absolute;top:14%;left:30px;right:30px}
@media(max-height:540px){#game{gap:8px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root #game#game#game p#guide{position:fixed!important;top:15%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root #game #stage{margin-top:clamp(0px,calc(16vh - 44px),60px);margin-bottom:0;transform:translateY(-4.5vh)}
html:root:root:root #game[data-feed-preview="true"] #stage{top:19%;bottom:33%;margin-top:0;margin-bottom:0;transform:none}
html:root:root:root #game#game#game p#guide{background:rgba(255,253,248,.94);color:#293c34;padding:6px 12px;border-radius:999px}

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
  const TAU = Math.PI * 2;
  const BEAD_COUNT = 12;
  const BEAD_RADIUS = 0.42;
  const clamp = (value, otherValue, argument3) => Math.max(otherValue, Math.min(argument3, value));
  function loopPoint(angle) {
    return {
      x: -0.64 * Math.cos(angle),
      y: -1.65 * Math.sin(angle),
      z: Math.sqrt(1.65 ** 2 - 0.64 ** 2) * Math.cos(angle)
    };
  }

  /** Input and inertia are separate from the silent opening animation. */
  class BeadMotion {
    constructor({
      count = BEAD_COUNT,
      friction = 2.1
    } = {}) {
      this.spacing = TAU / count;
      this.friction = friction;
      this.phase = 0;
      this.velocity = 0;
      this.travel = 0;
      this.count = 0;
      this.pointer = null;
      this.started = false;
    }
    add(delta) {
      if (!Number.isFinite(delta)) return;
      this.phase += delta;
      this.travel += Math.abs(delta);
      this.count = Math.floor((this.travel + 1e-9) / this.spacing);
      if (Math.abs(delta) > 0.00001) this.started = true;
    }
    down({
      id,
      x,
      y,
      time,
      primary = true,
      button = 0,
      hit = true
    }) {
      if (this.pointer || !primary || button !== 0 || !hit) return false;
      this.velocity = 0;
      this.pointer = {
        id,
        x,
        y,
        time,
        startX: x,
        startY: y,
        moving: false
      };
      return true;
    }
    move({
      id,
      x,
      y,
      time,
      height
    }) {
      const point = this.pointer;
      if (!point || point.id !== id) return false;
      if (!point.moving && Math.hypot(x - point.startX, y - point.startY) < 3) return false;
      const delta = clamp((y - point.y + (x - point.x) * 0.25) * 3.2 / Math.max(160, height), -0.65, 0.65);
      const seconds = clamp((time - point.time) / 1000, 1 / 240, 0.08);
      this.add(delta);
      this.velocity = clamp(this.velocity * 0.3 + delta / seconds * 0.7, -12, 12);
      Object.assign(point, {
        x,
        y,
        time,
        moving: true
      });
      return true;
    }
    up({
      id,
      time,
      cancel = false
    }) {
      const pointer2 = this.pointer;
      if (!pointer2 || pointer2.id !== id) return false;
      if (cancel || !pointer2.moving || time - pointer2.time > 100) this.velocity = 0;
      this.pointer = null;
      return true;
    }
    kick(direction = 1) {
      this.started = true;
      this.velocity = clamp(this.velocity + direction * 5.5, -12, 12);
    }
    tick(seconds) {
      if (this.pointer || !Number.isFinite(seconds) || seconds <= 0) return;
      const value = Math.min(0.05, seconds);
      const decay = Math.exp(-this.friction * value);
      if (Math.abs(this.velocity) < 0.025) {
        this.velocity = 0;
        return;
      }
      this.add(this.velocity * (1 - decay) / this.friction);
      this.velocity *= decay;
    }
    stop() {
      this.pointer = null;
      this.velocity = 0;
    }
  }
  const MATERIALS = [{
    id: 'jade',
    name: "Giada",
    color: '#5b8c78',
    roughness: 0.2,
    clearcoat: 1
  }, {
    id: 'wood',
    name: "Legno",
    color: '#92532e',
    roughness: 0.4,
    clearcoat: 0.5
  }, {
    id: 'stone',
    name: "Pietra",
    color: '#88928a',
    roughness: 0.38,
    clearcoat: 0.6
  }, {
    id: 'cat',
    name: "Gatto",
    color: '#bb9b7d',
    roughness: 0.35,
    clearcoat: 0.55
  }, {
    id: 'pearl',
    name: "Perla",
    color: '#f2e6db',
    roughness: 0.18,
    clearcoat: 1,
    iridescence: 0.65,
    iridescenceIOR: 1.3
  }, {
    id: 'amber',
    name: "Ambra",
    color: '#d98422',
    roughness: 0.13,
    clearcoat: 1
  }, {
    id: 'porcelain',
    name: "Porcellana bianca e blu",
    color: '#f4f2e9',
    roughness: 0.12,
    clearcoat: 1
  }, {
    id: 'amethyst',
    name: "Ametista",
    color: '#9368ba',
    roughness: 0.22,
    clearcoat: 0.9
  }, {
    id: 'gold',
    name: "Oro",
    color: '#e5b34d',
    roughness: 0.22,
    clearcoat: 0.35,
    metalness: 1,
    envMapIntensity: 1.15
  }, {
    id: 'obsidian',
    name: "Ossidiana",
    color: '#202c35',
    roughness: 0.15,
    clearcoat: 1,
    iridescence: 0.2
  }];
  const mix = (value, otherValue, argument3) => value.map((item, index) => Math.round(item + (otherValue[index] - item) * Math.max(0, Math.min(1, argument3))));
  function noise(x, y) {
    const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return value - Math.floor(value);
  }
  function field(value, otherValue) {
    return Math.sin(value * 6.283 + Math.sin(otherValue * 6.283) * 1.5) * 0.45 + Math.sin(value * 18.85 - otherValue * 12.566 + Math.sin(value * 6.283)) * 0.2 + Math.sin(value * 43.98 + otherValue * 25.13) * 0.08;
  }
  function materialPixel(kind, otherValue, argument3, grain = 0) {
    const value = field(otherValue, argument3);
    let value2;
    if (kind === 'jade') {
      const milk = Math.pow(Math.max(0, (value + 0.7) / 1.4), 2.4);
      value2 = mix([30, 83, 66], [172, 202, 151], milk * 0.8 + grain * 0.035);
      const vein = Math.pow(Math.max(0, 1 - Math.abs(Math.sin(otherValue * 18.85 + argument3 * 12.56 + value * 5)) / 0.08), 3);
      value2 = mix(value2, [212, 222, 172], vein * 0.18);
    } else if (kind === 'wood') {
      const rings = Math.sin(otherValue * 163.36 + value * 8 + Math.sin(argument3 * 12.56) * 1.5);
      value2 = mix([77, 35, 18], [170, 108, 57], 0.5 + value * 0.38 + rings * 0.13 + grain * 0.06);
      if (noise(Math.floor(otherValue * 256), Math.floor(argument3 * 12)) > 0.98) value2 = mix(value2, [51, 23, 10], 0.24);
    } else if (kind === 'stone') {
      const vein = Math.pow(1 - Math.abs(Math.sin(otherValue * 12.56 + argument3 * 6.283 + value * 5)), 18);
      value2 = mix([75, 86, 84], [141, 153, 140], 0.5 + value * 0.4 + grain * 0.04);
      value2 = mix(value2, [33, 44, 40], vein * 0.6);
      const fleck = Math.pow(Math.max(0, Math.sin(otherValue * 31.4 - argument3 * 12.56 + value * 7)), 40);
      value2 = mix(value2, [168, 132, 82], fleck * 0.35);
    } else if (kind === 'pearl') {
      value2 = mix([222, 219, 237], [255, 247, 229], 0.64 + value * 0.2 + grain * 0.012);
      const nacre = (1 + Math.sin(otherValue * 31.416 + Math.sin(argument3 * 18.85) * 0.7)) * 0.5;
      value2 = mix(value2, [242, 211, 225], nacre * 0.18);
    } else if (kind === 'amber') {
      value2 = mix([113, 43, 8], [246, 175, 48], 0.63 + value * 0.4);
      const swirl = Math.pow(1 - Math.abs(Math.sin(otherValue * 18.85 + argument3 * 6.283 + value * 5)), 13);
      value2 = mix(value2, [103, 36, 6], swirl * 0.48);
      if (grain > 0.487) value2 = mix(value2, [255, 224, 132], 0.65);
    } else if (kind === 'porcelain') {
      value2 = mix([236, 237, 231], [255, 253, 245], 0.7 + value * 0.1);
      const value3 = otherValue * 4 % 1 - 0.5;
      const value4 = argument3 * 3 % 1 - 0.5;
      const value5 = Math.hypot(value3, value4);
      const angle = Math.atan2(value4, value3);
      const petal = 0.19 + 0.07 * Math.cos(angle * 5);
      const flower = value5 < petal && value5 > 0.065 || value5 < 0.032;
      const leaf = (value3 - 0.34) ** 2 / 0.012 + (value4 + 0.26) ** 2 / 0.003 < 1 || (value3 + 0.34) ** 2 / 0.012 + (value4 - 0.26) ** 2 / 0.003 < 1;
      if (flower || leaf) value2 = mix([24, 55, 122], [66, 111, 177], 0.45 + value * 0.3);
    } else if (kind === 'amethyst') {
      const bands = 0.5 + 0.5 * Math.sin(argument3 * 62.832 + Math.sin(otherValue * 12.566) * 2 + value * 4);
      value2 = mix([62, 31, 107], [183, 139, 216], 0.35 + value * 0.35 + bands * 0.32);
      const quartz = Math.pow(1 - Math.abs(Math.sin(otherValue * 18.85 + argument3 * 12.566 + value * 3)), 22);
      value2 = mix(value2, [228, 212, 241], quartz * 0.6);
    } else if (kind === 'gold') {
      const brushed = Math.sin(otherValue * 440 + Math.sin(argument3 * 6.283) * 2) * 0.018;
      value2 = mix([183, 119, 32], [248, 204, 102], 0.7 + value * 0.05 + brushed + grain * 0.02);
    } else if (kind === 'obsidian') {
      value2 = mix([11, 16, 23], [45, 61, 72], 0.35 + value * 0.23);
      const thread = Math.pow(1 - Math.abs(Math.sin(otherValue * 12.566 - argument3 * 6.283 + value * 4)), 34);
      value2 = mix(value2, [92, 115, 120], thread * 0.3);
    } else throw new RangeError('Unknown procedural bead material: ' + kind);
    return value2;
  }
  function makeTexture(kind, size = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    const data = context.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const value = materialPixel(kind, x / size, y / size, noise(x, y) - 0.5);
      const value2 = (y * size + x) * 4;
      data.data[value2] = value[0];
      data.data[value2 + 1] = value[1];
      data.data[value2 + 2] = value[2];
      data.data[value2 + 3] = 255;
    }
    context.putImageData(data, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
  }
  function createMaterial(value, otherValue) {
    return new MeshPhysicalMaterial({
      map: otherValue,
      color: 16777215,
      roughness: value.roughness,
      metalness: value.metalness ?? 0,
      clearcoat: value.clearcoat,
      clearcoatRoughness: 0.22,
      envMapIntensity: value.envMapIntensity ?? 0.8,
      iridescence: value.iridescence ?? 0,
      iridescenceIOR: value.iridescenceIOR ?? 1.3,
      iridescenceThicknessRange: [140, 420],
      ...(value.id === 'jade' ? {
        sheen: 0.35,
        sheenRoughness: 0.8,
        sheenColor: 10599568
      } : {})
    });
  }
  /** One restrained, non-tonal bead click per pass; never sound before a gesture. */
  class BeadAudio {
    constructor() {
      this.ctx = null;
      this.last = -Infinity;
      this.active = false;
    }
    unlock() {
      try {
        if (!this.ctx) {
          const Context = window.AudioContext || window.webkitAudioContext;
          if (!Context) return;
          this.ctx = new Context();
          const frames = Math.floor(this.ctx.sampleRate * 0.055);
          this.noise = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
          const data = this.noise.getChannelData(0);
          for (let value = 0; value < frames; value++) data[value] = (Math.random() * 2 - 1) * Math.pow(1 - value / frames, 3);
        }
        this.active = true;
        this.ctx.resume().catch(() => {});
      } catch {}
    }
    click(kind = 'jade', light = false) {
      const value = this.ctx;
      if (!this.active || !value || value.state !== 'running' || value.currentTime - this.last < 0.065) return;
      this.last = value.currentTime;
      try {
        const source = value.createBufferSource();
        const filter = value.createBiquadFilter();
        const gain = value.createGain();
        source.buffer = this.noise;
        filter.type = 'bandpass';
        filter.frequency.value = kind === 'wood' ? 850 : kind === 'cat' ? 1600 : 2100;
        filter.Q.value = 0.65;
        gain.gain.setValueAtTime(light ? 0.035 : 0.065, value.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, value.currentTime + 0.065);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(value.destination);
        source.onended = () => {
          source.disconnect();
          filter.disconnect();
          gain.disconnect();
        };
        source.start();
        source.stop(value.currentTime + 0.07);
      } catch {}
    }
    pause() {
      this.active = false;
      if (this.ctx && this.ctx.state !== 'closed') this.ctx.suspend().catch(() => {});
    }
    dispose() {
      this.active = false;
      if (this.ctx && this.ctx.state !== 'closed') this.ctx.close().catch(() => {});
    }
  }
  const cameraPosition = new Vector3();
  const cameraRotation = new Quaternion();
  /** Keep the cat texture's +Z face directed at the viewer, including parent wobble. */
  function faceCatTowardCamera(bead, camera) {
    camera.getWorldPosition(cameraPosition);
    camera.getWorldQuaternion(cameraRotation);
    bead.up.set(0, 1, 0).applyQuaternion(cameraRotation);
    bead.lookAt(cameraPosition);
  }
  const root2 = document.querySelector('#game');
  const stage = document.querySelector('#stage');
  const counter = document.querySelector('#counter');
  const guide = document.querySelector('#guide');
  const feedback = document.querySelector('#material-feedback');
  const error = document.querySelector('#error');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const motion2 = new BeadMotion();
  const audio = new BeadAudio();
  let renderer;
  let scene;
  let camera2;
  let group;
  let beads = [];
  let frame = 0;
  let last = 0;
  let elapsed = 0;
  let disposed = false;
  let lost = false;
  let materialId = 'jade';
  let materialGeneration = 0;
  let textures = new Map();
  let materials = new Map();
  let environmentTarget;
  let cord;
  let geometry;
  let shadow;
  let resizeObserver;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const feedMode = new URLSearchParams(location.search).has('review') || new URLSearchParams(location.search).get('feedReview') === '1';
  let hostActive = !feedMode;
  root2.dataset.feedPreview = String(feedMode && !hostActive);
  const format = new Intl.NumberFormat("it-IT");
  let catTexturePath = './assets/textures/tabby-face.jpg';
  let audibleCount = 0;
  function markState() {
    stage.dataset.started = String(motion2.started);
    stage.dataset.turns = String(motion2.count);
    stage.dataset.material = materialId;
    stage.dataset.phase = motion2.phase.toFixed(4);
    counter.textContent = format.format(motion2.count);
    counter.setAttribute('aria-label', "Perline fatte scorrere: " + motion2.count);
    guide.dataset.dismissed = String(motion2.started);
    guide.setAttribute('aria-hidden', String(motion2.started));
    if (motion2.count !== audibleCount && hostActive && motion2.started) audio.click(materialId);
    audibleCount = motion2.count;
  }
  function updateBeads() {
    for (let value = 0; value < beads.length; value++) {
      const angle = motion2.phase + value * TAU / BEAD_COUNT;
      const point = loopPoint(angle);
      const bead = beads[value];
      bead.position.set(point.x, point.y, point.z);
      // Natural materials roll; cat faces are aligned after the parent transform below.
      if (materialId !== 'cat') bead.rotation.set(0.12 * Math.sin(angle) + motion2.phase * 0.15, motion2.phase * 0.42 + 0.12 * Math.sin(value * 0.4), 0.05 * Math.cos(angle));
    }
    const idle = !motion2.started && !reduced.matches;
    group.rotation.z = idle ? Math.sin(elapsed * 0.85) * 0.025 : group.rotation.z * 0.92;
    group.rotation.y = idle ? Math.sin(elapsed * 0.55) * 0.045 : group.rotation.y * 0.92;
    group.position.y = idle ? Math.sin(elapsed * 0.85) * 0.022 : 0;
    group.updateMatrixWorld(true);
    if (materialId === 'cat') for (const bead of beads) faceCatTowardCamera(bead, camera2);
  }
  function makeShadow() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(128, 64, 4, 128, 64, 62);
    gradient.addColorStop(0, 'rgba(51,66,59,.18)');
    gradient.addColorStop(0.5, 'rgba(51,66,59,.065)');
    gradient.addColorStop(1, 'rgba(51,66,59,0)');
    context.scale(2, 1);
    context.translate(-64, 0);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 128);
    const texture = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.65), new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    }));
    mesh.position.set(0, -2.52, -0.5);
    return mesh;
  }
  function resize() {
    if (!renderer || disposed) return;
    const {
      width,
      height
    } = stage.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    camera2.aspect = width / height;
    // Fit by both dimensions; no distorted models or cropped beads at short/narrow sizes.
    const viewHeight = Math.max(feedMode && !hostActive ? 4.15 : 4.45, 2.85 / camera2.aspect);
    camera2.position.set(0, 0.02, viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera2.fov / 2))) + 0.55);
    camera2.lookAt(0, -0.05, 0);
    camera2.updateProjectionMatrix();
    renderOnce();
  }
  function renderOnce() {
    if (renderer && !lost && !disposed) {
      updateBeads();
      renderer.render(scene, camera2);
    }
  }
  function draw(time) {
    frame = 0;
    if (disposed || lost || document.hidden) return;
    const value = last ? Math.min((time - last) / 1000, 0.05) : 0;
    last = time;
    elapsed += value;
    const before = motion2.count;
    if (hostActive) motion2.tick(value);
    if (motion2.count !== before) markState();
    updateBeads();
    renderer.render(scene, camera2);
    if (!reduced.matches || motion2.pointer || Math.abs(motion2.velocity) > 0.025) frame = requestAnimationFrame(draw);
  }
  function wake() {
    if (!frame && !disposed && !document.hidden && !lost) {
      last = 0;
      frame = requestAnimationFrame(draw);
    }
  }
  async function selectMaterial(value, {
    gesture = false
  } = {}) {
    if (!MATERIALS.some(item => item.id === value) || disposed) return;
    const request = ++materialGeneration;
    const value2 = MATERIALS.find(item => item.id === value);
    const button = document.querySelector(`.material[data-material="${value}"]`);
    if (!materials.has(value)) {
      let texture = textures.get(value);
      if (!texture) {
        try {
          if (value === 'cat') {
            button.setAttribute('aria-busy', 'true');
            button.disabled = true;
            texture = await new THREE.TextureLoader().loadAsync(catTexturePath);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = THREE.RepeatWrapping;
            texture.repeat.set(2, 1);
            texture.anisotropy = 4;
          } else texture = makeTexture(value);
          if (disposed) {
            texture.dispose();
            return;
          }
          textures.set(value, texture);
        } catch {
          button.removeAttribute('aria-busy');
          feedback.textContent = "Materiale non disponibile. Scegline un altro.";
          return;
        } finally {
          button.removeAttribute('aria-busy');
          button.disabled = false;
        }
      }
      materials.set(value, createMaterial(value2, texture));
    }
    if (request !== materialGeneration || disposed) return;
    materialId = value;
    for (const bead of beads) bead.material = materials.get(value);
    for (const option of document.querySelectorAll('.material[data-material]')) option.setAttribute('aria-pressed', String(option.dataset.material === value));
    if (gesture) button.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto'
    });
    document.querySelector('#material-name').textContent = value2.name;
    feedback.textContent = "Materiale selezionato: " + value2.name;
    root2.dataset.material = value;
    if (gesture && hostActive && !document.hidden && !lost) {
      audio.unlock();
      audio.click(value, true);
    }
    markState();
    renderOnce();
    wake();
  }
  function releasePointer({
    cancel = false,
    id: value = motion2.pointer?.id,
    time = performance.now()
  } = {}) {
    if (value == null) return;
    motion2.up({
      id: value,
      time,
      cancel
    });
    stage.dataset.dragging = 'false';
    if (stage.hasPointerCapture(value)) stage.releasePointerCapture(value);
  }
  function hitTest(event) {
    const bounds = stage.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera2);
    return raycaster.intersectObjects(beads, false).length > 0;
  }
  function onDown(event) {
    if (!hostActive || lost || !renderer) return;
    if (!motion2.down({
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      primary: event.isPrimary,
      button: event.button,
      hit: hitTest(event)
    })) return;
    event.preventDefault();
    stage.dataset.input = 'pointer';
    stage.setPointerCapture(event.pointerId);
    stage.dataset.dragging = 'true';
    stage.focus({
      preventScroll: true
    });
    audio.unlock();
    wake();
  }
  function onMove(event) {
    if (motion2.move({
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      height: stage.clientHeight
    })) {
      event.preventDefault();
      markState();
      renderOnce();
      wake();
    }
  }
  function onUp(event) {
    releasePointer({
      id: event.pointerId,
      time: event.timeStamp,
      cancel: event.type === 'pointercancel'
    });
    wake();
  }
  function onKey(event) {
    if (!hostActive || event.repeat || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    motion2.kick(['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1);
    audio.unlock();
    markState();
    wake();
  }
  function keyboardMode() {
    stage.dataset.input = 'keyboard';
  }
  function accessibleClick(event) {
    if (event.detail === 0 && hostActive && !lost) {
      motion2.kick();
      audio.unlock();
      markState();
      wake();
    }
  }
  function pause2() {
    releasePointer({
      cancel: true
    });
    motion2.stop();
    audio.pause();
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  }
  function visibility() {
    if (document.hidden) pause2();else wake();
  }
  function changedMotion() {
    cancelAnimationFrame(frame);
    frame = 0;
    renderOnce();
    wake();
  }
  function receive(event) {
    if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    hostActive = event.data.active === true;
    root2.dataset.feedPreview = String(!hostActive);
    if (!hostActive) pause2();
    resize();
    wake();
  }
  function contextLost(event) {
    event.preventDefault();
    lost = true;
    pause2();
    error.hidden = false;
  }
  function contextRestored() {
    lost = false;
    error.hidden = true;
    resize();
    wake();
  }
  function dispose() {
    if (disposed) return;
    pause2();
    disposed = true;
    resizeObserver?.disconnect();
    audio.dispose();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('message', receive);
    window.removeEventListener('blur', pause2);
    window.removeEventListener('keydown', keyboardMode, true);
    reduced.removeEventListener('change', changedMotion);
    for (const value of textures.values()) value.dispose();
    for (const value of materials.values()) value.dispose();
    geometry?.dispose();
    cord?.geometry.dispose();
    cord?.material.dispose();
    shadow?.material.map.dispose();
    shadow?.geometry.dispose();
    shadow?.material.dispose();
    environmentTarget?.dispose();
    renderer?.dispose();
  }
  async function init() {
    try {
      let config = {};
      try {
        config = await (await requestGameConfig()).json();
      } catch {
        try {
          config = runtimeConfig;
        } catch {}
      }
      guide.textContent = config.texts?.find(item => item.id === 'HINT_TEXT')?.value || guide.textContent;
      catTexturePath = config.images?.find(item => item.id === 'CAT_TEXTURE')?.path || catTexturePath;
      document.querySelector('.swatch.cat').style.backgroundImage = 'url(' + JSON.stringify(catTexturePath) + ')';
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'low-power'
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.22;
      renderer.setClearColor(0, 0);
      renderer.domElement.setAttribute('aria-hidden', 'true');
      stage.prepend(renderer.domElement);
      scene = new THREE.Scene();
      camera2 = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
      const room = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(renderer);
      environmentTarget = pmrem.fromScene(room, 0.04, 0.1, 100, {
        size: 128
      });
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = 0.65;
      room.dispose();
      pmrem.dispose();
      scene.add(new THREE.AmbientLight(16777215, 1.2));
      const directionalLight = new THREE.DirectionalLight(16774629, 3.4);
      directionalLight.position.set(-3, 5, 5);
      scene.add(directionalLight);
      const fill = new THREE.DirectionalLight(14149620, 1.7);
      fill.position.set(4, 1, 2);
      scene.add(fill);
      group = new THREE.Group();
      scene.add(group);
      geometry = new THREE.SphereGeometry(BEAD_RADIUS, 40, 28);
      const initial = createMaterial(MATERIALS[0], makeTexture('jade'));
      materials.set('jade', initial);
      textures.set('jade', initial.map);
      for (let value = 0; value < BEAD_COUNT; value++) {
        const bead = new THREE.Mesh(geometry, initial);
        group.add(bead);
        beads.push(bead);
      }
      const points = Array.from({
        length: 129
      }, (value, otherValue) => {
        const point = loopPoint(otherValue / 128 * TAU);
        return new THREE.Vector3(point.x, point.y, point.z);
      });
      const curve = new THREE.CatmullRomCurve3(points, true);
      cord = new THREE.Mesh(new THREE.TubeGeometry(curve, 128, 0.032, 8, true), new THREE.MeshStandardMaterial({
        color: 8812637,
        roughness: 0.8
      }));
      group.add(cord);
      shadow = makeShadow();
      scene.add(shadow);
      stage.addEventListener('pointerdown', onDown);
      stage.addEventListener('pointermove', onMove);
      stage.addEventListener('pointerup', onUp);
      stage.addEventListener('pointercancel', onUp);
      stage.addEventListener('lostpointercapture', () => {
        if (motion2.pointer) releasePointer({
          cancel: true
        });
      });
      stage.addEventListener('keydown', onKey);
      stage.addEventListener('click', accessibleClick);
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('blur', pause2);
      window.addEventListener('message', receive);
      window.addEventListener('pagehide', dispose, {
        once: true
      });
      window.addEventListener('keydown', keyboardMode, true);
      reduced.addEventListener('change', changedMotion);
      for (const button of document.querySelectorAll('.material[data-material]')) button.addEventListener('click', () => selectMaterial(button.dataset.material, {
        gesture: hostActive
      }));
      resizeObserver = observeGameSize(resize);
      resizeObserver.observe(stage);
      resize();
      markState();
      stage.dataset.ready = 'true';
      wake();
    } catch (value) {
      console.warn('3D beads could not start', value);
      error.hidden = false;
      error.querySelector('p').textContent = "Impossibile avviare il 3D. Ricarica la pagina.";
    }
  }
  document.querySelector('#retry').addEventListener('click', () => {
    error.hidden = true;
    disposed = false;
    init();
  });
  init();

  // playable-cta-breathing-20261030

  /* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
  (() => {
    const selectors = ["#game p#guide"];
    const copy = new Set(["Trascina le perline per farle girare"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
  return <><main id={"game"} data-material={"jade"}><output id={"counter"} aria-label={"Perline fatte scorrere: 0"} aria-live={"off"}>{"0"}</output><div id={"stage"} tabIndex={"0"} role={"button"} aria-label={"Fai girare le perline"} aria-description={"Scorri sulle perline. Puoi usare anche frecce, Spazio o Invio."} data-material={"jade"} data-ready={"false"} data-started={"false"} data-turns={"0"}></div><p id={"guide"}>{"Trascina le perline per farle girare"}</p><div id={"materials"} role={"group"} aria-label={"Materiali delle perline"}><output id={"material-name"} aria-live={"off"}>{"Giada"}</output><div id={"material-grid"}><button className={"material"} data-material={"jade"} aria-label={"Giada"} aria-pressed={"true"}><span className={"swatch jade"} aria-hidden={"true"}></span><span>{"Giada"}</span></button><button className={"material"} data-material={"wood"} aria-label={"Legno"} aria-pressed={"false"}><span className={"swatch wood"} aria-hidden={"true"}></span><span>{"Legno"}</span></button><button className={"material"} data-material={"stone"} aria-label={"Pietra"} aria-pressed={"false"}><span className={"swatch stone"} aria-hidden={"true"}></span><span>{"Pietra"}</span></button><button className={"material"} data-material={"cat"} aria-label={"Volto di gatto"} aria-pressed={"false"}><span className={"swatch cat"} aria-hidden={"true"}></span><span>{"Gatto"}</span></button><button className={"material"} data-material={"pearl"} aria-label={"Perla"} aria-pressed={"false"}><span className={"swatch pearl"} aria-hidden={"true"}></span><span>{"Perla"}</span></button><button className={"material"} data-material={"amber"} aria-label={"Ambra"} aria-pressed={"false"}><span className={"swatch amber"} aria-hidden={"true"}></span><span>{"Ambra"}</span></button><button className={"material"} data-material={"porcelain"} aria-label={"Porcellana bianca e blu"} aria-pressed={"false"}><span className={"swatch porcelain"} aria-hidden={"true"}></span><span>{"Porcellana"}</span></button><button className={"material"} data-material={"amethyst"} aria-label={"Ametista"} aria-pressed={"false"}><span className={"swatch amethyst"} aria-hidden={"true"}></span><span>{"Ametista"}</span></button><button className={"material"} data-material={"gold"} aria-label={"Oro"} aria-pressed={"false"}><span className={"swatch gold"} aria-hidden={"true"}></span><span>{"Oro"}</span></button><button className={"material"} data-material={"obsidian"} aria-label={"Ossidiana"} aria-pressed={"false"}><span className={"swatch obsidian"} aria-hidden={"true"}></span><span>{"Ossidiana"}</span></button></div></div><span id={"material-feedback"} aria-live={"polite"}></span><section id={"error"} role={"alert"} hidden={true}><p>{"Il 3D si è interrotto. Riprova."}</p><button id={"retry"}>{"Riprova"}</button></section></main></>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
