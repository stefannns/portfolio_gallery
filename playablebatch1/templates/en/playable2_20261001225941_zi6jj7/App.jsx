// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "CODE_LENGTH",
    "kind": "number",
    "label": "Code Length",
    "value": 8,
    "default": 8,
    "min": 3,
    "max": 8,
    "step": 1
  }, {
    "id": "MAX_ATTEMPTS",
    "kind": "number",
    "label": "Max Attempts",
    "value": 11,
    "default": 11,
    "min": 3,
    "max": 11,
    "step": 1
  }, {
    "id": "ALLOW_DUPLICATES",
    "kind": "boolean",
    "label": "Allow Duplicate Digits",
    "value": true,
    "default": true
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "CRACK THE CODE",
    "default": "CRACK THE CODE",
    "max_length": 20
  }, {
    "id": "BTN_GUESS",
    "label": "Guess Button Text",
    "value": "GUESS",
    "default": "GUESS",
    "max_length": 10
  }, {
    "id": "MSG_WIN",
    "label": "Win Message",
    "value": "CODE CRACKED!",
    "default": "CODE CRACKED!",
    "max_length": 30
  }, {
    "id": "MSG_LOSE",
    "label": "Lose Message",
    "value": "ACCESS DENIED",
    "default": "ACCESS DENIED",
    "max_length": 30
  }, {
    "id": "BTN_RESTART",
    "label": "Restart Button Text",
    "value": "PLAY AGAIN",
    "default": "PLAY AGAIN",
    "max_length": 15
  }, {
    "id": "BTN_POST",
    "label": "Post Button Text",
    "value": "Post My Play",
    "default": "Post My Play",
    "max_length": 15
  }],
  "images": [{
    "id": "BG_MAIN",
    "label": "Optional Background Overlay",
    "path": "./assets/bg_overlay.webp",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "99279099402845675",
    "version_id": "99279099402698785",
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
    #root > div > main > div > div {
      padding-left: 0 !important;
      padding-right: 0 !important;
    }
    #root > div > main + div {
      padding-left: calc(30px + env(safe-area-inset-left, 0px)) !important;
      padding-right: calc(30px + env(safe-area-inset-right, 0px)) !important;
    }
    #code-color-legend {
      width: 100%;
      max-width: 500px;
      margin: 16px auto 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
      color: #f4f4f5;
      font: 400 18px/1.4 var(--font-body, system-ui, sans-serif);
      letter-spacing: 0;
      text-align: left;
    }
    .code-color-key {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .code-color-key > span:last-child { min-width: 0; overflow-wrap: anywhere; }
    .code-color-swatch {
      flex: 0 0 12px;
      width: 12px;
      height: 12px;
      border-radius: 3px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
    }
    #root > div > header > h1 { line-height: 1.2 !important; letter-spacing: 0; }
    main[aria-label="Guess history"] { padding-top: 16px !important; }
    main[aria-label="Guess history"] > div { gap: 8px !important; }
    main[aria-label="Guess history"] > div > div {
      flex-basis: 38px !important;
      min-height: 38px !important;
    }
    main[aria-label="Guess history"] > div > div > div {
      height: 38px !important;
      min-height: 38px !important;
      min-width: 0;
      font-family: var(--font-mono) !important;
      font-size: 20px !important;
      line-height: 1 !important;
    }
    [role="dialog"] > div {
      max-width: 360px !important;
      padding: 24px 16px !important;
    }
    [role="dialog"] h2 { text-wrap: balance; }
    [role="dialog"] p { line-height: 1.5 !important; }
    [role="dialog"] > div > div:not(:last-child) {
      font-size: 28px !important;
      letter-spacing: .035em !important;
      line-height: 1.4;
      font-variant-numeric: tabular-nums;
    }
    [role="dialog"] button { line-height: 1.4; overflow-wrap: anywhere; }
    #root > div > main + div button { line-height: 1.2; letter-spacing: 0; }
    button:focus-visible { outline: 3px solid #ffcf69; outline-offset: 3px; }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  

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
for (const value3 of ['playable-inline-config', 'playable-config-inline']) {
  const node = document.createElement('script');
  node.id = value3;
  node.type = 'application/json';
  node.textContent = JSON.stringify(DEFAULT_CONFIG);
  document.body.append(node);
}
document.documentElement.lang = 'en';
var root2 = ReactDOM.createRoot(document.getElementById("root"));
function SV(value3, otherValue) {
  let label = "";
  let value4 = "0123456789".split("");
  for (let value5 = 0; value5 < value3; value5++) if (otherValue) label += value4[Math.floor(Math.random() * 10)];else {
    let value6 = Math.floor(Math.random() * value4.length);
    label += value4[value6];
    value4.splice(value6, 1);
  }
  return label;
}
var value = class {
  constructor() {
    this.ready = !1;
    this.synth = null;
    this.polySynth = null;
  }
  async init() {
    if (!this.ready) {
      await Tone.start();
      this.synth = new Tone.Synth({
        oscillator: {
          type: "sine"
        },
        envelope: {
          attack: 0.01,
          decay: 0.1,
          sustain: 0,
          release: 0.1
        }
      }).toDestination();
      this.synth.volume.value = -12;
      this.polySynth = new Tone.PolySynth(Tone.Synth).toDestination();
      this.polySynth.volume.value = -10;
      this.ready = !0;
    }
  }
  playTap() {
    try {
      const value3 = window.AudioContext || window.webkitAudioContext;
      if (!value3) return;
      const value4 = this.tapCtx || (this.tapCtx = new value3());
      const oscillator = value4.createOscillator();
      const gain = value4.createGain();
      const currentTime = value4.currentTime;
      oscillator.frequency.value = 640;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.035, currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.055);
      oscillator.connect(gain);
      gain.connect(value4.destination);
      oscillator.start(currentTime);
      oscillator.stop(currentTime + 0.06);
    } catch {}
  }
  playSubmit() {
    if (this.ready) {
      this.synth.triggerAttackRelease("G4", "16n");
    }
  }
  playWin() {
    if (!this.ready) return;
    let timestamp = Tone.now();
    this.polySynth.triggerAttackRelease(["C4", "E4", "G4", "C5"], "4n", timestamp);
  }
  playLose() {
    if (!this.ready) return;
    let timestamp = Tone.now();
    this.polySynth.triggerAttackRelease(["C4", "Eb4", "Gb4"], "2n", timestamp);
  }
};
var value2 = new value();
function Ea(style = "light") {
  try {
    if (typeof window !== "undefined" && window.tt && window.tt.vibrate) {
      window.tt.vibrate({
        style: style
      });
    }
  } catch {}
}
function GameWV() {
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
      --bg-color: #1c1c1e;
      --board-bg: #2c2c2e;
      --cell-empty: #3a3a3c;
      --cell-border: #48484a;
      --key-bg: #c7c7cc;
      --key-text: #000000;
      --color-correct: #34c759;
      --color-present: #ff9f0a;
      --color-absent: #3a3a3c;
      --text-main: #ffffff;
    }
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: var(--bg-color);
      font-family: var(--font-body);
      color: var(--text-main);
      user-select: none;
      -webkit-user-select: none;
    }
    * {
      box-sizing: border-box;
      touch-action: pan-x pan-y;
    }
    /* Prevent pull-to-refresh on mobile */
    body { overscroll-behavior-y: contain; }
  `}</style>;
}
function TV(value3, otherValue) {
  let value4 = Array(value3.length).fill("absent");
  let value5 = Array(otherValue.length).fill(!1);
  let value6 = Array(value3.length).fill(!1);
  for (let value7 = 0; value7 < value3.length; value7++) {
    if (value3[value7] === otherValue[value7]) {
      value4[value7] = "correct";
      value5[value7] = !0;
      value6[value7] = !0;
    }
  }
  for (let value7 = 0; value7 < value3.length; value7++) if (!value6[value7]) {
    for (let value8 = 0; value8 < otherValue.length; value8++) if (!value5[value8] && value3[value7] === otherValue[value8]) {
      value4[value7] = "present";
      value5[value8] = !0;
      break;
    }
  }
  return value4;
}
function GameKV({
  char: t,
  status: e,
  isActive: r
}) {
  let backgroundColor = "var(--cell-empty)";
  if (e === "correct") {
    backgroundColor = "var(--color-correct)";
  }
  if (e === "present") {
    backgroundColor = "var(--color-present)";
  }
  if (e === "absent") {
    backgroundColor = "var(--color-absent)";
  }
  return <Motion.motion.div initial={!1} animate={{
    backgroundColor: backgroundColor,
    scale: r ? 1.05 : 1,
    borderColor: r ? "#fff" : "var(--cell-border)"
  }} transition={{
    type: "spring",
    stiffness: 300,
    damping: 20
  }} style={{
    flex: 1,
    aspectRatio: "auto",
    height: "32px",
    minHeight: "32px",
    maxWidth: "52px",
    border: "2px solid",
    borderRadius: "3px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "20px",
    lineHeight: 1,
    fontWeight: "bold",
    fontFamily: "var(--font-display)",
    color: "#fff",
    margin: "0 auto"
  }}>{t}</Motion.motion.div>;
}
function GameBV({
  guess: t = [],
  secretCode: e,
  codeLength: r,
  isCurrent: n
}) {
  let value3 = t && !n ? TV(t, e) : [];
  let items = [];
  for (let value4 = 0; value4 < r; value4++) items.push(<GameKV char={t[value4] || ""} status={value3[value4]} isActive={n && t.length === value4} key={value4} />);
  return <div style={{
    display: "flex",
    gap: "4px",
    justifyContent: "center",
    width: "100%",
    flex: "0 0 32px",
    minHeight: 32
  }}>{items}</div>;
}
function CV({
  onKeyPress: t,
  codeLength: e,
  currentGuessLength: r
}) {
  let items = [["1", "2", "3", "4", "5"], ["6", "7", "8", "9", "0"]];
  let handleAction = value3 => {
    t(value3);
    value2.init().catch(() => {});
  };
  return <div style={{
    flex: "0 0 auto",
    padding: "clamp(8px, 2cqi, 16px)",
    backgroundColor: "var(--board-bg)",
    borderTopLeftRadius: "16px",
    borderTopRightRadius: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    paddingBottom: "calc(50px + env(safe-area-inset-bottom, 0px))"
  }}>{items.map((item, index) => <div style={{
      display: "flex",
      gap: "8px",
      justifyContent: "center"
    }} key={index}>{item.map(item2 => <Motion.motion.button whileTap={{
        scale: 0.9
      }} onClick={() => handleAction(item2)} style={{
        flex: 1,
        height: "48px",
        borderRadius: "8px",
        border: "none",
        backgroundColor: "var(--key-bg)",
        color: "var(--key-text)",
        fontFamily: "var(--font-display)",
        fontSize: "clamp(20px, 5cqi, 28px)",
        fontWeight: "bold",
        cursor: "pointer"
      }} key={item2}>{item2}</Motion.motion.button>)}</div>)}{<div style={{
      display: "flex",
      gap: "8px",
      justifyContent: "center"
    }}>{<Motion.motion.button whileTap={{
        scale: 0.9
      }} onClick={() => handleAction("Backspace")} style={{
        flex: "0 0 60px",
        height: "48px",
        borderRadius: "8px",
        border: "none",
        backgroundColor: "var(--key-bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer"
      }}>{<svg width={"24"} height={"24"} viewBox={"0 0 24 24"} fill={"none"} stroke={"var(--key-text)"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>{<path d={"M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"} />}{<line x1={"18"} y1={"9"} x2={"12"} y2={"15"} />}{<line x1={"12"} y1={"9"} x2={"18"} y2={"15"} />}</svg>}</Motion.motion.button>}{<Motion.motion.button whileTap={{
        scale: 0.95
      }} onClick={() => handleAction("Enter")} disabled={r < e} style={{
        flex: 1,
        height: "48px",
        borderRadius: "8px",
        border: "none",
        backgroundColor: r === e ? "var(--text-main)" : "var(--key-bg)",
        color: r === e ? "#000" : "rgba(0,0,0,0.3)",
        fontFamily: "var(--font-display)",
        fontSize: "clamp(16px, 4cqi, 20px)",
        fontWeight: "bold",
        cursor: r === e ? "pointer" : "not-allowed",
        transition: "background-color 0.2s, color 0.2s"
      }}>{"GUESS"}</Motion.motion.button>}</div>}</div>;
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
          fail(value3) {
            console.error("[post_my_play] playableRecordingSubmission failed", value3 && (value3.errMsg || value3.message));
            setSubmitting(!1);
          },
          complete() {}
        });
      }
    }
  };
}
function EV({
  gameState: t,
  config: e,
  onRestart: r,
  secretCode: code
}) {
  let {
    canSubmit: value3,
    submitting: value4,
    submitRecording: handleClick
  } = useGameFeature1();
  let value5 = t === "won";
  return <div role={"dialog"} aria-modal={!0} aria-label={value5 ? "Code cracked" : "Access denied"} style={{
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.85)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    padding: "calc(30px + env(safe-area-inset-top, 0px)) 30px calc(50px + env(safe-area-inset-bottom, 0px))",
    overflowY: "auto"
  }}>{<Motion.motion.div initial={{
      scale: 0.8,
      y: 20
    }} animate={{
      scale: 1,
      y: 0
    }} style={{
      backgroundColor: "var(--board-bg)",
      padding: "clamp(24px, 6cqi, 40px)",
      borderRadius: "24px",
      textAlign: "center",
      width: "100%",
      maxWidth: "400px",
      boxShadow: "0 20px 40px rgba(0,0,0,0.5)"
    }}>{<h2 style={{
        margin: "0 0 16px 0",
        fontFamily: "var(--font-display)",
        fontSize: 24,
        lineHeight: 1.25,
        overflowWrap: "anywhere",
        color: value5 ? "var(--color-correct)" : "var(--color-present)"
      }}>{value5 ? e.MSG_WIN || "CODE CRACKED!" : e.MSG_LOSE || "ACCESS DENIED"}</h2>}{<p role={"status"} aria-live={"assertive"} style={{
        margin: "0 0 12px",
        fontSize: 18,
        lineHeight: 1.35,
        color: "#fff"
      }}>{value5 ? "All digits matched." : "The code was:"}</p>}{<div style={{
        fontFamily: "var(--font-mono)",
        fontSize: 28,
        letterSpacing: ".12em",
        color: "#fff",
        overflowWrap: "anywhere"
      }}>{code}</div>}{<div style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        marginTop: "24px"
      }}>{<Motion.motion.button whileTap={{
          scale: 0.95
        }} autoFocus={!0} onClick={() => {
          Ea("light");
          r();
        }} style={{
          width: "100%",
          padding: "16px",
          borderRadius: "12px",
          border: "none",
          backgroundColor: "var(--text-main)",
          color: "#000",
          fontFamily: "var(--font-display)",
          fontSize: "18px",
          fontWeight: "bold",
          cursor: "pointer"
        }}>{e.BTN_RESTART}</Motion.motion.button>}{value3 && <Motion.motion.button whileTap={{
          scale: value4 ? 1 : 0.95
        }} onClick={handleClick} disabled={value4} style={{
          width: "100%",
          padding: "16px",
          borderRadius: "12px",
          backgroundColor: "transparent",
          color: "var(--text-main)",
          border: "2px solid var(--text-main)",
          fontFamily: "var(--font-display)",
          fontSize: "18px",
          fontWeight: "bold",
          cursor: value4 ? "not-allowed" : "pointer",
          opacity: value4 ? 0.5 : 1
        }}>{e.BTN_POST}</Motion.motion.button>}</div>}</Motion.motion.div>}</div>;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [selection, setSelection] = React.useState("");
  let [items, setItems] = React.useState([]);
  let [selection2, setSelection2] = React.useState("");
  let [phase, setPhase] = React.useState("playing");
  let roundRef = React.useRef({
    guess: "",
    attempts: [],
    state: "playing"
  });
  let boardRef = React.useRef(null);
  React.useEffect(() => {
    let value5 = !0;
    (async () => {
      let x = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value6 = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (value6.ok) {
          x = await value6.json();
        }
      } catch {
        console.warn("Config fetch failed, using defaults");
      }
      let options = {};
      (x.tweaks || []).forEach(item => {
        options[item.id] = item.value;
      });
      (x.texts || []).forEach(item => {
        options[item.id] = item.value;
      });
      (x.images || []).forEach(item => {
        options[item.id] = item.path;
      });
      (x.mentions || []).forEach(item => {
        options[item.id] = item.path != null && item.path !== "" ? item.path : item.value;
      });
      (x.motions || []).forEach(item => {
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
      if (value5) {
        setConfig(options);
      }
    })();
    return () => {
      value5 = !1;
    };
  }, []);
  let callback = React.useCallback(config2 => {
    let x = config2.CODE_LENGTH || 8;
    let value5 = config2.ALLOW_DUPLICATES !== !1;
    roundRef.current = {
      guess: "",
      attempts: [],
      state: "playing"
    };
    setSelection(SV(x, value5));
    setItems([]);
    setSelection2("");
    setPhase("playing");
  }, []);
  React.useEffect(() => {
    if (config && !selection) {
      callback(config);
    }
  }, [config, callback, selection]);
  let handleKeyPress = React.useCallback(value5 => {
    if (!config || !selection || roundRef.current.state !== "playing") return;
    const game = roundRef.current;
    const length = config.CODE_LENGTH || 8;
    const limit = config.MAX_ATTEMPTS || 11;
    if (value5 === "Backspace") {
      game.guess = game.guess.slice(0, -1);
      setSelection2(game.guess);
      try {
        value2.playTap();
      } catch {}
      ;
      Ea("light");
      return;
    }
    if (value5 === "Enter") {
      if (game.guess.length !== length) return;
      const submitted = game.guess;
      game.attempts = [...game.attempts, submitted];
      game.guess = "";
      game.state = submitted === selection ? "won" : game.attempts.length >= limit ? "lost" : "playing";
      setItems(game.attempts);
      setSelection2("");
      setPhase(game.state);
      Ea(game.state === "won" ? "notification_success" : game.state === "lost" ? "notification_error" : "medium");
      try {
        if (game.state === "won") {
          value2.playWin();
        } else {
          if (game.state === "lost") {
            value2.playLose();
          } else {
            value2.playSubmit();
          }
        }
      } catch {}
      ;
      return;
    }
    if (/^[0-9]$/.test(value5) && game.guess.length < length) {
      game.guess += value5;
      setSelection2(game.guess);
      try {
        value2.playTap();
      } catch {}
      ;
      Ea("light");
    }
  }, [config, selection]);
  React.useEffect(() => {
    const onKey = event => {
      if (/^[0-9]$/.test(event.key) || event.key === "Backspace" || event.key === "Enter") {
        if (event.target?.tagName === "BUTTON" && event.key === "Enter") return;
        event.preventDefault();
        handleKeyPress(event.key);
        value2.init().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleKeyPress]);
  React.useEffect(() => {
    const board = boardRef.current;
    if (board) board.scrollTop = board.scrollHeight;
  }, [items.length]);
  if (!config) return <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#1c1c1e"
  }} />;
  let value3 = config.CODE_LENGTH || 8;
  let value4 = config.MAX_ATTEMPTS || 11;
  return <div style={{
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    containerType: "inline-size"
  }}>{<GameWV />}{<header style={{
      flex: "0 0 auto",
      padding: "calc(30px + env(safe-area-inset-top, 0px)) 30px 8px",
      textAlign: "center"
    }}>{<h1 style={{
        margin: 0,
        fontFamily: "var(--font-display)",
        fontSize: 28,
        lineHeight: 1.15,
        fontVariantNumeric: "tabular-nums",
        fontWeight: 700,
        color: "#fff"
      }}>{Math.min(items.length + 1, value4) + "/" + value4}</h1>}</header>}{<main ref={boardRef} aria-label={"Guess history"} style={{
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "flex-start",
      padding: "6px 30px 10px",
      overflowY: "auto",
      overscrollBehavior: "contain"
    }}>{<div style={{
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        gap: "5px",
        width: "100%",
        maxWidth: "500px"
      }}>{Array.from({
          length: Math.min(value4, items.length + 1)
        }).map((item, x) => {
          let value5 = x === items.length;
          let value6 = value5 ? selection2 : items[x];
          return <GameBV guess={value6} secretCode={selection} codeLength={value3} isCurrent={value5} key={x} />;
        })}</div>}</main>}{<CV onKeyPress={handleKeyPress} codeLength={value3} currentGuessLength={selection2.length} />}{<Motion.AnimatePresence>{phase !== "playing" && <EV gameState={phase} config={config} secretCode={selection} onRestart={() => callback(config)} />}</Motion.AnimatePresence>}{config.BG_MAIN && <img src={config.BG_MAIN} alt={"bg"} style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      zIndex: -1,
      opacity: 0.1,
      pointerEvents: "none"
    }} />}</div>;
}
root2.render(<App />);

// Game helper

(() => {
  function addColorLegend() {
    const header = document.querySelector("#root > div > header");
    if (!header) {
      requestAnimationFrame(addColorLegend);
      return;
    }
    if (document.getElementById("code-color-legend")) return;
    const legend = document.createElement("div");
    legend.id = "code-color-legend";
    legend.setAttribute("role", "note");
    legend.setAttribute("aria-label", "Guess color meanings");
    const keys = [["#34c759", "Green", "Right digit, right spot", "Correct digit and position."], ["#ff9f0a", "Orange", "Right digit, wrong spot", "Correct digit, but a different position."], ["#636366", "Gray", "No match", "No unmatched copy of this digit remains in the code."]];
    keys.forEach(([color, label, explanation, detail]) => {
      const item = document.createElement("div");
      item.className = "code-color-key";
      item.setAttribute("aria-label", label + ": " + detail);
      item.title = detail;
      const swatch = document.createElement("span");
      swatch.className = "code-color-swatch";
      swatch.style.background = color;
      swatch.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.textContent = explanation;
      item.append(swatch, text);
      legend.appendChild(item);
    });
    header.appendChild(legend);
  }
  addColorLegend();
})();

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root button",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root button",
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
      for (const value3 of running.values()) value3.cancel();
      running.clear();
      return;
    }
    const targets = new Set();
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(item => targets.add(item));
      } catch {}
    }
    for (const value3 of document.querySelectorAll('p,span,div,label,text')) {
      if (value3.children.length || value3.closest('button,a,input,select,textarea,[role="button"]')) continue;
      const text = (value3.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 5 && text.length <= 140 && (copy.has(text.toLowerCase()) || !selectors.length && action.test(text))) targets.add(value3);
    }
    for (const value3 of targets) {
      if (running.has(value3) || typeof value3.animate !== 'function') continue;
      if ([...targets].some(child => child !== value3 && value3.contains(child))) continue;
      const style = getComputedStyle(value3);
      if (/breath/i.test(style.animationName)) continue;
      const base = style.filter.replace(/opacity\([^)]*\)/g, '').replace(/^none$/, '').trim();
      const filter = value5 => (base ? base + ' ' : '') + 'opacity(' + value5 + ')';
      const value4 = value3.animate([{
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
      running.set(value3, value4);
      if (document.hidden || !visible) value4.pause();
    }
  }
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  };
  const pause = () => {
    for (const value3 of running.values()) {
      if (document.hidden || !visible) {
        value3.pause();
      } else {
        value3.play();
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
    for (const value3 of running.values()) value3.cancel();
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
        "data-batch3-game": "49"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "49"
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
      top: '46%',
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
      const value3 = target.closest('button');
      return !!value3 && /^(Sand Art|Spinner)$/.test(value3.textContent.trim());
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
