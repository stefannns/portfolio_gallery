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
    "id": "TOLERANCE_FACTOR",
    "kind": "number",
    "label": "Tolerance Factor",
    "value": 0.15,
    "default": 0.15,
    "min": 0.05,
    "max": 0.5,
    "step": 0.01
  }],
  "texts": [{
    "id": "START_TITLE",
    "label": "Start Title",
    "value": "Tieni premuto per incidere. Rilascia per raffreddare la lama.",
    "default": "Tieni premuto per incidere. Rilascia per raffreddare la lama.",
    "max_length": 150
  }, {
    "id": "BTN_START",
    "label": "Start Button",
    "value": "Inizia a incidere",
    "default": "Inizia a incidere",
    "max_length": 20
  }, {
    "id": "BTN_RETRY",
    "label": "Retry Button",
    "value": "Riprova",
    "default": "Riprova",
    "max_length": 20
  }, {
    "id": "MSG_HOLD_CARVE",
    "label": "Hint Text",
    "value": "Incidi e lascia raffreddare",
    "default": "Incidi e lascia raffreddare",
    "max_length": 30
  }, {
    "id": "MSG_SCORE",
    "label": "Score Label",
    "value": "Stella incisa",
    "default": "Stella incisa",
    "max_length": 20
  }],
  "images": [{
    "id": "BG_MAIN",
    "label": "Main Background",
    "path": "./assets/beach-sand-v1.webp",
    "replaceable": true
  }, {
    "id": "IMG_COCONUT",
    "label": "Coconut Object",
    "path": "./assets/img_coconut_uncarved.webp",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "99278764042931231",
    "version_id": "99278764043067602",
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
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  

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
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .hint{position:fixed!important;top:20%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .hint{top:max(64px,calc(53vh - min(80vw,46vh,360px)*.32 - 114px))!important;font-weight:700!important;color:#fff!important;text-shadow:-1px 0 0 #38200f,1px 0 0 #38200f,0 -1px 0 #38200f,0 1px 0 #38200f,0 2px 4px #241408!important}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .hint{box-sizing:border-box!important;background:#fff!important;color:#293c34!important;padding:6px 14px!important;border:0!important;border-radius:999px!important;box-shadow:0 2px 10px rgba(0,0,0,.08)!important;text-shadow:none!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.82)}}
html:root:root :is(.hint){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.hint){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.hint){animation:none!important}}

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
  for (let value of config.tweaks || []) values[value.id] = value.value;
  for (let value of config.texts || []) values[value.id] = value.value;
  for (let value of config.images || []) values[value.id] = value.path;
  for (let value of config.mentions || []) values[value.id] = value.path || value.value;
  for (let value of config.motions || []) {
    if (value.base_path) {
      values[value.id] = value.base_path;
    }
    if (value.frame_count != null) {
      values[value.id + "_COUNT"] = value.frame_count;
    }
  }
  return values;
}
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
// Keep the live HUD on the same clock as carving, including during held touches.
// Some embedded hosts defer React's scheduled renders until touch release.
function paintStressMeter(canvas, level) {
  const shell = canvas?.parentElement;
  const value = Math.round(clamp(level, 0, 1) * 100);
  const label = shell?.querySelector('.stress-value');
  if (label?.firstChild) label.firstChild.nodeValue = String(value);
  const fill = shell?.querySelector('.fill.stress');
  if (fill) fill.style.width = clamp(level, 0, 1) * 100 + '%';
}
var value2 = Math.PI * 2;
function App() {
  let canvasRef = React.useRef(null);
  let gameRef = React.useRef({
    mode: "loading",
    width: 0,
    height: 0,
    dpr: 1,
    lastFrame: 0,
    elapsed: 0,
    progress: 0,
    stress: 0,
    holding: false,
    pointerId: null,
    stars: [],
    sparks: [],
    lastScrape: 0,
    bg: null,
    coconut: null
  });
  let audioRef = React.useRef({
    ready: false,
    starting: false,
    synth: null,
    sound: null,
    disposed: false
  });
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("loading");
  let [progress, setProgress] = React.useState(0);
  let [stress, setStress] = React.useState(0);
  let [submitting, setSubmitting] = React.useState(false);
  let [guideUsed, setGuideUsed] = React.useState(false);
  let [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  let canSubmit = typeof window !== "undefined" && typeof window.tt?.playableRecordingSubmission == "function";
  let changePhase = value => {
    gameRef.current.mode = value;
    setPhase(value);
  };
  let vibrate = style => {
    try {
      window.tt?.vibrate?.({
        style: style
      });
    } catch {}
  };
  let playNote = (value, value3 = "16n") => {
    try {
      if (audioRef.current.ready) {
        audioRef.current.synth.triggerAttackRelease(value, value3);
      }
    } catch {}
  };
  let ensureSceneAudio = () => {
    if (!audioRef.current.sound && window.PlayableSceneAudio) audioRef.current.sound = new window.PlayableSceneAudio({
      profile: "carve"
    });
    audioRef.current.sound?.unlock();
    if (!(audioRef.current.ready || audioRef.current.starting)) {
      audioRef.current.starting = true;
      Tone.start().then(() => {
        if (audioRef.current.disposed) return;
        let value = new Tone.Synth({
          oscillator: {
            type: "triangle"
          },
          envelope: {
            attack: 0.005,
            decay: 0.08,
            sustain: 0.08,
            release: 0.14
          }
        }).toDestination();
        value.volume.value = -24;
        audioRef.current.synth = value;
        audioRef.current.ready = true;
      }).catch(() => {}).finally(() => {
        audioRef.current.starting = false;
      });
    }
  };
  React.useEffect(() => {
    audioRef.current.disposed = false;
    let stopHolding = () => {
      gameRef.current.lastFrame = 0;
      gameRef.current.holding = false;
      gameRef.current.pointerId = null;
      audioRef.current.sound?.setLoop(false);
    };
    let onVisibility = () => {
      gameRef.current.lastFrame = 0;
      if (document.hidden) {
        stopHolding();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stopHolding);
    let enabled = true;
    let handleAction = value => new Promise(value3 => {
      if (!value) return value3(null);
      let image = new Image();
      image.onload = () => value3(image);
      image.onerror = () => value3(null);
      image.src = value;
    });
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let z = await requestGameConfig();
        if (z.ok) {
          options = await z.json();
        }
      } catch {}
      let config2 = readConfigValues(options);
      let [M, F] = await Promise.all([handleAction(config2.BG_MAIN), handleAction(config2.IMG_COCONUT)]);
      if (enabled) {
        Object.assign(gameRef.current, {
          bg: M,
          coconut: F
        });
        setConfig(config2);
        restartGame();
      }
    })();
    return () => {
      enabled = false;
      audioRef.current.disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stopHolding);
      audioRef.current.sound?.dispose();
      audioRef.current.sound = null;
      audioRef.current.synth?.dispose();
    };
  }, []);
  let restartGame = () => {
    let event = gameRef.current;
    setGuideUsed(false);
    audioRef.current.sound?.setLoop(false);
    event.elapsed = 0;
    event.lastFrame = 0;
    setElapsedSeconds(0);
    event.progress = 0;
    event.stress = 0;
    event.holding = false;
    event.pointerId = null;
    event.sparks = [];
    event.lastScrape = 0;
    setProgress(0);
    setStress(0);
    paintStressMeter(canvasRef.current, 0);
    changePhase("ready");
  };
  let submitRecording = () => {
    if (!(!canSubmit || submitting)) {
      setSubmitting(true);
      try {
        window.tt.playableRecordingSubmission({
          success() {},
          fail(value) {
            console.error("[post_my_play] failed", value?.errMsg || value?.message);
          },
          complete() {
            setSubmitting(false);
          }
        });
      } catch {
        setSubmitting(false);
      }
    }
  };
  let startCarving = event => {
    let event2 = gameRef.current;
    if (!(event2.mode !== "playing" && event2.mode !== "ready" || event.isPrimary === false || event.button > 0)) {
      event.preventDefault();
      if (event2.mode === "ready") {
        changePhase("playing");
        event2.lastFrame = performance.now();
      }
      setGuideUsed(true);
      ensureSceneAudio();
      event2.pointerId = event.pointerId;
      event2.holding = true;
      canvasRef.current.setPointerCapture?.(event.pointerId);
      audioRef.current.sound?.setLoop(true);
    }
  };
  let finishCarving = event => {
    let event2 = gameRef.current;
    if (event.pointerId === event2.pointerId) {
      event2.holding = false;
      audioRef.current.sound?.setLoop(false);
      event2.pointerId = null;
      if (canvasRef.current?.hasPointerCapture?.(event.pointerId)) {
        canvasRef.current.releasePointerCapture(event.pointerId);
      }
    }
  };
  let cancelCarving = event => {
    let event2 = gameRef.current;
    if (event.pointerId === event2.pointerId) {
      event2.holding = false;
      audioRef.current.sound?.setLoop(false);
      event2.pointerId = null;
    }
  };
  React.useEffect(() => {
    if (!config || !canvasRef.current) return;
    let element = canvasRef.current;
    let context = element.getContext("2d");
    let value;
    let handleAction = () => {
      let dimensions = gameRef.current;
      let dimensions2 = element.getBoundingClientRect();
      dimensions.width = dimensions2.width;
      dimensions.height = dimensions2.height;
      dimensions.dpr = Math.min(devicePixelRatio || 1, 3);
      element.width = Math.round(dimensions.width * dimensions.dpr);
      element.height = Math.round(dimensions.height * dimensions.dpr);
      let value3 = dimensions.width / 2;
      let value4 = dimensions.height * 0.53;
      let value5 = Math.min(dimensions.width * 0.8, dimensions.height * 0.46, 360);
      dimensions.coconutSize = value5;
      let value6 = value5 * 0.32;
      dimensions.stars = Array.from({
        length: 5
      }, (value7, otherValue) => {
        let value8 = -Math.PI / 2 + otherValue * Math.PI * 4 / 5;
        return {
          x: value3 + value6 * Math.cos(value8),
          y: value4 + value6 * Math.sin(value8)
        };
      });
      dimensions.stars.push({
        ...dimensions.stars[0]
      });
    };
    handleAction();
    let resizeObserver = observeGameSize(handleAction);
    resizeObserver.observe(element);
    let handleAction2 = (value3, otherValue) => {
      let value4 = Math.min(4, Math.floor(otherValue));
      let value5 = clamp(otherValue - value4, 0, 1);
      let point = value3.stars[value4];
      let point2 = value3.stars[value4 + 1];
      return {
        x: point.x + (point2.x - point.x) * value5,
        y: point.y + (point2.y - point.y) * value5,
        angle: Math.atan2(point2.y - point.y, point2.x - point.x)
      };
    };
    let z = value3 => {
      let value4 = Math.floor(value3.progress);
      let point = handleAction2(value3, value3.progress);
      context.save();
      context.beginPath();
      context.moveTo(value3.stars[0].x, value3.stars[0].y);
      for (let value5 = 1; value5 <= Math.min(value4, 5); value5++) context.lineTo(value3.stars[value5].x, value3.stars[value5].y);
      if (value3.progress < 5) {
        context.lineTo(point.x, point.y);
      }
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = "rgba(59,26,11,.85)";
      context.lineWidth = 13;
      context.stroke();
      context.shadowColor = "#ffe681";
      context.shadowBlur = 14;
      context.strokeStyle = "#fff2b3";
      context.lineWidth = 5;
      context.stroke();
      context.shadowBlur = 0;
      context.strokeStyle = "#f8af42";
      context.lineWidth = 2;
      context.stroke();
      context.restore();
      return point;
    };
    let handleAction3 = point => {
      context.save();
      context.translate(point.x, point.y);
      context.rotate(point.angle);
      context.shadowColor = "#211306";
      context.shadowBlur = 10;
      context.shadowOffsetY = 6;
      context.fillStyle = "#bcd5da";
      context.strokeStyle = "#39464b";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(-30, -9);
      context.lineTo(-45, -7);
      context.lineTo(-45, 7);
      context.lineTo(-30, 9);
      context.closePath();
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
      context.shadowOffsetY = 0;
      context.fillStyle = "#fff";
      context.beginPath();
      context.moveTo(-7, -1);
      context.lineTo(-32, -6);
      context.lineTo(-32, -2);
      context.closePath();
      context.fill();
      context.fillStyle = "#6c381f";
      context.strokeStyle = "#2a180f";
      context.lineWidth = 2;
      context.beginPath();
      context.roundRect(-81, -7, 40, 14, 5);
      context.fill();
      context.stroke();
      context.fillStyle = "#f3c15d";
      context.fillRect(-49, -11, 6, 22);
      context.fillStyle = "#fff8d0";
      context.beginPath();
      context.arc(0, 0, 3.5, 0, value2);
      context.fill();
      context.restore();
    };
    let handleAction4 = value3 => {
      value = requestAnimationFrame(handleAction4);
      let dimensions = gameRef.current;
      let value4 = dimensions.lastFrame ? Math.min((value3 - dimensions.lastFrame) / 1000, 0.04) : 0;
      let timerDelta = dimensions.lastFrame ? Math.max(0, (value3 - dimensions.lastFrame) / 1000) : 0;
      if (dimensions.lastFrame = value3, dimensions.mode === "playing") {
        if (!document.hidden) {
          dimensions.elapsed += timerDelta;
          setElapsedSeconds(seconds => Math.floor(dimensions.elapsed) !== seconds ? Math.floor(dimensions.elapsed) : seconds);
        }
        let progress2 = dimensions.progress;
        if (dimensions.holding) {
          if (dimensions.progress = Math.min(5, dimensions.progress + value4 * 0.86), dimensions.stress = Math.min(1, dimensions.stress + value4 * 0.6), Math.floor(progress2) !== Math.floor(dimensions.progress) && vibrate("light"), dimensions.progress > progress2) {
            let point = handleAction2(dimensions, dimensions.progress);
            if (Math.random() < 0.55) {
              dimensions.sparks.push({
                x: point.x,
                y: point.y,
                vx: (Math.random() - 0.5) * 75,
                vy: (Math.random() - 0.5) * 75,
                life: 0.45
              });
            }
          }
        } else dimensions.stress = Math.max(0, dimensions.stress - value4 * 0.4);
        paintStressMeter(element, dimensions.stress);
        setProgress(Math.round(dimensions.progress / 5 * 100));
        setStress(Math.round(dimensions.stress * 100));
        if (dimensions.progress >= 5) {
          dimensions.holding = false;
          changePhase("won");
          playNote("C6", "4n");
          vibrate("notification_success");
        } else {
          if (dimensions.stress >= 1) {
            dimensions.holding = false;
            changePhase("over");
            playNote("C3", "8n");
            vibrate("notification_error");
          }
        }
      }
      audioRef.current.sound?.setLoop(dimensions.mode === "playing" && dimensions.holding && !document.hidden);
      context.setTransform(dimensions.dpr, 0, 0, dimensions.dpr, 0, 0);
      context.clearRect(0, 0, dimensions.width, dimensions.height);
      if (dimensions.bg) {
        context.drawImage(dimensions.bg, 0, 0, dimensions.width, dimensions.height);
      } else {
        context.fillStyle = "#c48a42";
        context.fillRect(0, 0, dimensions.width, dimensions.height);
      }
      let value5 = dimensions.coconutSize || 240;
      let value6 = dimensions.width / 2;
      let value7 = dimensions.height * 0.53;
      if (dimensions.coconut) {
        let value8 = dimensions.coconut.naturalHeight / dimensions.coconut.naturalWidth;
        context.drawImage(dimensions.coconut, value6 - value5 / 2, value7 - value5 * value8 / 2, value5, value5 * value8);
      } else {
        context.fillStyle = "#774021";
        context.beginPath();
        context.arc(value6, value7, value5 / 2, 0, value2);
        context.fill();
      }
      if (dimensions.stars.length === 6) {
        context.save();
        context.beginPath();
        context.moveTo(dimensions.stars[0].x, dimensions.stars[0].y);
        for (let value8 = 1; value8 < dimensions.stars.length; value8++) context.lineTo(dimensions.stars[value8].x, dimensions.stars[value8].y);
        if (context.setLineDash([6, 7]), context.strokeStyle = "rgba(255,246,191,.86)", context.lineWidth = 3, context.shadowColor = "#402312", context.shadowBlur = 5, context.stroke(), context.restore(), dimensions.mode === "ready" || dimensions.mode === "playing" || dimensions.mode === "won" || dimensions.mode === "over") {
          const preview = document.documentElement.dataset.meetingFyp === "preview";
          const previewProgress = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.65 : Math.min(1.4, value3 % 6000 / 3300 * 1.4);
          let value8 = z(preview ? {
            ...dimensions,
            progress: previewProgress
          } : dimensions);
          handleAction3(value8);
        }
      }
      for (let value8 = dimensions.sparks.length - 1; value8 >= 0; value8--) {
        let particle = dimensions.sparks[value8];
        if (particle.x += particle.vx * value4, particle.y += particle.vy * value4, particle.life -= value4, particle.life <= 0) {
          dimensions.sparks.splice(value8, 1);
          continue;
        }
        context.globalAlpha = particle.life * 2;
        context.fillStyle = "#fff4ac";
        context.beginPath();
        context.arc(particle.x, particle.y, 2 + 3 * particle.life, 0, value2);
        context.fill();
        context.globalAlpha = 1;
      }
    };
    value = requestAnimationFrame(handleAction4);
    return () => {
      cancelAnimationFrame(value);
      resizeObserver.disconnect();
    };
  }, [config]);
  return <div className={"shell"}>{<style>{`
      @font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
      @font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');font-weight:700;font-display:swap}
      html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;touch-action:none;overscroll-behavior:none;background:#9d6832}
      :root{--ui-unit:min(0.2564102564vw,0.1672240803vh)}
      *{box-sizing:border-box}.shell{width:100%;height:100%;position:relative;overflow:hidden;font-family:Poppins,system-ui,sans-serif;color:#fff}
      canvas{display:block;width:100%;height:100%;touch-action:none}.top{position:absolute;left:calc(30 * var(--ui-unit) + env(safe-area-inset-left));right:calc(30 * var(--ui-unit) + env(safe-area-inset-right));top:calc(30 * var(--ui-unit) + env(safe-area-inset-top));pointer-events:none}
      .heading{font-size:clamp(23px,6.5vw,32px);font-weight:700;text-align:center;color:#422715;text-shadow:0 1px 1px #fff1ba;line-height:1.15}
      .meters{display:flex;justify-content:space-between;align-items:flex-start;gap:calc(16 * var(--ui-unit))}.meter{flex:1;width:auto;max-width:240px;min-width:0}.elapsed{flex:none;min-width:3.5ch;text-align:right;color:#321d11;font-size:calc(28 * var(--ui-unit));font-weight:700;font-variant-numeric:tabular-nums;line-height:1.4;white-space:nowrap}.meter label{display:flex;align-items:center;justify-content:flex-start;gap:12px;color:#321d11;font-weight:700;font-size:calc(18 * var(--ui-unit));line-height:1.4;margin-bottom:5px}.stress-value{font-size:calc(28 * var(--ui-unit));font-variant-numeric:tabular-nums}
      .track{height:15px;border:2px solid #5b3218;border-radius:10px;background:#51351f;overflow:hidden;box-shadow:0 2px 4px #3c210a66}.fill{height:100%;background:linear-gradient(90deg,#ffef93,#f9a84a);transition:width .08s linear}.fill.stress{background:linear-gradient(90deg,#ffbf65,#ee4832)}
      .hint{position:absolute;left:calc(30 * var(--ui-unit) + env(safe-area-inset-left));right:calc(30 * var(--ui-unit) + env(safe-area-inset-right));bottom:calc(50 * var(--ui-unit) + env(safe-area-inset-bottom) + 5px);text-align:center;font-size:calc(18 * var(--ui-unit));font-weight:700;color:#fff7d9;text-shadow:0 2px 5px #4b2718;pointer-events:none;line-height:1.3}
      .overlay{position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center;padding:calc(30 * var(--ui-unit) + env(safe-area-inset-top)) calc(30 * var(--ui-unit) + env(safe-area-inset-right)) calc(50 * var(--ui-unit) + env(safe-area-inset-bottom)) calc(30 * var(--ui-unit) + env(safe-area-inset-left));background:#201307a8;backdrop-filter:blur(4px)}
      .card{width:100%;max-width:360px;text-align:center;background:#fff3d2;color:#432713;border:3px solid #7a431e;border-radius:22px;padding:25px 21px;box-shadow:0 15px 35px #20130788}
      .card h1{margin:0 0 12px;font-size:calc(24 * var(--ui-unit));line-height:1.2;overflow-wrap:anywhere}.card p{margin:0 0 20px;font-size:calc(18 * var(--ui-unit));line-height:1.4;font-weight:600}
      .result-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}.result-stats>div{min-width:0}.final-time{font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
      .card .result-label{font-size:17px;font-weight:700;color:#6f4429;margin:4px 0 0}.card .result{font-size:calc(28 * var(--ui-unit));font-weight:700;color:#ac4d1f;margin:0 0 18px;line-height:1.15}.card button{display:block;width:100%;min-height:52px;border:0;border-radius:999px;background:#efad3c;color:#3f240e;font:700 18px Poppins,system-ui,sans-serif;cursor:pointer;padding:9px 15px}
      .card button:focus-visible{outline:3px solid #432713;outline-offset:3px}.card button:active{filter:brightness(.85)}.card button.secondary{margin-top:11px;border:2px solid #aa6a2d;background:transparent}.card button:disabled{opacity:.55}
    `}</style>}{<canvas ref={canvasRef} onPointerDown={startCarving} onPointerUp={finishCarving} onPointerCancel={cancelCarving} aria-label={"Tieni premuto per incidere la stella"} />}{<div className={"top"}>{(phase === "playing" || phase === "ready") && <div className={"meters"}>{<div className={"meter"}>{<label>{"Stress"}{<span className={"stress-value"}>{stress}{"%"}</span>}</label>}{<div className={"track"}>{<div className={"fill stress"} style={{
              width: stress + "%"
            }} />}</div>}</div>}{<span className={"elapsed"} role={"timer"} aria-live={"off"} aria-label={"Elapsed time " + elapsedSeconds + " seconds"}>{elapsedSeconds}{"s"}</span>}</div>}</div>}{(phase === "playing" || phase === "ready") && <div className={"hint feed-first-action"} style={{
      visibility: guideUsed ? "hidden" : "visible"
    }} aria-hidden={guideUsed}>{phase === "ready" ? "Incidi e lascia raffreddare" : config?.MSG_HOLD_CARVE || "Incidi e lascia raffreddare"}</div>}{null}{(phase === "won" || phase === "over") && <div className={"overlay"}>{<div className={"card"}>{<h1>{phase === "won" ? "STELLA COMPLETATA!" : "LAMA SCIVOLATA!"}</h1>}{<p>{phase === "won" ? "Hai inciso una stella a cinque punte." : "Rilascia prima per raffreddare la lama, poi continua."}</p>}{<div className={"result-stats"}>{<div>{<div className={"result-label"}>{config?.MSG_SCORE || "Stella incisa"}</div>}{<div className={"result"}>{progress}{"%"}</div>}</div>}{<div>{<div className={"result-label"}>{"Tempo"}</div>}{<div className={"result final-time"} aria-label={"Final time " + gameRef.current.elapsed.toFixed(1) + " seconds"}>{gameRef.current.elapsed.toFixed(1)}{"s"}</div>}</div>}</div>}{<button onClick={restartGame}>{config?.BTN_RETRY || "Riprova"}</button>}{canSubmit && <button className={"secondary"} disabled={submitting} onClick={submitRecording}>{"Condividi"}</button>}</div>}</div>}</div>;
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

// ./scene-audio.js
/* Original procedural audio. No third-party recordings or runtime dependencies. */
(() => {
  'use strict';

  const randomFor = seed => () => {
    seed = Math.imul(seed, 1664525) + 1013904223 >>> 0;
    return seed / 4294967296;
  };
  class PlayableSceneAudio {
    constructor({
      profile,
      context = null
    } = {}) {
      this.profile = profile;
      this.context = context;
      this.ownsContext = !context;
      this.buffers = new Map();
      this.voices = new Set();
      this.loopVoice = null;
      this.loopWanted = false;
      this.disposed = false;
      this.visibility = () => {
        if (document.hidden) {
          this.stopAll();
          if (this.profile === 'carve') this.loopWanted = false;
          if (this.ownsContext) this.context?.suspend?.().catch(() => {});
        } else if (this.profile === 'maze' && this.loopWanted) this.setLoop(true);
      };
      this.pageHide = () => {
        this.stopAll();
        if (this.profile === 'carve') this.loopWanted = false;
        if (this.ownsContext) this.context?.suspend?.().catch(() => {});
      };
      this.pageShow = () => {
        if (this.profile === 'maze' && this.loopWanted && !document.hidden) this.setLoop(true);
      };
      document.addEventListener('visibilitychange', this.visibility);
      window.addEventListener('pagehide', this.pageHide);
      window.addEventListener('pageshow', this.pageShow);
    }
    unlock() {
      if (this.disposed || document.hidden) return null;
      try {
        if (!this.context) {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) return null;
          this.context = new Audio();
        }
        if (this.context.state === 'closed') return null;
        if (this.context.state === 'suspended') this.context.resume().catch(() => {});
        return this.context;
      } catch (value) {
        return null;
      }
    }
    buffer(kind, variant = 0) {
      const value3 = kind + variant;
      if (this.buffers.has(value3)) return this.buffers.get(value3);
      const context = this.context;
      const seconds = {
        maze: 8,
        carve: 1.7,
        thunder: 3.4,
        step: 0.09,
        scare: 0.3,
        win: 0.55
      }[kind];
      const stereo = kind === 'thunder';
      const buffer = context.createBuffer(stereo ? 2 : 1, Math.ceil(seconds * context.sampleRate), context.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        const random = randomFor(4027 + variant * 89 + channel * 193);
        let value4 = 0;
        let grain = 0;
        let peak = 0;
        const smoothing = Math.exp(-2 * Math.PI * (kind === 'maze' ? 140 : 85) / context.sampleRate);
        const highSmoothing = Math.exp(-2 * Math.PI * 420 / context.sampleRate);
        for (let value5 = 0; value5 < samples.length; value5++) {
          const value6 = value5 / context.sampleRate;
          const white = random() * 2 - 1;
          value4 = value4 * smoothing + white * (1 - smoothing);
          grain = grain * highSmoothing + white * (1 - highSmoothing);
          let value;
          if (kind === 'maze') {
            // Slow, non-pitched air, deliberately behind footsteps and encounters.
            value = value4 * (0.68 + 0.16 * Math.sin(value6 * Math.PI / 2) + 0.08 * Math.sin(value6 * Math.PI));
          } else if (kind === 'carve') {
            const stroke = 0.42 + 0.26 * Math.sin(value6 * 18) ** 2 + 0.16 * Math.sin(value6 * 31 + 0.7) ** 2;
            value = (white - grain) * stroke * 0.3 + (random() > 0.997 ? white * 0.34 : 0);
          } else if (kind === 'thunder') {
            const crack = Math.exp(-value6 * 26) * 0.65 + Math.exp(-Math.abs(value6 - 0.07) * 60) * 0.2;
            const rolling = Math.exp(-value6 * 1.15) * (1 - Math.exp(-value6 * 24)) * (0.65 + 0.3 * Math.sin(value6 * 12 + variant) ** 2);
            const echoes = Math.exp(-Math.abs(value6 - 0.28) * 15) * 0.28 + Math.exp(-Math.abs(value6 - 0.64) * 9) * 0.2 + Math.exp(-Math.abs(value6 - 1.12) * 7) * 0.12;
            value = white * crack + value4 * 9 * (rolling + echoes);
            value *= Math.min(1, value6 / 0.003, (seconds - value6) / 0.28);
          } else if (kind === 'win') {
            value = [261.63, 329.63, 392].reduce((total, item) => total + Math.sin(value6 * Math.PI * 2 * item), 0) * Math.min(1, value6 / 0.02) * Math.exp(-value6 / 0.12) * Math.min(1, (seconds - value6) / 0.05);
          } else {
            const length = kind === 'step' ? 0.03 : 0.09;
            value = (value4 * 3 + white * 0.08) * Math.exp(-value6 / length) * Math.min(1, value6 / 0.006);
          }
          samples[value5] = value;
          peak = Math.max(peak, Math.abs(value));
        }
        const scale = 0.8 / Math.max(0.001, peak);
        for (let value = 0; value < samples.length; value++) samples[value] *= scale;
        if (kind === 'maze' || kind === 'carve') {
          // Match loop endpoints to avoid clicks at the buffer boundary.
          const blend = Math.round(context.sampleRate * 0.02);
          for (let value = 0; value < blend; value++) {
            const value5 = value / blend;
            samples[samples.length - blend + value] = samples[samples.length - blend + value] * (1 - value5) + samples[value] * value5;
          }
        }
      }
      this.buffers.set(value3, buffer);
      return buffer;
    }
    play(kind, {
      loop = false,
      volume = 0.12,
      variant = 0
    } = {}) {
      const value = this.unlock();
      if (!value) return null;
      try {
        // Rapid touches cannot accumulate unbounded audio nodes or excessive level.
        const limit = kind === 'thunder' ? 3 : 4;
        const active = [...this.voices].filter(item => !item.stopping);
        while (active.length >= limit) this.stopVoice(active.shift(), 0.025);
        const source = value.createBufferSource();
        const filter = value.createBiquadFilter();
        const gain = value.createGain();
        source.buffer = this.buffer(kind, variant);
        source.loop = loop;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(kind === 'maze' ? 500 : kind === 'carve' ? 4600 : kind === 'thunder' ? 3200 : 1700, value.currentTime);
        if (kind === 'thunder') filter.frequency.exponentialRampToValueAtTime(230, value.currentTime + 2.9);
        filter.Q.value = 0.45;
        const level = Math.min(0.4, Math.max(0, volume)) / Math.sqrt(active.length + 1);
        const attack = kind === 'maze' ? 1.2 : kind === 'carve' ? 0.035 : 0.004;
        gain.gain.setValueAtTime(0.0001, value.currentTime);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), value.currentTime + attack);
        source.connect(filter).connect(gain).connect(value.destination);
        const voice = {
          source,
          filter,
          gain,
          stopping: false
        };
        this.voices.add(voice);
        source.onended = () => {
          source.disconnect();
          filter.disconnect();
          gain.disconnect();
          this.voices.delete(voice);
          if (this.loopVoice === voice) this.loopVoice = null;
        };
        source.start();
        if (!loop) source.stop(value.currentTime + source.buffer.duration + 0.02);
        return voice;
      } catch (value3) {
        return null;
      }
    }
    setLoop(wanted) {
      this.loopWanted = Boolean(wanted);
      if (!wanted || document.hidden) {
        if (this.loopVoice) this.stopVoice(this.loopVoice, 0.12);
        this.loopVoice = null;
        return;
      }
      if (!this.loopVoice) this.loopVoice = this.play(this.profile, {
        loop: true,
        volume: this.profile === 'maze' ? 0.035 : 0.14
      });
    }
    stopVoice(voice, fade = 0.08) {
      if (!voice || voice.stopping) return;
      voice.stopping = true;
      try {
        const currentTime = this.context.currentTime;
        const param = voice.gain.gain;
        if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(currentTime);else {
          param.cancelScheduledValues(currentTime);
          param.setValueAtTime(Math.max(0.0001, param.value), currentTime);
        }
        param.exponentialRampToValueAtTime(0.0001, currentTime + fade);
        // A finite source already has a stop scheduled; replace it with the fade's end.
        voice.source.stop(currentTime + fade + 0.01);
      } catch (value) {}
    }
    stopAll() {
      for (const voice of this.voices) this.stopVoice(voice);
      this.loopVoice = null;
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.loopWanted = false;
      this.stopAll();
      document.removeEventListener('visibilitychange', this.visibility);
      window.removeEventListener('pagehide', this.pageHide);
      window.removeEventListener('pageshow', this.pageShow);
      if (this.ownsContext) this.context?.close?.().catch(() => {});
      this.buffers.clear();
    }
  }
  window.PlayableSceneAudio = PlayableSceneAudio;
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
        "data-game": "45"
      }[name] ?? null;
    },
    dataset: {
      game: "45"
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
      const value3 = [...value.children].find(item => item.tagName === 'DIV' && item.textContent.trim() === '0');
      if (value3) mark(value3, 'meeting-piano-hud');
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
  const selectors = [".hint"];
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
      const filter = value4 => (base ? base + ' ' : '') + 'opacity(' + value4 + ')';
      const value3 = value.animate([{
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
      running.set(value, value3);
      if (document.hidden || !visible) value3.pause();
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
