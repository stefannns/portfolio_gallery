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
        color-scheme: dark;
        font-family: Inter, ui-rounded, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --green: #28d66f;
        --green-deep: #0fb957;
        --yellow: #ffd10a;
        --panel: #1b1b22;
        --muted: #9b9ba9;
      }
      * { box-sizing: border-box; }
      html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body {
        background: #08080d;
        touch-action: manipulation;
        user-select: none;
        -webkit-user-select: none;
      }
      button { font: inherit; -webkit-tap-highlight-color: transparent; }
      .game {
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 100%;
        overflow: hidden;
        display: grid;
        grid-template-rows: auto auto auto auto minmax(140px, 1fr) auto;
        align-items: center;
        gap: clamp(10px, 1.8vh, 18px);
        padding: calc(42px + env(safe-area-inset-top)) max(28px, env(safe-area-inset-right)) calc(40px + env(safe-area-inset-bottom)) max(28px, env(safe-area-inset-left));
        background:
          radial-gradient(circle at 50% 38%, rgba(97, 35, 174, .58) 0, rgba(43, 13, 78, .5) 26%, transparent 56%),
          linear-gradient(145deg, #0a0a10 0%, #120a22 46%, #08080d 100%);
      }
      .game::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(circle at 50% 62%, rgba(131, 58, 210, .13), transparent 40%);
      }
      .sound {
        position: absolute;
        z-index: 4;
        top: calc(24px + env(safe-area-inset-top));
        right: max(25px, env(safe-area-inset-right));
        width: 48px;
        height: 48px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 50%;
        background: rgba(36,36,43,.84);
        color: #fff;
        box-shadow: 0 8px 28px rgba(0,0,0,.3);
        cursor: pointer;
      }
      .sound svg { width: 23px; height: 23px; }
      .sound:focus-visible, .action:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }
      .title {
        position: relative;
        z-index: 1;
        margin: 0;
        padding: 24px 58px 0;
        color: #fff;
        font-family: Impact, "Arial Black", ui-rounded, sans-serif;
        font-size: clamp(42px, 12vw, 70px);
        line-height: .96;
        letter-spacing: -.035em;
        text-align: center;
        text-wrap: balance;
        filter: drop-shadow(0 8px 20px rgba(59, 10, 104, .5));
      }
      .target-card {
        position: relative;
        z-index: 1;
        width: min(100%, 480px);
        min-height: clamp(126px, 18vh, 174px);
        margin: 0 auto;
        display: grid;
        place-content: center;
        gap: 6px;
        padding: 20px;
        border: 2px solid rgba(255,255,255,.08);
        border-radius: 28px;
        background: rgba(28,28,34,.94);
        box-shadow: 0 22px 50px rgba(0,0,0,.32), 0 0 34px rgba(118,45,209,.14);
        text-align: center;
      }
      .label {
        color: #aaaab8;
        font-size: clamp(14px, 3.5vw, 19px);
        font-weight: 800;
        letter-spacing: .23em;
      }
      .target {
        color: var(--yellow);
        font-size: clamp(46px, 13vw, 72px);
        font-weight: 750;
        line-height: 1;
        font-variant-numeric: tabular-nums;
        text-shadow: 0 0 26px rgba(255,209,10,.14);
      }
      .round { color: #777781; font-size: 13px; font-weight: 800; letter-spacing: .12em; }
      .timer-wrap { position: relative; z-index: 1; text-align: center; min-height: 102px; }
      .timer {
        color: #fff;
        font-size: clamp(74px, 22vw, 120px);
        font-weight: 700;
        line-height: .92;
        letter-spacing: -.065em;
        font-variant-numeric: tabular-nums;
        text-shadow: 0 10px 32px rgba(0,0,0,.28);
      }
      .feedback {
        min-height: 26px;
        margin-top: 6px;
        color: #fff;
        font-size: clamp(14px, 3.6vw, 18px);
        font-weight: 800;
        letter-spacing: .06em;
        text-align: center;
      }
      .feedback.perfect { color: #46ee8b; }
      .feedback.close { color: #ffd75a; }
      .feedback.miss { color: #ff7e83; }
      .precision { position: relative; z-index: 1; width: min(100%, 540px); margin: auto; }
      .precision-title { margin-bottom: 10px; color: #9696a7; font-size: 14px; font-weight: 800; letter-spacing: .08em; }
      .track {
        position: relative;
        height: 18px;
        border: 5px solid rgba(255,255,255,.08);
        border-radius: 999px;
        background: linear-gradient(90deg, #25d76f 0 5%, #efd63f 18%, #d64d68 48%, #382535 100%);
        box-shadow: inset 0 2px 8px rgba(0,0,0,.45);
      }
      .marker {
        position: absolute;
        top: 50%;
        width: 5px;
        height: 30px;
        border-radius: 99px;
        background: #fff;
        box-shadow: 0 0 12px #fff;
        transform: translate(-50%, -50%);
        opacity: 0;
        transition: left .28s ease, opacity .2s ease;
      }
      .marker.show { opacity: 1; }
      .scale { display: flex; justify-content: space-between; margin-top: 8px; color: #6e6e7a; font-size: 12px; font-weight: 700; }
      .control {
        position: relative;
        z-index: 1;
        align-self: center;
        display: grid;
        place-items: center;
        min-height: 150px;
      }
      .action {
        width: clamp(142px, 42vw, 188px);
        aspect-ratio: 1;
        border: 12px solid rgba(43, 235, 125, .2);
        border-radius: 50%;
        background: linear-gradient(145deg, #55d67d, #16c963);
        color: #fff;
        box-shadow: 0 18px 34px rgba(11,190,83,.24), inset 0 0 0 3px rgba(0,0,0,.1);
        font-size: clamp(25px, 7vw, 38px);
        font-weight: 850;
        letter-spacing: .025em;
        cursor: pointer;
        transition: transform .12s ease, background .18s ease, box-shadow .18s ease;
      }
      .action:active { transform: scale(.95); }
      .action.stop {
        border-color: rgba(255,111,112,.2);
        background: linear-gradient(145deg, #ff7b7b, #e94858);
        box-shadow: 0 18px 34px rgba(232,55,79,.24), inset 0 0 0 3px rgba(0,0,0,.1);
      }
      .action.next {
        aspect-ratio: auto;
        width: min(72vw, 280px);
        min-height: 82px;
        border-width: 8px;
        border-radius: 999px;
        font-size: clamp(22px, 6vw, 30px);
      }
      .stats {
        position: relative;
        z-index: 1;
        width: min(100%, 500px);
        margin: auto;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .stat {
        min-height: 58px;
        display: grid;
        place-content: center;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 16px;
        background: rgba(28,28,34,.78);
        text-align: center;
      }
      .stat span { color: #747481; font-size: 11px; font-weight: 800; letter-spacing: .12em; }
      .stat strong { margin-top: 2px; color: #fff; font-size: 20px; font-variant-numeric: tabular-nums; }
      @media (max-height: 730px) {
        .game { gap: 8px; padding-top: calc(30px + env(safe-area-inset-top)); padding-bottom: calc(28px + env(safe-area-inset-bottom)); }
        .title { padding-top: 8px; font-size: clamp(38px, 10vw, 54px); }
        .target-card { min-height: 116px; padding: 12px; }
        .timer-wrap { min-height: 82px; }
        .timer { font-size: clamp(66px, 18vw, 94px); }
        .control { min-height: 126px; }
        .action { width: clamp(120px, 34vw, 152px); }
        .stats { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
      }
    `;
    document.head.appendChild(style);

    root.innerHTML = `
      <main class="game">
        <button class="sound" id="sound" type="button" aria-label="Mute sound" aria-pressed="false">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path id="soundWaves" d="M16 8.2a5 5 0 0 1 0 7.6M18.7 5.5a9 9 0 0 1 0 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <h1 class="title" id="title"></h1>
        <section class="target-card" aria-label="Target time">
          <div class="label" id="targetLabel"></div>
          <div class="target" id="target"></div>
          <div class="round" id="round"></div>
        </section>
        <section class="timer-wrap" aria-live="polite">
          <div class="timer" id="timer">00.00</div>
          <div class="feedback" id="feedback">Tap PLAY, then tap STOP on the target</div>
        </section>
        <section class="precision" aria-label="Timing precision">
          <div class="precision-title">PRECISION</div>
          <div class="track"><div class="marker" id="marker"></div></div>
          <div class="scale"><span>0.0s</span><span>0.1s</span><span>0.3s</span><span>1.0s+</span></div>
        </section>
        <section class="control"><button class="action" id="action" type="button"></button></section>
        <section class="stats">
          <div class="stat"><span>SCORE</span><strong id="score">0</strong></div>
          <div class="stat"><span>BEST</span><strong id="best">—</strong></div>
        </section>
      </main>
    `;

    const els = {
      title: document.getElementById('title'),
      targetLabel: document.getElementById('targetLabel'),
      target: document.getElementById('target'),
      round: document.getElementById('round'),
      timer: document.getElementById('timer'),
      feedback: document.getElementById('feedback'),
      marker: document.getElementById('marker'),
      action: document.getElementById('action'),
      sound: document.getElementById('sound'),
      soundWaves: document.getElementById('soundWaves'),
      score: document.getElementById('score'),
      best: document.getElementById('best')
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
    let muted = false;
    let audio = null;

    const newTarget = () => {
      target = Math.round((minTarget + Math.random() * (maxTarget - minTarget)) * 100) / 100;
    };

    const formatTime = value => Math.min(99.99, value).toFixed(2).padStart(5, '0');

    const ensureAudio = () => {
      if (!audio) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (AudioCtor) audio = new AudioCtor();
      }
      if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
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
      els.title.textContent = cfg.TITLE || 'Hit the Time';
      els.targetLabel.textContent = cfg.TARGET_LABEL || 'TARGET';
      els.target.textContent = target.toFixed(2) + 's';
      els.round.textContent = 'ROUND ' + round + ' / ' + totalRounds;
      els.timer.textContent = formatTime(elapsed);
      els.score.textContent = String(score);
      els.best.textContent = Number.isFinite(best) ? best.toFixed(2) + 's' : '—';

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
      els.feedback.textContent = 'Tap STOP at ' + target.toFixed(2) + ' seconds';
      els.feedback.className = 'feedback';
      els.marker.classList.remove('show');
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
      els.marker.style.left = Math.min(100, difference * 100) + '%';
      els.marker.classList.add('show');
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
      } else {
        round += 1;
      }
      phase = 'ready';
      elapsed = 0;
      newTarget();
      els.feedback.textContent = 'Tap PLAY, then tap STOP on the target';
      els.feedback.className = 'feedback';
      els.marker.classList.remove('show');
      tone(300, .07, 'sine', .045);
      render();
    };

    els.action.addEventListener('click', () => {
      ensureAudio();
      if (phase === 'ready') beginRound();
      else if (phase === 'running') finishRound(false);
      else advance();
    });

    els.sound.addEventListener('click', event => {
      event.stopPropagation();
      muted = !muted;
      els.sound.setAttribute('aria-pressed', String(muted));
      els.sound.setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound');
      els.soundWaves.style.display = muted ? 'none' : '';
      if (!muted) tone(520, .08, 'sine', .045);
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

