import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "TARGET_SCORE",
    "kind": "number",
    "label": "Target Score",
    "value": 3,
    "default": 3,
    "min": 1,
    "max": 10,
    "step": 1
  }, {
    "id": "MIN_DELAY",
    "kind": "number",
    "label": "Min Delay (s)",
    "value": 2,
    "default": 2,
    "min": 1,
    "max": 5,
    "step": 0.5
  }, {
    "id": "MAX_DELAY",
    "kind": "number",
    "label": "Max Delay (s)",
    "value": 5,
    "default": 5,
    "min": 3,
    "max": 10,
    "step": 0.5
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "DUELLO DI TOCCHI",
    "default": "DUELLO DI TOCCHI",
    "max_length": 20
  }, {
    "id": "BTN_START",
    "label": "Start Button",
    "value": "INIZIA",
    "default": "INIZIA",
    "max_length": 15
  }, {
    "id": "BTN_RESTART",
    "label": "Restart Button",
    "value": "RIGIOCA",
    "default": "RIGIOCA",
    "max_length": 15
  }, {
    "id": "TXT_WAIT",
    "label": "Wait Text",
    "value": "ASPETTA…",
    "default": "ASPETTA…",
    "max_length": 15
  }, {
    "id": "TXT_FIRE",
    "label": "Fire Text",
    "value": "TOCCA ORA!",
    "default": "TOCCA ORA!",
    "max_length": 15
  }, {
    "id": "TXT_FAULT",
    "label": "Fault Text",
    "value": "TROPPO PRESTO!",
    "default": "TROPPO PRESTO!",
    "max_length": 15
  }, {
    "id": "TXT_WIN",
    "label": "Win Text",
    "value": "BEL COLPO!",
    "default": "BEL COLPO!",
    "max_length": 15
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
const BASE_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.tap-duel__instruction){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.tap-duel__instruction){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.tap-duel__instruction){animation:none!important}}

/* Italian copy keeps the approved role sizes and may wrap instead of clipping. */
html[lang="it"] :is(.meeting-guide,.feed-first-action,.melody-guide,.particle-guide,.dive-guide,.sandbox-guide,.koi-guide,.ui-guide,.bead-guide,.coloring-guide,.look-guide,.time-print-guide){white-space:normal;overflow-wrap:normal;word-break:normal;line-height:1.4}
html[lang="it"] :is(button,.btn,.btn-neon){overflow-wrap:normal;word-break:normal}
html[lang="it"] .melody-controls button{font-size:18px;padding-inline:12px}
html[lang="it"] .meeting-sand-ball-count{gap:6px!important}
html[lang="it"] #people-dialog fieldset label{min-width:0}
html[lang="it"] #people-dialog input{max-width:100%;min-width:0}
`;
const DUEL_STYLES = `
    @font-face {
      font-family: "Bangers Local";
      src: url("./assets/fonts/bangers/Bangers-Regular.woff2") format("woff2");
      font-display: swap;
    }
    :root { color-scheme: dark; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { background: #071f25; }
    * { box-sizing: border-box; }
    .tap-duel {
      position: fixed;
      inset: 0;
      overflow: hidden;
      background: #071f25;
      font-family: "Bangers Local", Impact, sans-serif;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .tap-duel__territory {
      position: absolute;
      left: 0;
      right: 0;
      transition: top 140ms cubic-bezier(.2,.8,.2,1), height 140ms cubic-bezier(.2,.8,.2,1);
    }
    .tap-duel__territory--red {
      top: 0;
      background: radial-gradient(circle at 50% 12%, #5f002f 0%, #39001d 45%, #250012 100%);
    }
    .tap-duel__territory--blue {
      bottom: 0;
      background: radial-gradient(circle at 50% 88%, #045665 0%, #073b46 45%, #062a32 100%);
    }
    .tap-duel__divider {
      position: absolute;
      left: 0;
      width: 100%;
      height: 5px;
      transform: translateY(-50%);
      background: #fff;
      box-shadow: 0 0 8px #fff, 0 0 18px rgba(255,255,255,.72);
      z-index: 4;
      pointer-events: none;
      transition: top 140ms cubic-bezier(.2,.8,.2,1);
    }
    .tap-duel__hitbox {
      font-family: inherit;
      position: absolute;
      left: 0;
      width: 100%;
      height: 50%;
      padding: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: #fff;
      z-index: 5;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: none;
    }
    .tap-duel__hitbox--red { top: 0; }
    .tap-duel__hitbox--blue { bottom: 0; }
    .tap-duel__player {
      position: absolute;
      left: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      top: 0;
      height: 100%;
      width: min(76vw, 460px);
      transform: translateX(-50%);
      pointer-events: none;
    }
    .tap-duel__hitbox--red .tap-duel__player {
      top: 0;
      transform: translateX(-50%) rotate(180deg);
    }
    .tap-duel__hitbox--blue .tap-duel__player {
      top: 0;
    }
    .tap-duel__copy {
      position: absolute;
      bottom: calc(50% - 12px);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      color: rgba(255,255,255,.72);
      text-shadow: 0 2px 12px rgba(0,0,0,.4);
    }
    .tap-duel__name {
      font-size: clamp(18px, 5vw, 32px);
      letter-spacing: .08em;
    }
    .tap-duel__instruction {
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 18px;
      line-height: 24px;
      font-weight: 800;
      letter-spacing: .16em;
    }
    .tap-duel__orb {
      position: absolute;
      top: calc(50% + 20px);
      height: min(clamp(104px, 29vw, 186px), calc(50% - 50px));
      width: auto;
      aspect-ratio: 1;
      border-radius: 50%;
      transition: transform 70ms ease;
    }
    .tap-duel__orb--red {
      background: #ff1683;
      box-shadow: 0 0 28px rgba(255,22,131,.74), inset 0 0 22px rgba(255,255,255,.25);
    }
    .tap-duel__orb--blue {
      background: #21e5f2;
      box-shadow: 0 0 28px rgba(33,229,242,.72), inset 0 0 22px rgba(255,255,255,.3);
    }
    .tap-duel__hitbox.is-pressed .tap-duel__orb { animation: tap-duel-press 130ms ease; }
    @keyframes tap-duel-press {
      0% { transform: scale(1); }
      45% { transform: scale(.88); }
      100% { transform: scale(1); }
    }
    .tap-duel__shot {
      position: absolute;
      left: 50%;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 6;
      transition: top 180ms linear, opacity 180ms ease;
    }
    .tap-duel__shot--red {
      background: #ff1683;
      box-shadow: 0 0 12px #ff1683;
    }
    .tap-duel__shot--blue {
      background: #21e5f2;
      box-shadow: 0 0 12px #21e5f2;
    }
    .tap-duel__result {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: grid;
      place-items: center;
      padding: max(40px, env(safe-area-inset-top)) 25px max(40px, env(safe-area-inset-bottom));
      background: rgba(0, 5, 10, .82);
      backdrop-filter: blur(8px);
    }
    .tap-duel__result[hidden] { display: none; }
    .tap-duel__result-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      width: min(84vw, 420px);
      text-align: center;
    }
    .tap-duel__winner {
      margin: 0;
      font-size: clamp(54px, 16vw, 96px);
      line-height: .92;
      letter-spacing: .04em;
      text-shadow: 0 0 24px currentColor;
    }
    .tap-duel__replay {
      min-width: 190px;
      min-height: 58px;
      padding: 14px 28px;
      border: 2px solid #fff;
      border-radius: 999px;
      background: #fff;
      color: #07151a;
      font: 32px/1 "Bangers Local", Impact, sans-serif;
      letter-spacing: .05em;
      cursor: pointer;
    }
    .tap-duel__sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    @media (max-height: 620px) {
      .tap-duel__orb { height: min(clamp(84px, 23vh, 142px), calc(50% - 50px)); }
      .tap-duel__name { font-size: 20px; }
      .tap-duel__instruction { font-size: 18px; }
    }
  `;
const TAP_FORCE = 4;
const RED_WIN_EDGE = 92;
const BLUE_WIN_EDGE = 8;
function createDuel() {
  return {
    boundary: 50,
    winner: null
  };
}
function applyTap(state, player) {
  if (state.winner) return state;
  const direction = player === 'p1' ? 1 : player === 'p2' ? -1 : 0;
  const boundary = Math.max(BLUE_WIN_EDGE, Math.min(RED_WIN_EDGE, state.boundary + direction * TAP_FORCE));
  const winner = boundary >= RED_WIN_EDGE ? 'p1' : boundary <= BLUE_WIN_EDGE ? 'p2' : null;
  return {
    boundary,
    winner
  };
}
function App() {
  const [state, setState] = React.useState(createDuel);
  const [config, setConfig] = React.useState(DEFAULT_CONFIG);
  const latestState = React.useRef(state);
  const surface = React.useRef(null);
  const audioContext = React.useRef(null);
  const timers = React.useRef(new Set());
  React.useEffect(() => {
    let mounted = true;
    fetch('./game.config.json', {
      cache: 'no-store'
    }).then(response => response.ok ? response.json() : DEFAULT_CONFIG).then(value => {
      if (mounted) setConfig(value);
    }).catch(() => {});
    return () => {
      mounted = false;
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear();
      audioContext.current?.close().catch(() => {});
    };
  }, []);
  function after(delay, action) {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      action();
    }, delay);
    timers.current.add(timer);
  }
  function playTone(frequency, duration, volume) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext.current ||= new AudioContextClass();
    const context = audioContext.current;
    if (context.state === 'suspended') context.resume().catch(() => {});
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }
  function createShot(player, targetBoundary) {
    const shot = document.createElement('span');
    shot.className = 'tap-duel__shot tap-duel__shot--' + (player === 'p1' ? 'red' : 'blue');
    shot.style.top = player === 'p1' ? '18%' : '82%';
    surface.current.appendChild(shot);
    requestAnimationFrame(() => {
      shot.style.top = targetBoundary + '%';
      shot.style.opacity = '0';
    });
    after(220, () => shot.remove());
  }
  function press(player, event) {
    event.preventDefault();
    if (latestState.current.winner) return;
    const next = applyTap(latestState.current, player);
    latestState.current = next;
    setState(next);
    createShot(player, next.boundary);
    const hitbox = event.currentTarget;
    hitbox.classList.remove('is-pressed');
    void hitbox.offsetWidth;
    hitbox.classList.add('is-pressed');
    playTone(player === 'p1' ? 300 : 420, 0.055, 0.025);
    navigator.vibrate?.(10);
    if (next.winner) {
      const redWon = next.winner === 'p1';
      playTone(redWon ? 560 : 720, 0.18, 0.08);
      after(120, () => playTone(redWon ? 720 : 880, 0.24, 0.08));
      navigator.vibrate?.([35, 40, 70]);
    }
  }
  function replay() {
    latestState.current = createDuel();
    setState(latestState.current);
  }
  const redWon = state.winner === 'p1';
  const replayLabel = config.texts?.find(item => item.id === 'BTN_RESTART')?.value || 'RIGIOCA';
  return <>
    <style>{BASE_STYLES + DUEL_STYLES}</style>
    <main ref={surface} className="tap-duel" aria-label="Duello a tocchi per due giocatori">
      <div className="tap-duel__territory tap-duel__territory--red" style={{
        height: state.boundary + '%'
      }} />
      <div className="tap-duel__territory tap-duel__territory--blue" style={{
        top: state.boundary + '%'
      }} />
      <div className="tap-duel__divider" style={{
        top: state.boundary + '%'
      }} aria-hidden="true" />
      <button className="tap-duel__hitbox tap-duel__hitbox--red" type="button" aria-label="Area di tocco del giocatore rosso" onPointerDown={event => { if (event.pointerType !== "mouse" || event.button === 0) press('p1', event); }} onClick={event => { if (event.detail === 0) press('p1', event); }}>
        <span className="tap-duel__player"><span className="tap-duel__copy"><span className="tap-duel__name">GIOCATORE ROSSO</span><span className="tap-duel__instruction">TOCCA RAPIDAMENTE</span></span><span className="tap-duel__orb tap-duel__orb--red" /></span>
      </button>
      <button className="tap-duel__hitbox tap-duel__hitbox--blue" type="button" aria-label="Area di tocco del giocatore blu" onPointerDown={event => { if (event.pointerType !== "mouse" || event.button === 0) press('p2', event); }} onClick={event => { if (event.detail === 0) press('p2', event); }}>
        <span className="tap-duel__player"><span className="tap-duel__copy"><span className="tap-duel__name">GIOCATORE BLU</span><span className="tap-duel__instruction">TOCCA RAPIDAMENTE</span></span><span className="tap-duel__orb tap-duel__orb--blue" /></span>
      </button>
      <output className="tap-duel__sr-only" aria-live="polite">{state.winner ? (redWon ? 'Rosso' : 'Blu') + ' vince' : 'Separatore al ' + state.boundary + ' percento'}</output>
      <section className="tap-duel__result" hidden={!state.winner} aria-live="assertive">
        <div className="tap-duel__result-card">
          <h1 className="tap-duel__winner" style={{
            color: redWon ? '#ff1683' : '#21e5f2'
          }}>{redWon ? 'VINCE IL ROSSO!' : 'VINCE IL BLU!'}</h1>
          <button className="tap-duel__replay" type="button" onClick={replay}>{replayLabel}</button>
        </div>
      </section>
    </main>
  </>;
}
document.documentElement.lang = 'it';
ReactDOM.createRoot(document.getElementById('root')).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": ".tap-duel__orb",
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
  const selectors = [".tap-duel__instruction"];
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
