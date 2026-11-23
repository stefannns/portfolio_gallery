// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
// Older hosts can still size the scene on mount and window resize.
function observeGameSize(callback) {
  if (typeof ResizeObserver === 'function') return new ResizeObserver(callback);

  const targets = new Set();
  let frame;
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const entries = Array.from(targets, target => ({
        target,
        contentRect: { width: target.clientWidth, height: target.clientHeight }
      }));
      if (entries.length) callback(entries);
    });
  }
  return {
    observe(target) {
      targets.add(target);
      window.addEventListener('resize', schedule);
      schedule();
    },
    disconnect() {
      targets.clear();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
    }
  };
}

const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "HIT_RADIUS",
    "kind": "number",
    "label": "Hit Node Radius",
    "value": 0.12,
    "default": 0.12,
    "min": 0.05,
    "max": 0.25,
    "step": 0.01
  }, {
    "id": "STROKE_WIDTH",
    "kind": "number",
    "label": "Line Thickness",
    "value": 8,
    "default": 8,
    "min": 2,
    "max": 20,
    "step": 1
  }, {
    "id": "NODE_RADIUS",
    "kind": "number",
    "label": "Node Size",
    "value": 14,
    "default": 14,
    "min": 5,
    "max": 30,
    "step": 1
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "Un solo tratto",
    "default": "Un solo tratto",
    "max_length": 20
  }, {
    "id": "TEXT_LEVEL_PREFIX",
    "label": "Level Prefix",
    "value": "Livello",
    "default": "Livello",
    "max_length": 10
  }, {
    "id": "BTN_HINT",
    "label": "Hint Button",
    "value": "Aiuto",
    "default": "Aiuto",
    "max_length": 10
  }, {
    "id": "BTN_RESET",
    "label": "Reset Button",
    "value": "Ricomincia",
    "default": "Ricomincia",
    "max_length": 10
  }, {
    "id": "TEXT_CONNECT",
    "label": "Instruction",
    "value": "Unisci i punti senza staccare",
    "default": "Unisci i punti senza staccare",
    "max_length": 50
  }, {
    "id": "TEXT_NO_LIFT",
    "label": "Sub Instruction",
    "value": "Non staccare il dito!",
    "default": "Non staccare il dito!",
    "max_length": 40
  }, {
    "id": "TEXT_DEAD_END",
    "label": "Dead End Toast",
    "value": "Vicolo cieco. Ridisegna.",
    "default": "Vicolo cieco. Ricomincia.",
    "max_length": 30
  }, {
    "id": "TEXT_ALL_CLEAR",
    "label": "All Clear Title",
    "value": "Ce l’hai fatta!",
    "default": "Ce l’hai fatta!",
    "max_length": 20
  }, {
    "id": "TEXT_ALL_CLEAR_SUB",
    "label": "All Clear Subtitle",
    "value": "Hai risolto tutti e 4 gli schemi.",
    "default": "Hai risolto tutti e 4 gli schemi.",
    "max_length": 40
  }, {
    "id": "BTN_PLAY_AGAIN",
    "label": "Play Again Button",
    "value": "Rigioca",
    "default": "Rigioca",
    "max_length": 15
  }, {
    "id": "BTN_POST_PLAY",
    "label": "Post My Play Button",
    "value": "Condividi",
    "default": "Condividi",
    "max_length": 20
  }],
  "images": [],
  "config_version": "2.0",
  "playable": {
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
    body { background: #F2ECFC; -webkit-tap-highlight-color: transparent; }
    button { min-height: 44px; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.entry-demo-copy),html:root:root :is(.one-stroke-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.entry-demo-copy,.one-stroke-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.entry-demo-copy,.one-stroke-guide){animation:none!important}}

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
var PUZZLE_LEVELS = [{
  "nodes": [{
    "x": 0.5,
    "y": 0.1
  }, {
    "x": 0.9,
    "y": 0.5
  }, {
    "x": 0.5,
    "y": 0.9
  }, {
    "x": 0.1,
    "y": 0.5
  }, {
    "x": 0.5,
    "y": 0.5
  }],
  "edges": [[0, 1], [1, 2], [2, 3], [3, 0], [1, 4], [3, 4]]
}, {
  "nodes": [{
    "x": 0.5,
    "y": 0.1
  }, {
    "x": 0.9,
    "y": 0.4
  }, {
    "x": 0.7,
    "y": 0.9
  }, {
    "x": 0.3,
    "y": 0.9
  }, {
    "x": 0.1,
    "y": 0.4
  }],
  "edges": [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 2], [2, 4], [4, 1], [1, 3], [3, 0]]
}, {
  "nodes": [{
    "x": 0.2,
    "y": 0.7
  }, {
    "x": 0.8,
    "y": 0.7
  }, {
    "x": 0.2,
    "y": 0.3
  }, {
    "x": 0.8,
    "y": 0.3
  }, {
    "x": 0.5,
    "y": 0.1
  }],
  "edges": [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 4]]
}, {
  "nodes": [{
    "x": 0.2,
    "y": 0.7
  }, {
    "x": 0.8,
    "y": 0.7
  }, {
    "x": 0.2,
    "y": 0.3
  }, {
    "x": 0.8,
    "y": 0.3
  }, {
    "x": 0.5,
    "y": 0.1
  }],
  "edges": [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 4], [0, 3], [1, 2]]
}];
function edgeKey(firstNode, secondNode) {
  return `${Math.min(firstNode, secondNode)}-${Math.max(firstNode, secondNode)}`;
}
function pointDistance(firstPoint, secondPoint) {
  return Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y);
}
function findHintNode(level, path) {
  let length = level.edges.length;
  let seenItems = new Set();
  for (let value = 0; value < path.length - 1; value++) seenItems.add(edgeKey(path[value], path[value + 1]));
  let handleAction = (value, otherValue) => {
    if (otherValue.size === length) return true;
    let value2 = level.edges.map(item => item[0] === value ? item[1] : item[1] === value ? item[0] : -1).filter(item => item !== -1);
    for (let value3 of value2) {
      let value4 = edgeKey(value, value3);
      if (!otherValue.has(value4)) {
        if (otherValue.add(value4), handleAction(value3, otherValue)) {
          otherValue.delete(value4);
          return value3;
        }
        otherValue.delete(value4);
      }
    }
    return null;
  };
  if (path.length === 0) {
    for (let value = 0; value < level.nodes.length; value++) if (handleAction(value, new Set())) return value;
    return null;
  } else return handleAction(path[path.length - 1], seenItems);
}
function useRecordingSubmission() {
  let canSubmit = typeof window !== "undefined" && typeof window.tt !== "undefined" && typeof window.tt.playableRecordingSubmission == "function";
  let [submitting, setSubmitting] = React.useState(false);
  React.useEffect(() => {
    let handleAction = () => setSubmitting(false);
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
      setSubmitting(true);
      window.tt.playableRecordingSubmission({
        success() {},
        fail(value) {
          console.error("[post_my_play] failed", value && (value.errMsg || value.message));
          setSubmitting(false);
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
var puzzleStyles = {
  loadingContainer: {
    width: "100%",
    height: "100%",
    backgroundColor: "#F2ECFC"
  },
  container: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    containerType: "size"
  },
  header: {
    flex: "0 0 auto",
    position: "relative",
    padding: "calc(30px + env(safe-area-inset-top, 0px)) 30px 16px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    maxWidth: "600px",
    margin: "0 auto",
    minHeight: "90px"
  },
  levelText: {
    fontSize: "28px",
    fontWeight: "bold",
    color: "var(--text-main)",
    fontFamily: "var(--font-display)"
  },
  headerActions: {
    position: "absolute",
    right: "30px",
    top: "calc(30px + env(safe-area-inset-top, 0px))",
    display: "flex",
    gap: "8px"
  },
  btnSmall: {
    padding: "8px 16px",
    borderRadius: "20px",
    border: "none",
    backgroundColor: "var(--btn-bg)",
    color: "var(--text-main)",
    fontSize: "clamp(14px, 4cqi, 16px)",
    fontWeight: 600,
    cursor: "pointer",
    touchAction: "manipulation"
  },
  instruction: {
    flex: "0 0 auto",
    textAlign: "center",
    padding: "12px calc(30px + env(safe-area-inset-right, 0px)) calc(50px + env(safe-area-inset-bottom, 0px)) calc(30px + env(safe-area-inset-left, 0px))",
    width: "100%",
    maxWidth: "600px",
    margin: "0 auto"
  },
  instTitle: {
    fontSize: "18px",
    lineHeight: 1.5,
    color: "var(--text-sub)",
    fontWeight: 600,
    marginBottom: 0
  },
  instSub: {
    fontSize: "clamp(12px, 3.5cqi, 14px)",
    color: "#8E78A2"
  },
  playArea: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    position: "relative",
    overflow: "hidden"
  },
  svg: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    display: "block"
  },
  toast: {
    position: "absolute",
    top: "25%",
    left: "50%",
    transform: "translateX(-50%)",
    backgroundColor: "rgba(46,32,69,0.88)",
    color: "#fff",
    padding: "12px 24px",
    borderRadius: "24px",
    fontSize: "14px",
    fontWeight: 600,
    pointerEvents: "none",
    zIndex: 100,
    whiteSpace: "nowrap"
  },
  levelClearOverlay: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(242,236,252,0.72)",
    zIndex: 10
  },
  clearBadge: {
    width: "112px",
    height: "112px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    background: "var(--primary)",
    border: "8px solid rgba(255,255,255,.9)",
    boxShadow: "0 0 0 6px rgba(101,57,181,.18),0 18px 42px rgba(101,57,181,.28)"
  },
  gameOverScreen: {
    position: "absolute",
    inset: 0,
    backgroundColor: "var(--bg-main)",
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px"
  },
  goTitle: {
    fontSize: "clamp(32px, 10cqi, 48px)",
    color: "var(--primary)",
    margin: "0 0 16px 0",
    textAlign: "center"
  },
  goSub: {
    fontSize: "clamp(16px, 5cqi, 20px)",
    color: "var(--text-main)",
    margin: "0 0 40px 0",
    textAlign: "center"
  },
  goActionArea: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    width: "100%",
    maxWidth: "300px"
  },
  btnPrimary: {
    width: "100%",
    padding: "16px",
    borderRadius: "32px",
    border: "none",
    backgroundColor: "var(--primary)",
    color: "#fff",
    fontSize: "18px",
    fontWeight: 700,
    cursor: "pointer"
  }
};
function App() {
  let [config, setConfig] = React.useState(null);
  let [gamePhase, setGamePhase] = React.useState("playing");
  let [levelIndex, setLevelIndex] = React.useState(0);
  let [pathNodes, setPathNodes] = React.useState([]);
  let [drawing, setDrawing] = React.useState(false);
  let [pointerPosition, setPointerPosition] = React.useState(null);
  let [hintNode, setHintNode] = React.useState(null);
  let [toast, setToast] = React.useState("");
  let boardRef = React.useRef(null);
  let audioReadyRef = React.useRef(false);
  let nodeSynthRef = React.useRef(null);
  let winSynthRef = React.useRef(null);
  let errorSynthRef = React.useRef(null);
  let [boardGeometry, setBoardGeometry] = React.useState({
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
    scale: 0
  });
  let [guideVisible, setGuideVisible] = React.useState(true);
  let sessionRef = React.useRef({
    phase: "playing",
    path: [],
    pointer: null,
    transition: null,
    toast: null,
    alive: true,
    audioPending: false
  });
  React.useEffect(() => {
    let enabled = true;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value = await requestGameConfig();
        if (value.ok) {
          options = await value.json();
        }
      } catch {}
      if (enabled) {
        setConfig(readConfigValues(options));
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  let initAudio = React.useCallback(async () => {
    if (!audioReadyRef.current && !sessionRef.current.audioPending && sessionRef.current.alive) {
      sessionRef.current.audioPending = true;
      try {
        if (await Tone.start(), !sessionRef.current.alive) return;
        nodeSynthRef.current = new Tone.Synth({
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
        nodeSynthRef.current.volume.value = -8;
        winSynthRef.current = new Tone.MembraneSynth().toDestination();
        winSynthRef.current.volume.value = -5;
        errorSynthRef.current = new Tone.PolySynth(Tone.Synth).toDestination();
        errorSynthRef.current.volume.value = -10;
        audioReadyRef.current = true;
      } catch (value) {
        console.warn("Audio unlock failed", value);
      } finally {
        sessionRef.current.audioPending = false;
      }
    }
  }, []);
  let playSound = React.useCallback((value, value2 = 0) => {
    var instrument;
    var instrument2;
    var instrument3;
    var instrument4;
    var instrument5;
    var instrument6;
    if (!audioReadyRef.current) return;
    let timestamp = Tone.now();
    if (value === "start") {
      if (!((instrument = nodeSynthRef.current) == null)) {
        instrument.triggerAttackRelease("C4", "16n", timestamp);
      }
    } else if (value === "connect") {
      let items = ["C4", "D4", "E4", "G4", "A4", "C5", "D5", "E5", "G5", "A5"];
      let item = items[Math.min(value2, items.length - 1)];
      if (!((instrument2 = nodeSynthRef.current) == null)) {
        instrument2.triggerAttackRelease(item, "16n", timestamp);
      }
    } else {
      if (value === "undo") {
        if (!((instrument3 = nodeSynthRef.current) == null)) {
          instrument3.triggerAttackRelease("A3", "16n", timestamp);
        }
      } else {
        if (value === "error") {
          if (!((instrument4 = winSynthRef.current) == null)) {
            instrument4.triggerAttackRelease("C2", "8n", timestamp);
          }
        } else {
          if (value === "win") {
            if (!((instrument5 = errorSynthRef.current) == null)) {
              instrument5.triggerAttackRelease(["C4", "E4", "G4"], "8n", timestamp);
            }
          } else {
            if (value === "gameover") {
              if (!((instrument6 = errorSynthRef.current) == null)) {
                instrument6.triggerAttackRelease(["C4", "F4", "A4", "C5"], "4n", timestamp);
              }
            }
          }
        }
      }
    }
  }, []);
  React.useEffect(() => {
    if (!config || !boardRef.current) return;
    let resizeObserver = observeGameSize(value => {
      let {
        width: width,
        height: height
      } = value[0].contentRect;
      if (width > 0 && height > 0) {
        let scale = Math.min(width, height) * 0.85;
        setBoardGeometry({
          width: width,
          height: height,
          scale: scale,
          offsetX: (width - scale) / 2,
          offsetY: (height - scale) / 2
        });
      }
    });
    resizeObserver.observe(boardRef.current);
    return () => resizeObserver.disconnect();
  }, [config]);
  let level = PUZZLE_LEVELS[levelIndex];
  let nodeToScreen = React.useCallback(point => ({
    x: boardGeometry.offsetX + point.x * boardGeometry.scale,
    y: boardGeometry.offsetY + point.y * boardGeometry.scale
  }), [boardGeometry]);
  let showToast = React.useCallback((value, value2 = false) => {
    clearTimeout(sessionRef.current.toast);
    setToast(value);
    sessionRef.current.toast = value2 ? null : setTimeout(() => setToast(""), 2000);
  }, []);
  let canCompletePath = (level2, otherValue) => {
    if (!otherValue.length) return true;
    const seenItems = new Set(otherValue.slice(1).map((item2, index) => edgeKey(otherValue[index], item2)));
    const value = level2.edges.filter(([value4, value5]) => !seenItems.has(edgeKey(value4, value5)));
    if (!value.length) return true;
    const value2 = level2.nodes.map(() => []);
    const item = otherValue[otherValue.length - 1];
    for (const [i, c] of value) {
      value2[i].push(c);
      value2[c].push(i);
    }
    if (!value2[item].length) return false;
    const seenItems2 = new Set([item]);
    const items = [item];
    for (let value4 = 0; value4 < items.length; value4++) for (const value5 of value2[items[value4]]) {
      if (!seenItems2.has(value5)) {
        seenItems2.add(value5);
        items.push(value5);
      }
    }
    if (value2.some((item2, index) => item2.length && !seenItems2.has(index))) return false;
    const value3 = value2.map((item2, index) => item2.length % 2 ? index : -1).filter(item2 => item2 !== -1);
    return value3.length === 0 || value3.length === 2 && value3.includes(item);
  };
  let failPath = () => {
    if (sessionRef.current.phase === "playing") {
      sessionRef.current.phase = "failed";
      setDrawing(false);
      setPointerPosition(null);
      setHintNode(null);
      setGamePhase("failed");
      showToast(config.TEXT_DEAD_END || "Vicolo cieco. Ridisegna.", true);
      playSound("error");
    }
  };
  let handlePointerDown = async event => {
    if (event.isPrimary === false || event.button > 0 || !["playing", "failed"].includes(sessionRef.current.phase) || sessionRef.current.pointer !== null || !boardRef.current) return;
    let bounds = boardRef.current.getBoundingClientRect();
    let options = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    };
    let value = boardGeometry.scale * (config.HIT_RADIUS || 0.12);
    let value2 = -1;
    for (let value3 = 0; value3 < level.nodes.length; value3++) if (pointDistance(options, nodeToScreen(level.nodes[value3])) < value) {
      value2 = value3;
      break;
    }
    if (value2 !== -1 && (initAudio(), setGuideVisible(false), window.PlayableEntryPreview?.stop()), value2 !== -1) {
      const value3 = sessionRef.current.phase === "failed" ? [] : sessionRef.current.path;
      if (!value3.length || value3[value3.length - 1] === value2) {
        sessionRef.current.phase = "playing";
        sessionRef.current.path = value3.length ? value3 : [value2];
        sessionRef.current.pointer = event.pointerId;
        setPathNodes(sessionRef.current.path);
        setGamePhase("playing");
        setDrawing(true);
        setPointerPosition(options);
        setHintNode(null);
        clearTimeout(sessionRef.current.toast);
        setToast("");
        event.currentTarget?.setPointerCapture?.(event.pointerId);
        if (!value3.length) {
          playSound("start");
        }
      }
    }
  };
  let handlePointerMove = event => {
    if (sessionRef.current.pointer !== event.pointerId || !boardRef.current || sessionRef.current.phase !== "playing") return;
    const path = sessionRef.current.path;
    let bounds = boardRef.current.getBoundingClientRect();
    let options = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    };
    setPointerPosition(options);
    let value = boardGeometry.scale * (config.HIT_RADIUS || 0.12);
    let value2 = -1;
    for (let value3 = 0; value3 < level.nodes.length; value3++) if (pointDistance(options, nodeToScreen(level.nodes[value3])) < value) {
      value2 = value3;
      break;
    }
    if (value2 !== -1 && value2 !== path[path.length - 1]) {
      let item = path[path.length - 1];
      if (path.length >= 2 && value2 === path[path.length - 2]) {
        sessionRef.current.path = path.slice(0, -1);
        setPathNodes(sessionRef.current.path);
        playSound("undo");
        return;
      }
      if (level.edges.some(item2 => item2[0] === item && item2[1] === value2 || item2[1] === item && item2[0] === value2)) {
        let value3 = edgeKey(item, value2);
        if (!path.some((item2, index) => index === path.length - 1 ? false : edgeKey(item2, path[index + 1]) === value3)) {
          let items = [...path, value2];
          sessionRef.current.path = items;
          setPathNodes(items);
          if (items.length - 1 === level.edges.length) {
            sessionRef.current.phase = "level_clear";
            setDrawing(false);
            setPointerPosition(null);
            setGamePhase("level_clear");
            playSound(levelIndex === PUZZLE_LEVELS.length - 1 ? "gameover" : "win");
            clearTimeout(sessionRef.current.transition);
            sessionRef.current.transition = setTimeout(() => {
              if (!(!sessionRef.current.alive || sessionRef.current.phase !== "level_clear")) {
                sessionRef.current.pointer = null;
                if (levelIndex === PUZZLE_LEVELS.length - 1) {
                  sessionRef.current.phase = "game_over";
                  setGamePhase("game_over");
                } else {
                  sessionRef.current.phase = "playing";
                  sessionRef.current.path = [];
                  setLevelIndex(value4 => value4 + 1);
                  setPathNodes([]);
                  setGamePhase("playing");
                }
              }
            }, levelIndex === PUZZLE_LEVELS.length - 1 ? 1200 : 1000);
          } else {
            if (canCompletePath(level, items)) {
              playSound("connect", items.length);
            } else {
              failPath();
            }
          }
        }
      }
    }
  };
  let releasePointer = event => {
    if (!(event && event.pointerId !== sessionRef.current.pointer)) {
      if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      sessionRef.current.pointer = null;
      setDrawing(false);
      setPointerPosition(null);
    }
  };
  let resetLevel = async () => {
    clearTimeout(sessionRef.current.transition);
    clearTimeout(sessionRef.current.toast);
    sessionRef.current.phase = "playing";
    sessionRef.current.path = [];
    sessionRef.current.pointer = null;
    initAudio();
    setPathNodes([]);
    setDrawing(false);
    setPointerPosition(null);
    setHintNode(null);
    setGamePhase("playing");
    setToast("");
  };
  let showHint = async () => {
    if (await initAudio(), gamePhase !== "playing") return;
    let hintNode2 = findHintNode(level, pathNodes);
    if (hintNode2 !== null) {
      setHintNode(hintNode2);
    } else {
      playSound("error");
      showToast(config.TEXT_DEAD_END || "Vicolo cieco. Ricomincia.");
    }
  };
  let restartPuzzle = async () => {
    resetLevel();
    setLevelIndex(0);
    setGuideVisible(true);
  };
  let {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: submitRecording
  } = useRecordingSubmission();
  if (React.useEffect(() => {
    sessionRef.current.alive = true;
    return () => {
      sessionRef.current.alive = false;
      clearTimeout(sessionRef.current.transition);
      clearTimeout(sessionRef.current.toast);
      for (const value of [nodeSynthRef.current, winSynthRef.current, errorSynthRef.current]) value?.dispose();
      audioReadyRef.current = false;
    };
  }, []), !config) return <div style={puzzleStyles.loadingContainer} />;
  let renderEdges = () => boardGeometry.width ? level.edges.map((item, index) => {
    let point = nodeToScreen(level.nodes[item[0]]);
    let point2 = nodeToScreen(level.nodes[item[1]]);
    return <line x1={point.x} y1={point.y} x2={point2.x} y2={point2.y} stroke={"var(--line-empty)"} strokeWidth={config.STROKE_WIDTH || 8} strokeLinecap={"round"} key={`e-${index}`} />;
  }) : null;
  let renderCompletedPath = () => {
    if (!boardGeometry.width || pathNodes.length < 2) return null;
    let value = pathNodes.map(item => {
      let point = nodeToScreen(level.nodes[item]);
      return `${point.x},${point.y}`;
    }).join(" ");
    return <polyline points={value} fill={"none"} stroke={gamePhase === "failed" ? "#B4233F" : "var(--primary)"} strokeWidth={(config.STROKE_WIDTH || 8) + 2} strokeLinecap={"round"} strokeLinejoin={"round"} />;
  };
  let renderActiveSegment = () => {
    if (!drawing || !pointerPosition || pathNodes.length === 0) return null;
    let point = nodeToScreen(level.nodes[pathNodes[pathNodes.length - 1]]);
    return <line x1={point.x} y1={point.y} x2={pointerPosition.x} y2={pointerPosition.y} stroke={"var(--primary)"} strokeWidth={(config.STROKE_WIDTH || 8) + 2} strokeLinecap={"round"} opacity={0.6} />;
  };
  let renderNodes = () => boardGeometry.width ? level.nodes.map((item, index) => {
    let point = nodeToScreen(item);
    let value = pathNodes.includes(index);
    return <g key={`n-${index}`}>{hintNode === index && <Motion.motion.circle cx={point.x} cy={point.y} r={(config.NODE_RADIUS || 14) + 8} fill={"transparent"} stroke={"var(--primary)"} strokeWidth={4} initial={{
        scale: 1,
        opacity: 1
      }} animate={{
        scale: 1.5,
        opacity: 0
      }} transition={{
        repeat: 1 / 0,
        duration: 1
      }} />}{<circle cx={point.x} cy={point.y} r={config.NODE_RADIUS || 14} fill={gamePhase === "failed" && index === pathNodes[pathNodes.length - 1] ? "#B4233F" : "var(--primary)"} style={{
        transition: "r 0.2s",
        filter: value ? "brightness(1.1)" : "none"
      }} />}</g>;
  }) : null;
  return <div style={puzzleStyles.container} className={"one-stroke-game"}>{<style>{`
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
          
          --bg-main: #F2ECFC;
          --primary: #6539B5;
          --line-empty: #9780AC;
          --text-main: #2E2045;
          --text-sub: #655375;
          --btn-bg: #E3D7F3;
        }
        
        html, body, #root { 
          width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; 
          background: var(--bg-main); font-family: var(--font-body); 
          touch-action: none; user-select: none; -webkit-user-select: none; 
        }
        * { box-sizing: border-box; }
        .btn-press:active { transform: scale(0.95); opacity: 0.8; }
        button { font-family: var(--font-display); }
      `}</style>}{<div style={puzzleStyles.header} className={"one-stroke-hud"}>{<div style={puzzleStyles.levelText}>{levelIndex + 1}{"/"}{PUZZLE_LEVELS.length}</div>}{<div style={puzzleStyles.headerActions}>{<button style={puzzleStyles.btnSmall} className={"btn-press"} type={"button"} onClick={resetLevel}>{config.BTN_RESET || "Ricomincia"}</button>}</div>}</div>}{<div style={puzzleStyles.playArea} className={"one-stroke-board"} ref={boardRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={releasePointer} onPointerCancel={releasePointer} onLostPointerCapture={releasePointer}>{boardGeometry.width > 0 && <svg style={puzzleStyles.svg}>{renderEdges()}{renderCompletedPath()}{renderActiveSegment()}{renderNodes()}</svg>}</div>}{<div className={"one-stroke-guide"} style={{
      ...puzzleStyles.instruction,
      visibility: guideVisible ? "visible" : "hidden",
      pointerEvents: "none"
    }} aria-hidden={!guideVisible}>{<div style={puzzleStyles.instTitle}>{config.TEXT_CONNECT || "Unisci i punti senza staccare"}</div>}</div>}{<Motion.AnimatePresence>{toast && <Motion.motion.div style={{
        ...puzzleStyles.toast,
        top: "auto",
        bottom: "50px",
        left: "30px",
        right: "30px",
        transform: "none",
        whiteSpace: "normal",
        textAlign: "center",
        fontSize: "18px",
        lineHeight: 1.35,
        padding: "12px 16px"
      }} role={"alert"} aria-atomic={true} initial={{
        opacity: 0,
        y: 20
      }} animate={{
        opacity: 1,
        y: 0
      }} exit={{
        opacity: 0,
        y: -20
      }}>{toast}</Motion.motion.div>}</Motion.AnimatePresence>}{<Motion.AnimatePresence>{gamePhase === "level_clear" && levelIndex < PUZZLE_LEVELS.length - 1 && <Motion.motion.div style={puzzleStyles.levelClearOverlay} initial={{
        opacity: 0
      }} animate={{
        opacity: 1
      }} exit={{
        opacity: 0
      }}>{<Motion.motion.div style={puzzleStyles.clearBadge} initial={{
          scale: 0.35,
          rotate: -12
        }} animate={{
          scale: [0.35, 1.08, 1],
          rotate: [-12, 3, 0]
        }} transition={{
          duration: 0.42,
          ease: "easeOut"
        }}>{<svg width={"72"} height={"72"} viewBox={"0 0 72 72"} fill={"none"} aria-hidden={true}>{<polyline points={"17 37 30 50 56 22"} stroke={"#fff"} strokeWidth={"9"} strokeLinecap={"round"} strokeLinejoin={"round"} />}</svg>}</Motion.motion.div>}</Motion.motion.div>}</Motion.AnimatePresence>}{<Motion.AnimatePresence>{gamePhase === "game_over" && <Motion.motion.div style={puzzleStyles.gameOverScreen} initial={{
        opacity: 0,
        y: "100%"
      }} animate={{
        opacity: 1,
        y: 0
      }} transition={{
        type: "spring",
        damping: 20
      }}>{<h1 style={puzzleStyles.goTitle}>{config.TEXT_ALL_CLEAR || "Ce l’hai fatta!"}</h1>}{<p style={puzzleStyles.goSub}>{config.TEXT_ALL_CLEAR_SUB || "All " + PUZZLE_LEVELS.length + " puzzles solved."}</p>}{<div style={puzzleStyles.goActionArea}>{<button style={puzzleStyles.btnPrimary} className={"btn-press"} type={"button"} onClick={restartPuzzle}>{config.BTN_PLAY_AGAIN || "Rigioca"}</button>}{canSubmit && <button style={{
            ...puzzleStyles.btnPrimary,
            background: submitting ? "#9780AC" : "var(--text-main)",
            color: "#fff"
          }} className={"btn-press"} type={"button"} disabled={submitting} onClick={submitRecording}>{config.BTN_POST_PLAY || "Condividi"}</button>}</div>}</Motion.motion.div>}</Motion.AnimatePresence>}</div>;
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

// ./entry-preview-guide.js
/* Decorative, game-specific guidance. Never dispatches input or changes game state. */
(() => {
  'use strict';

  const mode = "one-stroke";
  if (!['face', 'one-stroke', 'dumpling'].includes(mode)) return;
  const html = document.documentElement;
  const host = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let interacted = false;
  let active = !host;
  let layer = null;
  let board = null;
  let resize = null;
  let compactGuide = null;
  const animations = [];
  html.toggleAttribute('data-entry-feed-preview', host);
  const style = document.createElement('style');
  style.textContent = `
    .entry-demo-layer{position:absolute;inset:0;pointer-events:none;overflow:visible;z-index:8}
    .entry-demo-layer svg{display:block;width:100%;height:100%;overflow:visible}
    .entry-demo-guide-path{fill:none;stroke:var(--primary,#6c5ce7);stroke-width:8;stroke-linecap:round;stroke-linejoin:round;opacity:.78}
    .entry-demo-bun{position:absolute;width:40px;height:40px;object-fit:contain;transform:translate(-50%,-50%);opacity:0;pointer-events:none}
    .entry-demo-cursor{position:absolute;width:18px;height:18px;border:2px solid #6f3218;border-radius:50%;background:#fff9;transform:translate(-50%,-50%);pointer-events:none;opacity:0}
    html[data-entry-feed-preview] .face-game__header{position:absolute;top:12%;left:30px;right:30px;padding:0}
    html[data-entry-feed-preview] .face-game__prompt{font-size:18px;line-height:1.4}
    html[data-entry-feed-preview] #draw-workspace{position:absolute;top:27%;bottom:27%;left:30px;right:30px;padding:0}
    html[data-entry-feed-preview] #draw-toolbar{visibility:hidden}
    html[data-entry-feed-preview] .one-stroke-hud{position:absolute!important;top:12%!important;left:30px!important;right:30px!important;width:auto!important;min-height:42px!important;padding:0!important}
    html[data-entry-feed-preview] .one-stroke-hud button{visibility:hidden}
    html[data-entry-feed-preview] .one-stroke-board{position:absolute!important;inset:28% 30px 32% 30px!important;width:auto!important}
    .entry-demo-copy{display:none;pointer-events:none}
    html[data-entry-feed-preview] .one-stroke-guide{visibility:hidden!important}
    html[data-entry-feed-preview] .entry-demo-copy{display:block;position:absolute;top:70%;left:30px;right:30px;margin:0;font-size:18px;line-height:1.5;font-weight:600;text-align:center;color:var(--text-sub)}
    html[data-entry-feed-preview] .dh-hud{top:12%!important;right:30px!important}
    html[data-entry-feed-preview] .dh-hud span[aria-hidden=true]{display:none}
    html[data-entry-feed-preview] .dh-guide{top:23%!important;right:30px!important}
    html[data-entry-feed-preview] .dh-board{inset:36% 30px 26% 30px!important}
    html[data-entry-feed-preview] .dh-dumpling{width:28px!important;height:28px!important}
    html[data-entry-feed-preview] .dh-guide span{font-size:18px;line-height:1.35}
    html[data-entry-demo-stopped] :is(.entry-demo-layer,.entry-demo-copy){display:none}
    @media(prefers-reduced-motion:reduce){.entry-demo-layer *{animation:none!important}}
  `;
  document.head.append(style);
  const cancel = () => {
    for (const animation of animations.splice(0)) animation.cancel();
  };
  function stop() {
    interacted = true;
    html.setAttribute('data-entry-demo-stopped', '');
    cancel();
    if (layer) layer.hidden = true;
    observer.disconnect();
    resize?.disconnect();
  }
  window.PlayableEntryPreview = {
    stop
  };
  function drawLine(points, viewBox, width) {
    layer.innerHTML = `<svg class="entry-demo-svg" viewBox="${viewBox}" aria-hidden="true"><path class="entry-demo-guide-path" stroke-width="${width}"/></svg>`;
    const path = layer.querySelector('path');
    path.setAttribute('d', points);
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
    if (reduced?.matches || typeof path.animate !== 'function') {
      path.style.strokeDashoffset = String(length * 0.45);
      return;
    }
    animations.push(path.animate([{
      strokeDashoffset: String(length),
      opacity: 0.3,
      offset: 0
    }, {
      strokeDashoffset: '0',
      opacity: 0.85,
      offset: 0.65
    }, {
      strokeDashoffset: '0',
      opacity: 0.85,
      offset: 0.85
    }, {
      strokeDashoffset: '0',
      opacity: 0,
      offset: 1
    }], {
      duration: 3700,
      iterations: Infinity,
      easing: 'linear'
    }));
  }
  function render() {
    if (!layer || interacted || host && active) return;
    cancel();
    layer.hidden = false;
    if (mode === 'face') {
      drawLine('M210 360 C220 245 355 245 370 360 C355 445 220 445 210 360 M520 360 C535 245 670 245 680 360 C665 445 535 445 520 360', '0 0 900 900', 12);
    } else if (mode === 'one-stroke') {
      const lines = [...(board.querySelector('svg')?.querySelectorAll('line') || [])];
      if (!lines.length) return;
      const point = (line, suffix) => [Number(line.getAttribute('x' + suffix)), Number(line.getAttribute('y' + suffix))];
      const same = (value4, otherValue) => value4[0] === otherValue[0] && value4[1] === otherValue[1];
      const value = point(lines[0], '1');
      const value2 = point(lines[0], '2');
      const next = lines.slice(1).find(line => same(point(line, '1'), value2) || same(point(line, '2'), value2));
      const value3 = next ? point(next, same(point(next, '1'), value2) ? '2' : '1') : value2;
      drawLine(`M${value.join(' ')} L${value2.join(' ')} L${value3.join(' ')}`, `0 0 ${board.clientWidth} ${board.clientHeight}`, 10);
    } else {
      const target = board.querySelector('.dh-dumpling');
      if (!target) return;
      const config = JSON.parse(runtimeConfig.textContent);
      const opened = config.images.find(image => image.id === 'IMG_MODIFIED')?.path;
      if (!opened) return;
      layer.replaceChildren();
      const image = document.createElement('img');
      const cursor = document.createElement('span');
      image.className = 'entry-demo-bun';
      image.src = opened;
      image.alt = '';
      image.draggable = false;
      cursor.className = 'entry-demo-cursor';
      for (const element of [image, cursor]) {
        element.style.left = target.style.left;
        element.style.top = target.style.top;
        layer.append(element);
      }
      if (reduced?.matches || typeof image.animate !== 'function') {
        image.style.opacity = '.65';
        return;
      }
      animations.push(image.animate([{
        opacity: 0,
        offset: 0
      }, {
        opacity: 0,
        offset: 0.3
      }, {
        opacity: 1,
        offset: 0.4
      }, {
        opacity: 1,
        offset: 0.78
      }, {
        opacity: 0,
        offset: 1
      }], {
        duration: 3200,
        iterations: Infinity
      }));
      animations.push(cursor.animate([{
        opacity: 0,
        offset: 0
      }, {
        opacity: 0.9,
        offset: 0.2
      }, {
        opacity: 0.9,
        offset: 0.3
      }, {
        opacity: 0,
        offset: 0.45
      }, {
        opacity: 0,
        offset: 1
      }], {
        duration: 3200,
        iterations: Infinity
      }));
    }
    if (document.hidden) for (const animation of animations) animation.pause();
  }
  function attach() {
    if (layer || interacted || host && active) return;
    board = document.querySelector(mode === 'face' ? '.face-game__canvas-wrap' : mode === 'one-stroke' ? '.one-stroke-board' : '.dh-board');
    if (!board || mode === 'one-stroke' && !board.querySelector('svg line')) return;
    layer = document.createElement('div');
    layer.className = 'entry-demo-layer';
    layer.setAttribute('aria-hidden', 'true');
    board.append(layer);
    if (mode === 'one-stroke' && host && !compactGuide) {
      compactGuide = document.createElement('p');
      compactGuide.className = 'entry-demo-copy';
      compactGuide.textContent = "Unisci con un solo tratto";
      board.parentElement.append(compactGuide);
    }
    observer.disconnect();
    resize = observeGameSize(render);
    resize.observe(board);
    render();
  }
  const observer = new MutationObserver(attach);
  observer.observe(document.getElementById('root'), {
    childList: true,
    subtree: true
  });
  attach();
  window.addEventListener('message', event => {
    if (!host || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
    html.toggleAttribute('data-entry-feed-preview', !active);
    if (active) {
      cancel();
      if (layer) layer.hidden = true;
    } else if (!interacted) {
      attach();
      render();
    }
  });
  document.addEventListener('visibilitychange', () => {
    for (const animation of animations) {
      if (document.hidden) {
        animation.pause();
      } else {
        animation.play();
      }
    }
  });
  reduced?.addEventListener?.('change', render);
  window.addEventListener('pagehide', () => {
    cancel();
    observer.disconnect();
    resize?.disconnect();
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
        "data-subject": "#root svg",
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

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [".entry-demo-copy,.one-stroke-guide"];
  const copy = new Set(["Aiuto"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
