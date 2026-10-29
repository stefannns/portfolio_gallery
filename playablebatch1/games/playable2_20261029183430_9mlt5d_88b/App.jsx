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
.hud { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); z-index: 5; width: min(88%, 360px); display: flex; justify-content: center; align-items: flex-start; text-align: center; pointer-events: none; }
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

.hud { justify-content:center; }

`;

const DEFAULT_CFG = {
  ORBIT_SPEED: 0.0018,
  FLIGHT_MS: 560,
  TARGET_RADIUS: 52,
  SWEET_HALF_ANGLE: 0.42,
  FLIGHT_SPEED: 0.42,
  CAPTURE_BAND: 8,
  SPEED_RAMP_SECONDS: 40,
  MAX_SPEED_MULTIPLIER: 2.2,
  SCORE_PER_CATCH: 1,
  GAME_TITLE: 'Orbit Jump B',
  GUIDE: 'Tap to launch into the ring',
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

function speedMultiplier(elapsedMs, cfg) {
  const rampMs = Math.max(1, safeNumber(cfg.SPEED_RAMP_SECONDS, 40)) * 1000;
  return Math.min(Math.max(1, safeNumber(cfg.MAX_SPEED_MULTIPLIER, 2.2)), 1 + Math.max(0, elapsedMs) / rampMs);
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

function rayCircleEntry(start, direction, center, radius) {
  const x = start.x - center.x, y = start.y - center.y;
  const along = x * direction.x + y * direction.y;
  const outside = x * x + y * y - radius * radius;
  if (outside <= 0) return 0;
  const discriminant = along * along - outside;
  if (discriminant < -1e-8) return null;
  const distance = -along - Math.sqrt(Math.max(0, discriminant));
  return distance >= -1e-8 ? Math.max(0, distance) : null;
}

function traceOrbitLaunch(orbit, destination, angle, spin = 1, band = 8) {
  const start = pointOnCircle(orbit.x, orbit.y, orbit.r, angle);
  // Differentiate the circular motion: launch along velocity, never toward a preset target.
  const direction = { x: -Math.sin(angle) * spin, y: Math.cos(angle) * spin };
  const ahead = (destination.x - start.x) * direction.x + (destination.y - start.y) * direction.y;
  const nearest = { x: start.x + direction.x * Math.max(0, ahead), y: start.y + direction.y * Math.max(0, ahead) };
  const clearance = Math.hypot(nearest.x - destination.x, nearest.y - destination.y);
  const coreDistance = rayCircleEntry(start, direction, destination, 23 + 5.5);
  let distance = coreDistance;
  let outcome = coreDistance === null ? 'miss' : 'planet';
  if (coreDistance === null && ahead > 0 && clearance <= destination.r + band) {
    // A center-bound shot crosses the ring first, but must hit the planet rather than auto-catch.
    distance = rayCircleEntry(start, direction, destination, destination.r) ?? ahead;
    outcome = 'catch';
  }
  return { start, direction, destination, distance, outcome, clearance, perfect: outcome === 'catch' && Math.abs(clearance - destination.r) <= band };
}

function launchHintWindow(orbit, destination, spin, band) {
  const count = 1024, step = Math.PI * 2 / count, groups = [];
  let group = null;
  for (let index = 0; index < count; index += 1) {
    const angle = (index + .5) * step;
    const trajectory = traceOrbitLaunch(orbit, destination, angle, spin, band);
    if (trajectory.outcome !== 'catch') { group = null; continue; }
    if (!group) { group = []; groups.push(group); }
    group.push({ index, angle, distance: trajectory.distance });
  }
  // A window crossing zero radians is one arc, rather than two separate hints.
  if (groups.length > 1 && groups[0][0].index === 0 && groups[groups.length - 1][groups[groups.length - 1].length - 1].index === count - 1) {
    const first = groups.shift();
    groups[groups.length - 1].push(...first.map(sample => ({ ...sample, angle: sample.angle + Math.PI * 2 })));
  }
  if (!groups.length) return null;
  // Prefer the widest safe timing window; use the shorter flight to break ties.
  groups.sort((a, b) => b.length - a.length || a[Math.floor(a.length / 2)].distance - b[Math.floor(b.length / 2)].distance);
  const selected = groups[0];
  if (selected.length < 2) return null;
  const startAngle = selected[0].angle + step * .25;
  const endAngle = selected[selected.length - 1].angle - step * .25;
  return {
    startAngle, endAngle, centerAngle: (startAngle + endAngle) / 2,
    start: pointOnCircle(orbit.x, orbit.y, orbit.r, startAngle),
    end: pointOnCircle(orbit.x, orbit.y, orbit.r, endAngle),
    path: arcPath(orbit.x, orbit.y, orbit.r, startAngle, endAngle),
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
  const elapsedPlayMsRef = useRef(0);
  const [games, setGames] = useState(() => {
    try { return Number(localStorage.getItem('orbit-jump-88b-games') || 0); } catch (error) { return 0; }
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
  const launchGuideRef = useRef(null);
  const trailRefs = useRef([]);
  const rafRef = useRef(0);
  const timeoutRefs = useRef([]);
  const angleRef = useRef(-Math.PI / 2);
  const spinRef = useRef(1);
  const currentOrbitRef = useRef({ x: 200, y: 335, r: 98 });
  const flightRef = useRef(null);
  const audioRef = useRef({ ctx: null, gain: null, buffers: new Map(), sources: new Set() });
  const gameCountedRef = useRef(false);

  const palette = PALETTES[paletteName] || PALETTES.charcoal;
  cfgRef.current = cfg;
  statusRef.current = status;
  scoreRef.current = score;
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
    try { localStorage.setItem('orbit-jump-88b-games', String(nextGames)); } catch (error) { /* storage optional */ }
    console.info('[Orbit Jump B] miss', { score: scoreRef.current });
  }, [playCue]);

  const completeCatch = useCallback(() => {
    const nextScore = scoreRef.current + safeNumber(cfgRef.current.SCORE_PER_CATCH, 1);
    scoreRef.current = nextScore;
    setScore(nextScore);
    playCue('catch');
    vibrate('medium');
    setCatchPulse(true);
    timeoutRefs.current.push(window.setTimeout(() => setCatchPulse(false), 500));
    const nextLevel = levelRef.current + 1;
    levelRef.current = nextLevel;
    setLevel(nextLevel);
    console.info('[Orbit Jump B] catch', { score: nextScore, orbit: nextLevel });
  }, [playCue]);

  const launch = useCallback(() => {
    if (statusRef.current === 'over' || statusRef.current === 'paused' || flightRef.current) return;
    const orbit = currentOrbitRef.current;
    const layout = targetLayout(levelRef.current);
    const destination = { x: layout.x, y: layout.y, r: layout.orbit };
    flightRef.current = {
      ...traceOrbitLaunch(orbit, destination, angleRef.current, spinRef.current, safeNumber(cfgRef.current.CAPTURE_BAND, 8)),
      travelled: 0,
      speed: Math.max(0.1, safeNumber(cfgRef.current.FLIGHT_SPEED, 0.42)) * speedMultiplier(elapsedPlayMsRef.current, cfgRef.current),
    };
    if (!hasInteracted) setHasInteracted(true);
    if (!gameCountedRef.current) gameCountedRef.current = true;
    statusRef.current = 'active';
    setStatus('active');
    playCue('launch');
    vibrate('light');
    console.info('[Orbit Jump B] tangent launch', { direction: flightRef.current.direction, angle: Number(angleRef.current.toFixed(2)) });
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
    spinRef.current = 1;
    currentOrbitRef.current = { x: 200, y: 335, r: 98 };
    levelRef.current = 0;
    scoreRef.current = 0;
    elapsedPlayMsRef.current = 0;
    gameCountedRef.current = false;
    setScore(0);
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
        if (currentStatus === 'active') elapsedPlayMsRef.current += dt;
        if (!flightRef.current) angleRef.current += safeNumber(cfgRef.current.ORBIT_SPEED, .0018) * speedMultiplier(elapsedPlayMsRef.current, cfgRef.current) * spinRef.current * dt;
      }
      if (flightRef.current && running) {
        const flight = flightRef.current;
        flight.travelled += flight.speed * dt;
        const reached = flight.distance !== null && flight.travelled >= flight.distance;
        const distance = reached ? flight.distance : flight.travelled;
        const point = {
          x: flight.start.x + flight.direction.x * distance,
          y: flight.start.y + flight.direction.y * distance,
        };
        const prior = { x: point.x - flight.direction.x * 30, y: point.y - flight.direction.y * 30 };
        drawMotion(point, prior, 1);
        if (reached || point.x < -25 || point.x > 425 || point.y < -97 || point.y > 603 || flight.travelled > 1400) {
          flightRef.current = null;
          if (reached && flight.outcome === 'catch') {
            currentOrbitRef.current = flight.destination;
            angleRef.current = Math.atan2(point.y - flight.destination.y, point.x - flight.destination.x);
            const cross = (point.x - flight.destination.x) * flight.direction.y - (point.y - flight.destination.y) * flight.direction.x;
            spinRef.current = cross < 0 ? -1 : 1;
            completeCatch();
          } else {
            completeMiss();
          }
        }
      } else if (!flightRef.current && currentStatus !== 'over') {
        const orbit = currentOrbitRef.current;
        const point = pointOnCircle(orbit.x, orbit.y, orbit.r, angleRef.current);
        const trail = pointOnCircle(orbit.x, orbit.y, orbit.r, angleRef.current - .12 * spinRef.current);
        drawMotion(point, trail, currentStatus === 'paused' || currentStatus === 'over' ? .25 : .72);
      }
      if (stageRef.current) {
        stageRef.current.dataset.angle = String(angleRef.current);
        stageRef.current.dataset.orbitX = String(currentOrbitRef.current.x);
        stageRef.current.dataset.orbitY = String(currentOrbitRef.current.y);
        stageRef.current.dataset.motion = flightRef.current ? 'flight' : 'orbit';
        stageRef.current.dataset.speedMultiplier = String(speedMultiplier(elapsedPlayMsRef.current, cfgRef.current));
      }
      if (launchGuideRef.current) launchGuideRef.current.style.opacity = flightRef.current || statusRef.current === 'over' ? '0' : '1';
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
  const launchHint = useMemo(() => launchHintWindow(currentOrbit, { x: layout.x, y: layout.y, r: layout.orbit }, spinRef.current, safeNumber(cfg.CAPTURE_BAND, 8)),
    [currentOrbit, layout.x, layout.y, layout.orbit, cfg.CAPTURE_BAND, spinRef.current]);
  const unlocked = useMemo(() => {
    const conditions = {
      charcoal: true,
      sage: score >= 10,
      ivory: games >= 10,
      'matte gold': score >= 25,
      'slate blue': score >= 30,
      'powder pink': score >= 50,
      'soft peach': games >= 20,
      'pale lilac': score >= 40,
    };
    return conditions;
  }, [games, score]);

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
                </div>
              )}
              <svg className="orbit-svg" viewBox="0 -72 400 650" role="img" aria-label={cfg.GAME_TITLE}>
                <defs>
                  {launchHint && <linearGradient id="launchHintShade" gradientUnits="userSpaceOnUse" x1={launchHint.start.x} y1={launchHint.start.y} x2={launchHint.end.x} y2={launchHint.end.y}>
                    <stop offset="0" stopColor={palette.sage} stopOpacity="0" />
                    <stop offset=".2" stopColor={palette.sage} stopOpacity=".52" />
                    <stop offset=".5" stopColor={palette.sage} stopOpacity=".82" />
                    <stop offset=".8" stopColor={palette.sage} stopOpacity=".52" />
                    <stop offset="1" stopColor={palette.sage} stopOpacity="0" />
                  </linearGradient>}
                  <radialGradient id="planetGlow" cx="35%" cy="28%">
                    <stop offset="0" stopColor={palette.planetHi} />
                    <stop offset="1" stopColor={palette.planet} />
                  </radialGradient>
                  <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8" /></filter>
                </defs>
                <circle cx={currentOrbit.x} cy={currentOrbit.y} r={currentOrbit.r + 18} fill="none" stroke={palette.faint} strokeWidth="1" strokeDasharray="2 10" opacity=".32" />
                <g ref={launchGuideRef} data-testid="launch-sweet-guide" pointerEvents="none" aria-hidden="true">
                  {launchHint && <path data-testid="launch-sweet-strip" d={launchHint.path} fill="none" stroke="url(#launchHintShade)" strokeWidth="18" strokeLinecap="butt" />}
                </g>
                <circle cx={currentOrbit.x} cy={currentOrbit.y} r={currentOrbit.r} fill="none" stroke={palette.ink} strokeWidth="1.2" strokeDasharray="2 8" opacity=".42" />
                <circle cx={currentOrbit.x} cy={currentOrbit.y} r="34" fill={palette.ink} opacity=".05" filter="url(#softShadow)" />
                <circle cx={currentOrbit.x} cy={currentOrbit.y} r="32" fill="url(#planetGlow)" stroke={palette.planet} strokeWidth="1" />
                <ellipse cx={currentOrbit.x - 10} cy={currentOrbit.y - 10} rx="15" ry="9" fill={palette.planetHi} opacity=".38" />
                <circle data-testid="capture-range" cx={layout.x} cy={layout.y} r={layout.orbit} fill="none" stroke={palette.sage} strokeWidth={safeNumber(cfg.CAPTURE_BAND, 8) * 2} opacity=".18" />
                <circle cx={layout.x} cy={layout.y} r={layout.orbit} fill="none" stroke={palette.sage} strokeWidth="3" opacity=".8" />
                <circle cx={layout.x} cy={layout.y} r={layout.orbit} fill="none" stroke={palette.ink} strokeWidth="1.2" strokeDasharray="2 8" opacity=".42" />
                <circle cx={layout.x} cy={layout.y} r="26" fill={palette.planet} opacity=".18" />
                <circle cx={layout.x} cy={layout.y} r="23" fill={palette.planet} stroke={palette.planetHi} strokeWidth="1" />
                <ellipse cx={layout.x - 6} cy={layout.y - 7} rx="10" ry="6" fill={palette.planetHi} opacity=".56" />
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
