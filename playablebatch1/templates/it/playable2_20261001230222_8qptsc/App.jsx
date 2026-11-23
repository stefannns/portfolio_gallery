import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable instrument. Rebuild using the platform app/h5_build/build.js.
const PACKAGE_CONFIG_FALLBACK = {
  "tweaks": [{
    "id": "VOLUME",
    "kind": "number",
    "label": "Master Volume (dB)",
    "value": -20,
    "default": -20,
    "min": -36,
    "max": -8,
    "step": 1
  }, {
    "id": "MIN_FREQUENCY",
    "kind": "number",
    "label": "Shortest String Frequency",
    "value": 110,
    "default": 110,
    "min": 60,
    "max": 240,
    "step": 5
  }, {
    "id": "MAX_FREQUENCY",
    "kind": "number",
    "label": "Longest String Frequency",
    "value": 760,
    "default": 760,
    "min": 420,
    "max": 1200,
    "step": 10
  }, {
    "id": "WAVE_HEIGHT",
    "kind": "number",
    "label": "Wave Height",
    "value": 22,
    "default": 22,
    "min": 8,
    "max": 42,
    "step": 2
  }, {
    "id": "MAX_STRINGS",
    "kind": "number",
    "label": "Maximum Strings",
    "value": 8,
    "default": 8,
    "min": 3,
    "max": 12,
    "step": 1
  }],
  "texts": [{
    "id": "TEXT_PROMPT",
    "label": "Interaction Prompt",
    "value": "TRASCINA TRA DUE PUNTI",
    "default": "TRASCINA TRA DUE PUNTI",
    "max_length": 36
  }],
  "images": [],
  "config_version": "2.0",
  "playable": {
    "post_id": "99279771737181559",
    "version_id": "99279771737000613",
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "it",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const INSTRUMENT_STYLES = "\n    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }\n    body { background: #020306; -webkit-tap-highlight-color: transparent; }\n  \n\n@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}\n.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}\n.feed-first-action[aria-hidden=\"true\"]{animation:none}\nhtml[data-feed-background] .feed-first-action{animation-play-state:paused}\n@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}\n\nhtml[data-batch2-idle=\"true\"] #clear{display:none!important}\n      :root { --ui-unit: min(0.2564102564vw, 0.1672240803vh); color-scheme: dark; font-family: Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif; }\n      * { box-sizing: border-box; }\n      html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }\n      body { background: #020306; user-select: none; -webkit-user-select: none; touch-action: none; }\n      .instrument { position: relative; width: 100%; height: 100%; overflow: hidden; background: #020306; }\n      canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: crosshair; }\n      .prompt {\n        position: absolute;\n        z-index: 2;\n        top: 26%;\n        left: calc(30 * var(--ui-unit) + env(safe-area-inset-left, 0px));\n        right: calc(30 * var(--ui-unit) + env(safe-area-inset-right, 0px));\n        margin: 0;\n        transform: translateY(-50%);\n        color: rgba(222,232,248,.72);\n        font-size: calc(18 * var(--ui-unit));\n        font-weight: 750;\n        line-height: 1.35;\n        letter-spacing: .04em;\n        overflow-wrap: anywhere;\n        text-align: center;\n        text-wrap: balance;\n        pointer-events: none;\n        text-shadow: 0 2px 16px #000;\n        transition: opacity .25s ease;\n      }\n      .prompt.hidden { opacity: 0; }\n      .palette {\n        position: absolute; z-index: 3; left: 50%; transform: translateX(-50%);\n        bottom: calc(50 * var(--ui-unit) + env(safe-area-inset-bottom, 0px));\n        display: flex; gap: 8px;\n      }\n      .swatch {\n        position: relative; width: 44px; height: 44px; padding: 6px;\n        border: 2px solid transparent; border-radius: 50%; background: transparent;\n        cursor: pointer; touch-action: manipulation;\n        transition: border-color .15s ease, background-color .15s ease;\n      }\n      .swatch::before { content: ''; display: block; width: 100%; height: 100%; border-radius: 50%; background: var(--swatch); }\n      .swatch[aria-pressed=\"true\"] { border-color: #eff7ff; }\n      .swatch:active, .clear:active { background-color: rgba(255,255,255,.12); }\n      .swatch:focus-visible, canvas:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }\n      .clear {\n        position: absolute;\n        z-index: 3;\n        top: calc(30 * var(--ui-unit) + env(safe-area-inset-top, 0px) + 6px);\n        right: calc(30 * var(--ui-unit) + env(safe-area-inset-right, 0px) + 6px);\n        width: 48px;\n        height: 48px;\n        border: 0;\n        background: transparent;\n        color: rgba(235,239,247,.76);\n        cursor: pointer;\n      }\n      .clear::before, .clear::after {\n        content: '';\n        position: absolute;\n        left: 8px;\n        right: 8px;\n        top: 23px;\n        height: 3px;\n        border-radius: 99px;\n        background: currentColor;\n      }\n      .clear::before { transform: rotate(45deg); }\n      .clear::after { transform: rotate(-45deg); }\n      .clear::before,.clear::after{display:none}.clear{display:grid;place-items:center}html[data-batch2-idle=\"true\"] .palette{bottom:29%}\n      .clear:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }\n      @media (prefers-reduced-motion: reduce) { .prompt, .swatch { transition-duration: .01ms; } }\n    \n.startupError{position:absolute;z-index:6;left:30px;right:30px;top:38%;text-align:center;color:#e8f1ff;font:600 16px/1.5 sans-serif}.startupError button{display:block;margin:12px auto;padding:10px 20px;border:1px solid #a9d3ee;background:#152d40;color:#fff;border-radius:24px}";
const palettes = [{
        id: 'blue',
        label: "Blu",
        main: [64, 174, 255],
        deep: [38, 153, 235],
        light: [148, 218, 255],
        accent: [255, 195, 207]
      }, {
        id: 'pink',
        label: "Rosa",
        main: [244, 121, 194],
        deep: [211, 74, 170],
        light: [255, 186, 225],
        accent: [210, 182, 255]
      }, {
        id: 'mint',
        label: "Menta",
        main: [91, 218, 166],
        deep: [40, 180, 133],
        light: [179, 255, 216],
        accent: [156, 222, 255]
      }, {
        id: 'gold',
        label: "Oro",
        main: [246, 189, 89],
        deep: [221, 144, 47],
        light: [255, 224, 154],
        accent: [255, 180, 153]
      }];
function queryMedia(query) {
  try { return typeof window.matchMedia === 'function' ? window.matchMedia(query) : {matches:false}; }
  catch (_) { return {matches:false}; }
}
// Inlined into each editable App.jsx; never shipped as an external script.
function bindSurfaceGesture(surface, callbacks) {
  let active = null;
  const options = {passive: false, capture: true};
  const consume = event => {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };
  const sample = (event, point, family) => ({
    clientX: Number.isFinite(point.clientX) ? point.clientX : point.pageX - (window.scrollX || 0),
    clientY: Number.isFinite(point.clientY) ? point.clientY : point.pageY - (window.scrollY || 0),
    pointerId: family === 'touch' ? point.identifier : point.pointerId,
    pointerType: family === 'touch' ? 'touch' : event.pointerType,
    isPrimary: event.isPrimary,
    button: family === 'touch' ? 0 : event.button,
    currentTarget: surface
  });
  const begin = (event, point, family) => {
    if (active || event.isPrimary === false || (family === 'pointer' && event.pointerType === 'mouse' && event.button !== 0)) return;
    const next = sample(event, point, family);
    if (!Number.isFinite(next.clientX) || !Number.isFinite(next.clientY) || callbacks.start(next) === false) return;
    active = {family, id: next.pointerId};
    if (family === 'pointer') {
      try { surface.setPointerCapture?.(next.pointerId); } catch (_) {}
    }
    consume(event);
  };
  const findTouch = event => {
    for (let i = 0; i < event.changedTouches.length; i++) {
      const point = event.changedTouches[i];
      if (point.identifier === active.id) return point;
    }
    return null;
  };
  const move = (event, family) => {
    if (!active || active.family !== family) return;
    const point = family === 'touch' ? findTouch(event) : event.pointerId === active.id ? event : null;
    if (!point) return;
    consume(event);
    callbacks.move(sample(event, point, family));
  };
  const end = (event, family, cancelled) => {
    if (!active || active.family !== family) return;
    const point = family === 'touch' ? findTouch(event) : event.pointerId === active.id ? event : null;
    if (!point) return;
    const next = sample(event, point, family);
    active = null;
    if (family === 'pointer') {
      try { if (surface.hasPointerCapture?.(next.pointerId)) surface.releasePointerCapture(next.pointerId); } catch (_) {}
    }
    consume(event);
    callbacks.end(next, cancelled);
  };
  const stop = () => {
    if (!active) return;
    const id = active.id, family = active.family;
    active = null;
    if (family === 'pointer') {
      try { if (surface.hasPointerCapture?.(id)) surface.releasePointerCapture(id); } catch (_) {}
    }
    callbacks.end({pointerId: id}, true);
  };
  const lost = event => { if (active?.family === 'pointer' && active.id === event.pointerId) stop(); };
  const down = event => begin(event, event, 'pointer');
  const touch = event => {
    if (!active && event.changedTouches.length) begin(event, event.changedTouches[0], 'touch');
  };
  const pointerMove = event => move(event, 'pointer');
  const touchMove = event => move(event, 'touch');
  const up = event => end(event, 'pointer', false);
  const cancel = event => end(event, 'pointer', true);
  const touchUp = event => end(event, 'touch', false);
  const touchCancel = event => end(event, 'touch', true);
  const hidden = () => { if (document.hidden) stop(); };
  surface.addEventListener('pointerdown', down, options);
  surface.addEventListener('lostpointercapture', lost);
  surface.addEventListener('touchstart', touch, options);
  window.addEventListener('pointermove', pointerMove, options);
  window.addEventListener('pointerup', up, options);
  window.addEventListener('pointercancel', cancel, options);
  window.addEventListener('touchmove', touchMove, options);
  window.addEventListener('touchend', touchUp, options);
  window.addEventListener('touchcancel', touchCancel, options);
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', hidden);
  return () => {
    stop();
    surface.removeEventListener('pointerdown', down, options);
    surface.removeEventListener('lostpointercapture', lost);
    surface.removeEventListener('touchstart', touch, options);
    window.removeEventListener('pointermove', pointerMove, options);
    window.removeEventListener('pointerup', up, options);
    window.removeEventListener('pointercancel', cancel, options);
    window.removeEventListener('touchmove', touchMove, options);
    window.removeEventListener('touchend', touchUp, options);
    window.removeEventListener('touchcancel', touchCancel, options);
    window.removeEventListener('blur', stop);
    document.removeEventListener('visibilitychange', hidden);
  };
}
function createInstrumentPreview(canvas) {
  const query = new URLSearchParams(location.search);
  let preview = query.get('feedReview') === '1' || query.get('host') === 'fyp';
  let elapsed = 0, last = performance.now();
  const reduced = queryMedia('(prefers-reduced-motion: reduce)').matches;
  const listeners = new Set();
  const sync = () => {
    document.documentElement.dataset.batch2Idle = String(preview);
    last = performance.now();
    listeners.forEach(fn => fn());
  };
  const message = event => {
    if (parent === window || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    preview = event.data.active !== true;
    sync();
  };
  window.addEventListener('message', message);
  document.addEventListener('visibilitychange', sync);
  sync();
  return {
    get active() { return preview && !document.hidden; },
    get preview() { return preview; },
    get seconds() {
      const now = performance.now();
      if (preview && !document.hidden && !reduced) elapsed += Math.min(64, Math.max(0, now - last));
      last = now;
      return reduced ? 1.6 : elapsed / 1000;
    },
    stamp(target, kind) { target.dataset.idlePreview = preview ? kind : 'off'; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() {
      window.removeEventListener('message', message);
      document.removeEventListener('visibilitychange', sync);
      listeners.clear();
    }
  };
}
    const flattenConfig = raw => {
      const out = {};
      for (const section of ['tweaks', 'texts', 'images']) {
        for (const item of raw[section] || []) out[item.id] = item.value ?? item.path;
      }
      return out;
    };
    const loadConfig = () => new Promise(resolve => {
      let settled = false;
      const finish = config => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(config);
      };
      const timer = setTimeout(() => finish({}), 1200);
      try {
        fetch('./game.config.json', {cache: 'no-store'})
          .then(response => response.ok ? response.json() : null)
          .then(raw => finish(raw ? flattenConfig(raw) : {}))
          .catch(() => finish({}));
      } catch (_) { finish({}); }
    });
function startInstrument(root) {
  const cfg = flattenConfig(PACKAGE_CONFIG_FALLBACK);
  const canvas = root.querySelector('#strings');
  const prompt = root.querySelector('#prompt');
  const clearButton = root.querySelector('#clear');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Instrument canvas context unavailable');
  const idle = createInstrumentPreview(canvas);
  let palette = palettes[0];
  const rgba = (rgb, alpha) => 'rgba(' + rgb.join(',') + ',' + alpha + ')';
      let minFrequency = Math.max(40, Number(cfg.MIN_FREQUENCY) || 110);
      let maxFrequency = Math.max(minFrequency + 50, Number(cfg.MAX_FREQUENCY) || 760);
      let waveHeight = Math.max(6, Number(cfg.WAVE_HEIGHT) || 22);
      let maxStrings = Math.max(2, Math.round(Number(cfg.MAX_STRINGS) || 8));
      let masterDb = Number.isFinite(Number(cfg.VOLUME)) ? Number(cfg.VOLUME) : -20;
      let width = 1;
      let height = 1;
      let dpr = 1;
      let strings = [];
      let draft = null;
      let audio = null;
      let master = null;
      let compressor = null;
      const reducedMotion = queryMedia('(prefers-reduced-motion: reduce)').matches;
      let lastFrame = performance.now();
      let disposed = false, animationFrame = 0;
      let pulseSerial = 0;
      const pulseDuration = 1.05;
      // A Hann-shaped amplitude envelope starts/ends at exact silence with zero
      // slope. Audio-clock automation keeps the notes smooth even at low FPS.
      const pulseEnvelope = Float32Array.from({
        length: 129
      }, (_, i) => .16 * Math.pow(Math.sin(Math.PI * i / 128), 2));
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
        try {
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
        return {
          tone,
          shimmer,
          gain,
          overtoneGain,
          filter,
          frequency,
          stopped: false,
          enabled: false,
          nextPulse: Infinity,
          interval: 2.2 + pulseSerial++ % 4 * .14
        };

        } catch (_) { return null; }
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
        if (voice.gain.gain.cancelAndHoldAtTime) voice.gain.gain.cancelAndHoldAtTime(now);else {
          const level = voice.gain.gain.value;
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(level, now);
        }
        voice.gain.gain.linearRampToValueAtTime(0, now + .12);
        voice.tone.stop(now + .4);
        voice.shimmer.stop(now + .4);
        setTimeout(() => {
          for (const node of [voice.tone, voice.shimmer, voice.overtoneGain, voice.gain, voice.filter]) {
            try {
              node.disconnect();
            } catch (_) {}
          }
        }, 480);
      };
      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        width = Math.max(1, rect.width || root.clientWidth || window.innerWidth || 390);
        height = Math.max(1, rect.height || root.clientHeight || window.innerHeight || 598);
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
        const strands = [{
          phase: -.7,
          color: palette.accent,
          opacity: .98
        }, {
          phase: -.15,
          color: palette.light,
          opacity: .82
        }, {
          phase: .55,
          color: palette.main,
          opacity: .9
        }, {
          phase: 1.3,
          color: palette.accent,
          opacity: .92
        }];
        // A pair of translucent membranes follows the actual strand boundaries.
        // Crossings naturally form small filled lenses, with open gaps elsewhere.
        for (const [first, second] of [[0, 1], [2, 3]]) {
          ctx.beginPath();
          for (let i = 0; i <= 72; i++) {
            const point = stringPoint(string, i / 72, time, strands[first].phase);
            if (i === 0) ctx.moveTo(point.x, point.y);else ctx.lineTo(point.x, point.y);
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
        if (disposed) return;
        if (!Number.isFinite(now)) now = performance.now();
        const time = reducedMotion ? 0 : now / 1000;
        const dt = Math.min(.05, Math.max(0, (now - lastFrame) / 1000));
        lastFrame = now;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawBackground();
        if (!idle.preview) schedulePulses();
        if (idle.active) {
          const t = idle.seconds;
          const demos = [{
            start: {
              x: width * .18,
              y: height * .39
            },
            end: {
              x: width * .80,
              y: height * .53
            },
            speed: 1.1,
            phase: 0,
            drift: .1
          }, {
            start: {
              x: width * .22,
              y: height * .59
            },
            end: {
              x: width * .76,
              y: height * .42
            },
            speed: .9,
            phase: 1.4,
            drift: .1
          }];
          demos.forEach((line, index) => {
            ctx.save();
            ctx.globalAlpha = Math.min(1, Math.max(.2, (t - index * .4) * 1.5));
            drawString(line, t, false);
            ctx.restore();
          });
          idle.stamp(canvas, 'silent-wave-strings');
        }
        for (const string of strings) {
          if (!reducedMotion) string.phase += dt * string.drift;
          drawString(string, time, false);
        }
        if (draft) drawString(draft, time, true);
        animationFrame = requestAnimationFrame(frame);
      };
      const pointFromEvent = event => {
        const rect = canvas.getBoundingClientRect();
        return {
          x: Math.max(18, Math.min(width - 18, event.clientX - rect.left)),
          y: Math.max(95, Math.min(height - 130, event.clientY - rect.top))
        };
      };
      const beginDraft = event => {
        if (event.isPrimary === false || event.button !== undefined && event.button !== 0 || draft && draft.pointerId !== null) return;
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch (_) {}
        const point = pointFromEvent(event);
        if (draft) {
          draft.pointerId = event.pointerId;
          draft.end = point;
          return;
        }
        draft = {
          pointerId: event.pointerId,
          start: point,
          end: {
            ...point
          },
          phase: Math.random() * Math.PI * 2,
          speed: .35 + Math.random() * .45,
          drift: .14 + Math.random() * .18,
          voice: makeVoice(1)
        };
        balanceVoices();
        prompt.classList.add('hidden');
        prompt.setAttribute('aria-hidden', 'true');
      };
      const moveDraft = event => {
        if (!draft || event.isPrimary === false || draft.pointerId !== null && event.pointerId !== draft.pointerId) return;
        draft.end = pointFromEvent(event);
        const length = distance(draft.start, draft.end);
        updateVoice(draft.voice, length);
      };
      const finishDraft = (event, cancelled = false) => {
        if (!draft || event.pointerId !== draft.pointerId) return;
        if (!cancelled && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) draft.end = pointFromEvent(event);
        const finished = draft;
        const length = distance(finished.start, finished.end);
        if (!cancelled && length < 34 && event.pointerId !== 'keyboard') {
          finished.pointerId = null;
          try {
            if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
          } catch (_) {}
          return;
        }
        draft = null;
        try {
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        } catch (_) {}
        if (cancelled || length < 34) {
          stopVoice(finished.voice);
          balanceVoices();
          if (!strings.length) {
            prompt.classList.remove('hidden');
            prompt.removeAttribute('aria-hidden');
          }
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
      const unbindInput = bindSurfaceGesture(canvas, {
        start: beginDraft,
        move: moveDraft,
        end: finishDraft
      });
      const clearStrings = () => {
        if (draft) {
          const pointer = draft.pointerId;
          stopVoice(draft.voice);
          draft = null;
          try {
            if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
          } catch (_) {}
        }
        strings.forEach(string => stopVoice(string.voice));
        strings = [];
        balanceVoices();
        prompt.classList.remove('hidden');
        prompt.removeAttribute('aria-hidden');
        if (navigator.vibrate) navigator.vibrate(10);
      };
      const controlCleanup = [];
      const activate = (element, action) => {
        controlCleanup.push(bindSurfaceGesture(element, {start() { action(); }, move() {}, end() {}}));
        const keyboardClick = event => { if (event.detail === 0) action(); };
        element.addEventListener('click', keyboardClick);
        controlCleanup.push(() => element.removeEventListener('click', keyboardClick));
      };
      activate(clearButton, clearStrings);
      palettes.forEach(item => {
        activate(root.querySelector('#wave-' + item.id), () => {
          palette = item;
          palettes.forEach(option => root.querySelector('#wave-' + option.id).setAttribute('aria-pressed', String(option === item)));
        });
      });
      // Keyboard alternative uses the same drawing, pitch, clear and cancel path.
      const onKeyDown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
            if (draft?.pointerId === 'keyboard') finishDraft({
            pointerId: 'keyboard'
          });else if (!draft) {
            const point = {
              x: width * .35,
              y: height * .5
            };
            draft = {
              pointerId: 'keyboard',
              start: point,
              end: {
                x: point.x + 80,
                y: point.y
              },
              phase: 0,
              speed: .5,
              drift: .2,
              voice: makeVoice(80)
            };
            balanceVoices();
            prompt.classList.add('hidden');
            prompt.setAttribute('aria-hidden', 'true');
          }
        } else if (event.key === 'Escape' && draft) {
            finishDraft({
            pointerId: draft.pointerId
          }, true);
        } else if (draft?.pointerId === 'keyboard' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            const step = event.shiftKey ? 40 : 12;
          const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
          const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
          draft.end.x = Math.max(18, Math.min(width - 18, draft.end.x + dx));
          draft.end.y = Math.max(95, Math.min(height - 130, draft.end.y + dy));
          updateVoice(draft.voice, distance(draft.start, draft.end));
        }
      };
      canvas.addEventListener('keydown', onKeyDown);
      const onVisibility = () => {
        if (document.hidden && draft) finishDraft({
          pointerId: draft.pointerId
        }, true);
        if (!audio) return;
        if (document.hidden) {
          audio.suspend().catch(() => {});
        } else if (strings.length || draft) audio.resume().catch(() => {});
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('resize', resize);
      let observer = null;
      try {
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(resize);
          observer.observe(canvas);
        }
      } catch (_) { observer = null; }
      const unsubscribe = idle.subscribe(resize);
      resize();
      canvas.dataset.ready = 'true';
      frame(performance.now());
      loadConfig().then(fresh => {
        if (disposed) return;
        Object.assign(cfg, fresh);
        prompt.textContent = cfg.TEXT_PROMPT || "TRASCINA TRA DUE PUNTI";
        minFrequency = Math.max(40, Number(cfg.MIN_FREQUENCY) || 110);
        maxFrequency = Math.max(minFrequency + 50, Number(cfg.MAX_FREQUENCY) || 760);
        waveHeight = Math.max(6, Number(cfg.WAVE_HEIGHT) || 22);
        maxStrings = Math.max(2, Math.round(Number(cfg.MAX_STRINGS) || 8));
        masterDb = Number.isFinite(Number(cfg.VOLUME)) ? Number(cfg.VOLUME) : -20;
        balanceVoices();
      });
      return () => {
        disposed = true;
        cancelAnimationFrame(animationFrame);
        unbindInput();
        canvas.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('visibilitychange', onVisibility);
        controlCleanup.forEach(remove => remove());
        observer?.disconnect();
        unsubscribe();
        idle.dispose();
        window.removeEventListener('resize', resize);
        strings.forEach(string => stopVoice(string.voice));
        if (draft) stopVoice(draft.voice);
        try { audio?.close()?.catch(() => {}); } catch (_) {}
      };
}
function App() {
  const rootRef = React.useRef(null);
  const [startupError, setStartupError] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    document.documentElement.lang = 'it';
    setStartupError(false);
    try { return startInstrument(rootRef.current); }
    catch (error) {
      rootRef.current.dataset.startupError = String(error?.message || error);
      console.error('[instrument] startup', error);
      setStartupError(true);
    }
  }, [attempt]);
  return <main ref={rootRef} className="instrument" style={{position:'relative',width:'100%',height:'100%',minHeight:'100%',background:'#020306',color:'#dee8f8'}}>
    <style>{INSTRUMENT_STYLES}</style>
    <canvas id="strings" tabIndex="0" aria-label="Trascina o tocca due punti per creare una corda pulsante. Oppure premi Invio, imposta il punto finale con le frecce e premi di nuovo Invio. Esc annulla." />
    <p className="prompt feed-first-action" id="prompt">TRASCINA TRA DUE PUNTI</p>
    <button className="clear" id="clear" type="button" aria-label="Onde: Ricomincia lo strumento"><svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1.6 7.2M4 4v6h6" /></svg></button>
    <div className="palette" role="group" aria-label="Colore delle onde">
      {palettes.map((item,index) => <button className="swatch" id={'wave-'+item.id} key={item.id} type="button" aria-label={'Onde: '+item.label} aria-pressed={index===0} style={{'--swatch':'rgb('+item.main.join(',')+')'}} />)}
    </div>
    {startupError && <div className="startupError" role="alert">Impossibile avviare il disegno.<button type="button" onClick={() => setAttempt(n => n+1)}>Riprova</button></div>}
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
