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
    "id": "BRUSH_SIZE",
    "kind": "number",
    "label": "笔刷大小",
    "value": 60,
    "default": 60,
    "min": 20,
    "max": 120,
    "step": 1
  }, {
    "id": "REVEAL_THRESHOLD",
    "kind": "number",
    "label": "揭开阈值(%)",
    "value": 60,
    "default": 60,
    "min": 30,
    "max": 90,
    "step": 1
  }],
  "texts": [{
    "id": "HINT_TEXT",
    "label": "提示文案",
    "value": "GRATTA E SCOPRI!",
    "default": "GRATTA E SCOPRI!",
    "max_length": 30
  }],
  "images": [{
    "id": "ORIGINAL_IMG",
    "label": "原图(顶层)",
    "path": "./assets/image_1.webp",
    "replaceable": true
  }, {
    "id": "COMIC_IMG",
    "label": "漫画图(底层)",
    "path": "./assets/material.webp",
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
html:root:root:root #root#root#root div:has(>.scratch-guide){position:fixed!important;top:26%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.scratch-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.scratch-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.scratch-guide){animation:none!important}}

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
function GameStyles() {
  return <style>{`
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
      --font-body:    -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
      --font-mono:    ui-monospace, Menlo, monospace;
      --color-primary: #ffeb3b;
      --color-stroke: #000000;
    }
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: #111;
      touch-action: none; /* \u963B\u6B62\u9ED8\u8BA4\u624B\u52BF */
    }
    * {
      box-sizing: border-box;
      user-select: none;
      -webkit-user-drag: none;
    }
    .comic-text {
      font-family: var(--font-display);
      color: var(--color-primary);
      text-transform: uppercase;
      -webkit-text-stroke: .3px var(--color-stroke);
      text-shadow: 0 2px 6px var(--color-stroke);
      letter-spacing: 1px;
    }
  `}</style>;
}
var FONT_STYLES = `@font-face{font-family:"DM Sans";src:url("./assets/fonts/ui/DMSans.woff") format("woff");font-style:normal;font-weight:100 1000;font-display:swap}
:root{--font-display:"DM Sans","PingFang SC",system-ui,sans-serif;--font-body:"DM Sans","PingFang SC",system-ui,sans-serif;--ui-ink:#202722;--ui-surface:#f8f9f6}
.ui-game{font-family:var(--font-body);font-optical-sizing:auto;font-synthesis:none;-webkit-font-smoothing:antialiased}
.ui-game button{font-family:var(--font-body);font-weight:700;letter-spacing:0;line-height:1.25}
.ui-game .ui-guide{font-family:var(--font-body);font-weight:600;letter-spacing:0;line-height:1.35}
`;
function App() {
  let [config, setConfig] = React.useState(null);
  let [images, setImages] = React.useState(null);
  let [layout, setLayout] = React.useState(null);
  let [complete, setComplete] = React.useState(false);
  let [guideVisible, setGuideVisible] = React.useState(true);
  let surfaceRef = React.useRef(null);
  let canvasRef = React.useRef(null);
  let scratchingRef = React.useRef(false);
  let lastPointRef = React.useRef(null);
  let lastScratchTimeRef = React.useRef(0);
  let audioRef = React.useRef({
    ready: false
  });
  let successSynthRef = React.useRef(null);
  let activePointerRef = React.useRef(null);
  let loadingRef = React.useRef(false);
  let scratchAudioRef = React.useRef(null);
  let ensureScratchAudio = () => {
    if (!scratchAudioRef.current || scratchAudioRef.current.disposed) {
      scratchAudioRef.current = globalThis.PlayableActionAudio?.create("scratch");
    }
    return scratchAudioRef.current;
  };
  let reducedMotion = useResponsiveSurface(surfaceRef, !!config);
  let ensureAudio = useAudioLifecycle(Tone, audioRef);
  React.useEffect(() => {
    let handleAction = () => {
      activePointerRef.current = null;
      scratchingRef.current = false;
      lastPointRef.current = null;
      scratchAudioRef.current?.stop();
    };
    let handleAction2 = () => {
      if (document.hidden) {
        handleAction();
      }
    };
    window.addEventListener("blur", handleAction);
    document.addEventListener("visibilitychange", handleAction2);
    return () => {
      window.removeEventListener("blur", handleAction);
      document.removeEventListener("visibilitychange", handleAction2);
    };
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
  React.useEffect(() => {
    if (!config) return;
    let enabled = true;
    let handleAction = value => new Promise((value2, otherValue) => {
      let image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => value2(image);
      image.onerror = () => otherValue(new Error(`Failed to load ${value}`));
      image.src = value;
    });
    (async () => {
      try {
        let [N, M] = await Promise.all([handleAction(config.ORIGINAL_IMG || ""), handleAction(config.COMIC_IMG || "")]);
        if (!enabled) return;
        setImages({
          top: N,
          bottom: M
        });
      } catch (value) {
        console.warn("Images load failed, using fallback", value);
        if (enabled) {
          setImages({
            top: new Image(),
            bottom: new Image()
          });
        }
      }
    })();
    return () => {
      enabled = false;
    };
  }, [config]);
  React.useEffect(() => {
    if (!images || !images.top.naturalWidth || !surfaceRef.current) return;
    let handleAction = () => {
      let clientWidth = surfaceRef.current.clientWidth;
      let clientHeight = surfaceRef.current.clientHeight;
      if (clientWidth === 0 || clientHeight === 0) return;
      let naturalWidth = images.top.naturalWidth;
      let naturalHeight = images.top.naturalHeight;
      let isLandscape = naturalWidth > naturalHeight;
      let value = clientWidth / clientHeight;
      let value2 = naturalWidth / naturalHeight;
      let value3;
      let value4;
      if (isLandscape) {
        if (value > value2) {
          value4 = clientHeight;
          value3 = value4 * value2;
        } else {
          value3 = clientWidth;
          value4 = value3 / value2;
        }
      } else {
        if (value > value2) {
          value3 = clientWidth;
          value4 = value3 / value2;
        } else {
          value4 = clientHeight;
          value3 = value4 * value2;
        }
      }
      setLayout({
        w: value3,
        h: value4,
        isLandscape: isLandscape
      });
    };
    let resizeObserver = observeGameSize(handleAction);
    resizeObserver.observe(surfaceRef.current);
    handleAction();
    return () => resizeObserver.disconnect();
  }, [images]);
  React.useEffect(() => {
    if (!layout || !images || !canvasRef.current || complete) return;
    let dimensions = canvasRef.current;
    let context = dimensions.getContext("2d", {
      alpha: true
    });
    if (!context) return;
    let value = window.devicePixelRatio || 1;
    activePointerRef.current = null;
    scratchingRef.current = false;
    lastPointRef.current = null;
    scratchAudioRef.current?.stop();
    let dimensions2;
    if (loadingRef.current) {
      dimensions2 = document.createElement("canvas");
      dimensions2.width = dimensions.width;
      dimensions2.height = dimensions.height;
      dimensions2.getContext("2d").drawImage(dimensions, 0, 0);
    }
    dimensions.width = layout.w * value;
    dimensions.height = layout.h * value;
    context.drawImage(dimensions2 || images.top, 0, 0, dimensions.width, dimensions.height);
    context.globalCompositeOperation = "destination-out";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = (config.BRUSH_SIZE || 40) * value;
  }, [layout, images, config, complete]);
  React.useEffect(() => () => scratchAudioRef.current?.dispose(), []);
  let initAudio = () => ensureAudio(() => {
    successSynthRef.current = new Tone.PolySynth(Tone.Synth).toDestination();
    successSynthRef.current.volume.value = -8;
    return {
      synth: successSynthRef.current
    };
  });
  let playSuccess = React.useCallback(() => {
    if (!audioRef.current.ready || !successSynthRef.current) return;
    let timestamp = Tone.now();
    successSynthRef.current.triggerAttackRelease(["C4", "E4", "G4", "C5"], "8n", timestamp);
  }, []);
  let finishReveal = React.useCallback(() => {
    scratchAudioRef.current?.stop();
    setComplete(true);
    playSuccess();
  }, [playSuccess]);
  let pointerPosition = React.useCallback(event => {
    if (!canvasRef.current) return null;
    let dimensions = canvasRef.current.getBoundingClientRect();
    return {
      x: (event.clientX - dimensions.left) * canvasRef.current.width / dimensions.width,
      y: (event.clientY - dimensions.top) * canvasRef.current.height / dimensions.height
    };
  }, []);
  let startScratching = React.useCallback(event => {
    if (complete || event.isPrimary === false || event.button !== 0 || activePointerRef.current !== null) return;
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    initAudio();
    ensureScratchAudio()?.arm();
    ensureScratchAudio()?.move(0.35);
    setGuideVisible(false);
    scratchingRef.current = true;
    lastPointRef.current = pointerPosition(event);
    loadingRef.current = true;
    let point = lastPointRef.current;
    let context = canvasRef.current.getContext("2d");
    context.beginPath();
    context.arc(point.x, point.y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  }, [complete, pointerPosition]);
  let continueScratching = React.useCallback(event => {
    if (!scratchingRef.current || complete || !canvasRef.current || event.isPrimary === false || activePointerRef.current !== event.pointerId) return;
    let point = pointerPosition(event);
    if (!point || !lastPointRef.current) return;
    let context = canvasRef.current.getContext("2d");
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    let value = point.x - lastPointRef.current.x;
    let value2 = point.y - lastPointRef.current.y;
    let value3 = Math.sqrt(value * value + value2 * value2);
    lastScratchTimeRef.current += value3;
    if (point.x < 0 || point.x > canvasRef.current.width || point.y < 0 || point.y > canvasRef.current.height) {
      scratchAudioRef.current?.stop();
    } else {
      if (value3 >= 1) {
        ensureScratchAudio()?.move(0.6 + Math.min(value3 / 60, 0.4));
      }
    }
    lastPointRef.current = point;
  }, [complete, pointerPosition]);
  let checkCoverage = React.useCallback(() => {
    if (!canvasRef.current || complete) return;
    let dimensions = canvasRef.current;
    let context = dimensions.getContext("2d");
    try {
      let data = context.getImageData(0, 0, dimensions.width, dimensions.height).data;
      let value = 0;
      let value2 = 40;
      for (let value6 = 3; value6 < data.length; value6 += value2) {
        if (data[value6] < 128) {
          value++;
        }
      }
      let value3 = data.length / value2;
      let value4 = value / value3;
      let value5 = (config.REVEAL_THRESHOLD || 60) / 100;
      if (value4 > value5) {
        finishReveal();
      }
    } catch {
      let value = window.devicePixelRatio || 1;
      let value2 = dimensions.width * dimensions.height * 0.05 * value;
      if (lastScratchTimeRef.current > value2) {
        finishReveal();
      }
    }
  }, [config, complete, finishReveal]);
  let finishStroke = React.useCallback(event => {
    if (activePointerRef.current === event.pointerId) {
      continueScratching(event);
      activePointerRef.current = null;
      scratchingRef.current = false;
      lastPointRef.current = null;
      scratchAudioRef.current?.stop();
      checkCoverage();
    }
  }, [checkCoverage, continueScratching]);
  let cancelStroke = event => {
    if (activePointerRef.current === event.pointerId) {
      activePointerRef.current = null;
      scratchingRef.current = false;
      lastPointRef.current = null;
      scratchAudioRef.current?.stop();
    }
  };
  return config ? <div ref={surfaceRef} className={"ui-game"} style={{
    width: "100%",
    height: "100%",
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    containerType: "size"
  }}>{<GameStyles />}{<style>{FONT_STYLES + ".scratch-guide{display:inline-block;max-width:100%;padding:7px 14px;border-radius:999px;background:rgba(20,29,24,.83);color:#fff;font-family:var(--font-body);font-weight:600;line-height:1.35;letter-spacing:0;text-transform:none;text-shadow:none;-webkit-text-stroke:0}"}</style>}{layout?.isLandscape && <div style={{
      position: "absolute",
      inset: 0,
      backgroundImage: `url(${config.ORIGINAL_IMG})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      filter: "blur(20px) brightness(0.6)",
      transform: "scale(1.1)",
      zIndex: 0
    }} />}{layout && images && <div style={{
      position: "absolute",
      width: `${layout.w}px`,
      height: `${layout.h}px`,
      zIndex: 1,
      overflow: "hidden",
      boxShadow: layout.isLandscape ? "0 20px 50px rgba(0,0,0,0.5)" : "none"
    }}>{<img src={config.COMIC_IMG} alt={"Scopri il fumetto"} draggable={false} style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        pointerEvents: "none"
      }} />}{<Motion.AnimatePresence>{!complete && <Motion.motion.canvas ref={canvasRef} initial={{
          opacity: 1
        }} exit={{
          opacity: 0
        }} transition={{
          duration: reducedMotion ? 0.01 : 0.8,
          ease: "easeInOut"
        }} onPointerDown={startScratching} onPointerMove={continueScratching} onPointerUp={finishStroke} onPointerCancel={cancelStroke} onLostPointerCapture={cancelStroke} style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          cursor: "pointer",
          touchAction: "none"
        }} />}</Motion.AnimatePresence>}</div>}{<Motion.AnimatePresence>{guideVisible && layout && <Motion.motion.div initial={reducedMotion ? false : {
        opacity: 0,
        y: 20
      }} animate={{
        opacity: 1,
        y: 0
      }} exit={reducedMotion ? {
        opacity: 0
      } : {
        opacity: 0,
        scale: 0.9
      }} style={{
        position: "absolute",
        top: "max(12%, var(--ui-top))",
        left: "var(--ui-side)",
        right: "var(--ui-side)",
        zIndex: 10,
        pointerEvents: "none",
        textAlign: "center",
        lineHeight: 1.4
      }}>{<div className={"scratch-guide ui-float"} style={{
          fontSize: "calc(18px * var(--ui-scale))",
          overflowWrap: "anywhere"
        }}>{config.HINT_TEXT === "GRATTA E SCOPRI!" ? "Gratta e scopri" : config.HINT_TEXT}</div>}</Motion.motion.div>}</Motion.AnimatePresence>}{complete && <button autoFocus={true} type={"button"} onClick={() => {
      ensureAudio.stop();
      scratchAudioRef.current?.stop();
      loadingRef.current = false;
      lastScratchTimeRef.current = 0;
      setGuideVisible(true);
      setComplete(false);
    }} style={{
      position: "absolute",
      bottom: "var(--ui-bottom)",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "12px 28px",
      font: "700 18px var(--font-body)",
      color: "#202722",
      background: "#fffef9",
      border: "1px solid #d8dfd9",
      borderRadius: 999,
      boxShadow: "0 4px 14px #0002",
      zIndex: 20
    }}>{"Riprova"}</button>}</div> : <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#111"
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

// ./interaction-audio.js
/* Original procedural SFX. No samples, remote requests or audio before a valid gesture. */
(function (host) {
  'use strict';

  const profiles = {
    fur: {
      gain: 0.055,
      high: 110,
      low: 900,
      hold: 120,
      attack: 0.025,
      release: 0.08
    },
    scratch: {
      gain: 0.085,
      high: 480,
      low: 3200,
      hold: 110,
      attack: 0.018,
      release: 0.065
    },
    steam: {
      gain: 0.04,
      high: 750,
      low: 5000,
      hold: 180,
      attack: 0.035,
      release: 0.1
    },
    outfit: {
      gain: 0.06,
      high: 700,
      low: 2600,
      hold: 90,
      attack: 0.008,
      release: 0.065
    }
  };
  function create(kind) {
    const profile = profiles[kind] || profiles.scratch;
    const document = host.document;
    let context = null;
    let buffer = null;
    let voice = null;
    let idle = null;
    let pending = null;
    let intent = null;
    let epoch = 0;
    let disposed = false;
    let bound = false;
    const active = new Set();
    const timers = new Set();
    const handleAction = () => host.performance?.now?.() ?? Date.now();
    const later = (value, otherValue) => {
      const value2 = host.setTimeout(() => {
        timers.delete(value2);
        value();
      }, otherValue);
      timers.add(value2);
      return value2;
    };
    const cancel = value => {
      if (value !== null) {
        host.clearTimeout(value);
        timers.delete(value);
      }
    };
    function destroy(node) {
      if (!node || !active.has(node)) return;
      active.delete(node);
      if (node.cleanup !== undefined) cancel(node.cleanup);
      for (const source of node.sources) try {
        source.stop();
      } catch {}
      for (const part of node.nodes) try {
        part.disconnect();
      } catch {}
    }
    function noise() {
      if (buffer) return buffer;
      buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 2), context.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 76073;
      let brown = 0;
      for (let value = 0; value < data.length; value++) {
        seed = Math.imul(seed, 1664525) + 1013904223 >>> 0;
        const white = seed / 2147483648 - 1;
        brown = (brown + 0.02 * white) / 1.02;
        data[value] = kind === 'fur' ? brown * 3.5 : white * 0.78 + brown * 0.6;
      }
      return buffer;
    }
    function makeVoice(loop) {
      const source = context.createBufferSource();
      const high = context.createBiquadFilter();
      const biquadFilter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = noise();
      source.loop = loop;
      high.type = 'highpass';
      high.frequency.value = profile.high;
      high.Q.value = 0.5;
      biquadFilter.type = 'lowpass';
      biquadFilter.frequency.value = profile.low;
      biquadFilter.Q.value = 0.5;
      gain.gain.value = 0;
      source.connect(high);
      high.connect(biquadFilter);
      biquadFilter.connect(gain);
      gain.connect(context.destination);
      const node = {
        sources: [source],
        nodes: [source, high, biquadFilter, gain],
        gain
      };
      active.add(node);
      if (active.size > 4) destroy(active.values().next().value);
      source.start();
      return node;
    }
    function fade() {
      if (!voice || !context) return;
      const node = voice;
      voice = null;
      try {
        node.gain.gain.cancelScheduledValues(context.currentTime);
        node.gain.gain.setTargetAtTime(0, context.currentTime, profile.release / 3);
      } catch {}
      node.cleanup = later(() => destroy(node), Math.ceil(profile.release * 1000) + 25);
    }
    function stop() {
      intent = null;
      cancel(idle);
      idle = null;
      fade();
    }
    function playMotion(force) {
      if (!context || context.state !== 'running' || disposed || document?.hidden) return;
      if (!voice || !active.has(voice)) voice = makeVoice(true);
      const value = profile.gain * (0.55 + 0.45 * Math.max(0, Math.min(1, Number(force) || 0)));
      voice.gain.gain.cancelScheduledValues(context.currentTime);
      voice.gain.gain.setTargetAtTime(value, context.currentTime, profile.attack);
      cancel(idle);
      idle = later(() => {
        idle = null;
        stop();
      }, profile.hold);
    }
    function playTap(adding) {
      if (!context || context.state !== 'running' || disposed || document?.hidden) return;
      const node = makeVoice(false);
      const currentTime = context.currentTime;
      const gain = node.gain.gain;
      gain.setValueAtTime(0.0001, currentTime);
      gain.linearRampToValueAtTime(profile.gain, currentTime + 0.008);
      gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.095);
      const click = context.createOscillator();
      const level = context.createGain();
      click.type = 'sine';
      click.frequency.setValueAtTime(adding ? 720 : 510, currentTime);
      click.frequency.exponentialRampToValueAtTime(adding ? 460 : 300, currentTime + 0.045);
      level.gain.setValueAtTime(0.0001, currentTime);
      level.gain.linearRampToValueAtTime(0.2, currentTime + 0.004);
      level.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.055);
      click.connect(level);
      level.connect(context.destination);
      node.sources.push(click);
      node.nodes.push(click, level);
      click.start(currentTime);
      click.stop(currentTime + 0.065);
      node.cleanup = later(() => destroy(node), 130);
      intent = null;
    }
    function close() {
      epoch++;
      pending = null;
      stop();
      for (const value of [...timers]) cancel(value);
      for (const node of [...active]) destroy(node);
      voice = null;
      buffer = null;
      const previous = context;
      context = null;
      if (previous) try {
        Promise.resolve(previous.close()).catch(() => {});
      } catch {}
    }
    const hidden = () => {
      if (document?.hidden) close();
    };
    function bind() {
      if (bound) return;
      bound = true;
      document?.addEventListener?.('visibilitychange', hidden);
      host.addEventListener?.('pagehide', close);
      host.addEventListener?.('blur', close);
    }
    function arm() {
      if (disposed || document?.hidden) return false;
      bind();
      try {
        if (!context || context.state === 'closed') {
          const Constructor = host.AudioContext || host.webkitAudioContext;
          if (!Constructor) return false;
          context = new Constructor();
          buffer = null;
        }
        if (context.state === 'running') return true;
        if (pending) return false;
        const target = context;
        const generation = epoch;
        pending = Promise.resolve(target.resume()).then(() => {
          if (disposed || generation !== epoch || context !== target || document?.hidden || target.state !== 'running') return;
          const requested = intent;
          if (!requested || handleAction() - requested.time > 180) return;
          if (requested.type === 'tap') playTap(requested.adding);else playMotion(requested.force);
        }).catch(() => {
          if (generation === epoch && context === target) close();
        }).finally(() => {
          if (generation === epoch) pending = null;
        });
      } catch {
        close();
      }
      return false;
    }
    function move(force = 1) {
      if (disposed || document?.hidden) return;
      intent = {
        type: 'motion',
        force,
        time: handleAction()
      };
      if (context?.state === 'running') try {
        playMotion(force);
      } catch {
        close();
      }
    }
    function tap(adding = true) {
      if (disposed || document?.hidden) return;
      intent = {
        type: 'tap',
        adding,
        time: handleAction()
      };
      if (arm()) try {
        playTap(adding);
      } catch {
        close();
      }
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      close();
      document?.removeEventListener?.('visibilitychange', hidden);
      host.removeEventListener?.('pagehide', close);
      host.removeEventListener?.('blur', close);
    }
    return {
      arm,
      move,
      tap,
      stop,
      dispose,
      get disposed() {
        return disposed;
      }
    };
  }
  host.PlayableActionAudio = {
    create
  };
})(typeof window === 'undefined' ? globalThis : window);
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [".scratch-guide"];
  const copy = new Set(["GRATTA E SCOPRI!"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
