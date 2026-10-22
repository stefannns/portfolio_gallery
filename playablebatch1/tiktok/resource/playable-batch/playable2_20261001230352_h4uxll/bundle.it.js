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
      const response = await fetch("./game.config.it.json?l10n=de6b957dcb56", { cache: 'no-store' });
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
      body { background: #11151d; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
      .storm { position: relative; width: 100%; height: 100%; overflow: hidden; background: #11151d; }
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: manipulation; cursor: crosshair; }
      .hud {
        position: absolute;
        z-index: 2;
        top: calc(30 * var(--ui-unit) + env(safe-area-inset-top));
        left: calc(30 * var(--ui-unit) + env(safe-area-inset-left));
        right: calc(30 * var(--ui-unit) + env(safe-area-inset-right));
        pointer-events: none;
        text-align: center;
        filter: drop-shadow(0 3px 12px rgba(0,0,0,.72));
      }
      .guide {
        max-width: 420px;
        margin: 0 auto;
        color: rgba(226,232,242,.72);
        font-size: calc(18 * var(--ui-unit));
        overflow-wrap: anywhere;
        font-weight: 600;
        line-height: 1.35;
        transition: opacity .35s ease, transform .35s ease;
      }
      .counter { display: flex; align-items: center; justify-content: center; gap: 8px; color: #eef3ff; font-size: calc(28 * var(--ui-unit)); line-height: 1.2; font-weight: 700; font-variant-numeric: tabular-nums; margin-bottom: 14px; }
      .counter svg { width: 19px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; }
      .storm-controls { position: absolute; z-index: 3; bottom: calc(50 * var(--ui-unit) + env(safe-area-inset-bottom)); left: calc(30 * var(--ui-unit) + env(safe-area-inset-left)); right: calc(30 * var(--ui-unit) + env(safe-area-inset-right)); display: flex; justify-content: center; gap: 12px; }
      .storm-control { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; min-width: 112px; padding: 10px 14px; border: 1px solid rgba(221,231,255,.38); border-radius: 24px; background: rgba(15,21,34,.88); color: #edf3ff; font: inherit; font-size: calc(18 * var(--ui-unit)); font-weight: 600; line-height: 1.25; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; transition: background .15s ease, border-color .15s ease; }
      .storm-control svg { flex: 0 0 auto; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .storm-control[aria-pressed="true"] { background: #334264; border-color: #bed0f7; }
      .storm-control:active { background: #455779; }
      .storm-control:focus-visible { outline: 3px solid #d6e6ff; outline-offset: 4px; }
      .storm-control[aria-busy="true"] svg { opacity: .5; }
      .guide.hidden { opacity: 0; transform: translateY(-5px); }
      .storm[data-feed-preview="true"] .storm-controls,.storm[data-feed-preview="true"] .counter{visibility:hidden;pointer-events:none}
      .storm[data-feed-preview="true"] .counter{display:none}
      .storm[data-feed-preview="true"] .hud{top:18%}
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
        .storm-control { transition-duration: .01ms; }
      }
    `;
    document.head.appendChild(style);

    root.innerHTML = `
      <main class="storm">
        <canvas id="sky" aria-label="Moving storm clouds. Tap anywhere to create lightning."></canvas>
        <header class="hud">
          <div class="counter" aria-label="0 strikes" id="strike-counter"><svg viewBox="0 0 24 28" aria-hidden="true"><path d="M14 2 4 16h8l-2 10 10-15h-8z"/></svg><span id="strike-count">0</span></div>
          <p class="guide" id="guide"></p>
        </header>
        <nav class="storm-controls" aria-label="Storm options">
          <button type="button" class="storm-control" id="color-toggle" aria-pressed="false" aria-label="Fulmini colorati"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-13h-7z"/></svg><span>Colore</span></button>
          <button type="button" class="storm-control" id="music-toggle" aria-pressed="false" aria-busy="false" aria-label="Musica rock"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></svg><span id="music-label">Rock spento</span></button>
        </nav>
      </main>
    `;

    const canvas = document.getElementById('sky');
    const ctx = canvas.getContext('2d', { alpha: false });
    const guide = document.getElementById('guide');
    const strikeCount = document.getElementById('strike-count');
    const strikeCounter = document.getElementById('strike-counter');
    const colorToggle = document.getElementById('color-toggle');
    const musicToggle = document.getElementById('music-toggle');
    const musicLabel = document.getElementById('music-label');
    guide.textContent = cfg.GUIDE_TEXT || "Tocca le nuvole per i fulmini";
    const storm=root.querySelector('.storm');
    let feedPreview=new URLSearchParams(location.search).has('review')||new URLSearchParams(location.search).get('feedReview')==='1';
    storm.dataset.feedPreview=String(feedPreview);
    let previewElapsed=0,previewPlayed=false;
    let previewVisible=false;
    const previewObserver=new IntersectionObserver(entries=>{previewVisible=entries.some(entry=>entry.isIntersecting&&entry.intersectionRatio>.1);},{threshold:[0,.1]});
    previewObserver.observe(storm);
    addEventListener('pagehide',()=>previewObserver.disconnect(),{once:true});
    addEventListener('message',e=>{
      if(e.source!==parent||e.origin!==location.origin||e.data?.type!=='playable-active')return;
      feedPreview=e.data.active!==true;storm.dataset.feedPreview=String(feedPreview);
      if(!feedPreview){bolts=[];flash=0;}
    });

    const cloudSpeed = Math.max(.05, Number(cfg.CLOUD_SPEED) || .34);
    const cloudDensity = Math.max(8, Math.min(30, Math.round(Number(cfg.CLOUD_DENSITY) || 18)));
    const lightningGlow = Math.max(8, Number(cfg.LIGHTNING_GLOW) || 30);
    const configuredThunder = Number(cfg.THUNDER_VOLUME);
    const thunderVolume = Math.max(0, Math.min(.6, Number.isFinite(configuredThunder) ? configuredThunder : .28));
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let clouds = [];
    let bolts = [];
    let puffSprites = [];
    let lastFrame = performance.now();
    let flash = 0;
    let flashColor = [221, 234, 255];
    let strikes = 0;
    let colored = false;
    const lightningColors = [[161, 196, 255], [202, 149, 255], [255, 145, 217], [138, 232, 238], [255, 202, 125]];
    let lastColor = -1;
    const muted = false;
    let audio = null;
    let thunderSound = null;
    let thunderIndex = 0;
    let rainBuffer = null;
    let rainSource = null;
    let rainGain = null;
    let hasInteracted = false;
    let rockMusic = null;
    let musicWanted = false;
    let musicRevision = 0;
    let musicFrame = null;

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
      // Crop the bolt at the viewport, not at its visible rounded endpoints.
      const overflow = Math.max(100, height * .16, lightningGlow * 3);
      const endY = height + overflow;
      const startY = -overflow;
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
      let color = [177, 211, 255];
      if (colored) {
        // Vary new strikes without recoloring bolts that are already fading.
        lastColor = (lastColor + 1 + Math.floor(Math.random() * (lightningColors.length - 1))) % lightningColors.length;
        color = lightningColors[lastColor];
      }
      bolts.push({ main, branches, color, colored, born: performance.now(), duration: 620 });
      flashColor = color.map(channel => Math.round(channel * .45 + 255 * .55));
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
        const tint = bolt.color.join(',');
        const core = bolt.color.map(channel => Math.round(channel * .3 + 255 * .7)).join(',');
        ctx.shadowColor = 'rgba(' + tint + ',' + alpha + ')';
        ctx.shadowBlur = lightningGlow * 1.45;
        ctx.strokeStyle = 'rgba(' + tint + ',' + (alpha * .42) + ')';
        ctx.lineWidth = 15;
        strokePath(bolt.main);
        ctx.strokeStyle = 'rgba(' + (bolt.colored ? core : '236,246,255') + ',' + alpha + ')';
        ctx.lineWidth = 4.2;
        strokePath(bolt.main);
        for (const branch of bolt.branches) {
          ctx.strokeStyle = 'rgba(' + core + ',' + (alpha * .72) + ')';
          ctx.lineWidth = 2.1;
          strokePath(branch);
        }
        ctx.restore();
      }
    };

    const drawFlash = dt => {
      if (flash <= .002) return;
      ctx.fillStyle = 'rgba(' + flashColor.join(',') + ',' + (flash * (reducedMotion ? .09 : .34)) + ')';
      ctx.fillRect(0, 0, width, height);
      flash *= Math.pow(.075, dt);
    };

    const frame = now => {
      const dt = Math.min(.04, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      if(!document.hidden&&previewVisible&&feedPreview&&!previewPlayed&&!reducedMotion){
        previewElapsed+=dt*1000;
        if(previewElapsed>=900){previewPlayed=true;createBolt(width*.48,height*.5);storm.dataset.previewStrikes='1';}
      }
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
      if (muted || thunderVolume <= 0 || document.hidden) return;
      ensureAudio();
      if (!audio || !window.PlayableSceneAudio) return;
      if (!thunderSound) thunderSound = new window.PlayableSceneAudio({ profile: 'thunder', context: audio });
      thunderSound.play('thunder', { volume: thunderVolume, variant: thunderIndex++ % 2 });
    };

    const updateMusicControl = (busy = false) => {
      musicToggle.setAttribute('aria-pressed', String(musicWanted));
      musicToggle.setAttribute('aria-busy', String(busy));
      musicLabel.textContent = busy ? "Caricamento…" : musicWanted ? "Rock attivo" : "Rock spento";
    };

    const cancelMusicFade = () => {
      if (musicFrame !== null) cancelAnimationFrame(musicFrame);
      musicFrame = null;
    };

    const fadeMusic = (target, finished) => {
      cancelMusicFade();
      if (!rockMusic) return;
      const from = rockMusic.volume, started = performance.now();
      const tick = now => {
        if (!rockMusic) return;
        const fraction = Math.max(0, Math.min(1, (now - started) / 350));
        rockMusic.volume = Math.max(0, Math.min(1, from + (target - from) * fraction));
        if (fraction < 1) musicFrame = requestAnimationFrame(tick);
        else { musicFrame = null; finished?.(); }
      };
      musicFrame = requestAnimationFrame(tick);
    };

    const pauseMusic = () => {
      cancelMusicFade();
      if (rockMusic) { rockMusic.volume = 0; rockMusic.pause(); }
    };

    const musicFailed = revision => {
      if (revision !== musicRevision || !musicWanted || document.hidden) return;
      musicWanted = false;
      musicRevision++;
      pauseMusic();
      updateMusicControl();
      musicToggle.setAttribute('aria-label', "Musica non disponibile. Tocca per riprovare");
    };

    const startMusic = () => {
      if (!musicWanted || document.hidden) return;
      const revision = musicRevision;
      try {
        if (!rockMusic) {
          if (!window.Audio) { musicFailed(revision); return; }
          rockMusic = new window.Audio('./assets/audio/rock-theme-song-loop.mp3');
          rockMusic.loop = true;
          rockMusic.preload = 'none';
          rockMusic.volume = 0;
          rockMusic.addEventListener('error', () => musicFailed(musicRevision));
        }
        if (rockMusic.error) rockMusic.load();
        updateMusicControl(true);
        const playing = rockMusic.play();
        Promise.resolve(playing).then(() => {
          if (!musicWanted || document.hidden) { pauseMusic(); return; }
          if (revision !== musicRevision) return;
          musicToggle.setAttribute('aria-label', "Musica rock");
          updateMusicControl();
          fadeMusic(.3);
        }).catch(() => musicFailed(revision));
      } catch (_) { musicFailed(revision); }
    };

    colorToggle.addEventListener('click', () => {
      colored = !colored;
      colorToggle.setAttribute('aria-pressed', String(colored));
    });
    musicToggle.addEventListener('click', () => {
      musicWanted = !musicWanted;
      musicRevision++;
      updateMusicControl();
      if (musicWanted) startMusic();
      else fadeMusic(0, () => { if (!musicWanted) { rockMusic.pause(); rockMusic.currentTime = 0; } });
    });

    const ripple = (x, y) => {
      const el = document.createElement('div');
      el.className = 'tap-ripple';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      root.querySelector('.storm').appendChild(el);
      setTimeout(() => el.remove(), 620);
    };

    canvas.addEventListener('pointerdown', event => {
      if (feedPreview || event.isPrimary === false || event.button > 0) return;
      hasInteracted = true;
      startRain();
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      createBolt(x, y);
      strikes++;
      strikeCount.textContent = String(strikes);
      strikeCounter.setAttribute('aria-label', strikes + (strikes === 1 ? " fulmine" : " fulmini"));
      ripple(x, y);
      guide.classList.add('hidden');
      guide.setAttribute('aria-hidden', 'true');
      thunder();
      if (navigator.vibrate) navigator.vibrate(22);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { stopRain(); pauseMusic(); }
      else { startRain(); startMusic(); }
    });

    window.addEventListener('pagehide', stopRain);
    window.addEventListener('pagehide', pauseMusic);
    window.addEventListener('pageshow', startRain);
    window.addEventListener('pageshow', startMusic);
    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  };

  start();
})();
