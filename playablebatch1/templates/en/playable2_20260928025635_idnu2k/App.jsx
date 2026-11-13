// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Motion from 'framer-motion';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "INTENSITY_PUSH",
    "kind": "number",
    "label": "Push Intensity",
    "value": 0.8,
    "default": 0.8,
    "min": 0.1,
    "max": 2,
    "step": 0.1
  }, {
    "id": "INTENSITY_BLOAT",
    "kind": "number",
    "label": "Bloat/Pucker Intensity",
    "value": 0.5,
    "default": 0.5,
    "min": 0.1,
    "max": 1,
    "step": 0.1
  }, {
    "id": "BRUSH_DEFAULT_SIZE",
    "kind": "number",
    "label": "Default Brush Size",
    "value": 80,
    "default": 80,
    "min": 20,
    "max": 200,
    "step": 1
  }],
  "texts": [{
    "id": "APP_TITLE",
    "label": "App Title",
    "value": "Live Liquify Camera",
    "default": "Live Liquify Camera",
    "max_length": 20
  }, {
    "id": "BTN_UNDO",
    "label": "Undo Button",
    "value": "Undo",
    "default": "Undo",
    "max_length": 15
  }, {
    "id": "BTN_RESET",
    "label": "Reset Button",
    "value": "Reset",
    "default": "Reset",
    "max_length": 15
  }],
  "images": [{
    "id": "STICKER_GLASSES",
    "label": "Glasses Sticker",
    "path": "./assets/sticker_glasses.webp",
    "replaceable": true
  }, {
    "id": "STICKER_MOUSTACHE",
    "label": "Moustache Sticker",
    "path": "./assets/sticker_moustache.webp",
    "replaceable": true
  }, {
    "id": "STICKER_HAT",
    "label": "Hat Sticker",
    "path": "./assets/sticker_hat.webp",
    "replaceable": true
  }, {
    "id": "STICKER_SPARKLE",
    "label": "Sparkle Sticker",
    "path": "./assets/sticker_sparkle.webp",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "image_expression",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 2
  }
};
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; overscroll-behavior: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
    #root { isolation: isolate; }
    canvas { touch-action: none; }
    button, input, select, textarea { touch-action: manipulation; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
// Preserve the original fallback when the configuration cannot be fetched.
for (const value of ['playable-inline-config', 'playable-config-inline']) {
  const node = document.createElement('script');
  node.id = value;
  node.type = 'application/json';
  node.textContent = JSON.stringify(DEFAULT_CONFIG);
  document.body.append(node);
}
document.documentElement.lang = 'en';
function VC(config) {
  let options = {};
  (config.tweaks || []).forEach(item => {
    options[item.id] = item.value;
  });
  (config.texts || []).forEach(item => {
    options[item.id] = item.value;
  });
  (config.images || []).forEach(item => {
    options[item.id] = item.path;
  });
  (config.mentions || []).forEach(item => {
    options[item.id] = item.path != null && item.path !== "" ? item.path : item.value;
  });
  (config.motions || []).forEach(item => {
    if (!(!item || !item.id)) {
      if (item.base_path != null && item.base_path !== "") {
        options[item.id] = item.base_path;
        options[item.id + "_BASE"] = item.base_path;
      }
      if (item.frame_count != null) {
        options[item.id + "_COUNT"] = item.frame_count;
      }
    }
  });
  return options;
}
function SC() {
  return <svg viewBox={"0 0 24 24"}>{<path d={"M10 9V5a2 2 0 0 1 4 0v4h2a2 2 0 0 1 2 2v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-5a2 2 0 0 1 2-2h4z"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinejoin={"round"} />}</svg>;
}
function TC() {
  return <svg viewBox={"0 0 24 24"}>{<path d={"M7 11V7a5 5 0 0 1 10 0v4"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} />}{<circle cx={"12"} cy={"16"} r={"4"} fill={"currentColor"} />}</svg>;
}
function CC() {
  return <svg viewBox={"0 0 24 24"}>{<circle cx={"12"} cy={"12"} r={"8"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} />}{<path d={"M12 8v8M8 12h8"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} />}</svg>;
}
function PC() {
  return <svg viewBox={"0 0 24 24"}>{<circle cx={"12"} cy={"12"} r={"8"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} />}{<path d={"M9 9l6 6M15 9l-6 6"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} />}</svg>;
}
function GameKC() {
  return <svg viewBox={"0 0 24 24"}>{<path d={"M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinejoin={"round"} />}</svg>;
}
var items3 = [{
  id: "pan",
  icon: <SC />,
  label: "Pan"
}, {
  id: "push",
  icon: <TC />,
  label: "Push"
}, {
  id: "bloat",
  icon: <CC />,
  label: "Bloat"
}, {
  id: "pucker",
  icon: <PC />,
  label: "Pucker"
}, {
  id: "sticker",
  icon: <GameKC />,
  label: "Stickers"
}];
function App() {
  let [config, setConfig] = React.useState(null);
  let [currentValue, setCurrentValue] = React.useState(null);
  let [mode, setMode] = React.useState("push");
  let [size, setSize] = React.useState(80);
  let [items, setItems] = React.useState([]);
  let [items2, setItems2] = React.useState([]);
  let [point, setPoint] = React.useState({
    x: 0,
    y: 0,
    scale: 1
  });
  let [cameraError, setCameraError] = React.useState("");
  let y = React.useRef(null);
  let x = React.useRef(null);
  let stateRef = React.useRef(new Map());
  let stateRef2 = React.useRef(null);
  let stateRef3 = React.useRef(null);
  React.useEffect(() => {
    let value = !0;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value2 = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (value2.ok) {
          options = await value2.json();
        }
      } catch {}
      if (value) {
        setConfig(VC(options));
      }
    })();
    return () => {
      value = !1;
    };
  }, []);
  let callback = React.useCallback((value, otherValue) => {
    if (!y.current) return {
      x: 0,
      y: 0
    };
    let dimensions = y.current.getBoundingClientRect();
    return {
      x: (value - dimensions.left) / dimensions.width * y.current.width,
      y: (otherValue - dimensions.top) / dimensions.height * y.current.height
    };
  }, []);
  let callback2 = React.useCallback(() => {
    let dimensions = y.current;
    if (!dimensions || dimensions.__cameraVideo) return;
    let imageData = dimensions.getContext("2d", {
      willReadFrequently: !0
    }).getImageData(0, 0, dimensions.width, dimensions.height);
    setItems(value => {
      let items4 = [...value, imageData];
      if (items4.length > 10) {
        items4.shift();
      }
      return items4;
    });
  }, []);
  let handleClick = React.useCallback(() => {
    let live = y.current;
    if (live?.__cameraVideo) {
      live.__cameraOps?.pop();
      return;
    }
    if (items.length === 0 || !y.current) return;
    let items4 = [...items];
    let value = items4.pop();
    y.current.getContext("2d", {
      willReadFrequently: !0
    }).putImageData(value, 0, 0);
    setItems(items4);
  }, [items]);
  let handleClick2 = React.useCallback(() => {
    if (!x.current || !y.current) return;
    let current = x.current;
    let dimensions = y.current;
    if (dimensions.__cameraVideo) {
      dimensions.__cameraOps = [];
      setItems2([]);
      setPoint({
        x: 0,
        y: 0,
        scale: 1
      });
      return;
    }
    dimensions.getContext("2d", {
      willReadFrequently: !0
    }).drawImage(current, 0, 0, dimensions.width, dimensions.height);
    setItems([]);
    setItems2([]);
    setPoint({
      x: 0,
      y: 0,
      scale: 1
    });
  }, []);
  let handleChange = React.useCallback(value => {
    let item = value.target.files[0];
    if (!item) return;
    let objectURL = URL.createObjectURL(item);
    let dimensions = new Image();
    dimensions.onload = () => {
      setCurrentValue(objectURL);
      let width = dimensions.width;
      let height = dimensions.height;
      let value2 = 1024;
      if (Math.max(width, height) > value2) {
        if (width > height) {
          height = height * (value2 / width);
          width = value2;
        } else {
          width = width * (value2 / height);
          height = value2;
        }
      }
      x.current = dimensions;
      (() => {
        let attempts = 0;
        let paint = () => {
          if (!y.current) {
            if (attempts++ < 30) {
              requestAnimationFrame(paint);
            }
            return;
          }
          y.current.width = width;
          y.current.height = height;
          y.current.getContext("2d", {
            willReadFrequently: !0
          }).drawImage(dimensions, 0, 0, width, height);
        };
        requestAnimationFrame(paint);
      })();
      setItems([]);
      setItems2([]);
      setPoint({
        x: 0,
        y: 0,
        scale: 1
      });
      setMode("push");
    };
    dimensions.src = objectURL;
  }, []);
  let callback3 = React.useCallback((value, otherValue) => {
    if (!y.current) return;
    let point2 = callback(value, otherValue);
    let element = y.current;
    let replay = element.__replayOp;
    let point3 = replay ? replay.prev : stateRef3.current || point2;
    let activeMode = replay ? replay.mode : mode;
    let activeSize = replay ? replay.size : size;
    if (element.__cameraVideo && !element.__replaying) {
      let value14 = element.__cameraOps || (element.__cameraOps = []);
      value14.push({
        x: value,
        y: otherValue,
        prev: {
          ...point3
        },
        mode: mode,
        size: size
      });
      if (value14.length > 48) {
        value14.shift();
      }
    }
    let context = element.getContext("2d", {
      willReadFrequently: !0
    });
    let bounds = element.getBoundingClientRect();
    let value2 = activeSize * (element.width / bounds.width);
    let value3 = Math.floor(point2.x - value2);
    let value4 = Math.floor(point2.y - value2);
    let value5 = Math.ceil(value2 * 2);
    let value6 = Math.ceil(value2 * 2);
    if (value5 <= 0 || value6 <= 0 || value3 >= element.width || value4 >= element.height || value3 + value5 <= 0 || value4 + value6 <= 0) {
      stateRef3.current = point2;
      return;
    }
    let value7 = Math.max(0, value3);
    let value8 = Math.max(0, value4);
    let value9 = Math.min(element.width, value3 + value5);
    let value10 = Math.min(element.height, value4 + value6);
    let value11 = value9 - value7;
    let value12 = value10 - value8;
    if (value11 <= 0 || value12 <= 0) return;
    let imageData = context.getImageData(value7, value8, value11, value12);
    let uint8ClampedArray = new Uint8ClampedArray(imageData.data);
    let value13 = activeMode === "push" ? (config == null ? void 0 : config.INTENSITY_PUSH) || 0.8 : (config == null ? void 0 : config.INTENSITY_BLOAT) || 0.5;
    for (let value14 = 0; value14 < value12; value14++) for (let value15 = 0; value15 < value11; value15++) {
      let value16 = value7 + value15;
      let value17 = value8 + value14;
      let value18 = value16 - point2.x;
      let value19 = value17 - point2.y;
      let value20 = Math.sqrt(value18 * value18 + value19 * value19);
      if (value20 < value2) {
        let value21 = value16;
        let value22 = value17;
        let value23 = Math.pow(1 - value20 / value2, 2);
        if (activeMode === "push") {
          value21 = value16 - (point2.x - point3.x) * value23 * value13;
          value22 = value17 - (point2.y - point3.y) * value23 * value13;
        } else {
          if (activeMode === "bloat") {
            value21 = point2.x + value18 * (1 - value13 * value23);
            value22 = point2.y + value19 * (1 - value13 * value23);
          } else {
            if (activeMode === "pucker") {
              value21 = point2.x + value18 * (1 + value13 * value23);
              value22 = point2.y + value19 * (1 + value13 * value23);
            }
          }
        }
        let value24 = Math.round(value21 - value7);
        let value25 = Math.round(value22 - value8);
        if (value24 >= 0 && value24 < value11 && value25 >= 0 && value25 < value12) {
          let value26 = (value25 * value11 + value24) * 4;
          let value27 = (value14 * value11 + value15) * 4;
          imageData.data[value27] = uint8ClampedArray[value26];
          imageData.data[value27 + 1] = uint8ClampedArray[value26 + 1];
          imageData.data[value27 + 2] = uint8ClampedArray[value26 + 2];
          imageData.data[value27 + 3] = uint8ClampedArray[value26 + 3];
        }
      }
    }
    context.putImageData(imageData, value7, value8);
    stateRef3.current = point2;
  }, [size, mode, callback, config]);
  let cameraStart = async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Live camera is not supported here. Import a photo instead.");
      return;
    }
    try {
      let stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: {
            ideal: 720
          },
          height: {
            ideal: 1280
          }
        },
        audio: !1
      });
      let video = document.createElement("video");
      video.playsInline = !0;
      video.muted = !0;
      video.autoplay = !0;
      video.srcObject = stream;
      await video.play();
      setCurrentValue("camera");
      setMode("push");
      setItems([]);
      setItems2([]);
      setPoint({
        x: 0,
        y: 0,
        scale: 1
      });
      x.current = video;
      let attempts = 0;
      let setup = () => {
        let canvas = y.current;
        if (!canvas) {
          if (attempts++ < 60) {
            requestAnimationFrame(setup);
            return;
          }
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        let value = video.videoWidth || 480;
        let value2 = video.videoHeight || 640;
        let scale = Math.min(1, 640 / Math.max(value, value2));
        canvas.width = Math.max(1, Math.round(value * scale));
        canvas.height = Math.max(1, Math.round(value2 * scale));
        canvas.__cameraVideo = video;
        canvas.__cameraStream = stream;
        canvas.__cameraOps = [];
        canvas.__lastFrame = 0;
        let paint = timestamp => {
          if (!canvas.__cameraVideo) return;
          canvas.__cameraRaf = requestAnimationFrame(paint);
          if (timestamp - canvas.__lastFrame < 33) return;
          canvas.__lastFrame = timestamp;
          let context = canvas.getContext("2d", {
            willReadFrequently: !0
          });
          context.save();
          context.setTransform(-1, 0, 0, 1, canvas.width, 0);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          context.restore();
          canvas.__replaying = !0;
          for (let point2 of canvas.__cameraOps) {
            canvas.__replayOp = point2;
            stateRef3.current = point2.prev;
            callback3(point2.x, point2.y);
          }
          canvas.__replayOp = null;
          canvas.__replaying = !1;
          stateRef3.current = null;
        };
        canvas.__cameraRaf = requestAnimationFrame(paint);
      };
      requestAnimationFrame(setup);
    } catch {
      setCameraError("Camera unavailable. Allow access or import a photo.");
    }
  };
  let exitEditor = () => {
    let canvas = y.current;
    if (canvas?.__cameraRaf) {
      cancelAnimationFrame(canvas.__cameraRaf);
    }
    canvas?.__cameraStream?.getTracks().forEach(track => track.stop());
    if (canvas) {
      canvas.__cameraVideo = null;
      canvas.__cameraStream = null;
      canvas.__cameraOps = [];
    }
    x.current = null;
    setCurrentValue(null);
  };
  let handlePointerDown = React.useCallback(event => {
    if (event.currentTarget.setPointerCapture(event.pointerId), stateRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    }), stateRef.current.size === 2) {
      let value = Array.from(stateRef.current.values());
      let value2 = (value[0].x + value[1].x) / 2;
      let value3 = (value[0].y + value[1].y) / 2;
      let dist = Math.hypot(value[0].x - value[1].x, value[0].y - value[1].y);
      stateRef2.current = {
        cx: value2,
        cy: value3,
        dist: dist,
        tx: point.x,
        ty: point.y,
        s: point.scale,
        type: "pinch"
      };
    } else {
      if (stateRef.current.size === 1) {
        if (["push", "bloat", "pucker"].includes(mode)) {
          callback2();
          stateRef3.current = callback(event.clientX, event.clientY);
          callback3(event.clientX, event.clientY);
        } else {
          if (mode === "pan") {
            stateRef2.current = {
              ox: event.clientX,
              oy: event.clientY,
              tx: point.x,
              ty: point.y,
              type: "drag"
            };
          }
        }
      }
    }
  }, [mode, point, callback2, callback, callback3]);
  let handlePointerMove = React.useCallback(event => {
    if (stateRef.current.has(event.pointerId)) {
      if (stateRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY
      }), stateRef.current.size === 2) {
        let value = Array.from(stateRef.current.values());
        let value2 = (value[0].x + value[1].x) / 2;
        let value3 = (value[0].y + value[1].y) / 2;
        let value4 = Math.hypot(value[0].x - value[1].x, value[0].y - value[1].y);
        let current = stateRef2.current;
        if (current && current.type === "pinch") {
          let value5 = value4 / current.dist;
          let scale = Math.min(Math.max(current.s * value5, 0.2), 10);
          let value6 = value2 - current.cx;
          let value7 = value3 - current.cy;
          setPoint({
            x: current.tx + value6,
            y: current.ty + value7,
            scale: scale
          });
        }
      } else if (stateRef.current.size === 1) if (mode === "pan") {
        let current = stateRef2.current;
        if (current && current.type === "drag") {
          let value = event.clientX - current.ox;
          let value2 = event.clientY - current.oy;
          setPoint(value3 => ({
            ...value3,
            x: current.tx + value,
            y: current.ty + value2
          }));
        }
      } else {
        if (["push", "bloat", "pucker"].includes(mode)) {
          callback3(event.clientX, event.clientY);
        }
      }
    }
  }, [mode, callback3]);
  let handlePointerUp = React.useCallback(event => {
    stateRef.current.delete(event.pointerId);
    stateRef3.current = null;
    if (stateRef.current.size < 2) {
      stateRef2.current = null;
    }
  }, []);
  let callback4 = React.useCallback(value => {
    setItems2(value2 => [...value2, {
      id: Date.now(),
      src: value
    }]);
  }, []);
  let computedValue = React.useMemo(() => config ? Object.keys(config).filter(item => item.startsWith("STICKER_")).map(item => config[item]) : [], [config]);
  return config ? <React.Fragment>{<style>{`
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
          --font-body: "Poppins", "PingFang SC", system-ui, sans-serif;
          --font-mono: ui-monospace, Menlo, monospace;
          --accent: #FF5722;
          --bg: #121212;
          --panel: #1E1E1E;
          --text: #FFFFFF;
        }
        html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; background: var(--bg); color: var(--text); font-family: var(--font-body); }
        * { box-sizing: border-box; touch-action: none; }
        
        .app-container { display: flex; flex-direction: column; width: 100%; height: 100%; background: radial-gradient(circle at 50% 35%, #252525 0%, #121212 58%, #090909 100%); }
        .header { flex: 0 0 auto; min-height: calc(76px + env(safe-area-inset-top, 0px)); display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; padding: calc(40px + env(safe-area-inset-top, 0px)) 25px 16px; background: linear-gradient(180deg, rgba(30,30,30,.98), rgba(30,30,30,.9)); z-index: 20; box-shadow: 0 8px 24px rgba(0,0,0,0.28); }
        .header h1 { flex: 1; min-width: 0; font-size: clamp(20px, 5.5vw, 24px); line-height: 1.15; text-align: center; margin: 0; font-family: var(--font-display); font-weight: 700; text-wrap: balance; }
        .btn { background: transparent; border: none; color: var(--text); font-family: var(--font-body); font-weight: 600; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
        .btn:disabled { opacity: 0.5; }
        
        .workspace { flex: 1; min-height: 0; position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .canvas-wrapper { position: relative; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
        .canvas-wrapper canvas { display: block; max-width: 90vw; max-height: 70vh; width: auto; height: auto; }
        
        .empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 25px; }
        .upload-btn { width: min(100%, 280px); min-height: 50px; background: var(--accent); color: #fff; padding: 14px 28px; border-radius: 30px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.2s; box-shadow: 0 10px 26px rgba(255,87,34,.22); }
        .upload-btn:active { transform: scale(0.95); }
        .upload-btn input { display: none; }

        .bottom-panel { flex: 0 0 auto; background: var(--panel); padding-bottom: max(16px, env(safe-area-inset-bottom, 0px)); border-top-left-radius: 20px; border-top-right-radius: 20px; box-shadow: 0 -4px 15px rgba(0,0,0,0.3); z-index: 20; position: relative; }
        .tools-row { display: flex; justify-content: space-around; padding: 16px 8px 8px; }
        .tool-btn { display: flex; flex-direction: column; align-items: center; background: none; border: none; color: #888; font-size: 11px; gap: 6px; padding: 8px; border-radius: 12px; font-family: var(--font-body); transition: all 0.2s; }
        .tool-btn.active { color: var(--accent); background: rgba(255, 87, 34, 0.1); }
        .tool-btn svg { width: 28px; height: 28px; fill: currentColor; }
        
        .slider-row { padding: 20px 24px 0; display: flex; align-items: center; gap: 16px; }
        .slider-row span { font-size: 12px; font-weight: 600; opacity: 0.8; }
        .slider-row input[type=range] { flex: 1; accent-color: var(--accent); height: 4px; background: #333; border-radius: 2px; outline: none; }
        
        .sticker-tray { display: flex; overflow-x: auto; padding: 16px; gap: 12px; }
        .sticker-item { width: 64px; height: 64px; border-radius: 12px; background: rgba(255,255,255,0.05); object-fit: contain; padding: 8px; flex-shrink: 0; }
      `}</style>}{<div className={"app-container"}>{<header className={"header"}>{currentValue && <button className={"btn"} onClick={exitEditor} style={{
          color: "#888"
        }}>{"Back"}</button>}{!currentValue && <h1>{config.APP_TITLE || "Liquify Editor"}</h1>}{currentValue && <div style={{
          display: "flex",
          gap: "8px"
        }}>{<button className={"btn"} onClick={handleClick} disabled={items.length === 0}>{"Undo"}</button>}{<button className={"btn"} onClick={handleClick2} style={{
            color: "#FF4757"
          }}>{"Reset"}</button>}</div>}</header>}{currentValue ? <React.Fragment>{<div className={"workspace"} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>{<Motion.motion.div className={"canvas-wrapper"} style={{
            x: point.x,
            y: point.y,
            scale: point.scale
          }}>{<canvas ref={y} />}{items2.map(item => <Motion.motion.img drag={!0} dragMomentum={!1} src={item.src} onPointerDown={value => value.stopPropagation()} style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: "120px",
              height: "120px",
              marginTop: "-60px",
              marginLeft: "-60px",
              objectFit: "contain"
            }} key={item.id} />)}</Motion.motion.div>}</div>}{<div className={"bottom-panel"}>{<Motion.AnimatePresence>{["push", "bloat", "pucker"].includes(mode) && <Motion.motion.div initial={{
              height: 0,
              opacity: 0
            }} animate={{
              height: "auto",
              opacity: 1
            }} exit={{
              height: 0,
              opacity: 0
            }} className={"slider-row"}>{<span>{"SIZE"}</span>}{<input type={"range"} min={"20"} max={"200"} value={size} onChange={value => setSize(Number(value.target.value))} />}</Motion.motion.div>}{mode === "sticker" && <Motion.motion.div initial={{
              height: 0,
              opacity: 0
            }} animate={{
              height: "auto",
              opacity: 1
            }} exit={{
              height: 0,
              opacity: 0
            }} className={"sticker-tray"}>{computedValue.map(item => <img src={item} className={"sticker-item"} onClick={() => callback4(item)} alt={"sticker"} key={item} />)}</Motion.motion.div>}</Motion.AnimatePresence>}{<div className={"tools-row"}>{items3.map(item => <button className={`tool-btn ${mode === item.id ? "active" : ""}`} onClick={() => setMode(item.id)} key={item.id}>{item.icon}{<span>{item.label}</span>}</button>)}</div>}</div>}</React.Fragment> : <div className={"empty-state"}>{<button type={"button"} className={"upload-btn"} style={{
          border: "none",
          fontFamily: "inherit",
          fontSize: "16px"
        }} onClick={cameraStart}>{"Start Live Camera"}</button>}{cameraError && <div style={{
          maxWidth: "300px",
          padding: "0 25px",
          textAlign: "center",
          color: "#ffb4a2",
          fontSize: "14px",
          lineHeight: 1.4
        }}>{cameraError}</div>}{<label className={"upload-btn"} style={{
          background: "#333"
        }}>{"Import Photo Instead"}{<input type={"file"} accept={"image/*"} onChange={handleChange} style={{
            display: "none"
          }} />}</label>}</div>}</div>}</React.Fragment> : <div style={{
    width: "100%",
    height: "100%",
    background: "#121212"
  }} />;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": ".upload-btn",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": ".upload-btn",
      "game": ""
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
  const selectors = [];
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
