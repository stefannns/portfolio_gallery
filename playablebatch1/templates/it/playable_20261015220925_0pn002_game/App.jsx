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
    "id": "BRUSH_RATIO",
    "kind": "number",
    "label": "Iron Size Ratio",
    "value": 0.12,
    "default": 0.12,
    "min": 0.05,
    "max": 0.3,
    "step": 0.01
  }, {
    "id": "PARTICLE_COUNT",
    "kind": "number",
    "label": "Steam Intensity",
    "value": 3,
    "default": 3,
    "min": 1,
    "max": 10,
    "step": 1
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "Perline da stirare",
    "default": "Perline da stirare",
    "max_length": 30
  }, {
    "id": "HINT_TEXT",
    "label": "Hint Text",
    "value": "Trascina per scoprire!",
    "default": "Trascina per scoprire!",
    "max_length": 50
  }],
  "images": [{
    "id": "BG_PIXEL",
    "label": "Pixel Art (Bottom)",
    "path": "./assets/bg_pixel.webp",
    "replaceable": true
  }, {
    "id": "BG_BEAD",
    "label": "Fuse Bead (Top)",
    "path": "./assets/bg_bead.webp",
    "replaceable": true
  }, {
    "id": "CURSOR_IRON",
    "label": "Iron Cursor",
    "path": "./assets/cursor_iron.webp",
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
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  
/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.bead-guide{position:fixed!important;top:20%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root .bead-game .bead-board{top:48%!important;width:min(calc(100cqw - 2 * var(--ui-side)),48cqh)!important}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.bead-guide{background:rgba(255,255,255,.94)!important;color:#000!important;font-weight:800!important;padding:8px 14px!important;border:1px solid rgba(28,41,48,.12)!important;border-radius:999px!important;box-shadow:0 3px 10px rgba(0,0,0,.08)!important;text-shadow:none!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(p.bead-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(p.bead-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(p.bead-guide){animation:none!important}}

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
function GameStyles() {
  return <style>{`
    @font-face {
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
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: #ffffff;
      /* \u7981\u6B62\u9ED8\u8BA4\u9009\u4E2D\u548C\u957F\u6309 */
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: none;
    }
    * {
      box-sizing: border-box;
    }
    .pixelated {
      image-rendering: -moz-crisp-edges;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
      image-rendering: pixelated;
    }
  `}</style>;
}
var FuseBeadBoard = function BeadBoard({
  cfg
}) {
  const createElement = React.createElement;
  const root = React.useRef(null);
  const board = React.useRef(null);
  const canvas = React.useRef(null);
  const steam = React.useRef(null);
  const image = React.useRef(null);
  const pointer = React.useRef(null);
  const last = React.useRef(null);
  const cursor = React.useRef(null);
  const particles = React.useRef([]);
  const keyboard = React.useRef({
    x: 0.5,
    y: 0.5
  });
  const steamLoop = React.useRef(null);
  const clearSteam = React.useRef(null);
  const lastSteam = React.useRef(null);
  const actionAudioRef = React.useRef(null);
  const actionAudio = () => {
    if (!actionAudioRef.current || actionAudioRef.current.disposed) actionAudioRef.current = globalThis.PlayableActionAudio?.create('steam');
    return actionAudioRef.current;
  };
  const [ready, setReady] = React.useState(false);
  const [started, setStarted] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [ratio, setRatio] = React.useState(1);
  const brush = Math.max(0.05, Math.min(0.3, Number(cfg.BRUSH_RATIO) || 0.12));
  const ironSrc = cfg.CURSOR_IRON === './assets/cursor_iron.webp' ? cfg.CURSOR_IRON + '?art=top-down-iron73-20261015-1' : cfg.CURSOR_IRON || '';
  const guide = cfg.HINT_TEXT && cfg.HINT_TEXT !== "Trascina per scoprire!" ? cfg.HINT_TEXT : "Passa il ferro sulle perline";
  const handleAction = () => {
    const current = pointer.current;
    pointer.current = null;
    last.current = null;
    lastSteam.current = null;
    actionAudioRef.current?.stop();
    if (current !== null && canvas.current?.hasPointerCapture?.(current)) canvas.current.releasePointerCapture(current);
  };
  const suspend = () => {
    handleAction();
    clearSteam.current?.();
  };
  function restore() {
    suspend();
    if (!canvas.current || !image.current) return;
    const context = canvas.current.getContext('2d');
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, canvas.current.width, canvas.current.height);
    context.drawImage(image.current, 0, 0);
    setStarted(false);
    keyboard.current = {
      x: 0.5,
      y: 0.5
    };
    if (cursor.current) cursor.current.style.opacity = '0';
  }
  React.useEffect(() => {
    let alive = true;
    const image2 = new Image();
    image2.crossOrigin = 'anonymous';
    image2.onload = () => {
      if (!alive || !canvas.current) return;
      image.current = image2;
      canvas.current.width = image2.naturalWidth;
      canvas.current.height = image2.naturalHeight;
      setRatio(image2.naturalWidth / image2.naturalHeight);
      restore();
      setReady(true);
    };
    image2.onerror = () => {
      if (alive) setError(true);
    };
    image2.src = cfg.BG_BEAD || '';
    return () => {
      alive = false;
      suspend();
    };
  }, [cfg.BG_BEAD]);
  React.useEffect(() => {
    const node = root.current;
    if (!node) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleAction2 = () => node.style.setProperty('--ui-scale', String(Math.min(node.clientWidth / 390, node.clientHeight / 598)));
    const state = () => {
      node.dataset.reducedMotion = String(media.matches);
      node.dataset.pageHidden = String(document.hidden);
      if (document.hidden || media.matches) suspend();
    };
    const resize = observeGameSize(() => {
      handleAction();
      handleAction2();
    });
    resize.observe(node);
    handleAction2();
    state();
    media.addEventListener('change', state);
    document.addEventListener('visibilitychange', state);
    window.addEventListener('blur', suspend);
    return () => {
      resize.disconnect();
      media.removeEventListener('change', state);
      document.removeEventListener('visibilitychange', state);
      window.removeEventListener('blur', suspend);
    };
  }, []);
  React.useEffect(() => {
    let value = null;
    let previous = 0;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const vapor = document.createElement('canvas');
    vapor.width = 96;
    vapor.height = 128;
    const mist = vapor.getContext('2d');
    if (mist) for (const [x, y, r, alpha] of [[48, 86, 28, 0.82], [36, 64, 25, 0.6], [58, 44, 29, 0.65], [40, 25, 22, 0.45], [65, 75, 19, 0.4]]) {
      const falloff = mist.createRadialGradient(x, y, 0, x, y, r);
      falloff.addColorStop(0, `rgba(255,255,255,${alpha})`);
      falloff.addColorStop(0.42, `rgba(226,231,228,${alpha * 0.55})`);
      falloff.addColorStop(1, 'rgba(237,240,238,0)');
      mist.fillStyle = falloff;
      mist.fillRect(x - r, y - r, r * 2, r * 2);
    }
    function clear() {
      if (value !== null) cancelAnimationFrame(value);
      value = null;
      previous = 0;
      particles.current = [];
      const surface = steam.current;
      if (surface) surface.getContext('2d').clearRect(0, 0, surface.width, surface.height);
    }
    function frame(value2) {
      value = null;
      const surface = steam.current;
      if (!surface || document.hidden || media.matches) {
        clear();
        return;
      }
      const bounds = root.current.getBoundingClientRect();
      const value3 = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(bounds.width * value3);
      const height = Math.round(bounds.height * value3);
      if (surface.width !== width || surface.height !== height) {
        surface.width = width;
        surface.height = height;
      }
      const context = surface.getContext('2d');
      context.setTransform(value3, 0, 0, value3, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);
      const value4 = Math.min(50, previous ? value2 - previous : 16.7);
      previous = value2;
      particles.current = particles.current.filter(point => {
        point.age += value4;
        point.y -= value4 * point.rise;
        point.x += point.drift * value4;
        if (point.age > point.life) return false;
        const progress = point.age / point.life;
        const radius = point.size * (1 + progress * 1.8);
        const curl = Math.sin(point.phase + progress * 4.8) * progress * 11;
        context.save();
        context.translate(point.x + curl, point.y);
        context.rotate(point.tilt + progress * point.turn);
        context.globalAlpha = Math.min(1, point.age / 70) * Math.pow(1 - progress, 1.15) * 0.85;
        if (mist) context.drawImage(vapor, -radius, -radius * 1.6, radius * 2, radius * 2.7);
        context.restore();
        return true;
      });
      context.globalAlpha = 1;
      if (particles.current.length) value = requestAnimationFrame(frame);else previous = 0;
    }
    steamLoop.current = () => {
      if (value === null && !document.hidden && !media.matches) value = requestAnimationFrame(frame);
    };
    clearSteam.current = clear;
    return () => {
      clear();
      steamLoop.current = null;
      clearSteam.current = null;
    };
  }, []);
  React.useEffect(() => () => actionAudioRef.current?.dispose(), []);
  function paint(clientX, clientY) {
    if (!ready || !canvas.current) return false;
    const rect = canvas.current.getBoundingClientRect();
    const outer = root.current.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      last.current = null;
      actionAudioRef.current?.stop();
      return false;
    }
    const x = (clientX - rect.left) * canvas.current.width / rect.width;
    const y = (clientY - rect.top) * canvas.current.height / rect.height;
    const context = canvas.current.getContext('2d');
    const radius = outer.width * brush * 0.5 * canvas.current.width / rect.width;
    context.globalCompositeOperation = 'destination-out';
    context.lineWidth = radius * 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    if (last.current) {
      context.moveTo(last.current.x, last.current.y);
      context.lineTo(x, y);
      context.stroke();
    } else {
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    const distance = last.current ? Math.hypot(x - last.current.x, y - last.current.y) : 1;
    if (distance >= 0.6) actionAudio()?.move(0.65 + Math.min(distance / 60, 0.35));
    last.current = {
      x,
      y
    };
    setStarted(true);
    const localX = clientX - outer.left;
    const localY = clientY - outer.top;
    if (cursor.current) {
      cursor.current.style.left = localX + 'px';
      cursor.current.style.top = localY + 'px';
      cursor.current.style.opacity = '1';
    }
    const time = Date.now();
    const previousSteam = lastSteam.current;
    if (!document.hidden && root.current?.dataset?.reducedMotion !== 'true' && (!previousSteam || Math.hypot(localX - previousSteam.x, localY - previousSteam.y) >= 12 || time - previousSteam.time >= 60)) {
      lastSteam.current = {
        x: localX,
        y: localY,
        time: time
      };
      for (let value = 0; value < Math.min(10, Number(cfg.PARTICLE_COUNT) || 3); value++) particles.current.push({
        x: localX + (Math.random() - 0.5) * 18,
        y: localY - 26,
        size: 7 + Math.random() * 4,
        life: 1100 + Math.random() * 400,
        rise: 0.032 + Math.random() * 0.018,
        drift: (Math.random() - 0.5) * 0.014,
        phase: Math.random() * Math.PI * 2,
        tilt: (Math.random() - 0.5) * 0.35,
        turn: (Math.random() - 0.5) * 0.7,
        age: 0
      });
    }
    if (particles.current.length > 60) particles.current.splice(0, particles.current.length - 60);
    if (particles.current.length) steamLoop.current?.();
    return true;
  }
  function down(event) {
    if (event.isPrimary === false || event.button !== 0 || pointer.current !== null || !ready) return;
    if (!paint(event.clientX, event.clientY)) return;
    actionAudio()?.arm();
    actionAudio()?.move(0.75);
    pointer.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function move(event) {
    if (pointer.current !== event.pointerId) return;
    paint(event.clientX, event.clientY);
  }
  function up(event) {
    if (pointer.current !== event.pointerId) return;
    paint(event.clientX, event.clientY);
    handleAction();
  }
  function cancel(event) {
    if (pointer.current === event.pointerId) handleAction();
  }
  function key(event) {
    const change = {
      ArrowLeft: [-0.025, 0],
      ArrowRight: [0.025, 0],
      ArrowUp: [0, -0.025],
      ArrowDown: [0, 0.025]
    }[event.key];
    if (!ready || !change && ![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (change) {
      keyboard.current.x = Math.max(0, Math.min(1, keyboard.current.x + change[0]));
      keyboard.current.y = Math.max(0, Math.min(1, keyboard.current.y + change[1]));
    }
    actionAudio()?.arm();
    const dimensions = canvas.current.getBoundingClientRect();
    paint(dimensions.left + keyboard.current.x * dimensions.width, dimensions.top + keyboard.current.y * dimensions.height);
  }
  return <main ref={root} className={'bead-game ui-game'} aria-label={cfg.GAME_TITLE}>{<style>{`
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

@font-face{font-family:"Nunito Sans";src:url("./assets/fonts/ui/NunitoSans.woff") format("woff");font-style:normal;font-weight:100 1000;font-display:swap}
:root{--font-display:"Nunito Sans","PingFang SC",system-ui,sans-serif;--font-body:"Nunito Sans","PingFang SC",system-ui,sans-serif;--ui-ink:#244e68;--ui-surface:#fafaf7}
.ui-game{font-family:var(--font-body);font-optical-sizing:auto;font-synthesis:none;-webkit-font-smoothing:antialiased}
.ui-game button{font-family:var(--font-body);font-weight:700;letter-spacing:0;line-height:1.25}
.ui-game .ui-guide{font-family:var(--font-body);font-weight:600;letter-spacing:0;line-height:1.35}

html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#fafaf7}
.bead-game{position:relative;width:100%;height:100%;container-type:size;background:#fafaf7;font-family:"Nunito Sans",sans-serif;touch-action:none;overflow:hidden}
.bead-board{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(calc(100cqw - 2 * var(--ui-side)),62cqh,calc(100cqh - 2 * var(--ui-bottom) - 104px))}
.bead-board>img,.bead-board>canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
.bead-board>canvas{cursor:grab;touch-action:none}
.bead-board>canvas:active{cursor:grabbing}
.bead-board>canvas:focus-visible{outline:3px solid #287b67;outline-offset:4px}
.bead-guide{top:12%;color:#244e68;font-weight:650;letter-spacing:0}
.bead-steam{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5}
.bead-iron{position:absolute;left:0;top:0;opacity:0;transform:translate(-50%,-50%);pointer-events:none;z-index:10;image-rendering:auto;object-fit:contain}
.bead-loading{position:absolute;inset:0;display:grid;place-items:center;padding:20px;text-align:center;background:#fafaf7;color:#303c37;font-size:18px}
.bead-reset{position:absolute;left:50%;bottom:var(--ui-bottom);transform:translateX(-50%);border:1px solid #b2cbdc;border-radius:999px;padding:11px 28px;color:#244e68;background:#f2f8fb;font:700 calc(18px * var(--ui-scale))/1.25 "Nunito Sans",sans-serif;cursor:pointer}
.bead-reset:active{background:#deedf6}
`}</style>}{!started && <p className={'bead-guide ui-guide ui-float'}>{guide}</p>}{<div ref={board} className={'bead-board'} style={{
      aspectRatio: String(ratio)
    }}>{<img src={cfg.BG_PIXEL || ''} alt={"Disegno di perline fuse"} draggable={false} style={{
        visibility: ready ? 'visible' : 'hidden'
      }} />}{<canvas ref={canvas} style={{
        visibility: ready ? 'visible' : 'hidden'
      }} tabIndex={0} role={'application'} aria-label={"Trascina il ferro sulle perline, oppure usa frecce e Spazio."} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={key} onKeyUp={() => {
        last.current = null;
        actionAudioRef.current?.stop();
      }} />}{!ready && <p className={'bead-loading'} role={'status'}>{error ? "Immagine non disponibile. Ricarica per riprovare." : "Caricamento delle perline…"}</p>}</div>}{<canvas ref={steam} className={'bead-steam'} aria-hidden={true} />}{<img ref={cursor} className={'bead-iron'} src={ironSrc} alt={''} draggable={false} aria-hidden={true} style={{
      width: `max(88px, ${brush * 196}cqmin)`
    }} />}{started && <button type={'button'} className={'bead-reset'} onClick={() => {
      restore();
      canvas.current?.focus({
        preventScroll: true
      });
    }}>{"Ricomincia"}</button>}</main>;
};
function App() {
  let [config, setConfig] = React.useState(null);
  React.useEffect(() => {
    let enabled = true;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        if (location.protocol === "file:") options = runtimeConfig;else {
          let value = await requestGameConfig();
          options = value.ok ? await value.json() : runtimeConfig;
        }
      } catch {}
      if (enabled) {
        setConfig(readConfigValues(options));
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  return config ? <div style={{
    width: "100%",
    height: "100%",
    position: "relative",
    containerType: "size"
  }}>{<GameStyles />}{<FuseBeadBoard cfg={config} />}</div> : <div style={{
    width: "100%",
    height: "100%",
    background: "#fff"
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
  const selectors = ["p.bead-guide"];
  const copy = new Set(["Trascina per scoprire!"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
