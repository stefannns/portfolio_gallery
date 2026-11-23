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
    "id": "ITEM_SIZE",
    "kind": "number",
    "label": "物品大小",
    "value": 15,
    "default": 15,
    "min": 10,
    "max": 30,
    "step": 1
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "标题",
    "value": "TROVA GLI OGGETTI!",
    "default": "TROVA GLI OGGETTI!",
    "max_length": 30
  }, {
    "id": "SUCCESS_MSG",
    "label": "成功提示",
    "value": "COLLEZIONE COMPLETA!",
    "default": "COLLEZIONE COMPLETA!",
    "max_length": 30
  }],
  "images": [{
    "id": "BG_MAIN",
    "label": "主背景",
    "path": "./assets/bg_main.webp",
    "replaceable": true
  }, {
    "id": "ITEM_1",
    "label": "收集物1",
    "path": "./assets/item_starfish.webp",
    "replaceable": true
  }, {
    "id": "ITEM_2",
    "label": "收集物2",
    "path": "./assets/item_shell.webp",
    "replaceable": true
  }, {
    "id": "ITEM_3",
    "label": "收集物3",
    "path": "./assets/item_coconut.webp",
    "replaceable": true
  }, {
    "id": "ITEM_4",
    "label": "收集物4：树叶",
    "path": "./assets/item_leaf.webp",
    "replaceable": true
  }, {
    "id": "ITEM_5",
    "label": "收集物5：小鱼",
    "path": "./assets/item_fish.webp",
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
    /* 容器中立硬规：html / body / #root 三层撑满 + overflow:hidden + 无 vh/vw */
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  
/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.ui-guide{position:fixed!important;top:30%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.ui-guide{top:min(30%,calc(50cqh - var(--voxel-scene-height) * .153 - var(--voxel-item-inset) - 28px))!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(p.ui-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(p.ui-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(p.ui-guide){animation:none!important}}

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
function useResponsiveSurface(surfaceRef, enabled = true) {
  let [reducedMotion, setReducedMotion] = React.useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  React.useEffect(() => {
    let current = surfaceRef.current;
    if (!current || !enabled) return;
    let value = window.matchMedia("(prefers-reduced-motion: reduce)");
    let handleAction = () => current.style.setProperty("--ui-scale", String(Math.min(current.clientWidth / 390, current.clientHeight / 598)));
    let handleAction2 = () => {
      current.dataset.pageHidden = String(document.hidden);
    };
    let handleAction3 = () => {
      current.dataset.reducedMotion = String(value.matches);
      setReducedMotion(value.matches);
    };
    let resizeObserver = observeGameSize(handleAction);
    resizeObserver.observe(current);
    handleAction();
    handleAction2();
    handleAction3();
    value.addEventListener("change", handleAction3);
    document.addEventListener("visibilitychange", handleAction2);
    return () => {
      resizeObserver.disconnect();
      value.removeEventListener("change", handleAction3);
      document.removeEventListener("visibilitychange", handleAction2);
    };
  }, [surfaceRef, enabled]);
  return reducedMotion;
}
function useAudioLifecycle(tone, audioRef) {
  let lifecycleRef = React.useRef({
    alive: true,
    epoch: 0,
    pending: null
  });
  React.useEffect(() => {
    let current = lifecycleRef.current;
    current.alive = true;
    let handleAction2 = () => {
      current.epoch++;
      current.pending = null;
      for (let value of Object.values(audioRef.current)) if (value && typeof value.dispose == "function") try {
        value.dispose();
      } catch {}
      audioRef.current = {
        ready: false,
        lastTime: 0,
        lastNoiseTime: 0
      };
    };
    current.dispose = handleAction2;
    let handleAction3 = () => {
      if (document.hidden) {
        handleAction2();
      }
    };
    document.addEventListener("visibilitychange", handleAction3);
    window.addEventListener("pagehide", handleAction2);
    return () => {
      current.alive = false;
      handleAction2();
      document.removeEventListener("visibilitychange", handleAction3);
      window.removeEventListener("pagehide", handleAction2);
    };
  }, [audioRef, tone]);
  let handleAction = value => {
    let current = lifecycleRef.current;
    if (audioRef.current.ready || current.pending) return;
    let epoch = current.epoch;
    let value2;
    try {
      value2 = tone.start();
    } catch {
      return;
    }
    current.pending = Promise.resolve(value2).then(() => {
      if (!(!current.alive || current.epoch !== epoch || document.hidden)) {
        audioRef.current = {
          ...audioRef.current,
          ...value(),
          ready: true
        };
      }
    }).catch(() => {}).finally(() => {
      if (current.epoch === epoch) {
        current.pending = null;
      }
    });
  };
  handleAction.stop = () => lifecycleRef.current.dispose?.();
  return handleAction;
}
async function loadGameConfig() {
  try {
    await requestGameConfig();
  } catch {}
  return runtimeConfig;
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
  return values;
}
var HIDDEN_ITEMS = [{
  id: "item1",
  cfgKey: "ITEM_1",
  name: "Stella marina",
  scene: [0.565, 0.7],
  landscape: [0.57, 0.6],
  filter: "saturate(.55) hue-rotate(12deg)",
  size: 0.76
}, {
  id: "item2",
  cfgKey: "ITEM_2",
  name: "Conchiglia",
  scene: [0.35, 0.71],
  landscape: [0.3, 0.61],
  filter: "brightness(.93) saturate(.7)",
  size: 0.82
}, {
  id: "item3",
  cfgKey: "ITEM_3",
  name: "Cocco",
  scene: [0.62, 0.347],
  landscape: [0.68, 0.49],
  filter: "brightness(.68) saturate(.7)",
  size: 0.95
}, {
  id: "item4",
  cfgKey: "ITEM_4",
  name: "Foglia",
  scene: [0.72, 0.52],
  landscape: [0.8, 0.42],
  filter: "brightness(.62) saturate(.7)",
  size: 0.85
}, {
  id: "item5",
  cfgKey: "ITEM_5",
  name: "Pesce",
  scene: [0.3, 0.53],
  landscape: [0.18, 0.55],
  filter: "brightness(.8) saturate(.75)",
  size: 0.85
}];
var sceneStyles = {
  root: {
    display: "block",
    width: "100%",
    height: "100%",
    position: "relative",
    containerType: "size"
  },
  mainArea: {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    backgroundColor: "#000"
  },
  wrapper: {
    position: "absolute",
    inset: 0,
    zIndex: 1
  },
  itemWrapper: {
    position: "absolute",
    width: "var(--voxel-item-size)",
    aspectRatio: "1/1",
    minWidth: 44,
    minHeight: 44,
    border: 0,
    padding: 0,
    background: "transparent",
    transform: "translate(-50%, -50%)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  itemVisual: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    pointerEvents: "none"
  },
  itemImg: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    position: "relative",
    zIndex: 2
  },
  slotsContainer: {
    position: "absolute",
    left: "50%",
    bottom: "var(--ui-bottom)",
    transform: "translateX(-50%)",
    display: "grid",
    gridTemplateColumns: `repeat(${HIDDEN_ITEMS.length}, var(--voxel-slot-size))`,
    gap: "8px",
    background: "transparent",
    pointerEvents: "none",
    zIndex: 10
  },
  slot: {
    width: "var(--voxel-slot-size)",
    height: "var(--voxel-slot-size)",
    border: "2px solid",
    borderRadius: "12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 0 0 1px rgba(12,34,26,.55), 0 2px 8px rgba(12,34,26,.2)"
  },
  slotImg: {
    width: "80%",
    height: "80%",
    objectFit: "contain"
  },
  flyingImg: {
    position: "fixed",
    left: 0,
    top: 0,
    width: "60px",
    height: "60px",
    objectFit: "contain",
    zIndex: 50,
    pointerEvents: "none"
  },
  resultOverlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: "transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    gap: "20px",
    padding: "var(--ui-top) var(--ui-side) var(--ui-bottom)",
    zIndex: 100
  },
  resultText: {
    margin: 0,
    maxWidth: "100%",
    textAlign: "center",
    overflowWrap: "anywhere",
    fontFamily: "var(--font-display)",
    fontSize: "max(20px, calc(24px * var(--ui-scale)))",
    color: "#fff",
    textShadow: "0 2px 6px rgba(0,0,0,.75)",
    fontWeight: 700,
    lineHeight: 1.25
  },
  btn: {
    fontFamily: "var(--font-display)",
    fontSize: "18px",
    minWidth: 112,
    minHeight: 44,
    padding: "12px 32px",
    backgroundColor: "var(--color-accent)",
    color: "#fff",
    border: "none",
    borderRadius: "999px",
    cursor: "pointer"
  }
};
var RESPONSIVE_STYLES = `
.ui-game{--ui-scale:1;--ui-top:calc(30px * var(--ui-scale) + env(safe-area-inset-top,0px));--ui-bottom:calc(50px * var(--ui-scale) + env(safe-area-inset-bottom,0px));--ui-side:calc(30px * var(--ui-scale))}
.ui-guide{position:absolute;left:var(--ui-side);right:var(--ui-side);margin:0;text-align:center;font-size:calc(18px * var(--ui-scale));line-height:1.4;font-weight:500;overflow-wrap:anywhere;pointer-events:none;z-index:20}
.ui-float{animation:ui-guide-float 2.4s ease-in-out infinite}
@keyframes ui-guide-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.ui-game[data-page-hidden="true"] .ui-float{animation-play-state:paused}
.ui-game button{font-family:inherit;min-height:44px;min-width:44px;touch-action:manipulation}
.ui-game button:focus-visible,.ui-game [tabindex]:focus-visible{outline:3px solid #78baff;outline-offset:3px}
.ui-game[data-reduced-motion="true"] .ui-float{animation:none}
.ui-game[data-reduced-motion="true"] *{transition-duration:.001ms!important;animation-duration:.001ms!important;animation-iteration-count:1!important}
@media(prefers-reduced-motion:reduce){.ui-float{animation:none}}
`;
var FONT_STYLES = `@font-face{font-family:"Rubik";src:url("./assets/fonts/ui/Rubik-Regular.woff") format("woff");font-style:normal;font-weight:400;font-display:swap}
@font-face{font-family:"Rubik";src:url("./assets/fonts/ui/Rubik-Bold.woff") format("woff");font-style:normal;font-weight:700;font-display:swap}
:root{--font-display:"Rubik","PingFang SC",system-ui,sans-serif;--font-body:"Rubik","PingFang SC",system-ui,sans-serif;--ui-ink:#304b40;--ui-surface:#f3eee4}
.ui-game{font-family:var(--font-body);font-optical-sizing:auto;font-synthesis:none;-webkit-font-smoothing:antialiased}
.ui-game button{font-family:var(--font-body);font-weight:700;letter-spacing:0;line-height:1.25}
.ui-game .ui-guide{font-family:var(--font-body);font-weight:600;letter-spacing:0;line-height:1.35}
`;
function hiddenItemAssetUrl(value) {
  return /^\.\/assets\/item_(starfish|shell|coconut|leaf|fish)\.webp$/.test(value) ? `${value}?art=grounded-voxel70-20261015-1` : value;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [foundItems, setFoundItems] = React.useState([]);
  let [flyingItems, setFlyingItems] = React.useState([]);
  let [complete, setComplete] = React.useState(false);
  let [started, setStarted] = React.useState(false);
  let itemElementsRef = React.useRef({});
  let audioRef = React.useRef({
    ready: false
  });
  let collectSynthRef = React.useRef(null);
  let finishSynthRef = React.useRef(null);
  let surfaceRef = React.useRef(null);
  let collectingRef = React.useRef(new Set());
  let roundRef = React.useRef(0);
  let finishTimerRef = React.useRef(null);
  let reducedMotion = useResponsiveSurface(surfaceRef, !!config);
  let ensureAudio = useAudioLifecycle(Tone, audioRef);
  React.useEffect(() => () => {
    roundRef.current++;
    clearTimeout(finishTimerRef.current);
  }, []);
  React.useEffect(() => {
    let enabled = true;
    (async () => {
      let value = await loadGameConfig();
      if (enabled) {
        setConfig(readConfigValues(value));
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  let initAudio = () => ensureAudio(() => {
    collectSynthRef.current = new Tone.Synth({
      oscillator: {
        type: "sine"
      },
      envelope: {
        attack: 0.01,
        decay: 0.1,
        sustain: 0.1,
        release: 1
      }
    }).toDestination();
    collectSynthRef.current.volume.value = -8;
    finishSynthRef.current = new Tone.PolySynth(Tone.Synth).toDestination();
    finishSynthRef.current.volume.value = -6;
    return {
      synth: collectSynthRef.current,
      polySynth: finishSynthRef.current
    };
  });
  let playSound = React.useCallback(value => {
    if (!audioRef.current.ready) return;
    let timestamp = Tone.now();
    try {
      if (value === "click") {
        collectSynthRef.current?.triggerAttackRelease("C5", "16n", timestamp);
      } else {
        if (value === "collect") {
          collectSynthRef.current?.triggerAttackRelease("E5", "8n", timestamp);
        } else {
          if (value === "success") {
            finishSynthRef.current?.triggerAttackRelease(["C5", "E5", "G5", "C6"], "4n", timestamp);
          }
        }
      }
    } catch {}
  }, []);
  let collectItem = (event, otherValue) => {
    if (event.preventDefault(), event.stopPropagation(), complete || collectingRef.current.has(otherValue.id) || foundItems.includes(otherValue.id)) return;
    collectingRef.current.add(otherValue.id);
    setStarted(true);
    let dimensions = event.currentTarget.getBoundingClientRect();
    let startX = dimensions.left + dimensions.width / 2;
    let startY = dimensions.top + dimensions.height / 2;
    initAudio();
    playSound("click");
    let z = itemElementsRef.current[otherValue.id];
    let endX = window.innerWidth / 2;
    let endY = window.innerHeight;
    let endSize = 38;
    if (z) {
      let dimensions2 = z.getBoundingClientRect();
      endX = dimensions2.left + dimensions2.width / 2;
      endY = dimensions2.top + dimensions2.height / 2;
      endSize = dimensions2.width * 0.8;
    }
    setFlyingItems(value => [...value, {
      id: otherValue.id,
      cfgKey: otherValue.cfgKey,
      round: roundRef.current,
      startX: startX,
      startY: startY,
      endX: endX,
      endY: endY,
      startSize: dimensions.width,
      endSize: endSize,
      key: `${otherValue.id}_${Date.now()}`
    }]);
  };
  let finishItemFlight = event => {
    if (event.round === roundRef.current) {
      setFlyingItems(value => value.filter(event2 => event2.key !== event.key));
      setFoundItems(value => {
        if (value.includes(event.id)) return value;
        let items = [...value, event.id];
        playSound("collect");
        if (items.length === HIDDEN_ITEMS.length) {
          finishTimerRef.current = setTimeout(() => {
            if (event.round === roundRef.current) {
              setComplete(true);
              playSound("success");
            }
          }, 300);
        }
        return items;
      });
    }
  };
  if (!config) return <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#8D6E63"
  }} />;
  let backgroundImage = config.BG_MAIN || "";
  return <div ref={surfaceRef} className={"ui-game voxel-game"} style={{
    ...sceneStyles.root,
    "--voxel-item-size": `max(44px, ${config.ITEM_SIZE ?? 15}cqmin)`
  }} aria-label={config.GAME_TITLE}>{<style>{`
        ${RESPONSIVE_STYLES}
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
          --color-bg: #8D6E63;
          --color-hud: rgba(255, 255, 255, 0.85);
          --color-text: #3E2723;
          --color-accent: #2e7d32;
        }
        html, body, #root { width:100%; height:100%; margin:0; overflow:hidden; background: var(--color-bg); }
        * { box-sizing: border-box; touch-action: none; user-select: none; -webkit-user-drag: none; }
        
        .voxel-game{--voxel-slot-size:clamp(44px,12cqmin,56px);--voxel-item-inset:calc(var(--voxel-item-size) * .55 + 4px);--voxel-guide-top:max(var(--ui-top),12cqh);--voxel-guide-height:calc(18px * var(--ui-scale) * 1.35 + 14px);--voxel-scene-width:max(100cqw,calc(100cqh * 928 / 1152));--voxel-scene-height:max(100cqh,calc(100cqw * 1152 / 928))}
        .voxel-item{border-radius:50%}
        .voxel-item-visual{transition:transform .14s ease-out}
        @media(hover:hover) and (pointer:fine){.voxel-item:hover .voxel-item-visual{transform:scale(1.05)}}
        @media(orientation:landscape){
          .voxel-item{--voxel-scene-x:var(--voxel-landscape-x);--voxel-scene-y:var(--voxel-landscape-y)}
        }
        .voxel-item:active .voxel-item-visual{transform:scale(.95)}
        .ui-game .voxel-item:focus-visible{outline:3px solid #fff;outline-offset:4px;box-shadow:0 0 0 6px #244237}
        .ui-game[data-reduced-motion="true"] .voxel-item-visual{transform:none!important;transition:none!important}
        .voxel-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      `}</style>}{<style>{FONT_STYLES}</style>}{<div className={"voxel-scene"} style={sceneStyles.mainArea}>{<div style={sceneStyles.wrapper}>{<img src={backgroundImage} alt={"Spiaggia in voxel"} draggable={false} style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "cover"
        }} />}{HIDDEN_ITEMS.map(item => {
          let value = foundItems.includes(item.id);
          let value2 = flyingItems.some(item2 => item2.id === item.id);
          return value || value2 ? null : <button type={"button"} className={"voxel-item"} key={item.id} data-item={item.id} aria-label={`Collect ${item.name.toLowerCase()}`} style={{
            ...sceneStyles.itemWrapper,
            "--voxel-portrait-x": item.scene[0] - 0.5,
            "--voxel-portrait-y": item.scene[1] - 0.5,
            "--voxel-landscape-x": item.landscape[0] - 0.5,
            "--voxel-landscape-y": item.landscape[1] - 0.5,
            left: "clamp(calc(var(--ui-side) + var(--voxel-item-inset)), calc(50% + var(--voxel-scene-width) * var(--voxel-scene-x, var(--voxel-portrait-x))), calc(100% - var(--ui-side) - var(--voxel-item-inset)))",
            top: "clamp(calc(var(--voxel-guide-top) + var(--voxel-guide-height) + 8px + var(--voxel-item-inset)), calc(50% + var(--voxel-scene-height) * var(--voxel-scene-y, var(--voxel-portrait-y))), calc(100% - var(--ui-bottom) - var(--voxel-slot-size) - 12px - var(--voxel-item-inset)))"
          }} onClick={value3 => collectItem(value3, item)}>{<span className={"voxel-item-visual"} style={sceneStyles.itemVisual}>{<img src={hiddenItemAssetUrl(config[item.cfgKey])} alt={""} draggable={false} style={{
                ...sceneStyles.itemImg,
                width: `${item.size * 100}%`,
                height: `${item.size * 100}%`,
                filter: item.filter
              }} />}</span>}</button>;
        })}</div>}</div>}{<div className={"voxel-collection"} role={"list"} aria-label={"Oggetti da trovare"} style={sceneStyles.slotsContainer}>{HIDDEN_ITEMS.map(item => {
        let value = foundItems.includes(item.id);
        return <div key={`slot_${item.id}`} role={"listitem"} aria-label={`${item.name}: ${value ? "trovato" : "da trovare"}`} ref={value2 => itemElementsRef.current[item.id] = value2} style={{
          ...sceneStyles.slot,
          borderColor: value ? "#b6edc7" : "rgba(255,255,255,.8)",
          backgroundColor: value ? "rgba(255,255,255,.12)" : "transparent"
        }}>{value && <Motion.motion.img alt={""} aria-hidden={"true"} initial={reducedMotion ? false : {
            scale: 0
          }} animate={{
            scale: 1
          }} src={hiddenItemAssetUrl(config[item.cfgKey])} style={sceneStyles.slotImg} />}</div>;
      })}</div>}{<span className={"voxel-status"} role={"status"} aria-live={"polite"} aria-atomic={"true"}>{foundItems.length}{" di "}{HIDDEN_ITEMS.length}{" oggetti trovati"}</span>}{!started && <p className={"ui-guide ui-float"} style={{
      top: "var(--voxel-guide-top)",
      fontFamily: "var(--font-body)",
      fontWeight: 400,
      color: "#fff",
      textShadow: "none",
      background: "rgba(32,51,47,.8)",
      borderRadius: 12,
      padding: "7px 12px"
    }}>{"Tocca gli oggetti nascosti"}</p>}{flyingItems.map(event => <Motion.motion.img alt={""} aria-hidden={"true"} key={event.key} src={hiddenItemAssetUrl(config[event.cfgKey])} initial={{
      scale: event.startSize / 60,
      x: event.startX - 30,
      y: event.startY - 30
    }} animate={{
      x: event.endX - 30,
      y: event.endY - 30,
      scale: event.endSize / 60,
      rotate: 360
    }} transition={{
      duration: reducedMotion ? 0.05 : 0.6,
      ease: "easeInOut"
    }} onAnimationComplete={() => finishItemFlight(event)} style={sceneStyles.flyingImg} />)}{<Motion.AnimatePresence>{complete && <Motion.motion.div className={"voxel-result"} role={"dialog"} aria-modal={"true"} aria-label={"Collezione completa"} aria-describedby={"voxel-result-text"} style={sceneStyles.resultOverlay} initial={reducedMotion ? false : {
        opacity: 0
      }} animate={{
        opacity: 1
      }} transition={{
        duration: reducedMotion ? 0 : 0.18
      }}>{<h2 id={"voxel-result-text"} className={"voxel-result-text"} style={sceneStyles.resultText}>{config.SUCCESS_MSG}</h2>}{<button type={"button"} className={"voxel-again"} autoFocus={true} style={sceneStyles.btn} onClick={() => {
          ensureAudio.stop();
          roundRef.current++;
          clearTimeout(finishTimerRef.current);
          collectingRef.current.clear();
          setFlyingItems([]);
          setFoundItems([]);
          setStarted(false);
          setComplete(false);
          playSound("click");
        }}>{"Riprova"}</button>}</Motion.motion.div>}</Motion.AnimatePresence>}</div>;
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

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = ["p.ui-guide"];
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
