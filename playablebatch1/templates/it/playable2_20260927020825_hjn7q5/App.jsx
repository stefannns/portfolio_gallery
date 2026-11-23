// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
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
    "id": "GLOW_INTENSITY",
    "kind": "number",
    "label": "Glow Intensity",
    "value": 15,
    "default": 15,
    "min": 5,
    "max": 40,
    "step": 1
  }, {
    "id": "LINE_WIDTH",
    "kind": "number",
    "label": "Line Width",
    "value": 4,
    "default": 4,
    "min": 1,
    "max": 12,
    "step": 0.5
  }, {
    "id": "TRAIL_LIFE",
    "kind": "number",
    "label": "Trail Duration (ms)",
    "value": 1500,
    "default": 1500,
    "min": 500,
    "max": 5000,
    "step": 100
  }],
  "texts": [{
    "id": "TITLE",
    "label": "Game Title",
    "value": "Tela musicale",
    "default": "Tela musicale",
    "max_length": 24
  }, {
    "id": "BTN_START",
    "label": "Start Button",
    "value": "INIZIA",
    "default": "INIZIA",
    "max_length": 12
  }],
  "images": [{
    "id": "BG_OVERLAY",
    "label": "Background Texture",
    "path": "./assets/soundboard-realistic-v1.webp",
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
    html,body,#root{width:100%;height:100%;margin:0;padding:0;overflow:hidden;background:#a36a3d}
    body{-webkit-tap-highlight-color:transparent}
  

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
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .melody-guide{position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .melody-guide span{background:transparent!important;padding:0!important;border:0!important;border-radius:0!important;box-shadow:none!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.melody-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.melody-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.melody-guide){animation:none!important}}

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
var melodyStrings = (() => {
  const clamp = (value, otherValue, argument3) => Math.max(otherValue, Math.min(argument3, value));
  function geometry(value, otherValue) {
    const scale = Math.min(value / 390, otherValue / 598);
    const left = 30 * scale;
    const right = value - left;
    return {
      w: value,
      h: otherValue,
      scale,
      left,
      right,
      top: 78 * scale,
      bottom: otherValue - 184 * scale,
      step: (right - left) / 15
    };
  }
  const handleAction = (value, otherValue) => value.left + value.step * (otherValue + 0.5);
  const indexAt = (value, x) => clamp(Math.floor((x - value.left) / value.step), 0, 14);
  const inside = (value, point) => point.x >= value.left - value.step / 2 && point.x <= value.right + value.step / 2 && point.y >= value.top && point.y <= value.bottom;
  function pluck(value, otherValue, amplitude, life) {
    value.time = otherValue;
    value.amplitude = clamp(amplitude, 2, 18);
    value.life = clamp(life, 500, 5000);
  }
  function offset(value, otherValue, argument3, reduce) {
    const held = value.hold;
    if (held) {
      const y = clamp(held.u, 0.025, 0.975);
      return held.bend * (otherValue <= y ? otherValue / y : (1 - otherValue) / (1 - y));
    }
    const value2 = Math.max(0, argument3 - value.time);
    const decay = Math.exp(-5 * value2 / value.life);
    if (value2 >= value.life || decay * value.amplitude < 0.06 || reduce) return 0;
    const seconds = value2 / 1000;
    return value.amplitude * decay * (Math.sin(Math.PI * otherValue) * Math.sin(seconds * value.frequency * 2 * Math.PI) + 0.22 * Math.sin(2 * Math.PI * otherValue) * Math.sin(seconds * value.frequency * 4 * Math.PI + 0.4));
  }
  function metal(context, x, y, argument4) {
    const fill = context.createRadialGradient(x - argument4 * 0.3, y - argument4 * 0.35, 0.1, x, y, argument4);
    fill.addColorStop(0, '#f4e8d0');
    fill.addColorStop(0.35, '#b2a58d');
    fill.addColorStop(0.75, '#716754');
    fill.addColorStop(1, '#322c25');
    context.fillStyle = fill;
    context.beginPath();
    context.arc(x, y, argument4, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(26,19,13,.7)';
    context.lineWidth = 0.8;
    context.stroke();
    context.strokeStyle = '#4a4235';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x - argument4 * 0.44, y - argument4 * 0.12);
    context.lineTo(x + argument4 * 0.44, y + argument4 * 0.12);
    context.stroke();
  }
  function backdrop(context, otherValue, texture) {
    const {
      w: value,
      h: value2,
      scale
    } = otherValue;
    const base = context.createLinearGradient(0, 0, value, value2);
    base.addColorStop(0, '#765235');
    base.addColorStop(0.55, '#64452f');
    base.addColorStop(1, '#4d3628');
    context.fillStyle = base;
    context.fillRect(0, 0, value, value2);
    if (texture) {
      context.save();
      context.globalAlpha = 0.48;
      context.filter = 'blur(1.25px)';
      const value3 = Math.max((value + 8) / texture.width, (value2 + 8) / texture.height);
      const value4 = texture.width * value3;
      const value5 = texture.height * value3;
      context.drawImage(texture, (value - value4) / 2, (value2 - value5) / 2, value4, value5);
      context.restore();
    }
    const shade = context.createLinearGradient(0, 0, value, 0);
    shade.addColorStop(0, 'rgba(25,13,7,.16)');
    shade.addColorStop(0.3, 'rgba(255,212,152,.03)');
    shade.addColorStop(1, 'rgba(25,13,7,.22)');
    context.fillStyle = shade;
    context.fillRect(0, 0, value, value2);
    for (const y of [otherValue.top, otherValue.bottom]) {
      context.shadowColor = 'rgba(31,15,4,.5)';
      context.shadowBlur = 7 * scale;
      context.shadowOffsetY = 4 * scale;
      const rail = context.createLinearGradient(0, y - 10 * scale, 0, y + 10 * scale);
      rail.addColorStop(0, '#7b512e');
      rail.addColorStop(0.12, '#ba8752');
      rail.addColorStop(0.28, '#865634');
      rail.addColorStop(1, '#4b2e1d');
      context.fillStyle = rail;
      context.fillRect(20 * scale, y - 9 * scale, value - 40 * scale, 18 * scale);
      context.shadowBlur = 0;
      context.shadowOffsetY = 0;
      context.fillStyle = '#dbc294';
      context.fillRect(24 * scale, y - 1.7 * scale, value - 48 * scale, 3.4 * scale);
      context.fillStyle = 'rgba(249,229,185,.5)';
      context.fillRect(24 * scale, y - 1.7 * scale, value - 48 * scale, 0.7 * scale);
      metal(context, 29 * scale, y - 6 * scale, 1.8 * scale);
      metal(context, value - 29 * scale, y - 6 * scale, 1.8 * scale);
    }
    for (let value3 = 0; value3 < 15; value3++) {
      const x = handleAction(otherValue, value3);
      metal(context, x, otherValue.top - 21 * scale, 4.4 * scale);
      context.fillStyle = '#413225';
      context.fillRect(x - 1.3 * scale, otherValue.top - 29 * scale, 2.6 * scale, 12 * scale);
      context.fillStyle = '#bcb39b';
      context.fillRect(x - 1 * scale, otherValue.top - 28 * scale, 1.5 * scale, 3 * scale);
      metal(context, x, otherValue.bottom + 20 * scale, 3 * scale);
      context.strokeStyle = value3 < 6 ? '#b99a66' : '#cbc6b2';
      context.lineWidth = (value3 < 6 ? 1.45 : 0.9) * scale;
      context.beginPath();
      context.moveTo(x, otherValue.top - 19 * scale);
      context.lineTo(x, otherValue.top);
      context.moveTo(x, otherValue.bottom);
      context.lineTo(x, otherValue.bottom + 17 * scale);
      context.stroke();
    }
  }
  function draw(context, otherValue, strings, argument4, reduce, lineWidth, highlight) {
    const span = otherValue.bottom - otherValue.top;
    const scale = otherValue.scale;
    function path(value, x, shift) {
      context.beginPath();
      for (let value2 = 0; value2 <= 56; value2++) {
        const value3 = value2 / 56;
        const value4 = x + offset(value, value3, argument4, reduce) + shift;
        const value5 = otherValue.top + value3 * span;
        if (value2) {
          context.lineTo(value4, value5);
        } else {
          context.moveTo(value4, value5);
        }
      }
    }
    for (let value = 0; value < 15; value++) {
      const item = strings[value];
      const x = handleAction(otherValue, value);
      const gauge = (value < 6 ? 1.8 - value * 0.1 : 1.04 - (value - 6) * 0.035) * scale * clamp(lineWidth / 4, 0.65, 1.5);
      path(item, x, 2 * scale);
      context.strokeStyle = 'rgba(34,19,9,.32)';
      context.lineWidth = gauge + 1.4 * scale;
      context.stroke();
      path(item, x, 0);
      context.strokeStyle = value < 6 ? '#6f5131' : '#716f63';
      context.lineWidth = gauge + 0.65 * scale;
      context.stroke();
      path(item, x, -0.28 * scale);
      context.strokeStyle = value < 6 ? '#d1b078' : '#d6d7ce';
      context.lineWidth = gauge * 0.69;
      context.stroke();
      path(item, x, -0.38 * scale);
      context.strokeStyle = value < 6 ? '#f0d29e' : '#fff2d4';
      context.lineWidth = Math.max(0.28 * scale, gauge * 0.22);
      context.stroke();
      if (value < 6) {
        context.strokeStyle = 'rgba(62,39,17,.6)';
        context.lineWidth = 0.45 * scale;
        context.beginPath();
        const count = Math.ceil(span / (2.2 * scale));
        for (let value2 = 1; value2 < count; value2++) {
          const value3 = value2 / count;
          const value4 = x + offset(item, value3, argument4, reduce);
          const value5 = otherValue.top + value3 * span;
          context.moveTo(value4 - gauge * 0.6, value5 - 0.28 * scale);
          context.lineTo(value4 + gauge * 0.6, value5 + 0.28 * scale);
        }
        context.stroke();
      }
      if (item.hold) {
        const y = otherValue.top + clamp(item.hold.u, 0, 1) * span;
        const sheen = context.createLinearGradient(0, y - 28 * scale, 0, y + 28 * scale);
        sheen.addColorStop(0, 'rgba(255,235,176,0)');
        sheen.addColorStop(0.5, `rgba(255,235,176,${clamp(highlight / 40, 0.12, 0.55)})`);
        sheen.addColorStop(1, 'rgba(255,235,176,0)');
        path(item, x, 0);
        context.strokeStyle = sheen;
        context.lineWidth = gauge + 1.2 * scale;
        context.stroke();
      }
    }
  }
  function createStrings() {
    return Array.from({
      length: 15
    }, (value, otherValue) => ({
      time: -10000,
      amplitude: 0,
      life: 1500,
      frequency: 9 + otherValue * 0.65,
      hold: null
    }));
  }
  function drawLines(context, otherValue, strokes, elapsed = null) {
    context.save();
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const between = (point, point2, time) => {
      const value = clamp((time - point.time) / Math.max(1, point2.time - point.time), 0, 1);
      return {
        x: point.x + (point2.x - point.x) * value,
        y: point.y + (point2.y - point.y) * value
      };
    };
    const trace = (stroke, shift, until) => {
      context.beginPath();
      let count = 0;
      let previous = null;
      for (const point of stroke) {
        if (until !== null && point.time > until) {
          if (previous) {
            const point2 = between(previous, point, until);
            context.lineTo(otherValue.left + point2.x * (otherValue.right - otherValue.left) + shift, otherValue.top + point2.y * (otherValue.bottom - otherValue.top) + shift);
            count++;
          }
          break;
        }
        const x = otherValue.left + point.x * (otherValue.right - otherValue.left) + shift;
        const y = otherValue.top + point.y * (otherValue.bottom - otherValue.top) + shift;
        if (count++) {
          context.lineTo(x, y);
        } else {
          context.moveTo(x, y);
        }
        previous = point;
      }
      if (count === 1) {
        const point = stroke[0];
        context.lineTo(otherValue.left + point.x * (otherValue.right - otherValue.left) + shift + 0.01, otherValue.top + point.y * (otherValue.bottom - otherValue.top) + shift);
      }
      context.stroke();
    };
    const gold = context.createLinearGradient(otherValue.left, otherValue.top, otherValue.right, otherValue.bottom);
    gold.addColorStop(0, '#e1ab4b');
    gold.addColorStop(0.16, '#fff3c5');
    gold.addColorStop(0.24, '#fffdf1');
    gold.addColorStop(0.34, '#edbf69');
    gold.addColorStop(0.5, '#fff8da');
    gold.addColorStop(0.62, '#e5ad50');
    gold.addColorStop(0.76, '#fffdf1');
    gold.addColorStop(1, '#f5ce7c');
    const highlight = context.createLinearGradient(otherValue.left, otherValue.top, otherValue.right, otherValue.bottom);
    highlight.addColorStop(0, 'rgba(255,255,248,.45)');
    highlight.addColorStop(0.24, '#fffef5');
    highlight.addColorStop(0.4, 'rgba(255,255,248,.6)');
    highlight.addColorStop(0.76, '#fffef5');
    highlight.addColorStop(1, 'rgba(255,255,248,.55)');
    for (const stroke of strokes) {
      context.strokeStyle = gold;
      context.lineWidth = 3.8 * otherValue.scale;
      trace(stroke, 0, null);
      if (elapsed !== null) {
        context.strokeStyle = '#fff1bd';
        context.lineWidth = 2.4 * otherValue.scale;
        trace(stroke, 0, elapsed);
      }
      context.strokeStyle = highlight;
      context.lineWidth = 1.3 * otherValue.scale;
      trace(stroke, -0.5 * otherValue.scale, null);
    }
    if (elapsed !== null) for (const stroke of strokes) {
      let last = null;
      let previous = null;
      for (const value of stroke) {
        if (value.time <= elapsed) {
          last = value;
          previous = value;
        } else {
          if (previous) last = between(previous, value, elapsed);
          break;
        }
      }
      if (last) {
        const x = otherValue.left + last.x * (otherValue.right - otherValue.left);
        const y = otherValue.top + last.y * (otherValue.bottom - otherValue.top);
        context.fillStyle = '#e6b34f';
        context.beginPath();
        context.arc(x, y, 5 * otherValue.scale, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#fff9e1';
        context.beginPath();
        context.arc(x, y, 3.1 * otherValue.scale, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }
  return {
    clamp,
    geometry,
    xAt: handleAction,
    indexAt,
    inside,
    pluck,
    offset,
    backdrop,
    draw,
    drawLines,
    createStrings
  };
})();
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
var MELODY_NOTES = ["C3", "D3", "E3", "G3", "A3", "C4", "D4", "E4", "G4", "A4", "C5", "D5", "E5", "G5", "A5"];
function App() {
  const [config, setConfig] = React.useState(null);
  const [touched, setTouched] = React.useState(false);
  const surface = React.useRef(null);
  const canvas = React.useRef(null);
  const world = React.useRef({
    g: null,
    strings: melodyStrings.createStrings(),
    pointer: null,
    keyboard: 7,
    raf: 0,
    draw: null,
    background: null,
    strokes: [],
    notes: [],
    started: null,
    duration: 0,
    playback: null,
    version: 0
  });
  const sound = React.useRef({
    ready: false,
    pending: null,
    synth: null,
    reverb: null,
    lastNote: -1,
    lastTime: -1,
    latest: null,
    disposed: false
  });
  const [hasRecording, setHasRecording] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [status, setStatus] = React.useState('');
  React.useEffect(() => {
    let live = true;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        const value = await requestGameConfig();
        if (value.ok) options = await value.json();
      } catch {}
      if (live) setConfig(readConfigValues(options));
    })();
    return () => {
      live = false;
    };
  }, []);
  const playNote = (index, velocity, gain = 1) => {
    const audio = sound.current;
    if (!audio.ready || !audio.synth || audio.disposed) return;
    const timestamp = Tone.now();
    try {
      audio.synth.triggerAttackRelease(MELODY_NOTES[index], '8n', Math.max(timestamp, audio.lastTime + 0.001), Math.min(0.86, 0.35 + velocity * 0.1) * gain);
      audio.lastNote = index;
      audio.lastTime = timestamp;
    } catch {}
  };
  const unlock = () => {
    const audio = sound.current;
    if (audio.disposed) return Promise.resolve();
    if (audio.ready) {
      try {
        return Promise.resolve(Tone.start()).catch(() => {});
      } catch {
        return Promise.resolve();
      }
    }
    if (audio.pending) return audio.pending;
    audio.pending = (async () => {
      try {
        await Tone.start();
        if (audio.disposed) return;
        audio.synth = new Tone.PolySynth(Tone.FMSynth, {
          envelope: {
            attack: 0.05,
            decay: 0.2,
            sustain: 0.1,
            release: 1
          },
          harmonicity: 3,
          modulationIndex: 2,
          oscillator: {
            type: 'sine'
          },
          modulation: {
            type: 'square'
          },
          volume: -7
        }).toDestination();
        audio.reverb = new Tone.Reverb({
          decay: 2.5,
          wet: 0.3
        }).toDestination();
        audio.synth.connect(audio.reverb);
        audio.ready = true;
        if (audio.latest && performance.now() - audio.latest.time < 350) playNote(audio.latest.index, audio.latest.velocity);
      } catch {} finally {
        audio.pending = null;
      }
    })();
    return audio.pending;
  };
  const silence = () => {
    const audio = sound.current;
    audio.latest = null;
    audio.lastNote = -1;
    audio.lastTime = -1;
    try {
      audio.synth?.dispose();
      audio.reverb?.dispose();
    } catch {}
    audio.synth = null;
    audio.reverb = null;
    audio.ready = false;
  };
  const stop = () => {
    const current = world.current;
    current.version++;
    current.playback = null;
    setPlaying(false);
    silence();
    wake();
  };
  const wake = () => {
    const current = world.current;
    if (current.draw && !current.raf) current.raf = requestAnimationFrame(current.draw);
  };
  const strike = (index, velocity = 2, record = true, gain = 1) => {
    const current = world.current;
    if (!current.g) return;
    const time2 = performance.now();
    melodyStrings.pluck(current.strings[index], time2, (4 + velocity * 2.8) * current.g.scale, config?.TRAIL_LIFE || 1500);
    if (record) {
      const stroke = current.strokes.at(-1);
      if (!stroke) return;
      const time = time2 - stroke.started;
      current.notes.push({
        index,
        velocity,
        time,
        stroke: current.strokes.length - 1
      });
      current.duration = Math.max(current.duration, time);
      setHasRecording(true);
    }
    sound.current.latest = {
      index,
      velocity,
      time: time2
    };
    playNote(index, velocity, gain);
    wake();
  };
  function addPoint(point2, newStroke = false) {
    const current = world.current;
    const value = current.g;
    if (!value) return;
    if (current.started === null) current.started = performance.now();
    if (newStroke) {
      const stroke = [];
      stroke.started = performance.now();
      stroke.duration = 0;
      current.strokes.push(stroke);
    }
    const stroke = current.strokes.at(-1);
    if (!stroke) return;
    const point3 = {
      x: melodyStrings.clamp((point2.x - value.left) / (value.right - value.left), 0, 1),
      y: melodyStrings.clamp((point2.y - value.top) / (value.bottom - value.top), 0, 1),
      time: performance.now() - stroke.started
    };
    const last = stroke.at(-1);
    if (!last || Math.hypot((point3.x - last.x) * (value.right - value.left), (point3.y - last.y) * (value.bottom - value.top)) > 0.8 * value.scale) stroke.push(point3);
    stroke.duration = point3.time;
    current.duration = Math.max(current.duration, point3.time);
    wake();
  }
  const replay = async () => {
    const current = world.current;
    if (current.playback || playing) {
      stop();
      setStatus('');
      return;
    }
    if (!current.notes.length) return;
    releasePointer();
    silence();
    const version = ++current.version;
    setPlaying(true);
    setStatus('');
    sound.current.latest = null;
    await unlock();
    if (sound.current.disposed || version !== current.version) return;
    const notes = current.notes.slice().sort((leftItem, rightItem) => leftItem.time - rightItem.time || leftItem.stroke - rightItem.stroke);
    current.playback = {
      start: performance.now(),
      rate: 0.8,
      index: 0,
      notes,
      gain: 1 / Math.sqrt(current.strokes.length),
      end: notes.reduce((total, item) => Math.max(total, item.time), current.duration) + 500
    };
    if (!sound.current.ready) setStatus('Sound unavailable — showing your melody.');
    wake();
  };
  const reset = () => {
    releasePointer();
    stop();
    const current = world.current;
    current.strokes = [];
    current.notes = [];
    current.started = null;
    current.duration = 0;
    current.strings = melodyStrings.createStrings();
    setHasRecording(false);
    setTouched(false);
    setStatus('');
    wake();
  };
  React.useEffect(() => {
    if (!config || !surface.current || !canvas.current) return;
    const current = world.current;
    const dimensions = canvas.current;
    const context = dimensions.getContext('2d');
    if (!context) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const texture = new Image();
    let live = true;
    function resize() {
      const rect = surface.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const value = Math.min(window.devicePixelRatio || 1, 2);
      current.g = melodyStrings.geometry(rect.width, rect.height);
      dimensions.width = Math.round(rect.width * value);
      dimensions.height = Math.round(rect.height * value);
      context.setTransform(value, 0, 0, value, 0, 0);
      const dimensions2 = document.createElement('canvas');
      dimensions2.width = dimensions.width;
      dimensions2.height = dimensions.height;
      const context2 = dimensions2.getContext('2d');
      context2.setTransform(value, 0, 0, value, 0, 0);
      melodyStrings.backdrop(context2, current.g, texture.complete && texture.naturalWidth ? texture : null);
      current.background = dimensions2;
      releasePointer();
      wake();
    }
    current.draw = () => {
      current.raf = 0;
      if (!live || !current.g) return;
      const value = current.g;
      const timestamp = performance.now();
      context.clearRect(0, 0, value.w, value.h);
      context.drawImage(current.background, 0, 0, value.w, value.h);
      let elapsed = null;
      if (current.playback) {
        const playback = current.playback;
        elapsed = (timestamp - playback.start) * playback.rate;
        while (playback.index < playback.notes.length && playback.notes[playback.index].time <= elapsed) {
          const note = playback.notes[playback.index++];
          strike(note.index, note.velocity, false, playback.gain);
        }
        if (elapsed >= playback.end) {
          current.playback = null;
          setPlaying(false);
          setStatus('');
        }
      }
      melodyStrings.draw(context, value, current.strings, timestamp, Boolean(reduced?.matches), config.LINE_WIDTH || 4, config.GLOW_INTENSITY || 15);
      melodyStrings.drawLines(context, value, current.strokes, elapsed);
      const animating = current.pointer || current.playback || !reduced?.matches && current.strings.some(item => timestamp - item.time < item.life && item.amplitude * Math.exp(-5 * (timestamp - item.time) / item.life) > 0.06);
      if (animating && !document.hidden && !current.raf) current.raf = requestAnimationFrame(current.draw);
    };
    texture.onload = () => {
      if (live) resize();
    };
    texture.onerror = () => {
      if (live) wake();
    };
    texture.src = config.BG_OVERLAY || './assets/soundboard-realistic-v1.webp';
    const observer = observeGameSize(resize);
    observer.observe(surface.current);
    resize();
    const visibility = () => {
      if (document.hidden) {
        releasePointer();
        stop();
        if (current.raf) cancelAnimationFrame(current.raf);
        current.raf = 0;
      } else wake();
    };
    const motion = () => wake();
    document.addEventListener('visibilitychange', visibility);
    reduced?.addEventListener?.('change', motion);
    return () => {
      live = false;
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      reduced?.removeEventListener?.('change', motion);
      texture.onload = null;
      texture.onerror = null;
      if (current.raf) cancelAnimationFrame(current.raf);
      current.raf = 0;
      current.draw = null;
    };
  }, [config]);
  React.useEffect(() => () => {
    const current = sound.current;
    current.disposed = true;
    try {
      current.synth?.dispose();
      current.reverb?.dispose();
    } catch {}
  }, []);
  function point(event) {
    const rect = surface.current.getBoundingClientRect();
    const value = world.current.g;
    return {
      x: (event.clientX - rect.left) * (value ? value.w / rect.width : 1),
      y: (event.clientY - rect.top) * (value ? value.h / rect.height : 1)
    };
  }
  function releasePointer(event) {
    const current = world.current;
    const pointer = current.pointer;
    if (!pointer || event && event.pointerId !== pointer.id) return;
    const item = current.strings[pointer.index];
    const bend = item.hold?.bend || 0;
    item.hold = null;
    if (Math.abs(bend) > 0.5 && current.g) melodyStrings.pluck(item, performance.now(), Math.abs(bend), config?.TRAIL_LIFE || 1500);
    current.pointer = null;
    try {
      if (surface.current?.hasPointerCapture?.(pointer.id)) surface.current.releasePointerCapture(pointer.id);
    } catch {}
    wake();
  }
  const down = event => {
    if (event.isPrimary === false || event.button > 0) return;
    const current = world.current;
    if (current.pointer || !current.g) return;
    const point2 = point(event);
    if (!melodyStrings.inside(current.g, point2)) return;
    event.preventDefault();
    if (current.playback || playing) stop();
    setTouched(true);
    setStatus('');
    unlock();
    addPoint(point2, true);
    const index = melodyStrings.indexAt(current.g, point2.x);
    current.pointer = {
      id: event.pointerId,
      index,
      x: point2.x,
      y: point2.y,
      time: performance.now()
    };
    current.keyboard = index;
    strike(index);
    current.strings[index].hold = {
      u: (point2.y - current.g.top) / (current.g.bottom - current.g.top),
      bend: 0
    };
    try {
      surface.current.setPointerCapture(event.pointerId);
    } catch {}
  };
  function moveSample(event) {
    const current = world.current;
    const point2 = current.pointer;
    if (!point2 || point2.id !== event.pointerId || !current.g) return;
    const point3 = point(event);
    const value = current.g;
    if (!melodyStrings.inside(value, point3)) {
      releasePointer(event);
      return;
    }
    addPoint(point3);
    const index = melodyStrings.indexAt(value, point3.x);
    const timestamp = performance.now();
    const velocity = melodyStrings.clamp(Math.hypot(point3.x - point2.x, point3.y - point2.y) / Math.max(1, timestamp - point2.time), 0.15, 4);
    if (index !== point2.index) {
      const value2 = Math.sign(index - point2.index);
      const previous = current.strings[point2.index];
      melodyStrings.pluck(previous, timestamp, Math.max(4 * value.scale, Math.abs(previous.hold?.bend || 0)), config?.TRAIL_LIFE || 1500);
      previous.hold = null;
      for (let value3 = point2.index + value2; value2 > 0 ? value3 <= index : value3 >= index; value3 += value2) strike(value3, velocity);
      point2.index = index;
      current.keyboard = index;
    }
    const item = current.strings[index];
    item.hold = {
      u: melodyStrings.clamp((point3.y - value.top) / (value.bottom - value.top), 0, 1),
      bend: melodyStrings.clamp(point3.x - melodyStrings.xAt(value, index), -value.step * 0.46, value.step * 0.46)
    };
    point2.x = point3.x;
    point2.y = point3.y;
    point2.time = timestamp;
    wake();
  }
  const move = event => {
    if (!world.current.pointer) return;
    event.preventDefault();
    const samples = event.getCoalescedEvents?.() || [];
    for (const value of samples) moveSample(value);
    moveSample(event);
  };
  const handlePointerUp = event => {
    if (world.current.pointer?.id === event.pointerId) moveSample(event);
    releasePointer(event);
  };
  const handleKeyDown = event => {
    const current = world.current;
    if (!current.g) return;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', ' ', 'Enter'].includes(event.key)) {
      event.preventDefault();
      if (current.playback || playing) stop();
      setTouched(true);
      unlock();
      if (event.key === 'ArrowLeft') current.keyboard = melodyStrings.clamp(current.keyboard - 1, 0, 14);
      if (event.key === 'ArrowRight') current.keyboard = melodyStrings.clamp(current.keyboard + 1, 0, 14);
      if (event.key === 'Home') current.keyboard = 0;
      if (event.key === 'End') current.keyboard = 14;
      addPoint({
        x: melodyStrings.xAt(current.g, current.keyboard),
        y: (current.g.top + current.g.bottom) / 2
      }, true);
      strike(current.keyboard, 2);
    }
  };
  return <div className={'melody-realistic'}>{<style>{`
      @font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');font-display:swap}
      html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#a36a3d}
      *{box-sizing:border-box}.melody-realistic{position:relative;width:100%;height:100%;--ink:#fff1d6;--panel:#33251b;--accent:#e8c98d}
      .melody-surface{position:absolute;inset:0;touch-action:none;user-select:none;outline:none;cursor:crosshair}
      .melody-surface:focus-visible{outline:2px solid #fff4dd;outline-offset:-8px}
      .melody-surface canvas{width:100%;height:100%;display:block}
      .melody-guide{position:absolute;left:calc(30px + env(safe-area-inset-left));right:calc(30px + env(safe-area-inset-right));top:43%;transform:translateY(-50%);margin:0;text-align:center;font:400 18px/1.5 Poppins,system-ui,sans-serif;color:var(--ink);pointer-events:none;transition:opacity .15s}
      .melody-guide.hidden{opacity:0}.melody-guide span{background:rgba(44,24,12,.74);padding:5px 10px;box-decoration-break:clone;-webkit-box-decoration-break:clone;border-radius:4px}
      .melody-controls{position:absolute;z-index:2;left:calc(30px + env(safe-area-inset-left));right:calc(30px + env(safe-area-inset-right));bottom:calc(50px + env(safe-area-inset-bottom));display:grid;grid-template-columns:1.15fr 1fr;gap:12px;align-items:stretch}
      .melody-controls button{min-width:0;min-height:48px;padding:10px 12px;display:flex;align-items:center;justify-content:center;gap:8px;font:400 16px/1.4 Poppins,system-ui,sans-serif;white-space:normal;overflow-wrap:anywhere;border:1px solid rgba(255,241,214,.45);border-radius:12px;background:var(--panel);color:var(--ink);box-shadow:0 3px 8px rgba(32,15,4,.24);cursor:pointer;touch-action:manipulation;transition:background .12s,opacity .12s}
      .melody-controls .primary{background:var(--accent);border-color:var(--accent);color:#34230e}
      .melody-controls button:active:not(:disabled){filter:brightness(.86)}.melody-controls button:focus-visible{outline:3px solid #fff4dd;outline-offset:3px}
      .melody-controls button:disabled{opacity:.5;cursor:not-allowed;box-shadow:none}.melody-controls svg{width:18px;height:18px;flex:none}
      .melody-status{position:absolute;left:30px;right:30px;bottom:115px;text-align:center;font:400 16px/1.4 Poppins,system-ui,sans-serif;color:var(--ink);pointer-events:none}
      @media(max-height:570px),(max-width:360px){.melody-guide{font-size:16px;left:25px;right:25px}.melody-controls{left:25px;right:25px;bottom:42px;gap:8px}.melody-status{bottom:104px}}
      @media(prefers-reduced-motion:reduce){.melody-guide{transition:none}}
    `}</style>}{<div ref={surface} className={'melody-surface'} tabIndex={0} role={'button'} aria-label={"Trascina sulle corde per creare una melodia. Puoi usare anche frecce e Spazio. Riascolta la melodia o cancella il disegno."} onPointerDown={down} onPointerMove={move} onPointerUp={handlePointerUp} onPointerCancel={releasePointer} onLostPointerCapture={releasePointer} onBlur={() => releasePointer()} onKeyDown={handleKeyDown}>{<canvas ref={canvas} aria-hidden={'true'} />}</div>}{<p className={'melody-guide' + (touched ? ' hidden' : '')} aria-hidden={touched}>{<span>{"Disegna una melodia"}</span>}</p>}{<p className={'melody-status'} role={'status'} aria-live={'polite'}>{status}</p>}{<div className={'melody-controls'} aria-label={"Controlli della melodia"}>{<button type={'button'} className={'primary'} disabled={!hasRecording} onClick={replay} aria-label={playing ? "Ferma la melodia" : "Riascolta la melodia"}>{<svg viewBox={'0 0 24 24'} aria-hidden={'true'} fill={'currentColor'}>{<path d={playing ? 'M6 6h12v12H6z' : 'M8 5v14l11-7z'} />}</svg>}{playing ? "Ferma" : "Riascolta"}</button>}{<button type={'button'} disabled={!hasRecording} onClick={reset} aria-label={"Cancella disegno e melodia"}>{<svg viewBox={'0 0 24 24'} aria-hidden={'true'} fill={'none'} stroke={'currentColor'} strokeWidth={1.8} strokeLinecap={'round'} strokeLinejoin={'round'}>{<path d={'M4 10a8 8 0 1 1 1 8M4 4v6h6'} />}</svg>}{"Ricomincia"}</button>}</div>}</div>;
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
        "data-subject": ".melody-hint, #root p, #root canvas",
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
        "data-game": "14"
      }[name] ?? null;
    },
    dataset: {
      game: "14"
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
  const selectors = [".melody-guide"];
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
