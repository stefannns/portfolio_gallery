// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import Matter from 'matter-js';
import * as Tone from 'tone';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "CASH_PER_BOUNCE",
    "kind": "number",
    "label": "Cash Per Bounce",
    "value": 1,
    "default": 1,
    "min": 1,
    "max": 100,
    "step": 1
  }, {
    "id": "INITIAL_BALL_COST",
    "kind": "number",
    "label": "Initial Ball Cost",
    "value": 1,
    "default": 1,
    "min": 1,
    "max": 10,
    "step": 1
  }, {
    "id": "COST_INCREMENT",
    "kind": "number",
    "label": "Cost Increment per Ball",
    "value": 1,
    "default": 1,
    "min": 1,
    "max": 50,
    "step": 1
  }, {
    "id": "SPEED_MULTIPLIER",
    "kind": "number",
    "label": "Bounce Speed Multiplier",
    "value": 1.03,
    "default": 1.03,
    "min": 1,
    "max": 1.5,
    "step": 0.01
  }, {
    "id": "MAX_SPEED",
    "kind": "number",
    "label": "Max Ball Speed",
    "value": 13,
    "default": 13,
    "min": 10,
    "max": 30,
    "step": 1
  }],
  "texts": [{
    "id": "TEXT_CASH_EARNED",
    "label": "Cash Earned Label",
    "value": "CASH EARNED",
    "default": "CASH EARNED",
    "max_length": 20
  }, {
    "id": "BTN_ADD_BALL",
    "label": "Add Ball Button Text",
    "value": "ADD BALL",
    "default": "ADD BALL",
    "max_length": 15
  }, {
    "id": "TEXT_DRAW_HINT",
    "label": "Draw Hint Text",
    "value": "DRAW CIRCLES TO TRAP BALLS",
    "default": "DRAW CIRCLES TO TRAP BALLS",
    "max_length": 40
  }],
  "images": [],
  "config_version": "2.0",
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 1
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

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root #root#root#root>div>div>div:has(>button)>div{position:fixed!important;top:50%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html[data-guide-action-used="true"]:root:root:root #root#root#root>div>div>div:has(>button)>div{visibility:hidden!important;opacity:0!important}
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
// Preserve the original fallback when the configuration cannot be fetched.
for (const value2 of ['playable-inline-config', 'playable-config-inline']) {
  const node = document.createElement('script');
  node.id = value2;
  node.type = 'application/json';
  node.textContent = JSON.stringify(DEFAULT_CONFIG);
  document.body.append(node);
}
document.documentElement.lang = 'en';
function tC(config) {
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
var value = `
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
  --color-bg: #0b0c10;
  --color-neon-green: #45f3ff;
  --color-cash: #4ade80;
  --color-panel: #1f2833;
  --color-text-dim: #c5c6c7;
}
html, body, #root { 
  width: 100%; height: 100%; margin: 0; padding: 0; 
  overflow: hidden; background-color: var(--color-bg); 
  user-select: none; -webkit-user-select: none;
  touch-action: none; font-family: var(--font-body);
}
* { box-sizing: border-box; }
`;
var transport = Tone.getContext().transport;
var items = ["#ff2a6d", "#05d9e8", "#01ffc3", "#7b2cbf", "#f8961e"];
function GameNC({
  cfg: c
}) {
  let elementRef = React.useRef(null);
  let elementRef2 = React.useRef(null);
  let stateRef = React.useRef(null);
  let stateRef2 = React.useRef(null);
  let stateRef3 = React.useRef({});
  let stateRef4 = React.useRef([]);
  let y = React.useRef(0);
  let stateRef5 = React.useRef({
    active: !1,
    cx: 0,
    cy: 0,
    radius: 0
  });
  let z = React.useRef(!1);
  let stateRef6 = React.useRef(null);
  let stateRef7 = React.useRef(null);
  let [count, setCount] = React.useState(0);
  let [currentValue, setCurrentValue] = React.useState(c.INITIAL_BALL_COST);
  let handleAction = async () => {
    if (!z.current) try {
      await Tone.start();
      stateRef6.current = new Tone.PolySynth(Tone.Synth, {
        oscillator: {
          type: "sine"
        },
        envelope: {
          attack: 0.01,
          decay: 0.3,
          sustain: 0,
          release: 0.1
        }
      }).toDestination();
      stateRef6.current.volume.value = -8;
      let instrument = new Tone.FMSynth({
        harmonicity: 0.5,
        modulationIndex: 1.2,
        oscillator: {
          type: "sine"
        },
        envelope: {
          attack: 0.1,
          decay: 0.2,
          sustain: 1,
          release: 0.5
        },
        modulation: {
          type: "square"
        }
      }).toDestination();
      instrument.volume.value = -18;
      let sequence = new Tone.Sequence((value2, otherValue) => {
        instrument.triggerAttackRelease(otherValue, "8n", value2);
      }, ["C3", "G3", "Bb3", "F3", "Eb3", "G3", "C4", "Bb3"], "4n");
      transport.bpm.value = 100;
      transport.start();
      sequence.start(0);
      stateRef7.current = sequence;
      z.current = !0;
    } catch (value2) {
      console.warn("Audio init failed", value2);
    }
  };
  let callback = React.useCallback(() => {
    if (!z.current || !stateRef6.current) return;
    let timestamp = Tone.now();
    let items2 = ["C5", "D5", "E5", "G5", "A5"];
    let item = items2[Math.floor(Math.random() * items2.length)];
    stateRef6.current.triggerAttackRelease(item, "16n", timestamp);
  }, []);
  let callback2 = React.useCallback((value2, otherValue) => {
    if (!stateRef.current) return;
    let BALL_RADIUS = c.BALL_RADIUS;
    let value3 = Matter.Bodies.circle(value2, otherValue, BALL_RADIUS, {
      restitution: 1,
      friction: 0,
      frictionStatic: 0,
      frictionAir: 0,
      density: 0.05,
      label: "ball",
      render: {
        fillStyle: "var(--color-neon-green)"
      }
    });
    Matter.Body.setVelocity(value3, {
      x: (Math.random() - 0.5) * 4.25,
      y: 1.7
    });
    Matter.Composite.add(stateRef.current.world, value3);
  }, [c]);
  let callback3 = React.useCallback(() => {
    let current = elementRef.current;
    if (!current || !stateRef.current) return;
    let clientWidth = current.clientWidth;
    let clientHeight = current.clientHeight;
    let BALL_RADIUS = c.BALL_RADIUS;
    let value2 = BALL_RADIUS + 24;
    let value3 = Math.max(value2, clientWidth - BALL_RADIUS - 24);
    let value4 = Math.min(clientHeight - BALL_RADIUS - 24, Math.max(BALL_RADIUS + 24, 120));
    let value5 = Math.max(value4, clientHeight - BALL_RADIUS - 150);
    let x = Matter.Composite.allBodies(stateRef.current.world);
    let value6 = x.filter(item => item.label === "ball");
    let point = {
      x: (value2 + value3) / 2,
      y: (value4 + value5) / 2,
      clearance: -1 / 0
    };
    for (let value7 = 0; value7 < 40; value7++) {
      let value8 = value2 + Math.random() * (value3 - value2);
      let value9 = value4 + Math.random() * (value5 - value4);
      let clearance = Math.min(...stateRef4.current.map(item => Math.abs(Math.hypot(value8 - item.position.x, value9 - item.position.y) - item.circleRadius) - BALL_RADIUS), ...value6.map(item => Math.hypot(value8 - item.position.x, value9 - item.position.y) - BALL_RADIUS * 2), 1 / 0);
      if (clearance > point.clearance && (point = {
        x: value8,
        y: value9,
        clearance: clearance
      }), clearance > 18) break;
    }
    callback2(point.x, point.y);
  }, [c, callback2]);
  let handleClick = () => {
    handleAction();
    if (y.current >= currentValue) {
      y.current -= currentValue;
      setCount(Math.floor(y.current));
      setCurrentValue(value2 => value2 + c.COST_INCREMENT);
      callback3();
    }
  };
  React.useEffect(() => {
    let current = elementRef.current;
    let dimensions = elementRef2.current;
    if (!current || !dimensions || !c) return;
    let value2 = Matter.Engine.create();
    value2.gravity.y = c.BASE_GRAVITY || 0.85;
    stateRef.current = value2;
    let options = {
      top: Matter.Bodies.rectangle(0, -50, 100, 100, {
        isStatic: !0
      }),
      bottom: Matter.Bodies.rectangle(0, 0, 100, 100, {
        isStatic: !0
      }),
      left: Matter.Bodies.rectangle(-50, 0, 100, 100, {
        isStatic: !0
      }),
      right: Matter.Bodies.rectangle(0, 0, 100, 100, {
        isStatic: !0
      })
    };
    Matter.Composite.add(value2.world, Object.values(options));
    stateRef3.current = options;
    let value3 = 0;
    let value4 = 0;
    let value5 = 1;
    let handleAction2 = () => {
      value3 = current.clientWidth;
      value4 = current.clientHeight;
      value5 = window.devicePixelRatio || 1;
      dimensions.width = value3 * value5;
      dimensions.height = value4 * value5;
      Matter.Body.setPosition(options.top, {
        x: value3 / 2,
        y: -50
      });
      Matter.Body.setVertices(options.top, Matter.Bodies.rectangle(value3 / 2, -50, value3 * 2, 100).vertices);
      Matter.Body.setPosition(options.bottom, {
        x: value3 / 2,
        y: value4 + 50
      });
      Matter.Body.setVertices(options.bottom, Matter.Bodies.rectangle(value3 / 2, value4 + 50, value3 * 2, 100).vertices);
      Matter.Body.setPosition(options.left, {
        x: -50,
        y: value4 / 2
      });
      Matter.Body.setVertices(options.left, Matter.Bodies.rectangle(-50, value4 / 2, 100, value4 * 2).vertices);
      Matter.Body.setPosition(options.right, {
        x: value3 + 50,
        y: value4 / 2
      });
      Matter.Body.setVertices(options.right, Matter.Bodies.rectangle(value3 + 50, value4 / 2, 100, value4 * 2).vertices);
    };
    let x = new ResizeObserver(handleAction2);
    x.observe(current);
    handleAction2();
    callback3();
    Matter.Events.on(value2, "collisionStart", value8 => {
      let value9 = !1;
      value8.pairs.forEach(item => {
        let {
          bodyA: value10,
          bodyB: value11
        } = item;
        let value12 = value10.label === "ball";
        let value13 = value11.label === "ball";
        let value14 = value10.label === "ringWall";
        let value15 = value11.label === "ringWall";
        if (value12 && value15 || value13 && value14) {
          value9 = !0;
          let value16 = value12 ? value10 : value11;
          let velocity = value16.velocity;
          let value17 = Matter.Vector.magnitude(velocity);
          if (value17 > 0.1 && value17 < c.MAX_SPEED) {
            let value18 = Math.min(value17 * c.SPEED_MULTIPLIER, c.MAX_SPEED);
            let value19 = Matter.Vector.normalise(velocity);
            Matter.Body.setVelocity(value16, Matter.Vector.mult(value19, value18));
          }
        }
      });
      if (value9) {
        y.current += c.CASH_PER_BOUNCE;
        callback();
      }
    });
    let context = dimensions.getContext("2d", {
      alpha: !1
    });
    let timestamp = performance.now();
    let value6 = 0;
    let value7 = 1000 / 60;
    let handleAction3 = () => {
      Matter.Engine.update(value2, value7);
      for (const value8 of Matter.Composite.allBodies(value2.world).filter(item => item.label === "ball")) {
        const value9 = Matter.Vector.magnitude(value8.velocity);
        if (value8.restFrames = value9 < 2 ? (value8.restFrames || 0) + 1 : 0, value8.restFrames >= 30) {
          const value10 = value8.position.x < value3 / 2 ? 1 : -1;
          Matter.Body.setVelocity(value8, {
            x: value10 * Math.min(2.4, c.MAX_SPEED * 0.35),
            y: -Math.min(7, c.MAX_SPEED * 0.85)
          });
          value8.restFrames = 0;
        }
      }
    };
    let handleAction4 = value8 => {
      stateRef2.current = requestAnimationFrame(handleAction4);
      let value9 = Math.max(0, value8 - timestamp);
      for (value9 > 100 && (value9 = value7), timestamp = value8, value6 += value9; value6 + 1e-7 >= value7;) {
        handleAction3();
        value6 -= value7;
      }
      if (Math.floor(y.current) !== count) {
        setCount(Math.floor(y.current));
      }
      context.save();
      context.scale(value5, value5);
      context.fillStyle = "#0b0c10";
      context.fillRect(0, 0, value3, value4);
      let value10 = Matter.Composite.allBodies(value2.world);
      value10.filter(item => item.label === "obstacle").forEach(item => {
        context.beginPath();
        context.arc(item.position.x, item.position.y, item.circleRadius, 0, 2 * Math.PI);
        context.strokeStyle = item.render.strokeStyle || "#fff";
        context.lineWidth = 3;
        context.shadowBlur = 15;
        context.shadowColor = item.render.strokeStyle;
        context.stroke();
        context.fillStyle = item.render.strokeStyle;
        context.globalAlpha = 0.1;
        context.fill();
        context.globalAlpha = 1;
        context.shadowBlur = 0;
      });
      let current2 = stateRef5.current;
      if (current2.active && current2.radius > 5) {
        context.beginPath();
        context.arc(current2.cx, current2.cy, current2.radius, 0, 2 * Math.PI);
        context.setLineDash([5, 5]);
        context.strokeStyle = "rgba(255,255,255,0.5)";
        context.lineWidth = 2;
        context.stroke();
        context.setLineDash([]);
      }
      value10.filter(item => item.label === "ball").forEach(item => {
        context.beginPath();
        context.arc(item.position.x, item.position.y, item.circleRadius, 0, 2 * Math.PI);
        context.fillStyle = "#45f3ff";
        context.shadowBlur = 20;
        context.shadowColor = "#45f3ff";
        context.fill();
        context.shadowBlur = 0;
      });
      context.restore();
    };
    stateRef2.current = requestAnimationFrame(handleAction4);
    return () => {
      x.disconnect();
      cancelAnimationFrame(stateRef2.current);
      Matter.World.clear(value2.world, !1);
      Matter.Engine.clear(value2);
    };
  }, [c, callback2, callback]);
  let handlePointerDown = event => {
    if (event.isPrimary === !1 || event.button !== 0 || stateRef5.current.active) return;
    handleAction();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    let bounds = elementRef2.current.getBoundingClientRect();
    let value2 = event.clientX - bounds.left;
    let value3 = event.clientY - bounds.top;
    stateRef5.current = {
      active: !0,
      cx: value2,
      cy: value3,
      radius: 0,
      pointerId: event.pointerId
    };
  };
  let handlePointerMove = event => {
    let event2 = stateRef5.current;
    if (!event2.active || event.isPrimary === !1 || event.pointerId !== event2.pointerId) return;
    let bounds = elementRef2.current.getBoundingClientRect();
    let value2 = event.clientX - bounds.left;
    let value3 = event.clientY - bounds.top;
    let value4 = value2 - event2.cx;
    let value5 = value3 - event2.cy;
    event2.radius = Math.sqrt(value4 * value4 + value5 * value5);
  };
  let handlePointerUp = event => {
    if (!stateRef5.current.active || event.isPrimary === !1 || event.pointerId !== stateRef5.current.pointerId) return;
    handlePointerMove(event);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    let current = stateRef5.current;
    if (current.active && (current.active = !1, current.radius > 10 && stateRef.current)) {
      let strokeStyle = items[stateRef4.current.length % items.length];
      let value2 = Matter.Bodies.circle(current.cx, current.cy, current.radius, {
        isStatic: !0,
        isSensor: !0,
        label: "obstacle",
        render: {
          strokeStyle: strokeStyle
        }
      });
      let items2 = [value2];
      let value3 = 24;
      let value4 = Math.max(8, Math.min(14, current.radius * 0.13));
      let radius = current.radius;
      for (let x = 0; x < value3; x++) {
        let value5 = x / value3 * Math.PI * 2;
        let value6 = (x + 1) / value3 * Math.PI * 2;
        let value7 = (value5 + value6) / 2;
        let value8 = 2 * radius * Math.sin((value6 - value5) / 2) + 2;
        let value9 = radius - value4 / 2;
        let value10 = Matter.Bodies.rectangle(current.cx + Math.cos(value7) * value9, current.cy + Math.sin(value7) * value9, value8, value4, {
          isStatic: !0,
          angle: value7 + Math.PI / 2,
          restitution: 1,
          friction: 0,
          frictionStatic: 0,
          label: "ringWall"
        });
        items2.push(value10);
      }
      Matter.Composite.add(stateRef.current.world, items2);
      stateRef4.current.push(value2);
    }
  };
  return <div ref={elementRef} style={{
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column"
  }}>{<div style={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      padding: "calc(30px + env(safe-area-inset-top, 0px)) 30px 0",
      zIndex: 10,
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      pointerEvents: "none"
    }}>{<div style={{
        fontFamily: "var(--font-display)",
        fontSize: "28px",
        fontWeight: 700,
        color: "var(--color-cash)",
        lineHeight: 1,
        textShadow: "0 0 20px rgba(74, 222, 128, 0.5)"
      }}>{"$"}{count.toLocaleString(c.LANG || "en")}</div>}{null}</div>}{<canvas ref={elementRef2} style={{
      flex: 1,
      width: "100%",
      height: "100%",
      display: "block",
      touchAction: "none"
    }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={event => {
      if (event.pointerId === stateRef5.current.pointerId) {
        stateRef5.current.active = !1;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }
    }} />}{<div style={{
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      padding: "16px 30px calc(50px + env(safe-area-inset-bottom, 0px))",
      zIndex: 10,
      display: "flex",
      alignItems: "center",
      gap: "16px",
      pointerEvents: "none"
    }}>{<button onClick={handleClick} style={{
        position: "fixed",
        top: "calc(30px + env(safe-area-inset-top, 0px))",
        right: "30px",
        pointerEvents: "auto",
        flex: "0 0 auto",
        background: y.current >= currentValue ? "var(--color-panel)" : "rgba(31, 40, 51, 0.5)",
        border: `1px solid ${y.current >= currentValue ? "var(--color-text-dim)" : "transparent"}`,
        borderRadius: "12px",
        padding: "8px 12px",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        minWidth: 0,
        minHeight: "44px",
        whiteSpace: "nowrap",
        lineHeight: 1.2,
        cursor: "pointer",
        transition: "all 0.2s",
        opacity: y.current >= currentValue ? 1 : 0.6
      }}>{<span style={{
          fontFamily: "var(--font-display)",
          fontSize: "12px",
          fontWeight: 700,
          color: "var(--color-text-dim)",
          textTransform: "uppercase",
          marginBottom: 0
        }}>{c.BTN_ADD_BALL}</span>}{<span style={{
          fontFamily: "var(--font-display)",
          fontSize: "14px",
          fontWeight: 700,
          color: "#fff"
        }}>{"$"}{currentValue}</span>}</button>}{<div style={{
        flex: 1,
        fontFamily: "var(--font-body)",
        fontSize: "18px",
        color: "#e2e8f0",
        fontStyle: "normal",
        textShadow: "0 2px 4px rgba(0,0,0,0.5)",
        lineHeight: 1.2
      }}>{"Draw circles to trap balls"}</div>}</div>}</div>;
}
function App() {
  let [currentValue, setCurrentValue] = React.useState(null);
  React.useEffect(() => {
    let value2 = !0;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value3 = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (value3.ok) {
          options = await value3.json();
        }
      } catch {
        console.warn("Config load failed, using defaults");
      }
      if (value2) {
        let config = tC(options);
        setCurrentValue({
          LANG: "en",
          BASE_GRAVITY: 0.85,
          BALL_RADIUS: 10,
          CASH_PER_BOUNCE: config.CASH_PER_BOUNCE || 1,
          INITIAL_BALL_COST: config.INITIAL_BALL_COST || 1,
          COST_INCREMENT: config.COST_INCREMENT || 1,
          SPEED_MULTIPLIER: config.SPEED_MULTIPLIER || 1.03,
          MAX_SPEED: config.MAX_SPEED || 13,
          TEXT_CASH_EARNED: config.TEXT_CASH_EARNED || "CASH EARNED",
          BTN_ADD_BALL: config.BTN_ADD_BALL || "ADD BALL",
          TEXT_DRAW_HINT: config.TEXT_DRAW_HINT || "DRAW CIRCLES TO TRAP BALLS",
          ...config
        });
      }
    })();
    return () => {
      value2 = !1;
    };
  }, []);
  return currentValue ? <React.Fragment>{<style>{value}</style>}{<div style={{
      width: "100%",
      height: "100%",
      containerType: "size"
    }}>{<GameNC cfg={currentValue} />}</div>}</React.Fragment> : <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#0b0c10"
  }} />;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./guide-lifecycle.js
/* Game-owned copy dismissal only: no synthetic input, progress or physics writes. */
(() => {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "",
        "data-guide-lifecycle": "20261021",
        "defer": null,
        "src": "./guide-lifecycle.js?v=b0390ebbbaa6",
        "data-action-root": "#root>div>div>canvas"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "guideLifecycle": "20261021",
      "actionRoot": "#root>div>div>canvas"
    }
  };
  const actionRoot = script?.dataset.actionRoot;
  if (!actionRoot) return;
  const arrowButtons = script.dataset.arrowButtons || '';
  const ignored = script.dataset.ignore || '';
  const arrowKeys = script.dataset.arrowKeys === 'true';
  const html = document.documentElement;
  const hosted = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !hosted;
  let used = false;
  const element = target => target && typeof target.closest === 'function' ? target : null;
  const unrelated = target => !!target.closest('input,select,textarea,a,[contenteditable="true"],[role="button"],[data-settings]');
  function dismiss() {
    if (used) return;
    used = true;
    html.setAttribute('data-guide-action-used', 'true');
  }
  function pointer(event) {
    if (!active || used || event.isTrusted === false || event.isPrimary === false || event.button != null && event.button !== 0) return;
    const target = element(event.target);
    if (!target || unrelated(target) || ignored && target.closest(ignored)) return;
    const arrow = arrowButtons && target.closest(arrowButtons);
    if (target.closest('button') && !arrow) return;
    if (arrow || target.closest(actionRoot)) dismiss();
  }
  function key(event) {
    if (!arrowKeys || !active || used || event.isTrusted === false || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const target = element(event.target);
    if (target && (unrelated(target) || target.closest('input,select,textarea,button'))) return;
    dismiss();
  }
  function message(event) {
    if (!hosted || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
  }
  document.addEventListener('pointerdown', pointer, {
    capture: true,
    passive: true
  });
  if (arrowKeys) document.addEventListener('keydown', key, {
    capture: true,
    passive: true
  });
  addEventListener('message', message);
  addEventListener('pagehide', () => {
    document.removeEventListener('pointerdown', pointer, true);
    document.removeEventListener('keydown', key, true);
    removeEventListener('message', message);
  }, {
    once: true
  });
})();

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
  const selectors = ["#root>div>div>div:has(>button)>div"];
  const copy = new Set(["DRAW CIRCLES TO TRAP BALLS"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
      for (const value2 of running.values()) value2.cancel();
      running.clear();
      return;
    }
    const targets = new Set();
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(item => targets.add(item));
      } catch {}
    }
    for (const value2 of document.querySelectorAll('p,span,div,label,text')) {
      if (value2.children.length || value2.closest('button,a,input,select,textarea,[role="button"]')) continue;
      const text = (value2.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 5 && text.length <= 140 && (copy.has(text.toLowerCase()) || !selectors.length && action.test(text))) targets.add(value2);
    }
    for (const value2 of targets) {
      if (running.has(value2) || typeof value2.animate !== 'function') continue;
      if ([...targets].some(child => child !== value2 && value2.contains(child))) continue;
      const style = getComputedStyle(value2);
      if (/breath/i.test(style.animationName)) continue;
      const base = style.filter.replace(/opacity\([^)]*\)/g, '').replace(/^none$/, '').trim();
      const filter = value4 => (base ? base + ' ' : '') + 'opacity(' + value4 + ')';
      const value3 = value2.animate([{
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
      running.set(value2, value3);
      if (document.hidden || !visible) value3.pause();
    }
  }
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  };
  const pause = () => {
    for (const value2 of running.values()) {
      if (document.hidden || !visible) {
        value2.pause();
      } else {
        value2.play();
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
    for (const value2 of running.values()) value2.cancel();
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
        "data-batch3-game": "25"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "25"
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
      const value2 = target.closest('button');
      return !!value2 && /^(Sand Art|Spinner)$/.test(value2.textContent.trim());
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
