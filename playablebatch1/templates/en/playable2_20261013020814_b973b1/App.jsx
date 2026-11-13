// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "MAX_SPEED",
    "kind": "number",
    "label": "Max Speed",
    "value": 0.4,
    "default": 0.4,
    "min": 0.2,
    "max": 0.8,
    "step": 0.05
  }, {
    "id": "ACCELERATION",
    "kind": "number",
    "label": "Acceleration",
    "value": 0.0008,
    "default": 0.0008,
    "min": 0.0002,
    "max": 0.002,
    "step": 0.0001
  }, {
    "id": "STEER_SPEED",
    "kind": "number",
    "label": "Steering Speed",
    "value": 0.003,
    "default": 0.003,
    "min": 0.001,
    "max": 0.006,
    "step": 0.0005
  }],
  "texts": [{
    "id": "TXT_LEVEL_CLEAR",
    "label": "Level Clear Title",
    "value": "Level Cleared!",
    "default": "Level Cleared!",
    "max_length": 20
  }, {
    "id": "TXT_NEXT_LEVEL",
    "label": "Next Level Btn",
    "value": "Next Level",
    "default": "Next Level",
    "max_length": 15
  }, {
    "id": "TXT_GAME_OVER",
    "label": "Crash Title",
    "value": "Crashed!",
    "default": "Crashed!",
    "max_length": 20
  }, {
    "id": "TXT_RESTART",
    "label": "Try Again Btn",
    "value": "Try Again",
    "default": "Try Again",
    "max_length": 15
  }, {
    "id": "TXT_ALL_CLEAR",
    "label": "All Clear Title",
    "value": "You are a Parking Master!",
    "default": "You are a Parking Master!",
    "max_length": 30
  }, {
    "id": "TXT_RESTART_ALL",
    "label": "Play Again Btn",
    "value": "Play Again",
    "default": "Play Again",
    "max_length": 15
  }, {
    "id": "TXT_POST_PLAY",
    "label": "Post Play Btn",
    "value": "Post My Play",
    "default": "Post My Play",
    "max_length": 20
  }],
  "images": [{
    "id": "IMG_PLAYER",
    "label": "Player Car",
    "path": "./assets/art-v3/player.svg",
    "replaceable": true
  }, {
    "id": "IMG_PARKED",
    "label": "Parked Car",
    "path": "./assets/art-v3/parked.svg",
    "replaceable": true
  }, {
    "id": "IMG_BG",
    "label": "Cartoon Parking Lot",
    "path": "./assets/art-v3/parking-lot.png",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "103312816458762873",
    "version_id": "103312816458754163",
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const GAME_STYLES = "\n    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }\n    body { background: #596b80; -webkit-tap-highlight-color: transparent; }\n  ";
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
// Preserve the original fallback when the configuration cannot be fetched.
for (const value9 of ['playable-inline-config', 'playable-config-inline']) {
  const node = document.createElement('script');
  node.id = value9;
  node.type = 'application/json';
  node.textContent = JSON.stringify(DEFAULT_CONFIG);
  document.body.append(node);
}
document.documentElement.lang = 'en';
function Kc(stateRef) {
  let itemMap = new Map();
  let handleAction = () => {
    for (let value9 of ["up", "down", "left", "right"]) stateRef.current[value9] = [...itemMap.values()].includes(value9);
  };
  return {
    press(value9, otherValue) {
      itemMap.set(value9, otherValue);
      handleAction();
    },
    release(value9) {
      itemMap.delete(value9);
      handleAction();
    },
    clear() {
      itemMap.clear();
      handleAction();
    }
  };
}
function useGameFeature1() {
  let canSubmit = typeof window !== "undefined" && typeof window.tt !== "undefined" && typeof window.tt.playableRecordingSubmission == "function";
  let [submitting, setSubmitting] = React.useState(!1);
  React.useEffect(() => {
    let handleAction = () => setSubmitting(!1);
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
  return {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: () => {
      if (!(submitting || !canSubmit)) {
        setSubmitting(!0);
        window.tt.playableRecordingSubmission({
          success() {},
          fail(value9) {
            console.error("[post_my_play] playableRecordingSubmission failed", value9 && (value9.errMsg || value9.message));
            setSubmitting(!1);
          },
          complete() {}
        });
      }
    }
  };
}
function Lp(config) {
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
function xp(value9, otherValue, argument3) {
  let value10 = otherValue;
  let value11 = argument3;
  let value12 = -1;
  let value13 = -1;
  for (let value14 = 0; value14 < argument3; value14++) for (let value15 = 0; value15 < otherValue; value15++) {
    if (!(value9[(value14 * otherValue + value15) * 4 + 3] < 8)) {
      value10 = Math.min(value10, value15);
      value12 = Math.max(value12, value15);
      value11 = Math.min(value11, value14);
      value13 = Math.max(value13, value14);
    }
  }
  return value12 < value10 ? null : {
    x: value10,
    y: value11,
    w: value12 - value10 + 1,
    h: value13 - value11 + 1
  };
}
function Cp(value9) {
  let naturalWidth = value9.naturalWidth;
  let naturalHeight = value9.naturalHeight;
  if (!naturalWidth || !naturalHeight) return null;
  try {
    let dimensions = document.createElement("canvas");
    dimensions.width = naturalWidth;
    dimensions.height = naturalHeight;
    let context = dimensions.getContext("2d", {
      willReadFrequently: !0
    });
    context.drawImage(value9, 0, 0);
    return xp(context.getImageData(0, 0, naturalWidth, naturalHeight).data, naturalWidth, naturalHeight);
  } catch {
    return /\/car_parked\.webp(?:[?#]|$)/.test(value9.src) ? {
      x: naturalWidth * 514 / 1600,
      y: naturalHeight * 729 / 2848,
      w: naturalWidth * 582 / 1600,
      h: naturalHeight * 1453 / 2848
    } : {
      x: 0,
      y: 0,
      w: naturalWidth,
      h: naturalHeight
    };
  }
}
var value = 800;
var value2 = 1200;
var value3 = 76;
var value4 = 140;
var value5 = 60;
var value6 = 120;
function Np() {
  let items = [];
  for (let value9 = 0; value9 < 17; value9++) {
    let walls = [{
      x: value / 2,
      y: -10,
      w: value,
      h: 20,
      angle: 0
    }, {
      x: value / 2,
      y: value2 + 10,
      w: value,
      h: 20,
      angle: 0
    }, {
      x: -10,
      y: value2 / 2,
      w: 20,
      h: value2,
      angle: 0
    }, {
      x: value + 10,
      y: value2 / 2,
      w: 20,
      h: value2,
      angle: 0
    }];
    let parked = [];
    let target = {
      x: value / 2,
      y: 240,
      w: value3,
      h: value4,
      angle: 0
    };
    let player = {
      x: value / 2,
      y: 1000,
      angle: 0
    };
    if (value9 < 5) {
      let value10 = 3 + value9;
      let value11 = target.x - Math.floor(value10 / 2) * (value3 + 10);
      for (let value12 = 0; value12 < value10; value12++) {
        let value13 = value11 + value12 * (value3 + 10);
        if (value12 === Math.floor(value10 / 2)) {
          target.x = value13;
        } else {
          parked.push({
            x: value13,
            y: 240,
            w: value5,
            h: value6,
            angle: 0
          });
        }
      }
      player.x = target.x + (value9 % 2 === 0 ? 100 : -100);
      player.angle = value9 === 0 ? -0.13 : Math.PI / 2;
    } else if (value9 < 12) {
      target = {
        x: value - 100,
        y: 400 + (value9 - 5) * 60,
        w: value4,
        h: value3,
        angle: Math.PI / 2
      };
      parked.push({
        x: target.x,
        y: target.y - value3 - 20,
        w: value5,
        h: value6,
        angle: Math.PI / 2
      });
      parked.push({
        x: target.x,
        y: target.y + value3 + 20,
        w: value5,
        h: value6,
        angle: Math.PI / 2
      });
      if (value9 > 7) {
        parked.push({
          x: target.x,
          y: target.y - value3 * 2 - 40,
          w: value5,
          h: value6,
          angle: Math.PI / 2
        });
      }
      player.x = target.x - 200;
      player.y = target.y + 300;
      player.angle = -Math.PI / 2;
    } else {
      let angle = Math.PI / 4;
      target = {
        x: 300,
        y: 500,
        w: value3,
        h: value4,
        angle: angle
      };
      parked.push({
        x: target.x - 80,
        y: target.y - 80,
        w: value5,
        h: value6,
        angle: angle
      });
      parked.push({
        x: target.x + 80,
        y: target.y + 80,
        w: value5,
        h: value6,
        angle: angle
      });
      player.x = value - 200;
      player.y = 800;
      player.angle = -Math.PI;
      walls.push({
        x: 200,
        y: 800,
        w: 300,
        h: 20,
        angle: Math.PI / 6
      });
    }
    items.push({
      walls: walls,
      parked: parked,
      target: target,
      player: player
    });
  }
  return items;
}
var value7 = Np();
function _p(context) {
  context.fillStyle = "#858b8e";
  context.fillRect(0, 0, value, value2);
}
function Xc(value9, otherValue) {
  if (!otherValue) return value9;
  let value10 = Math.min(value9.w / otherValue.w, value9.h / otherValue.h);
  return {
    ...value9,
    w: otherValue.w * value10,
    h: otherValue.h * value10
  };
}
function Yc(value9, otherValue, argument3, argument4, argument5) {
  let value10 = Math.cos(argument5);
  let value11 = Math.sin(argument5);
  let value12 = argument3 / 2;
  let value13 = argument4 / 2;
  return [{
    x: value9 + value10 * value12 - value11 * value13,
    y: otherValue + value11 * value12 + value10 * value13
  }, {
    x: value9 - value10 * value12 - value11 * value13,
    y: otherValue - value11 * value12 + value10 * value13
  }, {
    x: value9 - value10 * value12 + value11 * value13,
    y: otherValue - value11 * value12 - value10 * value13
  }, {
    x: value9 + value10 * value12 + value11 * value13,
    y: otherValue + value11 * value12 - value10 * value13
  }];
}
function Gc(value9, point) {
  let value10 = value9[0].x * point.x + value9[0].y * point.y;
  let value11 = value10;
  for (let value12 = 1; value12 < 4; value12++) {
    let value13 = value9[value12].x * point.x + value9[value12].y * point.y;
    if (value13 < value10) {
      value10 = value13;
    }
    if (value13 > value11) {
      value11 = value13;
    }
  }
  return {
    min: value10,
    max: value11
  };
}
function Zc(point, point2) {
  let value9 = Yc(point.x, point.y, point.w, point.h, point.angle);
  let value10 = Yc(point2.x, point2.y, point2.w, point2.h, point2.angle);
  let items = [{
    x: value9[1].x - value9[0].x,
    y: value9[1].y - value9[0].y
  }, {
    x: value9[2].x - value9[1].x,
    y: value9[2].y - value9[1].y
  }, {
    x: value10[1].x - value10[0].x,
    y: value10[1].y - value10[0].y
  }, {
    x: value10[2].x - value10[1].x,
    y: value10[2].y - value10[1].y
  }];
  for (let value11 = 0; value11 < 4; value11++) {
    let point3 = items[value11];
    let value12 = Math.hypot(point3.x, point3.y);
    if (value12 === 0) continue;
    let options = {
      x: -point3.y / value12,
      y: point3.x / value12
    };
    let value13 = Gc(value9, options);
    let value14 = Gc(value10, options);
    if (value13.max < value14.min || value14.max < value13.min) return !1;
  }
  return !0;
}
function Pp(value9, otherValue, point) {
  let value10 = Math.cos(-point.angle);
  let value11 = Math.sin(-point.angle);
  let value12 = value9 - point.x;
  let value13 = otherValue - point.y;
  let value14 = value12 * value10 - value13 * value11;
  let value15 = value12 * value11 + value13 * value10;
  return Math.abs(value14) <= point.w / 2 && Math.abs(value15) <= point.h / 2;
}
var value8 = `
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
html, body, #root { width:100%; height:100%; margin:0; overflow:hidden; background-color:#1a1a24; }
* { box-sizing: border-box; touch-action: none; user-select: none; -webkit-user-drag: none; }
`;
function App() {
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("playing");
  let [count, setCount] = React.useState(0);
  let elementRef = React.useRef(null);
  let stateRef = React.useRef(null);
  let stateRef2 = React.useRef(0);
  let stateRef3 = React.useRef({});
  let stateRef4 = React.useRef(null);
  let y = React.useRef({
    up: !1,
    down: !1,
    left: !1,
    right: !1
  });
  let stateRef5 = React.useRef(null);
  if (!stateRef5.current) {
    stateRef5.current = Kc(y);
  }
  let stateRef6 = React.useRef({
    x: 0,
    y: 0,
    angle: 0,
    speed: 0,
    steeringAngle: 0
  });
  let {
    canSubmit: value9,
    submitting: x,
    submitRecording: handleClick
  } = useGameFeature1();
  React.useEffect(() => {
    let value10 = !0;
    (async () => {
      let options2 = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value11 = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (value11.ok) {
          options2 = await value11.json();
        }
      } catch {}
      if (value10) {
        let config2 = Lp(options2);
        setConfig(config2);
        let handleAction4 = (value11, otherValue) => {
          if (!otherValue) return;
          let image = new Image();
          if (value11 === "parked") {
            image.onload = () => {
              stateRef4.current = Cp(image);
            };
          }
          image.src = otherValue;
          stateRef3.current[value11] = image;
        };
        handleAction4("player", config2.IMG_PLAYER);
        handleAction4("parked", config2.IMG_PARKED);
        handleAction4("bg", config2.IMG_BG);
      }
    })();
    return () => {
      value10 = !1;
    };
  }, []);
  React.useEffect(() => {
    let options2 = {
      KeyW: "up",
      ArrowUp: "up",
      KeyS: "down",
      ArrowDown: "down",
      KeyA: "left",
      ArrowLeft: "left",
      KeyD: "right",
      ArrowRight: "right"
    };
    let handleAction4 = event => {
      if (options2[event.code]) {
        event.preventDefault();
        stateRef5.current.press("key:" + event.code, options2[event.code]);
      }
    };
    let handleAction5 = value10 => {
      if (options2[value10.code]) {
        stateRef5.current.release("key:" + value10.code);
      }
    };
    let handleAction6 = () => stateRef5.current.clear();
    let handleAction7 = () => {
      if (document.hidden) {
        handleAction6();
      }
    };
    window.addEventListener("keydown", handleAction4);
    window.addEventListener("keyup", handleAction5);
    window.addEventListener("blur", handleAction6);
    document.addEventListener("visibilitychange", handleAction7);
    return () => {
      window.removeEventListener("keydown", handleAction4);
      window.removeEventListener("keyup", handleAction5);
      window.removeEventListener("blur", handleAction6);
      document.removeEventListener("visibilitychange", handleAction7);
      handleAction6();
    };
  }, []);
  let callback = React.useCallback(value10 => {
    let item = value7[value10];
    stateRef6.current = {
      x: item.player.x,
      y: item.player.y,
      angle: item.player.angle,
      speed: 0,
      steeringAngle: 0
    };
    stateRef5.current.clear();
    setPhase("playing");
  }, []);
  React.useEffect(() => {
    if (config && phase === "playing" && stateRef6.current.x === 0) {
      callback(count);
    }
  }, [config, count, phase, callback]);
  let callback2 = React.useCallback(() => {
    let canvas = elementRef.current;
    if (!canvas) return;
    let context = canvas.getContext("2d", {
      alpha: !1
    });
    _p(context, stateRef3.current.bg);
    let item = value7[count];
    if (!item) return;
    // Parking bays follow the same position and rotation as the cars.
    const drawBay = (spot, w, h, opacity = .88) => {
      context.save();
      context.translate(spot.x, spot.y);
      context.rotate(spot.angle);
      context.strokeStyle = `rgba(255,255,255,${opacity})`;
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(-w / 2, h / 2);
      context.lineTo(-w / 2, -h / 2);
      context.lineTo(w / 2, -h / 2);
      context.lineTo(w / 2, h / 2);
      context.stroke();
      context.restore();
    };
    // Empty marked bays continue across the top row and down both sides,
    // leaving the central aisle clear for driving.
    const occupied = [item.target, ...item.parked];
    const addEmptyBay = (x, y, angle) => {
      if (occupied.some(spot => Math.hypot(spot.x - x, spot.y - y) < 102)) return;
      drawBay({x, y, angle}, value3, value4, .68);
    };
    for (let x = item.target.x % 86; x < value - 30; x += 86) {
      if (x > 30) addEmptyBay(x, 240, 0);
    }
    for (let y = 510; y < value2 - 45; y += 86) {
      addEmptyBay(90, y, -Math.PI / 2);
      addEmptyBay(value - 90, y, Math.PI / 2);
    }
    item.parked.forEach(car => drawBay(car, value3, value4));
    drawBay(item.target, item.target.w, item.target.h);
    // Keep any later-level obstacles visible without the former yellow bar.
    context.fillStyle = "#666d70";
    item.walls.slice(4).forEach(wall => {
      context.save();context.translate(wall.x, wall.y);context.rotate(wall.angle);
      context.fillRect(-wall.w / 2, -wall.h / 2, wall.w, wall.h);context.restore();
    });
    context.save();
    context.translate(item.target.x, item.target.y);
    context.rotate(item.target.angle);
    context.strokeStyle = "#2fff5f";
    context.lineWidth = 4;
    context.shadowColor = "#2fff5f";
    context.shadowBlur = 10;
    context.strokeRect(-item.target.w / 2, -item.target.h / 2, item.target.w, item.target.h);
    context.fillStyle = "#2fff5f";
    context.font = 'bold 48px "Poppins", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("P", 0, 0);
    context.restore();
    let handleAction4 = (point2, otherValue, argument3) => {
      let point3 = otherValue === "parked" ? stateRef4.current : null;
      let value10 = Xc(point2, point3);
      context.save();
      context.translate(point2.x, point2.y);
      context.rotate(point2.angle);
      let z = stateRef3.current[otherValue];
      if (z && z.complete && z.width > 0) {
        if (point3) {
          context.drawImage(z, point3.x, point3.y, point3.w, point3.h, -value10.w / 2, -value10.h / 2, value10.w, value10.h);
        } else {
          context.drawImage(z, -point2.w / 2, -point2.h / 2, point2.w, point2.h);
        }
      } else {
        context.fillStyle = argument3;
        context.fillRect(-point2.w / 2, -point2.h / 2, point2.w, point2.h);
        context.fillStyle = "#ffffff";
        context.fillRect(-10, -point2.h / 2 + 10, 20, 10);
      }
      context.restore();
    };
    item.parked.forEach(item2 => {
      handleAction4(item2, "parked", "#5b757a");
    });
    let point = stateRef6.current;
    handleAction4({
      x: point.x,
      y: point.y,
      w: value5,
      h: value6,
      angle: point.angle
    }, "player", "#ff6b35");
  }, [count]);
  React.useEffect(() => {
    if (!config || phase !== "playing") return;
    let value10 = config.MAX_SPEED || 0.4;
    let value11 = config.ACCELERATION || 0.0008;
    let value12 = config.BRAKING || 0.0015;
    let value13 = config.FRICTION || 0.0003;
    let value14 = config.MAX_STEER || 0.6;
    let value15 = config.STEER_SPEED || 0.003;
    let value16 = value6 * 0.7;
    let handleAction4 = value17 => {
      if (!stateRef2.current) {
        stateRef2.current = value17;
      }
      let value18 = Math.min(value17 - stateRef2.current, 32);
      stateRef2.current = value17;
      let z = stateRef6.current;
      let current = y.current;
      if (current.left) {
        z.steeringAngle -= value15 * value18;
      } else {
        if (current.right) {
          z.steeringAngle += value15 * value18;
        } else {
          if (z.steeringAngle > 0) {
            z.steeringAngle = Math.max(0, z.steeringAngle - value15 * value18 * 2);
          }
          if (z.steeringAngle < 0) {
            z.steeringAngle = Math.min(0, z.steeringAngle + value15 * value18 * 2);
          }
        }
      }
      z.steeringAngle = Math.max(-value14, Math.min(value14, z.steeringAngle));
      let value19 = 0;
      if (current.up && (value19 = value11), current.down && (value19 = -value12), value19 !== 0 ? z.speed += value19 * value18 : (z.speed > 0 && (z.speed = Math.max(0, z.speed - value13 * value18)), z.speed < 0 && (z.speed = Math.min(0, z.speed + value13 * value18))), z.speed = Math.max(-value10 * 0.5, Math.min(value10, z.speed)), Math.abs(z.speed) > 0.01) {
        let value21 = z.speed / value16 * Math.tan(z.steeringAngle);
        z.angle += value21 * value18;
        z.angle = z.angle % (Math.PI * 2);
        z.x += z.speed * Math.sin(z.angle) * value18;
        z.y -= z.speed * Math.cos(z.angle) * value18;
      }
      let item = value7[count];
      let options2 = {
        x: z.x,
        y: z.y,
        w: value5 - 4,
        h: value6 - 4,
        angle: z.angle
      };
      let value20 = !1;
      for (let value21 of item.walls) {
        if (Zc(options2, value21)) {
          value20 = !0;
        }
      }
      for (let value21 of item.parked) {
        if (Zc(options2, Xc(value21, stateRef4.current))) {
          value20 = !0;
        }
      }
      if (value20) {
        setPhase("game_over");
        cancelAnimationFrame(stateRef.current);
        return;
      }
      if (Math.abs(z.speed) < 0.02) {
        let target = item.target;
        if (Pp(z.x, z.y, target)) {
          let value21 = Math.abs(z.angle % Math.PI - target.angle % Math.PI);
          if (Math.min(value21, Math.PI - value21) < 0.26) {
            if (count >= value7.length - 1) {
              setPhase("all_clear");
            } else {
              setPhase("level_clear");
            }
            cancelAnimationFrame(stateRef.current);
            return;
          }
        }
      }
      callback2();
      stateRef.current = requestAnimationFrame(handleAction4);
    };
    stateRef.current = requestAnimationFrame(handleAction4);
    return () => {
      cancelAnimationFrame(stateRef.current);
      stateRef2.current = 0;
    };
  }, [config, phase, count, callback2]);
  let options = {
    background: "rgba(255,255,255,0.1)",
    border: "2px solid rgba(255,255,255,0.4)",
    borderRadius: "16px",
    width: "72px",
    height: "72px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontSize: "32px",
    color: "#fff",
    backdropFilter: "blur(4px)",
    touchAction: "none"
  };
  let handleAction = value10 => event => {
    if (!(phase !== "playing" || event.pointerId != null && event.pointerType === "mouse" && event.button !== 0)) {
      event.preventDefault();
      if (event.pointerId != null) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      stateRef5.current.press(event.pointerId != null ? "pointer:" + event.pointerId : "button:" + value10, value10);
    }
  };
  let handleAction2 = value10 => event => {
    stateRef5.current.release(event.pointerId != null ? "pointer:" + event.pointerId : "button:" + value10);
  };
  let handleAction3 = () => {
    if (phase === "playing") return null;
    let label = "";
    let label2 = "";
    let handleClick2 = null;
    if (phase === "level_clear") {
      label = config.TXT_LEVEL_CLEAR || "Level Cleared!";
      label2 = config.TXT_NEXT_LEVEL || "Next Level";
      handleClick2 = () => {
        setCount(value10 => value10 + 1);
        callback(count + 1);
      };
    } else {
      if (phase === "game_over") {
        label = config.TXT_GAME_OVER || "Crashed!";
        label2 = config.TXT_RESTART || "Try Again";
        handleClick2 = () => callback(count);
      } else {
        if (phase === "all_clear") {
          label = config.TXT_ALL_CLEAR || "You are a Parking Master!";
          label2 = config.TXT_RESTART_ALL || "Play Again";
          handleClick2 = () => {
            setCount(0);
            callback(0);
          };
        }
      }
    }
    return <div style={{
      position: "absolute",
      inset: 0,
      backgroundColor: "rgba(0,0,0,0.7)",
      backdropFilter: "blur(8px)",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 50,
      color: "#fff"
    }}>{<h2 style={{
        fontSize: "36px",
        marginBottom: "40px",
        textAlign: "center",
        padding: "0 20px",
        fontFamily: "var(--font-display)"
      }}>{label}</h2>}{<div style={{
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        width: "240px"
      }}>{<button onClick={handleClick2} style={{
          padding: "16px 0",
          fontSize: "20px",
          fontWeight: "bold",
          borderRadius: "30px",
          border: "none",
          background: "#ffcf33",
          color: "#1a1a24",
          cursor: "pointer",
          fontFamily: "var(--font-display)"
        }}>{label2}</button>}{value9 && <button type={"button"} disabled={x} onClick={handleClick} style={{
          padding: "16px 0",
          fontSize: "20px",
          fontWeight: "bold",
          borderRadius: "30px",
          border: "2px solid #fff",
          background: "transparent",
          color: "#fff",
          cursor: x ? "default" : "pointer",
          fontFamily: "var(--font-display)",
          opacity: x ? 0.55 : 1
        }}>{config.TXT_POST_PLAY || "Post My Play"}</button>}</div>}</div>;
  };
  return config ? <div style={{
    width: "100%",
    height: "100%",
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#858b8e",
    containerType: "size"
  }}>{<style>{value8}</style>}{<div style={{
      position: "absolute",
      inset: 0,
      display: "flex",
      justifyContent: "center",
      alignItems: "center"
    }}>{<canvas ref={elementRef} width={value} height={value2} style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        maxWidth: "100%",
        maxHeight: "100%"
      }} />}</div>}{<div style={{
      position: "absolute",
      top: "calc(30px + env(safe-area-inset-top, 0px))",
      left: 30,
      right: 30,
      display: "flex",
      justifyContent: "center",
      pointerEvents: "none"
    }}>{<div style={{
        color: "#fff",
        fontSize: "28px",
        lineHeight: 1.2,
        fontWeight: "bold",
        fontFamily: "var(--font-display)",
        textShadow: "0 2px 6px #172431"
      }}>{count + 1}{"/"}{value7.length}</div>}</div>}{<div style={{
      position: "absolute",
      bottom: "calc(50px + env(safe-area-inset-bottom, 0px))",
      left: "30px",
      right: "30px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-end",
      pointerEvents: phase === "playing" ? "auto" : "none",
      opacity: phase === "playing" ? 1 : 0.2
    }}>{<div style={{
        display: "flex",
        gap: "12px"
      }}>{<button type={"button"} aria-label={"Steer left"} disabled={phase !== "playing"} style={options} onPointerDown={handleAction("left")} onPointerUp={handleAction2("left")} onPointerCancel={handleAction2("left")} onLostPointerCapture={handleAction2("left")} onBlur={handleAction2("left")} onKeyDown={event => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            handleAction("left")(event);
          }
        }} onKeyUp={handleAction2("left")}>{"\u2190"}</button>}{<button type={"button"} aria-label={"Steer right"} disabled={phase !== "playing"} style={options} onPointerDown={handleAction("right")} onPointerUp={handleAction2("right")} onPointerCancel={handleAction2("right")} onLostPointerCapture={handleAction2("right")} onBlur={handleAction2("right")} onKeyDown={event => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            handleAction("right")(event);
          }
        }} onKeyUp={handleAction2("right")}>{"\u2192"}</button>}</div>}{<div style={{
        display: "flex",
        gap: "12px",
        flexDirection: "column"
      }}>{<button type={"button"} aria-label={"Drive forward"} disabled={phase !== "playing"} style={{
          ...options,
          background: "rgba(255, 207, 51, 0.2)",
          borderColor: "#ffcf33"
        }} onPointerDown={handleAction("up")} onPointerUp={handleAction2("up")} onPointerCancel={handleAction2("up")} onLostPointerCapture={handleAction2("up")} onBlur={handleAction2("up")} onKeyDown={event => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            handleAction("up")(event);
          }
        }} onKeyUp={handleAction2("up")}>{"\u2191"}</button>}{<button type={"button"} aria-label={"Reverse"} disabled={phase !== "playing"} style={{
          ...options,
          background: "rgba(255, 107, 53, 0.2)",
          borderColor: "#ff6b35"
        }} onPointerDown={handleAction("down")} onPointerUp={handleAction2("down")} onPointerCancel={handleAction2("down")} onLostPointerCapture={handleAction2("down")} onBlur={handleAction2("down")} onKeyDown={event => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            handleAction("down")(event);
          }
        }} onKeyUp={handleAction2("down")}>{"\u2193"}</button>}</div>}</div>}{handleAction3()}</div> : <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#1a1a24"
  }} />;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

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
      for (const value9 of running.values()) value9.cancel();
      running.clear();
      return;
    }
    const targets = new Set();
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(item => targets.add(item));
      } catch {}
    }
    for (const value9 of document.querySelectorAll('p,span,div,label,text')) {
      if (value9.children.length || value9.closest('button,a,input,select,textarea,[role="button"]')) continue;
      const text = (value9.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 5 && text.length <= 140 && (copy.has(text.toLowerCase()) || !selectors.length && action.test(text))) targets.add(value9);
    }
    for (const value9 of targets) {
      if (running.has(value9) || typeof value9.animate !== 'function') continue;
      if ([...targets].some(child => child !== value9 && value9.contains(child))) continue;
      const style = getComputedStyle(value9);
      if (/breath/i.test(style.animationName)) continue;
      const base = style.filter.replace(/opacity\([^)]*\)/g, '').replace(/^none$/, '').trim();
      const filter = value11 => (base ? base + ' ' : '') + 'opacity(' + value11 + ')';
      const value10 = value9.animate([{
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
      running.set(value9, value10);
      if (document.hidden || !visible) value10.pause();
    }
  }
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  };
  const pause = () => {
    for (const value9 of running.values()) {
      if (document.hidden || !visible) {
        value9.pause();
      } else {
        value9.play();
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
    for (const value9 of running.values()) value9.cancel();
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
        "data-batch3-game": "60"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "60"
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
      const value9 = target.closest('button');
      return !!value9 && /^(Sand Art|Spinner)$/.test(value9.textContent.trim());
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
