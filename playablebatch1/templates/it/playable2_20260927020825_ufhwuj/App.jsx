// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "BASE_SPEED",
    "kind": "number",
    "label": "Initial Block Speed",
    "value": 0.4,
    "default": 0.4,
    "min": 0.1,
    "max": 1,
    "step": 0.05
  }, {
    "id": "HARD_MODE",
    "kind": "boolean",
    "label": "Hard Mode (Faster Acceleration)",
    "value": false,
    "default": false
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "TORRE SYNTHWAVE",
    "default": "TORRE SYNTHWAVE",
    "max_length": 30
  }, {
    "id": "DESC",
    "label": "Description",
    "value": "Impila i blocchi al neon senza sbagliare.",
    "default": "Impila i blocchi al neon senza sbagliare.",
    "max_length": 150
  }, {
    "id": "BTN_START",
    "label": "Start Button",
    "value": "INIZIA",
    "default": "INIZIA",
    "max_length": 20
  }, {
    "id": "TXT_GAMEOVER",
    "label": "Game Over Text",
    "value": "PARTITA FINITA",
    "default": "PARTITA FINITA",
    "max_length": 20
  }, {
    "id": "BTN_RESTART",
    "label": "Restart Button",
    "value": "RIGIOCA",
    "default": "RIGIOCA",
    "max_length": 20
  }, {
    "id": "BTN_POST",
    "label": "Post Button (Not in form, fallback)",
    "value": "CONDIVIDI",
    "default": "CONDIVIDI",
    "max_length": 20
  }],
  "images": [{
    "id": "BG_MAIN",
    "label": "Main Background Fallback",
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
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
    :root { --synth-safe-bottom: env(safe-area-inset-bottom, 0px); }

    /* Keep the horizon subdued so the moving block remains the focal point. */
    .synth-grid {
      height: 52% !important;
      opacity: .55;
      transform: perspective(500px) rotateX(58deg) !important;
      animation: synthHorizon 6s linear infinite !important;
      mask-image: linear-gradient(to bottom, transparent, #000 48%);
      -webkit-mask-image: linear-gradient(to bottom, transparent, #000 48%);
    }
    @keyframes synthHorizon {
      from { background-position: 0 0; }
      to { background-position: 0 8cqi; }
    }
    .synth-score {
      position: absolute;
      top: calc(30px + env(safe-area-inset-top, 0px));
      left: calc(30px + env(safe-area-inset-left, 0px));
      right: calc(30px + env(safe-area-inset-right, 0px));
      text-align: center;
      font-family: var(--font-display);
      font-size: 28px;
      font-weight: 400;
      font-synthesis: none;
      font-variant-numeric: tabular-nums;
      line-height: 1.25;
      color: var(--neon-magenta);
      text-shadow: 0 0 4px var(--neon-magenta);
      overflow-wrap: anywhere;
      z-index: 10;
      pointer-events: none;
    }
    .synth-score-digit {
      display: inline-block;
      width: 1ch;
      text-align: center;
    }
    #root h1, #root h2 {
      max-width: calc(100% - 50px);
      overflow-wrap: anywhere;
      text-align: center;
    }
    .btn-neon {
      font-weight: 400;
      font-synthesis: none;
      letter-spacing: .02em;
      max-width: calc(100% - 50px);
      min-height: 48px;
      white-space: normal;
      line-height: 1.4;
    }
    @media (prefers-reduced-motion: reduce) {
      .synth-grid { animation: none !important; }
    }
  

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

@font-face{
  font-family:"Exo 2 Playable";
  src:url("./assets/fonts/exo2/Exo2-Latin.woff") format("woff");
  font-style:normal;
  font-weight:100 900;
  font-display:swap;
}
html[data-meeting-game="17"]{
  --font-display:"Exo 2 Playable","Arial",sans-serif!important;
  --font-body:"Exo 2 Playable","Arial",sans-serif!important;
  --font-mono:"Exo 2 Playable","Arial",sans-serif!important;
}
html[data-meeting-game="17"] #root,
html[data-meeting-game="17"] #root button{font-family:var(--font-body)!important}
html[data-meeting-game="17"] .feed-first-action{font-family:var(--font-body)!important;font-weight:600!important}
html[data-meeting-game="17"] .synth-score{font-weight:700;font-variant-numeric:tabular-nums;text-shadow:none;letter-spacing:.015em}
html[data-meeting-game="17"] .meeting-synth-result h2{font-weight:700!important;letter-spacing:.025em}
html[data-meeting-game="17"] .meeting-synth-result>div{font-weight:600!important;font-variant-numeric:tabular-nums}
html[data-meeting-game="17"] .btn-neon{font-weight:600;letter-spacing:.035em;text-shadow:none;font-size:18px;line-height:1.4;padding:12px 24px;min-width:176px;max-width:calc(100vw - 60px)}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.feed-first-action{position:fixed!important;top:45%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(p.feed-first-action){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(p.feed-first-action){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(p.feed-first-action){animation:none!important}}

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
var towerAudio = new class {
  constructor() {
    this.ready = false;
    this.synth = null;
    this.failSynth = null;
    this.lastTime = 0;
  }
  async ensure() {
    if (!this.ready) {
      await Tone.start();
      this.synth = new Tone.Synth({
        oscillator: {
          type: "square"
        },
        envelope: {
          attack: 0.01,
          decay: 0.1,
          sustain: 0.1,
          release: 0.5
        }
      }).toDestination();
      this.synth.volume.value = -12;
      this.failSynth = new Tone.MembraneSynth().toDestination();
      this.failSynth.volume.value = -8;
      this.ready = true;
    }
  }
  playPlace(value) {
    if (!this.ready) return;
    let timestamp = Tone.getContext().now();
    let value2 = timestamp > this.lastTime ? timestamp : this.lastTime + 0.005;
    this.lastTime = value2;
    let items = ["C3", "E3", "G3", "C4", "E4", "G4"];
    let item = items[Math.min(value, items.length - 1)];
    this.synth.triggerAttackRelease(item, "16n", value2);
  }
  playFail() {
    if (this.ready) {
      this.failSynth.triggerAttackRelease("C2", "8n");
    }
  }
}();
var WORLD_WIDTH = 1000;
var prefersReducedMotion = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function useRecordingSubmission() {
  let canSubmit = typeof window !== "undefined" && typeof window.tt !== "undefined" && "function" == typeof window.tt.playableRecordingSubmission;
  let [submitting, setSubmitting] = React.useState(false);
  React.useEffect(() => {
    let handleAction = () => setSubmitting(false);
    let handleAction2 = () => {
      if ("visible" === document.visibilityState) {
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
function App() {
  let {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: submitRecording
  } = useRecordingSubmission();
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("idle");
  let [score2, setScore] = React.useState(0);
  let canvasRef = React.useRef(null);
  let worldRef = React.useRef(null);
  let animationRef = React.useRef(null);
  let lastFrameRef = React.useRef(0);
  let phaseRef = React.useRef(phase);
  React.useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
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
        setConfig(function (config2) {
          let options2 = {};
          (config2.tweaks || []).forEach(item => {
            options2[item.id] = item.value;
          });
          (config2.texts || []).forEach(item => {
            options2[item.id] = item.value;
          });
          (config2.images || []).forEach(item => {
            options2[item.id] = item.path;
          });
          (config2.mentions || []).forEach(item => {
            options2[item.id] = null != item.path && "" !== item.path ? item.path : item.value;
          });
          (config2.motions || []).forEach(item => {
            if (!(!item || !item.id)) {
              if (null != item.base_path && "" !== item.base_path) {
                options2[item.id] = item.base_path;
                options2[item.id + "_BASE"] = item.base_path;
              }
              if (null != item.frame_count) {
                options2[item.id + "_COUNT"] = item.frame_count;
              }
            }
          });
          return options2;
        }(options));
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  let resetTower = React.useCallback(() => {
    worldRef.current = (config2 => ({
      blocks: [],
      active: null,
      debris: [],
      cameraY: 0,
      targetCameraY: 0,
      speed: config2.BASE_SPEED || 0.4,
      dir: 1,
      entryDir: 1,
      combo: 0
    }))(config);
    worldRef.current.blocks.push({
      x: 200,
      w: 600,
      y: 0,
      color: 0
    });
    worldRef.current.active = {
      x: 0,
      w: 600,
      y: 50,
      color: 1
    };
    setScore(0);
    phaseRef.current = "ready";
    setPhase("ready");
  }, [config]);
  let finishGame = React.useCallback(() => {
    towerAudio.playFail();
    setPhase("over");
  }, []);
  let advanceWorld = React.useCallback(value => {
    if (phaseRef.current !== "playing" && phaseRef.current !== "ready") return;
    let current = worldRef.current;
    if (current && current.active) {
      current.active.x += current.speed * current.dir * value;
      if (current.active.x <= 0) {
        current.active.x = 0;
        current.dir = 1;
      } else {
        if (current.active.x + current.active.w >= WORLD_WIDTH) {
          current.active.x = WORLD_WIDTH - current.active.w;
          current.dir = -1;
        }
      }
      current.cameraY += 0.1 * (current.targetCameraY - current.cameraY);
      for (let value2 = current.debris.length - 1; value2 >= 0; value2--) {
        let item = current.debris[value2];
        item.vy -= 0.001 * value;
        item.y += item.vy * value;
        if (item.y < current.cameraY - 500) {
          current.debris.splice(value2, 1);
        }
      }
    }
  }, []);
  let drawScene = React.useCallback(() => {
    let canvas = canvasRef.current;
    let game = worldRef.current;
    if (!canvas || !game) return;
    let context = canvas.getContext("2d");
    let width = canvas.width;
    let height = canvas.height;
    let pixelRatio = width / Math.max(1, canvas.getBoundingClientRect().width);
    let inset = 42 * pixelRatio;
    let scale = (width - 2 * inset) / WORLD_WIDTH;
    let safeBottom = typeof window !== "undefined" && window.getComputedStyle ? parseFloat(window.getComputedStyle(canvas).getPropertyValue("--synth-safe-bottom")) || 0 : 0;
    let floor = height - (50 + safeBottom) * pixelRatio - 50 * scale;
    let timestamp = performance.now();
    context.clearRect(0, 0, width, height);
    const ambientTime = prefersReducedMotion ? 0 : timestamp / 1000;
    const random = index => {
      const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
      return value - Math.floor(value);
    };
    context.save();
    for (let value = 0; value < 42; value++) {
      const depth = 0.35 + random(value + 40) * 0.65;
      const cycle = height + 40 * pixelRatio;
      const value2 = ((random(value + 80) * cycle - ambientTime * (6 + depth * 9) * pixelRatio) % cycle + cycle) % cycle - 20 * pixelRatio;
      const value3 = width * random(value + 120) + Math.sin(ambientTime * 0.18 + value) * 9 * pixelRatio;
      const alpha = 0.15 + depth * 0.2;
      context.globalAlpha = alpha;
      context.fillStyle = value % 4 === 0 ? "#c782fa" : "#57d8ed";
      const radius = (0.5 + depth * 0.7) * pixelRatio;
      context.beginPath();
      context.arc(value3, value2, radius, 0, Math.PI * 2);
      context.fill();
      if (value % 7 === 0) {
        context.globalAlpha = alpha * 0.3;
        context.strokeStyle = context.fillStyle;
        context.lineWidth = 0.7 * pixelRatio;
        context.beginPath();
        context.moveTo(value3, value2 + 3 * pixelRatio);
        context.lineTo(value3, value2 + (7 + depth * 5) * pixelRatio);
        context.stroke();
      }
    }
    context.restore();
    const palettes = [{
      edge: "#46edff",
      core: "#c3faff",
      face: ["#2398b2", "#226780", "#172f4c", "#09172d"]
    }, {
      edge: "#ff55cf",
      core: "#ffd3ed",
      face: ["#bc388a", "#802960", "#491e47", "#250e29"]
    }, {
      edge: "#ab7dff",
      core: "#e7d9ff",
      face: ["#8253bf", "#583b89", "#32254f", "#18152c"]
    }, {
      edge: "#ffbd60",
      core: "#ffebc9",
      face: ["#bf7632", "#864b30", "#4f2c36", "#261724"]
    }];
    const drawBlock = (block, isDebris = false) => {
      let x = inset + block.x * scale;
      let y = floor - (block.y - game.cameraY) * scale;
      let value = block.w * scale;
      let value2 = 50 * scale;
      if (y > height || y + value2 < 0 || value <= 0) return;
      const palette = palettes[block.color % palettes.length];
      const {
        edge,
        core
      } = palette;
      const active = block === game.active && !isDebris;
      const value3 = block.placedAt == null ? Infinity : timestamp - block.placedAt;
      const landed = !isDebris && value3 >= 0 && value3 < 480;
      context.save();
      context.globalAlpha = isDebris ? 0.66 : 1;
      const face = context.createLinearGradient(0, y, 0, y + value2);
      face.addColorStop(0, palette.face[0]);
      face.addColorStop(0.28, palette.face[1]);
      face.addColorStop(0.65, palette.face[2]);
      face.addColorStop(1, palette.face[3]);
      context.fillStyle = face;
      context.fillRect(x, y, value, value2);
      context.strokeStyle = edge;
      context.lineWidth = (active ? 1.6 : 1.1) * pixelRatio;
      context.shadowColor = edge;
      context.shadowBlur = (active ? 10 : isDebris ? 3 : 6) * pixelRatio;
      context.strokeRect(x + 0.5 * pixelRatio, y + 0.5 * pixelRatio, Math.max(0, value - pixelRatio), value2 - pixelRatio);
      context.shadowBlur = 0;
      context.fillStyle = core;
      context.globalAlpha = isDebris ? 0.4 : active ? 0.9 : 0.65;
      context.fillRect(x + pixelRatio, y + pixelRatio, Math.max(0, value - 2 * pixelRatio), pixelRatio);
      context.globalAlpha = isDebris ? 0.28 : 0.45;
      context.fillStyle = edge;
      context.fillRect(x + pixelRatio, y + value2 - 2 * pixelRatio, Math.max(0, value - 2 * pixelRatio), pixelRatio);
      context.globalAlpha = 1;
      const sweep = active ? timestamp % 2800 / 2800 : value3 / 340;
      if (!prefersReducedMotion && !isDebris && (active || value3 >= 0 && value3 < 340)) {
        const band = Math.min(value * 0.2, 26 * pixelRatio);
        const center = x - band + (value + 2 * band) * sweep;
        const tilt = value2 * 0.6;
        context.save();
        context.beginPath();
        context.rect(x, y, value, value2);
        context.clip();
        const sheen = context.createLinearGradient(center - band, y, center + band, y);
        sheen.addColorStop(0, core + "00");
        sheen.addColorStop(0.43, core + "1f");
        sheen.addColorStop(0.5, core + "73");
        sheen.addColorStop(0.57, core + "1f");
        sheen.addColorStop(1, core + "00");
        context.fillStyle = sheen;
        context.beginPath();
        context.moveTo(center - band + tilt, y);
        context.lineTo(center + band + tilt, y);
        context.lineTo(center + band - tilt, y + value2);
        context.lineTo(center - band - tilt, y + value2);
        context.closePath();
        context.fill();
        context.restore();
      }
      if (landed) {
        const progress = value3 / 480;
        const fade = (1 - progress) * (1 - progress);
        const seam = y + value2 - pixelRatio;
        context.globalAlpha = fade;
        context.strokeStyle = core;
        context.lineWidth = 2 * pixelRatio;
        context.shadowColor = edge;
        context.shadowBlur = 12 * pixelRatio;
        context.beginPath();
        context.moveTo(x, seam);
        context.lineTo(x + value, seam);
        context.stroke();
        context.shadowBlur = 0;
        if (!prefersReducedMotion) {
          context.strokeStyle = edge;
          context.lineWidth = pixelRatio;
          for (let side of [-1, 1]) for (let value4 = 0; value4 < 3; value4++) {
            const distance = (3 + 8 * progress) * pixelRatio;
            const value5 = (side < 0 ? x : x + value) + side * distance;
            const value6 = seam - (value4 - 1) * progress * 9 * pixelRatio;
            context.beginPath();
            context.moveTo(value5, value6);
            context.lineTo(value5 - side * 3 * pixelRatio, value6 + (value4 - 1) * pixelRatio);
            context.stroke();
          }
        }
      }
      context.restore();
    };
    game.blocks.forEach(block => drawBlock(block));
    if (game.active && (phaseRef.current === "playing" || phaseRef.current === "ready")) drawBlock(game.active);
    game.debris.forEach(block => drawBlock(block, true));
  }, []);
  let animateFrame = React.useCallback(value => {
    if (!lastFrameRef.current) {
      lastFrameRef.current = value;
    }
    let value2 = value - lastFrameRef.current;
    lastFrameRef.current = value;
    if (value2 > 100) {
      value2 = 16;
    }
    advanceWorld(value2);
    drawScene();
    animationRef.current = requestAnimationFrame(animateFrame);
  }, [advanceWorld, drawScene]);
  let dropBlock = React.useCallback(() => {
    if (phaseRef.current !== "playing" && phaseRef.current !== "ready") return;
    if (phaseRef.current === "ready") {
      phaseRef.current = "playing";
      setPhase("playing");
      void towerAudio.ensure().catch(() => {});
    }
    let game = worldRef.current;
    let previous = game.blocks[game.blocks.length - 1];
    let active = game.active;
    let left = Math.max(previous.x, active.x);
    let overlap = Math.min(previous.x + previous.w, active.x + active.w) - left;
    if (overlap <= 0) {
      finishGame();
      return;
    }
    if (Math.abs(previous.x - active.x) < 15) {
      left = previous.x;
      overlap = previous.w;
      game.combo++;
    } else {
      game.combo = 0;
      let offcutX = active.x < previous.x ? active.x : previous.x + previous.w;
      let offcutWidth = active.w - overlap;
      if (offcutWidth > 0) game.debris.push({
        x: offcutX,
        w: offcutWidth,
        y: active.y,
        color: active.color,
        vy: 0.2
      });
    }
    towerAudio.playPlace(game.combo);
    game.blocks.push({
      x: left,
      w: overlap,
      y: active.y,
      color: active.color,
      placedAt: performance.now()
    });
    setScore(score => score + 1);
    game.entryDir = -game.entryDir;
    game.dir = game.entryDir;
    game.active = {
      x: game.entryDir > 0 ? 0 : WORLD_WIDTH - overlap,
      w: overlap,
      y: active.y + 50,
      color: active.color + 1
    };
    game.speed += 0.01;
    game.targetCameraY = Math.max(0, active.y - 200);
  }, [finishGame]);
  React.useEffect(() => {
    if (config) resetTower();
  }, [config, resetTower]);
  React.useEffect(() => {
    if ("ready" === phase || "playing" === phase || "over" === phase) {
      lastFrameRef.current = performance.now();
      animationRef.current = requestAnimationFrame(animateFrame);
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [phase, animateFrame]);
  React.useEffect(() => {
    let handleAction = () => {
      if (canvasRef.current && canvasRef.current.parentElement) {
        let value = window.devicePixelRatio || 1;
        let dimensions = canvasRef.current.parentElement.getBoundingClientRect();
        canvasRef.current.width = dimensions.width * value;
        canvasRef.current.height = dimensions.height * value;
      }
      drawScene();
    };
    window.addEventListener("resize", handleAction);
    setTimeout(handleAction, 50);
    return () => window.removeEventListener("resize", handleAction);
  }, [drawScene, phase]);
  return config ? <div style={{
    width: "100%",
    height: "100%",
    position: "relative",
    containerType: "inline-size"
  }}>{<style>{`
  @font-face {
    font-family: 'Audiowide';
    src: url('./assets/fonts/audiowide/Audiowide-Regular.woff2') format('woff2');
    font-weight: 400;
    font-style: normal;
    font-display: swap;
  }
  :root {
    --font-display: "Audiowide", "PingFang SC", system-ui, sans-serif;
    --font-body:    -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
    --font-mono:    ui-monospace, Menlo, monospace;
    --neon-cyan: #00f3ff;
    --neon-magenta: #ff00ff;
    --bg-dark: #0b0213;
  }
  html, body, #root { width:100%; height:100%; margin:0; padding:0; overflow:hidden; background-color: var(--bg-dark); }
  * { box-sizing: border-box; touch-action: none; user-select: none; -webkit-user-select: none; }
  
  .synth-grid {
    position: absolute;
    bottom: 0; left: 0; right: 0; height: 120%;
    background-image: 
      linear-gradient(to right, rgba(255, 0, 255, 0.2) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(0, 243, 255, 0.2) 1px, transparent 1px);
    background-size: 8cqi 8cqi;
    transform: perspective(600px) rotateX(60deg) translateY(0);
    transform-origin: bottom center;
    animation: gridMove 2s linear infinite;
    pointer-events: none;
    z-index: 0;
  }
  @keyframes gridMove {
    0% { transform: perspective(600px) rotateX(60deg) translateY(0); }
    100% { transform: perspective(600px) rotateX(60deg) translateY(8cqi); }
  }
  
  .btn-neon {
    font-family: var(--font-display);
    background: transparent;
    color: var(--neon-cyan);
    border: 2px solid var(--neon-cyan);
    padding: 12px 32px;
    font-size: clamp(16px, 5cqi, 24px);
    border-radius: 4px;
    text-transform: uppercase;
    text-shadow: 0 0 5px var(--neon-cyan);
    box-shadow: 0 0 10px rgba(0, 243, 255, 0.3), inset 0 0 10px rgba(0, 243, 255, 0.2);
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-neon:active {
    background: var(--neon-cyan);
    color: var(--bg-dark);
  }
  .btn-neon.magenta {
    color: var(--neon-magenta);
    border-color: var(--neon-magenta);
    text-shadow: 0 0 5px var(--neon-magenta);
    box-shadow: 0 0 10px rgba(255, 0, 255, 0.3), inset 0 0 10px rgba(255, 0, 255, 0.2);
  }
  .btn-neon.magenta:active {
    background: var(--neon-magenta);
    color: var(--bg-dark);
  }
`}</style>}{<div className={"synth-grid"} />}{<div style={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: "40%",
      background: "linear-gradient(to bottom, rgba(255,0,255,0.1), transparent)",
      pointerEvents: "none"
    }} />}{<div style={{
      position: "absolute",
      inset: 0,
      zIndex: 1
    }} onPointerDown={value => {
      if (value.isPrimary !== false && !(value.button > 0)) {
        dropBlock();
      }
    }}>{<canvas ref={canvasRef} style={{
        width: "100%",
        height: "100%",
        display: "block",
        touchAction: "none"
      }} />}</div>}{(phase === "ready" || phase === "playing") && <output className={"synth-score"} aria-label={"Punti"}>{String(score2).split("").map((digit, index) => <span className={"synth-score-digit"} key={index}>{digit}</span>)}</output>}{phase === "ready" && <p className={"feed-first-action"} style={{
      position: "absolute",
      top: "100px",
      left: 30,
      right: 30,
      margin: 0,
      textAlign: "center",
      color: "#e8e3ff",
      font: "18px/1.4 var(--font-body)",
      zIndex: 12,
      pointerEvents: "none"
    }}>{"Tocca per impilare"}</p>}{"over" === phase && <div style={{
      position: "absolute",
      inset: 0,
      zIndex: 20,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(11,2,19,0.9)"
    }}>{<h2 style={{
        fontFamily: "var(--font-display)",
        color: "var(--neon-magenta)",
        textShadow: "0 0 6px var(--neon-magenta)",
        fontSize: "clamp(28px, 8cqi, 40px)",
        fontWeight: 400,
        fontSynthesis: "none",
        lineHeight: 1.3,
        margin: "0 0 12px"
      }}>{config.TXT_GAMEOVER || "PARTITA FINITA"}</h2>}{<div style={{
        fontFamily: "var(--font-display)",
        color: "#fff",
        fontSize: "28px",
        fontWeight: 400,
        fontSynthesis: "none",
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1.4,
        maxWidth: "calc(100% - 60px)",
        overflowWrap: "anywhere",
        textAlign: "center",
        marginBottom: "40px"
      }}>{"PUNTI: "}{score2}</div>}{<div style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        alignItems: "center"
      }}>{<button className={"btn-neon"} onClick={resetTower}>{config.BTN_RESTART || "RIGIOCA"}</button>}{canSubmit && <button className={"btn-neon magenta"} disabled={submitting} onClick={submitRecording} style={{
          opacity: submitting ? 0.5 : 1
        }}>{config.BTN_POST || "CONDIVIDI"}</button>}</div>}</div>}</div> : <div style={{
    width: "100%",
    height: "100%",
    background: "#0b0213"
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
        "data-game": "17"
      }[name] ?? null;
    },
    dataset: {
      game: "17"
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
