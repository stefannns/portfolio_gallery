// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
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
    "id": "COMFORT_SPEED_HAPPY",
    "kind": "number",
    "label": "舒服区增长速度",
    "value": 0.6,
    "default": 0.6,
    "min": 0.1,
    "max": 2,
    "step": 0.1
  }, {
    "id": "COMFORT_SPEED_RESIST",
    "kind": "number",
    "label": "敏感区减少速度",
    "value": -0.3,
    "default": -0.3,
    "min": -1,
    "max": 0,
    "step": 0.1
  }, {
    "id": "COMFORT_MAX",
    "kind": "number",
    "label": "目标舒适度",
    "value": 100,
    "default": 100,
    "min": 50,
    "max": 200,
    "step": 10
  }],
  "texts": [{
    "id": "TXT_GUIDE",
    "label": "引导文案",
    "value": "Trascina il pettine",
    "default": "Trascina il pettine",
    "max_length": 30
  }, {
    "id": "TXT_FINISH",
    "label": "完成文案",
    "value": "Relax 100%!",
    "default": "Relax 100%!",
    "max_length": 20
  }],
  "images": [{
    "id": "COMB",
    "label": "梳子",
    "path": "./assets/comb.webp",
    "replaceable": true
  }, {
    "id": "PET_BASE",
    "label": "宠物基础",
    "path": "./assets/pet_base.webp",
    "replaceable": true
  }, {
    "id": "PET_HAPPY",
    "label": "宠物开心",
    "path": "./assets/pet_happy.webp",
    "replaceable": true
  }, {
    "id": "PET_RESIST",
    "label": "宠物抗拒",
    "path": "./assets/pet_resist.webp",
    "replaceable": true
  }, {
    "id": "PET_FINISH",
    "label": "宠物完成",
    "path": "./assets/pet_finish.webp",
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
    /* 容器中立硬规：html / body / #root 三层撑满 + overflow:hidden + 无 vh/vw */
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  
/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .ui-float{position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .ui-float{background:transparent!important;color:#fff!important;font-weight:800!important;padding:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;text-shadow:0 2px 5px rgba(0,0,0,.52)!important}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .ui-float{box-sizing:border-box!important;background:#fff!important;color:#293c34!important;padding:6px 14px!important;border:0!important;border-radius:999px!important;box-shadow:0 2px 10px rgba(0,0,0,.08)!important;text-shadow:none!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.ui-float){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.ui-float){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.ui-float){animation:none!important}}

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
var FurParticle = class {
  constructor(value, otherValue, argument3, argument4, value2 = 1, value3 = Math.random) {
    this.x = value;
    this.y = otherValue;
    this.vx = argument3;
    this.vy = argument4;
    this.scale = value2;
    this.age = 0;
    this.lifetime = 2.15 + value3() * 0.7;
    this.phase = value3() * Math.PI * 2;
    this.startAngle = value3() * Math.PI;
    this.angle = this.startAngle;
    this.spin = (value3() - 0.5) * 1.15;
    this.length = (10 + value3() * 9) * value2;
    this.strands = Array.from({
      length: 3
    }, (value4, otherValue2) => ({
      offset: (otherValue2 - 1) * 0.6 * value2,
      bend: (1 + value3() * 2.5) * value2,
      width: (0.55 + value3() * 0.3) * value2,
      color: ["#634b3c", "#917055", "#b4916e"][otherValue2 % 3]
    }));
  }
  update(value) {
    let value2 = this.age;
    this.age += value;
    let value3 = 1.45;
    let value4 = Math.exp(-value3 * value);
    this.x += this.vx * (1 - value4) / value3 + 3 * this.scale * (Math.cos(this.phase + value2 * 3) - Math.cos(this.phase + this.age * 3));
    this.vx *= value4;
    let value5 = 94 * this.scale;
    this.y += this.vy * value + 0.5 * value5 * value * value;
    this.vy += value5 * value;
    this.angle = this.startAngle + this.spin * this.age + 0.22 * Math.sin(this.phase + this.age * 3);
    return this.age < this.lifetime;
  }
  draw(context) {
    let value = Math.min(1, this.age / 0.07);
    let value2 = Math.min(1, (this.lifetime - this.age) / 0.8);
    context.save();
    context.translate(this.x, this.y);
    context.rotate(this.angle);
    context.globalAlpha = 0.85 * Math.max(0, value * value2);
    context.lineCap = "round";
    for (let value3 of this.strands) {
      context.strokeStyle = value3.color;
      context.lineWidth = value3.width;
      context.beginPath();
      context.moveTo(-this.length * 0.5, value3.offset);
      context.bezierCurveTo(-this.length * 0.2, value3.offset - value3.bend, this.length * 0.18, value3.offset + value3.bend, this.length * 0.5, value3.offset * 0.3);
      context.stroke();
    }
    context.restore();
  }
};
var FurParticleSystem = class {
  constructor() {
    this.particles = [];
    this.remainder = 0;
    this.limit = 90;
  }
  clear() {
    this.particles.length = 0;
    this.remainder = 0;
  }
  emit(point, point2, value = 1, value2 = Math.random) {
    let value3 = point2.x - point.x;
    let value4 = point2.y - point.y;
    let value5 = Math.hypot(value3, value4);
    if (value5 < 3) return;
    let value6 = 12 * value;
    let value7 = Math.min(value5, 90 * value) + this.remainder;
    let value8 = Math.min(10, Math.floor(value7 / value6));
    this.remainder = value7 % value6;
    for (let value9 = 0; value9 < value8; value9++) {
      let value10 = (value9 + 0.5) / value8;
      this.particles.push(new FurParticle(point.x + value3 * value10 + (value2() - 0.5) * 9 * value, point.y + value4 * value10 - 34 * value + (value2() - 0.5) * 8 * value, value3 / value5 * 36 * value + (value2() - 0.5) * 34 * value, value4 / value5 * 16 * value - (28 + value2() * 22) * value, value, value2));
    }
    if (this.particles.length > this.limit) {
      this.particles.splice(0, this.particles.length - this.limit);
    }
  }
  step(value, otherValue) {
    this.particles = this.particles.filter(item => item.update(value));
    for (let value2 of this.particles) value2.draw(otherValue);
    return this.particles.length > 0;
  }
};
function useResponsiveSurface(surfaceRef, enabled = true) {
  let [reducedMotion, setReducedMotion] = React.useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  React.useEffect(() => {
    let current = surfaceRef.current;
    if (!current || !enabled) return;
    let value = window.matchMedia("(prefers-reduced-motion: reduce)");
    let handleAction = () => current.style.setProperty("--ui-scale", String(Math.min(current.clientWidth / 390, current.clientHeight / 598)));
    let handleAction2 = () => {
      current.dataset.pageHidden = String(document.hidden);
    };
    let handleAction3 = () => {
      current.dataset.reducedMotion = String(value.matches);
      setReducedMotion(value.matches);
    };
    let resizeObserver = observeGameSize(handleAction);
    resizeObserver.observe(current);
    handleAction();
    handleAction2();
    handleAction3();
    value.addEventListener("change", handleAction3);
    document.addEventListener("visibilitychange", handleAction2);
    return () => {
      resizeObserver.disconnect();
      value.removeEventListener("change", handleAction3);
      document.removeEventListener("visibilitychange", handleAction2);
    };
  }, [surfaceRef, enabled]);
  return reducedMotion;
}
function useAudioLifecycle(tone, audioRef) {
  let lifecycleRef = React.useRef({
    alive: true,
    epoch: 0,
    pending: null
  });
  React.useEffect(() => {
    let current = lifecycleRef.current;
    current.alive = true;
    let handleAction2 = () => {
      current.epoch++;
      current.pending = null;
      for (let value of Object.values(audioRef.current)) if (value && typeof value.dispose == "function") try {
        value.dispose();
      } catch {}
      audioRef.current = {
        ready: false,
        lastTime: 0,
        lastNoiseTime: 0
      };
    };
    current.dispose = handleAction2;
    let handleAction3 = () => {
      if (document.hidden) {
        handleAction2();
      }
    };
    document.addEventListener("visibilitychange", handleAction3);
    window.addEventListener("pagehide", handleAction2);
    return () => {
      current.alive = false;
      handleAction2();
      document.removeEventListener("visibilitychange", handleAction3);
      window.removeEventListener("pagehide", handleAction2);
    };
  }, [audioRef, tone]);
  let handleAction = value => {
    let current = lifecycleRef.current;
    if (audioRef.current.ready || current.pending) return;
    let epoch = current.epoch;
    let value2;
    try {
      value2 = tone.start();
    } catch {
      return;
    }
    current.pending = Promise.resolve(value2).then(() => {
      if (!(!current.alive || current.epoch !== epoch || document.hidden)) {
        audioRef.current = {
          ...audioRef.current,
          ...value(),
          ready: true
        };
      }
    }).catch(() => {}).finally(() => {
      if (current.epoch === epoch) {
        current.pending = null;
      }
    });
  };
  handleAction.stop = () => lifecycleRef.current.dispose?.();
  return handleAction;
}
async function loadGameConfig() {
  try {
    await requestGameConfig();
  } catch {}
  return runtimeConfig;
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
  return values;
}
function pettingGain({
  distance: t,
  elapsedMs: e,
  scale: r = 1,
  onPet: n = true
}) {
  return !n || !Number.isFinite(t) || !Number.isFinite(e) || t < 0.5 * r || e <= 0 ? 0 : Math.min(80, e, t / (70 * Math.max(0.1, r)) * 1000);
}
var RESPONSIVE_STYLES = `
.ui-game{--ui-scale:1;--ui-top:calc(30px * var(--ui-scale) + env(safe-area-inset-top,0px));--ui-bottom:calc(50px * var(--ui-scale) + env(safe-area-inset-bottom,0px));--ui-side:calc(30px * var(--ui-scale))}
.ui-guide{position:absolute;left:var(--ui-side);right:var(--ui-side);margin:0;text-align:center;font-size:calc(18px * var(--ui-scale));line-height:1.4;font-weight:500;overflow-wrap:anywhere;pointer-events:none;z-index:20}
.ui-float{animation:ui-guide-float 2.4s ease-in-out infinite}
@keyframes ui-guide-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.ui-game[data-page-hidden="true"] .ui-float{animation-play-state:paused}
.ui-game button{font-family:inherit;min-height:44px;min-width:44px;touch-action:manipulation}
.ui-game button:focus-visible,.ui-game [tabindex]:focus-visible{outline:3px solid #78baff;outline-offset:3px}
.ui-game[data-reduced-motion="true"] .ui-float{animation:none}
.ui-game[data-reduced-motion="true"] *{transition-duration:.001ms!important;animation-duration:.001ms!important;animation-iteration-count:1!important}
@media(prefers-reduced-motion:reduce){.ui-float{animation:none}}
`;
function GameStyles() {
  return <style>{`
    ${RESPONSIVE_STYLES}
    @font-face {
      font-family: 'DynaPuff';
      src: url('./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    :root {
      --font-display: "DynaPuff", "PingFang SC", system-ui, sans-serif;
      --font-body:    "DynaPuff", "PingFang SC", system-ui, sans-serif;
      --font-mono:    ui-monospace, Menlo, monospace;
      --c-primary: #8B5A2B;
      --c-bg: #514942;
    }
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: var(--c-bg);
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    * {
      box-sizing: border-box;
    }
    .pet-scene{position:absolute;inset:0;overflow:hidden;pointer-events:none;isolation:isolate}
    .pet-layer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
      pointer-events: none;
    }
  `}</style>;
}
var FONT_STYLES = `@font-face{font-family:"Nunito Sans";src:url("./assets/fonts/ui/NunitoSans.woff") format("woff");font-style:normal;font-weight:100 1000;font-display:swap}
:root{--font-display:"Nunito Sans","PingFang SC",system-ui,sans-serif;--font-body:"Nunito Sans","PingFang SC",system-ui,sans-serif;--ui-ink:#4b3426;--ui-surface:#f5eee5}
.ui-game{font-family:var(--font-body);font-optical-sizing:auto;font-synthesis:none;-webkit-font-smoothing:antialiased}
.ui-game button{font-family:var(--font-body);font-weight:700;letter-spacing:0;line-height:1.25}
.ui-game .ui-guide{font-family:var(--font-body);font-weight:600;letter-spacing:0;line-height:1.35}
`;
var PET_STATES = ["base", "happy", "resist", "finish"];
var PortraitTransition = class {
  constructor() {
    this.weights = [1, 0, 0, 0];
    this.from = this.weights.slice();
    this.ready = new Set();
    this.wanted = "base";
    this.target = "base";
    this.elapsed = 0;
    this.duration = 0.18;
    this.active = false;
  }
  request(value, value2 = false) {
    if (!PET_STATES.includes(value) || (this.wanted = value, !this.ready.has(value))) return;
    let value3 = PET_STATES.indexOf(value);
    if (value2) {
      this.weights = PET_STATES.map((item, index) => +(index === value3));
      this.from = this.weights.slice();
      this.target = value;
      this.active = false;
      return;
    }
    if (value !== this.target) {
      this.from = this.weights.slice();
      this.target = value;
      this.elapsed = 0;
      this.active = true;
    }
  }
  loaded(value, value2 = false) {
    this.ready.add(value);
    this.request(this.wanted, value2);
  }
  failed(value) {
    this.ready.delete(value);
  }
  step(value, value2 = false) {
    if (value2) {
      this.request(this.wanted, true);
      return this.view();
    }
    if (this.active) {
      this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, value));
      let value3 = this.elapsed / this.duration;
      let value4 = value3 * value3 * (3 - 2 * value3);
      let value5 = PET_STATES.indexOf(this.target);
      this.weights = this.from.map((item, index) => item * (1 - value4) + +(index === value5) * value4);
      if (value3 === 1) {
        this.active = false;
      }
    }
    return this.view();
  }
  view() {
    let value = this.weights.map((item, index) => this.ready.has(PET_STATES[index]) ? item : 0);
    if (!value.some(item => item > 0)) {
      let index = PET_STATES.findIndex(item => this.ready.has(item));
      value = value.map((item, index2) => +(index2 === index));
    }
    let value2 = 0;
    return PET_STATES.map((state, index) => {
      value2 += value[index];
      return {
        state: state,
        opacity: value[index] > 0 ? value[index] / value2 : 0,
        weight: value[index]
      };
    });
  }
};
function PetPortraitCanvas({
  cfg: t,
  petState: e,
  reduced: r
}) {
  let stateRef = React.useRef(null);
  let stateRef2 = React.useRef(null);
  let stateRef3 = React.useRef(null);
  let stateRef4 = React.useRef(() => {});
  if (!stateRef.current) {
    stateRef.current = new PortraitTransition();
  }
  let [currentValue, setCurrentValue] = React.useState(() => stateRef.current.view());
  React.useEffect(() => {
    let handleAction = x => {
      stateRef2.current = null;
      let value = stateRef3.current === null ? 0 : Math.min(0.05, (x - stateRef3.current) / 1000);
      stateRef3.current = x;
      setCurrentValue(stateRef.current.step(value, r));
      if (stateRef.current.active && !document.hidden) {
        stateRef2.current = requestAnimationFrame(handleAction);
      } else {
        stateRef3.current = null;
      }
    };
    let handleAction2 = () => {
      if (document.hidden || r) {
        setCurrentValue(stateRef.current.step(0, true));
        return;
      }
      if (stateRef2.current === null) {
        stateRef2.current = requestAnimationFrame(handleAction);
      }
    };
    stateRef4.current = handleAction2;
    let handleAction3 = () => {
      if (document.hidden) {
        cancelAnimationFrame(stateRef2.current);
        stateRef2.current = null;
        stateRef3.current = null;
      }
      handleAction2();
    };
    document.addEventListener("visibilitychange", handleAction3);
    handleAction2();
    return () => {
      cancelAnimationFrame(stateRef2.current);
      stateRef2.current = null;
      stateRef3.current = null;
      stateRef4.current = () => {};
      document.removeEventListener("visibilitychange", handleAction3);
    };
  }, [r]);
  React.useEffect(() => {
    stateRef.current.request(e, r);
    stateRef4.current();
  }, [e, r]);
  let options = {
    base: "PET_BASE",
    happy: "PET_HAPPY",
    resist: "PET_RESIST",
    finish: "PET_FINISH"
  };
  let options2 = {
    base: "Cucciolo pronto per la spazzola",
    happy: "Cucciolo felice",
    resist: "Cucciolo irrequieto",
    finish: "Cucciolo rilassato"
  };
  let state = currentValue.reduce((total, item) => item.weight > total.weight ? item : total, currentValue[0]).state;
  return <div className={"pet-scene"} data-pet-state={state}>{currentValue.map(({
      state: h,
      opacity: f
    }, zIndex) => <img key={h} src={t[options[h]]} className={"pet-layer"} data-pet-layer={h} alt={options2[h]} aria-hidden={h !== state} draggable={false} style={{
      opacity: f,
      zIndex: zIndex
    }} onLoad={() => {
      stateRef.current.loaded(h, r);
      stateRef4.current();
    }} onError={() => {
      stateRef.current.failed(h);
      stateRef4.current();
    }} />)}</div>;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [comfort, setComfort] = React.useState(0);
  let [petState, setPetState] = React.useState("base");
  let [combPosition, setCombPosition] = React.useState({
    x: -1000,
    y: -1000
  });
  let [combing, setCombing] = React.useState(false);
  let [started, setStarted] = React.useState(false);
  let surfaceRef = React.useRef(null);
  let furCanvasRef = React.useRef(null);
  let particleSystemRef = React.useRef(null);
  if (!particleSystemRef.current) {
    particleSystemRef.current = new FurParticleSystem();
  }
  let furControllerRef = React.useRef({
    start: () => {},
    clear: () => {}
  });
  let lastPointRef = React.useRef({
    x: 0,
    y: 0
  });
  let audioRef = React.useRef({
    ready: false,
    noise: null,
    winSynth: null,
    lastNoiseTime: 0
  });
  let combSynthRef = React.useRef(null);
  let finishedTimerRef = React.useRef(null);
  let activePointerRef = React.useRef(null);
  let lastFrameRef = React.useRef(0);
  let strokeDistanceRef = React.useRef({
    total: 0,
    last: 0
  });
  let reducedMotion = useResponsiveSurface(surfaceRef, !!config);
  let ensureAudio = useAudioLifecycle(Tone, audioRef);
  React.useEffect(() => {
    let handleAction = () => {
      let current = activePointerRef.current;
      activePointerRef.current = null;
      setCombing(false);
      if (current !== null && surfaceRef.current?.hasPointerCapture?.(current)) {
        surfaceRef.current.releasePointerCapture(current);
      }
    };
    let handleAction2 = () => {
      if (document.hidden) {
        handleAction();
      }
    };
    let handleAction3 = value => {
      if (value.source === parent && value.origin === location.origin && value.data?.type === "playable-active" && value.data.active !== true) {
        handleAction();
      }
    };
    window.addEventListener("blur", handleAction);
    document.addEventListener("visibilitychange", handleAction2);
    window.addEventListener("message", handleAction3);
    return () => {
      window.removeEventListener("message", handleAction3);
      window.removeEventListener("blur", handleAction);
      document.removeEventListener("visibilitychange", handleAction2);
    };
  }, []);
  React.useEffect(() => {
    let enabled = true;
    (async () => {
      let value = await loadGameConfig();
      if (enabled) {
        setConfig(readConfigValues(value));
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  React.useEffect(() => {
    if (!config || !surfaceRef.current) return;
    let handleAction = () => {
      if (furCanvasRef.current && surfaceRef.current) {
        let value = Math.min(window.devicePixelRatio || 1, 2);
        furCanvasRef.current.width = Math.round(surfaceRef.current.clientWidth * value);
        furCanvasRef.current.height = Math.round(surfaceRef.current.clientHeight * value);
        furCanvasRef.current.getContext("2d")?.setTransform(value, 0, 0, value, 0, 0);
        particleSystemRef.current.clear();
      }
    };
    handleAction();
    let resizeObserver = observeGameSize(handleAction);
    resizeObserver.observe(surfaceRef.current);
    window.addEventListener("resize", handleAction);
    setCombPosition({
      x: surfaceRef.current.clientWidth * 0.72,
      y: surfaceRef.current.clientHeight * 0.7
    });
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleAction);
    };
  }, [config]);
  React.useEffect(() => {
    if (!config) return;
    let value = null;
    let clear = () => {
      cancelAnimationFrame(combSynthRef.current);
      combSynthRef.current = null;
      value = null;
      particleSystemRef.current.clear();
      let dimensions = furCanvasRef.current;
      dimensions?.getContext("2d")?.clearRect(0, 0, dimensions.width, dimensions.height);
    };
    let handleAction = value2 => {
      combSynthRef.current = null;
      let dimensions = furCanvasRef.current;
      let value3 = dimensions?.getContext("2d");
      if (!value3 || document.hidden || reducedMotion) {
        clear();
        return;
      }
      let value4 = value === null ? 1 / 60 : Math.min(0.05, Math.max(0, (value2 - value) / 1000));
      value = value2;
      value3.clearRect(0, 0, dimensions.width, dimensions.height);
      if (particleSystemRef.current.step(value4, value3)) {
        combSynthRef.current = requestAnimationFrame(handleAction);
      } else {
        value = null;
      }
    };
    let start = () => {
      if (!reducedMotion && !document.hidden && particleSystemRef.current.particles.length && combSynthRef.current === null) {
        combSynthRef.current = requestAnimationFrame(handleAction);
      }
    };
    furControllerRef.current = {
      start: start,
      clear: clear
    };
    let handleAction2 = () => {
      if (document.hidden) {
        clear();
      }
    };
    document.addEventListener("visibilitychange", handleAction2);
    if (reducedMotion) {
      clear();
    }
    return () => {
      clear();
      furControllerRef.current = {
        start: () => {},
        clear: () => {}
      };
      document.removeEventListener("visibilitychange", handleAction2);
    };
  }, [config, reducedMotion]);
  React.useEffect(() => {
    if (!(petState === "finish" || combing)) {
      clearTimeout(finishedTimerRef.current);
      finishedTimerRef.current = setTimeout(() => {
        setPetState("base");
      }, 400);
      return () => clearTimeout(finishedTimerRef.current);
    }
  }, [combPosition, combing, petState]);
  let initAudio = () => ensureAudio(() => {
    let noise = new Tone.NoiseSynth({
      noise: {
        type: "brown"
      },
      envelope: {
        attack: 0.05,
        decay: 0.1,
        sustain: 0
      }
    }).toDestination();
    noise.volume.value = -15;
    let winSynth = new Tone.PolySynth(Tone.Synth).toDestination();
    winSynth.volume.value = -6;
    return {
      noise: noise,
      winSynth: winSynth,
      lastNoiseTime: 0
    };
  });
  let finishGrooming = () => {
    if (setPetState("finish"), activePointerRef.current = null, setCombing(false), audioRef.current.ready) {
      let timestamp = Tone.now();
      audioRef.current.winSynth.triggerAttackRelease(["C4", "E4", "G4"], "8n", timestamp);
      audioRef.current.winSynth.triggerAttackRelease(["E4", "G4", "C5"], "4n", timestamp + 0.2);
    }
  };
  let startCombing = event => {
    if (petState === "finish" || activePointerRef.current !== null || event.isPrimary === false || event.button !== 0) return;
    activePointerRef.current = event.pointerId;
    strokeDistanceRef.current.last = event.timeStamp;
    particleSystemRef.current.remainder = 0;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    initAudio();
    setCombing(true);
    let bounds = event.currentTarget.getBoundingClientRect();
    lastPointRef.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    };
    setCombPosition(lastPointRef.current);
  };
  let continueCombing = event => {
    if (activePointerRef.current !== event.pointerId || petState === "finish" || !surfaceRef.current) return;
    let dimensions = surfaceRef.current.getBoundingClientRect();
    let value = event.clientX - dimensions.left;
    let value2 = event.clientY - dimensions.top;
    let value3 = value - lastPointRef.current.x;
    let value4 = value2 - lastPointRef.current.y;
    let distance = Math.sqrt(value3 * value3 + value4 * value4);
    let elapsedMs = event.timeStamp - strokeDistanceRef.current.last;
    if (strokeDistanceRef.current.last = event.timeStamp, distance > 0.5 * Math.min(dimensions.width / 390, dimensions.height / 598)) {
      let timestamp = Tone.now();
      if (audioRef.current.ready && timestamp - audioRef.current.lastNoiseTime > 0.08) {
        audioRef.current.noise.triggerAttackRelease("16n", timestamp);
        audioRef.current.lastNoiseTime = timestamp;
      }
      let value5 = value2 / dimensions.height;
      let value6 = value / dimensions.width;
      if (!reducedMotion && !document.hidden && value6 > 0.2 && value6 < 0.8 && value5 > 0.3 && value5 < 0.8) {
        let value8 = Math.max(0.65, Math.min(1.2, dimensions.width / 390, dimensions.height / 598));
        let options = {
          x: Math.max(dimensions.width * 0.2, Math.min(dimensions.width * 0.8, lastPointRef.current.x)),
          y: Math.max(dimensions.height * 0.3, Math.min(dimensions.height * 0.8, lastPointRef.current.y))
        };
        particleSystemRef.current.emit(options, {
          x: value,
          y: value2
        }, value8);
        furControllerRef.current.start();
      } else particleSystemRef.current.remainder = 0;
      let onPet = value6 > 0.2 && value6 < 0.8 && value5 > 0.3 && value5 < 0.8;
      let value7 = pettingGain({
        distance: distance,
        elapsedMs: elapsedMs,
        scale: Math.min(dimensions.width / 390, dimensions.height / 598),
        onPet: onPet
      });
      if (value7 > 0) {
        setStarted(true);
        setPetState("happy");
        strokeDistanceRef.current.total = Math.min(5000, strokeDistanceRef.current.total + value7);
        let value8 = config.COMFORT_MAX ?? 100;
        let value9 = value8 * strokeDistanceRef.current.total / 5000;
        lastFrameRef.current = value9;
        setComfort(value9);
        if (value9 >= value8) {
          finishGrooming();
        }
      } else setPetState("base");
    }
    setCombPosition({
      x: value,
      y: value2
    });
    lastPointRef.current = {
      x: value,
      y: value2
    };
  };
  let stopCombing = event => {
    if (!(event && activePointerRef.current !== event.pointerId)) {
      activePointerRef.current = null;
      setCombing(false);
    }
  };
  return config ? <div ref={surfaceRef} className={"ui-game"} style={{
    width: "100%",
    height: "100%",
    position: "relative",
    containerType: "size"
  }} onPointerDown={startCombing} onPointerMove={continueCombing} onPointerUp={stopCombing} onPointerCancel={stopCombing} onLostPointerCapture={stopCombing}>{<GameStyles />}{<style>{FONT_STYLES}</style>}{<PetPortraitCanvas cfg={config} petState={petState} reduced={reducedMotion} />}{<canvas ref={furCanvasRef} aria-hidden={"true"} style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: 5
    }} />}{<Motion.AnimatePresence>{petState !== "finish" && <Motion.motion.img src={config.COMB} alt={"pettine"} draggable={false} initial={reducedMotion ? false : {
        opacity: 0,
        scale: 0.8
      }} animate={{
        opacity: 1,
        scale: 1
      }} exit={reducedMotion ? {
        opacity: 0
      } : {
        opacity: 0,
        scale: 0.5
      }} transformTemplate={(value, otherValue) => `translate(-50%, -70%) ${otherValue}`} style={{
        position: "absolute",
        left: combPosition.x,
        top: combPosition.y,
        width: "clamp(80px, 25cqi, 150px)",
        height: "calc(120px * var(--ui-scale))",
        objectFit: "contain",
        transform: "translate(-50%, -80%)",
        pointerEvents: "none",
        zIndex: 10,
        filter: "drop-shadow(2px 4px 6px rgba(0,0,0,0.3))"
      }} />}</Motion.AnimatePresence>}{<div style={{
      position: "absolute",
      top: "var(--ui-top)",
      left: "var(--ui-side)",
      right: "var(--ui-side)",
      zIndex: 20,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      pointerEvents: "none"
    }}>{<div role={"progressbar"} aria-label={"Relax"} aria-valuemin={0} aria-valuemax={config.COMFORT_MAX ?? 100} aria-valuenow={Math.round(comfort)} style={{
        width: "min(160px, 60%)",
        height: "10px",
        background: "rgba(255,255,255,0.28)",
        borderRadius: "999px",
        border: "1px solid rgba(255,255,255,0.72)",
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
      }}>{<div style={{
          width: `${100 * comfort / (config.COMFORT_MAX ?? 100)}%`,
          height: "100%",
          background: "#edbb88",
          transition: "width 0.2s ease-out"
        }} />}</div>}{<Motion.AnimatePresence mode={"wait"}>{petState === "finish" ? <Motion.motion.div key={"finish"} initial={reducedMotion ? false : {
          opacity: 0,
          y: 10,
          scale: 0.8
        }} animate={{
          opacity: 1,
          y: 0,
          scale: 1
        }} style={{
          marginTop: "16px",
          fontFamily: "var(--font-display)",
          fontSize: "calc(24px * var(--ui-scale))",
          textAlign: "center",
          overflowWrap: "anywhere",
          color: "#4b3426",
          background: "rgba(255,253,248,.94)",
          padding: "8px 16px",
          borderRadius: 16,
          textShadow: "none",
          fontWeight: 800
        }}>{config.TXT_FINISH}</Motion.motion.div> : !started && <Motion.motion.div key={"guide"} className={"ui-float"} initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} exit={{
          opacity: 0
        }} style={{
          marginTop: "12px",
          padding: "6px 14px",
          borderRadius: 999,
          background: "rgba(255,253,248,.94)",
          fontFamily: "var(--font-body)",
          fontSize: "calc(18px * var(--ui-scale))",
          textAlign: "center",
          lineHeight: 1.4,
          color: "#4b3426",
          fontWeight: 650,
          textShadow: "none"
        }}>{config.TXT_GUIDE}</Motion.motion.div>}</Motion.AnimatePresence>}</div>}{petState === "finish" && <button autoFocus={true} type={"button"} onPointerDown={value => value.stopPropagation()} onClick={() => {
      ensureAudio.stop();
      activePointerRef.current = null;
      lastFrameRef.current = 0;
      strokeDistanceRef.current = {
        total: 0,
        last: 0
      };
      furControllerRef.current.clear();
      setComfort(0);
      setPetState("base");
      setStarted(false);
      setCombPosition({
        x: surfaceRef.current.clientWidth * 0.72,
        y: surfaceRef.current.clientHeight * 0.7
      });
    }} style={{
      position: "absolute",
      bottom: "var(--ui-bottom)",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "12px 28px",
      border: "1px solid #ffffff50",
      borderRadius: 999,
      background: "#4b3426",
      color: "#fff",
      font: "700 18px var(--font-body)",
      zIndex: 30
    }}>{"Riprova"}</button>}</div> : <div style={{
    width: "100%",
    height: "100%",
    background: "#514942"
  }} />;
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

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [".ui-float"];
  const copy = new Set(["Trascina il pettine"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
