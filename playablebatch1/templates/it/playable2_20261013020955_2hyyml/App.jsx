// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
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
    "id": "MIN_YEAR",
    "kind": "number",
    "label": "Min Year",
    "value": 1900,
    "default": 1900,
    "min": 1800,
    "max": 1950,
    "step": 1
  }, {
    "id": "MAX_YEAR",
    "kind": "number",
    "label": "Max Year",
    "value": 2026,
    "default": 2026,
    "min": 2000,
    "max": 2026,
    "step": 1
  }, {
    "id": "DEFAULT_YEAR",
    "kind": "number",
    "label": "Default Selected Year",
    "value": 1985,
    "default": 1985,
    "min": 1900,
    "max": 2026,
    "step": 1
  }],
  "texts": [{
    "id": "TITLE_MAIN",
    "label": "Main Title",
    "value": "FOTOCAMERA NEL TEMPO",
    "default": "FOTOCAMERA NEL TEMPO",
    "max_length": 20
  }, {
    "id": "BTN_RESET",
    "label": "Reset Button Text",
    "value": "Torna a oggi",
    "default": "Torna a oggi",
    "max_length": 20
  }, {
    "id": "BTN_BUILD",
    "label": "Build Button Text",
    "value": "APRI FOTOCAMERA",
    "default": "APRI FOTOCAMERA",
    "max_length": 20
  }, {
    "id": "BTN_BACK",
    "label": "Back Button Text",
    "value": "CAMBIA ANNO",
    "default": "CAMBIA ANNO",
    "max_length": 15
  }],
  "images": [],
  "config_version": "2.0",
  "playable": {
    "post_id": "103313238082752342",
    "version_id": "103313238082822325",
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
  
/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1);scale:1}50%{filter:opacity(.6);scale:1.035}}
html:root:root :is(.year-guide-copy){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.year-guide-copy){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.year-guide-copy){animation:none!important}}

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
function yearPalette(value) {
  return value < 1970 ? {
    name: "VINTAGE",
    bg: "#d4c5b9",
    text: "#4a3b32",
    accent: "#8c6239",
    cameraBg: "#2c241b",
    desc: "Warm nostalgic tones from a golden era.",
    haze: "rgba(212, 197, 185, 0.2)"
  } : value < 1990 ? {
    name: "NEON ANNI ’80",
    bg: "#0f0a1c",
    text: "#0ff",
    accent: "#f0f",
    cameraBg: "#05030a",
    desc: "Cyan and violet dreams of the synthesized future.",
    haze: "rgba(255, 0, 255, 0.15)"
  } : value < 2010 ? {
    name: "TECNOLOGIA Y2K",
    bg: "#e2e8f0",
    text: "#1e293b",
    accent: "#3b82f6",
    cameraBg: "#cbd5e1",
    desc: "Silver millennium vibes and early digital aesthetics.",
    haze: "rgba(255, 255, 255, 0.1)"
  } : {
    name: "MODERN",
    bg: "#18181b",
    text: "#f4f4f5",
    accent: "#10b981",
    cameraBg: "#000000",
    desc: "Crisp, minimal, and ultra-high definition.",
    haze: "rgba(0, 0, 0, 0)"
  };
}
var CAMERA_ERAS = {
  plate: {
    id: "plate",
    name: "LASTRA D’ARGENTO",
    desc: "Soft focus, silver grain and worn plate edges.",
    fps: 18,
    sensor: 880,
    filter: "grayscale(1) sepia(.32) contrast(1.16) brightness(.94)",
    blur: 0.8,
    grain: 0.27,
    vignette: 0.77,
    dust: 23,
    scratches: 5,
    weave: 0.85,
    fade: 0.035
  },
  mono: {
    id: "mono",
    name: "PELLICOLA B/N",
    desc: "Monochrome film, fine grain and light scratches.",
    fps: 24,
    sensor: 1120,
    filter: "grayscale(1) contrast(1.17)",
    blur: 0.42,
    grain: 0.2,
    vignette: 0.52,
    dust: 13,
    scratches: 3,
    weave: 0.35,
    fade: 0
  },
  color: {
    id: "color",
    name: "PELLICOLA A COLORI",
    desc: "Soft color film, grain and warm edge light leaks.",
    fps: 24,
    sensor: 1200,
    filter: "sepia(.15) saturate(.82) contrast(.93) brightness(1.04)",
    blur: 0.36,
    grain: 0.13,
    vignette: 0.36,
    dust: 7,
    scratches: 1,
    weave: 0.12,
    fade: 0.035,
    leak: true
  },
  tape: {
    id: "tape",
    name: "VIDEO ANALOGICO",
    desc: "Soft video detail, scanlines and subtle tape tracking.",
    fps: 24,
    sensor: 420,
    filter: "saturate(.84) contrast(.97)",
    blur: 0.28,
    grain: 0.095,
    vignette: 0.17,
    dust: 0,
    scratches: 0,
    weave: 0.15,
    scanlines: true,
    tracking: true
  },
  digital: {
    id: "digital",
    name: "PRIME DIGITALI",
    desc: "Low-resolution detail and small-sensor noise.",
    fps: 30,
    sensor: 480,
    filter: "saturate(.93) contrast(1.08)",
    blur: 0,
    grain: 0.065,
    vignette: 0.12,
    dust: 0,
    scratches: 0,
    weave: 0,
    pixelated: true
  },
  modern: {
    id: "modern",
    name: "MODERN",
    desc: "Clean detail with no film wear or analog artifacts.",
    fps: 30,
    sensor: 1920,
    filter: "none",
    blur: 0,
    grain: 0,
    vignette: 0,
    dust: 0,
    scratches: 0,
    weave: 0
  }
};
function eraForYear(value) {
  return CAMERA_ERAS[value < 1930 ? "plate" : value < 1950 ? "mono" : value < 1970 ? "color" : value < 1990 ? "tape" : value < 2010 ? "digital" : "modern"];
}
function themeForYear(value) {
  return {
    ...yearPalette(value),
    name: eraForYear(value).name,
    desc: eraForYear(value).desc
  };
}
var CAMERA_DEVICES = Object.freeze([{
  id: "antique",
  label: "fotocamera antica",
  before: 1930,
  src: "./assets/devices/antique-camera-front-20261026.webp"
}, {
  id: "film",
  label: "fotocamera a pellicola",
  before: 1990,
  src: "./assets/devices/film-camera-front-20261026.webp"
}, {
  id: "ccd",
  label: "fotocamera CCD",
  before: 2004,
  src: "./assets/devices/ccd-camera-front-20261026.webp"
}, {
  id: "camera-phone",
  label: "cellulare con fotocamera",
  before: 2010,
  src: "./assets/devices/camera-phone-front-20261026.webp"
}, {
  id: "smartphone",
  label: "smartphone moderno",
  before: 1 / 0,
  src: "./assets/devices/smartphone-front-20261026.webp"
}]);
function deviceForYear(value) {
  let value2 = Number.isFinite(value) ? Math.min(value, 2026) : 2026;
  return CAMERA_DEVICES.find(item => value2 < item.before);
}
function useCameraStream(facingMode, otherValue) {
  let videoRef = React.useRef(null);
  let stateRef = React.useRef(null);
  let stateRef2 = React.useRef(0);
  let [ready, setReady] = React.useState(false);
  let [error, setError] = React.useState(null);
  let callback = React.useCallback(() => {
    stateRef2.current++;
    if (stateRef.current) {
      stateRef.current.getTracks().forEach(item => item.stop());
      stateRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setReady(false);
  }, []);
  let attachVideo = React.useCallback(value => {
    videoRef.current = value;
    let current = stateRef.current;
    if (!value || !current) return;
    let y = stateRef2.current;
    value.srcObject = current;
    Promise.resolve(value.play()).then(() => {
      if (y === stateRef2.current && videoRef.current === value) {
        setReady(true);
      }
    }).catch(error2 => {
      if (y === stateRef2.current) {
        console.warn("[camera] Video playback failed", error2);
        setError("Impossibile avviare la fotocamera.");
      }
    });
  }, []);
  let restart = React.useCallback(async () => {
    if (!otherValue) return;
    callback();
    let current = stateRef2.current;
    setError(null);
    try {
      let value = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingMode
        }
      });
      if (current !== stateRef2.current || document.hidden) {
        value.getTracks().forEach(y => y.stop());
        return;
      }
      stateRef.current = value;
      attachVideo(videoRef.current);
    } catch (value) {
      console.warn("[camera] getUserMedia failed", value);
      if (current === stateRef2.current) {
        setError(value?.name === "NotAllowedError"
          ? "Consenti l’accesso alla fotocamera per continuare."
          : "Fotocamera non disponibile.");
      }
    }
  }, [facingMode, otherValue, callback, attachVideo]);
  React.useEffect(() => {
    restart();
    return () => callback();
  }, [restart, callback]);
  React.useEffect(() => {
    let handleAction = () => {
      if (document.hidden) {
        callback();
      } else {
        if (otherValue) {
          restart();
        }
      }
    };
    document.addEventListener("visibilitychange", handleAction);
    return () => document.removeEventListener("visibilitychange", handleAction);
  }, [otherValue, restart, callback]);
  return {
    videoRef: videoRef,
    attachVideo: attachVideo,
    ready: ready,
    error: error,
    restart: restart
  };
}
function seededRandom(value) {
  let value2 = value >>> 0;
  return () => {
    value2 = Math.imul(value2, 1664525) + 1013904223 >>> 0;
    return value2 / 4294967296;
  };
}
function coverCrop(value, otherValue, argument3, argument4) {
  let value2 = Math.max(argument3 / value, argument4 / otherValue);
  return {
    x: (value - argument3 / value2) / 2,
    y: (otherValue - argument4 / value2) / 2,
    w: argument3 / value2,
    h: argument4 / value2
  };
}
function createCameraEffects(value = () => document.createElement("canvas")) {
  let dimensions = value();
  let context = dimensions.getContext("2d");
  let items = [];
  let weakMap = new WeakMap();
  function i(value2, otherValue) {
    let value3 = otherValue % 6;
    if (!items[value3]) {
      let dimensions2 = value();
      dimensions2.width = 128;
      dimensions2.height = 128;
      let context2 = dimensions2.getContext("2d");
      let imageData = context2.createImageData(128, 128);
      let value5 = seededRandom(733 + value3 * 701);
      for (let y = 0; y < imageData.data.length; y += 4) {
        let value6 = Math.floor(value5() * 256);
        imageData.data[y] = imageData.data[y + 1] = imageData.data[y + 2] = value6;
        imageData.data[y + 3] = 255;
      }
      context2.putImageData(imageData, 0, 0);
      items[value3] = dimensions2;
    }
    let value4 = weakMap.get(value2);
    if (!value4) {
      value4 = [];
      weakMap.set(value2, value4);
    }
    return value4[value3] || (value4[value3] = value2.createPattern(items[value3], "repeat"));
  }
  return {
    draw(context2, dimensions2, argument3, argument4, {
      year: value2 = 2024,
      mirror: value3 = false,
      time: value4 = 0,
      reducedMotion: value5 = false
    } = {}) {
      let y = dimensions2.videoWidth || dimensions2.naturalWidth || dimensions2.width;
      let value6 = dimensions2.videoHeight || dimensions2.naturalHeight || dimensions2.height;
      if (!context2 || !context || !y || !value6 || !argument3 || !argument4) return false;
      let value7 = eraForYear(value2);
      let value8 = value5 ? 0 : Math.floor(value4 * value7.fps / 1000);
      let value9 = seededRandom(921 + value8 * 37);
      let value10 = Math.min(argument3, value7.sensor);
      let x = Math.max(1, Math.round(value10 * argument4 / argument3));
      if (dimensions.width !== value10 || dimensions.height !== x) {
        dimensions.width = value10;
        dimensions.height = x;
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
      context.filter = "none";
      context.clearRect(0, 0, value10, x);
      let point = coverCrop(y, value6, value10, x);
      context.save();
      if (value3) {
        context.translate(value10, 0);
        context.scale(-1, 1);
      }
      context.drawImage(dimensions2, point.x, point.y, point.w, point.h, 0, 0, value10, x);
      context.restore();
      context2.save();
      context2.setTransform(1, 0, 0, 1, 0, 0);
      context2.globalCompositeOperation = "source-over";
      context2.globalAlpha = 1;
      context2.clearRect(0, 0, argument3, argument4);
      context2.imageSmoothingEnabled = !value7.pixelated;
      context2.filter = value7.filter;
      let value11 = Math.min(argument3, argument4) / 390;
      let value12 = value5 ? 0 : value7.weave * value11;
      let value13 = (value9() - 0.5) * value12;
      let value14 = (value9() - 0.5) * value12;
      let value15 = Math.max(1, value12);
      if (context2.drawImage(dimensions, -value15 + value13, -value15 + value14, argument3 + value15 * 2, argument4 + value15 * 2), value7.blur && (context2.globalAlpha = 0.35, context2.filter = value7.filter + ` blur(${value7.blur * value11}px)`, context2.drawImage(dimensions, -value15, -value15, argument3 + value15 * 2, argument4 + value15 * 2)), context2.filter = "none", context2.globalAlpha = 1, value7.fade && (context2.fillStyle = `rgba(234,216,181,${value7.fade})`, context2.fillRect(0, 0, argument3, argument4)), value7.id === "plate" && !value5 && (context2.fillStyle = `rgba(0,0,0,${0.007 + value8 % 7 * 0.0015})`, context2.fillRect(0, 0, argument3, argument4)), value7.grain && (context2.globalCompositeOperation = "overlay", context2.globalAlpha = value7.grain, context2.fillStyle = i(context2, value8), context2.fillRect(0, 0, argument3, argument4), context2.globalAlpha = 1, context2.globalCompositeOperation = "source-over"), value7.vignette) {
        let radialGradient = context2.createRadialGradient(argument3 * 0.5, argument4 * 0.46, Math.min(argument3, argument4) * 0.15, argument3 * 0.5, argument4 * 0.46, Math.hypot(argument3, argument4) * 0.53);
        radialGradient.addColorStop(0, "rgba(14,11,9,0)");
        radialGradient.addColorStop(0.52, "rgba(14,11,9,.035)");
        radialGradient.addColorStop(1, `rgba(14,11,9,${value7.vignette})`);
        context2.fillStyle = radialGradient;
        context2.fillRect(0, 0, argument3, argument4);
      }
      let value16 = seededRandom(3307 + (value5 ? 0 : Math.floor(value4 / 420)) * 11);
      for (let value17 = 0; value17 < value7.dust; value17++) {
        let value18 = value16() * argument3;
        let value19 = value16() * argument4;
        let value20 = (0.35 + value16() * 1.1) * value11;
        context2.fillStyle = value17 % 3 === 0 ? "rgba(238,223,195,.38)" : "rgba(29,23,18,.24)";
        context2.beginPath();
        context2.ellipse(value18, value19, value20, value20 * 0.65, value16() * Math.PI, 0, Math.PI * 2);
        context2.fill();
      }
      for (let value17 = 0; value17 < value7.scratches; value17++) {
        let value18 = value16() * argument3;
        let value19 = value16() * argument4;
        let value20 = (0.08 + value16() * 0.28) * argument4;
        context2.strokeStyle = "rgba(233,222,198,.2)";
        context2.lineWidth = (0.3 + value16() * 0.4) * value11;
        context2.beginPath();
        context2.moveTo(value18, value19);
        context2.lineTo(value18 + value11, value19 + value20);
        context2.stroke();
      }
      if (value7.leak) {
        let linearGradient = context2.createLinearGradient(0, 0, argument3, 0);
        let value17 = value5 ? 0.12 : 0.12 + Math.sin(value4 / 6200) * 0.025;
        linearGradient.addColorStop(0, `rgba(240,114,51,${value17})`);
        linearGradient.addColorStop(0.15, "rgba(247,184,106,.025)");
        linearGradient.addColorStop(0.35, "rgba(247,184,106,0)");
        linearGradient.addColorStop(1, "rgba(247,184,106,0)");
        context2.fillStyle = linearGradient;
        context2.fillRect(0, 0, argument3, argument4);
      }
      if (value7.scanlines) {
        context2.fillStyle = "rgba(18,25,33,.15)";
        for (let value17 = 0; value17 < argument4; value17 += 3 * value11) context2.fillRect(0, value17, argument3, 0.7 * value11);
      }
      if (value7.tracking) {
        let value17 = value5 ? argument4 * 0.81 : argument4 * (0.72 + 0.09 * Math.sin(value4 / 7000));
        context2.globalAlpha = 0.16;
        context2.drawImage(dimensions, 0, dimensions.height * 0.74, dimensions.width, 3, 1.8 * value11, value17, argument3, 3 * value11);
        context2.globalAlpha = 1;
      }
      context2.restore();
      return true;
    }
  };
}
function GameStyles() {
  return <style>{`
    @font-face {
      font-family: 'DM Sans';
      src: url('./assets/fonts/ui/DMSans.woff') format('woff');
      font-weight: 100 1000;
      font-style: normal;
      font-display: swap;
    }
    :root {
      --font-display: "DM Sans", "PingFang SC", system-ui, sans-serif;
      --font-body: var(--font-display);
      --font-mono: var(--font-display);
    }
    .time-camera-app { font-family:var(--font-body); font-optical-sizing:auto; font-synthesis:none; -webkit-font-smoothing:antialiased; }
    .time-camera-app button, .time-camera-app input { font:inherit; }
    .era-label { font:600 18px/1.35 var(--font-body); color:inherit; margin:0 0 8px; }
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: #000;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none; /* \u7EDF\u4E00\u7531\u5185\u90E8\u5904\u7406\u62D6\u62FD\uFF0C\u7981\u6B62\u5916\u5C42\u9ED8\u8BA4\u6EDA\u52A8 */
    }
    * { box-sizing: border-box; }
    
    /* \u5DE5\u5177\u7C7B */
    .hide-scrollbar::-webkit-scrollbar { display: none; }
    .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    
    /* \u9713\u8679\u53D1\u5149\u52A8\u753B */
    @keyframes neonPulse {
      0%,100% { text-shadow: 0 0 12px #00ffff55; }
      50% { text-shadow: 0 0 6px #00ffff30; }
    }
    
    input[type=number]::-webkit-inner-spin-button, 
    input[type=number]::-webkit-outer-spin-button { 
      -webkit-appearance: none; 
      margin: 0; 
    }
    button:focus-visible, [role=button]:focus-visible, input:focus-visible { outline: 3px solid currentColor; outline-offset: 3px; }
    .camera-entry { background:#ffffff0a; border:1.5px solid currentColor; padding:12px; width:180px; height:180px; flex-shrink:0; color:inherit; cursor:pointer; border-radius:50%; }
    .camera-entry-wrap { width:100%; height:180px; position:relative; display:flex; justify-content:center; flex-shrink:0; margin-bottom:52px; }
    .camera-device { display:block; width:100%; height:100%; object-fit:contain; pointer-events:none; user-select:none; }
    .camera-entry:active { background:#ffffff14; opacity:.8; }
    .time-camera-app button[aria-label="Switch camera"], .time-camera-app button[aria-label="Cambia fotocamera"] { background:#fff!important; border:1px solid #fff!important; color:#202124!important; box-shadow:0 2px 10px rgba(0,0,0,.24); } .camera-entry[data-device] { background:#fff; border:2px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,.12), 0 5px 0 rgba(0,0,0,.18), 0 9px 20px rgba(0,0,0,.16); } .camera-entry[data-device]:active { background:#fff; opacity:1; transform:translateY(2px); box-shadow:0 0 0 1px rgba(0,0,0,.12), 0 3px 0 rgba(0,0,0,.18), 0 5px 12px rgba(0,0,0,.14); }
    .camera-entry[data-guide="true"] .camera-entry-lens { transform-box:fill-box; transform-origin:center; animation:camera-lens-breathe 3.2s ease-in-out infinite; }
    .year-guide { position:absolute; inset:0; pointer-events:none; transition:opacity 180ms ease-out; }
    .year-guide[data-dismissed="true"] { opacity:0; visibility:hidden; }
    .year-guide[data-dismissed="true"] .year-guide-hand { animation:none; }
    .year-guide-hand { position:absolute; top:134px; left:calc(50% + 12px); width:30px; height:38px; color:#fff; filter:drop-shadow(0 1px 3px #0008); animation:camera-tap-guide 3.2s ease-in-out infinite; }
    .year-guide[data-stage="year"] .year-guide-hand { top:calc(100% + 70px); left:calc(50% - 15px); animation:year-drag-guide 3.2s ease-in-out infinite; }
    .year-guide-copy { margin:0; position:absolute; top:calc(100% + 12px); left:0; right:0; text-align:center; font:500 18px/1.35 var(--font-body); }
    @keyframes camera-tap-guide { 0%,8% { opacity:0; transform:translateY(10px); } 22% { opacity:.95; transform:translateY(10px); } 34%,42% { opacity:.95; transform:translateY(0) scale(.94); } 56% { opacity:.95; transform:translateY(10px); } 68%,100% { opacity:0; transform:translateY(10px); } }
    @keyframes year-drag-guide { 0%,8% { opacity:0; transform:translateX(34px); } 20% { opacity:.9; transform:translateX(34px); } 48%,58% { opacity:.9; transform:translateX(-34px); } 72%,100% { opacity:0; transform:translateX(-34px); } }
    @keyframes camera-lens-breathe { 0%,60%,100% { opacity:.85; transform:scale(1); } 78% { opacity:1; transform:scale(1.03); } }
    .time-camera-app[data-hidden="true"] .year-guide-hand,
    .time-camera-app[data-hidden="true"] .camera-entry-lens,
    .time-camera-app[data-hidden="true"] h2 { animation-play-state:paused; }
    @media(prefers-reduced-motion:reduce){h2{animation:none!important}.year-guide-hand{display:none}.camera-entry-lens{animation:none!important}.year-guide{transition:none}}
    @media(max-height:540px){.camera-entry{width:124px;height:124px;padding:8px}.camera-entry-wrap{height:124px;margin-bottom:40px}.year-guide-hand{top:88px}.time-camera-app h2{font-size:68px!important}}
  `}</style>;
}
function YearInput({
  year: e,
  min: t,
  max: n,
  theme: r,
  onCommit: o,
  onCancel: i
}) {
  let stateRef = React.useRef(false);
  let handleAction = value => {
    if (stateRef.current) return;
    stateRef.current = true;
    let value2 = Number(value);
    if (value.trim() !== "" && Number.isFinite(value2)) {
      o(Math.min(n, Math.max(t, Math.trunc(value2))));
    } else {
      i();
    }
  };
  return <input name={"yearInput"} type={"number"} inputMode={"numeric"} enterKeyHint={"done"} min={t} max={n} aria-label={"Anno della fotocamera"} defaultValue={e} autoFocus={true} onKeyDown={event => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      handleAction(event.currentTarget.value);
    } else {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        stateRef.current = true;
        i();
      }
    }
  }} onBlur={event => handleAction(event.currentTarget.value)} style={{
    fontFamily: "var(--font-display)",
    fontSize: "72px",
    fontWeight: 650,
    fontVariantNumeric: "tabular-nums",
    background: "transparent",
    border: "none",
    color: r.text,
    width: "200px",
    textAlign: "center",
    outline: "none",
    borderBottom: `2px solid ${r.accent}`
  }} />;
}
function CameraDevice({
  device: e
}) {
  return <img className={"camera-device camera-entry-lens"} src={e.src} alt={""} aria-hidden={"true"} draggable={"false"} width={"180"} height={"180"} />;
}
function YearGuide({
  stage: e
}) {
  return <div className={"year-guide"} data-stage={e} data-dismissed={e === "done"} aria-hidden={e === "done"}>{<svg className={"year-guide-hand"} aria-hidden={"true"} viewBox={"0 0 30 38"} fill={"none"} stroke={"currentColor"} strokeWidth={"1.8"} strokeLinecap={"round"} strokeLinejoin={"round"}>{<path d={"M10 22V6a3 3 0 0 1 6 0v12-3a2.5 2.5 0 0 1 5 0v3a2.5 2.5 0 0 1 5 0v9c0 5-3 8-8 8h-2c-4 0-6-2-8-5l-5-8a2.5 2.5 0 0 1 4-3l3 3Z"} fill={"#14131b"} />}</svg>}{<p className={"year-guide-copy"} id={"year-guide-instruction"} aria-live={"polite"}>{e === "year" ? "Trascina per cambiare anno" : "Tocca per aprire la fotocamera"}</p>}</div>;
}
function yearFromDrag(value, otherValue, argument3, argument4, argument5) {
  let value2 = Math.trunc((otherValue - argument3) / 8);
  return Math.max(argument4, Math.min(argument5, value + value2 * 5));
}
function YearDial({
  currentYear: e,
  setYear: t,
  min: n,
  max: r,
  theme: o,
  onInteract: i = () => {},
  guideStage: s
}) {
  let elementRef = React.useRef(null);
  let stateRef = React.useRef(null);
  let handlePointerDown = event => {
    if (!(stateRef.current || event.isPrimary === false || event.button !== 0)) {
      i();
      stateRef.current = {
        id: event.pointerId,
        x: event.clientX,
        year: e
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };
  let handlePointerMove = event => {
    let y = stateRef.current;
    if (!(!y || y.id !== event.pointerId)) {
      t(yearFromDrag(y.year, y.x, event.clientX, n, r));
    }
  };
  let handlePointerUp = event => {
    if (stateRef.current?.id === event.pointerId) {
      stateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };
  let items = [];
  for (let value = e - 25; value <= e + 25; value += 5) items.push(value);
  return <div ref={elementRef} role={"slider"} tabIndex={0} aria-label={"Cronologia delle fotocamere"} aria-valuemin={n} aria-valuemax={r} aria-valuenow={e} aria-describedby={s === "year" ? "year-guide-instruction" : void 0} onKeyDown={event => {
    let y = event.key === "ArrowRight" ? e + 5 : event.key === "ArrowLeft" ? e - 5 : event.key === "Home" ? n : event.key === "End" ? r : null;
    if (y !== null) {
      event.preventDefault();
      i();
      t(Math.min(r, Math.max(n, y)));
    }
  }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onLostPointerCapture={() => {
    stateRef.current = null;
  }} style={{
    width: "100%",
    height: "80px",
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    cursor: "grab",
    touchAction: "none"
  }}>{<div style={{
      position: "absolute",
      inset: 0,
      zIndex: 2,
      pointerEvents: "none",
      background: `linear-gradient(90deg, ${o.bg} 0%, transparent 20%, transparent 80%, ${o.bg} 100%)`
    }} />}{<Motion.motion.div style={{
      display: "flex",
      alignItems: "flex-end",
      gap: "20px",
      flexShrink: 0
    }} animate={{
      x: 0
    }}>{items.map(item => {
        let y = item === e;
        let value = item < n || item > r;
        return <div key={item} style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          width: 36,
          flexShrink: 0,
          height: 56,
          opacity: y ? 1 : 0.7,
          visibility: value ? "hidden" : "visible",
          transition: "opacity 0.2s"
        }}>{<div style={{
            width: "2px",
            height: y ? "24px" : "12px",
            background: o.text,
            marginBottom: "8px"
          }} />}{<div className={"dial-year"} aria-hidden={"true"} style={{
            fontFamily: "var(--font-body)",
            fontSize: y ? 16 : 14,
            fontWeight: y ? 700 : 500,
            lineHeight: "20px",
            fontVariantNumeric: "tabular-nums",
            color: o.text
          }}>{item}</div>}</div>;
      })}</Motion.motion.div>}{<div style={{
      position: "absolute",
      bottom: 0,
      left: "50%",
      transform: "translateX(-50%)",
      width: 0,
      height: 0,
      borderLeft: "6px solid transparent",
      borderRight: "6px solid transparent",
      borderBottom: `8px solid ${o.accent}`,
      zIndex: 3
    }} />}</div>;
}
function CameraPreview({
  videoRef: e,
  year: t,
  facing: n,
  ready: r,
  onRendered: o
}) {
  let elementRef = React.useRef(null);
  React.useEffect(() => {
    let dimensions = elementRef.current;
    if (!dimensions || !r) return;
    let context = dimensions.getContext("2d");
    let cameraEffects = createCameraEffects();
    if (!context) return;
    let value = 0;
    let value2 = -1 / 0;
    let enabled = false;
    let enabled2 = false;
    let value3 = window.matchMedia("(prefers-reduced-motion: reduce)");
    function y() {
      let dimensions2 = dimensions.parentElement.getBoundingClientRect();
      let value4 = Math.min(window.devicePixelRatio || 1, 1.5);
      dimensions.width = Math.max(1, Math.min(720, Math.round(dimensions2.width * value4)));
      dimensions.height = Math.max(1, Math.round(dimensions.width * dimensions2.height / Math.max(1, dimensions2.width)));
    }
    function v(time) {
      if (!(enabled || document.hidden)) {
        if (time - value2 >= 1000 / eraForYear(t).fps) {
          value2 = time;
          if (e.current?.readyState >= 2 && cameraEffects.draw(context, e.current, dimensions.width, dimensions.height, {
            year: t,
            mirror: n === "user",
            time: time,
            reducedMotion: value3.matches
          }) && !enabled2) {
            enabled2 = true;
            o();
          }
        }
        value = requestAnimationFrame(v);
      }
    }
    function w() {
      cancelAnimationFrame(value);
      if (!document.hidden) {
        value2 = -1 / 0;
        value = requestAnimationFrame(v);
      }
    }
    y();
    let resizeObserver = observeGameSize(y);
    resizeObserver.observe(dimensions.parentElement);
    document.addEventListener("visibilitychange", w);
    value = requestAnimationFrame(v);
    return () => {
      enabled = true;
      cancelAnimationFrame(value);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", w);
    };
  }, [t, n, r, e, o]);
  return <canvas ref={elementRef} aria-label={`${eraForYear(t).name} camera viewfinder`} style={{
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    opacity: r ? 1 : 0
  }} />;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [screen, setScreen] = React.useState("setup");
  let [guideStage, setGuideStage] = React.useState("year");
  let [pageVisible, setPageVisible] = React.useState(!document.hidden);
  React.useEffect(() => {
    let handleAction = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", handleAction);
    return () => document.removeEventListener("visibilitychange", handleAction);
  }, []);
  let [year, setYear] = React.useState(1985);
  let [editingYear, setEditingYear] = React.useState(false);
  let [facingMode, setFacingMode] = React.useState("environment");
  let [capturing, setCapturing] = React.useState(false);
  let [frameReady, setFrameReady] = React.useState(false);
  let markFrameReady = React.useCallback(() => setFrameReady(true), []);
  React.useEffect(() => setFrameReady(false), [year, facingMode, screen]);
  React.useEffect(() => {
    let enabled = true;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let z = runtimeConfig;
        if (location.protocol === "file:" && z) options = JSON.parse(z.textContent);else {
          let value = await requestGameConfig();
          if (value.ok) {
            options = await value.json();
          }
        }
      } catch {
        let value = runtimeConfig;
        if (value) try {
          options = JSON.parse(value.textContent);
        } catch {}
      }
      if (enabled) {
        let z = readConfigValues(options);
        setConfig(z);
        if (Number.isFinite(z.DEFAULT_YEAR)) {
          setYear(Math.min(2026, z.MAX_YEAR || 2026, Math.max(z.MIN_YEAR || 1900, z.DEFAULT_YEAR)));
        }
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  let theme = React.useMemo(() => themeForYear(year), [year]);
  let device = React.useMemo(() => deviceForYear(year), [year]);
  let minYear = config?.MIN_YEAR || 1900;
  let maxYear = Math.min(2026, config?.MAX_YEAR || 2026);
  let cameraActive = screen === "camera";
  let {
    videoRef: videoRef,
    attachVideo: attachVideo,
    ready: cameraReady,
    error: cameraError
  } = useCameraStream(facingMode, cameraActive);
  let advanceGuide = () => setGuideStage("camera");
  let openYearInput = () => {
    advanceGuide();
    setEditingYear(true);
  };
  let changeYear = value => {
    if (value !== year) {
      advanceGuide();
    }
    setYear(Math.min(maxYear, Math.max(minYear, value)));
  };
  let enterCamera = () => {
    setGuideStage("done");
    setEditingYear(false);
    setScreen("camera");
  };
  let submitYear = event => {
    event.preventDefault();
    setEditingYear(false);
    let formData = new FormData(event.target);
    let z = parseInt(formData.get("yearInput"), 10);
    if (!isNaN(z)) {
      changeYear(Math.min(maxYear, Math.max(minYear, z)));
    }
  };
  let capturePhoto = () => {
    if (!cameraReady || !videoRef.current || capturing) return;
    setCapturing(true);
    let element = document.createElement("div");
    element.style.cssText = "position:fixed; inset:0; background:#fff; z-index:9999; opacity:1; transition:opacity 0.3s; pointer-events:none;";
    document.body.appendChild(element);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        element.style.opacity = "0";
      });
    });
    setTimeout(() => element.remove(), 300);
    let current = videoRef.current;
    let z = document.createElement("canvas");
    z.width = current.videoWidth || 720;
    z.height = current.videoHeight || 1280;
    let context = z.getContext("2d");
    let dimensions = current.parentElement.getBoundingClientRect();
    if (z.width = Math.min(1600, Math.max(current.videoWidth, current.videoHeight)), z.height = Math.round(z.width * dimensions.height / Math.max(1, dimensions.width)), !createCameraEffects().draw(context, current, z.width, z.height, {
      year: year,
      mirror: facingMode === "user",
      time: performance.now(),
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
    })) {
      setCapturing(false);
      return;
    }
    let dataURL = z.toDataURL("image/jpeg", 0.9);
    let filename = `time_camera_${year}_${Date.now()}`;
    if (window.tt && window.tt.saveDataURL) window.tt.saveDataURL({
      dataURL: dataURL,
      filename: filename,
      extension: "jpg",
      saveToAlbum: "image",
      success() {
        setCapturing(false);
      },
      fail(value) {
        console.error("Save failed", value);
        setCapturing(false);
      },
      complete() {}
    });else {
      saveGameImage(dataURL, filename, 'jpg').finally(() => setCapturing(false));
    }
  };
  return config ? <div className={"time-camera-app"} data-hidden={!pageVisible} style={{
    width: "100%",
    height: "100%",
    position: "relative",
    overflow: "hidden",
    background: "#000"
  }}>{<GameStyles />}{<Motion.AnimatePresence mode={"wait"}>{screen === "setup" && <Motion.motion.div key={"setup"} initial={{
        opacity: 0
      }} animate={{
        opacity: 1
      }} exit={{
        opacity: 0,
        scale: 0.95
      }} transition={{
        duration: 0.4
      }} style={{
        position: "absolute",
        inset: 0,
        background: theme.bg,
        color: theme.text,
        display: "flex",
        flexDirection: "column",
        padding: "30px 30px 50px",
        transition: "background 0.3s, color 0.3s"
      }}>{<div style={{
          flex: "1",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center"
        }}>{<div style={{
            marginBottom: "12px",
            textAlign: "center"
          }}>{<p className={"era-label"} style={{
              color: theme.accent
            }}>{theme.name}</p>}{editingYear ? <form noValidate={true} onSubmit={submitYear} style={{
              display: "flex",
              justifyContent: "center"
            }}>{<YearInput year={year} min={minYear} max={maxYear} theme={theme} onCommit={value => {
                changeYear(value);
                setEditingYear(false);
              }} onCancel={() => setEditingYear(false)} />}</form> : <h2 onClick={openYearInput} role={"button"} tabIndex={0} aria-label={`Change year, currently ${year}`} onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openYearInput();
              }
            }} style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(60px, 20vw, 100px)",
              fontWeight: 650,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-.035em",
              margin: 0,
              lineHeight: 1,
              cursor: "pointer",
              animation: year >= 1970 && year < 1990 ? "neonPulse 2s infinite alternate" : "none"
            }}>{year}</h2>}</div>}{<div className={"camera-entry-wrap"}>{<button type={"button"} className={"camera-entry"} data-device={device.id} data-guide={guideStage === "camera"} aria-label={`Open ${year} ${device.label}`} aria-describedby={guideStage === "camera" ? "year-guide-instruction" : void 0} onClick={enterCamera}>{<CameraDevice device={device} />}</button>}{<YearGuide stage={guideStage} />}</div>}{<div style={{
            width: "100%",
            maxWidth: "400px",
            marginTop: "18px",
            position: "relative"
          }}>{<YearDial currentYear={year} setYear={changeYear} min={minYear} max={maxYear} theme={theme} onInteract={advanceGuide} guideStage={guideStage} />}</div>}</div>}{<div style={{
          flex: "0 0 auto",
          display: "flex",
          justifyContent: "center"
        }}>{<button type={"button"} aria-label={config.BTN_RESET || "Torna a oggi"} onClick={() => changeYear(Math.min(maxYear, Math.max(minYear, new Date().getFullYear())))} style={{
            background: "transparent",
            border: "none",
            color: theme.text,
            display: "grid",
            placeItems: "center",
            width: 44,
            height: 44,
            padding: 10,
            opacity: 0.8,
            cursor: "pointer"
          }}>{<svg width={"22"} height={"22"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"1.8"} strokeLinecap={"round"} strokeLinejoin={"round"} aria-hidden={"true"}>{<path d={"M3 10a9 9 0 1 1 2 8M3 4v6h6"} />}</svg>}</button>}</div>}</Motion.motion.div>}{screen === "camera" && <Motion.motion.div key={"camera"} initial={{
        opacity: 0
      }} animate={{
        opacity: 1
      }} transition={{
        duration: 0.5
      }} style={{
        position: "absolute",
        inset: 0,
        background: theme.cameraBg,
        display: "flex",
        flexDirection: "column"
      }}>{<div style={{
          flex: "0 0 auto",
          padding: "calc(30px + env(safe-area-inset-top, 0px)) 30px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 20
        }}>{<button onClick={() => setScreen("setup")} style={{
            background: "rgba(0,0,0,0.5)",
            border: `1px solid ${theme.accent}`,
            color: theme.text,
            minHeight: 44,
            padding: "8px 12px",
            borderRadius: "4px",
            fontFamily: "var(--font-body)",
            fontSize: "14px",
            fontWeight: 600,
            backdropFilter: "blur(4px)",
            cursor: "pointer"
          }}>{"\u2190 "}{config.BTN_BACK || "CAMBIA ANNO"}</button>}{<div style={{
            fontFamily: "var(--font-display)",
            color: theme.text,
            textAlign: "right"
          }}>{<div style={{
              fontSize: "28px",
              color: theme.accent
            }}>{year}</div>}</div>}</div>}{<div style={{
          flex: "1",
          minHeight: 0,
          position: "relative",
          margin: "0 30px",
          overflow: "hidden",
          borderRadius: "12px",
          background: "#000",
          border: `2px solid ${theme.accent}40`
        }}>{(!cameraReady || cameraError) && <div role="status" style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: cameraError ? "#ff7777" : "#ffffff",
            fontFamily: "var(--font-mono)",
            padding: "20px",
            textAlign: "center",
            zIndex: 10
          }}>{cameraError || "Avvio della fotocamera…"}</div>}{<video ref={attachVideo} playsInline={true} autoPlay={true} muted={true} style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: facingMode === "user" ? "scaleX(-1)" : "none",
            opacity: cameraReady && !frameReady ? 1 : 0
          }} />}{<CameraPreview videoRef={videoRef} year={year} facing={facingMode} ready={cameraReady} onRendered={markFrameReady} />}{year >= 1970 && year < 1990 && <React.Fragment>{<div style={{
              position: "absolute",
              top: "20px",
              left: "20px",
              width: "40px",
              height: "40px",
              borderTop: "4px solid #0ff",
              borderLeft: "4px solid #0ff"
            }} />}{<div style={{
              position: "absolute",
              top: "20px",
              right: "20px",
              width: "40px",
              height: "40px",
              borderTop: "4px solid #0ff",
              borderRight: "4px solid #0ff"
            }} />}{<div style={{
              position: "absolute",
              bottom: "20px",
              left: "20px",
              width: "40px",
              height: "40px",
              borderBottom: "4px solid #0ff",
              borderLeft: "4px solid #0ff"
            }} />}{<div style={{
              position: "absolute",
              bottom: "20px",
              right: "20px",
              width: "40px",
              height: "40px",
              borderBottom: "4px solid #0ff",
              borderRight: "4px solid #0ff"
            }} />}</React.Fragment>}{year >= 1990 && year < 2010 && <div style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "#fff",
            fontFamily: "var(--font-mono)",
            fontSize: "14px"
          }}>{<Motion.motion.div animate={{
              opacity: [1, 0, 1]
            }} transition={{
              repeat: 1 / 0,
              duration: 1.5
            }} style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: "#ff0000"
            }} />}{"REC"}</div>}</div>}{<div style={{
          flex: "0 0 auto",
          padding: "24px 30px calc(50px + env(safe-area-inset-bottom))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "40px"
        }}>{<div style={{
            width: "48px"
          }} />}{<button type={"button"} aria-label={"Scatta"} onClick={capturePhoto} disabled={capturing || !cameraReady} style={{
            width: "72px",
            height: "72px",
            borderRadius: "50%",
            border: "none",
            cursor: "pointer",
            background: "#fff",
            boxShadow: year >= 1970 && year < 1990 ? `0 0 20px ${theme.text}` : "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: capturing || !cameraReady ? 0.5 : 1
          }}>{<div style={{
              width: "60px",
              height: "60px",
              borderRadius: "50%",
              border: `2px solid ${theme.cameraBg}`
            }} />}</button>}{<button type={"button"} aria-label={"Cambia fotocamera"} onClick={() => setFacingMode(value => value === "user" ? "environment" : "user")} style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            background: "rgba(255,255,255,0.1)",
            border: `1px solid ${theme.text}40`,
            color: theme.text,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer"
          }}>{<svg width={"24"} height={"24"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>{<path d={"M21 2v6h-6"} />}{<path d={"M3 12a9 9 0 0 1 15-6.7L21 8"} />}{<path d={"M3 22v-6h6"} />}{<path d={"M21 12a9 9 0 0 1-15 6.7L3 16"} />}</svg>}</button>}</div>}</Motion.motion.div>}</Motion.AnimatePresence>}</div> : <div style={{
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#000",
    color: "#fff"
  }}>{"Caricamento…"}</div>;
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
  const selectors = [".year-guide-copy"];
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
function saveGameImage(dataURL, filename, extension = 'png') {
  return new Promise(resolve => {
    if (window.tt && typeof window.tt.saveDataURL === 'function') {
      window.tt.saveDataURL({
        dataURL,
        filename,
        extension,
        saveToAlbum: 'image',
        success() {
          resolve(true);
        },
        fail(error) {
          console.warn('Image save failed', error);
          resolve(false);
        },
        complete() {}
      });
      return;
    }
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'padding:16px;border:0;border-radius:18px;background:#fff;color:#222;max-width:90vw;max-height:90vh';
    const image = document.createElement('img');
    image.src = dataURL;
    image.alt = 'Immagine creata';
    image.style.cssText = 'display:block;max-width:76vw;max-height:65vh;object-fit:contain';
    const label = document.createElement('p');
    label.textContent = 'Tieni premuta l’immagine per salvarla.';
    const close = document.createElement('button');
    close.textContent = 'Chiudi';
    close.style.cssText = 'min-height:44px;padding:8px 20px';
    close.onclick = () => {
      dialog.close();
      dialog.remove();
      resolve(false);
    };
    dialog.append(image, label, close);
    document.body.append(dialog);
    dialog.showModal();
  });
}
