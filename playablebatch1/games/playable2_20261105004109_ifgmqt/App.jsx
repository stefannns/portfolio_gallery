import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

const DEFAULT_CFG = {
  GAME_TITLE: 'Neon Dodge',
  GUIDE_TEXT: 'Drag to dodge',
  SCORE_SURVIVAL_WEIGHT: 10,
  SCORE_NEAR_MISS: 35,
  SPAWN_START_MS: 740,
  SPAWN_MIN_MS: 340,
  SPEED_START: 150,
  SPEED_GROWTH: 10.5,
  SPEED_MAX: 450,
  MAX_OBSTACLES: 18,
  TOP_SPAWN_CHANCE: 0.9,
  WAVE_GAP: 124,
  LASER_FIRST_MS: 6500,
  LASER_INTERVAL_MS: 7600,
  LASER_WARNING_MS: 1000,
  LASER_ACTIVE_MS: 420,
  LASER_WIDTH: 14,
  NEAR_DISTANCE: 18,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function vibrate(style) {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style: style || 'light' });
  } catch (e) { /* optional haptics */ }
}

function playSound(name, once = false) {
  try {
    if (typeof window !== 'undefined' && window.SFX) {
      if (once && window.SFX.playOnce) window.SFX.playOnce(name);
      else if (window.SFX.play) window.SFX.play(name);
    }
  } catch (e) { /* audio is non-blocking */ }
}

function useRecordingSubmission() {
  const canSubmit = typeof tt !== 'undefined' && typeof tt.playableRecordingSubmission === 'function';
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  useEffect(() => {
    const restore = () => { submittingRef.current = false; setSubmitting(false); };
    const onVisible = () => { if (document.visibilityState === 'visible') restore(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', restore);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', restore);
    };
  }, []);
  const submitRecording = () => {
    if (submittingRef.current || !canSubmit) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      tt.playableRecordingSubmission({
        success() {},
        fail(err) {
          console.error('[post_my_play] playableRecordingSubmission failed', err && (err.errMsg || err.message));
          submittingRef.current = false;
          setSubmitting(false);
        },
        complete() {},
      });
    } catch (err) {
      console.error('[post_my_play] playableRecordingSubmission failed', err && err.message);
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
  return { canSubmit, submitting, submitRecording };
}

function PostMyPlayButton() {
  const { canSubmit, submitting, submitRecording } = useRecordingSubmission();
  if (!canSubmit) return null;
  return (
    <button className="action-button secondary" type="button" disabled={submitting} onClick={submitRecording}
      style={{ opacity: submitting ? 0.55 : 1, pointerEvents: submitting ? 'none' : 'auto' }}>
      POST MY PLAY
    </button>
  );
}

function getDistanceToRect(px, py, o) {
  const dx = px - o.x;
  const dy = py - o.y;
  const c = Math.cos(-o.angle);
  const s = Math.sin(-o.angle);
  const rx = dx * c - dy * s;
  const ry = dx * s + dy * c;
  const corner = Math.min(o.corner || 0, o.w / 2, o.h / 2);
  const qx = Math.abs(rx) - o.w / 2 + corner;
  const qy = Math.abs(ry) - o.h / 2 + corner;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - corner;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const amount = clamp(((px - x1) * dx + (py - y1) * dy) / Math.max(1, dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - x1 - dx * amount, py - y1 - dy * amount);
}

function hazardDistance(px, py, hazard) {
  if (hazard.type === 'laser') {
    return distanceToSegment(px, py, hazard.x1, hazard.y1, hazard.x2, hazard.y2) - hazard.width / 2;
  }
  if (hazard.type === 'disc') return Math.hypot(px - hazard.x, py - hazard.y) - hazard.r;
  return getDistanceToRect(px, py, hazard);
}

function laserStage(laser) {
  if (laser.age < laser.warningMs) return 'warning';
  if (laser.age < laser.warningMs + laser.activeMs) return 'active';
  return 'fading';
}

function isHazardActive(hazard) {
  return hazard.type !== 'laser' || laserStage(hazard) === 'active';
}

function sweptCollision(orb, from, hazard, previous) {
  let start = 0, end = 1;
  if (hazard.type === 'laser') {
    const previousAge = previous.age ?? hazard.age;
    if (hazard.age < hazard.warningMs || previousAge >= hazard.warningMs + hazard.activeMs) return false;
    const elapsed = hazard.age - previousAge;
    if (elapsed > 0) {
      start = clamp((hazard.warningMs - previousAge) / elapsed, 0, 1);
      end = clamp((hazard.warningMs + hazard.activeMs - previousAge) / elapsed, 0, 1);
    }
  }
  const travel = Math.hypot(orb.x - from.x, orb.y - from.y) + Math.hypot(hazard.x - previous.x, hazard.y - previous.y);
  const steps = Math.max(1, Math.ceil(travel / Math.max(6, orb.radius * .6)));
  for (let index = 0; index <= steps; index += 1) {
    const amount = start + (end - start) * index / steps;
    const shape = hazard.type === 'laser' ? hazard : {
      ...hazard,
      x: previous.x + (hazard.x - previous.x) * amount,
      y: previous.y + (hazard.y - previous.y) * amount,
      angle: previous.angle + (hazard.angle - previous.angle) * amount,
    };
    if (hazardDistance(from.x + (orb.x - from.x) * amount, from.y + (orb.y - from.y) * amount, shape) < orb.radius - 2) return true;
  }
  return false;
}

function makeObstacle(w, h, difficulty, index, topChance = .9, preview = false) {
  const scale = clamp(w / 390, .75, 1.3);
  const fromTop = preview || Math.random() < topChance;
  const speed = difficulty.speed * (.9 + Math.random() * .23);
  const typeRoll = Math.random();
  const type = typeRoll < .45 ? 'disc' : typeRoll < .74 ? 'block' : 'bar';
  const width = (type === 'bar' ? 70 + Math.random() * 42 : 32 + Math.random() * 27) * scale;
  const height = (type === 'bar' ? 17 + Math.random() * 7 : 35 + Math.random() * 32) * scale;
  const leftSide = Math.random() < .5;
  const x = fromTop ? (preview ? (leftSide ? .13 : .87) * w : 22 + Math.random() * (w - 44)) : (leftSide ? -80 : w + 80);
  const y = fromTop ? -80 : h * (.12 + Math.random() * .2);
  const lean = fromTop ? (Math.random() - .5) * .54 : (leftSide ? .62 : -.62);
  return {
    id: `fall-${index}`, type, spawnEdge: fromTop ? 'top' : 'side',
    x, y, vx: lean * speed, vy: speed,
    angle: (Math.random() - .5) * 1.1,
    spin: preview ? .13 : (Math.random() - .5) * .75,
    w: preview ? Math.min(width, 42) : width,
    h: height,
    corner: 7 * scale,
    r: (preview ? 18 : 19 + Math.random() * 15) * scale,
    wasNear: false, nearTriggered: false,
  };
}

function makeWave(w, h, difficulty, index, gapSize) {
  const scale = clamp(w / 390, .75, 1.3);
  const gap = clamp(gapSize * scale, 96, w * .5);
  const center = w * (.33 + Math.random() * .34);
  const gapLeft = center - gap / 2, gapRight = center + gap / 2;
  return [
    { x: (gapLeft - 24) / 2, w: gapLeft + 24 },
    { x: (gapRight + w + 24) / 2, w: w + 24 - gapRight },
  ].map((part, side) => ({
    ...part, id: `gate-${index}-${side}`, type: 'bar', spawnEdge: 'top',
    y: -60, vx: 0, vy: difficulty.speed * .9, h: 22 * scale,
    angle: 0, spin: 0, corner: 6, r: 0, wasNear: false, nearTriggered: false,
  }));
}

function makeLaser(w, h, orb, index, cfg, preview = false) {
  const across = !preview && Math.random() < .18;
  const slant = preview ? 0 : Math.random() < .6 ? 0 : (Math.random() < .5 ? -1 : 1) * w * .25;
  const startX = preview ? (index % 2 ? .15 : .85) * w : clamp(orb.x + slant, 35, w - 35);
  const targetY = Math.max(h * .35, orb.y);
  const acrossY = clamp(orb.y + (Math.random() - .5) * 32, h * .34, h - 70);
  return {
    id: `laser-${index}`, type: 'laser', spawnEdge: across ? 'side' : 'top',
    x: startX, y: acrossY, angle: 0,
    x1: across ? -24 : startX, y1: across ? acrossY : -24,
    x2: across ? w + 24 : startX + ((preview ? startX : orb.x) - startX) * (h + 48) / (targetY + 24),
    y2: across ? acrossY : h + 24,
    width: Number(cfg.LASER_WIDTH), age: 0,
    warningMs: Number(cfg.LASER_WARNING_MS), activeMs: Number(cfg.LASER_ACTIVE_MS), fadeMs: 180,
    fired: false, wasNear: false, nearTriggered: false,
  };
}

function unlockGameAudio(ref) {
  try {
    if (!ref.current) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      const context = new Context();
      const master = context.createGain();
      master.gain.value = .16;
      master.connect(context.destination);
      ref.current = { context, master };
    }
    ref.current.context.resume().catch(() => {});
  } catch { /* Device audio is optional. */ }
}

const MUSIC_GAIN = .12;

function setRunMusic(audio, enabled) {
  if (!audio || audio.musicWanted === enabled) return;
  const { context } = audio;
  audio.musicWanted = enabled;
  if (!enabled) {
    const music = audio.music;
    if (!music) return;
    audio.music = null;
    const now = context.currentTime;
    music.level.cancelScheduledValues(now);
    music.level.setTargetAtTime(0, now, .024);
    music.source.stop(now + .12);
    return;
  }

  audio.musicBuffer ??= fetch('./assets/music_neon_dodge.mp3')
    .then(response => response.arrayBuffer())
    .then(bytes => context.decodeAudioData(bytes))
    .catch(() => null);
  audio.musicBuffer.then(buffer => {
    if (!buffer || !audio.musicWanted || audio.music || context.state === 'closed') return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(context.destination);
    gain.gain.setTargetAtTime(MUSIC_GAIN, context.currentTime, .045);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    source.start();
    audio.music = { source, level: gain.gain };
  }).catch(() => { /* Music is optional. */ });
}

const GAME_CUES = {
  warning: { start: 440, end: 550, duration: .16, peak: .18, type: 'sine' },
  laser: { start: 670, end: 155, duration: .15, peak: .21, type: 'triangle' },
};

function playGameCue(audio, name) {
  if (!audio || audio.context.state !== 'running') return;
  const cue = GAME_CUES[name];
  try {
    const { context, master } = audio, now = context.currentTime;
    const musicLevel = audio.music?.level;
    if (musicLevel) {
      musicLevel.cancelScheduledValues(now);
      musicLevel.setTargetAtTime(MUSIC_GAIN * .24, now, .012);
      musicLevel.setTargetAtTime(MUSIC_GAIN, now + cue.duration, .09);
    }
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = cue.type;
    oscillator.frequency.setValueAtTime(cue.start, now);
    oscillator.frequency.exponentialRampToValueAtTime(cue.end, now + cue.duration * .85);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(cue.peak, now + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, now + cue.duration);
    oscillator.connect(gain); gain.connect(master);
    oscillator.start(now); oscillator.stop(now + cue.duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  } catch { /* Keep visual timing independent of audio. */ }
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function App() {
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [phase, setPhase] = useState('idle');
  const [live, setLive] = useState({ elapsed: 0, score: 0 });
  const [result, setResult] = useState(null);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const dimsRef = useRef({ w: 360, h: 720, dpr: 1 });
  const gameRef = useRef(null);
  const phaseRef = useRef('idle');
  const cfgRef = useRef(cfg);
  const gameAudioRef = useRef(null);
  const pausedRef = useRef(document.hidden);
  const hostActiveRef = useRef(true);
  const reducedMotionRef = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const syncRunMusic = useCallback(() => {
    setRunMusic(gameAudioRef.current, phaseRef.current === 'running' &&
      hostActiveRef.current && !pausedRef.current);
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch('./game.config.json', { cache: 'no-store' }).then((r) => r.json()).then((data) => {
      if (!mounted) return;
      const next = { ...DEFAULT_CFG };
      [...(data.tweaks || []), ...(data.texts || [])].forEach((item) => { next[item.id] = item.value; });
      setCfg(next); cfgRef.current = next;
    }).catch(() => { /* defaults keep the game playable */ });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    try {
      if (window.SFX && window.SFX.register) {
        window.SFX.register({
          replay: { path: './assets/sfx_replay.mp3', gain: .6 },
          near_miss: { path: './assets/sfx_near_miss.mp3', gain: .35 },
          collision: { path: './assets/sfx_collision.mp3', gain: .85 },
        });
      }
    } catch (e) { /* audio can gracefully degrade */ }
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 120) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const previous = dimsRef.current;
    const game = gameRef.current;
    if (game && previous.w > 0 && previous.h > 0) {
      const sx = w / previous.w, sy = h / previous.h;
      game.orb.x = clamp(game.orb.x * sx, 22, w - 22);
      game.orb.y = clamp(game.orb.y * sy, 40, h - 40);
      game.orb.targetX = game.orb.x; game.orb.targetY = game.orb.y;
      game.orb.trail = [];
      game.drag = false; game.pointerId = null;
      for (const hazard of game.obstacles) {
        hazard.x *= sx; hazard.y *= sy;
        if (hazard.type === 'laser') {
          hazard.x1 *= sx; hazard.x2 *= sx; hazard.y1 *= sy; hazard.y2 *= sy;
        }
      }
    }
    dimsRef.current = { w, h, dpr };
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }, []);

  const resetGame = useCallback((startNow = false) => {
    const { w, h } = dimsRef.current;
    const orb = { x: w * .5, y: h * .64, targetX: w * .5, targetY: h * .64, radius: 17, trail: [], pulse: 0 };
    gameRef.current = {
      orb, obstacles: [], sparks: [], elapsed: 0, near: 0, score: 0,
      demoElapsed: 0, lastSpawn: 0, nextLaserAt: startNow ? Number(cfgRef.current.LASER_FIRST_MS) : 2800,
      lastGateAt: -10000, lastNearSoundAt: -10000, nearNotice: null, hitFlash: 0,
      drag: false, pointerId: null, pointerX: 0, pointerY: 0, lastUi: 0, spawnIndex: 0,
    };
    if (!startNow) {
      gameRef.current.obstacles = [
        { ...makeObstacle(w, h, { speed: 88 }, 'demo-a', 1, true), x: w * .13, y: h * .35 },
        { ...makeObstacle(w, h, { speed: 88 }, 'demo-b', 1, true), x: w * .87, y: h * .55 },
      ];
    }
    lastFrameRef.current = 0;
    phaseRef.current = startNow ? 'running' : 'idle';
    syncRunMusic();
    setPhase(startNow ? 'running' : 'idle');
    setResult(null);
    setLive({ elapsed: 0, score: 0 });
    if (window.SFX && window.SFX.reset) window.SFX.reset();
  }, [syncRunMusic]);

  useEffect(() => {
    resizeCanvas();
    resetGame(false);
    const onResize = () => resizeCanvas();
    const resizeObserver = new ResizeObserver(onResize);
    if (wrapRef.current) resizeObserver.observe(wrapRef.current);
    const onVisibility = () => {
      pausedRef.current = document.hidden;
      syncRunMusic();
      lastFrameRef.current = 0;
      if (gameRef.current) { gameRef.current.drag = false; gameRef.current.pointerId = null; }
    };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => { reducedMotionRef.current = media.matches; };
    const onHost = (event) => {
      if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
      hostActiveRef.current = event.data.active === true;
      syncRunMusic();
      lastFrameRef.current = 0;
      if (!hostActiveRef.current && gameRef.current) { gameRef.current.drag = false; gameRef.current.pointerId = null; }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('message', onHost);
    document.addEventListener('visibilitychange', onVisibility);
    media.addEventListener?.('change', onMotion);
    return () => {
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      window.removeEventListener('message', onHost);
      document.removeEventListener('visibilitychange', onVisibility);
      media.removeEventListener?.('change', onMotion);
      cancelAnimationFrame(rafRef.current);
      const audio = gameAudioRef.current;
      setRunMusic(audio, false);
      audio?.context.close().catch(() => {});
      gameAudioRef.current = null;
    };
  }, [resizeCanvas, resetGame, syncRunMusic]);

  const pointerPosition = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const { w, h } = dimsRef.current;
    return {
      x: (event.clientX - rect.left) * w / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * h / Math.max(1, rect.height),
    };
  };

  const startFromPointer = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.isPrimary === false) return;
    const p = pointerPosition(event);
    let g = gameRef.current;
    if (!g || g.pointerId !== null || phaseRef.current === 'over') return;
    event.preventDefault();
    unlockGameAudio(gameAudioRef);
    if (phaseRef.current === 'idle') {
      const position = { x: g.orb.x, y: g.orb.y };
      resetGame(true);
      g = gameRef.current;
      g.orb.x = position.x; g.orb.y = position.y;
      g.orb.targetX = position.x; g.orb.targetY = position.y;
    }
    g.drag = true; g.pointerId = event.pointerId;
    g.pointerX = p.x; g.pointerY = p.y;
    try { canvasRef.current.setPointerCapture?.(event.pointerId); } catch (e) { /* synthetic preview events may not own a pointer */ }
  };

  const movePointer = (event) => {
    if (event.isPrimary === false) return;
    const g = gameRef.current;
    if (!g || phaseRef.current !== 'running' || !g.drag || g.pointerId !== event.pointerId) return;
    event.preventDefault();
    const p = pointerPosition(event);
    const { w, h } = dimsRef.current;
    g.orb.targetX = clamp(g.orb.targetX + p.x - g.pointerX, 22, w - 22);
    g.orb.targetY = clamp(g.orb.targetY + p.y - g.pointerY, 40, h - 40);
    g.pointerX = p.x; g.pointerY = p.y;
  };

  const endPointer = (event) => {
    if (event.isPrimary === false) return;
    const g = gameRef.current;
    if (!g || g.pointerId !== event.pointerId) return;
    g.drag = false; g.pointerId = null;
    try {
      if (canvasRef.current.hasPointerCapture?.(event.pointerId)) canvasRef.current.releasePointerCapture(event.pointerId);
    } catch { /* A cancelled pointer may already have lost capture. */ }
  };

  const keyDown = (event) => {
    const moves = { ArrowLeft: [-32, 0], ArrowRight: [32, 0], ArrowUp: [0, -32], ArrowDown: [0, 32] };
    if (!moves[event.key] && event.key !== ' ' && event.key !== 'Enter') return;
    if (phaseRef.current === 'over') return;
    event.preventDefault(); unlockGameAudio(gameAudioRef);
    if (phaseRef.current === 'idle') resetGame(true);
    const g = gameRef.current, { w, h } = dimsRef.current;
    const move = moves[event.key] || [0, 0];
    g.orb.targetX = clamp(g.orb.targetX + move[0], 22, w - 22);
    g.orb.targetY = clamp(g.orb.targetY + move[1], 40, h - 40);
  };

  const finishGame = (g) => {
    if (phaseRef.current !== 'running') return;
    phaseRef.current = 'over';
    syncRunMusic();
    g.drag = false; g.pointerId = null; g.hitFlash = 230; g.nearNotice = null;
    const final = { elapsed: g.elapsed, score: g.score, near: g.near };
    setResult(final);
    setPhase('over');
    playSound('collision', true);
    vibrate('notification_error');
  };

  const drawOrb = (ctx, orb, time, alpha = 1) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#189fff'; ctx.shadowBlur = 13;
    for (let i = 1; i < orb.trail.length; i += 1) {
      const point = orb.trail[i], previous = orb.trail[i - 1];
      const ratio = Math.max(0, 1 - point.age / 240);
      ctx.lineWidth = Math.max(1, orb.radius * 1.35 * ratio);
      ctx.strokeStyle = `rgba(22, 174, 255, ${ratio * .33})`;
      ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(point.x, point.y); ctx.stroke();
    }
    const pulse = 1 + (reducedMotionRef.current ? 0 : Math.sin(time * .006) * .025) + orb.pulse * .13;
    ctx.shadowColor = '#2de8ff'; ctx.shadowBlur = 25;
    const grad = ctx.createRadialGradient(orb.x - 5, orb.y - 6, 1, orb.x, orb.y, orb.radius * 1.7);
    grad.addColorStop(0, '#eaffff'); grad.addColorStop(0.22, '#57f3ff'); grad.addColorStop(0.72, '#05bce5'); grad.addColorStop(1, '#007aa8');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(orb.x, orb.y, orb.radius * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,.82)';
    ctx.beginPath(); ctx.arc(orb.x - 5, orb.y - 6, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };

  const drawLaser = (ctx, laser) => {
    const stage = laserStage(laser);
    const fade = stage === 'fading' ? clamp(1 - (laser.age - laser.warningMs - laser.activeMs) / laser.fadeMs, 0, 1) : 1;
    const line = () => { ctx.beginPath(); ctx.moveTo(laser.x1, laser.y1); ctx.lineTo(laser.x2, laser.y2); ctx.stroke(); };
    ctx.save(); ctx.lineCap = 'butt';
    if (stage === 'warning') {
      const progress = laser.age / laser.warningMs;
      ctx.strokeStyle = `rgba(255,53,86,${.06 + progress * .1})`;
      ctx.lineWidth = laser.width + 16; line();
      ctx.strokeStyle = `rgba(255,99,121,${.4 + progress * .45})`;
      ctx.lineWidth = 1.5; ctx.setLineDash([7, 8]); line(); ctx.setLineDash([]);
      // The emitter fills during the warning; the aiming line stays locked.
      const vertical = Math.abs(laser.y2 - laser.y1) > Math.abs(laser.x2 - laser.x1);
      const x = vertical ? laser.x1 + (laser.x2 - laser.x1) * (40 / (laser.y2 - laser.y1)) : 15;
      const y = vertical ? 16 : laser.y1;
      ctx.translate(x, y);
      if (!vertical) ctx.rotate(-Math.PI / 2);
      ctx.strokeStyle = '#ff4c69'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(0, 5); ctx.lineTo(9, -6); ctx.stroke();
      ctx.fillStyle = `rgba(255,53,86,${progress})`;
      roundedRectPath(ctx, -7, -17, 14, 5, 2); ctx.fill();
    } else {
      ctx.globalAlpha = fade;
      ctx.shadowColor = '#ff1f50'; ctx.shadowBlur = 26;
      ctx.strokeStyle = 'rgba(255,31,73,.14)'; ctx.lineWidth = laser.width + 18; line();
      ctx.strokeStyle = '#ff2b50'; ctx.lineWidth = laser.width; line();
      ctx.shadowBlur = 9; ctx.strokeStyle = '#fff0ef'; ctx.lineWidth = 3.5; line();
    }
    ctx.restore();
  };

  const drawObstacle = (ctx, o) => {
    if (o.type === 'laser') { drawLaser(ctx, o); return; }
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle || 0);
    ctx.shadowColor = '#ff204f'; ctx.shadowBlur = 15;
    ctx.strokeStyle = '#ff5367'; ctx.fillStyle = '#ee2949'; ctx.lineWidth = 1.5;
    if (o.type === 'disc') {
      ctx.beginPath(); ctx.arc(0, 0, o.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      roundedRectPath(ctx, -o.w / 2, -o.h / 2, o.w, o.h, o.corner); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,174,184,.4)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-o.w / 2 + 8, -o.h / 2 + 3); ctx.lineTo(o.w * .17, -o.h / 2 + 3); ctx.stroke();
    }
    ctx.restore();
  };

  const drawScene = (time) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const g = gameRef.current;
    if (!ctx || !g) return;
    const { w, h, dpr } = dimsRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(32, 114, 142, .10)'; ctx.lineWidth = 1;
    const grid = 32;
    const drift = reducedMotionRef.current ? 0 : (time * .018) % grid;
    for (let x = 0; x < w + grid; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = -grid + drift; y < h + grid; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(40, 205, 234, .055)';
    for (let i = 0; i < 9; i += 1) {
      const x = (i * 83) % (w + 80) - 40;
      const y = ((i * 137 + (reducedMotionRef.current ? 0 : time * .07)) % (h + 100)) - 50;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y - 22); ctx.stroke();
    }
    const vignette = ctx.createRadialGradient(w / 2, h * .45, 70, w / 2, h * .5, Math.max(w, h) * .7);
    vignette.addColorStop(0, 'rgba(0,22,35,.04)'); vignette.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h);
    g.obstacles.forEach((o) => drawObstacle(ctx, o));
    g.sparks.forEach((s) => {
      ctx.globalAlpha = Math.max(0, s.life / s.maxLife);
      ctx.fillStyle = s.color; ctx.fillRect(s.x, s.y, s.size, s.size);
    });
    ctx.globalAlpha = 1;
    drawOrb(ctx, g.orb, time);
    if (g.nearNotice && g.nearNotice.life > 0) {
      const notice = g.nearNotice;
      const text = `NEAR MISS +${notice.points}`;
      ctx.save();
      ctx.font = '700 13px system-ui, sans-serif';
      const half = ctx.measureText(text).width / 2;
      const x = clamp(notice.x, 30 + half, w - 30 - half);
      const y = clamp(notice.y - (1 - notice.life / 700) * 12, 86, h - 55);
      ctx.globalAlpha = Math.min(1, notice.life / 140);
      ctx.textAlign = 'center'; ctx.fillStyle = '#9cffff';
      ctx.shadowColor = '#00121d'; ctx.shadowBlur = 8;
      ctx.fillText(text, x, y);
      ctx.restore();
    }
    if (g.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,34,66,${g.hitFlash / 230 * .14})`;
      ctx.fillRect(0, 0, w, h);
    }
  };

  const tick = useCallback((time) => {
    const g = gameRef.current;
    if (!g) return;
    if (pausedRef.current || (phaseRef.current === 'running' && !hostActiveRef.current)) {
      lastFrameRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    const { w, h } = dimsRef.current;
    const dt = lastFrameRef.current ? clamp(time - lastFrameRef.current, 0, 48) : 0;
    const seconds = dt / 1000;
    lastFrameRef.current = time;
    const c = cfgRef.current;
    const from = { x: g.orb.x, y: g.orb.y };
    if (phaseRef.current === 'idle') {
      if (!reducedMotionRef.current) {
        g.demoElapsed += dt;
        const t = g.demoElapsed / 1000;
        g.orb.targetX = w * .5 + Math.sin(t * 1.25) * w * .21;
        g.orb.targetY = h * .61 + Math.cos(t * 1.07) * h * .065;
        const ease = 1 - Math.exp(-dt / 110);
        g.orb.x += (g.orb.targetX - g.orb.x) * ease;
        g.orb.y += (g.orb.targetY - g.orb.y) * ease;
        if (g.demoElapsed - g.lastSpawn > 1050 && g.obstacles.length < 8) {
          const hazard = makeObstacle(w, h, { speed: 88 }, g.spawnIndex++, 1, true);
          hazard.vx = 0;
          g.obstacles.push(hazard);
          g.lastSpawn = g.demoElapsed;
        }
        if (g.demoElapsed >= g.nextLaserAt) {
          g.obstacles.push(makeLaser(w, h, g.orb, g.spawnIndex++, c, true));
          g.nextLaserAt = g.demoElapsed + 6400;
        }
      }
    } else if (phaseRef.current === 'running') {
      g.elapsed += dt;
      const difficulty = { speed: Math.min(Number(c.SPEED_MAX), Number(c.SPEED_START) + (g.elapsed / 1000) * Number(c.SPEED_GROWTH)) };
      const spawnMs = Math.max(Number(c.SPAWN_MIN_MS), Number(c.SPAWN_START_MS) - g.elapsed / 50);
      const hasLaser = g.obstacles.some(hazard => hazard.type === 'laser');
      if (g.elapsed - g.lastSpawn >= spawnMs && g.obstacles.length < Number(c.MAX_OBSTACLES)) {
        const makeGate = g.elapsed > 3500 && g.spawnIndex % 7 === 6 && !hasLaser && g.elapsed < g.nextLaserAt && g.obstacles.length + 2 <= Number(c.MAX_OBSTACLES);
        if (makeGate) {
          g.obstacles.push(...makeWave(w, h, difficulty, g.spawnIndex++, Number(c.WAVE_GAP)));
          g.lastGateAt = g.elapsed;
        } else {
          g.obstacles.push(makeObstacle(w, h, difficulty, g.spawnIndex++, Number(c.TOP_SPAWN_CHANCE)));
        }
        g.lastSpawn = g.elapsed;
      }
      if (g.elapsed >= g.nextLaserAt && !hasLaser && g.elapsed - g.lastGateAt > 3200 && g.obstacles.length < Number(c.MAX_OBSTACLES)) {
        g.obstacles.push(makeLaser(w, h, g.orb, g.spawnIndex++, c));
        playGameCue(gameAudioRef.current, 'warning');
        g.nextLaserAt = g.elapsed + Math.max(4800, Number(c.LASER_INTERVAL_MS) - g.elapsed * .035);
      }
      const ease = 1 - Math.exp(-dt / 42);
      g.orb.x += (g.orb.targetX - g.orb.x) * ease;
      g.orb.y += (g.orb.targetY - g.orb.y) * ease;
    }

    let pendingNearFeedback = false;
    const awardNearMiss = (hazard) => {
      if (hazard.nearTriggered || phaseRef.current !== 'running') return;
      hazard.nearTriggered = true;
      g.near += 1;
      g.orb.pulse = 1;
      const points = Number(c.SCORE_NEAR_MISS);
      const previousPoints = g.nearNotice && g.nearNotice.life > 500 ? g.nearNotice.points : 0;
      g.nearNotice = { x: g.orb.x, y: g.orb.y - 38, points: previousPoints + points, life: 700 };
      for (let i = 0; i < 7; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        g.sparks.push({ x: g.orb.x, y: g.orb.y, vx: Math.cos(angle) * 65, vy: Math.sin(angle) * 65, size: 2, life: 250, maxLife: 250, color: '#6cf5ff' });
      }
      pendingNearFeedback = true;
    };

    if (phaseRef.current !== 'over' && !(phaseRef.current === 'idle' && reducedMotionRef.current)) {
      const next = [];
      for (const o of g.obstacles) {
        const previous = { x: o.x, y: o.y, angle: o.angle, age: o.age };
        if (o.type === 'laser') {
          o.age += dt;
          if (!o.fired && laserStage(o) === 'active') {
            o.fired = true;
            if (phaseRef.current === 'running') playGameCue(gameAudioRef.current, 'laser');
          }
        } else {
          o.x += o.vx * seconds; o.y += o.vy * seconds; o.angle += o.spin * seconds;
        }
        const distance = hazardDistance(g.orb.x, g.orb.y, o);
        if (phaseRef.current === 'running') {
          if (sweptCollision(g.orb, from, o, previous)) {
            for (let i = 0; i < 12; i += 1) g.sparks.push({ x: g.orb.x, y: g.orb.y, vx: (Math.random() - .5) * 150, vy: (Math.random() - .5) * 150, size: 2 + Math.random() * 4, life: 360, maxLife: 360, color: i % 2 ? '#ff385d' : '#b5fbff' });
            g.score = Math.round(g.elapsed / 1000 * Number(c.SCORE_SURVIVAL_WEIGHT) + g.near * Number(c.SCORE_NEAR_MISS));
            finishGame(g);
            break;
          }
          if (isHazardActive(o) && distance < g.orb.radius + Number(c.NEAR_DISTANCE)) {
            o.wasNear = true;
            o.closestNear = Math.min(o.closestNear ?? Infinity, distance);
          }
          // The sound and label follow the actual close pass, rather than arriving well after it.
          const passedSafely = distance > (o.closestNear ?? Infinity) + 8 && distance > g.orb.radius + 3;
          if (o.wasNear && !o.nearTriggered && (passedSafely || (o.type === 'laser' && laserStage(o) === 'fading'))) awardNearMiss(o);
        }
        const expired = o.type === 'laser' ? o.age >= o.warningMs + o.activeMs + o.fadeMs : o.x < -220 || o.x > w + 220 || o.y > h + 180;
        if (!expired) next.push(o);
      }
      if (phaseRef.current !== 'over') g.obstacles = next;
    }

    if (pendingNearFeedback && phaseRef.current === 'running' && g.elapsed - g.lastNearSoundAt >= 250) {
      g.lastNearSoundAt = g.elapsed;
      playSound('near_miss'); vibrate('light');
    }

    g.sparks.forEach(spark => { spark.x += spark.vx * seconds; spark.y += spark.vy * seconds; spark.life -= dt; });
    g.sparks = g.sparks.filter(spark => spark.life > 0);
    g.orb.pulse = Math.max(0, g.orb.pulse - seconds * 4);
    g.hitFlash = Math.max(0, g.hitFlash - dt);
    if (g.nearNotice) g.nearNotice.life = Math.max(0, g.nearNotice.life - dt);
    for (const point of g.orb.trail) point.age += dt;
    g.orb.trail = g.orb.trail.filter(point => point.age < 240);
    if (phaseRef.current !== 'over' && !reducedMotionRef.current) g.orb.trail.push({ x: g.orb.x, y: g.orb.y, age: 0 });
    if (g.orb.trail.length > 40) g.orb.trail.shift();
    if (phaseRef.current === 'running') {
      g.score = Math.round(g.elapsed / 1000 * Number(c.SCORE_SURVIVAL_WEIGHT) + g.near * Number(c.SCORE_NEAR_MISS));
      if (g.elapsed - g.lastUi > 80) {
        g.lastUi = g.elapsed;
        setLive({ elapsed: g.elapsed, score: g.score });
      }
    }
    drawScene(g.demoElapsed + g.elapsed);
    rafRef.current = requestAnimationFrame(tick);
  }, [syncRunMusic]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  const replay = () => {
    resetGame(false);
    playSound('replay');
    vibrate('light');
  };

  const title = cfg.GAME_TITLE || DEFAULT_CFG.GAME_TITLE;
  const guide = cfg.GUIDE_TEXT || DEFAULT_CFG.GUIDE_TEXT;
  return (
    <main className="app-shell" ref={wrapRef} data-phase={phase}>
      <canvas ref={canvasRef} className="game-canvas" aria-label={`${title}: drag to dodge falling objects and warning lasers`} tabIndex={0}
        onPointerDown={startFromPointer} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={endPointer}
        onLostPointerCapture={endPointer} onKeyDown={keyDown} />
      <div className={`top-copy ${phase !== 'idle' ? 'hidden' : ''}`} aria-hidden={phase !== 'idle'}>
        <p>{guide}</p>
      </div>
      {phase === 'running' && (
        <div className="hud" aria-label="Game stats">
          <span>{(live.elapsed / 1000).toFixed(1)}s</span>
          <span>{live.score}</span>
        </div>
      )}
      {phase === 'over' && result && (
        <section className="result-layer" aria-label="Game over">
          <div className="result-glow" />
          <div className="result-content">
            <div className="result-kicker">SIGNAL LOST</div>
            <h2>{result.score}</h2>
            <div className="result-grid">
              <div><strong>{(result.elapsed / 1000).toFixed(1)}s</strong><small>survival</small></div>
              <div><strong>{result.near}</strong><small>near misses</small></div>
            </div>
            <div className="result-actions">
              <button className="action-button primary" type="button" onClick={replay}>PLAY AGAIN</button>
              <PostMyPlayButton />
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

const styles = `
@font-face {
  font-family: 'Audiowide';
  src: url('./assets/fonts/audiowide/Audiowide-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

:root {
  --font-display: "Audiowide", "PingFang SC", system-ui, sans-serif;
  --font-body:    -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
  --font-mono:    ui-monospace, Menlo, monospace;
}

* { box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
body { background: #05070d; color: #eaffff; -webkit-tap-highlight-color: transparent; }
button { font-family: var(--font-display); }
.app-shell { position: relative; width: 100%; height: 100%; min-height: 0; overflow: clip; background: #05070d; touch-action: none; container-type: size; }
.game-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
.top-copy { position: absolute; z-index: 2; left: 30px; right: 30px; top: 26%; transform: translateY(-50%); text-align: center; pointer-events: none; transition: opacity 260ms ease; }
.top-copy.hidden { opacity: 0; }
h1 { margin: 0; color: #c8fbff; font: 400 clamp(20px, 6cqi, 30px)/1.2 var(--font-display); letter-spacing: .06em; text-shadow: 0 0 22px rgba(30, 229, 255, .55); }
.top-copy p { margin: 0; color: #d5fbff; font: 600 18px/1.4 var(--font-display); letter-spacing: .015em; text-shadow: 0 2px 7px #000, 0 0 18px #08738c; animation: guide-breathe 2.4s ease-in-out infinite; }
.top-copy.hidden p { animation: none; }
@keyframes guide-breathe { 0%,100% { opacity: 1; } 50% { opacity: .66; } }
.game-canvas:focus-visible { outline: 2px solid #6cf5ff88; outline-offset: -5px; }
.hud { position: absolute; z-index: 3; top: 30px; left: 30px; right: 30px; display: flex; gap: 8px; justify-content: space-between; align-items: center; pointer-events: none; color: #d9fbff; font: 400 clamp(20px, 7.18cqi, 28px)/1.2 var(--font-display); font-variant-numeric: tabular-nums; text-shadow: 0 2px 6px #000, 0 0 12px rgba(17, 225, 255, .45); }
.result-layer { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; padding: 30px 30px 50px; background: rgba(3, 5, 12, .68); backdrop-filter: blur(8px); }
.result-content { position: relative; width: min(100%, 390px); padding: 30px 22px 24px; text-align: center; border: 1px solid rgba(83, 226, 245, .34); background: linear-gradient(145deg, rgba(7, 21, 35, .92), rgba(8, 8, 20, .94)); box-shadow: 0 0 60px rgba(0, 210, 255, .12), inset 0 0 30px rgba(0, 200, 235, .04); }
.result-glow { position: absolute; width: 180px; height: 180px; top: 50%; left: 50%; transform: translate(-50%, -58%); border-radius: 50%; background: rgba(255, 25, 71, .1); filter: blur(35px); pointer-events: none; }
.result-kicker { position: relative; color: #ff4b6d; font: 400 clamp(16px, 5cqi, 23px) var(--font-display); letter-spacing: .11em; text-shadow: 0 0 15px rgba(255, 39, 78, .7); }
.result-content h2 { position: relative; margin: 12px 0 24px; color: #e8ffff; font: 400 clamp(48px, 15cqi, 70px)/1 var(--font-display); text-shadow: 0 0 24px rgba(41, 224, 255, .48); }
.result-grid { position: relative; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 25px; }
.result-grid div { min-width: 0; padding: 9px 3px; border-top: 1px solid rgba(84, 222, 240, .24); }
.result-grid strong { display: block; color: #bffaff; font: 400 clamp(18px, 5.6cqi, 24px) var(--font-display); }
.result-grid small { display: block; margin-top: 7px; color: #a5c6cc; font: 400 12px/1.35 var(--font-body); }
.result-actions { position: relative; display: flex; flex-wrap: wrap; justify-content: center; gap: 11px; }
.action-button { min-height: 48px; padding: 10px 16px; border: 1px solid rgba(92, 239, 255, .7); cursor: pointer; letter-spacing: .035em; font-size: 14px; transition: transform 150ms ease, background 150ms ease, opacity 150ms ease; }
.action-button:active { transform: scale(.96); }
.action-button.primary { color: #001419; background: #6cf5ff; box-shadow: 0 0 22px rgba(34, 225, 255, .28); }
.action-button.secondary { color: #c8fbff; background: rgba(12, 56, 70, .55); }
.action-button:disabled { cursor: default; }
@media (max-height: 560px) { .result-content { padding-top: 20px; padding-bottom: 18px; } .result-content h2 { margin: 8px 0 14px; } .result-grid { margin-bottom: 15px; } }
@media (prefers-reduced-motion: reduce) { .top-copy p { animation: none; } .top-copy, .action-button { transition: none; } }
`;

function Root() {
  return <><style>{styles}</style><App /></>;
}

createRoot(document.getElementById('root')).render(<Root />);
