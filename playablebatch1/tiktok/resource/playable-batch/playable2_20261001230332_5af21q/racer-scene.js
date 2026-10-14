/* Pocket Racer: shared projection for artwork and collisions; no runtime dependencies. */
(function (root) {
  'use strict';
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const traffic = ['IMG_TRAFFIC_RED', 'IMG_TRAFFIC_BLUE', 'IMG_TRAFFIC_PURPLE'];
  const positive = (v, fallback, a, b) => Number.isFinite(Number(v)) ? clamp(Number(v), a, b) : fallback;
  function settings(config) {
    return { cruise: positive(config.SPEED_INITIAL, .04, .02, .1),
      steering: positive(config.LANE_SPEED, .05, .02, .1), density: positive(config.DENSITY, 1500, 800, 3000) };
  }
  function create(config, now) {
    return { playerX: 0, vx: 0, enemies: [], speed: settings(config).cruise, distance: 0,
      score: 0, points: 0, elapsed: 0, lastHud: 0, spawnTimer: 1000, lastTime: now, ended: false, raf: null };
  }
  // One road-world unit is half a metre: default cruise = 72 km/h, max = 207 km/h.
  const kmh = speed => Math.round(Math.max(0, speed) * 1800);
  function formatTime(milliseconds) {
    const tenths = Math.floor(Math.max(0, milliseconds) / 100 + 1e-7);
    return String(Math.floor(tenths / 600)).padStart(2, '0') + ':' +
      String(Math.floor(tenths / 10) % 60).padStart(2, '0') + '.' + tenths % 10;
  }
  function stats(k) { return { score: k.score, speed: kmh(k.speed), elapsed: k.elapsed, distance: k.distance * .5 }; }
  function view(W, H) {
    const horizon = H * .34, lens = Math.min(Math.max(W, H) * .42, W * .72, H * .42);
    return { W, H, horizon, lens, near: lens * 12 / (H - horizon), cull: Math.max(12, lens * 12 / (H - horizon)),
      project(x, z) { const s = lens / Math.max(.01, z); return { x: W / 2 + x * s, y: horizon + 12 * s, s }; } };
  }
  function carRect(v, obj, images) {
    const p = v.project(obj.x, obj.z), image = images[obj.sprite];
    const nominalWidth = (obj.sprite === 'CHAR_PLAYER' ? 6.2 : 5.8) * .75 * p.s;
    const aspect = image && image.naturalWidth ? image.naturalHeight / image.naturalWidth : .74;
    // Contain unusually tall GUI replacements without stretching their artwork.
    const width = nominalWidth * Math.min(1, 1.15 / Math.max(.01, aspect));
    const height = width * aspect;
    return { x: p.x - width / 2, y: p.y - height, width, height, bottom: p.y };
  }
  function speedPosition(v) {
    // Fixed HUD position: steering moves only the car, not the speedometer.
    const p = v.project(0, 20);
    const controlsTop = v.H - (v.H <= 450 ? 78 : 108);
    const y = p.y + (v.H <= 450 ? 18 : 24);
    const height = Math.min(112, controlsTop - y - 16);
    const width = height < 80 ? 156 : 200;
    return { x: v.W / 2, y, width, height };
  }
  function meterAngle(speed) { return Math.PI + clamp(kmh(speed) / 240, 0, 1) * Math.PI; }
  function renderMeter(ctx, W, H, speed) {
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H - 34, rx = W / 2 - 8, ry = Math.max(12, H - 40);
    const point = (angle, inset = 0) => ({ x: cx + Math.cos(angle) * (rx - inset), y: cy + Math.sin(angle) * Math.max(4, ry - inset) });
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
    ctx.shadowColor = '#152b3a'; ctx.shadowBlur = 3; ctx.lineCap = 'butt';
    for (let i = 0; i <= 24; i++) {
      const angle = Math.PI + i / 24 * Math.PI, major = i % 6 === 0;
      const a = point(angle), b = point(angle, major ? 10 : 5);
      ctx.globalAlpha = major ? 1 : .65; ctx.lineWidth = major ? 2.5 : 1.4;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (major && H >= 80) {
        const label = point(angle, 23); ctx.globalAlpha = 1;
        ctx.font = 'bold 12px Arial, Helvetica, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(i * 10), label.x, label.y);
      }
    }
    const tip = point(meterAngle(speed), 16);
    ctx.globalAlpha = 1; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fillStyle = '#21394c'; ctx.fill(); ctx.stroke();
    ctx.font = 'bold 28px Arial, Helvetica, sans-serif'; ctx.textBaseline = 'alphabetic';
    const value = String(kmh(speed)), valueWidth = ctx.measureText(value).width;
    ctx.font = 'bold 16px Arial, Helvetica, sans-serif'; const unitWidth = ctx.measureText('km/h').width;
    const left = (W - valueWidth - 6 - unitWidth) / 2;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = 'bold 28px Arial, Helvetica, sans-serif'; ctx.fillText(value, left, H - 3);
    ctx.font = 'bold 16px Arial, Helvetica, sans-serif'; ctx.fillText('km/h', left + valueWidth + 6, H - 3);
    ctx.restore();
  }
  function overlap(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }
  function collides(k, v, images) {
    const player = carRect(v, { x: k.playerX, z: 20, sprite: 'CHAR_PLAYER' }, images);
    return k.enemies.some(enemy => enemy.z > v.cull && overlap(player, carRect(v, enemy, images)));
  }
  function spawn(k, random, cruise) {
    // Don't spawn two cars in the same visible space. Never block the whole road in a row.
    const recent = k.enemies.filter(e => e.z > 122);
    let x = null;
    for (let i = 0; i < 12; i++) {
      const candidate = random() * 16.4 - 8.2;
      if (recent.every(e => Math.abs(e.x - candidate) >= 6.4)) { x = candidate; break; }
    }
    if (x !== null && recent.length < 2) k.enemies.push({ x, z: 145, speed: cruise * .6,
      sprite: traffic[Math.min(2, Math.floor(random() * 3))] });
  }
  function step(k, milliseconds, input, config, v, images, random = Math.random) {
    if (k.ended || !Number.isFinite(milliseconds)) return;
    const cfg = settings(config);
    // Substeps keep collision/input behavior stable on lower-frame-rate phones.
    let remaining = clamp(milliseconds, 0, 100);
    // Elapsed time is the active frame time, even if physics caps a delayed frame.
    // A collision stops both clocks at the same substep; hidden-page ticks are skipped.
    const clockRatio = remaining ? Math.max(0, milliseconds) / remaining : 0;
    while (remaining > 0 && !k.ended) {
      const dt = Math.min(8, remaining); remaining -= dt;
      const desired = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * cfg.steering * .8;
      k.vx += (desired - k.vx) * (1 - Math.exp(-dt * .015));
      k.playerX = clamp(k.playerX + k.vx * dt, -8.3, 8.3);
      if (Math.abs(k.playerX) === 8.3) k.vx = 0;
      if (input.brake) k.speed = Math.max(.018, k.speed - .000055 * dt);
      else if (input.accelerate) k.speed = Math.min(.115, k.speed + .00004 * dt);
      else k.speed += (cfg.cruise - k.speed) * (1 - Math.exp(-dt * .0015));
      const traveled = k.speed * dt, activeTime = dt * clockRatio;
      k.distance += traveled; k.elapsed += activeTime;
      // Survival: 5 pts/sec. Distance: 1 pt/metre × speed / 72 km/h.
      // Accumulate fractions so scoring is independent of render frame rate.
      k.points += 5 * activeTime / 1000 + traveled * .5 * (k.speed / .04);
      k.score = Math.floor(k.points + 1e-7);
      k.spawnTimer -= dt;
      if (k.spawnTimer <= 0) {
        spawn(k, random, cfg.cruise); k.spawnTimer += Math.max(650, cfg.density - k.speed * 3000) + random() * 350;
      }
      // Trees/ground are stationary in world space; traffic advances independently.
      // Accelerating overtakes cars; braking lets faster traffic pull toward the horizon.
      k.enemies.forEach(e => { e.z += ((e.speed || 0) - k.speed) * dt; });
      k.ended = collides(k, v, images);
      // Cull before the near plane, never project a negative depth into a giant car.
      k.enemies = k.enemies.filter(e => e.z > v.cull && e.z < 200);
    }
  }
  function render(ctx, W, H, k, images, reducedMotion = false) {
    if (!ctx || !W || !H) return;
    k = k || create({}, 0);
    const v = view(W, H), horizon = v.horizon;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#4592d1'); sky.addColorStop(1, '#d9e8e1');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    const bg = images.IMG_BACKGROUND;
    if (bg && bg.complete && bg.naturalWidth) {
      // Bottom-aligned cover preserves mountain silhouettes at every portrait ratio.
      const scale = Math.max(W / bg.naturalWidth, horizon / bg.naturalHeight);
      const width = bg.naturalWidth * scale, height = bg.naturalHeight * scale;
      ctx.drawImage(bg, (W - width) / 2, horizon - height, width, height);
    }
    const ground = ctx.createLinearGradient(0, horizon, 0, H);
    ground.addColorStop(0, '#92aa72'); ground.addColorStop(1, '#527f43');
    ctx.fillStyle = ground; ctx.fillRect(0, horizon, W, H - horizon);
    // Stable world-space meadow patches: perspective changes with travel, not random
    // per-frame brush noise. Flattened shapes sit on the ground rather than floating.
    const terrainRandom = seed => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
    for (let index = Math.floor((k.distance + 520) / 16); index * 16 - k.distance > v.near; index--) {
      for (const side of [-1, 1]) for (let patch = 0; patch < 4; patch++) {
        const seed = index * 31 + patch * 7 + (side > 0 ? 13 : 0);
        const z = index * 16 - k.distance + (terrainRandom(seed + 8) - .5) * 10;
        if (z <= v.near) continue;
        const x = side * (21 + patch * 17 + terrainRandom(seed) * 10);
        const p = v.project(x, z), depth = 3 + terrainRandom(seed + 2) * 5;
        const front = v.project(x, Math.max(v.near, z - depth)), back = v.project(x, z + depth);
        const rx = (3 + terrainRandom(seed + 1) * 6) * p.s, ry = Math.max(.2, (front.y - back.y) / 2);
        if (p.x + rx < 0 || p.x - rx > W) continue;
        ctx.fillStyle = patch % 2 ? '#c3ce7826' : '#366a362b';
        ctx.beginPath(); ctx.ellipse(p.x, (front.y + back.y) / 2, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        if (p.s > 1) {
          ctx.strokeStyle = '#355e3980'; ctx.lineWidth = Math.max(.7, p.s * .045);
          ctx.beginPath();
          for (let blade = -1; blade <= 1; blade++) {
            ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + blade * p.s * .28, p.y - p.s * (.35 + terrainRandom(seed + blade + 4) * .3));
          }
          ctx.stroke();
        }
      }
    }
    const quad = (x1, x2, near, far, color) => {
      const a = v.project(x1, near), b = v.project(x1, far), c = v.project(x2, far), d = v.project(x2, near);
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
    };
    quad(-17, 17, v.near, Infinity, '#b5a07c');
    quad(-14, 14, v.near, Infinity, '#39474d');
    const offset = k.distance % 26;
    for (let z = 900 - offset; z > v.near; z -= 26) {
      const near = Math.max(v.near, z - 13), far = z;
      quad(-14, 14, near, far, '#3e4b50');
      for (const x of [-4.5, 4.5]) quad(x - .12, x + .12, Math.max(v.near, z - 12), z, '#e4e7db');
      for (const side of [-1, 1]) quad(side < 0 ? -14.6 : 14, side < 0 ? -14 : 14.6, near, far, '#ece9dd');
    }
    quad(-13.8, -13.6, v.near, Infinity, '#e8dfc3'); quad(13.6, 13.8, v.near, Infinity, '#e8dfc3');
    // Conifers are fixed in world space; no roadside poles.
    const scenery = [], pine = images.IMG_ROADSIDE;
    for (let index = Math.floor((k.distance + 680) / 44); index * 44 - k.distance > v.near; index--) scenery.push({ index, z: index * 44 - k.distance });
    scenery.forEach(({ z, index }) => {
      for (const side of [-1, 1]) {
        const tree = v.project(side * (23 + Math.sin(index * 2) * 2), z), size = tree.s * (7 + Math.sin(index * 1.7)) * 1.35;
        ctx.fillStyle = '#24452b30'; ctx.beginPath();
        ctx.ellipse(tree.x, tree.y, size * .25, size * .06, 0, 0, Math.PI * 2); ctx.fill();
        if (pine && pine.complete && pine.naturalWidth) {
          const width = size * pine.naturalWidth / pine.naturalHeight;
          ctx.drawImage(pine, tree.x - width / 2, tree.y - size, width, size);
        } else {
          ctx.fillStyle = side > 0 ? '#284e40' : '#35624a'; ctx.beginPath();
          ctx.moveTo(tree.x, tree.y - size); ctx.lineTo(tree.x - size * .37, tree.y); ctx.lineTo(tree.x + size * .37, tree.y); ctx.closePath(); ctx.fill();
        }
      }
    });
    const fog = ctx.createLinearGradient(0, horizon - 6, 0, horizon + H * .11);
    fog.addColorStop(0, '#d6e5db00'); fog.addColorStop(.15, '#d6e5db90'); fog.addColorStop(1, '#d6e5db00');
    ctx.fillStyle = fog; ctx.fillRect(0, horizon - 6, W, H * .11 + 6);
    const cars = [...k.enemies.filter(e => e.z > v.cull), { x: k.playerX, z: 20, sprite: 'CHAR_PLAYER' }];
    cars.sort((a, b) => b.z - a.z).forEach(obj => {
      const rect = carRect(v, obj, images), image = images[obj.sprite];
      ctx.fillStyle = '#14251c55'; ctx.beginPath(); ctx.ellipse(rect.x + rect.width / 2, rect.bottom - 1, rect.width * .48, rect.width * .065, 0, 0, Math.PI * 2); ctx.fill();
      if (image && image.complete && image.naturalWidth) ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
      else {
        ctx.fillStyle = obj.sprite === 'CHAR_PLAYER' ? '#ffb730' : '#3d85ce'; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        ctx.fillStyle = '#32485e'; ctx.fillRect(rect.x + rect.width * .18, rect.y + rect.height * .08, rect.width * .64, rect.height * .32);
        ctx.fillStyle = '#ef4444'; ctx.fillRect(rect.x + rect.width * .12, rect.y + rect.height * .62, rect.width * .19, rect.height * .13);
        ctx.fillRect(rect.x + rect.width * .69, rect.y + rect.height * .62, rect.width * .19, rect.height * .13);
      }
    });
    return v;
  }
  function controls() {
    const held = { left: false, right: false, accelerate: false, brake: false }, pointers = new Map(), keys = new Map();
    function sync() { Object.keys(held).forEach(k => { held[k] = [...pointers.values(), ...keys.values()].includes(k); }); return held; }
    return { held,
      pointer(id, action, down) { if (down) pointers.set(id, action); else pointers.delete(id); return sync(); },
      key(id, action, down) { if (down) keys.set(id, action); else keys.delete(id); return sync(); },
      clear() { pointers.clear(); keys.clear(); return sync(); } };
  }
  function crashSamples(sampleRate) {
    const duration = .78, samples = new Float32Array(Math.ceil(sampleRate * duration));
    let seed = 6519, low = 0, phase = 0, bodyPhase = 0, peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const t = i / sampleRate;
      seed = (1664525 * seed + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1;
      low += (noise - low) * (1 - Math.exp(-2 * Math.PI * 650 / sampleRate));
      phase += 2 * Math.PI * (52 + 105 * Math.exp(-t * 28)) / sampleRate;
      bodyPhase += 2 * Math.PI * (92 + 65 * Math.exp(-t * 32)) / sampleRate;
      const thud = Math.sin(phase) * Math.exp(-t * 7) * 1.6;
      const body = Math.sin(bodyPhase) * Math.exp(-t * 10) * .65;
      const crunch = (low * 1.6 + noise * .3) * Math.exp(-t * 20);
      const envelope = Math.min(1, t / .003, (duration - t) / .04);
      samples[i] = Math.tanh(thud + body + crunch) * envelope;
      peak = Math.max(peak, Math.abs(samples[i]));
    }
    for (let i = 0; i < samples.length; i++) samples[i] *= .92 / Math.max(.001, peak);
    return samples;
  }
  function audio() {
    let context = null, disposed = false, engine = null, lastDrive = -Infinity, engineBuffer = null, roadBuffer = null, crashBuffer = null;
    const voices = new Set(), engineGroups = new Set();
    function disconnectEngine(group) {
      group.nodes.forEach(node => { try { node.disconnect(); } catch (_) {} }); engineGroups.delete(group);
    }
    function stopEngine(immediate = false) {
      const group = engine; engine = null; lastDrive = -Infinity;
      if (!group) return;
      try {
        const t = context.currentTime;
        group.master.gain.cancelScheduledValues(t);
        if (immediate) group.master.gain.setValueAtTime(0, t);
        else group.master.gain.setTargetAtTime(0, t, .015);
        group.sources.forEach(source => { try { source.stop(t + (immediate ? 0 : .06)); } catch (_) {} });
      } catch (_) { disconnectEngine(group); }
      if (immediate) disconnectEngine(group);
    }
    function stop() {
      stopEngine(true);
      voices.forEach(v => { try { v.source.stop(); v.source.disconnect(); v.gain.disconnect(); } catch (_) {} }); voices.clear();
      engineGroups.forEach(group => { group.sources.forEach(source => { try { source.stop(); } catch (_) {} }); disconnectEngine(group); });
    }
    function startEngine() {
      const group = { sources: [], nodes: [] }; engineGroups.add(group);
      const node = value => { group.nodes.push(value); return value; };
      try {
        if (!engineBuffer) {
          engineBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
          roadBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
          const exhaust = engineBuffer.getChannelData(0), road = roadBuffer.getChannelData(0);
          for (let i = 0; i < exhaust.length; i++) {
            const p = 2 * Math.PI * 48 * i / context.sampleRate;
            exhaust[i] = Math.tanh(1.4 * Math.sin(p) + .45 * Math.sin(p * 2) + .2 * Math.sin(p * 3)) * .7;
            // The short seam envelope avoids a click at the noise-loop boundary.
            road[i] = (Math.random() * 2 - 1) * Math.min(1, i / 240, (exhaust.length - 1 - i) / 240);
          }
        }
        const master = node(context.createGain()); master.gain.setValueAtTime(0, context.currentTime); master.gain.setTargetAtTime(1, context.currentTime, .06); master.connect(context.destination);
        const motor = node(context.createBufferSource()), rolling = node(context.createBufferSource());
        group.sources.push(motor, rolling); motor.buffer = engineBuffer; rolling.buffer = roadBuffer; motor.loop = rolling.loop = true;
        const engineFilter = node(context.createBiquadFilter()), roadFilter = node(context.createBiquadFilter()), brakeFilter = node(context.createBiquadFilter());
        engineFilter.type = 'lowpass'; engineFilter.Q.setValueAtTime(.6, context.currentTime);
        roadFilter.type = 'bandpass'; roadFilter.frequency.setValueAtTime(500, context.currentTime); roadFilter.Q.setValueAtTime(.5, context.currentTime);
        brakeFilter.type = 'bandpass'; brakeFilter.frequency.setValueAtTime(2200, context.currentTime); brakeFilter.Q.setValueAtTime(.8, context.currentTime);
        const motorGain = node(context.createGain()), roadGain = node(context.createGain()), brakeGain = node(context.createGain());
        for (const gain of [motorGain, roadGain, brakeGain]) { gain.gain.setValueAtTime(0, context.currentTime); gain.connect(master); }
        motor.connect(engineFilter); engineFilter.connect(motorGain);
        rolling.connect(roadFilter); roadFilter.connect(roadGain); rolling.connect(brakeFilter); brakeFilter.connect(brakeGain);
        let ended = 0; for (const source of group.sources) { source.onended = () => { if (++ended === group.sources.length) disconnectEngine(group); }; source.start(); }
        Object.assign(group, { master, motor, engineFilter, motorGain, roadGain, brakeGain }); engine = group;
      } catch (_) { group.sources.forEach(source => { try { source.stop(); } catch (_) {} }); disconnectEngine(group); }
    }
    function drive(speed, input = {}) {
      if (!context || context.state !== 'running' || disposed) return;
      if (!engine) startEngine(); if (!engine) return;
      const t = context.currentTime; if (t - lastDrive < 1 / 30) return; lastDrive = t;
      const velocity = clamp((speed - .018) / .097, 0, 1), gas = input.accelerate && !input.brake;
      // Reuse two looping sources; smooth parameter changes instead of spawning
      // oscillators/samples every frame or abruptly changing engine pitch.
      engine.motor.playbackRate.setTargetAtTime(.8 + velocity * 2.4 + (gas ? .3 : 0), t, .12);
      engine.engineFilter.frequency.setTargetAtTime(580 + velocity * 850 + (gas ? 350 : 0), t, .12);
      engine.motorGain.gain.setTargetAtTime((input.brake ? .065 : .085) + velocity * .055, t, .08);
      engine.roadGain.gain.setTargetAtTime(.02 + velocity * .045, t, .12);
      engine.brakeGain.gain.setTargetAtTime(input.brake ? velocity * .08 : 0, t, .07);
    }
    function tone(f, duration, gainValue, noise = false) {
      if (!context || context.state !== 'running' || disposed || voices.size >= 6) return;
      const t = context.currentTime, gain = context.createGain(); let source;
      if (noise) {
        source = context.createBufferSource(); const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate), values = buffer.getChannelData(0);
        for (let i = 0; i < values.length; i++) values[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / values.length, 2);
        source.buffer = buffer;
      } else { source = context.createOscillator(); source.type = 'triangle'; source.frequency.setValueAtTime(f, t); source.frequency.exponentialRampToValueAtTime(f * .55, t + duration); }
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(gainValue, t + .008); gain.gain.exponentialRampToValueAtTime(.0001, t + duration);
      source.connect(gain); gain.connect(context.destination); const voice = { source, gain }; voices.add(voice);
      source.onended = () => { voices.delete(voice); source.disconnect(); gain.disconnect(); };
      source.start(t); source.stop(t + duration + .02);
    }
    function crash() {
      if (!context || context.state !== 'running' || disposed || voices.size >= 6) return;
      if (!crashBuffer) {
        const samples = crashSamples(context.sampleRate);
        crashBuffer = context.createBuffer(1, samples.length, context.sampleRate);
        crashBuffer.getChannelData(0).set(samples);
      }
      const t = context.currentTime, source = context.createBufferSource(), gain = context.createGain();
      source.buffer = crashBuffer;
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(.85, t + .003);
      gain.gain.setValueAtTime(.85, t + .74); gain.gain.linearRampToValueAtTime(0, t + .78);
      source.connect(gain); gain.connect(context.destination);
      const voice = { source, gain }; voices.add(voice);
      source.onended = () => { voices.delete(voice); source.disconnect(); gain.disconnect(); };
      source.start(t); source.stop(t + .8);
    }
    return {
      async unlock() { if (disposed) return; try { const Audio = root.AudioContext || root.webkitAudioContext; if (!Audio) return; if (!context) context = new Audio(); if (context.state === 'suspended') await context.resume(); } catch (_) {} },
      play(kind) { try { if (kind === 'crash') crash(); else tone(kind === 'score' ? 720 : 520, .09, .06); } catch (_) {} },
      drive(speed, input) { try { drive(speed, input); } catch (_) { stopEngine(true); } },
      stopEngine,
      stop,
      dispose() { disposed = true; stop(); if (context) { try { Promise.resolve(context.close()).catch(() => {}); } catch (_) {} } context = null; engineBuffer = roadBuffer = crashBuffer = null; }
    };
  }
  root.PocketRacer = { create, view, carRect, overlap, collides, step, render, controls, audio, settings, kmh, formatTime, stats, speedPosition, meterAngle, renderMeter, crashSamples };
})(typeof window !== 'undefined' ? window : globalThis);
