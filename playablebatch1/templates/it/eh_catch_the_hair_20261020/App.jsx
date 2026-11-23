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
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "it",
    "min_capability_level": 1,
    "full_capability_level": 1
  },
  "tweaks": [{
    "id": "fallSpeed",
    "kind": "number",
    "label": "fallSpeed",
    "value": 900,
    "default": 900,
    "min": 200,
    "max": 900,
    "step": 10
  }, {
    "id": "wigFitFactor",
    "kind": "number",
    "label": "wigFitFactor",
    "value": 2.05,
    "default": 2.05,
    "min": 1.2,
    "max": 3.2,
    "step": 0.05
  }],
  "texts": [{
    "id": "GUIDE",
    "label": "Opening guide",
    "value": "Tocca per fermare la parrucca",
    "max_length": 64
  }],
  "images": [{
    "id": "PERSON",
    "label": "Reference-inspired bald character",
    "path": "./assets/person.webp",
    "replaceable": true
  }, {
    "id": "BACKGROUND",
    "label": "Yellow background",
    "path": "./assets/background.webp",
    "replaceable": true
  }, {
    "id": "HAIR_0",
    "label": "Hairstyle 1",
    "path": "./assets/hair_0.webp",
    "replaceable": true
  }, {
    "id": "HAIR_1",
    "label": "Hairstyle 2",
    "path": "./assets/hair_1.webp",
    "replaceable": true
  }, {
    "id": "HAIR_2",
    "label": "Hairstyle 3",
    "path": "./assets/hair_2.webp",
    "replaceable": true
  }, {
    "id": "HAIR_3",
    "label": "Hairstyle 4",
    "path": "./assets/hair_3.webp",
    "replaceable": true
  }, {
    "id": "HAIR_4",
    "label": "Hairstyle 5",
    "path": "./assets/hair_4.webp",
    "replaceable": true
  }]
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
const GAME_STYLES = `@font-face{font-family:Poppins;src:url('./assets/fonts/Poppins-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:Poppins;src:url('./assets/fonts/Poppins-Bold.woff2') format('woff2');font-weight:700;font-display:swap}
:root{font-family:Poppins,Arial,sans-serif;color:#fff;background:#222;--ink:#fff;--ui:1;--accent:#ffcf4c}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{overscroll-behavior:none}button{font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}button:focus-visible{outline:3px solid #ffcd45;outline-offset:-5px}button:disabled{cursor:default}
#stage{position:relative;width:100%;height:100%;isolation:isolate;overflow:hidden;touch-action:manipulation;color:var(--ink)}canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#play{position:absolute;inset:0;border:0;background:none;z-index:1;padding:0;touch-action:manipulation;color:transparent}
.makeover #play{touch-action:none}
.hud{position:absolute;top:max(calc(30px * var(--ui)),env(safe-area-inset-top));left:calc(30px * var(--ui));right:calc(30px * var(--ui));display:flex;align-items:flex-start;justify-content:space-between;pointer-events:none;z-index:2;text-shadow:0 1px 4px #0009;font-size:calc(28px * var(--ui));font-weight:700;line-height:1.25;letter-spacing:-.6px;font-variant-numeric:tabular-nums}
.hud.center{justify-content:center}.hud small{font-size:calc(14px * var(--ui));display:block;line-height:1.4;letter-spacing:0;font-weight:400;margin-top:3px}.hud span:empty{display:none}
#guide{position:absolute;z-index:2;left:calc(30px * var(--ui));right:calc(30px * var(--ui));bottom:max(calc(62px * var(--ui)),env(safe-area-inset-bottom));font-size:calc(18px * var(--ui));font-weight:700;line-height:1.4;text-align:center;pointer-events:none;text-shadow:0 1px 4px #000a;animation:float 2s ease-in-out infinite;margin:0}
#guide[hidden], [hidden]{display:none!important}html[data-feed-preview="true"] #guide,html[data-feed-preview="true"] .controls{visibility:hidden}.controls{position:absolute;z-index:3;left:calc(30px * var(--ui));right:calc(30px * var(--ui));bottom:max(calc(50px * var(--ui)),env(safe-area-inset-bottom));display:flex;align-items:center;justify-content:center;gap:12px;pointer-events:none}
.control{min-height:48px;min-width:48px;padding:10px 22px;border:0;border-radius:30px;background:#fff;color:#20252b;font-weight:700;font-size:16px;box-shadow:0 2px 10px #0002;pointer-events:auto}.control:active{transform:scale(.97)}#direction{margin-left:auto;border:1px solid #ffffff80;background:#2228;color:#fff;backdrop-filter:blur(8px);padding:10px 13px;display:flex;align-items:center;gap:8px}#direction svg{width:22px;height:22px;transition:transform .2s}
#result{position:absolute;z-index:2;left:24px;right:24px;bottom:calc(122px * var(--ui));text-align:center;pointer-events:none;font-size:calc(28px * var(--ui));font-weight:700;line-height:1.2;text-shadow:0 2px 8px #0009}#result small{font-size:calc(18px * var(--ui));font-weight:400;display:block;margin-top:8px}
#loading{position:absolute;inset:0;z-index:6;background:#25272a;display:grid;place-content:center;text-align:center;padding:30px;font-size:18px;line-height:1.5}#loading:before{content:'';width:28px;height:28px;border:3px solid #ffffff35;border-top-color:#fff;border-radius:50%;margin:0 auto 18px;animation:turn .8s linear infinite}#loading.error:before{display:none}.hair-catch{--ink:#30251e}.hair-catch .hud,.hair-catch #guide,.hair-catch #result{text-shadow:none}.hair-catch #guide{bottom:calc(70px * var(--ui))}.hair-catch .hud{top:calc(50px * var(--ui))}.hair-catch #result{bottom:calc(170px * var(--ui))}
.hair-catch #guide{color:#fff;text-shadow:0 1px 4px #000b}.hair-catch .hud span:not(:empty){background:#fffef7ed;border-radius:24px;padding:6px 18px}.hair-shave #guide{bottom:calc(120px * var(--ui))}.makeover .hud{font-size:calc(24px * var(--ui))}.makeover .hud #left{max-width:75%}#pause{position:absolute;inset:0;z-index:7;background:#15191c90;display:grid;place-content:center;backdrop-filter:blur(4px)}#resume{border:1px solid #ffffff80;background:#fff;color:#222;font-size:18px;padding:15px 25px;border-radius:30px;min-height:50px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@keyframes float{50%{transform:translateY(-5px)}}@keyframes turn{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){*,*:before{animation:none!important;transition:none!important}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p#guide{position:fixed!important;top:14%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

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
html:root:root #stage #guide{visibility:visible!important;color:#30251e!important;text-shadow:none!important;background:#fffef7ed;border-radius:999px;padding:8px 14px;text-wrap:balance}
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
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
document.documentElement.lang = 'it';
function startGame() {
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
          "data-game": "77"
        }[name] ?? null;
      },
      dataset: {
        game: "77"
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
  window.GAME_SPEC = {
    "id": "hair-catch",
    "title": "Prendi la parrucca",
    "settings": {
      "fallSpeed": 900,
      "wigFitFactor": 2.05,
      "startWigIndex": 0,
      "wigAspects": [1.165, 1.134, 0.709, 1.115, 0.884],
      "wigAnchors": [0.39, 0.39, 0.595, 0.502, 0.413],
      "wigHoleCX": [0.408, 0.47, 0.478, 0.468, 0.449],
      "sizes": [0.808, 0.837, 0.783, 0.995, 0.787],
      "offsetX": [-29, 3, 1, 11, -15],
      "offsetY": [-17, -7, -10, -10, -76],
      "rotations": [0, 0, 0, 0, 0],
      "flips": [false, false, false, false, false],
      "face": {
        "x": -10,
        "width": 240,
        "targetY": 156,
        "rotation": 0
      }
    },
    "assets": {
      "person": "PERSON",
      "background": "BACKGROUND",
      "hair": ["HAIR_0", "HAIR_1", "HAIR_2", "HAIR_3", "HAIR_4"]
    },
    "person": {
      "position": {
        "x": 0,
        "y": -207
      },
      "size": {
        "x": 720,
        "y": 866
      },
      "pivot": {
        "x": 0.5,
        "y": 0.5
      },
      "scale": {
        "x": 1,
        "y": 1,
        "z": 1
      }
    },
    "audio": {}
  };
  (function (root) {
    'use strict';

    class HairCatch {
      constructor(settings, value = Math.random) {
        this.s = settings;
        this.rng = value;
        this.selected = -1;
        this.reset();
      }
      reset() {
        this.state = 'falling';
        this.started = false;
        this.score = null;
        this.scoreAge = 0;
        this.drop();
      }
      geometry(index = this.selected) {
        const value = this.s;
        const face = value.face;
        const width = Math.max(280, Math.min(1600, face.width * value.wigFitFactor * value.sizes[index]));
        const height = width / value.wigAspects[index];
        const angle = (face.rotation + value.rotations[index]) * Math.PI / 180;
        const value2 = value.flips[index] ? 1 - value.wigHoleCX[index] : value.wigHoleCX[index];
        const value3 = (value2 - 0.5) * width;
        const value4 = (0.5 - value.wigAnchors[index]) * height;
        const shift = value.offsetY[index] * face.width / 273;
        return {
          width,
          height,
          angle,
          flip: value.flips[index],
          x: face.x + value.offsetX[index] * face.width / 273 - (value3 * Math.cos(angle) - value4 * Math.sin(angle)),
          wearY: value3 * Math.sin(angle) + value4 * Math.cos(angle),
          targetY: face.targetY + shift
        };
      }
      drop() {
        let value = Math.floor(this.rng() * 5);
        if (value === this.selected) value = (value + 1) % 5;
        this.selected = value;
        const value2 = this.geometry();
        this.y = 640 + value2.height / 2;
        this.state = 'falling';
        this.score = null;
        this.scoreAge = 0;
      }
      tick(value) {
        if (this.state === 'falling') {
          this.y -= this.s.fallSpeed * value;
          if (this.y < -640 - this.geometry().height / 2) this.drop();
        } else {
          this.scoreAge += value;
          if (this.scoreAge >= 2.8) this.drop();
        }
      }
      tap() {
        if (this.state === 'stopped') {
          this.drop();
          return {
            next: true
          };
        }
        this.started = true;
        const value = this.geometry();
        const distance = Math.abs(this.y + value.wearY - value.targetY);
        this.score = distance <= 5 ? 100 : Math.max(0, (1 - distance / 500) * 100);
        this.scoreAge = 0;
        this.state = 'stopped';
        return {
          score: this.score,
          distance
        };
      }
    }
    root.HairCatch = HairCatch;
  })(typeof window !== 'undefined' ? window : globalThis);
  window.createGame = function (value) {
    const {
      ctx: context,
      spec: value2
    } = value;
    const assets = value2.assets;
    const hairCatch = new window.HairCatch(value2.settings);
    let feedback = '';
    let previewAge = 0;
    function reset() {
      hairCatch.reset();
      feedback = '';
      previewAge = 0;
      value.guide(value.config.texts.find(item => item.id === 'GUIDE')?.value || "Tocca per fermare la parrucca");
      value.hud('', '', true);
      value.setAction("Ferma la parrucca che cade");
      value.result('');
    }
    return {
      reset,
      previewUpdate(value3) {
        previewAge += value3;
      },
      state: () => ({
        state: hairCatch.state,
        selected: hairCatch.selected,
        y: hairCatch.y,
        score: hairCatch.score,
        started: hairCatch.started
      }),
      isPlaying: () => hairCatch.started,
      action() {
        const value3 = hairCatch.tap();
        if (value3.score !== undefined) {
          feedback = value3.score >= 98 ? "Perfetta!" : value3.score >= 70 ? "Quasi!" : "Prova il prossimo look";
          value.tone(value3.score > 70 ? 'good' : 'bad');
          value.announce(value3.score.toLocaleString("it-IT", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }) + " per cento. " + feedback);
        }
        value.guide('', false);
      },
      update(value3) {
        hairCatch.tick(value3);
        if (hairCatch.state === 'stopped') {
          const value4 = value.reduced ? 1 : value.ease(Math.min(1, hairCatch.scoreAge));
          value.hud((hairCatch.score * value4).toLocaleString("it-IT", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }) + '%', '', true);
        } else value.hud('', '', true);
      },
      draw(value3) {
        context.fillStyle = '#f8d14f';
        context.fillRect(0, 0, value.w, value.h);
        value.photo(assets.background);
        const demo = window.PlayableBatch4Preview?.active;
        // Preview-only poses: the live drop, timing and score stay untouched.
        const index = demo ? window.PlayableBatch4Preview.reduced ? 0 : Math.floor(previewAge * 1000 / window.PlayablePreviewModels.hairCycleMs) % 2 : hairCatch.selected;
        const dimensions = hairCatch.geometry(index);
        const pose = demo ? window.PlayablePreviewModels.hairPose(previewAge * 1000, dimensions, window.PlayableBatch4Preview.reduced) : {
          y: hairCatch.y,
          alpha: 1
        };
        const value4 = Math.max(value.w / 720, value.h / 1280);
        context.save();
        if (demo) {
          context.beginPath();
          context.rect(0, value.h * 0.14 + 28, value.w, value.h);
          context.clip();
        }
        context.translate(value.w / 2, value.h / 2);
        context.scale(value4, value4);
        value.sprite(assets.person, 0, 207, 720, 866);
        context.save();
        context.translate(dimensions.x, -pose.y);
        context.rotate(-dimensions.angle);
        if (dimensions.flip) context.scale(-1, 1);
        value.sprite(assets.hair[index], 0, 0, dimensions.width, dimensions.height, 0, pose.alpha);
        context.restore();
        context.restore();
        if (!demo && hairCatch.state === 'stopped') {
          context.save();
          context.fillStyle = '#fff';
          context.shadowColor = '#000';
          context.shadowBlur = 5;
          context.textAlign = 'center';
          context.font = `700 ${18 * Math.min(value.w / 390, value.h / 598)}px Poppins`;
          context.fillText(feedback, value.w / 2, Math.min(value.h - 115, value.h * 0.78));
          context.restore();
        }
      }
    };
  };
  (function () {
    'use strict';

    const handleAction = value5 => document.getElementById(value5);
    const canvas = handleAction('canvas');
    const context = canvas.getContext('2d', {
      alpha: false
    });
    const spec = window.GAME_SPEC;
    const images = {};
    const config = {};
    const hosted = new URLSearchParams(location.search).get('host') === 'fyp' || new URLSearchParams(location.search).get('feedReview') === '1' || !!document.querySelector('script[src*="playable-batch/review-host.js"]');
    let running = false;
    let hidden = false;
    let hostActive = !hosted;
    let paused = false;
    let last = 0;
    let value = 0;
    let value2;
    document.documentElement.dataset.feedPreview = String(hosted && !hostActive);
    const soundNodes = new Set();
    const voices = new Set();
    let value3;
    const value4 = window.Playable = {
      spec,
      images,
      ctx: context,
      canvas,
      w: 390,
      h: 598,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      config,
      clamp: (value5, otherValue, argument3) => Math.max(otherValue, Math.min(argument3, value5)),
      mix: (value5, otherValue, argument3) => value5 + (otherValue - value5) * argument3,
      ease: value5 => 1 - Math.pow(1 - value5, 3),
      cover(value5) {
        const dimensions = images[value5];
        const point2 = spec.photoFraming;
        const value6 = Math.max(value4.w / dimensions.width, value4.h / dimensions.height) * (point2?.zoom || 1);
        const value7 = dimensions.width * value6;
        const value8 = dimensions.height * value6;
        let y = point2 ? value4.h * point2.screenY - value8 * point2.y : (value4.h - value8) / 2;
        if (point2?.topLandmark !== undefined) y = Math.max(y, value4.h * point2.minTop - value8 * point2.topLandmark);
        return {
          x: point2 ? value4.clamp(value4.w * 0.5 - value7 * point2.x, value4.w - value7, 0) : (value4.w - value7) / 2,
          y: value4.clamp(y, value4.h - value8, 0),
          w: value7,
          h: value8
        };
      },
      photo(value5, alpha = 1) {
        const point2 = value4.cover(value5);
        context.save();
        context.globalAlpha = alpha;
        context.drawImage(images[value5], point2.x, point2.y, point2.w, point2.h);
        context.restore();
        return point2;
      },
      point(value5, point2) {
        const point3 = value4.cover(value5);
        return {
          x: point3.x + point3.w * point2.x,
          y: point3.y + point3.h * point2.y
        };
      },
      sprite(value5, x, y, argument4, argument5, rotation = 0, alpha = 1, anchor = {
        x: 0.5,
        y: 0.5
      }) {
        const dimensions = images[value5];
        if (!dimensions || !Number.isFinite(x + y + argument4)) return;
        argument5 = argument5 ?? argument4 * dimensions.height / dimensions.width;
        context.save();
        context.translate(x, y);
        context.rotate(rotation);
        context.globalAlpha = alpha;
        context.drawImage(dimensions, -argument4 * anchor.x, -argument5 * anchor.y, argument4, argument5);
        context.restore();
      },
      frame(value5, otherValue, duration, x, y, argument6, argument7, loop = false) {
        if (otherValue < 0 || !loop && otherValue >= duration) return;
        if (loop && value4.reduced) otherValue = duration * 0.5;
        const value6 = Math.min(value5.length - 1, Math.floor((loop ? otherValue % duration : otherValue) / duration * value5.length));
        value4.sprite(value5[value6], x, y, argument6, argument7);
      },
      hud(left = '', right = '', center = false) {
        handleAction('left').textContent = left;
        handleAction('right').textContent = right;
        handleAction('hud').classList.toggle('center', center);
      },
      guide(text, show = true) {
        handleAction('guide').textContent = text;
        handleAction('guide').hidden = !show;
      },
      result(title, value5 = '') {
        handleAction('resultTitle').textContent = title;
        handleAction('resultSub').textContent = value5;
        handleAction('result').hidden = !title;
        handleAction('retry').hidden = !title;
      },
      announce(text) {
        handleAction('status').textContent = text;
      },
      unlock() {
        try {
          value3 ??= new (window.AudioContext || window.webkitAudioContext)();
          if (value3.state === 'suspended') value3.resume().catch(() => {});
        } catch {}
      },
      tone(kind = 'good') {
        if (!value3 || value3.state !== 'running') return;
        const currentTime = value3.currentTime;
        const oscillator = value3.createOscillator();
        const gain = value3.createGain();
        oscillator.type = kind === 'bad' ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(kind === 'bad' ? 230 : 650, currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(kind === 'bad' ? 130 : 900, currentTime + 0.12);
        gain.gain.setValueAtTime(0.0001, currentTime);
        gain.gain.exponentialRampToValueAtTime(0.2, currentTime + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.17);
        oscillator.connect(gain);
        gain.connect(value3.destination);
        oscillator.start();
        oscillator.stop(currentTime + 0.19);
        voices.add(oscillator);
        oscillator.onended = () => {
          voices.delete(oscillator);
          oscillator.disconnect();
          gain.disconnect();
        };
      },
      sound(value5, volume = 0.5, loop = false) {
        const path = spec.audio[value5];
        if (!path) return null;
        const audio = new Audio(path);
        audio.volume = volume;
        audio.loop = loop;
        soundNodes.add(audio);
        audio.addEventListener('ended', () => soundNodes.delete(audio), {
          once: true
        });
        audio.play().catch(() => {
          soundNodes.delete(audio);
        });
        return audio;
      },
      stop(value5) {
        if (value5) {
          value5.pause();
          value5.currentTime = 0;
          soundNodes.delete(value5);
        }
      },
      silence() {
        for (const value5 of soundNodes) value4.stop(value5);
        for (const value5 of voices) {
          try {
            value5.stop();
          } catch {}
        }
        voices.clear();
      },
      setAction(label) {
        handleAction('play').setAttribute('aria-label', label);
      },
      releaseInput() {
        endPointer();
      },
      setDirection(show, otherValue) {
        handleAction('direction').hidden = !show;
        handleAction('direction').onclick = () => {
          if (paused || !hostActive) return;
          value4.unlock();
          otherValue();
        };
      },
      debug: () => ({
        state: value2?.state?.(),
        paused,
        hostActive,
        hidden,
        loaded: Object.keys(images).length,
        sounds: soundNodes.size
      })
    };
    function size() {
      const dimensions = canvas.getBoundingClientRect();
      value4.w = dimensions.width;
      value4.h = dimensions.height;
      const value5 = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.round(dimensions.width * value5);
      canvas.height = Math.round(dimensions.height * value5);
      context.setTransform(value5, 0, 0, value5, 0, 0);
      document.documentElement.style.setProperty('--ui', Math.min(dimensions.width / 390, dimensions.height / 598));
      value2?.resize?.();
    }
    function reset() {
      endPointer();
      value4.silence();
      paused = false;
      handleAction('pause').hidden = true;
      value4.result('');
      handleAction('direction').hidden = true;
      value2.reset();
      value4.announce("Pronto");
      if (running) value2.draw(0);
      last = 0;
    }
    function point(event) {
      const bounds = canvas.getBoundingClientRect();
      return {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      };
    }
    function canInput() {
      return running && !paused && hostActive && !hidden;
    }
    function action(value5) {
      if (!canInput() || value2.inputMode === 'drag') return;
      value4.unlock();
      const value6 = value5 ? point(value5) : {
        x: value4.w / 2,
        y: value4.h * 0.7
      };
      value2.action(value6);
    }
    let down = null;
    function endPointer() {
      const value5 = down;
      down = null;
      value2?.pointerEnd?.();
      if (value5 && handleAction('play').hasPointerCapture?.(value5.id)) handleAction('play').releasePointerCapture(value5.id);
    }
    handleAction('play').addEventListener('pointerdown', event => {
      if (event.isPrimary === false || event.button !== 0 || !canInput()) return;
      if (value2.inputMode === 'drag') {
        value4.unlock();
        if (!value2.pointerStart(point(event))) return;
        event.preventDefault();
        down = {
          id: event.pointerId
        };
        handleAction('play').setPointerCapture(event.pointerId);
        return;
      }
      down = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY
      };
    });
    handleAction('play').addEventListener('pointermove', event => {
      if (value2?.inputMode !== 'drag' || !down || event.pointerId !== down.id) return;
      if (!canInput() || event.buttons === 0) {
        endPointer();
        return;
      }
      event.preventDefault();
      value2.pointerMove(point(event));
    });
    handleAction('play').addEventListener('pointercancel', event => {
      if (down && event.pointerId === down.id) endPointer();
    });
    handleAction('play').addEventListener('lostpointercapture', event => {
      if (down && event.pointerId === down.id) endPointer();
    });
    handleAction('play').addEventListener('pointerup', event => {
      if (!down || event.pointerId !== down.id) return;
      const point2 = down;
      if (value2.inputMode === 'drag') {
        endPointer();
        return;
      }
      down = null;
      if (Math.hypot(event.clientX - point2.x, event.clientY - point2.y) > 18) return;
      action(event);
    });
    handleAction('play').addEventListener('click', event => {
      if (event.detail === 0) action();
    });
    handleAction('play').addEventListener('keydown', event => {
      if (!canInput() || !value2.keyStroke || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      value4.unlock();
      value2.keyStroke(event.key);
    });
    handleAction('retry').onclick = () => {
      value4.unlock();
      reset();
    };
    handleAction('resume').onclick = () => {
      value4.unlock();
      paused = false;
      handleAction('pause').hidden = true;
      value2.resume?.();
      last = 0;
    };
    function pause() {
      endPointer();
      value4.silence();
      value2?.pause?.();
      if (running && value2?.isPlaying?.()) {
        paused = true;
        handleAction('pause').hidden = false;
      }
    }
    document.addEventListener('visibilitychange', () => {
      hidden = document.hidden;
      if (hidden) pause();
      last = 0;
    });
    window.addEventListener('blur', pause);
    window.addEventListener('resize', size);
    // Only the parent frame can control activity; never accept commands from sibling windows.
    window.addEventListener('message', event => {
      if (event.source !== parent || parent === window) return;
      const data = event.data;
      if (data?.type === 'playable-active' && typeof data.active === 'boolean') {
        hostActive = data.active;
        document.documentElement.dataset.feedPreview = String(!hostActive);
        if (!hostActive && running) {
          pause();
          reset();
        }
        last = 0;
      }
    });
    function palette() {
      if (parent === window) return;
      const dimensions = document.createElement('canvas');
      dimensions.width = 32;
      dimensions.height = 48;
      const x = dimensions.getContext('2d');
      x.drawImage(canvas, 0, 0, 32, 48);
      try {
        parent.postMessage({
          type: 'playable-palette',
          top: Array.from(x.getImageData(0, 0, 32, 12).data),
          bottom: Array.from(x.getImageData(0, 36, 32, 12).data)
        }, location.origin);
      } catch {}
    }
    function loop(value5) {
      requestAnimationFrame(loop);
      if (!running || hidden || paused) {
        last = 0;
        return;
      }
      const value6 = last ? Math.min(0.05, (value5 - last) / 1000) : 0;
      last = value5;
      value += value6;
      if (hostActive) value2.update(value6);else value2.previewUpdate?.(value6);
      value2.draw(value);
      const state = value2.state?.().state;
      if (handleAction('stage').dataset.state !== state) handleAction('stage').dataset.state = state;
    }
    async function boot() {
      try {
        const config2 = await requestGameConfig().then(response => {
          if (!response.ok) throw Error("Impossibile caricare la configurazione");
          return response.json();
        });
        Object.assign(config, config2);
        for (const value5 of config2.tweaks || []) {
          if (typeof value5.value === 'number' && Number.isFinite(value5.value)) spec.settings[value5.id] = value4.clamp(value5.value, value5.min ?? -Infinity, value5.max ?? Infinity);
        }
        await Promise.all(config2.images.map(async slot => {
          if (!slot.path || /^(https?:|data:)/.test(slot.path)) throw Error("L’immagine deve usare un percorso locale: " + slot.id);
          const image = new Image();
          image.src = slot.path;
          await image.decode();
          images[slot.id] = image;
        }));
        await document.fonts.ready;
        document.title = spec.title;
        handleAction('stage').className = spec.id;
        value2 = window.createGame(value4);
        size();
        reset();
        running = true;
        handleAction('loading').hidden = true;
        value2.draw(0);
        document.documentElement.dataset.playableLoading = 'false';
        palette();
        requestAnimationFrame(loop);
      } catch (value5) {
        handleAction('loading').classList.add('error');
        handleAction('loading').textContent = "Impossibile caricare il gioco. " + value5.message;
        console.error(value5);
      }
    }
    boot();
  })();

  // playable-cta-breathing-20261030

  /* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
  (() => {
    const selectors = ["p#guide"];
    const copy = new Set(["Tocca per fermare la parrucca"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
  return <><main id={"stage"}><canvas id={"canvas"} aria-hidden={"true"}></canvas><button id={"play"} aria-label={"Gioca"}></button><div id={"hud"} className={"hud"} aria-hidden={"true"}><span id={"left"}></span><span id={"right"}></span></div><p id={"guide"}></p><div id={"result"} hidden={true}><span id={"resultTitle"}></span><small id={"resultSub"}></small></div><div className={"controls"}><button id={"retry"} className={"control"} hidden={true}>{"Riprova"}</button><button id={"direction"} className={"control"} hidden={true} aria-label={"Cambia direzione"}><svg viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} aria-hidden={"true"}><path d={"M6 17V4m-3 3 3-3 3 3m9 0v13m-3-3 3 3 3-3"}></path></svg><span>{"Direction"}</span></button></div><div id={"pause"} hidden={true}><button id={"resume"}>{"Tocca per riprendere"}</button></div><div id={"loading"} role={"status"}>{"Caricamento…"}</div><div id={"status"} role={"status"} aria-live={"polite"} className={"sr"}></div></main></>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
