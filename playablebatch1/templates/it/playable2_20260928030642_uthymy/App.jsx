// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "TRIES_BASE",
    "kind": "number",
    "label": "Base Tries",
    "value": 6,
    "default": 6,
    "min": 3,
    "max": 10,
    "step": 1
  }, {
    "id": "PEELER_SPEED",
    "kind": "number",
    "label": "Peeler Speed",
    "value": 0.08,
    "default": 0.08,
    "min": 0.02,
    "max": 0.2,
    "step": 0.01
  }, {
    "id": "DROP_SPEED",
    "kind": "number",
    "label": "Drop Speed",
    "value": 0.3,
    "default": 0.3,
    "min": 0.1,
    "max": 1,
    "step": 0.05
  }, {
    "id": "PEEL_WIDTH",
    "kind": "number",
    "label": "Peel Width",
    "value": 46.8,
    "default": 46.8,
    "min": 20,
    "max": 80,
    "step": 4
  }],
  "texts": [{
    "id": "TXT_PERFECT",
    "label": "Perfect Peel Text",
    "value": "Sbucciatura perfetta",
    "default": "Sbucciatura perfetta",
    "max_length": 20
  }, {
    "id": "TXT_FAIL_TITLE",
    "label": "Fail Title",
    "value": "TENTATIVI FINITI!",
    "default": "TENTATIVI FINITI!",
    "max_length": 20
  }, {
    "id": "TXT_FAIL_DESC",
    "label": "Fail Desc",
    "value": "Sbuccia tutto in 5 tentativi.",
    "default": "Sbuccia tutto in 5 tentativi.",
    "max_length": 60
  }, {
    "id": "TXT_CLEAR_TITLE",
    "label": "Clear Title",
    "value": "SFIDA COMPLETATA!",
    "default": "SFIDA COMPLETATA!",
    "max_length": 30
  }, {
    "id": "TXT_CLEAR_DESC",
    "label": "Clear Desc",
    "value": "Hai sbucciato la patata alla perfezione!",
    "default": "Hai sbucciato la patata alla perfezione!",
    "max_length": 60
  }, {
    "id": "TXT_POST",
    "label": "Post Button Text",
    "value": "Condividi",
    "default": "Condividi",
    "max_length": 20
  }],
  "images": [{
    "id": "PEELER_IMG",
    "label": "Peeler Sprite",
    "path": "./assets/peeler.webp",
    "replaceable": true
  }, {
    "id": "POTATO_UNPEELED",
    "label": "Unpeeled Potato",
    "path": "./assets/potato_unpeeled_v2.webp",
    "replaceable": true
  }, {
    "id": "POTATO_PEELED",
    "label": "Peeled Potato",
    "path": "./assets/potato_peeled_v2.webp",
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


.peeler-hud{display:flex;flex-direction:column}.peeler-hud>h1{order:2;font-size:24px!important;margin-top:16px!important}.peeler-hud>div{order:1;margin:0!important}.peeler-hud .glass-panel{background:none;border:0;box-shadow:none;padding:0!important}.peeler-hud .glass-panel:first-child{text-align:left}.peeler-hud .glass-panel:last-child{text-align:right}.peeler-hud span[style*="display: block"]{display:inline!important;font-size:12px!important;margin-right:6px}

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
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .meeting-peeler-guide{position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.meeting-peeler-guide p){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.meeting-peeler-guide p){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.meeting-peeler-guide p){animation:none!important}}

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
function GameStyles() {
  return <style>{`
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
      --color-bg: #E8F0FE;
      --color-hud: #FFFFFF;
      --color-text: #1C2B4E;
      --color-primary: #FF7E67;
      --color-success: #4CAF50;
    }
    html, body, #root { 
      width: 100%; height: 100%; margin: 0; padding: 0; 
      overflow: hidden; background: var(--color-bg);
      touch-action: none; user-select: none; -webkit-user-select: none;
    }
    * { box-sizing: border-box; }
    
    .text-stroke {
      -webkit-text-stroke: 1px rgba(255,255,255,0.8);
      text-shadow: 2px 2px 0px rgba(0,0,0,0.1);
    }
    .glass-panel {
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 16px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      border: 2px solid rgba(255,255,255,0.9);
    }
  `}</style>;
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
var audioDestination = Tone.getContext().destination;
function audioNow() {
  return Tone.getContext().now();
}
var FRUIT_LEVELS = ["PATATA"];
var buttonStyle = {
  fontFamily: "var(--font-display)",
  fontSize: "24px",
  color: "#FFF",
  background: "var(--color-text)",
  border: "none",
  borderRadius: "12px",
  padding: "16px",
  width: "100%",
  cursor: "pointer",
  boxShadow: "0 4px 0 rgba(0,0,0,0.2)",
  textTransform: "uppercase"
};
function FruitPeelerGame() {
  let [hasDropped, setHasDropped] = React.useState(false);
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("playing");
  let [levelIndex, setLevelIndex] = React.useState(0);
  let [remainingDrops, setRemainingDrops] = React.useState(0);
  let [totalDrops, setTotalDrops] = React.useState(6);
  let [peeledPercent, setPeeledPercent] = React.useState(0);
  let sceneRef = React.useRef(null);
  let peelCanvasRef = React.useRef(null);
  let peelerRef = React.useRef({
    x: 50,
    y: 0,
    state: "moving",
    dir: 1,
    initArea: 1,
    peels: []
  });
  let animationRef = React.useRef(null);
  let sourceImageRef = React.useRef(null);
  let audioReadyRef = React.useRef(false);
  let instrumentsRef = React.useRef({});
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
        let configValues = readConfigValues(options);
        setConfig(configValues);
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  let initAudio = async () => {
    if (!audioReadyRef.current) try {
      await Tone.start();
      instrumentsRef.current.swoosh = new Tone.MembraneSynth({
        pitchDecay: 0.1,
        octaves: 4,
        oscillator: {
          type: "sine"
        }
      }).toDestination();
      instrumentsRef.current.peel = new Tone.NoiseSynth({
        noise: {
          type: "pink"
        },
        envelope: {
          attack: 0.05,
          decay: 0.1,
          sustain: 0.1,
          release: 0.2
        }
      }).toDestination();
      instrumentsRef.current.win = new Tone.PolySynth(Tone.Synth).toDestination();
      instrumentsRef.current.fail = new Tone.Synth({
        oscillator: {
          type: "fmsquare"
        }
      }).toDestination();
      audioDestination.volume.value = -8;
      audioReadyRef.current = true;
    } catch (value) {
      console.warn("Audio init failed", value);
    }
  };
  let playPeelSound = React.useCallback(value => {
    var instrument;
    var instrument2;
    var instrument3;
    var instrument4;
    var instrument5;
    if (!audioReadyRef.current) return;
    let current = instrumentsRef.current;
    let value2 = audioNow();
    try {
      if (value === "drop") {
        if (!((instrument = current.swoosh) == null)) {
          instrument.triggerAttackRelease("C3", "8n", value2);
        }
      }
      if (value === "peel") {
        if (!((instrument2 = current.peel) == null)) {
          instrument2.triggerAttackRelease("16n", value2);
        }
      }
      if (value === "win") {
        if (!((instrument3 = current.win) == null)) {
          instrument3.triggerAttackRelease(["C4", "E4", "G4", "C5"], "4n", value2);
        }
      }
      if (value === "fail") {
        if (!((instrument4 = current.fail) == null)) {
          instrument4.triggerAttackRelease("C3", "4n", value2);
        }
        if (!((instrument5 = current.fail) == null)) {
          instrument5.triggerAttackRelease("G2", "4n", value2 + 0.3);
        }
      }
    } catch {}
  }, []);
  let calculatePeelCoverage = React.useCallback((value, otherValue, argument3) => {
    try {
      let data = value.getImageData(0, 0, otherValue, argument3).data;
      let value2 = 0;
      for (let value4 = 3; value4 < data.length; value4 += 4) {
        if (data[value4] > 128) {
          value2++;
        }
      }
      if (peelerRef.current.initArea <= 0) return 0;
      let value3 = 1 - Math.max(0, value2) / peelerRef.current.initArea;
      return Math.min(100, Math.floor(value3 * 100));
    } catch {
      return 0;
    }
  }, []);
  let resetLevel = React.useCallback((value, config2) => {
    if (!config2) return;
    let value2 = 5;
    setHasDropped(false);
    setTotalDrops(value2);
    setRemainingDrops(value2);
    setPeeledPercent(0);
    peelerRef.current = {
      x: 50,
      y: 0,
      state: "moving",
      dir: 1,
      initArea: 1,
      peels: []
    };
    let POTATO_UNPEELED = config2.POTATO_UNPEELED;
    let image = new Image();
    image.__directFileSafe = true;
    image.src = POTATO_UNPEELED;
    image.onload = () => {
      if (sourceImageRef.current = image, !sceneRef.current) return;
      let dimensions = sceneRef.current;
      let context = dimensions.getContext("2d", {
        willReadFrequently: true
      });
      let width = dimensions.width;
      let height = dimensions.height;
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "source-over";
      let value3 = Math.min(width / image.naturalWidth, height / image.naturalHeight) * 0.9;
      let value4 = image.naturalWidth * value3;
      let value5 = image.naturalHeight * value3;
      let value6 = (width - value4) / 2;
      let value7 = (height - value5) / 2;
      context.drawImage(image, value6, value7, value4, value5);
      try {
        let data = context.getImageData(0, 0, width, height).data;
        let value8 = 0;
        for (let value9 = 3; value9 < data.length; value9 += 4) {
          if (data[value9] > 128) {
            value8++;
          }
        }
        peelerRef.current.initArea = Math.max(1, value8);
      } catch {
        peelerRef.current.initArea = width * height;
      }
    };
    image.onerror = () => {
      if (!sceneRef.current) return;
      let dimensions = sceneRef.current;
      let context = dimensions.getContext("2d", {
        willReadFrequently: true
      });
      context.clearRect(0, 0, dimensions.width, dimensions.height);
      context.fillStyle = "#666";
      context.beginPath();
      context.arc(dimensions.width / 2, dimensions.height / 2, dimensions.width * 0.4, 0, Math.PI * 2);
      context.fill();
      peelerRef.current.initArea = Math.PI * Math.pow(dimensions.width * 0.4, 2);
    };
  }, []);
  let dropPeeler = value => {
    if (value.isPrimary !== false) {
      initAudio();
      if (phase === "playing" && peelerRef.current.state === "moving" && remainingDrops > 0) {
        setHasDropped(true);
        peelerRef.current.state = "dropping";
        playPeelSound("drop");
      }
    }
  };
  React.useEffect(() => {
    if (phase !== "playing" || !config) return;
    let timestamp = performance.now();
    let value = config.PEELER_SPEED || 0.1;
    let value2 = config.DROP_SPEED || 0.5;
    let value3 = config.PEEL_WIDTH || 40;
    let handleAction = value4 => {
      var value5;
      var value6;
      let value7 = Math.min(value4 - timestamp, 50);
      timestamp = value4;
      let point = peelerRef.current;
      let value8 = ((value5 = peelCanvasRef.current) == null ? void 0 : value5.clientWidth) || 300;
      let value9 = ((value6 = peelCanvasRef.current) == null ? void 0 : value6.clientHeight) || 400;
      if (point.state === "moving") {
        let value10 = value * (1 + levelIndex * 0.05);
        point.x += value10 * point.dir * value7;
        if (point.x < 10) {
          point.x = 10;
          point.dir = 1;
        }
        if (point.x > 90) {
          point.x = 90;
          point.dir = -1;
        }
      } else if (point.state === "dropping") {
        if (point.y += value2 * value7, point.y >= 100) {
          if (playPeelSound("peel"), sceneRef.current) {
            let dimensions = sceneRef.current;
            let context = dimensions.getContext("2d");
            let value10 = point.x / 100 * dimensions.width;
            context.globalCompositeOperation = "destination-out";
            context.lineCap = "round";
            context.lineJoin = "round";
            context.lineWidth = value3;
            context.beginPath();
            context.moveTo(value10, 0);
            context.lineTo(value10, dimensions.height);
            context.stroke();
            let half = value3 / dimensions.width * 50;
            peelerRef.current.peels.push({
              start: Math.max(24, point.x - half),
              end: Math.min(76, point.x + half)
            });
            let ranges = peelerRef.current.peels.slice().sort((x, y) => x.start - y.start);
            let covered = 0;
            let start = -1;
            let value11 = -1;
            for (let range of ranges) {
              if (range.start > value11) {
                covered += Math.max(0, value11 - start);
                start = range.start;
                value11 = range.end;
              } else {
                value11 = Math.max(value11, range.end);
              }
            }
            covered += Math.max(0, value11 - start);
            let value12 = Math.min(100, Math.floor(covered / 52 * 100));
            setPeeledPercent(value12);
            setRemainingDrops(value13 => {
              let next = Math.max(0, value13 - 1);
              if (next === 0 && value12 < 100) {
                setTimeout(() => {
                  setPhase("level_fail");
                  playPeelSound("fail");
                }, 0);
              }
              return next;
            });
          }
          point.state = "returning";
        }
      } else {
        if (point.state === "returning") {
          point.y -= value2 * 1.5 * value7;
          if (point.y <= 0) {
            point.y = 0;
            point.state = "moving";
          }
        }
      }
      let elementById = document.getElementById("peeler-sprite");
      if (elementById) {
        (() => {
          let dimensions = sceneRef.current?.getBoundingClientRect();
          let value10 = elementById.parentElement?.getBoundingClientRect();
          if (dimensions && value10) {
            elementById.style.left = `${dimensions.left - value10.left + point.x / 100 * dimensions.width}px`;
            elementById.style.top = `${Math.max(8, dimensions.top - value10.top + point.y / 100 * dimensions.height - elementById.clientHeight * 0.55)}px`;
            elementById.style.transform = "translateX(-50%)";
          }
        })();
      }
      animationRef.current = requestAnimationFrame(handleAction);
    };
    animationRef.current = requestAnimationFrame(handleAction);
    return () => cancelAnimationFrame(animationRef.current);
  }, [phase, config, levelIndex, calculatePeelCoverage, playPeelSound]);
  React.useEffect(() => {
    if (phase === "playing" && peeledPercent >= 100) {
      if (sceneRef.current) {
        let dimensions = sceneRef.current;
        dimensions.getContext("2d").clearRect(0, 0, dimensions.width, dimensions.height);
      }
      setPeeledPercent(100);
      setPhase("game_clear");
      playPeelSound("win");
    }
  }, [peeledPercent, phase, playPeelSound]);
  React.useEffect(() => {
    if (config && (phase === "playing" || phase === "level_success" || phase === "level_fail") && remainingDrops === 0 && peeledPercent === 0) {
      resetLevel(levelIndex, config);
    }
  }, [config, levelIndex, resetLevel]);
  let nextLevel = () => {
    setLevelIndex(value => value + 1);
    resetLevel(levelIndex + 1, config);
    setPhase("playing");
  };
  let restartGame = () => {
    setLevelIndex(0);
    resetLevel(0, config);
    setPhase("playing");
  };
  if (!config) return <div style={{
    width: "100%",
    height: "100%",
    background: "#E8F0FE"
  }} />;
  let levelDefinition = FRUIT_LEVELS[levelIndex % FRUIT_LEVELS.length];
  let dropCountColor = remainingDrops <= 1 ? "var(--color-primary)" : "var(--color-text)";
  return <div style={{
    width: "100%",
    height: "100%",
    position: "relative",
    containerType: "size",
    display: "flex",
    flexDirection: "column"
  }} onPointerDown={dropPeeler}>{<div className={"peeler-hud"} style={{
      flex: "0 0 auto",
      padding: "calc(30px + env(safe-area-inset-top, 0px)) 30px 16px",
      textAlign: "center",
      zIndex: 10
    }}>{<h1 style={{
        fontFamily: "var(--font-display)",
        margin: 0,
        fontSize: "clamp(28px, 8cqi, 40px)",
        color: "var(--color-text)",
        textTransform: "uppercase",
        letterSpacing: "2px"
      }}>{"PATATA"}</h1>}{<div style={{
        display: "grid",
        gridTemplateColumns: "repeat(2,minmax(0,1fr))",
        gap: "12px",
        margin: "12px auto 0",
        width: "100%",
        maxWidth: "330px"
      }}>{<div className={"glass-panel"} role={"status"} aria-live={"polite"} aria-atomic={"true"} style={{
          padding: "8px",
          minWidth: 0,
          boxSizing: "border-box"
        }}>{<span style={{
            fontFamily: "var(--font-display)",
            fontSize: "28px",
            color: "var(--color-text)",
            whiteSpace: "nowrap"
          }}>{<span style={{
              fontSize: 12,
              display: "block"
            }}>{"Tentativi"}</span>}{<span style={{
              color: dropCountColor
            }}>{remainingDrops}</span>}</span>}</div>}{<div className={"glass-panel"} style={{
          padding: "8px",
          minWidth: 0,
          boxSizing: "border-box"
        }}>{<span style={{
            fontFamily: "var(--font-display)",
            fontSize: "28px",
            color: "var(--color-text)",
            whiteSpace: "nowrap"
          }}>{<span style={{
              fontSize: 12,
              display: "block"
            }}>{"Sbucciato"}</span>}{<span style={{
              color: peeledPercent >= 100 ? "var(--color-success)" : "var(--color-text)"
            }}>{peeledPercent}{"%"}</span>}</span>}</div>}</div>}</div>}{<div ref={peelCanvasRef} style={{
      flex: 1,
      minHeight: 0,
      position: "relative",
      overflow: "hidden"
    }}>{<div style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none"
      }}>{<img src={config.POTATO_PEELED} alt={"patata sbucciata"} style={{
          width: "60%",
          height: "auto",
          aspectRatio: "1 / 1",
          objectFit: "contain",
          transform: "scale(.9)"
        }} />}</div>}{<div style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none"
      }}>{<canvas ref={sceneRef} width={300} height={300} style={{
          width: "60%",
          height: "auto",
          aspectRatio: "1 / 1",
          objectFit: "contain"
        }} />}</div>}{<img id={"peeler-sprite"} src={config.PEELER_IMG} alt={"pelapatate"} style={{
        position: "absolute",
        top: "10%",
        left: 0,
        width: "24.3%",
        aspectRatio: "23/26",
        objectFit: "contain",
        pointerEvents: "none",
        zIndex: 5,
        willChange: "transform"
      }} />}</div>}{<div style={{
      flex: "0 0 auto",
      padding: "16px 30px calc(50px + env(safe-area-inset-bottom, 0px))",
      textAlign: "center",
      minHeight: "80px",
      zIndex: 10,
      boxSizing: "border-box"
    }}>{<Motion.AnimatePresence>{phase === "playing" && <Motion.motion.p initial={{
          opacity: 0,
          y: 10
        }} animate={{
          opacity: 1,
          y: 0
        }} exit={{
          opacity: 0
        }} style={{
          fontFamily: "var(--font-display)",
          fontSize: "18px",
          color: "#1c2b4e",
          margin: 0,
          visibility: hasDropped ? "hidden" : "visible"
        }} aria-hidden={hasDropped}>{"Tocca per sbucciare"}</Motion.motion.p>}</Motion.AnimatePresence>}</div>}{<Motion.AnimatePresence>{phase !== "playing" && <Motion.motion.div initial={{
        opacity: 0
      }} animate={{
        opacity: 1
      }} exit={{
        opacity: 0
      }} style={{
        position: "absolute",
        inset: 0,
        background: "rgba(232, 240, 254, 0.9)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "24px"
      }}>{<Motion.motion.div initial={{
          scale: 0.8
        }} animate={{
          scale: 1
        }} className={"glass-panel"} style={{
          padding: "40px 24px",
          textAlign: "center",
          width: "100%",
          maxWidth: "360px",
          background: phase === "level_fail" ? "rgba(255,235,238,0.9)" : "rgba(255,255,255,0.9)"
        }}>{<h2 style={{
            fontFamily: "var(--font-display)",
            fontSize: "48px",
            margin: "0 0 16px 0",
            color: phase === "level_fail" ? "var(--color-primary)" : "var(--color-success)",
            lineHeight: 1
          }}>{phase === "level_success" && config.TXT_PERFECT}{phase === "level_fail" && config.TXT_FAIL_TITLE}{phase === "game_clear" && config.TXT_CLEAR_TITLE}</h2>}{<p style={{
            fontFamily: "var(--font-body)",
            fontSize: "18px",
            color: "var(--color-text)",
            margin: "0 0 32px 0",
            fontWeight: "bold"
          }}>{phase === "level_fail" && config.TXT_FAIL_DESC}{phase === "game_clear" && config.TXT_CLEAR_DESC}</p>}{<div style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px"
          }}>{phase === "level_success" && <button onClick={nextLevel} style={buttonStyle}>{"AVANTI"}</button>}{(phase === "level_fail" || phase === "game_clear") && <button onClick={restartGame} style={buttonStyle}>{"RIPROVA"}</button>}{(phase === "level_fail" || phase === "game_clear") && canSubmit && <button onClick={submitRecording} disabled={submitting} style={{
              ...buttonStyle,
              background: "#1DA1F2",
              opacity: submitting ? 0.6 : 1
            }}>{config.TXT_POST}</button>}</div>}</Motion.motion.div>}</Motion.motion.div>}</Motion.AnimatePresence>}</div>;
}
function App() {
  return <React.Fragment>{<GameStyles />}{<FruitPeelerGame />}</React.Fragment>;
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
        "data-subject": "#root img",
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
        "data-game": "32"
      }[name] ?? null;
    },
    dataset: {
      game: "32"
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
  const selectors = [".meeting-peeler-guide p"];
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
