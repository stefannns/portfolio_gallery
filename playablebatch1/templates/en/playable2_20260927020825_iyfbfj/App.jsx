// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [
    {
      "id": "BASE_POINT_VALUE",
      "kind": "number",
      "label": "Base Point Value",
      "value": 0.05,
      "default": 0.05,
      "min": 0.01,
      "max": 0.5,
      "step": 0.01
    },
    {
      "id": "COST_BASE_AXES",
      "kind": "number",
      "label": "Axes Upgrade Base Cost",
      "value": 50,
      "default": 50,
      "min": 10,
      "max": 500,
      "step": 10
    },
    {
      "id": "COST_BASE_BRUSH",
      "kind": "number",
      "label": "Brush Upgrade Base Cost",
      "value": 30,
      "default": 30,
      "min": 10,
      "max": 500,
      "step": 10
    },
    {
      "id": "COST_BASE_MULT",
      "kind": "number",
      "label": "Multiplier Upgrade Base Cost",
      "value": 100,
      "default": 100,
      "min": 10,
      "max": 1000,
      "step": 10
    },
    {
      "id": "COST_RAINBOW",
      "kind": "number",
      "label": "Rainbow Brush Unlock Cost",
      "value": 75,
      "default": 75,
      "min": 10,
      "max": 500,
      "step": 5
    }
  ],
  "texts": [
    {
      "id": "LANG_CODE",
      "label": "Language Code (Internal)",
      "value": "en",
      "default": "en",
      "max_length": 5
    },
    {
      "id": "TXT_BALANCE",
      "label": "Balance Label",
      "value": "BALANCE",
      "default": "BALANCE",
      "max_length": 15
    },
    {
      "id": "TXT_SELL",
      "label": "Sell Button Text",
      "value": "SELL ART",
      "default": "SELL ART",
      "max_length": 20
    },
    {
      "id": "TXT_SHOP",
      "label": "Shop Title",
      "value": "Upgrades",
      "default": "Upgrades",
      "max_length": 20
    },
    {
      "id": "TXT_DRAG_HINT",
      "label": "Canvas Hint Text",
      "value": "Drag to create magic",
      "default": "Drag to create magic",
      "max_length": 30
    },
    {
      "id": "TXT_UPGRADE_AXES",
      "label": "Upgrade Axes Text",
      "value": "More Symmetry",
      "default": "More Symmetry",
      "max_length": 20
    },
    {
      "id": "TXT_UPGRADE_BRUSH",
      "label": "Upgrade Brush Text",
      "value": "Thicker Brush",
      "default": "Thicker Brush",
      "max_length": 20
    },
    {
      "id": "TXT_UPGRADE_MULT",
      "label": "Upgrade Multiplier Text",
      "value": "Higher Value",
      "default": "Higher Value",
      "max_length": 20
    },
    {
      "id": "TXT_UPGRADE_RAINBOW",
      "label": "Rainbow Upgrade Text",
      "value": "Rainbow Brush",
      "default": "Rainbow Brush",
      "max_length": 25
    }
  ],
  "images": [
    {
      "id": "BG_MAIN_REF",
      "label": "Active Button Background Reference",
      "path": "./assets/bg_main_clean.svg",
      "replaceable": true
    }
  ],
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
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
    /* Iteration repair: stop the resize loop from recursively shrinking the drawing surface. */
    canvas {
      width: min(76vw, 480px) !important;
      height: min(76vw, 480px) !important;
      aspect-ratio: 1 / 1 !important;
    }
    /* Keep the empty Sell state visibly solid while retaining a muted disabled treatment. */
    button.sell-art-button {
      opacity: 1 !important;
    }
    button.sell-art-button[style*="background: var(--bg-panel)"] {
      background: #334155 !important;
      color: #f8fafc !important;
      border: 1px solid #64748b !important;
      box-shadow: 0 6px 14px rgba(2, 6, 23, 0.35) !important;
    }
    button.sell-art-button:not([style*="background: var(--bg-panel)"]) {
      background: linear-gradient(135deg, #fde047, #f59e0b) !important;
      color: #111827 !important;
      border: 1px solid #fbbf24 !important;
      box-shadow: 0 8px 18px rgba(245, 158, 11, 0.4) !important;
    }
    button.sell-art-button > div[style*="position: absolute"] {
      display: none !important;
    }
    #root > div > div:nth-of-type(1) { padding-top: 40px !important; }
    #root > div > div:nth-of-type(3) { padding-bottom: 40px !important; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}


#root>div>div:nth-of-type(1){padding-top:30px!important}#root>div>div:nth-of-type(3){padding-bottom:50px!important}
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
function yV(config) {
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
function Hi(value2) {
  try {
    if (typeof window !== "undefined" && window.tt && window.tt.vibrate) {
      window.tt.vibrate({
        style: value2 || "light"
      });
    }
  } catch {}
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
    --bg-dark:      #0b1120;
    --bg-panel:     #1e293b;
    --gold-light:   #fcd34d;
    --gold-dark:    #f59e0b;
  }
  html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; background: var(--bg-dark); }
  * { box-sizing: border-box; touch-action: none; user-select: none; }
`;
function App() {
  let [config, setConfig] = React.useState(null);
  let [count, setCount] = React.useState(0);
  let [count2, setCount2] = React.useState(0);
  let [currentValue, setCurrentValue] = React.useState(!1);
  let [count3, setCount3] = React.useState(0);
  let [count4, setCount4] = React.useState(0);
  let [count5, setCount5] = React.useState(0);
  const [rainbowOwned,setRainbowOwned]=React.useState(false),[rainbowEnabled,setRainbowEnabled]=React.useState(false);
  const balance=React.useRef(0);
  let stateRef = React.useRef(!1);
  let stateRef2 = React.useRef(null);
  let stateRef3 = React.useRef(null);
  let elementRef = React.useRef(null);
  let stateRef4 = React.useRef(!1);
  let stateRef5 = React.useRef({
    x: 0,
    y: 0
  });
  let stateRef6 = React.useRef("hsl(0, 100%, 70%)");
  let stateRef7 = React.useRef({
    pointer: null,
    audioPending: !1,
    alive: !0
  });
  let value2 = window.devicePixelRatio || 1;
  React.useEffect(() => {
    let value6 = !0;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value7 = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (value7.ok) {
          options = await value7.json();
        }
      } catch {}
      if (value6) {
        setConfig(yV(options));
      }
    })();
    return () => {
      value6 = !1;
    };
  }, []);
  let handleAction = async () => {
    if (!(stateRef.current || stateRef7.current.audioPending || !stateRef7.current.alive)) {
      stateRef7.current.audioPending = !0;
      try {
        if (await Tone.start(), !stateRef7.current.alive) return;
        stateRef2.current = new Tone.PolySynth(Tone.Synth).toDestination();
        stateRef2.current.volume.value = -12;
        stateRef3.current = new Tone.MembraneSynth().toDestination();
        stateRef3.current.volume.value = -8;
        stateRef.current = !0;
      } catch {} finally {
        stateRef7.current.audioPending = !1;
      }
    }
  };
  let value3 = 4 + count3 * 2;
  let value4 = 2 + count4 * 1;
  let value5 = 1 + count5 * 0.5;
  let handleAction2 = (value6, otherValue) => Math.floor(value6 * Math.pow(1.5, otherValue));
  let cost = config ? handleAction2(config.COST_BASE_AXES, count3) : 0;
  let cost2 = config ? handleAction2(config.COST_BASE_BRUSH, count4) : 0;
  let cost3 = config ? handleAction2(config.COST_BASE_MULT, count5) : 0;
  const rainbowCost=config?.COST_RAINBOW??75;
  let callback = React.useCallback(() => {
    let dimensions = elementRef.current;
    if (dimensions) {
      dimensions.getContext("2d").clearRect(0, 0, dimensions.width, dimensions.height);
    }
  }, []);
  let handlePointerDown = event => {
    if (!elementRef.current || !config || currentValue || event.isPrimary === !1 || event.button > 0 || stateRef7.current.pointer !== null) return;
    stateRef7.current.pointer = event.pointerId;
    stateRef4.current = !0;
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    handleAction();
    let bounds = elementRef.current.getBoundingClientRect();
    stateRef5.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    };
    stateRef6.current = `hsl(${Math.floor(Math.random() * 360)}, 100%, 65%)`;
    Hi("light");
  };
  let handlePointerMove = event => {
    if (!stateRef4.current || stateRef7.current.pointer !== event.pointerId || !elementRef.current || !config) return;
    let dimensions = elementRef.current.getBoundingClientRect();
    let point = {
      x: Math.max(0, Math.min(dimensions.width, event.clientX - dimensions.left)),
      y: Math.max(0, Math.min(dimensions.height, event.clientY - dimensions.top))
    };
    let value6 = point.x - stateRef5.current.x;
    let value7 = point.y - stateRef5.current.y;
    let value8 = Math.hypot(value6, value7);
    if (value8 < 2) return;
    let dimensions2 = elementRef.current;
    let context = dimensions2.getContext("2d");
    let value9 = dimensions2.width / 2;
    let value10 = dimensions2.height / 2;
    let x = Math.PI * 2 / value3;
    let y = stateRef5.current.x * dimensions2.width / dimensions.width;
    let value11 = stateRef5.current.y * dimensions2.height / dimensions.height;
    let z = point.x * dimensions2.width / dimensions.width;
    let value12 = point.y * dimensions2.height / dimensions.height;
    const scale=dimensions2.width/dimensions.width;
    const nx=-value7/value8,ny=value6/value8;
    const palette=['#ff5968','#ff9b4b','#ffe16a','#80e971','#56dedb','#6b9cff','#be7aff'];
    const bands=rainbowEnabled?7:1;
    const bandWidth=rainbowEnabled?value4*4/7:value4;
    context.lineCap='round';context.lineJoin='round';
    for(let axis=0;axis<value3;axis++){
      context.save();context.translate(value9,value10);context.rotate(axis*x);
      for(let band=0;band<bands;band++){
        const offset=rainbowEnabled?(band-3)*bandWidth*scale:0;
        context.lineWidth=bandWidth*scale+(rainbowEnabled?.35:0);
        context.strokeStyle=rainbowEnabled?palette[band]:stateRef6.current;
        context.shadowColor=context.strokeStyle;context.shadowBlur=(rainbowEnabled?1:4)*scale;
        const draw=()=>{context.beginPath();context.moveTo(y-value9+nx*offset,value11-value10+ny*offset);context.lineTo(z-value9+nx*offset,value12-value10+ny*offset);context.stroke();};
        draw();context.save();context.scale(1,-1);draw();context.restore();
      }
      context.restore();
    }
    setCount2(value13 => value13 + value8 * config.BASE_POINT_VALUE * value5);
    stateRef5.current = point;
  };
  let handlePointerUp = event => {
    if (!(event && stateRef7.current.pointer !== event.pointerId)) {
      stateRef7.current.pointer = null;
      stateRef4.current = !1;
      if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };
  let handleClick = () => {
    handleAction();
    handlePointerUp();
    if (!(count2 <= 0)) {
      balance.current+=count2;
      setCount(balance.current);
      setCount2(0);
      callback();
      Hi("notification_success");
      if (stateRef3.current) {
        stateRef3.current.triggerAttackRelease("C5", "8n");
      }
    }
  };
  let handleAction3 = (value6, otherValue, argument3) => {
    if (balance.current >= value6) {
      balance.current-=value6;
      setCount(balance.current);
      argument3(value7 => value7 + 1);
      Hi("medium");
      if (stateRef2.current) {
        stateRef2.current.triggerAttackRelease(["E4", "G4", "C5"], "8n");
      }
    } else {
      Hi("notification_error");
    }
  };
  React.useEffect(() => {
    stateRef7.current.alive = !0;
    return () => {
      stateRef7.current.alive = !1;
      stateRef7.current.pointer = null;
      stateRef4.current = !1;
      stateRef2.current?.dispose();
      stateRef3.current?.dispose();
    };
  }, []);
  React.useEffect(() => {
    if (!elementRef.current || !config) return;
    let element = elementRef.current;
    let parentElement = element.parentElement;
    let resizeObserver = new ResizeObserver(value6 => {
      for (let value7 of value6) {
        let {
          width: contentRect,
          height: contentRect2
        } = value7.contentRect;
        let value8 = Math.max(1, Math.floor(Math.min(contentRect, contentRect2) - 20));
        const value9 = Math.max(1, Math.round(value8 * value2));
        if (element.width === value9 && element.height === value9) continue;
        const dimensions = document.createElement("canvas");
        const x = element.getBoundingClientRect();
        dimensions.width = element.width;
        dimensions.height = element.height;
        dimensions.getContext("2d").drawImage(element, 0, 0);
        element.style.width = `${value8}px`;
        element.style.height = `${value8}px`;
        element.width = value9;
        element.height = value9;
        element.getContext("2d").drawImage(dimensions, 0, 0, value9, value9);
        const y = element.getBoundingClientRect();
        if (x.width && x.height) {
          stateRef5.current = {
            x: stateRef5.current.x * y.width / x.width,
            y: stateRef5.current.y * y.height / x.height
          };
        }
      }
    });
    resizeObserver.observe(parentElement);
    return () => resizeObserver.disconnect();
  }, [config, value2]);
  return config ? <div style={{
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    fontFamily: "var(--font-display)",
    color: "white"
  }}>{<style>{value}</style>}{<div style={{
      flex: "0 0 auto",
      position: "relative",
      padding: "calc(30px + env(safe-area-inset-top, 0px)) 30px 16px",
      display: "flex",
      justifyContent: "flex-start",
      alignItems: "center",
      zIndex: 2
    }}>{<div style={{
        padding: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center"
      }}>{<span style={{
          fontSize: "28px",
          lineHeight: 1.2,
          fontWeight: "bold",
          color: "var(--gold-light)",
          fontFamily: "var(--font-mono)"
        }}>{"$"}{Math.floor(count).toLocaleString(config.LANG_CODE || "en")}</span>}</div>}{<div onClick={() => {
        handleAction();
        setCurrentValue(!0);
        Hi("light");
      }} role={"button"} tabIndex={0} aria-label={"Open upgrades"} onKeyDown={event => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          handleAction();
          setCurrentValue(!0);
        }
      }} style={{
        position: "absolute",
        right: "30px",
        top: "30px",
        width: "48px",
        height: "48px",
        borderRadius: "50%",
        background: "#3b82f6",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        boxShadow: "0 4px 12px rgba(59,130,246,0.3)",
        cursor: "pointer"
      }}>{<svg width={"24"} height={"24"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>{<path d={"M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"} />}{<line x1={"3"} y1={"6"} x2={"21"} y2={"6"} />}{<path d={"M16 10a4 4 0 0 1-8 0"} />}</svg>}</div>}</div>}{<div style={{
      flex: "1",
      minHeight: 0,
      position: "relative",
      display: "flex",
      justifyContent: "center",
      alignItems: "center"
    }}>{<div style={{
        position: "relative"
      }}>{<canvas ref={elementRef} aria-label="Symmetry drawing canvas" data-symmetry={value3} data-brush-width={value4} data-value-multiplier={value5} data-rainbow={rainbowEnabled?'on':'off'} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onLostPointerCapture={handlePointerUp} style={{
          background: "#070a13",
          borderRadius: "16px",
          border: "2px solid rgba(255,255,255,0.05)",
          boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)",
          touchAction: "none"
        }} />}{count2 === 0 && <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          pointerEvents: "none"
        }}>{<span style={{
            color: "#e2e8f0",
            fontSize: "18px",
            fontWeight: "bold"
          }}>{config.TXT_DRAG_HINT}</span>}</div>}</div>}</div>}{<div style={{
      flex: "0 0 auto",
      padding: "20px 30px calc(50px + env(safe-area-inset-bottom, 0px))",
      display: "flex",
      justifyContent: "center"
    }}>{<button className="sell-art-button" onClick={handleClick} style={{
        width: "auto",
        maxWidth: "100%",
        minHeight: "44px",
        padding: "12px 18px",
        borderRadius: "20px",
        border: count2 > 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
        outline: "none",
        fontSize: "16px",
        fontWeight: "bold",
        fontFamily: "var(--font-display)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: "8px",
        cursor: count2 > 0 ? "pointer" : "default",
        background: count2 > 0 ? `url(${config.BG_MAIN_REF}) center/cover no-repeat` : "var(--bg-panel)",
        color: count2 > 0 ? "#0b1120" : "rgba(255,255,255,0.3)",
        boxShadow: count2 > 0 ? "0 8px 16px rgba(245,158,11,0.3)" : "none",
        transition: "all 0.2s ease",
        position: "relative",
        overflow: "hidden"
      }}>{count2 > 0 && <div style={{
          position: "absolute",
          inset: 0,
          background: "rgba(252, 211, 77, 0.2)"
        }} />}{<div style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: "8px"
        }}>{<svg width={"20"} height={"20"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.5"} strokeLinecap={"round"} strokeLinejoin={"round"}>{<line x1={"12"} y1={"1"} x2={"12"} y2={"23"} />}{<path d={"M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"} />}</svg>}{<span style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}>{config.TXT_SELL}{" ($"}{Math.floor(count2).toLocaleString(config.LANG_CODE || "en")}{")"}</span>}</div>}</button>}</div>}{<Motion.AnimatePresence>{currentValue && <Motion.motion.div initial={{
        opacity: 0
      }} animate={{
        opacity: 1
      }} exit={{
        opacity: 0
      }} style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        display: "flex",
        justifyContent: "center",
        alignItems: "center"
      }}>{<div style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(8px)"
        }} onClick={() => {
          setCurrentValue(!1);
          Hi("light");
        }} />}{<Motion.motion.div initial={{
          scale: 0.9,
          y: 20
        }} animate={{
          scale: 1,
          y: 0
        }} exit={{
          scale: 0.9,
          y: 20
        }} style={{
          width: "90%",
          maxWidth: "360px",
          maxHeight: "calc(100% - 48px)",
          overflowY: "auto",
          background: "var(--bg-panel)",
          borderRadius: "24px",
          padding: "24px",
          border: "1px solid rgba(255,255,255,0.1)",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: "16px"
        }}>{<div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "8px"
          }}>{<h2 style={{
              margin: 0,
              fontSize: "24px",
              color: "white"
            }}>{config.TXT_SHOP}</h2>}{<button type="button" aria-label="Close upgrades" onClick={() => {
              setCurrentValue(!1);
              Hi("light");
            }} style={{
              padding: "4px",
              border:0,
              background:'transparent',
              cursor: "pointer",
              color: "rgba(255,255,255,0.5)"
            }}>{<svg width={"24"} height={"24"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>{<line x1={"18"} y1={"6"} x2={"6"} y2={"18"} />}{<line x1={"6"} y1={"6"} x2={"18"} y2={"18"} />}</svg>}</button>}</div>}{[{
            title: config.TXT_UPGRADE_AXES,
            val: value3,
            cost: cost,
            lvl: count3,
            setLvl: setCount3
          }, {
            title: config.TXT_UPGRADE_BRUSH,
            val: `${value4} px`,
            cost: cost2,
            lvl: count4,
            setLvl: setCount4
          }, {
            title: config.TXT_UPGRADE_MULT,
            val: `x${value5.toFixed(1)}`,
            cost: cost3,
            lvl: count5,
            setLvl: setCount5
          }, {
            title: config.TXT_UPGRADE_RAINBOW||'Rainbow Brush',
            val: rainbowOwned?(rainbowEnabled?'On':'Off'):'7 colors per stroke',
            cost: rainbowCost,
            rainbow:true,
            lvl:0,
            setLvl:()=>{setRainbowOwned(true);setRainbowEnabled(true);}
          }].map((item, index) => <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(255,255,255,0.03)",
            padding: "12px 16px",
            borderRadius: "16px"
          }} key={index}>{<div style={{
              display: "flex",
              flexDirection: "column"
            }}>{<span style={{
                fontSize: "14px",
                fontWeight: "bold"
              }}>{item.title}</span>}{<span style={{
                fontSize: "12px",
                color: "rgba(255,255,255,0.5)",
                fontFamily: "var(--font-mono)"
              }}>{"Current: "}{item.val}</span>}</div>}{<button type="button" aria-label={item.rainbow&&rainbowOwned?(rainbowEnabled?'Disable Rainbow Brush':'Enable Rainbow Brush'):`Buy ${item.title} for $${item.cost}`} disabled={!(item.rainbow&&rainbowOwned)&&count<item.cost} onClick={() => {if(item.rainbow&&rainbowOwned){setRainbowEnabled(value=>!value);Hi('light');}else handleAction3(item.cost,item.lvl,item.setLvl);}} style={{
              padding: "8px 16px",
              borderRadius: "12px",
              border: "none",
              fontWeight: "bold",
              fontFamily: "var(--font-mono)",
              background: (item.rainbow&&rainbowOwned)||count >= item.cost ? "var(--gold-dark)" : "rgba(255,255,255,0.1)",
              color: (item.rainbow&&rainbowOwned)||count >= item.cost ? "#1e293b" : "rgba(255,255,255,0.3)",
              cursor: (item.rainbow&&rainbowOwned)||count >= item.cost ? "pointer" : "default",
              transition: "background 0.2s"
            }}>{item.rainbow&&rainbowOwned?(rainbowEnabled?'On':'Off'):`$${item.cost.toLocaleString(config.LANG_CODE||'en')}`}</button>}</div>)}</Motion.motion.div>}</Motion.motion.div>}</Motion.AnimatePresence>}</div> : <div style={{
    width: "100%",
    height: "100%",
    background: "#0b1120"
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
  const selectors = [];
  const copy = new Set(["Drag to create magic"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
        "data-batch3-game": "13"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "13"
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
