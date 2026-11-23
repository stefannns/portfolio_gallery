// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "BATTERY_START",
    "kind": "number",
    "label": "Start Battery (%)",
    "value": 25,
    "default": 25,
    "min": 5,
    "max": 90,
    "step": 1
  }, {
    "id": "DRAIN_BASE",
    "kind": "number",
    "label": "Drain Speed Base",
    "value": 1.5,
    "default": 1.5,
    "min": 0.5,
    "max": 5,
    "step": 0.1
  }, {
    "id": "DRAIN_PENALTY",
    "kind": "number",
    "label": "Drain Penalty Multiplier",
    "value": 3,
    "default": 3,
    "min": 1,
    "max": 8,
    "step": 1
  }, {
    "id": "CHARGE_AMOUNT",
    "kind": "number",
    "label": "Charge Amount Per Hit",
    "value": 15,
    "default": 15,
    "min": 5,
    "max": 40,
    "step": 1
  }, {
    "id": "SWING_SPEED",
    "kind": "number",
    "label": "Cable Swing Speed",
    "value": 0.003,
    "default": 0.003,
    "min": 0.001,
    "max": 0.01,
    "step": 0.001
  }, {
    "id": "MAX_ANGLE",
    "kind": "number",
    "label": "Cable Swing Max Angle",
    "value": 50,
    "default": 50,
    "min": 20,
    "max": 80,
    "step": 1
  }, {
    "id": "TOLERANCE_ANGLE",
    "kind": "number",
    "label": "Hit Tolerance Angle",
    "value": 6,
    "default": 6,
    "min": 2,
    "max": 15,
    "step": 1
  }],
  "texts": [{
    "id": "TITLE",
    "label": "Game Title",
    "value": "Ricarica al momento giusto",
    "default": "Ricarica al momento giusto",
    "max_length": 40
  }, {
    "id": "TXT_CHARGING",
    "label": "Charging State Text",
    "value": "IN CARICA",
    "default": "IN CARICA",
    "max_length": 20
  }, {
    "id": "TXT_TIMEOUT",
    "label": "Timeout State Text",
    "value": "TEMPO SCADUTO",
    "default": "TEMPO SCADUTO",
    "max_length": 25
  }, {
    "id": "TXT_LOW",
    "label": "Low Battery Text",
    "value": "BATTERIA SCARICA",
    "default": "BATTERIA SCARICA",
    "max_length": 20
  }, {
    "id": "TXT_RECHARGE",
    "label": "Recharge Text",
    "value": "RICARICA",
    "default": "RICARICA",
    "max_length": 20
  }, {
    "id": "TXT_FULL",
    "label": "Fully Charged Text",
    "value": "CARICA COMPLETA",
    "default": "CARICA COMPLETA",
    "max_length": 20
  }, {
    "id": "TXT_DIED",
    "label": "Phone Died Text",
    "value": "BATTERIA ESAURITA",
    "default": "BATTERIA ESAURITA",
    "max_length": 20
  }, {
    "id": "BTN_PLAY_AGAIN",
    "label": "Play Again Button",
    "value": "Rigioca",
    "default": "Rigioca",
    "max_length": 20
  }],
  "images": [{
    "id": "CABLE_HEAD",
    "label": "Cable Head Img",
    "path": "./assets/cable_connector.svg",
    "replaceable": true
  }],
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
    body { background: #e5f1ed; overscroll-behavior: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
    #root { isolation: isolate; }
    canvas { touch-action: none; }
    button, input, select, textarea { touch-action: manipulation; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.feed-first-action{position:fixed!important;top:70%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(p.feed-first-action){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(p.feed-first-action){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(p.feed-first-action){animation:none!important}}

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
var chargingAudio = {
  ready: false,
  synths: {}
};
function playChargingSound(value) {
  if (!chargingAudio.ready) return;
  let timestamp = Tone.now();
  if (value === "tick") {
    chargingAudio.synths.tick.triggerAttackRelease("C2", "32n", timestamp);
  }
  if (value === "shoot") {
    chargingAudio.synths.shoot.triggerAttackRelease("C5", "16n", timestamp);
  }
  if (value === "success") {
    chargingAudio.synths.success.triggerAttackRelease(["E4", "G4", "C5"], "8n", timestamp);
  }
  if (value === "fail") {
    chargingAudio.synths.fail.triggerAttackRelease("C3", "8n", timestamp);
  }
}
async function initChargingAudio() {
  if (!chargingAudio.ready) try {
    await Tone.start();
    chargingAudio.synths.tick = new Tone.MembraneSynth({
      pitchDecay: 0.01,
      octaves: 1
    }).toDestination();
    chargingAudio.synths.tick.volume.value = -15;
    chargingAudio.synths.shoot = new Tone.Synth({
      envelope: {
        attack: 0.01,
        decay: 0.2,
        sustain: 0
      }
    }).toDestination();
    chargingAudio.synths.success = new Tone.PolySynth(Tone.Synth).toDestination();
    chargingAudio.synths.success.volume.value = -5;
    chargingAudio.synths.fail = new Tone.Synth({
      oscillator: {
        type: "sawtooth"
      }
    }).toDestination();
    chargingAudio.synths.fail.volume.value = -10;
    chargingAudio.ready = true;
  } catch (value) {
    console.warn("Audio start failed", value);
  }
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("playing");
  let [endReason, setEndReason] = React.useState(null);
  let {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: submitRecording
  } = useRecordingSubmission();
  let chargingRef = React.useRef({
    battery: 25,
    plugState: "swing",
    angle: 0,
    cableY: 0,
    plugTimer: 0,
    drainMultiplier: 1,
    lastTime: 0,
    maxReach: 200
  });
  let screenGlowRef = React.useRef(null);
  let cableRef = React.useRef(null);
  let connectorRef = React.useRef(null);
  let batteryTextRef = React.useRef(null);
  let lowBatteryRef = React.useRef(null);
  let animationRef = React.useRef(null);
  let batteryRingRef = React.useRef(null);
  let phoneRef = React.useRef(null);
  const [hasInteracted, setHasInteracted] = React.useState(false);
  const interactedRef = React.useRef(false);
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
        let config2 = readConfigValues(options);
        setConfig(config2);
        chargingRef.current.battery = config2.BATTERY_START || 25;
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  let animateCharging = React.useCallback(value => {
    if (!config || phase !== "playing") return;
    let current = chargingRef.current;
    if (!current.lastTime) {
      current.lastTime = value;
    }
    let value2 = Math.min(value - current.lastTime, 50);
    if (current.lastTime = value, interactedRef.current && (current.battery -= config.DRAIN_BASE * current.drainMultiplier * value2 / 1000), current.battery <= 0) {
      current.battery = 0;
      setEndReason("died");
      setPhase("over");
      playChargingSound("fail");
      return;
    }
    if (current.battery >= 100) {
      current.battery = 100;
      setEndReason("full");
      setPhase("over");
      playChargingSound("success");
      return;
    }
    if (current.plugState === "swing") {
      current.angle = Math.sin(value * config.SWING_SPEED) * config.MAX_ANGLE;
      current.cableY = 0;
    } else {
      if (current.plugState === "plugging") {
        current.cableY += value2 * 1.5;
        if (current.cableY >= current.maxReach) {
          if (Math.abs(current.angle) <= config.TOLERANCE_ANGLE) {
            current.plugState = "plugged";
            current.angle = 0;
            current.cableY = current.maxReach;
            current.battery = Math.min(100, current.battery + config.CHARGE_AMOUNT);
            if (current.battery >= 100) {
              setEndReason("full");
              setPhase("over");
            }
            playChargingSound("success");
          } else {
            current.plugState = "plugged_fail";
            current.drainMultiplier = config.DRAIN_PENALTY;
            playChargingSound("fail");
          }
          current.plugTimer = 0;
        }
      } else {
        if (current.plugState === "plugged" || current.plugState === "plugged_fail") {
          current.plugTimer += value2;
          if (current.plugTimer > 800) {
            current.plugState = "returning";
            current.drainMultiplier = 1;
          }
        } else {
          if (current.plugState === "returning") {
            current.cableY -= value2 * 1.5;
            if (current.cableY <= 0) {
              current.cableY = 0;
              current.plugState = "swing";
            }
          }
        }
      }
    }
    if (phoneRef.current) {
      phoneRef.current.dataset.charging = String(current.plugState === "plugged");
    }
    if (batteryRingRef.current) {
      batteryRingRef.current.style.strokeDashoffset = String(289.03 * (1 - current.battery / 100));
      batteryRingRef.current.style.stroke = current.battery <= 20 && current.plugState !== "plugged" ? "#f87171" : "#83efaf";
    }
    if (cableRef.current && connectorRef.current) {
      cableRef.current.style.transform = `translateX(-50%) rotate(${current.angle}deg)`;
      connectorRef.current.style.transform = `translateY(${-current.cableY}px)`;
    }
    if (batteryTextRef.current) {
      batteryTextRef.current.innerText = Math.floor(current.battery) + "%";
      batteryTextRef.current.style.color = current.battery > 50 ? "var(--color-green)" : current.battery > 20 ? "var(--color-yellow)" : "var(--color-red)";
    }
    if (lowBatteryRef.current) {
      if (current.plugState === "plugged") {
        lowBatteryRef.current.innerText = config.TXT_CHARGING;
        lowBatteryRef.current.style.color = "var(--color-green)";
      } else {
        if (current.plugState === "plugged_fail") {
          lowBatteryRef.current.innerText = config.TXT_TIMEOUT;
          lowBatteryRef.current.style.color = "var(--color-red)";
        } else {
          if (current.battery <= 20) {
            lowBatteryRef.current.innerText = config.TXT_LOW;
            lowBatteryRef.current.style.color = "var(--color-red)";
          } else {
            lowBatteryRef.current.innerText = config.TXT_RECHARGE;
            lowBatteryRef.current.style.color = "var(--color-gray)";
          }
        }
      }
    }
    animationRef.current = requestAnimationFrame(animateCharging);
  }, [config, phase]);
  React.useEffect(() => {
    animationRef.current = requestAnimationFrame(animateCharging);
    return () => cancelAnimationFrame(animationRef.current);
  }, [animateCharging]);
  let tryConnect = () => {
    if (phase !== "playing") return;
    let current = chargingRef.current;
    if (current.plugState === "swing") {
      if (interactedRef.current = true, setHasInteracted(true), current.plugState = "plugging", screenGlowRef.current) {
        let bounds = screenGlowRef.current.getBoundingClientRect();
        let value = cableRef.current?.querySelector('img[alt="cable"]')?.getBoundingClientRect();
        current.maxReach = Math.max(24, (value ? value.top : window.innerHeight - 40) - bounds.bottom + 14);
      }
      initChargingAudio().then(() => playChargingSound("shoot")).catch(() => {});
    }
  };
  let restartCharging = () => {
    interactedRef.current = false;
    setHasInteracted(false);
    chargingRef.current.battery = config.BATTERY_START;
    chargingRef.current.plugState = "swing";
    chargingRef.current.cableY = 0;
    chargingRef.current.plugTimer = 0;
    chargingRef.current.drainMultiplier = 1;
    chargingRef.current.lastTime = performance.now();
    setPhase("playing");
  };
  const handleKeyDown = event => {
    if (!(event.target !== event.currentTarget || ![" ", "Enter"].includes(event.key) || event.repeat)) {
      event.preventDefault();
      tryConnect();
    }
  };
  return config ? <React.Fragment>{<style />}{<div style={{
      width: "100%",
      height: "100%",
      position: "relative",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      touchAction: "none",
      containerType: "size",
      background: "radial-gradient(ellipse at 50% 24%, #ffffff 0%, #e5f1ed 56%, #ccded6 100%)"
    }} className={"charging-game"} tabIndex={0} role={"application"} aria-label={"Tocca o premi Spazio quando il cavo è allineato alla presa."} onKeyDown={handleKeyDown} onPointerDown={value => {
      if (value.isPrimary !== false && !(value.button > 0)) {
        tryConnect();
      }
    }}>{phase === "playing" && !hasInteracted && <p className={"feed-first-action"} style={{
        position: "absolute",
        top: "calc(64% + 24px)",
        left: 30,
        right: 30,
        zIndex: 12,
        margin: 0,
        fontSize: 18,
        lineHeight: 1.35,
        textAlign: "center",
        pointerEvents: "none",
        color: "#244c43"
      }}>{"Tocca quando il cavo è allineato"}</p>}{<div ref={phoneRef} className={"charging-phone"} style={{
        position: "absolute",
        top: "calc(54px + env(safe-area-inset-top, 0px))",
        width: "min(47cqw, 29cqh)",
        maxWidth: "230px",
        aspectRatio: "0.53",
        border: "5px solid #6b7d78",
        borderRadius: "28px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(ellipse at 20% 26%,#285e5c,transparent 65%),linear-gradient(165deg,#142f35,#091c29 70%)",
        boxShadow: "0 16px 24px #234b4124,0 0 0 2px #bdcbc6,inset 0 0 0 2px #020f16",
        zIndex: 5,
        pointerEvents: "none"
      }}>{<span className={"phone-speaker"} aria-hidden={true} />}{<svg className={"charge-ring"} viewBox={"0 0 112 112"} aria-hidden={true}>{<circle cx={56} cy={56} r={46} fill={"none"} stroke={"#ffffff26"} strokeWidth={7} />}{<circle ref={batteryRingRef} cx={56} cy={56} r={46} fill={"none"} stroke={"#83efaf"} strokeWidth={7} strokeLinecap={"round"} strokeDasharray={"289.03"} strokeDashoffset={289.03 * (1 - chargingRef.current.battery / 100)} transform={"rotate(-90 56 56)"} />}{<path className={"charge-bolt"} d={"M60 28 39 59h15l-4 25 23-34H58z"} fill={"#83efaf"} />}</svg>}{<div ref={batteryTextRef} style={{
          fontFamily: "var(--font-display)",
          fontSize: "28px",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
          color: "var(--color-red)",
          letterSpacing: "0px",
          textShadow: "none",
          marginTop: "12px"
        }}>{Math.floor(chargingRef.current.battery)}{"%"}</div>}{<div ref={lowBatteryRef} style={{
          width: "100%",
          padding: "0 10px",
          boxSizing: "border-box",
          textAlign: "center",
          whiteSpace: "normal",
          overflowWrap: "normal",
          fontFamily: "var(--font-body)",
          fontSize: "16px",
          lineHeight: 1.35,
          fontWeight: "bold",
          color: "var(--color-red)",
          marginTop: "8px",
          letterSpacing: "0px",
          textTransform: "none"
        }}>{config.TXT_LOW}</div>}{<div ref={screenGlowRef} style={{
          position: "absolute",
          bottom: "-6px",
          width: "28px",
          height: "6px",
          background: "#102721",
          borderRadius: "4px"
        }} />}</div>}{<div ref={cableRef} style={{
        position: "absolute",
        bottom: 0,
        left: "50%",
        width: "16px",
        height: "100vh",
        transformOrigin: "bottom center",
        transform: "translateX(-50%)",
        pointerEvents: "none",
        zIndex: 6
      }}>{<div ref={connectorRef} style={{
          width: "100%",
          height: "100%",
          position: "relative"
        }}>{<div style={{
            position: "absolute",
            top: "40px",
            width: "100%",
            height: "100%",
            background: "#e5e7eb",
            borderRadius: "8px"
          }} />}{<img src={config.CABLE_HEAD} alt={"cable"} style={{
            position: "absolute",
            top: 0,
            left: "50%",
            transform: "translateX(-50%)",
            width: "32px",
            height: "45px",
            objectFit: "contain"
          }} />}</div>}</div>}{phase === "over" && <div style={{
        position: "absolute",
        inset: 0,
        background: "rgba(229,241,237,0.94)",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center"
      }}>{<h1 style={{
          fontFamily: "var(--font-display)",
          fontSize: "24px",
          fontWeight: 700,
          lineHeight: 1.3,
          textAlign: "center",
          maxWidth: "calc(100% - 60px)",
          overflowWrap: "anywhere",
          color: endReason === "full" ? "#18774b" : "#a53435",
          marginBottom: "40px"
        }}>{endReason === "full" ? config.TXT_FULL : config.TXT_DIED}</h1>}{<div style={{
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          justifyContent: "center"
        }}>{<button onClick={restartCharging} style={{
            padding: "16px 32px",
            fontFamily: "var(--font-display)",
            fontSize: "18px",
            fontWeight: 700,
            lineHeight: 1.35,
            background: "white",
            color: "black",
            border: "none",
            borderRadius: "12px",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(255,255,255,0.2)"
          }}>{config.BTN_PLAY_AGAIN}</button>}{canSubmit && <button type={"button"} disabled={submitting} onClick={submitRecording} style={{
            padding: "16px 32px",
            fontFamily: "var(--font-display)",
            fontSize: "18px",
            fontWeight: 700,
            lineHeight: 1.35,
            background: "var(--color-red)",
            color: "white",
            border: "none",
            borderRadius: "12px",
            cursor: "pointer",
            opacity: submitting ? 0.55 : 1,
            boxShadow: "0 4px 12px rgba(248,113,113,0.3)"
          }}>{"Condividi"}</button>}</div>}</div>}</div>}</React.Fragment> : <div style={{
    width: "100%",
    height: "100%",
    background: "var(--bg-color)"
  }} />;
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

// ./phone-cable-repair.js
(() => {
  const style = document.createElement('style');
  style.textContent = `
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
      --font-display: "Poppins", "Helvetica Neue", "PingFang SC", sans-serif;
      --font-body: var(--font-display);
      --font-mono: var(--font-display);
      --bg-color: #e5f1ed;
      --phone-border: #333;
      --color-green: #4ade80;
      --color-red: #f87171;
      --color-yellow: #facc15;
      --color-gray: #c7ddd5;
    }
    html, body, #root {
      width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden;
      background: var(--bg-color); user-select: none; -webkit-user-select: none; touch-action: none;
      font-family: var(--font-body);
      font-weight: 400;
      -webkit-font-smoothing: antialiased;
    }
    button { font-family: var(--font-body); font-weight: 700; }
    * { box-sizing: border-box; }
    .phone-speaker { position:absolute;top:10px;width:34%;height:10px;background:#041114;border-radius:8px; }
    .charge-ring { width:66%;max-width:140px;flex-shrink:0;overflow:visible; }
    .charge-bolt { opacity:.55; }
    [data-charging="true"] .charge-ring { filter:drop-shadow(0 0 6px #70e9a366); }
    [data-charging="true"] .charge-bolt { opacity:1;animation:charge-pulse .8s ease-in-out infinite alternate; }
    @keyframes charge-pulse { to { opacity:.6; } }
    .charging-game:focus-visible { outline:3px solid #287966;outline-offset:-4px; }
    @media (prefers-reduced-motion:reduce) { .charge-bolt { animation:none!important; } }
    @media (max-height:450px) { .charging-phone { width:min(30cqw,37cqh)!important;top:18px!important; } .charge-ring {width:48%;} .charging-phone > div {font-size:16px!important;margin-top:4px!important;} .charging-game .feed-first-action {left:62%!important;right:12px!important;top:35%!important;} }
  `;
  document.head.appendChild(style);
  const sizeCable = () => {
    const head = document.querySelector('img[alt="cable"]');
    if (!head) return false;
    const moving = head.parentElement;
    const anchor = moving?.parentElement;
    if (!moving || !anchor) return false;
    anchor.style.bottom = '0';
    anchor.style.transformOrigin = 'bottom center';
    const originalLine = head.previousElementSibling;
    if (originalLine) originalLine.style.display = 'none';
    head.style.display = 'block';
    head.style.top = 'auto';
    head.style.bottom = 'calc(72px + env(safe-area-inset-bottom, 0px))';
    head.style.left = '50%';
    head.style.width = '32px';
    head.style.height = '46px';
    head.style.objectFit = 'contain';
    head.style.zIndex = '2';
    moving.style.zIndex = '2';
    const wire = document.createElement('div');
    wire.style.cssText = 'position:absolute;bottom:0;left:0;width:16px;height:calc(var(--cable-rise, 0px) + 72px + env(safe-area-inset-bottom, 0px));background:linear-gradient(90deg,#475569 0%,#f8fafc 42%,#cbd5e1 62%,#64748b 100%);border:1px solid #334155;border-radius:8px;box-shadow:0 0 8px rgba(255,255,255,.28);z-index:1;pointer-events:none';
    anchor.insertBefore(wire, moving);
    const syncWire = () => {
      if (!anchor.isConnected) return;
      const rise = Math.max(0, Number.parseFloat(moving.style.transform.match(/translateY\(-([\d.]+)px\)/)?.[1] || '0'));
      wire.style.setProperty('--cable-rise', `${Math.ceil(rise)}px`);
      requestAnimationFrame(syncWire);
    };
    syncWire();
    return true;
  };
  if (!sizeCable()) {
    const observer = new MutationObserver(() => {
      if (sizeCable()) observer.disconnect();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})();

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root img[alt=\"cable\"]",
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
  const selectors = ["p.feed-first-action"];
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
