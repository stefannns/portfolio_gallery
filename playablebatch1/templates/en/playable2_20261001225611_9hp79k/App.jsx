// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "GRAVITY",
    "kind": "number",
    "label": "Gravity",
    "value": 0.12,
    "default": 0.12,
    "min": 0.02,
    "max": 2.5,
    "step": 0.1
  }, {
    "id": "BALL_RESTITUTION",
    "kind": "number",
    "label": "Ball Bounciness",
    "value": 0.85,
    "default": 0.85,
    "min": 0.1,
    "max": 1.2,
    "step": 0.05
  }, {
    "id": "LINE_RESTITUTION",
    "kind": "number",
    "label": "Line Bounciness",
    "value": 0.8,
    "default": 0.8,
    "min": 0.1,
    "max": 1.2,
    "step": 0.05
  }, {
    "id": "BALL_RADIUS",
    "kind": "number",
    "label": "Ball Radius",
    "value": 24,
    "default": 24,
    "min": 10,
    "max": 50,
    "step": 1
  }, {
    "id": "LINE_THICKNESS",
    "kind": "number",
    "label": "Line Thickness",
    "value": 8,
    "default": 8,
    "min": 4,
    "max": 20,
    "step": 1
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "Ball Line Bouncer",
    "default": "Ball Line Bouncer",
    "max_length": 30
  }, {
    "id": "GAME_OVER_TITLE",
    "label": "Game Over Title",
    "value": "Game Over",
    "default": "Game Over",
    "max_length": 20
  }, {
    "id": "BTN_RESTART",
    "label": "Add Ball Button",
    "value": "Add Ball",
    "default": "Add Ball",
    "max_length": 15
  }, {
    "id": "BTN_RESET",
    "label": "Reset Button",
    "value": "Reset",
    "default": "Reset",
    "max_length": 15
  }, {
    "id": "BTN_POST",
    "label": "Post Button",
    "value": "Post My Play",
    "default": "Post My Play",
    "max_length": 20
  }],
  "images": [{
    "id": "BALL_IMG",
    "label": "Ball Image",
    "path": "./assets/ball_img.webp",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "99278216745139447",
    "version_id": "99278216744990522",
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
// Preserve the original fallback when the configuration cannot be fetched.
for (const value of ['playable-inline-config', 'playable-config-inline']) {
  const node = document.createElement('script');
  node.id = value;
  node.type = 'application/json';
  node.textContent = JSON.stringify(DEFAULT_CONFIG);
  document.body.append(node);
}
document.documentElement.lang = 'en';
function CI(config) {
  let options = {};
  (config.tweaks || []).forEach(item => {
    options[item.id] = item.value;
  });
  (config.texts || []).forEach(item => {
    options[item.id] = item.value;
  });
  (config.images || []).forEach(item => {
    options[item.id] = item.path;
  });
  (config.mentions || []).forEach(item => {
    options[item.id] = item.path != null && item.path !== "" ? item.path : item.value;
  });
  (config.motions || []).forEach(item => {
    if (!(!item || !item.id)) {
      if (item.base_path != null && item.base_path !== "") {
        options[item.id] = item.base_path;
        options[item.id + "_BASE"] = item.base_path;
      }
      if (item.frame_count != null) {
        options[item.id + "_COUNT"] = item.frame_count;
      }
    }
  });
  return options;
}
function App() {
  const createElement = React.createElement;
  const canvas = React.useRef(null);
  const root = React.useRef(null);
  const count = React.useRef(1);
  const angles = React.useRef([0]);
  const bornAt = React.useRef([performance.now()]);
  const [ballCount, setBallCount] = React.useState(1);
  const [config, setConfig] = React.useState({});
  const colors = ["#f0444d", "#a66dff", "#52cf6c", "#36baff", "#ffc247", "#ff77c8", "#48d9d4", "#ff834f", "#a6e85a", "#6f91ff", "#e66fee", "#faf16f"];
  React.useEffect(() => {
    let active = true;
    fetch("./game.config.json", {
      cache: "no-store"
    }).then(response => response.json()).then(data => {
      if (active) setConfig(CI(data));
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  React.useEffect(() => {
    const dimensions = canvas.current;
    const container = root.current;
    if (!dimensions || !container) return;
    const context = dimensions.getContext("2d", {
      alpha: false
    });
    let frame = 0;
    let value = 0;
    let value2 = 0;
    let value3 = 1;
    const resize = () => {
      const dimensions2 = container.getBoundingClientRect();
      value = dimensions2.width;
      value2 = dimensions2.height;
      value3 = Math.min(window.devicePixelRatio || 1, 3);
      dimensions.width = Math.max(1, Math.round(value * value3));
      dimensions.height = Math.max(1, Math.round(value2 * value3));
      dimensions.style.width = value + "px";
      dimensions.style.height = value2 + "px";
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();
    const paint = value4 => {
      frame = requestAnimationFrame(paint);
      if (!value || !value2) return;
      context.setTransform(value3, 0, 0, value3, 0, 0);
      context.fillStyle = "#000";
      context.fillRect(0, 0, value, value2);
      const value5 = value / 2;
      const value6 = value2 * 0.475;
      const value7 = Math.min(value * 0.445, value2 * 0.31);
      const current = count.current;
      context.lineCap = "round";
      for (let value8 = 0; value8 < current; value8++) {
        const value9 = angles.current[value8];
        const value10 = Math.cos(value9);
        const value11 = Math.sin(value9);
        context.beginPath();
        context.moveTo(value5 - value10 * value7, value6 - value11 * value7);
        context.lineTo(value5 + value10 * value7, value6 + value11 * value7);
        context.strokeStyle = "#f4f4f4";
        context.lineWidth = 2.1;
        context.stroke();
      }
      for (let value8 = 0; value8 < current; value8++) {
        const value9 = angles.current[value8];
        const side = value8 % 2 === 1 ? -1 : 1;
        const value12 = Math.max(11, Math.min(15, value * 0.037));
        // Each ball begins touching the outer endpoint and keeps its own motion clock.
        const phase = Math.max(0, value4 - bornAt.current[value8]) * .00215;
        const alignedDistance = (value7 - value12) * (1 + Math.cos(phase)) * .5;
        const value10 = value5 + Math.cos(value9) * alignedDistance * side;
        const value11 = value6 + Math.sin(value9) * alignedDistance * side;
        context.beginPath();
        context.arc(value10, value11, value12, 0, Math.PI * 2);
        context.fillStyle = colors[value8 % colors.length];
        context.fill();
      }
    };
    frame = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, []);
  const addBall = () => {
    if (count.current >= 24) return;
    // Add a new line into the widest gap without moving any existing line or ball.
    const sorted = [...angles.current].sort((a, b) => a - b);
    let widest = -1, next = 0;
    for (let i = 0; i < sorted.length; i++) {
      const start = sorted[i], end = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI;
      if (end - start > widest) { widest = end - start; next = (start + widest / 2) % Math.PI; }
    }
    angles.current.push(next);
    bornAt.current.push(performance.now());
    count.current = angles.current.length;
    setBallCount(count.current);
    if (navigator.vibrate) navigator.vibrate(12);
  };
  const reset = () => {
    angles.current = [0];
    bornAt.current = [performance.now()];
    count.current = 1;
    setBallCount(1);
    if (navigator.vibrate) navigator.vibrate(12);
  };
  return <div ref={root} style={{
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    background: "#000",
    touchAction: "none",
    fontFamily: "Arial, sans-serif"
  }}>{<canvas ref={canvas} aria-label={ballCount + " colored balls moving on radial white lines"} style={{
      position: "absolute",
      inset: 0,
      display: "block"
    }} />}{<div style={{
      position: "absolute", left: 30, right: 30,
      bottom: "max(42px, env(safe-area-inset-bottom))",
      display: "flex", justifyContent: "center", gap: 10
    }}><button type="button" onClick={addBall} style={{
      flex: "1 1 0", maxWidth: 160, minWidth: 0, minHeight: 54, padding: "10px 8px",
      border: 0, borderRadius: 13, background: "#1686f7", boxShadow: "0 4px 0 #0758ac",
      color: "#fff", fontSize: 18, fontWeight: 700, cursor: "pointer", touchAction: "manipulation"
    }}>{config.BTN_RESTART || 'Add Ball'}</button><button type="button" onClick={reset} style={{
      flex: "1 1 0", maxWidth: 160, minWidth: 0, minHeight: 54, padding: "10px 8px",
      border: "2px solid #7cc6ff", borderRadius: 13, background: "#222b37",
      boxShadow: "0 4px 0 #111922", color: "#fff", fontSize: 18, fontWeight: 700,
      cursor: "pointer", touchAction: "manipulation"
    }}>{config.BTN_RESET || 'Reset'}</button></div>}</div>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": ""
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
  const selectors = [];
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

// Game helper

/* Batch 3 entry polish. Preview covers are still images in the feed. */
(() => {
  'use strict';

  const number = Number({
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "",
        "data-batch3-game": "37"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "37"
    }
  }?.dataset.batch3Game);
  const isFeed = new URLSearchParams(location.search).get('feedReview') === '1' && window.parent !== window;
  const root = document.documentElement;
  root.toggleAttribute('data-batch3-preview', isFeed);
  const configurations = {
    12: {
      text: 'Tap to pop the bubbles',
      top: '80px',
      color: '#a2355a',
      action: 'bubble'
    },
    20: {
      text: 'Tap the bug',
      top: '32%',
      color: '#fff',
      action: 'bug'
    },
    27: {
      text: 'Guess their age',
      top: '10.5%',
      color: '#fff',
      action: 'age'
    },
    37: {
      text: 'Tap to add balls',
      top: '24%',
      color: '#fff',
      action: 'add-ball'
    },
    39: {
      text: 'Tap squares to find the animal',
      top: '22%',
      color: '#29202e',
      action: 'cell'
    },
    49: {
      text: 'Guess the hidden code',
      top: '40%',
      color: '#fff',
      action: 'digit'
    },
    60: {
      text: 'Steer into the parking spot',
      top: '34%',
      color: '#fff',
      action: 'drive'
    }
  };
  const previewCSS = {
    8: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    11: 'html[data-batch3-preview] .screen-container div:has(>button.btn-option){transform:translateY(-8vh) scale(.84);transform-origin:center center}',
    13: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    25: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    27: 'html[data-batch3-preview] .age-controls {transform:translateY(-16vh) scale(.9);transform-origin:bottom center}',
    30: 'html[data-batch3-preview] .btn-control {visibility:hidden!important}',
    34: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    37: 'html[data-batch3-preview] #root button {bottom:34%!important}',
    38: 'html[data-batch3-preview] .pendulum-actions {visibility:hidden!important}',
    39: 'html[data-batch3-preview] [aria-label="8 by 8 animal search map"] {transform:scale(.84);transform-origin:center top}',
    43: 'html[data-batch3-preview] .meme-controls {visibility:hidden!important}',
    48: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    49: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    52: 'html[data-batch3-preview] .fate-wheel-wrap {transform:scale(.84)}',
    54: 'html[data-batch3-preview] .control {visibility:hidden!important}',
    56: 'html[data-batch3-preview] .drive-controls {visibility:hidden!important}',
    60: 'html[data-batch3-preview] #root div:has(>div>button[aria-label="Steer left"]) {visibility:hidden!important}',
    73: 'html[data-batch3-preview] #opening .opening-heading p {animation:b3-breathe 2.4s ease-in-out infinite}',
    74: 'html[data-batch3-preview] #photo-controls {visibility:hidden!important}'
  };
  const sharedCSS = `
    .b3-guide{position:fixed;left:30px;right:30px;z-index:120;margin:0;text-align:center;
      font:700 18px/1.3 var(--font-display,system-ui,sans-serif);pointer-events:none;
      text-shadow:0 1px 3px rgba(0,0,0,.25);animation:b3-breathe 2.4s ease-in-out infinite}
    @keyframes b3-breathe{0%,100%{opacity:1}50%{opacity:.68}}
    html[data-b3-hidden] .b3-guide,html[data-b3-hidden] #opening .opening-heading p{animation-play-state:paused!important}
    @media(prefers-reduced-motion:reduce){.b3-guide,html[data-batch3-preview] #opening .opening-heading p{animation:none!important}}
    ${previewCSS[number] || ''}
  `;
  const style = document.createElement('style');
  style.setAttribute('data-batch3-polish', '');
  style.textContent = sharedCSS;
  document.head.append(style);
  let guide;
  let dismissed = false;
  const config = configurations[number];
  function mountGuide() {
    if (!config || guide || dismissed) return;
    guide = document.createElement('p');
    guide.className = 'b3-guide';
    guide.textContent = config.text;
    guide.style.top = config.top;
    guide.style.color = config.color;
    document.body.append(guide);
  }
  function meaningful(event) {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (config?.action === 'bug') return !!target.closest('#root div[tabindex="0"]');
    if (config?.action === 'bubble') {
      if (target.closest('#root div[tabindex="0"],#root canvas')) return true;
      const value = target.closest('button');
      return !!value && /^(Sand Art|Spinner)$/.test(value.textContent.trim());
    }
    if (config?.action === 'age') return !!target.closest('input[type="range"],button.guess');
    const button = target.closest('button');
    if (!button || button.disabled) return false;
    if (config?.action === 'add-ball') return button.textContent.trim() === 'Add Ball';
    if (config?.action === 'cell') return /^Check cell \d+$/.test(button.getAttribute('aria-label') || '');
    if (config?.action === 'digit') return /^\d$/.test(button.textContent.trim());
    if (config?.action === 'drive') return /^(Steer left|Steer right|Drive forward|Reverse)$/.test(button.getAttribute('aria-label') || '');
    return false;
  }
  function dismissOnAction(event) {
    if (root.hasAttribute('data-batch3-preview')) return;
    if (meaningful(event)) {
      dismissed = true;
      guide?.remove();
      guide = null;
    }
  }
  document.addEventListener('pointerdown', dismissOnAction, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') dismissOnAction(event);
  }, true);
  window.addEventListener('message', event => {
    if (!isFeed || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    root.toggleAttribute('data-batch3-preview', event.data.active !== true);
  });
  document.addEventListener('visibilitychange', () => {
    root.toggleAttribute('data-b3-hidden', document.hidden);
  });
  const observer = new MutationObserver(mountGuide);
  const start = () => {
    mountGuide();
    observer.observe(document.getElementById('root') || document.body, {
      childList: true,
      subtree: true
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {
    once: true
  });else start();
  window.addEventListener('pagehide', () => {
    observer.disconnect();
  }, {
    once: true
  });
})();
