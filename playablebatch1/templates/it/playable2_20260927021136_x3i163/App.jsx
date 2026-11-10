// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import Matter from 'matter-js';
import * as Tone from 'tone';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "GRAVITY_SCALE",
    "kind": "number",
    "label": "Gravity Scale",
    "value": 1.2,
    "default": 1.2,
    "min": 0.5,
    "max": 3,
    "step": 0.1
  }, {
    "id": "SPAWN_RATE",
    "kind": "number",
    "label": "Spawn Interval (ms)",
    "value": 1500,
    "default": 1500,
    "min": 500,
    "max": 4000,
    "step": 100
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "CUBI IN MOVIMENTO",
    "default": "CUBI IN MOVIMENTO",
    "max_length": 20
  }, {
    "id": "SUBTITLE",
    "label": "Subtitle",
    "value": "Tocca uno spazio libero per creare cubi",
    "default": "Tocca il cubo che cade!",
    "max_length": 40
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
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
    /* Iteration repair: restore the theme variables expected by the compiled runtime. */
    :root {
      --color-bg: #f5f7fa;
      --color-primary: #397ee8;
      --color-text-main: #15233a;
      --color-text-sub: #50627a;
      --font-display: Arial, system-ui, sans-serif;
      --font-body: Arial, system-ui, sans-serif;
    }
    /* Make the header legible and safely inset above the light physics area. */
    #root > div { background: var(--color-bg) !important; }
    #root > div > div:first-of-type { padding-top: 40px !important; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}


#root>div>div:first-of-type{padding-top:30px!important}

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
html[data-meeting-game="19"] .meeting-cube-heading{position:absolute!important;inset:0 0 auto!important;box-sizing:border-box!important;width:100%!important;background:transparent!important;pointer-events:none!important} html[data-meeting-game="19"] .meeting-cube-heading button{pointer-events:auto!important} html:root:root:root .meeting-cube-board{margin-top:0!important}
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
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .meeting-cube-heading>div>p{position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html[data-guide-action-used="true"]:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .meeting-cube-heading>div>p{visibility:hidden!important;opacity:0!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.meeting-cube-heading>div>p){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.meeting-cube-heading>div>p){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.meeting-cube-heading>div>p){animation:none!important}}

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
function App() {
  let cubeRootSize = 120;
  let cubeColors = ["#397ee8", "#e85b70", "#cf850e", "#1a9c78", "#8956d9", "#1892b5"];
  let [uiUsed, setUiUsed] = React.useState(false);
  let [config, setConfig] = React.useState(null);
  let sceneRef = React.useRef(null);
  let canvasRef = React.useRef(null);
  let engineRef = React.useRef(null);
  let animationRef = React.useRef(null);
  let resizeObserverRef = React.useRef(null);
  let audioReadyRef = React.useRef(false);
  let audioRef = React.useRef({});
  let clickFx = React.useRef([]);
  React.useEffect(() => {
    let enabled = true;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let x = await requestGameConfig();
        if (x.ok) {
          options = await x.json();
        }
      } catch {
        console.warn("Config fetch failed, using defaults");
      }
      if (enabled) {
        setConfig(readConfigValues(options));
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  let initAudio = async () => {
    if (!audioReadyRef.current) try {
      await Tone.start();
      let splitSynth = new Tone.MembraneSynth({
        pitchDecay: 0.02,
        octaves: 4,
        oscillator: {
          type: "square"
        },
        envelope: {
          attack: 0.001,
          decay: 0.1,
          sustain: 0,
          release: 0.1
        }
      }).toDestination();
      splitSynth.volume.value = -8;
      let spawnSynth = new Tone.Synth({
        oscillator: {
          type: "sine"
        },
        envelope: {
          attack: 0.05,
          decay: 0.2,
          sustain: 0,
          release: 0.1
        }
      }).toDestination();
      spawnSynth.volume.value = -12;
      audioRef.current = {
        splitSynth: splitSynth,
        spawnSynth: spawnSynth
      };
      audioReadyRef.current = true;
    } catch (value) {
      console.warn("Audio init failed", value);
    }
  };
  let playSplit = value => {
    if (!audioReadyRef.current || !audioRef.current.splitSynth) return;
    let instrument = audioRef.current.splitSynth;
    let x = Tone.now();
    let value2 = value === 1 ? "C3" : value === 2 ? "C4" : "C5";
    instrument.triggerAttackRelease(value2, "16n", x);
  };
  let playSpawn = () => {
    if (!audioReadyRef.current || !audioRef.current.spawnSynth) return;
    let timestamp = Tone.now();
    audioRef.current.spawnSynth.triggerAttackRelease("G3", "8n", timestamp);
  };
  let spawnCube = React.useCallback((value, otherValue, x, argument4, cubeSize) => {
    let {
      Bodies: value2,
      Composite: value3
    } = Matter;
    let y = Math.max(12, cubeSize ?? cubeRootSize * Math.pow(0.5, x - 1));
    let cubeColor = cubeColors[Math.min(cubeColors.length - 1, Math.max(0, Math.round(Math.log2(cubeRootSize / y))))];
    let value4 = value2.rectangle(value, otherValue, y, y, {
      restitution: 0.5,
      friction: 0.1,
      density: 0.001,
      render: {
        fillStyle: cubeColor || cubeColors[0]
      },
      plugin: {
        sizeLevel: x,
        size: y,
        color: cubeColor || cubeColors[0]
      }
    });
    Matter.Body.setAngularVelocity(value4, (Math.random() - 0.5) * 0.1);
    value3.add(argument4.world, value4);
    return value4;
  }, []);
  React.useEffect(() => {
    if (!config || !sceneRef.current || !canvasRef.current) return;
    clickFx.current = [];
    let {
      Engine: value,
      World: value2,
      Runner: x,
      Composite: value3
    } = Matter;
    let value4 = value.create();
    engineRef.current = value4;
    value4.gravity.y = config.GRAVITY_SCALE || 1.2;
    let dimensions = canvasRef.current;
    let y = dimensions.getContext("2d", {
      alpha: false
    });
    let clientWidth = sceneRef.current.clientWidth;
    let clientHeight = sceneRef.current.clientHeight;
    let value5 = window.devicePixelRatio || 1;
    dimensions.width = clientWidth * value5;
    dimensions.height = clientHeight * value5;
    dimensions.style.width = `${clientWidth}px`;
    dimensions.style.height = `${clientHeight}px`;
    let options = {
      isStatic: true,
      render: {
        visible: false
      }
    };
    let value6 = Matter.Bodies.rectangle(-25, clientHeight / 2, 50, clientHeight * 2, options);
    let value7 = Matter.Bodies.rectangle(clientWidth + 25, clientHeight / 2, 50, clientHeight * 2, options);
    let floorWidth = clientWidth + 100;
    let oldHeight = clientHeight;
    let floorBody = Matter.Bodies.rectangle(clientWidth / 2, clientHeight - 24, floorWidth, 48, options);
    value3.add(value4.world, [value6, value7, floorBody]);
    spawnCube(clientWidth / 2, Math.max(40 + cubeRootSize / 2, Math.min(clientHeight - 48 - cubeRootSize / 2, clientHeight * 0.42)), 1, value4, cubeRootSize);
    resizeObserverRef.current = null;
    let handleAction = () => {
      if (document.documentElement.dataset.meetingFyp !== "preview") {
        value.update(value4, 1000 / 60);
      }
      let value8 = value3.allBodies(value4.world);
      let live = value8.filter(item => !item.isStatic);
      if (live.length > 180) {
        live.slice(0, live.length - 180).forEach(item => value2.remove(value4.world, item));
        value8 = value3.allBodies(value4.world);
      }
      for (let value11 = 0; value11 < value8.length; value11++) {
        if (value8[value11].position.y > clientHeight + 200 && !value8[value11].isStatic) {
          value2.remove(value4.world, value8[value11]);
        }
      }
      y.save();
      let value9 = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim() || "#F5F7FA";
      y.fillStyle = value9;
      y.fillRect(0, 0, dimensions.width, dimensions.height);
      y.scale(value5, value5);
      y.fillStyle = "#dce6f2";
      y.fillRect(0, clientHeight - 48, clientWidth, 48);
      y.fillStyle = "#8ea6c7";
      y.fillRect(0, clientHeight - 48, clientWidth, 4);
      let value10 = getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim() || "#5190F0";
      value8.forEach(item => {
        if (item.isStatic) return;
        let size = item.plugin.size;
        y.translate(item.position.x, item.position.y);
        y.rotate(item.angle);
        y.fillStyle = item.plugin.color || value10;
        y.beginPath();
        let value11 = size * 0.15;
        let value12 = -size / 2;
        let value13 = -size / 2;
        y.moveTo(value12 + value11, value13);
        y.arcTo(value12 + size, value13, value12 + size, value13 + size, value11);
        y.arcTo(value12 + size, value13 + size, value12, value13 + size, value11);
        y.arcTo(value12, value13 + size, value12, value13, value11);
        y.arcTo(value12, value13, value12 + size, value13, value11);
        y.closePath();
        y.fill();
        y.rotate(-item.angle);
        y.translate(-item.position.x, -item.position.y);
      });
      let fxNow = performance.now();
      clickFx.current = clickFx.current.filter(item => fxNow - item.born < 240);
      clickFx.current.forEach(point => {
        let progress = (fxNow - point.born) / 240;
        let spread = 1 - Math.pow(1 - progress, 3);
        let radius = 8 + spread * Math.min(42, point.size * 0.7);
        y.save();
        y.globalAlpha = (1 - progress) * 0.65;
        y.strokeStyle = value10;
        y.lineWidth = 2.5 * (1 - progress) + 0.5;
        y.beginPath();
        y.arc(point.x, point.y, radius, 0, Math.PI * 2);
        y.stroke();
        y.fillStyle = value10;
        for (let value11 = 0; value11 < 8; value11++) {
          let angle = value11 * Math.PI / 4;
          let distance = radius * 1.2;
          y.beginPath();
          y.arc(point.x + Math.cos(angle) * distance, point.y + Math.sin(angle) * distance - 8 * spread, Math.max(0.5, 3 * (1 - progress)), 0, Math.PI * 2);
          y.fill();
        }
        y.restore();
      });
      y.restore();
      animationRef.current = requestAnimationFrame(handleAction);
    };
    handleAction();
    let handleAction2 = () => {
      clientWidth = sceneRef.current.clientWidth;
      clientHeight = sceneRef.current.clientHeight;
      dimensions.width = clientWidth * value5;
      dimensions.height = clientHeight * value5;
      dimensions.style.width = `${clientWidth}px`;
      dimensions.style.height = `${clientHeight}px`;
      Matter.Body.setPosition(value6, {
        x: -25,
        y: clientHeight / 2
      });
      Matter.Body.setPosition(value7, {
        x: clientWidth + 25,
        y: clientHeight / 2
      });
      Matter.Body.scale(value6, 1, clientHeight / oldHeight);
      Matter.Body.scale(value7, 1, clientHeight / oldHeight);
      oldHeight = clientHeight;
      Matter.Body.scale(floorBody, (clientWidth + 100) / floorWidth, 1);
      floorWidth = clientWidth + 100;
      Matter.Body.setPosition(floorBody, {
        x: clientWidth / 2,
        y: clientHeight - 24
      });
    };
    window.addEventListener("resize", handleAction2);
    return () => {
      window.removeEventListener("resize", handleAction2);
      cancelAnimationFrame(animationRef.current);
      clearInterval(resizeObserverRef.current);
      value.clear(value4);
      value2.clear(value4.world);
    };
  }, [config, spawnCube]);
  let handlePointerDown = event => {
    if (event.isPrimary === false || event.button != null && event.button !== 0 || !engineRef.current || !canvasRef.current) return;
    let {
      Query: value,
      Composite: x,
      Body: value2,
      World: value3
    } = Matter;
    let current = engineRef.current;
    let y = canvasRef.current.getBoundingClientRect();
    let width = canvasRef.current.clientWidth;
    let height = canvasRef.current.clientHeight;
    let value4 = (event.clientX - y.left) * width / y.width;
    let value5 = (event.clientY - y.top) * height / y.height;
    if (!Number.isFinite(value4) || !Number.isFinite(value5) || value4 < 0 || value4 > width || value5 < 0 || value5 > height - 48) return;
    event.preventDefault?.();
    setUiUsed(true);
    initAudio();
    let value6 = x.allBodies(current.world).filter(item2 => !item2.isStatic);
    let value7 = value.point(value6, {
      x: value4,
      y: value5
    });
    if (value7.length === 0) {
      let size = cubeRootSize;
      let margin = 25 + size / 2;
      let value10 = 40 + size / 2;
      let cubeX = Math.max(margin, Math.min(width - margin, value4));
      let cubeY = Math.max(value10, Math.min(height - 48 - size / 2, value5));
      spawnCube(cubeX, cubeY, 1, current, size);
      playSpawn();
      return;
    }
    let item = value7[value7.length - 1];
    let {
      sizeLevel: plugin,
      size: size2
    } = item.plugin;
    let point = item.position;
    playSplit(plugin);
    if (!window.matchMedia || !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      clickFx.current.push({
        x: point.x,
        y: point.y,
        size: size2,
        born: performance.now()
      });
      clickFx.current = clickFx.current.slice(-12);
    }
    if (size2 <= 20) {
      value2.setVelocity(item, {
        x: (Math.random() - 0.5) * 8,
        y: -8 - Math.random() * 2
      });
      value2.setAngularVelocity(item, (Math.random() < 0.5 ? -1 : 1) * (0.14 + Math.random() * 0.12));
      return;
    }
    value3.remove(current.world, item);
    let value8 = plugin + 1;
    let value9 = size2 / 4;
    [{
      x: point.x - value9,
      y: point.y - value9
    }, {
      x: point.x + value9,
      y: point.y - value9
    }, {
      x: point.x - value9,
      y: point.y + value9
    }, {
      x: point.x + value9,
      y: point.y + value9
    }].forEach(point2 => {
      let value10 = spawnCube(point2.x, point2.y, value8, current, size2 / 2);
      let side = point2.x < point.x ? -1 : 1;
      value2.setVelocity(value10, {
        x: Math.max(-3, Math.min(3, item.velocity.x * 0.35)) + side * (3.5 + Math.random() * 2.5),
        y: Math.min(-1, Math.max(-3, item.velocity.y * 0.2)) - (point2.y < point.y ? 6 : 3.5) - Math.random() * 2
      });
      value2.setAngularVelocity(value10, side * (0.14 + Math.random() * 0.12));
    });
  };
  let resetCubes = () => {
    if (initAudio(), !engineRef.current) return;
    clickFx.current = [];
    setUiUsed(false);
    let current = engineRef.current;
    let x = Matter.Composite.allBodies(current.world).filter(item => !item.isStatic);
    Matter.Composite.remove(current.world, x);
    spawnCube(canvasRef.current.clientWidth / 2, Math.max(40 + cubeRootSize / 2, Math.min(canvasRef.current.clientHeight - 48 - cubeRootSize / 2, canvasRef.current.clientHeight * 0.42)), 1, current, cubeRootSize);
  };
  return config ? <div style={{
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    position: "relative"
  }}>{<style />}{<div style={{
      position: "absolute",
      inset: "0 0 auto",
      padding: "30px 30px 16px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      zIndex: 10,
      pointerEvents: "none"
    }}>{<div>{<p style={{
          margin: "4px 0 0 0",
          fontFamily: "var(--font-body)",
          fontSize: "18px",
          color: "var(--color-text-sub)",
          fontWeight: 400,
          visibility: uiUsed ? "hidden" : "visible"
        }} aria-hidden={uiUsed}>{config.SUBTITLE || "Tocca uno spazio libero per creare cubi"}</p>}</div>}{<button type={"button"} aria-label={"Ricomincia con i cubi"} onClick={resetCubes} style={{
        pointerEvents: "auto",
        width: "48px",
        height: "48px",
        borderRadius: "50%",
        backgroundColor: "var(--color-primary)",
        border: "none",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        cursor: "pointer",
        boxShadow: "0 4px 12px rgba(81, 144, 240, 0.3)",
        flexShrink: 0
      }}>{<svg width={"24"} height={"24"} viewBox={"0 0 24 24"} fill={"none"} stroke={"white"} strokeWidth={"2.5"} strokeLinecap={"round"} strokeLinejoin={"round"}>{<path d={"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"} />}{<path d={"M3 3v5h5"} />}</svg>}</button>}</div>}{<div ref={sceneRef} style={{
      flex: 1,
      minHeight: 0,
      position: "relative"
    }}>{<canvas ref={canvasRef} onPointerDown={handlePointerDown} style={{
        display: "block",
        position: "absolute",
        top: 0,
        left: 0,
        cursor: "pointer",
        touchAction: "none"
      }} />}</div>}</div> : <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#F5F7FA"
  }} />;
}

// ./cube-guide-layout.js
/* No.19: notify the existing renderer when its flex playfield changes size. */
(() => {
  const root = document.getElementById('root');
  if (!root) return;
  let board = null;
  let frame = 0;
  let closed = false;
  let attempts = 0;
  const sync = () => {
    frame = 0;
    if (closed || !board?.isConnected) return;
    const canvas = board.querySelector('canvas');
    if (!canvas) return;
    const target = board.getBoundingClientRect();
    const current = canvas.getBoundingClientRect();
    if (Math.abs(target.width - current.width) < 0.75 && Math.abs(target.height - current.height) < 0.75) {
      attempts = 0;
      return;
    }
    // This package already handles resize by fitting its bitmap and static
    // walls. Reuse that layout signal; do not recreate bodies or play input.
    window.dispatchEvent(new Event('resize'));
    if (++attempts < 3) schedule();
  };
  const schedule = () => {
    if (!closed && !frame) frame = requestAnimationFrame(sync);
  };
  const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    attempts = 0;
    schedule();
  }) : null;
  const attach = () => {
    const next = root.querySelector('.meeting-cube-board');
    if (next !== board) {
      resized?.disconnect();
      board = next;
      if (board) resized?.observe(board);
    }
    attempts = 0;
    schedule();
  };
  const content = new MutationObserver(attach);
  content.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
  attach();
  window.addEventListener('pagehide', () => {
    closed = true;
    if (frame) cancelAnimationFrame(frame);
    resized?.disconnect();
    content.disconnect();
  }, {
    once: true
  });
})();

// ./guide-lifecycle.js
/* Game-owned copy dismissal only: no synthetic input, progress or physics writes. */
(() => {
  'use strict';

  const script = {dataset: {actionRoot: ".meeting-cube-board canvas"}};
  const actionRoot = script?.dataset.actionRoot;
  if (!actionRoot) return;
  const arrowButtons = script.dataset.arrowButtons || '';
  const ignored = script.dataset.ignore || '';
  const arrowKeys = script.dataset.arrowKeys === 'true';
  const html = document.documentElement;
  const hosted = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !hosted;
  let used = false;
  const element = target => target && typeof target.closest === 'function' ? target : null;
  const unrelated = target => !!target.closest('input,select,textarea,a,[contenteditable="true"],[role="button"],[data-settings]');
  function dismiss() {
    if (used) return;
    used = true;
    html.setAttribute('data-guide-action-used', 'true');
  }
  function pointer(event) {
    if (!active || used || event.isTrusted === false || event.isPrimary === false || event.button != null && event.button !== 0) return;
    const target = element(event.target);
    if (!target || unrelated(target) || ignored && target.closest(ignored)) return;
    const arrow = arrowButtons && target.closest(arrowButtons);
    if (target.closest('button') && !arrow) return;
    if (arrow || target.closest(actionRoot)) dismiss();
  }
  function key(event) {
    if (!arrowKeys || !active || used || event.isTrusted === false || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const target = element(event.target);
    if (target && (unrelated(target) || target.closest('input,select,textarea,button'))) return;
    dismiss();
  }
  function message(event) {
    if (!hosted || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
  }
  document.addEventListener('pointerdown', pointer, {
    capture: true,
    passive: true
  });
  if (arrowKeys) document.addEventListener('keydown', key, {
    capture: true,
    passive: true
  });
  addEventListener('message', message);
  addEventListener('pagehide', () => {
    document.removeEventListener('pointerdown', pointer, true);
    document.removeEventListener('keydown', key, true);
    removeEventListener('message', message);
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
        "data-game": "19"
      }[name] ?? null;
    },
    dataset: {
      game: "19"
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
  const selectors = [".meeting-cube-heading>div>p"];
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
