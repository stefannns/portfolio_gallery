// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "FLUID_DISSIPATION",
    "kind": "number",
    "label": "Particle Fade Speed",
    "value": 2,
    "default": 2,
    "min": 0.5,
    "max": 5,
    "step": 0.1
  }, {
    "id": "SCRUB_SENSITIVITY",
    "kind": "number",
    "label": "Scrub Sensitivity",
    "value": 0.3,
    "default": 0.3,
    "min": 0.1,
    "max": 1,
    "step": 0.1
  }, {
    "id": "SHOW_PROGRESS",
    "kind": "boolean",
    "label": "Show Progress Bar",
    "value": false,
    "default": false
  }],
  "texts": [{
    "id": "TXT_TITLE",
    "label": "Main Title",
    "value": "Serpente",
    "default": "Serpente",
    "max_length": 25
  }, {
    "id": "TXT_HINT",
    "label": "Hint Text",
    "value": "Usa le frecce per giocare",
    "default": "Usa le frecce per giocare",
    "max_length": 50
  }],
  "images": [{
    "id": "IMG_CONSOLE",
    "label": "Realistic Console Frame",
    "path": "./assets/yellow-handheld-20261021.webp",
    "replaceable": true
  }, {
    "id": "BG_STONE",
    "label": "Stone Tablet",
    "path": "./assets/motion/reveal.svg",
    "replaceable": true
  }],
  "motions": [{
    "id": "MOTION_REVEAL",
    "label": "Reveal Text Motion",
    "base_path": "./assets/motion/reveal.svg",
    "frame_count": 24,
    "duration": 5,
    "aspect_ratio": "9:16"
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "99279521022691650",
    "version_id": "99279521022601594",
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
    body { background: transparent; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.snake-start-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.snake-start-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.snake-start-guide){animation:none!important}}

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
function App() {
  const createElement = React.createElement;
  const canvasRef = React.useRef(null);
  const gameRef = React.useRef({
    snake: [{
      x: 7,
      y: 4
    }, {
      x: 6,
      y: 4
    }, {
      x: 5,
      y: 4
    }],
    food: {
      x: 11,
      y: 6
    },
    dir: {
      x: 1,
      y: 0
    },
    next: {
      x: 1,
      y: 0
    },
    score: 0,
    over: false,
    paused: false,
    started: false
  });
  const [score, setScore] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [consoleImage, setConsoleImage] = React.useState("./assets/yellow-handheld-20261021.webp");
  const audioRef = React.useRef(null);
  const feedbackTimerRef = React.useRef(null);
  const [activeControl, setActiveControl] = React.useState("");
  const embeddedPreview = typeof location !== "undefined" && window.parent !== window && (/^batch(?:-|$)/.test(new URLSearchParams(location.search).get("review") || "") || new URLSearchParams(location.search).get("feedReview") === "1");
  const [started, setStarted] = React.useState(false);
  const [previewActive, setPreviewActive] = React.useState(embeddedPreview);
  const enteredRef = React.useRef(!embeddedPreview);
  const previewTimeRef = React.useRef(0);
  const [reducedMotion, setReducedMotion] = React.useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const reducedMotionRef = React.useRef(reducedMotion);
  React.useEffect(() => {
    const value = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const handleAction = () => {
      reducedMotionRef.current = !!value?.matches;
      setReducedMotion(!!value?.matches);
    };
    value?.addEventListener?.("change", handleAction);
    const handleAction2 = value2 => {
      if (!(!embeddedPreview || value2.source !== window.parent || value2.origin !== location.origin || value2.data?.type !== "playable-active")) {
        enteredRef.current = value2.data.active === true;
        setPreviewActive(!enteredRef.current);
        if (!enteredRef.current) {
          audioRef.current?.stop();
        }
      }
    };
    window.addEventListener("message", handleAction2);
    return () => {
      value?.removeEventListener?.("change", handleAction);
      window.removeEventListener("message", handleAction2);
    };
  }, []);
  const controlFeedback = (value, otherValue) => {
    setActiveControl(value);
    clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setActiveControl(""), 150);
    try {
      if (!audioRef.current) {
        audioRef.current = window.createSnakeConsoleFeedback?.();
      }
      audioRef.current?.play(otherValue, true);
    } catch {}
  };
  React.useEffect(() => () => {
    clearTimeout(feedbackTimerRef.current);
    audioRef.current?.destroy();
  }, []);
  React.useEffect(() => {
    let enabled = true;
    requestGameConfig().then(response => response.ok ? response.json() : Promise.reject()).then(response => {
      const value = (response.images || []).find(item => item.id === "IMG_CONSOLE");
      if (enabled && value?.path) {
        setConsoleImage(value.path);
      }
    }).catch(() => {});
    return () => {
      enabled = false;
    };
  }, []);
  const chooseFood = value => {
    let point;
    do point = {
      x: Math.floor(Math.random() * 16),
      y: Math.floor(Math.random() * 10)
    }; while (value.some(point2 => point2.x === point.x && point2.y === point.y));
    return point;
  };
  const previewSnake = value => {
    const items = [];
    for (let value5 = 3; value5 <= 9; value5++) items.push({
      x: value5,
      y: 3
    });
    for (let value5 = 4; value5 <= 8; value5++) items.push({
      x: 9,
      y: value5
    });
    for (let value5 = 8; value5 >= 3; value5--) items.push({
      x: value5,
      y: 8
    });
    for (let value5 = 7; value5 >= 4; value5--) items.push({
      x: 3,
      y: value5
    });
    const value2 = value / 215;
    const value3 = Math.floor(value2);
    const value4 = value2 - value3;
    return Array.from({
      length: 5
    }, (value5, otherValue) => {
      const value6 = (value3 - otherValue + items.length * 20) % items.length;
      const point = items[value6];
      const x = items[(value6 + 1) % items.length];
      return {
        x: point.x + (x.x - point.x) * value4,
        y: point.y + (x.y - point.y) * value4
      };
    });
  };
  const drawSnake = (value = previewTimeRef.current) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    const current = gameRef.current;
    context.fillStyle = "#aab194";
    context.fillRect(0, 0, 320, 225);
    context.fillStyle = "#202921";
    context.textAlign = "center";
    context.font = "bold 35px monospace";
    context.fillText(String(current.score), 160, 34);
    context.textAlign = "left";
    const value2 = 16;
    const value3 = 32;
    const value4 = 45;
    const value5 = !current.started && !current.over && !reducedMotionRef.current;
    context.fillStyle = "#1d281f";
    context.fillRect(value3 + current.food.x * value2 + 2, value4 + current.food.y * value2 + 2, 13, 13);
    if (value5) {
      context.globalAlpha = 0.35 + 0.3 * (1 + Math.sin(value / 330)) / 2;
      context.strokeStyle = "#1d281f";
      context.lineWidth = 1;
      context.strokeRect(value3 + current.food.x * value2 - 1, value4 + current.food.y * value2 - 1, 19, 19);
      context.globalAlpha = 1;
    }
    (value5 ? previewSnake(value) : current.snake).forEach((point, x) => {
      context.fillStyle = x === 0 ? "#1b251d" : "#242d23";
      context.fillRect(value3 + point.x * value2 + 2, value4 + point.y * value2 + 2, 13, 13);
    });
    if (current.over) {
      context.fillStyle = "#aab194df";
      context.fillRect(22, 75, 276, 80);
      context.fillStyle = "#19251e";
      context.textAlign = "center";
      context.font = "bold 23px monospace";
      context.fillText("PARTITA FINITA", 160, 112);
      context.font = "14px monospace";
      context.fillText("PREMI RICOMINCIA", 160, 139);
      context.textAlign = "left";
    }
    if (current.paused && !current.over && current.started) {
      context.fillStyle = "#aab194df";
      context.fillRect(60, 85, 200, 55);
      context.fillStyle = "#19251e";
      context.font = "bold 26px monospace";
      context.textAlign = "center";
      context.fillText("PAUSED", 160, 121);
      context.textAlign = "left";
    }
  };
  React.useEffect(() => {
    if (started || reducedMotion) {
      drawSnake();
      return;
    }
    let value = 0;
    let timestamp = performance.now();
    const handleAction = value2 => {
      if (value = 0, document.hidden) return;
      const value3 = Math.min(50, Math.max(0, value2 - timestamp));
      timestamp = value2;
      previewTimeRef.current += value3;
      drawSnake(previewTimeRef.current);
      value = requestAnimationFrame(handleAction);
    };
    const handleAction2 = () => {
      cancelAnimationFrame(value);
      value = 0;
      if (!document.hidden) {
        timestamp = performance.now();
        value = requestAnimationFrame(handleAction);
      }
    };
    if (!document.hidden) {
      value = requestAnimationFrame(handleAction);
    }
    document.addEventListener("visibilitychange", handleAction2);
    return () => {
      cancelAnimationFrame(value);
      document.removeEventListener("visibilitychange", handleAction2);
    };
  }, [started, reducedMotion]);
  React.useEffect(() => {
    drawSnake();
    const value = setInterval(() => {
      const current = gameRef.current;
      if (current.over || current.paused || !current.started || document.hidden || !enteredRef.current) return;
      current.dir = current.next;
      const point = {
        x: current.snake[0].x + current.dir.x,
        y: current.snake[0].y + current.dir.y
      };
      if (point.x < 0 || point.x >= 16 || point.y < 0 || point.y >= 10 || current.snake.some((point2, index) => index < current.snake.length - 1 && point2.x === point.x && point2.y === point.y)) {
        current.over = true;
        setSubmitting(true);
        audioRef.current?.play("over");
        drawSnake();
        return;
      }
      current.snake.unshift(point);
      if (point.x === current.food.x && point.y === current.food.y) {
        current.score++;
        setScore(current.score);
        current.food = chooseFood(current.snake);
        audioRef.current?.play("eat");
        if (navigator.vibrate) {
          navigator.vibrate(10);
        }
      } else {
        current.snake.pop();
      }
      drawSnake();
    }, 215);
    const handleAction = event => {
      const options = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        w: [0, -1],
        s: [0, 1],
        a: [-1, 0],
        d: [1, 0]
      };
      if (options[event.key]) {
        event.preventDefault();
        changeDirection(...options[event.key]);
      }
    };
    window.addEventListener("keydown", handleAction);
    return () => {
      clearInterval(value);
      window.removeEventListener("keydown", handleAction);
    };
  }, []);
  const changeDirection = (value, otherValue) => {
    const current = gameRef.current;
    if (enteredRef.current) {
      if (!(current.dir.x + value === 0 && current.dir.y + otherValue === 0 || current.over)) {
        controlFeedback("dir-" + value + "," + otherValue, "click");
        current.started = true;
        setStarted(true);
        current.next = {
          x: value,
          y: otherValue
        };
        drawSnake();
      }
    }
  };
  const restartGame = () => {
    if (enteredRef.current) {
      controlFeedback("restart", "restart");
      gameRef.current = {
        snake: [{
          x: 7,
          y: 4
        }, {
          x: 6,
          y: 4
        }, {
          x: 5,
          y: 4
        }],
        food: {
          x: 11,
          y: 6
        },
        dir: {
          x: 1,
          y: 0
        },
        next: {
          x: 1,
          y: 0
        },
        score: 0,
        over: false,
        paused: false,
        started: false
      };
      setScore(0);
      setSubmitting(false);
      setPaused(false);
      setStarted(false);
      previewTimeRef.current = 0;
      drawSnake();
    }
  };
  const togglePause = () => {
    if (!(!enteredRef.current || !gameRef.current.started || gameRef.current.over)) {
      controlFeedback("pause", gameRef.current.paused ? "resume" : "pause");
      gameRef.current.paused = !gameRef.current.paused;
      setPaused(gameRef.current.paused);
      drawSnake();
    }
  };
  const controlStyle = {
    position: "absolute",
    width: 44,
    height: 44,
    padding: 0,
    border: 0,
    borderRadius: "50%",
    background: "transparent",
    color: "#4f4d25",
    display: "grid",
    placeItems: "center",
    transform: "translate(-50%,-50%)",
    cursor: "pointer",
    touchAction: "manipulation"
  };
  const renderIcon = value => <svg width={20} height={20} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={2} strokeLinecap={"round"} strokeLinejoin={"round"} aria-hidden={true}>{<path d={value} />}</svg>;
  const renderDirectionButton = (a, otherValue, argument3, argument4, left, argument6) => <button type={"button"} className={"snake-console-control"} aria-label={a} data-feedback={activeControl === "dir-" + argument3 + "," + argument4} onClick={() => changeDirection(argument3, argument4)} style={{
    ...controlStyle,
    left: left,
    top: argument6
  }}>{renderIcon(otherValue)}</button>;
  return <div className={"snake-game"} data-feed-preview={previewActive} data-started={started} style={{
    width: "100%",
    height: "100%",
    overflow: "hidden",
    background: "#a0d4b6",
    position: "relative",
    containerType: "size",
    display: "grid",
    placeItems: "center",
    boxSizing: "border-box",
    fontFamily: "Poppins,Arial,sans-serif"
  }}>{<style>{".snake-console-control{transition:box-shadow 100ms ease,color 100ms ease}.snake-console-control svg{transition:transform 100ms ease}.snake-console-control:active,.snake-console-control[data-feedback=true]{background:rgba(135,107,24,.15)!important;box-shadow:inset 0 2px 5px #64531955;color:#343d24!important}.snake-console-control:active svg,.snake-console-control[data-feedback=true] svg{transform:translateY(1px) scale(.88)}.snake-console-control:focus-visible{outline:3px solid #244e3e;outline-offset:3px}@media(prefers-reduced-motion:reduce){.snake-console-control,.snake-console-control svg{transition:none}.snake-console-control:active svg,.snake-console-control[data-feedback=true] svg{transform:none}}"}</style>}{<style>{`
      @font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
      .snake-game{--console-width:min(118cqw,calc((100cqh - 88px)/1.14))}
      .snake-game[data-feed-preview=true]{--console-width:min(118cqw,calc((100cqh - 80px)/1.14),calc((30cqh + 10px)/.432),calc((100cqw - 152px)/.562))}
      .snake-device{position:absolute!important;width:var(--console-width)!important;aspect-ratio:2/3;left:50%;top:calc(50% + 12px);transform:translate(-50%,-50%)}
      .snake-game[data-feed-preview=true] .snake-device{top:calc(50% - 44px)}
      .snake-start-guide{position:absolute;left:6px;right:6px;top:20%;margin:0;text-align:center;font-size:clamp(12px,calc(var(--console-width)*.0465),20px);line-height:1.2;color:#294b3b;pointer-events:none;animation:snake-guide-breathe 2.8s ease-in-out infinite}
      .snake-console-control:disabled{opacity:.45;cursor:default}
      .snake-game[data-feed-preview=true] .snake-console-control{pointer-events:none}
      @keyframes snake-guide-breathe{50%{opacity:.7}}
      html[data-feed-background] .snake-start-guide{animation-play-state:paused}
      @media(prefers-reduced-motion:reduce){.snake-start-guide{animation:none}}
      @media(max-height:450px) and (min-aspect-ratio:1/1){.snake-game{--console-width:min(52cqw,calc((100cqh - 24px)/1.5))}.snake-device{left:34%;top:12px;transform:translateX(-50%)}.snake-game[data-feed-preview=true]{--console-width:min(48cqw,calc((100cqh - 24px)/1.5))}.snake-game[data-feed-preview=true] .snake-device{left:50%;top:50%;transform:translate(-50%,-50%)}}
    `}</style>}{<div className={"snake-device"} style={{
      position: "relative",
      width: "min(100%,calc((100dvh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px)) / 1.5))",
      aspectRatio: "2 / 3",
      overflow: "hidden"
    }}>{<img src={consoleImage} alt={""} width={780} height={1170} draggable={false} aria-hidden={true} style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "contain",
        pointerEvents: "none",
        userSelect: "none"
      }} />}{<div className={"snake-lcd"} style={{
        position: "absolute",
        top: "19.5%",
        left: "16.3%",
        width: "67.4%",
        aspectRatio: "320/225",
        borderRadius: 4,
        overflow: "hidden"
      }}>{<canvas ref={canvasRef} width={320} height={225} aria-label={"Snake game, score " + score} style={{
          width: "100%",
          height: "100%",
          display: "block",
          imageRendering: "pixelated"
        }} />}{!started && <p className={"snake-start-guide"}>{"Usa le frecce per iniziare"}</p>}</div>}{<button type={"button"} className={"snake-console-control"} aria-label={paused ? "Riprendi" : "Pausa"} aria-pressed={paused} disabled={!started || submitting} data-feedback={activeControl === "pause"} onClick={togglePause} style={{
        ...controlStyle,
        left: "29.3%",
        top: "65.6%",
        width: "max(54px,19%)",
        borderRadius: 22
      }}>{renderIcon(paused ? "M8 5l11 7-11 7Z" : "M9 5v14M15 5v14")}</button>}{<button type={"button"} className={"snake-console-control"} aria-label={"Ricomincia"} data-feedback={activeControl === "restart"} onClick={restartGame} style={{
        ...controlStyle,
        left: "29.3%",
        top: "78.8%",
        width: "max(54px,19%)",
        borderRadius: 22
      }}>{renderIcon("M3 10a9 9 0 1 1 2 9M3 4v6h6")}</button>}{renderDirectionButton("Vai su", "M6 15l6-6 6 6", 0, -1, "67%", "62.3%")}{renderDirectionButton("Vai a sinistra", "M15 6l-6 6 6 6", -1, 0, "54.7%", "71.1%")}{renderDirectionButton("Vai a destra", "M9 6l6 6-6 6", 1, 0, "78.1%", "71.1%")}{renderDirectionButton("Vai giù", "M6 9l6 6 6-6", 0, 1, "67%", "78.8%")}</div>}</div>;
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

// ./snake-feedback.js
/* Short, gesture-unlocked console cues. No music or idle oscillator. */
(function () {
  window.createSnakeConsoleFeedback = function () {
    let context = null;
    let master = null;
    let destroyed = false;
    let generation = 0;
    let lastClick = -Infinity;
    const voices = new Set();
    const stop = () => {
      generation++;
      for (const voice of [...voices]) {
        try {
          voice.oscillator.stop();
        } catch (value) {}
        voice.oscillator.disconnect();
        voice.gain.disconnect();
        voices.delete(voice);
      }
    };
    const note = (frequency, start, duration, type, peak, endFrequency) => {
      if (voices.size >= 8) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const voice = {
        oscillator,
        gain
      };
      voices.add(voice);
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      gain.gain.setValueAtTime(0, start + duration + 0.01);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        voices.delete(voice);
      };
      oscillator.start(start);
      oscillator.stop(start + duration + 0.015);
    };
    const emit = kind => {
      if (destroyed || document.hidden || context.state !== 'running') return;
      const currentTime = context.currentTime;
      if (kind === 'click') {
        if (currentTime - lastClick < 0.055) return;
        lastClick = currentTime;
        note(900, currentTime, 0.055, 'triangle', 0.22, 330);
      } else if (kind === 'eat') {
        note(660, currentTime, 0.09, 'triangle', 0.24);
        note(990, currentTime + 0.065, 0.12, 'triangle', 0.22);
      } else if (kind === 'over') {
        [330, 220, 145].forEach((item, index) => note(item, currentTime + index * 0.105, 0.16, 'sine', 0.22));
      } else if (kind === 'restart') {
        note(440, currentTime, 0.08, 'triangle', 0.22);
        note(660, currentTime + 0.06, 0.11, 'triangle', 0.22);
      } else {
        note(kind === 'pause' ? 280 : 520, currentTime, 0.085, 'triangle', 0.22);
      }
    };
    const play = (kind, gesture = false) => {
      if (destroyed || document.hidden) return;
      try {
        if (!context) {
          if (!gesture) return;
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) return;
          context = new Audio();
          master = context.createGain();
          master.gain.value = 0.32;
          master.connect(context.destination);
        }
        if (context.state === 'running') emit(kind);else if (gesture) {
          const token = generation;
          Promise.resolve(context.resume()).then(() => {
            if (token === generation) emit(kind);
          }).catch(() => {});
        }
      } catch (value) {/* Audio failure must never block game input. */}
    };
    const hide = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', stop);
    return {
      play,
      stop,
      destroy() {
        destroyed = true;
        stop();
        document.removeEventListener('visibilitychange', hide);
        window.removeEventListener('pagehide', stop);
        if (master) master.disconnect();
        if (context) try {
          Promise.resolve(context.close()).catch(() => {});
        } catch (value) {}
      }
    };
  };
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
  const selectors = [".snake-start-guide"];
  const copy = new Set(["Usa le frecce per giocare"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
