import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// Play again confirmation: arcade-cabinet plastic button press from the selected library cue.
const PINGPONG_CLICK = './assets/sfx_pingpong_click.mp3';
// Match result: compact celebratory victory fanfare from the selected library cue.
const RESULT_CHIME = './assets/sfx_result_chime.mp3';

const fallbackConfig = {
  MATCH_POINTS: 5,
  BALL_SPEED: 0.38,
  AI_SPEED: 0.24,
  PADDLE_WIDTH: 86,
  BALL_SIZE: 16,
  SCORE_PAUSE_MS: 650,
  GUIDE_TEXT: '2 players · Drag your half',
  YOU_WIN: 'Red wins',
  YOU_LOSE: 'Blue wins',
  FINAL_SCORE: 'Final score',
  PLAY_AGAIN: 'Play again',
};

const audioState = {
  context: null,
  gain: null,
  buffers: new Map(),
  pending: new Map(),
};

const feedSession = (() => {
  const embedded = parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !embedded;
  window.addEventListener('message', event => {
    if (embedded && event.source === parent && event.origin === location.origin && event.data?.type === 'playable-active') active = event.data.active === true;
  });
  return { get active() { return active && !document.hidden; } };
})();

function unlockAudio() {
  if (!feedSession.active) return null;
  try {
    if (!audioState.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      audioState.context = new AudioContextClass();
      audioState.gain = audioState.context.createGain();
      audioState.gain.gain.value = 0.18;
      audioState.gain.connect(audioState.context.destination);
    }
    if (audioState.context.state === 'suspended') audioState.context.resume();
    return audioState.context;
  } catch (error) {
    return null;
  }
}

function playFile(path) {
  const context = unlockAudio();
  if (!context || !audioState.gain) return;
  let loadPromise = audioState.pending.get(path);
  if (!loadPromise) {
    loadPromise = fetch(path)
      .then((response) => {
        if (!response.ok) throw new Error('sound fetch failed');
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => context.decodeAudioData(arrayBuffer))
      .then((buffer) => {
        audioState.buffers.set(path, buffer);
        return buffer;
      })
      .catch(() => null);
    audioState.pending.set(path, loadPromise);
  }
  loadPromise.then((buffer) => {
    if (!buffer || !audioState.context || audioState.context.state !== 'running' || !feedSession.active) return;
    try {
      const source = audioState.context.createBufferSource();
      source.buffer = buffer;
      source.connect(audioState.gain);
      source.start();
    } catch (error) {
      // Audio is feedback only; gameplay continues if decoding or playback is unavailable.
    }
  });
}

function playBeep(kind) {
  const context = unlockAudio();
  if (!context || !audioState.gain) return;
  const now = context.currentTime;
  const sequence = kind === 'score' ? [440, 660] : kind === 'serve' ? [520, 760] : [880];
  const spacing = kind === 'score' ? 0.075 : 0;
  sequence.forEach((frequency, index) => {
    try {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = kind === 'hit' ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, now + index * spacing);
      envelope.gain.setValueAtTime(0.0001, now + index * spacing);
      envelope.gain.exponentialRampToValueAtTime(0.11, now + index * spacing + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + index * spacing + 0.075);
      oscillator.connect(envelope);
      envelope.connect(audioState.gain);
      oscillator.start(now + index * spacing);
      oscillator.stop(now + index * spacing + 0.08);
    } catch (error) {
      // Native Web Audio is an optional enhancement.
    }
  });
}

function vibrate(style) {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style: style || 'light' });
  } catch (error) {
    // Haptics are not available in a regular browser.
  }
}

function useRecordingSubmission() {
  const canSubmit = typeof tt !== 'undefined' && typeof tt.playableRecordingSubmission === 'function';
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const restore = () => setSubmitting(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') restore();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', restore);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', restore);
    };
  }, []);

  const submitRecording = () => {
    if (submitting || !canSubmit) return;
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

function PostMyPlayButton({ text }) {
  const { canSubmit, submitting, submitRecording } = useRecordingSubmission();
  if (!canSubmit) return null;
  return (
    <button className="result-button secondary" type="button" disabled={submitting} onClick={() => {
      unlockAudio();
      playBeep('serve');
      submitRecording();
    }}>
      {submitting ? '...' : 'Post my play'}
    </button>
  );
}

function App() {
  const [cfg, setCfg] = useState(fallbackConfig);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [guideVisible, setGuideVisible] = useState(true);
  const [score, setScore] = useState([0, 0]);
  const [gameOver, setGameOver] = useState(false);
  const [result, setResult] = useState('');
  const [roundPulse, setRoundPulse] = useState(false);
  const courtRef = useRef(null);
  const frameRef = useRef(0);
  const roundTimerRef = useRef(0);
  const lastTimeRef = useRef(0);
  const activeRef = useRef(false);
  const gameOverRef = useRef(false);
  const startedRef = useRef(false);
  const scoreRef = useRef([0, 0]);
  const paddleRef = useRef({ red: 50, blue: 50 });
  const ballRef = useRef({ x: 50, y: 50, vx: 0, vy: 0 });
  const dragsRef = useRef(new Map());
  const redPaddleEl = useRef(null);
  const bluePaddleEl = useRef(null);
  const ballEl = useRef(null);

  useEffect(() => {
    let mounted = true;
    fetch('./game.config.json')
      .then((response) => response.ok ? response.json() : {})
      .then((raw) => {
        if (!mounted) return;
        const next = { ...fallbackConfig };
        [...(raw.tweaks || []), ...(raw.texts || [])].forEach((item) => {
          next[item.id] = item.value;
        });
        setCfg(next);
        setReady(true);
      })
      .catch(() => {
        if (mounted) setReady(true);
      });
    return () => { mounted = false; };
  }, []);

  const applyPositions = useCallback(() => {
    const ball = ballRef.current;
    const paddle = paddleRef.current;
    if (redPaddleEl.current) redPaddleEl.current.style.left = `${paddle.red}%`;
    if (bluePaddleEl.current) bluePaddleEl.current.style.left = `${paddle.blue}%`;
    if (ballEl.current) {
      ballEl.current.style.left = `${ball.x}%`;
      ballEl.current.style.top = `${ball.y}%`;
    }
  }, []);

  const resetObjects = useCallback((resetPaddles = true) => {
    if (resetPaddles) paddleRef.current = { red: 50, blue: 50 };
    ballRef.current = { x: 50, y: 50, vx: 0, vy: 0 };
    applyPositions();
  }, [applyPositions]);

  const startBall = useCallback(() => {
    const direction = Math.random() > 0.5 ? 1 : -1;
    const vertical = Math.random() > 0.5 ? 1 : -1;
    ballRef.current = { x: 50, y: 50, vx: direction * cfg.BALL_SPEED * 0.42, vy: vertical * cfg.BALL_SPEED };
    activeRef.current = true;
    applyPositions();
  }, [applyPositions, cfg.BALL_SPEED]);

  const finishMatch = useCallback((playerWon) => {
    activeRef.current = false;
    gameOverRef.current = true;
    dragsRef.current.clear();
    setGameOver(true);
    setResult(playerWon ? cfg.YOU_WIN : cfg.YOU_LOSE);
    playFile(RESULT_CHIME);
    vibrate('notification_success');
    console.log('[table-tennis] match finished', { playerWon, score: scoreRef.current });
  }, [cfg.YOU_LOSE, cfg.YOU_WIN]);

  const registerPoint = useCallback((playerWon) => {
    if (gameOverRef.current || !activeRef.current) return;
    activeRef.current = false;
    const nextScore = [...scoreRef.current];
    nextScore[playerWon ? 0 : 1] += 1;
    scoreRef.current = nextScore;
    setScore(nextScore);
    setRoundPulse(true);
    window.setTimeout(() => setRoundPulse(false), 220);
    playBeep('score');
    vibrate('medium');
    // Preserve both players' held positions between points.
    resetObjects(false);
    console.log('[table-tennis] point', { playerWon, score: nextScore });
    if (nextScore[0] >= cfg.MATCH_POINTS || nextScore[1] >= cfg.MATCH_POINTS) {
      finishMatch(nextScore[0] >= cfg.MATCH_POINTS);
      return;
    }
    roundTimerRef.current = window.setTimeout(() => {
      if (!gameOverRef.current) startBall();
    }, cfg.SCORE_PAUSE_MS);
  }, [cfg.MATCH_POINTS, cfg.SCORE_PAUSE_MS, finishMatch, resetObjects, startBall]);

  const tick = useCallback((time) => {
    const elapsed = lastTimeRef.current ? Math.min(time - lastTimeRef.current, 32) : 16;
    lastTimeRef.current = time;
    if (activeRef.current && !gameOverRef.current && feedSession.active && courtRef.current) {
      const court = courtRef.current;
      const width = court.clientWidth;
      const height = court.clientHeight;
      const ball = ballRef.current;
      const paddles = paddleRef.current;
      const ballRadius = cfg.BALL_SIZE / 2;
      const paddleHalf = cfg.PADDLE_WIDTH / 2;
      const redY = height * 0.88;
      const blueY = height * 0.12;
      const px = (ball.x / 100) * width;
      const py = (ball.y / 100) * height;
      let nextX = px + ball.vx * elapsed;
      let nextY = py + ball.vy * elapsed;
      const wallLeft = ballRadius;
      const wallRight = width - ballRadius;
      if (nextX <= wallLeft || nextX >= wallRight) {
        nextX = Math.max(wallLeft, Math.min(wallRight, nextX));
        ball.vx *= -1;
        playBeep('hit');
      }

      const redX = (paddles.red / 100) * width;
      const blueX = (paddles.blue / 100) * width;
      const paddleHeight = 14;
      const hitRed = ball.vy > 0 && nextY + ballRadius >= redY - paddleHeight / 2 && nextY - ballRadius <= redY + paddleHeight / 2 && Math.abs(nextX - redX) <= paddleHalf + ballRadius;
      const hitBlue = ball.vy < 0 && nextY - ballRadius <= blueY + paddleHeight / 2 && nextY + ballRadius >= blueY - paddleHeight / 2 && Math.abs(nextX - blueX) <= paddleHalf + ballRadius;
      if (hitRed) {
        nextY = redY - paddleHeight / 2 - ballRadius;
        ball.vy = -Math.abs(ball.vy) * 1.015;
        ball.vx += ((nextX - redX) / paddleHalf) * 0.045;
        playBeep('hit');
        vibrate('light');
      } else if (hitBlue) {
        nextY = blueY + paddleHeight / 2 + ballRadius;
        ball.vy = Math.abs(ball.vy) * 1.015;
        ball.vx += ((nextX - blueX) / paddleHalf) * 0.045;
        playBeep('hit');
      }
      const maxSpeed = cfg.BALL_SPEED * 1.35;
      ball.vx = Math.max(-maxSpeed, Math.min(maxSpeed, ball.vx));
      ball.x = (nextX / width) * 100;
      ball.y = (nextY / height) * 100;
      if (nextY < -ballRadius) {
        registerPoint(true);
      } else if (nextY > height + ballRadius) {
        registerPoint(false);
      }
    }
    applyPositions();
    frameRef.current = window.requestAnimationFrame(tick);
  }, [applyPositions, cfg.BALL_SIZE, cfg.BALL_SPEED, cfg.PADDLE_WIDTH, registerPoint]);

  useEffect(() => {
    if (!ready) return undefined;
    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameRef.current);
      window.clearTimeout(roundTimerRef.current);
    };
  }, [ready, tick]);

  const movePaddle = useCallback((side, clientX) => {
    const court = courtRef.current;
    if (!court) return;
    const bounds = court.getBoundingClientRect();
    const paddleHalf = cfg.PADDLE_WIDTH / 2;
    const x = Math.max(paddleHalf, Math.min(Math.max(paddleHalf, bounds.width - paddleHalf), clientX - bounds.left));
    paddleRef.current[side] = (x / bounds.width) * 100;
    applyPositions();
  }, [applyPositions, cfg.PADDLE_WIDTH]);

  const beginInteraction = useCallback((event) => {
    if (!ready || !feedSession.active || gameOverRef.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const bounds = courtRef.current.getBoundingClientRect();
    const side = event.clientY < bounds.top + bounds.height / 2 ? 'blue' : 'red';
    // Each finger owns its original half until release, even across the net.
    if ([...dragsRef.current.values()].some(drag => drag.side === side)) return;
    event.preventDefault();
    unlockAudio();
    dragsRef.current.set(event.pointerId, { side, startX: event.clientX, moved: false });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
    movePaddle(side, event.clientX);
  }, [ready, movePaddle]);

  const moveInteraction = useCallback((event) => {
    const drag = dragsRef.current.get(event.pointerId);
    if (!drag || !feedSession.active || gameOverRef.current) return;
    event.preventDefault();
    if (drag.moved || Math.abs(event.clientX - drag.startX) > 3) {
      drag.moved = true;
      if (!startedRef.current) {
        startedRef.current = true;
        setStarted(true);
        setGuideVisible(false);
        startBall();
        playBeep('serve');
      }
      movePaddle(drag.side, event.clientX);
    }
  }, [movePaddle, startBall]);

  const endInteraction = useCallback((event) => {
    dragsRef.current.delete(event.pointerId);
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch (error) { /* optional */ }
  }, []);

  useEffect(() => {
    const clearTouches = () => dragsRef.current.clear();
    window.addEventListener('blur', clearTouches);
    document.addEventListener('visibilitychange', clearTouches);
    return () => {
      window.removeEventListener('blur', clearTouches);
      document.removeEventListener('visibilitychange', clearTouches);
    };
  }, []);

  const restart = useCallback(() => {
    unlockAudio();
    playFile(PINGPONG_CLICK);
    window.clearTimeout(roundTimerRef.current);
    activeRef.current = false;
    gameOverRef.current = false;
    startedRef.current = false;
    dragsRef.current.clear();
    scoreRef.current = [0, 0];
    setScore([0, 0]);
    setGameOver(false);
    setResult('');
    setStarted(false);
    setGuideVisible(true);
    resetObjects();
    console.log('[table-tennis] replay');
  }, [resetObjects]);

  useEffect(() => () => {
    if (audioState.context && audioState.context.state !== 'closed') {
      audioState.context.close().catch(() => {});
    }
  }, []);

  return (
    <main className="game-root">
      <section
        ref={courtRef}
        className={`court ${started ? 'is-playing' : 'is-ready'} ${roundPulse ? 'point-pulse' : ''}`}
        data-testid="court"
        aria-label="Two-player Pong court. Blue controls the upper half; red controls the lower half."
        onPointerDown={beginInteraction}
        onPointerMove={moveInteraction}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
        onLostPointerCapture={endInteraction}
      >
        <div className="court-line court-line-vertical" />
        <div className="court-line court-line-horizontal" />
        <div className="net" aria-hidden="true" />
        <div ref={bluePaddleEl} className="paddle paddle-blue" style={{ width: cfg.PADDLE_WIDTH }} aria-label="Blue player paddle" />
        <div ref={redPaddleEl} className="paddle paddle-red" style={{ width: cfg.PADDLE_WIDTH }} aria-label="Red player paddle" />
        <div ref={ballEl} className="ball" style={{ width: cfg.BALL_SIZE, height: cfg.BALL_SIZE }} aria-label="Ball" />
        {guideVisible && !gameOver && <div className="guide">{cfg.GUIDE_TEXT}</div>}
        {started && !gameOver && (
          <div className="scoreboard" aria-label={`Blue ${score[1]}, Red ${score[0]}`}>
            <span className="score-blue"><i />{score[1]}</span><b aria-hidden="true">—</b><span className="score-red"><i />{score[0]}</span>
          </div>
        )}
        {gameOver && (
          <div className="result-overlay" data-testid="result-overlay">
            <div className="result-card">
              <div className={`result-mark ${score[0] >= cfg.MATCH_POINTS ? 'red' : 'blue'}`} />
              <h1>{result}</h1>
              <p>{cfg.FINAL_SCORE}</p>
              <strong data-testid="final-score"><span className="score-blue">{score[1]}</span> — <span className="score-red">{score[0]}</span></strong>
              <div className="result-actions">
                <button className="result-button" type="button" onClick={restart}>{cfg.PLAY_AGAIN}</button>
                <PostMyPlayButton text={cfg.PLAY_AGAIN} />
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

const styles = `
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
body { background: #082c24; -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
.game-root { width: 100%; height: 100%; overflow: clip; display: flex; justify-content: center; background: #082c24; }
.court { position: relative; width: min(100%, 520px); height: 100%; overflow: hidden; touch-action: none; user-select: none; background: #2e8a62; border: 1px solid rgba(229, 249, 231, .48); box-shadow: inset 0 0 0 7px rgba(15, 87, 58, .14), inset 0 0 80px rgba(9, 61, 43, .18); }
.court::before { content: ''; position: absolute; inset: 8px; border: 1px solid rgba(236, 255, 235, .45); pointer-events: none; }
.court::after { content: ''; position: absolute; left: 8px; right: 8px; top: 50%; height: 1px; background: rgba(238, 255, 237, .36); pointer-events: none; }
.court-line-vertical { position: absolute; top: 8px; bottom: 8px; left: 50%; width: 1px; background: rgba(231, 255, 234, .16); }
.court-line-horizontal { display: none; }
.net { position: absolute; left: 8px; right: 8px; top: 50%; height: 2px; transform: translateY(-1px); background: rgba(237, 255, 235, .48); opacity: .38; }
.paddle { position: absolute; z-index: 3; width: 86px; height: 14px; border-radius: 999px; transform: translate(-50%, -50%); }
.paddle-red { left: 50%; top: 88%; background: #f0444f; box-shadow: 0 5px 0 rgba(117, 26, 40, .25), 0 0 20px rgba(255, 75, 83, .2); }
.paddle-blue { left: 50%; top: 12%; background: #2779e8; box-shadow: 0 5px 0 rgba(17, 43, 111, .24), 0 0 20px rgba(52, 128, 255, .18); }
.ball { position: absolute; z-index: 4; left: 50%; top: 50%; width: 16px; height: 16px; transform: translate(-50%, -50%); border-radius: 50%; background: #fffef0; border: 2px solid rgba(255, 255, 255, .82); box-shadow: 2px 3px 0 rgba(13, 74, 51, .22), 0 0 12px rgba(255, 255, 220, .36); }
.guide { position: absolute; z-index: 6; left: 20px; right: 20px; top: 34%; text-align: center; color: #f1fff0; font: 700 18px/1.2 var(--font-body); letter-spacing: .01em; text-shadow: 0 2px 8px rgba(7, 59, 39, .22); animation: breathe 1.8s ease-in-out infinite; }
.scoreboard { position: absolute; z-index: 7; top: calc(12% + 24px); left: 50%; transform: translateX(-50%); display: flex; flex-direction: row; writing-mode: horizontal-tb; pointer-events: none; align-items: center; gap: 13px; min-width: 76px; justify-content: center; color: #f3fff0; font: 700 28px/1 var(--font-display); text-shadow: 0 2px 6px rgba(6, 67, 40, .32); }
.scoreboard span { display: inline-flex; align-items: center; gap: 7px; writing-mode: horizontal-tb; transform: none; font-variant-numeric: tabular-nums; }
.scoreboard b { font-size: 18px; font-weight: 400; opacity: .65; }
.scoreboard i { display: block; width: 9px; height: 9px; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255,255,255,.7); }
.score-blue i, .result-mark.blue { background: #2779e8; }
.score-red i, .result-mark.red { background: #f0444f; }
.guide, .net, .court-line, .paddle, .ball { pointer-events: none; }
.point-pulse::before { animation: flash .22s ease-out; }
.result-overlay { position: absolute; z-index: 10; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(7, 48, 35, .38); }
.result-card { width: min(84%, 330px); padding: 28px 22px 24px; text-align: center; color: #f3fff0; border: 1px solid rgba(235, 255, 236, .56); border-radius: 22px; background: rgba(16, 88, 59, .92); box-shadow: 0 18px 50px rgba(4, 37, 27, .3); }
.result-mark { width: 12px; height: 12px; margin: 0 auto 14px; border-radius: 50%; background: #f0444f; box-shadow: 0 0 0 7px rgba(240, 68, 79, .13); }
.result-mark.blue { box-shadow: 0 0 0 7px rgba(39, 121, 232, .15); }
.result-card h1 { margin: 0; font: 700 24px/1.2 var(--font-display); }
.result-card p { margin: 17px 0 4px; color: rgba(236, 255, 234, .72); font: 400 14px/1.3 var(--font-body); }
.result-card strong { display: block; font: 700 28px/1.15 var(--font-display); letter-spacing: .03em; writing-mode: horizontal-tb; }
.result-actions { display: flex; justify-content: center; gap: 10px; margin-top: 24px; }
.result-button { min-width: 130px; min-height: 46px; padding: 10px 18px; border: 0; border-radius: 999px; color: #145339; background: #f4ffe9; font: 700 15px/1 var(--font-display); box-shadow: 0 5px 0 rgba(6, 58, 38, .25); cursor: pointer; }
.result-button:active { transform: translateY(2px); box-shadow: 0 3px 0 rgba(6, 58, 38, .25); }
.result-button.secondary { min-width: 46px; padding: 10px 13px; color: #f4ffe9; background: transparent; border: 1px solid rgba(244, 255, 233, .62); box-shadow: none; }
.result-button:disabled { opacity: .55; cursor: default; }
@keyframes breathe { 0%, 100% { opacity: .58; transform: scale(.985); } 50% { opacity: 1; transform: scale(1); } }
@keyframes flash { 0% { box-shadow: inset 0 0 0 7px rgba(255, 255, 220, .3); } 100% { box-shadow: inset 0 0 0 7px rgba(15, 87, 58, .14); } }
@media (max-height: 560px) { .guide { top: 29%; font-size: 16px; } .result-card { padding: 20px 18px; } .result-actions { margin-top: 16px; } }
.court { container-type:size; }
.scoreboard { top:50%; left:44px; right:auto; transform:translate(-50%,-50%) rotate(90deg); gap:12px; font-size:28px; }
.guide { top:32%; left:50%; right:auto; width:max-content; max-width:calc(100% - 60px); color:#f1fff0; font-size:18px; line-height:1.35; transform:translate(-50%,-50%); animation:sidewaysBreathe 1.8s ease-in-out infinite; }
@keyframes sidewaysBreathe { 0%,100% { opacity:.6; } 50% { opacity:1; } }
.result-overlay { padding:0; }
.result-card { flex:0 0 auto; width:min(320px,calc(100cqh - 100px)); max-width:none; padding:24px 22px; transform:rotate(90deg); }
.result-card h1 { font-size:24px; }
.result-card p { margin-top:14px; }
.result-actions { margin-top:20px; flex-wrap:wrap; }
.result-button { min-height:46px; font-size:16px; }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }

`;

function Root() {
  return <><style>{styles}</style><App /></>;
}

createRoot(document.getElementById('root')).render(<Root />);
