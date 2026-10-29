import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const DEFAULTS = {
  BOARD_INSET: 30,
  PADDLE_WIDTH: 148,
  PADDLE_HEIGHT: 16,
  PADDLE_BOTTOM: 76,
  BALL_RADIUS: 8,
  START_SPEED: 340,
  MAX_SPEED: 720,
  SPEED_STEP: 22,
  GUIDE: 'Drag to keep it bouncing',
  RESULT_TITLE: 'Rally over',
  FINAL_SCORE: 'Final score',
  BEST_SCORE: 'Best',
  PLAY_AGAIN: 'Play again',
};

const SOUND_FILES = {
  // Successful paddle catch: mechanical, clean tick.
  hit: './assets/sfx_tick.mp3',
  // Miss / rally end: descending pixel failure cue.
  miss: './assets/sfx_game_over.mp3',
  // First launch and Play again reset: compact activation confirmation.
  reset: './assets/sfx_reset.mp3',
};

const feedSession = (() => {
  const embedded = window.parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !embedded;
  const listeners = new Set();
  const update = () => {
    document.documentElement.dataset.feedPreview = String(!active);
    for (const listener of listeners) listener(active && !document.hidden);
  };
  window.addEventListener('message', event => {
    if (!embedded || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
    update();
  });
  document.addEventListener('visibilitychange', update);
  update();
  return { get active() { return active && !document.hidden; }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
})();


function readConfig(data) {
  const next = { ...DEFAULTS };
  (data.tweaks || []).forEach((item) => { if (item && item.id in next) next[item.id] = Number(item.value); });
  (data.texts || []).forEach((item) => { if (item && item.id in next) next[item.id] = String(item.value); });
  return next;
}

function vibrate(style) {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style: style || 'light' });
  } catch (error) {
    // Haptics are optional outside the host.
  }
}

function useSound(setLastSound) {
  const audioRef = useRef(null);
  const buffersRef = useRef({});
  const loadingRef = useRef({});

  const ensureAudio = useCallback(() => {
    if (!feedSession.active) return null;
    if (!audioRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      const context = new AudioContextClass();
      const output = context.createGain();
      output.gain.value = 0.22;
      output.connect(context.destination);
      audioRef.current = { context, output, sources: new Set() };
    }
    const audio = audioRef.current;
    if (audio.context.state === 'suspended') audio.context.resume().catch(() => {});
    return audio;
  }, []);

  const fallbackBeep = useCallback((kind) => {
    const audio = ensureAudio();
    if (!audio) return;
    const { context, output, sources } = audio;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const isError = kind === 'miss';
    oscillator.type = isError ? 'square' : 'sine';
    oscillator.frequency.setValueAtTime(isError ? 155 : kind === 'hit' ? 780 : 520, now);
    if (kind === 'hit') oscillator.frequency.exponentialRampToValueAtTime(1120, now + 0.08);
    if (kind === 'reset') oscillator.frequency.exponentialRampToValueAtTime(760, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (isError ? 0.2 : 0.15));
    oscillator.connect(gain);
    gain.connect(output);
    oscillator.start(now);
    oscillator.stop(now + (isError ? 0.21 : 0.16));
    sources.add(oscillator);
    oscillator.addEventListener('ended', () => sources.delete(oscillator));
  }, [ensureAudio]);

  const loadBuffer = useCallback((key, audio) => {
    if (buffersRef.current[key]) return Promise.resolve(buffersRef.current[key]);
    if (loadingRef.current[key]) return loadingRef.current[key];
    const promise = fetch(SOUND_FILES[key])
      .then((response) => { if (!response.ok) throw new Error('sound request failed'); return response.arrayBuffer(); })
      .then((arrayBuffer) => audio.context.decodeAudioData(arrayBuffer))
      .then((buffer) => { buffersRef.current[key] = buffer; return buffer; });
    loadingRef.current[key] = promise;
    return promise;
  }, []);

  const playSound = useCallback((key) => {
    if (!feedSession.active) return;
    const audio = ensureAudio();
    setLastSound(key);
    if (!audio || !SOUND_FILES[key]) return;
    loadBuffer(key, audio).then((buffer) => {
      if (audio.context.state === 'suspended') return audio.context.resume().then(() => buffer);
      return buffer;
    }).then((buffer) => {
      if (!buffer || !feedSession.active) return;
      const source = audio.context.createBufferSource();
      source.buffer = buffer;
      source.connect(audio.output);
      audio.sources.add(source);
      source.addEventListener('ended', () => audio.sources.delete(source));
      source.start();
    }).catch(() => fallbackBeep(key));
  }, [ensureAudio, fallbackBeep, loadBuffer, setLastSound]);

  useEffect(() => () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.sources.forEach((source) => { try { source.stop(); } catch (error) {} });
    audio.sources.clear();
    audio.context.close().catch(() => {});
  }, []);

  return playSound;
}

function useRecordingSubmission(onSound) {
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

  const submitRecording = () => {
    if (submitting || !canSubmit) return;
    onSound();
    setSubmitting(true);
    tt.playableRecordingSubmission({
      success() {},
      fail(error) {
        console.error('[post_my_play] playableRecordingSubmission failed', error && (error.errMsg || error.message));
        setSubmitting(false);
      },
      complete() {},
    });
  };

  return { canSubmit, submitting, submitRecording };
}

function PostMyPlayButton({ label, onSound }) {
  const { canSubmit, submitting, submitRecording } = useRecordingSubmission(onSound);
  if (!canSubmit) return null;
  return <button type="button" className="resultButton secondary" disabled={submitting} onClick={submitRecording}>{submitting ? '…' : label}</button>;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function App() {
  const [cfg, setCfg] = useState(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [score, setScore] = useState(0);
  const [lastSound, setLastSound] = useState('');
  const canvasRef = useRef(null);
  const boardRef = useRef({ width: 0, height: 0, dpr: 1 });
  const gameRef = useRef({
    active: false,
    score: 0,
    paddleX: 0,
    dragging: false,
    pulse: 0,
    ball: { x: 0, y: 0, vx: 0, vy: 0, trail: [] },
  });
  const playSound = useSound(setLastSound);

  useEffect(() => {
    let mounted = true;
    fetch('./game.config.json')
      .then((response) => response.ok ? response.json() : {})
      .then((data) => { if (mounted) setCfg(readConfig(data || {})); })
      .catch(() => {})
      .finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, []);

  const pointFromEvent = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    return event.clientX - rect.left;
  }, []);

  const setPaddleFromX = useCallback((x) => {
    const width = boardRef.current.width;
    if (!width) return;
    const half = cfg.PADDLE_WIDTH / 2;
    const left = cfg.BOARD_INSET + half;
    const right = width - cfg.BOARD_INSET - half;
    gameRef.current.paddleX = Math.max(left, Math.min(right, x));
  }, [cfg.BOARD_INSET, cfg.PADDLE_WIDTH]);

  const startRound = useCallback((initialX) => {
    const board = boardRef.current;
    if (!board.width || !board.height) return;
    const game = gameRef.current;
    setPaddleFromX(initialX);
    game.active = true;
    game.score = 0;
    game.pulse = 0;
    game.ball = {
      x: game.paddleX,
      y: Math.max(92, board.height * 0.19),
      // Scale both velocity components so the quicker serve keeps its familiar angle.
      vx: cfg.START_SPEED * (32 / 222),
      vy: cfg.START_SPEED,
      trail: [],
    };
    setScore(0);
    setPhase('playing');
    playSound('reset');
    vibrate('light');
    console.log('[paddle-survival] rally started', { width: Math.round(board.width), height: Math.round(board.height) });
  }, [cfg.START_SPEED, playSound, setPaddleFromX]);

  const resetRound = useCallback(() => {
    const game = gameRef.current;
    game.active = false;
    game.score = 0;
    game.pulse = 0;
    game.dragging = false;
    game.paddleX = boardRef.current.width / 2;
    game.ball = { x: game.paddleX, y: Math.max(92, boardRef.current.height * .19), vx: 0, vy: 0, trail: [] };
    setScore(0);
    setPhase('idle');
    playSound('reset');
    vibrate('light');
    console.log('[paddle-survival] rally reset');
  }, [playSound]);

  const handlePointerDown = useCallback((event) => {
    if (event.pointerType !== 'mouse' && event.isPrimary === false) return;
    if (!ready || !feedSession.active || phase === 'over') return;
    const x = pointFromEvent(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gameRef.current.dragging = true;
    setPaddleFromX(x);
    if (!gameRef.current.active) startRound(x);
  }, [phase, pointFromEvent, ready, setPaddleFromX, startRound]);

  const handlePointerMove = useCallback((event) => {
    if (!feedSession.active || !gameRef.current.dragging || (event.pointerType !== 'mouse' && event.isPrimary === false)) return;
    setPaddleFromX(pointFromEvent(event));
  }, [pointFromEvent, setPaddleFromX]);

  const stopDragging = useCallback((event) => {
    if (event.pointerType !== 'mouse' && event.isPrimary === false) return;
    gameRef.current.dragging = false;
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    let frame = 0;
    let lastTime = performance.now();
    let resizeObserver;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      boardRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      if (!gameRef.current.paddleX) gameRef.current.paddleX = rect.width / 2;
    };
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }

    const draw = (time) => {
      const board = boardRef.current;
      const game = gameRef.current;
      const width = board.width;
      const height = board.height;
      const dpr = board.dpr;
      const dtMs = Math.min(Math.max(time - lastTime, 0), 32);
      lastTime = time;
      const dt = dtMs / 1000;
      const courtLeft = cfg.BOARD_INSET;
      const courtRight = width - cfg.BOARD_INSET;
      const courtTop = 98;
      const courtBottom = height - 50;
      const paddleY = height - cfg.PADDLE_BOTTOM;
      const radius = cfg.BALL_RADIUS;

      if (game.active && feedSession.active) {
        const steps = Math.max(1, Math.min(4, Math.ceil(dtMs / 8)));
        const stepDt = dt / steps;
        for (let step = 0; step < steps && game.active; step += 1) {
          const ball = game.ball;
          const oldY = ball.y;
          ball.x += ball.vx * stepDt;
          ball.y += ball.vy * stepDt;
          if (ball.x - radius <= courtLeft) { ball.x = courtLeft + radius; ball.vx = Math.abs(ball.vx); }
          if (ball.x + radius >= courtRight) { ball.x = courtRight - radius; ball.vx = -Math.abs(ball.vx); }
          if (ball.y - radius <= courtTop) { ball.y = courtTop + radius; ball.vy = Math.abs(ball.vy); }

          const crossedPaddle = ball.vy > 0 && oldY + radius <= paddleY + 2 && ball.y + radius >= paddleY;
          const withinPaddle = Math.abs(ball.x - game.paddleX) <= cfg.PADDLE_WIDTH / 2 + radius;
          if (crossedPaddle && withinPaddle) {
            ball.y = paddleY - radius - 0.2;
            const offset = Math.max(-1, Math.min(1, (ball.x - game.paddleX) / (cfg.PADDLE_WIDTH / 2)));
            game.score += 1;
            const nextSpeed = Math.min(cfg.MAX_SPEED, Math.hypot(ball.vx, ball.vy) + cfg.SPEED_STEP);
            const horizontalRatio = Math.max(-0.72, Math.min(0.72, offset * 0.9));
            ball.vx = nextSpeed * horizontalRatio;
            ball.vy = -Math.sqrt(Math.max(1, nextSpeed * nextSpeed - ball.vx * ball.vx));
            game.pulse = 1;
            setScore(game.score);
            playSound('hit');
            vibrate('medium');
            console.log('[paddle-survival] clean catch', { score: game.score, speed: Math.round(nextSpeed) });
          }
          if (ball.y - radius > height + 12) {
            game.active = false;
            game.score = Math.max(0, game.score);
            setPhase('over');
            setScore(game.score);
            playSound('miss');
            vibrate('notification_error');
            console.log('[paddle-survival] rally ended', { score: game.score });
          }
          ball.trail.push({ x: ball.x, y: ball.y });
          if (ball.trail.length > 8) ball.trail.shift();
        }
        game.pulse = Math.max(0, game.pulse - dt * 5.5);
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.lineWidth = 1.5;
      context.strokeStyle = 'rgba(46, 43, 39, 0.14)';
      roundedRect(context, courtLeft, courtTop, courtRight - courtLeft, courtBottom - courtTop, 14);
      context.stroke();
      context.strokeStyle = 'rgba(46, 43, 39, 0.08)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(courtLeft + 20, courtBottom - 14);
      context.lineTo(courtRight - 20, courtBottom - 14);
      context.stroke();

      const paddleX = game.paddleX || width / 2;
      context.save();
      context.shadowColor = 'rgba(38, 35, 31, 0.15)';
      context.shadowBlur = 12;
      context.shadowOffsetY = 5;
      context.fillStyle = '#292724';
      roundedRect(context, paddleX - cfg.PADDLE_WIDTH / 2, paddleY, cfg.PADDLE_WIDTH, cfg.PADDLE_HEIGHT, cfg.PADDLE_HEIGHT / 2);
      context.fill();
      context.restore();

      if (game.pulse > 0) {
        context.save();
        context.strokeStyle = `rgba(185, 121, 78, ${game.pulse * 0.48})`;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(paddleX, paddleY + cfg.PADDLE_HEIGHT / 2, 18 + (1 - game.pulse) * 18, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }

      let ballX = game.ball.x || width / 2;
      let ballY = game.ball.y || Math.max(92, height * 0.19);
      if (!game.active) ballY += Math.sin(time / 420) * 3;
      const trail = game.ball.trail || [];
      trail.forEach((point, index) => {
        const alpha = ((index + 1) / trail.length) * 0.13;
        context.fillStyle = `rgba(35, 33, 31, ${alpha})`;
        context.beginPath();
        context.arc(point.x, point.y, Math.max(2, radius * (index + 1) / trail.length * 0.8), 0, Math.PI * 2);
        context.fill();
      });
      context.save();
      context.shadowColor = 'rgba(31, 28, 25, 0.2)';
      context.shadowBlur = 10;
      context.shadowOffsetY = 4;
      context.fillStyle = '#242220';
      context.beginPath();
      context.arc(ballX, ballY, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener('resize', resize);
    };
  }, [cfg, playSound, ready]);

  return (
    <main className="app" data-phase={phase} data-score={score} data-last-sound={lastSound}>
      <style>{`
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
body { background: #f4ede3; -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
.app { position: relative; width: 100%; height: 100%; overflow: clip; background: #f4ede3; color: #292724; user-select: none; touch-action: none; }
.gameCanvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
.hud { position: absolute; z-index: 2; top: max(18px, env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 14px; color: #292724; font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: 0.03em; pointer-events: none; }
.hudDot { width: 4px; height: 4px; border-radius: 50%; background: #b9794e; }
.hint { position: absolute; z-index: 2; top: 30%; left: 50%; transform: translate(-50%, -50%); width: max-content; max-width: calc(100% - 48px); color: rgba(41, 39, 36, 0.72); font-family: var(--font-body); font-size: 17px; font-weight: 700; text-align: center; letter-spacing: -0.02em; animation: breathe 2.4s ease-in-out infinite; pointer-events: none; }
.resultOverlay { position: absolute; inset: 0; z-index: 4; display: flex; align-items: center; justify-content: center; padding: 28px; background: rgba(244, 237, 227, 0.94); }
.resultContent { width: min(100%, 330px); text-align: center; }
.resultTitle { margin: 0 0 28px; font-family: var(--font-display); font-size: 24px; line-height: 1.2; font-weight: 700; letter-spacing: -0.04em; }
.resultStats { display: flex; justify-content: center; gap: 34px; margin-bottom: 34px; }
.stat { display: grid; gap: 5px; min-width: 86px; }
.statLabel { color: rgba(41, 39, 36, 0.54); font-family: var(--font-body); font-size: 12px; font-weight: 400; }
.statValue { color: #292724; font-family: var(--font-display); font-size: 34px; line-height: 1; font-weight: 700; }
.resultActions { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; }
.resultButton { min-height: 52px; padding: 0 25px; border: 0; border-radius: 999px; color: #f8f1e8; background: #292724; box-shadow: 0 9px 18px rgba(41, 39, 36, 0.14); font-family: var(--font-display); font-size: 16px; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.resultButton.secondary { color: #292724; background: transparent; border: 1px solid rgba(41, 39, 36, 0.25); box-shadow: none; }
.resultButton:disabled { opacity: 0.55; cursor: default; }
@keyframes breathe { 0%, 100% { opacity: 0.56; transform: translate(-50%, -50%) translateY(0); } 50% { opacity: 0.92; transform: translate(-50%, -50%) translateY(-4px); } }

.hud { top:30px; left:30px; right:30px; transform:none; justify-content:center; gap:20px; font-size:28px; line-height:1; letter-spacing:0; }
.hudStat { display:grid; gap:5px; text-align:center; }
.hudStat:last-child { text-align:center; }
.hudStat strong { font-size:28px; line-height:1.15; }
.hudStat small { font-size:11px; font-weight:400; line-height:1.3; opacity:.65; }
.hint { top:32%; max-width:calc(100% - 60px); color:#3d3831; font-size:18px; line-height:1.35; letter-spacing:0; }
.resultOverlay { padding:30px 30px 50px; }
.resultButton { min-height:48px; font-size:16px; }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }

      `}</style>
      <canvas
        ref={canvasRef}
        className="gameCanvas"
        aria-label="Paddle survival game"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onLostPointerCapture={stopDragging}
      />
      {phase === 'playing' && <div className="hud" aria-label={`Score ${score}`}><span className="hudStat"><strong>{score}</strong><small>Score</small></span></div>}
      {phase === 'idle' && ready && <div className="hint" data-testid="hint">{cfg.GUIDE}</div>}
      {phase === 'over' && (
        <section className="resultOverlay" aria-label="Rally result">
          <div className="resultContent">
            <h1 className="resultTitle">{cfg.RESULT_TITLE}</h1>
            <div className="resultStats">
              <div className="stat"><span className="statLabel">{cfg.FINAL_SCORE}</span><strong className="statValue">{score}</strong></div>
            </div>
            <div className="resultActions">
              <button type="button" className="resultButton" onClick={resetRound}>{cfg.PLAY_AGAIN}</button>
              <PostMyPlayButton label="Post my play" onSound={() => playSound('reset')} />
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
