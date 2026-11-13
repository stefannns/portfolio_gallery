// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "GRAVITY",
    "kind": "number",
    "label": "Gravity",
    "value": 0.0015,
    "default": 0.0015,
    "min": 0.0005,
    "max": 0.005,
    "step": 0.0001
  }, {
    "id": "PARTICLE_COUNT",
    "kind": "number",
    "label": "Explosion Particles",
    "value": 60,
    "default": 60,
    "min": 20,
    "max": 120,
    "step": 5
  }, {
    "id": "LAUNCH_SPEED",
    "kind": "number",
    "label": "Launch Speed",
    "value": 1.2,
    "default": 1.2,
    "min": 0.5,
    "max": 2.5,
    "step": 0.1
  }, {
    "id": "EXPLOSION_FORCE",
    "kind": "number",
    "label": "Explosion Force",
    "value": 0.4,
    "default": 0.4,
    "min": 0.1,
    "max": 1,
    "step": 0.05
  }],
  "texts": [{
    "id": "TITLE",
    "label": "Title",
    "value": "Starlit Hill",
    "default": "Starlit Hill",
    "max_length": 30
  }, {
    "id": "DESC",
    "label": "Description",
    "value": "Swipe upward and release to launch a firework into the night sky.",
    "default": "Swipe upward and release to launch a firework into the night sky.",
    "max_length": 150
  }],
  "images": [{
    "id": "BG_IMAGE",
    "label": "Background Image",
    "path": "./assets/art-v2/night-sky-vector-v4.svg",
    "replaceable": true
  }, {
    "id": "BG_HILLS",
    "label": "Distant Hill Layer",
    "path": "./assets/art-v2/distant-hills-vector-v3.svg",
    "replaceable": true
  }, {
    "id": "BG_FOREGROUND",
    "label": "Foreground Hill and Silhouettes",
    "path": "./assets/art-v2/hill-foreground-vector-v3.svg",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "99279183230167264",
    "version_id": "99279183230149284",
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
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .firework-guide{position:fixed!important;top:30%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
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
// The origin sits below the hill silhouettes, including when the portrait art is cropped.
const FIREWORK_LAUNCH_Y = .92;
function App() {
  const createElement = React.createElement;
  const [config, setConfig] = React.useState({});
  const [count, setCount] = React.useState(0);
  const [hint, setHint] = React.useState(true);
  const [aiming, setAiming] = React.useState(false);
  const canvas = React.useRef(null);
  const start = React.useRef(null);
  const stateRef = React.useRef(null);
  const rockets = React.useRef([]);
  const bursts = React.useRef([]);
  const frame = React.useRef(0);
  const lastTick = React.useRef(0);
  const audio = React.useRef(null);
  const risingVoices = React.useRef(0);
  const lastBurst = React.useRef(-1);
  const sampleAudio = React.useRef({
    buffers: null,
    promise: null,
    voices: new Set(),
    master: null,
    limiter: null,
    closed: false
  });
  const makeParticles = (x, y, color, style, size, rect) => {
    const baseCount = Math.max(32, Math.min(105, Number(config.PARTICLE_COUNT) || 60));
    const value = Math.min(140, Math.round(baseCount * Math.sqrt(size)));
    const force = Math.max(1, Math.min(1.35, 1 + (Number(config.EXPLOSION_FORCE) || 0.4) * 0.35));
    const speed = Math.min(rect.width, rect.height) / 120 * size * force;
    const particles = [];
    for (let value2 = 0; value2 < value; value2++) {
      const theta = value2 / value * Math.PI * 2 - Math.PI / 2;
      let value3 = Math.cos(theta);
      let value4 = Math.sin(theta);
      let spread = style === "ring" ? 1 : 0.35 + Math.random() * 0.65;
      if (style === "star") {
        const edge = value2 / value * 10;
        const value5 = Math.floor(edge);
        const value6 = edge - value5;
        const angle = value5 * Math.PI / 5 - Math.PI / 2;
        const next = angle + Math.PI / 5;
        const value7 = value5 % 2 ? 0.43 : 1;
        const rNext = value5 % 2 ? 1 : 0.43;
        value3 = Math.cos(angle) * value7 * (1 - value6) + Math.cos(next) * rNext * value6;
        value4 = Math.sin(angle) * value7 * (1 - value6) + Math.sin(next) * rNext * value6;
        spread = 1;
      }
      const willow = style === "willow";
      const life = 0.85 + Math.random() * 0.15;
      particles.push({
        x,
        y,
        vx: value3 * speed * spread / rect.width,
        vy: value4 * speed * spread / rect.height,
        life,
        color: willow ? ["#ffc95e", "#ffe6a0", "#ffdc79"][value2 % 3] : value2 % 7 === 0 ? "#fff5da" : color,
        drag: willow ? 0.983 : 0.992,
        gravity: (willow ? 0.065 : 0.025) / rect.height,
        lifeScale: willow ? 2.2 : 1,
        trail: willow ? [] : null,
        size
      });
    }
    return particles;
  };
  const getAudio = (unlock = false) => {
    try {
      if (sampleAudio.current.closed) return null;
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return null;
      const value = audio.current || (audio.current = new Audio());
      if (value.state === "closed") return null;
      if (unlock && value.state === "suspended") Promise.resolve(value.resume()).catch(() => {});
      return value;
    } catch {
      return null;
    }
  };
  const prepareAudio = (unlock = false) => {
    const audio2 = getAudio(unlock);
    const state = sampleAudio.current;
    const data = {
      rise: "./assets/firework-rise.mp3",
      burst: "./assets/firework-burst.mp3"
    };
    if (!audio2 || state.closed || !data?.rise || !data?.burst || typeof audio2.decodeAudioData !== "function") return Promise.resolve(null);
    if (state.buffers) return Promise.resolve(state.buffers);
    if (state.promise) return state.promise;
    const decode = async path => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Could not load firework sound');
      return audio2.decodeAudioData(await response.arrayBuffer());
    };
    state.promise = Promise.all([decode(data.rise), decode(data.burst)]).then(([rise, burst]) => {
      if (state.closed || audio.current !== audio2) return null;
      state.buffers = {
        rise,
        burst
      };
      state.promise = null;
      return state.buffers;
    }).catch(() => {
      if (!state.closed && audio.current === audio2) state.promise = null;
      return null;
    });
    return state.promise;
  };
  const playSample = (kind, duration) => {
    const audio2 = getAudio();
    const state = sampleAudio.current;
    const buffer = state.buffers?.[kind];
    if (!audio2 || audio2.state !== "running" || !buffer || state.closed) return false;
    if (state.voices.size >= 10 || [...state.voices].filter(item => item.kind === kind).length >= (kind === "rise" ? 4 : 6)) return true;
    let source;
    let gain;
    let voice;
    try {
      if (!state.master) {
        const master = audio2.createGain();
        master.gain.value = 0.9;
        state.master = master;
        if (typeof audio2.createDynamicsCompressor === "function") {
          const limiter = audio2.createDynamicsCompressor();
          limiter.threshold.value = -6;
          limiter.knee.value = 6;
          limiter.ratio.value = 6;
          limiter.attack.value = 0.002;
          limiter.release.value = 0.13;
          master.connect(limiter).connect(audio2.destination);
          state.limiter = limiter;
        } else master.connect(audio2.destination);
      }
      const currentTime = audio2.currentTime;
      const length = kind === "rise" ? Math.min(buffer.duration, duration / 1000) : buffer.duration;
      const offset = kind === "rise" ? Math.max(0, buffer.duration - length) : 0;
      source = audio2.createBufferSource();
      gain = audio2.createGain();
      source.buffer = buffer;
      gain.gain.setValueAtTime(kind === "rise" ? 0 : 0.85, currentTime);
      if (kind === "rise") {
        gain.gain.linearRampToValueAtTime(0.65, currentTime + Math.min(0.012, length / 4));
        gain.gain.setValueAtTime(0.65, currentTime + Math.max(0.012, length - 0.025));
        gain.gain.linearRampToValueAtTime(0, currentTime + length);
      }
      source.connect(gain).connect(state.master);
      voice = {
        kind,
        source,
        gain
      };
      state.voices.add(voice);
      source.onended = () => {
        state.voices.delete(voice);
        try {
          source.disconnect();
          gain.disconnect();
        } catch {}
      };
      source.start(currentTime, offset, length);
      source.stop(currentTime + length + 0.01);
      return true;
    } catch {
      if (voice) state.voices.delete(voice);
      try {
        source?.disconnect();
        gain?.disconnect();
      } catch {}
      return false;
    }
  };
  const playSyntheticRise = duration => {
    const audio2 = getAudio();
    if (!audio2 || audio2.state !== "running" || risingVoices.current >= 4) return;
    try {
      const currentTime = audio2.currentTime;
      const length = duration / 1000;
      const oscillator = audio2.createOscillator();
      const gain = audio2.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(340, currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1100, currentTime + length);
      gain.gain.setValueAtTime(0.0001, currentTime);
      gain.gain.linearRampToValueAtTime(0.2, currentTime + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + length);
      oscillator.connect(gain).connect(audio2.destination);
      risingVoices.current++;
      oscillator.onended = () => {
        risingVoices.current = Math.max(0, risingVoices.current - 1);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(currentTime);
      oscillator.stop(currentTime + length + 0.02);
    } catch {}
  };
  const playSyntheticBurst = () => {
    const current = audio.current;
    if (!current || current.state !== "running") return;
    try {
      const currentTime = current.currentTime;
      const length = Math.floor(current.sampleRate * 0.3);
      const buffer = current.createBuffer(1, length, current.sampleRate);
      const data = buffer.getChannelData(0);
      for (let value = 0; value < length; value++) data[value] = (Math.random() * 2 - 1) * Math.pow(1 - value / length, 2);
      const noise = current.createBufferSource();
      const filter = current.createBiquadFilter();
      const gain = current.createGain();
      noise.buffer = buffer;
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2400, currentTime);
      filter.frequency.exponentialRampToValueAtTime(300, currentTime + 0.28);
      gain.gain.setValueAtTime(0.0001, currentTime);
      gain.gain.linearRampToValueAtTime(0.2, currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.29);
      noise.connect(filter).connect(gain).connect(current.destination);
      noise.onended = () => {
        noise.disconnect();
        filter.disconnect();
        gain.disconnect();
      };
      noise.start(currentTime);
      noise.stop(currentTime + 0.3);
      const thump = current.createOscillator();
      const thumpGain = current.createGain();
      thump.type = "sine";
      thump.frequency.setValueAtTime(170, currentTime);
      thump.frequency.exponentialRampToValueAtTime(65, currentTime + 0.18);
      thumpGain.gain.setValueAtTime(0.08, currentTime);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.18);
      thump.connect(thumpGain).connect(current.destination);
      thump.onended = () => {
        thump.disconnect();
        thumpGain.disconnect();
      };
      thump.start(currentTime);
      thump.stop(currentTime + 0.19);
    } catch {}
  };
  const playRise = duration => {
    if (!playSample("rise", duration)) playSyntheticRise(duration);
  };
  const playBurst = () => {
    const current = audio.current;
    if (!current || current.state !== "running" || current.currentTime - lastBurst.current < 0.07) return;
    lastBurst.current = current.currentTime;
    if (!playSample("burst")) playSyntheticBurst();
  };
  React.useEffect(() => {
    fetch("./game.config.json", {
      cache: "no-store"
    }).then(response => response.json()).then(data => {
      const options = {};
      for (const value of ["texts", "images", "tweaks"]) for (const item of data[value] || []) options[item.id] = item.value ?? item.path;
      setConfig(options);
    }).catch(() => {});
  }, []);
  React.useEffect(() => {
    let alive = true;
    sampleAudio.current.closed = false;
    prepareAudio();
    const draw = value => {
      const element = canvas.current;
      if (!element || !alive) return;
      const rect = element.getBoundingClientRect();
      const value2 = window.devicePixelRatio || 1;
      const width = rect.width;
      const height = rect.height;
      if (element.width !== Math.round(width * value2) || element.height !== Math.round(height * value2)) {
        element.width = Math.round(width * value2);
        element.height = Math.round(height * value2);
      }
      const context = element.getContext("2d");
      context.setTransform(value2, 0, 0, value2, 0, 0);
      context.clearRect(0, 0, width, height);
      const value3 = Math.min(50, value - (lastTick.current || value));
      lastTick.current = value;
      const guide = stateRef.current;
      if (guide && guide.a.y - guide.b.y > 0.015) {
        const value4 = guide.a.x * width;
        const value5 = FIREWORK_LAUNCH_Y * height;
        const value6 = Math.max(0.1, Math.min(0.9, guide.b.x)) * width;
        const value7 = Math.max(0.13, Math.min(0.68, guide.b.y)) * height;
        const valid = guide.a.y - guide.b.y >= 0.07;
        context.save();
        context.strokeStyle = valid ? "#fff6bb" : "#ffffff99";
        context.fillStyle = valid ? "#fff6bb" : "#ffffff99";
        context.lineWidth = 2.5;
        context.setLineDash([6, 9]);
        context.shadowColor = "#ffe88d";
        context.shadowBlur = 12;
        context.beginPath();
        context.moveTo(value4, value5);
        context.lineTo(value6, value7);
        context.stroke();
        context.setLineDash([]);
        context.beginPath();
        context.arc(value4, value5, 5, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.arc(value6, value7, 13, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.arc(value6, value7, 3.5, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
      context.save();
      context.globalCompositeOperation = "lighter";
      for (let value4 = rockets.current.length - 1; value4 >= 0; value4--) {
        const item = rockets.current[value4];
        const value5 = item.t;
        item.t = Math.min(1, item.t + value3 / item.duration);
        const value6 = (item.x0 + (item.x1 - item.x0) * value5) * width;
        const value7 = (item.y0 + (item.y1 - item.y0) * value5) * height;
        const x = (item.x0 + (item.x1 - item.x0) * item.t) * width;
        const y = (item.y0 + (item.y1 - item.y0) * item.t) * height;
        context.strokeStyle = item.color;
        context.lineWidth = 3;
        context.shadowColor = item.color;
        context.shadowBlur = 17;
        context.beginPath();
        context.moveTo(value6, value7);
        context.lineTo(x, y);
        context.stroke();
        context.fillStyle = "#fff";
        context.beginPath();
        context.arc(x, y, 3.5, 0, Math.PI * 2);
        context.fill();
        if (item.t >= 1) {
          bursts.current.push({
            particles: item.particles,
            style: item.style,
            size: item.size
          });
          rockets.current.splice(value4, 1);
          playBurst();
        }
      }
      const step = value3 / (1000 / 60);
      const current = bursts.current;
      for (let value4 = current.length - 1; value4 >= 0; value4--) {
        const item = current[value4];
        for (const particle of item.particles) {
          if (particle.trail && step > 0) {
            particle.trail.push({
              x: particle.x,
              y: particle.y
            });
            if (particle.trail.length > 10) particle.trail.shift();
          }
          particle.x += particle.vx * step;
          particle.y += particle.vy * step;
          const drag = Math.pow(particle.drag, step);
          particle.vx *= drag;
          particle.vy = particle.vy * drag + particle.gravity * step;
          particle.life -= 0.012 * step / particle.lifeScale;
          context.globalAlpha = Math.max(0, particle.life);
          context.fillStyle = particle.color;
          context.strokeStyle = particle.color;
          context.shadowColor = particle.color;
          context.shadowBlur = 8;
          if (particle.trail?.length) {
            context.globalAlpha *= 0.45;
            context.lineWidth = 1.4 * particle.size;
            context.beginPath();
            context.moveTo(particle.trail[0].x * width, particle.trail[0].y * height);
            for (const point2 of particle.trail) context.lineTo(point2.x * width, point2.y * height);
            context.lineTo(particle.x * width, particle.y * height);
            context.stroke();
            context.globalAlpha = Math.max(0, particle.life);
          }
          context.beginPath();
          context.arc(particle.x * width, particle.y * height, Math.max(0.8, particle.life * 2.8 * Math.sqrt(particle.size)), 0, Math.PI * 2);
          context.fill();
        }
        item.particles = item.particles.filter(item2 => item2.life > 0);
        if (!item.particles.length) current.splice(value4, 1);
      }
      context.restore();
      frame.current = requestAnimationFrame(draw);
    };
    frame.current = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(frame.current);
      const state = sampleAudio.current;
      state.closed = true;
      for (const voice of [...state.voices]) {
        try {
          voice.source.stop();
          voice.source.disconnect();
          voice.gain.disconnect();
        } catch {}
      }
      state.voices.clear();
      try {
        state.master?.disconnect();
        state.limiter?.disconnect();
      } catch {}
      state.master = null;
      state.limiter = null;
      state.buffers = null;
      state.promise = null;
      risingVoices.current = 0;
      if (audio.current) {
        Promise.resolve(audio.current.close()).catch(() => {});
        audio.current = null;
      }
    };
  }, []);
  const point = event => {
    const dimensions = canvas.current.getBoundingClientRect();
    return {
      x: (event.clientX - dimensions.left) / dimensions.width,
      y: (event.clientY - dimensions.top) / dimensions.height
    };
  };
  const down = event => {
    if (event.isPrimary === false || event.button > 0) return;
    prepareAudio(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    const value = point(event);
    start.current = {
      ...value,
      id: event.pointerId
    };
    stateRef.current = {
      a: value,
      b: value
    };
    setAiming(true);
  };
  const move = event => {
    if (start.current?.id === event.pointerId) stateRef.current = {
      a: start.current,
      b: point(event)
    };
  };
  const cancel = event => {
    if (start.current?.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    start.current = null;
    stateRef.current = null;
    setAiming(false);
  };
  const onPointerUp = event => {
    if (start.current?.id !== event.pointerId) return;
    const point2 = start.current;
    const point3 = point(event);
    cancel(event);
    const rise = point2.y - point3.y;
    if (rise < 0.07) return;
    const x = Math.max(0.1, Math.min(0.9, point3.x));
    const y = Math.max(0.13, Math.min(0.68, point3.y));
    const colors = ["#fc70d2", "#fff392", "#8feeff", "#d2a2ff", "#90ffbb"];
    const color = colors[count % colors.length];
    const style = ["peony", "ring", "willow", "star"][count % 4];
    const size = [0.68, 1, 1.3][count % 3];
    const rect = canvas.current.getBoundingClientRect();
    const particles = makeParticles(x, y, color, style, size, rect);
    const distance = Math.hypot((x - point2.x) * rect.width, (y - FIREWORK_LAUNCH_Y) * rect.height);
    const duration = Math.max(350, Math.min(1100, distance / (Number(config.LAUNCH_SPEED) || 1.2)));
    rockets.current.push({
      x0: point2.x,
      y0: FIREWORK_LAUNCH_Y,
      x1: x,
      y1: y,
      t: 0,
      duration,
      color,
      particles,
      style,
      size
    });
    playRise(duration);
    setCount(value => value + 1);
    setHint(false);
    if (navigator.vibrate) navigator.vibrate(12);
  };
  return <div style={{
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    boxSizing: "border-box",
    background: `#080d2c url(${config.BG_IMAGE || "./assets/art-v2/night-sky-vector-v4.svg"}) center/cover`,
    color: "white",
    touchAction: "none",
    userSelect: "none",
    fontFamily: "system-ui,sans-serif"
  }}>{<canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={onPointerUp} onPointerCancel={cancel} style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      zIndex: 1,
      touchAction: "none"
    }} aria-label={"Drag upward to preview the trajectory, then release to launch fireworks"} />}{<img
      data-scenery-layer="distant-hills"
      src={config.BG_HILLS || './assets/art-v2/distant-hills-vector-v3.svg'}
      alt="" aria-hidden="true" draggable={false}
      style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',zIndex:2,pointerEvents:'none'}}
    />}{<img
      data-scenery-layer="foreground-hill"
      src={config.BG_FOREGROUND || './assets/art-v2/hill-foreground-vector-v3.svg'}
      alt="" aria-hidden="true" draggable={false}
      style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',zIndex:3,pointerEvents:'none'}}
    />}{<div className={"firework-guide"} style={{
      position: "absolute",
      bottom: "calc(50 * min(.2564102564vw,.1672240803vh) + env(safe-area-inset-bottom, 0px))",
      left: "calc(30 * min(.2564102564vw,.1672240803vh) + env(safe-area-inset-left, 0px))",
      right: "calc(30 * min(.2564102564vw,.1672240803vh) + env(safe-area-inset-right, 0px))",
      padding: "12px",
      boxSizing: "border-box",
      borderRadius: 24,
      background: "#0a1319eb",
      border: "1px solid #eee4",
      textAlign: "center",
      lineHeight: 1.4,
      fontSize: "calc(18 * min(.2564102564vw,.1672240803vh))",
      pointerEvents: "none",
      visibility: hint || aiming ? "visible" : "hidden"
    }}>{aiming ? "Release to launch" : "Drag up to preview the path"}</div>}</div>;
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
  const selectors = [".firework-guide"];
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
        "data-batch3-game": "50"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "50"
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
