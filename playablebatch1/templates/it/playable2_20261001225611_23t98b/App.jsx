// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "TYPING_SPEED",
    "kind": "number",
    "label": "Typing Speed (ms)",
    "value": 1200,
    "default": 1200,
    "min": 500,
    "max": 3000,
    "step": 100
  }],
  "texts": [{
    "id": "TITLE",
    "label": "Game Title",
    "value": "Scrivi all’ex",
    "default": "Scrivi all’ex",
    "max_length": 30
  }, {
    "id": "BTN_START",
    "label": "Start Button",
    "value": "Inizia",
    "default": "Inizia",
    "max_length": 20
  }, {
    "id": "BTN_RESTART",
    "label": "Restart Button",
    "value": "Rigioca",
    "default": "Rigioca",
    "max_length": 20
  }],
  "images": [{
    "id": "START_BG",
    "label": "Start Background",
    "path": "./assets/text_ex_backdrop.svg",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "99278216778713364",
    "version_id": "99278216778593044",
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "it",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
let runtimeConfig = DEFAULT_CONFIG;
async function requestGameConfig() {
  let deadline;
  try {
    const request = fetch('./game.config.json', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .catch(() => null);
    const timeout = new Promise(resolve => {
      deadline = setTimeout(() => resolve(null), 1200);
    });
    const config = await Promise.race([request, timeout]);
    if (config && typeof config === 'object' && !Array.isArray(config)) runtimeConfig = config;
    return { ok: true, json: async () => runtimeConfig };
  } finally {
    clearTimeout(deadline);
  }
}
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* Game-owned FYP adjustments. Host gradients, button and frame are not changed. */
.meeting-guide{position:absolute;z-index:18;top:18%;left:30px;right:30px;margin:0;text-align:center;font:500 18px/1.4 var(--font-body,system-ui,sans-serif);pointer-events:none;color:var(--meeting-ink,#263544)}
.meeting-guide[hidden]{display:none}
html[data-meeting-fyp="preview"] .meeting-guide{animation:meeting-guide-breathe 2.8s ease-in-out infinite}
@keyframes meeting-guide-breathe{0%,100%{opacity:1}50%{opacity:.72}}
.meeting-demo{position:absolute;pointer-events:none;z-index:8;inset:0;overflow:hidden}
.meeting-demo[hidden]{display:none}
html[data-meeting-fyp="playing"] .meeting-demo,html[data-meeting-fyp="direct"] .meeting-demo{display:none}
html[data-meeting-game="14"] .melody-realistic{--ink:#fff4df;--panel:#263541;--accent:#e5bc79}
html[data-meeting-game="14"][data-meeting-fyp="preview"] .melody-controls,html[data-meeting-game="14"][data-meeting-fyp="preview"] .melody-status{visibility:hidden;pointer-events:none}
html[data-meeting-game="14"][data-meeting-fyp="preview"] .melody-guide{top:18%;font-size:18px;line-height:1.4}
html[data-meeting-game="14"] .melody-guide span{background:rgba(30,43,54,.9)}
html[data-meeting-game="15"]{--bg-dark:#edf5f3!important;--surface:transparent!important;--primary:#d66e4d!important;--text-main:#234c4a!important;--text-dim:#355e5a!important}
html[data-meeting-game="15"] #root>div{padding:0!important;background:#edf5f3!important}
html[data-meeting-game="15"] .meeting-orbital-heading{display:none!important}
html[data-meeting-game="15"] .meeting-orbital-board{border-radius:0!important;box-shadow:none!important;background:transparent!important}
html[data-meeting-game="15"] .meeting-orbital-board>div:has(>p){top:18%!important;left:30px!important;right:30px!important}
html[data-meeting-game="16"] .meeting-sand-reset-wrap{left:auto!important;right:30px!important;top:auto!important;bottom:50px!important}
html[data-meeting-game="16"][data-meeting-fyp="preview"] .meeting-sand-reset-wrap{visibility:hidden;pointer-events:none}
html[data-meeting-game="16"] .meeting-sand-reset{width:44px;height:44px;min-height:44px!important;padding:10px!important;border:1.5px solid #713f32!important;border-radius:50%!important;background:transparent!important;box-shadow:none!important;color:#713f32!important;display:grid;place-items:center}
html[data-meeting-game="16"] .meeting-sand-reset svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
html[data-meeting-game="16"] .meeting-sand-hud,html[data-meeting-game="16"] .meeting-sand-hud>div{font-family:var(--font-display)!important;font-size:28px!important;line-height:1.25!important;white-space:nowrap}
html[data-meeting-game="16"] .meeting-sand-ball-count{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
html[data-meeting-game="16"] .meeting-sand-ball-count>small{font-size:12px;line-height:1.2;font-family:inherit}
html[data-meeting-game="17"]{--bg-dark:#eaf3fa!important;--neon-cyan:#167e9b!important;--neon-magenta:#9c4b8d!important}
html[data-meeting-game="17"] .synth-grid{opacity:.25}
html[data-meeting-game="17"] .feed-first-action{color:#334c65!important;top:18%!important;font-size:18px!important;line-height:1.4!important}
html[data-meeting-game="17"] .meeting-synth-result{background:rgba(234,243,250,.97)!important}
html[data-meeting-game="17"] .meeting-synth-result>div{color:#334c65!important}
html[data-meeting-game="17"] .meeting-synth-result h2{text-shadow:none!important}
html[data-meeting-game="17"][data-meeting-fyp="preview"] canvas{--synth-safe-bottom:140px}
html[data-meeting-game="17"][data-meeting-fyp="preview"] .synth-score{visibility:hidden}
html[data-meeting-game="19"] .meeting-cube-heading>div>p{position:absolute;top:108px;left:30px;right:30px;text-align:center!important;margin:0!important;font-size:18px!important;line-height:1.4!important;z-index:12}
html[data-meeting-game="19"] button[aria-label="Ricomincia con i cubi"]{width:44px!important;height:44px!important;background:transparent!important;box-shadow:none!important;border:1.5px solid #65708c!important;color:#65708c}
html[data-meeting-game="19"] button[aria-label="Ricomincia con i cubi"] svg{stroke:currentColor!important;stroke-width:1.8}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .peeler-hud{visibility:hidden}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-board img[alt="peeled potato"],html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-board canvas{width:82%!important;max-height:100%;object-fit:contain}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-board canvas{transform:translateY(-20px)}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-board img[alt="peeled potato"]{transform:translateY(-20px) scale(.9)!important}
html[data-meeting-game="32"][data-meeting-fyp="preview"] #peeler-sprite{margin-top:44px}
html[data-meeting-game="32"][data-meeting-fyp="preview"] .meeting-peeler-guide{position:absolute!important;top:18%!important;left:30px;right:30px;bottom:auto!important;min-height:0!important;padding:0!important;pointer-events:none}
html[data-meeting-game="32"] .meeting-peeler-guide p{font:500 18px/1.4 var(--font-body)!important}
html[data-meeting-game="35"] .meeting-guide{background:#fffffff2;box-shadow:0 2px 10px #0000000a;padding:9px 10px;border-radius:8px;left:30px;right:30px;--meeting-ink:#26262a}
html[data-meeting-game="40"] .meeting-guide{--meeting-ink:#f5e8d3}
html[data-meeting-game="40"] .meeting-pixel-clear{bottom:30px!important}
html[data-meeting-game="40"] .meeting-pixel-clear button{padding:10px 20px!important;min-height:44px!important;box-shadow:none!important;font-family:var(--font-body)!important;font-size:18px!important}
html[data-meeting-game="40"][data-meeting-fyp="preview"] :is(.meeting-pixel-palette,.meeting-pixel-label,.meeting-pixel-clear){visibility:hidden;opacity:0!important;pointer-events:none}
html[data-meeting-game="41"] .meeting-chat-shell{padding-top:12px!important;padding-bottom:20px!important}
html[data-meeting-game="41"] header{min-height:56px!important;padding-top:4px!important;padding-bottom:4px!important}
html[data-meeting-game="41"] header>div{gap:2px!important}
html[data-meeting-game="41"] header>div>div:first-child{width:32px!important;height:32px!important}
html[data-meeting-game="41"] main{min-height:150px!important}
html[data-meeting-game="41"] section .ios-scroll{max-height:96px!important;overflow-y:auto!important}
html[data-meeting-game="41"] section{padding-top:6px!important;padding-bottom:6px!important}
html[data-meeting-game="41"] section:has(.ios-scroll)>div:first-child{height:32px!important;margin-bottom:6px!important;border-radius:16px!important;font-size:14px!important}
html[data-meeting-game="41"] section:has(.ios-scroll)>div:first-child>span[aria-hidden="true"]{width:24px!important;height:24px!important;font-size:17px!important}
html[data-meeting-game="41"][data-meeting-fyp="preview"] .meeting-chat-shell{padding-top:48px!important;padding-bottom:128px!important}
html[data-meeting-game="45"][data-meeting-fyp="preview"] .top{visibility:hidden}
html[data-meeting-game="45"] .hint{top:18%!important;bottom:auto!important;font-size:18px!important;line-height:1.4!important;font-weight:500!important}
.meeting-carve-cursor{position:absolute;left:50%;top:44%;width:18px;height:18px;border:2px solid #fff8cd;border-radius:50%;box-shadow:0 0 0 6px #f5cd6544;animation:meeting-carve 3.4s ease-in-out infinite}
@keyframes meeting-carve{0%,100%{transform:translate(-66px,40px);opacity:0}12%{opacity:1}35%{transform:translate(0,-54px);opacity:1}58%{transform:translate(66px,40px);opacity:1}78%{transform:translate(-45px,-18px);opacity:.7}90%{transform:translate(45px,-18px);opacity:0}}
html[data-meeting-inactive] .meeting-demo *,html[data-meeting-inactive] .meeting-guide{animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){.meeting-demo *,.meeting-guide{animation:none!important}}

/* Game-owned chat layout. Native FYP chrome, gradients and launch control stay unchanged. */
html[data-meeting-game="41"] .meeting-chat-shell{padding-top:24px!important;padding-bottom:0!important;background:#fff!important;min-height:0}
html[data-meeting-game="41"] header{grid-template-columns:1fr!important;min-height:64px!important;padding:8px 30px!important;background:#fff!important;backdrop-filter:none!important;border-bottom:1px solid #ececf0!important}
/* The fake navigation/contact pictograms are decorative, not game controls. */
html[data-meeting-game="41"] header>div:first-child,
html[data-meeting-game="41"] header>div:last-child{display:none!important}
html[data-meeting-game="41"] header>div:nth-child(2)>div:first-child{width:32px!important;height:32px!important}
html[data-meeting-game="41"] main{min-height:0!important}
html[data-meeting-game="41"] section{padding-bottom:30px!important}
/* Put reserved launch space INSIDE the reply surface, not in a white tail below it. */
html[data-meeting-game="41"][data-meeting-fyp="preview"] .meeting-chat-shell{padding-top:56px!important;padding-bottom:0!important}
html[data-meeting-game="41"][data-meeting-fyp="preview"] section{padding-bottom:134px!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.meeting-chat-shell section:has(.ios-scroll)>div:first-child>span:first-child){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.meeting-chat-shell section:has(.ios-scroll)>div:first-child>span:first-child){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.meeting-chat-shell section:has(.ios-scroll)>div:first-child>span:first-child){animation:none!important}}

/* Italian copy keeps the approved role sizes and may wrap instead of clipping. */
html[lang="it"] :is(.meeting-guide,.feed-first-action,.melody-guide,.particle-guide,.dive-guide,.sandbox-guide,.koi-guide,.ui-guide,.bead-guide,.coloring-guide,.look-guide,.time-print-guide){white-space:normal;overflow-wrap:normal;word-break:normal;line-height:1.4}
html[lang="it"] :is(button,.btn,.btn-neon){overflow-wrap:normal;word-break:normal}
html[lang="it"] .melody-controls button{font-size:18px;padding-inline:12px}
html[lang="it"] .meeting-sand-ball-count{gap:6px!important}
html[lang="it"] #people-dialog fieldset label{min-width:0}
html[lang="it"] #people-dialog input{max-width:100%;min-width:0}
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
document.documentElement.lang = 'it';
function readConfigValues(config) {
  let values = {};
  (config.tweaks || []).forEach(item => {
    values[item.id] = item.value;
  });
  (config.texts || []).forEach(item => {
    values[item.id] = item.value;
  });
  (config.images || []).forEach(item => {
    values[item.id] = item.path;
  });
  (config.mentions || []).forEach(item => {
    values[item.id] = item.path != null && item.path !== "" ? item.path : item.value;
  });
  (config.motions || []).forEach(item => {
    if (!(!item || !item.id)) {
      if (item.base_path != null && item.base_path !== "") {
        values[item.id] = item.base_path;
        values[item.id + "_BASE"] = item.base_path;
      }
      if (item.frame_count != null) {
        values[item.id + "_COUNT"] = item.frame_count;
      }
    }
  });
  return values;
}
function App() {
  const createElement = React.createElement;
  const [config, setConfig] = React.useState({});
  const [screen, setScreen] = React.useState("chat");
  const [messages, setMessages] = React.useState([{
    from: "ex",
    text: "Dobbiamo parlare."
  }]);
  const [pending, setPending] = React.useState(false);
  const [turn, setTurn] = React.useState(0);
  const [ending, setEnding] = React.useState("");
  const chatEnd = React.useRef(null);
  const words = ["scusa", "ti odio", "colpa mia", "come vuoi", "sul serio", "mi ami", "amici?", "fascino", "zerbino", "spietato", "terapia", "nuova tipa", "poesia", "cosa?", "sì", "no", "ahah", "ok", "mi manchi", "che fai", "vieni qui", "ti prego", "❤️", "MAIUSCOLO", "papiro", "ok", "meme", "🎵", "ho bevuto", "regalo", "playlist", "$$$", "📍", "videochiamata", "🎤", "📸", "nuovo tipo?", "non è gelosia", "hackerato", "numero sbagliato"];
  const reply = (word, otherValue) => {
    if (["scusa", "colpa mia", "ti prego", "mi manchi"].includes(word)) return ["Mi fa piacere sentirlo.", "Forse possiamo parlarne.", "Anche io sentivo la tua mancanza."][otherValue % 3];
    if (["ti odio", "come vuoi", "non è gelosia", "numero sbagliato"].includes(word)) return ["Che cattiveria.", "Direi che abbiamo chiuso.", "Wow. Va bene."][otherValue % 3];
    if (["ahah", "meme", "fascino", "amici?"].includes(word)) return ["Dici sul serio?", "Non posso credere che tu l’abbia detto.", "Non cambi mai 😂"][otherValue % 3];
    return ["Dobbiamo parlare.", "Cosa vuoi dire davvero?", "Non so cosa rispondere."][otherValue % 3];
  };
  const start = () => {
    setMessages([{
      from: "ex",
      text: "Dobbiamo parlare."
    }]);
    setTurn(0);
    setEnding("");
    setPending(false);
    setScreen("chat");
  };
  const send = word => {
    if (pending || screen !== "chat") return;
    const nextTurn = turn + 1;
    setTurn(nextTurn);
    setPending(true);
    setMessages(value => [...value, {
      from: "me",
      text: word
    }]);
    if (navigator.vibrate) navigator.vibrate(8);
    setTimeout(() => {
      setMessages(value => [...value, {
        from: "ex",
        text: reply(word, nextTurn)
      }]);
      setPending(false);
      if (nextTurn >= 5) {
        setEnding(["scusa", "colpa mia", "ti prego", "mi manchi"].includes(word) ? "Forse possiamo riprovarci." : ["ti odio", "come vuoi", "numero sbagliato"].includes(word) ? "La conversazione finisce qui." : "È complicato…");
        setScreen("ending");
      }
    }, Math.max(300, Number(config.TYPING_SPEED) || 1200));
  };
  React.useEffect(() => {
    let active = true;
    requestGameConfig().then(response => response.ok ? response.json() : null).then(value => {
      if (active && value) setConfig(readConfigValues(value));
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  React.useEffect(() => {
    chatEnd.current?.scrollIntoView({
      block: "end",
      behavior: "smooth"
    });
  }, [messages]);
  const button = {
    border: 0,
    fontFamily: "inherit",
    fontWeight: 600,
    cursor: "pointer",
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent"
  };
  const title = config.TITLE || "Scrivi all’ex";
  const value2 = `
    *{box-sizing:border-box}
    button:focus-visible{outline:3px solid rgba(0,122,255,.38);outline-offset:2px}
    button:active:not(:disabled){opacity:.72}
    button:disabled{cursor:default}
    .ios-scroll{scrollbar-width:none;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
    .ios-scroll::-webkit-scrollbar{display:none}
    @keyframes ios-dot{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-3px);opacity:1}}
    .typing-dot{width:6px;height:6px;border-radius:50%;background:#767680;animation:ios-dot 1.05s infinite ease-in-out}
    .typing-dot:nth-child(2){animation-delay:.14s}.typing-dot:nth-child(3){animation-delay:.28s}
    @media (prefers-reduced-motion:reduce){.typing-dot{animation:none!important}}
  `;
  const avatar = <div style={{
    width: 36,
    height: 36,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(145deg,#b9bdc7,#7c8390)",
    color: "white",
    fontSize: 16,
    fontWeight: 700,
    boxShadow: "inset 0 0 0 1px #0001"
  }}>{"E"}</div>;
  return <div style={{
    width: "100%",
    height: "100%",
    background: "#fff",
    fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif',
    overflow: "hidden",
    color: "#111",
    boxSizing: "border-box",
    colorScheme: "light"
  }}>{<style>{value2}</style>}{<div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      paddingTop: "calc(40px + env(safe-area-inset-top, 0px))",
      paddingBottom: "calc(40px + env(safe-area-inset-bottom, 0px))",
      background: "#fff"
    }}>{<header style={{
        flex: "0 0 auto",
        minHeight: 70,
        background: "rgba(249,249,249,.94)",
        display: "grid",
        gridTemplateColumns: "48px 1fr 48px",
        alignItems: "center",
        padding: "6px 25px 7px",
        borderBottom: "0.5px solid #c6c6c8",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        zIndex: 2
      }}>{<div aria-hidden={"true"} style={{
          width: 44,
          height: 44,
          display: "grid",
          placeItems: "center start"
        }}>{<span style={{
            display: "block",
            width: 12,
            height: 12,
            borderLeft: "2px solid #007aff",
            borderBottom: "2px solid #007aff",
            transform: "rotate(45deg)",
            marginLeft: 4
          }} />}</div>}{<div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 3
        }}>{avatar}{<div style={{
            fontWeight: 500,
            fontSize: 12.5,
            lineHeight: 1.1,
            display: "flex",
            alignItems: "center",
            gap: 4
          }}>{"Ex"}{<span aria-hidden={"true"} style={{
              display: "inline-block",
              width: 5,
              height: 5,
              borderTop: "1.5px solid #8e8e93",
              borderRight: "1.5px solid #8e8e93",
              transform: "rotate(45deg)"
            }} />}</div>}</div>}{<div aria-hidden={"true"} style={{
          justifySelf: "end",
          width: 29,
          height: 29,
          borderRadius: "50%",
          border: "1.5px solid #007aff",
          position: "relative"
        }}>{<div style={{
            position: "absolute",
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "#007aff",
            left: 10.5,
            top: 5
          }} />}{<div style={{
            position: "absolute",
            width: 11,
            height: 7,
            borderRadius: "7px 7px 4px 4px",
            background: "#007aff",
            left: 8,
            top: 12
          }} />}</div>}</header>}{<main className={"ios-scroll"} style={{
        flex: 1,
        minHeight: 100,
        overflowY: "auto",
        padding: "14px 25px 18px",
        background: "#fff"
      }}>{<div style={{
          textAlign: "center",
          fontSize: 11.5,
          color: "#8e8e93",
          fontWeight: 500,
          margin: "0 0 16px"
        }}>{"iMessage · Oggi 9:41"}</div>}{messages.map((item, index) => <div key={index} style={{
          display: "flex",
          justifyContent: item.from === "me" ? "flex-end" : "flex-start",
          margin: "0 0 7px"
        }}>{<div style={{
            maxWidth: "78%",
            padding: "8px 12px 9px",
            borderRadius: 18,
            borderBottomRightRadius: item.from === "me" ? 5 : 18,
            borderBottomLeftRadius: item.from === "me" ? 18 : 5,
            background: item.from === "me" ? "#007aff" : "#e9e9eb",
            color: item.from === "me" ? "white" : "#111",
            fontSize: 16,
            lineHeight: 1.28,
            letterSpacing: "-.01em",
            overflowWrap: "anywhere"
          }}>{item.text}</div>}</div>)}{pending && <div style={{
          display: "flex",
          justifyContent: "flex-start",
          marginTop: 2
        }}>{<div aria-label={"Sta scrivendo…"} style={{
            height: 34,
            minWidth: 55,
            borderRadius: 18,
            borderBottomLeftRadius: 5,
            background: "#e9e9eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            padding: "0 12px"
          }}>{<span className={"typing-dot"} />}{<span className={"typing-dot"} />}{<span className={"typing-dot"} />}</div>}</div>}{<div ref={chatEnd} />}</main>}{screen === "chat" ? <section style={{
        flex: "0 0 auto",
        background: "#f2f2f7",
        borderTop: "0.5px solid #c6c6c8",
        padding: "9px 30px 10px"
      }}>{<div style={{
          height: 40,
          border: "1px solid #c7c7cc",
          borderRadius: 20,
          background: "#fff",
          display: "flex",
          alignItems: "center",
          padding: "0 5px 0 14px",
          margin: "0 0 9px",
          color: "#8e8e93",
          fontSize: 15
        }}>{<span style={{
            flex: 1
          }}>{"Scegli una risposta…"}</span>}{<span aria-hidden={"true"} style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: "#d1d1d6",
            color: "white",
            fontSize: 20,
            fontWeight: 700,
            lineHeight: 1
          }}>{"↑"}</span>}</div>}{<div className={"ios-scroll"} style={{
          maxHeight: "min(38vh, 284px)",
          overflowY: "auto",
          padding: "1px"
        }}>{<div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,minmax(0,1fr))",
            gap: 8
          }}>{words.map(word => <button key={word} type={"button"} disabled={pending} onClick={() => send(word)} style={{
              ...button,
              minHeight: 44,
              padding: "5px 4px",
              borderRadius: 12,
              background: "#fff",
              border: "1px solid #d1d1d6",
              color: "#007aff",
              fontSize: "16px",
              lineHeight: 1.25,
              opacity: pending ? 0.5 : 1,
              whiteSpace: "normal",
              overflowWrap: "anywhere",
              boxShadow: "0 1px 1px #00000008"
            }}>{word}</button>)}</div>}</div>}</section> : <section style={{
        flex: "0 0 auto",
        padding: "14px 25px 0",
        background: "#f2f2f7",
        borderTop: "0.5px solid #c6c6c8",
        textAlign: "center"
      }}>{<div style={{
          maxWidth: 360,
          margin: "0 auto",
          padding: "17px 16px",
          borderRadius: 18,
          background: "#fff",
          boxShadow: "0 5px 18px #00000012"
        }}>{<div style={{
            fontSize: 17,
            fontWeight: 650,
            lineHeight: 1.3,
            marginBottom: 13
          }}>{ending}</div>}{<button type={"button"} onClick={start} style={{
            ...button,
            minHeight: 48,
            width: "100%",
            borderRadius: 12,
            background: "#007aff",
            color: "#fff",
            fontSize: 17
          }}>{config.BTN_RESTART || "Rigioca"}</button>}</div>}</section>}</div>}</div>;
}

// ./guide-breathing.js
/* Decorative guide visibility only: no inputs, timers, sound or game state. */
(() => {
  const root = document.documentElement;
  let intersecting = true;
  const update = () => root.toggleAttribute('data-guide-breathing-paused', document.hidden || !intersecting);
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    intersecting = entries.some(entry => entry.isIntersecting);
    update();
  }) : null;
  if (document.body) observer?.observe(document.body);
  document.addEventListener('visibilitychange', update);
  update();
  window.addEventListener('pagehide', () => {
    observer?.disconnect();
    document.removeEventListener('visibilitychange', update);
  }, {
    once: true
  });
})();
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root [class*=\"bubble\"], #root button",
        "data-game": ""
      }[name] ?? null;
    },
    dataset: {
      game: ""
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

// ./fyp-meeting.js
/* Game-owned opening adaptation; never dispatches gameplay input or writes scores. */
(() => {
  'use strict';

  const game = Number({
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "41"
      }[name] ?? null;
    },
    dataset: {
      game: "41"
    }
  }?.dataset.game);
  const html = document.documentElement;
  const hosted = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
  html.dataset.meetingGame = String(game);
  html.dataset.meetingFyp = hosted ? 'preview' : 'direct';
  let active = !hosted;
  let guideUsed = false;
  let guide = null;
  let demo = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const resetIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></svg>';
  const mark = (value, name) => {
    value?.classList.add(name);
    return value;
  };
  function addGuide(container, text) {
    if (!guide) {
      guide = document.createElement('p');
      guide.className = 'meeting-guide';
      guide.textContent = text;
      container.append(guide);
    }
    return guide;
  }
  function attach() {
    const value = document.querySelector('#root>div');
    if (!value) return;
    const canvas = value.querySelector('canvas');
    if (game === 15 && canvas) {
      mark(canvas.parentElement, 'meeting-orbital-board');
      mark(value.querySelector('h1')?.parentElement, 'meeting-orbital-heading');
    }
    if (game === 16) {
      const counter = value.querySelector("[aria-label^=\"Livello \"]");
      if (counter) {
        mark(counter.parentElement, 'meeting-sand-hud');
        const balls = counter.nextElementSibling;
        if (balls) {
          mark(balls, 'meeting-sand-ball-count');
          balls.querySelector('small')?.remove();
        }
      }
      const reset = [...value.querySelectorAll('button')].find(item => item.textContent.trim() === "RICOMINCIA" || item.classList.contains('meeting-sand-reset'));
      if (reset && !reset.classList.contains('meeting-sand-reset')) {
        reset.setAttribute('aria-label', "Ricomincia il livello");
        reset.title = "Ricomincia il livello";
        mark(reset, 'meeting-sand-reset');
        mark(reset.parentElement, 'meeting-sand-reset-wrap');
        reset.innerHTML = resetIcon;
      }
    }
    if (game === 19 && canvas) {
      mark(value.children[1], 'meeting-cube-heading');
      mark(canvas.parentElement, 'meeting-cube-board');
    }
    if (game === 17) {
      const replay = value.querySelector('.btn-neon');
      if (replay) mark(replay.parentElement.parentElement, 'meeting-synth-result');
    }
    if (game === 32 && canvas) {
      mark(canvas.parentElement.parentElement, 'meeting-peeler-board');
      const hint = [...value.querySelectorAll('p')].find(item => item.textContent === "Tocca per sbucciare");
      mark(hint?.parentElement, 'meeting-peeler-guide');
    }
    if (game === 35 && canvas) {
      addGuide(value, "Tocca il tasto scuro in basso");
      const value2 = [...value.children].find(item => item.tagName === 'DIV' && item.textContent.trim() === '0');
      if (value2) mark(value2, 'meeting-piano-hud');
      guide.hidden = !!value.querySelector('button') || [...value.querySelectorAll('div')].some(item => item.classList.contains('meeting-piano-hud') && Number(item.textContent) > 0);
    }
    if (game === 40 && canvas) {
      mark(value.querySelector('.hide-scrollbar'), 'meeting-pixel-palette');
      const clear = [...value.querySelectorAll('button')].find(item => item.textContent === "Cancella");
      mark(clear?.parentElement, 'meeting-pixel-clear');
      const label = [...value.children].find(item => item.tagName === 'DIV' && !item.querySelector('canvas,button') && item.textContent === "Sabbia");
      mark(label, 'meeting-pixel-label');
      addGuide(value, "Scegli un materiale e trascina per versarlo");
    }
    if (game === 41) {
      const shell = value.querySelector('header')?.parentElement;
      mark(shell, 'meeting-chat-shell');
    }
    // No.45's real knife renderer supplies its decorative, non-scoring preview.
    sync();
  }
  function sync() {
    if (demo) demo.hidden = !hosted || active;
    if (game === 40 && guide) guide.hidden = active && guideUsed;
    html.toggleAttribute('data-meeting-inactive', document.hidden);
  }
  const observer = new MutationObserver(attach);
  const root = document.getElementById('root');
  if (root) observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true
  });
  attach();
  // Real game input hides only the new Pixel Sandbox instruction; palette taps do not count.
  document.addEventListener('pointerdown', event => {
    if (game === 40 && active && event.isPrimary !== false && event.button <= 0 && event.target.tagName === 'CANVAS' && guide) {
      guideUsed = true;
      guide.hidden = true;
    }
  }, {
    capture: true
  });
  addEventListener('message', event => {
    if (!hosted || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
    html.dataset.meetingFyp = active ? 'playing' : 'preview';
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener?.('change', sync);
  addEventListener('pagehide', () => {
    observer.disconnect();
  }, {
    once: true
  });
})();

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [".meeting-chat-shell section:has(.ios-scroll)>div:first-child>span:first-child"];
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
