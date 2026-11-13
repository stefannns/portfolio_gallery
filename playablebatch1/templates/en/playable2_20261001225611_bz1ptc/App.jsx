// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "GAME_DURATION",
    "kind": "number",
    "label": "Survival Time (s)",
    "value": 15,
    "default": 15,
    "min": 10,
    "max": 60,
    "step": 5
  }, {
    "id": "PASS_ACCURACY",
    "kind": "number",
    "label": "Pass Accuracy (%)",
    "value": 60,
    "default": 60,
    "min": 10,
    "max": 100,
    "step": 5
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "Stayin' Alive CPR",
    "default": "Stayin' Alive CPR",
    "max_length": 30
  }, {
    "id": "GAME_SUBTITLE",
    "label": "Subtitle",
    "value": "Tap to the beat to save a life!",
    "default": "Tap to the beat to save a life!",
    "max_length": 40
  }, {
    "id": "INSTRUCTION",
    "label": "Instruction",
    "value": "Ideally, perform compressions at 100-120 beats per minute",
    "default": "Ideally, perform compressions at 100-120 beats per minute",
    "max_length": 80
  }, {
    "id": "TXT_PERFECT",
    "label": "Perfect Feedback",
    "value": "Perfect!",
    "default": "Perfect!",
    "max_length": 15
  }, {
    "id": "TXT_TOO_FAST",
    "label": "Fast Feedback",
    "value": "Too Fast!",
    "default": "Too Fast!",
    "max_length": 15
  }, {
    "id": "TXT_TOO_SLOW",
    "label": "Slow Feedback",
    "value": "Too Slow!",
    "default": "Too Slow!",
    "max_length": 15
  }, {
    "id": "BTN_START",
    "label": "Start Button",
    "value": "START",
    "default": "START",
    "max_length": 15
  }, {
    "id": "BTN_RESTART",
    "label": "Restart Button",
    "value": "PLAY AGAIN",
    "default": "PLAY AGAIN",
    "max_length": 20
  }, {
    "id": "TXT_SUCCESS",
    "label": "Success Result",
    "value": "Life Saved!",
    "default": "Life Saved!",
    "max_length": 25
  }, {
    "id": "TXT_FAIL",
    "label": "Fail Result",
    "value": "Keep Practicing",
    "default": "Keep Practicing",
    "max_length": 25
  }],
  "images": [{
    "id": "BTN_PLAY",
    "label": "Play Button Icon",
    "path": "./assets/btn_play.webp",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "99278216778511579",
    "version_id": "99278216778645925",
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

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root #root#root#root:has(.cpr-control[aria-label="Tap the heart to start"])>div>p{position:fixed!important;top:26%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

@font-face{font-family:'PaperType';src:url('./assets/fonts/special-elite/SpecialElite-Regular.ttf') format('truetype');font-style:normal;font-weight:400;font-display:swap}
:root:root{--font-display:'PaperType',Georgia,serif;--font-body:'PaperType',Georgia,serif;--font-mono:'PaperType',Georgia,serif;--ink:#282725}

html,body,#root{background:#a8d3bf!important;color:#292729!important}
#root>div{background:#a8d3bf url('./assets/paper-grain.svg') repeat!important;color:#292729!important;font-family:'PaperType',Georgia,serif!important}
#root>div p,#root>div div{font-family:'PaperType',Georgia,serif!important}
.cpr-control[aria-label='Tap the heart to start']>span,.cpr-control[aria-label='Tap for chest compression']{background:#fff7df!important;color:#de6672!important;border:3px solid #292729!important;box-shadow:3px 4px 0 #292729!important}
.cpr-beat-ring{border-color:#e1797e!important;box-shadow:none!important}
.cpr-control:not([aria-label]){background:#e7e776!important;color:#292729!important;border:2px solid #292729!important;border-radius:4px 7px 4px 6px!important;box-shadow:2px 3px 0 #292729!important;font:400 18px 'PaperType',Georgia,serif!important}

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
function yV() {
  return <style>{`
    @font-face {
      font-family: 'Poppins';
      src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Poppins';
      src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    :root {
      --font-display: "Poppins", "PingFang SC", system-ui, sans-serif;
      --font-body:    "Poppins", "PingFang SC", system-ui, sans-serif;
      --font-mono:    ui-monospace, Menlo, monospace;
      
      --c-bg: #EAF5F0;
      --c-text-main: #1B2B48;
      --c-text-sub: #5A7184;
      --c-accent: #E94E8E;
      --c-success: #10B981;
      --c-error: #EF4444;
    }
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: var(--c-bg);
      font-family: var(--font-body);
      color: var(--c-text-main);
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }
    * { box-sizing: border-box; }
    button {
      font-family: var(--font-body);
      border: none;
      outline: none;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
  `}</style>;
}
function App() {
  const createElement = React.createElement;
  const [config, setConfig] = React.useState({});
  const [phase, setPhase] = React.useState("idle");
  const [time, setTime] = React.useState(20);
  const [streak, setStreak] = React.useState(0);
  const [best, setBest] = React.useState(0);
  const [feedback, setFeedback] = React.useState("");
  const [cueStarted, setCueStarted] = React.useState(false);
  const [currentBpm, setCurrentBpm] = React.useState(null);
  const [beatProgress, setBeatProgress] = React.useState(0);
  const last = React.useRef(null);
  const streakRef = React.useRef(0);
  const feedbackTimer = React.useRef(0);
  const music = React.useRef(null);
  const tapIntervals = React.useRef([]);
  const beatOrigin = React.useRef(0);
  const active = React.useRef(false);
  const audioFailed = React.useRef(false);
  const TARGET_BPM = 100;
  const BEAT_MS = 600;
  const stopMusic = () => {
    if (music.current) {
      music.current.pause();
      try {
        music.current.currentTime = 0;
      } catch {}
    }
  };
  React.useEffect(() => {
    let live = true;
    fetch("./game.config.json", {
      cache: "no-store"
    }).then(response => response.json()).then(data => {
      const values = {};
      for (const value of ["texts", "images", "tweaks"]) for (const item of data[value] || []) values[item.id] = item.value ?? item.path;
      if (live) {
        setConfig(values);
        setTime(Number(values.GAME_DURATION) || 15);
      }
    }).catch(() => {});
    return () => {
      live = false;
      active.current = false;
      clearTimeout(feedbackTimer.current);
      stopMusic();
    };
  }, []);
  React.useEffect(() => {
    if (phase !== "playing" || !cueStarted) return;
    const value = setInterval(() => setTime(value2 => {
      if (value2 <= 1) {
        active.current = false;
        stopMusic();
        clearTimeout(feedbackTimer.current);
        setFeedback("");
        setPhase("over");
        return 0;
      }
      return value2 - 1;
    }), 1000);
    return () => clearInterval(value);
  }, [phase, cueStarted]);
  React.useEffect(() => {
    if (phase !== "playing" || !cueStarted) return;
    let frame;
    const update = () => {
      const audio = music.current;
      const timestamp = performance.now();
      const elapsed = audio && !audioFailed.current && !audio.paused && !audio.ended ? audio.currentTime * 1000 : timestamp - beatOrigin.current;
      setBeatProgress((elapsed % BEAT_MS + BEAT_MS) % BEAT_MS / BEAT_MS);
      if (last.current !== null && timestamp - last.current > 1500) setCurrentBpm(0);
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [phase, cueStarted]);
  const start = () => {
    stopMusic();
    clearTimeout(feedbackTimer.current);
    active.current = true;
    audioFailed.current = false;
    setPhase("playing");
    setTime(Number(config.GAME_DURATION) || 15);
    setStreak(0);
    streakRef.current = 0;
    last.current = null;
    tapIntervals.current = [];
    setCurrentBpm(null);
    setBeatProgress(0);
    setCueStarted(false);
    setFeedback("Tap once to start the beat");
  };
  const handleAction = () => {
    if (phase === "idle") start();else if (phase !== "playing" || !active.current) return;
    const timestamp = performance.now();
    const firstTap = last.current === null;
    const value = firstTap ? 0 : timestamp - last.current;
    if (!firstTap && value < 80) return;
    last.current = timestamp;
    if (firstTap) {
      beatOrigin.current = timestamp;
      setCueStarted(true);
      if (music.current) {
        music.current.volume = 0.7;
        try {
          const promise = music.current.play();
          if (promise) {
            promise.catch(() => {
              audioFailed.current = true;
            });
          }
        } catch {
          audioFailed.current = true;
        }
      }
    } else {
      if (value > 1500) tapIntervals.current = [];
      tapIntervals.current.push(value);
      tapIntervals.current = tapIntervals.current.slice(-4);
      const average = tapIntervals.current.reduce((total, item) => total + item, 0) / tapIntervals.current.length;
      setCurrentBpm(Math.round(60000 / average));
    }
    const message = !value ? "Find the beat" : value < 420 ? config.TXT_TOO_FAST || "Too Fast!" : value > 680 ? config.TXT_TOO_SLOW || "Too Slow!" : config.TXT_PERFECT || "Perfect!";
    if (value >= 420 && value <= 680) {
      streakRef.current++;
      setStreak(streakRef.current);
      setBest(value2 => Math.max(value2, streakRef.current));
      try {
        if (navigator.vibrate) {
          navigator.vibrate(9);
        }
      } catch {}
    } else if (value) {
      streakRef.current = 0;
      setStreak(0);
    }
    setFeedback(message);
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => {
      if (active.current) setFeedback("");
    }, 720);
  };
  const dancer = x => <svg viewBox={"0 0 65 115"} width={72} height={130} style={{
    position: "absolute",
    bottom: "16%",
    [x]: "4%",
    opacity: 0.65
  }} aria-hidden={"true"}>{<g fill={"none"} stroke={"#253335"} strokeWidth={8} strokeLinecap={"round"}>{<circle cx={33} cy={13} r={8} fill={"#253335"} />}{<path d={"M32 25 30 65M30 38 8 55M31 40 58 24M30 65 12 104M30 65 57 102"} />}</g>}</svg>;
  const onBeat = beatProgress < 0.055 || beatProgress > 0.965;
  const ringScale = beatProgress < 0.06 ? 1 : 1 + 0.4 * (1 - beatProgress) / 0.94;
  return <div style={{
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    background: "#e8f8f1",
    color: "#21313c",
    fontFamily: "var(--font-body, Poppins),system-ui,sans-serif",
    textAlign: "center",
    padding: "calc(30px + env(safe-area-inset-top,0px)) 30px calc(50px + env(safe-area-inset-bottom,0px))",
    boxSizing: "border-box"
  }}>{<yV />}{<audio ref={music} src={"./assets/audio/honey-bee-100bpm.mp3"} preload={"auto"} loop={true} aria-hidden={"true"} style={{
      display: "none"
    }} onError={() => {
      audioFailed.current = true;
    }} />}{<style>{".cpr-control:focus-visible{outline:3px solid #21313c;outline-offset:6px}.cpr-control:active{filter:brightness(.94)}.cpr-beat-ring{will-change:transform,opacity}@media(prefers-reduced-motion:reduce){.cpr-beat-ring{transform:none!important}}"}</style>}{(phase === "playing" || phase === "idle") && <div style={{
      position: "absolute",
      top: "calc(30px + env(safe-area-inset-top,0px))",
      left: 30,
      right: 30,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "start",
      gap: 12,
      pointerEvents: "none"
    }}>{<div style={{
        textAlign: "left"
      }}>{<div style={{
          fontSize: 18,
          lineHeight: 1.3
        }}>{"Your BPM"}</div>}{<div role={"status"} aria-live={"off"} aria-label={currentBpm === null ? "Tap twice to measure your BPM" : `Your pace: ${currentBpm} BPM`} style={{
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1.2,
          fontVariantNumeric: "tabular-nums"
        }}>{currentBpm === null ? "—" : currentBpm}</div>}{<div style={{
          fontSize: 18,
          lineHeight: 1.3,
          color: "#50616b"
        }}>{`Target ${TARGET_BPM}`}</div>}</div>}{<div style={{
        fontSize: 28,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1.2
      }}>{time + "s"}</div>}</div>}{phase === "playing" && dancer("left")}{phase === "playing" && dancer("right")}{<div style={{
      position: "absolute",
      top: phase === "over" ? "42%" : "49%",
      left: "50%",
      transform: "translate(-50%,-50%)",
      width: "min(50vw,195px)",
      aspectRatio: "1"
    }}>{phase === "playing" && cueStarted && <div className={"cpr-beat-ring"} style={{
        position: "absolute",
        inset: 0,
        border: "7px solid #d94792",
        borderRadius: "50%",
        pointerEvents: "none",
        transform: `scale(${ringScale})`,
        opacity: onBeat ? 1 : 0.25 + beatProgress * 0.6,
        zIndex: 1,
        boxShadow: "0 0 0 3px #fff8"
      }} aria-hidden={"true"} />}{phase === "playing" && cueStarted && <div className={"cpr-beat-word"} style={{
        position: "absolute",
        left: "50%",
        top: "-14%",
        transform: "translate(-50%,-50%)",
        color: "#b72270",
        fontSize: 18,
        lineHeight: 1.2,
        fontWeight: 700,
        letterSpacing: 1.2,
        pointerEvents: "none",
        opacity: onBeat ? 1 : 0,
        zIndex: 3
      }} aria-hidden={"true"}>{"TAP"}</div>}{phase === "idle" ? <button className={"cpr-control"} type={"button"} onPointerDown={event => {
        if (event.isPrimary === false || event.button > 0) return;
        event.preventDefault();
        handleAction();
      }} onClick={event => {
        if (event.detail === 0) handleAction();
      }} aria-label={"Tap the heart to start"} style={{
        width: "100%",
        height: "100%",
        border: 0,
        padding: 0,
        borderRadius: "50%",
        background: "transparent",
        cursor: "pointer",
        touchAction: "manipulation"
      }}>{<span className={"feed-first-action"} style={{
          display: "grid",
          placeItems: "center",
          width: "100%",
          height: "100%",
          border: "6px solid #e950a0",
          borderRadius: "50%",
          background: "#fff",
          color: "#ed4b99",
          fontSize: "clamp(55px,15vw,84px)"
        }}>{"♥"}</span>}</button> : phase === "playing" ? <button className={"cpr-control"} type={"button"} onPointerDown={event => {
        if (event.isPrimary === false || event.button > 0) return;
        event.preventDefault();
        handleAction();
      }} onClick={event => {
        if (event.detail === 0) handleAction();
      }} aria-label={"Tap for chest compression"} style={{
        position: "relative",
        zIndex: 2,
        width: "100%",
        height: "100%",
        border: "6px solid #e950a0",
        borderRadius: "50%",
        background: "#fff",
        color: "#ed4b99",
        boxShadow: "0 3px 8px #0002",
        fontSize: "clamp(55px,15vw,84px)",
        cursor: "pointer",
        touchAction: "manipulation"
      }}>{"♥"}</button> : <div style={{
        background: "#fff",
        border: "6px solid #e950a0",
        borderRadius: "50%",
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
        fontSize: 24,
        fontWeight: 800
      }}>{"Great work!"}</div>}</div>}{phase === "playing" && <div style={{
      position: "absolute",
      top: "69%",
      left: 30,
      right: 30,
      minHeight: 52,
      color: "#b72270",
      fontSize: 18,
      lineHeight: 1.4,
      fontWeight: 700
    }}>{<div>{feedback}</div>}{cueStarted && <div style={{
        fontSize: 18,
        color: "#21313c",
        fontWeight: 400
      }}>{"Streak " + streak}</div>}</div>}{phase === "over" && <div style={{
      position: "absolute",
      top: "64%",
      left: 30,
      right: 30,
      display: "grid",
      justifyItems: "center",
      gap: 10
    }}>{<div style={{
        fontSize: 18,
        fontWeight: 700
      }}>{"Best streak: " + best}</div>}{<button className={"cpr-control"} type={"button"} onClick={start} style={{
        minWidth: 170,
        minHeight: 48,
        border: 0,
        borderRadius: 25,
        background: "#b72270",
        color: "white",
        fontWeight: 700,
        fontSize: 18
      }}>{config.BTN_RESTART || "PLAY AGAIN"}</button>}</div>}{phase === "idle" && <p style={{
      position: "absolute",
      bottom: "calc(50px + env(safe-area-inset-bottom,0px))",
      left: 30,
      right: 30,
      fontSize: 18,
      lineHeight: 1.4,
      color: "#50616b",
      margin: 0
    }}>{"Tap the heart to start"}</p>}{phase === "over" && <div style={{
      position: "absolute",
      bottom: "calc(50px + env(safe-area-inset-bottom,0px))",
      left: 30,
      right: 30,
      fontSize: 16,
      lineHeight: 1.4,
      color: "#50616b"
    }}>{<span>{"Honey Bee · Kevin MacLeod (incompetech.com)"}</span>}{<br />}{<span>{"CC BY 4.0 · creativecommons.org/licenses/by/4.0/"}</span>}{" · Edited music loop"}</div>}</div>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": ".feed-first-action",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": ".feed-first-action",
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
  const selectors = ["#root:has(.cpr-control[aria-label=\"Tap the heart to start\"])>div>p"];
  const copy = new Set(["Ideally, perform compressions at 100-120 beats per minute"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
        "data-batch3-game": "42"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "42"
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
