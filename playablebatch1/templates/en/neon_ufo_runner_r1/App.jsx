import React, {useState, useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Host config with a hard timeout so a stalled host never blanks us.  */
/* ------------------------------------------------------------------ */
async function loadGameConfig() {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let deadline;
  try {
    const request = fetch('./game.config.json', {signal: controller?.signal}).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    const timeout = new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('timed out')), 1200);
    });
    const config = await Promise.race([request, timeout]);
    if (!config || typeof config !== 'object' || Array.isArray(config) ||
        ['tweaks', 'texts', 'images'].some(key => config[key] != null && !Array.isArray(config[key]))) {
      throw new Error('invalid config');
    }
    return config;
  } catch (error) {
    console.warn('[playable] Using packaged defaults:', error.message);
    return null;
  } finally {
    clearTimeout(deadline);
    controller?.abort();
  }
}

function watchGameSize(container, resize) {
  resize();
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }
  window.addEventListener('resize', resize);
  return () => window.removeEventListener('resize', resize);
}

/* The feed cover animates silently; only playable-active starts a real run. */
let inFeedCover = window.parent !== window &&
  new URLSearchParams(location.search).get('feedReview') === '1';
if (inFeedCover) {
  document.documentElement.dataset.feedCover = 'true';
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin ||
        event.data?.type !== 'playable-active') return;
    inFeedCover = event.data.active !== true;
    document.documentElement.dataset.feedCover = String(inFeedCover);
    if (!inFeedCover && navigator.userActivation?.hasBeenActive) window.SFX?.unlock();
  });
}

const play = name => { try { window.SFX?.play(name); } catch (error) { /* no audio */ } };

/* ------------------------------------------------------------------ */
/* Tunable defaults (overridable through game.config.json tweaks/texts) */
/* ------------------------------------------------------------------ */
const DEFAULTS = {
  HINT: 'Drag to fly',
  FIRE_INTERVAL: 0.16,
  HEAT_PER_SHOT: 0.085,
  ENEMY_INTERVAL: 1.55,
  BASE_SPEED: 22,
  MAX_SPEED: 34,
  HULL_MAX: 3,
};

const COLORS = {
  sky: 0x171233,
  fog: 0x241a4d,
  cyan: 0x37e6ff,
  magenta: 0xff3fa4,
  violet: 0x7a4bff,
  peach: 0xffb8a0,
  yellow: 0xffd95a,
  hull: 0xeaf6ff,
  enemyGreen: 0x4ce0a4,
  danger: 0xff4d6d,
};

const CSS = `
@font-face {
  font-family: 'Audiowide';
  src: url('./assets/fonts/Audiowide-Regular.woff2') format('woff2');
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Poppins';
  src: url('./assets/fonts/Poppins-Regular.woff2') format('woff2');
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Poppins';
  src: url('./assets/fonts/Poppins-Bold.woff2') format('woff2');
  font-weight: 700; font-style: normal; font-display: swap;
}
:root{
  --font-display:'Audiowide','Poppins',system-ui,sans-serif;
  --font-ui:'Poppins','PingFang SC',system-ui,sans-serif;
  --cyan:#37e6ff; --magenta:#ff3fa4; --violet:#7a4bff; --ink:#0d0a24;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
button{font-family:var(--font-ui);cursor:pointer}
.app{position:relative;width:100%;height:100%;overflow:hidden;background:#0d0a24;
  font-family:var(--font-ui);touch-action:none;user-select:none;-webkit-user-select:none;}
.app canvas{display:block;width:100%;height:100%;touch-action:none;image-rendering:pixelated;image-rendering:crisp-edges;}
.hud{position:absolute;inset:0;pointer-events:none;color:#eaf6ff;}
.hud.hidden{visibility:hidden;}
.hud-top{position:absolute;top:14px;left:14px;right:14px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
.stat{background:rgba(13,10,36,.62);border:1px solid rgba(55,230,255,.35);border-radius:10px;
  padding:7px 10px 8px;backdrop-filter:blur(3px);box-shadow:0 0 14px rgba(55,230,255,.18) inset;}
.stat .label{display:block;font-family:var(--font-display);font-size:9px;letter-spacing:2px;color:#8fa7d8;line-height:1;}
.stat .value{display:block;font-family:var(--font-display);font-size:22px;line-height:1.15;color:var(--cyan);
  text-shadow:0 0 10px rgba(55,230,255,.65);margin-top:3px;}
.hull{display:flex;gap:5px;margin-top:6px;}
.pip{width:15px;height:11px;clip-path:polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%);
  background:#2c3556;border:1px solid #3a4670;}
.pip.on{background:linear-gradient(180deg,#7df3ff,#19b8d6);box-shadow:0 0 9px rgba(55,230,255,.8);}
.pip.hit{animation:pipFlash .35s ease;}
@keyframes pipFlash{50%{background:#ff4d6d;box-shadow:0 0 12px rgba(255,77,109,.9);}}
.heat{position:absolute;left:14px;bottom:16px;width:132px;}
.heat .label{font-family:var(--font-display);font-size:9px;letter-spacing:2px;color:#8fa7d8;margin-bottom:4px;display:flex;justify-content:space-between;}
.heat .label em{font-style:normal;color:var(--cyan);}
.heat.over .label em{color:#ff4d6d;animation:blink .5s steps(2) infinite;}
.bar{height:8px;border-radius:5px;background:rgba(13,10,36,.65);border:1px solid rgba(55,230,255,.3);overflow:hidden;}
.bar i{display:block;height:100%;width:0%;border-radius:4px;
  background:linear-gradient(90deg,#37e6ff,#7a4bff);box-shadow:0 0 10px rgba(55,230,255,.7);transition:width .12s linear;}
.heat.over .bar i{background:linear-gradient(90deg,#ff4d6d,#ff3fa4);}
@keyframes blink{50%{opacity:.25;}}
.guide{position:absolute;top:27%;left:0;right:0;text-align:center;pointer-events:none;
  font-family:var(--font-display);font-size:21px;letter-spacing:3px;color:#eaf6ff;
  text-shadow:0 0 14px rgba(55,230,255,.85),0 2px 6px rgba(13,10,36,.9);
  animation:breathe 2.4s ease-in-out infinite;}
.guide small{display:block;font-family:var(--font-ui);font-size:12px;letter-spacing:1px;margin-top:8px;color:#9fc2ff;font-weight:700;}
@keyframes breathe{50%{opacity:.55;transform:translateY(-4px);}}
@media(prefers-reduced-motion:reduce){.guide{animation:none;}.pip.hit{animation:none;}}
.vignette{position:absolute;inset:0;pointer-events:none;opacity:0;
  background:radial-gradient(ellipse at center,rgba(255,77,109,0) 42%,rgba(255,45,85,.55) 100%);}
.vignette.flash{animation:flash .45s ease-out;}
@keyframes flash{0%{opacity:.9;}100%{opacity:0;}}
.banner{position:absolute;top:20%;left:0;right:0;text-align:center;pointer-events:none;
  font-family:var(--font-display);font-size:18px;letter-spacing:4px;color:var(--yellow);
  text-shadow:0 0 16px rgba(255,217,90,.8);animation:breathe 1.6s ease-in-out infinite;}
.result{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at center,rgba(36,26,77,.72),rgba(13,10,36,.92));pointer-events:auto;}
.panel{width:min(300px,calc(100% - 56px));border-radius:18px;padding:24px 22px 20px;text-align:center;
  background:linear-gradient(165deg,rgba(46,32,96,.96),rgba(17,12,44,.96));
  border:1px solid rgba(55,230,255,.45);box-shadow:0 0 34px rgba(122,75,255,.45),0 0 18px rgba(55,230,255,.25) inset;}
.panel h2{margin:0 0 4px;font-family:var(--font-display);font-size:24px;letter-spacing:3px;color:var(--cyan);
  text-shadow:0 0 14px rgba(55,230,255,.7);}
.panel .sub{font-size:11px;letter-spacing:2px;color:#9fa8d8;margin-bottom:16px;font-weight:700;}
.scores{display:flex;gap:10px;margin-bottom:18px;}
.score-box{flex:1;background:rgba(13,10,36,.6);border:1px solid rgba(122,75,255,.4);border-radius:12px;padding:10px 4px;}
.score-box .k{display:block;font-size:9px;letter-spacing:1.5px;color:#8fa7d8;font-weight:700;}
.score-box .v{display:block;font-family:var(--font-display);font-size:20px;color:#fff;margin-top:4px;}
.score-box .v.gold{color:var(--yellow);text-shadow:0 0 10px rgba(255,217,90,.6);}
.replay{width:100%;border:0;border-radius:12px;padding:13px 0;font-family:var(--font-display);
  font-size:16px;letter-spacing:3px;color:#0d0a24;
  background:linear-gradient(90deg,#37e6ff,#7af0ff);box-shadow:0 0 20px rgba(55,230,255,.55);}
.replay:active{transform:scale(.97);}
[data-feed-cover="true"] .hud{visibility:hidden;}
`;

/* ------------------------------------------------------------------ */
/* Canvas-generated textures: radial glows, stripes, particles.        */
/* ------------------------------------------------------------------ */
function makeGlowTexture(inner, outer) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.35, outer);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeChuteTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  for (let x = 0; x < 64; x += 8) {
    ctx.fillStyle = (x / 8) % 2 ? '#eaf6ff' : '#378bff';
    ctx.fillRect(x, 0, 8, 64);
  }
  const shade = ctx.createLinearGradient(0, 0, 0, 64);
  shade.addColorStop(0, 'rgba(255,255,255,.35)');
  shade.addColorStop(1, 'rgba(13,10,36,.35)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/* ------------------------------------------------------------------ */
/* Model factories. UFOs are faceted low-poly geometry with emissive   */
/* neon trim and canvas glow sprites (no postprocessing dependency).   */
/* ------------------------------------------------------------------ */
function buildUfo(theme, glowCyan, glowMagenta, glowWhite) {
  const group = new THREE.Group();
  const geos = [], mats = [];
  const track = (asset, bucket) => { bucket.push(asset); return asset; };
  const enemy = theme === 'enemy';
  const hullColor = enemy ? 0x2f8f6b : 0xdfeeff;
  const rimColor = enemy ? COLORS.danger : COLORS.cyan;
  const domeColor = enemy ? 0x9b5cff : COLORS.yellow;
  const engineColor = enemy ? 0xff7a59 : 0x63b7ff;

  const hullMat = track(new THREE.MeshStandardMaterial({
    color: hullColor, metalness: enemy ? 0.25 : 0.55, roughness: enemy ? 0.5 : 0.32,
    flatShading: true, emissive: enemy ? 0x0c3a2c : 0x12233f, emissiveIntensity: 0.55,
  }), mats);
  const darkMat = track(new THREE.MeshStandardMaterial({
    color: enemy ? 0x1d2a44 : 0x26314f, metalness: 0.5, roughness: 0.6, flatShading: true,
  }), mats);
  const neonMat = track(new THREE.MeshStandardMaterial({
    color: rimColor, emissive: rimColor, emissiveIntensity: 2.4, roughness: 0.4,
  }), mats);
  const domeMat = track(new THREE.MeshStandardMaterial({
    color: domeColor, emissive: domeColor, emissiveIntensity: enemy ? 0.5 : 0.35,
    transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.1, flatShading: true,
  }), mats);
  const engineMat = track(new THREE.MeshStandardMaterial({
    color: engineColor, emissive: engineColor, emissiveIntensity: 2.6,
  }), mats);

  const body = track(new THREE.CylinderGeometry(0.95, 1.28, 0.34, 20), geos);
  group.add(new THREE.Mesh(body, hullMat));
  const deck = track(new THREE.CylinderGeometry(0.52, 0.82, 0.2, 20), geos);
  const deckMesh = new THREE.Mesh(deck, hullMat);
  deckMesh.position.y = 0.17;
  group.add(deckMesh);
  const belly = track(new THREE.ConeGeometry(0.6, 0.46, 20), geos);
  const bellyMesh = new THREE.Mesh(belly, darkMat);
  bellyMesh.rotation.x = Math.PI;
  bellyMesh.position.y = -0.3;
  group.add(bellyMesh);
  const rimGeo = track(new THREE.TorusGeometry(1.04, 0.065, 8, 28), geos);
  const rim = new THREE.Mesh(rimGeo, neonMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.04;
  group.add(rim);
  const domeGeo = track(new THREE.SphereGeometry(0.46, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), geos);
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.position.y = 0.26;
  group.add(dome);

  const podGeo = track(new THREE.CylinderGeometry(0.13, 0.17, 0.26, 10), geos);
  const nozGeo = track(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 10), geos);
  const engineGlows = [];
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + i * Math.PI / 2;
    const px = Math.cos(angle) * 0.8, pz = Math.sin(angle) * 0.8;
    const pod = new THREE.Mesh(podGeo, darkMat);
    pod.position.set(px, -0.16, pz);
    group.add(pod);
    const noz = new THREE.Mesh(nozGeo, engineMat);
    noz.position.set(px, -0.32, pz);
    group.add(noz);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowWhite, color: engineColor, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false,
    }));
    glow.position.set(px, -0.42, pz);
    glow.scale.setScalar(0.55);
    group.add(glow);
    engineGlows.push(glow);
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: enemy ? glowMagenta : glowCyan, color: rimColor, blending: THREE.AdditiveBlending,
    transparent: true, opacity: 0.8, depthWrite: false,
  }));
  halo.scale.setScalar(3.5);
  halo.position.y = -0.1;
  group.add(halo);
  group.userData.dispose = () => {
    geos.forEach(g => g.dispose());
    mats.forEach(m => m.dispose());
    halo.material.dispose();
    engineGlows.forEach(g => g.material.dispose());
  };
  group.userData.engineGlows = engineGlows;
  group.userData.halo = halo;
  return group;
}

function buildIsland(terrainTexture, glowCyan, rng) {
  const group = new THREE.Group();
  const geos = [], mats = [];
  const r = 2.2 + rng() * 1.5;
  const depth = 1.4 + rng() * 1.1;
  const rockMat = new THREE.MeshStandardMaterial({
    color: rng() > 0.5 ? 0x3a2566 : 0x2b2358, roughness: 0.9, flatShading: true,
  });
  mats.push(rockMat);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.82, depth, 12), rockMat);
  geos.push(base.geometry);
  group.add(base);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 0.82, 2.1, 12), rockMat);
  cone.position.y = -depth / 2 - 0.95;
  geos.push(cone.geometry);
  group.add(cone);
  const topMat = new THREE.MeshStandardMaterial({ map: terrainTexture, roughness: 0.95, flatShading: true });
  mats.push(topMat);
  const top = new THREE.Mesh(new THREE.CircleGeometry(r * 0.97, 14), topMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = depth / 2 + 0.02;
  geos.push(top.geometry);
  group.add(top);
  const rimMat = new THREE.MeshStandardMaterial({
    color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 1.6,
  });
  mats.push(rimMat);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.97, 0.07, 8, 26), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = depth / 2 + 0.05;
  geos.push(rim.geometry);
  group.add(rim);

  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x8df3ff, emissive: 0x2fd8ff, emissiveIntensity: 1.8, flatShading: true,
    transparent: true, opacity: 0.92, roughness: 0.2,
  });
  const violetMat = new THREE.MeshStandardMaterial({
    color: 0xc99bff, emissive: 0x8a4bff, emissiveIntensity: 1.6, flatShading: true,
    transparent: true, opacity: 0.92, roughness: 0.2,
  });
  mats.push(crystalMat, violetMat);
  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0xff5fb0, emissive: 0xff2f92, emissiveIntensity: 0.7, flatShading: true,
  });
  mats.push(foliageMat);
  const crystalGeo = new THREE.OctahedronGeometry(0.34, 0);
  const foliageGeo = new THREE.IcosahedronGeometry(0.3, 0);
  geos.push(crystalGeo, foliageGeo);
  const propCount = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < propCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = r * (0.25 + rng() * 0.55);
    const px = Math.cos(angle) * dist, pz = Math.sin(angle) * dist;
    if (rng() > 0.45) {
      const crystal = new THREE.Mesh(crystalGeo, rng() > 0.4 ? crystalMat : violetMat);
      const s = 0.7 + rng() * 1.1;
      crystal.scale.set(s, s * (1.4 + rng()), s);
      crystal.position.set(px, depth / 2 + 0.3 * s, pz);
      crystal.rotation.y = rng() * Math.PI;
      group.add(crystal);
    } else {
      const blob = new THREE.Mesh(foliageGeo, foliageMat);
      const s = 0.8 + rng() * 0.9;
      blob.scale.set(s, s * 0.8, s);
      blob.position.set(px, depth / 2 + 0.22, pz);
      group.add(blob);
    }
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowCyan, color: COLORS.violet, blending: THREE.AdditiveBlending,
    transparent: true, opacity: 0.35, depthWrite: false,
  }));
  glow.scale.setScalar(r * 2.4);
  glow.position.y = depth / 2;
  group.add(glow);
  group.userData = {
    radius: r,
    dispose() {
      geos.forEach(g => g.dispose());
      mats.forEach(m => m.dispose());
      glow.material.dispose();
    },
  };
  return group;
}

function buildPilot(chuteTexture, glowCyan) {
  const root = new THREE.Group();
  const geos = [], mats = [];
  const suitMat = new THREE.MeshStandardMaterial({ color: 0xeaf6ff, roughness: 0.6, flatShading: true });
  const helmetMat = new THREE.MeshStandardMaterial({
    color: 0x37e6ff, emissive: 0x1a9ec2, emissiveIntensity: 0.8, flatShading: true,
  });
  mats.push(suitMat, helmetMat);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.34, 8), suitMat);
  geos.push(body.geometry);
  body.position.y = 0;
  root.add(body);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), helmetMat);
  geos.push(helmet.geometry);
  helmet.position.y = 0.26;
  root.add(helmet);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.12), suitMat);
  geos.push(pack.geometry);
  pack.position.set(0, 0.02, 0.12);
  root.add(pack);

  const chute = new THREE.Group();
  const canopyMat = new THREE.MeshStandardMaterial({
    map: chuteTexture, side: THREE.DoubleSide, roughness: 0.7, flatShading: true,
  });
  mats.push(canopyMat);
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.85, 12, 1, true), canopyMat);
  geos.push(canopy.geometry);
  canopy.position.y = 1.15;
  chute.add(canopy);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.85 });
  mats.push(lineMat);
  const linePositions = [];
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3;
    linePositions.push(0, 0.78, 0, Math.cos(angle) * 0.85, 1.05, Math.sin(angle) * 0.85);
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  geos.push(lineGeo);
  chute.add(new THREE.LineSegments(lineGeo, lineMat));
  chute.visible = false;
  chute.scale.setScalar(0.2);
  root.add(chute);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowCyan, color: 0x9fd8ff, blending: THREE.AdditiveBlending,
    transparent: true, opacity: 0.5, depthWrite: false,
  }));
  glow.scale.setScalar(1.4);
  glow.position.y = 0.1;
  root.add(glow);
  root.userData = {
    chute,
    dispose() { geos.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); glow.material.dispose(); },
  };
  return root;
}

/* Pooled explosion bursts: point particles + flash sprite + shockwave ring. */
function createEffects(scene, glowWhite, glowCyan, glowMagenta) {
  const bursts = [];
  const ringGeo = new THREE.RingGeometry(0.4, 0.55, 26);
  for (let i = 0; i < 10; i++) {
    const count = 34;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.32, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.visible = false;
    scene.add(points);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowWhite, blending: THREE.AdditiveBlending, transparent: true,
      depthWrite: false, opacity: 0,
    }));
    flash.visible = false;
    scene.add(flash);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    ring.visible = false;
    scene.add(ring);
    bursts.push({points, flash, ring, positions, velocities, count, age: 0, ttl: 0, active: false});
  }
  function spawn(position, color, scale = 1) {
    const burst = bursts.find(b => !b.active) || bursts[0];
    burst.active = true;
    burst.age = 0;
    burst.ttl = 0.75;
    for (let i = 0; i < burst.count; i++) {
      burst.positions[i * 3] = position.x;
      burst.positions[i * 3 + 1] = position.y;
      burst.positions[i * 3 + 2] = position.z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = (3.5 + Math.random() * 6) * scale;
      burst.velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      burst.velocities[i * 3 + 1] = Math.cos(phi) * speed;
      burst.velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }
    burst.points.geometry.attributes.position.needsUpdate = true;
    burst.points.material.color.setHex(color);
    burst.points.material.opacity = 1;
    burst.points.visible = true;
    burst.flash.position.copy(position);
    burst.flash.material.color.setHex(color);
    burst.flash.material.opacity = 0.95;
    burst.flash.scale.setScalar(0.6 * scale);
    burst.flash.visible = true;
    burst.ring.position.copy(position);
    burst.ring.material.color.setHex(color);
    burst.ring.material.opacity = 0.9;
    burst.ring.scale.setScalar(0.4 * scale);
    burst.ring.visible = true;
  }
  function update(dt) {
    for (const burst of bursts) {
      if (!burst.active) continue;
      burst.age += dt;
      const k = burst.age / burst.ttl;
      if (k >= 1) {
        burst.active = false;
        burst.points.visible = false;
        burst.flash.visible = false;
        burst.ring.visible = false;
        continue;
      }
      for (let i = 0; i < burst.count; i++) {
        burst.velocities[i * 3 + 1] -= 4.5 * dt;
        burst.positions[i * 3] += burst.velocities[i * 3] * dt;
        burst.positions[i * 3 + 1] += burst.velocities[i * 3 + 1] * dt;
        burst.positions[i * 3 + 2] += burst.velocities[i * 3 + 2] * dt;
      }
      burst.points.geometry.attributes.position.needsUpdate = true;
      burst.points.material.opacity = 1 - k;
      burst.flash.material.opacity = 0.95 * (1 - k * 1.6);
      burst.flash.scale.multiplyScalar(1 + dt * 5);
      burst.ring.material.opacity = 0.9 * (1 - k);
      burst.ring.scale.multiplyScalar(1 + dt * 7);
    }
  }
  function dispose() {
    bursts.forEach(b => {
      b.points.geometry.dispose();
      b.points.material.dispose();
      b.flash.material.dispose();
      b.ring.material.dispose();
      scene.remove(b.points, b.flash, b.ring);
    });
    ringGeo.dispose();
  }
  return {spawn, update, dispose};
}

/* ------------------------------------------------------------------ */
/* Main game component                                                  */
/* ------------------------------------------------------------------ */
function App() {
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const [ui, setUi] = useState({
    phase: 'idle', hull: DEFAULTS.HULL_MAX, kills: 0, distance: 0,
    heat: 0, overheat: false, best: 0, showResult: false,
    banner: '', flashKey: 0, score: 0, shots: 0,
  });

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    const host = hostRef.current;
    const cfg = {...DEFAULTS};

    /* Register synthesized SFX (window.SFX is injected by the build banner). */
    try {
      window.SFX?.register({
        laser: './assets/audio/laser.mp3',
        enemy_laser: './assets/audio/enemy_laser.mp3',
        explosion: './assets/audio/explosion.mp3',
        hit: './assets/audio/hit.mp3',
        alarm: './assets/audio/alarm.mp3',
        ui: './assets/audio/ui.mp3',
        respawn: './assets/audio/respawn.mp3',
      });
    } catch (error) { /* audio is progressive enhancement */ }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.sky);
    scene.fog = new THREE.Fog(COLORS.fog, 38, 125);
    const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 400);
    camera.position.set(0, 2.7, 8.4);
    const renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: 'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * 0.6);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const canvas = renderer.domElement;

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const unwatch = watchGameSize(host, resize);

    /* Textures */
    const loader = new THREE.TextureLoader();
    const skyTexture = loader.load('./assets/img/sky_neon.png');
    skyTexture.colorSpace = THREE.SRGBColorSpace;
    const terrainTexture = loader.load('./assets/img/terrain_pixel.png');
    terrainTexture.colorSpace = THREE.SRGBColorSpace;
    terrainTexture.wrapS = terrainTexture.wrapT = THREE.RepeatWrapping;
    terrainTexture.repeat.set(2, 2);
    terrainTexture.anisotropy = 4;
    const glowCyan = makeGlowTexture('rgba(190,250,255,1)', 'rgba(55,230,255,.55)');
    const glowMagenta = makeGlowTexture('rgba(255,210,235,1)', 'rgba(255,63,164,.55)');
    const glowWhite = makeGlowTexture('rgba(255,255,255,1)', 'rgba(180,220,255,.5)');

    /* Sky dome */
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(180, 28, 18),
      new THREE.MeshBasicMaterial({map: skyTexture, side: THREE.BackSide, fog: false, depthWrite: false})
    );
    sky.renderOrder = -1;
    scene.add(sky);

    /* Lights */
    scene.add(new THREE.HemisphereLight(0x9a7bff, 0x140c33, 1.35));
    const keyLight = new THREE.DirectionalLight(0xff9ecf, 1.5);
    keyLight.position.set(-6, 9, 4);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x59d8ff, 1.1);
    rimLight.position.set(6, 3, -8);
    scene.add(rimLight);

    /* Starfield (world-space, slow parallax flow) */
    const starLayers = [];
    for (let layer = 0; layer < 2; layer++) {
      const count = layer ? 260 : 380;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 130;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 70 + 6;
        positions[i * 3 + 2] = -160 + Math.random() * 180;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        color: layer ? 0x9fd8ff : 0xffffff, size: layer ? 0.55 : 0.8,
        transparent: true, opacity: layer ? 0.7 : 0.95, fog: false, sizeAttenuation: true,
      });
      const points = new THREE.Points(geo, mat);
      scene.add(points);
      starLayers.push({points, positions, count, factor: layer ? 0.22 : 0.4});
    }

    /* Drifting neon clouds */
    const clouds = [];
    const cloudGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: Math.random() > 0.5 ? glowMagenta : glowCyan,
        transparent: true, opacity: 0.16 + Math.random() * 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const cloud = new THREE.Mesh(cloudGeo, mat);
      cloud.scale.set(14 + Math.random() * 16, 6 + Math.random() * 6, 1);
      cloud.position.set((Math.random() - 0.5) * 90, -6 + Math.random() * 16, -160 + Math.random() * 180);
      scene.add(cloud);
      clouds.push(cloud);
    }

    /* Player */
    const player = buildUfo('player', glowCyan, glowMagenta, glowWhite);
    player.scale.setScalar(0.82);
    player.position.set(0, -0.4, 1.2);
    scene.add(player);

    /* Island pool, pre-spread along the whole flight corridor. */
    const rng = Math.random;
    const islands = [];
    const placeIsland = (island, z) => {
      if (rng() > 0.87) {
        island.position.x = (rng() - 0.5) * 7;
        island.position.y = rng() > 0.5 ? 4.8 + rng() * 1.6 : -4 - rng() * 1.4;
      } else {
        island.position.x = (rng() > 0.5 ? 1 : -1) * (6.4 + rng() * 5.2);
        island.position.y = -2.2 + rng() * 4.6;
      }
      island.position.z = z;
      island.rotation.y = rng() * Math.PI * 2;
    };
    for (let i = 0; i < 9; i++) {
      const island = buildIsland(terrainTexture, glowCyan, rng);
      placeIsland(island, 8 - i * 19);
      scene.add(island);
      islands.push(island);
    }

    /* Laser / bolt pools */
    function makeProjectile(color, glowTex, length, radius) {
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.95});
      const geo = new THREE.CylinderGeometry(radius, radius, length, 6);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI / 2;
      group.add(mesh);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }));
      glow.scale.setScalar(0.7);
      group.add(glow);
      group.visible = false;
      scene.add(group);
      return {group, mat, glow, active: false, vel: new THREE.Vector3(), life: 0};
    }
    const lasers = Array.from({length: 24}, () => makeProjectile(COLORS.cyan, glowCyan, 2.2, 0.07));
    const bolts = Array.from({length: 18}, () => makeProjectile(COLORS.danger, glowMagenta, 1.1, 0.11));

    const effects = createEffects(scene, glowWhite, glowCyan, glowMagenta);

    /* Pilot + reserve UFO for the signature respawn cutscene */
    const chuteTexture = makeChuteTexture();
    const pilot = buildPilot(chuteTexture, glowCyan);
    pilot.visible = false;
    scene.add(pilot);
    const reserveUfo = buildUfo('player', glowCyan, glowMagenta, glowWhite);
    reserveUfo.scale.setScalar(0.82);
    reserveUfo.visible = false;
    scene.add(reserveUfo);

    /* ---------------------------------------------------------------- */
    const G = {
      phase: 'idle',
      hull: cfg.HULL_MAX, kills: 0, distance: 0, heat: 0, overheat: false,
      invuln: 0, shots: 0, speed: cfg.BASE_SPEED, elapsed: 0,
      target: new THREE.Vector2(0, -0.4),
      vel: new THREE.Vector2(0, 0),
      enemies: [], enemyTimer: 1.2, islandTimer: 0, fireTimer: 0,
      respawnsLeft: 1, cut: null,
    };
    let flashKey = 0;
    let best = 0;
    try { best = Number(localStorage.getItem('neon-ufo-run-best')) || 0; } catch (e) { /* no storage */ }
    setUi(u => ({...u, best}));

    function syncUi(extra) {
      setUi(u => ({
        ...u,
        phase: G.phase,
        hull: G.hull,
        kills: G.kills,
        distance: Math.floor(G.distance),
        heat: G.heat,
        overheat: G.overheat,
        shots: G.shots,
        score: G.kills * 100 + Math.floor(G.distance),
        ...extra,
      }));
    }

    function resetRun() {
      G.hull = cfg.HULL_MAX; G.kills = 0; G.distance = 0; G.heat = 0; G.overheat = false;
      G.invuln = 0; G.shots = 0; G.elapsed = 0; G.speed = cfg.BASE_SPEED;
      G.target.set(0, -0.4); G.vel.set(0, 0);
      G.enemies.forEach(e => scene.remove(e.mesh));
      G.enemies.length = 0;
      lasers.forEach(l => { l.active = false; l.group.visible = false; });
      bolts.forEach(b => { b.active = false; b.group.visible = false; });
      G.enemyTimer = 1.2; G.fireTimer = 0; G.respawnsLeft = 1; G.cut = null;
      player.visible = true;
      player.position.set(0, -0.4, 1.2);
      pilot.visible = false;
      reserveUfo.visible = false;
      G.phase = 'play';
      syncUi({showResult: false, banner: ''});
    }

    /* Expose controls to the React layer (replay button, external check). */
    engineRef.current = {
      reset: resetRun,
      state: () => ({...G, distance: Math.floor(G.distance)}),
    };

    /* ----------------------------- spawning ----------------------------- */
    function spawnIsland() {
      const slot = islands.find(i => i.position.z > 18);
      if (!slot) return;
      placeIsland(slot, -132 - rng() * 12);
    }
    function spawnEnemy() {
      if (G.enemies.length >= 6) return;
      const big = rng() > 0.82;
      const mesh = buildUfo('enemy', glowCyan, glowMagenta, glowWhite);
      mesh.scale.setScalar(big ? 1.32 : 1.0);
      mesh.position.set((rng() - 0.5) * 9.6, -1.8 + rng() * 4.8, -95);
      scene.add(mesh);
      G.enemies.push({
        mesh, hp: big ? 2 : 1, fireIn: 0.8 + rng() * 1.2,
        bob: rng() * Math.PI * 2, big,
      });
    }
    function fireLasers() {
      for (const side of [-1, 1]) {
        const laser = lasers.find(l => !l.active);
        if (!laser) return;
        laser.active = true;
        laser.group.visible = true;
        laser.group.position.set(
          player.position.x + side * 0.62,
          player.position.y - 0.28,
          player.position.z - 0.5
        );
        laser.vel.set(0, 0, -72);
        laser.life = 1.7;
      }
      G.shots++;
      G.heat = Math.min(1, G.heat + cfg.HEAT_PER_SHOT);
      if (G.heat >= 1) G.overheat = true;
      play('laser');
    }
    function enemyFire(enemy) {
      const bolt = bolts.find(b => !b.active);
      if (!bolt) return;
      bolt.active = true;
      bolt.group.visible = true;
      bolt.group.position.copy(enemy.mesh.position);
      const aim = new THREE.Vector3().subVectors(player.position, enemy.mesh.position).normalize();
      bolt.vel.copy(aim.multiplyScalar(27));
      bolt.life = 4;
      play('enemy_laser');
    }

    /* ----------------------------- damage ----------------------------- */
    function damage(impactPos) {
      if (G.invuln > 0 || G.phase !== 'play') return;
      G.hull -= 1;
      G.invuln = 1.3;
      effects.spawn(impactPos || player.position, COLORS.danger, 0.9);
      play('hit');
      if (G.hull <= 1) play('alarm');
      syncUi({flashKey: ++flashKey});
      if (G.hull <= 0) startDeath();
    }

    function startDeath() {
      effects.spawn(player.position, 0xffd95a, 1.7);
      effects.spawn(player.position, COLORS.magenta, 1.2);
      play('explosion');
      /* Clean the air so the parachute cutscene reads clearly. */
      G.enemies.forEach(e => {
        scene.remove(e.mesh);
        e.mesh.userData.dispose();
      });
      G.enemies.length = 0;
      bolts.forEach(b => { b.active = false; b.group.visible = false; });
      if (G.respawnsLeft > 0) {
        G.respawnsLeft -= 1;
        G.phase = 'respawn';
        player.visible = false;
        pilot.visible = true;
        pilot.position.copy(player.position);
        pilot.userData.chute.visible = false;
        pilot.userData.chute.scale.setScalar(0.2);
        G.cut = {t: 0, vy: 6.5, opened: false, merged: false, detached: false};
        syncUi({banner: 'EJECTING…'});
      } else {
        G.phase = 'over';
        player.visible = false;
        const score = G.kills * 100 + Math.floor(G.distance);
        if (score > best) {
          best = score;
          try { localStorage.setItem('neon-ufo-run-best', String(best)); } catch (e) { /* no storage */ }
        }
        window.setTimeout(() => syncUi({showResult: true, best, banner: ''}), 900);
        syncUi({banner: ''});
      }
    }

    /* ----------------------------- input ----------------------------- */
    let dragging = false;
    const dragStart = new THREE.Vector2();
    const targetStart = new THREE.Vector2();
    function pointerPos(e) {
      const rect = canvas.getBoundingClientRect();
      return new THREE.Vector2(
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height
      );
    }
    function onDown(e) {
      if (e.button > 0 || e.isPrimary === false) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is best effort */ }
      dragging = true;
      if (G.phase === 'idle') resetRun();
      const p = pointerPos(e);
      dragStart.copy(p);
      targetStart.copy(G.target);
      try { window.SFX?.unlock(); } catch (err) { /* no audio */ }
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      const p = pointerPos(e);
      const dx = (p.x - dragStart.x) * 11;
      const dy = -(p.y - dragStart.y) * 8.5;
      G.target.x = THREE.MathUtils.clamp(targetStart.x + dx, -4.6, 4.6);
      G.target.y = THREE.MathUtils.clamp(targetStart.y + dy, -2.9, 3.4);
      e.preventDefault();
    }
    function onUp(e) {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('lostpointercapture', onUp);
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    /* ----------------------------- loop ----------------------------- */
    const clock = new THREE.Clock();
    const camTarget = new THREE.Vector3();
    const camLook = new THREE.Vector3(0, 0.2, -8);
    let uiTimer = 0;

    function updateStars(dt, flow) {
      for (const layer of starLayers) {
        const pos = layer.positions;
        for (let i = 0; i < layer.count; i++) {
          pos[i * 3 + 2] += flow * layer.factor * dt;
          if (pos[i * 3 + 2] > 22) {
            pos[i * 3 + 2] = -160;
            pos[i * 3] = (Math.random() - 0.5) * 130;
            pos[i * 3 + 1] = (Math.random() - 0.5) * 70 + 6;
          }
        }
        layer.points.geometry.attributes.position.needsUpdate = true;
      }
      for (const cloud of clouds) {
        cloud.position.z += flow * 0.55 * dt;
        if (cloud.position.z > 20) {
          cloud.position.z = -160;
          cloud.position.x = (Math.random() - 0.5) * 90;
          cloud.position.y = -6 + Math.random() * 16;
        }
      }
    }

    function updatePlayer(dt, time) {
      const k = 1 - Math.exp(-dt * 9);
      const prevX = player.position.x, prevY = player.position.y;
      player.position.x += (G.target.x - player.position.x) * k;
      player.position.y += (G.target.y - player.position.y) * k;
      G.vel.set((player.position.x - prevX) / Math.max(dt, 1e-4),
                (player.position.y - prevY) / Math.max(dt, 1e-4));
      player.rotation.z = THREE.MathUtils.clamp(-G.vel.x * 0.11, -0.75, 0.75);
      player.rotation.x = THREE.MathUtils.clamp(G.vel.y * 0.08, -0.45, 0.45);
      player.position.z = 1.2 + Math.sin(time * 2.2) * 0.06;
      const pulse = 1 + Math.sin(time * 14) * 0.12;
      player.userData.engineGlows.forEach(g => g.scale.setScalar(0.55 * pulse));
      /* Short blink: ship stays visible ~75% of the invulnerability window. */
      player.visible = G.invuln > 0 ? (Math.floor(time * 10) % 4 !== 0) : true;
    }

    function updateProjectiles(dt) {
      for (const laser of lasers) {
        if (!laser.active) continue;
        laser.group.position.addScaledVector(laser.vel, dt);
        laser.life -= dt;
        if (laser.life <= 0 || laser.group.position.z < -120) {
          laser.active = false; laser.group.visible = false;
        }
      }
      for (const bolt of bolts) {
        if (!bolt.active) continue;
        bolt.group.position.addScaledVector(bolt.vel, dt);
        bolt.group.rotation.z += dt * 9;
        bolt.life -= dt;
        if (bolt.life <= 0 || bolt.group.position.z > 12) {
          bolt.active = false; bolt.group.visible = false;
        }
      }
    }

    function updateEnemies(dt, time) {
      for (let i = G.enemies.length - 1; i >= 0; i--) {
        const enemy = G.enemies[i];
        const m = enemy.mesh;
        m.position.z += G.speed * 0.62 * dt;
        m.position.x += THREE.MathUtils.clamp(player.position.x - m.position.x, -1, 1) * 0.55 * dt;
        m.position.y += Math.sin(time * 1.8 + enemy.bob) * 0.35 * dt;
        m.rotation.y += dt * 1.4;
        const pulse = 1 + Math.sin(time * 12 + enemy.bob) * 0.14;
        m.userData.engineGlows.forEach(g => g.scale.setScalar(0.5 * pulse));
        enemy.fireIn -= dt;
        if (enemy.fireIn <= 0 && m.position.z < -8 && m.position.z > -75) {
          enemyFire(enemy);
          enemy.fireIn = 1.9 + Math.random() * 1;
        }
        if (m.position.z > 12) {
          scene.remove(m);
          m.userData.dispose();
          G.enemies.splice(i, 1);
        }
      }
    }

    function handleCombat() {
      /* lasers vs enemies */
      for (const laser of lasers) {
        if (!laser.active) continue;
        for (let i = G.enemies.length - 1; i >= 0; i--) {
          const enemy = G.enemies[i];
          if (laser.group.position.distanceTo(enemy.mesh.position) < 1.25) {
            laser.active = false; laser.group.visible = false;
            enemy.hp -= 1;
            effects.spawn(laser.group.position, COLORS.cyan, 0.55);
            if (enemy.hp <= 0) {
              effects.spawn(enemy.mesh.position, COLORS.yellow, 1.15);
              effects.spawn(enemy.mesh.position, COLORS.magenta, 0.85);
              play('explosion');
              G.kills += 1;
              scene.remove(enemy.mesh);
              enemy.mesh.userData.dispose();
              G.enemies.splice(i, 1);
            }
            break;
          }
        }
      }
      if (G.phase !== 'play') return;
      /* bolts vs player */
      for (const bolt of bolts) {
        if (!bolt.active) continue;
        if (bolt.group.position.distanceTo(player.position) < 0.95) {
          bolt.active = false; bolt.group.visible = false;
          damage(bolt.group.position.clone());
        }
      }
      /* enemies vs player */
      for (const enemy of G.enemies) {
        if (enemy.mesh.position.distanceTo(player.position) < 1.35) {
          effects.spawn(enemy.mesh.position, COLORS.danger, 1.1);
          scene.remove(enemy.mesh);
          enemy.mesh.userData.dispose();
          G.enemies.splice(G.enemies.indexOf(enemy), 1);
          damage(player.position.clone());
          break;
        }
      }
      /* islands vs player */
      for (const island of islands) {
        if (Math.abs(island.position.z - player.position.z) > island.userData.radius) continue;
        const dx = player.position.x - island.position.x;
        const dy = player.position.y - island.position.y;
        if (Math.hypot(dx, dy) < island.userData.radius * 0.82) {
          damage(player.position.clone());
          G.target.x = THREE.MathUtils.clamp(player.position.x + Math.sign(dx || 1) * 2.4, -4.6, 4.6);
          G.target.y = THREE.MathUtils.clamp(player.position.y + Math.sign(dy || 1) * 1.8, -2.9, 3.4);
          break;
        }
      }
    }

    function updateRespawn(dt, time) {
      const cut = G.cut;
      cut.t += dt;
      /* pilot ballistic + parachute */
      if (!cut.opened) {
        cut.vy -= 11 * dt;
        pilot.position.y += cut.vy * dt;
        pilot.position.z -= 4 * dt;
        if (cut.t > 0.62) {
          cut.opened = true;
          pilot.userData.chute.visible = true;
          play('ui');
        }
      } else {
        pilot.position.y = Math.max(pilot.position.y - 1.7 * dt, reserveUfo.position.y + 1.35);
        pilot.position.z -= 1.2 * dt;
        const s = Math.min(1, pilot.userData.chute.scale.x + dt * 3.2);
        pilot.userData.chute.scale.setScalar(s);
      }
      pilot.rotation.z = Math.sin(time * 3) * 0.08;
      /* reserve UFO rises to catch the pilot */
      if (cut.t > 1.05 && !cut.merged) {
        reserveUfo.visible = true;
        reserveUfo.position.set(
          pilot.position.x,
          pilot.position.y - 1.35 + Math.sin(time * 3) * 0.05,
          pilot.position.z + 0.15
        );
      }
      if (cut.t > 2.15 && !cut.merged) {
        cut.merged = true;
        play('respawn');
      }
      if (cut.merged) {
        pilot.userData.chute.position.y += dt * 2.4;
        pilot.userData.chute.visible = cut.t < 2.55;
        const fade = 1 - (cut.t - 2.15) / 0.35;
        pilot.scale.setScalar(Math.max(0.05, fade));
      }
      if (cut.t > 2.55) {
        pilot.visible = false;
        pilot.scale.setScalar(1);
        pilot.userData.chute.position.y = 0;
        player.visible = true;
        player.position.copy(reserveUfo.position);
        G.target.set(reserveUfo.position.x, reserveUfo.position.y);
        reserveUfo.visible = false;
        G.hull = 2;
        G.invuln = 2;
        G.heat = 0;
        G.overheat = false;
        islands.forEach(island => { island.visible = true; });
        G.phase = 'play';
        G.cut = null;
        syncUi({banner: ''});
      }
    }

    function loop() {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      const time = clock.elapsedTime;
      if (document.hidden || disposed) return;
      const active = G.phase === 'play' || G.phase === 'respawn';
      const flow = G.phase === 'idle' ? cfg.BASE_SPEED * 0.55
        : G.phase === 'respawn' ? G.speed * 0.45 : G.speed;

      updateStars(dt, flow);
      for (const island of islands) {
        island.position.z += flow * dt;
        island.rotation.y += dt * 0.05;
        if (island.position.z > 18) spawnIsland();
      }

      if (G.phase === 'idle') {
        /* Silent autopilot demo: no enemies, no weapons, no score. */
        G.target.set(Math.sin(time * 0.55) * 2.4, Math.sin(time * 0.85) * 0.9 - 0.4);
        updatePlayer(dt, time);
      } else if (G.phase === 'play') {
        G.elapsed += dt;
        G.speed = Math.min(cfg.MAX_SPEED, cfg.BASE_SPEED + G.elapsed * 0.055);
        G.distance += G.speed * dt;
        if (G.invuln > 0) G.invuln -= dt;
        updatePlayer(dt, time);

        G.fireTimer += dt;
        if (G.overheat) {
          G.heat = Math.max(0, G.heat - dt * 0.7);
          if (G.heat <= 0.35) G.overheat = false;
        } else {
          G.heat = Math.max(0, G.heat - dt * 0.42);
          if (G.fireTimer >= cfg.FIRE_INTERVAL) {
            G.fireTimer = 0;
            fireLasers();
          }
        }
        G.enemyTimer -= dt;
        const interval = Math.max(0.95, cfg.ENEMY_INTERVAL - G.elapsed * 0.004);
        if (G.enemyTimer <= 0) {
          spawnEnemy();
          G.enemyTimer = interval * (0.75 + Math.random() * 0.5);
        }
        G.islandTimer -= dt;
        if (G.islandTimer <= 0) {
          spawnIsland();
          G.islandTimer = 1.9 + Math.random() * 0.9;
        }
        updateEnemies(dt, time);
        updateProjectiles(dt);
        handleCombat();
      } else if (G.phase === 'respawn') {
        updateRespawn(dt, time);
        updateProjectiles(dt);
        G.enemies.forEach(enemy => { enemy.mesh.position.z += G.speed * 0.4 * dt; });
      } else if (G.phase === 'over') {
        updateProjectiles(dt);
      }
      effects.update(dt);

      /* Camera follows gently; cutscene snaps to a side view of the pilot. */
      if (G.phase === 'respawn' && pilot.visible) {
        camTarget.set(pilot.position.x + 3.1, pilot.position.y + 1.5, pilot.position.z + 5.0);
        camLook.copy(pilot.position);
        camera.position.copy(camTarget);
        camera.lookAt(camLook);
        /* Cutscene reads cleanest against pure neon sky; islands return on rescue. */
        for (const island of islands) {
          island.visible = false;
        }
      } else {
        camTarget.set(player.position.x * 0.45, 2.7 + player.position.y * 0.32, 8.4);
        camLook.set(player.position.x * 0.6, player.position.y * 0.55, -8);
        camera.position.lerp(camTarget, 1 - Math.exp(-dt * 4.2));
        camera.lookAt(camLook);
        camera.rotation.z += THREE.MathUtils.clamp(-G.vel.x * 0.012, -0.08, 0.08);
      }

      uiTimer += dt;
      if (uiTimer > 0.12 && active) {
        uiTimer = 0;
        syncUi();
      }
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(loop);

    /* Config merge after the scene is live. */
    loadGameConfig().then(config => {
      if (!config || disposed) return;
      for (const item of [...(config.tweaks || []), ...(config.texts || [])]) {
        if (item && item.id in cfg) cfg[item.id] = item.value;
      }
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      unwatch();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('lostpointercapture', onUp);
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(m => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      });
      [glowCyan, glowMagenta, glowWhite, skyTexture, terrainTexture, chuteTexture].forEach(t => t.dispose());
      G.enemies.forEach(e => e.mesh.userData.dispose());
      islands.forEach(i => i.userData.dispose());
      player.userData.dispose();
      reserveUfo.userData.dispose();
      pilot.userData.dispose();
      effects.dispose();
      renderer.dispose();
      engineRef.current = null;
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, []);

  const heatPct = Math.round(ui.heat * 100);
  return (
    <div
      className="app"
      ref={hostRef}
      data-phase={ui.phase}
      data-distance={ui.distance}
      data-shots={ui.shots}
      data-kills={ui.kills}
    >
      <style>{CSS}</style>
      <div className={`hud ${ui.phase === 'idle' ? 'hidden' : ''}`}>
        <div className="hud-top">
          <div className="stat">
            <span className="label">KILLS</span>
            <span className="value">{String(ui.kills).padStart(2, '0')}</span>
            <div className="hull">
              {Array.from({length: DEFAULTS.HULL_MAX}).map((_, i) => (
                <span key={i} className={`pip ${i < ui.hull ? 'on' : ''}`} />
              ))}
            </div>
          </div>
          <div className="stat" style={{textAlign: 'right'}}>
            <span className="label">DIST</span>
            <span className="value">{ui.distance}<small style={{fontSize: 11}}>m</small></span>
          </div>
        </div>
        <div className={`heat ${ui.overheat ? 'over' : ''}`}>
          <div className="label"><span>LASER</span><em>{ui.overheat ? 'OVERHEAT' : heatPct + '%'}</em></div>
          <div className="bar"><i style={{width: heatPct + '%'}} /></div>
        </div>
        {ui.banner ? <div className="banner">{ui.banner}</div> : null}
      </div>
      {ui.phase === 'idle' && (
        <div className="guide">DRAG TO FLY<small>Steer your UFO · shoot on sight</small></div>
      )}
      <div key={ui.flashKey} className={`vignette ${ui.flashKey ? 'flash' : ''}`} />
      {ui.showResult && (
        <div className="result">
          <div className="panel">
            <h2>MISSION END</h2>
            <div className="sub">YOUR UFO WENT DOWN IN NEON SKIES</div>
            <div className="scores">
              <div className="score-box"><span className="k">KILLS</span><span className="v">{ui.kills}</span></div>
              <div className="score-box"><span className="k">DISTANCE</span><span className="v">{ui.distance}m</span></div>
              <div className="score-box"><span className="k">BEST</span><span className="v gold">{ui.best}</span></div>
            </div>
            <button
              className="replay"
              onClick={() => {
                play('ui');
                engineRef.current?.reset();
              }}
            >REPLAY</button>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
