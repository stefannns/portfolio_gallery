// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "SEGMENTS",
    "kind": "number",
    "label": "Segments",
    "value": 12,
    "default": 12,
    "min": 4,
    "max": 24,
    "step": 1
  }, {
    "id": "BRUSH_SIZE",
    "kind": "number",
    "label": "Brush Size",
    "value": 4,
    "default": 4,
    "min": 2,
    "max": 16,
    "step": 1
  }, {
    "id": "GLOW",
    "kind": "number",
    "label": "Glow Effect",
    "value": 25,
    "default": 25,
    "min": 0,
    "max": 50,
    "step": 1
  }, {
    "id": "COLOR_SPEED",
    "kind": "number",
    "label": "Color Speed",
    "value": 1.5,
    "default": 1.5,
    "min": 0.1,
    "max": 5,
    "step": 0.1
  }],
  "texts": [{
    "id": "TXT_TITLE",
    "label": "App Title",
    "value": "MANDALA // SYMMETRY",
    "default": "MANDALA // SYMMETRY",
    "max_length": 30
  }, {
    "id": "TXT_PRINT",
    "label": "Print Btn",
    "value": "PRINT",
    "default": "PRINT",
    "max_length": 15
  }, {
    "id": "TXT_HIDE",
    "label": "Hide UI Btn",
    "value": "HIDE UI",
    "default": "HIDE UI",
    "max_length": 15
  }, {
    "id": "TXT_SHOW",
    "label": "Show UI Btn",
    "value": "SHOW UI",
    "default": "SHOW UI",
    "max_length": 15
  }, {
    "id": "TXT_CLEAR",
    "label": "Clear Btn",
    "value": "CLEAR",
    "default": "CLEAR",
    "max_length": 15
  }, {
    "id": "TXT_UNDO",
    "label": "Undo Btn",
    "value": "UNDO",
    "default": "UNDO",
    "max_length": 15
  }, {
    "id": "TXT_PAUSE",
    "label": "Pause Colors Btn",
    "value": "PAUSE COLORS",
    "default": "PAUSE COLORS",
    "max_length": 20
  }, {
    "id": "TXT_RESUME",
    "label": "Resume Colors Btn",
    "value": "RESUME COLORS",
    "default": "RESUME COLORS",
    "max_length": 20
  }, {
    "id": "TXT_INSTRUCT",
    "label": "Instruction Text",
    "value": "TOUCH + DRAG\nTO DRAW",
    "default": "TOUCH + DRAG\nTO DRAW",
    "max_length": 40
  }],
  "images": [],
  "config_version": "2.0",
  "playable": {
    "post_id": "99279036236539903",
    "version_id": "99279036236600477",
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

/* All controls, status and the hint share one compact top toolbar. */
.mandala-toolbar{position:absolute;top:calc(30px + env(safe-area-inset-top,0px));left:calc(30px + env(safe-area-inset-left,0px));right:calc(30px + env(safe-area-inset-right,0px));z-index:10;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.mandala-toolbar button{min-width:0;line-height:1.25;overflow-wrap:anywhere}
.mandala-toolbar button:disabled{opacity:.4;cursor:default;box-shadow:none!important;text-shadow:none!important}
.mandala-toolbar button:focus-visible,.mandala-show-ui button:focus-visible{outline:2px solid #d9ffe6;outline-offset:3px}
.mandala-toolbar-primary{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.mandala-toolbar-drawing{display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:8px}
.mandala-status{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px 10px;color:#94d6a6;font:12px/1.4 var(--font-mono);padding:3px 0}
.mandala-status span{white-space:nowrap}
.mandala-color-status{display:inline-flex;align-items:center;gap:5px}
.mandala-color-status i{width:6px;height:6px;border-radius:50%;background:#00ff41;box-shadow:0 0 4px #00ff41}
.mandala-color-status[data-paused="true"] i{background:#94d6a6;box-shadow:none}
.mandala-guide{margin:0;min-height:24px;text-align:center;font:18px/1.3 var(--font-display);color:#d9ffe6;pointer-events:none;overflow-wrap:anywhere}
.mandala-guide[aria-hidden="true"]{visibility:hidden}
.mandala-show-ui{position:absolute;top:calc(30px + env(safe-area-inset-top,0px));right:calc(30px + env(safe-area-inset-right,0px));z-index:11}
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
function pp(config) {
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
const MANDALA_CENTER_Y = .58;
function GameVp({
  cfg: e
}) {
  let [guideUsed, setGuideUsed] = React.useState(!1);
  let elementRef = React.useRef(null);
  let elementRef2 = React.useRef(null);
  let [currentValue, setCurrentValue] = React.useState(!0);
  let [currentValue2, setCurrentValue2] = React.useState(!1);
  let [currentValue3, setCurrentValue3] = React.useState(!1);
  let stateRef = React.useRef(!1);
  let stateRef2 = React.useRef({
    x: 0,
    y: 0
  });
  let stateRef3 = React.useRef(0);
  let stateRef4 = React.useRef([]);
  let stateRef5 = React.useRef(null);
  let value = window.devicePixelRatio || 1;
  React.useEffect(() => {
    let dimensions = elementRef.current;
    let element = elementRef2.current;
    if (!dimensions || !element) return;
    let handleAction4 = () => {
      let dimensions2 = element.getBoundingClientRect();
      let value2 = dimensions.width > 0 && dimensions.height > 0 ? dimensions.getContext("2d").getImageData(0, 0, dimensions.width, dimensions.height) : null;
      dimensions.width = dimensions2.width * value;
      dimensions.height = dimensions2.height * value;
      let context = dimensions.getContext("2d");
      context.lineCap = "round";
      context.lineJoin = "round";
      if (value2) {
        context.putImageData(value2, 0, 0);
      } else {
        context.fillStyle = "#000";
        context.fillRect(0, 0, dimensions.width, dimensions.height);
      }
    };
    let resizeObserver = new ResizeObserver(handleAction4);
    resizeObserver.observe(element);
    handleAction4();
    return () => resizeObserver.disconnect();
  }, [value]);
  React.useEffect(() => {
    let handleAction4 = () => {
      if (!currentValue2) {
        stateRef3.current = (stateRef3.current + (e.COLOR_SPEED || 1)) % 360;
      }
      stateRef5.current = requestAnimationFrame(handleAction4);
    };
    stateRef5.current = requestAnimationFrame(handleAction4);
    return () => cancelAnimationFrame(stateRef5.current);
  }, [currentValue2, e.COLOR_SPEED]);
  let handleAction = () => {
    let dimensions = elementRef.current;
    let context = dimensions.getContext("2d");
    stateRef4.current.push(context.getImageData(0, 0, dimensions.width, dimensions.height));
    if (stateRef4.current.length > 20) {
      stateRef4.current.shift();
    }
    setCurrentValue3(!0);
  };
  let handleAction2 = value2 => {
    let element = elementRef.current;
    let bounds = element.getBoundingClientRect();
    let event = value2.touches ? value2.touches[0] : value2;
    return event ? {
      x: (event.clientX - bounds.left) * value - element.width / 2,
      y: (event.clientY - bounds.top) * value - element.height * MANDALA_CENTER_Y
    } : null;
  };
  let handleAction3 = (context, point, point2, argument4) => {
    let value2 = `hsl(${argument4}, 100%, 60%)`;
    context.strokeStyle = value2;
    context.shadowColor = value2;
    context.shadowBlur = e.GLOW || 20;
    context.lineWidth = (e.BRUSH_SIZE || 4) * value;
    let value3 = e.SEGMENTS || 12;
    let value4 = Math.PI * 2 / value3;
    context.save();
    context.translate(context.canvas.width / 2, context.canvas.height * MANDALA_CENTER_Y);
    for (let value5 = 0; value5 < value3; value5++) {
      context.rotate(value4);
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(point2.x, point2.y);
      context.stroke();
      context.save();
      context.scale(1, -1);
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(point2.x, point2.y);
      context.stroke();
      context.restore();
    }
    context.restore();
  };
  let handlePointerDown = value2 => {
    if (value2.isPrimary === false || value2.button > 0) return;
    let point = handleAction2(value2);
    if (!point) return;
    setGuideUsed(!0);
    handleAction();
    stateRef.current = !0;
    stateRef2.current = point;
    let canvas = elementRef.current;
    handleAction3(canvas.getContext("2d"), point, {
      x: point.x + 0.1,
      y: point.y + 0.1
    }, stateRef3.current);
  };
  let handlePointerMove = event => {
    if (!stateRef.current) return;
    if (event.cancelable) {
      event.preventDefault();
    }
    let value2 = handleAction2(event);
    if (!value2) return;
    let canvas = elementRef.current;
    handleAction3(canvas.getContext("2d"), stateRef2.current, value2, stateRef3.current);
    stateRef2.current = value2;
  };
  let handlePointerUp = () => {
    stateRef.current = !1;
  };
  let x = () => {
    handleAction();
    let dimensions = elementRef.current;
    let context = dimensions.getContext("2d");
    context.fillStyle = "#000";
    context.fillRect(0, 0, dimensions.width, dimensions.height);
  };
  let handleClick = () => {
    if (stateRef4.current.length === 0) return;
    let context = elementRef.current.getContext("2d");
    let value2 = stateRef4.current.pop();
    context.putImageData(value2, 0, 0);
    setCurrentValue3(stateRef4.current.length > 0);
  };
  let options = {
    border: "1px solid #00ff41",
    boxShadow: "0 0 4px rgba(0, 255, 65, 0.5), inset 0 0 4px rgba(0, 255, 65, 0.5)",
    padding: "10px 12px",
    minHeight: "44px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#00ff41",
    textShadow: "0 0 4px rgba(0, 255, 65, 0.8)",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    backdropFilter: "blur(4px)",
    cursor: "pointer",
    pointerEvents: "auto",
    textTransform: "uppercase",
    fontSize: "14px",
    fontFamily: "inherit"
  };
  return <React.Fragment>{<style>{`
        html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #000; }
        * { box-sizing: border-box; }
        @font-face {
          font-family: 'Audiowide';
          src: url('./assets/fonts/audiowide/Audiowide-Regular.woff2') format('woff2');
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
        :root {
          --font-display: "Audiowide", "PingFang SC", system-ui, sans-serif;
          --font-body: -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
          --font-mono: ui-monospace, Menlo, monospace;
        }
      `}</style>}{<div ref={elementRef2} style={{
      width: "100%",
      height: "100%",
      position: "relative",
      fontFamily: "var(--font-display)",
      containerType: "size"
    }}>{<canvas ref={elementRef} style={{
        width: "100%",
        height: "100%",
        display: "block",
        touchAction: "none"
      }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} />}{<div className="mandala-toolbar" role="toolbar" aria-label="Drawing controls" aria-hidden={!currentValue} style={{
        opacity: currentValue ? 1 : 0,
        visibility: currentValue ? 'visible' : 'hidden',
        transition: 'opacity .2s'
      }}>
        <div className="mandala-toolbar-primary">
          <button type="button" style={options} onClick={() => window.print()}>{e.TXT_PRINT}</button>
          <button type="button" style={options} onClick={() => setCurrentValue(false)}>{e.TXT_HIDE}</button>
        </div>
        <div className="mandala-toolbar-drawing">
          <button type="button" style={options} onClick={x}>{e.TXT_CLEAR}</button>
          <button type="button" style={options} onClick={handleClick} disabled={!currentValue3}>{e.TXT_UNDO}</button>
          <button type="button" style={options} aria-pressed={currentValue2} onClick={() => setCurrentValue2(!currentValue2)}>{currentValue2 ? e.TXT_RESUME : e.TXT_PAUSE}</button>
        </div>
        <div className="mandala-status" role="group" aria-label="Drawing settings">
          <span>SEG {e.SEGMENTS}</span>
          <span>BRUSH {e.BRUSH_SIZE}px</span>
          <span>GLOW {e.GLOW}</span>
          <span className="mandala-color-status" data-paused={currentValue2}><i aria-hidden="true" />{currentValue2 ? 'PAUSED' : 'LIVE'}</span>
        </div>
        <p className="mandala-guide" aria-hidden={guideUsed}>Drag to draw</p>
      </div>}{!currentValue && <div className="mandala-show-ui">
        <button type="button" style={options} onClick={() => setCurrentValue(true)}>{e.TXT_SHOW}</button>
      </div>}</div>}</React.Fragment>;
}
function App() {
  let [currentValue, setCurrentValue] = React.useState(null);
  React.useEffect(() => {
    let value = !0;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value2 = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (value2.ok) {
          options = await value2.json();
        }
      } catch {}
      if (value) {
        setCurrentValue(pp(options));
      }
    })();
    return () => {
      value = !1;
    };
  }, []);
  return currentValue ? <GameVp cfg={currentValue} /> : <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#000"
  }} />;
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
  const selectors = [".mandala-guide"];
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
        "data-batch3-game": "48"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "48"
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
