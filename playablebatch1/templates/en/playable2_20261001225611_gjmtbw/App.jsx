// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "INITIAL_TIME",
    "kind": "number",
    "label": "Initial Time (s)",
    "value": 30,
    "default": 30,
    "min": 10,
    "max": 60,
    "step": 1
  }, {
    "id": "MAX_TIME",
    "kind": "number",
    "label": "Max Time Limit",
    "value": 60,
    "default": 60,
    "min": 20,
    "max": 100,
    "step": 1
  }, {
    "id": "BONUS_TIME",
    "kind": "number",
    "label": "Bonus Time per Find",
    "value": 2,
    "default": 2,
    "min": 1,
    "max": 5,
    "step": 1
  }, {
    "id": "PENALTY_TIME",
    "kind": "number",
    "label": "Penalty Time on Mistake",
    "value": 3,
    "default": 3,
    "min": 1,
    "max": 10,
    "step": 1
  }, {
    "id": "SCORE_PER_FIND",
    "kind": "number",
    "label": "Score per Find",
    "value": 10,
    "default": 10,
    "min": 1,
    "max": 50,
    "step": 1
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "Find the Animal",
    "default": "Find the Animal",
    "max_length": 15
  }, {
    "id": "TEXT_DESC",
    "label": "Description",
    "value": "Tap the hidden animal's cell using hot-and-cold clues.",
    "default": "Tap the hidden animal's cell using hot-and-cold clues.",
    "max_length": 60
  }, {
    "id": "BTN_START",
    "label": "Start Button",
    "value": "START",
    "default": "START",
    "max_length": 15
  }, {
    "id": "TEXT_TIME",
    "label": "Time Label",
    "value": "TIME",
    "default": "TIME",
    "max_length": 10
  }, {
    "id": "TEXT_TARGET",
    "label": "Target Label",
    "value": "FIND",
    "default": "FIND",
    "max_length": 10
  }, {
    "id": "TEXT_SCORE",
    "label": "Score Label",
    "value": "SCORE",
    "default": "SCORE",
    "max_length": 10
  }, {
    "id": "TEXT_GAMEOVER",
    "label": "Game Over Title",
    "value": "Time's Up!",
    "default": "Time's Up!",
    "max_length": 20
  }, {
    "id": "TEXT_FINAL_SCORE",
    "label": "Final Score Label",
    "value": "Final Score",
    "default": "Final Score",
    "max_length": 20
  }, {
    "id": "BTN_RESTART",
    "label": "Restart Button",
    "value": "Play Again",
    "default": "Play Again",
    "max_length": 15
  }, {
    "id": "BTN_POST",
    "label": "Post Play Button",
    "value": "Post my play",
    "default": "Post my play",
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
    "post_id": "99278216757715177",
    "version_id": "99278216757734252",
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

@font-face{font-family:'PaperType';src:url('./assets/fonts/special-elite/SpecialElite-Regular.ttf') format('truetype');font-style:normal;font-weight:400;font-display:swap}
:root:root{--font-display:'PaperType',Georgia,serif;--font-body:'PaperType',Georgia,serif;--font-mono:'PaperType',Georgia,serif;--ink:#282725}

html,body,#root{background:#ad91c1!important;color:#292729!important}
.animal-paper-game{background:#ad91c1 url('./assets/paper-grain.svg') repeat!important;color:#292729!important;font-family:'PaperType',Georgia,serif!important}
.animal-paper-game>div:nth-child(2){background:#f7efda!important;border:1.5px solid #292729!important;border-radius:4px 6px 4px 5px!important;box-shadow:2px 3px 0 #292729!important;font-size:13px!important}
.animal-paper-game>div:nth-child(3){padding-top:36px;box-sizing:border-box}
.animal-paper-board{gap:0!important;border:2px solid #292729!important;box-shadow:3px 4px 0 #292729!important}
.animal-paper-board button{border:1px solid #292729!important;background:#e5e775!important;color:#292729!important;border-radius:0!important;font-family:'PaperType',Georgia,serif!important}
.animal-paper-board button:nth-child(3n+1){background:#e9eb86!important}.animal-paper-board button[aria-label^='Cell ']{background:#f8f0d9!important}
.animal-icon{display:inline-block;flex:none;width:28px;height:28px;max-width:80%;max-height:80%;background-image:url('./assets/art-v2/animal-icons.webp');background-repeat:no-repeat;background-size:500% 200%;vertical-align:middle}
.animal-legend-cue{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}.animal-legend-cue .animal-icon{width:17px;height:17px}
.animal-paper-game>button{border:2px solid #292729!important;border-radius:4px 7px 4px 6px!important;background:#e5e775!important;color:#292729!important;font:400 18px 'PaperType',Georgia,serif!important;box-shadow:2px 3px 0 #292729!important}
.b3-guide{font-family:'PaperType',Georgia,serif!important;font-weight:400!important;color:#292729!important;text-shadow:none!important}

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
const animalIconNames = ['fire','hot','warm','cold','elephant','monkey','lion','panda','fox','frog'];
function animalIcon(name) {
  const index = animalIconNames.indexOf(name);
  if (index < 0) return null;
  return <span className="animal-icon" aria-hidden="true" style={{backgroundPosition: `${(index % 5) * 25}% ${index < 5 ? 0 : 100}%`}} />;
}
function App() {
  const createElement = React.createElement;
  const value = 8;
  const length = value * value;
  const [model, setModel] = React.useState({});
  const [round, setRound] = React.useState(0);
  const [target, setTarget] = React.useState(() => Math.floor(Math.random() * length));
  const [animal, setAnimal] = React.useState("elephant");
  const [count, setCount] = React.useState(0);
  const [model2, setModel2] = React.useState({});
  const [currentValue, setCurrentValue] = React.useState(!1);
  const stateRef = React.useRef({
    target: target,
    animal: animal,
    opened: {},
    taps: 0,
    won: !1,
    round: round
  });
  React.useEffect(() => {
    let value2 = !0;
    fetch("./game.config.json", {
      cache: "no-store"
    }).then(response => response.json()).then(response => {
      const options2 = {};
      for (const value3 of ["texts", "images", "tweaks"]) for (const value4 of response[value3] || []) options2[value4.id] = value4.value ?? value4.path;
      if (value2) {
        setModel(options2);
      }
    }).catch(() => {});
    return () => {
      value2 = !1;
    };
  }, []);
  const onClick = () => {
    const target2 = Math.floor(Math.random() * length);
    const animal2 = ["elephant", "monkey", "lion", "panda", "fox", "frog"][Math.floor(Math.random() * 6)];
    stateRef.current = {
      target: target2,
      animal: animal2,
      opened: {},
      taps: 0,
      won: !1,
      round: stateRef.current.round + 1
    };
    setRound(stateRef.current.round);
    setTarget(target2);
    setAnimal(animal2);
    setCount(0);
    setModel2({});
    setCurrentValue(!1);
  };
  const handleAction = value2 => {
    const current = stateRef.current;
    if (round !== current.round || current.won || current.opened[value2]) return;
    const target2 = current.target;
    const animal2 = current.animal;
    const value3 = Math.abs(Math.floor(value2 / value) - Math.floor(target2 / value)) + Math.abs(value2 % value - target2 % value);
    const value4 = Math.max(Math.floor(target2 / value), value - 1 - Math.floor(target2 / value)) + Math.max(target2 % value, value - 1 - target2 % value);
    const z = value3 === 0 ? animal2 : value3 <= 1 ? "fire" : value3 <= 3 ? "hot" : value3 <= Math.ceil(value4 * 0.6) ? "warm" : "cold";
    current.opened = {
      ...current.opened,
      [value2]: z
    };
    current.taps++;
    setModel2(current.opened);
    setCount(current.taps);
    if (value3 === 0) {
      current.won = !0;
      setCurrentValue(!0);
      if (navigator.vibrate) {
        navigator.vibrate(25);
      }
    }
  };
  const options = {
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    padding: 0,
    boxSizing: "border-box",
    border: "1px solid #eee5f2",
    background: "#c7b3d0",
    color: "#222",
    fontSize: "clamp(16px, 4.5vw, 26px)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    touchAction: "manipulation"
  };
  return <div className="animal-paper-game" style={{
    width: "100%",
    height: "100%",
    minHeight: 0,
    background: "#bba3c5",
    color: "#111",
    fontFamily: "Arial, sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "calc(30px + env(safe-area-inset-top)) calc(30px + env(safe-area-inset-right)) calc(50px + env(safe-area-inset-bottom)) calc(30px + env(safe-area-inset-left))",
    boxSizing: "border-box",
    overflow: "hidden"
  }}>{<div aria-label={"Taps " + count} style={{
      margin: "0 0 14px",
      fontSize: "28px",
      lineHeight: 1.2,
      fontWeight: 800,
      textAlign: "center"
    }}>{count}</div>}{<div style={{
      width: "100%",
      maxWidth: 390,
      background: "#d4c0d9",
      borderRadius: 8,
      padding: "10px 6px",
      display: "flex",
      flexWrap: "wrap",
      justifyContent: "space-around",
      gap: 4,
      fontSize: "14px",
      whiteSpace: "nowrap"
    }}>{<span className="animal-legend-cue">{animalIcon('fire')} On fire!</span>}{<span className="animal-legend-cue">{animalIcon('hot')} Hot</span>}{<span className="animal-legend-cue">{animalIcon('warm')} Warm</span>}{<span className="animal-legend-cue">{animalIcon('cold')} Cold</span>}</div>}{<div style={{
      flex: 1,
      minHeight: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      containerType: "size"
    }}>{<div className="animal-paper-board" aria-label={"8 by 8 animal search map"} style={{
        width: "min(100%, 100cqh)",
        maxWidth: 440,
        aspectRatio: "1",
        flexShrink: 0,
        boxSizing: "border-box",
        display: "grid",
        gridTemplateColumns: `repeat(${value},minmax(0,1fr))`,
        gridTemplateRows: `repeat(${value},minmax(0,1fr))`,
        gap: 1,
        border: "1px solid #e3d7e9",
        boxShadow: "0 4px 12px #6c547052"
      }}>{Array.from({
          length: length
        }, (value2, otherValue) => <button key={round + "-" + otherValue} type={"button"} onClick={() => handleAction(otherValue)} aria-label={model2[otherValue] ? "Cell " + (otherValue + 1) + ": " + (model2[otherValue] === animal ? "animal found" : "clue " + model2[otherValue]) : "Check cell " + (otherValue + 1)} style={{
          ...options,
          background: model2[otherValue] ? "#dcc7e5" : "#c7b3d0"
        }}>{model2[otherValue] ? animalIcon(model2[otherValue]) : null}</button>)}</div>}</div>}{<div style={{
      fontSize: 15,
      minHeight: 24,
      textAlign: "center",
      marginTop: 14
    }}>{currentValue ? "Found it in " + count + " taps!" : ""}</div>}{currentValue && <button type={"button"} onClick={onClick} style={{
      minHeight: 46,
      minWidth: 140,
      marginTop: 12,
      border: 0,
      borderRadius: 12,
      background: "#744e92",
      color: "white",
      fontSize: 16,
      fontWeight: 700,
      cursor: "pointer"
    }}>{"Play Again"}</button>}</div>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root button",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root button",
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
        "data-batch3-game": "39"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "39"
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
