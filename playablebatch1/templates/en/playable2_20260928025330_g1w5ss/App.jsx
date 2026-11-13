// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "MAX_LEVEL",
    "kind": "number",
    "label": "Max Level",
    "value": 12,
    "default": 25,
    "min": 10,
    "max": 200,
    "step": 1
  }],
  "texts": [{
    "id": "TITLE_MAIN",
    "label": "Main Title",
    "value": "Find the mistake!",
    "default": "Find the mistake!",
    "max_length": 25
  }, {
    "id": "SUB_TITLE",
    "label": "Footer Prompt",
    "value": "TAP THE ODD ONE OUT",
    "default": "TAP THE ODD ONE OUT",
    "max_length": 30
  }, {
    "id": "LEVEL_LABEL",
    "label": "Level Label",
    "value": "Level",
    "default": "Level",
    "max_length": 15
  }, {
    "id": "VICTORY_TITLE",
    "label": "Victory Title",
    "value": "All Levels Complete!",
    "default": "All Levels Complete!",
    "max_length": 30
  }, {
    "id": "BTN_RESTART",
    "label": "Restart Button",
    "value": "Play Again",
    "default": "Play Again",
    "max_length": 20
  }, {
    "id": "BTN_POST",
    "label": "Post Button",
    "value": "Post My Play",
    "default": "Post My Play",
    "max_length": 20
  }],
  "images": [{"id":"BG_PAPER","label":"Yellow dotted paper","path":"./assets/yellow-paper-dots-v3.svg","replaceable":true}],
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

.mistake-emoji{font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;line-height:1;pointer-events:none}
.mistake-progress{position:relative}
.mistake-progress::after{content:'';position:absolute;left:0;right:0;top:50%;border-top:1px solid #20211f55;pointer-events:none}
.mistake-tile:focus-visible,button:focus-visible{outline:3px solid #20211f;outline-offset:4px}
.mistake-tile{min-width:0;min-height:0}
@media(prefers-reduced-motion:reduce){.mistake-tile{transition:none!important}}`;
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
function useGameFeature1() {
  let canSubmit = typeof tt !== "undefined" && typeof tt.playableRecordingSubmission == "function";
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
  let submitRecording = React.useCallback(() => {
    if (!(submitting || !canSubmit)) {
      setSubmitting(!0);
      tt.playableRecordingSubmission({
        success() {},
        fail(value) {
          console.error("[post_my_play] failed", value && (value.errMsg || value.message));
          setSubmitting(!1);
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
function wV(config) {
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
function TV(value) {
  return value <= 2 ? 2 : value <= 4 ? 3 : value <= 7 ? 4 : 5;
}
var items = [["🍎", "🍅"], ["🍓", "🍒"], ["🌻", "🌼"], ["🍩", "🥯"], ["😀", "😃"], ["😄", "😃"], ["😮", "😯"], ["😺", "😸"], ["😑", "😐"], ["🕓", "🕔"], ["🌎", "🌍"], ["☘️", "🍀"]];
var options = {
  fullscreen: {
    width: "100%",
    height: "100%"
  },
  container: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    fontFamily: "var(--font-display)",
    fontWeight: 600,
    color: "var(--primary-color)",
    position: "relative",
    paddingBottom: 0
  },
  header: {
    flex: "0 0 auto",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "12px",
    padding: "calc(30 * var(--ui-unit) + env(safe-area-inset-top, 0px)) calc(30 * var(--ui-unit) + env(safe-area-inset-right, 0px)) 8px calc(30 * var(--ui-unit) + env(safe-area-inset-left, 0px))",
    width: "100%"
  },
  levelText: {
    fontSize: "calc(28 * var(--ui-unit))",
    fontWeight: 600,
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.2,
    border: "2.5px solid #20211f",
    borderRadius: 2,
    padding: "3px 8px 5px",
    backgroundColor: "#ffd34d",
    boxShadow: "2px 4px 0 #20211f26"
  },
  titleText: {
    fontSize: "clamp(14px, 4vw, 16px)",
    color: "var(--accent-color)",
    maxWidth: "50%",
    textAlign: "right",
    overflowWrap: "anywhere",
    lineHeight: 1.25
  },
  mainArea: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "68px calc(30 * var(--ui-unit) + env(safe-area-inset-right, 0px)) calc(50 * var(--ui-unit)) calc(30 * var(--ui-unit) + env(safe-area-inset-left, 0px))",
    containerType: "size"
  },
  gridContainer: value => ({
    display: "grid",
    gridTemplateColumns: `repeat(${value}, 1fr)`,
    gap: "clamp(4px, 1.2vw, 8px)",
    width: "min(100%, 100cqh)",
    maxWidth: "520px",
    aspectRatio: "1 / 1",
    backgroundColor: "transparent",
    padding: "4px 5px 7px 3px",
    borderRadius: "6px"
  }),
  gridItem: value => ({
    backgroundColor: "#fffdf5",
    border: "2.5px solid #20211f",
    borderRadius: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: {
      2: "3.5rem",
      3: "2.5rem",
      4: "2rem",
      5: "1.65rem"
    }[value] || "1.5rem",
    cursor: "pointer",
    boxShadow: "3px 4px 0 #20211f33",
    userSelect: "none"
  }),
  footer: {
    position: "absolute",
    top: "20%",
    left: "calc(30 * var(--ui-unit) + env(safe-area-inset-left, 0px))",
    right: "calc(30 * var(--ui-unit) + env(safe-area-inset-right, 0px))",
    textAlign: "center",
    fontSize: "calc(18 * var(--ui-unit))",
    fontWeight: 600,
    lineHeight: 1.4,
    color: "#20211f",
    pointerEvents: "none"
  },
  resultPanel: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    maxWidth: "400px",
    gap: "24px",
    backgroundColor: "#fffdf5",
    border: "2.5px solid #20211f",
    borderRadius: "6px",
    padding: "24px 16px",
    boxShadow: "4px 6px 0 #20211f33"
  },
  resultTitle: {
    fontSize: "calc(24 * var(--ui-unit))",
    color: "var(--accent-color)",
    margin: 0,
    textAlign: "center"
  },
  rewardImageWrapper: {
    width: "80%",
    aspectRatio: "1 / 1",
    backgroundColor: "#fff",
    borderRadius: "24px",
    padding: "16px",
    boxShadow: "0 8px 16px rgba(0,0,0,0.08)"
  },
  rewardImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain"
  },
  btnRow: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    width: "80%"
  },
  btnPrimary: {
    width: "100%",
    padding: "16px",
    borderRadius: "6px",
    border: "2.5px solid #20211f",
    backgroundColor: "#ffd34d",
    color: "#20211f",
    fontSize: "20px",
    fontFamily: "inherit",
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "3px 5px 0 #20211f33"
  },
  btnSecondary: {
    width: "100%",
    padding: "16px",
    borderRadius: "6px",
    border: "2px solid var(--accent-color)",
    backgroundColor: "transparent",
    color: "var(--accent-color)",
    fontSize: "20px",
    fontFamily: "inherit",
    fontWeight: 600,
    cursor: "pointer"
  }
};
function App() {
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("playing");
  let [count, setCount] = React.useState(1);
  let [currentValue, setCurrentValue] = React.useState(-1);
  let [count2, setCount2] = React.useState(0);
  let stateRef = React.useRef(!1);
  let stateRef2 = React.useRef(null);
  let stateRef3 = React.useRef(null);
  let x = React.useRef(null);
  let stateRef4 = React.useRef(!1);
  let [currentValue2, setCurrentValue2] = React.useState(!1);
  let [count3, setCount3] = React.useState(30);
  let [count4, setCount4] = React.useState(3);
  let stateRef5 = React.useRef({
    started: !1,
    deadline: 0,
    chances: 3,
    outcome: null
  });
  let stateRef6 = React.useRef(null);
  let stateRef7 = React.useRef(null);
  let stateRef8 = React.useRef(!0);
  let stateRef9 = React.useRef(!1);
  let stateRef10 = React.useRef(new Set());
  let {
    canSubmit: value,
    submitting: value2,
    submitRecording: handleClick
  } = useGameFeature1();
  React.useEffect(() => {
    let value4 = !0;
    (async () => {
      let options2 = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value5 = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (value5.ok) {
          options2 = await value5.json();
        }
      } catch {}
      if (value4) {
        setConfig(wV(options2));
      }
    })();
    return () => {
      value4 = !1;
    };
  }, []);
  let handleAction = async () => {
    if (!(stateRef.current || stateRef9.current || !stateRef8.current)) {
      stateRef9.current = !0;
      try {
        if (await Tone.start(), !stateRef8.current) return;
        stateRef2.current = new Tone.Synth({
          volume: -8
        }).toDestination();
        stateRef3.current = new Tone.MembraneSynth({
          volume: -4
        }).toDestination();
        x.current = new Tone.PolySynth(Tone.Synth, {
          volume: -8
        }).toDestination();
        stateRef.current = !0;
      } catch {
        stateRef.current = !1;
      } finally {
        stateRef9.current = !1;
      }
    }
  };
  let handleAction2 = () => {
    if (stateRef.current) {
      stateRef2.current.triggerAttackRelease("C5", "8n");
    }
  };
  let handleAction3 = () => {
    if (stateRef.current) {
      stateRef3.current.triggerAttackRelease("C2", "8n");
    }
  };
  let z = () => {
    if (!stateRef.current) return;
    let timestamp = Tone.now();
    x.current.triggerAttackRelease(["C4", "E4", "G4", "C5"], "2n", timestamp);
  };
  let computedValue = React.useMemo(() => {
    let size = TV(count);
    let total = size * size;
    let item = items[(count - 1) % items.length];
    let y = Math.floor(Math.random() * total);
    return {
      size: size,
      total: total,
      normal: item[0],
      odd: item[1],
      oddIdx: y
    };
  }, [count]);
  let handleAction4 = value4 => !stateRef8.current || stateRef5.current.outcome ? !1 : (stateRef5.current.outcome = value4, clearInterval(stateRef6.current), stateRef6.current = null, clearTimeout(stateRef7.current), stateRef7.current = null, setPhase("over"), !0);
  let handleAction5 = value4 => {
    if (!(!Number.isInteger(value4) || value4 < 0 || value4 >= computedValue.total) && phase === "playing" && !stateRef4.current && !stateRef5.current.outcome && stateRef8.current) {
      const timestamp = performance.now();
      if (stateRef5.current.started && timestamp >= stateRef5.current.deadline) {
        setCount3(0);
        if (handleAction4("time")) {
          handleAction3();
        }
        return;
      }
      if (stateRef5.current.started || (stateRef5.current.started = !0, stateRef5.current.deadline = timestamp + 30000, stateRef6.current = setInterval(() => {
        if (!stateRef8.current || stateRef5.current.outcome) return;
        const value5 = Math.max(0, stateRef5.current.deadline - performance.now());
        setCount3(Math.ceil(value5 / 1000));
        if (value5 === 0 && handleAction4("time")) {
          handleAction3();
        }
      }, 100)), stateRef4.current = !0, setCurrentValue2(!0), stateRef7.current = setTimeout(() => {
        stateRef4.current = !1;
        stateRef7.current = null;
      }, 220), handleAction(), value4 === computedValue.oddIdx) {
        handleAction2();
        if (count >= (config?.MAX_LEVEL || 100)) {
          handleAction4("win");
          z();
        } else {
          setCount(value5 => value5 + 1);
          setCurrentValue(-1);
        }
      } else if (handleAction3(), setCurrentValue(value4), setCount2(value5 => value5 + 1), stateRef5.current.chances -= 1, setCount4(stateRef5.current.chances), stateRef5.current.chances === 0 && handleAction4("mistakes"), typeof tt !== "undefined" && tt.vibrate) try {
        tt.vibrate({
          style: "light"
        });
      } catch {}
    }
  };
  let handleClick2 = () => {
    clearInterval(stateRef6.current);
    clearTimeout(stateRef7.current);
    stateRef6.current = stateRef7.current = null;
    stateRef5.current = {
      started: !1,
      deadline: 0,
      chances: 3,
      outcome: null
    };
    stateRef10.current.clear();
    setCount3(30);
    setCount4(3);
    handleAction();
    stateRef4.current = !1;
    setCurrentValue2(!1);
    setCount(1);
    setCurrentValue(-1);
    setCount2(0);
    setPhase("playing");
  };
  if (React.useEffect(() => {
    stateRef8.current = !0;
    return () => {
      stateRef8.current = !1;
      clearInterval(stateRef6.current);
      clearTimeout(stateRef7.current);
      stateRef10.current.clear();
      stateRef2.current?.dispose();
      stateRef3.current?.dispose();
      x.current?.dispose();
      stateRef.current = !1;
    };
  }, []), !config) return <div style={options.fullscreen} />;
  let value3 = phase === "over";
  return <div style={{...options.container, backgroundColor:'#ffd34d',backgroundImage:`url("${config.BG_PAPER || './assets/yellow-paper-dots-v3.svg'}")`,backgroundSize:'cover'}}>{<style>{`
        @font-face {
          font-family: 'DynaPuff';
          src: url('./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2') format('woff2');
          font-weight: 600;
          font-style: normal;
          font-display: swap;
        }
        :root {
          --ui-unit: min(0.2564102564vw, 0.1672240803vh);
          --font-display: "DynaPuff", "PingFang SC", system-ui, sans-serif;
          --font-body: var(--font-display);
          --font-mono: ui-monospace, Menlo, monospace;
          --primary-color: #20211f;
          --bg-color: #ffd34d;
          --accent-color: #20211f;
        }
        html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; background-color: var(--bg-color); }
        * { box-sizing: border-box; touch-action: none; -webkit-tap-highlight-color: transparent; }
      `}</style>}{<header style={{
      ...options.header,
      position: "relative"
    }}>{<div role={"status"} aria-live={"polite"} aria-atomic={!0} style={{
        position: "absolute",
        left: "calc(30 * var(--ui-unit) + env(safe-area-inset-left, 0px))",
        bottom: "8px",
        display: "flex",
        alignItems: "center",
        height: "calc(33.6 * var(--ui-unit))",
        gap: "calc(4 * var(--ui-unit))"
      }}>{[...Array.from({
          length: 3
        }, (value4, otherValue) => <svg aria-hidden={!0} viewBox={"0 0 24 24"} width={"calc(18 * var(--ui-unit))"} height={"calc(18 * var(--ui-unit))"} style={{
          opacity: otherValue < count4 ? 1 : 0.2
        }} fill={"currentColor"} key={otherValue}>{<path d={"M12 21s-9-5.8-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.2-9 12-9 12Z"} />}</svg>)]}{<span style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap"
        }}>{`${count4} ${count4 === 1 ? "chance" : "chances"} remaining`}</span>}</div>}{<div className="mistake-progress" style={options.levelText}>{count}{"/"}{config.MAX_LEVEL}</div>}{<div role={"timer"} aria-label={"Time remaining"} aria-live={"off"} style={{
        ...options.levelText,
        position: "absolute",
        right: "calc(30 * var(--ui-unit) + env(safe-area-inset-right, 0px))",
        bottom: "8px"
      }}>{count3}{"s"}</div>}</header>}{<main style={options.mainArea}>{<Motion.AnimatePresence mode={"wait"}>{value3 ? <Motion.motion.div initial={{
          opacity: 0,
          y: 20
        }} animate={{
          opacity: 1,
          y: 0
        }} style={options.resultPanel} key={"result"}>{<h2 style={options.resultTitle}>{stateRef5.current.outcome === "win" ? config.VICTORY_TITLE : stateRef5.current.outcome === "time" ? "Time\u2019s up!" : "Out of chances"}</h2>}{<div style={options.btnRow}>{<button style={options.btnPrimary} onClick={handleClick2}>{config.BTN_RESTART}</button>}{value && <button style={{
              ...options.btnSecondary,
              opacity: value2 ? 0.6 : 1
            }} onClick={handleClick} disabled={value2}>{config.BTN_POST}</button>}</div>}</Motion.motion.div> : <Motion.motion.div initial={{
          opacity: 0,
          scale: 0.95
        }} animate={{
          opacity: 1,
          scale: 1
        }} exit={{
          opacity: 0,
          scale: 1.05
        }} transition={{
          duration: 0.2
        }} style={options.gridContainer(computedValue.size)} key={count}>{Array.from({
            length: computedValue.total
          }).map((item, index) => {
            let value4 = index === computedValue.oddIdx;
            let y = index === currentValue;
            return <Motion.motion.div className="mistake-tile" role={"button"} tabIndex={0} aria-label={"Tile " + (index + 1)} onPointerDown={event => {
              if (event.isPrimary === !1) {
                stateRef10.current.add(event.pointerId);
              } else {
                stateRef10.current.delete(event.pointerId);
              }
            }} onPointerCancel={event => stateRef10.current.delete(event.pointerId)} onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!event.repeat) {
                  handleAction5(index);
                }
              }
            }} onClick={value5 => {
              if (value5?.button > 0) return;
              const value6 = value5?.nativeEvent?.pointerId;
              if (stateRef10.current.has(value6)) {
                stateRef10.current.delete(value6);
                return;
              }
              handleAction5(index);
            }} style={options.gridItem(computedValue.size)} animate={y ? {
              x: [-5, 5, -5, 5, 0]
            } : {}} transition={{
              duration: 0.3
            }} whileTap={{
              scale: 0.9
            }} key={`${index}-${y ? count2 : "0"}`}><span className="mistake-emoji" aria-hidden="true">{value4 ? computedValue.odd : computedValue.normal}</span></Motion.motion.div>;
          })}</Motion.motion.div>}</Motion.AnimatePresence>}</main>}{!value3 && <footer style={{
      ...options.footer,
      visibility: currentValue2 ? "hidden" : "visible"
    }} aria-hidden={currentValue2}>{config.SUB_TITLE + " TO START"}</footer>}</div>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root [role=\"button\"]",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root [role=\"button\"]",
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
  const selectors = ["#root footer"];
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
        "data-batch3-game": "28"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "28"
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
