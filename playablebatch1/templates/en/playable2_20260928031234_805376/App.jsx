// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "MAZE_SIZE",
    "kind": "number",
    "label": "Maze Size",
    "value": 15,
    "default": 15,
    "min": 10,
    "max": 25,
    "step": 1
  }, {
    "id": "VISION_RADIUS",
    "kind": "number",
    "label": "Vision Radius",
    "value": 18,
    "default": 18,
    "min": 10,
    "max": 40,
    "step": 1
  }, {
    "id": "MONSTER_COUNT",
    "kind": "number",
    "label": "Monster Count",
    "value": 4,
    "default": 4,
    "min": 0,
    "max": 10,
    "step": 1
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Title",
    "value": "THE MAZE OF HORROR",
    "default": "THE MAZE OF HORROR",
    "max_length": 25
  }, {
    "id": "SUB_TITLE",
    "label": "Subtitle",
    "value": "Find the exit before you get lost",
    "default": "Find the exit before you get lost",
    "max_length": 40
  }, {
    "id": "MSG_WIN",
    "label": "Win Message",
    "value": "YOU ESCAPED!",
    "default": "YOU ESCAPED!",
    "max_length": 20
  }, {
    "id": "BTN_RESTART",
    "label": "Restart Button",
    "value": "PLAY AGAIN",
    "default": "PLAY AGAIN",
    "max_length": 15
  }],
  "images": [{
    "id": "CHAR_PLAYER",
    "label": "Player Icon",
    "path": "./assets/char_player.webp",
    "replaceable": true
  }, {
    "id": "ICON_MONSTER",
    "label": "Monster Icon",
    "path": "./assets/icon_monster.svg",
    "replaceable": true
  }],
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

#root>div>div:first-child{position:relative;z-index:50!important} #root>div>div:first-child>p{color:#f7f4ed!important;text-shadow:0 2px 6px #000}
/* User override 2026-10-21: favor visual center, not a fixed upper band. */
.maze-instruction{position:static!important;margin:0!important;text-align:center!important;transform:none!important;translate:none!important}

html[data-guide-action-used="true"]:root:root:root #root#root#root>div>div:first-child>p{visibility:hidden!important;opacity:0!important}
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
function ZT(length, length2) {
  let value = Array.from({
    length: length2
  }, (value3, otherValue) => Array.from({
    length: length
  }, (value4, otherValue2) => ({
    x: otherValue2,
    y: otherValue,
    top: !0,
    right: !0,
    bottom: !0,
    left: !0,
    visited: !1
  })));
  let items = [];
  let item = value[0][0];
  item.visited = !0;
  let handleAction = value3 => {
    let items2 = [];
    let {
      x: value4,
      y: value5
    } = value3;
    if (value5 > 0 && !value[value5 - 1][value4].visited) {
      items2.push({
        dir: "top",
        cell: value[value5 - 1][value4]
      });
    }
    if (value4 < length - 1 && !value[value5][value4 + 1].visited) {
      items2.push({
        dir: "right",
        cell: value[value5][value4 + 1]
      });
    }
    if (value5 < length2 - 1 && !value[value5 + 1][value4].visited) {
      items2.push({
        dir: "bottom",
        cell: value[value5 + 1][value4]
      });
    }
    if (value4 > 0 && !value[value5][value4 - 1].visited) {
      items2.push({
        dir: "left",
        cell: value[value5][value4 - 1]
      });
    }
    return items2;
  };
  let handleAction2 = (value3, otherValue, argument3) => {
    if (argument3 === "top") {
      value3.top = !1;
      otherValue.bottom = !1;
    } else {
      if (argument3 === "right") {
        value3.right = !1;
        otherValue.left = !1;
      } else {
        if (argument3 === "bottom") {
          value3.bottom = !1;
          otherValue.top = !1;
        } else {
          if (argument3 === "left") {
            value3.left = !1;
            otherValue.right = !1;
          }
        }
      }
    }
  };
  for (;;) {
    let value3 = handleAction(item);
    if (value3.length > 0) {
      let item2 = value3[Math.floor(Math.random() * value3.length)];
      items.push(item);
      handleAction2(item, item2.cell, item2.dir);
      item = item2.cell;
      item.visited = !0;
    } else if (items.length > 0) item = items.pop();else break;
  }
  return value;
}
function HT(config) {
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
var value2 = `
html, body, #root { 
  width: 100%; height: 100%; margin: 0; padding: 0; 
  overflow: hidden; background-color: #000; color: #fff;
}
* { box-sizing: border-box; }
button { font-family: inherit; }

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
`;
function KT({
  onMove: t
}) {
  let options = {
    width: "56px",
    height: "56px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "12px",
    color: "#fff",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontSize: "28px",
    cursor: "pointer",
    userSelect: "none",
    touchAction: "none"
  };
  return <div style={{
    display: "grid",
    gridTemplateColumns: "repeat(3, 56px)",
    gap: "8px"
  }}>{<div />}{<button type={"button"} aria-label={"Move up"} style={{
      ...options,
      padding: 0
    }} onClick={() => t(0, -1)}>{"\u2191"}</button>}{<div />}{<button type={"button"} aria-label={"Move left"} style={{
      ...options,
      padding: 0
    }} onClick={() => t(-1, 0)}>{"\u2190"}</button>}{<button type={"button"} aria-label={"Move down"} style={{
      ...options,
      padding: 0
    }} onClick={() => t(0, 1)}>{"\u2193"}</button>}{<button type={"button"} aria-label={"Move right"} style={{
      ...options,
      padding: 0
    }} onClick={() => t(1, 0)}>{"\u2192"}</button>}</div>;
}
function useGameFeature1() {
  let canSubmit = typeof window !== "undefined" && window.tt && typeof window.tt.playableRecordingSubmission == "function";
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
          fail(value) {
            console.error("[post_my_play] playableRecordingSubmission failed", value && (value.errMsg || value.message));
            setSubmitting(!1);
          },
          complete() {}
        });
      }
    }
  };
}
function XT({
  style: t
}) {
  let {
    canSubmit: value,
    submitting: value3,
    submitRecording: handleClick
  } = useGameFeature1();
  return value ? <button type={"button"} disabled={value3} onClick={handleClick} style={{
    ...t,
    opacity: value3 ? 0.5 : 1
  }}>{"Post My Play"}</button> : null;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("playing");
  let [currentValue, setCurrentValue] = React.useState(null);
  let [point, setPoint] = React.useState({
    x: 0,
    y: 0
  });
  let [items, setItems] = React.useState([]);
  let stateRef = React.useRef({
    ready: !1,
    sound: null
  });
  let stateRef2 = React.useRef(null);
  let handleClick = () => {
    let current = stateRef.current;
    if (!current.sound && window.PlayableSceneAudio) current.sound = new window.PlayableSceneAudio({
      profile: "maze"
    });
    if (current.sound?.unlock()) {
      current.ready = !0;
      current.sound.setLoop(phase !== "over");
      current.stepSynth = {
        triggerAttackRelease: () => current.sound.play("step", {
          volume: 0.1
        })
      };
      current.scareSynth = {
        triggerAttackRelease: () => current.sound.play("scare", {
          volume: 0.14
        })
      };
      current.winSynth = {
        triggerAttackRelease: () => {
          current.sound.setLoop(!1);
          current.sound.play("win", {
            volume: 0.08
          });
        }
      };
    }
  };
  let handleClick2 = React.useCallback(() => {
    if (!config) return;
    stateRef.current.sound?.setLoop(!0);
    let value = ZT(config.MAZE_SIZE, config.MAZE_SIZE);
    setCurrentValue(value);
    setPoint({
      x: 0,
      y: 0
    });
    setPhase("playing");
    let y = value.flat().filter(point2 => point2.x === 0 && point2.y === 0 || point2.x === config.MAZE_SIZE - 1 && point2.y === config.MAZE_SIZE - 1 ? !1 : [point2.top, point2.right, point2.bottom, point2.left].filter(Boolean).length === 3);
    let value3 = y.sort(() => Math.random() - 0.5).slice(0, Math.min(config.MONSTER_COUNT, y.length));
    setItems(value3.map(point2 => ({
      x: point2.x,
      y: point2.y,
      found: !1
    })));
  }, [config]);
  let handleMove = React.useCallback((value, y) => {
    if (!(phase !== "playing" || !currentValue)) {
      handleClick();
      setPoint(value3 => {
        let {
          x: value4,
          y: value5
        } = value3;
        let item = currentValue[value5][value4];
        let value6 = value4;
        let value7 = value5;
        if (value === 0 && y === -1 && !item.top) {
          value7 -= 1;
        } else {
          if (value === 1 && y === 0 && !item.right) {
            value6 += 1;
          } else {
            if (value === 0 && y === 1 && !item.bottom) {
              value7 += 1;
            } else {
              if (value === -1 && y === 0 && !item.left) {
                value6 -= 1;
              }
            }
          }
        }
        return value6 !== value4 || value7 !== value5 ? (stateRef.current.ready && stateRef.current.stepSynth.triggerAttackRelease("16n"), {
          x: value6,
          y: value7
        }) : value3;
      });
    }
  }, [phase, currentValue]);
  let x = React.useCallback(value => {
    stateRef2.current = {
      x: value.touches[0].clientX,
      y: value.touches[0].clientY
    };
  }, []);
  let handleTouchEnd = React.useCallback(value => {
    if (!stateRef2.current) return;
    let y = value.changedTouches[0].clientX - stateRef2.current.x;
    let value3 = value.changedTouches[0].clientY - stateRef2.current.y;
    if (Math.abs(y) > 30 || Math.abs(value3) > 30) {
      if (Math.abs(y) > Math.abs(value3)) {
        handleMove(y > 0 ? 1 : -1, 0);
      } else {
        handleMove(0, value3 > 0 ? 1 : -1);
      }
    }
    stateRef2.current = null;
  }, [handleMove]);
  React.useEffect(() => {
    let handleAction = () => {
      if (document.hidden) {
        stateRef.current.ready = !1;
      } else if (stateRef.current.sound?.context) stateRef.current.ready = !0;
    };
    document.addEventListener("visibilitychange", handleAction);
    return () => {
      document.removeEventListener("visibilitychange", handleAction);
      stateRef.current.sound?.dispose();
    };
  }, []);
  if (React.useEffect(() => {
    if (phase !== "playing" || !config) return;
    let {
      x: value,
      y
    } = point;
    if (items.some(point2 => point2.x === value && point2.y === y)) {
      setPhase("scared");
      setItems(value3 => value3.map(point2 => point2.x === value && point2.y === y ? {
        ...point2,
        found: !0
      } : point2));
      if (stateRef.current.ready) {
        stateRef.current.scareSynth.triggerAttackRelease("C3", "8n");
      }
      setTimeout(() => {
        setPoint({
          x: 0,
          y: 0
        });
        setPhase("playing");
      }, 500);
      return;
    }
    if (value === config.MAZE_SIZE - 1 && y === config.MAZE_SIZE - 1) {
      setPhase("over");
      if (stateRef.current.ready) {
        stateRef.current.winSynth.triggerAttackRelease(["C4", "E4", "G4"], "4n");
      }
      return;
    }
    setItems(value3 => {
      let value4 = !1;
      let value5 = value3.map(point2 => !point2.found && Math.abs(point2.x - value) + Math.abs(point2.y - y) <= 2 ? (value4 = !0, stateRef.current.ready && stateRef.current.scareSynth.triggerAttackRelease("C6", "16n"), {
        ...point2,
        found: !0
      }) : point2);
      return value4 ? value5 : value3;
    });
  }, [point, phase, config]), React.useEffect(() => {
    let value = !0;
    (async () => {
      let y = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value3 = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (value3.ok) {
          y = await value3.json();
        }
      } catch {}
      if (value) {
        setConfig(HT(y));
      }
    })();
    return () => {
      value = !1;
    };
  }, []), React.useEffect(() => {
    if (config && !currentValue) {
      handleClick2();
    }
  }, [config, currentValue, handleClick2]), !config || !currentValue) return <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#000"
  }} />;
  let MAZE_SIZE = config.MAZE_SIZE;
  let MAZE_SIZE2 = config.MAZE_SIZE;
  let options = {
    padding: "12px 24px",
    backgroundColor: "#fff",
    color: "#000",
    border: "none",
    borderRadius: "8px",
    fontSize: "16px",
    fontWeight: "bold",
    fontFamily: "var(--font-body)",
    cursor: "pointer"
  };
  return <React.Fragment>{<style>{value2}</style>}{<div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      paddingBottom: "calc(40px + env(safe-area-inset-bottom, 0px))"
    }} onClick={handleClick}>{<div style={{
        flex: "0 0 auto",
        textAlign: "center",
        padding: "calc(24px + env(safe-area-inset-top, 0px)) 25px 12px",
        zIndex: 10
      }}>{<p className="maze-instruction" style={{
          fontFamily: "var(--font-body)",
          margin: "4px 0 0 0",
          fontSize: "18px",
          color: "#cbd5e1"
        }}>{config.SUB_TITLE}</p>}</div>}{<div style={{
        flex: "1",
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        containerType: "size",
        padding: "0 25px",
        touchAction: "none"
      }} onTouchStart={x} onTouchEnd={handleTouchEnd}>{<div style={{
          width: "min(100%, 100cqh)",
          maxWidth: "450px",
          aspectRatio: "1",
          position: "relative",
          border: "2px solid #333",
          backgroundColor: "#000"
        }}>{<div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${MAZE_SIZE}, 1fr)`,
            gridTemplateRows: `repeat(${MAZE_SIZE2}, 1fr)`,
            width: "100%",
            height: "100%"
          }}>{currentValue.flat().map((point2, y) => <div style={{
              borderTop: point2.top ? "1px solid #444" : "1px solid transparent",
              borderRight: point2.right ? "1px solid #444" : "1px solid transparent",
              borderBottom: point2.bottom ? "1px solid #444" : "1px solid transparent",
              borderLeft: point2.left ? "1px solid #444" : "1px solid transparent",
              backgroundColor: point2.x === MAZE_SIZE - 1 && point2.y === MAZE_SIZE2 - 1 ? "#600" : "transparent"
            }} key={y} />)}</div>}{<div style={{
            position: "absolute",
            left: `${(MAZE_SIZE - 1) / MAZE_SIZE * 100}%`,
            top: `${(MAZE_SIZE2 - 1) / MAZE_SIZE2 * 100}%`,
            width: `${100 / MAZE_SIZE}%`,
            height: `${100 / MAZE_SIZE2}%`,
            backgroundColor: "rgba(255, 0, 0, 0.6)",
            zIndex: 5,
            pointerEvents: "none"
          }} />}{<img src={config.CHAR_PLAYER} style={{
            position: "absolute",
            left: `${point.x / MAZE_SIZE * 100}%`,
            top: `${point.y / MAZE_SIZE2 * 100}%`,
            width: `${100 / MAZE_SIZE}%`,
            height: `${100 / MAZE_SIZE2}%`,
            objectFit: "contain",
            zIndex: 10,
            pointerEvents: "none",
            transition: "all 0.15s ease-out"
          }} alt={"player"} />}{items.map((point2, y) => <img src={config.ICON_MONSTER} style={{
            position: "absolute",
            left: `${point2.x / MAZE_SIZE * 100}%`,
            top: `${point2.y / MAZE_SIZE2 * 100}%`,
            width: `${100 / MAZE_SIZE}%`,
            height: `${100 / MAZE_SIZE2}%`,
            objectFit: "contain",
            zIndex: 6,
            pointerEvents: "none",
            opacity: point2.found ? 1 : 0.2,
            transition: "opacity 0.2s"
          }} alt={"monster"} key={y} />)}{<div style={{
            position: "absolute",
            inset: 0,
            zIndex: 20,
            pointerEvents: "none",
            background: `radial-gradient(circle at ${(point.x + 0.5) / MAZE_SIZE * 100}% ${(point.y + 0.5) / MAZE_SIZE2 * 100}%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) ${config.VISION_RADIUS}%, rgba(0,0,0,1) ${config.VISION_RADIUS * 1.6}%)`,
            transition: "background 0.15s ease-out"
          }} />}</div>}</div>}{<div style={{
        flex: "0 0 auto",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "16px 0",
        zIndex: 10
      }}>{<KT onMove={handleMove} />}</div>}{phase === "over" && <div style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.85)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50
      }}>{<h2 style={{
          fontFamily: "var(--font-display)",
          fontSize: "32px",
          color: "#ff2a2a",
          marginBottom: "24px"
        }}>{config.MSG_WIN}</h2>}{<div style={{
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          justifyContent: "center"
        }}>{<button onClick={handleClick2} style={options}>{config.BTN_RESTART}</button>}{<XT style={options} />}</div>}</div>}</div>}</React.Fragment>;
}

// ./scene-audio.js
/* Original procedural audio. No third-party recordings or runtime dependencies. */
(() => {
  'use strict';

  const randomFor = seed => () => {
    seed = Math.imul(seed, 1664525) + 1013904223 >>> 0;
    return seed / 4294967296;
  };
  class PlayableSceneAudio {
    constructor({
      profile,
      context = null
    } = {}) {
      this.profile = profile;
      this.context = context;
      this.ownsContext = !context;
      this.buffers = new Map();
      this.voices = new Set();
      this.loopVoice = null;
      this.loopWanted = false;
      this.disposed = false;
      this.visibility = () => {
        if (document.hidden) {
          this.stopAll();
          if (this.profile === 'carve') this.loopWanted = false;
          if (this.ownsContext) this.context?.suspend?.().catch(() => {});
        } else if (this.profile === 'maze' && this.loopWanted) this.setLoop(true);
      };
      this.pageHide = () => {
        this.stopAll();
        if (this.profile === 'carve') this.loopWanted = false;
        if (this.ownsContext) this.context?.suspend?.().catch(() => {});
      };
      this.pageShow = () => {
        if (this.profile === 'maze' && this.loopWanted && !document.hidden) this.setLoop(true);
      };
      document.addEventListener('visibilitychange', this.visibility);
      window.addEventListener('pagehide', this.pageHide);
      window.addEventListener('pageshow', this.pageShow);
    }
    unlock() {
      if (this.disposed || document.hidden) return null;
      try {
        if (!this.context) {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) return null;
          this.context = new Audio();
        }
        if (this.context.state === 'closed') return null;
        if (this.context.state === 'suspended') this.context.resume().catch(() => {});
        return this.context;
      } catch (value) {
        return null;
      }
    }
    buffer(kind, variant = 0) {
      const value3 = kind + variant;
      if (this.buffers.has(value3)) return this.buffers.get(value3);
      const context = this.context;
      const seconds = {
        maze: 8,
        carve: 1.7,
        thunder: 3.4,
        step: 0.09,
        scare: 0.3,
        win: 0.55
      }[kind];
      const stereo = kind === 'thunder';
      const buffer = context.createBuffer(stereo ? 2 : 1, Math.ceil(seconds * context.sampleRate), context.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        const random = randomFor(4027 + variant * 89 + channel * 193);
        let value4 = 0;
        let grain = 0;
        let peak = 0;
        const smoothing = Math.exp(-2 * Math.PI * (kind === 'maze' ? 140 : 85) / context.sampleRate);
        const highSmoothing = Math.exp(-2 * Math.PI * 420 / context.sampleRate);
        for (let value5 = 0; value5 < samples.length; value5++) {
          const value6 = value5 / context.sampleRate;
          const white = random() * 2 - 1;
          value4 = value4 * smoothing + white * (1 - smoothing);
          grain = grain * highSmoothing + white * (1 - highSmoothing);
          let value;
          if (kind === 'maze') {
            // Slow, non-pitched air, deliberately behind footsteps and encounters.
            value = value4 * (0.68 + 0.16 * Math.sin(value6 * Math.PI / 2) + 0.08 * Math.sin(value6 * Math.PI));
          } else if (kind === 'carve') {
            const stroke = 0.42 + 0.26 * Math.sin(value6 * 18) ** 2 + 0.16 * Math.sin(value6 * 31 + 0.7) ** 2;
            value = (white - grain) * stroke * 0.3 + (random() > 0.997 ? white * 0.34 : 0);
          } else if (kind === 'thunder') {
            const crack = Math.exp(-value6 * 26) * 0.65 + Math.exp(-Math.abs(value6 - 0.07) * 60) * 0.2;
            const rolling = Math.exp(-value6 * 1.15) * (1 - Math.exp(-value6 * 24)) * (0.65 + 0.3 * Math.sin(value6 * 12 + variant) ** 2);
            const echoes = Math.exp(-Math.abs(value6 - 0.28) * 15) * 0.28 + Math.exp(-Math.abs(value6 - 0.64) * 9) * 0.2 + Math.exp(-Math.abs(value6 - 1.12) * 7) * 0.12;
            value = white * crack + value4 * 9 * (rolling + echoes);
            value *= Math.min(1, value6 / 0.003, (seconds - value6) / 0.28);
          } else if (kind === 'win') {
            value = [261.63, 329.63, 392].reduce((total, item) => total + Math.sin(value6 * Math.PI * 2 * item), 0) * Math.min(1, value6 / 0.02) * Math.exp(-value6 / 0.12) * Math.min(1, (seconds - value6) / 0.05);
          } else {
            const length = kind === 'step' ? 0.03 : 0.09;
            value = (value4 * 3 + white * 0.08) * Math.exp(-value6 / length) * Math.min(1, value6 / 0.006);
          }
          samples[value5] = value;
          peak = Math.max(peak, Math.abs(value));
        }
        const scale = 0.8 / Math.max(0.001, peak);
        for (let value = 0; value < samples.length; value++) samples[value] *= scale;
        if (kind === 'maze' || kind === 'carve') {
          // Match loop endpoints to avoid clicks at the buffer boundary.
          const blend = Math.round(context.sampleRate * 0.02);
          for (let value = 0; value < blend; value++) {
            const value5 = value / blend;
            samples[samples.length - blend + value] = samples[samples.length - blend + value] * (1 - value5) + samples[value] * value5;
          }
        }
      }
      this.buffers.set(value3, buffer);
      return buffer;
    }
    play(kind, {
      loop = false,
      volume = 0.12,
      variant = 0
    } = {}) {
      const value = this.unlock();
      if (!value) return null;
      try {
        // Rapid touches cannot accumulate unbounded audio nodes or excessive level.
        const limit = kind === 'thunder' ? 3 : 4;
        const active = [...this.voices].filter(item => !item.stopping);
        while (active.length >= limit) this.stopVoice(active.shift(), 0.025);
        const source = value.createBufferSource();
        const filter = value.createBiquadFilter();
        const gain = value.createGain();
        source.buffer = this.buffer(kind, variant);
        source.loop = loop;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(kind === 'maze' ? 500 : kind === 'carve' ? 4600 : kind === 'thunder' ? 3200 : 1700, value.currentTime);
        if (kind === 'thunder') filter.frequency.exponentialRampToValueAtTime(230, value.currentTime + 2.9);
        filter.Q.value = 0.45;
        const level = Math.min(0.4, Math.max(0, volume)) / Math.sqrt(active.length + 1);
        const attack = kind === 'maze' ? 1.2 : kind === 'carve' ? 0.035 : 0.004;
        gain.gain.setValueAtTime(0.0001, value.currentTime);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), value.currentTime + attack);
        source.connect(filter).connect(gain).connect(value.destination);
        const voice = {
          source,
          filter,
          gain,
          stopping: false
        };
        this.voices.add(voice);
        source.onended = () => {
          source.disconnect();
          filter.disconnect();
          gain.disconnect();
          this.voices.delete(voice);
          if (this.loopVoice === voice) this.loopVoice = null;
        };
        source.start();
        if (!loop) source.stop(value.currentTime + source.buffer.duration + 0.02);
        return voice;
      } catch (value3) {
        return null;
      }
    }
    setLoop(wanted) {
      this.loopWanted = Boolean(wanted);
      if (!wanted || document.hidden) {
        if (this.loopVoice) this.stopVoice(this.loopVoice, 0.12);
        this.loopVoice = null;
        return;
      }
      if (!this.loopVoice) this.loopVoice = this.play(this.profile, {
        loop: true,
        volume: this.profile === 'maze' ? 0.035 : 0.14
      });
    }
    stopVoice(voice, fade = 0.08) {
      if (!voice || voice.stopping) return;
      voice.stopping = true;
      try {
        const currentTime = this.context.currentTime;
        const param = voice.gain.gain;
        if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(currentTime);else {
          param.cancelScheduledValues(currentTime);
          param.setValueAtTime(Math.max(0.0001, param.value), currentTime);
        }
        param.exponentialRampToValueAtTime(0.0001, currentTime + fade);
        // A finite source already has a stop scheduled; replace it with the fade's end.
        voice.source.stop(currentTime + fade + 0.01);
      } catch (value) {}
    }
    stopAll() {
      for (const voice of this.voices) this.stopVoice(voice);
      this.loopVoice = null;
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.loopWanted = false;
      this.stopAll();
      document.removeEventListener('visibilitychange', this.visibility);
      window.removeEventListener('pagehide', this.pageHide);
      window.removeEventListener('pageshow', this.pageShow);
      if (this.ownsContext) this.context?.close?.().catch(() => {});
      this.buffers.clear();
    }
  }
  window.PlayableSceneAudio = PlayableSceneAudio;
})();
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
        "data-action-root": "#root>div>div:nth-child(2)",
        "data-arrow-keys": "true",
        "data-arrow-buttons": "button[aria-label=\"Move up\"],button[aria-label=\"Move down\"],button[aria-label=\"Move left\"],button[aria-label=\"Move right\"]"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "guideLifecycle": "20261021",
      "actionRoot": "#root>div>div:nth-child(2)",
      "arrowKeys": "true",
      "arrowButtons": "button[aria-label=\"Move up\"],button[aria-label=\"Move down\"],button[aria-label=\"Move left\"],button[aria-label=\"Move right\"]"
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
        "data-subject": "#root img",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root img",
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
  const selectors = ["#root>div>div:first-child>p"];
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
      const filter = value4 => (base ? base + ' ' : '') + 'opacity(' + value4 + ')';
      const value3 = value.animate([{
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
      running.set(value, value3);
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
        "data-batch3-game": "34"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "34"
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
