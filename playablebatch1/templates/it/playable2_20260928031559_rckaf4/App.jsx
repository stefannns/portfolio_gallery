// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
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
    "id": "SPEED_BASE_FRAC",
    "kind": "number",
    "label": "Initial Speed",
    "value": 0.0006,
    "default": 0.0006,
    "min": 0.0002,
    "max": 0.0015,
    "step": 0.0001
  }, {
    "id": "SPEED_INC_FRAC",
    "kind": "number",
    "label": "Speed Increment",
    "value": 0.000015,
    "default": 0.000015,
    "min": 0.000001,
    "max": 0.00005,
    "step": 0.000001
  }],
  "texts": [{
    "id": "TXT_GAME_OVER",
    "label": "Game Over Text",
    "value": "PARTITA FINITA",
    "default": "PARTITA FINITA",
    "max_length": 20
  }, {
    "id": "BTN_RESTART",
    "label": "Restart Button",
    "value": "TOCCA PER RIPROVARE",
    "default": "TOCCA PER RIPROVARE",
    "max_length": 20
  }],
  "images": [{
    "id": "UI_KEYBOARD",
    "label": "Keyboard Watermark",
    "path": "./assets/ui_piano_keyboard.webp",
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
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.meeting-guide{position:fixed!important;top:30%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(p.meeting-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(p.meeting-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(p.meeting-guide){animation:none!important}}

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
var PIANO_MELODY = ["C4", "C4", "G4", "G4", "A4", "A4", "G4", "F4", "F4", "E4", "E4", "D4", "D4", "C4", "G4", "G4", "F4", "F4", "E4", "E4", "D4", "G4", "G4", "F4", "F4", "E4", "E4", "D4"];
var pianoStyles = {
  container: {
    position: "relative",
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: "#fff",
    containerType: "size"
  },
  watermark: {
    position: "absolute",
    bottom: 0,
    left: "12vw",
    width: "76vw",
    aspectRatio: "76 / 37",
    objectFit: "contain",
    opacity: 0.1,
    pointerEvents: "none",
    zIndex: 1
  },
  canvas: {
    position: "absolute",
    inset: 0,
    display: "block",
    zIndex: 2,
    touchAction: "none",
    cursor: "pointer"
  },
  hud: {
    position: "absolute",
    top: "calc(30px + env(safe-area-inset-top, 0px))",
    left: 30,
    right: 30,
    display: "flex",
    justifyContent: "center",
    pointerEvents: "none",
    zIndex: 10
  },
  scoreNumber: {
    fontFamily: "var(--font-mono)",
    fontSize: "28px",
    fontWeight: 700,
    color: "#2478cc",
    textShadow: "0 2px 8px rgba(255,255,255,0.8), 0 0 2px #fff",
    lineHeight: 1
  },
  overlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(255, 255, 255, 0.75)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20
  },
  modal: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "32px 24px",
    backgroundColor: "#111",
    borderRadius: "24px",
    boxShadow: "0 16px 32px rgba(0,0,0,0.2)",
    width: "85%",
    maxWidth: "400px"
  },
  modalTitle: {
    fontFamily: "var(--font-display)",
    fontSize: "clamp(24px, 6cqi, 36px)",
    fontWeight: 700,
    color: "#fff",
    margin: "0 0 16px 0",
    textAlign: "center"
  },
  modalScore: {
    fontFamily: "var(--font-mono)",
    fontSize: "clamp(48px, 12cqi, 80px)",
    fontWeight: 700,
    color: "#2478cc",
    margin: "0 0 32px 0",
    lineHeight: 1
  },
  btnGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    width: "100%"
  },
  btnPrimary: {
    fontFamily: "var(--font-body)",
    fontSize: "16px",
    fontWeight: 700,
    color: "#111",
    backgroundColor: "#fff",
    border: "none",
    borderRadius: "12px",
    padding: "16px 24px",
    width: "100%",
    cursor: "pointer",
    touchAction: "manipulation"
  },
  btnSecondary: {
    fontFamily: "var(--font-body)",
    fontSize: "16px",
    fontWeight: 700,
    color: "#fff",
    backgroundColor: "transparent",
    border: "2px solid rgba(255,255,255,0.2)",
    borderRadius: "12px",
    padding: "16px 24px",
    width: "100%",
    cursor: "pointer",
    touchAction: "manipulation"
  }
};
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
function RecordingButton() {
  let {
    canSubmit: value,
    submitting: value2,
    submitRecording: handleClick
  } = useRecordingSubmission();
  return value ? <button type={"button"} disabled={value2} onClick={handleClick} style={pianoStyles.btnSecondary}>{"CONDIVIDI"}</button> : null;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("idle");
  let [score, setScore] = React.useState(0);
  let surfaceRef = React.useRef(null);
  let canvasRef = React.useRef(null);
  let animationRef = React.useRef(null);
  let audioReadyRef = React.useRef(false);
  let pianoSynthRef = React.useRef(null);
  let missSynthRef = React.useRef(null);
  let gameRef = React.useRef({
    state: "idle",
    score: 0,
    offsetY: 0,
    targetRow: 0,
    maxRow: 5,
    tiles: [],
    lastTime: 0,
    width: 0,
    height: 0
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
        setConfig(readConfigValues(options));
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  let resetPiano = React.useCallback(() => {
    let current = gameRef.current;
    current.state = "idle";
    current.score = 0;
    current.offsetY = 0;
    current.targetRow = 0;
    current.maxRow = 6;
    current.tiles = Array.from({
      length: 7
    }, (value, otherValue) => ({
      row: otherValue,
      col: Math.floor(Math.random() * 4),
      clicked: false,
      error: false
    }));
    current.lastTime = 0;
  }, []);
  let finishGame = React.useCallback(() => {
    gameRef.current.state = "over";
    setPhase("over");
    if (missSynthRef.current) {
      missSynthRef.current.triggerAttackRelease("C2", "8n", Tone.now());
    }
  }, []);
  let drawPiano = React.useCallback(() => {
    let canvas = canvasRef.current;
    let dimensions = gameRef.current;
    if (!canvas || dimensions.width === 0) return;
    let context = canvas.getContext("2d", {
      alpha: false
    });
    let width = dimensions.width;
    let height = dimensions.height;
    let value = height / 4;
    let value2 = width / 4;
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#E0E0E0";
    context.lineWidth = 1;
    for (let value3 = 1; value3 < 4; value3++) {
      context.beginPath();
      context.moveTo(value3 * value2, 0);
      context.lineTo(value3 * value2, height);
      context.stroke();
    }
    dimensions.tiles.forEach(item => {
      let value3 = height - (item.row + 1) * value + dimensions.offsetY;
      if (!(value3 > height || value3 + value < 0)) {
        if (item.error) {
          context.fillStyle = "#F44336";
        } else {
          if (item.clicked) {
            context.fillStyle = "rgba(0, 0, 0, 0.15)";
          } else {
            context.fillStyle = "#111111";
          }
        }
        context.fillRect(item.col * value2, value3, value2, value);
      }
    });
  }, []);
  let animatePiano = React.useCallback(value => {
    let current = gameRef.current;
    if (!current.lastTime) {
      current.lastTime = value;
    }
    let value2 = Math.min(value - current.lastTime, 100);
    if (current.lastTime = value, current.state === "playing") {
      let value3 = current.height / 4;
      let value4 = current.height * ((config == null ? void 0 : config.SPEED_BASE_FRAC) || 0.0005);
      let value5 = current.height * ((config == null ? void 0 : config.SPEED_INC_FRAC) || 0.00001);
      let value6 = value4 + current.score * value5;
      if (current.offsetY += value6 * value2, current.offsetY >= (current.targetRow + 1) * value3) {
        let value7 = current.tiles.find(item => item.row === current.targetRow);
        if (value7) {
          value7.error = true;
        }
        finishGame();
      } else {
        let handleAction = value7 => value7 - (current.maxRow + 1) * value3 + current.offsetY > -value3;
        for (; handleAction(current.height);) {
          current.maxRow++;
          current.tiles.push({
            row: current.maxRow,
            col: Math.floor(Math.random() * 4),
            clicked: false,
            error: false
          });
        }
        current.tiles = current.tiles.filter(item => item.row >= current.targetRow - 1);
      }
    }
    drawPiano();
    animationRef.current = requestAnimationFrame(animatePiano);
  }, [config, finishGame, drawPiano]);
  let handlePianoTap = React.useCallback(async event => {
    let dimensions = gameRef.current;
    if (dimensions.state === "over") return;
    if (audioReadyRef.current) {
      audioReadyRef.current = true;
    }
    if (!audioReadyRef.current) try {
      await Tone.start();
      pianoSynthRef.current = new Tone.PolySynth(Tone.Synth).toDestination();
      pianoSynthRef.current.volume.value = -6;
      missSynthRef.current = new Tone.MembraneSynth().toDestination();
      missSynthRef.current.volume.value = -4;
      audioReadyRef.current = true;
    } catch {
      audioReadyRef.current = true;
    }
    let value = dimensions.width / 4;
    let bounds = canvasRef.current.getBoundingClientRect();
    let value2 = event.clientX - bounds.left;
    let value3 = Math.floor(value2 / value);
    let value4 = dimensions.tiles.find(item => item.row === dimensions.targetRow);
    if (value4) if (value3 === value4.col && event.clientY - bounds.top >= dimensions.height - (dimensions.targetRow + 1) * (dimensions.height / 4) + dimensions.offsetY && event.clientY - bounds.top < dimensions.height - dimensions.targetRow * (dimensions.height / 4) + dimensions.offsetY) {
      if (value4.clicked = true, dimensions.targetRow++, dimensions.score++, setScore(dimensions.score), pianoSynthRef.current) {
        let item = PIANO_MELODY[(dimensions.score - 1) % PIANO_MELODY.length];
        pianoSynthRef.current.triggerAttackRelease(item, "8n", Tone.now());
      }
      if (dimensions.state === "idle") {
        dimensions.state = "playing";
        setPhase("playing");
        dimensions.lastTime = performance.now();
      }
    } else {
      dimensions.tiles.push({
        row: dimensions.targetRow,
        col: value3,
        clicked: false,
        error: true
      });
      finishGame();
    }
  }, [finishGame]);
  let restartPiano = React.useCallback(() => {
    resetPiano();
    setScore(0);
    setPhase("idle");
    drawPiano();
  }, [resetPiano, drawPiano]);
  if (React.useEffect(() => {
    if (!config || !surfaceRef.current || !canvasRef.current) return;
    let resizeObserver = observeGameSize(value => {
      let {
        width: contentRect,
        height: contentRect2
      } = value[0].contentRect;
      if (contentRect <= 0 || contentRect2 <= 0) return;
      let dimensions = gameRef.current;
      let value2 = window.devicePixelRatio || 1;
      dimensions.width = contentRect;
      dimensions.height = contentRect2;
      let dimensions2 = canvasRef.current;
      dimensions2.width = contentRect * value2;
      dimensions2.height = contentRect2 * value2;
      dimensions2.style.width = `${contentRect}px`;
      dimensions2.style.height = `${contentRect2}px`;
      dimensions2.getContext("2d").setTransform(value2, 0, 0, value2, 0, 0);
      drawPiano();
    });
    resizeObserver.observe(surfaceRef.current);
    resetPiano();
    animationRef.current = requestAnimationFrame(animatePiano);
    return () => {
      resizeObserver.disconnect();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [config, resetPiano, animatePiano, drawPiano]), !config) return <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#fff"
  }} />;
  let isGameOver = phase === "over";
  return <div ref={surfaceRef} style={pianoStyles.container}>{<style>{`
        html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: #FFF; }
        * { box-sizing: border-box; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
        @font-face {
          font-family: 'Poppins';
          src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');
          font-weight: 400; font-style: normal; font-display: swap;
        }
        @font-face {
          font-family: 'Poppins';
          src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');
          font-weight: 700; font-style: normal; font-display: swap;
        }
        :root {
          --font-display: "Poppins", "PingFang SC", system-ui, sans-serif;
          --font-body: "Poppins", "PingFang SC", system-ui, sans-serif;
          --font-mono: ui-monospace, Menlo, monospace;
        }
      `}</style>}{<img src={config.UI_KEYBOARD} alt={"keyboard watermark"} style={pianoStyles.watermark} draggable={false} />}{<canvas ref={canvasRef} style={pianoStyles.canvas} onClick={handlePianoTap} />}{<div style={pianoStyles.hud}>{<div style={pianoStyles.scoreNumber}>{score}</div>}</div>}{isGameOver && <div style={pianoStyles.overlay}>{<div style={pianoStyles.modal}>{<h1 style={pianoStyles.modalTitle}>{config.TXT_GAME_OVER}</h1>}{<div style={pianoStyles.modalScore}>{score}</div>}{<div style={pianoStyles.btnGroup}>{<button style={pianoStyles.btnPrimary} onClick={restartPiano}>{config.BTN_RESTART}</button>}{<RecordingButton />}</div>}</div>}</div>}</div>;
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
        "data-game": "35"
      }[name] ?? null;
    },
    dataset: {
      game: "35"
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
  const selectors = ["p.meeting-guide"];
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
