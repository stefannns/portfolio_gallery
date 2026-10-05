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
      :root { color-scheme: dark; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { background: #020306; user-select: none; -webkit-user-select: none; touch-action: none; }
      .instrument { position: relative; width: 100%; height: 100%; overflow: hidden; background: #020306; }
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: crosshair; }
      .prompt {
        position: absolute;
        z-index: 2;
        top: calc(42px + env(safe-area-inset-top));
        left: max(72px, calc(25px + env(safe-area-inset-left)));
        right: max(72px, calc(25px + env(safe-area-inset-right)));
        margin: 0;
        color: rgba(222,232,248,.72);
        font-size: clamp(13px, 3.8vw, 18px);
        font-weight: 750;
        line-height: 1.35;
        letter-spacing: .16em;
        text-align: center;
        text-wrap: balance;
        pointer-events: none;
        text-shadow: 0 2px 16px #000;
        transition: opacity .35s ease, transform .35s ease;
      }
      .prompt.hidden { opacity: 0; transform: translateY(-6px); }
      .clear {
        position: absolute;
        z-index: 3;
        top: calc(25px + env(safe-area-inset-top));
        right: max(25px, env(safe-area-inset-right));
        width: 48px;
        height: 48px;
        border: 0;
        background: transparent;
        color: rgba(235,239,247,.76);
        cursor: pointer;
      }
      .clear::before, .clear::after {
        content: '';
        position: absolute;
        left: 8px;
        right: 8px;
        top: 23px;
        height: 3px;
        border-radius: 99px;
        background: currentColor;
      }
      .clear::before { transform: rotate(45deg); }
      .clear::after { transform: rotate(-45deg); }
      .sound {
        position: absolute;
        z-index: 3;
        right: max(25px, env(safe-area-inset-right));
        bottom: calc(40px + env(safe-area-inset-bottom));
        width: 58px;
        height: 58px;
        display: grid;
        place-items: center;
        border: 3px solid rgba(240,246,255,.9);
        border-radius: 50%;
        background: rgba(6,10,16,.74);
        color: #edf6ff;
        cursor: pointer;
        backdrop-filter: blur(8px);
      }
      .sound svg { width: 25px; height: 25px; }
      .status {
        position: absolute;
        z-index: 2;
        left: max(25px, env(safe-area-inset-left));
        bottom: calc(40px + env(safe-area-inset-bottom));
        min-width: 132px;
        min-height: 58px;
        display: grid;
        place-content: center;
        gap: 2px;
        padding: 8px 16px;
        border: 1px solid rgba(119,196,255,.25);
        border-radius: 29px;
        background: rgba(22,55,83,.56);
        color: #d9efff;
        text-align: center;
        pointer-events: none;
        backdrop-filter: blur(9px);
        box-shadow: 0 0 24px rgba(46,163,255,.12);
      }
      .status strong { font-size: 16px; font-variant-numeric: tabular-nums; }
      .status span { color: rgba(210,230,247,.62); font-size: 10px; font-weight: 800; letter-spacing: .13em; }
      .clear:focus-visible, .sound:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
      @media (max-height: 680px) {
        .prompt { top: calc(30px + env(safe-area-inset-top)); }
        .clear { top: calc(18px + env(safe-area-inset-top)); }
        .sound, .status { bottom: calc(28px + env(safe-area-inset-bottom)); }
      }
      @media (prefers-reduced-motion: reduce) { .prompt { transition-duration: .01ms; } }
    `;
    document.head.appendChild(style);

    root.innerHTML = `
      <main class="instrument">
        <canvas id="strings" aria-label="Drag from one point to another to create a humming string."></canvas>
        <p class="prompt" id="prompt"></p>
        <button class="clear" id="clear" type="button" aria-label="Clear all strings"></button>
        <div class="status" id="status"><strong>0 STRINGS</strong><span>DRAG TO PLAY</span></div>
        <button class="sound" id="sound" type="button" aria-label="Mute instrument" aria-pressed="false">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path id="soundWaves" d="M16 8.2a5 5 0 0 1 0 7.6M18.7 5.5a9 9 0 0 1 0 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </main>
    `;

    const canvas = document.getElementById('strings');
    const ctx = canvas.getContext('2d');
    const prompt = document.getElementById('prompt');
    const clearButton = document.getElementById('clear');
    const soundButton = document.getElementById('sound');
    const soundWaves = document.getElementById('soundWaves');
    const status = document.getElementById('status');
    prompt.textContent = cfg.TEXT_PROMPT || 'DRAG BETWEEN TWO POINTS';

    const minFrequency = Math.max(40, Number(cfg.MIN_FREQUENCY) || 110);
    const maxFrequency = Math.max(minFrequency + 50, Number(cfg.MAX_FREQUENCY) || 760);
    const waveHeight = Math.max(6, Number(cfg.WAVE_HEIGHT) || 22);
    const maxStrings = Math.max(2, Math.round(Number(cfg.MAX_STRINGS) || 8));
    const masterDb = Number.isFinite(Number(cfg.VOLUME)) ? Number(cfg.VOLUME) : -20;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let strings = [];
    let draft = null;
    let audio = null;
    let master = null;
    let compressor = null;
    let muted = false;
    let lastFrame = performance.now();

    const dbToGain = db => Math.pow(10, db / 20);
    const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

    const frequencyForLength = length => {
      const maxLength = Math.max(180, Math.hypot(width, height) * .82);
      const normalized = Math.max(0, Math.min(1, (length - 28) / (maxLength - 28)));
      return minFrequency + (maxFrequency - minFrequency) * Math.pow(normalized, .82);
    };

    const ensureAudio = () => {
      if (!audio) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return false;
        audio = new AudioCtor();
        master = audio.createGain();
        compressor = audio.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 18;
        compressor.ratio.value = 4;
        compressor.attack.value = .01;
        compressor.release.value = .3;
        master.gain.value = muted ? 0 : dbToGain(masterDb);
        master.connect(compressor).connect(audio.destination);
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      return true;
    };

    const makeVoice = length => {
      if (!ensureAudio()) return null;
      const now = audio.currentTime;
      const frequency = frequencyForLength(length);
      const gain = audio.createGain();
      const tone = audio.createOscillator();
      const shimmer = audio.createOscillator();
      tone.type = 'sine';
      shimmer.type = 'triangle';
      tone.frequency.value = frequency;
      shimmer.frequency.value = frequency * 2.002;
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.14, now + .08);
      tone.connect(gain);
      shimmer.connect(gain);
      gain.connect(master);
      tone.start();
      shimmer.start();
      return { tone, shimmer, gain, frequency, stopped: false };
    };

    const updateVoice = (voice, length) => {
      if (!voice || voice.stopped || !audio) return;
      const frequency = frequencyForLength(length);
      const now = audio.currentTime;
      voice.frequency = frequency;
      voice.tone.frequency.cancelScheduledValues(now);
      voice.shimmer.frequency.cancelScheduledValues(now);
      voice.tone.frequency.setValueAtTime(voice.tone.frequency.value, now);
      voice.shimmer.frequency.setValueAtTime(voice.shimmer.frequency.value, now);
      voice.tone.frequency.linearRampToValueAtTime(frequency, now + .045);
      voice.shimmer.frequency.linearRampToValueAtTime(frequency * 2.002, now + .045);
    };

    const stopVoice = voice => {
      if (!voice || voice.stopped || !audio) return;
      voice.stopped = true;
      const now = audio.currentTime;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(.0001, now, .035);
      voice.tone.stop(now + .18);
      voice.shimmer.stop(now + .18);
      setTimeout(() => {
        try { voice.gain.disconnect(); } catch (_) {}
      }, 260);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawBackground = () => {
      const gradient = ctx.createRadialGradient(width * .55, height * .48, 0, width * .5, height * .5, Math.max(width, height) * .72);
      gradient.addColorStop(0, '#07101a');
      gradient.addColorStop(.5, '#03070c');
      gradient.addColorStop(1, '#010204');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.globalAlpha = .18;
      ctx.strokeStyle = '#16304a';
      ctx.lineWidth = 1;
      for (let y = 130; y < height - 100; y += 76) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.restore();
    };

    const stringPoint = (string, progress, time, phaseOffset = 0) => {
      const dx = string.end.x - string.start.x;
      const dy = string.end.y - string.start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const normalX = -dy / length;
      const normalY = dx / length;
      const envelope = Math.sin(progress * Math.PI);
      const cycles = 1.35 + length / 155;
      const amplitude = Math.min(waveHeight * 1.6, waveHeight * (.62 + length / Math.max(width, height)));
      const wave = Math.sin(progress * Math.PI * 2 * cycles - time * (2.1 + string.speed) + string.phase + phaseOffset) * amplitude * envelope;
      return {
        x: string.start.x + dx * progress + normalX * wave,
        y: string.start.y + dy * progress + normalY * wave
      };
    };

    const strokeWave = (string, time, phaseOffset, color, widthValue, glow = 0) => {
      ctx.beginPath();
      const first = stringPoint(string, 0, time, phaseOffset);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i <= 72; i++) {
        const point = stringPoint(string, i / 72, time, phaseOffset);
        ctx.lineTo(point.x, point.y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = widthValue;
      ctx.shadowBlur = glow;
      ctx.shadowColor = color;
      ctx.stroke();
    };

    const drawString = (string, time, active = false) => {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const alpha = active ? 1 : .86;
      strokeWave(string, time, 0, 'rgba(38,153,235,' + (.32 * alpha) + ')', active ? 14 : 11, 18);
      strokeWave(string, time, .32, 'rgba(64,174,255,' + (.42 * alpha) + ')', active ? 8 : 6, 10);
      const strandColors = [
        'rgba(255,178,193,.82)',
        'rgba(122,205,255,.92)',
        'rgba(244,210,222,.7)',
        'rgba(37,150,232,.95)',
        'rgba(255,195,207,.72)',
        'rgba(148,218,255,.72)',
        'rgba(255,163,183,.72)',
        'rgba(92,190,255,.76)',
        'rgba(255,221,230,.66)'
      ];
      strandColors.forEach((color, index) => {
        const centered = index - (strandColors.length - 1) / 2;
        strokeWave(string, time, centered * .19, color, index === 4 ? 1.65 : .8, index === 4 ? 7 : 2);
      });
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#69c6ff';
      ctx.beginPath();
      ctx.arc(string.start.x, string.start.y, active ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffc1cf';
      ctx.beginPath();
      ctx.arc(string.end.x, string.end.y, active ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const updateStatus = (string = null) => {
      if (string) {
        const length = Math.round(distance(string.start, string.end));
        const frequency = Math.round(frequencyForLength(length));
        status.innerHTML = '<strong>' + frequency + ' Hz</strong><span>' + length + ' PX STRING</span>';
      } else {
        status.innerHTML = '<strong>' + strings.length + ' STRING' + (strings.length === 1 ? '' : 'S') + '</strong><span>DRAG TO PLAY</span>';
      }
    };

    const frame = now => {
      const time = now / 1000;
      const dt = Math.min(.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBackground();
      for (const string of strings) {
        string.phase += dt * string.drift;
        drawString(string, time, false);
      }
      if (draft) drawString(draft, time, true);
      requestAnimationFrame(frame);
    };

    const pointFromEvent = event => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(18, Math.min(width - 18, event.clientX - rect.left)),
        y: Math.max(95, Math.min(height - 100, event.clientY - rect.top))
      };
    };

    canvas.addEventListener('pointerdown', event => {
      if (event.isPrimary === false || draft) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      const point = pointFromEvent(event);
      draft = {
        pointerId: event.pointerId,
        start: point,
        end: { ...point },
        phase: Math.random() * Math.PI * 2,
        speed: .35 + Math.random() * .45,
        drift: .14 + Math.random() * .18,
        voice: makeVoice(1)
      };
      prompt.classList.add('hidden');
      updateStatus(draft);
    });

    canvas.addEventListener('pointermove', event => {
      if (!draft || event.pointerId !== draft.pointerId) return;
      event.preventDefault();
      draft.end = pointFromEvent(event);
      const length = distance(draft.start, draft.end);
      updateVoice(draft.voice, length);
      updateStatus(draft);
    });

    const finishDraft = (event, cancelled = false) => {
      if (!draft || event.pointerId !== draft.pointerId) return;
      const finished = draft;
      draft = null;
      const length = distance(finished.start, finished.end);
      if (cancelled || length < 34) {
        stopVoice(finished.voice);
        updateStatus();
        return;
      }
      strings.push(finished);
      while (strings.length > maxStrings) {
        const removed = strings.shift();
        stopVoice(removed.voice);
      }
      updateVoice(finished.voice, length);
      updateStatus();
      if (navigator.vibrate) navigator.vibrate(14);
    };

    canvas.addEventListener('pointerup', event => finishDraft(event, false));
    canvas.addEventListener('pointercancel', event => finishDraft(event, true));
    canvas.addEventListener('lostpointercapture', event => {
      if (draft && event.pointerId === draft.pointerId) finishDraft(event, true);
    });

    const clearStrings = () => {
      if (draft) { stopVoice(draft.voice); draft = null; }
      strings.forEach(string => stopVoice(string.voice));
      strings = [];
      prompt.classList.remove('hidden');
      updateStatus();
      if (navigator.vibrate) navigator.vibrate(10);
    };

    clearButton.addEventListener('click', event => {
      event.stopPropagation();
      clearStrings();
    });

    soundButton.addEventListener('click', event => {
      event.stopPropagation();
      muted = !muted;
      soundButton.setAttribute('aria-pressed', String(muted));
      soundButton.setAttribute('aria-label', muted ? 'Turn instrument sound on' : 'Mute instrument');
      soundWaves.style.display = muted ? 'none' : '';
      if (master && audio) master.gain.setTargetAtTime(muted ? .0001 : dbToGain(masterDb), audio.currentTime, .025);
    });

    document.addEventListener('visibilitychange', () => {
      if (!audio) return;
      if (document.hidden) audio.suspend().catch(() => {});
      else if (!muted && (strings.length || draft)) audio.resume().catch(() => {});
    });

    window.addEventListener('resize', resize);
    resize();
    updateStatus();
    requestAnimationFrame(frame);
  };

  start();
})();
