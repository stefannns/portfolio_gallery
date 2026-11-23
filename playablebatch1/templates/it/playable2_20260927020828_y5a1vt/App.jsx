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
    "id": "INITIAL_SPEED",
    "kind": "number",
    "label": "Initial Speed",
    "value": 0.18,
    "default": 0.18,
    "min": 0.05,
    "max": 0.3,
    "step": 0.01
  }, {
    "id": "SPEED_INCREMENT",
    "kind": "number",
    "label": "Speed Increment",
    "value": 0.025,
    "default": 0.025,
    "min": 0.005,
    "max": 0.05,
    "step": 0.001
  }, {
    "id": "MAX_SPEED",
    "kind": "number",
    "label": "Max Speed",
    "value": 0.5,
    "default": 0.5,
    "min": 0.3,
    "max": 1,
    "step": 0.01
  }, {
    "id": "NEEDLE_PIVOT_Y",
    "kind": "number",
    "label": "Needle Pivot Y (%)",
    "value": 82,
    "default": 82,
    "min": 50,
    "max": 100,
    "step": 1
  }, {
    "id": "NEEDLE_HEIGHT_PERCENT",
    "kind": "number",
    "label": "Needle Height (%)",
    "value": 45,
    "default": 45,
    "min": 30,
    "max": 60,
    "step": 1
  }],
  "texts": [{
    "id": "LEVEL_PREFIX",
    "label": "Level Prefix",
    "value": "LIVELLO ",
    "default": "LIVELLO ",
    "max_length": 10
  }, {
    "id": "TARGET_PREFIX",
    "label": "Target Prefix",
    "value": "OBIETTIVO:",
    "default": "OBIETTIVO:",
    "max_length": 12
  }, {
    "id": "TAP_RED",
    "label": "Red Target Text",
    "value": "TOCCA IL ROSSO",
    "default": "TOCCA IL ROSSO",
    "max_length": 15
  }, {
    "id": "TAP_BLUE",
    "label": "Blue Target Text",
    "value": "TOCCA IL BLU",
    "default": "TOCCA IL BLU",
    "max_length": 15
  }, {
    "id": "TAP_YELLOW",
    "label": "Yellow Target Text",
    "value": "TOCCA IL GIALLO",
    "default": "TOCCA IL GIALLO",
    "max_length": 15
  }, {
    "id": "TIP_TEXT",
    "label": "Bottom Tip",
    "value": "Tocca quando la lancetta è sul colore giusto",
    "default": "Tocca quando la lancetta è sul colore giusto",
    "max_length": 50
  }, {
    "id": "BTN_RESTART",
    "label": "Restart Button",
    "value": "RIGIOCA",
    "default": "RIGIOCA",
    "max_length": 20
  }, {
    "id": "POST_PLAY",
    "label": "Post Button",
    "value": "CONDIVIDI",
    "default": "CONDIVIDI",
    "max_length": 20
  }],
  "images": [{
    "id": "BG_WHEEL",
    "label": "Ruota dei colori",
    "path": "./assets/bg_wheel.webp",
    "replaceable": true
  }, {
    "id": "ICON_NEEDLE",
    "label": "Needle Indicator",
    "path": "./assets/icon_needle.webp",
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
    /* The wheel component now sizes from its available stage, preserving its aspect ratio. */
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.cw-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.cw-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.cw-guide){animation:none!important}}

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
function GameStyles() {
  return <style>{`
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
      
      --color-bg: #0a0a0c;
      --color-red: #ff2a5f;
      --color-blue: #00e5ff;
      --color-text: #ffffff;
      --color-text-dim: #888899;
      --color-panel: rgba(255, 255, 255, 0.1);
    }
    html, body, #root { 
      width: 100%; height: 100%; margin: 0; padding: 0; 
      overflow: hidden; background-color: var(--color-bg);
      font-family: var(--font-body);
      color: var(--color-text);
      user-select: none; -webkit-user-select: none;
      touch-action: none;
    }
    * { box-sizing: border-box; }
    
    .hud-text { font-family: var(--font-display); }
    .neon-red { color: var(--color-red); text-shadow: 0 0 10px var(--color-red); }
    .neon-blue { color: var(--color-blue); text-shadow: 0 0 10px var(--color-blue); }
    
    .btn {
      background: transparent; border: 2px solid var(--color-text-dim);
      color: var(--color-text); padding: 12px 24px; border-radius: 30px;
      font-family: var(--font-display); font-size: 1.1rem;
      cursor: pointer; transition: all 0.2s;
    }
    .btn:active { transform: scale(0.95); }
    .btn.primary {
      background: var(--color-text); color: var(--color-bg); border-color: var(--color-text);
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  `}</style>;
}
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
  let submitRecording = React.useCallback(() => {
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
  }, [submitting, canSubmit]);
  return {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: submitRecording
  };
}
var audioDestination = Tone.getContext().destination;
function vibrate(style = "light") {
  try {
    if (typeof window !== "undefined" && window.tt && window.tt.vibrate) {
      window.tt.vibrate({
        style: style
      });
    }
  } catch {}
}
function ColorWheelGame({
  cfg: config
}) {
  let [phase, setPhase] = React.useState("playing");
  let [round, setRound] = React.useState(1);
  let [score, setScore] = React.useState(0);
  let [targetColor, setTargetColor] = React.useState("ROSSO");
  let wheelRef = React.useRef(null);
  let needleRef = React.useRef(null);
  let lastFrameRef = React.useRef(0);
  let angleRef = React.useRef(0);
  let speedRef = React.useRef(config.INITIAL_SPEED);
  let directionRef = React.useRef(1);
  let audioReadyRef = React.useRef(false);
  let hitSynthRef = React.useRef(null);
  let missSynthRef = React.useRef(null);
  let [guideVisible, setGuideVisible] = React.useState(true);
  let containerRef = React.useRef(null);
  let [wheelSize, setWheelSize] = React.useState(260);
  let {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: submitRecording
  } = useRecordingSubmission();
  let initAudio = async () => {
    if (!audioReadyRef.current) try {
      await Tone.start();
      hitSynthRef.current = new Tone.Synth().toDestination();
      missSynthRef.current = new Tone.MembraneSynth().toDestination();
      audioDestination.volume.value = -8;
      audioReadyRef.current = true;
    } catch (value) {
      console.error("Audio start failed", value);
    }
  };
  let playHit = () => {
    if (hitSynthRef.current) {
      hitSynthRef.current.triggerAttackRelease("C5", "16n", Tone.now());
    }
  };
  let playMiss = () => {
    if (missSynthRef.current) {
      missSynthRef.current.triggerAttackRelease("G2", "8n", Tone.now());
    }
  };
  let animateWheel = React.useCallback(value => {
    if (!lastFrameRef.current) {
      lastFrameRef.current = value;
    }
    let value2 = Math.min(value - lastFrameRef.current, 100);
    lastFrameRef.current = value;
    if (phase === "playing") {
      angleRef.current = (angleRef.current + directionRef.current * speedRef.current * value2) % 360;
      if (wheelRef.current) {
        wheelRef.current.style.transform = `translate(-50%, -${config.NEEDLE_PIVOT_Y}%) rotate(${angleRef.current}deg)`;
      }
    }
    needleRef.current = requestAnimationFrame(animateWheel);
  }, [phase, config.NEEDLE_PIVOT_Y]);
  React.useEffect(() => {
    if (!containerRef.current) return;
    const handleAction = () => {
      const dimensions = containerRef.current.getBoundingClientRect();
      setWheelSize(Math.max(1, Math.min(400, dimensions.width, dimensions.height)));
    };
    handleAction();
    const resizeObserver = observeGameSize(handleAction);
    resizeObserver.observe(containerRef.current);
    window.addEventListener("resize", handleAction);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleAction);
    };
  }, []);
  React.useEffect(() => {
    needleRef.current = requestAnimationFrame(animateWheel);
    return () => {
      if (needleRef.current) {
        cancelAnimationFrame(needleRef.current);
      }
    };
  }, [animateWheel]);
  let handleTap = async value => {
    if (phase !== "playing" || value?.isPrimary === false || value?.button > 0) return;
    setGuideVisible(false);
    initAudio();
    let value2 = angleRef.current % 360;
    if (value2 < 0) {
      value2 += 360;
    }
    let value3 = score >= 8 ? value2 >= 0 && value2 < 120 : value2 >= 0 && value2 < 180;
    let value4 = score >= 8 ? value2 >= 120 && value2 < 240 : value2 >= 180 && value2 < 360;
    let value5 = score >= 8 && value2 >= 240 && value2 < 360;
    let value6 = targetColor === "BLU";
    let value7 = targetColor === "GIALLO";
    if (score >= 8 ? value6 && value3 || value7 && value4 || targetColor === "ROSSO" && value5 : value6 && value3 || !value6 && value4) {
      playHit();
      vibrate("notification_success");
      setRound(value8 => value8 + 1);
      setScore(value8 => value8 + 1);
      speedRef.current = Math.min(speedRef.current + config.SPEED_INCREMENT, config.MAX_SPEED);
      if (Math.random() < 0.4) {
        directionRef.current *= -1;
      }
      setTargetColor(value8 => score + 1 >= 8 ? value8 === "ROSSO" ? "BLU" : value8 === "BLU" ? "GIALLO" : "ROSSO" : value8 === "ROSSO" ? "BLU" : "ROSSO");
    } else {
      playMiss();
      vibrate("notification_error");
      setPhase("over");
    }
  };
  let restartGame = () => {
    setPhase("playing");
    setGuideVisible(true);
    setRound(1);
    setScore(0);
    setTargetColor("ROSSO");
    angleRef.current = 0;
    speedRef.current = config.INITIAL_SPEED;
    directionRef.current = 1;
    lastFrameRef.current = 0;
  };
  return <div className={"cw-game"} style={{
    width: "100%",
    height: "100%",
    position: "relative",
    display: "flex",
    flexDirection: "column"
  }} onClick={handleTap}>{<style>{`
        .cw-stage{position:absolute;inset:max(140px,24%) 30px 22%;display:grid;place-items:center}
        .cw-guide{position:absolute;top:80%;left:30px;right:30px;margin:0;font-size:18px;line-height:1.5;text-align:center;pointer-events:none;color:#e8efff}
        .cw-target .cw-target-prefix{display:none}
        .cw-target{max-width:100%;overflow-wrap:anywhere}
      `}</style>}{<div className={"cw-header"} style={{
      flex: "0 0 auto",
      padding: "calc(30px + env(safe-area-inset-top, 0px)) 30px 20px",
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      textAlign: "center",
      zIndex: 10
    }}>{<div className={"hud-text"} style={{
        fontSize: "28px",
        textAlign: "left",
        lineHeight: 1.2,
        color: "var(--color-text-dim)"
      }} aria-label={"Turno " + round}>{"#"}{round}</div>}{<div className={"hud-text"} style={{
        fontSize: "28px",
        textAlign: "right",
        margin: 0,
        lineHeight: 1.2
      }} aria-label={"Punti " + score}>{score}</div>}{<div className={"cw-target"} style={{
        gridColumn: "1 / -1",
        justifySelf: "center",
        marginTop: "16px",
        display: "inline-block",
        background: "rgba(255,255,255,0.1)",
        padding: "8px 24px",
        borderRadius: "30px",
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.2)"
      }}>{<span className={"hud-text cw-target-prefix"} style={{
          color: "var(--color-text-dim)",
          marginRight: "8px"
        }}>{config.TARGET_PREFIX}</span>}{<span className={`hud-text ${targetColor === "ROSSO" ? "neon-red" : targetColor === "BLU" ? "neon-blue" : ""}`} style={{
          fontSize: "1.2rem",
          color: targetColor === "GIALLO" ? "#ffd84d" : void 0,
          textShadow: targetColor === "GIALLO" ? "0 0 10px rgba(255,216,77,.8)" : void 0
        }}>{targetColor === "ROSSO" ? config.TAP_RED : targetColor === "BLU" ? config.TAP_BLUE : config.TAP_YELLOW}</span>}</div>}</div>}{<div ref={containerRef} className={"cw-stage"}>{<div style={{
        width: wheelSize + "px",
        height: wheelSize + "px",
        maxWidth: "100%",
        maxHeight: "100%",
        aspectRatio: "1 / 1",
        position: "relative"
      }}>{<img src={config.BG_WHEEL} alt={"Ruota dei colori"} draggable={false} style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: score >= 8 ? "none" : "block"
        }} />}{score >= 8 && <div role={"img"} aria-label={"Ruota a tre colori"} style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: "conic-gradient(from 0deg, #11d7e8 0deg 120deg, #ffd84d 120deg 240deg, #ff174c 240deg 360deg)",
          boxShadow: "0 0 0 2px rgba(255,255,255,.3), 0 12px 30px rgba(0,0,0,.35)"
        }}>{<div style={{
            position: "absolute",
            inset: "30%",
            borderRadius: "50%",
            background: "#050510",
            boxShadow: "0 0 0 2px rgba(255,255,255,.12)"
          }} />}</div>}{<div style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none"
        }}>{<div ref={wheelRef} data-needle-pivot={"center"} style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            height: `${config.NEEDLE_HEIGHT_PERCENT}%`,
            width: `${config.NEEDLE_HEIGHT_PERCENT * 37 / 633}%`,
            transformOrigin: `50% ${config.NEEDLE_PIVOT_Y}%`,
            transform: `translate(-50%, -${config.NEEDLE_PIVOT_Y}%) rotate(0deg)`,
            willChange: "transform"
          }}>{<img src={config.ICON_NEEDLE} alt={"Lancetta"} draggable={false} style={{
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: "contain",
              transform: "rotate(180deg)",
              transformOrigin: "50% 50%"
            }} />}</div>}{<div aria-hidden={true} style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            background: "#e2e8f0",
            border: "3px solid #111827",
            boxShadow: "0 0 0 1px rgba(255,255,255,.45), 0 2px 6px rgba(0,0,0,.5)",
            transform: "translate(-50%, -50%)"
          }} />}</div>}</div>}</div>}{<div aria-hidden={true} style={{
      flex: "0 0 auto",
      height: "calc(40px + env(safe-area-inset-bottom, 0px))",
      pointerEvents: "none"
    }} />}{<p className={"cw-guide"} style={{
      visibility: guideVisible && phase === "playing" ? "visible" : "hidden"
    }} aria-hidden={!guideVisible || phase !== "playing"}>{config.TIP_TEXT || "Tocca quando la lancetta è sul colore giusto"}</p>}{<Motion.AnimatePresence>{phase === "over" && <Motion.motion.div initial={{
        opacity: 0
      }} animate={{
        opacity: 1
      }} exit={{
        opacity: 0
      }} style={{
        position: "absolute",
        inset: 0,
        zIndex: 100,
        backgroundColor: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(5px)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "20px"
      }} onClick={value => value.stopPropagation()}>{<Motion.motion.h1 initial={{
          scale: 0.5,
          y: 20
        }} animate={{
          scale: 1,
          y: 0
        }} className={"hud-text"} style={{
          fontSize: "3rem",
          textAlign: "center",
          margin: "0 0 10px 0"
        }}>{"PARTITA FINITA"}</Motion.motion.h1>}{<Motion.motion.div initial={{
          opacity: 0
        }} animate={{
          opacity: 1,
          transition: {
            delay: 0.2
          }
        }}>{<p style={{
            color: "var(--color-text-dim)",
            fontSize: "1.2rem",
            marginBottom: "40px",
            textAlign: "center"
          }}>{"PUNTI: "}{<span style={{
              color: "#fff",
              fontSize: "1.5rem"
            }}>{score}</span>}</p>}{<div style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            width: "100%",
            maxWidth: "240px"
          }}>{<button className={"btn primary"} onClick={restartGame}>{config.BTN_RESTART}</button>}{canSubmit && <button className={"btn"} disabled={submitting} onClick={submitRecording}>{config.POST_PLAY}</button>}</div>}</Motion.motion.div>}</Motion.motion.div>}</Motion.AnimatePresence>}</div>;
}
function App() {
  let [config, setConfig] = React.useState(null);
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
  return config ? <React.Fragment>{<GameStyles />}{<ColorWheelGame cfg={config} />}</React.Fragment> : <div style={{
    width: "100%",
    height: "100%",
    background: "#0a0a0c"
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

// ./ui-batch2-layout.js
/* State-specific layout only. No simulated input or preview demonstration. */
(() => {
  const html = document.documentElement;
  const host = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
  html.toggleAttribute('data-ui-batch2-preview', host);
  const style = document.createElement('style');
  style.textContent = `
    .cash-game .hud-score{color:#FFF0BA!important;text-shadow:none!important}
    .cw-header .hud-text{font-variant-numeric:tabular-nums}
    .cw-target .hud-text{font-size:18px!important;line-height:1.5}
    @media(max-height:450px){.string-board>svg{height:calc(100% - 90px)!important}}
    html[data-ui-batch2-preview] .cash-game .hud-panel{top:18%!important}
    html[data-ui-batch2-preview] .cash-game .tip-text{top:67%!important;bottom:auto!important;line-height:1.5}
    html[data-ui-batch2-preview] .string-hud{position:absolute;top:12%;left:30px;right:30px;padding:0!important}
    html[data-ui-batch2-preview] .string-board{position:absolute!important;inset:24% 0 20%}
    html[data-ui-batch2-preview] .string-guide{top:-12px;bottom:auto!important}
    .cw-game .cw-header{position:absolute;top:10%;left:30px;right:30px;padding:0!important}
    .cw-game .cw-target{margin-top:8px!important;padding:4px 16px!important}
    .cw-game .cw-target .hud-text{text-shadow:none!important}
    .cw-game .cw-stage{inset:26% 30px 36%}
    .cw-game .cw-guide{top:67%}
  `;
  document.head.append(style);
  window.addEventListener('message', event => {
    if (!host || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    html.toggleAttribute('data-ui-batch2-preview', event.data.active !== true);
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

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [".cw-guide"];
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
