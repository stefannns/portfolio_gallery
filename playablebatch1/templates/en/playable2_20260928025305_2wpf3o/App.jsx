// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "MIN_AGE",
    "kind": "number",
    "label": "Minimum Age",
    "value": 1,
    "default": 1,
    "min": 1,
    "max": 10,
    "step": 1
  }, {
    "id": "MAX_AGE",
    "kind": "number",
    "label": "Maximum Age",
    "value": 100,
    "default": 100,
    "min": 80,
    "max": 120,
    "step": 1
  }, {
    "id": "POINTS_MAX",
    "kind": "number",
    "label": "Max Points Per Round",
    "value": 1000,
    "default": 1000,
    "min": 100,
    "max": 5000,
    "step": 100
  }, {
    "id": "POINTS_PENALTY",
    "kind": "number",
    "label": "Penalty Per Year Off",
    "value": 50,
    "default": 50,
    "min": 10,
    "max": 200,
    "step": 10
  }],
  "texts": [{
    "id": "TXT_SCORE",
    "label": "Score Label",
    "value": "SCORE",
    "default": "SCORE",
    "max_length": 15
  }, {
    "id": "TXT_GUESS_AGE",
    "label": "Guess Age Title",
    "value": "Guess Age",
    "default": "Guess Age",
    "max_length": 20
  }, {
    "id": "TXT_BTN_GUESS",
    "label": "Guess Button",
    "value": "GUESS",
    "default": "GUESS",
    "max_length": 15
  }, {
    "id": "TXT_BTN_NEXT",
    "label": "Next Button",
    "value": "NEXT",
    "default": "NEXT",
    "max_length": 15
  }, {
    "id": "TXT_REAL_AGE",
    "label": "Real Age Prefix",
    "value": "Real Age: ",
    "default": "Real Age: ",
    "max_length": 20
  }, {
    "id": "TXT_FEEDBACK_PERFECT",
    "label": "Perfect Feedback",
    "value": "Perfect!",
    "default": "Perfect!",
    "max_length": 20
  }, {
    "id": "TXT_FEEDBACK_GOOD",
    "label": "Good Feedback",
    "value": "Close!",
    "default": "Close!",
    "max_length": 20
  }, {
    "id": "TXT_FEEDBACK_BAD",
    "label": "Bad Feedback",
    "value": "Way off!",
    "default": "Way off!",
    "max_length": 20
  }],
  "images": [{
    "id": "CHAR_1",
    "label": "Character 1 (Baby)",
    "path": "./assets/char_baby.webp",
    "replaceable": true
  }, {
    "id": "CHAR_2",
    "label": "Character 2 (Young)",
    "path": "./assets/char_young-flush.webp",
    "replaceable": true
  }, {
    "id": "CHAR_3",
    "label": "Character 3 (Adult)",
    "path": "./assets/char_adult.webp",
    "replaceable": true
  }, {
    "id": "CHAR_4",
    "label": "Character 4 (Elder)",
    "path": "./assets/char_elder.webp",
    "replaceable": true
  }, {
    "id": "CHAR_5",
    "label": "Character 5 (Teen)",
    "path": "./assets/char_teen.webp",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; overscroll-behavior: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
    #root { isolation: isolate; }
    canvas { touch-action: none; }
    button, input, select, textarea { touch-action: manipulation; }
  

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
var root2 = ReactDOM.createRoot(document.getElementById("root"));
var destination = Tone.getContext().destination;
function useGameFeature1() {
  let stateRef = React.useRef(!1);
  let stateRef2 = React.useRef(null);
  let initAudio = async () => {
    if (!stateRef.current) try {
      await Tone.start();
      stateRef2.current = {
        tick: new Tone.Synth({
          oscillator: {
            type: "sine"
          },
          envelope: {
            attack: 0.01,
            decay: 0.1,
            sustain: 0,
            release: 0.1
          }
        }).toDestination(),
        reveal: new Tone.MembraneSynth().toDestination(),
        success: new Tone.PolySynth(Tone.Synth).toDestination(),
        next: new Tone.Synth({
          oscillator: {
            type: "triangle"
          },
          envelope: {
            attack: 0.01,
            decay: 0.2,
            sustain: 0,
            release: 0.2
          }
        }).toDestination()
      };
      stateRef2.current.tick.volume.value = -15;
      stateRef2.current.reveal.volume.value = -8;
      stateRef2.current.success.volume.value = -10;
      stateRef2.current.next.volume.value = -12;
      destination.volume.value = -5;
      stateRef.current = !0;
    } catch (value) {
      console.warn("Audio init failed", value);
    }
  };
  let playTick = React.useCallback(value => {
    if (!(!stateRef.current || !stateRef2.current)) {
      stateRef2.current.tick.triggerAttackRelease("C5", "32n", value || Tone.now());
    }
  }, []);
  let playReveal = React.useCallback(() => {
    if (!(!stateRef.current || !stateRef2.current)) {
      stateRef2.current.reveal.triggerAttackRelease("C2", "8n");
    }
  }, []);
  let playSuccess = React.useCallback(() => {
    if (!stateRef.current || !stateRef2.current) return;
    let timestamp = Tone.now();
    stateRef2.current.success.triggerAttackRelease(["C4", "E4", "G4"], "8n", timestamp);
  }, []);
  let playNext = React.useCallback(() => {
    if (!(!stateRef.current || !stateRef2.current)) {
      stateRef2.current.next.triggerAttackRelease("G4", "16n");
    }
  }, []);
  return {
    initAudio: initAudio,
    playTick: playTick,
    playReveal: playReveal,
    playSuccess: playSuccess,
    playNext: playNext
  };
}
function _V(config) {
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
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("idle");
  let [count, setCount] = React.useState(0);
  let [count2, setCount2] = React.useState(25);
  let [items, setItems] = React.useState([]);
  let [count3, setCount3] = React.useState(0);
  let [count4, setCount4] = React.useState(0);
  let {
    initAudio: value,
    playTick: x,
    playReveal: value2,
    playSuccess: value3,
    playNext: value4
  } = useGameFeature1();
  let roundLock = React.useRef(!1);
  let [portraitKey, setPortraitKey] = React.useState(0);
  let y = React.useMemo(() => [{
    imgKey: "CHAR_1",
    baseAge: 2
  }, {
    imgKey: "CHAR_2",
    baseAge: 22
  }, {
    imgKey: "CHAR_3",
    baseAge: 45
  }, {
    imgKey: "CHAR_4",
    baseAge: 68
  }, {
    imgKey: "CHAR_5",
    baseAge: 16
  }], []);
  let handleAction = value10 => {
    let items2 = [...value10];
    for (let value11 = items2.length - 1; value11 > 0; value11--) {
      let value12 = Math.floor(Math.random() * (value11 + 1));
      [items2[value11], items2[value12]] = [items2[value12], items2[value11]];
    }
    return items2;
  };
  React.useEffect(() => {
    let value10 = !0;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value12 = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (value12.ok) {
          options = await value12.json();
        }
      } catch {}
      if (!value10) return;
      let config2 = _V(options);
      setConfig(config2);
      let value11 = handleAction(y).map(item => ({
        imgSrc: config2[item.imgKey] || "",
        age: item.baseAge
      }));
      setItems(value11);
      setPhase("guessing");
      setCount2(Math.floor(config2.MIN_AGE + (config2.MAX_AGE - config2.MIN_AGE) / 2) || 25);
    })();
    return () => {
      value10 = !1;
    };
  }, [y]);
  let handleChange = value10 => {
    setCount2(Number(value10.target.value));
  };
  let stateRef = React.useRef(count2);
  React.useEffect(() => {
    if (Math.abs(count2 - stateRef.current) >= 1) {
      x();
      stateRef.current = count2;
    }
  }, [count2, x]);
  let handleAction2 = async value10 => {
    if (phase !== "guessing" || roundLock.current || !items[count3]) return;
    roundLock.current = !0;
    void value();
    let value11 = items[count3].age;
    let value12 = Math.abs(count2 - value11);
    let value13 = config.POINTS_MAX || 1000;
    let value14 = config.POINTS_PENALTY || 30;
    let value15 = Math.max(0, value13 - value12 * value14);
    setCount4(value15);
    setCount(value16 => value16 + value15);
    setPhase("revealed");
    if (value15 > value13 * 0.8) {
      value3();
    } else {
      value2();
    }
  };
  let handleAction3 = async () => {
    if (phase !== "revealed" || !roundLock.current) return;
    roundLock.current = !1;
    void value();
    value4();
    setPortraitKey(value12 => value12 + 1);
    let value10 = count3 + 1;
    let value11 = items;
    if (value10 >= items.length) {
      value11 = handleAction(y).map(item => ({
        imgSrc: config[item.imgKey] || "",
        age: Math.max(1, item.baseAge + Math.floor(Math.random() * 5) - 2)
      }));
      setItems(value11);
      value10 = 0;
      setCount3(0);
    } else {
      setCount3(value10);
    }
    setCount2(Math.floor(config.MIN_AGE + (config.MAX_AGE - config.MIN_AGE) / 2) || 25);
    setPhase("guessing");
  };
  if (!config) return <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#1a1a2e"
  }} />;
  let value5 = items[count3] || {
    imgSrc: "",
    age: 0
  };
  let value6 = config.MIN_AGE || 1;
  let value7 = config.MAX_AGE || 100;
  let value8 = Math.abs(count2 - value5.age);
  let value9 = config.TXT_FEEDBACK_BAD || "Way off!";
  if (value8 === 0) {
    value9 = config.TXT_FEEDBACK_PERFECT || "Perfect!";
  } else {
    if (value8 <= 5) {
      value9 = config.TXT_FEEDBACK_GOOD || "Close!";
    }
  }
  return <React.Fragment>{<style>{`
        @font-face {
          font-family: 'Bangers';
          src: url('./assets/fonts/bangers/Bangers-Regular.woff2') format('woff2');
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
        :root {
          --font-display: "Bangers", "PingFang SC", system-ui, sans-serif;
          --font-body: var(--font-display);
          --font-mono: var(--font-display);
          --ui-unit: min(0.2564102564vw, 0.1672240803vh);
        }
        html, body, #root {
          width: 100%; height: 100%; margin: 0; overflow: hidden;
          background: #111424;
          background: linear-gradient(180deg, #2a3b5c 0%, #111424 100%);
          font-family: var(--font-body);
          color: white;
          user-select: none;
          -webkit-user-select: none;
        }
        * { box-sizing: border-box; }
        
        .glass-panel {
          background: rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 24px;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2);
        }
        
        input[type=range] {
          -webkit-appearance: none;
          width: 100%;
          background: transparent;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 28px;
          width: 28px;
          border-radius: 50%;
          background: #ffffff;
          cursor: pointer;
          margin-top: -12px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }
        input[type=range]::-webkit-slider-runnable-track {
          width: 100%;
          height: 6px;
          cursor: pointer;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }
        input[type=range]:focus-visible,button:focus-visible { outline: 3px solid #a8ff78; outline-offset: 4px; }
        .age-game{width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;position:relative;container-type:size}
        .age-score{flex:0 0 auto;padding:calc(30 * var(--ui-unit) + env(safe-area-inset-top)) calc(30 * var(--ui-unit)) 12px;text-align:center;font:400 calc(28 * var(--ui-unit))/1.2 var(--font-display);font-variant-numeric:tabular-nums}
        .age-stage{flex:1;min-height:0;position:relative;margin:0 calc(30 * var(--ui-unit) + env(safe-area-inset-right)) 0 calc(30 * var(--ui-unit) + env(safe-area-inset-left));overflow:hidden}
        .age-result-layer{position:absolute;inset:0;display:grid;place-items:center;padding:10px;z-index:5;pointer-events:none}
        .age-result-card{width:100%;max-width:330px;max-height:100%;overflow-y:auto;pointer-events:auto;padding:16px 12px;border:1px solid #dce9ff44;border-radius:18px;background:#111424ed;text-align:center;box-shadow:0 8px 28px #0005;overflow-wrap:anywhere}
        .age-result-title{font:400 calc(28 * var(--ui-unit))/1.15 var(--font-display)}
        .age-result-points{margin-top:8px;color:#b0ff87;font:400 calc(18 * var(--ui-unit))/1.35 var(--font-body)}
        .age-result-feedback{margin-top:4px;font-size:calc(18 * var(--ui-unit));line-height:1.35;color:#e9edf5}
        .age-controls{flex:0 0 auto;padding:0 calc(30 * var(--ui-unit) + env(safe-area-inset-right)) calc(50 * var(--ui-unit) + env(safe-area-inset-bottom)) calc(30 * var(--ui-unit) + env(safe-area-inset-left));z-index:10}
        .age-controls .glass-panel{width:100%;max-width:500px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:8px}
        .age-choice{display:flex;justify-content:space-between;align-items:center;gap:12px}
        .age-choice label{font-size:calc(18 * var(--ui-unit));line-height:1.3}
        .age-choice output{font:400 calc(28 * var(--ui-unit))/1.2 var(--font-display)}
        .age-controls input{height:44px;margin:0;flex:0 0 auto;touch-action:manipulation}
        .age-controls button{width:100%;min-height:48px;padding:12px;border-radius:14px;border:0;background:#fff;color:#111;font:400 calc(18 * var(--ui-unit))/1.3 var(--font-body);cursor:pointer;touch-action:manipulation}
        .b3-guide{font-family:var(--font-display)!important;font-weight:400!important}
        .age-controls button.next{background:#a8ffcb;color:#0a3a2a}
        .age-controls button:active{filter:brightness(.87)}
        @media(prefers-reduced-motion:reduce){.age-game *{transition:none!important}}
      `}</style>}{<main className={"age-game"}>{<header className={"age-score"} aria-label={"Score " + count}>{count.toLocaleString("en")}</header>}{<section className={"age-stage"} aria-label={"Person to guess"}>{<Motion.AnimatePresence mode={"sync"}>{<Motion.motion.img src={value5.imgSrc ? value5.imgSrc + (value5.imgSrc.includes("?") ? "&" : "?") + "portrait=realistic-20261006-1" : ""} alt={"Person whose age you are guessing"} initial={{
            opacity: 0
          }} animate={{
            opacity: 1
          }} exit={{
            opacity: 0
          }} transition={{
            duration: 0.18
          }} style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            objectPosition: "center bottom",
            filter: phase === "revealed" ? "brightness(0.7)" : "none"
          }} draggable={!1} key={portraitKey} />}</Motion.AnimatePresence>}{<Motion.AnimatePresence>{phase === "revealed" && <div className={"age-result-layer"}>{<Motion.motion.div className={"age-result-card"} role={"status"} aria-live={"polite"} aria-atomic={!0} initial={{
              opacity: 0,
              y: 10
            }} animate={{
              opacity: 1,
              y: 0
            }} exit={{
              opacity: 0,
              y: 0
            }} transition={{
              duration: 0.18
            }}>{<div className={"age-result-title"}>{config.TXT_REAL_AGE}{" "}{value5.age}</div>}{<div className={"age-result-points"}>{"+"}{count4.toLocaleString("en")}{" "}{config.TXT_SCORE}</div>}{<div className={"age-result-feedback"}>{value9}</div>}</Motion.motion.div>}</div>}</Motion.AnimatePresence>}</section>}{<footer className={"age-controls"}>{<div className={"glass-panel"}>{<div className={"age-choice"}>{<label htmlFor={"age-guess"}>{config.TXT_GUESS_AGE}</label>}{<output htmlFor={"age-guess"}>{count2}</output>}</div>}{<input id={"age-guess"} type={"range"} min={value6} max={value7} value={count2} onChange={handleChange} disabled={phase === "revealed"} aria-valuetext={count2 + " years old"} style={{
            opacity: phase === "revealed" ? 0.5 : 1
          }} />}{<button type={"button"} className={phase === "guessing" ? "guess" : "next"} onClick={phase === "guessing" ? handleAction2 : handleAction3}>{phase === "guessing" ? config.TXT_BTN_GUESS : config.TXT_BTN_NEXT}</button>}</div>}</footer>}</main>}</React.Fragment>;
}
root2.render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root img",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root img",
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
        "data-batch3-game": "27"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "27"
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
