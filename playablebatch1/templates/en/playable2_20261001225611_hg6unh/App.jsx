// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "TILT_SENSITIVITY",
    "kind": "number",
    "label": "Tilt Sensitivity",
    "value": 0.8,
    "default": 0.8,
    "min": 0.5,
    "max": 2.5,
    "step": 0.1
  }, {
    "id": "TRACK_WIDTH",
    "kind": "number",
    "label": "Track Width",
    "value": 90,
    "default": 90,
    "min": 50,
    "max": 150,
    "step": 5
  }, {
    "id": "BALL_MASS",
    "kind": "number",
    "label": "Ball Mass",
    "value": 1,
    "default": 1,
    "min": 0.5,
    "max": 3,
    "step": 0.1
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "Physics 2.0",
    "default": "Physics 2.0",
    "max_length": 20
  }, {
    "id": "TXT_TAP_START",
    "label": "Start Motion Button",
    "value": "Start Motion",
    "default": "Start Motion",
    "max_length": 30
  }, {
    "id": "TXT_DOUBLE_TAP",
    "label": "Calibrate Prompt",
    "value": "Double tap outside to reset",
    "default": "Double tap outside to reset",
    "max_length": 30
  }, {
    "id": "TXT_WIN",
    "label": "Win Text",
    "value": "STAGE CLEARED!",
    "default": "STAGE CLEARED!",
    "max_length": 20
  }, {
    "id": "TXT_LOSE",
    "label": "Lose Text",
    "value": "YOU FELL!",
    "default": "YOU FELL!",
    "max_length": 20
  }, {
    "id": "TXT_RESTART",
    "label": "Restart Button",
    "value": "PLAY AGAIN",
    "default": "PLAY AGAIN",
    "max_length": 20
  }],
  "images": [{
    "id": "BG_MAIN",
    "label": "Background",
    "path": "./assets/rolling_backdrop.svg",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "99278216753389841",
    "version_id": "99278216753423966",
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const GAME_STYLES = `
    @font-face { font-family:'Audiowide'; src:url('./assets/fonts/audiowide/Audiowide-Regular.woff2') format('woff2'); font-style:normal; font-weight:400; font-display:swap; }
    :root { --font-display:'Audiowide',sans-serif; --font-body:var(--font-display); --font-mono:var(--font-display); }
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.pendulum-guide{position:fixed!important;top:20%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root .pendulum-game::before{content:"";flex:0 0 calc(55.2 * var(--ui-unit) + 10px)}
html:root:root:root .pendulum-guide{padding:0!important}
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
function OI(config) {
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
function App() {
  const createElement = React.createElement;
  const root = React.useRef(null);
  const canvas = React.useRef(null);
  const audio = React.useRef(null);
  const model = React.useRef({
    speed: 1,
    color: "#47ff25",
    glow: true,
    rods: [{
      angle: Math.PI / 2 - 0.48,
      velocity: 0
    }, {
      angle: Math.PI / 2 + 0.34,
      velocity: 0
    }, {
      angle: Math.PI / 2 - 0.18,
      velocity: 0
    }],
    trail: [],
    pivot: {
      x: 0.5,
      y: 0.4
    },
    drag: null,
    lastTap: -1000000000,
    running: false
  });
  const [speed, setSpeed] = React.useState(1);
  const [color, setColor] = React.useState("#47ff25");
  const [glow, setGlow] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  const [panel, setPanel] = React.useState("");
  const [config, setConfig] = React.useState({});
  const [showGuide, setShowGuide] = React.useState(true);
  const swatches = ["#47ff25", "#21d6fa", "#ee62ff", "#ff4e70", "#ffcc30", "#ffffff", "#ff8c36", "#a879ff", "#57f2bb"];
  const icon = {
    speed: <svg width={22} height={22} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={2} strokeLinecap={"round"} strokeLinejoin={"round"} aria-hidden={"true"}>{<path d={"m13 2-9 11h7l-1 9 10-12h-7l1-8Z"} />}</svg>,
    brush: <svg width={22} height={22} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={2} strokeLinecap={"round"} strokeLinejoin={"round"} aria-hidden={"true"}>{<path d={"m14 4 6 6M13 5l-8 8 6 6 8-8-6-6ZM5 13c-2 2-2 5-3 7 2-1 5-1 7-3"} />}</svg>
  };
  const resetMotion = () => {
    const current = model.current;
    current.rods = [{
      angle: Math.PI / 2 - 0.48,
      velocity: 0
    }, {
      angle: Math.PI / 2 + 0.34,
      velocity: 0
    }, {
      angle: Math.PI / 2 - 0.18,
      velocity: 0
    }];
    current.trail = [];
    current.pivot = {
      x: 0.5,
      y: 0.4
    };
    current.drag = null;
    current.running = false;
    setRunning(false);
    setShowGuide(true);
  };
  model.current.speed = speed;
  model.current.color = color;
  model.current.glow = glow;
  React.useEffect(() => {
    let active = true;
    fetch("./game.config.json", {
      cache: "no-store"
    }).then(response => response.json()).then(data => {
      if (active) setConfig(OI(data));
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const getPoints = (value, otherValue, argument3) => {
    const value2 = otherValue * value.pivot.x;
    const value3 = argument3 * value.pivot.y;
    const length = Math.min(otherValue * 0.42, argument3 * 0.34) / 3;
    const points = [{
      x: value2,
      y: value3
    }];
    for (const value4 of value.rods) {
      const prev = points[points.length - 1];
      points.push({
        x: prev.x + Math.cos(value4.angle) * length,
        y: prev.y + Math.sin(value4.angle) * length
      });
    }
    return points;
  };
  React.useEffect(() => {
    const dimensions = canvas.current;
    const container = root.current;
    if (!dimensions || !container) return;
    const context = dimensions.getContext("2d", {
      alpha: false
    });
    let frame = 0;
    let value = 0;
    let value2 = 0;
    let value3 = 1;
    let last = performance.now();
    const resize = () => {
      const rect = container.getBoundingClientRect();
      value = rect.width;
      value2 = rect.height;
      value3 = Math.min(window.devicePixelRatio || 1, 3);
      dimensions.width = Math.max(1, Math.round(value * value3));
      dimensions.height = Math.max(1, Math.round(value2 * value3));
      dimensions.style.width = value + "px";
      dimensions.style.height = value2 + "px";
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();
    const draw = value4 => {
      frame = requestAnimationFrame(draw);
      if (!value || !value2) return;
      const value5 = Math.max(0, Math.min(40, value4 - last)) / 16.67;
      last = value4;
      const current = model.current;
      context.setTransform(value3, 0, 0, value3, 0, 0);
      context.fillStyle = "#000";
      context.fillRect(0, 0, value, value2);
      if (current.running && !current.drag) {
        current.rods.forEach((item, index) => {
          const anchor = index ? Math.sin(current.rods[index - 1].angle - item.angle) * 0.0035 : Math.sin(value4 * 0.0012) * 0.0018;
          item.velocity += (-Math.sin(item.angle - Math.PI / 2) * (0.006 + index * 0.001) + anchor) * value5;
          item.velocity *= Math.pow(0.9985, value5);
          item.angle += item.velocity * value5 * current.speed;
        });
      }
      const points = getPoints(current, value, value2);
      const point = points[3];
      if (current.running && !current.drag) {
        const previous = current.trail[current.trail.length - 1];
        if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 1.2) current.trail.push({
          ...point,
          age: 0
        });
      }
      if (current.trail.length > 175) current.trail.splice(0, current.trail.length - 175);
      for (const value6 of current.trail) value6.age += value5;
      current.trail = current.trail.filter(item => item.age < 210);
      if (current.trail.length > 1) {
        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        for (let value6 = 1; value6 < current.trail.length; value6++) {
          const point2 = current.trail[value6 - 1];
          const point3 = current.trail[value6];
          context.globalAlpha = Math.max(0, 0.7 - point3.age / 270);
          context.strokeStyle = current.color;
          context.lineWidth = 2.6;
          if (current.glow) {
            context.shadowColor = current.color;
            context.shadowBlur = 10;
          }
          context.beginPath();
          context.moveTo(point2.x, point2.y);
          context.lineTo(point3.x, point3.y);
          context.stroke();
        }
        context.restore();
      }
      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = current.color;
      context.lineWidth = 4;
      if (current.glow) {
        context.shadowColor = current.color;
        context.shadowBlur = 15;
      }
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let value6 = 1; value6 < points.length; value6++) context.lineTo(points[value6].x, points[value6].y);
      context.stroke();
      context.restore();
      points.forEach((point2, index) => {
        if (!current.running) {
          context.beginPath();
          context.arc(point2.x, point2.y, 19, 0, Math.PI * 2);
          context.strokeStyle = index === 0 ? "#ffffff55" : current.color + "66";
          context.lineWidth = 1.5;
          context.stroke();
        }
        context.beginPath();
        context.arc(point2.x, point2.y, index === 0 ? 11 : 12, 0, Math.PI * 2);
        context.fillStyle = index === 3 ? current.color : "#fff";
        context.fill();
        context.strokeStyle = "#111";
        context.lineWidth = 2;
        context.stroke();
        if (!current.running && index > 0) {
          context.fillStyle = index === 3 ? "#071607" : "#171717";
          context.font = "400 11px Audiowide,sans-serif";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(String(index), point2.x, point2.y + 0.5);
        }
      });
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, []);
  const pointerPosition = event => {
    const dimensions = canvas.current.getBoundingClientRect();
    return {
      x: event.clientX - dimensions.left,
      y: event.clientY - dimensions.top,
      w: dimensions.width,
      h: dimensions.height
    };
  };
  const distanceToSegment = (point, point2, point3) => {
    const value = point3.x - point2.x;
    const value2 = point3.y - point2.y;
    const length = value * value + value2 * value2;
    const value3 = length ? Math.max(0, Math.min(1, ((point.x - point2.x) * value + (point.y - point2.y) * value2) / length)) : 0;
    return Math.hypot(point.x - point2.x - value3 * value, point.y - point2.y - value3 * value2);
  };
  const onDown = event => {
    if (event.isPrimary === false || event.button > 0) return;
    const current = model.current;
    const timestamp = performance.now();
    const point = pointerPosition(event);
    const points = getPoints(current, point.w, point.h);
    let nearest = -1;
    let distance = Infinity;
    points.forEach((point2, index) => {
      const value = Math.hypot(point.x - point2.x, point.y - point2.y);
      if (value < distance) {
        distance = value;
        nearest = index;
      }
    });
    if (distance > 31) {
      nearest = -1;
      distance = Infinity;
      for (let value = 0; value < 3; value++) {
        const value2 = distanceToSegment(point, points[value], points[value + 1]);
        if (value2 < distance) {
          distance = value2;
          nearest = value + 1;
        }
      }
    }
    if (distance > 28 && nearest !== 0) {
      if (timestamp - current.lastTap < 330) {
        resetMotion();
        current.lastTap = -1000000000;
      } else current.lastTap = timestamp;
      return;
    }
    current.lastTap = -1000000000;
    setShowGuide(false);
    event.preventDefault();
    if (current.running) {
      current.running = false;
      setRunning(false);
    }
    current.drag = {
      joint: nearest,
      pointer: event.pointerId,
      start: {
        x: point.x,
        y: point.y
      },
      pivot: {
        ...current.pivot
      }
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove = event => {
    const current = model.current;
    const drag = current.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    const point = pointerPosition(event);
    if (drag.joint === 0) {
      current.pivot = {
        x: Math.max(40 / point.w, Math.min(1 - 40 / point.w, drag.pivot.x + (point.x - drag.start.x) / point.w)),
        y: Math.max(32 / point.h, Math.min(1 - 32 / point.h, drag.pivot.y + (point.y - drag.start.y) / point.h))
      };
      current.trail = [];
      return;
    }
    const points = getPoints(current, point.w, point.h);
    const index = drag.joint - 1;
    const anchor = points[index];
    const item = current.rods[index];
    let delta = Math.atan2(point.y - anchor.y, point.x - anchor.x) - item.angle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    for (let value = index; value < current.rods.length; value++) {
      current.rods[value].angle += delta;
      current.rods[value].velocity = 0;
    }
    current.trail = [];
  };
  const onUp = event => {
    const current = model.current;
    if (current.drag && current.drag.pointer === event.pointerId) current.drag = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const playClick = starting => {
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      const value = audio.current || (audio.current = new AudioCtor());
      if (value.state === "suspended") value.resume().catch(() => {});
      const currentTime = value.currentTime;
      const oscillator = value.createOscillator();
      const gain = value.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(starting ? 440 : 290, currentTime);
      if (starting) oscillator.frequency.exponentialRampToValueAtTime(660, currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.18);
      oscillator.connect(gain).connect(value.destination);
      oscillator.start(currentTime);
      oscillator.stop(currentTime + 0.2);
    } catch {}
  };
  const toggleMotion = () => {
    const current = model.current;
    setShowGuide(false);
    if (current.running) {
      current.running = false;
      setRunning(false);
      playClick(false);
      return;
    }
    current.drag = null;
    current.trail = [];
    current.rods.forEach((item, index) => {
      item.velocity += (index % 2 === 0 ? 1 : -1) * (0.027 + index * 0.006);
    });
    current.running = true;
    setRunning(true);
    setPanel("");
    playClick(true);
  };
  const panelButton = (kind, label) => <button type={"button"} className={"pendulum-tool"} aria-label={label} aria-expanded={panel === kind} aria-controls={"pendulum-options"} onClick={() => setPanel(panel === kind ? "" : kind)} style={{
    background: panel === kind ? "#263b28" : "#151b2a",
    color: panel === kind ? "#50ff3a" : "#eee"
  }}>{icon[kind]}</button>;
  const actionStyle = {
    minHeight: 44,
    minWidth: 0,
    padding: "8px 12px",
    border: "1px solid #555",
    borderRadius: 10,
    background: "#292929",
    color: "#fff",
    fontSize: 16,
    cursor: "pointer",
    touchAction: "manipulation"
  };
  const cardHeading = label => <div style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 12
  }}>{<strong>{label}</strong>}{<button type={"button"} onClick={() => setPanel("")} style={actionStyle} aria-label={"Close " + label + " options"}>{"Done"}</button>}</div>;
  let card = null;
  if (panel === "speed") card = <section id={"pendulum-options"} className={"pendulum-options"} aria-label={"Motion speed"}>{cardHeading("Speed")}{<label htmlFor={"pendulum-speed"} style={{
      display: "block",
      marginBottom: 8
    }}>{"Speed: " + speed.toFixed(1) + "×"}</label>}{<input id={"pendulum-speed"} type={"range"} min={0.2} max={3} step={0.1} value={speed} onChange={value => setSpeed(Number(value.target.value))} style={{
      width: "100%",
      height: 44,
      accentColor: color,
      touchAction: "auto"
    }} />}{<div style={{
      display: "flex",
      gap: 8,
      marginTop: 8
    }}>{<button type={"button"} onClick={() => setSpeed(1)} style={{
        ...actionStyle,
        flex: 1
      }}>{"1×"}</button>}{<button type={"button"} onClick={() => {
        setSpeed(1);
        resetMotion();
      }} style={{
        ...actionStyle,
        flex: 1
      }}>{"Reset"}</button>}</div>}</section>;
  if (panel === "brush") card = <section id={"pendulum-options"} className={"pendulum-options"} aria-label={"Color and glow"}>{cardHeading("Color")}{<div style={{
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 8
    }}>{swatches.map(background => <button key={background} type={"button"} aria-label={"Select " + background + " color"} aria-pressed={color === background} onClick={() => setColor(background)} style={{
        height: 44,
        borderRadius: 10,
        border: color === background ? "3px solid #fff" : "2px solid #777",
        background: background,
        cursor: "pointer",
        touchAction: "manipulation"
      }} />)}</div>}{<button type={"button"} aria-pressed={glow} onClick={() => setGlow(!glow)} style={{
      ...actionStyle,
      width: "100%",
      marginTop: 12,
      background: glow ? "#244a27" : "#292929"
    }}>{"Glow " + (glow ? "On" : "Off")}</button>}</section>;
  return <main className={"pendulum-game"} onKeyDown={event => {
    if (event.key === "Escape") setPanel("");
  }}>{<style>{`
      :root{--ui-unit:min(0.2564102564vw,0.1672240803vh)}
      html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#000}
      .pendulum-game,.pendulum-game *{box-sizing:border-box}
      .pendulum-game{position:relative;isolation:isolate;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;background:#000;color:#fff;font-family:var(--font-display);font-weight:400}
      .pendulum-guide{flex:0 0 auto;min-height:calc(56 * var(--ui-unit));margin:0;padding:calc(30 * var(--ui-unit) + env(safe-area-inset-top)) calc(30 * var(--ui-unit)) 10px;text-align:center;font-size:calc(18 * var(--ui-unit));line-height:1.4;color:#d1d5df;pointer-events:none}
      .pendulum-stage{position:relative;flex:1;min-height:0;margin:0 calc(30 * var(--ui-unit) + env(safe-area-inset-right)) 0 calc(30 * var(--ui-unit) + env(safe-area-inset-left));overflow:hidden}
      .pendulum-stage canvas{position:absolute;inset:0;display:block;touch-action:none}
      .pendulum-actions{position:relative;z-index:2;flex:0 0 auto;display:flex;align-items:stretch;gap:8px;padding:12px calc(30 * var(--ui-unit) + env(safe-area-inset-right)) calc(50 * var(--ui-unit) + env(safe-area-inset-bottom)) calc(30 * var(--ui-unit) + env(safe-area-inset-left))}
      .pendulum-game :is(button,input,label,strong,output){font-family:inherit;font-weight:400}
      .pendulum-game button{cursor:pointer;touch-action:manipulation}
      .pendulum-game button:focus-visible,.pendulum-game input:focus-visible{outline:3px solid #fff;outline-offset:3px}
      .pendulum-tool{width:48px;min-height:48px;flex:0 0 48px;border:1px solid #555;border-radius:12px;display:grid;place-items:center}
      .pendulum-start{flex:1;min-width:0;min-height:48px;padding:10px 8px;border:1px solid #74ff60;border-radius:12px;background:#43e530;color:#062406;font-size:calc(18 * var(--ui-unit));font-weight:400;line-height:1.3;overflow-wrap:anywhere}
      .pendulum-start[aria-pressed="true"]{background:#152319;color:#d8ffcf}
      .pendulum-game button:active{filter:brightness(.86)}
      .pendulum-options{position:absolute;z-index:3;bottom:calc(50 * var(--ui-unit) + env(safe-area-inset-bottom) + 72px);left:calc(30 * var(--ui-unit) + env(safe-area-inset-left));right:calc(30 * var(--ui-unit) + env(safe-area-inset-right));padding:14px;border:1px solid #555;border-radius:16px;background:#151b2a;box-shadow:0 12px 30px #000a;font-size:16px;line-height:1.4;max-height:calc(100% - 30 * var(--ui-unit) - env(safe-area-inset-top) - 50 * var(--ui-unit) - env(safe-area-inset-bottom) - 84px);overflow-y:auto}
    `}</style>}{<p className={"pendulum-guide"} style={{
      visibility: showGuide && !panel ? "visible" : "hidden"
    }} aria-hidden={!showGuide || !!panel}>{"Adjust the joints, then start"}</p>}{<div ref={root} className={"pendulum-stage"}>{<canvas ref={canvas} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-label={"Single articulated pendulum arm. Drag pivot or numbered joints to tune each segment before starting motion."} />}</div>}{card}{<footer className={"pendulum-actions"}>{panelButton("speed", "Speed")}{panelButton("brush", "Color and glow")}{<button type={"button"} className={"pendulum-start"} onClick={toggleMotion} aria-pressed={running}>{running ? "Pause Motion" : config.TXT_TAP_START || "Start Motion"}</button>}</footer>}</main>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
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
  const selectors = ["p.pendulum-guide"];
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

// Game helper

/* Batch 3 entry polish. Preview covers are still images in the feed. */
(() => {
  'use strict';

  const number = Number({
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "",
        "data-batch3-game": "38"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "38"
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
