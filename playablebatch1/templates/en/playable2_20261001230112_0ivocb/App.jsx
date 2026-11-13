// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "TIME_LIMIT",
    "kind": "number",
    "label": "Questions Per Run",
    "value": 10,
    "default": 10,
    "min": 5,
    "max": 10,
    "step": 1
  }, {
    "id": "DECAY_RATE",
    "kind": "number",
    "label": "Fate Variation",
    "value": 1,
    "default": 1,
    "min": 0.1,
    "max": 5,
    "step": 0.1
  }, {
    "id": "CLICK_POWER",
    "kind": "number",
    "label": "Base Strength Bonus",
    "value": 5,
    "default": 5,
    "min": 1,
    "max": 20,
    "step": 1
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "How Strong Are You?",
    "default": "How Strong Are You?",
    "max_length": 30
  }, {
    "id": "TEXT_WEAK",
    "label": "Level 1",
    "value": "Weak",
    "default": "Weak",
    "max_length": 20
  }, {
    "id": "TEXT_AVERAGE",
    "label": "Level 2",
    "value": "Average",
    "default": "Average",
    "max_length": 20
  }, {
    "id": "TEXT_STRONG",
    "label": "Level 3",
    "value": "Strong",
    "default": "Strong",
    "max_length": 20
  }, {
    "id": "TEXT_SUPER",
    "label": "Level 4",
    "value": "Superhuman",
    "default": "Superhuman",
    "max_length": 20
  }, {
    "id": "TEXT_ABSURD",
    "label": "Level 5",
    "value": "Absurdly Powerful",
    "default": "Absurdly Powerful",
    "max_length": 20
  }, {
    "id": "BTN_RETRY",
    "label": "Retry Button",
    "value": "Try Again",
    "default": "Try Again",
    "max_length": 20
  }],
  "images": [{
    "id": "BG_MAIN",
    "label": "Main Background",
    "path": "./assets/destiny_clean.svg",
    "replaceable": true
  }, {
    "id": "IMG_TITLE",
    "label": "Destiny Emblem",
    "path": "./assets/destiny_emblem.svg",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "99279478907671513",
    "version_id": "99279478907604667",
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
function ep(config) {
  let options2 = {};
  for (let value of config.tweaks || []) options2[value.id] = value.value;
  for (let value of config.texts || []) options2[value.id] = value.value;
  for (let value of config.images || []) options2[value.id] = value.path;
  for (let value of config.mentions || []) options2[value.id] = value.path || value.value;
  return options2;
}
function Pc(value, otherValue, argument3) {
  return Math.max(otherValue, Math.min(argument3, value));
}
var items = [{
  id: "born",
  question: "Are you born?",
  hint: "Every fate begins somewhere.",
  options: ["Yes", "Not yet"],
  weights: [0, 0]
}, {
  id: "race",
  question: "What is your race?",
  hint: "Choose a fantasy race for your story.",
  options: ["Human", "Elf", "Orc", "Fairy"],
  weights: [0, 0, 0, 0]
}];
var items2 = [{
  id: "birthplace",
  question: "Where are you born?",
  hint: "The first place you call home.",
  options: ["Quiet village", "Ancient forest", "Royal city", "Under the stars"],
  weights: [1, 2, 2, 3]
}, {
  id: "omen",
  question: "What is the first omen?",
  hint: "A sign appears in the sky.",
  options: ["A comet", "A storm", "Golden dawn", "A whisper"],
  weights: [3, 2, 2, 1]
}, {
  id: "gift",
  question: "What gift awakens?",
  hint: "Your hidden power takes shape.",
  options: ["Courage", "Magic", "Speed", "Wisdom"],
  weights: [3, 3, 2, 2]
}, {
  id: "trial",
  question: "What tests your strength?",
  hint: "No destiny comes without a trial.",
  options: ["A dragon", "A maze", "A rival", "A storm"],
  weights: [3, 2, 2, 3]
}, {
  id: "ally",
  question: "Who joins your journey?",
  hint: "Even legends need a companion.",
  options: ["A friend", "A mentor", "A whole team", "No one"],
  weights: [2, 2, 3, 1]
}, {
  id: "relic",
  question: "Which relic calls to you?",
  hint: "Choose what you will carry forward.",
  options: ["A sword", "A shield", "A staff", "A map"],
  weights: [3, 2, 2, 1]
}, {
  id: "protect",
  question: "What will you protect?",
  hint: "The choice that defines you.",
  options: ["Your home", "A stranger", "A secret", "Your dream"],
  weights: [3, 3, 2, 2]
}];
var options = {
  id: "fate",
  question: "What fate do you choose?",
  hint: "The final page is yours to write.",
  options: ["Guardian", "Explorer", "Sage", "Legend"],
  weights: [2, 2, 2, 3]
};
function useGameFeature1() {
  let stateRef = React.useRef(null);
  return value => {
    try {
      let value2 = window.AudioContext || window.webkitAudioContext;
      if (!value2) return;
      let value3 = stateRef.current || (stateRef.current = new value2());
      if (value3.state === "suspended") {
        value3.resume();
      }
      let currentTime = value3.currentTime;
      let oscillator = value3.createOscillator();
      let gain = value3.createGain();
      oscillator.type = value === "result" ? "triangle" : "sine";
      let value4 = value === "result" ? 523 : value === "back" ? 330 : 440;
      let value5 = value === "result" ? 784 : value === "back" ? 260 : 620;
      oscillator.frequency.setValueAtTime(value4, currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(value5, currentTime + 0.15);
      gain.gain.setValueAtTime(0.0001, currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.24);
      oscillator.connect(gain).connect(value3.destination);
      oscillator.start(currentTime);
      oscillator.stop(currentTime + 0.25);
    } catch {}
  };
}
var items3 = ["Guardian of the Dawn", "Wandering Explorer", "Starbound Sage", "Living Legend"];
function op(value, otherValue, config) {
  let value2 = 0;
  let value3 = 0;
  value.forEach((item, index) => {
    if (index < 2) return;
    let weights = item.weights;
    value2 += (weights[otherValue[index]] || 1) - 1;
    value3 += Math.max(...weights) - 1;
  });
  let value4 = Number(config.CLICK_POWER) || 5;
  let value5 = Number(config.DECAY_RATE) || 1;
  let strength = Pc(Math.round(16 + (value3 ? value2 / value3 : 0) * 73 + value4 + value5), 0, 99);
  let rank = [config.TEXT_WEAK || "Weak", config.TEXT_AVERAGE || "Average", config.TEXT_STRONG || "Strong", config.TEXT_SUPER || "Superhuman", config.TEXT_ABSURD || "Absurdly Powerful"][strength < 35 ? 0 : strength < 50 ? 1 : strength < 65 ? 2 : strength < 82 ? 3 : 4];
  let value6 = Object.fromEntries(value.map((item, index) => [item.id, item.options[otherValue[index]]]));
  let fate = items3[otherValue[otherValue.length - 1]] || items3[0];
  let value7 = value6.race || "traveler";
  let value8 = /^[aeiou]/i.test(value7) ? "an" : "a";
  let value9 = value6.birthplace ? `the ${value6.birthplace.toLowerCase()}` : "a distant land";
  let story = `${value6.born === "Not yet" ? `Before you were born, fate imagined ${value8} ${value7} from ${value9}.` : `Born as ${value8} ${value7}, you set out from ${value9}.`} ${value6.gift ? `Your gift of ${value6.gift.toLowerCase()} carried you forward. ` : ""}You chose to become the ${fate.toLowerCase()}.`;
  return {
    strength: strength,
    rank: rank,
    fate: fate,
    story: story
  };
}
function GameIp({
  cfg: e
}) {
  const createElement = React.createElement;
  const count = Pc(Math.round(Number(e.TIME_LIMIT) || 10), 5, 10);
  const questions = React.useMemo(() => [...items, ...items2.slice(0, count - 3), options], [count]);
  const [step, setStep] = React.useState(0);
  const [answers, setAnswers] = React.useState([]);
  const [rotation, setRotation] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  const [complete, setComplete] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const stateRef = React.useRef({
    locked: false,
    active: true,
    timers: []
  });
  const action = React.useRef(null);
  const sound = useGameFeature1();
  React.useEffect(() => {
    stateRef.current.active = true;
    return () => {
      stateRef.current.active = false;
      stateRef.current.timers.forEach(clearTimeout);
      stateRef.current.timers = [];
    };
  }, []);
  const question = questions[complete ? questions.length - 1 : step];
  React.useEffect(() => {
    if (stateRef.current.previousQuestion && (stateRef.current.previousQuestion !== question.id || stateRef.current.previousBusy && !busy)) action.current?.focus({
      preventScroll: true
    });
    stateRef.current.previousQuestion = question.id;
    stateRef.current.previousBusy = busy;
  }, [question.id, busy]);
  const result = complete ? op(questions, answers, e) : null;
  const colors = ["#275d69", "#975a38", "#396b56", "#795268"];
  const reduced = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const duration = reduced ? 350 : 2200;
  const random = value2 => {
    if (window.crypto?.getRandomValues) {
      const value = new Uint32Array(1);
      window.crypto.getRandomValues(value);
      return value[0] % value2;
    }
    return Math.floor(Math.random() * value2);
  };
  const later = (value, otherValue) => {
    const timer = setTimeout(() => {
      stateRef.current.timers = stateRef.current.timers.filter(item => item !== timer);
      if (stateRef.current.active) value();
    }, otherValue);
    stateRef.current.timers.push(timer);
  };
  const restart = () => {
    stateRef.current.timers.forEach(clearTimeout);
    stateRef.current.timers = [];
    stateRef.current.locked = false;
    setStep(0);
    setAnswers([]);
    setRotation(0);
    setBusy(false);
    setSelected(null);
    setComplete(false);
    setAnnouncement("");
  };
  const spin = () => {
    if (stateRef.current.locked) return;
    if (complete) {
      restart();
      return;
    }
    stateRef.current.locked = true;
    setBusy(true);
    setSelected(null);
    setAnnouncement("Spinning for a random answer.");
    sound("choice");
    const chosen = random(question.options.length);
    const slice = 360 / question.options.length;
    const turns = 5 + random(3);
    const landing = (360 - chosen * slice) % 360;
    setRotation(previous => previous + turns * 360 + (landing - previous % 360 + 360) % 360);
    later(() => {
      setSelected(chosen);
      sound("choice");
      const answer = question.options[chosen];
      if (question.id === "born" && /^not yet$/i.test(answer)) {
        setAnnouncement("Not yet born. Spin again to begin.");
        setBusy(false);
        stateRef.current.locked = false;
        return;
      }
      setAnnouncement(answer);
      later(() => {
        const next = [...answers.slice(0, step), chosen];
        setAnswers(next);
        setBusy(false);
        stateRef.current.locked = false;
        if (step + 1 >= questions.length) {
          setComplete(true);
          const fate = op(questions, next, e);
          setAnnouncement(fate.fate + ". " + fate.rank + ", " + fate.strength + " out of 100. Tap the wheel to start again.");
          sound("result");
        } else {
          setStep(step + 1);
          setRotation(0);
          setSelected(null);
        }
      }, reduced ? 180 : 520);
    }, duration);
  };
  const slice = 360 / question.options.length;
  const point = angle => {
    const radians = angle * Math.PI / 180;
    return [160 + 153 * Math.cos(radians), 160 + 153 * Math.sin(radians)];
  };
  const wrap = label => {
    const words = label.split(" ");
    const lines = [];
    let line = "";
    words.forEach(word => {
      if ((line + " " + word).trim().length > 11 && line) {
        lines.push(line);
        line = word;
      } else line = (line + " " + word).trim();
    });
    if (line) lines.push(line);
    return lines;
  };
  const wheel = <svg viewBox={"0 0 320 320"} width={320} height={320} aria-hidden={true} className={"fate-wheel-face"} style={{
    transform: "rotate(" + rotation + "deg)",
    transitionDuration: duration + "ms"
  }}>{question.options.map((label, index) => {
      const start = point(index * slice - 90 - slice / 2);
      const value = point(index * slice - 90 + slice / 2);
      return <path key={"wedge-" + index} d={"M160 160L" + start.join(" ") + "A153 153 0 " + (slice > 180 ? 1 : 0) + " 1 " + value.join(" ") + "Z"} fill={colors[index % colors.length]} stroke={selected === index ? "#fff0bd" : "#0e1720"} strokeWidth={selected === index ? 4 : 1.5} />;
    })}{<circle cx={160} cy={160} r={155} fill={"none"} stroke={"#d9bd7a"} strokeWidth={3} />}{question.options.map((label, index) => {
      const angle = (index * slice - 90) * Math.PI / 180;
      const x = 160 + 98 * Math.cos(angle);
      const y = 160 + 98 * Math.sin(angle);
      const lines = wrap(label);
      return <text key={label} x={x} y={y} fill={"#fff9eb"} textAnchor={"middle"} fontSize={17} fontWeight={700} className={"fate-wheel-label"} style={{
        transform: "rotate(" + -rotation + "deg)",
        transformOrigin: x + "px " + y + "px",
        transitionDuration: duration + "ms"
      }}>{lines.map((line, index2) => <tspan key={index2} x={x} dy={index2 === 0 ? 5 - (lines.length - 1) * 10 : 20}>{line}</tspan>)}</text>;
    })}</svg>;
  return <React.Fragment>{<style>{`
      @font-face{font-family:Bangers;src:url('./assets/fonts/bangers/Bangers-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
      html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#0e1720;overscroll-behavior:none}
      *{box-sizing:border-box}
      .fate-simple{--ink:#eefcf8;--ground:#0e1720;--hub:#f0d58c;position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:32px;padding:max(30px,env(safe-area-inset-top)) 30px max(50px,env(safe-area-inset-bottom));background:var(--ground);color:var(--ink);font-family:Arial,system-ui,sans-serif;overflow:hidden}
      .fate-question{width:100%;max-width:340px;min-height:58px;margin:0;display:grid;place-items:center;font-family:Bangers,Impact,sans-serif;font-size:24px;font-weight:400;letter-spacing:.6px;line-height:1.2;text-align:center;text-wrap:balance;overflow-wrap:anywhere}
      .fate-wheel-wrap{position:relative;flex:none;width:min(100%,340px,calc(100svh - 210px));aspect-ratio:1}
      .fate-wheel-tap{display:block;position:absolute;inset:0;width:100%;height:100%;min-width:48px;min-height:48px;padding:0;border:0;border-radius:50%;background:transparent;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;font-family:inherit;color:var(--ground)}
      .fate-wheel-tap:focus-visible{outline:3px solid var(--ink);outline-offset:7px}
      .fate-wheel-tap:active:not(:disabled) .fate-wheel-hub{background:#fff0bd}
      .fate-wheel-tap:disabled{cursor:wait}
      .fate-wheel-face{display:block;width:100%;height:100%;overflow:visible;transition:transform 2.2s cubic-bezier(.12,.7,.08,1);transform-origin:center}
      .fate-wheel-label{transition:transform 2.2s cubic-bezier(.12,.7,.08,1)}
      .fate-wheel-pointer{position:absolute;z-index:2;top:-6px;left:50%;width:0;height:0;transform:translateX(-50%);border-left:11px solid transparent;border-right:11px solid transparent;border-top:23px solid #fff0bd;pointer-events:none}
      .fate-wheel-hub{position:absolute;left:50%;top:50%;display:grid;place-items:center;min-width:64px;min-height:64px;width:22%;height:22%;transform:translate(-50%,-50%);border:3px solid var(--ground);border-radius:50%;background:var(--hub);font-size:16px;font-weight:700;line-height:1;transition:background .12s}
      .fate-announcement{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
      @media (orientation:landscape) and (max-height:500px){.fate-simple{flex-direction:row;gap:24px;padding:30px 30px 50px}.fate-question{width:42%;max-width:280px}.fate-wheel-wrap{width:min(42vw,calc(100svh - 105px),300px)}}
      @media (prefers-reduced-motion:reduce){.fate-wheel-face,.fate-wheel-label{transition-duration:.35s}}
    `}</style>}{<main className={"fate-simple"}>{<h1 id={"fate-question"} className={"fate-question"}>{complete ? result.fate : question.id === "fate" ? "What is your fate?" : question.question}</h1>}{<div className={"fate-wheel-wrap"} key={question.id}>{<span className={"fate-wheel-pointer"} aria-hidden={true} />}{<button ref={action} type={"button"} className={"fate-wheel-tap"} disabled={busy} aria-busy={busy} aria-label={complete ? "Start again" : selected !== null && question.id === "born" ? "Not yet born. Spin again" : "Spin for an answer: " + question.question} onClick={spin}>{wheel}{<span className={"fate-wheel-hub"} aria-hidden={true}>{complete || selected !== null && !busy ? "Again" : busy ? "…" : "Spin"}</span>}</button>}</div>}{<span className={"fate-announcement"} role={"status"} aria-live={"polite"} aria-atomic={true}>{announcement}</span>}</main>}</React.Fragment>;
}
function App() {
  let [currentValue, setCurrentValue] = React.useState(null);
  React.useEffect(() => {
    let value = !0;
    fetch("./game.config.json", {
      cache: "no-store"
    }).then(response => response.json()).catch(() => ({})).then(response => {
      if (value) {
        setCurrentValue(ep(response));
      }
    });
    return () => {
      value = !1;
    };
  }, []);
  return currentValue ? <GameIp cfg={currentValue} /> : <div style={{
    width: "100%",
    height: "100%",
    background: "#0e1720"
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
        "data-subject": ".fate-wheel-face",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": ".fate-wheel-face",
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
        "data-batch3-game": "52"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "52"
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
