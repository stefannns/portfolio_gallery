// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "TARGET_MIN",
    "kind": "number",
    "label": "Minimum Target Time",
    "value": 1.5,
    "default": 1.5,
    "min": 0.5,
    "max": 4,
    "step": 0.1
  }, {
    "id": "TARGET_MAX",
    "kind": "number",
    "label": "Maximum Target Time",
    "value": 4.5,
    "default": 4.5,
    "min": 2,
    "max": 8,
    "step": 0.1
  }, {
    "id": "ROUNDS",
    "kind": "number",
    "label": "Rounds",
    "value": 5,
    "default": 5,
    "min": 1,
    "max": 10,
    "step": 1
  }, {
    "id": "PERFECT_WINDOW",
    "kind": "number",
    "label": "Perfect Window",
    "value": 0.05,
    "default": 0.05,
    "min": 0.02,
    "max": 0.2,
    "step": 0.01
  }],
  "texts": [{
    "id": "TITLE",
    "label": "Game Title",
    "value": "Hit the Time",
    "default": "Hit the Time",
    "max_length": 24
  }, {
    "id": "TARGET_LABEL",
    "label": "Target Label",
    "value": "TARGET",
    "default": "TARGET",
    "max_length": 16
  }, {
    "id": "PLAY_TEXT",
    "label": "Play Button",
    "value": "PLAY",
    "default": "PLAY",
    "max_length": 14
  }, {
    "id": "STOP_TEXT",
    "label": "Stop Button",
    "value": "STOP",
    "default": "STOP",
    "max_length": 14
  }, {
    "id": "NEXT_TEXT",
    "label": "Next Button",
    "value": "NEXT",
    "default": "NEXT",
    "max_length": 14
  }, {
    "id": "AGAIN_TEXT",
    "label": "Replay Button",
    "value": "PLAY AGAIN",
    "default": "PLAY AGAIN",
    "max_length": 20
  }],
  "images": [],
  "config_version": "2.0",
  "playable": {
    "post_id": "99279729722908290",
    "version_id": "99279729722770773",
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #08080d; -webkit-tap-highlight-color: transparent; }
  

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
(() => {
  'use strict';

  const flattenConfig = value => {
    const options = {};
    for (const section of ['tweaks', 'texts', 'images']) {
      for (const item of value[section] || []) options[item.id] = item.value ?? item.path;
    }
    return options;
  };
  const loadConfig = async () => {
    try {
      const response = await fetch('./game.config.json', {
        cache: 'no-store'
      });
      if (response.ok) return flattenConfig(await response.json());
    } catch (value) {}
    const inline = document.getElementById('playable-config-inline');
    return inline ? flattenConfig(JSON.parse(inline.textContent)) : {};
  };
  const start = async () => {
    const config = await loadConfig();
    const root = document.getElementById('root');
    const style = document.createElement('style');
    style.textContent = `
      @font-face{font-family:Audiowide;src:url('./assets/fonts/audiowide/Audiowide-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}
      :root {
        --ui-unit:min(0.2564102564vw,0.1672240803vh);
        --font-display:Audiowide,"PingFang SC",system-ui,sans-serif;
        --font-body:-apple-system,"Helvetica Neue","PingFang SC",system-ui,sans-serif;
        --font-mono:ui-monospace,Menlo,monospace;
        --color-bg:#070b19;--color-accent:#00e5ff;--color-text-main:#fff;
        --color-text-dim:rgba(255,255,255,.6);--color-panel:rgba(7,11,25,.85);
        color-scheme:dark;font-family:var(--font-display);
      }
      *{box-sizing:border-box}
      html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}
      body{background:var(--color-bg);touch-action:manipulation;user-select:none;-webkit-user-select:none}
      button{font:inherit;-webkit-tap-highlight-color:transparent}
      .game {
        position:relative;width:100%;height:100%;overflow:hidden;container-type:inline-size;
        display:flex;flex-direction:column;align-items:center;gap:calc(12 * var(--ui-unit));
        padding:calc(30 * var(--ui-unit) + env(safe-area-inset-top)) calc(30 * var(--ui-unit) + env(safe-area-inset-right)) calc(50 * var(--ui-unit) + env(safe-area-inset-bottom) + 7px) calc(30 * var(--ui-unit) + env(safe-area-inset-left));
        background:var(--color-bg);color:var(--color-text-main);
      }
      .hud{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;width:100%;gap:16px;min-height:calc(34 * var(--ui-unit));font-size:calc(28 * var(--ui-unit));font-weight:400;line-height:1.2;font-variant-numeric:tabular-nums}
      .target-card{flex:0 0 auto;width:100%;min-height:calc(100 * var(--ui-unit));display:grid;place-content:center;gap:8px;padding:12px;text-align:center;border:1px solid #00e5ff33;border-radius:8px;background:var(--color-panel)}
      .label{color:var(--color-text-dim);font:400 calc(18 * var(--ui-unit))/1.3 var(--font-body);overflow-wrap:anywhere}
      .target{color:var(--color-accent);font-size:clamp(28px,8cqi,42px);font-weight:400;line-height:1.2;font-variant-numeric:tabular-nums}
      .timer-wrap{flex:1;min-height:calc(132 * var(--ui-unit));width:100%;display:flex;flex-direction:column;justify-content:center;text-align:center}
      .timer{color:var(--color-text-main);font:400 clamp(60px,18cqi,100px)/1 var(--font-mono);letter-spacing:-.035em;font-variant-numeric:tabular-nums}
      .feedback{min-height:calc(50 * var(--ui-unit));margin-top:16px;color:var(--color-accent);font-size:calc(18 * var(--ui-unit));line-height:1.4;font-weight:400;overflow-wrap:anywhere}
      .game[data-phase="ready"] .feedback{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
      .feedback.perfect{color:#00e5ff}.feedback.close{color:#ffd75a}.feedback.miss{color:#ff7e83}
      .control{flex:0 0 auto;width:100%;display:grid;place-items:center;min-height:calc(100 * var(--ui-unit))}
      .action{width:min(100%,calc(220 * var(--ui-unit)));min-width:48px;min-height:56px;padding:12px 24px;border:1px solid var(--color-accent);border-radius:8px;background:#00e5ff1a;color:var(--color-accent);font:400 clamp(14px,4cqi,18px)/1.3 var(--font-display);text-transform:uppercase;letter-spacing:1px;overflow-wrap:anywhere;cursor:pointer;transition:background-color .15s,transform .15s}
      .action.stop{background:var(--color-accent);color:var(--color-bg)}
      .action.next{background:#00e5ff1a;color:var(--color-accent)}
      .action:focus-visible{outline:3px solid #fff;outline-offset:4px}
      .action:active{background:#00e5ff4d;transform:scale(.96)}
      @media(prefers-reduced-motion:reduce){.action{transition:none}.game[data-phase="ready"] .feedback{animation:none}}
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
    const options = {
      targetLabel: document.getElementById('targetLabel'),
      target: document.getElementById('target'),
      round: document.getElementById('round'),
      timer: document.getElementById('timer'),
      feedback: document.getElementById('feedback'),
      action: document.getElementById('action'),
      score: document.getElementById('score')
    };
    const totalRounds = Math.max(1, Math.round(Number(config.ROUNDS) || 5));
    const perfectWindow = Math.max(0.01, Number(config.PERFECT_WINDOW) || 0.05);
    const minTarget = Math.max(0.25, Number(config.TARGET_MIN) || 1.5);
    const maxTarget = Math.max(minTarget + 0.25, Number(config.TARGET_MAX) || 4.5);
    let phase = 'ready';
    let round = 1;
    let target = 0;
    let elapsed = 0;
    let score = 0;
    let best = Infinity;
    let startAt = 0;
    let value2 = 0;
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
      } catch (value) {
        audio = null;
      }
    };
    const tone = (frequency, duration, type = 'sine', volume = 0.08, delay = 0) => {
      if (muted) return;
      ensureAudio();
      if (!audio) return;
      const startTime = audio.currentTime + delay;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, startTime);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(startTime);
      oscillator.stop(startTime + duration + 0.02);
    };
    const render = () => {
      root.querySelector('.game').dataset.phase = phase;
      options.targetLabel.textContent = config.TARGET_LABEL || 'TARGET';
      options.target.textContent = target.toFixed(2) + 's';
      options.round.textContent = round + '/' + totalRounds;
      options.round.setAttribute('aria-label', 'Round ' + round + ' of ' + totalRounds);
      options.timer.textContent = formatTime(elapsed);
      options.score.textContent = String(score);
      options.score.setAttribute('aria-label', 'Score ' + score);
      options.action.className = 'action';
      if (phase === 'ready') {
        options.action.textContent = config.PLAY_TEXT || 'PLAY';
      } else if (phase === 'running') {
        options.action.textContent = config.STOP_TEXT || 'STOP';
        options.action.classList.add('stop');
      } else {
        options.action.textContent = phase === 'complete' ? config.AGAIN_TEXT || 'PLAY AGAIN' : config.NEXT_TEXT || 'NEXT';
        options.action.classList.add('next');
      }
    };
    const tick = value => {
      if (phase !== 'running') return;
      elapsed = (value - startAt) / 1000;
      if (elapsed >= 9.99) {
        elapsed = 9.99;
        finishRound(true);
        return;
      }
      options.timer.textContent = formatTime(elapsed);
      value2 = requestAnimationFrame(tick);
    };
    const beginRound = () => {
      phase = 'running';
      elapsed = 0;
      startAt = performance.now();
      hasPlayed = true;
      options.feedback.textContent = '';
      options.feedback.className = 'feedback';
      tone(360, 0.08, 'sine', 0.055);
      render();
      value2 = requestAnimationFrame(tick);
    };
    const finishRound = automatic => {
      if (phase !== 'running') return;
      cancelAnimationFrame(value2);
      if (!automatic) elapsed = (performance.now() - startAt) / 1000;
      const difference = Math.abs(elapsed - target);
      best = Math.min(best, difference);
      const perfect = difference <= perfectWindow;
      let rating = 'MISS';
      let label = 'miss';
      let earned = Math.max(0, Math.round(70 - difference * 70));
      if (perfect) {
        rating = 'PERFECT';
        label = 'perfect';
        earned = 100;
      } else if (difference <= 0.14) {
        rating = 'GREAT';
        label = 'perfect';
        earned = 85;
      } else if (difference <= 0.35) {
        rating = 'CLOSE';
        label = 'close';
        earned = 60;
      }
      score += earned;
      phase = round >= totalRounds ? 'complete' : 'result';
      const signed = elapsed - target;
      const direction = signed === 0 ? '' : signed < 0 ? ' early' : ' late';
      options.feedback.textContent = rating + ' · ' + difference.toFixed(2) + 's' + direction;
      options.feedback.className = 'feedback ' + label;
      if (perfect) {
        tone(620, 0.13, 'sine', 0.08);
        tone(820, 0.16, 'sine', 0.07, 0.08);
      } else if (difference <= 0.35) {
        tone(470, 0.12, 'triangle', 0.065);
      } else {
        tone(160, 0.2, 'sawtooth', 0.045);
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
      options.feedback.textContent = hasPlayed ? '' : 'PLAY, then STOP at the target';
      options.feedback.className = 'feedback';
      tone(300, 0.07, 'sine', 0.045);
      render();
    };
    options.action.addEventListener('click', () => {
      ensureAudio();
      if (phase === 'ready') beginRound();else if (phase === 'running') finishRound(false);else advance();
    });
    window.addEventListener('keydown', event => {
      if (event.code === 'Space') {
        event.preventDefault();
        options.action.click();
      }
    });
    newTarget();
    render();
  };
  start();
})();

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root button",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root button",
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
  const selectors = ["#feedback"];
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
    // Only the instruction breathes; stopwatch outcomes remain steady.
    for (const value of targets) if (value.id === 'feedback' && (value.textContent || '').trim() !== 'PLAY, then STOP at the target') targets.delete(value);
    for (const [el, a] of running) if (!targets.has(el)) {
      a.cancel();
      running.delete(el);
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
        "data-batch3-game": "54"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "54"
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
