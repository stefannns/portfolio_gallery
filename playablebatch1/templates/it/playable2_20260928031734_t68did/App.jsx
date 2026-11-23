// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "MAX_OXYGEN",
    "kind": "number",
    "label": "Max Oxygen (ms)",
    "value": 45000,
    "default": 45000,
    "min": 10000,
    "max": 120000,
    "step": 1000
  }],
  "texts": [{
    "id": "INSTRUCTION_MAIN",
    "label": "Instruction Title",
    "value": "Tieni premuto per immergerti",
    "default": "Tieni premuto per immergerti",
    "max_length": 30
  }, {
    "id": "INSTRUCTION_SUB",
    "label": "Instruction Subtitle",
    "value": "Fai un bel respiro",
    "default": "Fai un bel respiro",
    "max_length": 50
  }, {
    "id": "RESULT_TITLE",
    "label": "Result Title",
    "value": "Tempo in immersione",
    "default": "Tempo in immersione",
    "max_length": 30
  }, {
    "id": "RESULT_DESC_NORMAL",
    "label": "Result Desc (Normal)",
    "value": "Sei tornato a respirare!",
    "default": "Sei tornato a respirare!",
    "max_length": 40
  }, {
    "id": "RESULT_DESC_O2",
    "label": "Result Desc (Out of O2)",
    "value": "Ossigeno esaurito!",
    "default": "Ossigeno esaurito!",
    "max_length": 40
  }, {
    "id": "BTN_REPLAY",
    "label": "Replay Button",
    "value": "Riprova",
    "default": "Riprova",
    "max_length": 20
  }],
  "images": [{
    "id": "ICON_MASK",
    "label": "Snorkel Mask Icon",
    "path": "./assets/icon_mask.webp",
    "replaceable": true
  }],
  "config_version": "2.0",
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
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; overscroll-behavior: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
    #root { isolation: isolate; }
    canvas { touch-action: none; }
    button, input, select, textarea { touch-action: manipulation; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.dive-guide{position:fixed!important;top:36%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(p.dive-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(p.dive-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(p.dive-guide){animation:none!important}}

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
function useRecordingSubmission() {
  let canSubmit = typeof window !== "undefined" && typeof window.tt !== "undefined" && typeof window.tt.playableRecordingSubmission == "function";
  let [submitting, setSubmitting] = React.useState(false);
  React.useEffect(() => {
    let handleAction = () => setSubmitting(false);
    let handleAction2 = () => {
      if (document.visibilityState === "visible") {
        handleAction();
      }
    };
    document.addEventListener("visibilitychange", handleAction2);
    window.addEventListener("pageshow", handleAction);
    return () => {
      document.removeEventListener("visibilitychange", handleAction2);
      window.removeEventListener("pageshow", handleAction);
    };
  }, []);
  return {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: () => {
      if (!(submitting || !canSubmit)) {
        setSubmitting(true);
        window.tt.playableRecordingSubmission({
          success() {},
          fail(value) {
            console.error("[post_my_play] playableRecordingSubmission failed", value && (value.errMsg || value.message));
            setSubmitting(false);
          },
          complete() {}
        });
      }
    }
  };
}
function readConfigValues(config) {
  let values = {};
  (config.tweaks || []).forEach(item => {
    values[item.id] = item.value;
  });
  (config.texts || []).forEach(item => {
    values[item.id] = item.value;
  });
  (config.images || []).forEach(item => {
    values[item.id] = item.path;
  });
  (config.mentions || []).forEach(item => {
    values[item.id] = item.path != null && item.path !== "" ? item.path : item.value;
  });
  (config.motions || []).forEach(item => {
    if (!(!item || !item.id)) {
      if (item.base_path != null && item.base_path !== "") {
        values[item.id] = item.base_path;
        values[item.id + "_BASE"] = item.base_path;
      }
      if (item.frame_count != null) {
        values[item.id + "_COUNT"] = item.frame_count;
      }
    }
  });
  return values;
}
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
// Depth is a game simulation, not a real-world breath-holding measurement.
const METERS_PER_SECOND = 2.4;
const MAX_FRAME_MS = 100;
function makeDive(maxOxygen = 45000) {
  return {
    phase: 'idle',
    elapsed: 0,
    remaining: Math.max(1, Number(maxOxygen) || 45000),
    max: Math.max(1, Number(maxOxygen) || 45000),
    depth: 0,
    reason: null
  };
}
function startDive(state) {
  if (state.phase !== 'idle') return state;
  return {
    ...state,
    phase: 'playing',
    elapsed: 0,
    remaining: state.max,
    depth: 0,
    reason: null
  };
}
function advanceDive(state, milliseconds) {
  if (state.phase !== 'playing') return state;
  const delta = Math.min(MAX_FRAME_MS, Math.max(0, Number(milliseconds) || 0), state.remaining);
  const elapsed = state.elapsed + delta;
  const remaining = Math.max(0, state.remaining - delta);
  return {
    ...state,
    elapsed,
    remaining,
    depth: elapsed / 1000 * METERS_PER_SECOND,
    phase: remaining === 0 ? 'over' : 'playing',
    reason: remaining === 0 ? 'limit' : null
  };
}
function finishDive(state, reason = 'release') {
  return state.phase === 'playing' ? {
    ...state,
    phase: 'over',
    reason
  } : state;
}
function resetDive(state) {
  return makeDive(state.max);
}
function formatTime(milliseconds) {
  return (milliseconds / 1000).toFixed(2);
}
function formatDepth(meters) {
  return meters.toFixed(1);
}
function axisMaximum(state) {
  return Math.max(10, Math.ceil(state.max / 1000 * METERS_PER_SECOND / 10) * 10);
}
const WORLD_PIXELS_PER_METER = 8;
// Compressed fictional layers: colors depend on meters, never viewport size.
const WATER_STOPS = [[0, '#3d9db6'], [18, '#277b9c'], [45, '#195373'], [75, '#0b2b4b'], [108, '#040f24'], [140, '#020a17']];
function oceanZone(depth) {
  return depth < 18 ? 'shallows' : depth < 45 ? 'midwater' : depth < 75 ? 'twilight' : 'deep';
}
function oceanEncounters(minDepth, maxDepth) {
  const encounters = [];
  for (let slot = Math.max(1, Math.ceil(minDepth / 4)); slot * 4 <= maxDepth; slot++) {
    const depth = slot * 4;
    const zone = oceanZone(depth);
    const kinds = zone === 'shallows' ? ['shoal', 'striped', 'shoal'] : zone === 'midwater' ? ['striped', 'ray', 'silver'] : zone === 'twilight' ? ['silver', 'ray', 'silver'] : ['angler', 'glowfish', 'glowfish'];
    encounters.push({
      depth,
      zone,
      kind: kinds[slot % kinds.length],
      side: slot % 2,
      index: slot
    });
  }
  return encounters;
}
const BODY = ['      nnnnn       ', '     nnnnnnn      ', '    nnwwwwnn      ', '    nwccccwn      ', '    nwcwwcwn      ', '     nnnnnn       ', '       ss         ', '    nnnnnnyy      ', '   nnbbbbnnyy     ', '  nnbbbbbnnyy     ', ' nnbbbbbbnnyy     ', ' nnbbbbbbnnyy     ', '  ssbbbbbnny      ', '    bbbbbnn       ', '    nnnnnn        ', '    nn  nn        ', '    nb  nb        ', '    nb  nb        ', '    nb  nb        ', '    nn  nn        ', '   ccc  ccc       ', '  cccc  cccc      ', '  cccc  cccc      '];
const DIVER_COLORS = {
  n: '#10253b',
  b: '#21435c',
  w: '#e3f7e7',
  c: '#71e4dc',
  y: '#f5cc68',
  s: '#edbd94'
};
const FISH = ['       ff      ', '    sssffss    ', 't  sbbbbbbsw   ', 'ttsbllllbbbwk  ', 'ttsbllbbbbbbss ', 't  sbbbbbbs    ', '    sssffss    ', '       ff      '];
const ANGLER = ['         ll    ', '        l  g   ', '        l      ', '    sssssss    ', '   sbllllbbs   ', 't sbbbbbbbwks  ', 'ttsbblbbbbssss ', 'ttsbblbbbsm m  ', 't sbbbbbbsmmm  ', '   sbbbbbsm m  ', '    sssssss    ', '       ff      '];
const RAY = ['      ss      ', '     slls     ', '    sbbbbs    ', '  ssbwbwbbss  ', ' sbbbbbbbbbbs ', 'sbbbbbllbbbbbs', ' ssbbbllbbbss ', '   ssbbbbss   ', '     ssss     ', '      ss      ', '      s       ', '      s       ', '      s       '];
const FISH_COLORS = {
  shoal: {
    s: '#705d38',
    b: '#e4b955',
    l: '#f8df87',
    f: '#e3a34a',
    t: '#dfa048',
    w: '#fff2c6',
    k: '#23364a'
  },
  striped: {
    s: '#79484b',
    b: '#ed9a73',
    l: '#ffce97',
    f: '#c96660',
    t: '#d47762',
    w: '#fff1d3',
    k: '#26364f'
  },
  silver: {
    s: '#32536e',
    b: '#80aabf',
    l: '#c0d8d7',
    f: '#4d7d99',
    t: '#5d8ba2',
    w: '#e4ece3',
    k: '#122942'
  },
  ray: {
    s: '#304d65',
    b: '#6d97ab',
    l: '#b1c8cd',
    w: '#10283d'
  },
  angler: {
    s: '#0a192e',
    b: '#3d5875',
    l: '#6c8ba1',
    f: '#345672',
    t: '#28435f',
    w: '#b4ded3',
    k: '#0a192e',
    m: '#d8d9b7',
    g: '#b5ffe0'
  },
  glowfish: {
    s: '#19334c',
    b: '#43728b',
    l: '#91dbcf',
    f: '#345e78',
    t: '#345e78',
    w: '#b9fae4',
    k: '#0a192e'
  }
};
const mod = (value, otherValue) => (value % otherValue + otherValue) % otherValue;
function diverPixelY(state, height) {
  return Math.round(height * 0.47 + Math.min(height * 0.19, state.depth * 3));
}
// Let the diver sink initially, then follow it through the same continuous world.
function diveCamera(state, height) {
  const diverY = diverPixelY(state, height);
  const startY = diverPixelY({
    depth: 0
  }, height);
  const offset = Math.max(0, state.depth * WORLD_PIXELS_PER_METER - (diverY - startY));
  return {
    diverY,
    offset,
    surfaceY: 9 - offset
  };
}
function depthAxis(state, cssHeight) {
  const height = Math.max(1, Math.round(cssHeight / 2));
  const value = cssHeight * 0.25;
  const span = cssHeight * 0.6;
  const reference = (diverPixelY(state, height) + 7) * cssHeight / height;
  const marker = (reference - value) / span * 100;
  const limit = axisMaximum(state);
  const ticks = [];
  for (let meters = 0; meters <= limit; meters += 5) {
    const percent = (reference + (meters - state.depth) * WORLD_PIXELS_PER_METER * cssHeight / height - value) / span * 100;
    if (percent >= 0 && percent <= 100) ticks.push({
      meters,
      percent
    });
  }
  return {
    marker,
    ticks,
    reference
  };
}
function block(context, color, x, y, argument5, argument6) {
  context.fillStyle = color;
  context.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(argument5)), Math.max(1, Math.round(argument6)));
}
function sprite(value, rows, colors, x, y, scale = 2, flip = false) {
  const width = Math.max(...rows.map(item => item.length));
  rows.forEach((item, index) => [...item].forEach((color, index2) => {
    if (colors[color]) block(value, colors[color], x + (flip ? width - 1 - index2 : index2) * scale, y + index * scale, scale, scale);
  }));
}
const channels = WATER_STOPS.map(([meters, color]) => [meters, [1, 3, 5].map(item => parseInt(color.slice(item, item + 2), 16))]);
function waterColorAtDepth(depth) {
  const meters = Math.max(0, Math.min(channels.at(-1)[0], Number(depth) || 0));
  const index = Math.max(0, channels.findIndex(([limit]) => limit >= meters) - 1);
  const [from, a] = channels[index];
  const [to, b] = channels[index + 1];
  const blend = (meters - from) / (to - from);
  return `rgb(${a.map((value, index2) => Math.round(value + (b[index2] - value) * blend)).join(',')})`;
}
function seaLife(value, kind, x, y, index, motion) {
  const colors = FISH_COLORS[kind];
  const flip = index % 2 === 0;
  const value2 = Math.round(Math.sin(motion * 1.2 + index));
  if (kind === 'ray' || kind === 'angler') {
    sprite(value, kind === 'ray' ? RAY : ANGLER, colors, Math.round(x - 14), Math.round(y - 8 + value2), 2, flip);
    return;
  }
  for (let value3 = 0; value3 < (kind === 'shoal' ? 3 : 2); value3++) {
    const value4 = Math.round(x - 21 + value3 % 2 * 22);
    const value5 = Math.round(y + Math.floor(value3 / 2) * 15 + value2);
    sprite(value, FISH, colors, value4, value5, 2, flip);
    if (kind === 'striped') for (let stripe = 0; stripe < 2; stripe++) block(value, '#795665', value4 + 10 + stripe * 8, value5 + 6, 2, 6);
    if (kind === 'glowfish') for (let value6 = 0; value6 < 3; value6++) block(value, '#a4f8d7', value4 + 10 + value6 * 4, value5 + 10, 2, 2);
  }
}
function drawOcean(value, width, height, camera, motion) {
  const scroll = camera.offset;
  const origin = diverPixelY({
    depth: 0
  }, height) + 7; // Eight-pixel water bands and flat, limited-palette sprites, with no scenery props.
  for (let y = 0; y < height; y += 8) {
    const meters = (scroll + y - origin) / WORLD_PIXELS_PER_METER;
    block(value, waterColorAtDepth(meters), 0, y, width, 8);
  }
  if (camera.surfaceY > -5) for (let x = 0; x < width; x += 12) {
    const wave = Math.round(Math.sin(x * 0.07 + motion * 0.6));
    block(value, '#9ad5c950', x, camera.surfaceY + wave, 8, 1);
  }
  for (let value2 = 0; value2 < 24; value2++) {
    const x = mod(value2 * 73 + 17, width);
    const y = mod(value2 * 41 - scroll * 0.68, height + 24) - 12;
    block(value, '#b7e9df1c', x, y, 1, 1);
  }
  const minDepth = (scroll - origin - 35) / WORLD_PIXELS_PER_METER;
  const maxDepth = (scroll + height - origin + 35) / WORLD_PIXELS_PER_METER;
  for (const encounter of oceanEncounters(minDepth, maxDepth)) {
    const y = origin + encounter.depth * WORLD_PIXELS_PER_METER - scroll;
    if (y < -35 || y > height + 35) continue;
    const drift = Math.round(Math.sin(motion * 0.45 + encounter.index) * 9);
    const x = width * (encounter.side ? 0.76 : 0.26) + drift;
    seaLife(value, encounter.kind, x, y, encounter.index, motion);
  }
}
function drawPixelDive(canvas, {
  state,
  time = 0,
  reducedMotion = false
}) {
  const width = Math.max(1, Math.round(canvas.clientWidth / 2));
  const height = Math.max(1, Math.round(canvas.clientHeight / 2));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.imageSmoothingEnabled = false;
  const depth = state.depth;
  const active = state.phase === 'playing';
  const motion = reducedMotion ? 0 : time;
  const camera = diveCamera(state, height);
  drawOcean(context, width, height, camera, motion);
  const diverX = Math.round(width * 0.51 - 17);
  const diverY = diverPixelY(state, height);
  sprite(context, BODY, DIVER_COLORS, diverX, diverY, 2);
  if (active && !reducedMotion) {
    const finKick = Math.round(Math.sin(motion * 7) * 2);
    block(context, '#71e4dc', diverX + 5, diverY + 43, 6 + finKick, 3);
    block(context, '#71e4dc', diverX + 18, diverY + 43, 8 - finKick, 3);
  }
  for (let value = 0; value < (active ? 8 : 3); value++) {
    const value2 = mod(motion * 0.75 + value * 0.28, 2.3);
    const x = diverX + 27 + Math.round(Math.sin(value * 2 + motion) * 3);
    const y = diverY + 9 - value2 * 24;
    if (y < 16) continue;
    const size = value % 3 === 0 ? 3 : 2;
    context.strokeStyle = '#b9eee1';
    context.lineWidth = 1;
    context.strokeRect(x, y, size, size);
    block(context, '#e3f7e7', x, y, 1, 1);
  }
  canvas.dataset.diverY = String(diverY * 2);
  canvas.dataset.pixelWidth = String(width);
  canvas.dataset.pixelHeight = String(height);
  canvas.dataset.worldOffsetY = String(Math.round(camera.offset * canvas.clientHeight / height));
  canvas.dataset.surfaceY = String(Math.round(camera.surfaceY * canvas.clientHeight / height));
  canvas.dataset.oceanZone = oceanZone(depth);
  canvas.dataset.art = 'chunky-pixel';
  canvas.dataset.waterColor = waterColorAtDepth(depth);
  const origin = diverPixelY({
    depth: 0
  }, height) + 7;
  canvas.dataset.seaLife = oceanEncounters((camera.offset - origin) / WORLD_PIXELS_PER_METER, (camera.offset + height - origin) / WORLD_PIXELS_PER_METER).map(item => item.kind).join(',');
}
const CSS = `
.pixel-dive{position:relative;width:100%;height:100%;overflow:hidden;color:#edfff7;background:#123f69;font-family:Arial,Helvetica,sans-serif;touch-action:none;outline:none;--u:min(.2564102564vw,.1672240803vh)}
.pixel-dive *{box-sizing:border-box}.pixel-dive button{font:700 calc(18 * var(--u))/1.3 Arial,Helvetica,sans-serif;cursor:pointer}
.pixel-dive-canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;pointer-events:none}
.pixel-dive-hud{position:absolute;top:calc(30 * var(--u));left:calc(30 * var(--u));right:calc(30 * var(--u));display:flex;justify-content:space-between;gap:16px;pointer-events:none;font-variant-numeric:tabular-nums;text-shadow:2px 2px 0 #102c50}
.pixel-dive-stat{display:flex;gap:3px;align-items:baseline;font-weight:700;font-size:calc(28 * var(--u));line-height:1.2}.pixel-dive-stat small{font-size:calc(15 * var(--u));font-weight:500;opacity:.85}.pixel-dive-stat-label{display:block;font-size:calc(12 * var(--u));line-height:1.5;letter-spacing:.08em;text-transform:uppercase;opacity:.8}
.pixel-dive .dive-guide{position:absolute;top:36%;left:50%;width:max-content;max-width:calc(100% - 60px);margin:0;transform:translate(-50%,-50%);text-align:center;color:#f4fff9;font-size:calc(18 * var(--u));font-weight:600;line-height:1.45;text-shadow:2px 2px 0 #164862;pointer-events:none;z-index:3}
.pixel-dive .dive-guide span{display:block;font-weight:400;font-size:calc(14 * var(--u));opacity:.83}
.pixel-depth-axis{position:absolute;left:calc(32 * var(--u));top:25%;bottom:15%;width:calc(48 * var(--u));border-left:2px solid #b8e8db70;pointer-events:none}.pixel-depth-tick{position:absolute;left:0;display:flex;align-items:center;gap:5px;transform:translateY(-50%);font-size:calc(12 * var(--u));line-height:1;color:#c6e8df;font-variant-numeric:tabular-nums}.pixel-depth-tick:before{content:'';width:7px;border-top:2px solid #b8e8db70}.pixel-depth-tick span{white-space:nowrap}.pixel-depth-marker{position:absolute;left:-5px;width:8px;height:8px;background:#f8da7f;transform:translateY(-50%);box-shadow:0 0 0 2px #143c59;transition:top .08s linear}
.pixel-depth-tick span{font-weight:600;text-shadow:-1px 0 #0a2541,1px 0 #0a2541,0 -1px #0a2541,0 1px #0a2541,0 2px 3px #071b31}
.pixel-dive-release{position:absolute;bottom:calc(82 * var(--u));left:0;right:0;margin:0;text-align:center;font-size:calc(16 * var(--u));color:#e1f6e7;pointer-events:none;text-shadow:1px 2px #102c50}
.pixel-dive-oxygen{position:absolute;left:calc(30 * var(--u));right:calc(30 * var(--u));bottom:calc(50 * var(--u));height:8px;background:#0e2949;border:2px solid #b9e7d640;pointer-events:none}.pixel-dive-oxygen>div{height:100%;background:#89e8d1}
.pixel-dive-result{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#071b3199,#07162bd6);z-index:10}.pixel-dive-result-inner{width:calc(100% - 60 * var(--u));max-width:340px;text-align:center;transform:translateY(-5%)}
.pixel-dive-result h2{font-size:calc(24 * var(--u));margin:0 0 calc(24 * var(--u));line-height:1.25;color:#f7e0a2}.pixel-dive-result-stats{display:flex;justify-content:center;gap:calc(30 * var(--u));margin-bottom:calc(24 * var(--u));font-variant-numeric:tabular-nums}.pixel-dive-result-stats strong{display:block;font-size:calc(28 * var(--u));line-height:1.2}.pixel-dive-result-stats span{display:block;margin-bottom:8px;font-size:calc(14 * var(--u));opacity:.8}.pixel-dive-result button{display:block;min-height:44px;min-width:148px;max-width:100%;width:auto;padding:10px 24px;border:0;border-radius:6px;background:#f1d591;color:#14384b;box-shadow:0 3px 0 #9d875a;margin:12px auto 0}.pixel-dive-result button+button{background:transparent;color:#eafbf1;box-shadow:none;border:1px solid #eafbf180}
.pixel-dive button:focus-visible{outline:3px solid #fff;outline-offset:4px}.pixel-dive button:active{transform:translateY(2px)}
@media(prefers-reduced-motion:reduce){.pixel-depth-marker{transition:none}}
`;
const isFeed = () => new URLSearchParams(location.search).get('feedReview') === '1';
function PixelDive() {
  const [config, setConfig] = React.useState(null);
  const [state, setState] = React.useState(() => makeDive());
  const [reduced, setReduced] = React.useState(() => matchMedia('(prefers-reduced-motion:reduce)').matches);
  const [viewHeight, setViewHeight] = React.useState(() => innerHeight);
  const stateRef = React.useRef(state);
  const canvasRef = React.useRef(null);
  const ownerRef = React.useRef(null);
  const frameRef = React.useRef(null);
  const lastRef = React.useRef(0);
  const synthRef = React.useRef(null);
  const audioPending = React.useRef(false);
  const aliveRef = React.useRef(true);
  const activeRef = React.useRef(!isFeed());
  const {
    canSubmit,
    submitting,
    submitRecording
  } = useRecordingSubmission();
  const commit = React.useCallback(next => {
    stateRef.current = next;
    setState(next);
  }, []);
  const releaseAudio = React.useCallback(() => {
    try {
      synthRef.current?.triggerRelease();
    } catch {}
  }, []);
  const finish = React.useCallback((reason = 'release') => {
    ownerRef.current = null;
    commit(finishDive(stateRef.current, reason));
    releaseAudio();
  }, [commit, releaseAudio]);
  React.useEffect(() => {
    let current = true;
    (async () => {
      let options = {};
      try {
        const response = await fetch('./game.config.json', {
          cache: 'no-store'
        });
        if (response.ok) options = await response.json();
      } catch {}
      if (current) {
        const flat = readConfigValues(options);
        setConfig(flat);
        commit(makeDive(flat.MAX_OXYGEN || 45000));
      }
    })();
    return () => {
      current = false;
    };
  }, [commit]);
  React.useEffect(() => {
    const resize = () => setViewHeight(canvasRef.current?.clientHeight || innerHeight);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (canvasRef.current) observer?.observe(canvasRef.current);
    window.addEventListener('resize', resize);
    resize();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);
  React.useEffect(() => {
    aliveRef.current = true;
    const media = matchMedia('(prefers-reduced-motion:reduce)');
    const motion = () => setReduced(media.matches);
    const hide = () => {
      if (document.hidden) finish('interrupted');
    };
    const host = event => {
      if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
      activeRef.current = event.data.active === true;
      if (!activeRef.current) finish('interrupted');
    };
    media.addEventListener?.('change', motion);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('message', host);
    return () => {
      aliveRef.current = false;
      media.removeEventListener?.('change', motion);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('message', host);
      releaseAudio();
      try {
        synthRef.current?.dispose();
      } catch {}
    };
  }, [finish, releaseAudio]);
  React.useEffect(() => {
    let animation;
    const draw = value => {
      const previous = lastRef.current;
      lastRef.current = value;
      if (!document.hidden) {
        if (stateRef.current.phase === 'playing') {
          const next = advanceDive(stateRef.current, previous ? value - previous : 0);
          commit(next);
          if (next.phase === 'over') {
            ownerRef.current = null;
            releaseAudio();
          }
        }
        if (canvasRef.current) drawPixelDive(canvasRef.current, {
          state: stateRef.current,
          time: value / 1000,
          reducedMotion: reduced
        });
      }
      animation = requestAnimationFrame(draw);
      frameRef.current = animation;
    };
    animation = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animation);
      frameRef.current = null;
    };
  }, [commit, releaseAudio, reduced]);
  const sound = async () => {
    if (audioPending.current) return;
    if (synthRef.current) {
      try {
        synthRef.current.triggerAttack('C2');
      } catch {}
      return;
    }
    audioPending.current = true;
    try {
      await Tone.start();
      if (!aliveRef.current || stateRef.current.phase !== 'playing' || !activeRef.current) return;
      const synth = new Tone.FMSynth({
        modulationIndex: 2,
        oscillator: {
          type: 'sine'
        },
        modulation: {
          type: 'square'
        },
        envelope: {
          attack: 0.5,
          decay: 0,
          sustain: 1,
          release: 2
        }
      }).toDestination();
      synth.volume.value = -15;
      synthRef.current = synth;
      synth.triggerAttack('C2');
    } catch (error) {
      console.warn('Dive audio unavailable', error);
    } finally {
      audioPending.current = false;
    }
  };
  const begin = owner => {
    if (!config || stateRef.current.phase !== 'idle' || document.hidden || !activeRef.current) return false;
    ownerRef.current = owner;
    lastRef.current = performance.now();
    commit(startDive(stateRef.current));
    sound();
    return true;
  };
  const pointerDown = event => {
    if (event.isPrimary === false || event.button !== 0) return;
    if (begin(event.pointerId)) {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  };
  const pointerUp = event => {
    if (ownerRef.current !== event.pointerId) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    finish(event.type === 'pointercancel' ? 'interrupted' : 'release');
  };
  const keyDown = event => {
    if (![' ', 'Enter'].includes(event.key) || event.repeat || event.target.tagName === 'BUTTON') return;
    event.preventDefault();
    begin('keyboard');
  };
  const keyUp = event => {
    if ([' ', 'Enter'].includes(event.key) && ownerRef.current === 'keyboard') {
      event.preventDefault();
      finish();
    }
  };
  const reset = () => {
    ownerRef.current = null;
    releaseAudio();
    commit(resetDive(stateRef.current));
    lastRef.current = performance.now();
  };
  const playing = state.phase === 'playing';
  const over = state.phase === 'over';
  const axis = depthAxis(state, viewHeight);
  const oxygen = state.remaining / state.max;
  return <div className="dive-game pixel-dive" data-revision="pixel-dive36-20261021" data-phase={state.phase} data-elapsed-ms={Math.round(state.elapsed)} data-depth-m={formatDepth(state.depth)} data-oxygen-ms={Math.round(state.remaining)} role="application" aria-label="Immersione. Tieni premuto per scendere e rilascia per finire." tabIndex={0} onPointerDown={pointerDown} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={event => {
    if (ownerRef.current === event.pointerId) finish('interrupted');
  }} onKeyDown={keyDown} onKeyUp={keyUp} onBlur={() => {
    if (ownerRef.current === 'keyboard') finish('interrupted');
  }}>
    <style>{CSS}</style>
    <canvas className="pixel-dive-canvas" ref={canvasRef} aria-label="Un sub in pixel art scende nell’oceano" />
    <div className="pixel-dive-hud" style={{
      visibility: state.phase === 'idle' ? 'hidden' : 'visible'
    }}>
      <div><span className="pixel-dive-stat-label">Tempo</span><div className="pixel-dive-stat">{formatTime(state.elapsed)}<small>s</small></div></div>
      <div><span className="pixel-dive-stat-label">Profondità</span><div className="pixel-dive-stat">{formatDepth(state.depth)}<small>m</small></div></div>
    </div>
    <div className="pixel-depth-axis" aria-hidden="true">
      {axis.ticks.map(tick => <div className="pixel-depth-tick" key={tick.meters} style={{
        top: `${tick.percent}%`
      }}><span>{tick.meters}m</span></div>)}
      <div className="pixel-depth-marker" style={{
        top: `${axis.marker}%`
      }} />
    </div>
    {state.phase === 'idle' && <p className="dive-guide feed-first-action">Tieni premuto per immergerti<span>Rilascia per risalire</span></p>}
    {playing && <p className="pixel-dive-release">Rilascia per risalire</p>}
    <div className="pixel-dive-oxygen" role="progressbar" aria-label="Ossigeno rimasto nel gioco" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.ceil(oxygen * 100)} style={{
      visibility: playing ? 'visible' : 'hidden'
    }}><div style={{
        width: `${oxygen * 100}%`,
        background: oxygen < 0.2 ? '#f2b78f' : '#89e8d1'
      }} /></div>
    {over && <div className="pixel-dive-result" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
      <div className="pixel-dive-result-inner" role="status">
        <h2>Immersione conclusa</h2>
        <div className="pixel-dive-result-stats"><div><span>Durata</span><strong>{formatTime(state.elapsed)}s</strong></div><div><span>Profondità</span><strong>{formatDepth(state.depth)}m</strong></div></div>
        <button onClick={reset}>{config?.BTN_REPLAY || "Riprova"}</button>
        {canSubmit && <button onClick={submitRecording} disabled={submitting}>Condividi</button>}
      </div>
    </div>}
  </div>;
}
const App = PixelDive;
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": ".pixel-dive-canvas",
        "data-game": ""
      }[name] ?? null;
    },
    dataset: {
      game: ""
    }
  };
  const selector = script?.getAttribute('data-subject') || '#root canvas';
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let observer;
  let animation;
  let entered = false;
  function stop() {
    animation?.cancel();
    animation = null;
  }
  function enter() {
    if (entered || document.hidden) return;
    const subject = document.querySelector(selector);
    if (!subject || subject.closest('[hidden], [aria-hidden="true"]')) return;
    const computed = window.getComputedStyle(subject);
    if (computed.display === 'none' || computed.visibility === 'hidden') return;
    if (subject.tagName === 'IMG' && !subject.complete) {
      subject.addEventListener('load', enter, {
        once: true
      });
      return;
    }
    entered = true;
    observer?.disconnect();
    if (media?.matches) return;
    const opacity = Number(window.getComputedStyle(subject).opacity) || 1;
    if (typeof subject.animate === 'function') {
      animation = subject.animate([{
        opacity: opacity * 0.76
      }, {
        opacity
      }], {
        duration: 650,
        easing: 'ease-out'
      });
      animation.onfinish = () => {
        animation = null;
      };
    }
  }
  observer = new MutationObserver(enter);
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  enter();
  document.addEventListener('visibilitychange', () => {
    document.documentElement.toggleAttribute('data-feed-background', document.hidden);
    if (document.hidden) stop();else enter();
  });
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    stop();
  });
  window.addEventListener('pageshow', () => {
    if (!entered) observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    enter();
  });
  document.addEventListener('pointerdown', stop, {
    capture: true,
    passive: true
  });
  media?.addEventListener?.('change', () => {
    if (media.matches) stop();
  });
})();

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = ["p.dive-guide"];
  const copy = new Set(["Tieni premuto per immergerti", "Fai un bel respiro"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
