import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

// Adapted from the provided Acupuncture Darts reference: continuous torso,
// prone anatomy, room materials, surface decal, swept-ray needle and Verlet pose.
// No external runtime, profile API, analytics, advertising or upload service.
const DEFAULTS = { FRIEND_NAME: 'Buddy', FRIEND_AVATAR: 'assets/friend-avatar.webp', HINT: 'Swipe up to hit the spot', AGAIN: 'Play again', TARGET_RADIUS: 0.085 };
const css = `
@font-face{font-family:Poppins;src:url('assets/fonts/Poppins-Regular.woff2') format('woff2');font-style:normal;font-weight:400;font-display:swap}
@font-face{font-family:Poppins;src:url('assets/fonts/Poppins-Bold.woff2') format('woff2');font-style:normal;font-weight:700;font-display:swap}
*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{background:#e9dcc6}
.game{position:relative;width:100%;height:100%;overflow:hidden;color:#493625;--font-ui:Poppins,sans-serif;font-family:var(--font-ui);user-select:none;-webkit-user-select:none}
.stage{position:absolute;inset:0}.stage canvas{display:block;width:100%;height:100%;touch-action:none}
.score{position:absolute;top:30px;left:50%;transform:translateX(-50%);font-size:28px;font-weight:700;line-height:42px;min-width:64px;text-align:center;color:#493625;background:#fff8eadd;border-radius:18px;padding:0 12px;pointer-events:none;font-variant-numeric:tabular-nums}
.friend{position:absolute;right:30px;top:84px;width:88px;z-index:3;transform-origin:center;filter:drop-shadow(0 3px 5px #4d362530)}
.friend button{font:inherit;display:block;width:100%;padding:3px;border:0;border-radius:14px;background:#fff8ed;cursor:pointer;touch-action:manipulation;color:#493625}
.friend img{display:block;width:82px;height:82px;object-fit:cover;border-radius:11px}
.friend-name{display:block;padding:4px 2px 2px;font-weight:700;font-size:12px;line-height:17px;overflow-wrap:anywhere;max-height:38px;overflow:hidden}
.change-mark{position:absolute;right:0;top:64px;width:24px;height:24px;border:2px solid #fff8ed;border-radius:50%;background:#388979;color:#fff;display:grid;place-items:center;font-size:16px;pointer-events:none}
.reaction{display:block;position:absolute;right:0;top:-18px;font-size:12px;font-weight:700;background:#fff8ed;padding:3px 8px;border-radius:10px;white-space:nowrap;pointer-events:none}
.friend[data-reaction=ouch]{animation:ouch .45s ease-in-out}.friend[data-reaction=bliss]{animation:relief .7s ease-in-out}.friend[data-reaction=miss]{animation:relief .45s ease-in-out}
@keyframes ouch{20%,60%{transform:translateX(-4px) rotate(-3deg)}40%,80%{transform:translateX(4px) rotate(3deg)}}
@keyframes relief{50%{transform:translateY(-5px) scale(1.035)}}
.hint{position:absolute;left:30px;right:30px;top:32%;text-align:center;pointer-events:none;font-size:18px;line-height:27px;color:#493625;animation:breathe 2.3s ease-in-out infinite}
.hint span{display:inline-block;background:#fff8eae8;padding:7px 13px;border-radius:24px;box-shadow:0 2px 8px #785a2220}
@keyframes breathe{50%{transform:translateY(-3px)}}
.result{position:absolute;bottom:50px;left:30px;right:30px;background:#fff8edf2;border:1px solid #dac9ae;border-radius:22px;padding:12px 16px;text-align:center;box-shadow:0 5px 18px #4d362522;z-index:4}
.result h2{margin:0 0 8px;font-size:24px;line-height:32px;font-weight:700}.result button{font:700 18px/27px var(--font-ui);border:0;border-radius:14px;min-height:48px;padding:8px 24px;background:#388979;color:white;box-shadow:0 3px 0 #23594f;cursor:pointer;touch-action:manipulation}.result button:active{transform:translateY(2px);box-shadow:none}
.photo-status{position:absolute;left:30px;right:30px;top:74px;font-size:12px;text-align:center;pointer-events:none;color:#493625}.error{position:absolute;inset:30px;display:grid;place-items:center;text-align:center;font-size:18px}
@media(max-height:480px){.friend{top:76px;width:72px}.friend img{width:66px;height:66px}.change-mark{top:49px}.hint{top:36%;font-size:16px}.result{bottom:30px;padding:8px}.result h2{font-size:20px;margin-bottom:4px}}
@media(prefers-reduced-motion:reduce){.hint,.friend{animation:none!important}}
.game[data-paused=true] .hint,.game[data-paused=true] .friend{animation-play-state:paused}
`;

export function FriendAvatar({ src, name, reaction, onChange }) {
  const input = useRef(null);
  const words = { bliss: 'So good!', ouch: 'Ouch!', miss: 'Miss!' };
  return <div className="friend" data-testid="friend-avatar" data-reaction={reaction || 'calm'}>
    <button type="button" aria-label="Choose local friend photo" onClick={() => input.current?.click()}>
      <img src={src} alt={`${name}'s avatar`} draggable="false" />
      <span className="friend-name">{name}</span><span className="change-mark" aria-hidden="true">+</span>
    </button>
    {reaction && <span className="reaction" role="status">{words[reaction]}</span>}
    <input ref={input} data-testid="avatar-input" hidden type="file" accept="image/*" onChange={onChange} />
  </div>;
}

function App() {
  const stage = useRef(null), api = useRef(null), localPhoto = useRef(null);
  const [config, setConfig] = useState(DEFAULTS), [loaded, setLoaded] = useState(false);
  const [view, setView] = useState({ state: 'ready', score: 0, outcome: null, paused: true });
  const [photo, setPhoto] = useState(null), [photoStatus, setPhotoStatus] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let gone = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    fetch('game.config.json', { signal: controller.signal }).then(r => r.ok ? r.json() : Promise.reject(new Error('Config unavailable'))).then(c => {
      if (gone) return;
      const next = { ...DEFAULTS };
      for (const t of c.texts || []) if (t.id in next && typeof t.value === 'string') next[t.id] = t.value;
      const image = (c.images || []).find(i => i.id === 'FRIEND_AVATAR');
      if (image?.path && !/^(https?:|\/\/)/i.test(image.path)) next.FRIEND_AVATAR = image.path;
      const radius = (c.tweaks || []).find(t => t.id === 'TARGET_RADIUS');
      if (Number.isFinite(radius?.value)) next.TARGET_RADIUS = THREE.MathUtils.clamp(radius.value, .065, .11);
      setConfig(next);
    }).catch(() => {}).finally(() => { clearTimeout(timeout); if (!gone) setLoaded(true); });
    return () => { gone = true; controller.abort(); clearTimeout(timeout); };
  }, []);
  useEffect(() => {
    if (!loaded) return undefined;
    try { api.current = createGame(stage.current, config, setView); }
    catch (e) { setError(`3D rendering unavailable. ${e.message}`); }
    return () => { api.current?.dispose(); api.current = null; };
  }, [loaded, config]);
  useEffect(() => () => { if (localPhoto.current) URL.revokeObjectURL(localPhoto.current); }, []);
  const changePhoto = e => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) { setPhotoStatus('Choose an image under 12 MB'); return; }
    const url = URL.createObjectURL(file), image = new Image();
    image.onload = () => { if (localPhoto.current) URL.revokeObjectURL(localPhoto.current); localPhoto.current = url; setPhoto(url); setPhotoStatus('Local photo only · not uploaded'); };
    image.onerror = () => { URL.revokeObjectURL(url); setPhotoStatus('That image could not be opened'); };
    image.src = url;
  };
  return <main className="game" data-testid="game" data-state={view.state} data-score={view.score} data-outcome={view.outcome || ''} data-paused={view.paused}>
    <style>{css}</style><div className="stage" ref={stage} data-testid="throw-surface" />
    <output className="score" aria-label="Score" data-testid="score">{view.score}</output>
    <FriendAvatar src={photo || config.FRIEND_AVATAR} name={config.FRIEND_NAME} reaction={view.outcome} onChange={changePhoto} />
    {photoStatus && <div className="photo-status" role="status">{photoStatus}</div>}
    {view.state === 'ready' && <div className="hint" data-testid="hint"><span>{config.HINT}</span></div>}
    {view.state === 'result' && <section className="result" data-testid="result" aria-label="Round result">
      <h2>{view.outcome === 'bliss' ? 'Sweet relief!' : view.outcome === 'ouch' ? 'Ouch! Try the orange spot' : 'Miss! Try a longer swipe'}</h2>
      <button type="button" data-testid="replay" onClick={() => api.current?.reset()}>{config.AGAIN}</button>
    </section>}
    {error && <div className="error" role="alert">{error}</div>}
  </main>;
}

function createGame(stage, cfg, onView) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  stage.appendChild(renderer.domElement); renderer.domElement.setAttribute('aria-label', 'Swipe upward to throw one needle');
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#e9dcc6'); scene.fog = new THREE.Fog('#e9dcc6', 7, 16);
  const camera = new THREE.PerspectiveCamera(40, 1, .05, 60);
  scene.add(new THREE.HemisphereLight('#dfefff', '#8a6a48', 1.1));
  const sun = new THREE.DirectionalLight('#fff0d8', 2.3); sun.position.set(-2.5, 5, 2.5); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 4; sun.shadow.bias = -.0006;
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: .5, far: 14 }); scene.add(sun);
  const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const mat = (c, roughness = .75, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness, ...extra });
  const shade = o => { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
  const SPH = new THREE.SphereGeometry(1, 32, 20), CYL = new THREE.CylinderGeometry(1, 1, 1, 24), BOX = new THREE.BoxGeometry(1, 1, 1);
  const part = (g, m, x, y, z, sx, sy = sx, sz = sx, parent = scene) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); parent.add(o); return o; };
  const rnd = (a, b) => a + Math.random() * (b - a), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const colliders = [], textures = [];
  const repeat = (t, x, y) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(x, y); textures.push(t); return t; };
  // Original room: textured wood floor, plaster, wainscoting, sunlit window, plant and trolley.
  const wood = repeat(tex(512, 512, (c, w, h) => {
    for (let i = 0; i < 8; i++) {
      c.fillStyle = `hsl(${rnd(28, 34)},${rnd(42, 52)}%,${rnd(46, 56)}%)`; c.fillRect(i * w / 8, 0, w / 8, h);
      for (let k = 0; k < 14; k++) { c.strokeStyle = `rgba(70,35,10,${rnd(.08, .23)})`; c.lineWidth = rnd(1, 2.5); const x = i * w / 8 + rnd(0, w / 8); c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + rnd(-4, 4), h * .3, x + rnd(-4, 4), h * .6, x, h); c.stroke(); }
      c.fillStyle = 'rgba(40,20,5,.45)'; c.fillRect(i * w / 8, 0, 2, h); c.fillRect(i * w / 8, (i * .37 % 1) * h, w / 8, 2);
    }
  }), 2.5, 2.5);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), mat('#ffffff', .6, { map: wood })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor); colliders.push(floor);
  const plaster = repeat(tex(256, 256, (c, w, h) => { c.fillStyle = '#f3ead9'; c.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { c.fillStyle = `rgba(120,90,60,${rnd(0, .06)})`; c.fillRect(rnd(0, w), rnd(0, h), 2, 2); } }), 3, 2);
  const wallM = mat('#ffffff', .95, { map: plaster }), panelM = mat('#a87a4e', .7);
  for (const [w, x, z, ry] of [[8, 0, -1.85, 0], [9, -2.4, 2, Math.PI / 2], [9, 2.4, 2, -Math.PI / 2]]) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
    const wall = part(new THREE.PlaneGeometry(1, 1), wallM, 0, 1.5, 0, w, 3, 1, g); wall.receiveShadow = true; colliders.push(wall);
    part(BOX, panelM, 0, .45, .02, w, .9, .04, g); part(BOX, mat('#7a5232', .6), 0, .92, .05, w, .05, .06, g);
  }
  const win = new THREE.Group(); win.position.set(2.38, 1.65, -.4); win.rotation.y = -Math.PI / 2; scene.add(win);
  const sky = tex(4, 128, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#7cc0f0'); g.addColorStop(1, '#e8f6ff'); c.fillStyle = g; c.fillRect(0, 0, w, h); }); textures.push(sky);
  part(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: sky, fog: false }), 0, 0, .01, 1.1, .9, 1, win);
  const frameM = mat('#f6f1e8', .5);
  for (const [x, y, w, h] of [[0, .47, 1.2, .06], [0, -.47, 1.2, .06], [-.57, 0, .06, 1], [.57, 0, .06, 1], [0, 0, .04, .9], [0, 0, 1.1, .04]]) part(BOX, frameM, x, y, .03, w, h, .05, win);
  // A quiet meridian diagram replaces the reference's unavailable cat poster.
  const poster = new THREE.Group(); poster.position.set(.15, 1.45, -1.83); poster.rotation.z = .03; scene.add(poster);
  part(BOX, mat('#5a3a22', .5), 0, 0, 0, .78, .98, .03, poster); part(new THREE.PlaneGeometry(1, 1), mat('#fbf6ea'), 0, 0, .017, .7, .9, 1, poster);
  for (const s of [-1, 1]) { part(BOX, mat('#bf9875'), s * .11, 0, .021, .003, .56, .002, poster); for (let i = 0; i < 5; i++) part(new THREE.CircleGeometry(.017, 16), new THREE.MeshBasicMaterial({ color: '#dd8d3b' }), s * .11, -.22 + .11 * i, .023, 1, 1, 1, poster); }
  const plant = new THREE.Group(); plant.position.set(-1.5, 0, -1.4); scene.add(plant);
  const pot = part(new THREE.CylinderGeometry(.22, .17, .42, 24), mat('#c9744a'), 0, .21, 0, 1, 1, 1, plant);
  part(new THREE.CylinderGeometry(.2, .2, .02, 24), mat('#4a3020'), 0, .42, 0, 1, 1, 1, plant);
  const leafM = mat('#3f8f4a', .55), stemM = mat('#5a7a3a');
  for (let i = 0; i < 9; i++) { const a = i * 2.4, h = rnd(.5, 1.1), r = rnd(.12, .3); const st = part(CYL, stemM, Math.cos(a) * r / 2, .42 + h / 2, Math.sin(a) * r / 2, .012, h, .012, plant); st.rotation.set(Math.sin(a) * .35, 0, -Math.cos(a) * .35); const lf = part(SPH, leafM, Math.cos(a) * r, .42 + h, Math.sin(a) * r, .16, .025, .09, plant); lf.rotation.set(rnd(-.4, .4), -a, rnd(-.5, .5)); }
  shade(plant); colliders.push(pot);
  const cart = new THREE.Group(); cart.position.set(1.3, 0, -1.2); scene.add(cart);
  const metal = mat('#d8dde2', .3, { metalness: .6 });
  for (const y of [.3, .75]) colliders.push(part(BOX, mat('#f4f6f8', .45), 0, y, 0, .6, .03, .42, cart));
  for (const x of [-.27, .27]) for (const z of [-.18, .18]) part(CYL, metal, x, .4, z, .015, .8, .015, cart);
  part(BOX, mat('#e04a5a', .6), -.1, .8, 0, .18, .07, .12, cart); part(new THREE.CylinderGeometry(.06, .06, .16, 16), mat('#fff', .3), .15, .85, .05, 1, 1, 1, cart); part(BOX, mat('#fff'), .12, .33, 0, .36, .05, .3, cart); shade(cart);
  const BED_Y = .62, HOLE_Z = -1.08, bed = new THREE.Group(); scene.add(bed);
  const leather = repeat(tex(128, 128, (c, w, h) => { c.fillStyle = '#3a8f86'; c.fillRect(0, 0, w, h); for (let i = 0; i < 1200; i++) { c.fillStyle = `rgba(0,30,30,${rnd(0, .07)})`; c.beginPath(); c.arc(rnd(0, w), rnd(0, h), rnd(1, 2.5), 0, 7); c.fill(); } }), 2, 4);
  const lm = mat('#ffffff', .45, { map: leather }), shape = new THREE.Shape();
  shape.moveTo(-.41, 1.3); shape.lineTo(.41, 1.3); shape.lineTo(.41, -1); shape.lineTo(-.41, -1); shape.lineTo(-.41, 1.3);
  const hole = new THREE.Path(); hole.absellipse(0, -HOLE_Z, .08, .1, 0, Math.PI * 2, true); shape.holes.push(hole);
  const mg = new THREE.ExtrudeGeometry(shape, { depth: .14, bevelEnabled: false, curveSegments: 32 }); mg.rotateX(-Math.PI / 2); mg.translate(0, BED_Y - .13, 0);
  const mattress = new THREE.Mesh(mg, lm); bed.add(mattress); colliders.push(mattress);
  for (const z of [-1.3, 1]) { const e = part(new THREE.CapsuleGeometry(.07, .68, 6, 16), lm, 0, BED_Y - .06, z, 1, 1, 1, bed); e.rotation.z = Math.PI / 2; colliders.push(e); }
  part(BOX, metal, 0, BED_Y - .17, -.02, .74, .06, 1.94, bed); part(BOX, metal, 0, BED_Y - .17, -1.22, .74, .06, .06, bed);
  for (const x of [-.32, .32]) for (const z of [-1.1, .8]) part(CYL, metal, x, (BED_Y - .17) / 2, z, .03, BED_Y - .17, .03, bed);
  const pillow = new THREE.Mesh(new THREE.TorusGeometry(.145, .05, 14, 32), mat('#f6f2ea', .85)); pillow.rotation.x = Math.PI / 2; pillow.scale.set(1.05, 1.15, 1); pillow.position.set(0, BED_Y + .03, HOLE_Z); bed.add(pillow); colliders.push(pillow); shade(bed);

  // Continuous cross sections copied/adapted from the reference, not a stack of ellipsoids.
  const curve = table => t => { let i = 0; while (i < table.length - 2 && t > table[i + 1][0]) i++; const [t0, a] = table[i], [t1, b] = table[i + 1], k = THREE.MathUtils.clamp((t - t0) / (t1 - t0), 0, 1); return a + (b - a) * (1 - Math.cos(k * Math.PI)) / 2; };
  function bodyGeo(z0, z1, W, Ht, Hb, bump) {
    const N = 64, M = 48, p = [], idx = [];
    for (let i = 0; i <= N; i++) { const t = i / N, z = z0 + (z1 - z0) * t, w = W(t), ht = Ht(t), hb = Hb(t); for (let j = 0; j <= M; j++) { const a = -Math.PI + 2 * Math.PI * j / M, c = Math.cos(a), x = w * Math.sin(a); let y = c > 0 ? ht * Math.pow(c, .8) : hb * c; if (c > 0) y += bump(x, t) * c; p.push(x, y, z); } }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = a + M + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  const gauss = (x, w) => Math.exp(-((x / w) ** 2)), up = V(0, 1, 0);
  function limb(a, b, r0, r1, m, parent) { const d = new THREE.Vector3().subVectors(b, a), L = d.length(); const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, L, 18), m); o.position.copy(a).addScaledVector(d, .5); o.quaternion.setFromUnitVectors(up, d.normalize()); parent.add(o); part(SPH, m, a.x, a.y, a.z, r0, r0, r0, parent); part(SPH, m, b.x, b.y, b.z, r1, r1, r1, parent); }
  const breathe = new THREE.Group(); scene.add(breathe);
  const SEGS = ['torso', 'pelvis', 'head', 'uaL', 'faL', 'uaR', 'faR', 'legL', 'legR'];
  let segs = {}, rest = {}, patMeshes = [], torso, ragdoll = null, target;
  const targetLocal = new THREE.Vector3(), targetWorld = new THREE.Vector3(), TARGET_R = cfg.TARGET_RADIUS;
  const targetTex = tex(256, 256, (c, w, h) => { const g = c.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(255,230,140,1)'); g.addColorStop(.45, 'rgba(255,170,60,.5)'); g.addColorStop(1, 'rgba(255,140,40,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); const R = 128 / 1.6; c.strokeStyle = '#ff7a2a'; c.lineWidth = 6; for (const r of [R * .965, R * .63]) { c.beginPath(); c.arc(128, 128, r, 0, 7); c.stroke(); } c.fillStyle = '#ff7a2a'; c.beginPath(); c.arc(128, 128, R * .2, 0, 7); c.fill(); }); textures.push(targetTex);
  const targetMat = new THREE.MeshBasicMaterial({ map: targetTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false });
  const shared = new Set([SPH, CYL, BOX]);
  function clearPatient() {
    const geometries = new Set(), materials = new Set(), maps = new Set();
    breathe.traverse(o => { if (o.isMesh && o !== needle) { if (!shared.has(o.geometry)) geometries.add(o.geometry); if (o.material !== targetMat) { materials.add(o.material); if (o.material.map) maps.add(o.material.map); } } });
    for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); for (const t of maps) t.dispose(); breathe.clear();
  }
  function makePatient() {
    clearPatient(); ragdoll = null; segs = {};
    for (const k of SEGS) { const g = new THREE.Group(); g.matrixAutoUpdate = false; g.userData.seg = k; breathe.add(g); segs[k] = g; }
    const skin = mat('#e5b088', .55), hair = mat('#3a2414', .8);
    const towelTex = tex(128, 128, (c, w, h) => { c.fillStyle = '#f4d8a8'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(0,0,0,.08)'; for (let y = 0; y < h; y += 16) c.fillRect(0, y, w, 6); for (let i = 0; i < 1500; i++) { c.fillStyle = `rgba(255,255,255,${rnd(0, .25)})`; c.fillRect(rnd(0, w), rnd(0, h), 1, 2); } }); towelTex.wrapS = towelTex.wrapT = THREE.RepeatWrapping; towelTex.repeat.set(2, 3);
    const towel = mat('#ffffff', 1, { map: towelTex }), Y = BED_Y + .005, build = 1.03;
    rest = { N: V(0, Y + .1, -.88), H: V(0, Y + .11, -1.1), P: V(0, Y + .1, 0), SL: V(-.23 * build, Y + .08, -.79), SR: V(.23 * build, Y + .08, -.79), HL: V(-.15 * build, Y + .09, .02), HR: V(.15 * build, Y + .09, .02), EL: V(-.37, Y + .05, -1.03), ER: V(.37, Y + .05, -1.03), WL: V(-.1, Y + .05, -1.24), WR: V(.1, Y + .05, -1.24), KL: V(-.1, Y + .06, .55), KR: V(.1, Y + .06, .55), AL: V(-.095, Y + .05, .93), AR: V(.095, Y + .05, .93) };
    torso = new THREE.Mesh(bodyGeo(-.9, .08, t => build * curve([[0, .07], [.1, .2], [.2, .245], [.36, .215], [.68, .165], [1, .19]])(t), curve([[0, .05], [.12, .095], [.3, .115], [.55, .095], [.75, .075], [1, .1]]), curve([[0, .05], [.15, .075], [1, .07]]), (x, t) => { const z = -.9 + .98 * t; let b = -.012 * gauss(x, .022) * curve([[0, 0], [.2, 1], [.9, 1], [1, .3]])(t); for (const s of [-1, 1]) b += .02 * gauss(x - s * .095, .055) * gauss(z + .66, .09); return b; }), skin);
    torso.position.y = Y + .07; segs.torso.add(torso);
    for (const s of [-1, 1]) part(SPH, skin, s * .215 * build, Y + .085, -.79, .075, .07, .085, segs.torso);
    limb(V(0, Y + .1, -.86), V(0, Y + .1, -.98), .06, .052, skin, segs.head);
    // Only the back of the prone head is visible. The reaction window is FriendAvatar.
    part(SPH, skin, 0, Y + .11, -1.08, .08, .1, .11, segs.head); part(SPH, hair, 0, Y + .14, -1.102, .086, .09, .108, segs.head);
    for (const s of [-1, 1]) { const L = s < 0 ? 'L' : 'R', ua = segs['ua' + L], fa = segs['fa' + L], sh = rest['S' + L], el = rest['E' + L], hd = rest['W' + L]; limb(sh, el, .058, .045, skin, ua); part(SPH, skin, s * .29, Y + .075, -.9, .06, .05, .075, ua).rotation.y = s * .6; limb(el, hd, .044, .034, skin, fa); part(SPH, skin, hd.x - s * .04, Y + .035, -1.27, .06, .022, .045, fa).rotation.y = s * .5; part(SPH, skin, hd.x - s * .02, Y + .035, -1.22, .025, .017, .012, fa).rotation.y = s * 1.1; }
    const tw = new THREE.Mesh(bodyGeo(-.06, .62, t => build * curve([[0, .205], [.25, .22], [.6, .2], [1, .17]])(t), curve([[0, .1], [.22, .13], [.45, .1], [1, .075]]), () => .075, (x, t) => -.02 * gauss(x, .03) * curve([[0, .2], [.3, 1], [1, .6]])(t)), towel); tw.position.y = Y + .075; tw.scale.set(1.04, 1.04, 1); segs.pelvis.add(tw);
    for (const s of [-1, 1]) { const L = s < 0 ? 'L' : 'R', g = segs['leg' + L]; limb(rest['K' + L], rest['A' + L], .058, .032, skin, g); part(SPH, skin, s * .1, Y + .075, .68, .058, .05, .1, g); part(SPH, skin, s * .1, Y + .035, .98, .038, .035, .065, g).rotation.x = 1; part(SPH, skin, s * .1, Y + .075, .955, .033, .03, .03, g); }
    shade(breathe); patMeshes = []; breathe.traverse(o => { if (o.isMesh) patMeshes.push(o); });
    breathe.updateMatrixWorld(true); const ray = new THREE.Raycaster();
    ray.set(V(rnd(-.09, .09), 2, rnd(-.63, -.25)), V(0, -1, 0)); const h = ray.intersectObject(torso, false)[0];
    if (h) { const n = h.face.normal.clone().transformDirection(h.object.matrixWorld), o = new THREE.Object3D(); o.position.copy(h.point); o.lookAt(h.point.clone().add(n)); target = new THREE.Mesh(new DecalGeometry(torso, h.point, o.rotation, V(TARGET_R * 3.2, TARGET_R * 3.2, .12)), targetMat); target.renderOrder = 2; segs.torso.add(target); targetLocal.copy(breathe.worldToLocal(h.point.clone())); }
  }
  // Original Verlet rig, with the same joint constraints and table/floor collision.
  const FRAMES = { torso: ['N', 'P', 'SL', 'SR'], pelvis: ['P', 'KM', 'HL', 'HR'], head: ['N', 'H', 'SL', 'SR'], uaL: ['SL', 'EL', 'SL', 'SR'], faL: ['EL', 'WL', 'SL', 'SR'], uaR: ['SR', 'ER', 'SL', 'SR'], faR: ['ER', 'WR', 'SL', 'SR'], legL: ['KL', 'AL', 'HL', 'HR'], legR: ['KR', 'AR', 'HL', 'HR'] };
  const BONES = [['N', 'H'], ['H', 'SL'], ['H', 'SR'], ['SL', 'EL'], ['EL', 'WL'], ['SR', 'ER'], ['ER', 'WR'], ['HL', 'KL'], ['HR', 'KR'], ['KL', 'AL'], ['KR', 'AR'], ['KL', 'KR']];
  const LOOSE = [['WL', 'SL'], ['WR', 'SR'], ['AL', 'HL'], ['AR', 'HR'], ['H', 'P']];
  const RAD = { N: .07, P: .08, SL: .07, SR: .07, HL: .08, HR: .08, H: .1, EL: .045, ER: .045, WL: .04, WR: .04, KL: .055, KR: .055, AL: .035, AR: .035 };
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  const basis = (o, a, s1, s2, m) => { const y = tmpA.subVectors(a, o).normalize(), x = tmpB.subVectors(s2, s1); x.addScaledVector(y, -x.dot(y)).normalize(); const z = tmpC.crossVectors(x, y); return m.makeBasis(x, y, z); };
  const kmid = pts => pts.KM.copy(pts.KL).add(pts.KR).multiplyScalar(.5);
  const STEP = 1 / 120, GRAV = 9.8;
  function startRagdoll(hitPt) {
    breathe.position.set(0, 0, 0); breathe.scale.set(1, 1, 1); breathe.updateMatrixWorld(true);
    const p = {}, q = {}, restB = {}, rp = {};
    for (const k in rest) { p[k] = rest[k].clone(); q[k] = rest[k].clone(); rp[k] = rest[k].clone(); }
    p.KM = new THREE.Vector3(); rp.KM = new THREE.Vector3(); kmid(p); kmid(rp);
    for (const k of SEGS) { const f = FRAMES[k]; restB[k] = basis(rp[f[0]], rp[f[1]], rp[f[2]], rp[f[3]], new THREE.Matrix4()).transpose(); }
    const cons = [], add = (a, b, mode) => cons.push([a, b, rest[a].distanceTo(rest[b]), mode]);
    const rigid = ['N', 'SL', 'SR', 'P', 'HL', 'HR']; for (let i = 0; i < rigid.length; i++) for (let j = i + 1; j < rigid.length; j++) add(rigid[i], rigid[j], 0);
    for (const [a, b] of BONES) add(a, b, 0); for (const [a, b] of LOOSE) add(a, b, 1);
    const side = Math.sign(hitPt.x || (Math.random() - .5)), spin = rnd(1.2, 1.8);
    for (const k in rest) { const d = rest[k].distanceTo(hitPt), v = V(side * rnd(.2, .45), 1.9 + 1.6 * Math.max(0, .7 - d), rnd(-.2, .2)); if (/^[EWKA]/.test(k)) v.add(V(rnd(-1.6, 1.6), rnd(0, 1.8), rnd(-.8, .8))); v.x += (rest[k].z - hitPt.z) * spin * .5 * side; q[k].addScaledVector(v, -STEP); }
    ragdoll = { p, q, cons, restB, rp, M: new THREE.Matrix4() };
  }
  const push = new THREE.Vector3();
  function bedPush(x, y, z, r) { const dx = .42 + r - Math.abs(x), dyT = BED_Y + r - y, dyB = y - (BED_Y - .22 - r), dz0 = z - (-1.4 - r), dz1 = 1.08 + r - z; if (Math.min(dx, dyT, dyB, dz0, dz1) <= 0) return null; const m = Math.min(dx, dyT, dyB, dz0, dz1); push.set(0, 0, 0); if (m === dyT) push.y = dyT; else if (m === dx) push.x = Math.sign(x || 1) * dx; else if (m === dyB) push.y = -dyB; else if (m === dz0) push.z = -dz0; else push.z = dz1; return push; }
  const segLines = [...BONES, ['N', 'P'], ['SL', 'HL'], ['SR', 'HR'], ['SL', 'SR'], ['HL', 'HR']];
  function stepRagdoll(dt) {
    const { p, q, cons } = ragdoll;
    for (const k in rest) { const a = p[k], b = q[k], vx = (a.x - b.x) * .999, vy = (a.y - b.y) * .999, vz = (a.z - b.z) * .999; b.copy(a); a.x += vx; a.y += vy - GRAV * dt * dt; a.z += vz; }
    const touch = new Set();
    for (let it = 0; it < 12; it++) {
      for (const [ka, kb, L, mode] of cons) { const a = p[ka], b = p[kb], d = tmpA.subVectors(b, a), len = d.length() || 1e-6; if (mode === 1 && len > L * .7) continue; const diff = (len - (mode === 1 ? L * .7 : L)) / len * .5; a.addScaledVector(d, diff); b.addScaledVector(d, -diff); }
      for (const [ka, kb] of segLines) { const a = p[ka], b = p[kb], r = Math.min(RAD[ka], RAD[kb]); for (const t of [.25, .5, .75]) { const o = bedPush(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, r); if (!o) continue; const wa = 1 - t, wb = t, k = 1 / (wa * wa + wb * wb); a.addScaledVector(o, wa * k); b.addScaledVector(o, wb * k); touch.add(ka); touch.add(kb); } }
      for (const k in rest) { const a = p[k], r = RAD[k], o = bedPush(a.x, a.y, a.z, r); if (o) { a.add(o); touch.add(k); } if (a.y < r) { a.y = r; touch.add(k); } a.x = THREE.MathUtils.clamp(a.x, -2.3, 2.3); a.z = Math.max(a.z, -1.75); }
    }
    for (const k of touch) { const a = p[k], b = q[k]; b.x += (a.x - b.x) * .15; b.z += (a.z - b.z) * .15; }
  }
  function poseRagdoll() { const { p, restB, rp, M } = ragdoll; kmid(p); for (const k of SEGS) { const f = FRAMES[k], g = segs[k]; basis(p[f[0]], p[f[1]], p[f[2]], p[f[3]], M).multiply(restB[k]); g.matrix.copy(M).setPosition(0, 0, 0); const o = rp[f[0]].clone().applyMatrix4(g.matrix); g.matrix.setPosition(p[f[0]].x - o.x, p[f[0]].y - o.y, p[f[0]].z - o.z); g.matrixWorldNeedsUpdate = true; } }

  const needle = new THREE.Group(), steel = mat('#f4f7fa', .2, { metalness: .42 });
  part(new THREE.CylinderGeometry(.0028, .001, .22, 10), steel, 0, 0, -.11, 1, 1, 1, needle).rotation.x = Math.PI / 2;
  shade(needle); needle.scale.setScalar(1.95); scene.add(needle);
  const START = V(0, 1.32, 1.75), pos = new THREE.Vector3(), prev = new THREE.Vector3(), vel = new THREE.Vector3(), aimOff = new THREE.Vector3();
  let state = 'ready', score = 0, outcome = null, clock = 0, flyT = 0, endT = 0, squash = 0, drag = null, disposed = false;
  const embedded = window.parent !== window, reviewMode = embedded && new URLSearchParams(window.location.search).get('feedReview') === '1';
  let active = !reviewMode, everActive = active, visible = !document.hidden, audio = null;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const notify = () => onView({ state, score, outcome, paused: !active || !visible });
  function unlockAudio() { if (!active || !visible) return; try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); if (audio.state !== 'running') audio.resume().catch(() => {}); } catch { audio = null; } }
  function tone(f0, f1, duration, volume = .08) { if (!active || !visible || !audio || audio.state !== 'running') return; const o = audio.createOscillator(), g = audio.createGain(), now = audio.currentTime; o.type = 'sine'; o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(f1, now + duration); g.gain.setValueAtTime(volume, now); g.gain.exponentialRampToValueAtTime(.001, now + duration); o.connect(g).connect(audio.destination); o.onended = () => { o.disconnect(); g.disconnect(); }; o.start(); o.stop(now + duration + .02); }
  const fx = [], dotG = new THREE.SphereGeometry(1, 8, 6);
  function burst(p, count, color) { for (let i = 0; i < count; i++) { const m = new THREE.Mesh(dotG, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false })); m.position.copy(p); m.scale.setScalar(.012); scene.add(m); const a = rnd(0, Math.PI * 2); fx.push({ m, v: V(Math.cos(a) * .3, rnd(.15, .4), Math.sin(a) * .3), t: 0 }); } }
  function clearFx() { for (const f of fx) { scene.remove(f.m); f.m.material.dispose(); } fx.length = 0; }
  const ray = new THREE.Raycaster(), dirV = new THREE.Vector3(), tmpV = new THREE.Vector3();
  function stick(hit) {
    const onBody = patMeshes.includes(hit.object); dirV.copy(vel).normalize(); pos.copy(hit.point).addScaledVector(dirV, onBody ? .035 : .02); needle.position.copy(pos); needle.lookAt(pos.clone().add(dirV)); state = 'stuck'; endT = 0;
    if (onBody) { breathe.updateMatrixWorld(true); targetWorld.copy(breathe.localToWorld(targetLocal.clone())); const d = hit.point.distanceTo(targetWorld); score = d < TARGET_R ? Math.max(1, Math.round(100 * (1 - d / TARGET_R) ** .8)) : 0;
      if (score > 0) { outcome = 'bliss'; breathe.attach(needle); squash = .001; burst(hit.point, 20, '#ffd36a'); tone(420, 720, .35); }
      else { outcome = 'ouch'; let seg = hit.object; while (seg && !seg.userData.seg) seg = seg.parent; startRagdoll(hit.point); (seg || breathe).attach(needle); burst(hit.point, 8, '#ff5a4a'); tone(260, 90, .22); }
    } else { score = 0; outcome = 'miss'; tone(140, 70, .15); burst(hit.point, 6, '#c8b090'); }
    notify();
  }
  function reset() { if (disposed) return; if (needle.parent !== scene) scene.attach(needle); clearFx(); breathe.position.set(0, 0, 0); breathe.scale.set(1, 1, 1); makePatient(); state = 'ready'; score = 0; outcome = null; squash = 0; flyT = 0; endT = 0; drag = null; aimOff.set(0, 0, 0); pos.copy(START); prev.copy(pos); notify(); render(0); }
  function throwNeedle(dx, length, seconds) {
    // Length gives a forgiving mobile range; speed remains a real distance influence.
    const power = THREE.MathUtils.clamp(2.7 + length * 4.8 + (length / seconds - 1.5) * .18, 2.75, 6.5);
    vel.set(THREE.MathUtils.clamp(dx / Math.max(length, .08) * power * .48, -3, 3), .35 * power, -power);
    pos.copy(START).add(aimOff); prev.copy(pos); state = 'fly'; flyT = 0; tone(540, 210, .16, .045); notify();
  }
  const cv = renderer.domElement;
  function down(e) { if (!active || !visible || state !== 'ready' || drag) return; e.preventDefault(); cv.setPointerCapture?.(e.pointerId); drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }; unlockAudio(); }
  function move(e) { if (!drag || e.pointerId !== drag.id) return; const H = stage.clientHeight; aimOff.set(THREE.MathUtils.clamp((e.clientX - drag.x) / H * .15, -.12, .12), THREE.MathUtils.clamp((drag.y - e.clientY) / H * .06, -.06, .06), 0); }
  function cancel() { drag = null; aimOff.set(0, 0, 0); }
  function upPointer(e) { if (!drag || e.pointerId !== drag.id) return; const d = drag; cancel(); if (!active || !visible || state !== 'ready') return; const H = stage.clientHeight, dx = (e.clientX - d.x) / H, length = (d.y - e.clientY) / H; if (length < .07 || Math.abs(dx) > length * 1.6) return; unlockAudio(); throwNeedle(dx, length, Math.max(.09, (performance.now() - d.t) / 1000)); }
  cv.addEventListener('pointerdown', down, { passive: false }); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', upPointer); cv.addEventListener('pointercancel', cancel); cv.addEventListener('lostpointercapture', cancel);
  function resize() { const W = Math.max(1, stage.clientWidth), H = Math.max(1, stage.clientHeight); renderer.setSize(W, H, false); camera.aspect = W / H; camera.clearViewOffset(); const center = V(0, .75, .05), direction = V(0, 1.05, 1).normalize(); const distance = Math.max(4.3, 4.65 * Math.max(1, (H / W) / (598 / 390))); camera.position.copy(center).addScaledVector(direction, distance); camera.lookAt(center); camera.updateProjectionMatrix(); camera.updateMatrixWorld(); render(0); }
  function step(dt, idle = false) {
    clock += dt;
    if (!ragdoll) { const br = reducedMotion ? 0 : Math.sin(clock * 1.7); breathe.scale.y = 1 - squash * .12; breathe.position.y = br * .008 + BED_Y * squash * .12; } else if (!idle) stepRagdoll(dt);
    if (squash > 0 && !idle) squash = Math.min(1, squash + dt * 1.5); targetMat.opacity = reducedMotion ? .9 : .8 + Math.sin(clock * 5) * .15;
    if (idle) return;
    for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.t += dt; f.v.y -= dt * 1.5; f.m.position.addScaledVector(f.v, dt); f.m.material.opacity = Math.max(0, 1 - f.t); if (f.t >= 1) { scene.remove(f.m); f.m.material.dispose(); fx.splice(i, 1); } }
    if (state === 'fly') { flyT += dt; prev.copy(pos); vel.y -= GRAV * dt; pos.addScaledVector(vel, dt); dirV.subVectors(pos, prev); const len = dirV.length(); if (len > 0) { ray.set(prev, dirV.normalize()); ray.far = len + .001; scene.updateMatrixWorld(true); const hit = ray.intersectObjects(patMeshes.concat(colliders), false)[0]; if (hit) { stick(hit); return; } } if (pos.y < -.5 || flyT > 4 || Math.abs(pos.x) > 6 || pos.z < -6) { state = 'stuck'; score = 0; outcome = 'miss'; endT = 0; notify(); } }
    else if (state === 'stuck') { endT += dt; if (endT > (outcome === 'ouch' ? 2.6 : outcome === 'bliss' ? 1.6 : 1.1)) { state = 'result'; notify(); } }
  }
  function render(alpha) { if (state === 'ready') { needle.position.copy(START).add(aimOff); if (!reducedMotion) needle.position.y += Math.sin(clock * 2.2) * .012; needle.lookAt(tmpV.copy(needle.position).add(V(aimOff.x * .6, -.32, -1))); } else if (state === 'fly') { needle.position.lerpVectors(prev, pos, alpha); needle.lookAt(tmpV.copy(needle.position).add(vel)); } if (ragdoll) poseRagdoll(); renderer.render(scene, camera); }
  let frame = 0, last = performance.now(), acc = 0;
  function shouldRun() { return visible && (active || (!everActive && !reducedMotion)); }
  function loop(now) { frame = 0; if (disposed || !shouldRun()) return; const dt = Math.min(.05, (now - last) / 1000); last = now; acc += dt; while (acc >= STEP) { step(STEP, !active); acc -= STEP; } render(acc / STEP); frame = requestAnimationFrame(loop); }
  function resumeLoop() { cancelAnimationFrame(frame); frame = 0; last = performance.now(); acc = 0; if (shouldRun()) frame = requestAnimationFrame(loop); }
  function lifecycle(next) { active = next; if (active) everActive = true; if (!active) { cancel(); audio?.suspend().catch(() => {}); } notify(); resumeLoop(); }
  function message(e) { if (e.source !== window.parent || e.origin !== window.location.origin || e.data?.type !== 'playable-active' || typeof e.data.active !== 'boolean') return; lifecycle(e.data.active); }
  function visibility() { visible = !document.hidden; if (!visible) { cancel(); audio?.suspend().catch(() => {}); } notify(); resumeLoop(); }
  window.addEventListener('message', message); document.addEventListener('visibilitychange', visibility); window.addEventListener('resize', resize);
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null; observer?.observe(stage);
  reset(); resize(); renderer.compile(scene, camera); resumeLoop();
  // Read-only telemetry supports QA without exposing a fake hit/score shortcut.
  window.__acupuncture = { get state() { return state; }, get score() { return score; }, get outcome() { return outcome; }, get active() { return active; }, get targetScreen() { const q = breathe.localToWorld(targetLocal.clone()).project(camera); return { x: (q.x + 1) * stage.clientWidth / 2, y: (1 - q.y) * stage.clientHeight / 2 }; }, get startScreen() { const q = START.clone().project(camera); return { x: (q.x + 1) * stage.clientWidth / 2, y: (1 - q.y) * stage.clientHeight / 2 }; } };
  return { reset, dispose() { disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', resize); window.removeEventListener('message', message); document.removeEventListener('visibilitychange', visibility); cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', upPointer); cv.removeEventListener('pointercancel', cancel); cv.removeEventListener('lostpointercapture', cancel); audio?.close().catch(() => {}); clearFx(); const gs = new Set(), ms = new Set(), ts = new Set(textures); scene.traverse(o => { if (o.isMesh) { gs.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { ms.add(m); if (m.map) ts.add(m.map); } } }); gs.add(dotG); for (const g of gs) g.dispose(); for (const m of ms) m.dispose(); for (const t of ts) t.dispose(); renderer.dispose(); cv.remove(); delete window.__acupuncture; } };
}

createRoot(document.getElementById('root')).render(<App />);
