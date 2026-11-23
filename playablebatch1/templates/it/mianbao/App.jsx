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
    "id": "TOAST_DURATION",
    "kind": "number",
    "label": "烤面包时长(ms)",
    "value": 2500,
    "default": 2500,
    "min": 1000,
    "max": 5000,
    "step": 100
  }],
  "texts": [{
    "id": "RESULT_TEXT",
    "label": "结果文案",
    "value": "Bruciato!",
    "default": "Bruciato!",
    "max_length": 20
  }],
  "images": [{
    "id": "TOASTER_IMG",
    "label": "烤面包机",
    "path": "./assets/toaster.webp",
    "replaceable": true
  }, {
    "id": "HANDLE_IMG",
    "label": "手柄",
    "path": "./assets/toaster_handle.webp",
    "replaceable": true
  }, {
    "id": "NORMAL_BREAD_IMG",
    "label": "正常面包",
    "path": "./assets/normal_bread.webp",
    "replaceable": true
  }, {
    "id": "BURNT_BREAD_IMG",
    "label": "烤焦面包",
    "path": "./assets/burnt_bread.webp",
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
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.toaster-guide{position:fixed!important;top:0%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.toaster-guide{position:absolute!important;top:calc(var(--toaster-width) * -.65 - 26px * var(--ui-scale))!important;font-weight:800!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(p.toaster-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(p.toaster-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(p.toaster-guide){animation:none!important}}

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
function useFeedPreviewActive() {
  let [currentValue, setCurrentValue] = React.useState(() => new URLSearchParams(location.search).has("review") || new URLSearchParams(location.search).get("feedReview") === "1");
  React.useEffect(() => {
    let handleAction = value => {
      if (value.source === parent && value.origin === location.origin && value.data?.type === "playable-active") {
        setCurrentValue(value.data.active !== true);
      }
    };
    addEventListener("message", handleAction);
    return () => removeEventListener("message", handleAction);
  }, []);
  return currentValue;
}
function useSurfaceVisibility(stateRef, otherValue) {
  let [active, setActive] = React.useState(false);
  React.useEffect(() => {
    if (!otherValue || !stateRef.current) return;
    if (typeof IntersectionObserver !== "function") {
      setActive(true);
      return;
    }
    let intersectionObserver = new IntersectionObserver(value => setActive(value.some(item => item.isIntersecting && item.intersectionRatio > 0.1)), {
      threshold: [0, 0.1]
    });
    intersectionObserver.observe(stateRef.current);
    return () => intersectionObserver.disconnect();
  }, [stateRef, otherValue]);
  return active;
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
    html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #ffffff; }
    * { box-sizing: border-box; }
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
    }
  `}</style>;
}
var FONT_STYLES = `@font-face{font-family:"Nunito Sans";src:url("./assets/fonts/ui/NunitoSans.woff") format("woff");font-style:normal;font-weight:100 1000;font-display:swap}
:root{--font-display:"Nunito Sans","PingFang SC",system-ui,sans-serif;--font-body:"Nunito Sans","PingFang SC",system-ui,sans-serif;--ui-ink:#4b352a;--ui-surface:#fffaf4}
.ui-game{font-family:var(--font-body);font-optical-sizing:auto;font-synthesis:none;-webkit-font-smoothing:antialiased}
.ui-game button{font-family:var(--font-body);font-weight:700;letter-spacing:0;line-height:1.25}
.ui-game .ui-guide{font-family:var(--font-body);font-weight:600;letter-spacing:0;line-height:1.35}
`;
function toasterAssetUrl(value) {
  return /^\.\/assets\/(toaster|toaster_handle|normal_bread|burnt_bread)\.webp$/.test(value) ? `${value}?art=retro69-20261015-1` : value;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("idle");
  let audioRef = React.useRef({
    ready: false
  });
  let popSynthRef = React.useRef(null);
  let toastingSynthRef = React.useRef(null);
  let resultSynthRef = React.useRef(null);
  let handleRef = React.useRef(null);
  let handleAnimation = Motion.useAnimationControls();
  let breadAnimation = Motion.useAnimationControls();
  let toasterAnimation = Motion.useAnimationControls();
  let surfaceRef = React.useRef(null);
  let toastTimerRef = React.useRef(null);
  let toastCycleRef = React.useRef(0);
  let phaseRef = React.useRef("idle");
  let [started, setStarted] = React.useState(false);
  let [burnt, setBurnt] = React.useState(false);
  let reducedMotion = useResponsiveSurface(surfaceRef, !!config);
  let previewActive = useFeedPreviewActive();
  let surfaceVisible = useSurfaceVisibility(surfaceRef, !!config);
  let ensureAudio = useAudioLifecycle(Tone, audioRef);
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
    popSynthRef.current = new Tone.Synth().toDestination();
    popSynthRef.current.volume.value = -10;
    toastingSynthRef.current = new Tone.NoiseSynth({
      noise: {
        type: "brown"
      },
      envelope: {
        attack: 0.5,
        decay: 0.1,
        sustain: 1,
        release: 0.5
      }
    }).toDestination();
    toastingSynthRef.current.volume.value = -15;
    resultSynthRef.current = new Tone.MetalSynth({
      frequency: 800,
      envelope: {
        attack: 0.001,
        decay: 1,
        release: 1
      },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5
    }).toDestination();
    resultSynthRef.current.volume.value = -5;
    return {
      synth: popSynthRef.current,
      noise: toastingSynthRef.current,
      bell: resultSynthRef.current
    };
  });
  let popToast = React.useCallback(() => {
    if (phaseRef.current !== "toasting") return;
    let current = toastCycleRef.current;
    phaseRef.current = "popping";
    setPhase("popping");
    toasterAnimation.stop();
    toasterAnimation.set({
      x: 0
    });
    if (audioRef.current.ready && resultSynthRef.current) {
      resultSynthRef.current.triggerAttackRelease("8n");
    }
    handleAnimation.start({
      y: 0,
      transition: {
        type: "spring",
        stiffness: 400,
        damping: 15
      }
    });
    breadAnimation.start({
      y: 0,
      transition: reducedMotion ? {
        duration: 0.08
      } : {
        type: "spring",
        stiffness: 300,
        damping: 20
      }
    }).then(() => {
      if (current === toastCycleRef.current) {
        phaseRef.current = "done";
        setPhase("done");
      }
    });
  }, [handleAnimation, breadAnimation, toasterAnimation, reducedMotion]);
  let startToasting = React.useCallback(() => {
    if (phaseRef.current !== "idle") return;
    phaseRef.current = "toasting";
    setStarted(true);
    setPhase("toasting");
    let value = handleRef.current?.clientHeight || 100;
    let value2 = handleRef.current?.firstChild?.clientHeight || 30;
    let value3 = Math.max(0, value - value2);
    handleAnimation.start({
      y: value3,
      transition: {
        duration: 0.2
      }
    });
    if (audioRef.current.ready) {
      popSynthRef.current?.triggerAttackRelease("C2", "8n");
      toastingSynthRef.current?.triggerAttackRelease(config.TOAST_DURATION / 1000);
    }
    let current = toastCycleRef.current;
    breadAnimation.start({
      y: "100%",
      transition: {
        duration: 0.5,
        ease: "easeInOut"
      }
    }).then(() => {
      if (!(current !== toastCycleRef.current || phaseRef.current !== "toasting")) {
        setBurnt(true);
      }
    });
    if (!reducedMotion) {
      toasterAnimation.start({
        x: [-2, 2, -2, 2, 0],
        transition: {
          repeat: 1 / 0,
          duration: 0.1
        }
      });
    }
    toastTimerRef.current = setTimeout(() => {
      popToast();
    }, config.TOAST_DURATION || 2500);
  }, [config, handleAnimation, breadAnimation, toasterAnimation, popToast, reducedMotion]);
  let releaseHandle = React.useCallback((value, otherValue) => {
    if (phase !== "idle") return;
    if (value.type === "pointercancel" || document.hidden) {
      handleAnimation.set({
        y: 0
      });
      return;
    }
    let value2 = (handleRef.current?.clientHeight || 100) * 0.4;
    if (otherValue.offset.y > value2) {
      startToasting();
    } else {
      handleAnimation.start({
        y: 0,
        transition: {
          type: "spring",
          stiffness: 300,
          damping: 20
        }
      });
    }
  }, [phase, startToasting, handleAnimation]);
  let resetToaster = React.useCallback(() => {
    ensureAudio.stop();
    clearTimeout(toastTimerRef.current);
    toastCycleRef.current++;
    phaseRef.current = "idle";
    setStarted(false);
    setBurnt(false);
    toasterAnimation.stop();
    toasterAnimation.set({
      x: 0
    });
    setPhase("idle");
    handleAnimation.set({
      y: 0
    });
    breadAnimation.set({
      y: 0
    });
  }, [handleAnimation, breadAnimation, toasterAnimation]);
  if (React.useEffect(() => {
    if (previewActive) {
      resetToaster();
    }
  }, [previewActive, resetToaster]), React.useEffect(() => {
    let handleAction = () => {
      if (document.hidden) {
        resetToaster();
      }
    };
    document.addEventListener("visibilitychange", handleAction);
    return () => {
      clearTimeout(toastTimerRef.current);
      toastCycleRef.current++;
      handleAnimation.stop();
      breadAnimation.stop();
      toasterAnimation.stop();
      document.removeEventListener("visibilitychange", handleAction);
    };
  }, [resetToaster, handleAnimation, breadAnimation, toasterAnimation]), !config) return <div style={{
    width: "100%",
    height: "100%",
    background: "#fff"
  }} />;
  let showToastedBread = burnt || phase === "popping" || phase === "done";
  return <div ref={surfaceRef} data-feed-preview={previewActive} data-stage-visible={surfaceVisible} className={"ui-game toaster-game"} style={{
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    padding: "var(--ui-top) var(--ui-side) var(--ui-bottom)",
    containerType: "size",
    position: "relative"
  }}>{<GameStyles />}{<style>{FONT_STYLES}</style>}{<style>{`
        .toaster-game[data-feed-preview="true"] .toaster-assembly{top:calc(104px * var(--ui-scale))!important}
        .toaster-game[data-feed-preview="true"] .toaster-lever{animation:preview-lever 3.2s .7s ease-in-out both}
        .toaster-game[data-feed-preview="true"] .toaster-bread{animation:preview-bread 3.2s .7s ease-in-out both}
        .toaster-game[data-page-hidden="true"] .toaster-lever,.toaster-game[data-page-hidden="true"] .toaster-bread{animation-play-state:paused}
        .toaster-game[data-stage-visible="false"] .toaster-lever,.toaster-game[data-stage-visible="false"] .toaster-bread{animation-play-state:paused}
        @keyframes preview-lever{0%,100%{transform:translateY(0)}25%,60%{transform:translateY(40px)}}
        @keyframes preview-bread{0%,100%{transform:translateY(0)}25%,60%{transform:translateY(100%)}76%{transform:translateY(-10%)}}
        @media(prefers-reduced-motion:reduce){.toaster-game .toaster-lever,.toaster-game .toaster-bread{animation:none!important}}
      `}</style>}{<Motion.motion.div className={"toaster-assembly"} animate={toasterAnimation} style={{
      position: "relative",
      "--toaster-width": "min(72cqi, calc(280px * var(--ui-scale)))",
      width: "var(--toaster-width)",
      top: "max(calc(56px * var(--ui-scale)), calc(var(--toaster-width) * 1.051 + 40px * var(--ui-scale) - 50cqh))",
      aspectRatio: "1402 / 1122"
    }}>{!started && <p className={"ui-guide ui-float toaster-guide"} style={{
        top: "calc(var(--toaster-width) * -.65 - 26px * var(--ui-scale))",
        bottom: "auto",
        fontFamily: "var(--font-body)",
        color: "#4b352a",
        fontWeight: 800
      }}>{"Abbassa la leva"}</p>}{<div className={"toaster-lever-track"} ref={handleRef} style={{
        position: "absolute",
        left: "92%",
        transform: "translateX(-4%)",
        top: "25%",
        width: "15%",
        minWidth: 44,
        height: "45%",
        zIndex: 3
      }}>{<Motion.motion.div className={"toaster-lever"} drag={phase === "idle" ? "y" : false} dragConstraints={handleRef} dragElastic={0} dragMomentum={false} onPointerDown={initAudio} onDragStart={() => setStarted(true)} onDragEnd={releaseHandle} role={"button"} tabIndex={phase === "idle" ? 0 : -1} aria-label={"Abbassa la leva"} aria-disabled={phase !== "idle"} onKeyDown={event => {
          if (["Enter", " "].includes(event.key) && phase === "idle") {
            event.preventDefault();
            initAudio();
            startToasting();
          }
        }} animate={handleAnimation} style={{
          width: "100%",
          minHeight: 44,
          cursor: phase === "idle" ? "grab" : "default",
          touchAction: "none"
        }}>{<img src={toasterAssetUrl(config.HANDLE_IMG)} draggable={false} alt={"handle"} style={{
            width: "100%",
            display: "block",
            pointerEvents: "none",
            objectFit: "contain",
            aspectRatio: "67 / 56"
          }} />}</Motion.motion.div>}</div>}{<div className={"toaster-bread-mask"} style={{
        position: "absolute",
        left: "22.5%",
        bottom: "86.5%",
        width: "55%",
        height: "150%",
        overflow: "hidden",
        zIndex: 2,
        pointerEvents: "none"
      }}>{<Motion.motion.div className={"toaster-bread"} animate={breadAnimation} style={{
          position: "absolute",
          bottom: 0,
          width: "100%",
          aspectRatio: "1122 / 1402"
        }}>{<img className={"toaster-bread-normal"} src={toasterAssetUrl(config.NORMAL_BREAD_IMG)} alt={showToastedBread ? "" : "bread"} aria-hidden={showToastedBread} draggable={false} loading={"eager"} decoding={"sync"} style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "contain",
            opacity: showToastedBread ? 0 : 1
          }} />}{<img className={"toaster-bread-burnt"} src={toasterAssetUrl(config.BURNT_BREAD_IMG)} alt={showToastedBread ? "pane bruciato" : ""} aria-hidden={!showToastedBread} draggable={false} loading={"eager"} decoding={"sync"} style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "contain",
            opacity: showToastedBread ? 1 : 0
          }} />}</Motion.motion.div>}</div>}{<img className={"toaster-body"} src={toasterAssetUrl(config.TOASTER_IMG)} alt={"toaster"} style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        objectFit: "contain",
        zIndex: 1,
        pointerEvents: "none"
      }} />}{<img className={"toaster-casing-occluder"} src={toasterAssetUrl(config.TOASTER_IMG)} alt={""} aria-hidden={"true"} draggable={false} style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        objectFit: "contain",
        clipPath: "polygon(89.5% 26.5%,93.58% 26.95%,92.93% 27.43%,92.57% 28.55%,92.54% 30%,93.39% 57.95%,93.73% 59.35%,94.10% 60.08%,94.71% 60.27%,94.71% 62%,89.5% 62%)",
        zIndex: 4,
        pointerEvents: "none"
      }} />}{<Motion.AnimatePresence>{phase === "toasting" && <React.Fragment>{<Motion.motion.div initial={{
            opacity: 0
          }} animate={{
            opacity: 0.8
          }} exit={{
            opacity: 0
          }} style={{
            position: "absolute",
            top: "5%",
            left: "20%",
            width: "60%",
            height: "15%",
            background: "radial-gradient(ellipse at center, rgba(255,150,0,0.6) 0%, transparent 70%)",
            zIndex: 5,
            pointerEvents: "none",
            filter: "blur(8px)"
          }} />}{<Motion.motion.div initial={{
            opacity: 0,
            y: 10
          }} animate={reducedMotion ? {
            opacity: 0.2,
            y: 0
          } : {
            opacity: [0, 0.6, 0],
            y: -30
          }} transition={{
            repeat: 1 / 0,
            duration: 1.5,
            ease: "linear"
          }} style={{
            position: "absolute",
            top: "-10%",
            left: "30%",
            width: "40%",
            height: "30%",
            background: "radial-gradient(circle, rgba(200,200,200,0.8) 0%, transparent 70%)",
            zIndex: 5,
            pointerEvents: "none",
            filter: "blur(12px)"
          }} />}</React.Fragment>}</Motion.AnimatePresence>}</Motion.motion.div>}{phase === "done" && <div className={"toaster-result"} role={"dialog"} aria-modal={"true"} aria-label={"Risultato della tostatura"} aria-describedby={"toaster-result-text"} style={{
      position: "absolute",
      inset: 0,
      zIndex: 30,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "transparent",
      padding: "var(--ui-top) var(--ui-side) var(--ui-bottom)",
      fontFamily: "var(--font-body)",
      textAlign: "center"
    }}>{<p id={"toaster-result-text"} className={"toaster-result-text"} style={{
        position: "absolute",
        left: "var(--ui-side)",
        right: "var(--ui-side)",
        bottom: "calc(var(--ui-bottom) + 60px)",
        margin: 0,
        maxWidth: "100%",
        fontSize: "max(20px, calc(24px * var(--ui-scale)))",
        lineHeight: 1.3,
        overflowWrap: "anywhere",
        fontWeight: 800,
        color: "#4b352a"
      }}>{config.RESULT_TEXT}</p>}{<button className={"toaster-again"} autoFocus={true} type={"button"} onClick={resetToaster} style={{
        position: "absolute",
        left: "50%",
        bottom: "var(--ui-bottom)",
        transform: "translateX(-50%)",
        minWidth: 112,
        minHeight: 44,
        border: 0,
        borderRadius: 999,
        padding: "12px 28px",
        background: "#4b352a",
        color: "#fff",
        fontFamily: "var(--font-body)",
        fontSize: 18,
        fontWeight: 700
      }}>{"Riprova"}</button>}</div>}</div>;
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
  const selectors = ["p.toaster-guide"];
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
