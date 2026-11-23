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
    "id": "MATCH_THRESHOLD",
    "kind": "number",
    "label": "匹配成功阈值(%)",
    "value": 90,
    "default": 90,
    "min": 50,
    "max": 100,
    "step": 1
  }],
  "texts": [{
    "id": "TXT_LEVEL",
    "label": "关卡文案",
    "value": "LIVELLO",
    "default": "LIVELLO",
    "max_length": 15
  }, {
    "id": "TXT_TARGET",
    "label": "目标颜色文案",
    "value": "Colore da ottenere",
    "default": "Colore da ottenere",
    "max_length": 25
  }, {
    "id": "TXT_MATCH",
    "label": "匹配进度文案",
    "value": "Corrispondenza",
    "default": "Corrispondenza",
    "max_length": 15
  }, {
    "id": "TXT_SUCCESS_MSG",
    "label": "过关提示语",
    "value": "Colore perfetto!",
    "default": "Colore perfetto!",
    "max_length": 30
  }, {
    "id": "TXT_NEXT",
    "label": "下一关按钮",
    "value": "Prossimo livello",
    "default": "Prossimo livello",
    "max_length": 20
  }, {
    "id": "TXT_POST",
    "label": "投稿按钮",
    "value": "Condividi",
    "default": "Condividi",
    "max_length": 20
  }],
  "images": [{
    "id": "IMG_TUBE_RED",
    "label": "红色颜料管",
    "path": "./assets/tube_red.webp",
    "replaceable": true
  }, {
    "id": "IMG_TUBE_YELLOW",
    "label": "黄色颜料管",
    "path": "./assets/tube_yellow.webp",
    "replaceable": true
  }, {
    "id": "IMG_TUBE_BLUE",
    "label": "蓝色颜料管",
    "path": "./assets/tube_blue.webp",
    "replaceable": true
  }, {
    "id": "IMG_TUBE_WHITE",
    "label": "白色颜料管",
    "path": "./assets/tube_white.webp",
    "replaceable": true
  }, {
    "id": "IMG_TUBE_BLACK",
    "label": "黑色颜料管",
    "path": "./assets/tube_black.webp",
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
    @font-face {
      font-family: DynaPuff;
      src: url("./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2") format("woff2");
      font-weight: 600; font-style: normal; font-display: swap;
    }
    :root {
      --font-display: DynaPuff, system-ui, sans-serif;
      --font-mono: ui-monospace, Menlo, monospace;
      --color-panel: #fff;
      --color-text: #1f2937;
    }
    * { box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      overscroll-behavior: none;
      overscroll-behavior-y: none;
      touch-action: none;
    }
    #root {
      position: relative;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      overscroll-behavior: none;
      touch-action: none;
      contain: layout paint size;
    }
    body {
      background: #f6f7f9;
      color: #1f2937;
      -webkit-tap-highlight-color: transparent;
      -webkit-user-select: none;
      user-select: none;
    }
    img { -webkit-touch-callout: none; }
    #root, #root * { touch-action: none !important; }
    button { min-width: 44px; min-height: 44px; }
    #paint-drag-indicator {
      position: fixed;
      left: 0;
      top: 0;
      width: 48px;
      height: 48px;
      box-sizing: border-box;
      border: 3px solid rgba(15, 23, 42, .78);
      border-radius: 50%;
      box-shadow: 0 8px 16px rgba(0, 0, 0, .28);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translate3d(-80px, -80px, 0);
      will-change: transform;
      z-index: 9999;
    }
    /* Iteration repair: replace mislabeled source art with accurate, draggable paint controls. */
    div:has(> img[src*="tube_"]) { position: relative !important; }
    img[src*="tube_"] { opacity: 0 !important; position: relative; z-index: 2; }
    div:has(> img[src*="tube_"])::after {
      content: "";
      position: absolute;
      left: 4px;
      right: 4px;
      bottom: 0;
      height: 104px;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding-bottom: 10px;
      border: 3px solid rgba(15,23,42,.72);
      border-radius: 14px 14px 9px 9px;
      box-sizing: border-box;
      color: #fff;
      font: 700 11px/1 Arial, sans-serif;
      letter-spacing: .03em;
      text-shadow: 0 1px 2px #000;
      box-shadow: 0 5px 10px rgba(0,0,0,.2);
      pointer-events: none;
    }
    div:has(> img[src*="tube_red"])::after { background: linear-gradient(#ff8794,#d62839); }
    div:has(> img[src*="tube_yellow"])::after { background: linear-gradient(#ffe66d,#e0a800); }
    div:has(> img[src*="tube_blue"])::after { background: linear-gradient(#71c7ff,#2166d1); }
    div:has(> img[src*="tube_white"])::after { background: linear-gradient(#fff,#dfe7ef); }
    div:has(> img[src*="tube_black"])::after { background: linear-gradient(#4b5563,#070b12); }
    /* Keep the target bowl clear of the tube dock on compact portrait screens. */
    @media (max-height: 600px) {
      #root > div > div:nth-of-type(1) { padding: calc(40px + env(safe-area-inset-top, 0px)) 25px 10px !important; }
      #root > div > div:nth-of-type(1) > div { padding: 10px !important; gap: 6px !important; }
      #root > div > div:nth-of-type(2) { padding: 6px !important; }
      #root > div > div:nth-of-type(2) > div { width: min(60vw, 220px) !important; }
      #root > div > div:nth-of-type(3) { padding: 10px 25px calc(40px + env(safe-area-inset-bottom, 0px)) !important; }
      #root > div > div:nth-of-type(3) > div { height: 82px !important; }
      div:has(> img[src*="tube_"])::after { height: 78px; }
    }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}


.color-round{position:absolute;top:30px;left:30px}.color-match-hud{position:absolute;top:30px;right:30px}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .color-guide{position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

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
function usePaintAudio() {
  let audioReadyRef = React.useRef(false);
  let instrumentsRef = React.useRef({});
  return {
    initAudio: async () => {
      if (!audioReadyRef.current) try {
        await Tone.start();
        instrumentsRef.current.pop = new Tone.Synth({
          oscillator: {
            type: "sine"
          },
          envelope: {
            attack: 0.01,
            decay: 0.2,
            sustain: 0,
            release: 0.1
          }
        }).toDestination();
        instrumentsRef.current.drop = new Tone.MembraneSynth({
          pitchDecay: 0.05,
          octaves: 4,
          envelope: {
            attack: 0.01,
            decay: 0.4,
            sustain: 0.1,
            release: 0.4
          }
        }).toDestination();
        instrumentsRef.current.win = new Tone.PolySynth(Tone.Synth).toDestination();
        instrumentsRef.current.pop.volume.value = -12;
        instrumentsRef.current.drop.volume.value = -10;
        instrumentsRef.current.win.volume.value = -8;
        audioReadyRef.current = true;
      } catch (value) {
        console.warn("Audio init failed", value);
      }
    },
    playSound: value => {
      if (!audioReadyRef.current || !instrumentsRef.current[value]) return;
      let timestamp = Tone.now();
      try {
        if (value === "pop") {
          instrumentsRef.current.pop.triggerAttackRelease("C5", "16n", timestamp);
        }
        if (value === "drop") {
          instrumentsRef.current.drop.triggerAttackRelease("G2", "8n", timestamp);
        }
        if (value === "win") {
          instrumentsRef.current.win.triggerAttackRelease(["C4", "E4", "G4", "C5"], "4n", timestamp);
        }
      } catch {}
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
var PIGMENT_COLORS = {
  red: [220, 40, 40],
  yellow: [240, 200, 40],
  blue: [40, 80, 220],
  white: [240, 240, 240],
  black: [40, 40, 40]
};
function mixPigments(pigments) {
  if (!pigments || pigments.length === 0) return null;
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  pigments.forEach(item => {
    redTotal += item[0];
    greenTotal += item[1];
    blueTotal += item[2];
  });
  let count = pigments.length;
  return [Math.round(redTotal / count), Math.round(greenTotal / count), Math.round(blueTotal / count)];
}
function colorDistance(firstColor, secondColor) {
  return !firstColor || !secondColor ? 1000 : Math.sqrt(Math.pow(firstColor[0] - secondColor[0], 2) + Math.pow(firstColor[1] - secondColor[1], 2) + Math.pow(firstColor[2] - secondColor[2], 2));
}
var MAX_COLOR_DISTANCE = Math.sqrt(255 * 255 * 3);
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
function App() {
  let [config, setConfig] = React.useState(null);
  let {
    initAudio: initAudio,
    playSound: playSound
  } = usePaintAudio();
  let [phase, setPhase] = React.useState("playing");
  let [round, setRound] = React.useState(1);
  let [targetColor, setTargetColor] = React.useState([220, 40, 40]);
  let [pigments, setPigments] = React.useState([]);
  let bowlRef = React.useRef(null);
  let [dragState, setDragState] = React.useState({
    active: false,
    colorKey: null,
    img: null,
    x: 0,
    y: 0
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
  let chooseTargetColor = React.useCallback(() => {
    let value = Object.keys(PIGMENT_COLORS).filter(item => item !== "black");
    let value2 = Math.floor(Math.random() * 3) + 2;
    let items = [];
    for (let value3 = 0; value3 < value2; value3++) items.push(PIGMENT_COLORS[value[Math.floor(Math.random() * value.length)]]);
    setTargetColor(mixPigments(items));
    setPigments([]);
  }, []);
  React.useEffect(() => {
    chooseTargetColor();
  }, [chooseTargetColor]);
  let mixedColor = React.useMemo(() => mixPigments(pigments), [pigments]);
  let matchPercent = React.useMemo(() => {
    if (!mixedColor) return 0;
    let value = colorDistance(mixedColor, targetColor);
    let value2 = Math.max(0, 100 - value / (MAX_COLOR_DISTANCE * 0.4) * 100);
    return Math.min(100, Math.round(value2));
  }, [mixedColor, targetColor]);
  React.useEffect(() => {
    if (phase === "playing" && config && matchPercent >= (config.MATCH_THRESHOLD || 90)) {
      setPhase("over");
      playSound("win");
    }
  }, [matchPercent, phase, config, playSound]);
  let startPaintDrag = async (event, colorKey, argument3) => {
    if (event.isPrimary === false || phase !== "playing") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      active: true,
      colorKey: colorKey,
      img: null,
      x: 0,
      y: 0
    });
    await initAudio();
    playSound("pop");
  };
  let movePaintDrag = event => {
    if (dragState.active) {
      event.preventDefault();
    }
  };
  let finishPaintDrag = event => {
    if (dragState.active) {
      event.preventDefault();
      if (bowlRef.current) {
        let bounds = bowlRef.current.getBoundingClientRect();
        if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
          setPigments(value => [...value, PIGMENT_COLORS[dragState.colorKey]]);
          playSound("drop");
        }
      }
      setDragState({
        active: false,
        colorKey: null,
        img: null,
        x: 0,
        y: 0
      });
    }
  };
  let clearBowl = async () => {
    await initAudio();
    setPigments([]);
  };
  let nextRound = async () => {
    await initAudio();
    setRound(value => value + 1);
    chooseTargetColor();
    setPhase("playing");
  };
  let {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: submitRecording
  } = useRecordingSubmission();
  if (!config) return <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#f6f7f9"
  }} />;
  let paintTubes = [{
    key: "red",
    img: config.IMG_TUBE_RED
  }, {
    key: "yellow",
    img: config.IMG_TUBE_YELLOW
  }, {
    key: "blue",
    img: config.IMG_TUBE_BLUE
  }, {
    key: "white",
    img: config.IMG_TUBE_WHITE
  }, {
    key: "black",
    img: config.IMG_TUBE_BLACK
  }];
  let mixedColorCss = mixedColor ? `rgb(${mixedColor[0]},${mixedColor[1]},${mixedColor[2]})` : "transparent";
  let targetColorCss = `rgb(${targetColor[0]},${targetColor[1]},${targetColor[2]})`;
  return <div style={{
    width: "100%",
    height: "100%",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    fontFamily: "var(--font-display)",
    background: "#f6f7f9",
    containerType: "inline-size"
  }} onPointerMove={movePaintDrag} onPointerUp={finishPaintDrag} onPointerCancel={finishPaintDrag}>{<style />}{<div style={{
      flex: "0 0 auto",
      padding: "calc(84px + env(safe-area-inset-top, 0px)) 30px 16px",
      zIndex: 10
    }}>{<div style={{
        background: "var(--color-panel)",
        borderRadius: "20px",
        padding: "16px",
        boxShadow: "0 8px 16px rgba(0,0,0,0.1)",
        display: "flex",
        flexDirection: "column",
        gap: "12px"
      }}>{<div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>{<div>{<div className={"color-round"} style={{
              fontSize: "28px",
              color: "#475569",
              lineHeight: 1.2
            }} aria-label={"Turno " + round}>{"#"}{round}</div>}{<div style={{
              fontSize: "clamp(18px, 5cqi, 22px)",
              color: "var(--color-text)",
              fontWeight: "bold"
            }}>{config.TXT_TARGET}</div>}</div>}{<div style={{
            display: "flex",
            alignItems: "center",
            gap: "12px"
          }}>{<div style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              backgroundColor: targetColorCss,
              border: "3px solid white",
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)"
            }} />}{<button onClick={clearBowl} style={{
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              border: "none",
              background: "#f0f0f0",
              color: "#555",
              fontSize: "20px",
              cursor: "pointer",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
            }}>{"\u21BB"}</button>}</div>}</div>}{<div style={{
          display: "flex",
          alignItems: "center",
          gap: "12px"
        }}>{<span style={{
            fontSize: "16px",
            color: "#475569",
            fontWeight: "bold"
          }}>{config.TXT_MATCH}</span>}{<div style={{
            flex: 1,
            height: "12px",
            background: "#e0e0e0",
            borderRadius: "6px",
            overflow: "hidden"
          }}>{<Motion.motion.div animate={{
              width: `${matchPercent}%`
            }} transition={{
              type: "spring",
              bounce: 0,
              duration: 0.5
            }} style={{
              height: "100%",
              background: matchPercent >= config.MATCH_THRESHOLD ? "#4ade80" : "#facc15",
              borderRadius: "6px"
            }} />}</div>}{<span className={"color-match-hud"} style={{
            fontSize: "28px",
            color: "var(--color-text)",
            fontFamily: "var(--font-mono)",
            minWidth: "60px",
            textAlign: "right"
          }}>{matchPercent}{"%"}</span>}</div>}</div>}</div>}{<div style={{
      flex: 1,
      minHeight: 0,
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      padding: "20px"
    }}>{<div ref={bowlRef} style={{
        width: "clamp(200px, 70cqi, 400px)",
        aspectRatio: "1/1",
        borderRadius: "50%",
        background: pigments.length > 0 ? mixedColorCss : "#eef1f5",
        boxShadow: "inset 0 10px 20px rgba(0,0,0,0.15), 0 2px 5px rgba(255,255,255,0.2)",
        border: "8px solid #cbd5e1",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        transition: "background-color 0.3s ease",
        position: "relative",
        overflow: "hidden"
      }}>{pigments.length === 0 && <div style={{
          color: "#475569",
          fontSize: "18px",
          fontWeight: "bold",
          textAlign: "center",
          padding: "0 20px"
        }}>{"Trascina i colori"}{<br />}{"here"}</div>}</div>}</div>}{<div style={{
      flex: "0 0 auto",
      padding: "20px 25px",
      paddingBottom: "calc(40px + env(safe-area-inset-bottom, 0px))",
      background: "#fff",
      borderTopLeftRadius: "30px",
      borderTopRightRadius: "30px",
      boxShadow: "0 -4px 16px rgba(0,0,0,0.05)",
      zIndex: 10
    }}>{<div style={{
        display: "flex",
        justifyContent: "space-evenly",
        alignItems: "flex-end",
        height: "120px"
      }}>{paintTubes.map(event => <div style={{
          width: "18%",
          height: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-end",
          opacity: dragState.active && dragState.colorKey === event.key ? 0.3 : 1
        }} key={event.key}>{<img src={event.img} data-pigment={event.key} alt={{red:"Rosso",yellow:"Giallo",blue:"Blu",white:"Bianco",black:"Nero"}[event.key]} draggable={false} onPointerDown={value => startPaintDrag(value, event.key, event.img)} style={{
            width: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            cursor: "pointer",
            WebkitUserDrag: "none",
            touchAction: "none",
            filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.2))"
          }} />}</div>)}</div>}</div>}{dragState.active && dragState.img && <div style={{
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: 9999
    }}>{<img src={dragState.img} alt={"dragging"} style={{
        position: "absolute",
        left: dragState.x,
        top: dragState.y,
        width: "16cqi",
        height: "auto",
        transform: "translate(-50%, -50%) scale(1.1)",
        filter: "drop-shadow(0 10px 15px rgba(0,0,0,0.3))"
      }} />}</div>}{<Motion.AnimatePresence>{phase === "over" && <Motion.motion.div initial={{
        opacity: 0
      }} animate={{
        opacity: 1
      }} exit={{
        opacity: 0
      }} style={{
        position: "absolute",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "20px"
      }}>{<Motion.motion.div initial={{
          scale: 0.8,
          y: 50
        }} animate={{
          scale: 1,
          y: 0
        }} transition={{
          type: "spring"
        }} style={{
          background: "#fff",
          borderRadius: "24px",
          padding: "32px 24px",
          width: "100%",
          maxWidth: "340px",
          textAlign: "center",
          boxShadow: "0 20px 40px rgba(0,0,0,0.2)"
        }}>{<h2 style={{
            margin: "0 0 16px 0",
            color: "var(--color-text)",
            fontSize: "28px"
          }}>{config.TXT_SUCCESS_MSG}</h2>}{<div style={{
            width: "80px",
            height: "80px",
            borderRadius: "50%",
            margin: "0 auto 24px",
            background: mixedColorCss,
            border: "4px solid #eee"
          }} />}{<div style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px"
          }}>{<button onClick={nextRound} style={{
              width: "100%",
              padding: "16px",
              borderRadius: "16px",
              border: "none",
              background: "#15803d",
              color: "#fff",
              fontSize: "18px",
              fontWeight: "bold",
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(21,128,61,0.25)"
            }}>{config.TXT_NEXT}</button>}{canSubmit && <button type={"button"} disabled={submitting} onClick={submitRecording} style={{
              width: "100%",
              padding: "16px",
              borderRadius: "16px",
              border: "none",
              background: "#1d4ed8",
              color: "#fff",
              fontSize: "18px",
              fontWeight: "bold",
              cursor: "pointer",
              opacity: submitting ? 0.6 : 1,
              boxShadow: "0 4px 12px rgba(29,78,216,0.25)"
            }}>{config.TXT_POST}</button>}</div>}</Motion.motion.div>}</Motion.motion.div>}</Motion.AnimatePresence>}</div>;
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
        "data-game": "9"
      }[name] ?? null;
    },
    dataset: {
      game: "9"
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
    const tube = paintApp.querySelector(".color-tubes img[data-pigment=\"red\"]");
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
    const value2 = value.querySelector("img[data-pigment=\"red\"]");
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

// Game interaction

// Track the drag marker outside the React layout so the game UI never reflows.
(function () {
  var indicator = document.getElementById('paint-drag-indicator');
  var activePointerId = null;
  var colors = {
    red: '#dc2828',
    yellow: '#f0c828',
    blue: '#2850dc',
    white: '#f4f4f4',
    black: '#282828'
  };
  function moveIndicator(event) {
    indicator.style.transform = 'translate3d(' + (event.clientX - 24) + 'px,' + (event.clientY - 24) + 'px,0)';
  }
  function endIndicator(event) {
    if (activePointerId === null || event.pointerId != null && event.pointerId !== activePointerId) return;
    indicator.style.opacity = '0';
    indicator.style.visibility = 'hidden';
    activePointerId = null;
  }
  document.addEventListener('touchmove', function (event) {
    event.preventDefault();
  }, {
    passive: false
  });
  document.addEventListener('pointerdown', function (event) {
    var tube = event.target.closest && event.target.closest('img[data-pigment]');
    if (!tube) return;
    // The indicator is rendered by React after this listener is registered.
    indicator ||= document.getElementById('paint-drag-indicator');
    if (!indicator) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    indicator.style.background = colors[tube.dataset.pigment || (tube.alt || '').toLowerCase()] || '#ffffff';
    indicator.style.opacity = '1';
    indicator.style.visibility = 'visible';
    moveIndicator(event);
  }, {
    capture: true,
    passive: false
  });
  document.addEventListener('pointermove', function (event) {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();
    moveIndicator(event);
  }, {
    capture: true,
    passive: false
  });
  document.addEventListener('pointerup', endIndicator, {
    capture: true
  });
  document.addEventListener('pointercancel', endIndicator, {
    capture: true
  });
  document.addEventListener('lostpointercapture', endIndicator, {
    capture: true
  });
  window.addEventListener('blur', function () {
    endIndicator({});
  });
})();
ReactDOM.createRoot(document.getElementById("root")).render(<React.Fragment><App /><div id={"paint-drag-indicator"} aria-hidden={"true"}></div></React.Fragment>);

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

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [".color-guide"];
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
