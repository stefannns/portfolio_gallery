// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
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
  "tweaks": [{
    "id": "TIME_LIMIT",
    "kind": "number",
    "label": "Time Limit",
    "value": 30,
    "default": 30,
    "min": 10,
    "max": 60,
    "step": 1
  }, {
    "id": "FISH_COUNT",
    "kind": "number",
    "label": "Fish Count",
    "value": 24,
    "default": 24,
    "min": 5,
    "max": 50,
    "step": 1
  }, {
    "id": "FISH_SPEED",
    "kind": "number",
    "label": "Fish Speed",
    "value": 0.16,
    "default": 0.16,
    "min": 0.05,
    "max": 0.4,
    "step": 0.01
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "STRAPPA LA RETE",
    "default": "STRAPPA LA RETE",
    "max_length": 30
  }, {
    "id": "BTN_START",
    "label": "Start Button",
    "value": "INIZIA",
    "default": "INIZIA",
    "max_length": 20
  }, {
    "id": "BTN_RESTART",
    "label": "Restart Button",
    "value": "RIGIOCA",
    "default": "RIGIOCA",
    "max_length": 20
  }, {
    "id": "LBL_SCORE",
    "label": "Score Label",
    "value": "PUNTI",
    "default": "PUNTI",
    "max_length": 15
  }, {
    "id": "LBL_TIME",
    "label": "Time Label",
    "value": "TEMPO",
    "default": "TEMPO",
    "max_length": 15
  }],
  "images": [{
    "id": "BG_MAIN",
    "label": "Background Image",
    "path": "./assets/bg_main.webp",
    "replaceable": true
  }],
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
    body { background: #050510; overscroll-behavior: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
    #root { isolation: isolate; }
    canvas { touch-action: none; }
    button, input, select, textarea { touch-action: manipulation; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.feed-first-action{position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

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
html:root:root #stage #guide{visibility:visible!important;color:#30251e!important;text-shadow:none!important}
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
function audioNow() {
  return Tone.getContext().now();
}
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
function vibrate(value) {
  try {
    if (typeof window !== "undefined" && window.tt && window.tt.vibrate) {
      window.tt.vibrate({
        style: value || "light"
      });
    }
  } catch {}
}
function useRecordingSubmission() {
  let canSubmit = typeof window !== "undefined" && window.tt && typeof window.tt.playableRecordingSubmission == "function";
  let [submitting, setSubmitting] = React.useState(false);
  React.useEffect(() => {
    let handleAction = () => setSubmitting(false);
    let handleAction2 = () => {
      if (document.visibilityState === "visible") {
        handleAction();
      }
    };
    document.addEventListener("visibilitychange", handleAction2);
    window.addEventListener("pageshow", handleAction);
    return () => {
      document.removeEventListener("visibilitychange", handleAction2);
      window.removeEventListener("pageshow", handleAction);
    };
  }, []);
  return {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: () => {
      if (!(submitting || !canSubmit)) {
        setSubmitting(true);
        window.tt.playableRecordingSubmission({
          success() {},
          fail(value) {
            console.error("[post_my_play] playableRecordingSubmission failed", value && (value.errMsg || value.message));
            setSubmitting(false);
          },
          complete() {}
        });
      }
    }
  };
}
function RecordingButton() {
  let {
    canSubmit: value,
    submitting: value2,
    submitRecording: handleClick
  } = useRecordingSubmission();
  return value ? <button className={"btn btn-secondary"} type={"button"} disabled={value2} onClick={handleClick}>{"Condividi"}</button> : null;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("ready");
  let surfaceRef = React.useRef(null);
  let canvasRef = React.useRef(null);
  let animationRef = React.useRef(null);
  let timerTextRef = React.useRef(null);
  let phaseRef = React.useRef("idle");
  let startedAtRef = React.useRef(0);
  let lastFrameRef = React.useRef(0);
  let nodesRef = React.useRef([]);
  let linksRef = React.useRef([]);
  let nodeAlive = React.useRef([]);
  let anchorPointsRef = React.useRef([]);
  let escapedItemsRef = React.useRef([]);
  let particlesRef = React.useRef([]);
  let pointerRef = React.useRef(null);
  let audioRef = React.useRef({
    synth: null,
    mem: null,
    lastTime: {}
  });
  let startedRef = React.useRef(false);
  let columns = 8;
  let rows = 12;
  let initAudio = async () => {
    if (!audioRef.current.synth) {
      await Tone.start();
      audioRef.current.synth = new Tone.PolySynth(Tone.Synth).toDestination();
      audioRef.current.synth.volume.value = -12;
      audioRef.current.mem = new Tone.MembraneSynth().toDestination();
      audioRef.current.mem.volume.value = -6;
    }
  };
  let nextAudioTime = React.useCallback(value => {
    let current = audioRef.current;
    let value2 = audioNow();
    let value3 = current.lastTime[value] || 0;
    let value4 = value2 > value3 ? value2 : value3 + 0.001;
    current.lastTime[value] = value4;
    return value4;
  }, []);
  let playCut = React.useCallback(() => {
    if (audioRef.current.synth) {
      audioRef.current.synth.triggerAttackRelease("C6", "32n", nextAudioTime("cut"));
    }
  }, [nextAudioTime]);
  let playEscape = React.useCallback(() => {
    if (audioRef.current.mem) {
      audioRef.current.mem.triggerAttackRelease("E2", "8n", nextAudioTime("esc"));
    }
  }, [nextAudioTime]);
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
  React.useEffect(() => {
    if (!config) return;
    let resizeObserver = observeGameSize(value => {
      for (let value2 of value) {
        let {
          width: contentRect,
          height: contentRect2
        } = value2.contentRect;
        if (contentRect > 0 && contentRect2 > 0 && canvasRef.current) {
          canvasRef.current.width = contentRect * (window.devicePixelRatio || 1);
          canvasRef.current.height = contentRect2 * (window.devicePixelRatio || 1);
        }
      }
    });
    if (surfaceRef.current) {
      resizeObserver.observe(surfaceRef.current);
    }
    return () => resizeObserver.disconnect();
  }, [config]);
  let resetNet = React.useCallback(() => {
    if (!canvasRef.current) return;
    let clientWidth = canvasRef.current.clientWidth;
    let clientHeight = canvasRef.current.clientHeight;
    let items = [];
    for (let value2 = 0; value2 <= rows; value2++) {
      let items4 = [];
      for (let value3 = 0; value3 < columns; value3++) items4.push(true);
      items.push(items4);
    }
    nodesRef.current = items;
    let items2 = [];
    for (let value2 = 0; value2 < rows; value2++) {
      let items4 = [];
      for (let value3 = 0; value3 <= columns; value3++) items4.push(true);
      items2.push(items4);
    }
    linksRef.current = items2;
    nodeAlive.current = Array.from({
      length: rows + 1
    }, () => Array(columns + 1).fill(true));
    let items3 = [];
    let value = config.FISH_SPEED || 0.15;
    for (let value2 = 0; value2 < config.FISH_COUNT; value2++) items3.push({
      x: clientWidth / 2 + (Math.random() - 0.5) * clientWidth * 0.6,
      y: clientHeight / 2 + (Math.random() - 0.5) * clientHeight * 0.6,
      vx: (Math.random() > 0.5 ? 1 : -1) * value * (0.8 + Math.random() * 0.4),
      vy: (Math.random() > 0.5 ? 1 : -1) * value * (0.8 + Math.random() * 0.4),
      color: Math.random() > 0.2 ? "#00f3ff" : "#ffaa00"
    });
    anchorPointsRef.current = items3;
    startedAtRef.current = 0;
    lastFrameRef.current = config.TIME_LIMIT;
    escapedItemsRef.current = [];
    particlesRef.current = [];
    pointerRef.current = null;
    phaseRef.current = "ready";
    setPhase("ready");
  }, [config]);
  let startGame = () => {
    if (!startedRef.current) {
      startedRef.current = true;
      resetNet();
      initAudio().catch(() => {});
    }
  };
  let restartGame = () => {
    resetNet();
  };
  React.useEffect(() => {
    if (config && canvasRef.current) resetNet();
  }, [resetNet, config]);
  React.useEffect(() => {
    if (!config) return;
    let value;
    let timestamp = performance.now();
    let handleAction = value2 => {
      value = requestAnimationFrame(handleAction);
      let value3 = value2 - timestamp;
      if (value3 > 100) {
        value3 = 16;
      }
      timestamp = value2;
      if (document.hidden) return;
      let dimensions = canvasRef.current;
      if (!dimensions) return;
      let context = dimensions.getContext("2d");
      let value4 = window.devicePixelRatio || 1;
      let clientWidth = dimensions.clientWidth;
      let clientHeight = dimensions.clientHeight;
      let value5 = clientWidth / columns;
      let value6 = clientHeight / rows;
      let demoDrag = window.PlayableBatch4Preview?.netDrag(clientWidth, clientHeight, columns, rows, value2);
      let handleAction2 = (value7, otherValue) => {
        let drag = pointerRef.current || demoDrag;
        let baseX = otherValue * value5;
        let baseY = value7 * value6;
        if (!drag) return {
          x: baseX,
          y: baseY
        };
        let fall = Math.max(0, 1 - Math.hypot(value7 - drag.row, otherValue - drag.col) / 4.5);
        fall = fall * fall * (3 - 2 * fall);
        return {
          x: baseX + drag.dx * fall,
          y: baseY + drag.dy * fall
        };
      };
      if (phaseRef.current === "playing" && !window.PlayableBatch4Preview?.active) {
        lastFrameRef.current -= value3 / 1000;
        if (lastFrameRef.current <= 0) {
          lastFrameRef.current = 0;
          phaseRef.current = "over";
          setPhase("over");
        }
        for (let value7 = anchorPointsRef.current.length - 1; value7 >= 0; value7--) {
          let particle = anchorPointsRef.current[value7];
          let value8 = Math.floor(particle.x / value5);
          let value9 = Math.floor(particle.y / value6);
          particle.x += particle.vx * value3;
          particle.y += particle.vy * value3;
          let value10 = Math.floor(particle.x / value5);
          let value11 = Math.floor(particle.y / value6);
          if (value10 !== value8) {
            let value12 = value10 > value8 ? value10 : value8;
            if (value9 >= 0 && value9 < rows && value12 >= 0 && value12 <= columns && linksRef.current[value9][value12]) {
              particle.vx *= -1;
              particle.x = value8 * value5 + (value10 > value8 ? value5 - 1 : 1);
            }
          }
          if (value11 !== value9) {
            let value12 = value11 > value9 ? value11 : value9;
            if (value8 >= 0 && value8 < columns && value12 >= 0 && value12 <= rows && nodesRef.current[value12][value8]) {
              particle.vy *= -1;
              particle.y = value9 * value6 + (value11 > value9 ? value6 - 1 : 1);
            }
          }
          if (particle.x < -30 || particle.x > clientWidth + 30 || particle.y < -30 || particle.y > clientHeight + 30) {
            anchorPointsRef.current.splice(value7, 1);
            playEscape();
          }
        }
        if (anchorPointsRef.current.length === 0 && phaseRef.current === "playing") {
          phaseRef.current = "over";
          setPhase("over");
        }
      }
      context.clearRect(0, 0, dimensions.width, dimensions.height);
      context.save();
      context.scale(value4, value4);
      context.strokeStyle = pointerRef.current && pointerRef.current.ratio > 0.65 ? "rgba(255, 157, 74, 0.98)" : "rgba(255, 255, 255, 0.96)";
      context.lineWidth = 4 + ((pointerRef.current == null ? void 0 : pointerRef.current.ratio) || 0) * 2;
      context.shadowColor = "#00f3ff";
      context.shadowBlur = 5;
      context.lineCap = "round";
      context.beginPath();
      for (let value7 = 0; value7 <= rows; value7++) for (let value8 = 0; value8 < columns; value8++) {
        if (nodesRef.current[value7]?.[value8] && nodeAlive.current[value7]?.[value8] && nodeAlive.current[value7]?.[value8 + 1]) {
          (() => {
            let from = handleAction2(value7, value8);
            let point = handleAction2(value7, value8 + 1);
            context.moveTo(from.x, from.y);
            context.lineTo(point.x, point.y);
          })();
        }
      }
      for (let value7 = 0; value7 < rows; value7++) for (let value8 = 0; value8 <= columns; value8++) {
        if (linksRef.current[value7]?.[value8] && nodeAlive.current[value7]?.[value8] && nodeAlive.current[value7 + 1]?.[value8]) {
          (() => {
            let from = handleAction2(value7, value8);
            let point = handleAction2(value7 + 1, value8);
            context.moveTo(from.x, from.y);
            context.lineTo(point.x, point.y);
          })();
        }
      }
      context.stroke();
      context.shadowBlur = 0;
      context.fillStyle = "#00f3ff";
      for (let value7 = 0; value7 <= rows; value7++) for (let value8 = 0; value8 <= columns; value8++) {
        if (!nodeAlive.current[value7]?.[value8]) continue;
        let enabled = false;
        if (value7 < rows && value8 <= columns && linksRef.current[value7]?.[value8]) {
          enabled = true;
        }
        if (value7 > 0 && value8 <= columns && linksRef.current[value7 - 1]?.[value8]) {
          enabled = true;
        }
        if (value7 <= rows && value8 < columns && nodesRef.current[value7]?.[value8]) {
          enabled = true;
        }
        if (value7 <= rows && value8 > 0 && nodesRef.current[value7]?.[value8 - 1]) {
          enabled = true;
        }
        if (enabled) {
          (() => {
            let point = handleAction2(value7, value8);
            context.beginPath();
            context.arc(point.x, point.y, 4 + ((pointerRef.current == null ? void 0 : pointerRef.current.ratio) || 0) * 1.5, 0, Math.PI * 2);
            context.fill();
          })();
        }
      }
      context.lineWidth = 4;
      context.strokeStyle = "#ffffff";
      context.shadowColor = "#00aaff";
      context.shadowBlur = 15;
      for (let value7 = particlesRef.current.length - 1; value7 >= 0; value7--) {
        let item = particlesRef.current[value7];
        if (item.age += value3, item.age > 250) {
          particlesRef.current.splice(value7, 1);
          continue;
        }
        context.globalAlpha = 1 - item.age / 250;
        context.beginPath();
        context.moveTo(item.x1, item.y1);
        context.lineTo(item.x2, item.y2);
        context.stroke();
      }
      context.globalAlpha = 1;
      context.shadowBlur = 0;
      for (let particle of anchorPointsRef.current) {
        context.save();
        context.translate(particle.x + (demoDrag ? Math.sin(value2 * 0.001 + particle.y) * value5 * 0.22 : 0), particle.y + (demoDrag ? Math.cos(value2 * 0.0012 + particle.x) * value6 * 0.18 : 0));
        context.rotate(Math.atan2(particle.vy, particle.vx));
        let value7 = Math.sin(value2 * 0.018 + particle.x * 0.04) * 2.5;
        context.shadowColor = particle.color;
        context.shadowBlur = 10;
        context.fillStyle = particle.color;
        context.beginPath();
        context.ellipse(0, 0, 13, 7, 0, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 0.82;
        context.beginPath();
        context.moveTo(-9, 0);
        context.lineTo(-21, -8 + value7);
        context.lineTo(-17, 0);
        context.lineTo(-21, 8 + value7);
        context.closePath();
        context.fill();
        context.globalAlpha = 0.65;
        context.fillStyle = "#fff";
        context.beginPath();
        context.moveTo(-1, 1);
        context.lineTo(-7, 9);
        context.lineTo(5, 5);
        context.closePath();
        context.fill();
        context.globalAlpha = 0.45;
        context.strokeStyle = "#fff";
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(5, 0, 4, -Math.PI / 2, Math.PI / 2);
        context.stroke();
        context.globalAlpha = 1;
        context.fillStyle = "#fff";
        context.beginPath();
        context.arc(7, -2.2, 2.1, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#07121d";
        context.beginPath();
        context.arc(7.6, -2.2, 0.9, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "rgba(0,0,0,.55)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(11.5, 2);
        context.quadraticCurveTo(14, 3, 15, 1);
        context.stroke();
        context.restore();
      }
      for (let value7 = escapedItemsRef.current.length - 1; value7 >= 0; value7--) {
        let particle = escapedItemsRef.current[value7];
        if (particle.x += particle.vx * value3, particle.y += particle.vy * value3, particle.life -= value3 * 0.003, particle.life <= 0) {
          escapedItemsRef.current.splice(value7, 1);
          continue;
        }
        context.fillStyle = `rgba(0, 200, 255, ${particle.life})`;
        context.beginPath();
        context.arc(particle.x, particle.y, 3, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
      if (animationRef.current) {
        animationRef.current.textContent = startedAtRef.current;
      }
      if (timerTextRef.current) {
        timerTextRef.current.textContent = Math.ceil(lastFrameRef.current) + "s";
      }
    };
    value = requestAnimationFrame(handleAction);
    return () => cancelAnimationFrame(value);
  }, [config, playEscape]);
  let handlePointerDown = event => {
    if (phaseRef.current !== "playing" && phaseRef.current !== "ready" || event.isPrimary === false || event.button > 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    let bounds = surfaceRef.current.getBoundingClientRect();
    let value = event.clientX - bounds.left;
    let value2 = event.clientY - bounds.top;
    let clientWidth = canvasRef.current.clientWidth;
    let clientHeight = canvasRef.current.clientHeight;
    let value3 = clientWidth / columns;
    let value4 = clientHeight / rows;
    let value5 = Math.max(0, Math.min(rows, Math.round(value2 / value4)));
    let value6 = Math.max(0, Math.min(columns, Math.round(value / value3)));
    if (!nodeAlive.current[value5]?.[value6]) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      return;
    }
    if (phaseRef.current === "ready") {
      phaseRef.current = "playing";
      setPhase("playing");
      initAudio().catch(() => {});
    }
    pointerRef.current = {
      row: value5,
      col: value6,
      baseX: value6 * value3,
      baseY: value5 * value4,
      dx: value - value6 * value3,
      dy: value2 - value5 * value4,
      ratio: 0,
      tears: 0
    };
  };
  let handlePointerMove = event => {
    if (phaseRef.current !== "playing" || !pointerRef.current || event.isPrimary === false) return;
    event.preventDefault();
    let bounds = surfaceRef.current.getBoundingClientRect();
    let value = event.clientX - bounds.left;
    let value2 = event.clientY - bounds.top;
    let current = pointerRef.current;
    let clientWidth = canvasRef.current.clientWidth;
    let clientHeight = canvasRef.current.clientHeight;
    let value3 = clientWidth / columns;
    let value4 = clientHeight / rows;
    let tearThreshold = Math.max(64, Math.min(value3, value4) * 1.45);
    current.dx = value - current.baseX;
    current.dy = value2 - current.baseY;
    let stretch = Math.hypot(current.dx, current.dy);
    if (current.ratio = Math.min(1, stretch / tearThreshold), stretch >= tearThreshold) {
      let broken = 0;
      let handleAction = (grid, otherValue, argument3) => {
        if (grid.current[otherValue]?.[argument3]) {
          grid.current[otherValue][argument3] = false;
        }
      };
      let breakNode = (value5, otherValue) => {
        if (!nodeAlive.current[value5]?.[otherValue]) return false;
        nodeAlive.current[value5][otherValue] = false;
        broken++;
        handleAction(nodesRef, value5, otherValue - 1);
        handleAction(nodesRef, value5, otherValue);
        handleAction(linksRef, value5 - 1, otherValue);
        handleAction(linksRef, value5, otherValue);
        return true;
      };
      let prune = () => {
        let seen = Array.from({
          length: rows + 1
        }, () => Array(columns + 1).fill(false));
        let stack = [];
        let push = (value5, otherValue) => {
          if (nodeAlive.current[value5]?.[otherValue] && !seen[value5][otherValue]) {
            seen[value5][otherValue] = true;
            stack.push([value5, otherValue]);
          }
        };
        for (let value5 = 0; value5 <= rows; value5++) {
          push(value5, 0);
          push(value5, columns);
        }
        for (let value5 = 1; value5 < columns; value5++) {
          push(0, value5);
          push(rows, value5);
        }
        for (; stack.length;) {
          let [row, col] = stack.pop();
          if (col > 0 && nodesRef.current[row]?.[col - 1]) {
            push(row, col - 1);
          }
          if (col < columns && nodesRef.current[row]?.[col]) {
            push(row, col + 1);
          }
          if (row > 0 && linksRef.current[row - 1]?.[col]) {
            push(row - 1, col);
          }
          if (row < rows && linksRef.current[row]?.[col]) {
            push(row + 1, col);
          }
        }
        for (let value5 = 0; value5 <= rows; value5++) for (let value6 = 0; value6 <= columns; value6++) {
          if (nodeAlive.current[value5]?.[value6] && !seen[value5][value6]) {
            nodeAlive.current[value5][value6] = false;
            handleAction(nodesRef, value5, value6 - 1);
            handleAction(nodesRef, value5, value6);
            handleAction(linksRef, value5 - 1, value6);
            handleAction(linksRef, value5, value6);
          }
        }
      };
      breakNode(current.row, current.col);
      prune();
      particlesRef.current.push({
        x1: current.baseX,
        y1: current.baseY,
        x2: value,
        y2: value2,
        age: 0
      });
      for (let value5 = 0; value5 < 18; value5++) escapedItemsRef.current.push({
        x: value,
        y: value2,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        life: 1
      });
      if (broken) {
        playCut();
        vibrate("medium");
      }
      let nextRow = Math.max(0, Math.min(rows, Math.round(value2 / value4)));
      let nextCol = Math.max(0, Math.min(columns, Math.round(value / value3)));
      if (!nodeAlive.current[nextRow]?.[nextCol]) {
        let best = null;
        let bestDist = 1 / 0;
        for (let value5 = 0; value5 <= rows; value5++) for (let value6 = 0; value6 <= columns; value6++) if (nodeAlive.current[value5]?.[value6]) {
          let dist = Math.hypot(value5 - nextRow, value6 - nextCol);
          if (dist < bestDist) {
            bestDist = dist;
            best = {
              row: value5,
              col: value6
            };
          }
        }
        if (!best) {
          pointerRef.current = null;
          return;
        }
        nextRow = best.row;
        nextCol = best.col;
      }
      current.row = nextRow;
      current.col = nextCol;
      current.baseX = nextCol * value3;
      current.baseY = nextRow * value4;
      current.dx = value - current.baseX;
      current.dy = value2 - current.baseY;
      current.ratio = 0;
      current.tears = (current.tears || 0) + 1;
    }
  };
  let releasePointer = event => {
    pointerRef.current = null;
    if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  return config ? <React.Fragment>{<style>{`
        @font-face {
          font-family: 'Bangers';
          src: url('./assets/fonts/bangers/Bangers-Regular.woff2') format('woff2');
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
        :root {
          --font-display: "Bangers", "PingFang SC", system-ui, sans-serif;
          --font-body: -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
          --font-mono: ui-monospace, Menlo, monospace;
        }
        html, body, #root { width:100%; height:100%; margin:0; overflow:hidden; background-color:#000B18; }
        * { box-sizing: border-box; }
        .overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(0,11,24,0.7); backdrop-filter:blur(6px); z-index:20; }
        .title { font-family:var(--font-display); font-size:clamp(40px, 12cqi, 72px); color:#fff; text-shadow:0 4px 0 #0055ff, 0 0 20px rgba(0,150,255,0.6); margin-bottom:16px; text-align:center; padding:0 20px; letter-spacing: 2px;}
        .stat { font-family:var(--font-display); font-size:36px; color:#00f3ff; margin-bottom:30px; text-shadow:0 2px 4px rgba(0,0,0,0.8); }
        .btn { font-family:var(--font-display); font-size:28px; padding:12px 32px; background:#0055ff; color:#fff; border:none; border-radius:12px; box-shadow:0 6px 0 #003399; cursor:pointer; text-transform:uppercase; transition:transform 0.1s; letter-spacing: 1px; min-width: 180px;}
        .btn:active:not(:disabled) { transform:translateY(4px); box-shadow:0 2px 0 #003399; }
        .btn-secondary { background:#ffaa00; box-shadow:0 6px 0 #cc8800; }
        .btn-secondary:active:not(:disabled) { box-shadow:0 2px 0 #cc8800; }
        .btn:disabled { opacity:0.6; cursor:not-allowed; }
        .hud { position:absolute; top:calc(30px + env(safe-area-inset-top, 0px)); left:30px; right:30px; display:flex; justify-content:space-between; pointer-events:none; font-family:var(--font-display); font-size:28px; color:#fff; text-shadow:0 3px 6px rgba(0,0,0,0.8); z-index:10; }
        .btn-group { display:flex; gap:16px; flex-wrap:wrap; justify-content:center; padding:0 20px; }
      `}</style>}{<div ref={surfaceRef} style={{
      width: "100%",
      height: "100%",
      position: "relative",
      containerType: "size",
      backgroundImage: `url(${config.BG_MAIN || ""})`,
      backgroundSize: "cover",
      backgroundPosition: "center"
    }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={releasePointer} onPointerCancel={releasePointer}>{<canvas ref={canvasRef} style={{
        width: "100%",
        height: "100%",
        display: "block",
        touchAction: "none"
      }} />}{<div className={"hud"}>{<div aria-label={"Tempo rimanente"}>{<span ref={timerTextRef}>{config.TIME_LIMIT}{"s"}</span>}</div>}</div>}{phase === "ready" && <p className={"feed-first-action"} style={{
        position: "absolute",
        top: "90px",
        left: 30,
        right: 30,
        zIndex: 12,
        margin: 0,
        fontSize: 18,
        lineHeight: 1.35,
        textAlign: "center",
        pointerEvents: "none",
        color: "#e4faff"
      }}>{"Trascina per strappare la rete"}</p>}{<Motion.AnimatePresence>{null}{phase === "over" && <Motion.motion.div className={"overlay"} initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} exit={{
          opacity: 0
        }}>{<div className={"title"}>{"PARTITA FINITA"}</div>}{<div className={"stat"}>{Math.ceil(Math.max(0, config.TIME_LIMIT - lastFrameRef.current))}{"s"}</div>}{<div className={"btn-group"}>{<button className={"btn"} onClick={restartGame}>{config.BTN_RESTART}</button>}{<RecordingButton />}</div>}</Motion.motion.div>}</Motion.AnimatePresence>}</div>}</React.Fragment> : <div style={{
    width: "100%",
    height: "100%",
    background: "#000B18"
  }} />;
}

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
        "data-game": "33"
      }[name] ?? null;
    },
    dataset: {
      game: "33"
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
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./fishing-net-repair.js
(() => {
  const attachInputGuard = () => {
    const canvas = document.querySelector("canvas");
    if (!canvas || canvas.dataset.netInputRepair === "1") return false;
    canvas.dataset.netInputRepair = "1";
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", event => {
      event.preventDefault();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (value) {
        // Pointer capture is an enhancement; the original handlers still work.
      }
    }, {
      passive: false
    });
    const releasePointer = event => {
      try {
        if (canvas.hasPointerCapture(event.pointerId)) {
          canvas.releasePointerCapture(event.pointerId);
        }
      } catch (value) {
        // Ignore browsers without full pointer-capture support.
      }
    };
    canvas.addEventListener("pointerup", releasePointer);
    canvas.addEventListener("pointercancel", releasePointer);
    return true;
  };
  if (!attachInputGuard()) {
    const observer = new MutationObserver(() => {
      if (attachInputGuard()) observer.disconnect();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})();

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
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
  const selectors = ["p.feed-first-action"];
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
