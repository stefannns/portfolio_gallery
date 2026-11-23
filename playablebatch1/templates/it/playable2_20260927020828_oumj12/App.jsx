// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "DRAW_SPEED",
    "kind": "number",
    "label": "Drawing Speed",
    "value": 0.4,
    "default": 0.4,
    "min": 0.1,
    "max": 1,
    "step": 0.05
  }, {
    "id": "MIN_RADIUS",
    "kind": "number",
    "label": "Min Radius",
    "value": 50,
    "default": 50,
    "min": 30,
    "max": 80,
    "step": 1
  }, {
    "id": "MAX_RADIUS",
    "kind": "number",
    "label": "Max Radius",
    "value": 140,
    "default": 140,
    "min": 100,
    "max": 180,
    "step": 1
  }],
  "texts": [{
    "id": "TXT_PROMPT",
    "label": "Prompt Text",
    "value": "Tieni premuto e disegna",
    "default": "Tieni premuto e disegna",
    "max_length": 30
  }, {
    "id": "TXT_PERFECT",
    "label": "Perfect Text",
    "value": "Perfetto! 🎯",
    "default": "Perfetto! 🎯",
    "max_length": 15
  }, {
    "id": "TXT_GOOD",
    "label": "Good Text",
    "value": "Bene! 👍",
    "default": "Bene! 👍",
    "max_length": 15
  }, {
    "id": "TXT_OK",
    "label": "OK Text",
    "value": "Non male 🤔",
    "default": "Non male 🤔",
    "max_length": 15
  }, {
    "id": "TXT_MISS",
    "label": "Miss Text",
    "value": "Mancato!",
    "default": "Mancato!",
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
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #E6F5F0; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .string-guide{position:fixed!important;top:30%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
@font-face{font-family:"String Poppins";src:url("./assets/fonts/poppins/Poppins-Regular.woff2") format("woff2");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"String Poppins";src:url("./assets/fonts/poppins/Poppins-Bold.woff2") format("woff2");font-weight:700 900;font-style:normal;font-display:swap}
html:root{--font-display:"String Poppins",Arial,sans-serif;--font-body:"String Poppins",Arial,sans-serif;--font-mono:"String Poppins",Arial,sans-serif}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .string-guide{position:absolute!important;top:var(--string-guide-y,30%)!important;max-width:calc(100% - 60px)!important;font-size:16px!important;line-height:1.4!important;white-space:normal!important;overflow-wrap:normal!important;word-break:normal!important}
html:root .string-board:not([data-string-guide-aligned]) .string-guide{visibility:hidden!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.string-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html:root:root .string-guide,html:root:root .string-guide :is(p,span){font-weight:800!important}
html[data-guide-breathing-paused]:root:root :is(.string-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.string-guide){animation:none!important}}

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
var audioTransport = Tone.getContext().transport;
function App() {
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("idle");
  let [round, setRound] = React.useState(1);
  let [score, setScore] = React.useState(0);
  let [targetRadius, setTargetRadius] = React.useState(80);
  let [drawnAngle, setDrawnAngle] = React.useState(0);
  let [result, setResult] = React.useState({
    acc: 0,
    fb: ""
  });
  let angleRef = React.useRef(0);
  let animationRef = React.useRef(null);
  let lastFrameRef = React.useRef(0);
  let startedAtRef = React.useRef(null);
  let audioReadyRef = React.useRef(false);
  let successSynthRef = React.useRef(null);
  let errorSynthRef = React.useRef(null);
  let activePointerRef = React.useRef(null);
  let pressedRef = React.useRef(false);
  let audioPendingRef = React.useRef(false);
  let mountedRef = React.useRef(true);
  React.useEffect(() => {
    let enabled = true;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value = await requestGameConfig();
        if (value.ok) {
          options = await value.json();
        }
      } catch {}
      if (enabled) {
        setConfig(readConfigValues(options));
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  let createInstruments = React.useCallback(() => {
    if (!successSynthRef.current) {
      successSynthRef.current = new Tone.PolySynth(Tone.Synth).toDestination();
      successSynthRef.current.volume.value = -8;
      errorSynthRef.current = new Tone.MembraneSynth().toDestination();
      errorSynthRef.current.volume.value = -12;
      activePointerRef.current = new Tone.Loop(value => {
        errorSynthRef.current.triggerAttackRelease("C2", "32n", value, 0.1);
      }, "16n");
    }
  }, []);
  let resetRound = React.useCallback(() => {
    if (!config) return;
    let value = config.MIN_RADIUS || 40;
    let value2 = config.MAX_RADIUS || 120;
    setTargetRadius(value + Math.random() * (value2 - value));
    setPhase("idle");
    setDrawnAngle(0);
    angleRef.current = 0;
  }, [config]);
  React.useEffect(() => {
    if (config && round === 1 && targetRadius === 80) {
      resetRound();
    }
  }, [config, round, targetRadius, resetRound]);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pressedRef.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (startedAtRef.current) {
        clearTimeout(startedAtRef.current);
      }
      if (activePointerRef.current) {
        activePointerRef.current.stop();
        activePointerRef.current.dispose();
      }
      audioTransport.stop();
    };
  }, []);
  let startDrawing = async value => {
    if (!config || value.isPrimary === false || value.button > 0 || phase !== "idle" || pressedRef.current) return;
    pressedRef.current = true;
    if (!audioReadyRef.current && !audioPendingRef.current) {
      audioPendingRef.current = true;
      (async () => {
        try {
          if (await Tone.start(), !mountedRef.current) return;
          createInstruments();
          audioReadyRef.current = true;
          if (pressedRef.current) {
            activePointerRef.current?.start(0);
            audioTransport.start();
          }
        } catch {} finally {
          audioPendingRef.current = false;
        }
      })();
    }
    setPhase("drawing");
    angleRef.current = 0;
    setDrawnAngle(0);
    lastFrameRef.current = performance.now();
    if (audioReadyRef.current && activePointerRef.current) {
      activePointerRef.current.start(0);
    }
    if (audioReadyRef.current) {
      audioTransport.start();
    }
    let handleAction = value2 => {
      let value3 = Math.min(value2 - lastFrameRef.current, 50);
      lastFrameRef.current = value2;
      let value4 = config?.DRAW_SPEED || 0.4;
      angleRef.current += value3 * value4;
      setDrawnAngle(angleRef.current);
      animationRef.current = requestAnimationFrame(handleAction);
    };
    animationRef.current = requestAnimationFrame(handleAction);
  };
  let finishDrawing = value => {
    if (value && value.isPrimary === false || phase !== "drawing") return;
    pressedRef.current = false;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    if (activePointerRef.current) {
      activePointerRef.current.stop();
    }
    audioTransport.stop();
    setPhase("result");
    let current = angleRef.current;
    let value2 = 2 * Math.PI * targetRadius;
    let value3 = current / value2;
    let value4 = Math.max(0, 100 - Math.abs(1 - value3) * 100);
    let value5 = 0;
    let value6 = config?.TXT_MISS || "Mancato!";
    if (value4 > 95) {
      value5 = 10;
      value6 = config?.TXT_PERFECT || "Perfetto!";
    } else {
      if (value4 > 85) {
        value5 = 5;
        value6 = config?.TXT_GOOD || "Bene!";
      } else {
        if (value4 > 70) {
          value5 = 2;
          value6 = config?.TXT_OK || "OK";
        }
      }
    }
    setScore(value7 => value7 + value5);
    setResult({
      acc: value4,
      fb: value6
    });
    let timestamp = Tone.now();
    if (successSynthRef.current) {
      if (value5 > 0) {
        successSynthRef.current.triggerAttackRelease(["C5", "E5"], "8n", timestamp);
        successSynthRef.current.triggerAttackRelease(["E5", "G5"], "4n", timestamp + 0.15);
      } else {
        successSynthRef.current.triggerAttackRelease("C3", "4n", timestamp);
        successSynthRef.current.triggerAttackRelease("G2", "4n", timestamp + 0.2);
      }
    }
    startedAtRef.current = setTimeout(() => {
      setRound(value7 => value7 + 1);
      resetRound();
    }, 2500);
  };
  if (!config) return <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#E6F5F0"
  }} />;
  let circumference = 2 * Math.PI * targetRadius;
  let displayRadius = Math.max(65, Math.min(95, 65 + (targetRadius - (config.MIN_RADIUS || 40)) * 30 / Math.max(1, (config.MAX_RADIUS || 120) - (config.MIN_RADIUS || 40))));
  let strokeOffset = drawnAngle * displayRadius / targetRadius;
  return <div className={"string-game"} style={{
    width: "100%",
    height: "100%",
    margin: 0,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#E6F5F0",
    color: "#153F37",
    fontFamily: "var(--font-display)",
    display: "flex",
    flexDirection: "column",
    userSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "none"
  }} onPointerDown={startDrawing} onPointerUp={finishDrawing} onPointerCancel={finishDrawing}>{<style>{`
        html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
        * { box-sizing: border-box; }
      `}</style>}{<div className={"string-hud"} style={{
      position: "absolute",
      zIndex: 2,
      top: "calc(30px + env(safe-area-inset-top, 0px))",
      left: "30px",
      right: "30px",
      display: "flex",
      justifyContent: "space-between",
      padding: 0,
      background: "transparent",
      pointerEvents: "none",
      fontSize: "28px",
      fontWeight: 700,
      color: "#0C7168"
    }}>{<div aria-label={"Turno " + round}>{"#"}{round}</div>}{<div aria-label={"Punti " + score}>{score}</div>}</div>}{<div className={"string-board"} style={{
      position: "absolute",
      inset: 0,
      minHeight: 0
    }}>{<svg data-target-radius={targetRadius} viewBox={"0 0 400 400"} preserveAspectRatio={"xMidYMid meet"} style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible"
      }}>{<circle cx={200} cy={200} r={displayRadius} fill={"none"} stroke={"#557F73"} strokeWidth={4} strokeDasharray={"12 12"} />}{phase === "result" && <Motion.motion.circle cx={200} cy={200} r={displayRadius} fill={"none"} stroke={"#0C7168"} strokeWidth={6} strokeLinecap={"round"} strokeDasharray={`${strokeOffset} 10000`} initial={{
          strokeDashoffset: strokeOffset
        }} animate={{
          strokeDashoffset: 0
        }} transition={{
          duration: 1,
          ease: "easeOut"
        }} transform={"rotate(-90 200 200)"} />}{phase !== "result" && <g transform={"translate(200, 350)"}>{<line x1={0} y1={0} x2={0} y2={-strokeOffset} stroke={"#0C7168"} strokeWidth={6} strokeLinecap={"round"} vectorEffect={"non-scaling-stroke"} />}{phase === "idle" && <circle cx={0} cy={0} r={6} fill={"#0C7168"} />}</g>}{phase === "result" && (
        <Motion.motion.g className="string-result" transform="translate(200 200)"
          role="status" aria-label={`${(drawnAngle / circumference * 100).toFixed(1)}% ${result.fb}`}
          textAnchor="middle" pointerEvents="none" initial={{ opacity: 0 }}
          animate={{ opacity: 1 }} transition={{ delay: 1, duration: 0.22 }}>
          <text y={-12} dominantBaseline="central" fill="#0C7168" fontSize={Math.min(38, displayRadius * 0.48)}
            fontWeight={700} fontFamily="var(--font-mono)">
            {(drawnAngle / circumference * 100).toFixed(1)}%
          </text>
          <text y={28} dominantBaseline="central" fill="#153F37" fontSize={20} fontWeight={600}>
            {result.fb}
          </text>
        </Motion.motion.g>
      )}</svg>}{<Motion.AnimatePresence>{phase === "idle" && <Motion.motion.div className={"string-guide"} initial={{
          opacity: 0,
          y: 10
        }} animate={{
          opacity: 1,
          y: 0
        }} exit={{
          opacity: 0,
          y: 10
        }} style={{
          position: "absolute",
          bottom: "50px",
          left: "30px",
          right: "30px",
          textAlign: "center",
          color: "#4E6E66",
          fontSize: "18px",
          lineHeight: 1.5,
          pointerEvents: "none"
        }}>{config.TXT_PROMPT}</Motion.motion.div>}</Motion.AnimatePresence>}</div>}</div>;
}

// ./string-guide-layout.js
/* No.6 presentation only: follow the actual circle without changing play state. */
(() => {
  const root = document.getElementById('root');
  if (!root) return;
  let board = null;
  let circle = null;
  let guide = null;
  let frame = 0;
  let closed = false;
  const measure = () => {
    frame = 0;
    if (closed || !board?.isConnected || !circle?.isConnected) return;
    const container = board.getBoundingClientRect();
    const target = circle.getBoundingClientRect();
    if (target.width <= 0 || target.height <= 0) return;
    board.style.setProperty('--string-circle-y', target.top + target.height / 2 - container.top + 'px');
    board.style.setProperty('--string-circle-copy-width', target.width * 0.8 + 'px');
    const guideHeight = guide?.getBoundingClientRect().height || 22.4;
    board.style.setProperty('--string-guide-y', target.top - container.top - 28 - guideHeight / 2 + 'px');
    board.setAttribute('data-string-guide-aligned', 'true');
  };
  const schedule = () => {
    if (!closed && !frame) frame = requestAnimationFrame(measure);
  };
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  const radius = new MutationObserver(schedule);
  const attach = () => {
    const nextBoard = root.querySelector('.string-board');
    const nextCircle = nextBoard?.querySelector('svg>circle');
    const nextGuide = nextBoard?.querySelector('.string-guide');
    if (nextBoard !== board || nextCircle !== circle || nextGuide !== guide) {
      resize?.disconnect();
      radius.disconnect();
      board = nextBoard;
      circle = nextCircle;
      guide = nextGuide;
      if (board) resize?.observe(board);
      if (guide) resize?.observe(guide);
      if (circle) {
        resize?.observe(circle);
        radius.observe(circle, {
          attributes: true,
          attributeFilter: ['r', 'cx', 'cy']
        });
      }
    }
    schedule();
  };
  const content = new MutationObserver(attach);
  content.observe(root, {
    subtree: true,
    childList: true
  });
  const mode = new MutationObserver(schedule);
  mode.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-ui-batch2-preview']
  });
  window.addEventListener('resize', schedule);
  attach();
  window.addEventListener('pagehide', () => {
    closed = true;
    if (frame) cancelAnimationFrame(frame);
    resize?.disconnect();
    radius.disconnect();
    content.disconnect();
    mode.disconnect();
    window.removeEventListener('resize', schedule);
  }, {
    once: true
  });
})();

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

// ./ui-batch2-layout.js
/* State-specific layout only. No simulated input or preview demonstration. */
(() => {
  const html = document.documentElement;
  const host = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
  html.toggleAttribute('data-ui-batch2-preview', host);
  const style = document.createElement('style');
  style.textContent = `
    .cash-game .hud-score{color:#FFF0BA!important;text-shadow:none!important}
    .cw-header .hud-text{font-variant-numeric:tabular-nums}
    .cw-target .hud-text{font-size:18px!important;line-height:1.5}
    html[data-ui-batch2-preview] .cash-game .hud-panel{top:18%!important}
    html[data-ui-batch2-preview] .cash-game .tip-text{top:67%!important;bottom:auto!important;line-height:1.5}
    html[data-ui-batch2-preview] .cw-header{position:absolute;top:18%;left:30px;right:30px;padding:0!important}
    html[data-ui-batch2-preview] .cw-target{margin-top:8px!important;padding:4px 16px!important}
    html[data-ui-batch2-preview] .cw-target .hud-text{color:#fff!important;text-shadow:none!important}
    html[data-ui-batch2-preview] .cw-stage{inset:34% 30px 28%}
    html[data-ui-batch2-preview] .cw-guide{top:75%}
  `;
  document.head.append(style);
  window.addEventListener('message', event => {
    if (!host || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    html.toggleAttribute('data-ui-batch2-preview', event.data.active !== true);
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
        "data-subject": "#root svg",
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
  const selectors = [".string-guide"];
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
