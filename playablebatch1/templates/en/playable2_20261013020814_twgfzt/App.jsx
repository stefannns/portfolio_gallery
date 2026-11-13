// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "SPRING_K",
    "kind": "number",
    "label": "Spring Stiffness",
    "value": 0.00006,
    "default": 0.00003,
    "min": 0.00001,
    "max": 0.0001,
    "step": 0.00001
  }, {
    "id": "DAMPING",
    "kind": "number",
    "label": "Damping Friction",
    "value": 0.0003,
    "default": 0.0003,
    "min": 0.0001,
    "max": 0.001,
    "step": 0.0001
  }, {
    "id": "TRAIL_LENGTH",
    "kind": "number",
    "label": "Trail Length",
    "value": 100,
    "default": 50,
    "min": 20,
    "max": 100,
    "step": 5
  }],
  "texts": [{
    "id": "HINT_TEXT",
    "label": "Interaction Hint",
    "value": "Pull and release to swirl",
    "default": "Drag the orb to swing",
    "max_length": 30
  }],
  "images": [],
  "config_version": "2.0",
  "playable": {
    "post_id": "103312816450468741",
    "version_id": "103312816450543816",
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  
/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .hint-text{position:fixed!important;top:28%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
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
var options = {
  SPRING_K: 0.00006,
  DAMPING: 0.0003,
  TRAIL_LENGTH: 100,
  HINT_TEXT: "Pull and release to swirl"
};
function vp(config) {
  let options2 = {};
  (config.tweaks || []).forEach(item => {
    options2[item.id] = item.value;
  });
  (config.texts || []).forEach(item => {
    options2[item.id] = item.value;
  });
  (config.images || []).forEach(item => {
    options2[item.id] = item.path;
  });
  (config.mentions || []).forEach(item => {
    options2[item.id] = item.path != null && item.path !== "" ? item.path : item.value;
  });
  (config.motions || []).forEach(item => {
    if (!(!item || !item.id)) {
      if (item.base_path != null && item.base_path !== "") {
        options2[item.id] = item.base_path;
        options2[item.id + "_BASE"] = item.base_path;
      }
      if (item.frame_count != null) {
        options2[item.id + "_COUNT"] = item.frame_count;
      }
    }
  });
  return options2;
}
function jc(value, otherValue) {
  return Math.max(0, Math.min(value / 2 - 65, otherValue / 2 - 85));
}
function zl(config = {}) {
  let handleAction = (value, otherValue, argument3, argument4) => Number.isFinite(Number(value)) ? Math.max(argument3, Math.min(argument4, Number(value))) : otherValue;
  return {
    stiffness: handleAction(config.SPRING_K, 0.00006, 0.000001, 0.001),
    damping: handleAction(config.DAMPING, 0.0003, 0, 0.001),
    trailLimit: Math.round(handleAction(config.TRAIL_LENGTH, 100, 2, 100))
  };
}
function bi(value, otherValue, argument3, argument4, argument5, argument6) {
  let value2 = argument6 / 2;
  let value3 = Math.sqrt(argument5 - value2 * value2);
  let value4 = Math.cos(value3 * argument4);
  let value5 = Math.sin(value3 * argument4);
  let value6 = Math.exp(-value2 * argument4);
  for (let [v, p, w] of [["x", "vx", otherValue], ["y", "vy", argument3]]) {
    let value7 = value[v] - w;
    let x = value[p];
    value[v] = w + value6 * (value7 * value4 + (x + value2 * value7) / value3 * value5);
    value[p] = value6 * (x * value4 - (value2 * x + argument5 * value7) / value3 * value5);
  }
}
function Ac(value, otherValue, argument3) {
  let {
    stiffness: value2,
    damping: value3,
    trailLimit: value4
  } = zl(argument3);
  let value5 = Math.max(0, Math.min(64, otherValue));
  for (; value5 > 0;) {
    let value7 = Math.min(value5, 30 - value.sampleClock);
    if (value.simTime += value7, value.pointer.active && value.pull && bi(value.orb, value.pull.x, value.pull.y, value7, 0.0016, 0.075), value.swinging && !value.pointer.active) {
      bi(value.orb, value.cx, value.cy, value7, value2, value3);
      let {
        orb: particle
      } = value;
      if (Math.sqrt((particle.x - value.cx) ** 2 + (particle.y - value.cy) ** 2 + (particle.vx ** 2 + particle.vy ** 2) / value2) < 1.6) {
        value.swinging = !1;
        particle.x = value.cx;
        particle.y = value.cy;
        particle.vx = 0;
        particle.vy = 0;
      }
    }
    let value8 = value.shape || (value.shape = {
      extension: 0,
      velocity: 0,
      angle: 0
    });
    let value9 = value.pointer.active ? Math.min(0.6, Math.hypot(value.orb.x - value.cx, value.orb.y - value.cy) / (value.radius * 0.88 || 1) * 0.6) : 0;
    let options2 = {
      x: value8.extension,
      vx: value8.velocity,
      y: 0,
      vy: 0
    };
    bi(options2, value9, 0, value7, 0.0005, 0.018);
    value8.extension = Math.max(-0.22, Math.min(0.65, options2.x));
    value8.velocity = options2.vx;
    if (value.pointer.active) {
      value8.angle = Math.atan2(value.orb.y - value.cy, value.orb.x - value.cx);
    }
    value.sampleClock += value7;
    if (value.sampleClock >= 30 - 0.000001) {
      if (value.swinging && !value.pointer.active) {
        value.trail.push({
          x: value.orb.x,
          y: value.orb.y,
          time: value.simTime
        });
      }
      value.sampleClock = 0;
    }
    value5 -= value7;
  }
  let value6 = value.simTime - value4 * 30;
  for (; value.trail.length && (value.trail.length > value4 || value.trail[0].time < value6);) value.trail.shift();
}
function Ll(value) {
  value.pointer.active = !1;
  value.pointer.id = null;
  value.swinging = !1;
  value.trail.length = 0;
  value.orb.x = value.cx;
  value.orb.y = value.cy;
  value.orb.vx = 0;
  value.orb.vy = 0;
  value.pull = {
    x: value.cx,
    y: value.cy
  };
  value.shape = {
    extension: 0,
    velocity: 0,
    angle: 0
  };
}
function Tl(value, otherValue, argument3) {
  let value2 = otherValue - value.cx;
  let value3 = argument3 - value.cy;
  let value4 = Math.hypot(value2, value3);
  let value5 = value.radius * 0.88;
  let value6 = (value5 > 0 ? value5 * Math.tanh(value4 / value5) : 0) / (value4 || 1);
  value.pull = {
    x: value.cx + value2 * value6,
    y: value.cy + value3 * value6
  };
}
function eu(value, otherValue) {
  let {
    stiffness: value2
  } = zl(otherValue);
  if (Math.hypot(value.orb.x - value.cx, value.orb.y - value.cy) < 6 && value.pull) {
    value.orb.x = value.pull.x;
    value.orb.y = value.pull.y;
  }
  let value3 = value.orb.x - value.cx;
  let value4 = value.orb.y - value.cy;
  if (value.trail.length = 0, value.sampleClock = 0, Math.hypot(value3, value4) < 6) {
    value.swinging = !1;
    value.orb.x = value.cx;
    value.orb.y = value.cy;
    return !1;
  }
  let value5 = Math.sqrt(value2);
  value.orb.vx = (-value4 * 0.64 - value3 * 0.42) * value5;
  value.orb.vy = (value3 * 0.64 - value4 * 0.42) * value5;
  let value6 = value.shape || (value.shape = {
    extension: 0,
    velocity: 0,
    angle: Math.atan2(value4, value3)
  });
  value6.extension = Math.max(value6.extension, Math.hypot(value3, value4) / (value.radius || 1) * 0.6);
  value6.velocity = -value6.extension * 0.008;
  value.swinging = !0;
  value.trail.push({
    x: value.orb.x,
    y: value.orb.y,
    time: value.simTime
  });
  return !0;
}
function Uc(value, otherValue, argument3) {
  Tl(value, otherValue, argument3);
  value.orb.x = value.pull.x;
  value.orb.y = value.pull.y;
  value.orb.vx = 0;
  value.orb.vy = 0;
}
function GameHp() {
  return <style>{`
    @font-face { font-family: 'Poppins'; src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2'); font-weight: 400; font-display: swap; }
    @font-face { font-family: 'Poppins'; src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2'); font-weight: 700; font-display: swap; }
    html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #05030a; touch-action: none; user-select: none; -webkit-user-select: none; }
    * { box-sizing: border-box; }
    .hint-text {
      position: absolute; top: 20%; left: 30px; right: 30px; z-index: 2;
      color: rgba(255,255,255,.8); font: 400 18px/1.5 'Poppins', 'PingFang SC', system-ui, sans-serif;
      text-align: center; text-wrap: balance; overflow-wrap: anywhere; pointer-events: none;
      transition: opacity .3s ease-out;
    }
    canvas:focus-visible { outline: 2px solid #bb9bff; outline-offset: -30px; }
    @media (prefers-reduced-motion: reduce) { .hint-text { transition: none; } }
  `}</style>;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [currentValue, setCurrentValue] = React.useState(!1);
  let elementRef = React.useRef(null);
  let elementRef2 = React.useRef(null);
  let stateRef = React.useRef({
    cx: 0,
    cy: 0,
    radius: 0,
    orb: {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0
    },
    pull: {
      x: 0,
      y: 0
    },
    shape: {
      extension: 0,
      velocity: 0,
      angle: 0
    },
    trail: [],
    sampleClock: 0,
    simTime: 0,
    swinging: !1,
    pointer: {
      x: 0,
      y: 0,
      active: !1,
      id: null
    },
    hasInteracted: !1,
    lastTime: performance.now(),
    reducedMotion: !1,
    initialized: !1,
    rafId: null
  });
  React.useEffect(() => {
    let value = !0;
    (async () => {
      let value2 = window.__GAME_CONFIG__ || {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value3 = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (value3.ok) {
          value2 = await value3.json();
        }
      } catch {}
      if (value) {
        setConfig({
          ...options,
          ...vp(value2)
        });
      }
    })();
    return () => {
      value = !1;
    };
  }, []);
  let callback = React.useCallback((value, otherValue) => {
    if (value <= 0 || otherValue <= 0) return;
    let current = stateRef.current;
    let value2 = current.cx;
    let value3 = current.cy;
    let value4 = jc(value, otherValue);
    let value5 = current.radius > 0 ? Math.min(1, value4 / current.radius) : 1;
    if (current.cx = value / 2, current.cy = otherValue / 2, current.radius = value4, !current.initialized) {
      current.orb.x = current.cx;
      current.orb.y = current.cy;
      current.pull.x = current.cx;
      current.pull.y = current.cy;
      current.initialized = !0;
    } else {
      for (let point of [current.orb, current.pointer, current.pull, ...current.trail]) {
        point.x = current.cx + (point.x - value2) * value5;
        point.y = current.cy + (point.y - value3) * value5;
      }
      current.orb.vx *= value5;
      current.orb.vy *= value5;
    }
  }, []);
  let callback2 = React.useCallback(() => {
    let canvas = elementRef2.current;
    let current = stateRef.current;
    if (!canvas || !config || document.hidden) return;
    let context = canvas.getContext("2d");
    if (!context) return;
    let timestamp = performance.now();
    let value = Math.max(0, Math.min(timestamp - current.lastTime, 64));
    if (current.lastTime = timestamp, !current.initialized) {
      current.rafId = requestAnimationFrame(callback2);
      return;
    }
    if (Ac(current, value, config), context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight), context.globalCompositeOperation = "source-over", context.lineCap = "round", context.lineJoin = "round", !current.pointer.active && current.trail.length > 1) {
      let items = [...current.trail, {
        x: current.orb.x,
        y: current.orb.y,
        time: current.simTime
      }];
      let value7 = zl(config).trailLimit * 30;
      if (!current.reducedMotion) {
        context.beginPath();
        context.moveTo(items[0].x, items[0].y);
        for (let value8 = 1; value8 < items.length - 1; value8++) {
          let point3 = items[value8];
          let point4 = items[value8 + 1];
          context.quadraticCurveTo(point3.x, point3.y, (point3.x + point4.x) / 2, (point3.y + point4.y) / 2);
        }
        let point2 = items[items.length - 1];
        context.lineTo(point2.x, point2.y);
        context.strokeStyle = "rgba(130,100,255,.08)";
        context.lineWidth = 4;
        context.shadowColor = "rgba(120,80,255,.45)";
        context.shadowBlur = 8;
        context.stroke();
        context.shadowBlur = 0;
      }
      context.lineCap = "butt";
      for (let value8 = 1; value8 < items.length; value8++) {
        let point2 = items[value8 - 1];
        let point3 = items[value8];
        let value9 = Math.max(0, 1 - (current.simTime - point2.time) / value7) ** 0.7;
        let value10 = (point2.time * 0.13 + 190) % 360;
        let value11 = (point3.time * 0.13 + 190) % 360;
        let linearGradient = context.createLinearGradient(point2.x, point2.y, point3.x, point3.y);
        linearGradient.addColorStop(0, `hsla(${value10},100%,65%,${value9 * 0.92})`);
        linearGradient.addColorStop(1, `hsla(${value11},100%,65%,${value9 * 0.92})`);
        context.beginPath();
        context.moveTo(point2.x, point2.y);
        context.lineTo(point3.x, point3.y);
        context.strokeStyle = linearGradient;
        context.lineWidth = 1 + value9 * 3;
        context.stroke();
      }
      context.lineCap = "round";
      context.shadowBlur = 0;
    }
    let {
      orb: point
    } = current;
    let value2 = current.swinging ? (current.simTime * 0.13 + 190) % 360 : 270;
    let value3 = current.reducedMotion ? 25 : 35 + (current.hasInteracted ? 0 : Math.sin(timestamp / 700) * 3);
    let radialGradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, value3);
    radialGradient.addColorStop(0, "rgba(255,255,255,.9)");
    radialGradient.addColorStop(0.2, `hsla(${value2},100%,65%,.75)`);
    radialGradient.addColorStop(1, `hsla(${value2},100%,65%,0)`);
    context.beginPath();
    context.arc(point.x, point.y, value3, 0, Math.PI * 2);
    context.fillStyle = radialGradient;
    context.fill();
    let value4 = current.reducedMotion ? 0 : current.shape.extension;
    let value5 = 1 + value4;
    let value6 = 1 / value5;
    context.beginPath();
    if (Math.abs(value4) < 0.0001) {
      context.arc(point.x, point.y, 8, 0, Math.PI * 2);
    } else {
      context.ellipse(point.x, point.y, 8 * value5, 8 * value6, current.shape.angle, 0, Math.PI * 2);
    }
    context.fillStyle = "#fff";
    context.shadowColor = `hsl(${value2},100%,70%)`;
    context.shadowBlur = current.reducedMotion ? 0 : 12;
    context.fill();
    context.shadowBlur = 0;
    current.rafId = requestAnimationFrame(callback2);
  }, [config]);
  React.useEffect(() => {
    if (!config || !elementRef2.current || !elementRef.current) return;
    let handleAction = (value2, otherValue) => {
      if (value2 <= 0 || otherValue <= 0 || !elementRef2.current) return;
      let value3 = Math.min(3, window.devicePixelRatio || 1);
      let dimensions = elementRef2.current;
      dimensions.width = Math.round(value2 * value3);
      dimensions.height = Math.round(otherValue * value3);
      dimensions.getContext("2d")?.setTransform(value3, 0, 0, value3, 0, 0);
      callback(value2, otherValue);
    };
    let {
      width: bounds,
      height: bounds2
    } = elementRef.current.getBoundingClientRect();
    handleAction(bounds, bounds2);
    let resizeObserver = new ResizeObserver(value2 => {
      for (let value3 of value2) handleAction(value3.contentRect.width, value3.contentRect.height);
    });
    resizeObserver.observe(elementRef.current);
    let current = stateRef.current;
    let value = window.matchMedia("(prefers-reduced-motion: reduce)");
    let handleAction2 = () => {
      current.reducedMotion = value.matches;
    };
    handleAction2();
    value.addEventListener("change", handleAction2);
    let handleAction3 = () => {
      if (!current.pointer.active) return;
      let value2 = current.pointer.id;
      Ll(current);
      let current2 = elementRef2.current;
      if (typeof value2 == "number" && current2?.hasPointerCapture(value2)) {
        current2.releasePointerCapture(value2);
      }
    };
    let handleAction4 = () => {
      if (current.rafId !== null) {
        cancelAnimationFrame(current.rafId);
      }
      current.rafId = null;
      if (document.hidden) {
        handleAction3();
      } else {
        current.lastTime = performance.now();
        current.rafId = requestAnimationFrame(callback2);
      }
    };
    document.addEventListener("visibilitychange", handleAction4);
    window.addEventListener("blur", handleAction3);
    handleAction4();
    return () => {
      resizeObserver.disconnect();
      value.removeEventListener("change", handleAction2);
      document.removeEventListener("visibilitychange", handleAction4);
      window.removeEventListener("blur", handleAction3);
      handleAction3();
      if (current.rafId !== null) {
        cancelAnimationFrame(current.rafId);
      }
      current.rafId = null;
    };
  }, [config, callback, callback2]);
  let callback3 = React.useCallback(() => {
    stateRef.current.hasInteracted = !0;
    setCurrentValue(!0);
  }, []);
  let callback4 = React.useCallback(event => {
    let bounds = elementRef2.current.getBoundingClientRect();
    let current = stateRef.current;
    current.pointer.x = event.clientX - bounds.left;
    current.pointer.y = event.clientY - bounds.top;
    Tl(current, current.pointer.x, current.pointer.y);
  }, []);
  let handlePointerDown = React.useCallback(event => {
    let current = stateRef.current;
    if (!(!event.isPrimary || event.button !== 0 || !current.initialized || current.pointer.active)) {
      current.swinging = !1;
      current.trail.length = 0;
      current.orb.vx = 0;
      current.orb.vy = 0;
      current.pointer.active = !0;
      current.pointer.id = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      callback4(event);
      callback3();
    }
  }, [callback4, callback3]);
  let handlePointerMove = React.useCallback(event => {
    let current = stateRef.current;
    if (current.pointer.active && current.pointer.id === event.pointerId) {
      callback4(event);
    }
  }, [callback4]);
  let handlePointerUp = React.useCallback(event => {
    let current = stateRef.current;
    if (!(!current.pointer.active || current.pointer.id !== event.pointerId)) {
      callback4(event);
      current.pointer.active = !1;
      current.pointer.id = null;
      eu(current, config);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }, [config, callback4]);
  let handlePointerCancel = React.useCallback(event => {
    let current = stateRef.current;
    if (!(!current.pointer.active || current.pointer.id !== event.pointerId)) {
      Ll(current);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }, []);
  let x = React.useCallback(event => {
    let current = stateRef.current;
    if (!current.initialized || current.pointer.active && current.pointer.id !== "keyboard") return;
    let options2 = {
      ArrowLeft: [-24, 0],
      ArrowRight: [24, 0],
      ArrowUp: [0, -24],
      ArrowDown: [0, 24]
    };
    if (options2[event.key]) {
      event.preventDefault();
      current.swinging = !1;
      current.trail.length = 0;
      let point = current.pointer.active && current.pointer.id === "keyboard" ? current.pointer : current.orb;
      let value = point.x + options2[event.key][0];
      let value2 = point.y + options2[event.key][1];
      current.pointer.active = !0;
      current.pointer.id = "keyboard";
      current.pointer.x = value;
      current.pointer.y = value2;
      Tl(current, current.pointer.x, current.pointer.y);
      callback3();
    } else if (event.key === "Enter" || event.key === " ") {
      if (event.preventDefault(), event.repeat) return;
      if (!current.pointer.active) {
        Uc(current, current.cx + current.radius * 0.85, current.cy);
      }
      current.pointer.active = !1;
      current.pointer.id = null;
      eu(current, config);
      callback3();
    } else {
      if (event.key === "Escape") {
        event.preventDefault();
        Ll(current);
      }
    }
  }, [config, callback3]);
  return config ? <div ref={elementRef} style={{
    width: "100%",
    height: "100%",
    position: "relative"
  }}>{<GameHp />}{<div className={"hint-text"} aria-hidden={currentValue} style={{
      opacity: currentValue ? 0 : 1
    }}>{config.HINT_TEXT}</div>}{<canvas ref={elementRef2} role={"button"} tabIndex={0} aria-label={"Pull and release the orb to swirl. Tap away from the center to launch, or use arrow keys then Enter. Escape stops the swing."} style={{
      display: "block",
      width: "100%",
      height: "100%",
      position: "absolute",
      inset: 0,
      zIndex: 1,
      cursor: "grab"
    }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} onLostPointerCapture={handlePointerCancel} onKeyDown={x} />}</div> : <div style={{
    width: "100%",
    height: "100%",
    background: "#05030a"
  }} />;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [".hint-text"];
  const copy = new Set(["Pull and release to swirl"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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

// Game helper

/* Batch 3 entry polish. Preview covers are still images in the feed. */
(() => {
  'use strict';

  const number = Number({
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "",
        "data-batch3-game": "59"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "59"
    }
  }?.dataset.batch3Game);
  const isFeed = new URLSearchParams(location.search).get('feedReview') === '1' && window.parent !== window;
  const root = document.documentElement;
  root.toggleAttribute('data-batch3-preview', isFeed);
  const configurations = {
    12: {
      text: 'Tap to pop the bubbles',
      top: '80px',
      color: '#a2355a',
      action: 'bubble'
    },
    20: {
      text: 'Tap the bug',
      top: '32%',
      color: '#fff',
      action: 'bug'
    },
    27: {
      text: 'Guess their age',
      top: '10.5%',
      color: '#fff',
      action: 'age'
    },
    37: {
      text: 'Tap to add balls',
      top: '24%',
      color: '#fff',
      action: 'add-ball'
    },
    39: {
      text: 'Tap squares to find the animal',
      top: '22%',
      color: '#29202e',
      action: 'cell'
    },
    49: {
      text: 'Guess the hidden code',
      top: '40%',
      color: '#fff',
      action: 'digit'
    },
    60: {
      text: 'Steer into the parking spot',
      top: '34%',
      color: '#fff',
      action: 'drive'
    }
  };
  const previewCSS = {
    8: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    11: 'html[data-batch3-preview] .screen-container div:has(>button.btn-option){transform:translateY(-8vh) scale(.84);transform-origin:center center}',
    13: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    25: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    27: 'html[data-batch3-preview] .age-controls {transform:translateY(-16vh) scale(.9);transform-origin:bottom center}',
    30: 'html[data-batch3-preview] .btn-control {visibility:hidden!important}',
    34: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    37: 'html[data-batch3-preview] #root button {bottom:34%!important}',
    38: 'html[data-batch3-preview] .pendulum-actions {visibility:hidden!important}',
    39: 'html[data-batch3-preview] [aria-label="8 by 8 animal search map"] {transform:scale(.84);transform-origin:center top}',
    43: 'html[data-batch3-preview] .meme-controls {visibility:hidden!important}',
    48: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    49: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    52: 'html[data-batch3-preview] .fate-wheel-wrap {transform:scale(.84)}',
    54: 'html[data-batch3-preview] .control {visibility:hidden!important}',
    56: 'html[data-batch3-preview] .drive-controls {visibility:hidden!important}',
    60: 'html[data-batch3-preview] #root div:has(>div>button[aria-label="Steer left"]) {visibility:hidden!important}',
    73: 'html[data-batch3-preview] #opening .opening-heading p {animation:b3-breathe 2.4s ease-in-out infinite}',
    74: 'html[data-batch3-preview] #photo-controls {visibility:hidden!important}'
  };
  const sharedCSS = `
    .b3-guide{position:fixed;left:30px;right:30px;z-index:120;margin:0;text-align:center;
      font:700 18px/1.3 var(--font-display,system-ui,sans-serif);pointer-events:none;
      text-shadow:0 1px 3px rgba(0,0,0,.25);animation:b3-breathe 2.4s ease-in-out infinite}
    @keyframes b3-breathe{0%,100%{opacity:1}50%{opacity:.68}}
    html[data-b3-hidden] .b3-guide,html[data-b3-hidden] #opening .opening-heading p{animation-play-state:paused!important}
    @media(prefers-reduced-motion:reduce){.b3-guide,html[data-batch3-preview] #opening .opening-heading p{animation:none!important}}
    ${previewCSS[number] || ''}
  `;
  const style = document.createElement('style');
  style.setAttribute('data-batch3-polish', '');
  style.textContent = sharedCSS;
  document.head.append(style);
  let guide;
  let dismissed = false;
  const config = configurations[number];
  function mountGuide() {
    if (!config || guide || dismissed) return;
    guide = document.createElement('p');
    guide.className = 'b3-guide';
    guide.textContent = config.text;
    guide.style.top = config.top;
    guide.style.color = config.color;
    document.body.append(guide);
  }
  function meaningful(event) {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (config?.action === 'bug') return !!target.closest('#root div[tabindex="0"]');
    if (config?.action === 'bubble') {
      if (target.closest('#root div[tabindex="0"],#root canvas')) return true;
      const value = target.closest('button');
      return !!value && /^(Sand Art|Spinner)$/.test(value.textContent.trim());
    }
    if (config?.action === 'age') return !!target.closest('input[type="range"],button.guess');
    const button = target.closest('button');
    if (!button || button.disabled) return false;
    if (config?.action === 'add-ball') return button.textContent.trim() === 'Add Ball';
    if (config?.action === 'cell') return /^Check cell \d+$/.test(button.getAttribute('aria-label') || '');
    if (config?.action === 'digit') return /^\d$/.test(button.textContent.trim());
    if (config?.action === 'drive') return /^(Steer left|Steer right|Drive forward|Reverse)$/.test(button.getAttribute('aria-label') || '');
    return false;
  }
  function dismissOnAction(event) {
    if (root.hasAttribute('data-batch3-preview')) return;
    if (meaningful(event)) {
      dismissed = true;
      guide?.remove();
      guide = null;
    }
  }
  document.addEventListener('pointerdown', dismissOnAction, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') dismissOnAction(event);
  }, true);
  window.addEventListener('message', event => {
    if (!isFeed || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    root.toggleAttribute('data-batch3-preview', event.data.active !== true);
  });
  document.addEventListener('visibilitychange', () => {
    root.toggleAttribute('data-b3-hidden', document.hidden);
  });
  const observer = new MutationObserver(mountGuide);
  const start = () => {
    mountGuide();
    observer.observe(document.getElementById('root') || document.body, {
      childList: true,
      subtree: true
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {
    once: true
  });else start();
  window.addEventListener('pagehide', () => {
    observer.disconnect();
  }, {
    once: true
  });
})();
