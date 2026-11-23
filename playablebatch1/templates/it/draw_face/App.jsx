import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "BRUSH_SIZE",
    "kind": "number",
    "label": "Brush Size",
    "value": 4,
    "default": 4,
    "min": 1,
    "max": 20,
    "step": 1
  }],
  "texts": [{
    "id": "BTN_CLEAR",
    "label": "Clear Button Text",
    "value": "CANCELLA",
    "default": "CANCELLA",
    "max_length": 10
  }, {
    "id": "BTN_NEXT",
    "label": "Next Button Text",
    "value": "AVANTI",
    "default": "AVANTI",
    "max_length": 10
  }, {
    "id": "BTN_FINISH",
    "label": "Finish Button Text",
    "value": "FATTO",
    "default": "FATTO",
    "max_length": 10
  }, {
    "id": "BTN_BLINK",
    "label": "Blink Button Text",
    "value": "SBATTI LE PALPEBRE",
    "default": "SBATTI LE PALPEBRE",
    "max_length": 18
  }, {
    "id": "BTN_SNIFF",
    "label": "Sniff Button Text",
    "value": "ANNUSA",
    "default": "ANNUSA",
    "max_length": 14
  }, {
    "id": "BTN_TALK",
    "label": "Talk Button Text",
    "value": "PARLA",
    "default": "PARLA",
    "max_length": 14
  }, {
    "id": "BTN_AGAIN",
    "label": "Draw Again Button Text",
    "value": "RIDISEGNA",
    "default": "RIDISEGNA",
    "max_length": 20
  }, {
    "id": "TXT_STEP",
    "label": "Step Label",
    "value": "FASE",
    "default": "FASE",
    "max_length": 12
  }, {
    "id": "TXT_OF",
    "label": "Step Separator",
    "value": "DI",
    "default": "DI",
    "max_length": 12
  }, {
    "id": "PROMPT_1",
    "label": "Step 1 Prompt",
    "value": "Disegna gli occhi aperti",
    "default": "Disegna gli occhi aperti",
    "max_length": 40
  }, {
    "id": "PROMPT_2",
    "label": "Step 2 Prompt",
    "value": "Disegna gli occhi chiusi",
    "default": "Disegna gli occhi chiusi",
    "max_length": 40
  }, {
    "id": "PROMPT_3",
    "label": "Step 3 Prompt",
    "value": "Disegna un naso",
    "default": "Disegna un naso",
    "max_length": 40
  }, {
    "id": "PROMPT_4",
    "label": "Step 4 Prompt",
    "value": "Disegna un naso piccolo",
    "default": "Disegna un naso piccolo",
    "max_length": 40
  }, {
    "id": "PROMPT_5",
    "label": "Step 5 Prompt",
    "value": "Disegna la bocca aperta",
    "default": "Disegna la bocca aperta",
    "max_length": 40
  }, {
    "id": "PROMPT_6",
    "label": "Step 6 Prompt",
    "value": "Disegna la bocca socchiusa",
    "default": "Disegna la bocca socchiusa",
    "max_length": 40
  }, {
    "id": "PROMPT_7",
    "label": "Step 7 Prompt",
    "value": "Disegna la bocca chiusa",
    "default": "Disegna la bocca chiusa",
    "max_length": 40
  }, {
    "id": "MSG_DONE",
    "label": "Done Message",
    "value": "IL TUO VISO!",
    "default": "IL TUO VISO!",
    "max_length": 60
  }],
  "images": [],
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
    const request = fetch('./game.config.json', { cache: 'no-store' }).then(async response => ({
      ok: response.ok,
      status: response.status,
      config: response.ok ? await response.json() : null
    }));
    const fallback = new Promise(resolve => {
      deadline = setTimeout(() => resolve({ ok: false, status: 0, config: null }), 400);
    });
    const result = await Promise.race([request, fallback]);
    if (result.ok) runtimeConfig = result.config;
    return { ok: result.ok, status: result.status, json: async () => runtimeConfig };
  } finally {
    clearTimeout(deadline);
  }
}
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #fdf8ea; overscroll-behavior: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.face-game__prompt){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.face-game__prompt){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.face-game__prompt){animation:none!important}}

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

  // ./entry-preview-guide.js
  /* Decorative, game-specific guidance. Never dispatches input or changes game state. */
  (() => {
    'use strict';

    const mode = "face";
    if (!['face', 'one-stroke', 'dumpling'].includes(mode)) return;
    const html = document.documentElement;
    const host = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let interacted = false;
    let active = !host;
    let layer = null;
    let board = null;
    let resize = null;
    let compactGuide = null;
    const animations = [];
    html.toggleAttribute('data-entry-feed-preview', host);
    const style = document.createElement('style');
    style.textContent = `
    .entry-demo-layer{position:absolute;inset:0;pointer-events:none;overflow:visible;z-index:8}
    .entry-demo-layer svg{display:block;width:100%;height:100%;overflow:visible}
    .entry-demo-guide-path{fill:none;stroke:var(--primary,#6c5ce7);stroke-width:8;stroke-linecap:round;stroke-linejoin:round;opacity:.78}
    .entry-demo-bun{position:absolute;width:40px;height:40px;object-fit:contain;transform:translate(-50%,-50%);opacity:0;pointer-events:none}
    .entry-demo-cursor{position:absolute;width:18px;height:18px;border:2px solid #6f3218;border-radius:50%;background:#fff9;transform:translate(-50%,-50%);pointer-events:none;opacity:0}
    html[data-entry-feed-preview] .face-game__header{position:absolute;top:12%;left:30px;right:30px;padding:0}
    html[data-entry-feed-preview] .face-game__prompt{font-size:18px;line-height:1.4}
    html[data-entry-feed-preview] #draw-workspace{position:absolute;top:27%;bottom:27%;left:30px;right:30px;padding:0}
    html[data-entry-feed-preview] #draw-toolbar{visibility:hidden}
    html[data-entry-feed-preview] .one-stroke-hud{position:absolute!important;top:12%!important;left:30px!important;right:30px!important;width:auto!important;min-height:42px!important;padding:0!important}
    html[data-entry-feed-preview] .one-stroke-hud button{visibility:hidden}
    html[data-entry-feed-preview] .one-stroke-board{position:absolute!important;inset:28% 30px 32% 30px!important;width:auto!important}
    .entry-demo-copy{display:none;pointer-events:none}
    html[data-entry-feed-preview] .one-stroke-guide{visibility:hidden!important}
    html[data-entry-feed-preview] .entry-demo-copy{display:block;position:absolute;top:70%;left:30px;right:30px;margin:0;font-size:18px;line-height:1.5;font-weight:600;text-align:center;color:var(--text-sub)}
    html[data-entry-feed-preview] .dh-hud{top:12%!important;right:30px!important}
    html[data-entry-feed-preview] .dh-hud span[aria-hidden=true]{display:none}
    html[data-entry-feed-preview] .dh-guide{top:23%!important;right:30px!important}
    html[data-entry-feed-preview] .dh-board{inset:36% 30px 26% 30px!important}
    html[data-entry-feed-preview] .dh-dumpling{width:28px!important;height:28px!important}
    html[data-entry-feed-preview] .dh-guide span{font-size:18px;line-height:1.35}
    html[data-entry-demo-stopped] :is(.entry-demo-layer,.entry-demo-copy){display:none}
    @media(prefers-reduced-motion:reduce){.entry-demo-layer *{animation:none!important}}
  `;
    document.head.append(style);
    const cancel = () => {
      for (const animation of animations.splice(0)) animation.cancel();
    };
    function stop() {
      interacted = true;
      html.setAttribute('data-entry-demo-stopped', '');
      cancel();
      if (layer) layer.hidden = true;
      observer.disconnect();
      resize?.disconnect();
    }
    window.PlayableEntryPreview = {
      stop
    };
    function drawLine(points, viewBox, width) {
      layer.innerHTML = `<svg class="entry-demo-svg" viewBox="${viewBox}" aria-hidden="true"><path class="entry-demo-guide-path" stroke-width="${width}"/></svg>`;
      const path = layer.querySelector('path');
      path.setAttribute('d', points);
      const length = path.getTotalLength();
      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);
      if (reduced?.matches || typeof path.animate !== 'function') {
        path.style.strokeDashoffset = String(length * 0.45);
        return;
      }
      animations.push(path.animate([{
        strokeDashoffset: String(length),
        opacity: 0.3,
        offset: 0
      }, {
        strokeDashoffset: '0',
        opacity: 0.85,
        offset: 0.65
      }, {
        strokeDashoffset: '0',
        opacity: 0.85,
        offset: 0.85
      }, {
        strokeDashoffset: '0',
        opacity: 0,
        offset: 1
      }], {
        duration: 3700,
        iterations: Infinity,
        easing: 'linear'
      }));
    }
    function render() {
      if (!layer || interacted || host && active) return;
      cancel();
      layer.hidden = false;
      if (mode === 'face') {
        drawLine('M210 360 C220 245 355 245 370 360 C355 445 220 445 210 360 M520 360 C535 245 670 245 680 360 C665 445 535 445 520 360', '0 0 900 900', 12);
      } else if (mode === 'one-stroke') {
        const lines = [...(board.querySelector('svg')?.querySelectorAll('line') || [])];
        if (!lines.length) return;
        const point = (line, suffix) => [Number(line.getAttribute('x' + suffix)), Number(line.getAttribute('y' + suffix))];
        const same = (value4, otherValue) => value4[0] === otherValue[0] && value4[1] === otherValue[1];
        const value = point(lines[0], '1');
        const value2 = point(lines[0], '2');
        const next = lines.slice(1).find(line => same(point(line, '1'), value2) || same(point(line, '2'), value2));
        const value3 = next ? point(next, same(point(next, '1'), value2) ? '2' : '1') : value2;
        drawLine(`M${value.join(' ')} L${value2.join(' ')} L${value3.join(' ')}`, `0 0 ${board.clientWidth} ${board.clientHeight}`, 10);
      } else {
        const target = board.querySelector('.dh-dumpling');
        if (!target) return;
        const config = JSON.parse(runtimeConfig.textContent);
        const opened = config.images.find(image => image.id === 'IMG_MODIFIED')?.path;
        if (!opened) return;
        layer.replaceChildren();
        const image = document.createElement('img');
        const cursor = document.createElement('span');
        image.className = 'entry-demo-bun';
        image.src = opened;
        image.alt = '';
        image.draggable = false;
        cursor.className = 'entry-demo-cursor';
        for (const element of [image, cursor]) {
          element.style.left = target.style.left;
          element.style.top = target.style.top;
          layer.append(element);
        }
        if (reduced?.matches || typeof image.animate !== 'function') {
          image.style.opacity = '.65';
          return;
        }
        animations.push(image.animate([{
          opacity: 0,
          offset: 0
        }, {
          opacity: 0,
          offset: 0.3
        }, {
          opacity: 1,
          offset: 0.4
        }, {
          opacity: 1,
          offset: 0.78
        }, {
          opacity: 0,
          offset: 1
        }], {
          duration: 3200,
          iterations: Infinity
        }));
        animations.push(cursor.animate([{
          opacity: 0,
          offset: 0
        }, {
          opacity: 0.9,
          offset: 0.2
        }, {
          opacity: 0.9,
          offset: 0.3
        }, {
          opacity: 0,
          offset: 0.45
        }, {
          opacity: 0,
          offset: 1
        }], {
          duration: 3200,
          iterations: Infinity
        }));
      }
      if (document.hidden) for (const animation of animations) animation.pause();
    }
    function attach() {
      if (layer || interacted || host && active) return;
      board = document.querySelector(mode === 'face' ? '.face-game__canvas-wrap' : mode === 'one-stroke' ? '.one-stroke-board' : '.dh-board');
      if (!board || mode === 'one-stroke' && !board.querySelector('svg line')) return;
      layer = document.createElement('div');
      layer.className = 'entry-demo-layer';
      layer.setAttribute('aria-hidden', 'true');
      board.append(layer);
      if (mode === 'one-stroke' && host && !compactGuide) {
        compactGuide = document.createElement('p');
        compactGuide.className = 'entry-demo-copy';
        compactGuide.textContent = "Unisci con un solo tratto";
        board.parentElement.append(compactGuide);
      }
      observer.disconnect();
      if (typeof ResizeObserver === 'function') {
        resize = new ResizeObserver(render);
        resize.observe(board);
      }
      render();
    }
    const observer = new MutationObserver(attach);
    observer.observe(document.getElementById('root'), {
      childList: true,
      subtree: true
    });
    attach();
    window.addEventListener('message', event => {
      if (!host || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
      active = event.data.active === true;
      html.toggleAttribute('data-entry-feed-preview', !active);
      if (active) {
        cancel();
        if (layer) layer.hidden = true;
      } else if (!interacted) {
        attach();
        render();
      }
    });
    document.addEventListener('visibilitychange', () => {
      for (const animation of animations) {
        if (document.hidden) {
          animation.pause();
        } else {
          animation.play();
        }
      }
    });
    reduced?.addEventListener?.('change', render);
    window.addEventListener('pagehide', () => {
      cancel();
      observer.disconnect();
      resize?.disconnect();
    }, {
      once: true
    });
  })();
  function computeGroupPlacements({
    bounds,
    slots
  }) {
    const validBounds = bounds.filter(Boolean);
    if (validBounds.length === 0) return bounds.map(() => null);
    const maxWidth = Math.max(...validBounds.map(item => item.width));
    const maxHeight = Math.max(...validBounds.map(item => item.height));
    return bounds.map((item, index) => {
      if (!item) return null;
      const slot = slots[index] || slots[0];
      const scale = Math.min(slot.width / maxWidth, slot.height / maxHeight);
      const width = item.width * scale;
      const height = item.height * scale;
      const centerX = slot.x + slot.width / 2;
      const centerY = slot.y + slot.height / 2;
      const left = centerX - width / 2;
      const value = centerY - height / 2;
      return {
        sourceX: item.x,
        sourceY: item.y,
        sourceWidth: item.width,
        sourceHeight: item.height,
        left,
        top: value,
        width,
        height,
        centerX,
        centerY,
        right: left + width,
        bottom: value + height
      };
    });
  }
  (() => {
    "use strict";

    const SIZE = 900;
    const STEP_COUNT = 7;
    const FEATURE_SLOTS = {
      eyes: {
        x: 170,
        y: 230,
        width: 560,
        height: 170
      },
      nose: {
        x: 330,
        y: 420,
        width: 240,
        height: 140
      },
      mouth: {
        x: 260,
        y: 590,
        width: 380,
        height: 160
      }
    };
    const FALLBACK = {
      BRUSH_SIZE: 4,
      BTN_CLEAR: "CANCELLA",
      BTN_NEXT: "AVANTI",
      BTN_FINISH: "FATTO",
      BTN_BLINK: "SBATTI LE PALPEBRE",
      BTN_SNIFF: "ANNUSA",
      BTN_TALK: "PARLA",
      BTN_AGAIN: "RIDISEGNA",
      TXT_STEP: "FASE",
      TXT_OF: "DI",
      MSG_DONE: "IL TUO VISO!",
      PROMPT_1: "Disegna gli occhi aperti",
      PROMPT_2: "Disegna gli occhi chiusi",
      PROMPT_3: "Disegna un naso",
      PROMPT_4: "Disegna un naso piccolo",
      PROMPT_5: "Disegna la bocca aperta",
      PROMPT_6: "Disegna la bocca socchiusa",
      PROMPT_7: "Disegna la bocca chiusa"
    };
    const sleep = value => new Promise(resolve => setTimeout(resolve, value));
    function readConfig(config) {
      const values = {
        ...FALLBACK
      };
      ["tweaks", "texts"].forEach(section => {
        (config[section] || []).forEach(item => {
          if (item && item.id) values[item.id] = item.value;
        });
      });
      return values;
    }
    function makeLayer() {
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      return canvas;
    }
    async function boot() {
      let config = {};
      const inlineConfig = runtimeConfig;
      if (window.location.protocol === "file:" && inlineConfig) {
        try {
          config = runtimeConfig;
        } catch (value) {}
      } else {
        try {
          const response = await requestGameConfig();
          if (response.ok) config = await response.json();
        } catch (value) {
          if (inlineConfig) {
            try {
              config = runtimeConfig;
            } catch (value2) {}
          }
        }
      }
      mount(readConfig(config));
    }
    function mount(copy) {
      const root = document.getElementById("game-surface");
      root.innerHTML = `
      <style>
        @font-face { font-family: Poppins; src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2'); font-weight: 400; font-display: swap; }
        @font-face { font-family: Poppins; src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2'); font-weight: 700; font-display: swap; }
        :root { --paper: #fdf8ea; --ink: #303035; --purple: #6c5ce7; --green: #08b894; --red: #dc3035; --guide: #d7cfbc; }
        * { box-sizing: border-box; }
        button { font: 700 clamp(14px, 3.8vw, 18px)/1.2 Poppins, sans-serif; border: 0; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
        .face-game { width: 100%; height: 100%; min-height: 0; overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: var(--paper); color: var(--ink); font-family: Poppins, sans-serif; }
        .face-game__header { padding: calc(30px + env(safe-area-inset-top)) 30px 12px; text-align: center; }
        .face-game__step { margin: 0 0 5px; font-size: 28px; letter-spacing: 0; line-height: 1.2; color: #736e64; }
        .face-game__prompt { margin: 0; max-width: 100%; font-size: clamp(19px, 5.4vw, 30px); line-height: 1.15; overflow-wrap: anywhere; }
        .face-game__workspace { min-height: 0; display: grid; place-items: center; padding: 4px 30px 12px; overflow: hidden; container-type: size; }
        .face-game__canvas-wrap { position: relative; width: min(100%, calc(100vh - 280px), 560px); max-width: 100%; max-height: 100%; aspect-ratio: 1; border: 2px dashed var(--guide); border-radius: 22px; overflow: hidden; background: rgba(255,255,255,.08); touch-action: none; }
        .face-game canvas { display: block; width: 100%; height: 100%; }
        #draw-canvas { cursor: crosshair; touch-action: none; }
        .face-game__toolbar { width: min(calc(100% - 60px), 560px); min-height: calc(112px + env(safe-area-inset-bottom)); margin: 0 auto; padding: 8px 0 calc(50px + env(safe-area-inset-bottom)); display: grid; grid-template-columns: minmax(105px,.72fr) 1.28fr; gap: 14px; }
        .face-game__button { min-height: 54px; border-radius: 14px; padding: 11px 18px; box-shadow: 0 7px 17px rgba(54,46,36,.12); transition: transform .12s ease, filter .12s ease; white-space: normal; overflow-wrap: anywhere; }
        .face-game__button:active { transform: translateY(2px) scale(.985); filter: brightness(.96); }
        .face-game__button:disabled { cursor: default; opacity: .42; transform: none; filter: none; }
        .face-game__button--clear { color: var(--ink); background: #fff; border: 2px solid var(--ink); box-shadow: none; }
        .face-game__button--next { color: #fff; background: var(--purple); }
        .face-game__result-title { margin: 0; max-width: 100%; font-size: clamp(24px, 6vw, 34px); line-height: 1.1; overflow-wrap: anywhere; }
        .face-game__result-wrap { position: relative; width: min(100%, calc(100vh - 270px), 620px); max-width: 100%; max-height: 100%; aspect-ratio: 1; }
        .face-game__actions { width: min(calc(100% - 60px), 700px); margin: 0 auto; padding: 10px 0 calc(50px + env(safe-area-inset-bottom)); }
        .face-game__action-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .face-game__action { min-height: clamp(56px, 12vw, 76px); color: #fff; border-radius: 14px; box-shadow: 0 9px 20px rgba(55,45,35,.15); }
        .face-game__action--blink { background: var(--purple); }
        .face-game__action--sniff { background: var(--green); }
        .face-game__action--talk { background: var(--red); }
        .face-game__again { display: block; margin: 13px auto 0; padding: 4px 12px; color: #817c70; background: transparent; text-decoration: underline; box-shadow: none; font-weight: 400; }
        [hidden] { display: none !important; }
        @supports (width: 1cqh) {
          .face-game__canvas-wrap, .face-game__result-wrap { width: min(100%, 100cqh, 620px); }
          .face-game__canvas-wrap { max-width: 560px; }
        }
        @media (max-height: 600px) {
          .face-game__header { padding-bottom: 8px; }
          .face-game__button { min-height: 50px; }
          .face-game__action-row { gap: 8px; }
        }
      </style>
      <main class="face-game">
        <header class="face-game__header" id="draw-header">
          <p class="face-game__step" id="step-label"></p>
          <h1 class="face-game__prompt" id="prompt-label"></h1>
        </header>
        <header class="face-game__header" id="result-header" hidden>
          <h1 class="face-game__result-title" id="result-title"></h1>
        </header>
        <section class="face-game__workspace" id="draw-workspace">
          <div class="face-game__canvas-wrap"><canvas id="draw-canvas" width="${SIZE}" height="${SIZE}" aria-label="Drawing canvas"></canvas></div>
        </section>
        <section class="face-game__workspace" id="result-workspace" hidden>
          <div class="face-game__result-wrap"><canvas id="result-canvas" width="${SIZE}" height="${SIZE}" aria-label="Your animated face"></canvas></div>
        </section>
        <footer class="face-game__toolbar" id="draw-toolbar">
          <button class="face-game__button face-game__button--clear" id="clear-button"></button>
          <button class="face-game__button face-game__button--next" id="next-button"></button>
        </footer>
        <footer class="face-game__actions" id="result-actions" hidden>
          <div class="face-game__action-row">
            <button class="face-game__button face-game__action face-game__action--blink" data-action="blink"></button>
            <button class="face-game__button face-game__action face-game__action--sniff" data-action="sniff"></button>
            <button class="face-game__button face-game__action face-game__action--talk" data-action="talk"></button>
          </div>
          <button class="face-game__again" id="again-button"></button>
        </footer>
      </main>`;
      const layers = Array.from({
        length: STEP_COUNT
      }, makeLayer);
      const drawCanvas = root.querySelector("#draw-canvas");
      const drawContext = drawCanvas.getContext("2d");
      const resultCanvas = root.querySelector("#result-canvas");
      const resultContext = resultCanvas.getContext("2d");
      const stepLabel = root.querySelector("#step-label");
      const promptLabel = root.querySelector("#prompt-label");
      const nextButton = root.querySelector("#next-button");
      const clearButton = root.querySelector("#clear-button");
      const resultTitle = root.querySelector("#result-title");
      const againButton = root.querySelector("#again-button");
      const actionButtons = Array.from(root.querySelectorAll("[data-action]"));
      const hasInk = Array(STEP_COUNT).fill(false);
      let step = 0;
      let drawing = false;
      let lastPoint = null;
      let animationToken = 0;
      let audioContext = null;
      let resultParts = {
        eyes: 0,
        nose: 2,
        mouth: 6
      };
      let placementCache = null;
      const actionCopy = {
        blink: copy.BTN_BLINK,
        sniff: copy.BTN_SNIFF,
        talk: copy.BTN_TALK
      };
      actionButtons.forEach(button => {
        button.textContent = actionCopy[button.dataset.action] || button.dataset.action.toUpperCase();
      });
      againButton.textContent = copy.BTN_AGAIN;
      function ensureAudio() {
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) return null;
          if (!audioContext) audioContext = new AudioContext();
          if (audioContext.state === "suspended") audioContext.resume();
          return audioContext;
        } catch (value) {
          return null;
        }
      }
      function playTone(frequency, duration, delay = 0, type = "sine") {
        const context = ensureAudio();
        if (!context) return;
        const start = context.currentTime + delay;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.2, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.015);
      }
      function feedback(kind) {
        const patterns = {
          draw: [[420, 0.035]],
          clear: [[180, 0.08]],
          next: [[520, 0.06], [660, 0.08, 0.055]],
          success: [[523, 0.12], [659, 0.12, 0.08], [784, 0.16, 0.16]],
          blink: [[700, 0.06]],
          sniff: [[300, 0.06], [380, 0.08, 0.07]],
          talk: [[220, 0.06], [280, 0.06, 0.06], [340, 0.08, 0.12]],
          again: [[440, 0.08]]
        };
        (patterns[kind] || []).forEach(([frequency, duration, delay = 0]) => {
          playTone(frequency, duration, delay, kind === "clear" ? "triangle" : "sine");
        });
        try {
          if (window.tt && typeof window.tt.vibrate === "function") window.tt.vibrate({
            style: "light"
          });else if (navigator.vibrate) navigator.vibrate(kind === "success" ? [12, 30, 16] : 8);
        } catch (value) {}
      }
      function renderDrawing() {
        drawContext.clearRect(0, 0, SIZE, SIZE);
        drawContext.globalAlpha = 1;
        drawContext.drawImage(layers[step], 0, 0);
      }
      function getInkBounds(layer) {
        const pixels = layer.getContext("2d").getImageData(0, 0, SIZE, SIZE).data;
        let minX = SIZE;
        let minY = SIZE;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < SIZE; y += 1) {
          for (let x = 0; x < SIZE; x += 1) {
            if (pixels[(y * SIZE + x) * 4 + 3] < 8) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
        if (maxX < minX || maxY < minY) return null;
        const padding = 8;
        const x = Math.max(0, minX - padding);
        const y = Math.max(0, minY - padding);
        const right = Math.min(SIZE, maxX + padding + 1);
        const bottom = Math.min(SIZE, maxY + padding + 1);
        return {
          x,
          y,
          width: right - x,
          height: bottom - y
        };
      }
      function buildPlacementCache() {
        const groups = {
          eyes: [0, 1],
          nose: [2, 3],
          mouth: [4, 5, 6]
        };
        const cache = {};
        Object.entries(groups).forEach(([groupName, indexes]) => {
          const slot = FEATURE_SLOTS[groupName];
          const bounds = indexes.map(index => getInkBounds(layers[index]));
          const placements = computeGroupPlacements({
            bounds,
            slots: indexes.map(() => slot)
          });
          indexes.forEach((layerIndex, placementIndex) => {
            cache[layerIndex] = placements[placementIndex];
          });
        });
        return cache;
      }
      function drawPlacedLayer(layerIndex) {
        const placement = placementCache && placementCache[layerIndex];
        if (!placement) return;
        resultContext.drawImage(layers[layerIndex], placement.sourceX, placement.sourceY, placement.sourceWidth, placement.sourceHeight, placement.left, placement.top, placement.width, placement.height);
      }
      function renderResult() {
        resultContext.clearRect(0, 0, SIZE, SIZE);
        resultContext.globalAlpha = 1;
        drawPlacedLayer(resultParts.eyes);
        drawPlacedLayer(resultParts.nose);
        drawPlacedLayer(resultParts.mouth);
      }
      function updateNextAvailability() {
        nextButton.disabled = !hasInk[step];
        nextButton.setAttribute("aria-disabled", String(nextButton.disabled));
        clearButton.hidden = !hasInk[step];
        nextButton.hidden = !hasInk[step];
      }
      function updateStep() {
        stepLabel.textContent = `${step + 1}/${STEP_COUNT}`;
        promptLabel.textContent = copy[`PROMPT_${step + 1}`] || FALLBACK[`PROMPT_${step + 1}`];
        nextButton.textContent = step === STEP_COUNT - 1 ? copy.BTN_FINISH : copy.BTN_NEXT;
        updateNextAvailability();
        renderDrawing();
      }
      function pointFromEvent(event) {
        const rect = drawCanvas.getBoundingClientRect();
        return {
          x: (event.clientX - rect.left) * SIZE / rect.width,
          y: (event.clientY - rect.top) * SIZE / rect.height
        };
      }
      drawCanvas.addEventListener("pointerdown", event => {
        if (event.isPrimary === false || event.button > 0) return;
        window.PlayableEntryPreview?.stop();
        event.preventDefault();
        drawCanvas.setPointerCapture(event.pointerId);
        drawing = true;
        lastPoint = pointFromEvent(event);
        const context = layers[step].getContext("2d");
        const brushWidth = Math.max(2, Number(copy.BRUSH_SIZE) || 4) * 2.1;
        context.beginPath();
        context.arc(lastPoint.x, lastPoint.y, brushWidth / 2, 0, Math.PI * 2);
        context.fillStyle = "#303035";
        context.fill();
        hasInk[step] = true;
        updateNextAvailability();
        renderDrawing();
        feedback("draw");
      });
      drawCanvas.addEventListener("pointermove", event => {
        if (!drawing || !event.isPrimary) return;
        event.preventDefault();
        const current = pointFromEvent(event);
        const context = layers[step].getContext("2d");
        context.beginPath();
        context.moveTo(lastPoint.x, lastPoint.y);
        context.lineTo(current.x, current.y);
        context.strokeStyle = "#303035";
        context.lineWidth = Math.max(2, Number(copy.BRUSH_SIZE) || 4) * 2.1;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.stroke();
        hasInk[step] = true;
        lastPoint = current;
        renderDrawing();
      });
      function endStroke(event) {
        if (!drawing || !event.isPrimary) return;
        drawing = false;
        lastPoint = null;
        if (drawCanvas.hasPointerCapture(event.pointerId)) drawCanvas.releasePointerCapture(event.pointerId);
      }
      drawCanvas.addEventListener("pointerup", endStroke);
      drawCanvas.addEventListener("pointercancel", endStroke);
      clearButton.textContent = copy.BTN_CLEAR;
      clearButton.addEventListener("click", () => {
        layers[step].getContext("2d").clearRect(0, 0, SIZE, SIZE);
        hasInk[step] = false;
        updateNextAvailability();
        renderDrawing();
        feedback("clear");
      });
      nextButton.addEventListener("click", () => {
        if (!hasInk[step]) return;
        if (step < STEP_COUNT - 1) {
          feedback("next");
          step += 1;
          updateStep();
        } else {
          showResult();
        }
      });
      function showResult() {
        animationToken += 1;
        resultParts = {
          eyes: 0,
          nose: 2,
          mouth: 6
        };
        placementCache = buildPlacementCache();
        root.querySelector("#draw-header").hidden = true;
        root.querySelector("#draw-workspace").hidden = true;
        root.querySelector("#draw-toolbar").hidden = true;
        root.querySelector("#result-header").hidden = false;
        root.querySelector("#result-workspace").hidden = false;
        root.querySelector("#result-actions").hidden = false;
        resultTitle.textContent = copy.MSG_DONE || FALLBACK.MSG_DONE;
        renderResult();
        feedback("success");
      }
      async function blink() {
        const token = ++animationToken;
        resultParts.eyes = 1;
        renderResult();
        await sleep(230);
        if (token !== animationToken) return;
        resultParts.eyes = 0;
        renderResult();
      }
      async function sniff() {
        const token = ++animationToken;
        for (const frame of [3, 2, 3, 2]) {
          if (token !== animationToken) return;
          resultParts.nose = frame;
          renderResult();
          await sleep(145);
        }
      }
      async function talk() {
        const token = ++animationToken;
        for (const frame of [4, 5, 6, 5, 4, 5, 6]) {
          if (token !== animationToken) return;
          resultParts.mouth = frame;
          renderResult();
          await sleep(135);
        }
      }
      actionButtons.forEach(button => {
        button.addEventListener("click", () => {
          const action = button.dataset.action;
          feedback(action);
          if (action === "blink") blink();
          if (action === "sniff") sniff();
          if (action === "talk") talk();
        });
      });
      againButton.addEventListener("click", () => {
        animationToken += 1;
        layers.forEach(layer => layer.getContext("2d").clearRect(0, 0, SIZE, SIZE));
        hasInk.fill(false);
        step = 0;
        placementCache = null;
        root.querySelector("#draw-header").hidden = false;
        root.querySelector("#draw-workspace").hidden = false;
        root.querySelector("#draw-toolbar").hidden = false;
        root.querySelector("#result-header").hidden = true;
        root.querySelector("#result-workspace").hidden = true;
        root.querySelector("#result-actions").hidden = true;
        updateStep();
        feedback("again");
      });
      updateStep();
    }
    boot();
  })();

  // ./feed-entry-motion.js
  /* Decorative entry motion only. No game state, audio, timers or synthetic input. */
  (function () {
    'use strict';

    const script = {
      getAttribute(name) {
        return {
          "data-subject": "#draw-canvas",
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
    const selectors = [".face-game__prompt"];
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
}
function App() {
  React.useEffect(() => {
    startGame();
  }, []);
  return <><div id="game-surface" style={{
      width: "100%",
      height: "100%"
    }} /></>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
