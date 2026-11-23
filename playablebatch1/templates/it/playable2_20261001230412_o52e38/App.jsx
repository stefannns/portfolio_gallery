// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "SPEED_INIT",
    "kind": "number",
    "label": "Initial Speed",
    "value": 0.5,
    "default": 0.5,
    "min": 0.1,
    "max": 0.8,
    "step": 0.05
  }, {
    "id": "SPEED_INC",
    "kind": "number",
    "label": "Speed Increment",
    "value": 0.015,
    "default": 0.015,
    "min": 0.005,
    "max": 0.05,
    "step": 0.005
  }, {
    "id": "PERFECT_TOL",
    "kind": "number",
    "label": "Perfect Tolerance",
    "value": 5,
    "default": 5,
    "min": 5,
    "max": 30,
    "step": 1
  }],
  "texts": [{
    "id": "TITLE",
    "label": "Game Title",
    "value": "Torre",
    "default": "Torre",
    "max_length": 20
  }, {
    "id": "SCORE_TXT",
    "label": "Score Label",
    "value": "PUNTI",
    "default": "PUNTI",
    "max_length": 15
  }, {
    "id": "PERFECT_TXT",
    "label": "Perfect Text",
    "value": "PERFETTO!",
    "default": "PERFETTO!",
    "max_length": 20
  }, {
    "id": "GAMEOVER",
    "label": "Game Over Title",
    "value": "PARTITA FINITA",
    "default": "PARTITA FINITA",
    "max_length": 20
  }, {
    "id": "BTN_RETRY",
    "label": "Retry Button",
    "value": "RIPROVA",
    "default": "RIPROVA",
    "max_length": 15
  }, {
    "id": "BTN_POST",
    "label": "Post Button",
    "value": "CONDIVIDI",
    "default": "CONDIVIDI",
    "max_length": 25
  }],
  "images": [{
    "id": "BLOCK_IMG",
    "label": "Block Surface Texture",
    "path": "./assets/block_surface.svg",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "99280234071180629",
    "version_id": "99280234071098749",
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

    /* Keep the score centered as plain text across portrait mobile widths. */
    .stack-score {
      left: 25px !important;
      right: 25px !important;
      transform: none !important;
      max-width: none !important;
      min-height: 0 !important;
      padding: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      text-align: center !important;
      line-height: 1.1 !important;
      text-shadow: 0 3px 10px rgba(36, 27, 23, 0.58);
      font-variant-numeric: tabular-nums;
    }
    /* Preview CTA stays above the host entry button. Gameplay canvas is unchanged. */
    .stack-hint{top:18%!important;bottom:auto!important;line-height:1.4!important;font-weight:500!important}
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .stack-hint{position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.stack-hint){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.stack-hint){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.stack-hint){animation:none!important}}

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
  let submitRecording = React.useCallback(() => {
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
  }, [submitting, canSubmit]);
  return {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: submitRecording
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
function App() {
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("playing");
  let [score, setScore] = React.useState(0);
  let canvas = React.useRef(null);
  let world = React.useRef(null);
  let surface = React.useRef(null);
  let audio = React.useRef(null);
  let stateRef = React.useRef(0);
  let [timingHint, setTimingHint] = React.useState("show");
  React.useEffect(() => {
    if (phase !== "playing" || score === 0) {
      setTimingHint("show");
      return;
    }
    const fade = setTimeout(() => setTimingHint("fading"), 1200);
    const hide = setTimeout(() => setTimingHint("hidden"), 1700);
    return () => {
      clearTimeout(fade);
      clearTimeout(hide);
    };
  }, [phase, score > 0]);
  let {
    canSubmit,
    submitting,
    submitRecording
  } = useRecordingSubmission();
  React.useEffect(() => {
    let live = true;
    (async () => {
      let data = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let response = await requestGameConfig();
        if (response.ok) data = await response.json();
      } catch {}
      if (live) setConfig(readConfigValues(data));
    })();
    return () => {
      live = false;
    };
  }, []);
  React.useEffect(() => {
    if (!config?.BLOCK_IMG) return;
    let image = new Image();
    image.onload = () => surface.current = image;
    image.src = config.BLOCK_IMG;
    return () => {
      surface.current = null;
    };
  }, [config]);
  let colors = [{
    top: "#f7a9ba",
    front: "#d96f8a",
    side: "#bd526f"
  }, {
    top: "#ffc983",
    front: "#e79a4c",
    side: "#c97a38"
  }, {
    top: "#ffe59a",
    front: "#dfbc59",
    side: "#bf993f"
  }, {
    top: "#afe0c5",
    front: "#74ba98",
    side: "#55997d"
  }, {
    top: "#9fdcec",
    front: "#5bafd0",
    side: "#4389ad"
  }, {
    top: "#bfc8ff",
    front: "#8390dc",
    side: "#6671bd"
  }, {
    top: "#d6b0f0",
    front: "#9e72c3",
    side: "#7e55a1"
  }];
  let makeWorld = () => ({
    blocks: [{
      x0: -2,
      x1: 2,
      y0: -2,
      y1: 2,
      level: 0,
      color: colors[0]
    }],
    current: {
      axis: "x",
      offset: 4.9,
      dir: -1,
      level: 1
    },
    debris: [],
    effects: [],
    camera: 0,
    score: 0,
    phase: "playing",
    lastTime: performance.now(),
    overAt: 0
  });
  let reset = event => {
    event?.stopPropagation();
    world.current = makeWorld();
    setScore(0);
    setPhase("playing");
  };
  let activeBounds = stateRef2 => {
    let base = stateRef2.blocks[stateRef2.blocks.length - 1];
    let current = stateRef2.current;
    if (!current) return null;
    return current.axis === "x" ? {
      x0: base.x0 + current.offset,
      x1: base.x1 + current.offset,
      y0: base.y0,
      y1: base.y1,
      level: current.level,
      color: colors[current.level % colors.length]
    } : {
      x0: base.x0,
      x1: base.x1,
      y0: base.y0 + current.offset,
      y1: base.y1 + current.offset,
      level: current.level,
      color: colors[current.level % colors.length]
    };
  };
  let sound = kind => {
    try {
      let AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      let value = audio.current || (audio.current = new AudioCtor());
      if (value.state === "suspended") value.resume().catch(() => {});
      let start = value.currentTime;
      let oscillator = value.createOscillator();
      let gain = value.createGain();
      oscillator.type = kind === "fail" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(kind === "fail" ? 170 : kind === "perfect" ? 660 : 440, start);
      if (kind === "perfect") oscillator.frequency.exponentialRampToValueAtTime(880, start + 0.12);
      if (kind === "fail") oscillator.frequency.exponentialRampToValueAtTime(85, start + 0.2);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + (kind === "fail" ? 0.3 : 0.18));
      oscillator.connect(gain).connect(value.destination);
      oscillator.start(start);
      oscillator.stop(start + (kind === "fail" ? 0.32 : 0.2));
    } catch {}
  };
  let place = event => {
    if (event?.isPrimary === false) return;
    let stateRef2 = world.current;
    if (!stateRef2 || stateRef2.phase !== "playing" || !stateRef2.current) return;
    let base = stateRef2.blocks[stateRef2.blocks.length - 1];
    let moving = activeBounds(stateRef2);
    let axis = stateRef2.current.axis;
    let tolerance = (Number(config?.PERFECT_TOL) || 12) / (Math.max(1, canvas.current?.clientWidth || 390) * 0.08);
    let perfect = Math.abs(stateRef2.current.offset) <= tolerance;
    let value = axis === "x" ? "x0" : "y0";
    let high = axis === "x" ? "x1" : "y1";
    let start = perfect ? base[value] : Math.max(base[value], moving[value]);
    let value2 = perfect ? base[high] : Math.min(base[high], moving[high]);
    if (value2 - start <= 0.02) {
      stateRef2.debris.push({
        ...moving,
        drop: 0,
        velocity: 0,
        alpha: 1
      });
      stateRef2.current = null;
      stateRef2.phase = "falling";
      stateRef2.overAt = performance.now() + 650;
      setPhase("falling");
      sound("fail");
      return;
    }
    let placed = {
      ...moving,
      [value]: start,
      [high]: value2
    };
    stateRef2.blocks.push(placed);
    if (!perfect) {
      if (moving[value] < start) stateRef2.debris.push({
        ...moving,
        [high]: start,
        drop: 0,
        velocity: 0,
        alpha: 1
      });
      if (moving[high] > value2) stateRef2.debris.push({
        ...moving,
        [value]: value2,
        drop: 0,
        velocity: 0,
        alpha: 1
      });
    } else stateRef2.effects.push({
      text: config?.PERFECT_TXT || "PERFETTO!",
      level: placed.level,
      life: 650,
      x: (placed.x0 + placed.x1) / 2,
      y: (placed.y0 + placed.y1) / 2
    });
    stateRef2.score++;
    setScore(stateRef2.score);
    sound(perfect ? "perfect" : "normal");
    try {
      if (perfect && window.tt?.vibrate) window.tt.vibrate({
        style: "light"
      });
    } catch {}
    let nextLevel = placed.level + 1;
    let nextAxis = axis === "x" ? "y" : "x";
    stateRef2.current = {
      axis: nextAxis,
      offset: nextLevel % 2 ? 4.9 : -4.9,
      dir: nextLevel % 2 ? -1 : 1,
      level: nextLevel
    };
  };
  React.useEffect(() => {
    if (!config || !canvas.current) return;
    let dimensions = canvas.current;
    let resize = () => {
      let value = Math.min(2, window.devicePixelRatio || 1);
      dimensions.width = Math.max(1, Math.round(dimensions.clientWidth * value));
      dimensions.height = Math.max(1, Math.round(dimensions.clientHeight * value));
    };
    resize();
    window.addEventListener("resize", resize);
    if (!world.current) world.current = makeWorld();
    let polygon = (context, points, color) => {
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let value = 1; value < points.length; value++) context.lineTo(points[value].x, points[value].y);
      context.closePath();
      context.fill();
    };
    let frame = value => {
      let stateRef2 = world.current;
      let clientWidth = dimensions.clientWidth;
      let clientHeight = dimensions.clientHeight;
      let value2 = Math.min(2, window.devicePixelRatio || 1);
      let context = dimensions.getContext("2d", {
        alpha: false
      });
      if (stateRef2 && clientWidth && clientHeight && context) {
        let value3 = Math.min(32, Math.max(0, value - stateRef2.lastTime));
        stateRef2.lastTime = value;
        let unit = Math.min(clientWidth * 0.08, clientHeight * 0.066);
        let unitY = unit * 0.38;
        let layer = unit * 0.96;
        let originY = clientHeight * 0.665;
        if (stateRef2.phase === "playing" && stateRef2.current) {
          let speed = (Number(config.SPEED_INIT) || 0.35) * 9 + stateRef2.score * (Number(config.SPEED_INC) || 0.015) * 9;
          stateRef2.current.offset += stateRef2.current.dir * speed * value3 / 1000;
          if (stateRef2.current.offset > 5.2) {
            stateRef2.current.offset = 5.2;
            stateRef2.current.dir = -1;
          }
          if (stateRef2.current.offset < -5.2) {
            stateRef2.current.offset = -5.2;
            stateRef2.current.dir = 1;
          }
        }
        if (stateRef2.phase === "falling" && value >= stateRef2.overAt) {
          stateRef2.phase = "gameover";
          setPhase("gameover");
        }
        let targetCam = Math.max(0, stateRef2.blocks.length - 5) * layer;
        stateRef2.camera += (targetCam - stateRef2.camera) * Math.min(1, value3 * 0.008);
        for (let piece of stateRef2.debris) {
          piece.velocity += value3 * 0.0018;
          piece.drop += piece.velocity * value3;
          piece.alpha -= value3 * 0.0009;
        }
        stateRef2.debris = stateRef2.debris.filter(piece => piece.alpha > 0 && piece.drop < clientHeight);
        for (let effect of stateRef2.effects) effect.life -= value3;
        stateRef2.effects = stateRef2.effects.filter(effect => effect.life > 0);
        let point = (x, y, z) => ({
          x: clientWidth / 2 + (x - y) * unit,
          y: originY + (x + y) * unitY - z * layer + stateRef2.camera
        });
        context.setTransform(value2, 0, 0, value2, 0, 0);
        let backdrop = context.createRadialGradient(clientWidth * 0.55, clientHeight * 0.43, clientWidth * 0.08, clientWidth * 0.5, clientHeight * 0.48, clientHeight * 0.9);
        backdrop.addColorStop(0, "#30476b");
        backdrop.addColorStop(0.55, "#1b2945");
        backdrop.addColorStop(1, "#121a2d");
        context.fillStyle = backdrop;
        context.fillRect(0, 0, clientWidth, clientHeight);
        context.save();
        let gridFade = context.createLinearGradient(0, clientHeight * 0.34, 0, clientHeight * 0.7);
        gridFade.addColorStop(0, "rgba(143,182,221,0)");
        gridFade.addColorStop(0.38, "rgba(143,182,221,.055)");
        gridFade.addColorStop(1, "rgba(143,182,221,.22)");
        context.strokeStyle = gridFade;
        context.lineWidth = 1;
        for (let value4 = -14; value4 <= 14; value4 += 2) {
          let point2 = point(value4, -14, -2);
          let point3 = point(value4, 14, -2);
          let point4 = point(-14, value4, -2);
          let point5 = point(14, value4, -2);
          context.beginPath();
          context.moveTo(point2.x, point2.y);
          context.lineTo(point3.x, point3.y);
          context.moveTo(point4.x, point4.y);
          context.lineTo(point5.x, point5.y);
          context.stroke();
        }
        context.restore();
        let shadow = point(0, 0, -1);
        context.fillStyle = "#07101c70";
        context.beginPath();
        context.ellipse(shadow.x, shadow.y + 26, unit * 5.4, unit * 1.75, 0, 0, Math.PI * 2);
        context.fill();
        let drawBlock = (piece, drop = 0, alpha = 1) => {
          let z = piece.level;
          let value4 = piece.color || colors[z % colors.length];
          let point2 = point(piece.x0, piece.y0, z);
          let point3 = point(piece.x1, piece.y0, z);
          let point4 = point(piece.x1, piece.y1, z);
          let point5 = point(piece.x0, piece.y1, z);
          for (let value5 of [point2, point3, point4, point5]) value5.y += drop;
          let down = point6 => ({
            x: point6.x,
            y: point6.y + layer
          });
          context.save();
          context.globalAlpha = alpha;
          polygon(context, [point3, point4, down(point4), down(point3)], value4.side);
          polygon(context, [point5, point4, down(point4), down(point5)], value4.front);
          polygon(context, [point2, point3, point4, point5], value4.top);
          context.strokeStyle = "#fff9";
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(point2.x, point2.y);
          context.lineTo(point3.x, point3.y);
          context.lineTo(point4.x, point4.y);
          context.lineTo(point5.x, point5.y);
          context.closePath();
          context.stroke();
          let image = surface.current;
          if (image && image.complete && image.naturalWidth) {
            let minX = Math.min(point2.x, point3.x, point4.x, point5.x);
            let maxX = Math.max(point2.x, point3.x, point4.x, point5.x);
            let minY = Math.min(point2.y, point3.y, point4.y, point5.y);
            let maxY = Math.max(point2.y, point3.y, point4.y, point5.y);
            context.save();
            context.beginPath();
            context.moveTo(point2.x, point2.y);
            context.lineTo(point3.x, point3.y);
            context.lineTo(point4.x, point4.y);
            context.lineTo(point5.x, point5.y);
            context.closePath();
            context.clip();
            context.globalAlpha = 0.22 * alpha;
            context.drawImage(image, minX, minY, maxX - minX, maxY - minY);
            context.restore();
          }
          context.restore();
        };
        for (let block of stateRef2.blocks) drawBlock(block);
        for (let piece of stateRef2.debris) drawBlock(piece, piece.drop, piece.alpha);
        if (stateRef2.current && stateRef2.phase === "playing") drawBlock(activeBounds(stateRef2));
        context.textAlign = "center";
        context.font = '700 20px "Poppins",system-ui,sans-serif';
        for (let effect of stateRef2.effects) {
          let point2 = point(effect.x, effect.y, effect.level);
          context.globalAlpha = Math.min(1, effect.life / 250);
          context.fillStyle = "#fff";
          context.shadowColor = "#739ee0";
          context.shadowBlur = 9;
          context.fillText(effect.text, point2.x, point2.y - 45 - (650 - effect.life) * 0.04);
          context.shadowBlur = 0;
        }
        context.globalAlpha = 1;
      }
      stateRef.current = requestAnimationFrame(frame);
    };
    stateRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(stateRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [config]);
  React.useEffect(() => {
    let handleAction = event => {
      if ((event.code === "Space" || event.code === "Enter") && !event.repeat) {
        event.preventDefault();
        place(event);
      }
    };
    window.addEventListener("keydown", handleAction);
    return () => window.removeEventListener("keydown", handleAction);
  }, [config]);
  return config ? <div className={"stack-game"} tabIndex={0} role={"button"} aria-label={(config.TITLE || "Torre") + " — tap or press space to place the moving block"} onPointerDown={place}>{<style>{`
.stack-game{position:relative;width:100%;height:100%;overflow:hidden;touch-action:manipulation;background:#121a2d;cursor:pointer}
.stack-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.stack-score{position:absolute;top:calc(30px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);max-width:calc(100% - 60px);color:#fff;font:700 clamp(24px,7vw,32px) "Poppins",system-ui,sans-serif;letter-spacing:.02em;white-space:nowrap;text-shadow:0 3px 12px #07101c99;pointer-events:none}
.stack-hint{position:absolute;bottom:calc(50px + env(safe-area-inset-bottom));left:30px;right:30px;color:#fff;text-align:center;font:700 18px "Poppins",system-ui,sans-serif;letter-spacing:0;text-shadow:0 2px 8px #07101ccc;pointer-events:none}
.stack-timing-hint{transition:opacity .35s ease-out}.stack-timing-hint[data-fading=true]{opacity:0}
@media(prefers-reduced-motion:reduce){.stack-timing-hint{transition:none}}
.stack-modal{position:absolute;inset:0;z-index:5;background:#07101ccc;display:flex;align-items:center;justify-content:center;padding:30px 30px 50px;cursor:default}
.stack-card{width:min(100%,360px);padding:28px 24px;border-radius:24px;background:#f5f7ff;color:#1b2945;text-align:center;box-shadow:0 22px 50px #20171399}
.stack-card h2{margin:0 0 8px;font:700 clamp(28px,8vw,42px) "Poppins",system-ui,sans-serif}
.stack-final{font:700 18px "Poppins",system-ui,sans-serif;margin:0 0 24px;color:#586887}
.stack-buttons{display:flex;gap:12px;flex-wrap:wrap}
.stack-button{display:flex;align-items:center;justify-content:center;text-align:center;flex:1 1 125px;min-height:52px;border:0;border-radius:14px;background:#6557d8;color:white;font:700 16px "Poppins",system-ui,sans-serif;line-height:1.25;white-space:normal;overflow-wrap:anywhere;padding:10px 14px;cursor:pointer}
.stack-button.secondary{background:#dce5ff;color:#1b2945}
.stack-button:active{filter:brightness(.88)}
.stack-button:focus-visible,.stack-game:focus-visible{outline:3px solid #fff;outline-offset:3px}
.stack-button:disabled{opacity:.5;cursor:not-allowed}
`}</style>}{<canvas className={"stack-canvas"} ref={canvas} aria-hidden={true} />}{<div className={"stack-score"} aria-live={"polite"} aria-label={"Punti " + score}>{score}</div>}{phase === "playing" && (score === 0 || timingHint !== "hidden") && <div className={score === 0 ? "stack-hint" : "stack-hint stack-timing-hint"} data-fading={timingHint === "fading"}>{score === 0 ? "TOCCA PER IMPILARE" : "TOCCA AL MOMENTO GIUSTO"}</div>}{phase === "gameover" && <div className={"stack-modal"} onPointerDown={event => event.stopPropagation()}>{<div className={"stack-card"}>{<h2>{config.GAMEOVER || "PARTITA FINITA"}</h2>}{<p className={"stack-final"}>{config.SCORE_TXT || "PUNTI"}{" "}{score}</p>}{<div className={"stack-buttons"}>{<button type={"button"} className={"stack-button"} onClick={reset}>{config.BTN_RETRY || "RIPROVA"}</button>}{canSubmit && <button type={"button"} className={"stack-button secondary"} disabled={submitting} onClick={submitRecording}>{config.BTN_POST || "CONDIVIDI"}</button>}</div>}</div>}</div>}</div> : <div style={{
    width: "100%",
    height: "100%",
    background: "#121a2d"
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

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [".stack-hint"];
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
