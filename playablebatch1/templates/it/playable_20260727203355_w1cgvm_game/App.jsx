// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
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
  "tweaks": [{
    "id": "FLOAT_SPEED",
    "kind": "number",
    "label": "悬浮动画速度",
    "value": 2.5,
    "default": 2.5,
    "min": 1,
    "max": 5,
    "step": 0.1
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "标题",
    "value": "Scegli il look",
    "default": "Scegli il look",
    "max_length": 20
  }],
  "images": [{
    "id": "BG_BASE",
    "label": "原图(未穿)",
    "path": "./assets/bg_base.webp",
    "replaceable": true
  }, {
    "id": "BG_A",
    "label": "穿丝巾",
    "path": "./assets/bg_a.webp",
    "replaceable": true
  }, {
    "id": "BG_B",
    "label": "穿上衣",
    "path": "./assets/bg_b.webp",
    "replaceable": true
  }, {
    "id": "BG_AB",
    "label": "穿丝巾和上衣",
    "path": "./assets/bg_ab.webp",
    "replaceable": true
  }, {
    "id": "ITEM_A",
    "label": "悬浮丝巾素材",
    "path": "./assets/item_a.webp",
    "replaceable": true
  }, {
    "id": "ITEM_B",
    "label": "悬浮上衣素材",
    "path": "./assets/item_b.webp",
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
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.look-guide{position:fixed!important;top:13%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root .pick-look .look-plane{top:0!important;transform:translateX(-50%)!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(p.look-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(p.look-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(p.look-guide){animation:none!important}}

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
async function loadGameConfig() {
  try {
    await requestGameConfig();
  } catch {}
  return runtimeConfig;
}
function readConfigValues(config) {
  let values = {};
  for (let value of [...(config.tweaks || []), ...(config.texts || [])]) values[value.id] = value.value;
  for (let value of config.images || []) values[value.id] = value.path;
  return values;
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
var FONT_STYLES = `@font-face{font-family:"DM Sans";src:url("./assets/fonts/ui/DMSans.woff") format("woff");font-style:normal;font-weight:100 1000;font-display:swap}
:root{--font-display:"DM Sans","PingFang SC",system-ui,sans-serif;--font-body:"DM Sans","PingFang SC",system-ui,sans-serif;--ui-ink:#202322;--ui-surface:#f7f7f4}
.ui-game{font-family:var(--font-body);font-optical-sizing:auto;font-synthesis:none;-webkit-font-smoothing:antialiased}
.ui-game button{font-family:var(--font-body);font-weight:700;letter-spacing:0;line-height:1.25}
.ui-game .ui-guide{font-family:var(--font-body);font-weight:600;letter-spacing:0;line-height:1.35}
`;
function outfitAssetUrl(value) {
  return /^\.\/assets\/(?:bg_base|bg_a|bg_b|bg_ab|item_a|item_b)\.webp$/.test(value) ? value + "?art=street-restored-67-20261016-7" : value;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [scarfOn, setScarfOn] = React.useState(false);
  let [jacketOn, setJacketOn] = React.useState(false);
  let [started, setStarted] = React.useState(false);
  let [photoSize, setPhotoSize] = React.useState({
    width: 0,
    height: 0
  });
  let surfaceRef = React.useRef(null);
  let scarfRemoveRef = React.useRef(null);
  let jacketRemoveRef = React.useRef(null);
  let scarfItemRef = React.useRef(null);
  let jacketItemRef = React.useRef(null);
  let actionAudioRef = React.useRef(null);
  let ensureActionAudio = () => {
    if (!actionAudioRef.current || actionAudioRef.current.disposed) {
      actionAudioRef.current = globalThis.PlayableActionAudio?.create("outfit");
    }
    return actionAudioRef.current;
  };
  useResponsiveSurface(surfaceRef, !!config);
  React.useEffect(() => {
    let enabled = true;
    loadGameConfig().then(response => {
      if (enabled) {
        setConfig(readConfigValues(response));
      }
    });
    return () => {
      enabled = false;
    };
  }, []);
  React.useEffect(() => {
    let current = surfaceRef.current;
    if (!config || !current) return;
    let handleAction = () => {
      let x = Math.max(current.clientWidth / 3, current.clientHeight / 4);
      setPhotoSize({
        width: 3 * x,
        height: 4 * x
      });
    };
    let resizeObserver = observeGameSize(handleAction);
    resizeObserver.observe(current);
    handleAction();
    return () => resizeObserver.disconnect();
  }, [config]);
  React.useEffect(() => () => actionAudioRef.current?.dispose(), []);
  function changeOutfit(value, otherValue, argument3) {
    ensureActionAudio()?.tap(otherValue);
    setStarted(true);
    if (value === "A") {
      setScarfOn(otherValue);
    } else {
      setJacketOn(otherValue);
    }
    if (argument3) {
      requestAnimationFrame(() => {
        (value === "A" ? otherValue ? scarfRemoveRef : scarfItemRef : otherValue ? jacketRemoveRef : jacketItemRef).current?.focus({
          preventScroll: true
        });
      });
    }
  }
  if (!config) return <div style={{
    width: "100%",
    height: "100%",
    background: "#111"
  }} />;
  let photoKey = scarfOn ? jacketOn ? "BG_AB" : "BG_A" : jacketOn ? "BG_B" : "BG_BASE";
  return <main ref={surfaceRef} className={"ui-game pick-look"} aria-label={config.GAME_TITLE}>{<style>{`${RESPONSIVE_STYLES}
      html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#111}
      *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
      .pick-look{width:100%;height:100%;position:relative;overflow:hidden;container-type:size;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;touch-action:none}
      .look-plane{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none}
      .look-plane>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .25s ease;pointer-events:none}
      .look-remove{position:absolute;border:0;background:transparent;padding:0;pointer-events:auto;cursor:pointer}
      .look-remove:focus-visible{background:#ffffff24;border-radius:18px}
      .outfit-item{position:absolute;width:25%;aspect-ratio:1;border:0;padding:0;background:transparent;cursor:pointer;z-index:10}
      .outfit-item img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none;filter:drop-shadow(0 6px 7px #0004)}
      .outfit-item:active img{filter:drop-shadow(0 3px 4px #0006) brightness(.94)}
      .look-guide{top:12%;bottom:auto;left:50%;right:auto;transform:translateX(-50%);width:max-content;max-width:calc(100% - 2 * var(--ui-side));padding:8px 16px;color:#202322;background:#fffffff0;border:1px solid #ffffff90;border-radius:999px;text-shadow:none;box-shadow:0 3px 14px #10181218}
    `}</style>}{<style>{FONT_STYLES}</style>}{<div className={"look-plane"} style={{
      ...photoSize,
      zIndex: 1
    }}>{["BG_BASE", "BG_A", "BG_B", "BG_AB"].map(item => <img key={item} src={outfitAssetUrl(config[item])} alt={item === photoKey ? "Look attuale" : ""} aria-hidden={item !== photoKey} draggable={false} style={{
        opacity: item === photoKey ? 1 : 0
      }} />)}{scarfOn && <button ref={scarfRemoveRef} className={"look-remove"} type={"button"} aria-label={"Togli il foulard"} onClick={value => changeOutfit("A", false, value.detail === 0)} style={{
        top: "48%",
        left: "44%",
        width: "28%",
        height: "14%",
        zIndex: 12
      }} />}{jacketOn && <button ref={jacketRemoveRef} className={"look-remove"} type={"button"} aria-label={"Togli il top"} onClick={value => changeOutfit("B", false, value.detail === 0)} style={{
        top: "60%",
        left: "20%",
        width: "60%",
        height: "9%",
        zIndex: 11
      }} />}</div>}{!scarfOn && <button ref={scarfItemRef} type={"button"} className={"outfit-item"} aria-label={"Prova il foulard"} onClick={value => changeOutfit("A", true, value.detail === 0)} style={{
      left: "var(--ui-side)",
      top: "25%"
    }}>{<img className={"ui-float"} style={{
        animationDuration: `${config.FLOAT_SPEED || 2.5}s`
      }} src={outfitAssetUrl(config.ITEM_A)} alt={""} draggable={false} />}</button>}{!jacketOn && <button ref={jacketItemRef} type={"button"} className={"outfit-item"} aria-label={"Prova il top"} onClick={value => changeOutfit("B", true, value.detail === 0)} style={{
      left: "var(--ui-side)",
      bottom: "29%"
    }}>{<img className={"ui-float"} style={{
        animationDuration: `${(config.FLOAT_SPEED || 2.5) * 1.1}s`
      }} src={outfitAssetUrl(config.ITEM_B)} alt={""} draggable={false} />}</button>}{!started && <p className={"ui-guide look-guide"}>{"Tocca un capo per provarlo"}</p>}</main>;
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

// ./interaction-audio.js
/* Original procedural SFX. No samples, remote requests or audio before a valid gesture. */
(function (host) {
  'use strict';

  const profiles = {
    fur: {
      gain: 0.055,
      high: 110,
      low: 900,
      hold: 120,
      attack: 0.025,
      release: 0.08
    },
    scratch: {
      gain: 0.085,
      high: 480,
      low: 3200,
      hold: 110,
      attack: 0.018,
      release: 0.065
    },
    steam: {
      gain: 0.04,
      high: 750,
      low: 5000,
      hold: 180,
      attack: 0.035,
      release: 0.1
    },
    outfit: {
      gain: 0.06,
      high: 700,
      low: 2600,
      hold: 90,
      attack: 0.008,
      release: 0.065
    }
  };
  function create(kind) {
    const profile = profiles[kind] || profiles.scratch;
    const document = host.document;
    let context = null;
    let buffer = null;
    let voice = null;
    let idle = null;
    let pending = null;
    let intent = null;
    let epoch = 0;
    let disposed = false;
    let bound = false;
    const active = new Set();
    const timers = new Set();
    const handleAction = () => host.performance?.now?.() ?? Date.now();
    const later = (value, otherValue) => {
      const value2 = host.setTimeout(() => {
        timers.delete(value2);
        value();
      }, otherValue);
      timers.add(value2);
      return value2;
    };
    const cancel = value => {
      if (value !== null) {
        host.clearTimeout(value);
        timers.delete(value);
      }
    };
    function destroy(node) {
      if (!node || !active.has(node)) return;
      active.delete(node);
      if (node.cleanup !== undefined) cancel(node.cleanup);
      for (const source of node.sources) try {
        source.stop();
      } catch {}
      for (const part of node.nodes) try {
        part.disconnect();
      } catch {}
    }
    function noise() {
      if (buffer) return buffer;
      buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 2), context.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 76073;
      let brown = 0;
      for (let value = 0; value < data.length; value++) {
        seed = Math.imul(seed, 1664525) + 1013904223 >>> 0;
        const white = seed / 2147483648 - 1;
        brown = (brown + 0.02 * white) / 1.02;
        data[value] = kind === 'fur' ? brown * 3.5 : white * 0.78 + brown * 0.6;
      }
      return buffer;
    }
    function makeVoice(loop) {
      const source = context.createBufferSource();
      const high = context.createBiquadFilter();
      const biquadFilter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = noise();
      source.loop = loop;
      high.type = 'highpass';
      high.frequency.value = profile.high;
      high.Q.value = 0.5;
      biquadFilter.type = 'lowpass';
      biquadFilter.frequency.value = profile.low;
      biquadFilter.Q.value = 0.5;
      gain.gain.value = 0;
      source.connect(high);
      high.connect(biquadFilter);
      biquadFilter.connect(gain);
      gain.connect(context.destination);
      const node = {
        sources: [source],
        nodes: [source, high, biquadFilter, gain],
        gain
      };
      active.add(node);
      if (active.size > 4) destroy(active.values().next().value);
      source.start();
      return node;
    }
    function fade() {
      if (!voice || !context) return;
      const node = voice;
      voice = null;
      try {
        node.gain.gain.cancelScheduledValues(context.currentTime);
        node.gain.gain.setTargetAtTime(0, context.currentTime, profile.release / 3);
      } catch {}
      node.cleanup = later(() => destroy(node), Math.ceil(profile.release * 1000) + 25);
    }
    function stop() {
      intent = null;
      cancel(idle);
      idle = null;
      fade();
    }
    function playMotion(force) {
      if (!context || context.state !== 'running' || disposed || document?.hidden) return;
      if (!voice || !active.has(voice)) voice = makeVoice(true);
      const value = profile.gain * (0.55 + 0.45 * Math.max(0, Math.min(1, Number(force) || 0)));
      voice.gain.gain.cancelScheduledValues(context.currentTime);
      voice.gain.gain.setTargetAtTime(value, context.currentTime, profile.attack);
      cancel(idle);
      idle = later(() => {
        idle = null;
        stop();
      }, profile.hold);
    }
    function playTap(adding) {
      if (!context || context.state !== 'running' || disposed || document?.hidden) return;
      const node = makeVoice(false);
      const currentTime = context.currentTime;
      const gain = node.gain.gain;
      gain.setValueAtTime(0.0001, currentTime);
      gain.linearRampToValueAtTime(profile.gain, currentTime + 0.008);
      gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.095);
      const click = context.createOscillator();
      const level = context.createGain();
      click.type = 'sine';
      click.frequency.setValueAtTime(adding ? 720 : 510, currentTime);
      click.frequency.exponentialRampToValueAtTime(adding ? 460 : 300, currentTime + 0.045);
      level.gain.setValueAtTime(0.0001, currentTime);
      level.gain.linearRampToValueAtTime(0.2, currentTime + 0.004);
      level.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.055);
      click.connect(level);
      level.connect(context.destination);
      node.sources.push(click);
      node.nodes.push(click, level);
      click.start(currentTime);
      click.stop(currentTime + 0.065);
      node.cleanup = later(() => destroy(node), 130);
      intent = null;
    }
    function close() {
      epoch++;
      pending = null;
      stop();
      for (const value of [...timers]) cancel(value);
      for (const node of [...active]) destroy(node);
      voice = null;
      buffer = null;
      const previous = context;
      context = null;
      if (previous) try {
        Promise.resolve(previous.close()).catch(() => {});
      } catch {}
    }
    const hidden = () => {
      if (document?.hidden) close();
    };
    function bind() {
      if (bound) return;
      bound = true;
      document?.addEventListener?.('visibilitychange', hidden);
      host.addEventListener?.('pagehide', close);
      host.addEventListener?.('blur', close);
    }
    function arm() {
      if (disposed || document?.hidden) return false;
      bind();
      try {
        if (!context || context.state === 'closed') {
          const Constructor = host.AudioContext || host.webkitAudioContext;
          if (!Constructor) return false;
          context = new Constructor();
          buffer = null;
        }
        if (context.state === 'running') return true;
        if (pending) return false;
        const target = context;
        const generation = epoch;
        pending = Promise.resolve(target.resume()).then(() => {
          if (disposed || generation !== epoch || context !== target || document?.hidden || target.state !== 'running') return;
          const requested = intent;
          if (!requested || handleAction() - requested.time > 180) return;
          if (requested.type === 'tap') playTap(requested.adding);else playMotion(requested.force);
        }).catch(() => {
          if (generation === epoch && context === target) close();
        }).finally(() => {
          if (generation === epoch) pending = null;
        });
      } catch {
        close();
      }
      return false;
    }
    function move(force = 1) {
      if (disposed || document?.hidden) return;
      intent = {
        type: 'motion',
        force,
        time: handleAction()
      };
      if (context?.state === 'running') try {
        playMotion(force);
      } catch {
        close();
      }
    }
    function tap(adding = true) {
      if (disposed || document?.hidden) return;
      intent = {
        type: 'tap',
        adding,
        time: handleAction()
      };
      if (arm()) try {
        playTap(adding);
      } catch {
        close();
      }
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      close();
      document?.removeEventListener?.('visibilitychange', hidden);
      host.removeEventListener?.('pagehide', close);
      host.removeEventListener?.('blur', close);
    }
    return {
      arm,
      move,
      tap,
      stop,
      dispose,
      get disposed() {
        return disposed;
      }
    };
  }
  host.PlayableActionAudio = {
    create
  };
})(typeof window === 'undefined' ? globalThis : window);
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = ["p.look-guide"];
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
