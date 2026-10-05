(()=>{
  'use strict';

  const flattenConfig = raw => {
    const out = {};
    for (const section of ['tweaks', 'texts', 'images', 'motions']) {
      for (const item of raw[section] || []) {
        if (section === 'motions') {
          out[item.id + '_BASE'] = item.base_path;
          out[item.id + '_COUNT'] = item.frame_count;
        } else out[item.id] = item.value ?? item.path;
      }
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
      body { background: #11151d; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
      .storm { position: relative; width: 100%; height: 100%; overflow: hidden; background: #11151d; }
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: manipulation; cursor: crosshair; }
      .hud {
        position: absolute;
        z-index: 2;
        top: calc(40px + env(safe-area-inset-top));
        left: max(25px, env(safe-area-inset-left));
        right: max(25px, env(safe-area-inset-right));
        pointer-events: none;
        text-align: center;
        filter: drop-shadow(0 3px 12px rgba(0,0,0,.72));
      }
      .guide {
        max-width: 420px;
        margin: 0 auto;
        color: rgba(226,232,242,.72);
        font-size: clamp(14px, 3.8vw, 19px);
        font-weight: 600;
        line-height: 1.35;
        transition: opacity .35s ease, transform .35s ease;
      }
      .guide.hidden { opacity: 0; transform: translateY(-5px); }
      .counter {
        position: absolute;
        z-index: 2;
        left: max(25px, env(safe-area-inset-left));
        bottom: calc(40px + env(safe-area-inset-bottom));
        min-width: 104px;
        min-height: 46px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 16px;
        border: 1px solid rgba(255,255,255,.13);
        border-radius: 999px;
        background: rgba(13,17,25,.62);
        backdrop-filter: blur(10px);
        color: rgba(241,245,252,.86);
        font-size: 13px;
        font-weight: 750;
        letter-spacing: .12em;
        pointer-events: none;
      }
      .sound {
        position: absolute;
        z-index: 3;
        right: max(25px, env(safe-area-inset-right));
        bottom: calc(40px + env(safe-area-inset-bottom));
        width: 48px;
        height: 48px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(255,255,255,.15);
        border-radius: 50%;
        background: rgba(13,17,25,.68);
        color: #f3f6fc;
        backdrop-filter: blur(10px);
        cursor: pointer;
      }
      .sound svg { width: 23px; height: 23px; }
      .sound:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }
      .tap-ripple {
        position: absolute;
        z-index: 2;
        width: 28px;
        height: 28px;
        border: 2px solid rgba(216,231,255,.85);
        border-radius: 50%;
        pointer-events: none;
        transform: translate(-50%, -50%) scale(.25);
        animation: ripple .55s ease-out forwards;
      }
      @keyframes ripple { to { opacity: 0; transform: translate(-50%, -50%) scale(3.2); } }
      @media (prefers-reduced-motion: reduce) {
        .tap-ripple { animation-duration: .2s; }
        .guide { transition-duration: .01ms; }
      }
    `;
    document.head.appendChild(style);

    root.innerHTML = `
      <main class="storm">
        <canvas id="sky" aria-label="Moving storm clouds. Tap anywhere to create lightning."></canvas>
        <header class="hud">
          <p class="guide" id="guide"></p>
        </header>
        <div class="counter" id="counter">STRIKES 0</div>
        <button class="sound" id="sound" type="button" aria-label="Mute rain and thunder" aria-pressed="false">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path id="soundWaves" d="M16 8.2a5 5 0 0 1 0 7.6M18.7 5.5a9 9 0 0 1 0 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </main>
    `;

    const canvas = document.getElementById('sky');
    const ctx = canvas.getContext('2d', { alpha: false });
    const guide = document.getElementById('guide');
    const counter = document.getElementById('counter');
    const soundButton = document.getElementById('sound');
    const soundWaves = document.getElementById('soundWaves');
    guide.textContent = cfg.GUIDE_TEXT || 'Tap the clouds to call lightning';

    const cloudSpeed = Math.max(.05, Number(cfg.CLOUD_SPEED) || .34);
    const cloudDensity = Math.max(8, Math.min(30, Math.round(Number(cfg.CLOUD_DENSITY) || 18)));
    const lightningGlow = Math.max(8, Number(cfg.LIGHTNING_GLOW) || 30);
    const thunderVolume = Math.max(0, Math.min(.6, Number(cfg.THUNDER_VOLUME) || .28));
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let clouds = [];
    let bolts = [];
    let puffSprites = [];
    let lastFrame = performance.now();
    let flash = 0;
    let strikeCount = 0;
    let muted = false;
    let audio = null;
    let rainBuffer = null;
    let rainSource = null;
    let rainGain = null;
    let hasInteracted = false;

    const seeded = seed => {
      let value = seed >>> 0;
      return () => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 4294967296;
      };
    };

    const makePuffSprite = (depth, shadow = false) => {
      const sprite = document.createElement('canvas');
      sprite.width = 768;
      sprite.height = 768;
      const g = sprite.getContext('2d');
      const base = depth === 0 ? 155 : depth === 1 ? 125 : 92;
      const center = sprite.width / 2;
      const gradient = g.createRadialGradient(center, center * .86, 5, center, center, center);
      if (shadow) {
        const low = Math.max(12, base - 72);
        gradient.addColorStop(0, 'rgba(' + low + ',' + (low + 6) + ',' + (low + 16) + ',.34)');
        gradient.addColorStop(.48, 'rgba(' + low + ',' + (low + 6) + ',' + (low + 16) + ',.2)');
        gradient.addColorStop(.78, 'rgba(' + low + ',' + (low + 6) + ',' + (low + 16) + ',.055)');
      } else {
        const lift = Math.min(228, base + 42);
        gradient.addColorStop(0, 'rgba(' + lift + ',' + (lift + 5) + ',' + Math.min(244, lift + 14) + ',.9)');
        gradient.addColorStop(.46, 'rgba(' + base + ',' + (base + 5) + ',' + (base + 14) + ',.66)');
        gradient.addColorStop(.78, 'rgba(' + Math.max(18, base - 55) + ',' + Math.max(22, base - 48) + ',' + Math.max(30, base - 35) + ',.12)');
      }
      gradient.addColorStop(1, 'rgba(15,19,28,0)');
      g.fillStyle = gradient;
      g.fillRect(0, 0, sprite.width, sprite.height);
      return sprite;
    };

    const buildSprites = () => {
      puffSprites = Array.from({ length: 3 }, (_, depth) => ({
        light: makePuffSprite(depth, false),
        shadow: makePuffSprite(depth, true)
      }));
    };

    const makeCloudPuffs = seed => {
      const random = seeded(seed);
      const puffs = [];
      for (let i = 0; i < 7; i++) {
        puffs.push({
          shadow: true,
          x: .1 + random() * .8,
          y: .56 + random() * .22,
          w: .25 + random() * .2,
          h: .48 + random() * .24
        });
      }
      for (let i = 0; i < 16; i++) {
        puffs.push({
          shadow: false,
          x: .06 + random() * .88,
          y: .19 + random() * .5,
          w: .2 + random() * .24,
          h: .48 + random() * .4
        });
      }
      return puffs;
    };

    const createCloud = (index, randomX = true) => {
      const depth = index % 3;
      const scale = (.72 + Math.random() * .62) * (depth === 0 ? .8 : depth === 1 ? 1 : 1.2);
      return {
        depth,
        x: randomX ? Math.random() * (width + 500) - 250 : -650,
        y: height * (.12 + Math.random() * .66),
        w: 420 * scale,
        h: 184 * scale,
        speed: (9 + depth * 7 + Math.random() * 8) * cloudSpeed * (reducedMotion ? .45 : 1),
        opacity: depth === 0 ? .36 : depth === 1 ? .5 : .66,
        drift: Math.random() * Math.PI * 2,
        puffs: makeCloudPuffs(Math.floor(Math.random() * 1000000000))
      };
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(3, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (!puffSprites.length) buildSprites();
      clouds = Array.from({ length: cloudDensity }, (_, index) => createCloud(index, true));
      clouds.sort((a, b) => a.depth - b.depth);
    };

    const drawSky = time => {
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#111723');
      sky.addColorStop(.42, '#252a35');
      sky.addColorStop(.72, '#3a3a43');
      sky.addColorStop(1, '#171a22');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      const twilight = ctx.createRadialGradient(width * .5, height * .64, 0, width * .5, height * .64, width * .78);
      twilight.addColorStop(0, 'rgba(198,202,213,.13)');
      twilight.addColorStop(.48, 'rgba(119,125,140,.07)');
      twilight.addColorStop(1, 'rgba(20,23,31,0)');
      ctx.fillStyle = twilight;
      ctx.fillRect(0, 0, width, height);

      const mist = ctx.createLinearGradient(0, height * .68, 0, height);
      mist.addColorStop(0, 'rgba(18,22,31,0)');
      mist.addColorStop(.56, 'rgba(13,17,24,.19)');
      mist.addColorStop(1, 'rgba(7,10,15,.58)');
      ctx.fillStyle = mist;
      ctx.fillRect(0, height * .68, width, height * .32);
    };

    const drawClouds = (dt, time) => {
      for (const cloud of clouds) {
        cloud.x += cloud.speed * dt;
        if (cloud.x > width + cloud.w * .55) {
          const fresh = createCloud(cloud.depth, false);
          Object.assign(cloud, fresh, { depth: cloud.depth, x: -fresh.w * .72 });
        }
        const bob = Math.sin(time * .00018 + cloud.drift) * (3 + cloud.depth * 2);
        ctx.save();
        ctx.globalAlpha = cloud.opacity;
        for (const puff of cloud.puffs) {
          const puffWidth = cloud.w * puff.w;
          const puffHeight = cloud.h * puff.h;
          const puffX = cloud.x - cloud.w / 2 + cloud.w * puff.x - puffWidth / 2;
          const puffY = cloud.y - cloud.h / 2 + bob + cloud.h * puff.y - puffHeight / 2;
          const sprite = puff.shadow ? puffSprites[cloud.depth].shadow : puffSprites[cloud.depth].light;
          ctx.drawImage(sprite, puffX, puffY, puffWidth, puffHeight);
        }
        ctx.restore();
      }
    };

    const makePath = (startX, startY, endX, endY, segments, spread) => {
      const points = [{ x: startX, y: startY }];
      for (let i = 1; i < segments; i++) {
        const progress = i / segments;
        const center = startX + (endX - startX) * progress;
        const taper = Math.sin(progress * Math.PI);
        points.push({
          x: center + (Math.random() - .5) * spread * taper,
          y: startY + (endY - startY) * progress
        });
      }
      points.push({ x: endX, y: endY });
      return points;
    };

    const createBolt = (x, y) => {
      const endY = Math.max(height * .42, Math.min(height * .98, y + height * .08));
      const startY = height * (.025 + Math.random() * .06);
      const startX = Math.max(18, Math.min(width - 18, x + (Math.random() - .5) * 92));
      const main = makePath(startX, startY, x, endY, 15, Math.min(132, width * .32));
      const branches = [];
      for (let i = 2; i < main.length - 2; i += 2) {
        if (Math.random() < .88) {
          const point = main[i];
          const direction = Math.random() < .5 ? -1 : 1;
          branches.push(makePath(point.x, point.y, point.x + direction * (45 + Math.random() * 100), point.y + 75 + Math.random() * 115, 6, 44));
        }
      }
      bolts.push({ main, branches, born: performance.now(), duration: 620 });
      flash = 1;
    };

    const strokePath = points => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    };

    const drawBolts = now => {
      bolts = bolts.filter(bolt => now - bolt.born < bolt.duration);
      for (const bolt of bolts) {
        const age = now - bolt.born;
        const fade = Math.max(0, 1 - age / bolt.duration);
        const flicker = age < 110 ? 1 : .48 + Math.abs(Math.sin(age * .055)) * .45;
        const alpha = fade * flicker;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(177,211,255,' + alpha + ')';
        ctx.shadowBlur = lightningGlow * 1.45;
        ctx.strokeStyle = 'rgba(126,174,255,' + (alpha * .42) + ')';
        ctx.lineWidth = 15;
        strokePath(bolt.main);
        ctx.strokeStyle = 'rgba(236,246,255,' + alpha + ')';
        ctx.lineWidth = 4.2;
        strokePath(bolt.main);
        for (const branch of bolt.branches) {
          ctx.strokeStyle = 'rgba(209,229,255,' + (alpha * .72) + ')';
          ctx.lineWidth = 2.1;
          strokePath(branch);
        }
        ctx.restore();
      }
    };

    const drawFlash = dt => {
      if (flash <= .002) return;
      ctx.fillStyle = 'rgba(221,234,255,' + (flash * .34) + ')';
      ctx.fillRect(0, 0, width, height);
      flash *= Math.pow(.075, dt);
    };

    const frame = now => {
      const dt = Math.min(.04, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSky(now);
      drawClouds(dt, now);
      drawBolts(now);
      drawFlash(dt);
      requestAnimationFrame(frame);
    };

    const ensureAudio = () => {
      try {
        if (!audio) {
          const AudioCtor = window.AudioContext || window.webkitAudioContext;
          if (AudioCtor) audio = new AudioCtor();
        }
        if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
      } catch (_) { audio = null; }
    };

    const makeRainBuffer = () => {
      const seconds = 3;
      const length = Math.round(audio.sampleRate * seconds);
      const buffer = audio.createBuffer(1, length, audio.sampleRate);
      const samples = buffer.getChannelData(0);
      let low = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        low = low * .985 + white * .015;
        samples[i] = (white - low) * .42 + low * .18;
      }
      for (let drop = 0; drop < 85; drop++) {
        const start = Math.floor(Math.random() * (length - audio.sampleRate * .04));
        const frequency = 650 + Math.random() * 850;
        const duration = Math.floor(audio.sampleRate * .035);
        for (let i = 0; i < duration; i++) {
          samples[start + i] += Math.sin(2 * Math.PI * frequency * i / audio.sampleRate) * Math.exp(-i / (audio.sampleRate * .007)) * .28;
        }
      }
      return buffer;
    };

    const stopRain = () => {
      if (!rainSource || !audio) return;
      const source = rainSource, gain = rainGain, at = audio.currentTime;
      rainSource = null;
      rainGain = null;
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(Math.max(.0001, gain.gain.value), at);
      gain.gain.exponentialRampToValueAtTime(.0001, at + .2);
      source.stop(at + .22);
    };

    const startRain = () => {
      if (muted || !hasInteracted || document.hidden || rainSource) return;
      ensureAudio();
      if (!audio) return;
      try {
        rainBuffer = rainBuffer || makeRainBuffer();
        const source = audio.createBufferSource();
        const highpass = audio.createBiquadFilter();
        const lowpass = audio.createBiquadFilter();
        const gain = audio.createGain();
        source.buffer = rainBuffer;
        source.loop = true;
        highpass.type = 'highpass';
        highpass.frequency.value = 280;
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 6200;
        gain.gain.setValueAtTime(.0001, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(.055, audio.currentTime + .45);
        source.connect(highpass).connect(lowpass).connect(gain).connect(audio.destination);
        source.onended = () => { source.disconnect(); highpass.disconnect(); lowpass.disconnect(); gain.disconnect(); };
        source.start();
        rainSource = source;
        rainGain = gain;
      } catch (_) {}
    };

    const thunder = () => {
      if (muted || thunderVolume <= 0) return;
      ensureAudio();
      if (!audio) return;
      const duration = .72;
      const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / data.length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2);
      }
      const noise = audio.createBufferSource();
      const filter = audio.createBiquadFilter();
      const gain = audio.createGain();
      noise.buffer = buffer;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(520, audio.currentTime);
      filter.frequency.exponentialRampToValueAtTime(110, audio.currentTime + duration);
      gain.gain.setValueAtTime(.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(thunderVolume, audio.currentTime + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + duration);
      noise.connect(filter).connect(gain).connect(audio.destination);
      noise.start();
      noise.stop(audio.currentTime + duration);
    };

    const ripple = (x, y) => {
      const el = document.createElement('div');
      el.className = 'tap-ripple';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      root.querySelector('.storm').appendChild(el);
      setTimeout(() => el.remove(), 620);
    };

    canvas.addEventListener('pointerdown', event => {
      hasInteracted = true;
      startRain();
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      createBolt(x, y);
      ripple(x, y);
      strikeCount += 1;
      counter.textContent = 'STRIKES ' + strikeCount;
      guide.classList.add('hidden');
      thunder();
      if (navigator.vibrate) navigator.vibrate(22);
    });

    soundButton.addEventListener('pointerdown', event => event.stopPropagation());
    soundButton.addEventListener('click', event => {
      event.stopPropagation();
      muted = !muted;
      hasInteracted = true;
      if (muted) stopRain(); else startRain();
      soundButton.setAttribute('aria-pressed', String(muted));
      soundButton.setAttribute('aria-label', muted ? 'Turn rain and thunder on' : 'Mute rain and thunder');
      soundWaves.style.display = muted ? 'none' : '';
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopRain(); else startRain();
    });

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  };

  start();
})();
