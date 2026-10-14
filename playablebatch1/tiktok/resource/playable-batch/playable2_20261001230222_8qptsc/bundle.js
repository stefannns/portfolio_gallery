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
      :root { --ui-unit: min(0.2564102564vw, 0.1672240803vh); color-scheme: dark; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { background: #020306; user-select: none; -webkit-user-select: none; touch-action: none; }
      .instrument { position: relative; width: 100%; height: 100%; overflow: hidden; background: #020306; }
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: crosshair; }
      .prompt {
        position: absolute;
        z-index: 2;
        top: 50%;
        left: calc(30 * var(--ui-unit) + env(safe-area-inset-left));
        right: calc(30 * var(--ui-unit) + env(safe-area-inset-right));
        margin: 0;
        transform: translateY(-50%);
        color: rgba(222,232,248,.72);
        font-size: calc(18 * var(--ui-unit));
        font-weight: 750;
        line-height: 1.35;
        letter-spacing: .04em;
        overflow-wrap: anywhere;
        text-align: center;
        text-wrap: balance;
        pointer-events: none;
        text-shadow: 0 2px 16px #000;
        transition: opacity .25s ease;
      }
      .prompt.hidden { opacity: 0; }
      .palette {
        position: absolute; z-index: 3; left: 50%; transform: translateX(-50%);
        bottom: calc(50 * var(--ui-unit) + env(safe-area-inset-bottom));
        display: flex; gap: 8px;
      }
      .swatch {
        position: relative; width: 44px; height: 44px; padding: 6px;
        border: 2px solid transparent; border-radius: 50%; background: transparent;
        cursor: pointer; touch-action: manipulation;
        transition: border-color .15s ease, background-color .15s ease;
      }
      .swatch::before { content: ''; display: block; width: 100%; height: 100%; border-radius: 50%; background: var(--swatch); }
      .swatch[aria-pressed="true"] { border-color: #eff7ff; }
      .swatch:active, .clear:active { background-color: rgba(255,255,255,.12); }
      .swatch:focus-visible, canvas:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
      .clear {
        position: absolute;
        z-index: 3;
        top: calc(30 * var(--ui-unit) + env(safe-area-inset-top) + 6px);
        right: calc(30 * var(--ui-unit) + env(safe-area-inset-right) + 6px);
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
      .clear:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
      @media (prefers-reduced-motion: reduce) { .prompt, .swatch { transition-duration: .01ms; } }
    `;
    document.head.appendChild(style);

    const palettes = [
      { id: 'blue', label: 'Blue', main: [64,174,255], deep: [38,153,235], light: [148,218,255], accent: [255,195,207] },
      { id: 'pink', label: 'Pink', main: [244,121,194], deep: [211,74,170], light: [255,186,225], accent: [210,182,255] },
      { id: 'mint', label: 'Mint', main: [91,218,166], deep: [40,180,133], light: [179,255,216], accent: [156,222,255] },
      { id: 'gold', label: 'Gold', main: [246,189,89], deep: [221,144,47], light: [255,224,154], accent: [255,180,153] }
    ];
    let palette = palettes[0];
    const rgba = (rgb, alpha) => 'rgba(' + rgb.join(',') + ',' + alpha + ')';
    root.innerHTML = `
      <main class="instrument">
        <canvas id="strings" tabindex="0" aria-label="Drag between two points to create a gently pulsing string. Or press Enter, use arrow keys to set the endpoint, then Enter to finish. Escape cancels."></canvas>
        <p class="prompt" id="prompt"></p>
        <button class="clear" id="clear" type="button" aria-label="Clear all strings"></button>
        <div class="palette" role="group" aria-label="Wave color">
          ${palettes.map((item, index) => `<button class="swatch" id="wave-${item.id}" type="button" aria-label="${item.label} waves" aria-pressed="${index === 0}" style="--swatch: rgb(${item.main.join(',')})"></button>`).join('')}
        </div>
      </main>
    `;

    const canvas = document.getElementById('strings');
    const ctx = canvas.getContext('2d');
    const prompt = document.getElementById('prompt');
    const clearButton = document.getElementById('clear');
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
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
    let lastFrame = performance.now();
    let pulseSerial = 0;
    const pulseDuration = 1.05;
    // A Hann-shaped amplitude envelope starts/ends at exact silence with zero
    // slope. Audio-clock automation keeps the notes smooth even at low FPS.
    const pulseEnvelope = Float32Array.from({ length: 129 }, (_, i) => .16 * Math.pow(Math.sin(Math.PI * i / 128), 2));
    pulseEnvelope[0] = pulseEnvelope[128] = 0;

    const dbToGain = db => Math.pow(10, db / 20);
    const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

    const frequencyForLength = length => {
      const maxLength = Math.max(180, Math.hypot(width, height) * .82);
      const normalized = Math.max(0, Math.min(1, (length - 28) / (maxLength - 28)));
      return minFrequency + (maxFrequency - minFrequency) * Math.pow(normalized, .82);
    };

    const ensureAudio = () => {
      try {
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
        master.gain.value = dbToGain(masterDb);
        master.connect(compressor).connect(audio.destination);
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      return true;
      } catch (_) {
        audio = null;
        master = null;
        compressor = null;
        return false;
      }
    };

    const makeVoice = length => {
      if (!ensureAudio()) return null;
      const now = audio.currentTime;
      const frequency = frequencyForLength(length);
      const gain = audio.createGain();
      const overtoneGain = audio.createGain();
      const filter = audio.createBiquadFilter();
      const tone = audio.createOscillator();
      const shimmer = audio.createOscillator();
      tone.type = 'sine';
      // A near-pure sine hum: a very faint, exact octave, without beating.
      shimmer.type = 'sine';
      overtoneGain.gain.value = .025;
      filter.type = 'lowpass';
      filter.frequency.value = Math.min(1200, frequency * 1.7);
      filter.Q.value = .35;
      tone.frequency.value = frequency;
      shimmer.frequency.value = frequency * 2;
      gain.gain.setValueAtTime(0, now);
      tone.connect(gain);
      shimmer.connect(overtoneGain).connect(gain);
      gain.connect(filter).connect(master);
      tone.start();
      shimmer.start();
      return { tone, shimmer, gain, overtoneGain, filter, frequency, stopped: false,
        enabled: false, nextPulse: Infinity, interval: 2.2 + (pulseSerial++ % 4) * .14 };
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
      voice.tone.frequency.linearRampToValueAtTime(frequency, now + .12);
      voice.shimmer.frequency.linearRampToValueAtTime(frequency * 2, now + .12);
      voice.filter.frequency.setTargetAtTime(Math.min(1200, frequency * 1.7), now, .06);
    };

    const schedulePulses = () => {
      if (!audio || audio.state !== 'running' || document.hidden) return;
      const now = audio.currentTime;
      for (const string of strings) {
        const voice = string.voice;
        if (!voice || voice.stopped || !voice.enabled) continue;
        // Skip missed notes after a stall, never bunch them into a catch-up burst.
        if (voice.nextPulse < now) voice.nextPulse = now + .03;
        if (voice.nextPulse <= now + .12) {
          voice.gain.gain.setValueCurveAtTime(pulseEnvelope, voice.nextPulse, pulseDuration);
          voice.nextPulse += voice.interval;
        }
      }
    };

    const balanceVoices = () => {
      if (!audio || !master) return;
      const count = strings.filter(string => string.voice?.enabled && !string.voice.stopped).length;
      const level = count ? dbToGain(masterDb) / Math.sqrt(count) : 0;
      master.gain.setTargetAtTime(level, audio.currentTime, .06);
    };

    const stopVoice = voice => {
      if (!voice || voice.stopped || !audio) return;
      voice.stopped = true;
      const now = audio.currentTime;
      if (voice.gain.gain.cancelAndHoldAtTime) voice.gain.gain.cancelAndHoldAtTime(now);
      else {
        const level = voice.gain.gain.value;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(level, now);
      }
      voice.gain.gain.linearRampToValueAtTime(0, now + .12);
      voice.tone.stop(now + .4);
      voice.shimmer.stop(now + .4);
      setTimeout(() => {
        for (const node of [voice.tone, voice.shimmer, voice.overtoneGain, voice.gain, voice.filter]) {
          try { node.disconnect(); } catch (_) {}
        }
      }, 480);
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
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    };

    const stringPoint = (string, progress, time, phaseOffset = 0) => {
      const dx = string.end.x - string.start.x;
      const dy = string.end.y - string.start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const normalX = -dy / length;
      const normalY = dx / length;
      const envelope = Math.sin(progress * Math.PI);
      const cycles = 1.05 + Math.min(.65, length / 650) + phaseOffset * .12;
      const amplitude = Math.min(waveHeight * 1.15, waveHeight * (.5 + length / Math.max(width, height) * .5));
      const wave = Math.sin(progress * Math.PI * 2 * cycles - time * (.75 + string.speed * .35) + string.phase + phaseOffset) * amplitude * envelope;
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
      const alpha = active ? 1 : .95;
      // Four fine, separate curves, all converging exactly at both endpoints.
      // No thick glowing backing ribbons or stacked near-identical strands.
      const strands = [
        { phase: -.7, color: palette.accent, opacity: .98 },
        { phase: -.15, color: palette.light, opacity: .82 },
        { phase: .55, color: palette.main, opacity: .9 },
        { phase: 1.3, color: palette.accent, opacity: .92 }
      ];
      // A pair of translucent membranes follows the actual strand boundaries.
      // Crossings naturally form small filled lenses, with open gaps elsewhere.
      for (const [first, second] of [[0, 1], [2, 3]]) {
        ctx.beginPath();
        for (let i = 0; i <= 72; i++) {
          const point = stringPoint(string, i / 72, time, strands[first].phase);
          if (i === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        }
        for (let i = 72; i >= 0; i--) {
          const point = stringPoint(string, i / 72, time, strands[second].phase);
          ctx.lineTo(point.x, point.y);
        }
        ctx.closePath();
        ctx.shadowBlur = 0;
        ctx.fillStyle = rgba(palette.main, .22 * alpha);
        ctx.fill();
      }
      strands.forEach(strand => {
        strokeWave(string, time, strand.phase, rgba(strand.color, strand.opacity * alpha), .8, 0);
      });
      ctx.restore();
    };

    const frame = now => {
      const time = reducedMotion ? 0 : now / 1000;
      const dt = Math.min(.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBackground();
      schedulePulses();
      for (const string of strings) {
        if (!reducedMotion) string.phase += dt * string.drift;
        drawString(string, time, false);
      }
      if (draft) drawString(draft, time, true);
      requestAnimationFrame(frame);
    };

    const pointFromEvent = event => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(18, Math.min(width - 18, event.clientX - rect.left)),
        y: Math.max(95, Math.min(height - 130, event.clientY - rect.top))
      };
    };

    canvas.addEventListener('pointerdown', event => {
      if (event.isPrimary === false || (event.button !== undefined && event.button !== 0) || draft) return;
      event.preventDefault();
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
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
      balanceVoices();
      prompt.classList.add('hidden');
      prompt.setAttribute('aria-hidden', 'true');
    });

    canvas.addEventListener('pointermove', event => {
      if (!draft || event.pointerId !== draft.pointerId) return;
      event.preventDefault();
      draft.end = pointFromEvent(event);
      const length = distance(draft.start, draft.end);
      updateVoice(draft.voice, length);
    });

    const finishDraft = (event, cancelled = false) => {
      if (!draft || event.pointerId !== draft.pointerId) return;
      const finished = draft;
      draft = null;
      try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch (_) {}
      const length = distance(finished.start, finished.end);
      if (cancelled || length < 34) {
        stopVoice(finished.voice);
        balanceVoices();
        if (!strings.length) { prompt.classList.remove('hidden'); prompt.removeAttribute('aria-hidden'); }
        return;
      }
      strings.push(finished);
      while (strings.length > maxStrings) {
        const removed = strings.shift();
        stopVoice(removed.voice);
      }
      updateVoice(finished.voice, length);
      if (finished.voice && audio) {
        finished.voice.enabled = true;
        finished.voice.nextPulse = audio.currentTime + .03;
      }
      balanceVoices();
      schedulePulses();
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
      balanceVoices();
      prompt.classList.remove('hidden');
      prompt.removeAttribute('aria-hidden');
      if (navigator.vibrate) navigator.vibrate(10);
    };

    clearButton.addEventListener('click', event => {
      event.stopPropagation();
      clearStrings();
    });

    palettes.forEach(item => {
      document.getElementById('wave-' + item.id).addEventListener('click', event => {
        event.stopPropagation();
        palette = item;
        palettes.forEach(option => document.getElementById('wave-' + option.id).setAttribute('aria-pressed', String(option === item)));
      });
    });

    // Keyboard alternative uses the same drawing, pitch, clear and cancel path.
    canvas.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (draft?.pointerId === 'keyboard') finishDraft({ pointerId: 'keyboard' });
        else if (!draft) {
          const point = { x: width * .35, y: height * .5 };
          draft = { pointerId: 'keyboard', start: point, end: { x: point.x + 80, y: point.y }, phase: 0, speed: .5, drift: .2, voice: makeVoice(80) };
          balanceVoices();
          prompt.classList.add('hidden'); prompt.setAttribute('aria-hidden', 'true');
        }
      } else if (event.key === 'Escape' && draft?.pointerId === 'keyboard') {
        event.preventDefault(); finishDraft({ pointerId: 'keyboard' }, true);
      } else if (draft?.pointerId === 'keyboard' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 40 : 12;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        draft.end.x = Math.max(18, Math.min(width - 18, draft.end.x + dx));
        draft.end.y = Math.max(95, Math.min(height - 130, draft.end.y + dy));
        updateVoice(draft.voice, distance(draft.start, draft.end));
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && draft) finishDraft({ pointerId: draft.pointerId }, true);
      if (!audio) return;
      if (document.hidden) {
        audio.suspend().catch(() => {});
      } else if (strings.length || draft) audio.resume().catch(() => {});
    });

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  };

  start();
})();
