// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import Matter from 'matter-js';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "BALL_COUNT",
    "kind": "number",
    "label": "Ball Count",
    "value": 112,
    "default": 112,
    "min": 50,
    "max": 200,
    "step": 1
  }, {
    "id": "GRAVITY_Y",
    "kind": "number",
    "label": "Gravity",
    "value": 1.2,
    "default": 1.2,
    "min": 0.5,
    "max": 2.5,
    "step": 0.1
  }, {
    "id": "DIG_RADIUS",
    "kind": "number",
    "label": "Dig Brush Size",
    "value": 26,
    "default": 26,
    "min": 20,
    "max": 60,
    "step": 1
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "Scava nella sabbia",
    "default": "Scava nella sabbia",
    "max_length": 20
  }, {
    "id": "LEVEL_TEXT",
    "label": "Level Prefix",
    "value": "LIVELLO",
    "default": "LIVELLO",
    "max_length": 10
  }, {
    "id": "WIN_TEXT",
    "label": "Win Message",
    "value": "LIVELLO SUPERATO!",
    "default": "LIVELLO SUPERATO!",
    "max_length": 25
  }, {
    "id": "BTN_RESET",
    "label": "Reset Button",
    "value": "RICOMINCIA",
    "default": "RICOMINCIA",
    "max_length": 15
  }, {
    "id": "BTN_PLAY_AGAIN",
    "label": "Play Again Button",
    "value": "RIGIOCA",
    "default": "RIGIOCA",
    "max_length": 20
  }, {
    "id": "BTN_POST",
    "label": "Post My Play Button",
    "value": "CONDIVIDI",
    "default": "CONDIVIDI",
    "max_length": 20
  }],
  "images": [{
    "id": "SAND_DECO",
    "label": "Sand Decoration",
    "path": "./assets/media2_20260927020936_pzpo8p00.webp",
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
    body { background: #FFF4E9; -webkit-tap-highlight-color: transparent; }
    button { min-height: 44px; }
  

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

/* Requested game UI only. Native feed chrome, game coordinates and input are unchanged. */
html[data-meeting-game="16"] .meeting-sand-ball-count{
  flex-direction:row!important;
  align-items:baseline!important;
  gap:8px!important;
}
html[data-meeting-game="16"] .meeting-sand-ball-count>small{order:1}


/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .meeting-sand-guide{position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root #root{--sand-scene-top:0px;background:#FFF4E9!important}
html:root:root #root>div{top:var(--sand-scene-top)!important;height:calc(100% - var(--sand-scene-top))!important;background:#FFF4E9!important}
html:root:root #root .meeting-sand-hud{position:fixed!important;top:30px!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.meeting-sand-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.meeting-sand-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.meeting-sand-guide){animation:none!important}}

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
            console.error("[post_my_play] failed", value && (value.errMsg || value.message));
            setSubmitting(false);
          },
          complete() {}
        });
      }
    }
  };
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
var SAND_COLOR = "#EDB58F";
function sandSceneLayout(width, height, level) {
  level = level === 1 ? 3 : level === 3 ? 1 : level;
  // Cap the puzzle geometry at the authored 390 × 598 proportions on tall hosts.
  const layoutHeight = Math.min(height, width * 598 / 390);
  const topOffset = Math.max(0, layoutHeight * 0.24 - 2);
  const referenceHeight = layoutHeight - topOffset;
  const placeY = ratio => topOffset + referenceHeight * ratio;
  const baseSize = Math.min(width * 0.34, referenceHeight * 0.2);
  const pocketRadius = baseSize * 0.66;
  const originalPocket = topOffset + Math.max(baseSize + 48, referenceHeight * 0.26) - 24;
  return {
    layoutLevel: level,
    baseSize,
    pocketY: originalPocket - (level < 3 ? layoutHeight * 0.14 : 0),
    pocketRadius,
    sandBottom: placeY(0.64),
    goalY: placeY(0.88),
    goalHeight: referenceHeight * 0.1,
    obstacleThickness: Math.max(18, Math.min(28, referenceHeight * 0.045)),
    blocks: level === 1 ? [[width / 2, placeY(0.54) - 24 - layoutHeight * 0.1]] : [[width * 0.37, placeY(0.46) - 16 - layoutHeight * 0.11], [width * 0.63, placeY(0.57) - 16 - layoutHeight * 0.06]],
    curves: [[width * 0.36, placeY(0.455) - 2, width * 0.12, -Math.min(22, referenceHeight * 0.03)], [width * 0.64, placeY(0.54) - 6, width * 0.12, -Math.min(14, referenceHeight * 0.02)], [width * 0.5, placeY(0.61) - 6, width * 0.12, -Math.min(14, referenceHeight * 0.02)]]
  };
}
var TRAY_COLOR = "#215E60";
function sandCavityCells(width, bottom, argument3, argument4, radius) {
  const cells = [];
  const tile = 15;
  const detail = 2;
  const handleAction = (x, y, argument32, argument42) => cells.push(Matter.Bodies.rectangle(x, y, argument32, argument42, {
    isStatic: true,
    label: "sand",
    render: {
      visible: false
    }
  }));
  for (let value = 0; value < bottom; value += tile) for (let left = 0; left < width; left += tile) {
    const value2 = Math.min(tile, width - left);
    const value3 = Math.min(tile, bottom - value);
    const x = left + value2 / 2;
    const y = value + value3 / 2;
    const near = Math.hypot(Math.max(Math.abs(x - argument3) - value2 / 2, 0), Math.max(Math.abs(y - argument4) - value3 / 2, 0));
    const value4 = Math.hypot(Math.abs(x - argument3) + value2 / 2, Math.abs(y - argument4) + value3 / 2);
    if (near >= radius) {
      handleAction(x, y, value2, value3);
      continue;
    }
    if (value4 <= radius) continue;
    const columns = Math.ceil(value2 / detail);
    const rows = Math.ceil(value3 / detail);
    const value5 = value2 / columns;
    const value6 = value3 / rows;
    for (let value7 = 0; value7 < rows; value7++) for (let value8 = 0; value8 < columns; value8++) {
      const value9 = left + (value8 + 0.5) * value5;
      const value10 = value + (value7 + 0.5) * value6;
      if (Math.hypot(Math.abs(value9 - argument3) + value5 / 2, Math.abs(value10 - argument4) + value6 / 2) >= radius) handleAction(value9, value10, value5, value6);
    }
  }
  return cells;
}
function sandBallSeeds(value, otherValue, holeRadius, count, initialRadius) {
  let radius = initialRadius;
  let seeds = [];
  for (let value2 = 0; value2 < 30; value2++) {
    seeds = [];
    const spacing = radius * 2.15;
    const rowHeight = spacing * Math.sqrt(3) / 2;
    const limit = holeRadius - radius - 4;
    let value3 = 0;
    for (let y = -limit; y <= limit; y += rowHeight) {
      const offset = value3++ % 2 ? spacing / 2 : 0;
      for (let x = -limit; x <= limit; x += spacing) if (Math.hypot(x + offset, y) <= limit) seeds.push({
        x: value + x + offset,
        y: otherValue + y
      });
    }
    if (seeds.length >= count) break;
    radius *= 0.92;
  }
  return {
    radius,
    seeds
  };
}
var BALL_COLORS = ["#BC355F", "#355EB1", "#1D7062", "#7B4CAC"];
function vibrate(style = "light") {
  try {
    if (typeof window !== "undefined" && window.tt && window.tt.vibrate) {
      window.tt.vibrate({
        style: style
      });
    }
  } catch {}
}
var RESULT_BACKGROUND = "#FFF4E9";
function App() {
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("playing");
  let [collectedBalls, setCollectedBalls] = React.useState(0);
  let [totalBalls, setTotalBalls] = React.useState(0);
  let [level, setLevel] = React.useState(1);
  let sceneRef = React.useRef(null);
  let engineRef = React.useRef(null);
  let canvasHostRef = React.useRef(null);
  let digSurfaceRef = React.useRef(null);
  let ballBodiesRef = React.useRef(null);
  let sandBodiesRef = React.useRef([]);
  let audioRef = React.useRef({
    synth: null,
    ready: false
  });
  let runCleanup = React.useRef(null);
  let activePointer = React.useRef(null);
  let lastDig = React.useRef(null);
  let {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: submitRecording
  } = useRecordingSubmission();
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
  let initAudio = async () => {
    if (!audioRef.current.ready) try {
      await Tone.start();
      let value = new Tone.PolySynth(Tone.Synth).toDestination();
      value.volume.value = -10;
      audioRef.current.synth = value;
      audioRef.current.ready = true;
    } catch {}
  };
  let playSound = value => {
    let {
      synth: instrument,
      ready: current
    } = audioRef.current;
    if (!current || !instrument) return;
    let timestamp = Tone.now();
    if (value === "pop") {
      instrument.triggerAttackRelease("C5", "32n", timestamp);
    } else {
      if (value === "win") {
        instrument.triggerAttackRelease(["C4", "E4", "G4", "C5"], "4n", timestamp);
      }
    }
  };
  let resetScene = React.useCallback(() => {
    if (!config || !sceneRef.current) return;
    sceneRef.current.setAttribute("data-sand-guide-used", "false");
    if (runCleanup.current) {
      runCleanup.current();
    }
    activePointer.current = null;
    lastDig.current = null;
    setPhase("playing");
    setCollectedBalls(0);
    let value = config.BALL_COUNT || 100;
    setTotalBalls(Math.min(value, 100));
    let clientWidth = sceneRef.current.clientWidth;
    let clientHeight = sceneRef.current.clientHeight;
    let value2 = window.devicePixelRatio || 1;
    [engineRef.current, canvasHostRef.current].forEach(dimensions => {
      if (!dimensions) return;
      dimensions.width = clientWidth * value2;
      dimensions.height = clientHeight * value2;
      dimensions.style.width = `${clientWidth}px`;
      dimensions.style.height = `${clientHeight}px`;
      dimensions.getContext("2d").setTransform(value2, 0, 0, value2, 0, 0);
    });
    let context = engineRef.current.getContext("2d");
    context.clearRect(0, 0, clientWidth, clientHeight);
    context.globalCompositeOperation = "source-over";
    context.fillStyle = SAND_COLOR;
    let scene = sandSceneLayout(clientWidth, clientHeight, level);
    let baseSize = scene.baseSize;
    let pocketY = scene.pocketY;
    let pocketRadius = scene.pocketRadius;
    let sandBottom = scene.sandBottom;
    context.fillRect(0, 0, clientWidth, sandBottom);
    context.globalCompositeOperation = "destination-out";
    context.beginPath();
    context.arc(clientWidth / 2, pocketY, pocketRadius, 0, Math.PI * 2);
    context.fill();
    context.globalCompositeOperation = "source-over";
    if (digSurfaceRef.current) {
      Matter.Engine.clear(digSurfaceRef.current);
      Matter.World.clear(digSurfaceRef.current.world);
      if (ballBodiesRef.current) {
        Matter.Render.stop(ballBodiesRef.current);
      }
    }
    let value3 = Matter.Engine.create();
    value3.gravity.y = config.GRAVITY_Y || 1;
    digSurfaceRef.current = value3;
    let options = {
      isStatic: true,
      render: {
        visible: false
      }
    };
    Matter.World.add(value3.world, [Matter.Bodies.rectangle(clientWidth / 2, clientHeight + 50, clientWidth * 2, 100, options), Matter.Bodies.rectangle(-50, clientHeight / 2, 100, clientHeight * 2, options), Matter.Bodies.rectangle(clientWidth + 50, clientHeight / 2, 100, clientHeight * 2, options)]);
    let value4 = clientWidth / 2;
    let goalY = scene.goalY;
    let value5 = clientWidth * 0.4;
    let goalHeight = scene.goalHeight;
    let value6 = 10;
    let options2 = {
      isStatic: true,
      render: {
        fillStyle: TRAY_COLOR
      }
    };
    let value7 = Matter.Bodies.rectangle(value4 - value5 / 2 + value6 / 2, goalY, value6, goalHeight, options2);
    let value8 = Matter.Bodies.rectangle(value4 + value5 / 2 - value6 / 2, goalY, value6, goalHeight, options2);
    let value9 = Matter.Bodies.rectangle(value4, goalY + goalHeight / 2 - value6 / 2, value5, value6, options2);
    let value10 = Matter.Bodies.rectangle(value4, goalY, value5 - value6 * 2, goalHeight - value6, {
      isStatic: true,
      isSensor: true,
      label: "goalSensor",
      render: {
        visible: false
      }
    });
    Matter.World.add(value3.world, [value7, value8, value9, value10]);
    sandBodiesRef.current = [];
    sandBodiesRef.current = sandCavityCells(clientWidth, sandBottom, clientWidth / 2, pocketY, pocketRadius);
    Matter.World.add(value3.world, sandBodiesRef.current);
    {
      const obstacleOptions = {
        isStatic: true,
        label: "obstacle",
        friction: 0.2,
        restitution: 0.25,
        render: {
          fillStyle: "#614763"
        }
      };
      const thickness = scene.obstacleThickness;
      if (scene.layoutLevel < 3) {
        const obstacleLayout = scene.blocks;
        for (const [blockX, blockY] of obstacleLayout) {
          const centerBlock = Matter.Bodies.rectangle(blockX, blockY, scene.layoutLevel === 1 ? Math.min(clientWidth * 0.25, 104) : Math.min(clientWidth * 0.34, 146), thickness, {
            ...obstacleOptions,
            chamfer: {
              radius: 4
            }
          });
          Matter.World.add(value3.world, centerBlock);
        }
      } else {
        const curveLayouts = scene.curves;
        const curveThickness = Math.min(16, thickness);
        for (const [centerX, centerY, span, bend] of curveLayouts) {
          const points = [];
          const parts = [];
          const steps = 16;
          for (let step = 0; step <= steps; step++) {
            const ratio = step / steps;
            points.push({
              x: centerX - span / 2 + span * ratio,
              y: centerY + bend * Math.sin(Math.PI * ratio)
            });
          }
          for (let step = 0; step < steps; step++) {
            const from = points[step];
            const point = points[step + 1];
            const value12 = point.x - from.x;
            const value13 = point.y - from.y;
            parts.push(Matter.Bodies.rectangle((from.x + point.x) / 2, (from.y + point.y) / 2, Math.hypot(value12, value13), curveThickness, {
              ...obstacleOptions,
              angle: Math.atan2(value13, value12)
            }));
          }
          for (const point of points) parts.push(Matter.Bodies.circle(point.x, point.y, curveThickness / 2, obstacleOptions, 16));
          const curvedBlock = Matter.Body.create({
            ...obstacleOptions,
            parts
          });
          curvedBlock.isCurvedObstacle = true;
          Matter.World.add(value3.world, curvedBlock);
        }
      }
    }
    let items = [];
    let packing = sandBallSeeds(clientWidth / 2, pocketY, pocketRadius, value, Math.max(4, Math.min(6, baseSize / 30)));
    let radius = packing.radius;
    let seeds = packing.seeds;
    for (let value12 = seeds.length - 1; value12 > 0; value12--) {
      let value13 = Math.floor(Math.random() * (value12 + 1));
      [seeds[value12], seeds[value13]] = [seeds[value13], seeds[value12]];
    }
    for (let value12 = 0; value12 < value; value12++) {
      let point = seeds[value12];
      let fillStyle = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)];
      items.push(Matter.Bodies.circle(point.x, point.y, radius, {
        restitution: 0.45,
        friction: 0.05,
        frictionAir: 0.01,
        density: 0.04,
        label: "ball",
        render: {
          fillStyle: fillStyle
        }
      }));
    }
    Matter.World.add(value3.world, items);
    Matter.Events.on(value3, "collisionStart", value12 => {
      value12.pairs.forEach(item => {
        let {
          bodyA: value13,
          bodyB: value14
        } = item;
        let value15 = value13.label === "goalSensor" || value14.label === "goalSensor";
        let value16 = value13.label === "ball" ? value13 : value14.label === "ball" ? value14 : null;
        if (value15 && value16 && !value16.isCollected) {
          value16.isCollected = true;
          Matter.Body.scale(value16, 0.5, 0.5);
          setTimeout(() => {
            if (digSurfaceRef.current === value3) {
              Matter.Composite.remove(value3.world, value16);
            }
          }, 100);
          setCollectedBalls(value17 => value17 + 1);
          playSound("pop");
          vibrate("light");
        }
      });
    });
    let value11;
    let context2 = canvasHostRef.current.getContext("2d");
    let handleAction = () => {
      if (digSurfaceRef.current !== value3) return;
      Matter.Engine.update(digSurfaceRef.current, 1000 / 60);
      context2.clearRect(0, 0, clientWidth, clientHeight);
      let value12 = Matter.Composite.allBodies(digSurfaceRef.current.world);
      context2.beginPath();
      value12.forEach(item => {
        if (!(!item.render.visible || item.label === "sand")) {
          context2.save();
          context2.fillStyle = item.render.fillStyle || "#45344A";
          context2.beginPath();
          item.parts.forEach((item2, index) => {
            if (!(index === 0 && item.parts.length > 1)) {
              context2.moveTo(item2.vertices[0].x, item2.vertices[0].y);
              for (let value13 = 1; value13 < item2.vertices.length; value13++) context2.lineTo(item2.vertices[value13].x, item2.vertices[value13].y);
              context2.lineTo(item2.vertices[0].x, item2.vertices[0].y);
            }
          });
          context2.fill();
          if (item.label === "ball") {
            context2.fillStyle = "rgba(255,255,255,0.3)";
            context2.beginPath();
            context2.arc(item.position.x - item.circleRadius * 0.3, item.position.y - item.circleRadius * 0.3, item.circleRadius * 0.3, 0, Math.PI * 2);
            context2.fill();
          }
          context2.restore();
        }
      });
      value11 = requestAnimationFrame(handleAction);
    };
    const cleanup = () => {
      cancelAnimationFrame(value11);
      Matter.Events.off(value3);
      Matter.World.clear(value3.world);
      Matter.Engine.clear(value3);
      if (digSurfaceRef.current === value3) {
        digSurfaceRef.current = null;
      }
      if (runCleanup.current === cleanup) {
        runCleanup.current = null;
      }
      activePointer.current = null;
      lastDig.current = null;
    };
    runCleanup.current = cleanup;
    handleAction();
    return cleanup;
  }, [config, level]);
  React.useEffect(() => config ? resetScene() : void 0, [config, resetScene]);
  React.useEffect(() => {
    if (phase === "playing" && totalBalls > 0 && collectedBalls >= totalBalls) {
      setPhase("over");
      playSound("win");
      vibrate("notification_success");
    }
  }, [collectedBalls, totalBalls, phase]);
  let digAtPointer = event => {
    if (phase !== "playing" || !digSurfaceRef.current || event.target?.closest?.("button")) return;
    initAudio();
    event.preventDefault?.();
    let dimensions = sceneRef.current.getBoundingClientRect();
    let value2;
    let value3;
    if (event.touches && event.touches.length > 0) {
      value2 = event.touches[0].clientX;
      value3 = event.touches[0].clientY;
    } else {
      value2 = event.clientX;
      value3 = event.clientY;
    }
    let value4 = (value2 - dimensions.left) * sceneRef.current.clientWidth / dimensions.width;
    let value5 = (value3 - dimensions.top) * sceneRef.current.clientHeight / dimensions.height;
    let value6 = config.DIG_RADIUS || 26;
    let context = engineRef.current.getContext("2d");
    const from = lastDig.current || {
      x: value4,
      y: value5
    };
    const point2 = {
      x: value4,
      y: value5
    };
    const value7 = point2.x - from.x;
    const value8 = point2.y - from.y;
    const length2 = value7 * value7 + value8 * value8;
    lastDig.current = point2;
    context.globalCompositeOperation = "destination-out";
    context.lineWidth = value6 * 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(point2.x, point2.y);
    context.stroke();
    context.beginPath();
    context.arc(point2.x, point2.y, value6, 0, Math.PI * 2);
    context.fill();
    const radius2 = value6 * value6;
    const pointDistance = (x, y) => {
      const ratio = length2 ? Math.max(0, Math.min(1, ((x - from.x) * value7 + (y - from.y) * value8) / length2)) : 0;
      return (x - from.x - value7 * ratio) ** 2 + (y - from.y - value8 * ratio) ** 2;
    };
    const rectangleDistance = (point, bounds) => {
      const x = Math.max(bounds.min.x - point.x, 0, point.x - bounds.max.x);
      const y = Math.max(bounds.min.y - point.y, 0, point.y - bounds.max.y);
      return x * x + y * y;
    };
    const classify = body => {
      const bounds = body.bounds;
      const distances = [pointDistance(bounds.min.x, bounds.min.y), pointDistance(bounds.max.x, bounds.min.y), pointDistance(bounds.max.x, bounds.max.y), pointDistance(bounds.min.x, bounds.max.y)];
      if (distances.every(value => value <= radius2)) return 2;
      return Math.min(...distances, rectangleDistance(from, bounds), rectangleDistance(point2, bounds)) <= radius2 ? 1 : 0;
    };
    const removed = [];
    const added = [];
    const retained = [];
    for (const cell of sandBodiesRef.current) {
      const kind = classify(cell);
      if (!kind) {
        retained.push(cell);
        continue;
      }
      removed.push(cell);
      const width = cell.bounds.max.x - cell.bounds.min.x;
      const height = cell.bounds.max.y - cell.bounds.min.y;
      if (kind === 2 || Math.max(width, height) <= 3.01) continue;
      const columns = Math.ceil(width / 3);
      const rows = Math.ceil(height / 3);
      const cellWidth = width / columns;
      const cellHeight = height / rows;
      for (let value = 0; value < rows; value++) for (let column = 0; column < columns; column++) {
        const piece = Matter.Bodies.rectangle(cell.bounds.min.x + (column + 0.5) * cellWidth, cell.bounds.min.y + (value + 0.5) * cellHeight, cellWidth, cellHeight, {
          isStatic: true,
          label: "sand",
          render: {
            visible: false
          }
        });
        if (!classify(piece)) {
          retained.push(piece);
          added.push(piece);
        }
      }
    }
    if (removed.length) {
      Matter.Composite.remove(digSurfaceRef.current.world, removed);
      sceneRef.current.setAttribute("data-sand-guide-used", "true");
    }
    if (added.length) Matter.World.add(digSurfaceRef.current.world, added);
    sandBodiesRef.current = retained;
  };
  let restartLevel = () => {
    vibrate("light");
    resetScene();
  };
  let advanceLevel = () => {
    vibrate("light");
    if (phase !== "over") return;
    setPhase("transition");
    setLevel(level < 3 ? level + 1 : 1);
  };
  return config ? <React.Fragment>{<style>{`
        @font-face {
          font-family: 'DynaPuff';
          src: url('./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2') format('woff2');
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
        :root {
          --font-display: "DynaPuff", "PingFang SC", system-ui, sans-serif;
          --font-body: "DynaPuff", "PingFang SC", system-ui, sans-serif;
          --font-mono: ui-monospace, Menlo, monospace;
        }
        html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; background: ${RESULT_BACKGROUND}; user-select: none; -webkit-user-select: none; touch-action: none; }
        * { box-sizing: border-box; }
        

        /* The result covers the entire game, including the former top offset. */
        .sand-game[data-sand-state="over"]>:not(.sand-result){visibility:hidden!important}
        html:root:root:root #root#root#root>.sand-game:is([data-sand-level="2"],[data-sand-level="3"]) .meeting-sand-guide{top:14%!important}

        .btn {
          font-family: var(--font-body);
          font-size: clamp(16px, 4.5cqi, 24px);
          padding: 12px 24px;
          border-radius: 99px;
          border: none;
          background: #FFF7F0;
          color: #713F32;
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 4px 0 #BA866D;
          transition: transform 0.1s;
        }
        .btn:active { transform: translateY(4px); box-shadow: 0 0 0 #BA866D; }
        .btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; box-shadow: 0 4px 0 #BA866D; }
      `}</style>}{<div ref={sceneRef} className={"sand-game"} data-sand-state={phase} data-sand-level={level} style={{
      width: "100%",
      height: "100%",
      position: "relative",
      containerType: "inline-size"
    }} onPointerDown={event => {
      if (phase !== "playing" || activePointer.current !== null || event.isPrimary === false || event.button > 0 || event.target?.closest?.("button")) return;
      activePointer.current = event.pointerId;
      lastDig.current = null;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
      digAtPointer(event);
    }} onPointerMove={event => {
      if (activePointer.current === event.pointerId) {
        digAtPointer(event);
      }
    }} onPointerUp={event => {
      if (activePointer.current !== event.pointerId) return;
      activePointer.current = null;
      lastDig.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {}
    }} onPointerCancel={() => {
      activePointer.current = null;
      lastDig.current = null;
    }} onLostPointerCapture={() => {
      activePointer.current = null;
      lastDig.current = null;
    }}>{<canvas ref={engineRef} style={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
        pointerEvents: "none"
      }} />}{<canvas ref={canvasHostRef} style={{
        position: "absolute",
        inset: 0,
        zIndex: 2,
        pointerEvents: "none"
      }} />}{<div style={{
        position: "absolute",
        top: "calc(30px + env(safe-area-inset-top, 0px))",
        left: "30px",
        right: "30px",
        zIndex: 10,
        pointerEvents: "none",
        display: "flex",
        justifyContent: "space-between",
        fontFamily: "var(--font-display)",
        color: "#713F32",
        fontSize: "28px",
        lineHeight: 1.2,
        fontWeight: "bold"
      }}>{<div aria-label={"Livello " + level + " of 3"}>{"Liv. "}{level}</div>}{<div style={{
          fontFamily: "var(--font-mono)"
        }}>{collectedBalls}{" / "}{totalBalls}</div>}</div>}{<div className="meeting-sand-reset-wrap" style={{
        position: "absolute",
        bottom: "calc(50px + env(safe-area-inset-bottom, 0px))",
        left: "30px",
        zIndex: 10
      }}>{<button type="button" className="btn meeting-sand-reset"
        aria-label={config.BTN_RESET || "Ricomincia il livello"} onClick={event => {
          event.stopPropagation();
          restartLevel();
        }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></svg>
        </button>}</div>}{<Motion.AnimatePresence>{phase === "over" && <Motion.motion.div className={"sand-result"} initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} style={{
          position: "absolute",
          inset: 0,
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#FFF4E9"
        }}>{<Motion.motion.h1 initial={{
            scale: 0.5,
            y: 20
          }} animate={{
            scale: 1,
            y: 0
          }} transition={{
            type: "spring",
            bounce: 0.5
          }} style={{
            fontFamily: "var(--font-display)",
            color: "#713F32",
            fontSize: "clamp(32px, 10cqi, 48px)",
            textShadow: "none",
            marginBottom: "40px",
            textAlign: "center",
            padding: "0 20px"
          }}>{config.WIN_TEXT}</Motion.motion.h1>}{<div style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            alignItems: "center"
          }}>{<button className={"btn"} onClick={advanceLevel}>{level < 3 ? "AVANTI" : config.BTN_PLAY_AGAIN}</button>}{canSubmit && <button className={"btn"} style={{
              background: "#713F32",
              color: "#FFF7F0",
              boxShadow: "0 4px 0 #4F2D26"
            }} disabled={submitting} onClick={submitRecording}>{config.BTN_POST}</button>}</div>}</Motion.motion.div>}</Motion.AnimatePresence>}</div>}</React.Fragment> : <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: RESULT_BACKGROUND
  }} />;
}

// ./sand-guide.js
/* Copy lifecycle follows the real sand-removal/reset marker, not incidental taps. */
(() => {
  const root = document.getElementById('root');
  if (!root) return;
  const style = document.createElement('style');
  style.textContent = '.meeting-sand-guide{position:absolute;top:42%;left:30px;right:30px;translate:0 -50%;margin:0;text-align:center;font:600 18px/1.4 var(--font-body,system-ui,sans-serif);color:#713f32;pointer-events:none;z-index:15}.meeting-sand-guide[hidden]{display:none}';
  document.head.append(style);
  function update() {
    const value = [...root.children].find(child => child.querySelector('canvas'));
    if (!value) return;
    let guide = value.querySelector('.meeting-sand-guide');
    if (!guide) {
      guide = document.createElement('p');
      guide.className = 'meeting-sand-guide';
      guide.textContent = "Trascina per scavare";
      value.append(guide);
    }
    guide.hidden = value.getAttribute('data-sand-guide-used') === 'true';
  }
  const observer = new MutationObserver(update);
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-sand-guide-used']
  });
  update();
  window.addEventListener('pagehide', () => observer.disconnect(), {
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
        "data-game": "16"
      }[name] ?? null;
    },
    dataset: {
      game: "16"
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
  const selectors = [".meeting-sand-guide"];
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
