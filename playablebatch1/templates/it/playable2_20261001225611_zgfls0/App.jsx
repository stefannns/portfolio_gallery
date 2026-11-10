// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import Matter from 'matter-js';
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
  "tweaks": [{
    "id": "GRAVITY_Y",
    "kind": "number",
    "label": "Gravity",
    "value": 1.2,
    "default": 1.2,
    "min": 0.1,
    "max": 2.5,
    "step": 0.1
  }, {
    "id": "BRUSH_SIZE",
    "kind": "number",
    "label": "Brush Size (Particles)",
    "value": 2,
    "default": 2,
    "min": 1,
    "max": 5,
    "step": 1
  }, {
    "id": "MAX_PARTICLES",
    "kind": "number",
    "label": "Max Particles Limit",
    "value": 2000,
    "default": 2000,
    "min": 200,
    "max": 3000,
    "step": 100
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "Laboratorio di pixel",
    "default": "Laboratorio di pixel",
    "max_length": 20
  }, {
    "id": "BTN_CLEAR",
    "label": "Clear Button Text",
    "value": "Cancella",
    "default": "Cancella",
    "max_length": 15
  }],
  "images": [],
  "config_version": "2.0",
  "playable": {
    "post_id": "99278216761911513",
    "version_id": "99278216761859467",
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
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* Game-owned FYP adjustments. Host gradients, button and frame are not changed. */
.meeting-guide{position:absolute;z-index:18;top:18%;left:30px;right:30px;margin:0;text-align:center;font:500 18px/1.4 var(--font-body,system-ui,sans-serif);pointer-events:none;color:var(--meeting-ink,#263544)}
.meeting-guide[hidden]{display:none}
html[data-meeting-fyp="preview"] .meeting-guide{animation:meeting-guide-breathe 2.8s ease-in-out infinite}
@keyframes meeting-guide-breathe{0%,100%{opacity:1}50%{opacity:.72}}
.meeting-demo{position:absolute;pointer-events:none;z-index:8;inset:0;overflow:hidden}
.meeting-demo[hidden]{display:none}
html[data-meeting-fyp="playing"] .meeting-demo,html[data-meeting-fyp="direct"] .meeting-demo{display:none}
html[data-meeting-game="14"] .melody-realistic{--ink:#fff4df;--panel:#263541;--accent:#e5bc79}
html[data-meeting-game="14"][data-meeting-fyp="preview"] .melody-controls,html[data-meeting-game="14"][data-meeting-fyp="preview"] .melody-status{visibility:hidden;pointer-events:none}
html[data-meeting-game="14"][data-meeting-fyp="preview"] .melody-guide{top:18%;font-size:18px;line-height:1.4}
html[data-meeting-game="14"] .melody-guide span{background:rgba(30,43,54,.9)}
html[data-meeting-game="15"]{--bg-dark:#edf5f3!important;--surface:transparent!important;--primary:#d66e4d!important;--text-main:#234c4a!important;--text-dim:#355e5a!important}
html[data-meeting-game="15"] #root>div{padding:0!important;background:#edf5f3!important}
html[data-meeting-game="15"] .meeting-orbital-heading{display:none!important}
html[data-meeting-game="15"] .meeting-orbital-board{border-radius:0!important;box-shadow:none!important;background:transparent!important}
html[data-meeting-game="15"] .meeting-orbital-board>div:has(>p){top:18%!important;left:30px!important;right:30px!important}
html[data-meeting-game="16"] .meeting-sand-reset-wrap{left:auto!important;right:30px!important;top:auto!important;bottom:50px!important}
html[data-meeting-game="16"][data-meeting-fyp="preview"] .meeting-sand-reset-wrap{visibility:hidden;pointer-events:none}
html[data-meeting-game="16"] .meeting-sand-reset{width:44px;height:44px;min-height:44px!important;padding:10px!important;border:1.5px solid #713f32!important;border-radius:50%!important;background:transparent!important;box-shadow:none!important;color:#713f32!important;display:grid;place-items:center}
html[data-meeting-game="16"] .meeting-sand-reset svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
html[data-meeting-game="16"] .meeting-sand-hud,html[data-meeting-game="16"] .meeting-sand-hud>div{font-family:var(--font-display)!important;font-size:28px!important;line-height:1.25!important;white-space:nowrap}
html[data-meeting-game="16"] .meeting-sand-ball-count{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
html[data-meeting-game="16"] .meeting-sand-ball-count>small{font-size:12px;line-height:1.2;font-family:inherit}
html[data-meeting-game="17"]{--bg-dark:#eaf3fa!important;--neon-cyan:#167e9b!important;--neon-magenta:#9c4b8d!important}
html[data-meeting-game="17"] .synth-grid{opacity:.25}
html[data-meeting-game="17"] .feed-first-action{color:#334c65!important;top:18%!important;font-size:18px!important;line-height:1.4!important}
html[data-meeting-game="17"] .meeting-synth-result{background:rgba(234,243,250,.97)!important}
html[data-meeting-game="17"] .meeting-synth-result>div{color:#334c65!important}
html[data-meeting-game="17"] .meeting-synth-result h2{text-shadow:none!important}
html[data-meeting-game="17"][data-meeting-fyp="preview"] canvas{--synth-safe-bottom:140px}
html[data-meeting-game="17"][data-meeting-fyp="preview"] .synth-score{visibility:hidden}
html[data-meeting-game="19"] .meeting-cube-heading>div>p{position:absolute;top:108px;left:30px;right:30px;text-align:center!important;margin:0!important;font-size:18px!important;line-height:1.4!important;z-index:12}
html[data-meeting-game="19"] button[aria-label="Ricomincia con i cubi"]{width:44px!important;height:44px!important;background:transparent!important;box-shadow:none!important;border:1.5px solid #65708c!important;color:#65708c}
html[data-meeting-game="19"] button[aria-label="Ricomincia con i cubi"] svg{stroke:currentColor!important;stroke-width:1.8}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .peeler-hud{visibility:hidden}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-board img[alt="peeled potato"],html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-board canvas{width:82%!important;max-height:100%;object-fit:contain}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-board canvas{transform:translateY(-20px)}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-board img[alt="peeled potato"]{transform:translateY(-20px) scale(.9)!important}
html[data-meeting-game="32"][data-meeting-fyp="preview"] #peeler-sprite{margin-top:44px}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-guide{position:absolute!important;top:18%!important;left:30px;right:30px;bottom:auto!important;min-height:0!important;padding:0!important;pointer-events:none}
html[data-meeting-game="32"] .meeting-peeler-guide p{font:500 18px/1.4 var(--font-body)!important}
html[data-meeting-game="35"] .meeting-guide{background:#fffffff2;box-shadow:0 2px 10px #0000000a;padding:9px 10px;border-radius:8px;left:30px;right:30px;--meeting-ink:#26262a}
html[data-meeting-game="40"] .meeting-guide{--meeting-ink:#f5e8d3}
html[data-meeting-game="40"] .meeting-pixel-clear{bottom:30px!important}
html[data-meeting-game="40"] .meeting-pixel-clear button{padding:10px 20px!important;min-height:44px!important;box-shadow:none!important;font-family:var(--font-body)!important;font-size:18px!important}
html[data-meeting-game="40"][data-meeting-fyp="preview"] :is(.meeting-pixel-palette,.meeting-pixel-label,.meeting-pixel-clear){visibility:hidden;opacity:0!important;pointer-events:none}
html[data-meeting-game="41"] .meeting-chat-shell{padding-top:12px!important;padding-bottom:20px!important}
html[data-meeting-game="41"] header{min-height:56px!important;padding-top:4px!important;padding-bottom:4px!important}
html[data-meeting-game="41"] header>div{gap:2px!important}
html[data-meeting-game="41"] header>div>div:first-child{width:32px!important;height:32px!important}
html[data-meeting-game="41"] main{min-height:150px!important}
html[data-meeting-game="41"] section .ios-scroll{max-height:96px!important;overflow-y:auto!important}
html[data-meeting-game="41"] section{padding-top:6px!important;padding-bottom:6px!important}
html[data-meeting-game="41"] section:has(.ios-scroll)>div:first-child{height:32px!important;margin-bottom:6px!important;border-radius:16px!important;font-size:14px!important}
html[data-meeting-game="41"] section:has(.ios-scroll)>div:first-child>span[aria-hidden="true"]{width:24px!important;height:24px!important;font-size:17px!important}
html[data-meeting-game="41"][data-meeting-fyp="preview"] .meeting-chat-shell{padding-top:48px!important;padding-bottom:128px!important}
html[data-meeting-game="45"][data-meeting-fyp="preview"] .top{visibility:hidden}
html[data-meeting-game="45"] .hint{top:18%!important;bottom:auto!important;font-size:18px!important;line-height:1.4!important;font-weight:500!important}
.meeting-carve-cursor{position:absolute;left:50%;top:44%;width:18px;height:18px;border:2px solid #fff8cd;border-radius:50%;box-shadow:0 0 0 6px #f5cd6544;animation:meeting-carve 3.4s ease-in-out infinite}
@keyframes meeting-carve{0%,100%{transform:translate(-66px,40px);opacity:0}12%{opacity:1}35%{transform:translate(0,-54px);opacity:1}58%{transform:translate(66px,40px);opacity:1}78%{transform:translate(-45px,-18px);opacity:.7}90%{transform:translate(45px,-18px);opacity:0}}
html[data-meeting-inactive] .meeting-demo *,html[data-meeting-inactive] .meeting-guide{animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){.meeting-demo *,.meeting-guide{animation:none!important}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.meeting-guide{position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.meeting-guide{background:rgba(15,19,27,.88);color:#fff7e9!important;padding:6px 12px;border-radius:999px}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(p.meeting-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(p.meeting-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(p.meeting-guide){animation:none!important}}

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
function createSandboxAsmr(canvas, getMaterial, isDrawing, environment = globalThis) {
  const value2 = environment.window || environment;
  const document = environment.document;
  const profiles = {
    sand: {
      low: 3800,
      high: 450,
      level: 0.13,
      grain: 0.07,
      space: 75
    },
    water: {
      low: 1300,
      high: 100,
      level: 0.09,
      grain: 0.05,
      space: 155
    },
    stone: {
      low: 2400,
      high: 300,
      level: 0.018,
      grain: 0.13,
      space: 115
    },
    wood: {
      low: 1900,
      high: 240,
      level: 0.028,
      grain: 0.1,
      space: 125
    },
    smoke: {
      low: 1700,
      high: 130,
      level: 0.055,
      grain: 0.025,
      space: 180
    },
    fire: {
      low: 2800,
      high: 260,
      level: 0.075,
      grain: 0.065,
      space: 95
    },
    lava: {
      low: 1100,
      high: 70,
      level: 0.08,
      grain: 0.07,
      space: 165
    }
  };
  let value3 = null;
  let value4 = null;
  let filter = null;
  let high = null;
  let gain = null;
  let master = null;
  let value5 = null;
  let buffer = null;
  let pressed = false;
  let disposed = false;
  let lastGrain = 0;
  let lastContact = -Infinity;
  let lastGesture = -Infinity;
  let lastProfile = '';
  let bursts = 0;
  let voices = new Set();
  const clock = () => environment.performance?.now?.() ?? Date.now();
  const allowed = () => !disposed && !document.hidden && document.documentElement.dataset.meetingFyp !== 'preview';
  const mark = value => {
    canvas.dataset.sandboxAudio = value;
  };
  mark('waiting-for-gesture');
  const cutGrains = () => {
    for (const source of voices) {
      try {
        source.stop();
      } catch {}
    }
    voices.clear();
  };
  function hush() {
    pressed = false;
    if (gain && value3) {
      gain.gain.cancelScheduledValues(value3.currentTime);
      gain.gain.setTargetAtTime(0, value3.currentTime, 0.035);
    }
    mark('silent');
  }
  function unlock(event) {
    if (event.isPrimary === false || event.button > 0 || !allowed()) return;
    pressed = true;
    lastGesture = clock();
    try {
      if (!value3) {
        const Audio = value2.AudioContext || value2.webkitAudioContext;
        if (!Audio) {
          mark('unavailable');
          return;
        }
        value3 = new Audio();
        buffer = value3.createBuffer(1, Math.round(value3.sampleRate * 2), value3.sampleRate);
        const samples = buffer.getChannelData(0);
        let pink = 0;
        for (let value = 0; value < samples.length; value++) {
          const white = Math.random() * 2 - 1;
          pink = 0.97 * pink + 0.03 * white;
          samples[value] = Math.max(-0.9, Math.min(0.9, (white * 0.17 + pink * 3.5) * 0.8));
        }
        master = value3.createGain();
        master.gain.value = 0.65;
        const limiter = value3.createDynamicsCompressor();
        limiter.threshold.value = -14;
        limiter.knee.value = 14;
        limiter.ratio.value = 5;
        limiter.attack.value = 0.005;
        limiter.release.value = 0.12;
        master.connect(limiter).connect(value3.destination);
        value5 = value3.createStereoPanner ? value3.createStereoPanner() : value3.createGain();
        value5.connect(master);
        value4 = value3.createBufferSource();
        value4.buffer = buffer;
        value4.loop = true;
        high = value3.createBiquadFilter();
        high.type = 'highpass';
        filter = value3.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 0.55;
        gain = value3.createGain();
        gain.gain.value = 0;
        value4.connect(high).connect(filter).connect(gain).connect(value5);
        value4.start();
      }
      Promise.resolve(value3.resume()).catch(() => {
        hush();
        mark('unavailable');
      });
      lastProfile = '';
      lastGrain = -Infinity;
    } catch {
      hush();
      mark('unavailable');
    }
  }
  function grain(profile, kind, amount = 1) {
    if (!value3 || voices.size >= 6) return;
    const source = value3.createBufferSource();
    const band = value3.createBiquadFilter();
    const envelope = value3.createGain();
    const currentTime = value3.currentTime;
    source.buffer = buffer;
    source.playbackRate.value = kind === 'stone' ? 0.7 : kind === 'wood' ? 0.85 : 1 + Math.random() * 0.2;
    band.type = 'bandpass';
    band.frequency.value = kind === 'stone' ? 650 : kind === 'wood' ? 420 : kind === 'water' ? 700 : 1200 + Math.random() * 1400;
    band.Q.value = 0.55;
    envelope.gain.setValueAtTime(0, currentTime);
    envelope.gain.linearRampToValueAtTime(profile.grain * amount, currentTime + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.11);
    source.connect(band).connect(envelope).connect(value5);
    voices.add(source);
    source.onended = () => {
      voices.delete(source);
      source.disconnect();
      band.disconnect();
      envelope.disconnect();
    };
    source.start(currentTime, Math.random() * 1.7, 0.13);
    source.stop(currentTime + 0.15);
    canvas.dataset.sandboxAudioBursts = String(++bursts);
  }
  function frame(value) {
    if (!pressed || !allowed() || !isDrawing()) {
      if (pressed) hush();
      return;
    }
    if (!value3 || value3.state !== 'running') return;
    lastGesture = clock();
    const kind = getMaterial();
    const profile = profiles[kind] || profiles.sand;
    if (kind !== lastProfile) {
      high.frequency.setTargetAtTime(profile.high, value3.currentTime, 0.06);
      filter.frequency.setTargetAtTime(profile.low, value3.currentTime, 0.06);
      gain.gain.setTargetAtTime(profile.level, value3.currentTime, 0.045);
      lastProfile = kind;
    }
    if (value - lastGrain >= profile.space) {
      lastGrain = value;
      grain(profile, kind);
    }
    mark('playing-' + kind);
  }
  const down = event => {
    const rect = canvas.getBoundingClientRect();
    if (value5?.pan && value3) value5.pan.setTargetAtTime(Math.max(-0.55, Math.min(0.55, (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5)), value3.currentTime, 0.06);
    unlock(event);
  };
  const move = event => {
    if (pressed && value5?.pan && value3) {
      const rect = canvas.getBoundingClientRect();
      value5.pan.setTargetAtTime(Math.max(-0.55, Math.min(0.55, (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5)), value3.currentTime, 0.06);
    }
  };
  const inactive = event => {
    if (event.source === value2.parent && event.origin === value2.location.origin && event.data?.type === 'playable-active' && !event.data.active) {
      hush();
      cutGrains();
    }
  };
  const hidden = () => {
    if (document.hidden) {
      hush();
      cutGrains();
      value3?.suspend().catch(() => {});
    }
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  for (const name of ['pointerup', 'pointercancel', 'blur']) value2.addEventListener(name, hush);
  value2.addEventListener('message', inactive);
  document.addEventListener('visibilitychange', hidden);
  return {
    frame,
    contact(pairs = []) {
      const value = clock();
      if (!value3 || value3.state !== 'running' || !allowed() || value - lastGesture > 1200 || value - lastContact < 80) return;
      const pair = pairs.find(pair => [pair.bodyA, pair.bodyB].some(body => profiles[body?.label] && !body.isStatic && (body.speed || 0) > 0.6));
      if (!pair) return;
      const body = [pair.bodyA, pair.bodyB].find(body => profiles[body?.label] && !body.isStatic);
      const kind = body.label;
      lastContact = value;
      grain(profiles[kind], kind, 0.28);
    },
    dispose() {
      if (disposed) return;
      hush();
      disposed = true;
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      for (const name of ['pointerup', 'pointercancel', 'blur']) value2.removeEventListener(name, hush);
      value2.removeEventListener('message', inactive);
      document.removeEventListener('visibilitychange', hidden);
      for (const source of voices) {
        try {
          source.stop();
        } catch {}
      }
      voices.clear();
      try {
        value4?.stop();
      } catch {}
      value3?.close().catch(() => {});
      mark('closed');
    }
  };
}
function meetingSandboxPreview(Matter, sand, config, dimensions, canvas) {
  let engine = null;
  let bodies = [];
  let frame = 0;
  let seed = 40;
  let wasActive = false;
  let visible = true;
  let size = '';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
  }) : null;
  observer?.observe(canvas);
  const random = () => {
    seed = 1664525 * seed + 1013904223 >>> 0;
    return seed / 4294967296;
  };
  function clear() {
    if (engine) Matter.Engine.clear(engine);
    engine = null;
    bodies = [];
    frame = 0;
    seed = 40;
  }
  function init() {
    engine = Matter.Engine.create();
    engine.positionIterations = 14;
    engine.velocityIterations = 10;
    engine.constraintIterations = 4;
    engine.gravity.y = config.GRAVITY_Y ?? 1;
    const {
      width,
      height
    } = dimensions();
    size = width + ':' + height;
    const floor = height - Math.min(140, height * 0.28);
    Matter.World.add(engine.world, [Matter.Bodies.rectangle(width / 2, floor + 25, width + 100, 50, {
      isStatic: true
    }), Matter.Bodies.rectangle(-25, height / 2, 50, 2 * height, {
      isStatic: true
    }), Matter.Bodies.rectangle(width + 25, height / 2, 50, 2 * height, {
      isStatic: true
    })]);
    for (let value = 0; value < 100; value++) step();
  }
  function step() {
    const {
      width,
      height
    } = dimensions();
    if (frame < 360) for (let value = 0; value < Math.min(config.BRUSH_SIZE ?? 1, 2); value++) {
      const radius = sand.radius * (0.4 * random() + 0.8);
      const x = width * (0.5 + 0.1 * Math.sin(frame / 70)) + 15 * (random() - 0.5);
      const y = height * 0.12 + 15 * (random() - 0.5);
      const bead = Matter.Bodies.circle(x, y, radius, {
        ...sand.opts,
        label: sand.id
      });
      bead.renderColor = sand.color;
      Matter.World.add(engine.world, bead);
      bodies.push(bead);
    }
    Matter.Engine.update(engine, 1000 / 120);
    Matter.Engine.update(engine, 1000 / 120);
    frame++;
  }
  return {
    frame(active) {
      if (!active) {
        if (wasActive) clear();
        wasActive = false;
        canvas.removeAttribute('data-sandbox-preview');
        return null;
      }
      const {
        width,
        height
      } = dimensions();
      if (!wasActive || size !== width + ':' + height) {
        clear();
        init();
        wasActive = true;
      }
      if (visible && !document.hidden) {
        if (!motion.matches) {
          if (frame > 540) {
            clear();
            init();
          }
          step();
        }
      }
      canvas.setAttribute('data-sandbox-preview', String(bodies.length));
      return bodies;
    },
    dispose() {
      observer?.disconnect();
      clear();
      canvas.removeAttribute('data-sandbox-preview');
    }
  };
}
var SANDBOX_MATERIALS = [{
  id: "sand",
  label: "Sabbia",
  color: "#F4A460",
  type: "circle",
  radius: 4,
  opts: {
    friction: 0.25,
    frictionStatic: 0.35,
    restitution: 0.05,
    density: 0.003,
    slop: 0.01,
    collisionFilter: {
      category: 1,
      mask: 4294967295
    }
  }
}, {
  id: "water",
  label: "Acqua",
  color: "#4169E1",
  type: "circle",
  radius: 4,
  opts: {
    friction: 0.02,
    frictionAir: 0.015,
    restitution: 0.08,
    density: 0.001,
    slop: 0.01,
    collisionFilter: {
      category: 1,
      mask: 4294967295
    }
  }
}, {
  id: "stone",
  label: "Pietra",
  color: "#808080",
  type: "rect",
  radius: 6,
  opts: {
    friction: 0.8,
    frictionStatic: 1,
    restitution: 0,
    density: 0.006,
    slop: 0.01,
    collisionFilter: {
      category: 1,
      mask: 4294967295
    }
  }
}, {
  id: "wood",
  label: "Legno",
  color: "#8B4513",
  type: "rect",
  radius: 5,
  opts: {
    friction: 0.6,
    frictionStatic: 0.8,
    restitution: 0.05,
    density: 0.0025,
    slop: 0.01,
    collisionFilter: {
      category: 1,
      mask: 4294967295
    }
  }
}, {
  id: "smoke",
  label: "Fumo",
  color: "#A9A9A9",
  type: "circle",
  radius: 5,
  opts: {
    frictionAir: 0.04,
    density: 0.001,
    collisionFilter: {
      group: -1
    }
  }
}, {
  id: "fire",
  label: "Fuoco",
  color: "#FF4500",
  type: "circle",
  radius: 4,
  opts: {
    frictionAir: 0.02,
    density: 0.005,
    collisionFilter: {
      group: -1
    }
  }
}, {
  id: "lava",
  label: "Lava",
  color: "#FF5A1F",
  type: "circle",
  radius: 4,
  opts: {
    friction: 0.08,
    frictionAir: 0.012,
    restitution: 0.04,
    density: 0.002,
    slop: 0.01,
    collisionFilter: {
      category: 1,
      mask: 4294967295
    }
  }
}];
function GameStyles() {
  return <style>{`
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background-color: #12121A; user-select: none; }
    * { box-sizing: border-box; touch-action: none; }
    @font-face {
      font-family: 'Poppins';
      src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Poppins';
      src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    :root {
      --font-display: "Poppins", "PingFang SC", system-ui, sans-serif;
      --font-body: "Poppins", "PingFang SC", system-ui, sans-serif;
      --font-mono: ui-monospace, Menlo, monospace;
      --color-bg: #12121A;
      --color-panel: #1A1A24;
      --color-text: #FFFFFF;
    }
    .hide-scrollbar::-webkit-scrollbar { display: none; }
    .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    .hide-scrollbar { display:grid!important; grid-template-columns:repeat(7,minmax(0,44px)); justify-content:center!important; gap:clamp(3px,1vw,8px)!important; padding-inline:15px!important; overflow:hidden!important; touch-action:manipulation!important; } .hide-scrollbar > button { width:100%!important; height:auto!important; min-width:0; aspect-ratio:1; touch-action:manipulation!important; }
  `}</style>;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [materialId, setMaterialId] = React.useState(SANDBOX_MATERIALS[0].id);
  let materialRef = React.useRef(materialId);
  let sceneRef = React.useRef(null);
  let canvasRef = React.useRef(null);
  let engineRef = React.useRef(null);
  let animationRef = React.useRef(null);
  let particleBodiesRef = React.useRef([]);
  let drawingRef = React.useRef(false);
  let pointerRef = React.useRef({
    x: -100,
    y: -100
  });
  materialRef.current = materialId;
  React.useEffect(() => {
    let enabled = true;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value = await requestGameConfig();
        if (value.ok) {
          options = await value.json();
        }
      } catch {}
      if (enabled) {
        setConfig(function (config2) {
          let options2 = {};
          (config2.tweaks || []).forEach(item => {
            options2[item.id] = item.value;
          });
          (config2.texts || []).forEach(item => {
            options2[item.id] = item.value;
          });
          (config2.images || []).forEach(item => {
            options2[item.id] = item.path;
          });
          (config2.mentions || []).forEach(item => {
            options2[item.id] = null != item.path && "" !== item.path ? item.path : item.value;
          });
          (config2.motions || []).forEach(item => {
            if (!(!item || !item.id)) {
              if (null != item.base_path && "" !== item.base_path) {
                options2[item.id] = item.base_path;
                options2[item.id + "_BASE"] = item.base_path;
              }
              if (null != item.frame_count) {
                options2[item.id + "_COUNT"] = item.frame_count;
              }
            }
          });
          return options2;
        }(options));
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  let clearSandbox = React.useCallback(() => {
    if (!engineRef.current) return;
    let current = engineRef.current;
    let current2 = particleBodiesRef.current;
    Matter.World.remove(current.world, current2);
    particleBodiesRef.current = [];
  }, []);
  React.useEffect(() => {
    if (!config || !canvasRef.current || !sceneRef.current) return;
    let current = sceneRef.current;
    let dimensions = canvasRef.current;
    let context = dimensions.getContext("2d", {
      alpha: false
    });
    let width = current.clientWidth;
    let height = current.clientHeight;
    let value = window.devicePixelRatio || 1;
    dimensions.width = width * value;
    dimensions.height = height * value;
    context.scale(value, value);
    let y = Matter.Engine.create();
    y.positionIterations = 14;
    y.velocityIterations = 10;
    y.constraintIterations = 4;
    y.gravity.y = config.GRAVITY_Y ?? 1;
    engineRef.current = y;
    let options = {
      isStatic: true,
      render: {
        fillStyle: "transparent"
      }
    };
    let value2 = Matter.Bodies.rectangle(width / 2, height + 25, width + 100, 50, options);
    let value3 = Matter.Bodies.rectangle(-25, height / 2, 50, 2 * height, options);
    let value4 = Matter.Bodies.rectangle(width + 25, height / 2, 50, 2 * height, options);
    Matter.World.add(y.world, [value2, value3, value4]);
    let handleAction = value6 => {
      let pairs = value6.pairs;
      let seenItems = new Set();
      let items = [];
      let items2 = [];
      for (let value7 = 0; value7 < pairs.length; value7++) {
        let bodyA = pairs[value7].bodyA;
        let bodyB = pairs[value7].bodyB;
        if (bodyA.isStatic || bodyB.isStatic) continue;
        let value8 = "lava" === bodyA.label || "fire" === bodyA.label ? bodyA : "lava" === bodyB.label || "fire" === bodyB.label ? bodyB : null;
        let value9 = value8 === bodyA ? bodyB : bodyA;
        if (value8 && "lava" === value8.label && "water" === value9.label) {
          seenItems.add(value8);
          seenItems.add(value9);
          items.push({
            x: (value8.position.x + value9.position.x) / 2,
            y: (value8.position.y + value9.position.y) / 2
          });
        } else {
          if (value8 && "fire" === value8.label && "water" === value9.label) {
            seenItems.add(value8);
          } else {
            if (value8 && "wood" === value9.label && !seenItems.has(value9)) {
              seenItems.add(value9);
              items2.push({
                x: value9.position.x,
                y: value9.position.y
              });
            }
          }
        }
      }
      if (seenItems.size > 0) {
        let value7 = Array.from(seenItems);
        Matter.World.remove(y.world, value7);
        particleBodiesRef.current = particleBodiesRef.current.filter(item => !seenItems.has(item));
        for (let point of items) {
          let value8 = Matter.Bodies.rectangle(point.x, point.y, 10, 10, {
            ...SANDBOX_MATERIALS.find(item => "stone" === item.id).opts,
            label: "stone"
          });
          value8.renderColor = "#808080";
          Matter.World.add(y.world, value8);
          particleBodiesRef.current.push(value8);
        }
        for (let point of items2) {
          let timestamp = performance.now();
          let value8 = Matter.Bodies.circle(point.x, point.y, 5, {
            frictionAir: 0.02,
            density: 0.005,
            label: "fire",
            collisionFilter: {
              group: -1
            }
          });
          value8.renderColor = "#FF4500";
          value8.spawnedAt = timestamp;
          value8.lifeMs = 2800 + 1200 * Math.random();
          value8.lastRiseY = point.y;
          value8.lastRiseAt = timestamp;
          Matter.World.add(y.world, value8);
          particleBodiesRef.current.push(value8);
          let value9 = Matter.Bodies.circle(point.x + 6 * (Math.random() - 0.5), point.y - 7, 4, {
            frictionAir: 0.04,
            density: 0.001,
            label: "smoke",
            collisionFilter: {
              group: -1
            }
          });
          value9.renderColor = "#A9A9A9";
          value9.spawnedAt = timestamp;
          value9.lifeMs = 5000 + 2000 * Math.random();
          Matter.World.add(y.world, value9);
          particleBodiesRef.current.push(value9);
        }
      }
    };
    Matter.Events.on(y, "collisionStart", handleAction);
    Matter.Events.on(y, "collisionActive", handleAction);
    let audioTexture = createSandboxAsmr(dimensions, () => materialRef.current, () => drawingRef.current);
    let preview = meetingSandboxPreview(Matter, SANDBOX_MATERIALS[0], config, () => ({
      width: width,
      height: height
    }), dimensions);
    let value5 = config.MAX_PARTICLES ?? 2000;
    let handleAction2 = () => {
      for (let value7 = 0; value7 < 2; value7++) {
        for (let value8 of particleBodiesRef.current) if ("smoke" === value8.label || "fire" === value8.label) {
          let value9 = "fire" === value8.label ? 0.0003 : 0.00024;
          Matter.Body.applyForce(value8, value8.position, {
            x: value8.mass * (Math.random() - 0.5) * 0.00006,
            y: -value8.mass * (y.gravity.y * y.gravity.scale + value9)
          });
        }
        Matter.Engine.update(y, 1000 / 120);
      }
      if (drawingRef.current) {
        let value7 = SANDBOX_MATERIALS.find(item => item.id === materialRef.current) || SANDBOX_MATERIALS[0];
        let value8 = config.BRUSH_SIZE ?? 1;
        for (let value9 = 0; value9 < value8 && !(particleBodiesRef.current.length >= value5 && "lava" !== value7.id && "water" !== value7.id || particleBodiesRef.current.length >= value5 + 120); value9++) {
          let value10;
          let value11 = pointerRef.current.x + 15 * (Math.random() - 0.5);
          let value12 = pointerRef.current.y + 15 * (Math.random() - 0.5);
          let value13 = value7.radius * (0.4 * Math.random() + 0.8);
          value10 = "rect" === value7.type ? Matter.Bodies.rectangle(value11, value12, 2 * value13, 2 * value13, {
            ...value7.opts,
            label: value7.id
          }) : Matter.Bodies.circle(value11, value12, value13, {
            ...value7.opts,
            label: value7.id
          });
          value10.renderColor = value7.color;
          if ("fire" === value7.id || "smoke" === value7.id) {
            value10.spawnedAt = performance.now();
            value10.lifeMs = "fire" === value7.id ? 2800 + 1200 * Math.random() : 5000 + 2000 * Math.random();
            value10.lastRiseY = value10.position.y;
            value10.lastRiseAt = value10.spawnedAt;
          }
          Matter.World.add(y.world, value10);
          particleBodiesRef.current.push(value10);
        }
      }
      for (let timestamp = performance.now(), value7 = particleBodiesRef.current.length - 1; value7 >= 0; value7--) {
        let item = particleBodiesRef.current[value7];
        let enabled = false;
        if ("fire" === item.label) {
          item.spawnedAt ??= timestamp;
          item.lifeMs ??= 2800 + 1200 * Math.random();
          item.lastRiseY ??= item.position.y;
          item.lastRiseAt ??= timestamp;
          if (item.position.y < item.lastRiseY - 1.5) {
            item.lastRiseY = item.position.y;
            item.lastRiseAt = timestamp;
          }
          let value8 = timestamp - item.lastRiseAt > 1100;
          enabled = timestamp - item.spawnedAt > item.lifeMs || value8;
        } else {
          if ("smoke" === item.label) {
            item.spawnedAt ??= timestamp;
            item.lifeMs ??= 5000 + 2000 * Math.random();
            enabled = timestamp - item.spawnedAt > item.lifeMs;
          }
        }
        if (enabled || item.position.y > height + 100 || item.position.y < -100) {
          Matter.World.remove(y.world, item);
          particleBodiesRef.current.splice(value7, 1);
        }
      }
      context.fillStyle = "#050507";
      context.fillRect(0, 0, width, height);
      context.lineWidth = 1;
      let value6 = preview.frame(document.documentElement.dataset.meetingFyp === "preview") ?? particleBodiesRef.current;
      for (let value7 = 0; value7 < value6.length; value7++) {
        let item = value6[value7];
        context.fillStyle = item.renderColor;
        context.beginPath();
        let vertices = item.vertices;
        context.moveTo(vertices[0].x, vertices[0].y);
        for (let value8 = 1; value8 < vertices.length; value8++) context.lineTo(vertices[value8].x, vertices[value8].y);
        context.lineTo(vertices[0].x, vertices[0].y);
        context.fill();
      }
      audioTexture.frame(performance.now());
      animationRef.current = requestAnimationFrame(handleAction2);
    };
    Matter.Events.on(y, "collisionStart", value6 => audioTexture.contact(value6.pairs));
    handleAction2();
    let resizeObserver = observeGameSize(value6 => {
      for (let value7 of value6) {
        width = value7.contentRect.width;
        height = value7.contentRect.height;
        dimensions.width = width * value;
        dimensions.height = height * value;
        context.scale(value, value);
        Matter.Body.setPosition(value2, {
          x: width / 2,
          y: height + 25
        });
        Matter.Body.setPosition(value4, {
          x: width + 25,
          y: height / 2
        });
      }
    });
    resizeObserver.observe(current);
    return () => {
      cancelAnimationFrame(animationRef.current);
      resizeObserver.disconnect();
      audioTexture.dispose();
      preview.dispose();
      Matter.Engine.clear(y);
    };
  }, [config]);
  let movePointer = event => {
    if (!canvasRef.current) return;
    let bounds = canvasRef.current.getBoundingClientRect();
    let clientX = event.clientX;
    let clientY = event.clientY;
    if (event.touches && event.touches.length > 0) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    }
    pointerRef.current = {
      x: clientX - bounds.left,
      y: clientY - bounds.top
    };
  };
  let stopDrawing = () => {
    drawingRef.current = false;
  };
  if (!config) return <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#12121A"
  }} />;
  let selectedMaterial = SANDBOX_MATERIALS.find(item => item.id === materialId);
  return <div style={{
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    position: "relative"
  }}>{<GameStyles />}{<div style={{
      flex: "0 0 auto",
      padding: "30px 30px 12px",
      display: "flex",
      gap: "8px",
      justifyContent: "flex-start",
      overflowX: "auto",
      touchAction: "pan-x",
      backgroundColor: "var(--color-panel)",
      borderBottomLeftRadius: "24px",
      borderBottomRightRadius: "24px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      zIndex: 10
    }} className={"hide-scrollbar"}>{SANDBOX_MATERIALS.map(item => {
        let value = materialId === item.id;
        return <button type={"button"} aria-label={item.label} aria-pressed={value} onClick={() => setMaterialId(item.id)} style={{
          padding: 0,
          flex: "0 0 auto",
          touchAction: "pan-x",
          width: "44px",
          height: "44px",
          borderRadius: "12px",
          backgroundColor: item.color,
          border: value ? "3px solid #FFF" : "3px solid transparent",
          transform: "none",
          transition: "all 0.2s",
          cursor: "pointer",
          boxShadow: value ? `0 0 16px ${item.color}80` : "none"
        }} key={item.id} />;
      })}</div>}{<div style={{
      position: "absolute",
      top: "98px",
      left: "50%",
      transform: "translateX(-50%)",
      backgroundColor: "rgba(0,0,0,0.6)",
      padding: "6px 16px",
      borderRadius: "20px",
      color: "#FFF",
      fontFamily: "var(--font-display)",
      fontSize: "14px",
      fontWeight: "700",
      zIndex: 10,
      pointerEvents: "none",
      backdropFilter: "blur(4px)"
    }}>{(null == selectedMaterial ? void 0 : selectedMaterial.label) || "Sabbia"}</div>}{<div ref={sceneRef} style={{
      flex: 1,
      minHeight: 0,
      position: "relative"
    }} onPointerDown={event => {
      if (event.isPrimary === false || event.button > 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drawingRef.current = true;
      movePointer(event);
    }} onPointerMove={value => {
      if (drawingRef.current) {
        movePointer(value);
      }
    }} onPointerUp={stopDrawing} onPointerCancel={stopDrawing}>{<canvas ref={canvasRef} style={{
        width: "100%",
        height: "100%",
        display: "block",
        touchAction: "none"
      }} />}</div>}{<div style={{
      position: "absolute",
      bottom: "calc(50px + env(safe-area-inset-bottom, 0px))",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: 10
    }}>{<button onClick={clearSandbox} style={{
        padding: "16px 32px",
        borderRadius: "30px",
        border: "none",
        backgroundColor: "#ECECEC",
        color: "#12121A",
        fontFamily: "var(--font-display)",
        fontSize: "18px",
        fontWeight: "700",
        cursor: "pointer",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)"
      }}>{config.BTN_CLEAR || "Cancella"}</button>}</div>}</div>;
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
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
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

// ./fyp-meeting.js
/* Game-owned opening adaptation; never dispatches gameplay input or writes scores. */
(() => {
  'use strict';

  const game = Number({
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "40"
      }[name] ?? null;
    },
    dataset: {
      game: "40"
    }
  }?.dataset.game);
  const html = document.documentElement;
  const hosted = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
  html.dataset.meetingGame = String(game);
  html.dataset.meetingFyp = hosted ? 'preview' : 'direct';
  let active = !hosted;
  let guideUsed = false;
  let guide = null;
  let demo = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const resetIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></svg>';
  const mark = (value, name) => {
    value?.classList.add(name);
    return value;
  };
  function addGuide(container, text) {
    if (!guide) {
      guide = document.createElement('p');
      guide.className = 'meeting-guide';
      guide.textContent = text;
      container.append(guide);
    }
    return guide;
  }
  function attach() {
    const value = document.querySelector('#root>div');
    if (!value) return;
    const canvas = value.querySelector('canvas');
    if (game === 15 && canvas) {
      mark(canvas.parentElement, 'meeting-orbital-board');
      mark(value.querySelector('h1')?.parentElement, 'meeting-orbital-heading');
    }
    if (game === 16) {
      const counter = value.querySelector("[aria-label^=\"Livello \"]");
      if (counter) {
        mark(counter.parentElement, 'meeting-sand-hud');
        const balls = counter.nextElementSibling;
        if (balls) {
          mark(balls, 'meeting-sand-ball-count');
          balls.querySelector('small')?.remove();
        }
      }
      const reset = [...value.querySelectorAll('button')].find(item => item.textContent.trim() === "RICOMINCIA" || item.classList.contains('meeting-sand-reset'));
      if (reset && !reset.classList.contains('meeting-sand-reset')) {
        reset.setAttribute('aria-label', "Ricomincia il livello");
        reset.title = "Ricomincia il livello";
        mark(reset, 'meeting-sand-reset');
        mark(reset.parentElement, 'meeting-sand-reset-wrap');
        reset.innerHTML = resetIcon;
      }
    }
    if (game === 19 && canvas) {
      mark(value.children[1], 'meeting-cube-heading');
      mark(canvas.parentElement, 'meeting-cube-board');
    }
    if (game === 17) {
      const replay = value.querySelector('.btn-neon');
      if (replay) mark(replay.parentElement.parentElement, 'meeting-synth-result');
    }
    if (game === 32 && canvas) {
      mark(canvas.parentElement.parentElement, 'meeting-peeler-board');
      const hint = [...value.querySelectorAll('p')].find(item => item.textContent === "Tocca per sbucciare");
      mark(hint?.parentElement, 'meeting-peeler-guide');
    }
    if (game === 35 && canvas) {
      addGuide(value, "Tocca il tasto scuro in basso");
      const value2 = [...value.children].find(item => item.tagName === 'DIV' && item.textContent.trim() === '0');
      if (value2) mark(value2, 'meeting-piano-hud');
      guide.hidden = !!value.querySelector('button') || [...value.querySelectorAll('div')].some(item => item.classList.contains('meeting-piano-hud') && Number(item.textContent) > 0);
    }
    if (game === 40 && canvas) {
      mark(value.querySelector('.hide-scrollbar'), 'meeting-pixel-palette');
      const clear = [...value.querySelectorAll('button')].find(item => item.textContent === "Cancella");
      mark(clear?.parentElement, 'meeting-pixel-clear');
      const label = [...value.children].find(item => item.tagName === 'DIV' && !item.querySelector('canvas,button') && item.textContent === "Sabbia");
      mark(label, 'meeting-pixel-label');
      addGuide(value, "Scegli un materiale e trascina per versarlo");
    }
    if (game === 41) {
      const shell = value.querySelector('header')?.parentElement;
      mark(shell, 'meeting-chat-shell');
    }
    // No.45's real knife renderer supplies its decorative, non-scoring preview.
    sync();
  }
  function sync() {
    if (demo) demo.hidden = !hosted || active;
    if (game === 40 && guide) guide.hidden = active && guideUsed;
    html.toggleAttribute('data-meeting-inactive', document.hidden);
  }
  const observer = new MutationObserver(attach);
  const root = document.getElementById('root');
  if (root) observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true
  });
  attach();
  // Real game input hides only the new Pixel Sandbox instruction; palette taps do not count.
  document.addEventListener('pointerdown', event => {
    if (game === 40 && active && event.isPrimary !== false && event.button <= 0 && event.target.tagName === 'CANVAS' && guide) {
      guideUsed = true;
      guide.hidden = true;
    }
  }, {
    capture: true
  });
  addEventListener('message', event => {
    if (!hosted || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
    html.dataset.meetingFyp = active ? 'playing' : 'preview';
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener?.('change', sync);
  addEventListener('pagehide', () => {
    observer.disconnect();
  }, {
    once: true
  });
})();

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = ["p.meeting-guide"];
  const copy = new Set([].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
