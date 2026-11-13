// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "are you dumb",
    "default": "are you dumb",
    "max_length": 30
  }, {
    "id": "START_BTN",
    "label": "Start Button",
    "value": "Start Test",
    "default": "Start Test",
    "max_length": 15
  }, {
    "id": "HUD_QUESTION",
    "label": "HUD Question Label",
    "value": "Question",
    "default": "Question",
    "max_length": 15
  }, {
    "id": "HUD_SCORE",
    "label": "HUD Score Label",
    "value": "Score",
    "default": "Score",
    "max_length": 10
  }, {
    "id": "Q1_TEXT",
    "label": "Q1 Text",
    "value": "Some months have 31 days, others have 30 days. How many have 28 days?",
    "default": "Some months have 31 days, others have 30 days. How many have 28 days?",
    "max_length": 150
  }, {
    "id": "Q1_O0",
    "label": "Q1 Option 1",
    "value": "1",
    "default": "1",
    "max_length": 30
  }, {
    "id": "Q1_O1",
    "label": "Q1 Option 2",
    "value": "6",
    "default": "6",
    "max_length": 30
  }, {
    "id": "Q1_O2",
    "label": "Q1 Option 3",
    "value": "12",
    "default": "12",
    "max_length": 30
  }, {
    "id": "Q1_O3",
    "label": "Q1 Option 4",
    "value": "Depends on leap year",
    "default": "Depends on leap year",
    "max_length": 30
  }, {
    "id": "Q1_A",
    "label": "Q1 Correct Index (0-3)",
    "value": "2",
    "default": "2",
    "max_length": 1
  }, {
    "id": "Q1_EXP",
    "label": "Q1 Explanation",
    "value": "All 12 months have at least 28 days!",
    "default": "All 12 months have at least 28 days!",
    "max_length": 100
  }, {
    "id": "Q2_TEXT",
    "label": "Q2 Text",
    "value": "What has a head and a tail, but no body?",
    "default": "What has a head and a tail, but no body?",
    "max_length": 150
  }, {
    "id": "Q2_O0",
    "label": "Q2 Option 1",
    "value": "A snake",
    "default": "A snake",
    "max_length": 30
  }, {
    "id": "Q2_O1",
    "label": "Q2 Option 2",
    "value": "A coin",
    "default": "A coin",
    "max_length": 30
  }, {
    "id": "Q2_O2",
    "label": "Q2 Option 3",
    "value": "A comet",
    "default": "A comet",
    "max_length": 30
  }, {
    "id": "Q2_O3",
    "label": "Q2 Option 4",
    "value": "A river",
    "default": "A river",
    "max_length": 30
  }, {
    "id": "Q2_A",
    "label": "Q2 Correct Index (0-3)",
    "value": "1",
    "default": "1",
    "max_length": 1
  }, {
    "id": "Q2_EXP",
    "label": "Q2 Explanation",
    "value": "A coin has a 'heads' side and a 'tails' side.",
    "default": "A coin has a 'heads' side and a 'tails' side.",
    "max_length": 100
  }, {
    "id": "Q3_TEXT",
    "label": "Q3 Text",
    "value": "If you are running in a race and you pass the person in second place, what place are you in?",
    "default": "If you are running in a race and you pass the person in second place, what place are you in?",
    "max_length": 150
  }, {
    "id": "Q3_O0",
    "label": "Q3 Option 1",
    "value": "First place",
    "default": "First place",
    "max_length": 30
  }, {
    "id": "Q3_O1",
    "label": "Q3 Option 2",
    "value": "Second place",
    "default": "Second place",
    "max_length": 30
  }, {
    "id": "Q3_O2",
    "label": "Q3 Option 3",
    "value": "Third place",
    "default": "Third place",
    "max_length": 30
  }, {
    "id": "Q3_O3",
    "label": "Q3 Option 4",
    "value": "Last place",
    "default": "Last place",
    "max_length": 30
  }, {
    "id": "Q3_A",
    "label": "Q3 Correct Index (0-3)",
    "value": "1",
    "default": "1",
    "max_length": 1
  }, {
    "id": "Q3_EXP",
    "label": "Q3 Explanation",
    "value": "You took their spot, so now you are in second place.",
    "default": "You took their spot, so now you are in second place.",
    "max_length": 100
  }, {
    "id": "Q4_TEXT",
    "label": "Q4 Text",
    "value": "What has keys but can't open locks?",
    "default": "What has keys but can't open locks?",
    "max_length": 150
  }, {
    "id": "Q4_O0",
    "label": "Q4 Option 1",
    "value": "A piano",
    "default": "A piano",
    "max_length": 30
  }, {
    "id": "Q4_O1",
    "label": "Q4 Option 2",
    "value": "A treasure chest",
    "default": "A treasure chest",
    "max_length": 30
  }, {
    "id": "Q4_O2",
    "label": "Q4 Option 3",
    "value": "A map",
    "default": "A map",
    "max_length": 30
  }, {
    "id": "Q4_O3",
    "label": "Q4 Option 4",
    "value": "A door",
    "default": "A door",
    "max_length": 30
  }, {
    "id": "Q4_A",
    "label": "Q4 Correct Index (0-3)",
    "value": "0",
    "default": "0",
    "max_length": 1
  }, {
    "id": "Q4_EXP",
    "label": "Q4 Explanation",
    "value": "A piano has musical keys, but no physical locks.",
    "default": "A piano has musical keys, but no physical locks.",
    "max_length": 100
  }, {
    "id": "FB_CORRECT",
    "label": "Feedback Correct Text",
    "value": "Correct!",
    "default": "Correct!",
    "max_length": 15
  }, {
    "id": "FB_WRONG",
    "label": "Feedback Wrong Text",
    "value": "Wrong!",
    "default": "Wrong!",
    "max_length": 15
  }, {
    "id": "BTN_NEXT",
    "label": "Next Button",
    "value": "Next",
    "default": "Next",
    "max_length": 10
  }, {
    "id": "RES_TITLE",
    "label": "Result Title",
    "value": "Test Complete!",
    "default": "Test Complete!",
    "max_length": 25
  }, {
    "id": "RES_PERFECT",
    "label": "Result Perfect Comment",
    "value": "Wow, you're actually smart!",
    "default": "Wow, you're actually smart!",
    "max_length": 50
  }, {
    "id": "RES_NORMAL",
    "label": "Result Normal Comment",
    "value": "Well... at least you tried.",
    "default": "Well... at least you tried.",
    "max_length": 50
  }, {
    "id": "RESTART_BTN",
    "label": "Restart Button",
    "value": "Restart Test",
    "default": "Restart Test",
    "max_length": 20
  }, {
    "id": "POST_BTN",
    "label": "Post My Play Button",
    "value": "Post My Play",
    "default": "Post My Play",
    "max_length": 20
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
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
    .screen-container { padding: 40px 25px !important; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}


.screen-container{padding:30px 30px 50px!important}@media(max-height:560px){.btn-option{min-height:44px;padding:8px 12px!important;margin-bottom:8px!important;font-size:16px!important;line-height:1.25!important}.btn-option:last-child{margin-bottom:0!important}.screen-container>div:last-child{padding-bottom:0!important}.screen-container h2{margin-bottom:12px!important;font-size:24px!important}}

@font-face{font-family:'PaperType';src:url('./assets/fonts/special-elite/SpecialElite-Regular.ttf') format('truetype');font-style:normal;font-weight:400;font-display:swap}
:root:root{--font-display:'PaperType',Georgia,serif;--font-body:'PaperType',Georgia,serif;--font-mono:'PaperType',Georgia,serif;--ink:#282725}

html,body,#root{background:#e9a06f!important;color:#282725!important}
.screen-container{background:#e9a06f url('./assets/paper-grain.svg') repeat!important;color:#282725!important}
.screen-container>div:first-child{color:#35332d!important;font-family:'PaperType',Georgia,serif!important}
.screen-container h2{color:#282725!important;font:400 clamp(22px,6.3cqi,27px)/1.27 'PaperType',Georgia,serif!important;letter-spacing:-.02em}
.screen-container .btn-option{background:#fff6da!important;color:#282725!important;border:1.8px solid #282725!important;border-radius:3px 5px 3px 5px!important;box-shadow:2px 3px 0 #282725!important;font:400 clamp(16px,4.3cqi,18px)/1.25 'PaperType',Georgia,serif!important;padding:12px 16px!important;min-height:46px;margin-bottom:10px!important}
.screen-container .btn-option:nth-child(2){background:#e7e76e!important}.screen-container .btn-option:nth-child(3){background:#aec9d5!important}.screen-container .btn-option:nth-child(4){background:#e8c9cd!important}
.quiz-screen>div:nth-child(2){flex:0 1 auto!important;margin-top:auto;min-height:0}
.quiz-screen>div:nth-child(3){margin-bottom:auto}
.screen-container .btn-option:active{transform:translate(2px,3px);box-shadow:none!important}
.screen-container .btn-black,.screen-container button:not(.btn-option){font-family:'PaperType',Georgia,serif!important}
.screen-container .btn-black{background:#e7e76e!important;color:#282725!important;border:2px solid #282725!important;border-radius:4px 6px 4px 5px!important;box-shadow:2px 3px 0 #282725!important;font-weight:400!important}

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
function _V(config) {
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
var destination = Tone.getContext().destination;
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
  let submitRecording = React.useCallback(() => {
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
  }, [submitting, canSubmit]);
  return {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: submitRecording
  };
}
function GameXV() {
  return <style>{`
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
      --color-bg: #ffffff;
      --color-text: #000000;
      --color-gray: #f0f0f0;
      --color-gray-dark: #888888;
      --color-correct: #10b981;
      --color-wrong: #ef4444;
    }
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: var(--color-bg);
      color: var(--color-text);
      font-family: var(--font-body);
      -webkit-font-smoothing: antialiased;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
    }
    * {
      box-sizing: border-box;
      touch-action: pan-y;
    }
    
    .btn-black {
      background: var(--color-text);
      color: var(--color-bg);
      border: none;
      padding: clamp(12px, 4cqi, 20px) clamp(24px, 8cqi, 40px);
      font-size: clamp(16px, 5cqi, 24px);
      border-radius: 12px;
      font-weight: 700;
      font-family: var(--font-display);
      cursor: pointer;
      width: 100%;
      max-width: 320px;
      display: flex;
      justify-content: center;
      align-items: center;
      transition: transform 0.1s;
    }
    .btn-black:active {
      transform: scale(0.96);
    }
    .btn-black:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .btn-option {
      background: var(--color-bg);
      color: var(--color-text);
      border: 3px solid var(--color-text);
      padding: 16px;
      font-size: clamp(14px, 4.5cqi, 18px);
      border-radius: 12px;
      font-weight: 700;
      font-family: var(--font-body);
      cursor: pointer;
      width: 100%;
      text-align: left;
      margin-bottom: 12px;
      transition: all 0.1s;
    }
    .btn-option:active {
      background: var(--color-text);
      color: var(--color-bg);
    }
    
    .screen-container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: clamp(20px, 6cqi, 40px);
      container-type: inline-size;
      position: absolute;
      inset: 0;
    }
  `}</style>;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("playing");
  let [count, setCount] = React.useState(0);
  let [count2, setCount2] = React.useState(0);
  let [currentValue, setCurrentValue] = React.useState(-1);
  let stateRef = React.useRef(!1);
  let stateRef2 = React.useRef(null);
  React.useEffect(() => {
    let value4 = !0;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value5 = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (value5.ok) {
          options = await value5.json();
        }
      } catch {}
      if (value4) {
        setConfig(_V(options));
      }
    })();
    return () => {
      value4 = !1;
    };
  }, []);
  let callback = React.useCallback(async () => {
    if (!stateRef.current) try {
      await Tone.start();
      stateRef2.current = new Tone.Synth().toDestination();
      destination.volume.value = -10;
      stateRef.current = !0;
    } catch (value4) {
      console.warn("Audio init failed", value4);
    }
  }, []);
  let callback2 = React.useCallback(value4 => {
    if (!stateRef2.current) return;
    let timestamp = Tone.now();
    if (value4 === "tap") {
      stateRef2.current.triggerAttackRelease("C4", "16n", timestamp);
    } else {
      if (value4 === "correct") {
        stateRef2.current.triggerAttackRelease("C5", "8n", timestamp);
      } else {
        if (value4 === "wrong") {
          stateRef2.current.triggerAttackRelease("G2", "8n", timestamp);
        }
      }
    }
  }, []);
  let computedValue = React.useMemo(() => config ? [{
    text: config.Q1_TEXT,
    options: [config.Q1_O0, config.Q1_O1, config.Q1_O2, config.Q1_O3],
    answer: parseInt(config.Q1_A),
    exp: config.Q1_EXP
  }, {
    text: config.Q2_TEXT,
    options: [config.Q2_O0, config.Q2_O1, config.Q2_O2, config.Q2_O3],
    answer: parseInt(config.Q2_A),
    exp: config.Q2_EXP
  }, {
    text: config.Q3_TEXT,
    options: [config.Q3_O0, config.Q3_O1, config.Q3_O2, config.Q3_O3],
    answer: parseInt(config.Q3_A),
    exp: config.Q3_EXP
  }, {
    text: config.Q4_TEXT,
    options: [config.Q4_O0, config.Q4_O1, config.Q4_O2, config.Q4_O3],
    answer: parseInt(config.Q4_A),
    exp: config.Q4_EXP
  }] : [], [config]);
  let x = async () => {
    await callback();
    callback2("tap");
    setPhase("playing");
    setCount(0);
    setCount2(0);
  };
  let handleAction = value4 => {
    if (phase !== "playing") return;
    void callback();
    setCurrentValue(value4);
    if (value4 === computedValue[count].answer) {
      callback2("correct");
      setCount2(value5 => value5 + 1);
    } else {
      callback2("wrong");
    }
    setPhase("feedback");
  };
  let handleClick = () => {
    callback2("tap");
    if (count < computedValue.length - 1) {
      setCount(count + 1);
      setCurrentValue(-1);
      setPhase("playing");
    } else {
      setPhase("result");
    }
  };
  let handleClick2 = () => {
    callback2("tap");
    setPhase("playing");
    setCount(0);
    setCount2(0);
    setCurrentValue(-1);
  };
  let {
    canSubmit: y,
    submitting: value,
    submitRecording: handleClick3
  } = useGameFeature1();
  if (!config) return <div style={{
    width: "100%",
    height: "100%",
    background: "#fff"
  }} />;
  let value2 = computedValue[count] || {};
  let value3 = currentValue === value2.answer;
  return <div style={{
    width: "100%",
    height: "100%",
    position: "relative"
  }}>{<GameXV />}{<Motion.AnimatePresence mode={"wait"}>{null}{(phase === "playing" || phase === "feedback") && <Motion.motion.div className={"screen-container quiz-screen"} initial={{
        opacity: 0,
        x: 20
      }} animate={{
        opacity: 1,
        x: 0
      }} exit={{
        opacity: 0,
        x: -20
      }} transition={{
        duration: 0.3
      }} key={`q-${count}`}>{<div style={{
          flex: "0 0 auto",
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "20px",
          fontWeight: 700,
          color: "var(--color-gray-dark)"
        }}>{<span aria-label={"Question " + (count + 1) + " of " + computedValue.length} style={{
            fontSize: "28px",
            lineHeight: 1.2
          }}>{count + 1}{"/"}{computedValue.length}</span>}{<span aria-label={"Score " + count2} style={{
            fontSize: "28px",
            lineHeight: 1.2
          }}>{count2}</span>}</div>}{<div style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          paddingBottom: "20px"
        }}>{<h2 style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(24px, 7cqi, 36px)",
            lineHeight: 1.3,
            margin: "0 0 24px 0"
          }}>{value2.text}</h2>}</div>}{<div style={{
          flex: "0 0 auto",
          paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))"
        }}>{phase === "playing" ? <div style={{
            display: "flex",
            flexDirection: "column"
          }}>{value2.options.map((item, index) => <button className={"btn-option"} onClick={() => handleAction(index)} key={index}>{item}</button>)}</div> : <Motion.motion.div initial={{
            opacity: 0,
            y: 20
          }} animate={{
            opacity: 1,
            y: 0
          }} style={{
            background: value3 ? "var(--color-correct)" : "var(--color-wrong)",
            color: "#fff",
            padding: "24px",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "16px"
          }}>{<h3 style={{
              margin: 0,
              fontSize: "24px"
            }}>{value3 ? config.FB_CORRECT : config.FB_WRONG}</h3>}{<p style={{
              margin: 0,
              fontSize: "16px",
              lineHeight: 1.5,
              opacity: 0.9
            }}>{value2.exp}</p>}{<button onClick={handleClick} style={{
              background: "#fff",
              color: "#000",
              border: "none",
              padding: "12px",
              borderRadius: "8px",
              fontWeight: 700,
              fontSize: "16px",
              marginTop: "8px",
              cursor: "pointer"
            }}>{config.BTN_NEXT}</button>}</Motion.motion.div>}</div>}</Motion.motion.div>}{phase === "result" && <Motion.motion.div className={"screen-container"} style={{
        justifyContent: "center",
        alignItems: "center",
        gap: "32px"
      }} initial={{
        opacity: 0
      }} animate={{
        opacity: 1
      }} transition={{
        duration: 0.4
      }} key={"result"}>{<div style={{
          textAlign: "center"
        }}>{<h2 style={{
            fontSize: "32px",
            margin: "0 0 16px 0"
          }}>{config.RES_TITLE}</h2>}{<div style={{
            fontSize: "64px",
            fontWeight: 900,
            fontFamily: "var(--font-display)",
            marginBottom: "16px"
          }}>{count2}{" / "}{computedValue.length}</div>}{<p style={{
            fontSize: "20px",
            color: "var(--color-gray-dark)",
            margin: 0
          }}>{count2 === computedValue.length ? config.RES_PERFECT : config.RES_NORMAL}</p>}</div>}{<div style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          width: "100%",
          alignItems: "center"
        }}>{<button className={"btn-black"} onClick={handleClick2}>{config.RESTART_BTN}</button>}{y && <button className={"btn-black"} style={{
            background: "transparent",
            color: "var(--color-text)",
            border: "2px solid var(--color-text)"
          }} disabled={value} onClick={handleClick3}>{config.POST_BTN}</button>}</div>}</Motion.motion.div>}</Motion.AnimatePresence>}</div>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": ".btn-option",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": ".btn-option",
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

// Game helper

/* Batch 3 entry polish. Preview covers are still images in the feed. */
(() => {
  'use strict';

  const number = Number({
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "",
        "data-batch3-game": "11"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "11"
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
