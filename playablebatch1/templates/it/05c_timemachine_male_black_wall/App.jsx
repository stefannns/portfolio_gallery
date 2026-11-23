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
    "id": "DEFAULT_INDEX",
    "kind": "number",
    "label": "默认年龄索引",
    "value": 7,
    "default": 7,
    "min": 0,
    "max": 14,
    "step": 1
  }],
  "texts": [{
    "id": "TITLE",
    "label": "标题",
    "value": "MACCHINA DEL TEMPO",
    "default": "MACCHINA DEL TEMPO",
    "max_length": 20
  }],
  "images": [{
    "id": "AGE_01",
    "label": "1岁",
    "path": "./assets/age_01.webp",
    "replaceable": true
  }, {
    "id": "AGE_03",
    "label": "3岁",
    "path": "./assets/age_03.webp",
    "replaceable": true
  }, {
    "id": "AGE_05",
    "label": "5岁",
    "path": "./assets/age_05.webp",
    "replaceable": true
  }, {
    "id": "AGE_07",
    "label": "7岁",
    "path": "./assets/age_07.webp",
    "replaceable": true
  }, {
    "id": "AGE_10",
    "label": "10岁",
    "path": "./assets/age_10.webp",
    "replaceable": true
  }, {
    "id": "AGE_12",
    "label": "12岁",
    "path": "./assets/age_12.webp",
    "replaceable": true
  }, {
    "id": "AGE_16",
    "label": "16岁",
    "path": "./assets/age_16.webp",
    "replaceable": true
  }, {
    "id": "AGE_22",
    "label": "22岁",
    "path": "./assets/age_22.webp",
    "replaceable": true
  }, {
    "id": "AGE_28",
    "label": "28岁",
    "path": "./assets/age_28.webp",
    "replaceable": true
  }, {
    "id": "AGE_38",
    "label": "38岁",
    "path": "./assets/age_38.webp",
    "replaceable": true
  }, {
    "id": "AGE_47",
    "label": "47岁",
    "path": "./assets/age_47.webp",
    "replaceable": true
  }, {
    "id": "AGE_55",
    "label": "55岁",
    "path": "./assets/age_55.webp",
    "replaceable": true
  }, {
    "id": "AGE_65",
    "label": "65岁",
    "path": "./assets/age_65_v2.webp",
    "replaceable": true
  }, {
    "id": "AGE_75",
    "label": "75岁",
    "path": "./assets/age_75.webp",
    "replaceable": true
  }, {
    "id": "AGE_85",
    "label": "85岁",
    "path": "./assets/age_85.webp",
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
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .time-print-guide{position:fixed!important;top:93%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .time-print-guide{position:absolute!important;top:calc(100% - var(--print-width) * .10)!important;width:88%!important;max-width:none!important;background:transparent!important;color:#293c34;padding:0!important;border-radius:0!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.time-print-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.time-print-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.time-print-guide){animation:none!important}}

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
    let handleAction = () => {
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
    current.dispose = handleAction;
    let handleAction2 = () => {
      if (document.hidden) {
        handleAction();
      }
    };
    document.addEventListener("visibilitychange", handleAction2);
    window.addEventListener("pagehide", handleAction);
    return () => {
      current.alive = false;
      handleAction();
      document.removeEventListener("visibilitychange", handleAction2);
      window.removeEventListener("pagehide", handleAction);
    };
  }, [audioRef, tone]);
  let ensureAudio = value => {
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
  ensureAudio.stop = () => lifecycleRef.current.dispose?.();
  return ensureAudio;
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
var AGE_STAGES = [{
  age: 1,
  stage: "Prima infanzia",
  imgId: "AGE_01"
}, {
  age: 3,
  stage: "Prima infanzia",
  imgId: "AGE_03"
}, {
  age: 5,
  stage: "Prima infanzia",
  imgId: "AGE_05"
}, {
  age: 7,
  stage: "Infanzia",
  imgId: "AGE_07"
}, {
  age: 10,
  stage: "Infanzia",
  imgId: "AGE_10"
}, {
  age: 12,
  stage: "Infanzia",
  imgId: "AGE_12"
}, {
  age: 16,
  stage: "Gioventù",
  imgId: "AGE_16"
}, {
  age: 22,
  stage: "Gioventù",
  imgId: "AGE_22"
}, {
  age: 28,
  stage: "Gioventù",
  imgId: "AGE_28"
}, {
  age: 38,
  stage: "Mezza età",
  imgId: "AGE_38"
}, {
  age: 47,
  stage: "Mezza età",
  imgId: "AGE_47"
}, {
  age: 55,
  stage: "Mezza età",
  imgId: "AGE_55"
}, {
  age: 65,
  stage: "Anziano",
  imgId: "AGE_65"
}, {
  age: 75,
  stage: "Anziano",
  imgId: "AGE_75"
}, {
  age: 85,
  stage: "Anziano",
  imgId: "AGE_85"
}];
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
var FONT_STYLES = `@font-face{font-family:"DM Sans";src:url("./assets/fonts/ui/DMSans.woff") format("woff");font-style:normal;font-weight:100 1000;font-display:swap}
:root{--font-display:"DM Sans","PingFang SC",system-ui,sans-serif;--font-body:"DM Sans","PingFang SC",system-ui,sans-serif;--ui-ink:#30352f;--ui-surface:#efeee8}
.ui-game{font-family:var(--font-body);font-optical-sizing:auto;font-synthesis:none;-webkit-font-smoothing:antialiased}
.ui-game button{font-family:var(--font-body);font-weight:700;letter-spacing:0;line-height:1.25}
.ui-game .ui-guide{font-family:var(--font-body);font-weight:600;letter-spacing:0;line-height:1.35}
`;
function App() {
  let [config, setConfig] = React.useState(null);
  let [ageIndex, setAgeIndex] = React.useState(7);
  let [timelineProgress, setTimelineProgress] = React.useState(7 / 14);
  let [dragging, setDragging] = React.useState(false);
  let [started, setStarted] = React.useState(false);
  let timelineRef = React.useRef(null);
  let ageIndexRef = React.useRef(7);
  let audioRef = React.useRef({
    ready: false,
    lastTime: 0,
    synth: null
  });
  let surfaceRef = React.useRef(null);
  let activePointerRef = React.useRef(null);
  let reducedMotion = useResponsiveSurface(surfaceRef, !!config);
  let previewActive = useFeedPreviewActive();
  let surfaceVisible = useSurfaceVisibility(surfaceRef, !!config);
  React.useEffect(() => {
    if (!config || !previewActive || !surfaceVisible || reducedMotion) return;
    let value = 0;
    let timestamp = performance.now();
    let value2;
    let handleAction = value3 => {
      let value4 = Math.min(80, value3 - timestamp);
      timestamp = value3;
      if (!document.hidden) {
        value += value4;
      }
      let value5 = value < 900 ? 7 : value < 1750 ? 9 : value < 2600 ? 12 : 7;
      setAgeIndex(value5);
      setTimelineProgress(value5 / 14);
      if (value < 3350) {
        value2 = requestAnimationFrame(handleAction);
      }
    };
    value2 = requestAnimationFrame(handleAction);
    return () => {
      cancelAnimationFrame(value2);
      setAgeIndex(ageIndexRef.current);
      setTimelineProgress(ageIndexRef.current / 14);
    };
  }, [config, previewActive, surfaceVisible, reducedMotion]);
  let ensureAudio = useAudioLifecycle(Tone, audioRef);
  React.useEffect(() => {
    let handleAction = () => {
      activePointerRef.current = null;
      setDragging(false);
      setTimelineProgress(ageIndexRef.current / 14);
    };
    let handleAction2 = () => {
      if (document.hidden) {
        handleAction();
      }
    };
    let handleAction3 = value => {
      if (value.source === parent && value.origin === location.origin && value.data?.type === "playable-active" && value.data.active !== true) {
        handleAction();
      }
    };
    window.addEventListener("blur", handleAction);
    document.addEventListener("visibilitychange", handleAction2);
    window.addEventListener("message", handleAction3);
    return () => {
      window.removeEventListener("message", handleAction3);
      window.removeEventListener("blur", handleAction);
      document.removeEventListener("visibilitychange", handleAction2);
    };
  }, []);
  React.useEffect(() => {
    let enabled = true;
    (async () => {
      let value = await loadGameConfig();
      if (enabled) {
        let config2 = readConfigValues(value);
        setConfig(config2);
        let value2 = Math.max(0, Math.min(14, Math.round(config2.DEFAULT_INDEX ?? 7)));
        ageIndexRef.current = value2;
        setAgeIndex(value2);
        setTimelineProgress(value2 / 14);
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  let initAudio = () => ensureAudio(() => {
    let synth = new Tone.Synth({
      oscillator: {
        type: "sine"
      },
      envelope: {
        attack: 0.005,
        decay: 0.1,
        sustain: 0,
        release: 0.1
      }
    }).toDestination();
    synth.volume.value = -15;
    return {
      synth: synth,
      lastTime: 0
    };
  });
  let playAgeTick = React.useCallback(() => {
    let current = audioRef.current;
    if (!current.ready || !current.synth) return;
    let timestamp = Tone.now();
    let value = timestamp > current.lastTime ? timestamp : current.lastTime + 0.01;
    current.lastTime = value;
    current.synth.triggerAttackRelease("C6", "32n", value);
  }, []);
  let seekAge = React.useCallback(value => {
    if (!timelineRef.current) return;
    let bounds = timelineRef.current.getBoundingClientRect();
    let value2 = 0;
    let value3 = (value - bounds.left - value2) / (bounds.width - value2 * 2);
    value3 = Math.max(0, Math.min(1, value3));
    setTimelineProgress(value3);
    let value4 = Math.round(value3 * 14);
    if (ageIndexRef.current !== value4) {
      playAgeTick();
    }
    ageIndexRef.current = value4;
    setAgeIndex(value4);
  }, [playAgeTick]);
  let startTimelineDrag = event => {
    if (event.isPrimary === false || event.button !== 0 || activePointerRef.current !== null) return;
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    let clientX = event.clientX;
    initAudio();
    setStarted(true);
    setDragging(true);
    seekAge(clientX);
  };
  let continueTimelineDrag = event => {
    if (activePointerRef.current === event.pointerId) {
      seekAge(event.clientX);
    }
  };
  let finishTimelineDrag = event => {
    if (activePointerRef.current === event.pointerId) {
      seekAge(event.clientX);
      activePointerRef.current = null;
      setDragging(false);
      setTimelineProgress(ageIndexRef.current / 14);
    }
  };
  if (!config) return null;
  let ageStage = AGE_STAGES[ageIndex];
  let pageStyle = {
    width: "100%",
    height: "100%",
    backgroundColor: "#efeee8",
    backgroundImage: "radial-gradient(ellipse at 50% 30%, #faf9f5 0%, transparent 75%)",
    color: "#30352f",
    display: "flex",
    flexDirection: "column",
    fontFamily: "var(--font-body)",
    overflow: "hidden",
    userSelect: "none",
    WebkitUserSelect: "none"
  };
  let headerStyle = {
    flex: "0 0 auto",
    padding: "var(--ui-top) var(--ui-side) 8px",
    textAlign: "center"
  };
  let eyebrowStyle = {
    fontSize: "14px",
    letterSpacing: "5px",
    color: "rgba(255,255,255,0.58)",
    margin: "0 0 9px 0",
    fontWeight: 600
  };
  let headingStyle = {
    fontSize: "calc(28px * var(--ui-scale))",
    fontWeight: 700,
    margin: 0,
    letterSpacing: "-.6px",
    fontVariantNumeric: "tabular-nums"
  };
  let photoAreaStyle = {
    flex: 1,
    minHeight: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "8px var(--ui-side) 8px",
    containerType: "size"
  };
  let photoWrapperStyle = {
    width: "100%",
    height: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center"
  };
  let printStyle = {
    "--print-width": "min(100cqw, calc(100cqh * 30 / 43))",
    width: "var(--print-width)",
    height: "calc(var(--print-width) * 43 / 30)",
    padding: "calc(var(--print-width) * .06) calc(var(--print-width) * .06) calc(var(--print-width) * .20)",
    margin: 0,
    flexShrink: 0,
    position: "relative",
    borderRadius: "1px",
    background: "linear-gradient(115deg, #fffefa, #f8f7f2)",
    boxShadow: "0 14px 24px -10px #36332a35, 0 2px 5px #36332a12, inset 0 0 0 1px #ffffffc0"
  };
  let imageWindowStyle = {
    width: "100%",
    height: "100%",
    position: "relative",
    overflow: "hidden",
    boxShadow: "0 0 0 1px #24292420",
    backgroundColor: "#222"
  };
  let footerStyle = {
    flex: "0 0 auto",
    padding: "0 var(--ui-side) var(--ui-bottom)"
  };
  let timelineStyle = {
    position: "relative",
    height: "44px",
    display: "flex",
    alignItems: "center",
    touchAction: "none",
    cursor: "pointer",
    margin: "0 12px"
  };
  return <div ref={surfaceRef} data-feed-preview={previewActive} className={"app-shell ui-game"} style={pageStyle} aria-label={config.TITLE}>{<style>{`
        ${RESPONSIVE_STYLES}
        * { box-sizing: border-box; }
        html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
        .app-shell { position: relative; isolation: isolate; }
        .app-shell::before {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          opacity: .14;
          mix-blend-mode: soft-light;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.42'/%3E%3C/svg%3E");
        }
        .app-shell > *:not(.ui-guide) { position: relative; z-index: 1; }
        .time-print-guide{position:absolute;left:50%;right:auto;top:calc(100% - var(--print-width) * .10);bottom:auto;width:88%;margin:0;translate:-50% -50%;text-align:center;font-size:max(14px,calc(18px * var(--ui-scale)));color:#666b61;line-height:1.4}
        .app-shell[data-feed-preview="true"] .time-footer{visibility:hidden;pointer-events:none}
      `}</style>}{<style>{FONT_STYLES}</style>}{<div style={headerStyle}>{<h2 style={headingStyle}>{"Età "}{ageStage.age}</h2>}</div>}{<div style={photoAreaStyle}>{<div style={photoWrapperStyle}>{<figure className={"time-print"} style={printStyle}>{<div className={"time-print-window"} style={imageWindowStyle}>{AGE_STAGES.map((item, index) => <img key={item.imgId} src={config[item.imgId]} alt={`Età ${item.age}`} aria-hidden={index !== ageIndex} draggable={false} style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: index === ageIndex ? 1 : 0,
              transition: "opacity 0.15s ease-out",
              pointerEvents: "none"
            }} />)}</div>}{!started && <figcaption className={"ui-guide ui-float time-print-guide"}>{"Trascina per cambiare età"}</figcaption>}</figure>}</div>}</div>}{<div className={"time-footer"} style={footerStyle}>{<div ref={timelineRef} style={timelineStyle} onPointerDown={startTimelineDrag} onPointerMove={continueTimelineDrag} onPointerUp={finishTimelineDrag} onPointerCancel={event => {
        if (activePointerRef.current === event.pointerId) {
          activePointerRef.current = null;
          setDragging(false);
          setTimelineProgress(ageIndexRef.current / 14);
        }
      }} onLostPointerCapture={event => {
        if (activePointerRef.current === event.pointerId) {
          activePointerRef.current = null;
          setDragging(false);
          setTimelineProgress(ageIndexRef.current / 14);
        }
      }} role={"slider"} tabIndex={0} aria-label={"Linea delle età"} aria-valuemin={0} aria-valuemax={14} aria-valuenow={ageIndex} aria-valuetext={`Età ${ageStage.age}, ${ageStage.stage}`} onKeyDown={event => {
        let item = {
          ArrowLeft: -1,
          ArrowDown: -1,
          ArrowRight: 1,
          ArrowUp: 1
        }[event.key];
        if (item === void 0 && !["Home", "End"].includes(event.key)) return;
        event.preventDefault();
        initAudio();
        setStarted(true);
        let value = event.key === "Home" ? 0 : event.key === "End" ? 14 : Math.max(0, Math.min(14, ageIndexRef.current + item));
        if (value !== ageIndexRef.current) {
          playAgeTick();
        }
        ageIndexRef.current = value;
        setAgeIndex(value);
        setTimelineProgress(value / 14);
      }}>{<div style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: "2px",
          background: "#cccfc5",
          borderRadius: "1px"
        }} />}{<div style={{
          position: "absolute",
          left: 0,
          width: `${timelineProgress * 100}%`,
          height: "2px",
          background: "#8c75bd",
          borderRadius: "1px"
        }} />}{AGE_STAGES.map((item, index) => {
          let value = index % 3 === 1;
          let value2 = index === ageIndex;
          return <div key={index} style={{
            position: "absolute",
            left: `${index / 14 * 100}%`,
            width: value ? "8px" : "4px",
            height: value ? "8px" : "4px",
            background: index <= ageIndex ? "#8c75bd" : "#b7bbb1",
            transform: "translate(-50%, -50%)",
            top: "50%",
            borderRadius: "50%",
            boxShadow: value ? "0 0 0 3px #efeee8, 0 0 0 4px #b7bbb1" : "none",
            transition: "background 0.2s, transform .2s"
          }}>{index === 0 || index === 14 ? <span aria-hidden={"true"} style={{
              position: "absolute",
              left: "50%",
              top: "24px",
              transform: "translateX(-50%)",
              fontSize: "14px",
              fontWeight: 500,
              color: "#646b60",
              background: "transparent",
              padding: 0,
              whiteSpace: "nowrap",
              pointerEvents: "none"
            }}>{item.age}</span> : null}</div>;
        })}{<div style={{
          position: "absolute",
          left: `${timelineProgress * 100}%`,
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: "22px",
          height: "22px",
          borderRadius: "50%",
          background: "#8c75bd",
          boxShadow: "0 2px 7px #40324d2c",
          transition: dragging ? "none" : "left 0.2s cubic-bezier(0.2, 0, 0, 1)",
          pointerEvents: "none"
        }}>{<div style={{
            position: "absolute",
            inset: "7px",
            borderRadius: "50%",
            background: "#fffefa"
          }} />}</div>}</div>}{<div aria-hidden={"true"} style={{
        height: 20
      }} />}</div>}</div>;
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
  const selectors = [".time-print-guide"];
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
