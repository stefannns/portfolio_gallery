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
  "tweaks": [],
  "texts": [{
    "id": "TITLE",
    "label": "Game Title",
    "value": "Cerchio orbitale",
    "default": "Cerchio orbitale",
    "max_length": 25
  }, {
    "id": "GUIDE_TEXT",
    "label": "Guide Text",
    "value": "Disegna un cerchio perfetto",
    "default": "Disegna un cerchio perfetto",
    "max_length": 60
  }, {
    "id": "BTN_RETRY",
    "label": "Retry Button",
    "value": "Riprova",
    "default": "Riprova",
    "max_length": 20
  }, {
    "id": "SCORE_PERFECT",
    "label": "Perfect Comment",
    "value": "Perfetto",
    "default": "Perfetto",
    "max_length": 20
  }, {
    "id": "SCORE_GOOD",
    "label": "Good Comment",
    "value": "Bene",
    "default": "Bene",
    "max_length": 20
  }, {
    "id": "SCORE_AGAIN",
    "label": "Try Again Comment",
    "value": "Riprova",
    "default": "Riprova",
    "max_length": 20
  }, {
    "id": "SCORE_SHORT",
    "label": "Too Short Comment",
    "value": "Troppo breve",
    "default": "Troppo breve",
    "max_length": 20
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
    body { background: #152C3A; -webkit-tap-highlight-color: transparent; }
    #root > div { padding: 40px 25px !important; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}


#root>div{padding:30px 30px 50px!important}#root h1{display:none}

/* Game-owned FYP adjustments. Host gradients, button and frame are not changed. */
.meeting-guide{position:absolute;z-index:18;top:18%;left:30px;right:30px;margin:0;text-align:center;font:500 18px/1.4 var(--font-body,system-ui,sans-serif);pointer-events:none;color:var(--meeting-ink,#263544)}
.meeting-guide[hidden]{display:none}
html[data-meeting-fyp="preview"] .meeting-guide{animation:meeting-guide-breathe 2.8s ease-in-out infinite}
@keyframes meeting-guide-breathe{0%,100%{opacity:1}50%{opacity:.72}}
.meeting-demo{position:absolute;pointer-events:none;z-index:8;inset:0;overflow:hidden}
.meeting-demo[hidden]{display:none}
html[data-meeting-fyp="playing"] .meeting-demo,html[data-meeting-fyp="direct"] .meeting-demo{display:none}
html[data-meeting-game="14"] .melody-realistic{--ink:#fff4df;--panel:#263541;--accent:#e5bc79}
html[data-meeting-game="14"][data-meeting-fyp="preview"] .melody-controls,html[data-meeting-game="14"][data-meeting-fyp="preview"] .melody-status{visibility:hidden;pointer-events:none}
html[data-meeting-game="14"][data-meeting-fyp="preview"] .melody-guide{top:18%;font-size:18px;line-height:1.4}
html[data-meeting-game="14"] .melody-guide span{background:rgba(30,43,54,.9)}
html[data-meeting-game="15"]{--bg-dark:#edf5f3!important;--surface:transparent!important;--primary:#d66e4d!important;--text-main:#234c4a!important;--text-dim:#355e5a!important}
html[data-meeting-game="15"] #root>div{padding:0!important;background:#edf5f3!important}
html[data-meeting-game="15"] .meeting-orbital-heading{display:none!important}
html[data-meeting-game="15"] .meeting-orbital-board{border-radius:0!important;box-shadow:none!important;background:transparent!important}
html[data-meeting-game="15"] .meeting-orbital-board>div:has(>p){top:18%!important;left:30px!important;right:30px!important}
html[data-meeting-game="16"] .meeting-sand-reset-wrap{left:auto!important;right:30px!important;top:auto!important;bottom:50px!important}
html[data-meeting-game="16"][data-meeting-fyp="preview"] .meeting-sand-reset-wrap{visibility:hidden;pointer-events:none}
html[data-meeting-game="16"] .meeting-sand-reset{width:44px;height:44px;min-height:44px!important;padding:10px!important;border:1.5px solid #713f32!important;border-radius:50%!important;background:transparent!important;box-shadow:none!important;color:#713f32!important;display:grid;place-items:center}
html[data-meeting-game="16"] .meeting-sand-reset svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
html[data-meeting-game="16"] .meeting-sand-hud,html[data-meeting-game="16"] .meeting-sand-hud>div{font-family:var(--font-display)!important;font-size:28px!important;line-height:1.25!important;white-space:nowrap}
html[data-meeting-game="16"] .meeting-sand-ball-count{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
html[data-meeting-game="16"] .meeting-sand-ball-count>small{font-size:12px;line-height:1.2;font-family:inherit}
html[data-meeting-game="17"]{--bg-dark:#eaf3fa!important;--neon-cyan:#167e9b!important;--neon-magenta:#9c4b8d!important}
html[data-meeting-game="17"] .synth-grid{opacity:.25}
html[data-meeting-game="17"] .feed-first-action{color:#334c65!important;top:18%!important;font-size:18px!important;line-height:1.4!important}
html[data-meeting-game="17"] .meeting-synth-result{background:rgba(234,243,250,.97)!important}
html[data-meeting-game="17"] .meeting-synth-result>div{color:#334c65!important}
html[data-meeting-game="17"] .meeting-synth-result h2{text-shadow:none!important}
html[data-meeting-game="17"][data-meeting-fyp="preview"] canvas{--synth-safe-bottom:140px}
html[data-meeting-game="17"][data-meeting-fyp="preview"] .synth-score{visibility:hidden}
html[data-meeting-game="19"] .meeting-cube-heading>div>p{position:absolute;top:108px;left:30px;right:30px;text-align:center!important;margin:0!important;font-size:18px!important;line-height:1.4!important;z-index:12}
html[data-meeting-game="19"] button[aria-label="Ricomincia con i cubi"]{width:44px!important;height:44px!important;background:transparent!important;box-shadow:none!important;border:1.5px solid #65708c!important;color:#65708c}
html[data-meeting-game="19"] button[aria-label="Ricomincia con i cubi"] svg{stroke:currentColor!important;stroke-width:1.8}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .peeler-hud{visibility:hidden}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-board img[alt="peeled potato"],html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-board canvas{width:82%!important;max-height:100%;object-fit:contain}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-board canvas{transform:translateY(-20px)}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-board img[alt="peeled potato"]{transform:translateY(-20px) scale(.9)!important}
html[data-meeting-game="32"][data-meeting-fyp="preview"] #peeler-sprite{margin-top:44px}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-guide{position:absolute!important;top:18%!important;left:30px;right:30px;bottom:auto!important;min-height:0!important;padding:0!important;pointer-events:none}
html[data-meeting-game="32"] .meeting-peeler-guide p{font:500 18px/1.4 var(--font-body)!important}
html[data-meeting-game="35"] .meeting-guide{background:#fffffff2;box-shadow:0 2px 10px #0000000a;padding:9px 10px;border-radius:8px;left:30px;right:30px;--meeting-ink:#26262a}
html[data-meeting-game="40"] .meeting-guide{--meeting-ink:#f5e8d3}
html[data-meeting-game="40"] .meeting-pixel-clear{bottom:30px!important}
html[data-meeting-game="40"] .meeting-pixel-clear button{padding:10px 20px!important;min-height:44px!important;box-shadow:none!important;font-family:var(--font-body)!important;font-size:18px!important}
html[data-meeting-game="40"][data-meeting-fyp="preview"] :is(.meeting-pixel-palette,.meeting-pixel-label,.meeting-pixel-clear){visibility:hidden;opacity:0!important;pointer-events:none}
html[data-meeting-game="41"] .meeting-chat-shell{padding-top:12px!important;padding-bottom:20px!important}
html[data-meeting-game="41"] header{min-height:56px!important;padding-top:4px!important;padding-bottom:4px!important}
html[data-meeting-game="41"] header>div{gap:2px!important}
html[data-meeting-game="41"] header>div>div:first-child{width:32px!important;height:32px!important}
html[data-meeting-game="41"] main{min-height:150px!important}
html[data-meeting-game="41"] section .ios-scroll{max-height:96px!important;overflow-y:auto!important}
html[data-meeting-game="41"] section{padding-top:6px!important;padding-bottom:6px!important}
html[data-meeting-game="41"] section:has(.ios-scroll)>div:first-child{height:32px!important;margin-bottom:6px!important;border-radius:16px!important;font-size:14px!important}
html[data-meeting-game="41"] section:has(.ios-scroll)>div:first-child>span[aria-hidden="true"]{width:24px!important;height:24px!important;font-size:17px!important}
html[data-meeting-game="41"][data-meeting-fyp="preview"] .meeting-chat-shell{padding-top:48px!important;padding-bottom:128px!important}
html[data-meeting-game="45"][data-meeting-fyp="preview"] .top{visibility:hidden}
html[data-meeting-game="45"] .hint{top:18%!important;bottom:auto!important;font-size:18px!important;line-height:1.4!important;font-weight:500!important}
.meeting-carve-cursor{position:absolute;left:50%;top:44%;width:18px;height:18px;border:2px solid #fff8cd;border-radius:50%;box-shadow:0 0 0 6px #f5cd6544;animation:meeting-carve 3.4s ease-in-out infinite}
@keyframes meeting-carve{0%,100%{transform:translate(-66px,40px);opacity:0}12%{opacity:1}35%{transform:translate(0,-54px);opacity:1}58%{transform:translate(66px,40px);opacity:1}78%{transform:translate(-45px,-18px);opacity:.7}90%{transform:translate(45px,-18px);opacity:0}}
html[data-meeting-inactive] .meeting-demo *,html[data-meeting-inactive] .meeting-guide{animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){.meeting-demo *,.meeting-guide{animation:none!important}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .meeting-orbital-board>div:has(>p){position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.meeting-orbital-board>div:has(>p)>p){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.meeting-orbital-board>div:has(>p)>p){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.meeting-orbital-board>div:has(>p)>p){animation:none!important}}

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
function useRecordingSubmission() {
  let canSubmit = typeof window !== "undefined" && typeof window.tt !== "undefined" && typeof window.tt.playableRecordingSubmission == "function";
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
function GameStyles() {
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
      --bg-dark: #152C3A;
      --surface: #1D3846;
      --primary: #FFAA53;
      --text-main: #EFF7FA;
      --text-dim: #ACC4D0;
    }
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: var(--bg-dark);
      color: var(--text-main);
      font-family: var(--font-body);
      user-select: none;
      -webkit-user-select: none;
    }
    * {
      box-sizing: border-box;
      touch-action: none;
      -webkit-tap-highlight-color: transparent;
    }
    button {
      font-family: var(--font-display);
      border: none;
      outline: none;
      cursor: pointer;
    }
  `}</style>;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let audioReadyRef = React.useRef(false);
  let drawSynthRef = React.useRef(null);
  let hitSynthRef = React.useRef(null);
  let successSynthRef = React.useRef(null);
  let [phase, setPhase] = React.useState("idle");
  let [result, setResult] = React.useState(null);
  let pointsRef = React.useRef([]);
  let canvasRef = React.useRef(null);
  let surfaceRef = React.useRef(null);
  let pixelRatio = window.devicePixelRatio || 1;
  let circleRef = React.useRef({
    cx: 0,
    cy: 0,
    r: 100
  });
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
        let config2 = readConfigValues(options);
        if (!config2.TITLE) {
          config2.TITLE = "Cerchio orbitale";
        }
        if (!config2.GUIDE_TEXT) {
          config2.GUIDE_TEXT = "Disegna un cerchio perfetto";
        }
        if (!config2.BTN_RETRY) {
          config2.BTN_RETRY = "Riprova";
        }
        if (!config2.SCORE_PERFECT) {
          config2.SCORE_PERFECT = "Perfetto";
        }
        if (!config2.SCORE_GOOD) {
          config2.SCORE_GOOD = "Bene";
        }
        if (!config2.SCORE_AGAIN) {
          config2.SCORE_AGAIN = "Riprova";
        }
        if (!config2.SCORE_SHORT) {
          config2.SCORE_SHORT = "Troppo breve";
        }
        setConfig(config2);
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  React.useEffect(() => {
    if (!config || !surfaceRef.current || !canvasRef.current) return;
    let value;
    let dimensions = surfaceRef.current;
    let context = dimensions.getContext("2d", {
      alpha: true
    });
    let handleAction = () => {
      let {
        clientWidth: current,
        clientHeight: current2
      } = canvasRef.current;
      if (!(current === 0 || current2 === 0)) {
        dimensions.width = current * pixelRatio;
        dimensions.height = current2 * pixelRatio;
        circleRef.current.cx = current / 2;
        circleRef.current.cy = current2 / 2;
        circleRef.current.r = Math.min(current, current2) * 0.28;
      }
    };
    let resizeObserver = observeGameSize(handleAction);
    resizeObserver.observe(canvasRef.current);
    handleAction();
    let handleAction2 = () => {
      let {
        cx: current,
        cy: current2,
        r: current3
      } = circleRef.current;
      let width = dimensions.width;
      let height = dimensions.height;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      context.scale(pixelRatio, pixelRatio);
      context.beginPath();
      context.arc(current, current2, current3, 0, Math.PI * 2);
      context.strokeStyle = "#789d96";
      context.lineWidth = 4;
      context.setLineDash([12, 12]);
      context.stroke();
      context.setLineDash([]);
      if (phase === "idle") {
        context.beginPath();
        context.arc(current, current2 - current3, 12, 0, Math.PI * 2);
        context.fillStyle = "#d66e4d";
        context.fill();
        context.shadowBlur = 10;
        context.shadowColor = "rgba(255,170,83,0.5)";
        context.fill();
        context.shadowBlur = 0;
      }
      let current4 = pointsRef.current;
      if (current4 && current4.length > 0) {
        context.beginPath();
        context.moveTo(current4[0].x, current4[0].y);
        for (let value2 = 1; value2 < current4.length; value2++) context.lineTo(current4[value2].x, current4[value2].y);
        context.strokeStyle = "#d66e4d";
        context.lineWidth = 6;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.stroke();
      }
      value = requestAnimationFrame(handleAction2);
    };
    value = requestAnimationFrame(handleAction2);
    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(value);
    };
  }, [config, phase, pixelRatio]);
  let initAudio = async () => {
    if (!audioReadyRef.current) try {
      await Tone.start();
      drawSynthRef.current = new Tone.Synth({
        volume: -8
      }).toDestination();
      hitSynthRef.current = new Tone.MembraneSynth({
        volume: -4
      }).toDestination();
      successSynthRef.current = new Tone.PolySynth(Tone.Synth, {
        volume: -8
      }).toDestination();
      audioReadyRef.current = true;
    } catch (value) {
      console.warn("Audio start failed", value);
    }
  };
  let playSound = value => {
    var instrument;
    var instrument2;
    var instrument3;
    if (!audioReadyRef.current) return;
    let timestamp = Tone.now();
    try {
      if (value === "start") {
        if (!((instrument = drawSynthRef.current) == null)) {
          instrument.triggerAttackRelease("C5", "16n", timestamp);
        }
      } else {
        if (value === "short") {
          if (!((instrument2 = hitSynthRef.current) == null)) {
            instrument2.triggerAttackRelease("C2", "8n", timestamp);
          }
        } else {
          if (value === "success") {
            if (!((instrument3 = successSynthRef.current) == null)) {
              instrument3.triggerAttackRelease(["C4", "E4", "G4"], "8n", timestamp);
            }
          }
        }
      }
    } catch {}
  };
  let evaluateCircle = () => {
    let current = pointsRef.current;
    let {
      cx: current2,
      cy: current3,
      r: current4
    } = circleRef.current;
    if (current.length < 15) {
      playSound("short");
      return {
        score: 0,
        msg: config.SCORE_SHORT
      };
    }
    let value = 0;
    for (let value3 = 1; value3 < current.length; value3++) {
      let value4 = current[value3 - 1].x - current2;
      let value5 = current[value3 - 1].y - current3;
      let value6 = current[value3].x - current2;
      let value7 = current[value3].y - current3;
      let value8 = Math.atan2(value5, value4);
      let value9 = Math.atan2(value7, value6) - value8;
      for (; value9 > Math.PI;) value9 -= Math.PI * 2;
      for (; value9 < -Math.PI;) value9 += Math.PI * 2;
      value += Math.abs(value9);
    }
    if (value < Math.PI * 1.5) {
      playSound("short");
      return {
        score: 0,
        msg: config.SCORE_SHORT
      };
    }
    let value2 = 0;
    for (let value3 = 0; value3 < current.length; value3++) {
      let value4 = current[value3].x - current2;
      let value5 = current[value3].y - current3;
      let value6 = Math.sqrt(value4 * value4 + value5 * value5);
      let value7 = Math.abs(value6 - current4) / current4;
      value2 += value7;
    }
    let score = 100 - value2 / current.length * 200;
    score = Math.max(0, Math.min(100, Math.floor(score)));
    playSound("success");
    return score >= 90 ? {
      score: score,
      msg: config.SCORE_PERFECT
    } : score >= 70 ? {
      score: score,
      msg: config.SCORE_GOOD
    } : {
      score: score,
      msg: config.SCORE_AGAIN
    };
  };
  let startDrawing = event => {
    if (event.isPrimary === false || event.button > 0 || phase !== "idle") return;
    void initAudio();
    let {
      left: bounds,
      top: bounds2
    } = surfaceRef.current.getBoundingClientRect();
    let value = event.clientX - bounds;
    let value2 = event.clientY - bounds2;
    let {
      cx: current,
      cy: current2,
      r: current3
    } = circleRef.current;
    let value3 = current;
    let value4 = current2 - current3;
    if (Math.sqrt((value - value3) ** 2 + (value2 - value4) ** 2) < 50) {
      pointsRef.current = [{
        x: value,
        y: value2
      }];
      setPhase("drawing");
      playSound("start");
    }
  };
  let continueDrawing = event => {
    if (event.isPrimary === false || phase !== "drawing") return;
    let {
      left: bounds,
      top: bounds2
    } = surfaceRef.current.getBoundingClientRect();
    let value = event.clientX - bounds;
    let value2 = event.clientY - bounds2;
    pointsRef.current.push({
      x: value,
      y: value2
    });
  };
  let finishDrawing = event => {
    if (event.isPrimary === false || phase !== "drawing") return;
    let {
      left: bounds,
      top: bounds2
    } = surfaceRef.current.getBoundingClientRect();
    let value = event.clientX - bounds;
    let value2 = event.clientY - bounds2;
    pointsRef.current.push({
      x: value,
      y: value2
    });
    let value3 = evaluateCircle();
    setResult(value3);
    setPhase("over");
  };
  let resetDrawing = () => {
    pointsRef.current = [];
    setResult(null);
    setPhase("idle");
  };
  let {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: submitRecording
  } = useRecordingSubmission();
  return config ? <div style={{
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    padding: "clamp(16px, 4vh, 32px)",
    containerType: "size"
  }}>{<GameStyles />}{<div style={{
      flex: "0 0 auto",
      textAlign: "center",
      marginBottom: "clamp(16px, 3vh, 24px)"
    }}>{<h1 style={{
        margin: 0,
        fontSize: "clamp(24px, 7cqi, 32px)",
        fontWeight: 700
      }}>{config.TITLE}</h1>}</div>}{<div style={{
      flex: "1",
      minHeight: 0,
      position: "relative",
      backgroundColor: "var(--surface)",
      borderRadius: "32px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
      overflow: "hidden"
    }} ref={canvasRef}>{<canvas ref={surfaceRef} style={{
        width: "100%",
        height: "100%",
        display: "block",
        touchAction: "none"
      }} onPointerDown={startDrawing} onPointerMove={continueDrawing} onPointerUp={finishDrawing} onPointerCancel={finishDrawing} onPointerOut={finishDrawing} />}{<Motion.AnimatePresence>{(phase === "idle" || phase === "drawing") && <Motion.motion.div initial={{
          opacity: 0,
          y: -10
        }} animate={{
          opacity: 1,
          y: 0
        }} exit={{
          opacity: 0
        }} style={{
          position: "absolute",
          top: "clamp(20px, 4cqi, 32px)",
          left: "20px",
          right: "20px",
          textAlign: "center",
          pointerEvents: "none"
        }}>{<p style={{
            margin: 0,
            fontSize: "18px",
            color: "var(--text-dim)",
            lineHeight: 1.3
          }}>{"Disegna un cerchio"}</p>}</Motion.motion.div>}</Motion.AnimatePresence>}{<Motion.AnimatePresence>{phase === "over" && result && <Motion.motion.div initial={{
          opacity: 0,
          scale: 0.95
        }} animate={{
          opacity: 1,
          scale: 1
        }} exit={{
          opacity: 0
        }} style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(237,245,243,0.97)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)"
        }}>{<div style={{
            textAlign: "center",
            marginBottom: "32px"
          }}>{<div style={{
              fontSize: "clamp(48px, 15cqi, 72px)",
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
              color: "var(--text-main)",
              textShadow: "none"
            }}>{result.score}{"%"}</div>}{<div style={{
              fontSize: "clamp(20px, 5cqi, 28px)",
              color: "var(--primary)",
              marginTop: "8px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "2px"
            }}>{result.msg}</div>}</div>}{<div style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            width: "100%",
            maxWidth: "240px"
          }}>{<button type={"button"} onClick={resetDrawing} style={{
              padding: "16px 24px",
              borderRadius: "100px",
              backgroundColor: "var(--primary)",
              color: "#152C3A",
              fontSize: "16px",
              fontWeight: 700,
              boxShadow: "0 4px 16px rgba(255,170,83,0.25)",
              transition: "transform 0.1s"
            }} onPointerDown={event => event.currentTarget.style.transform = "scale(0.95)"} onPointerUp={event => event.currentTarget.style.transform = "scale(1)"} onPointerCancel={event => event.currentTarget.style.transform = "scale(1)"}>{config.BTN_RETRY}</button>}{canSubmit && <button type={"button"} disabled={submitting} onClick={submitRecording} style={{
              padding: "16px 24px",
              borderRadius: "100px",
              backgroundColor: "#ffffff",
              color: "#164239",
              fontSize: "16px",
              fontWeight: 700,
              opacity: submitting ? 0.7 : 1,
              border: "1px solid #438579"
            }}>{"Condividi"}</button>}</div>}</Motion.motion.div>}</Motion.AnimatePresence>}</div>}</div> : <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "var(--bg-dark)"
  }} />;
}

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
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

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

// ./fyp-meeting.js
/* Game-owned opening adaptation; never dispatches gameplay input or writes scores. */
(() => {
  'use strict';

  const game = Number({
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "15"
      }[name] ?? null;
    },
    dataset: {
      game: "15"
    }
  }?.dataset.game);
  const html = document.documentElement;
  const hosted = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
  html.dataset.meetingGame = String(game);
  html.dataset.meetingFyp = hosted ? 'preview' : 'direct';
  let active = !hosted;
  let guideUsed = false;
  let guide = null;
  let demo = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const resetIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></svg>';
  const mark = (value, name) => {
    value?.classList.add(name);
    return value;
  };
  function addGuide(container, text) {
    if (!guide) {
      guide = document.createElement('p');
      guide.className = 'meeting-guide';
      guide.textContent = text;
      container.append(guide);
    }
    return guide;
  }
  function attach() {
    const value = document.querySelector('#root>div');
    if (!value) return;
    const canvas = value.querySelector('canvas');
    if (game === 15 && canvas) {
      mark(canvas.parentElement, 'meeting-orbital-board');
      mark(value.querySelector('h1')?.parentElement, 'meeting-orbital-heading');
    }
    if (game === 16) {
      const counter = value.querySelector("[aria-label^=\"Livello \"]");
      if (counter) {
        mark(counter.parentElement, 'meeting-sand-hud');
        const balls = counter.nextElementSibling;
        if (balls) {
          mark(balls, 'meeting-sand-ball-count');
          balls.querySelector('small')?.remove();
        }
      }
      const reset = [...value.querySelectorAll('button')].find(item => item.textContent.trim() === "RICOMINCIA" || item.classList.contains('meeting-sand-reset'));
      if (reset && !reset.classList.contains('meeting-sand-reset')) {
        reset.setAttribute('aria-label', "Ricomincia il livello");
        reset.title = "Ricomincia il livello";
        mark(reset, 'meeting-sand-reset');
        mark(reset.parentElement, 'meeting-sand-reset-wrap');
        reset.innerHTML = resetIcon;
      }
    }
    if (game === 19 && canvas) {
      mark(value.children[1], 'meeting-cube-heading');
      mark(canvas.parentElement, 'meeting-cube-board');
    }
    if (game === 17) {
      const replay = value.querySelector('.btn-neon');
      if (replay) mark(replay.parentElement.parentElement, 'meeting-synth-result');
    }
    if (game === 32 && canvas) {
      mark(canvas.parentElement.parentElement, 'meeting-peeler-board');
      const hint = [...value.querySelectorAll('p')].find(item => item.textContent === "Tocca per sbucciare");
      mark(hint?.parentElement, 'meeting-peeler-guide');
    }
    if (game === 35 && canvas) {
      addGuide(value, "Tocca il tasto scuro in basso");
      const value2 = [...value.children].find(item => item.tagName === 'DIV' && item.textContent.trim() === '0');
      if (value2) mark(value2, 'meeting-piano-hud');
      guide.hidden = !!value.querySelector('button') || [...value.querySelectorAll('div')].some(item => item.classList.contains('meeting-piano-hud') && Number(item.textContent) > 0);
    }
    if (game === 40 && canvas) {
      mark(value.querySelector('.hide-scrollbar'), 'meeting-pixel-palette');
      const clear = [...value.querySelectorAll('button')].find(item => item.textContent === "Cancella");
      mark(clear?.parentElement, 'meeting-pixel-clear');
      const label = [...value.children].find(item => item.tagName === 'DIV' && !item.querySelector('canvas,button') && item.textContent === "Sabbia");
      mark(label, 'meeting-pixel-label');
      addGuide(value, "Scegli un materiale e trascina per versarlo");
    }
    if (game === 41) {
      const shell = value.querySelector('header')?.parentElement;
      mark(shell, 'meeting-chat-shell');
    }
    // No.45's real knife renderer supplies its decorative, non-scoring preview.
    sync();
  }
  function sync() {
    if (demo) demo.hidden = !hosted || active;
    if (game === 40 && guide) guide.hidden = active && guideUsed;
    html.toggleAttribute('data-meeting-inactive', document.hidden);
  }
  const observer = new MutationObserver(attach);
  const root = document.getElementById('root');
  if (root) observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true
  });
  attach();
  // Real game input hides only the new Pixel Sandbox instruction; palette taps do not count.
  document.addEventListener('pointerdown', event => {
    if (game === 40 && active && event.isPrimary !== false && event.button <= 0 && event.target.tagName === 'CANVAS' && guide) {
      guideUsed = true;
      guide.hidden = true;
    }
  }, {
    capture: true
  });
  addEventListener('message', event => {
    if (!hosted || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
    html.dataset.meetingFyp = active ? 'playing' : 'preview';
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener?.('change', sync);
  addEventListener('pagehide', () => {
    observer.disconnect();
  }, {
    once: true
  });
})();

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [".meeting-orbital-board>div:has(>p)>p"];
  const copy = new Set(["Disegna un cerchio perfetto"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
