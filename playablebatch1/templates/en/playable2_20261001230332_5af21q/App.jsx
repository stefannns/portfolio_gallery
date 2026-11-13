import * as JSXRuntime from 'react/jsx-runtime';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.

// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "SPEED_INITIAL",
    "kind": "number",
    "label": "Initial Speed",
    "value": 0.04,
    "default": 0.04,
    "min": 0.02,
    "max": 0.1,
    "step": 0.01
  }, {
    "id": "DENSITY",
    "kind": "number",
    "label": "Traffic Density",
    "value": 1500,
    "default": 1500,
    "min": 800,
    "max": 3000,
    "step": 100
  }, {
    "id": "LANE_SPEED",
    "kind": "number",
    "label": "Steering Speed",
    "value": 0.05,
    "default": 0.05,
    "min": 0.02,
    "max": 0.1,
    "step": 0.01
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "POCKET RACER",
    "default": "POCKET RACER",
    "max_length": 20
  }, {
    "id": "BTN_START",
    "label": "Start Button",
    "value": "Start Race",
    "default": "Start Race",
    "max_length": 15
  }, {
    "id": "BTN_RESTART",
    "label": "Restart Button",
    "value": "Play Again",
    "default": "Play Again",
    "max_length": 15
  }, {
    "id": "TXT_POST",
    "label": "Post Button",
    "value": "Post My Play",
    "default": "Post My Play",
    "max_length": 20
  }],
  "images": [{
    "id": "CHAR_PLAYER",
    "label": "Player Car",
    "path": "./assets/art-v3/player.svg",
    "replaceable": true
  }, {
    "id": "IMG_TRAFFIC_RED",
    "label": "Red Traffic Car",
    "path": "./assets/art-v3/red.svg",
    "replaceable": true
  }, {
    "id": "IMG_TRAFFIC_BLUE",
    "label": "Blue Traffic Car",
    "path": "./assets/art-v3/blue.svg",
    "replaceable": true
  }, {
    "id": "IMG_TRAFFIC_PURPLE",
    "label": "Purple Traffic Car",
    "path": "./assets/art-v3/purple.svg",
    "replaceable": true
  }, {
    "id": "IMG_BACKGROUND",
    "label": "Alpine Horizon",
    "path": "./assets/art-v3/mountains-only-v4.webp",
    "replaceable": true
  }, {
    "id": "IMG_ROADSIDE",
    "label": "Roadside Pine",
    "path": "./assets/art-v3/pine.svg",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "99280066550480227",
    "version_id": "99280066554654271",
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.race-instruction{position:fixed!important;top:33%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

@font-face{font-family:RacePixel;src:url('./assets/fonts/silkscreen/Silkscreen-Regular.ttf') format('truetype');font-style:normal;font-weight:400;font-display:swap}:root{--race-font:RacePixel,monospace;--font-display:var(--race-font);--font-body:var(--race-font);--font-mono:var(--race-font);--race-ink:#152b3a;--race-paper:#f4f5e9;--race-accent:#ffc14b;--race-control:#21394c;--race-stroke:#e0e8e8;--race-top:calc(30px + env(safe-area-inset-top));--race-bottom:calc(50px + env(safe-area-inset-bottom));--race-left:calc(30px + env(safe-area-inset-left));--race-right:calc(30px + env(safe-area-inset-right))}
html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:var(--race-ink)}
*{box-sizing:border-box}
button{font-family:var(--race-font);cursor:pointer;-webkit-tap-highlight-color:transparent}
.racer{position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;user-select:none;font-family:var(--race-font)}
.race-canvas{display:block;width:100%;height:100%;pointer-events:none;image-rendering:pixelated}
.racer-loading{display:grid;place-items:center;height:100%;color:var(--race-paper);font:400 18px var(--race-font)}
.race-hud{position:absolute;top:var(--race-top);left:var(--race-left);right:var(--race-right);pointer-events:none;color:white;font-family:var(--race-font);font-variant-numeric:tabular-nums;text-shadow:2px 0 #18334d,-2px 0 #18334d,0 2px #18334d,0 -2px #18334d}
.race-hud-top{display:flex;align-items:baseline;justify-content:space-between;gap:16px;min-width:0}
.race-points{display:flex;align-items:baseline;gap:6px;min-width:0;flex-wrap:wrap}
.race-points{justify-content:flex-start;overflow-wrap:anywhere;text-align:left}
.race-speed{position:absolute;left:50%;top:65%;width:200px;height:96px;transform:translateX(-50%);pointer-events:none}
.race-number{font-size:28px;font-weight:400;line-height:1.2;overflow-wrap:anywhere;min-width:0}
.race-unit{font:400 16px/1.2 var(--race-font)}
.race-time{text-align:right}
.race-summary{display:flex;flex-wrap:wrap;justify-content:center;gap:12px 24px;color:var(--race-paper);font:400 18px/1.4 var(--race-font);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.drive-controls{position:absolute;left:var(--race-left);right:var(--race-right);bottom:var(--race-bottom);display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;align-items:stretch}
.drive-button{min-width:0;min-height:58px;display:grid;place-items:center;border:3px solid var(--race-stroke);border-radius:0;background:var(--race-control);color:white;font-size:16px;font-weight:400;line-height:1.2;overflow-wrap:anywhere;padding:10px 4px;touch-action:none;box-shadow:inset 3px 3px 0 #ffffff25,inset -3px -3px 0 #0003,0 4px 0 #132533;text-transform:uppercase}
.drive-button.accelerate{background:#216843}.drive-button.brake{background:#923c37}
.drive-button.active,.drive-button:active{background:var(--race-accent);color:var(--race-ink);box-shadow:inset 0 3px 0 #b7772450,0 1px 0 #132533}
.race-overlay{position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;text-align:center;padding:var(--race-top) var(--race-right) var(--race-bottom) var(--race-left);background:#12273de8;overflow:auto;text-shadow:2px 2px 0 #081c2b;text-transform:uppercase}
.race-instruction{font:400 18px/1.5 var(--race-font);max-width:290px;color:var(--race-paper);margin:0;text-wrap:balance;overflow-wrap:anywhere}
.race-action{min-height:54px;min-width:0;max-width:100%;border:3px solid #ffe0a2;background:var(--race-accent);color:var(--race-ink);border-radius:0;padding:13px 22px;font-size:18px;font-weight:400;line-height:1.4;overflow-wrap:anywhere;box-shadow:inset 3px 3px 0 #fff4,inset -3px -3px 0 #9e692b55,0 4px 0 #a66b23;touch-action:manipulation;text-transform:uppercase;text-shadow:none}
.race-action:active{box-shadow:inset 0 3px 0 #b7772450,0 1px 0 #a66b23}.race-action.secondary{background:var(--race-control);border-color:var(--race-stroke);color:white;box-shadow:0 4px 0 #132533}
.race-action:disabled{opacity:.6;cursor:not-allowed}
.race-result{font:400 24px/1.3 var(--race-font);color:white;margin:0;overflow-wrap:anywhere}
.race-distance{font:400 28px/1.3 var(--race-font);color:var(--race-paper);margin:0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.race-actions{display:flex;flex-wrap:wrap;gap:16px;justify-content:center;width:100%;max-width:330px}
.drive-button:focus-visible,.race-action:focus-visible{outline:3px solid #fff;outline-offset:4px}
@media(prefers-reduced-motion:reduce){.drive-button{transition:none}}
@media(max-height:450px) and (orientation:landscape){.drive-controls{bottom:calc(30px + env(safe-area-inset-bottom));left:calc(30px + env(safe-area-inset-left));right:calc(30px + env(safe-area-inset-right));max-width:360px;margin:auto}.drive-button{min-height:48px}.race-overlay{gap:16px}}
.racer,.racer button,.racer input{font-synthesis:none;-webkit-font-smoothing:none}.race-instruction,.race-unit{text-transform:uppercase}
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
// ./racer-scene.js
/* Pocket Racer: shared projection for artwork and collisions; no runtime dependencies. */
(function (root) {
  'use strict';

  const clamp = (value, otherValue, argument3) => Math.max(otherValue, Math.min(argument3, value));
  const traffic = ['IMG_TRAFFIC_RED', 'IMG_TRAFFIC_BLUE', 'IMG_TRAFFIC_PURPLE'];
  const meadowRows = new Map();
  function meadowRow(index) {
    if (meadowRows.has(index)) return meadowRows.get(index);
    const random = seed => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
    const patches = [];
    for (const side of [-1, 1]) for (let patch = 0; patch < 3; patch++) {
      const seed = index * 31 + patch * 7 + (side > 0 ? 13 : 0);
      patches.push({x:side*(21+patch*22+random(seed)*10),offset:(random(seed+8)-.5)*10,depth:3+random(seed+2)*5,radius:3+random(seed+1)*6,light:patch%2});
    }
    meadowRows.set(index, patches);
    if (meadowRows.size > 64) meadowRows.delete(meadowRows.keys().next().value);
    return patches;
  }
  const positive = (value, fallback, argument3, argument4) => Number.isFinite(Number(value)) ? clamp(Number(value), argument3, argument4) : fallback;
  function settings(config) {
    return {
      cruise: positive(config.SPEED_INITIAL, 0.04, 0.02, 0.1),
      steering: positive(config.LANE_SPEED, 0.05, 0.02, 0.1),
      density: positive(config.DENSITY, 1500, 800, 3000)
    };
  }
  function create(config, lastTime) {
    return {
      playerX: 0,
      vx: 0,
      enemies: [],
      speed: settings(config).cruise,
      distance: 0,
      score: 0,
      points: 0,
      elapsed: 0,
      lastHud: 0,
      spawnTimer: 1000,
      lastTime: lastTime,
      ended: false,
      raf: null
    };
  }
  // One road-world unit is half a metre: default cruise = 72 km/h, max = 207 km/h.
  const handleAction = speed => Math.round(Math.max(0, speed) * 1800);
  function formatTime(milliseconds) {
    const tenths = Math.floor(Math.max(0, milliseconds) / 100 + 1e-7);
    return String(Math.floor(tenths / 600)).padStart(2, '0') + ':' + String(Math.floor(tenths / 10) % 60).padStart(2, '0') + '.' + tenths % 10;
  }
  function stats(value) {
    return {
      score: value.score,
      speed: handleAction(value.speed),
      elapsed: value.elapsed,
      distance: value.distance * 0.5
    };
  }
  function view(value, otherValue) {
    const horizon = otherValue * 0.34;
    const lens = Math.min(Math.max(value, otherValue) * 0.42, value * 0.72, otherValue * 0.42);
    return {
      W: value,
      H: otherValue,
      horizon,
      lens,
      near: lens * 12 / (otherValue - horizon),
      cull: Math.max(12, lens * 12 / (otherValue - horizon)),
      project(x, z) {
        const value2 = lens / Math.max(0.01, z);
        return {
          x: value / 2 + x * value2,
          y: horizon + 12 * value2,
          s: value2
        };
      }
    };
  }
  function carRect(value, otherValue, images) {
    const point = value.project(otherValue.x, otherValue.z);
    const image = images[otherValue.sprite];
    const nominalWidth = (otherValue.sprite === 'CHAR_PLAYER' ? 6.2 : 5.8) * 0.75 * point.s;
    const aspect = image && image.naturalWidth ? image.naturalHeight / image.naturalWidth : 0.74;
    // Contain unusually tall GUI replacements without stretching their artwork.
    const width = nominalWidth * Math.min(1, 1.15 / Math.max(0.01, aspect));
    const height = width * aspect;
    return {
      x: point.x - width / 2,
      y: point.y - height,
      width,
      height,
      bottom: point.y
    };
  }
  function speedPosition(value) {
    // Fixed HUD position: steering moves only the car, not the speedometer.
    const value2 = value.project(0, 20);
    const controlsTop = value.H - (value.H <= 450 ? 78 : 108);
    const y = value2.y + (value.H <= 450 ? 18 : 24);
    const height = Math.min(112, controlsTop - y - 16);
    const width = height < 80 ? 156 : 200;
    return {
      x: value.W / 2,
      y,
      width,
      height
    };
  }
  function meterAngle(speed) {
    return Math.PI + clamp(handleAction(speed) / 240, 0, 1) * Math.PI;
  }
  function renderMeter(context, width, height, speed) {
    context.clearRect(0, 0, width, height);
    if (width < 20 || height < 20) return;
    context.save();context.imageSmoothingEnabled = false;
    const pixel = 2, snap = n => Math.round(n / pixel) * pixel;
    const cx = snap(width / 2), cy = snap(height - 31);
    const rx = width / 2 - 8, ry = Math.max(12, height - 38);
    const point = (angle, inset = 0) => ({x:cx + Math.cos(angle) * (rx - inset), y:cy + Math.sin(angle) * Math.max(4, ry - inset)});
    // Hard-edged staircase strokes retain the old half-dial form without smooth vector lines.
    function pixelLine(a, b, color, thickness = 1, shadow = true) {
      let x = Math.round(a.x / pixel), y = Math.round(a.y / pixel);
      const endX = Math.round(b.x / pixel), endY = Math.round(b.y / pixel);
      const dx = Math.abs(endX - x), dy = -Math.abs(endY - y);
      const sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
      let error = dx + dy;
      const blocks = [];
      while (true) {
        blocks.push([x * pixel, y * pixel]);
        if (x === endX && y === endY) break;
        const twice = 2 * error;
        if (twice >= dy) { error += dy; x += sx; }
        if (twice <= dx) { error += dx; y += sy; }
      }
      if (shadow) { context.fillStyle='#152b3a';for(const [x,y] of blocks) context.fillRect(x+pixel,y+pixel,pixel*thickness,pixel*thickness); }
      context.fillStyle=color;for(const [x,y] of blocks) context.fillRect(x,y,pixel*thickness,pixel*thickness);
    }
    for (let i = 0; i <= 24; i++) {
      const angle = Math.PI + i / 24 * Math.PI, major = i % 6 === 0;
      const color = i >= 21 ? '#ee8069' : major ? '#fff3c4' : '#c3d9ce';
      pixelLine(point(angle), point(angle, major ? 10 : 5), color);
      if (major && height >= 80) {
        const label = point(angle, 23);
        context.font='400 10px RacePixel,monospace';context.textAlign='center';context.textBaseline='middle';
        context.fillStyle='#152b3a';context.fillText(String(i*10),snap(label.x)+2,snap(label.y)+2);
        context.fillStyle='#fff3c4';context.fillText(String(i*10),snap(label.x),snap(label.y));
      }
    }
    pixelLine({x:cx,y:cy},point(meterAngle(speed),16),'#ffc14b',1);
    context.fillStyle='#152b3a';context.fillRect(cx-4,cy-2,10,6);context.fillRect(cx-2,cy-4,6,10);
    context.fillStyle='#e0e8e8';context.fillRect(cx-4,cy-2,8,4);context.fillRect(cx-2,cy-4,4,8);
    context.fillStyle='#21394c';context.fillRect(cx-2,cy-2,4,4);
    const number=String(handleAction(speed)),numberSize=width>=180?24:20;
    context.font='400 '+numberSize+'px RacePixel,monospace';const numberWidth=context.measureText(number).width;
    context.font='400 10px RacePixel,monospace';const unitWidth=context.measureText('KM/H').width;
    const left=snap((width-numberWidth-unitWidth-8)/2),baseline=snap(height-3);
    context.textAlign='left';context.textBaseline='alphabetic';
    context.font='400 '+numberSize+'px RacePixel,monospace';context.fillStyle='#152b3a';context.fillText(number,left+2,baseline+2);context.fillStyle='#fff3c4';context.fillText(number,left,baseline);
    context.font='400 10px RacePixel,monospace';context.fillStyle='#152b3a';context.fillText('KM/H',snap(left+numberWidth+8)+2,baseline+2);context.fillStyle='#e0e8e8';context.fillText('KM/H',snap(left+numberWidth+8),baseline);
    context.restore();
  }
  function overlap(point, point2) {
    return point.x < point2.x + point2.width && point.x + point.width > point2.x && point.y < point2.y + point2.height && point.y + point.height > point2.y;
  }
  function collides(value, otherValue, images) {
    const player = carRect(otherValue, {
      x: value.playerX,
      z: 20,
      sprite: 'CHAR_PLAYER'
    }, images);
    return value.enemies.some(enemy => enemy.z > otherValue.cull && overlap(player, carRect(otherValue, enemy, images)));
  }
  function spawn(value, random, cruise) {
    // Don't spawn two cars in the same visible space. Never block the whole road in a row.
    const recent = value.enemies.filter(item => item.z > 122);
    let x = null;
    for (let value2 = 0; value2 < 12; value2++) {
      const candidate = random() * 16.4 - 8.2;
      if (recent.every(item => Math.abs(item.x - candidate) >= 6.4)) {
        x = candidate;
        break;
      }
    }
    if (x !== null && recent.length < 2) value.enemies.push({
      x,
      z: 145,
      speed: cruise * 0.6,
      sprite: traffic[Math.min(2, Math.floor(random() * 3))]
    });
  }
  function step(value, milliseconds, input, config, argument5, images, random = Math.random) {
    if (value.ended || !Number.isFinite(milliseconds)) return;
    const value2 = settings(config);
    // Substeps keep collision/input behavior stable on lower-frame-rate phones.
    let remaining = clamp(milliseconds, 0, 100);
    // Elapsed time is the active frame time, even if physics caps a delayed frame.
    // A collision stops both clocks at the same substep; hidden-page ticks are skipped.
    const clockRatio = remaining ? Math.max(0, milliseconds) / remaining : 0;
    while (remaining > 0 && !value.ended) {
      const value3 = Math.min(8, remaining);
      remaining -= value3;
      const desired = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * value2.steering * 0.8;
      value.vx += (desired - value.vx) * (1 - Math.exp(-value3 * 0.015));
      value.playerX = clamp(value.playerX + value.vx * value3, -8.3, 8.3);
      if (Math.abs(value.playerX) === 8.3) value.vx = 0;
      if (input.brake) value.speed = Math.max(0.018, value.speed - 0.000055 * value3);else if (input.accelerate) value.speed = Math.min(0.115, value.speed + 0.00004 * value3);else value.speed += (value2.cruise - value.speed) * (1 - Math.exp(-value3 * 0.0015));
      const traveled = value.speed * value3;
      const activeTime = value3 * clockRatio;
      value.distance += traveled;
      value.elapsed += activeTime;
      // Survival: 5 pts/sec. Distance: 1 pt/metre × speed / 72 km/h.
      // Accumulate fractions so scoring is independent of render frame rate.
      value.points += 5 * activeTime / 1000 + traveled * 0.5 * (value.speed / 0.04);
      value.score = Math.floor(value.points + 1e-7);
      value.spawnTimer -= value3;
      if (value.spawnTimer <= 0) {
        spawn(value, random, value2.cruise);
        value.spawnTimer += Math.max(650, value2.density - value.speed * 3000) + random() * 350;
      }
      // Trees/ground are stationary in world space; traffic advances independently.
      // Accelerating overtakes cars; braking lets faster traffic pull toward the horizon.
      value.enemies.forEach(item => {
        item.z += ((item.speed || 0) - value.speed) * value3;
      });
      value.ended = collides(value, argument5, images);
      // Cull before the near plane, never project a negative depth into a giant car.
      value.enemies = value.enemies.filter(item => item.z > argument5.cull && item.z < 200);
    }
  }
  function render(context, otherValue, argument3, argument4, images, reducedMotion = false) {
    if (!context || !otherValue || !argument3) return;
    argument4 = argument4 || create({}, 0);
    const value = view(otherValue, argument3);
    const horizon = value.horizon;
    const linearGradient = context.createLinearGradient(0, 0, 0, horizon);
    linearGradient.addColorStop(0, '#4592d1');
    linearGradient.addColorStop(1, '#d9e8e1');
    context.fillStyle = linearGradient;
    context.fillRect(0, 0, otherValue, argument3);
    const IMG_BACKGROUND = images.IMG_BACKGROUND;
    if (IMG_BACKGROUND && IMG_BACKGROUND.complete && IMG_BACKGROUND.naturalWidth) {
      // Bottom-aligned cover preserves mountain silhouettes at every portrait ratio.
      const scale = Math.max(otherValue / IMG_BACKGROUND.naturalWidth, horizon / IMG_BACKGROUND.naturalHeight);
      const width = IMG_BACKGROUND.naturalWidth * scale;
      const height = IMG_BACKGROUND.naturalHeight * scale;
      context.drawImage(IMG_BACKGROUND, (otherValue - width) / 2, horizon - height, width, height);
    }
    // Restore the previous continuous meadow. Crossfade into the foothills instead of
    // painting hard horizontal color bands across the horizon.
    const blendHeight = Math.max(12, Math.min(36, argument3 * .04));
    const groundTop = horizon - blendHeight;
    const ground = context.createLinearGradient(0, groundTop, 0, argument3);
    ground.addColorStop(0, 'rgba(67,132,75,0)');
    ground.addColorStop(blendHeight / (argument3 - groundTop), '#43844b');
    ground.addColorStop(.35, '#46874c');
    ground.addColorStop(.68, '#55934f');
    ground.addColorStop(1, '#5c9f51');
    context.fillStyle = ground;
    context.fillRect(0, groundTop, otherValue, argument3 - groundTop);
    // Sparse, unsnapped world-space ellipses keep the old smooth motion. Cache
    // their layout and fade at both ends, with no per-blade pixel drawing.
    const smoothstep = (a,b,x) => { const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t); };
    context.save();
    for(let index=Math.floor((argument4.distance+380)/32);index*32-argument4.distance>value.near;index--){
      for(const patch of meadowRow(index)){
        const z=index*32-argument4.distance+patch.offset;
        if(z<=value.near) continue;
        const point=value.project(patch.x,z),rx=patch.radius*point.s;
        if(point.x+rx<0 || point.x-rx>otherValue) continue;
        const progress=(point.y-horizon)/(argument3-horizon);
        const opacity=.12*smoothstep(.012,.14,progress)*(1-smoothstep(.78,1.12,progress));
        if(opacity<.006) continue;
        const front=value.project(patch.x,Math.max(value.near,z-patch.depth));
        const back=value.project(patch.x,z+patch.depth);
        context.globalAlpha=opacity;
        context.fillStyle=patch.light?'#c0cb7a':'#174c36';
        context.beginPath();
        context.ellipse(point.x,(front.y+back.y)/2,rx,Math.max(.2,(front.y-back.y)/2),0,0,Math.PI*2);
        context.fill();
      }
    }
    context.restore();
    const quad = (value2, otherValue2, near, argument42, color) => {
      const point = value.project(value2, near);
      const point2 = value.project(value2, argument42);
      const point3 = value.project(otherValue2, argument42);
      const point4 = value.project(otherValue2, near);
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(point2.x, point2.y);
      context.lineTo(point3.x, point3.y);
      context.lineTo(point4.x, point4.y);
      context.closePath();
      context.fill();
    };
    quad(-17, 17, value.near, Infinity, '#b5a07c');
    quad(-14, 14, value.near, Infinity, '#39474d');
    const offset = argument4.distance % 26;
    for (let z = 900 - offset; z > value.near; z -= 26) {
      const near = Math.max(value.near, z - 13);
      const value2 = z;
      quad(-14, 14, near, value2, '#3e4b50');
      for (const x of [-4.5, 4.5]) quad(x - 0.12, x + 0.12, Math.max(value.near, z - 12), z, '#e4e7db');
      for (const side of [-1, 1]) quad(side < 0 ? -14.6 : 14, side < 0 ? -14 : 14.6, near, value2, '#ece9dd');
    }
    quad(-13.8, -13.6, value.near, Infinity, '#e8dfc3');
    quad(13.6, 13.8, value.near, Infinity, '#e8dfc3');
    // Conifers are fixed in world space; no roadside poles.
    const scenery = [];
    const pine = images.IMG_ROADSIDE;
    for (let index = Math.floor((argument4.distance + 680) / 44); index * 44 - argument4.distance > value.near; index--) scenery.push({
      index,
      z: index * 44 - argument4.distance
    });
    scenery.forEach(({
      z,
      index
    }) => {
      for (const side of [-1, 1]) {
        const tree = value.project(side * (23 + Math.sin(index * 2) * 2), z);
        const size = tree.s * (7 + Math.sin(index * 1.7)) * 1.35;
        context.fillStyle = '#24452b30';
        context.beginPath();
        context.ellipse(tree.x, tree.y, size * 0.25, size * 0.06, 0, 0, Math.PI * 2);
        context.fill();
        if (pine && pine.complete && pine.naturalWidth) {
          const width = size * pine.naturalWidth / pine.naturalHeight;
          context.drawImage(pine, tree.x - width / 2, tree.y - size, width, size);
        } else {
          context.fillStyle = side > 0 ? '#284e40' : '#35624a';
          context.beginPath();
          context.moveTo(tree.x, tree.y - size);
          context.lineTo(tree.x - size * 0.37, tree.y);
          context.lineTo(tree.x + size * 0.37, tree.y);
          context.closePath();
          context.fill();
        }
      }
    });
    const cars = [...argument4.enemies.filter(item => item.z > value.cull), {
      x: argument4.playerX,
      z: 20,
      sprite: 'CHAR_PLAYER'
    }];
    cars.sort((leftItem, rightItem) => rightItem.z - leftItem.z).forEach(item => {
      const rect = carRect(value, item, images);
      const image = images[item.sprite];
      context.fillStyle = '#14251c55';
      context.beginPath();
      context.ellipse(rect.x + rect.width / 2, rect.bottom - 1, rect.width * 0.48, rect.width * 0.065, 0, 0, Math.PI * 2);
      context.fill();
      if (image && image.complete && image.naturalWidth) context.drawImage(image, rect.x, rect.y, rect.width, rect.height);else {
        context.fillStyle = item.sprite === 'CHAR_PLAYER' ? '#ffb730' : '#3d85ce';
        context.fillRect(rect.x, rect.y, rect.width, rect.height);
        context.fillStyle = '#32485e';
        context.fillRect(rect.x + rect.width * 0.18, rect.y + rect.height * 0.08, rect.width * 0.64, rect.height * 0.32);
        context.fillStyle = '#ef4444';
        context.fillRect(rect.x + rect.width * 0.12, rect.y + rect.height * 0.62, rect.width * 0.19, rect.height * 0.13);
        context.fillRect(rect.x + rect.width * 0.69, rect.y + rect.height * 0.62, rect.width * 0.19, rect.height * 0.13);
      }
    });
    return value;
  }
  function controls() {
    const held = {
      left: false,
      right: false,
      accelerate: false,
      brake: false
    };
    const pointers = new Map();
    const keys = new Map();
    function sync() {
      Object.keys(held).forEach(item => {
        held[item] = [...pointers.values(), ...keys.values()].includes(item);
      });
      return held;
    }
    return {
      held,
      pointer(value, action, down) {
        if (down) pointers.set(value, action);else pointers.delete(value);
        return sync();
      },
      key(value, action, down) {
        if (down) keys.set(value, action);else keys.delete(value);
        return sync();
      },
      clear() {
        pointers.clear();
        keys.clear();
        return sync();
      }
    };
  }
  function crashSamples(sampleRate) {
    const duration = 0.78;
    const samples = new Float32Array(Math.ceil(sampleRate * duration));
    let seed = 6519;
    let value = 0;
    let phase = 0;
    let bodyPhase = 0;
    let peak = 0;
    for (let value2 = 0; value2 < samples.length; value2++) {
      const value3 = value2 / sampleRate;
      seed = 1664525 * seed + 1013904223 >>> 0;
      const noise = seed / 2147483648 - 1;
      value += (noise - value) * (1 - Math.exp(-2 * Math.PI * 650 / sampleRate));
      phase += 2 * Math.PI * (52 + 105 * Math.exp(-value3 * 28)) / sampleRate;
      bodyPhase += 2 * Math.PI * (92 + 65 * Math.exp(-value3 * 32)) / sampleRate;
      const thud = Math.sin(phase) * Math.exp(-value3 * 7) * 1.6;
      const body = Math.sin(bodyPhase) * Math.exp(-value3 * 10) * 0.65;
      const crunch = (value * 1.6 + noise * 0.3) * Math.exp(-value3 * 20);
      const envelope = Math.min(1, value3 / 0.003, (duration - value3) / 0.04);
      samples[value2] = Math.tanh(thud + body + crunch) * envelope;
      peak = Math.max(peak, Math.abs(samples[value2]));
    }
    for (let value2 = 0; value2 < samples.length; value2++) samples[value2] *= 0.92 / Math.max(0.001, peak);
    return samples;
  }
  function audio() {
    let context = null;
    let disposed = false;
    let engine = null;
    let lastDrive = -Infinity;
    let engineBuffer = null;
    let roadBuffer = null;
    let crashBuffer = null;
    const voices = new Set();
    const engineGroups = new Set();
    function disconnectEngine(group) {
      group.nodes.forEach(node => {
        try {
          node.disconnect();
        } catch (value) {}
      });
      engineGroups.delete(group);
    }
    function stopEngine(immediate = false) {
      const group = engine;
      engine = null;
      lastDrive = -Infinity;
      if (!group) return;
      try {
        const currentTime = context.currentTime;
        group.master.gain.cancelScheduledValues(currentTime);
        if (immediate) group.master.gain.setValueAtTime(0, currentTime);else group.master.gain.setTargetAtTime(0, currentTime, 0.015);
        group.sources.forEach(source => {
          try {
            source.stop(currentTime + (immediate ? 0 : 0.06));
          } catch (value) {}
        });
      } catch (value) {
        disconnectEngine(group);
      }
      if (immediate) disconnectEngine(group);
    }
    function stop() {
      stopEngine(true);
      voices.forEach(item => {
        try {
          item.source.stop();
          item.source.disconnect();
          item.gain.disconnect();
        } catch (value) {}
      });
      voices.clear();
      engineGroups.forEach(group => {
        group.sources.forEach(source => {
          try {
            source.stop();
          } catch (value) {}
        });
        disconnectEngine(group);
      });
    }
    function startEngine() {
      const group = {
        sources: [],
        nodes: []
      };
      engineGroups.add(group);
      const node = value => {
        group.nodes.push(value);
        return value;
      };
      try {
        if (!engineBuffer) {
          engineBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
          roadBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
          const exhaust = engineBuffer.getChannelData(0);
          const road = roadBuffer.getChannelData(0);
          for (let value = 0; value < exhaust.length; value++) {
            const value2 = 2 * Math.PI * 48 * value / context.sampleRate;
            exhaust[value] = Math.tanh(1.4 * Math.sin(value2) + 0.45 * Math.sin(value2 * 2) + 0.2 * Math.sin(value2 * 3)) * 0.7;
            // The short seam envelope avoids a click at the noise-loop boundary.
            road[value] = (Math.random() * 2 - 1) * Math.min(1, value / 240, (exhaust.length - 1 - value) / 240);
          }
        }
        const master = node(context.createGain());
        master.gain.setValueAtTime(0, context.currentTime);
        master.gain.setTargetAtTime(1, context.currentTime, 0.06);
        master.connect(context.destination);
        const motor = node(context.createBufferSource());
        const rolling = node(context.createBufferSource());
        group.sources.push(motor, rolling);
        motor.buffer = engineBuffer;
        rolling.buffer = roadBuffer;
        motor.loop = rolling.loop = true;
        const engineFilter = node(context.createBiquadFilter());
        const roadFilter = node(context.createBiquadFilter());
        const brakeFilter = node(context.createBiquadFilter());
        engineFilter.type = 'lowpass';
        engineFilter.Q.setValueAtTime(0.6, context.currentTime);
        roadFilter.type = 'bandpass';
        roadFilter.frequency.setValueAtTime(500, context.currentTime);
        roadFilter.Q.setValueAtTime(0.5, context.currentTime);
        brakeFilter.type = 'bandpass';
        brakeFilter.frequency.setValueAtTime(2200, context.currentTime);
        brakeFilter.Q.setValueAtTime(0.8, context.currentTime);
        const motorGain = node(context.createGain());
        const roadGain = node(context.createGain());
        const brakeGain = node(context.createGain());
        for (const gain of [motorGain, roadGain, brakeGain]) {
          gain.gain.setValueAtTime(0, context.currentTime);
          gain.connect(master);
        }
        motor.connect(engineFilter);
        engineFilter.connect(motorGain);
        rolling.connect(roadFilter);
        roadFilter.connect(roadGain);
        rolling.connect(brakeFilter);
        brakeFilter.connect(brakeGain);
        let ended = 0;
        for (const source of group.sources) {
          source.onended = () => {
            if (++ended === group.sources.length) disconnectEngine(group);
          };
          source.start();
        }
        Object.assign(group, {
          master,
          motor,
          engineFilter,
          motorGain,
          roadGain,
          brakeGain
        });
        engine = group;
      } catch (value) {
        group.sources.forEach(source => {
          try {
            source.stop();
          } catch (value2) {}
        });
        disconnectEngine(group);
      }
    }
    function drive(speed, input = {}) {
      if (!context || context.state !== 'running' || disposed) return;
      if (!engine) startEngine();
      if (!engine) return;
      const currentTime = context.currentTime;
      if (currentTime - lastDrive < 1 / 30) return;
      lastDrive = currentTime;
      const velocity = clamp((speed - 0.018) / 0.097, 0, 1);
      const value = input.accelerate && !input.brake; // Reuse two looping sources; smooth parameter changes instead of spawning
      // oscillators/samples every frame or abruptly changing engine pitch.
      engine.motor.playbackRate.setTargetAtTime(0.8 + velocity * 2.4 + (value ? 0.3 : 0), currentTime, 0.12);
      engine.engineFilter.frequency.setTargetAtTime(580 + velocity * 850 + (value ? 350 : 0), currentTime, 0.12);
      engine.motorGain.gain.setTargetAtTime((input.brake ? 0.065 : 0.085) + velocity * 0.055, currentTime, 0.08);
      engine.roadGain.gain.setTargetAtTime(0.02 + velocity * 0.045, currentTime, 0.12);
      engine.brakeGain.gain.setTargetAtTime(input.brake ? velocity * 0.08 : 0, currentTime, 0.07);
    }
    function tone(value, duration, gainValue, noise = false) {
      if (!context || context.state !== 'running' || disposed || voices.size >= 6) return;
      const currentTime = context.currentTime;
      const gain = context.createGain();
      let source;
      if (noise) {
        source = context.createBufferSource();
        const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
        const values = buffer.getChannelData(0);
        for (let value2 = 0; value2 < values.length; value2++) values[value2] = (Math.random() * 2 - 1) * Math.pow(1 - value2 / values.length, 2);
        source.buffer = buffer;
      } else {
        source = context.createOscillator();
        source.type = 'triangle';
        source.frequency.setValueAtTime(value, currentTime);
        source.frequency.exponentialRampToValueAtTime(value * 0.55, currentTime + duration);
      }
      gain.gain.setValueAtTime(0, currentTime);
      gain.gain.linearRampToValueAtTime(gainValue, currentTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + duration);
      source.connect(gain);
      gain.connect(context.destination);
      const voice = {
        source,
        gain
      };
      voices.add(voice);
      source.onended = () => {
        voices.delete(voice);
        source.disconnect();
        gain.disconnect();
      };
      source.start(currentTime);
      source.stop(currentTime + duration + 0.02);
    }
    function crash() {
      if (!context || context.state !== 'running' || disposed || voices.size >= 6) return;
      if (!crashBuffer) {
        const samples = crashSamples(context.sampleRate);
        crashBuffer = context.createBuffer(1, samples.length, context.sampleRate);
        crashBuffer.getChannelData(0).set(samples);
      }
      const currentTime = context.currentTime;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = crashBuffer;
      gain.gain.setValueAtTime(0, currentTime);
      gain.gain.linearRampToValueAtTime(0.85, currentTime + 0.003);
      gain.gain.setValueAtTime(0.85, currentTime + 0.74);
      gain.gain.linearRampToValueAtTime(0, currentTime + 0.78);
      source.connect(gain);
      gain.connect(context.destination);
      const voice = {
        source,
        gain
      };
      voices.add(voice);
      source.onended = () => {
        voices.delete(voice);
        source.disconnect();
        gain.disconnect();
      };
      source.start(currentTime);
      source.stop(currentTime + 0.8);
    }
    return {
      async unlock() {
        if (disposed) return;
        try {
          const Audio = root.AudioContext || root.webkitAudioContext;
          if (!Audio) return;
          if (!context) context = new Audio();
          if (context.state === 'suspended') await context.resume();
        } catch (value) {}
      },
      play(kind) {
        try {
          if (kind === 'crash') crash();else tone(kind === 'score' ? 720 : 520, 0.09, 0.06);
        } catch (value) {}
      },
      drive(speed, input) {
        try {
          drive(speed, input);
        } catch (value) {
          stopEngine(true);
        }
      },
      stopEngine,
      stop,
      dispose() {
        disposed = true;
        stop();
        if (context) {
          try {
            Promise.resolve(context.close()).catch(() => {});
          } catch (value) {}
        }
        context = null;
        engineBuffer = roadBuffer = crashBuffer = null;
      }
    };
  }
  root.PocketRacer = {
    create,
    view,
    carRect,
    overlap,
    collides,
    step,
    render,
    controls,
    audio,
    settings,
    kmh: handleAction,
    formatTime,
    stats,
    speedPosition,
    meterAngle,
    renderMeter,
    crashSamples
  };
})(typeof window !== 'undefined' ? window : globalThis);

// ./racer-component.js
/* Uses the imported React runtime and the original config / host submission adapters. */
window.createPocketRacerComponent = function (React, otherValue, flatten, useSubmission, vibrate) {
  const {
    useState,
    useRef,
    useEffect,
    useCallback
  } = React;
  const {
    jsx: value,
    jsxs
  } = otherValue;
  const Racer = window.PocketRacer;
  return function PocketRacerGame() {
    const [config, setConfig] = useState(null);
    const [phase, setPhase] = useState('idle');
    const [hud, setHud] = useState({
      score: 0,
      speed: 0,
      elapsed: 0,
      distance: 0
    });
    const [pressed, setPressed] = useState({});
    const canvas = useRef(null);
    const game = useRef(null);
    const images = useRef({});
    const speedDisplay = useRef(null);
    const inputs = useRef(null);
    const sound = useRef(null);
    const currentConfig = useRef({});
    const live = useRef(true);
    const actionButton = useRef(null);
    if (!inputs.current) inputs.current = Racer.controls();
    if (!sound.current) sound.current = Racer.audio();
    currentConfig.current = config || {};
    const {
      canSubmit,
      submitting,
      submitRecording
    } = useSubmission();
    const draw = useCallback(() => {
      const dimensions = canvas.current;
      if (!dimensions) return;
      const clientWidth = dimensions.clientWidth;
      const clientHeight = dimensions.clientHeight;
      if (!clientWidth || !clientHeight) return;
      const context = dimensions.getContext('2d', {
        alpha: false
      });
      if (!context) return;
      context.setTransform(dimensions.width / clientWidth, 0, 0, dimensions.height / clientHeight, 0, 0);
      context.imageSmoothingEnabled = false;
      Racer.render(context, clientWidth, clientHeight, game.current, images.current, !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      if (speedDisplay.current?.style && game.current) {
        const position = Racer.speedPosition(Racer.view(clientWidth, clientHeight));
        const meter = speedDisplay.current;
        const half = position.width / 2;
        meter.style.left = 'clamp(calc(var(--race-left) + ' + half + 'px), ' + position.x + 'px, calc(100% - var(--race-right) - ' + half + 'px))';
        // CSS safe-area budget can shorten the dial without touching the driving buttons.
        meter.style.top = position.y + 'px';
        meter.style.width = position.width + 'px';
        meter.style.height = 'max(0px, calc(' + position.height + 'px - env(safe-area-inset-bottom)))';
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const value2 = meter.clientWidth || position.width;
        const value3 = meter.clientHeight || position.height;
        if (meter.width !== Math.round(value2 * ratio) || meter.height !== Math.round(value3 * ratio)) {
          meter.width = Math.round(value2 * ratio);
          meter.height = Math.round(value3 * ratio);
        }
        const context2 = meter.getContext?.('2d');
        if (context2) {
          context2.setTransform(ratio, 0, 0, ratio, 0, 0);
          Racer.renderMeter(context2, value2, value3, game.current.speed);
        }
      }
    }, []);
    const clear = useCallback(() => {
      inputs.current.clear();
      if (live.current) setPressed({});
    }, []);
    const tick = useCallback(value2 => {
      const current = game.current;
      const current2 = canvas.current;
      if (!live.current || !current || current.ended || current.waiting || !current2) return;
      current.raf = null;
      if (document.hidden) {
        current.lastTime = null;
        return;
      }
      if (!current2.clientWidth || !current2.clientHeight) {
        current.lastTime = null;
        current.raf = requestAnimationFrame(tick);
        return;
      }
      const value3 = current.lastTime === null ? 0 : value2 - current.lastTime;
      current.lastTime = value2;
      const previousScore = current.score;
      Racer.step(current, value3, inputs.current.held, currentConfig.current, Racer.view(current2.clientWidth, current2.clientHeight), images.current);
      if (current.ended || current.elapsed - current.lastHud >= 100) {
        setHud(Racer.stats(current));
        current.lastHud = current.elapsed;
      }
      if (!current.ended && Math.floor(current.score / 250) > Math.floor(previousScore / 250)) sound.current.play('score');
      draw();
      if (current.ended) {
        clear();
        setPhase('over');
        vibrate('heavy');
        sound.current.stopEngine();
        sound.current.play('crash');
        return;
      }
      sound.current.drive(current.speed, inputs.current.held);
      current.raf = requestAnimationFrame(tick);
    }, [draw, clear]);
    const start = useCallback(() => {
      // Duplicate start events must not create a second animation loop.
      if (game.current && !game.current.ended && !game.current.waiting) return;
      clear();
      sound.current.stop();
      vibrate('light');
      game.current = Racer.create(currentConfig.current, performance.now());
      const race = game.current;
      sound.current.unlock().then(() => {
        if (live.current && !document.hidden && game.current === race && !race.ended && race.raf !== null) sound.current.play('click');
      });
      setHud(Racer.stats(race));
      setPhase('playing');
      draw();
      if (!document.hidden) game.current.raf = requestAnimationFrame(tick);
    }, [clear, draw, tick]);
    const prepare = useCallback(() => {
      const current = game.current;
      if (current?.raf !== null && current?.raf !== undefined) cancelAnimationFrame(current.raf);
      clear();
      sound.current.stop();
      game.current = Racer.create(currentConfig.current, performance.now());
      game.current.speed = 0;
      game.current.waiting = true;
      game.current.raf = null;
      setHud(Racer.stats(game.current));
      setPhase('idle');
      draw();
    }, [clear, draw]);
    useEffect(() => {
      let active = true;
      (async () => {
        let data;
        try {
          const response = await fetch('./game.config.json', {
            cache: 'no-store'
          });
          if (response.ok) data = await response.json();
        } catch (value2) {}
        if (!data) {
          try {
            data = JSON.parse(document.getElementById('playable-config-inline').textContent);
          } catch (value2) {}
        }
        if (active) setConfig(flatten(data || {
          tweaks: [],
          texts: [],
          images: []
        }));
      })();
      return () => {
        active = false;
      };
    }, []);
    useEffect(() => {
      if (!config) return;
      prepare();
      let active = true;
      const loaded = {};
      for (const value2 of ['CHAR_PLAYER', 'IMG_TRAFFIC_RED', 'IMG_TRAFFIC_BLUE', 'IMG_TRAFFIC_PURPLE', 'IMG_BACKGROUND', 'IMG_ROADSIDE']) {
        if (!config[value2]) continue;
        const image = new Image();
        loaded[value2] = image;
        image.onload = () => {
          if (active) draw();
        };
        image.onerror = () => {
          if (active) draw();
        };
        image.src = config[value2];
      }
      images.current = loaded;
      draw();
      return () => {
        active = false;
        Object.values(loaded).forEach(image => {
          image.onload = null;
          image.onerror = null;
        });
      };
    }, [config, draw, prepare]);
    useEffect(() => {
      const resize = () => {
        const dimensions = canvas.current;
        if (!dimensions) return;
        const ratio = .65;
        dimensions.width = Math.max(1, Math.round(dimensions.clientWidth * ratio));
        dimensions.height = Math.max(1, Math.round(dimensions.clientHeight * ratio));
        draw();
      };
      resize();
      window.addEventListener('resize', resize);
      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
      if (canvas.current) observer?.observe(canvas.current);
      return () => {
        observer?.disconnect();
        window.removeEventListener('resize', resize);
      };
    }, [config, draw]);
    useEffect(() => {
      if (phase === 'over') actionButton.current?.focus({
        preventScroll: true
      });
    }, [phase]);
    useEffect(() => {
      live.current = true;
      const keyActions = {
        arrowleft: 'left',
        a: 'left',
        arrowright: 'right',
        d: 'right',
        arrowup: 'accelerate',
        w: 'accelerate',
        arrowdown: 'brake',
        s: 'brake'
      };
      const down = event => {
        if (!game.current || game.current.ended || event.altKey || event.metaKey || event.ctrlKey) return;
        const value2 = event.key.toLowerCase();
        const action = keyActions[value2];
        if (action) {
          event.preventDefault();
          if (game.current.waiting) start();
          sound.current.unlock();
          setPressed({
            ...inputs.current.key(value2, action, true)
          });
        }
      };
      const handleAction = event => {
        const value2 = event.key.toLowerCase();
        const action = keyActions[value2];
        if (action) setPressed({
          ...inputs.current.key(value2, action, false)
        });
      };
      const pause = () => {
        clear();
        sound.current.stop();
        const current = game.current;
        if (current) {
          if (current.raf !== null) cancelAnimationFrame(current.raf);
          current.raf = null;
          current.lastTime = null;
        }
      };
      const resume = () => {
        const current = game.current;
        if (current && !current.ended && !current.waiting && current.raf === null && !document.hidden && live.current) {
          current.lastTime = null;
          current.raf = requestAnimationFrame(tick);
        }
      };
      const visibility = () => {
        if (document.hidden) pause();else resume();
      };
      window.addEventListener('keydown', down);
      window.addEventListener('keyup', handleAction);
      window.addEventListener('blur', clear);
      window.addEventListener('pagehide', pause);
      window.addEventListener('pageshow', resume);
      document.addEventListener('visibilitychange', visibility);
      return () => {
        live.current = false;
        pause();
        sound.current.dispose();
        window.removeEventListener('keydown', down);
        window.removeEventListener('keyup', handleAction);
        window.removeEventListener('blur', clear);
        window.removeEventListener('pagehide', pause);
        window.removeEventListener('pageshow', resume);
        document.removeEventListener('visibilitychange', visibility);
      };
    }, [tick, clear, start]);
    function pointer(action, down, event) {
      if (!game.current || game.current.ended) return;
      if (down && game.current.waiting) start();
      // Every pointer owns its action, including non-primary touches (steer + gas).
      const value2 = event.pointerId ?? 'mouse';
      if (down) {
        event.preventDefault();
        sound.current.unlock();
        try {
          event.currentTarget.setPointerCapture(value2);
        } catch (value3) {}
      }
      setPressed({
        ...inputs.current.pointer(value2, action, down)
      });
      if (!down) {
        try {
          if (event.currentTarget.hasPointerCapture?.(value2)) event.currentTarget.releasePointerCapture(value2);
        } catch (value3) {}
      }
    }
    function control(action, label, icon) {
      return value('button', {
        type: 'button',
        className: 'drive-button ' + action + (pressed[action] ? ' active' : ''),
        'aria-label': label,
        'aria-pressed': !!pressed[action],
        onPointerDown: value2 => pointer(action, true, value2),
        onPointerUp: value2 => pointer(action, false, value2),
        onPointerCancel: value2 => pointer(action, false, value2),
        onLostPointerCapture: value2 => pointer(action, false, value2),
        // Native keyboard activation gives a short hold, while arrows/WASD support continuous driving.
        onKeyDown: event => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            if (game.current?.waiting) start();
            sound.current.unlock();
            setPressed({
              ...inputs.current.key('button:' + action, action, true)
            });
          }
        },
        onKeyUp: event => {
          if (event.key === ' ' || event.key === 'Enter') setPressed({
            ...inputs.current.key('button:' + action, action, false)
          });
        },
        onBlur: () => setPressed({
          ...inputs.current.key('button:' + action, action, false)
        }),
        children: icon ? value('svg', {
          width: 24,
          height: 24,
          viewBox: '0 0 24 24',
          'aria-hidden': true,
          children: value('path', {
            d: action === 'left' ? 'M12 2h4v4h-4zM8 6h4v4H8zM4 10h4v4H4zM8 14h4v4H8zM12 18h4v4h-4z' : 'M8 2h4v4H8zM12 6h4v4h-4zM16 10h4v4h-4zM12 14h4v4h-4zM8 18h4v4H8z',
            fill: 'currentColor',
            shapeRendering: 'crispEdges'
          })
        }) : label
      });
    }
    if (!config) return value('div', {
      className: 'racer-loading',
      role: 'status',
      children: 'LOADING...'
    });
    return jsxs('div', {
      className: 'racer',
      children: [value('canvas', {
        ref: canvas,
        className: 'race-canvas',
        'aria-label': 'Road with a rear-view car and approaching traffic'
      }), phase !== 'over' && jsxs('div', {
        className: 'race-hud',
        children: [jsxs('div', {
          className: 'race-hud-top',
          children: [jsxs('div', {
            className: 'race-points',
            'aria-label': hud.score + ' points',
            children: [value('span', {
              className: 'race-number',
              children: hud.score.toLocaleString('en')
            }), value('span', {
              className: 'race-unit',
              children: 'pts'
            })]
          }), value('div', {
            className: 'race-time race-number',
            'aria-label': 'Elapsed time ' + Racer.formatTime(hud.elapsed),
            children: Racer.formatTime(hud.elapsed)
          })]
        })]
      }), phase !== 'over' && value('canvas', {
        ref: speedDisplay,
        className: 'race-speed',
        role: 'img',
        'aria-label': 'Speedometer: ' + hud.speed + ' kilometres per hour; scale 0 to 240'
      }), phase !== 'over' && jsxs('div', {
        className: 'drive-controls',
        role: 'group',
        'aria-label': 'Driving controls',
        children: [control('left', 'Steer left', true), control('right', 'Steer right', true), control('accelerate', 'Accel'), control('brake', 'Brake')]
      }), phase === 'idle' && value('p', {
        className: 'race-instruction feed-first-action',
        style: {
          position: 'absolute',
          top: '18%',
          left: 30,
          right: 30,
          margin: 0,
          textAlign: 'center',
          pointerEvents: 'none'
        },
        children: 'Hold Accel to start'
      }), phase === 'over' && jsxs('div', {
        className: 'race-overlay',
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'crash-heading',
        children: [value('h2', {
          id: 'crash-heading',
          className: 'race-result',
          children: 'Crash'
        }), jsxs('p', {
          className: 'race-distance',
          children: [hud.score.toLocaleString('en'), value('span', {
            className: 'race-unit',
            children: ' pts'
          })]
        }), jsxs('div', {
          className: 'race-summary',
          children: [value('span', {
            'aria-label': 'Final time ' + Racer.formatTime(hud.elapsed),
            children: Racer.formatTime(hud.elapsed)
          }), value('span', {
            'aria-label': 'Distance ' + Math.round(hud.distance) + ' metres',
            children: Math.round(hud.distance).toLocaleString('en') + ' m'
          })]
        }), jsxs('div', {
          className: 'race-actions',
          children: [value('button', {
            ref: actionButton,
            type: 'button',
            className: 'race-action',
            onClick: prepare,
            children: config.BTN_RESTART || 'Play Again'
          }), canSubmit && value('button', {
            type: 'button',
            className: 'race-action secondary',
            disabled: submitting,
            onClick: submitRecording,
            children: config.TXT_POST || 'Post My Play'
          })]
        })]
      })]
    });
  };
};
function WM(config) {
  let options = {};
  (config.tweaks || []).forEach(item => {
    options[item.id] = item.value;
  });
  (config.texts || []).forEach(item => {
    options[item.id] = item.value;
  });
  (config.images || []).forEach(item => {
    options[item.id] = item.path;
  });
  (config.mentions || []).forEach(item => {
    options[item.id] = item.path != null && item.path !== "" ? item.path : item.value;
  });
  (config.motions || []).forEach(item => {
    if (!(!item || !item.id)) {
      if (item.base_path != null && item.base_path !== "") {
        options[item.id] = item.base_path;
        options[item.id + "_BASE"] = item.base_path;
      }
      if (item.frame_count != null) {
        options[item.id + "_COUNT"] = item.frame_count;
      }
    }
  });
  return options;
}
function useGameFeature1() {
  let canSubmit = typeof window !== "undefined" && window.tt && typeof window.tt.playableRecordingSubmission == "function";
  let [submitting, setSubmitting] = React.useState(!1);
  React.useEffect(() => {
    let handleAction = () => setSubmitting(!1);
    let handleAction2 = () => {
      if (document.visibilityState === "visible") {
        handleAction();
      }
    };
    document.addEventListener("visibilitychange", handleAction2);
    window.addEventListener("pageshow", handleAction);
    return () => {
      document.removeEventListener("visibilitychange", handleAction2);
      window.removeEventListener("pageshow", handleAction);
    };
  }, []);
  let submitRecording = React.useCallback(() => {
    if (!(submitting || !canSubmit)) {
      setSubmitting(!0);
      if (typeof window !== "undefined" && window.tt && window.tt.vibrate) {
        window.tt.vibrate({
          style: "light"
        });
      }
      window.tt.playableRecordingSubmission({
        success() {},
        fail(value) {
          console.error("[post_my_play] playableRecordingSubmission failed", value && (value.errMsg || value.message));
          setSubmitting(!1);
        },
        complete() {}
      });
    }
  }, [submitting, canSubmit]);
  return {
    canSubmit: canSubmit,
    submitting: submitting,
    submitRecording: submitRecording
  };
}
function fb(value) {
  try {
    if (typeof window !== "undefined" && window.tt && window.tt.vibrate) {
      window.tt.vibrate({
        style: value || "light"
      });
    }
  } catch {}
}
var App = window.createPocketRacerComponent(React, JSXRuntime, WM, useGameFeature1, fb);
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": ".race-canvas",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": ".race-canvas",
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
  const selectors = ["p.race-instruction"];
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
        "data-batch3-game": "56"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "56"
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
