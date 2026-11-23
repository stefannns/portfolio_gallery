// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { flushSync } from 'react-dom';
import * as Tone from 'tone';
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
    "id": "GRAVITY",
    "kind": "number",
    "label": "Particle Gravity",
    "value": 0.0015,
    "default": 0.0015,
    "min": 0.0005,
    "max": 0.005,
    "step": 0.0001
  }, {
    "id": "COMBO_DECAY_MS",
    "kind": "number",
    "label": "Combo Reset Time (ms)",
    "value": 2000,
    "default": 2000,
    "min": 1000,
    "max": 5000,
    "step": 100
  }],
  "texts": [{
    "id": "LABEL_INSTRUCTION",
    "label": "Instruction Text",
    "value": "Trascina e scalda",
    "default": "Trascina e scalda",
    "max_length": 20
  }],
  "images": [{
    "id": "BG_MAIN",
    "label": "Main Background",
    "path": "./assets/bg_main.webp",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "99278849158007137",
    "version_id": "99278849158144913",
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
    body { background: #050b3b; -webkit-tap-highlight-color: transparent; }
    #thermal-overlay {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
    }
    #root canvas { opacity: 0; }
    #root .heading, #root .hint { z-index: 2; }
    #root .heading { color: #e5ffff !important; text-shadow: 0 0 13px #18badc !important; }
    #root .hint {
      color: #edffff !important;
      background: rgba(4, 16, 57, 0.82) !important;
      border-color: rgba(84, 234, 224, 0.46) !important;
      text-shadow: 0 0 8px #13c0d0 !important;
    }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}


#root .heading{display:none!important}#root .hint{left:30px!important;right:30px!important;bottom:50px!important;font-size:18px!important;letter-spacing:0!important;line-height:1.3!important}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .hint{position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

/* Only the four newly selected games. Host frame, gradients and launch pill stay host-owned. */
@keyframes batch4-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.68)}}
html:root:root :is(.color-guide,p.feed-first-action,.hint,#guide){animation:batch4-guide-breathe 2.4s ease-in-out infinite!important}
html[data-batch4-paused]:root:root :is(.color-guide,p.feed-first-action,.hint,#guide){animation-play-state:paused!important}
html[data-batch4-game="33"]:root:root p.feed-first-action{font-family:var(--font-body,system-ui,sans-serif)!important;font-weight:700!important;color:#17384a!important;background:#fff!important;border-radius:999px!important;padding:10px 18px!important;box-sizing:border-box;text-shadow:none!important;box-shadow:0 3px 12px #001b3833}
html[data-batch4-game="33"] .hud{justify-content:center}
/* Keep the CTA preview focused on the demonstration. Restore the HUD on entry. */
html[data-batch4-game="33"][data-batch4-preview="true"] .hud,
html[data-batch4-game="9"][data-batch4-preview="true"] .color-header{visibility:hidden!important}
[data-net-preview-guide]{display:none}
html[data-batch4-preview="true"] [data-net-preview-guide]:not([hidden]){display:block;color:#e4faff;font-size:18px;line-height:1.35}
html[data-batch4-game="47"][data-batch4-preview="true"]:root:root .hint{visibility:visible!important}
html[data-batch4-preview="false"]:root:root .hint[style*="visibility: hidden"]{animation:none!important}
html:root:root .color-guide{position:fixed;z-index:25;top:24%;left:50%;translate:-50% -50%;width:max-content;max-width:calc(100% - 60px);margin:0;text-align:center;pointer-events:none;color:#334155;font:700 18px/1.4 var(--font-display,system-ui,sans-serif)}
.color-guide[hidden]{display:none!important}
html:root:root .color-header{position:absolute;inset:0;pointer-events:none;padding:0!important;z-index:10!important}
html:root:root .color-panel{position:static!important;padding:0!important;box-shadow:none!important;background:transparent!important;pointer-events:none}
html:root:root .color-round{position:absolute;top:30px;left:30px}
html:root:root .color-round-group>div:not(.color-round){display:none}
html:root:root .color-target-group{position:absolute;top:30px;left:calc(50% - 18px);transform:none;pointer-events:auto}
html:root:root .color-target-swatch{width:36px!important;height:36px!important}
html:root:root .color-reset{position:fixed;bottom:50px;right:30px}
html:root:root .color-match-hud{position:fixed;top:30px;right:30px}
html:root:root .color-progress-row{position:absolute;top:82px;left:30px;right:30px;pointer-events:none}
html:root:root .color-bowl-wrap{position:absolute;inset:0;padding:0!important;pointer-events:none}
html:root:root .color-mix-bowl{position:absolute!important;left:50%!important;top:47%!important;translate:-50% -50%;transform:none!important;min-width:0!important;box-sizing:border-box!important;width:min(62vw,35vh)!important;height:auto;pointer-events:auto}
html:root:root .color-mix-bowl>div:not(.color-preview-paint){display:none}
html:root:root .color-tubes{position:absolute;left:30px;right:30px;top:66%;height:13%;padding:0!important;background:transparent!important;box-shadow:none!important;pointer-events:auto}
html:root:root .color-tubes>div{height:100%!important}
html[data-batch4-preview="true"] .color-reset{visibility:hidden;pointer-events:none}
.color-preview-paint{position:absolute;inset:8%;border-radius:50%;pointer-events:none;display:none;background:radial-gradient(ellipse at 35% 35%,#fba6b0 0%,#cf637b 26%,#6b5dcc 64%,#3b4a9f 100%);box-shadow:inset 0 8px 18px #ffffff45}
.color-preview-tube{position:absolute!important;top:0;left:0;width:var(--paint-tw)!important;height:var(--paint-th)!important;box-sizing:border-box;pointer-events:none;z-index:15;display:none;border:3px solid #0f172ab8;border-radius:14px 14px 9px 9px;background:linear-gradient(#ff8794,#d62839);filter:drop-shadow(0 4px 6px #0003)}
html[data-batch4-preview="true"] .color-preview-paint{display:block;animation:paint-mix-preview 3.6s ease-in-out infinite}
html[data-batch4-preview="true"] .color-preview-tube{display:block;animation:paint-tube-preview 3.6s ease-in-out infinite}
@keyframes paint-mix-preview{0%,18%,100%{opacity:0;scale:.35}46%,72%{opacity:1;scale:1}86%{opacity:.2;scale:1}}
@keyframes paint-tube-preview{0%,7%{opacity:0;transform:translate(calc(var(--paint-sx) - 50%),calc(var(--paint-sy) - 50%)) rotate(0)}14%{opacity:1}40%,62%{opacity:1;transform:translate(calc(var(--paint-ex) - 50%),calc(var(--paint-ey) - 50%)) rotate(-22deg)}78%,100%{opacity:0;transform:translate(calc(var(--paint-ex) - 50%),calc(var(--paint-ey) - 50%)) rotate(-22deg)}}
html[data-batch4-paused] :is(.color-preview-paint,.color-preview-tube){animation-play-state:paused!important}
html:root:root #stage #guide{visibility:visible!important;color:#30251e!important;text-shadow:none!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.color-guide,p.feed-first-action,.hint,#guide){animation:none!important}.color-preview-tube{display:none!important}.color-preview-paint{animation:none!important;opacity:.7!important;scale:1!important}}

/* Italian copy keeps the approved role sizes and may wrap instead of clipping. */
html[lang="it"] :is(.meeting-guide,.feed-first-action,.melody-guide,.particle-guide,.dive-guide,.sandbox-guide,.koi-guide,.ui-guide,.bead-guide,.coloring-guide,.look-guide,.time-print-guide){white-space:normal;overflow-wrap:normal;word-break:normal;line-height:1.4}
html[lang="it"] :is(button,.btn,.btn-neon){overflow-wrap:normal;word-break:normal}
html[lang="it"] .melody-controls button{font-size:18px;padding-inline:12px}
html[lang="it"] .meeting-sand-ball-count{gap:6px!important}
html[lang="it"] #people-dialog fieldset label{min-width:0}
html[lang="it"] #people-dialog input{max-width:100%;min-width:0}
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES + '\n#root #thermal-overlay{opacity:1}';
document.head.append(gameStyle);
document.documentElement.lang = 'it';
function readConfigValues(config) {
  let values = {};
  for (let value of config.tweaks || []) values[value.id] = value.value;
  for (let value of config.texts || []) values[value.id] = value.value;
  for (let value of config.images || []) values[value.id] = value.path;
  for (let value of config.mentions || []) values[value.id] = value.path || value.value;
  for (let value of config.motions || []) {
    if (value.base_path) {
      values[value.id] = value.base_path;
    }
    if (value.frame_count != null) {
      values[value.id + "_COUNT"] = value.frame_count;
    }
  }
  return values;
}
var TAU2 = Math.PI * 2;
function rotateHeatPoint(x, y, centerX, centerY, sector) {
  let angle = sector * TAU2 / 6;
  let offsetX = x - centerX;
  let offsetY = y - centerY;
  return {
    x: centerX + offsetX * Math.cos(angle) - offsetY * Math.sin(angle),
    y: centerY + offsetX * Math.sin(angle) + offsetY * Math.cos(angle)
  };
}
function App() {
  let canvasRef = React.useRef(null);
  let sceneRef = React.useRef({
    width: 0,
    height: 0,
    dpr: 1,
    radius: 0,
    point: null,
    pointerId: null,
    dragging: false,
    trail: [],
    lastFrame: 0,
    background: null,
    pulse: 0
  });
  let audioRef = React.useRef({
    ready: false,
    starting: false,
    synth: null
  });
  let [config, setConfig] = React.useState(null);
  let [guideUsed, setGuideUsed] = React.useState(false);
  let playNote = (y = "C5") => {
    try {
      if (audioRef.current.ready) {
        audioRef.current.synth.triggerAttackRelease(y, "32n");
      }
    } catch {}
  };
  let initAudio = () => {
    if (!(audioRef.current.ready || audioRef.current.starting)) {
      audioRef.current.starting = true;
      Tone.start().then(() => {
        let y = new Tone.Synth({
          oscillator: {
            type: "sine"
          },
          envelope: {
            attack: 0.005,
            decay: 0.07,
            sustain: 0.04,
            release: 0.11
          }
        }).toDestination();
        y.volume.value = -20;
        audioRef.current.synth = y;
        audioRef.current.ready = true;
      }).catch(() => {}).finally(() => {
        audioRef.current.starting = false;
      });
    }
  };
  React.useEffect(() => {
    let y = true;
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
      let config2 = readConfigValues(options);
      let image = new Image();
      image.onload = () => {
        if (y) {
          sceneRef.current.background = image;
        }
      };
      image.onerror = () => {};
      image.src = config2.BG_MAIN || "";
      if (y) {
        setConfig(config2);
      }
    })();
    return () => {
      y = false;
      audioRef.current.synth?.dispose();
    };
  }, []);
  let constrainPoint = (y, otherValue) => {
    let dimensions = sceneRef.current;
    let value = dimensions.width / 2;
    let value2 = dimensions.height / 2;
    let value3 = y - value;
    let value4 = otherValue - value2;
    let value5 = Math.hypot(value3, value4);
    if (value5 > dimensions.radius) {
      value3 *= dimensions.radius / value5;
      value4 *= dimensions.radius / value5;
    }
    let point = {
      x: value + value3,
      y: value2 + value4
    };
    if (!dimensions.point || Math.hypot(point.x - dimensions.point.x, point.y - dimensions.point.y) >= 2) {
      dimensions.point = point;
      dimensions.trail.push({
        x: point.x,
        y: point.y,
        age: 0
      });
      if (dimensions.trail.length > 90) {
        dimensions.trail.shift();
      }
    }
  };
  let pointerPosition = y => {
    let bounds = canvasRef.current.getBoundingClientRect();
    return {
      x: y.clientX - bounds.left,
      y: y.clientY - bounds.top
    };
  };
  let startDragging = y => {
    if (y.isPrimary === false) return;
    y.preventDefault();
    initAudio();
    let event = sceneRef.current;
    let point = pointerPosition(y);
    event.pointerId = y.pointerId;
    event.dragging = true;
    canvasRef.current.setPointerCapture?.(y.pointerId);
    constrainPoint(point.x, point.y);
    setGuideUsed(true);
    playNote("E5");
    try {
      window.tt?.vibrate?.({
        style: "light"
      });
    } catch {}
  };
  let continueDragging = y => {
    let event = sceneRef.current;
    if (!event.dragging || y.pointerId !== event.pointerId) return;
    y.preventDefault();
    let point = pointerPosition(y);
    constrainPoint(point.x, point.y);
  };
  let finishDragging = y => {
    let event = sceneRef.current;
    if (y.pointerId === event.pointerId) {
      event.dragging = false;
      event.pointerId = null;
      if (canvasRef.current?.hasPointerCapture?.(y.pointerId)) {
        canvasRef.current.releasePointerCapture(y.pointerId);
      }
    }
  };
  let cancelDragging = y => {
    let event = sceneRef.current;
    if (y.pointerId === event.pointerId) {
      event.dragging = false;
      event.pointerId = null;
    }
  };
  let handleKeyDown = y => {
    let dimensions = sceneRef.current;
    let item = {
      ArrowLeft: [-13, 0],
      ArrowRight: [13, 0],
      ArrowUp: [0, -13],
      ArrowDown: [0, 13]
    }[y.key];
    if (!item) return;
    y.preventDefault();
    let point = dimensions.point || {
      x: dimensions.width / 2 + Math.min(72, dimensions.radius),
      y: dimensions.height / 2
    };
    constrainPoint(point.x + item[0], point.y + item[1]);
    setGuideUsed(true);
  };
  React.useEffect(() => {
    if (!config || !canvasRef.current) return;
    let y = canvasRef.current;
    let context = y.getContext("2d");
    let value;
    let handleAction = () => {
      let dimensions = sceneRef.current;
      let dimensions2 = y.getBoundingClientRect();
      let width = dimensions.width;
      let height = dimensions.height;
      if (dimensions.width = dimensions2.width, dimensions.height = dimensions2.height, dimensions.dpr = Math.min(devicePixelRatio || 1, 3), dimensions.radius = Math.max(40, Math.min(dimensions.width / 2 - 52, dimensions.height / 2 - 100)), y.width = Math.round(dimensions.width * dimensions.dpr), y.height = Math.round(dimensions.height * dimensions.dpr), width && height && dimensions.point) {
        let value2 = width / 2;
        let value3 = height / 2;
        let value4 = (dimensions.point.x - value2) / width;
        let z = (dimensions.point.y - value3) / height;
        constrainPoint(dimensions.width / 2 + value4 * dimensions.width, dimensions.height / 2 + z * dimensions.height);
      }
    };
    handleAction();
    let resizeObserver = observeGameSize(handleAction);
    resizeObserver.observe(y);
    let handleAction2 = (value2, otherValue, value3 = 1, value4 = 1, value5 = false) => {
      let value6 = 31 * value4;
      context.save();
      context.globalAlpha = value3;
      let radialGradient = context.createRadialGradient(value2, otherValue, 2, value2, otherValue, value6 * 1.45);
      radialGradient.addColorStop(0, "#fff4b0");
      radialGradient.addColorStop(0.19, "#ff6b32");
      radialGradient.addColorStop(0.38, "#ed1729");
      radialGradient.addColorStop(0.68, "rgba(179,0,22,.68)");
      radialGradient.addColorStop(1, "rgba(179,0,22,0)");
      context.fillStyle = radialGradient;
      context.beginPath();
      context.arc(value2, otherValue, value6 * 1.45, 0, TAU2);
      context.fill();
      context.fillStyle = "#ff3b2e";
      context.shadowColor = "#f20c2d";
      context.shadowBlur = 17;
      context.beginPath();
      context.arc(value2, otherValue, 10 * value4, 0, TAU2);
      context.fill();
      context.shadowBlur = 0;
      if (value5) {
        context.strokeStyle = "rgba(255,237,189,.95)";
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(value2, otherValue, 17 * value4, 0, TAU2);
        context.stroke();
      }
      context.restore();
    };
    let handleAction3 = value2 => {
      value = requestAnimationFrame(handleAction3);
      let dimensions = sceneRef.current;
      let value3 = dimensions.lastFrame ? Math.min((value2 - dimensions.lastFrame) / 1000, 0.04) : 0;
      dimensions.lastFrame = value2;
      dimensions.pulse += value3 * 2.7;
      context.setTransform(dimensions.dpr, 0, 0, dimensions.dpr, 0, 0);
      context.fillStyle = "#100a1a";
      context.fillRect(0, 0, dimensions.width, dimensions.height);
      if (dimensions.background) {
        context.drawImage(dimensions.background, 0, 0, dimensions.width, dimensions.height);
        context.fillStyle = "rgba(9,5,14,.73)";
        context.fillRect(0, 0, dimensions.width, dimensions.height);
      }
      let value4 = dimensions.width / 2;
      let value5 = dimensions.height / 2;
      context.strokeStyle = "rgba(231,75,83,.18)";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(value4, value5, dimensions.radius, 0, TAU2);
      context.stroke();
      context.beginPath();
      context.arc(value4, value5, dimensions.radius * 0.52, 0, TAU2);
      context.stroke();
      for (let value6 = 0; value6 < 6; value6++) {
        let value7 = value6 * TAU2 / 6;
        context.beginPath();
        context.moveTo(value4, value5);
        context.lineTo(value4 + Math.cos(value7) * dimensions.radius, value5 + Math.sin(value7) * dimensions.radius);
        context.stroke();
      }
      context.fillStyle = "#ff485d";
      context.shadowColor = "#fc183f";
      context.shadowBlur = 11;
      context.beginPath();
      context.arc(value4, value5, 3.3, 0, TAU2);
      context.fill();
      context.shadowBlur = 0;
      for (let value6 = dimensions.trail.length - 1; value6 >= 0; value6--) {
        let point = dimensions.trail[value6];
        if (point.age += value3, point.age > 1.05) {
          dimensions.trail.splice(value6, 1);
          continue;
        }
        let z = (1 - point.age / 1.05) * 0.28;
        for (let value7 = 0; value7 < 6; value7++) {
          let point2 = rotateHeatPoint(point.x, point.y, value4, value5, value7);
          context.fillStyle = `rgba(255,38,49,${z})`;
          context.beginPath();
          context.arc(point2.x, point2.y, 5.5 * (1 - point.age / 1.2), 0, TAU2);
          context.fill();
        }
      }
      if (dimensions.point) for (let value6 = 0; value6 < 6; value6++) {
        let point = rotateHeatPoint(dimensions.point.x, dimensions.point.y, value4, value5, value6);
        handleAction2(point.x, point.y, value6 === 0 ? 1 : 0.91, 1 + 0.055 * Math.sin(dimensions.pulse + value6), value6 === 0);
      }
    };
    value = requestAnimationFrame(handleAction3);
    return () => {
      cancelAnimationFrame(value);
      resizeObserver.disconnect();
    };
  }, [config]);
  return <div className={"shell"}>{<style>{`
      @font-face{font-family:Audiowide;src:url('./assets/fonts/audiowide/Audiowide-Regular.woff2') format('woff2');font-display:swap}
      html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#100a1a;touch-action:none;overscroll-behavior:none}
      *{box-sizing:border-box}.shell{position:relative;width:100%;height:100%;overflow:hidden;color:#fff;font-family:Audiowide,system-ui,sans-serif}
      canvas{display:block;width:100%;height:100%;touch-action:none;cursor:crosshair;outline:none}
      canvas:focus-visible{outline:2px solid #ff7c79;outline-offset:-5px}
      .heading{position:absolute;top:calc(40px + env(safe-area-inset-top));left:max(26px,env(safe-area-inset-left));right:max(26px,env(safe-area-inset-right));text-align:center;pointer-events:none;font-size:clamp(19px,5.3vw,27px);color:#ffb6a3;text-shadow:0 0 13px #d40d36;line-height:1.2}
      .hint{position:absolute;bottom:calc(45px + env(safe-area-inset-bottom));left:26px;right:26px;text-align:center;pointer-events:none;color:#ffe0d8;font-size:clamp(12px,3.4vw,16px);line-height:1.4;text-shadow:0 0 8px #f72143;background:rgba(12,6,23,.76);border:1px solid rgba(255,103,111,.36);border-radius:12px;padding:9px 13px}
    `}</style>}{<canvas ref={canvasRef} tabIndex={0} onPointerDown={startDragging} onPointerMove={continueDragging} onPointerUp={finishDragging} onPointerCancel={cancelDragging} onKeyDown={handleKeyDown} aria-label={"Tocca o trascina il punto rosso per creare cinque scie di calore"} />}{<div className={"hint"} style={{
      visibility: guideUsed ? "hidden" : "visible"
    }} aria-hidden={guideUsed}>{config?.LABEL_INSTRUCTION || "TRASCINA E SCALDA"}</div>}</div>;
}

// ./preview-models.js
/* Read-only demonstration poses. No scoring, timers, input or game-state writes. */
(function (root) {
  'use strict';

  const clamp = (value2, value3 = 0, value4 = 1) => Math.max(value3, Math.min(value4, value2));
  function netPose(value2, width, height, columns, rows) {
    const phase = Math.max(0, value2) % 3600 / 3600;
    const pull = Math.sin(Math.PI * clamp((phase - 0.12) / 0.7)) ** 2;
    return {
      row: Math.round(rows * 0.57),
      col: Math.round(columns * 0.45),
      dx: Math.min(48, width * 0.12) * pull,
      dy: Math.min(32, height * 0.055) * pull,
      ratio: pull * 0.8
    };
  }
  function heatPose(value2, width, height, radius) {
    const value3 = Math.max(0, value2) / 1350;
    const reach = Math.min(radius * 0.45, width * 0.2, height * 0.17);
    return {
      x: width / 2 + Math.cos(value3) * reach,
      y: height / 2 + Math.sin(value3 * 1.37) * reach * 0.72
    };
  }
  const hairCycleMs = 2400;
  function hairPose(value2, geometry, reduced = false) {
    const phase = Math.max(0, value2) % hairCycleMs / hairCycleMs;
    const target = geometry.targetY - geometry.wearY;
    if (reduced) return {
      y: target,
      alpha: 1
    };
    return {
      y: 640 + geometry.height / 2 - (1280 + geometry.height) * phase,
      alpha: 1
    };
  }
  const value = Object.freeze({
    netPose,
    heatPose,
    hairPose,
    hairCycleMs
  });
  root.PlayablePreviewModels = value;
})(typeof window === 'object' ? window : globalThis);

// ./preview-controller.js
/* Game-specific FYP presentation. Never sends or simulates gameplay input. */
(() => {
  'use strict';

  const game = Number({
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "47"
      }[name] ?? null;
    },
    dataset: {
      game: "47"
    }
  }?.dataset.game);
  const html = document.documentElement;
  const hosted = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('host') === 'fyp' || new URLSearchParams(location.search).get('feedReview') === '1';
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  let preview = hosted;
  let origin = performance.now();
  let used = false;
  let guide = null;
  let paintApp = null;
  html.dataset.batch4Game = String(game);
  function sync() {
    html.dataset.batch4Preview = String(preview);
    html.toggleAttribute('data-batch4-paused', document.hidden);
    html.toggleAttribute('data-batch4-reduced', media.matches);
  }
  function message(event) {
    if (event.source !== parent || parent === window || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    preview = event.data.active !== true;
    origin = performance.now();
    if (preview) {
      used = false;
      if (guide) guide.hidden = false;
    }
    sync();
    attachNet();
  }
  function mark(element, name) {
    if (element && !element.classList.contains(name)) element.classList.add(name);
    return element;
  }
  function geometry() {
    if (!paintApp) return;
    const bowl = paintApp.querySelector('.color-mix-bowl');
    const tube = paintApp.querySelector('.color-tubes img[alt="red"]');
    if (!bowl || !tube) return;
    const bounds = paintApp.getBoundingClientRect();
    const dimensions = bowl.getBoundingClientRect();
    const dimensions2 = tube.getBoundingClientRect();
    for (const [key, value] of Object.entries({
      sx: dimensions2.left - bounds.left + dimensions2.width / 2,
      sy: dimensions2.top - bounds.top + dimensions2.height / 2,
      ex: dimensions.left - bounds.left + dimensions.width * 0.56,
      ey: dimensions.top - bounds.top + dimensions.height * 0.38,
      tw: dimensions2.width,
      th: dimensions2.height
    })) paintApp.style.setProperty('--paint-' + key, value + 'px');
  }
  function attachPaint() {
    if (game !== 9) return;
    const value = document.querySelector('#root>div');
    const round = value?.querySelector('.color-round');
    if (!value || !round) return;
    paintApp = mark(value, 'color-game');
    const panel = mark(round.parentElement?.parentElement?.parentElement, 'color-panel');
    if (!panel) return;
    mark(panel.parentElement, 'color-header');
    mark(round.parentElement, 'color-round-group');
    const reset = mark(panel.querySelector('button'), 'color-reset');
    mark(reset?.previousElementSibling, 'color-target-swatch');
    mark(reset?.parentElement, 'color-target-group');
    if (reset) reset.setAttribute('aria-label', "Svuota la ciotola");
    mark(panel.lastElementChild, 'color-progress-row');
    const bowl = mark([...value.querySelectorAll('div')].find(item => item.style.aspectRatio === '1 / 1' || item.style.aspectRatio === '1/1'), 'color-mix-bowl');
    if (!bowl) return;
    mark(bowl.parentElement, 'color-bowl-wrap');
    const value2 = value.querySelector('img[alt="red"]');
    mark(value2?.parentElement?.parentElement?.parentElement, 'color-tubes');
    if (!guide || !guide.isConnected) {
      guide = document.createElement('p');
      guide.className = 'color-guide';
      guide.textContent = "Trascina i colori nella ciotola";
      value.append(guide);
    }
    guide.hidden = used;
    if (!bowl.querySelector('.color-preview-paint')) {
      const paint = document.createElement('div');
      paint.className = 'color-preview-paint';
      paint.setAttribute('aria-hidden', 'true');
      bowl.append(paint);
    }
    // A direct tube image would match the legacy div:has(>img[src*=tube_])
    // repair and paint a full-width red pseudo-element on the entire game.
    if (value2 && !value.querySelector('.color-preview-tube')) {
      const ghost = document.createElement('div');
      ghost.className = 'color-preview-tube';
      ghost.setAttribute('aria-hidden', 'true');
      value2.addEventListener('load', geometry, {
        once: true
      });
      value.append(ghost);
    }
    geometry();
  }
  function input(event) {
    if (game !== 9 || preview || event.isPrimary === false || event.button > 0) return;
    if (event.target.closest('.color-tubes img')) {
      used = true;
      if (guide) guide.hidden = true;
    }
    if (event.target.closest('.color-reset')) {
      used = false;
      if (guide) guide.hidden = false;
    }
  }
  function attachNet() {
    if (game !== 33) return;
    const root = document.getElementById('root');
    if (!root) return;
    let copy = root.querySelector('[data-net-preview-guide]');
    if (!copy) {
      copy = document.createElement('p');
      copy.className = 'feed-first-action';
      copy.dataset.netPreviewGuide = '';
      copy.textContent = "Trascina per strappare la rete";
      root.append(copy);
    }
    const hidden = !!root.querySelector('p.feed-first-action:not([data-net-preview-guide])');
    if (copy.hidden !== hidden) copy.hidden = hidden;
  }
  const observer = new MutationObserver(() => {
    attachPaint();
    attachNet();
  });
  if ([9, 33].includes(game) && document.getElementById('root')) observer.observe(document.getElementById('root'), {
    subtree: true,
    childList: true
  });
  const resize = observeGameSize(geometry);
  resize.observe(document.documentElement);
  window.PlayableBatch4Preview = Object.freeze({
    get active() {
      return preview && !document.hidden;
    },
    get reduced() {
      return media.matches;
    },
    elapsed(value = performance.now()) {
      return Math.max(0, value - origin);
    },
    netDrag(width, height, columns, rows, argument5) {
      return preview && !document.hidden && !media.matches ? window.PlayablePreviewModels.netPose(Math.max(0, argument5 - origin), width, height, columns, rows) : null;
    }
  });
  addEventListener('message', message);
  addEventListener('resize', geometry);
  document.addEventListener('pointerdown', input, {
    capture: true,
    passive: true
  });
  document.addEventListener('visibilitychange', sync);
  media.addEventListener?.('change', sync);
  addEventListener('pagehide', () => {
    observer.disconnect();
    resize.disconnect();
    removeEventListener('message', message);
    removeEventListener('resize', geometry);
    document.removeEventListener('pointerdown', input, true);
    document.removeEventListener('visibilitychange', sync);
    media.removeEventListener?.('change', sync);
  }, {
    once: true
  });
  sync();
  attachPaint();
  attachNet();
})();
// Mount the migrated canvas before initializing the thermal renderer.
flushSync(() => ReactDOM.createRoot(document.getElementById("root")).render(<React.Fragment><App /><canvas id={"thermal-overlay"} aria-hidden={"true"}></canvas></React.Fragment>));

// ./thermal-surface.js
(() => {
  const overlay = document.getElementById("thermal-overlay");
  const context = overlay.getContext("2d");
  const backdrop = document.createElement("canvas");
  const backdropCtx = backdrop.getContext("2d");
  const value2 = Math.PI * 2;
  const CELL = 6;
  const BRUSH_RADIUS = 78;
  const HEAT_DOTS = 5; // One controlled ball plus four mirrored balls.
  const COOL_PER_SECOND = 0.615;
  const heatColors = ["#4676bc", "#21abd2", "#f6e554", "#ffac2b", "#f66b50", "#eb308e"];
  let width = 0;
  let height = 0;
  let value3 = 1;
  let radius = 0;
  let columns = 0;
  let rows = 0;
  let heat = new Float32Array(0);
  let previewHeat = new Float32Array(0);
  let wasPreview = false;
  let point = null;
  let activePointer = null;
  let lastFrame = 0;
  const backgroundWaves = Array.from({
    length: 7
  }, (value, index) => ({
    y: (index + 0.65) / 7.5,
    amplitude: 8 + Math.random() * 22,
    wavelength: 120 + Math.random() * 190,
    secondary: 42 + Math.random() * 96,
    speed: (0.00008 + Math.random() * 0.0001) * (Math.random() < 0.5 ? -1 : 1),
    phase: Math.random() * value2,
    alpha: 0.018 + Math.random() * 0.025,
    width: 0.7 + Math.random() * 1.25
  }));
  function noise(index) {
    const value = Math.sin(index * 127.1 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  }
  function buildBackdrop() {
    backdrop.width = Math.ceil(width);
    backdrop.height = Math.ceil(height);
    const base = backdropCtx.createLinearGradient(0, 0, 0, height);
    base.addColorStop(0, "#79559f");
    base.addColorStop(0.58, "#865caa");
    base.addColorStop(1, "#7755a4");
    backdropCtx.fillStyle = base;
    backdropCtx.fillRect(0, 0, width, height);
    const ambientColors = ["#5198be", "#6a91c0", "#4da5c4", "#6780b7"];
    for (let value = 0; value < rows; value++) {
      for (let value4 = 0; value4 < columns; value4++) {
        const index = value * columns + value4;
        backdropCtx.fillStyle = ambientColors[Math.floor(noise(index + 19) * ambientColors.length)];
        backdropCtx.fillRect(value4 * CELL + 1, value * CELL + 1, CELL - 2, CELL - 2);
      }
    }
  }
  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    value3 = Math.min(window.devicePixelRatio || 1, 3);
    radius = Math.max(40, Math.min(width / 2 - 28, height / 2 - 90));
    columns = Math.ceil(width / CELL);
    rows = Math.ceil(height / CELL);
    heat = new Float32Array(columns * rows);
    previewHeat = new Float32Array(columns * rows);
    overlay.width = Math.round(width * value3);
    overlay.height = Math.round(height * value3);
    overlay.style.width = width + "px";
    overlay.style.height = height + "px";
    context.imageSmoothingEnabled = false;
    buildBackdrop();
  }
  function constrainPoint(clientX, clientY) {
    return {
      x: clientX,
      y: clientY
    };
  }
  function rotatePoint(source, otherValue, argument3, step) {
    const angle = step * value2 / HEAT_DOTS;
    const value = source.x - otherValue;
    const value4 = source.y - argument3;
    return {
      x: otherValue + value * Math.cos(angle) - value4 * Math.sin(angle),
      y: argument3 + value * Math.sin(angle) + value4 * Math.cos(angle)
    };
  }
  function depositAt(x, y, target = heat) {
    const minCol = Math.max(0, Math.floor((x - BRUSH_RADIUS) / CELL));
    const maxCol = Math.min(columns - 1, Math.ceil((x + BRUSH_RADIUS) / CELL));
    const minRow = Math.max(0, Math.floor((y - BRUSH_RADIUS) / CELL));
    const maxRow = Math.min(rows - 1, Math.ceil((y + BRUSH_RADIUS) / CELL));
    const radiusSquared = BRUSH_RADIUS * BRUSH_RADIUS;
    for (let value = minRow; value <= maxRow; value++) {
      for (let value4 = minCol; value4 <= maxCol; value4++) {
        const value5 = value4 * CELL + CELL / 2 - x;
        const value6 = value * CELL + CELL / 2 - y;
        const distanceSquared = value5 * value5 + value6 * value6;
        if (distanceSquared >= radiusSquared) continue;
        const strength = Math.pow(1 - distanceSquared / radiusSquared, 1.25);
        const index = value * columns + value4;
        target[index] = Math.max(target[index], strength);
      }
    }
  }
  function paintBetween(from, point2) {
    const value = width / 2;
    const value4 = height / 2;
    const distance = from ? Math.hypot(point2.x - from.x, point2.y - from.y) : 0;
    const steps = Math.max(1, Math.ceil(distance / (CELL * 1.4)));
    for (let sample = 0; sample <= steps; sample++) {
      const amount = sample / steps;
      const source = from ? {
        x: from.x + (point2.x - from.x) * amount,
        y: from.y + (point2.y - from.y) * amount
      } : point2;
      for (let step = 0; step < HEAT_DOTS; step++) {
        const reflected = rotatePoint(source, value, value4, step);
        depositAt(reflected.x, reflected.y);
      }
    }
    point = point2;
  }
  function render(value4) {
    requestAnimationFrame(render);
    if (document.hidden) {
      lastFrame = 0;
      return;
    }
    if (lastFrame && value4 - lastFrame < 30) return;
    const elapsed = lastFrame ? Math.min(8, (value4 - lastFrame) / 1000) : 0;
    lastFrame = value4;
    const preview = window.PlayableBatch4Preview?.active;
    const reduced = window.PlayableBatch4Preview?.reduced;
    if (preview !== wasPreview) {
      previewHeat.fill(0);
      wasPreview = preview;
    }
    if (preview) {
      const source = window.PlayablePreviewModels.heatPose(reduced ? 0 : window.PlayableBatch4Preview.elapsed(value4), width, height, radius);
      for (let step = 0; step < HEAT_DOTS; step++) {
        const point2 = rotatePoint(source, width / 2, height / 2, step);
        depositAt(point2.x, point2.y, previewHeat);
      }
    }
    const visibleHeat = preview ? previewHeat : heat;
    if (preview && reduced) value4 = 0;
    if (activePointer !== null && point) {
      for (let step = 0; step < HEAT_DOTS; step++) {
        const reflected = rotatePoint(point, width / 2, height / 2, step);
        depositAt(reflected.x, reflected.y);
      }
    }
    context.setTransform(value3, 0, 0, value3, 0, 0);
    context.drawImage(backdrop, 0, 0, width, height);
    context.save();
    context.globalCompositeOperation = "screen";
    context.lineCap = "round";
    for (const wave of backgroundWaves) {
      context.strokeStyle = `rgba(116, 231, 239, ${wave.alpha})`;
      context.lineWidth = wave.width;
      context.beginPath();
      for (let x = -12; x <= width + 12; x += 7) {
        const y = height * wave.y + Math.sin(x / wave.wavelength * value2 + value4 * wave.speed + wave.phase) * wave.amplitude + Math.sin(x / wave.secondary * value2 - value4 * wave.speed * 0.58 + wave.phase * 1.7) * wave.amplitude * 0.28;
        if (x === -12) context.moveTo(x, y);else context.lineTo(x, y);
      }
      context.stroke();
    }
    context.restore();
    const cellsByColor = heatColors.map(() => []);
    for (let index = 0; index < visibleHeat.length; index++) {
      const value = visibleHeat[index] = Math.max(0, visibleHeat[index] - elapsed * COOL_PER_SECOND);
      if (value < 0.08) continue;
      const patterned = value + (noise(index + 827) - 0.5) * 0.12;
      const band = patterned > 0.76 ? 5 : patterned > 0.6 ? 4 : patterned > 0.43 ? 3 : patterned > 0.23 ? 2 : patterned > 0.13 ? 1 : 0;
      cellsByColor[band].push(index);
    }
    for (let band = 0; band < heatColors.length; band++) {
      context.fillStyle = heatColors[band];
      context.beginPath();
      for (const index of cellsByColor[band]) {
        const value = index % columns;
        const value5 = Math.floor(index / columns);
        context.rect(value * CELL + 0.65, value5 * CELL + 0.65, CELL - 1.3, CELL - 1.3);
      }
      context.fill();
    }
  }
  function attachInput() {
    const inputCanvas = document.querySelector("#root canvas");
    if (!inputCanvas) return requestAnimationFrame(attachInput);
    inputCanvas.addEventListener("pointerdown", event => {
      if (event.isPrimary === false) return;
      event.preventDefault();
      activePointer = event.pointerId;
      inputCanvas.setPointerCapture?.(event.pointerId);
      paintBetween(null, constrainPoint(event.clientX, event.clientY));
    });
    inputCanvas.addEventListener("pointermove", event => {
      if (event.pointerId === activePointer) {
        event.preventDefault();
        paintBetween(point, constrainPoint(event.clientX, event.clientY));
      }
    });
    const release = event => {
      if (event.pointerId === activePointer) {
        activePointer = null;
        point = null;
      }
    };
    inputCanvas.addEventListener("pointerup", release);
    inputCanvas.addEventListener("pointercancel", release);
    inputCanvas.addEventListener("lostpointercapture", release);
    inputCanvas.addEventListener("keydown", event => {
      const move = {
        ArrowLeft: [-14, 0],
        ArrowRight: [14, 0],
        ArrowUp: [0, -14],
        ArrowDown: [0, 14]
      }[event.key];
      if (!move) return;
      event.preventDefault();
      const from = point || {
        x: width / 2 + 40,
        y: height / 2
      };
      paintBetween(from, constrainPoint(from.x + move[0], from.y + move[1]));
    });
    const heading = document.querySelector("#root .heading");
    if (heading) heading.textContent = "THERMAL MIRROR";
  }
  window.addEventListener("resize", resize, {
    passive: true
  });
  resize();
  attachInput();
  requestAnimationFrame(render);
})();

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

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [".hint"];
  const copy = new Set(["Trascina e scalda"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
