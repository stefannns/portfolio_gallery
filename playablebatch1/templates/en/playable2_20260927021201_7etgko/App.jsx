// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "BOSS_MAX_HP",
    "kind": "number",
    "label": "Boss Max HP",
    "value": 100,
    "default": 100,
    "min": 100,
    "max": 2000,
    "step": 50
  }, {
    "id": "BOSS_SPEED",
    "kind": "number",
    "label": "Boss Speed",
    "value": 0.25,
    "default": 0.25,
    "min": 0.1,
    "max": 0.6,
    "step": 0.05
  }],
  "texts": [{
    "id": "UI_POST_TITLE",
    "label": "Post Title",
    "value": "LIKE IF YOU HATE BUGS",
    "default": "LIKE IF YOU HATE BUGS",
    "max_length": 30
  }, {
    "id": "UI_AUTHOR_NAME",
    "label": "Author Name",
    "value": "Bug_Hater",
    "default": "Bug_Hater",
    "max_length": 20
  }, {
    "id": "UI_HATE_TEXT",
    "label": "Hate Text",
    "value": "people hate bugs",
    "default": "people hate bugs",
    "max_length": 30
  }, {
    "id": "BTN_LIKE",
    "label": "Like Button",
    "value": "8.8K",
    "default": "8.8K",
    "max_length": 10
  }, {
    "id": "BTN_REPLAY",
    "label": "Replay Button",
    "value": "Play Again",
    "default": "Play Again",
    "max_length": 20
  }, {
    "id": "BTN_POST",
    "label": "Post Button",
    "value": "Post My Play",
    "default": "Post My Play",
    "max_length": 20
  }, {
    "id": "MSG_VICTORY",
    "label": "Victory Message",
    "value": "BUG SQUASHED!",
    "default": "BUG SQUASHED!",
    "max_length": 40
  }],
  "images": [{
    "id": "IMG_AVATAR",
    "label": "Author Avatar",
    "path": "./assets/img_avatar.webp",
    "replaceable": true
  }, {
    "id": "IMG_FEED_MAIN",
    "label": "Feed Main Image",
    "path": "./assets/bug-v3/cockroach-body.webp",
    "replaceable": true
  }, {
    "id": "IMG_BOSS",
    "label": "Bug Boss Character",
    "path": "./assets/bug-v3/cockroach-body.webp",
    "replaceable": true
  }, {
    "id": "IMG_MEME_SPAWN",
    "label": "Spawn Meme Effect",
    "path": "./assets/img_meme_spawn.webp",
    "replaceable": true
  }, {
    "id": "IMG_MEME_WIN",
    "label": "Victory Meme Effect",
    "path": "./assets/img_meme_win.webp",
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
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
    /* Keep social metadata and like controls outside device edge zones. */
    .feed-container { padding: 40px 16px !important; box-sizing: border-box; }
  

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
for (const value of ['playable-inline-config', 'playable-config-inline']) {
  const node = document.createElement('script');
  node.id = value;
  node.type = 'application/json';
  node.textContent = JSON.stringify(DEFAULT_CONFIG);
  document.body.append(node);
}
document.documentElement.lang = 'en';
function CV(config) {
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
function kV(stateRef, otherValue) {
  let timestamp = Tone.now();
  let value = stateRef.current.lastTime[otherValue] || 0;
  let value2 = timestamp > value ? timestamp : value + 0.001;
  stateRef.current.lastTime[otherValue] = value2;
  return value2;
}
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
function TV() {
  return <style>{`
    @font-face {
      font-family: 'Bangers';
      src: url('./assets/fonts/bangers/Bangers-Regular.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    :root {
      --font-display: "Bangers", "PingFang SC", system-ui, sans-serif;
      --font-body: -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
      --font-mono: ui-monospace, Menlo, monospace;
      --color-bg: #0f0f11;
      --color-panel: #1c1c1e;
      --color-accent: #ff3b30;
      --color-text: #ffffff;
      --color-text-dim: #8e8e93;
    }
    html, body, #root { 
      width: 100%; height: 100%; margin: 0; padding: 0; 
      overflow: hidden; background-color: var(--color-bg);
      color: var(--color-text); font-family: var(--font-body);
      user-select: none; -webkit-user-select: none;
      touch-action: none;
    }
    * { box-sizing: border-box; }
    
    .feed-container {
      width: 100%; max-width: 500px; margin: 0 auto;
      height: 100%; display: flex; flex-direction: column;
      background: var(--color-bg);
    }
    
    .boss-entity {
      position: absolute;
      top: 0; left: 0;
      will-change: transform;
      cursor: pointer;
      touch-action: none;
    }
  `}</style>;
}
// Raster chitin body with a six-legged alternating-tripod crawl.
// The gait follows distance travelled, so feet stop stepping during a pause.
function CrawlingBug({ source, poseRef, moving = false, defeated = false }) {
  const canvasRef = React.useRef(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const image = new Image();
    let frame = 0;
    let disposed = false;
    image.src = source;
    function stroke(points, width, color) {
      ctx.beginPath();
      points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    function draw(time = 0) {
      if (disposed) return;
      const pose = moving && poseRef ? poseRef.current : null;
      const phase = pose?.gait || 0;
      const stepping = pose && pose.speed > .025 && !defeated;
      const antennaTime = defeated ? 0 : time * .001;
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.clearRect(0, 0, 220, 220);
      ctx.save();
      ctx.translate(110, 110);
      ctx.scale(.9, .9);
      ctx.rotate(pose?.heading || 0);
      if (defeated) ctx.scale(1.12, .82);
      else if (pose && time < (pose.hitUntil || 0)) ctx.scale(1.07, .93);
      // A compact contact shadow; the insect stays on the surface.
      ctx.fillStyle = 'rgba(0,0,0,.26)';
      ctx.beginPath();ctx.ellipse(1, 4, 25, 50, 0, 0, Math.PI * 2);ctx.fill();
      ctx.lineCap = 'round';ctx.lineJoin = 'round';
      for (let side = -1; side <= 1; side += 2) {
        for (let row = 0; row < 3; row++) {
          const cycle = ((phase / (Math.PI * 2) + ((row + (side > 0 ? 1 : 0)) % 2) * .5) % 1 + 1) % 1;
          const stance = cycle < .63;
          const stride = !stepping ? 0 : stance ? -13 + 26 * cycle / .63 : 13 * Math.cos((cycle - .63) / .37 * Math.PI);
          const lift = !stepping || stance ? 0 : Math.sin((cycle - .63) / .37 * Math.PI) * 6;
          const hip = [side * 16, -30 + row * 16];
          const foot = [side * ([57, 72, 61][row] - lift * .4), [-47, 9, 62][row] + stride];
          const dx = foot[0] - hip[0], dy = foot[1] - hip[1];
          const length = Math.min(73.5, Math.hypot(dx, dy));
          const ux = dx / Math.hypot(dx, dy), uy = dy / Math.hypot(dx, dy);
          const along = (32 * 32 - 42 * 42 + length * length) / (2 * length);
          const bend = Math.sqrt(Math.max(0, 32 * 32 - along * along));
          const elbow = [hip[0] + ux * along + uy * bend * side, hip[1] + uy * along - ux * bend * side];
          const ankle = [foot[0] + side * 7, foot[1] + (row === 0 ? -7 : 8)];
          ctx.save();
          ctx.translate(1.5, 2.5);stroke([hip, elbow, foot, ankle], 4, 'rgba(0,0,0,.2)');ctx.restore();
          const gradient = ctx.createLinearGradient(hip[0], hip[1], foot[0], foot[1]);
          gradient.addColorStop(0, '#2d160b');gradient.addColorStop(.38, '#aa6631');gradient.addColorStop(.52, '#6a3819');gradient.addColorStop(1, '#ba7842');
          stroke([hip, elbow], 5.1, '#341c10');stroke([hip, elbow], 3.2, gradient);
          stroke([elbow, foot], 3.1, '#3b2113');stroke([elbow, foot], 1.8, gradient);
          stroke([foot, ankle, [ankle[0] + side * 4, ankle[1] + 4]], 1.1, '#b37b4c');
          ctx.fillStyle = '#7e4926';ctx.beginPath();ctx.arc(elbow[0], elbow[1], 2.5, 0, Math.PI * 2);ctx.fill();
          // Short tibial spines break up the smooth limb silhouette.
          for (let spine = 1; spine <= 4; spine++) {
            const f = spine / 5, x = elbow[0] + (foot[0] - elbow[0]) * f, y = elbow[1] + (foot[1] - elbow[1]) * f;
            stroke([[x, y], [x + side * 3, y - 2.5]], .85, '#8b5b32');
          }
        }
        // Long, fine segmented feelers sweep independently of the legs.
        const scan = Math.sin(antennaTime * 3.2 + side) * 5;
        ctx.beginPath();ctx.moveTo(side * 7, -48);
        ctx.bezierCurveTo(side * 17, -63, side * (35 + scan), -73, side * (42 + scan), -83);
        // Complete the feeler in a second curve for a fine tapered tip.
        ctx.strokeStyle = '#a8794b';ctx.lineWidth = 1.2;ctx.stroke();
        ctx.beginPath();ctx.moveTo(side * (42 + scan), -83);
        ctx.quadraticCurveTo(side * (48 + scan), -96, side * (56 + scan), -101 + scan * .35);
        ctx.strokeStyle = '#b18a5c';ctx.lineWidth = .65;ctx.stroke();
        stroke([[side * 8, 46], [side * 11, 55]], 1.5, '#94582c');
      }
      // The generated body is already straight overhead and naturally textured.
      if (image.complete && image.naturalWidth) {
        const bodyWidth = 104 * image.naturalWidth / image.naturalHeight;
        ctx.drawImage(image, -bodyWidth / 2, -51, bodyWidth, 104);
      }
      ctx.restore();
      if (moving && !defeated && !document.hidden) frame = requestAnimationFrame(draw);
    }
    image.addEventListener('load', () => { if (!moving) draw(); });
    draw();
    function visibility() { cancelAnimationFrame(frame); if (!document.hidden) draw(performance.now()); }
    document.addEventListener('visibilitychange', visibility);
    return () => { disposed = true;cancelAnimationFrame(frame);document.removeEventListener('visibilitychange', visibility); };
  }, [source, moving, poseRef, defeated]);
  return <canvas ref={canvasRef} width={440} height={440} aria-label="Realistic top-down cockroach" role="img" style={{ width:'100%',height:'100%',display:'block',pointerEvents:'none' }} />;
}

function App() {
  let [config, setConfig] = React.useState(null);
  let [count, setCount] = React.useState(0);
  let [count2, setCount2] = React.useState(6699);
  let [count3, setCount3] = React.useState(0);
  let [currentValue, setCurrentValue] = React.useState(null);
  let [items, setItems] = React.useState([]);
  let elementRef = React.useRef(null);
  let elementRef2 = React.useRef(null);
  let stateRef = React.useRef(!1);
  let x = React.useRef({
    lastTime: {}
  });
  let stateRef2 = React.useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    width: 160,
    height: 160,
    heading: 0, gait: 0, speed: 0, hitUntil: 0,
    active: !1
  });
  let stateRef3 = React.useRef(null);
  let stateRef4 = React.useRef(0);
  React.useEffect(() => {
    let value3 = !0;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value4 = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (value4.ok) {
          options = await value4.json();
        }
      } catch {}
      if (value3) {
        let config2 = CV(options);
        setConfig(config2);
        setCount3(config2.BOSS_MAX_HP || 500);
        setCount(1);
      }
    })();
    return () => {
      value3 = !1;
    };
  }, []);
  let y = React.useCallback(async () => {
    if (!stateRef.current) {
      await Tone.start();
      x.current.pop = new Tone.Synth({
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
      x.current.hit = new Tone.MembraneSynth().toDestination();
      x.current.spawn = new Tone.NoiseSynth({
        noise: {
          type: "pink"
        },
        envelope: {
          attack: 0.05,
          decay: 0.5,
          sustain: 0
        }
      }).toDestination();
      x.current.win = new Tone.PolySynth(Tone.Synth).toDestination();
      x.current.pop.volume.value = -10;
      x.current.hit.volume.value = -5;
      x.current.spawn.volume.value = -8;
      x.current.win.volume.value = -6;
      stateRef.current = !0;
    }
  }, []);
  let callback = React.useCallback(value3 => {
    if (!stateRef.current) return;
    let value4 = kV(x, value3);
    if (value3 === "pop") {
      x.current.pop.triggerAttackRelease("C5", "16n", value4);
    } else {
      if (value3 === "hit") {
        x.current.hit.triggerAttackRelease("G2", "8n", value4);
      } else {
        if (value3 === "spawn") {
          x.current.spawn.triggerAttackRelease("4n", value4);
        } else {
          if (value3 === "win") {
            x.current.win.triggerAttackRelease(["C4", "E4", "G4", "C5"], "2n", value4);
          }
        }
      }
    }
  }, []);
  let callback2 = React.useCallback((value3, value4 = 1500) => {
    setCurrentValue(config[value3]);
    setTimeout(() => setCurrentValue(null), value4);
  }, [config]);
  let callback3 = React.useCallback(value3 => {
    if (!stateRef4.current) {
      stateRef4.current = value3;
    }
    const dt = Math.min(value3 - stateRef4.current, 40);
    stateRef4.current = value3;
    const bug = stateRef2.current;
    if (bug.active && elementRef.current && elementRef2.current && !document.hidden) {
      const area = elementRef.current.getBoundingClientRect();
      const left = 14, right = Math.max(left, area.width - bug.width - 14);
      const bottom = Math.max(20, area.height - bug.height - 20);
      const top = Math.min(134, Math.max(20, bottom * .28));
      // Pick a destination across the play area, then scuttle toward it.
      // Unlike continuous random steering, this cannot settle into a small orbit.
      const remaining = Math.hypot((bug.targetX ?? bug.x) - bug.x, (bug.targetY ?? bug.y) - bug.y);
      if (bug.targetX == null || remaining < 19 || value3 > bug.nextScuttleAt) {
        const minimumTravel = Math.min(180, Math.hypot(right - left, bottom - top) * .48);
        let longest = -1;
        for (let attempt = 0; attempt < 20; attempt++) {
          const x = left + Math.random() * (right - left);
          const y = top + Math.random() * (bottom - top);
          const distance = Math.hypot(x - bug.x, y - bug.y);
          if (distance > longest) { bug.targetX = x; bug.targetY = y; longest = distance; }
          if (distance >= minimumTravel) { bug.targetX = x; bug.targetY = y; break; }
        }
        bug.nextScuttleAt = value3 + Math.max(1800, longest / bug.baseSpeed + 1000);
      }
      if (value3 > bug.nextPauseAt) {
        bug.pauseUntil = value3 + 80 + Math.random() * 130;
        bug.nextPauseAt = value3 + 1700 + Math.random() * 2200;
      }
      const desired = Math.atan2(bug.targetX - bug.x, -(bug.targetY - bug.y));
      const turn = Math.atan2(Math.sin(desired - bug.heading), Math.cos(desired - bug.heading));
      bug.heading += Math.max(-.012 * dt, Math.min(.012 * dt, turn));
      // Slow briefly for a sharp turn instead of making a wide circular loop.
      const turnSpeed = Math.max(.12, Math.cos(turn) * .8 + .2);
      const targetSpeed = value3 < bug.pauseUntil ? 0 : bug.baseSpeed * (1.08 + Math.sin(value3 * .009) * .14) * turnSpeed;
      bug.speed += (targetSpeed - bug.speed) * (1 - Math.exp(-dt / 45));
      const oldX = bug.x, oldY = bug.y;
      bug.x = Math.max(left, Math.min(right, bug.x + Math.sin(bug.heading) * bug.speed * dt));
      bug.y = Math.max(top, Math.min(bottom, bug.y - Math.cos(bug.heading) * bug.speed * dt));
      bug.gait += Math.hypot(bug.x - oldX, bug.y - oldY) / 30 * Math.PI * 2;
      elementRef2.current.style.transform = `translate3d(${bug.x}px, ${bug.y}px, 0)`;
    }
    stateRef3.current = requestAnimationFrame(callback3);
  }, []);
  React.useEffect(() => {
    if (count === 2) {
      stateRef4.current = performance.now();
      stateRef3.current = requestAnimationFrame(callback3);
    } else {
      if (stateRef3.current) {
        cancelAnimationFrame(stateRef3.current);
      }
    }
    return () => {
      if (stateRef3.current) {
        cancelAnimationFrame(stateRef3.current);
      }
    };
  }, [count, callback3]);
  let handleClick = async () => {
    await y();
    callback("pop");
    setCount2(value3 => value3 + 1);
  };
  let handleClick2 = async () => {
    if (await y(), count === 1) {
      if (elementRef.current) {
        let dimensions = elementRef.current.getBoundingClientRect();
        let width = 160;
        let height = 160;
        stateRef2.current = {
          x: dimensions.width / 2 - width / 2,
          y: dimensions.height / 2 - height / 2,
          baseSpeed: config.BOSS_SPEED || .25,
          speed: 0,
          heading: Math.PI * .35,
          targetX: null,
          targetY: null,
          gait: 0,
          hitUntil: 0,
          nextScuttleAt: 0,
          nextPauseAt: performance.now() + 2200,
          pauseUntil: 0,
          width: width,
          height: height,
          active: !0
        };
      }
      callback("spawn");
      setCount(2);
    }
  };
  let handleClick3 = async value3 => {
    if (await y(), count !== 2) return;
    let {
      clientX: value4 = elementRef2.current?.getBoundingClientRect().x + 80,
      clientY: value5 = elementRef2.current?.getBoundingClientRect().y + 80
    } = value3;
    callback("hit");
    stateRef2.current.hitUntil = performance.now() + 85;
    setCount3(value7 => {
      let value8 = value7 - 1;
      return value8 <= 0 ? (stateRef2.current.active = !1, setCount(3), callback("win"), callback2("IMG_MEME_WIN", 3000), 0) : value8;
    });
    let value6 = Date.now() + Math.random();
    setItems(value7 => [...value7, {
      id: value6,
      x: value4,
      y: value5 - 40
    }]);
    setTimeout(() => {
      setItems(value7 => value7.filter(item => item.id !== value6));
    }, 800);
  };
  let handleClick4 = async () => {
    await y();
    callback("pop");
    setCount3(config.BOSS_MAX_HP || 500);
    setCount(1);
    setCount2(6699);
    stateRef2.current.active = !1;
  };
  let {
    canSubmit: value,
    submitting: value2,
    submitRecording: handleClick5
  } = useGameFeature1();
  return config ? <div style={{
    width: "100%",
    height: "100%",
    position: "relative"
  }}>{<TV />}{<div ref={elementRef} className={"feed-container"} style={{
      position: "relative"
    }}>{<div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "clamp(16px, 4cqi, 24px)",
        minHeight: 0,
        opacity: count === 1 ? 1 : 0,
        transition: "opacity 0.5s",
        pointerEvents: count === 1 ? "auto" : "none"
      }}>{<div style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
          flex: "0 0 auto"
        }}>{<div style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "var(--color-panel)",
            overflow: "hidden"
          }}>{<img src={config.IMG_AVATAR} alt={"avatar"} style={{
              width: "100%",
              height: "100%",
              objectFit: "cover"
            }} />}</div>}{<div>{<div style={{
              fontWeight: "bold",
              fontSize: 16
            }}>{config.UI_AUTHOR_NAME}</div>}{<div style={{
              fontSize: 12,
              color: "var(--color-text-dim)"
            }}>{"Posted 1 min ago"}</div>}</div>}</div>}{<div style={{
          flex: 1,
          minHeight: 0,
          background: "var(--color-panel)",
          borderRadius: 24,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)"
        }}>{<h1 data-game-cta={"like-bugs"} style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(32px, 8vw, 48px)",
            margin: "0 0 16px 0",
            textAlign: "center",
            textTransform: "uppercase",
            fontStyle: "italic"
          }}>{config.UI_POST_TITLE}</h1>}{<Motion.motion.div whileTap={{
            scale: 0.95
          }} onClick={handleClick2} style={{
            width: "60%",
            aspectRatio: "1/1",
            maxWidth: 200,
            margin: "24px 0",
            cursor: "pointer",
            position: "relative"
          }}>{<CrawlingBug source={config.IMG_FEED_MAIN} />}{<Motion.motion.div animate={{
              scale: [1, 1.1, 1],
              opacity: [0.5, 0, 0.5]
            }} transition={{
              repeat: 1 / 0,
              duration: 1.5
            }} style={{
              position: "absolute",
              inset: -20,
              borderRadius: "50%",
              border: "2px solid var(--color-accent)",
              pointerEvents: "none"
            }} />}</Motion.motion.div>}{<div style={{
            fontSize: 18,
            color: "var(--color-text-dim)"
          }}>{count2.toLocaleString(config.LANG || "en")}{" "}{config.UI_HATE_TEXT}</div>}</div>}{<div style={{
          flex: "0 0 auto",
          display: "flex",
          gap: 24,
          marginTop: 24,
          paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))"
        }}>{<div onClick={handleClick} style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer"
          }}>{<div style={{
              fontSize: 28,
              color: "var(--color-accent)"
            }}>{"\u2665"}</div>}{<span style={{
              fontSize: 18,
              fontWeight: "bold"
            }}>{config.BTN_LIKE}</span>}</div>}</div>}</div>}{count >= 2 && <React.Fragment>{<div style={{
          position: "absolute",
          top: "max(40px, calc(env(safe-area-inset-top, 0px) + 20px))",
          left: 20,
          right: 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pointerEvents: "none"
        }}>{<div style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            lineHeight: 1.2,
            marginBottom: 8,
            color: "#fff",
            textShadow: "0 2px 4px #000"
          }}>{"BUG HP: "}{Math.max(0, count3)}{" / "}{config.BOSS_MAX_HP}</div>}{<div style={{
            width: "100%",
            maxWidth: 300,
            height: 16,
            background: "#333",
            borderRadius: 8,
            overflow: "hidden",
            border: "2px solid #000"
          }}>{<div style={{
              height: "100%",
              background: "var(--color-accent)",
              width: `${Math.max(0, count3 / (config.BOSS_MAX_HP || 500) * 100)}%`,
              transition: "width 0.1s"
            }} />}</div>}</div>}{<div ref={elementRef2} className={"boss-entity"} role="button" tabIndex={0} aria-label="Tap the crawling bug" style={{
          width: stateRef2.current.width,
          height: stateRef2.current.height,
          transform: `translate3d(${stateRef2.current.x}px, ${stateRef2.current.y}px, 0)`
        }} onClick={handleClick3} onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault();handleClick3(event); }
        }}>{<CrawlingBug source={config.IMG_BOSS} poseRef={stateRef2} moving={count === 2} defeated={count === 3} />}</div>}</React.Fragment>}{<Motion.AnimatePresence>{items.map(point => <Motion.motion.div initial={{
          opacity: 1,
          y: point.y,
          x: point.x - 10,
          scale: 0.5
        }} animate={{
          opacity: 0,
          y: point.y - 100,
          scale: 1.5
        }} exit={{
          opacity: 0
        }} transition={{
          duration: 0.8,
          ease: "easeOut"
        }} style={{
          position: "fixed",
          top: 0,
          left: 0,
          pointerEvents: "none",
          color: "var(--color-accent)",
          fontFamily: "var(--font-display)",
          fontSize: 36,
          textShadow: "0 4px 8px rgba(0,0,0,0.8)",
          zIndex: 50
        }} key={point.id}>{"-1"}</Motion.motion.div>)}</Motion.AnimatePresence>}{<Motion.AnimatePresence>{currentValue && <Motion.motion.div initial={{
          opacity: 0,
          scale: 0.8
        }} animate={{
          opacity: 1,
          scale: 1
        }} exit={{
          opacity: 0,
          scale: 1.2
        }} transition={{
          duration: 0.3
        }} style={{
          position: "absolute",
          inset: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          backgroundColor: "rgba(0,0,0,0.6)"
        }}>{<img src={currentValue} alt={"Meme"} style={{
            width: "80%",
            maxHeight: "80%",
            objectFit: "contain",
            transform: "rotate(-5deg)"
          }} />}</Motion.motion.div>}</Motion.AnimatePresence>}{<Motion.AnimatePresence>{count === 3 && <Motion.motion.div initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} transition={{
          delay: 0.5
        }} style={{
          position: "absolute",
          inset: 0,
          zIndex: 90,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(15,15,17,0.9)",
          backdropFilter: "blur(10px)"
        }}>{<h2 style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(48px, 12vw, 64px)",
            color: "var(--color-accent)",
            textShadow: "0 4px 16px rgba(255,59,48,0.5)",
            textAlign: "center",
            padding: "0 20px",
            margin: "0 0 40px 0"
          }}>{config.MSG_VICTORY}</h2>}{<div style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            width: "100%",
            maxWidth: 300,
            padding: "0 20px"
          }}>{<button onClick={handleClick4} style={{
              width: "100%",
              padding: "16px",
              borderRadius: 12,
              background: "#fff",
              color: "#000",
              border: "none",
              fontFamily: "var(--font-display)",
              fontSize: 24,
              cursor: "pointer",
              textTransform: "uppercase"
            }}>{config.BTN_REPLAY}</button>}{value && <button onClick={handleClick5} disabled={value2} style={{
              width: "100%",
              padding: "16px",
              borderRadius: 12,
              background: "var(--color-panel)",
              color: "#fff",
              border: "2px solid #333",
              fontFamily: "var(--font-display)",
              fontSize: 24,
              cursor: value2 ? "not-allowed" : "pointer",
              textTransform: "uppercase",
              opacity: value2 ? 0.55 : 1
            }}>{config.BTN_POST}</button>}</div>}</Motion.motion.div>}</Motion.AnimatePresence>}</div>}</div> : <div style={{
    width: "100%",
    height: "100%",
    background: "#0f0f11"
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
        "data-subject": ".boss-entity",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": ".boss-entity",
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
  const selectors = ["[data-game-cta=like-bugs]"];
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
        "data-batch3-game": "20"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "20"
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
