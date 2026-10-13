(()=>{
  'use strict';

  const flattenConfig = raw => {
    const out = {};
    for (const section of ['tweaks', 'texts', 'images']) {
      for (const item of raw[section] || []) out[item.id] = item.value ?? item.path;
    }
    return out;
  };

  const loadConfig = async () => {
    try {
      const response = await fetch('./game.config.json', { cache: 'no-store' });
      if (response.ok) return flattenConfig(await response.json());
    } catch (_) {}
    const inline = document.getElementById('playable-config-inline');
    return inline ? flattenConfig(JSON.parse(inline.textContent)) : {};
  };

  const start = async () => {
    const cfg = await loadConfig();
    const root = document.getElementById('root');
    const style = document.createElement('style');
    style.textContent = `
      :root {
        --ui-unit: min(0.2564102564vw, 0.1672240803vh);
        color-scheme: dark;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --green: #28d66f;
        --yellow: #ffd10a;
      }
      * { box-sizing: border-box; }
      html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { background: #08080d; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
      button { font: inherit; -webkit-tap-highlight-color: transparent; }
      .game {
        position: relative; width: 100%; height: 100%; overflow: hidden;
        display: flex; flex-direction: column; align-items: center;
        gap: calc(12 * var(--ui-unit));
        padding: calc(30 * var(--ui-unit) + env(safe-area-inset-top))
          calc(30 * var(--ui-unit) + env(safe-area-inset-right))
          calc(50 * var(--ui-unit) + env(safe-area-inset-bottom) + 7px)
          calc(30 * var(--ui-unit) + env(safe-area-inset-left));
        background: radial-gradient(ellipse at 50% 40%, #33105a, transparent 70%), #08080d;
      }
      .hud {
        flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
        width: 100%; gap: 16px; min-height: calc(34 * var(--ui-unit));
        color: #fff; font-size: calc(28 * var(--ui-unit)); font-weight: 750;
        line-height: 1.2; font-variant-numeric: tabular-nums;
      }
      .target-card {
        flex: 0 0 auto; width: 100%; min-height: calc(100 * var(--ui-unit));
        display: grid; place-content: center; gap: calc(4 * var(--ui-unit));
        padding: calc(12 * var(--ui-unit)); text-align: center;
        background: #1b1b22; border: 1px solid #ffffff20; border-radius: calc(22 * var(--ui-unit));
      }
      .label { color: #c8c8d5; font-size: calc(18 * var(--ui-unit)); font-weight: 650; line-height: 1.3; overflow-wrap: anywhere; }
      .target { color: var(--yellow); font-size: calc(48 * var(--ui-unit)); font-weight: 750; line-height: 1.1; font-variant-numeric: tabular-nums; }
      .timer-wrap { flex: 1; min-height: calc(132 * var(--ui-unit)); width: 100%; display: flex; flex-direction: column; justify-content: center; text-align: center; }
      .timer { color: #fff; font-size: calc(80 * var(--ui-unit)); font-weight: 700; line-height: 1.1; letter-spacing: -.035em; font-variant-numeric: tabular-nums; }
      .feedback { min-height: calc(50 * var(--ui-unit)); margin-top: calc(8 * var(--ui-unit)); color: #fff; font-size: calc(18 * var(--ui-unit)); line-height: 1.4; font-weight: 600; overflow-wrap: anywhere; }
      .feedback.perfect { color: #46ee8b; }
      .feedback.close { color: #ffd75a; }
      .feedback.miss { color: #ff7e83; }
      .control { flex: 0 0 auto; width: 100%; display: grid; place-items: center; min-height: calc(132 * var(--ui-unit)); }
      .action {
        width: calc(132 * var(--ui-unit)); min-width: 48px; aspect-ratio: 1;
        border: calc(8 * var(--ui-unit)) solid #2beb7d33; border-radius: 50%;
        background: linear-gradient(145deg, #55d67d, #16c963); color: #07301b;
        box-shadow: 0 8px 22px #0bbe5333;
        font-size: calc(24 * var(--ui-unit)); line-height: 1.2; font-weight: 800;
        padding: 8px; cursor: pointer; transition: transform .12s ease;
      }
      .action:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }
      .action:active { transform: scale(.95); }
      .action.stop { border-color: #ff6f7033; background: linear-gradient(145deg, #ff7b7b, #e94858); color: #340509; }
      .action.next { aspect-ratio: auto; width: min(100%, calc(260 * var(--ui-unit))); min-height: max(48px, calc(64 * var(--ui-unit))); border-radius: 999px; font-size: calc(20 * var(--ui-unit)); overflow-wrap: anywhere; }
      @media (prefers-reduced-motion: reduce) { .action { transition: none; } }
    `;
    document.head.appendChild(style);

    root.innerHTML = `
      <main class="game">
        <header class="hud">
          <span id="round" aria-label="Round"></span>
          <span id="score" aria-label="Score">0</span>
        </header>
        <section class="target-card" aria-label="Target time">
          <div class="label" id="targetLabel"></div>
          <div class="target" id="target"></div>
        </section>
        <section class="timer-wrap">
          <div class="timer" id="timer">00.00</div>
          <div class="feedback" id="feedback" role="status" aria-live="polite">PLAY, then STOP at the target</div>
        </section>
        <section class="control"><button class="action" id="action" type="button"></button></section>
      </main>
    `;

    const els = {
      targetLabel: document.getElementById('targetLabel'),
      target: document.getElementById('target'),
      round: document.getElementById('round'),
      timer: document.getElementById('timer'),
      feedback: document.getElementById('feedback'),
      action: document.getElementById('action'),
      score: document.getElementById('score')
    };

    const totalRounds = Math.max(1, Math.round(Number(cfg.ROUNDS) || 5));
    const perfectWindow = Math.max(.01, Number(cfg.PERFECT_WINDOW) || .05);
    const minTarget = Math.max(.25, Number(cfg.TARGET_MIN) || 1.5);
    const maxTarget = Math.max(minTarget + .25, Number(cfg.TARGET_MAX) || 4.5);
    let phase = 'ready';
    let round = 1;
    let target = 0;
    let elapsed = 0;
    let score = 0;
    let best = Infinity;
    let startAt = 0;
    let raf = 0;
    const muted = false;
    let hasPlayed = false;
    let audio = null;

    const newTarget = () => {
      target = Math.round((minTarget + Math.random() * (maxTarget - minTarget)) * 100) / 100;
    };

    const formatTime = value => Math.min(99.99, value).toFixed(2).padStart(5, '0');

    const ensureAudio = () => {
      try {
        if (!audio) {
          const AudioCtor = window.AudioContext || window.webkitAudioContext;
          if (AudioCtor) audio = new AudioCtor();
        }
        if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
      } catch (_) { audio = null; }
    };

    const tone = (frequency, duration, type = 'sine', volume = .08, delay = 0) => {
      if (muted) return;
      ensureAudio();
      if (!audio) return;
      const startTime = audio.currentTime + delay;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, startTime);
      gain.gain.setValueAtTime(.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(volume, startTime + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, startTime + duration);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(startTime);
      oscillator.stop(startTime + duration + .02);
    };

    const render = () => {
      els.targetLabel.textContent = cfg.TARGET_LABEL || 'TARGET';
      els.target.textContent = target.toFixed(2) + 's';
      els.round.textContent = round + '/' + totalRounds;
      els.round.setAttribute('aria-label', 'Round ' + round + ' of ' + totalRounds);
      els.timer.textContent = formatTime(elapsed);
      els.score.textContent = String(score);
      els.score.setAttribute('aria-label', 'Score ' + score);

      els.action.className = 'action';
      if (phase === 'ready') {
        els.action.textContent = cfg.PLAY_TEXT || 'PLAY';
      } else if (phase === 'running') {
        els.action.textContent = cfg.STOP_TEXT || 'STOP';
        els.action.classList.add('stop');
      } else {
        els.action.textContent = phase === 'complete' ? (cfg.AGAIN_TEXT || 'PLAY AGAIN') : (cfg.NEXT_TEXT || 'NEXT');
        els.action.classList.add('next');
      }
    };

    const tick = now => {
      if (phase !== 'running') return;
      elapsed = (now - startAt) / 1000;
      if (elapsed >= 9.99) {
        elapsed = 9.99;
        finishRound(true);
        return;
      }
      els.timer.textContent = formatTime(elapsed);
      raf = requestAnimationFrame(tick);
    };

    const beginRound = () => {
      phase = 'running';
      elapsed = 0;
      startAt = performance.now();
      hasPlayed = true;
      els.feedback.textContent = '';
      els.feedback.className = 'feedback';
      tone(360, .08, 'sine', .055);
      render();
      raf = requestAnimationFrame(tick);
    };

    const finishRound = automatic => {
      if (phase !== 'running') return;
      cancelAnimationFrame(raf);
      if (!automatic) elapsed = (performance.now() - startAt) / 1000;
      const difference = Math.abs(elapsed - target);
      best = Math.min(best, difference);
      const perfect = difference <= perfectWindow;
      let rating = 'MISS';
      let css = 'miss';
      let earned = Math.max(0, Math.round(70 - difference * 70));
      if (perfect) { rating = 'PERFECT'; css = 'perfect'; earned = 100; }
      else if (difference <= .14) { rating = 'GREAT'; css = 'perfect'; earned = 85; }
      else if (difference <= .35) { rating = 'CLOSE'; css = 'close'; earned = 60; }
      score += earned;
      phase = round >= totalRounds ? 'complete' : 'result';
      const signed = elapsed - target;
      const direction = signed === 0 ? '' : signed < 0 ? ' early' : ' late';
      els.feedback.textContent = rating + ' · ' + difference.toFixed(2) + 's' + direction;
      els.feedback.className = 'feedback ' + css;
      if (perfect) {
        tone(620, .13, 'sine', .08);
        tone(820, .16, 'sine', .07, .08);
      } else if (difference <= .35) {
        tone(470, .12, 'triangle', .065);
      } else {
        tone(160, .2, 'sawtooth', .045);
      }
      if (navigator.vibrate) navigator.vibrate(perfect ? [18, 28, 18] : 18);
      render();
    };

    const advance = () => {
      if (phase === 'complete') {
        round = 1;
        score = 0;
        best = Infinity;
        hasPlayed = false;
      } else {
        round += 1;
      }
      phase = 'ready';
      elapsed = 0;
      newTarget();
      els.feedback.textContent = hasPlayed ? '' : 'PLAY, then STOP at the target';
      els.feedback.className = 'feedback';
      tone(300, .07, 'sine', .045);
      render();
    };

    els.action.addEventListener('click', () => {
      ensureAudio();
      if (phase === 'ready') beginRound();
      else if (phase === 'running') finishRound(false);
      else advance();
    });

    window.addEventListener('keydown', event => {
      if (event.code === 'Space') {
        event.preventDefault();
        els.action.click();
      }
    });

    newTarget();
    render();
  };

  start();
})();
