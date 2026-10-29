import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const CSS = `
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

* { box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
body { background: #f4f0e8; color: #282b2c; -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
.app-shell { width: 100%; height: 100%; min-height: 0; overflow: clip; position: relative; background: #f4f0e8; font-family: var(--font-body); }
.canvas { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; position: relative; }
.topline { flex: 0 0 auto; height: 58px; display: flex; align-items: center; justify-content: center; position: relative; z-index: 3; }
.wordmark { color: #303536; letter-spacing: .22em; font-family: var(--font-display); font-weight: 700; font-size: 13px; text-transform: uppercase; opacity: .78; }
.stage-area { flex: 1 1 auto; min-height: 0; position: relative; display: flex; align-items: stretch; justify-content: center; overflow: hidden; }
.orbit-stage { width: min(100%, 480px); height: 100%; min-height: 0; position: relative; touch-action: manipulation; }
.orbit-svg { width: 100%; height: 100%; display: block; overflow: visible; }
.intro-guide { position: absolute; z-index: 5; top: 28px; left: 50%; transform: translateX(-50%); white-space: nowrap; color: #353a39; font-family: var(--font-display); font-weight: 700; font-size: clamp(13px, 3.8cqi, 17px); letter-spacing: .01em; animation: breathe 2.2s ease-in-out infinite; pointer-events: none; }
@keyframes breathe { 0%, 100% { opacity: .48; transform: translateX(-50%) translateY(0); } 50% { opacity: 1; transform: translateX(-50%) translateY(-3px); } }
.hud { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); z-index: 5; width: min(88%, 360px); display: flex; justify-content: space-between; align-items: flex-start; pointer-events: none; }
.hud-item { min-width: 62px; color: #303536; }
.hud-item.center { text-align: center; }
.hud-item.right { text-align: right; }
.hud-value { display: block; font-family: var(--font-display); font-weight: 700; font-size: 26px; line-height: 1; letter-spacing: -.04em; }
.hud-label { display: block; margin-top: 5px; font-family: var(--font-body); font-size: 10px; letter-spacing: .15em; text-transform: uppercase; color: #8d928b; }
.pause-control { position: absolute; z-index: 8; right: 22px; bottom: 20px; width: 46px; height: 46px; border: 1px solid rgba(48,53,54,.18); border-radius: 50%; background: rgba(244,240,232,.72); color: #303536; display: grid; place-items: center; cursor: pointer; box-shadow: 0 5px 16px rgba(48,53,54,.06); backdrop-filter: blur(8px); }
.pause-control:active { transform: scale(.94); }
.pause-control svg { width: 18px; height: 18px; }
.status-note { position: absolute; z-index: 5; left: 50%; bottom: 22px; transform: translateX(-50%); color: #78817a; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; pointer-events: none; }
.result-layer { position: absolute; z-index: 12; inset: 0; display: flex; align-items: center; justify-content: center; padding: 70px 24px 44px; background: rgba(244,240,232,.72); }
.result-card { width: min(100%, 350px); text-align: center; color: #303536; }
.result-kicker { font-family: var(--font-body); font-size: 11px; letter-spacing: .28em; text-transform: uppercase; color: #8b938a; margin-bottom: 11px; }
.result-title { font-family: var(--font-display); font-size: 25px; line-height: 1.1; font-weight: 700; margin: 0 0 25px; }
.result-stats { display: flex; justify-content: center; align-items: center; gap: 31px; margin-bottom: 27px; }
.result-stat { min-width: 76px; }
.result-number { display: block; font-family: var(--font-display); font-size: 42px; line-height: 1; font-weight: 700; letter-spacing: -.07em; }
.result-label { display: block; margin-top: 8px; color: #8b938a; font-size: 10px; letter-spacing: .16em; text-transform: uppercase; }
.retry-button { min-height: 48px; padding: 0 28px; border: 0; border-radius: 24px; background: #303536; color: #f7f3eb; font-family: var(--font-display); font-size: 15px; font-weight: 700; cursor: pointer; box-shadow: 0 8px 16px rgba(48,53,54,.13); }
.retry-button:active { transform: translateY(1px) scale(.98); }
.result-actions { display: flex; justify-content: center; align-items: center; gap: 10px; flex-wrap: wrap; }
.unlocks { margin-top: 30px; }
.unlocks-label { color: #8b938a; font-size: 10px; letter-spacing: .2em; text-transform: uppercase; margin-bottom: 11px; }
.swatches { display: flex; justify-content: center; gap: 9px; flex-wrap: wrap; }
.swatch { width: 27px; height: 27px; padding: 0; border-radius: 50%; border: 2px solid transparent; cursor: pointer; position: relative; }
.swatch.selected { border-color: #303536; box-shadow: 0 0 0 2px #f4f0e8; }
.swatch.locked { opacity: .2; cursor: default; }
.swatch span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-height: 620px) { .topline { height: 42px; } .intro-guide { top: 15px; } .result-layer { padding-top: 40px; } .result-title { margin-bottom: 17px; } .unlocks { margin-top: 17px; } }
.topline { display:none; }
.intro-guide { top:26%; width:max-content; max-width:calc(100% - 60px); white-space:normal; text-align:center; font-size:18px; line-height:1.35; letter-spacing:0; }
.hud { top:30px; left:30px; right:30px; width:auto; transform:none; }
.hud-value { font-size:28px; line-height:1.15; letter-spacing:0; }
.hud-label { font-size:11px; letter-spacing:.04em; color:#72796f; }
.pause-control { right:30px; bottom:50px; width:46px; height:46px; }
.status-note { bottom:64px; }
.result-layer { padding:30px 30px 50px; }
.result-title { font-size:24px; }
.swatches { display:grid; grid-template-columns:repeat(4,44px); gap:8px 12px; }
.swatch { width:44px; height:44px; }
.swatch:focus-visible,.retry-button:focus-visible,.pause-control:focus-visible { outline:3px solid #607f6a; outline-offset:3px; }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }

`;

const DEFAULT_CFG = {
  ORBIT_SPEED: 0.0018,
  FLIGHT_MS: 560,
  TARGET_RADIUS: 52,
  SWEET_HALF_ANGLE: 0.42,
  SCORE_PER_CATCH: 1,
  GAME_TITLE: 'Orbit Jump',
  GUIDE: 'Tap at the arc to jump',
  SCORE_LABEL: 'Score',
  BEST_LABEL: 'Best',
  PERFECT_LABEL: 'Perfect',
  MISS_LABEL: 'Miss',
  PAUSED_LABEL: 'Paused',
  PLAY_AGAIN: 'Play again',
  UNLOCKED_LABEL: 'Unlocked',
  PAUSE_LABEL: 'Pause',
  RESUME_LABEL: 'Resume',
};

const PALETTES = {
  charcoal: { name: 'charcoal', ink: '#303536', planet: '#d8d9d1', planetHi: '#ecebe2', sage: '#91a893', faint: '#c4c9bf' },
  sage: { name: 'sage', ink: '#3c5148', planet: '#cddbd0', planetHi: '#eaf0e7', sage: '#718f79', faint: '#b4c7b5' },
  ivory: { name: 'ivory', ink: '#625c4f', planet: '#e9e3d4', planetHi: '#faf7ed', sage: '#9ba68c', faint: '#d9d2c3' },
  'matte gold': { name: 'matte gold', ink: '#514637', planet: '#e4d4b4', planetHi: '#f6edda', sage: '#aa9971', faint: '#d4c4a0' },
  'slate blue': { name: 'slate blue', ink: '#354651', planet: '#cbd5d7', planetHi: '#e8eeee', sage: '#809ba3', faint: '#b9c5c8' },
  'powder pink': { name: 'powder pink', ink: '#5d4650', planet: '#e4ced2', planetHi: '#f6e8e9', sage: '#aa8991', faint: '#d4babe' },
  'soft peach': { name: 'soft peach', ink: '#5f493e', planet: '#ecd3c2', planetHi: '#fae9dd', sage: '#b28e7c', faint: '#d9b9a7' },
  'pale lilac': { name: 'pale lilac', ink: '#514b62', planet: '#d8d2e4', planetHi: '#f0ecf5', sage: '#968db0', faint: '#c5bfd5' },
};
const UNLOCKS = ['charcoal', 'sage', 'ivory', 'matte gold', 'slate blue', 'powder pink', 'soft peach', 'pale lilac'];
const SOUND_FILES = {
  launch: './assets/sfx_launch.mp3',
  catch: './assets/sfx_catch.mp3',
  perfect: './assets/sfx_perfect.mp3',
  miss: './assets/sfx_miss.mp3',
  click: './assets/sfx_click.mp3',
};

function safeNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function flattenConfig(data) {
  const next = { ...DEFAULT_CFG };
  (data?.tweaks || []).forEach((item) => { next[item.id] = safeNumber(item.value, next[item.id]); });
  (data?.texts || []).forEach((item) => { next[item.id] = typeof item.value === 'string' ? item.value : next[item.id]; });
  return next;
}

function useRecordingSubmission() {
  const canSubmit = typeof tt !== 'undefined' && typeof tt.playableRecordingSubmission === 'function';
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const restore = () => setSubmitting(false);
    const onVisible = () => { if (document.visibilityState === 'visible') restore(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', restore);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', restore);
    };
  }, []);
  const submitRecording = useCallback(() => {
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    tt.playableRecordingSubmission({
      success() {},
      fail(err) {
        console.error('[post_my_play] playableRecordingSubmission failed', err && (err.errMsg || err.message));
        setSubmitting(false);
      },
      complete() {},
    });
  }, [canSubmit, submitting]);
  return { canSubmit, submitting, submitRecording };
}

function PostMyPlayButton() {
  const { canSubmit, submitting, submitRecording } = useRecordingSubmission();
  if (!canSubmit) return null;
  return <button type="button" className="retry-button" disabled={submitting} onClick={submitRecording} style={{ opacity: submitting ? 0.55 : 1 }}>Post my play</button>;
}

function vibrate(style) {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style: style || 'light' });
  } catch (error) { /* optional haptics */ }
}

function pointOnCircle(cx, cy, radius, angle) {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

function arcPath(cx, cy, radius, startAngle, endAngle) {
  const start = pointOnCircle(cx, cy, radius, startAngle);
  const end = pointOnCircle(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function getTransferWindow(current, next, angle, halfWidth = 0.42) {
  const center = Math.atan2(next.y - current.y, next.x - current.x);
  const error = Math.abs(Math.atan2(Math.sin(angle - center), Math.cos(angle - center)));
  return {
    center, error,
    valid: error <= halfWidth + 1e-8,
    perfect: error <= Math.min(0.12, halfWidth * 0.35) + 1e-8,
    landingAngle: Math.atan2(current.y - next.y, current.x - next.x),
  };
}

const feedSession = (() => {
  const embedded = parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !embedded;
  window.addEventListener('message', event => {
    if (embedded && event.source === parent && event.origin === location.origin && event.data?.type === 'playable-active') active = event.data.active === true;
  });
  return { get active() { return active && !document.hidden; } };
})();

function App() {
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const cfgRef = useRef(DEFAULT_CFG);
  const [status, setStatus] = useState('ready');
  const statusRef = useRef('ready');
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const [best, setBest] = useState(() => {
    try { return Number(localStorage.getItem('orbit-jump-best') || 0); } catch (error) { return 0; }
  });
  const [perfects, setPerfects] = useState(0);
  const perfectsRef = useRef(0);
  const [games, setGames] = useState(() => {
    try { return Number(localStorage.getItem('orbit-jump-games') || 0); } catch (error) { return 0; }
  });
  const gamesRef = useRef(games);
  const [level, setLevel] = useState(0);
  const levelRef = useRef(0);
  const [paletteName, setPaletteName] = useState('charcoal');
  const [lastResult, setLastResult] = useState('miss');
  const [catchPulse, setCatchPulse] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const stageRef = useRef(null);
  const playerRef = useRef(null);
  const trailRefs = useRef([]);
  const rafRef = useRef(0);
  const timeoutRefs = useRef([]);
  const angleRef = useRef(-Math.PI / 2);
  const currentOrbitRef = useRef({ x: 200, y: 335, r: 98 });
  const flightRef = useRef(null);
  const audioRef = useRef({ ctx: null, gain: null, buffers: new Map(), sources: new Set() });
  const gameCountedRef = useRef(false);

  const palette = PALETTES[paletteName] || PALETTES.charcoal;
  cfgRef.current = cfg;
  statusRef.current = status;
  scoreRef.current = score;
  perfectsRef.current = perfects;
  levelRef.current = level;

  useEffect(() => {
    let cancelled = false;
    fetch('./game.config.json')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled && data) setCfg(flattenConfig(data)); })
      .catch(() => { /* fallback config keeps the game playable */ });
    return () => { cancelled = true; };
  }, []);

  const ensureAudio = useCallback(() => {
    if (!feedSession.active) return null;
    const audio = audioRef.current;
    if (!audio.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      audio.ctx = new AudioContextClass();
      audio.gain = audio.ctx.createGain();
      audio.gain.gain.value = 0.18;
      audio.gain.connect(audio.ctx.destination);
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
    return audio.ctx;
  }, []);

  const playCue = useCallback((kind) => {
    const audio = audioRef.current;
    const ctx = ensureAudio();
    if (!ctx) return;
    const src = SOUND_FILES[kind];
    if (!src) return;
    let bufferPromise = audio.buffers.get(src);
    if (!bufferPromise) {
      bufferPromise = fetch(src)
        .then((response) => response.arrayBuffer())
        .then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer))
        .catch(() => null);
      audio.buffers.set(src, bufferPromise);
    }
    const resumePromise = ctx.state === 'suspended' ? ctx.resume().catch(() => {}) : Promise.resolve();
    Promise.all([bufferPromise, resumePromise]).then(([buffer]) => {
      if (!buffer || audio.ctx !== ctx || ctx.state !== 'running' || !feedSession.active) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(audio.gain);
      audio.sources.add(source);
      source.onended = () => audio.sources.delete(source);
      source.start(0);
    }).catch(() => {});
  }, [ensureAudio]);

  const targetLayout = useCallback((index) => {
    const layouts = [
      { x: 307, y: 202, orbit: 51, arc: 2.15 },
      { x: 92, y: 205, orbit: 56, arc: 0.85 },
      { x: 305, y: 446, orbit: 50, arc: -2.45 },
      { x: 91, y: 443, orbit: 57, arc: -0.7 },
      { x: 318, y: 326, orbit: 49, arc: 2.8 },
      { x: 83, y: 325, orbit: 54, arc: 0.25 },
    ];
    const base = layouts[index % layouts.length];
    return { ...base, orbit: safeNumber(cfgRef.current.TARGET_RADIUS, base.orbit) };
  }, []);

  const drawMotion = useCallback((point, trailingPoint, opacity = 1) => {
    if (playerRef.current) playerRef.current.setAttribute('transform', `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`);
    trailRefs.current.forEach((line, index) => {
      if (!line) return;
      const t = (index + 1) / 4;
      const x = point.x + (trailingPoint.x - point.x) * t;
      const y = point.y + (trailingPoint.y - point.y) * t;
      line.setAttribute('x1', '0');
      line.setAttribute('y1', '0');
      line.setAttribute('x2', (x - point.x).toFixed(2));
      line.setAttribute('y2', (y - point.y).toFixed(2));
      line.style.opacity = String(opacity * (1 - index * .2));
    });
  }, []);

  const completeMiss = useCallback(() => {
    if (statusRef.current === 'over') return;
    statusRef.current = 'over';
    setStatus('over');
    setLastResult('miss');
    playCue('miss');
    vibrate('notification_error');
    const nextGames = gamesRef.current + 1;
    gamesRef.current = nextGames;
    setGames(nextGames);
    try { localStorage.setItem('orbit-jump-games', String(nextGames)); } catch (error) { /* storage optional */ }
    console.info('[Orbit Jump] miss', { score: scoreRef.current, perfects: perfectsRef.current });
  }, [playCue]);

  const completeCatch = useCallback((perfect) => {
    const nextScore = scoreRef.current + safeNumber(cfgRef.current.SCORE_PER_CATCH, 1);
    scoreRef.current = nextScore;
    setScore(nextScore);
    if (nextScore > best) {
      setBest(nextScore);
      try { localStorage.setItem('orbit-jump-best', String(nextScore)); } catch (error) { /* storage optional */ }
    }
    if (perfect) {
      const nextPerfects = perfectsRef.current + 1;
      perfectsRef.current = nextPerfects;
      setPerfects(nextPerfects);
      playCue('perfect');
      vibrate('notification_success');
    } else {
      playCue('catch');
      vibrate('medium');
    }
    setCatchPulse(true);
    timeoutRefs.current.push(window.setTimeout(() => setCatchPulse(false), 500));
    const nextLevel = levelRef.current + 1;
    levelRef.current = nextLevel;
    setLevel(nextLevel);
    console.info('[Orbit Jump] catch', { score: nextScore, perfect: perfect, orbit: nextLevel });
  }, [best, playCue]);

  const launch = useCallback(() => {
    if (statusRef.current === 'over' || statusRef.current === 'paused' || flightRef.current) return;
    const orbit = currentOrbitRef.current;
    const current = pointOnCircle(orbit.x, orbit.y, orbit.r, angleRef.current);
    const layout = targetLayout(levelRef.current);
    const window = getTransferWindow(orbit, layout, angleRef.current, safeNumber(cfgRef.current.SWEET_HALF_ANGLE, 0.42));
    const target = window.valid
      ? pointOnCircle(layout.x, layout.y, layout.orbit, window.landingAngle)
      : { x: current.x + Math.cos(angleRef.current) * 360, y: current.y + Math.sin(angleRef.current) * 360 };
    flightRef.current = { start: current, target, elapsed: 0, valid: window.valid, perfect: window.perfect,
      destination: { x: layout.x, y: layout.y, r: layout.orbit }, landingAngle: window.landingAngle };
    if (!hasInteracted) setHasInteracted(true);
    if (!gameCountedRef.current) gameCountedRef.current = true;
    statusRef.current = 'active';
    setStatus('active');
    playCue('launch');
    vibrate('light');
    console.info('[Orbit Jump] launch', { valid: window.valid, perfect: window.perfect, angle: Number(angleRef.current.toFixed(2)) });
  }, [hasInteracted, playCue, targetLayout]);

  const handleStageClick = useCallback((event) => {
    if (event.defaultPrevented || !feedSession.active || flightRef.current || statusRef.current === 'over' || statusRef.current === 'paused') return;
    launch();
  }, [launch]);

  const togglePause = useCallback((event) => {
    event.stopPropagation();
    if (statusRef.current === 'over' || !hasInteracted) return;
    playCue('click');
    vibrate('light');
    const next = statusRef.current === 'paused' ? 'active' : 'paused';
    statusRef.current = next;
    setStatus(next);
  }, [hasInteracted, playCue]);

  const resetGame = useCallback(() => {
    playCue('click');
    vibrate('light');
    flightRef.current = null;
    angleRef.current = -Math.PI / 2;
    currentOrbitRef.current = { x: 200, y: 335, r: 98 };
    levelRef.current = 0;
    scoreRef.current = 0;
    perfectsRef.current = 0;
    gameCountedRef.current = false;
    setScore(0);
    setPerfects(0);
    setLevel(0);
    setLastResult('miss');
    setHasInteracted(true);
    statusRef.current = 'active';
    setStatus('active');
    console.info('[Orbit Jump] restart');
  }, [playCue]);

  useEffect(() => {
    let lastTime = performance.now();
    const tick = (time) => {
      const rawDt = time - lastTime;
      const dt = Math.min(Math.max(rawDt, 0), 32);
      lastTime = time;
      const currentStatus = statusRef.current;
      const running = (currentStatus === 'ready' || currentStatus === 'active') && !document.hidden && (currentStatus === 'ready' || feedSession.active);
      if (running) {
        if (!flightRef.current) angleRef.current += safeNumber(cfgRef.current.ORBIT_SPEED, .0018) * dt;
      }
      if (flightRef.current && running) {
        const flight = flightRef.current;
        flight.elapsed += dt;
        const ratio = Math.min(flight.elapsed / safeNumber(cfgRef.current.FLIGHT_MS, 560), 1);
        const eased = 1 - Math.pow(1 - ratio, 3);
        const point = {
          x: flight.start.x + (flight.target.x - flight.start.x) * eased,
          y: flight.start.y + (flight.target.y - flight.start.y) * eased,
        };
        const prior = { x: flight.start.x, y: flight.start.y };
        drawMotion(point, prior, 1);
        if (ratio >= 1) {
          const wasValid = flight.valid;
          flightRef.current = null;
          if (wasValid) {
            currentOrbitRef.current = flight.destination;
            angleRef.current = flight.landingAngle;
            completeCatch(flight.perfect);
          } else {
            completeMiss();
          }
        }
      } else if (!flightRef.current) {
        const orbit = currentOrbitRef.current;
        const point = pointOnCircle(orbit.x, orbit.y, orbit.r, angleRef.current);
        const trail = pointOnCircle(orbit.x, orbit.y, orbit.r, angleRef.current - .12);
        drawMotion(point, trail, currentStatus === 'paused' || currentStatus === 'over' ? .25 : .72);
      }
      const window = getTransferWindow(currentOrbitRef.current, targetLayout(levelRef.current), angleRef.current, safeNumber(cfgRef.current.SWEET_HALF_ANGLE, 0.42));
      if (stageRef.current) {
        stageRef.current.dataset.inSweetRange = String(window.valid && !flightRef.current);
        stageRef.current.dataset.angle = String(angleRef.current);
        stageRef.current.dataset.sweetAngle = String(window.center);
        stageRef.current.dataset.orbitX = String(currentOrbitRef.current.x);
        stageRef.current.dataset.orbitY = String(currentOrbitRef.current.y);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [completeCatch, completeMiss, drawMotion, targetLayout]);

  useEffect(() => () => {
    timeoutRefs.current.forEach((id) => window.clearTimeout(id));
    audioRef.current.sources.forEach((source) => { try { source.stop(); } catch (error) { /* already ended */ } });
    if (audioRef.current.ctx) audioRef.current.ctx.close().catch(() => {});
  }, []);

  const layout = targetLayout(level);
  const currentOrbit = currentOrbitRef.current;
  const sweet = getTransferWindow(currentOrbit, layout, angleRef.current, safeNumber(cfg.SWEET_HALF_ANGLE, 0.42));
  const targetArc = arcPath(currentOrbit.x, currentOrbit.y, currentOrbit.r,
    sweet.center - safeNumber(cfg.SWEET_HALF_ANGLE, 0.42), sweet.center + safeNumber(cfg.SWEET_HALF_ANGLE, 0.42));
  const unlocked = useMemo(() => {
    const conditions = {
      charcoal: true,
      sage: perfects >= 10,
      ivory: games >= 10,
      'matte gold': score >= 25,
      'slate blue': perfects >= 30,
      'powder pink': perfects >= 50,
      'soft peach': games >= 20,
      'pale lilac': score >= 40,
    };
    return conditions;
  }, [games, perfects, score]);

  const stageStatusText = status === 'paused' ? cfg.PAUSED_LABEL : (lastResult === 'miss' && status === 'over' ? cfg.MISS_LABEL : '');
  const background = palette.planetHi;

  return (
    <>
      <style>{CSS}</style>
      <main className="app-shell" style={{ background }}>
        <div className="canvas">
          <div className="topline"><div className="wordmark">{cfg.GAME_TITLE}</div></div>
          <div className="stage-area">
            <div
              className="orbit-stage"
              data-testid="orbit-stage"
              ref={stageRef}
              onPointerDown={() => { ensureAudio(); }}
              onClick={handleStageClick}
              style={{ containerType: 'inline-size' }}
            >
              {!hasInteracted && status === 'ready' && <div className="intro-guide">{cfg.GUIDE}</div>}
              {hasInteracted && status !== 'over' && (
                <div className="hud">
                  <div className="hud-item"><span className="hud-value score-value">{score}</span><span className="hud-label">{cfg.SCORE_LABEL}</span></div>
                  <div className="hud-item center"><span className="hud-value">{perfects}</span><span className="hud-label">{cfg.PERFECT_LABEL}</span></div>
                  <div className="hud-item right"><span className="hud-value">{best}</span><span className="hud-label">{cfg.BEST_LABEL}</span></div>
                </div>
              )}
              <svg className="orbit-svg" viewBox="0 -72 400 650" role="img" aria-label={cfg.GAME_TITLE}>
                <defs>
                  <radialGradient id="planetGlow" cx="35%" cy="28%">
                    <stop offset="0" stopColor={palette.planetHi} />
                    <stop offset="1" stopColor={palette.planet} />
                  </radialGradient>
                  <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8" /></filter>
                </defs>
                <circle cx={currentOrbit.x} cy={currentOrbit.y} r={currentOrbit.r + 18} fill="none" stroke={palette.faint} strokeWidth="1" strokeDasharray="2 10" opacity=".32" />
                <circle cx={currentOrbit.x} cy={currentOrbit.y} r={currentOrbit.r} fill="none" stroke={palette.ink} strokeWidth="1.2" strokeDasharray="2 8" opacity=".42" />
                <circle cx={currentOrbit.x} cy={currentOrbit.y} r="34" fill={palette.ink} opacity=".05" filter="url(#softShadow)" />
                <circle cx={currentOrbit.x} cy={currentOrbit.y} r="32" fill="url(#planetGlow)" stroke={palette.planet} strokeWidth="1" />
                <ellipse cx={currentOrbit.x - 10} cy={currentOrbit.y - 10} rx="15" ry="9" fill={palette.planetHi} opacity=".38" />
                <circle cx={layout.x} cy={layout.y} r="76" fill="none" stroke={palette.faint} strokeWidth="1" strokeDasharray="2 9" opacity=".2" />
                <circle cx={layout.x} cy={layout.y} r={layout.orbit} fill="none" stroke={palette.ink} strokeWidth="1.2" strokeDasharray="2 8" opacity=".42" />
                <circle cx={layout.x} cy={layout.y} r="26" fill={palette.planet} opacity=".18" />
                <circle cx={layout.x} cy={layout.y} r="23" fill={palette.planet} stroke={palette.planetHi} strokeWidth="1" />
                <ellipse cx={layout.x - 6} cy={layout.y - 7} rx="10" ry="6" fill={palette.planetHi} opacity=".56" />
                <path d={targetArc} fill="none" stroke={palette.sage} strokeWidth="12" strokeLinecap="round" opacity=".2" pointerEvents="none" />
                <path data-testid="sweet-range" d={targetArc} fill="none" stroke={palette.sage} strokeWidth="6" strokeLinecap="round" opacity="1" pointerEvents="none" />
                <g ref={playerRef}>
                  <line ref={(el) => { trailRefs.current[0] = el; }} stroke={palette.sage} strokeWidth="2.6" strokeLinecap="round" />
                  <line ref={(el) => { trailRefs.current[1] = el; }} stroke={palette.sage} strokeWidth="1.8" strokeLinecap="round" />
                  <line ref={(el) => { trailRefs.current[2] = el; }} stroke={palette.sage} strokeWidth="1.1" strokeLinecap="round" />
                  <circle r="9" fill={palette.sage} opacity=".18" />
                  <circle r="5.5" fill={palette.ink} />
                  <circle cx="-1.5" cy="-1.7" r="1.5" fill={palette.planetHi} opacity=".8" />
                </g>
                {catchPulse && <circle cx={currentOrbit.x} cy={currentOrbit.y} r="30" fill="none" stroke={palette.sage} strokeWidth="2" opacity=".55" className="pulse-ring" />}
              </svg>
              {hasInteracted && status === 'paused' && <div className="status-note">{stageStatusText}</div>}
              {hasInteracted && status !== 'over' && (
                <button className="pause-control" type="button" aria-label={status === 'paused' ? cfg.RESUME_LABEL : cfg.PAUSE_LABEL} onClick={togglePause}>
                  {status === 'paused' ? <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4.5v11l8-5.5z" fill="currentColor" /></svg> : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4.5v11M14 4.5v11" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" /></svg>}
                </button>
              )}
            </div>
          </div>
          {status === 'over' && (
            <div className="result-layer" data-testid="result-panel">
              <div className="result-card">
                <div className="result-kicker">{cfg.MISS_LABEL}</div>
                <h1 className="result-title">{cfg.GAME_TITLE}</h1>
                <div className="result-stats">
                  <div className="result-stat"><span className="result-number result-score">{score}</span><span className="result-label">{cfg.SCORE_LABEL}</span></div>
                  <div className="result-stat"><span className="result-number">{best}</span><span className="result-label">{cfg.BEST_LABEL}</span></div>
                </div>
                <div className="result-actions">
                  <button type="button" className="retry-button" onClick={resetGame}>{cfg.PLAY_AGAIN}</button>
                  <PostMyPlayButton />
                </div>
                <div className="unlocks">
                  <div className="unlocks-label">{cfg.UNLOCKED_LABEL}</div>
                  <div className="swatches">
                    {UNLOCKS.map((name) => (
                      <button key={name} type="button" className={`swatch${unlocked[name] ? '' : ' locked'}${paletteName === name ? ' selected' : ''}`} style={{ background: PALETTES[name].sage }} disabled={!unlocked[name]} onClick={() => { if (!unlocked[name]) return; playCue('click'); setPaletteName(name); }} aria-label={name} title={name}><span>{name}</span></button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
