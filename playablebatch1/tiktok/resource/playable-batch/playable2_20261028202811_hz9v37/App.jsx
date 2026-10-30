import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';


// This bridge belongs to the game; it does not reproduce host UI or gradients.
const feedSession = (() => {
  const embedded = window.parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !embedded;
  const listeners = new Set();
  const update = () => {
    document.documentElement.dataset.feedPreview = String(!active);
    for (const callback of listeners) callback(active && !document.hidden);
  };
  window.addEventListener('message', event => {
    if (!embedded || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
    update();
  });
  document.addEventListener('visibilitychange', update);
  update();
  return {get active() { return active && !document.hidden; }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }};
})();
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

function useFeedActive() {
  const [active, setActive] = React.useState(feedSession.active);
  React.useEffect(() => feedSession.subscribe(setActive), []);
  return active;
}

function BatchPolish() {
  const active = useFeedActive();
  return <>
    <style>{POLISH_CSS+CAMERA_CONTROLS_CSS}</style>
    {!active && [80,81,84].includes(GAME_NUMBER) && <div className={'preview-example example-' + GAME_NUMBER} aria-hidden="true">
      {GAME_NUMBER === 80 && <svg viewBox="0 0 320 220"><defs><radialGradient id="soft-example" cx=".35" cy=".2" r=".9"><stop stopColor="#ffe4bd"/><stop offset="1" stopColor="#f3ad97"/></radialGradient></defs><path className="example-blob" d="M78 61C112 16 184 23 192 66C206 88 248 75 249 113C251 162 200 176 165 166C117 195 69 166 80 124C40 101 47 78 78 61Z" fill="url(#soft-example)" stroke="#d99485" strokeWidth="2"/><g className="example-eyes"><ellipse cx="136" cy="91" rx="11" ry="14" fill="white"/><ellipse cx="168" cy="91" rx="11" ry="14" fill="white"/><circle cx="139" cy="94" r="5" fill="#443c39"/><circle cx="171" cy="94" r="5" fill="#443c39"/></g></svg>}
      {GAME_NUMBER === 81 && <svg viewBox="0 0 320 220"><path className="example-noodle" d="M65 145C44 109 84 61 115 88S139 171 187 151S250 80 263 126" fill="none" stroke="#e4d3ed" strokeWidth="29" strokeLinecap="round"/><path className="example-noodle" d="M65 145C44 109 84 61 115 88S139 171 187 151S250 80 263 126" fill="none" stroke="#3e3b42" strokeWidth="13" strokeLinecap="round"/><circle cx="129" cy="103" r="6" fill="white"/><circle cx="144" cy="111" r="6" fill="white"/><circle cx="130" cy="104" r="2.4"/><circle cx="145" cy="112" r="2.4"/><path d="M115 151q-5 17-15 11M186 160q5 18 15 9" fill="none" stroke="#3e3b42" strokeWidth="3" strokeLinecap="round"/></svg>}
      {GAME_NUMBER === 84 && <div className="example-poem">a little line becomes a thought<br/>the words wander across the paper<br/><em>softly</em> a small world opens<br/>every mark is a moment<br/>and every moment can begin again</div>}
    </div>}
  </>;
}

const BASE_CSS = `
button { touch-action: manipulation; }
button:focus-visible { outline: 3px solid #3c8ddd; outline-offset: 3px; }
@keyframes batchBreathe { 0%,100% { opacity:.72; } 50% { opacity:1; } }
.preview-example { position:fixed; z-index:2; pointer-events:none; width:min(80%,340px); left:50%; top:35%; transform:translateX(-50%); }
.preview-example svg { width:100%; height:auto; overflow:visible; }
.example-blob { transform-origin:50% 60%; animation:exampleSquish 3.8s ease-in-out infinite; }
.example-noodle { transform-origin:50% 70%; animation:exampleWiggle 3.6s ease-in-out infinite; }
.example-poem { padding:20px; color:#44444c; font:15px/1.8 ui-monospace,monospace; clip-path:ellipse(49% 47% at 50% 50%); animation:exampleInk 5s ease-in-out infinite; }
.example-poem em { color:#ad7397; font-style:normal; }
@keyframes exampleSquish { 0%,100% {transform:scale(1,1) rotate(-3deg)} 40% {transform:scale(1.06,.94) rotate(2deg)} 70% {transform:scale(.96,1.04) rotate(-1deg)} }
@keyframes exampleWiggle { 0%,100% { transform:rotate(-3deg) translateY(0); } 50% { transform:rotate(3deg) translateY(-5px); } }
@keyframes exampleInk { 0%,100% {opacity:.25;clip-path:ellipse(23% 35% at 32% 50%)} 45%,70% {opacity:.9;clip-path:ellipse(49% 47% at 50% 50%)} }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; } }
`;

const GAME_NUMBER=79;
const POLISH_CSS=BASE_CSS+".brand,.bottom-hint{display:none}.topline{top:30px;left:30px;right:30px;justify-content:center}.stats{font:700 28px/1 system-ui,sans-serif;color:#292d2b}.stats-dot{display:none}.guide{top:24%;left:30px;right:30px;transform:translateY(-50%);font:700 18px/1.3 system-ui,sans-serif;color:#2f3631;letter-spacing:0;animation:batchBreathe 2.5s ease-in-out infinite}.viewfinder{width:82%;height:42%;box-shadow:none;background:transparent;border-color:rgba(40,45,42,.25)}.zoom-readout{top:8px;right:8px;border-radius:24px;padding:0 3px;background:#fbfaf3ee;gap:1px}.zoom-readout button{min-width:44px;min-height:44px;font-size:22px}.zoom-readout span{min-width:36px;text-align:center}.shutter{background:#303a35;border-color:#fffdf3}.reset-control{left:30px;bottom:50px;min-height:44px;border-radius:24px;padding:0 15px;font-size:14px;background:#fdfcf5e6;border:1px solid #c9cec2;color:#354239}.tension-wrap{top:72px;right:30px;width:86px}.tension-caption{font-size:10px}.newspaper,.recap-sheet{background:#fffef6;color:#2c352e;border-color:#788374;box-shadow:4px 7px 0 #2e39241c;max-height:88%;width:100%;padding:20px}.newspaper h1{font:700 clamp(23px,6vw,29px)/1.08 Georgia,serif}.paper-close,.primary-action{background:#354a40;border-color:#354a40;min-height:46px;border-radius:3px}.secondary-action{min-height:46px}.recap-count{color:#354a40}.paper-photo{border:3px solid #e8eade}.paper-backdrop,.recap-backdrop{padding:30px}.recap-label,.recap-grid span{font-size:12px;letter-spacing:0;text-transform:none}[data-feed-preview=true] .stats,[data-feed-preview=true] .tension-wrap,[data-feed-preview=true] .reset-control,[data-feed-preview=true] .zoom-readout,[data-feed-preview=true] .shutter{visibility:hidden}"+".observer-app{container-type:size}.newspaper{max-height:100%;padding:18px}.newspaper h1{font-size:26px;line-height:1.06}.newspaper .paper-photo{height:26cqh;min-height:100px;max-height:170px;aspect-ratio:auto}.newspaper .paper-photo img{object-fit:contain}.newspaper .paper-caption{font-size:14px;line-height:1.4;margin:10px 0}.newspaper .paper-meta{font-size:9px;margin:8px 0 12px}.newspaper .paper-rule{margin:6px 0 10px}.town-canvas{touch-action:none;cursor:grab}.town-canvas:active{cursor:grabbing}.paper-caption{font:400 15px/1.45 system-ui,sans-serif;margin:14px 0;color:#3c443c}.paper-meta{gap:14px;align-items:start;line-height:1.4;letter-spacing:.02em}.paper-meta>span:first-child{max-width:85%}.paper-photo{aspect-ratio:1.28}.newspaper{transform:rotate(-.5deg)}.paper-kicker{font:700 12px/1.3 system-ui,sans-serif;letter-spacing:.17em}.paper-close{width:100%;font:600 15px/1.25 system-ui,sans-serif}.guide{background:#faf8eeeb;border-radius:24px;padding:10px 14px;left:50%;right:auto;white-space:nowrap;transform:translate(-50%,-50%)}@media(max-width:350px){.guide{font-size:16px;padding:10px 12px}.newspaper{padding:15px}.paper-caption{font-size:14px}}";
const CAMERA_CONTROLS_CSS=`
.observer-app{--finder-center:54cqh;--finder-height:max(120px,min(42cqh,calc(92cqh - 256px)));--finder-controls-gap:16px}
.observer-app .viewfinder{top:var(--finder-center);height:var(--finder-height)}
.camera-controls{position:absolute;z-index:5;left:30px;right:30px;top:calc(var(--finder-center) + var(--finder-height) / 2 + var(--finder-controls-gap));height:62px;display:grid;grid-template-columns:minmax(0,1fr) 62px minmax(0,1fr);grid-template-areas:'reset shutter zoom';gap:10px;align-items:center;pointer-events:none}
.camera-controls .shutter{grid-area:shutter;position:static;transform:none;justify-self:center;pointer-events:auto}
.camera-controls .shutter:active{transform:scale(.95)}
.camera-controls .zoom-readout{grid-area:zoom;position:static;justify-self:end;gap:0;padding:0 2px;height:46px;pointer-events:auto}
.camera-controls .zoom-readout button{width:44px;min-width:44px;min-height:44px;padding:0;flex:0 0 44px}
.camera-controls .zoom-readout span{min-width:30px;width:30px}
.camera-controls .reset-control{grid-area:reset;position:static;justify-self:start;max-width:100%;min-width:0;min-height:44px;pointer-events:auto}
.camera-controls .reset-icon{flex:0 0 14px}
.camera-controls .reset-label{min-width:0;overflow-wrap:anywhere}
[data-feed-preview=true] .camera-controls{visibility:hidden;pointer-events:none}
@media(max-width:389px){
.observer-app{--finder-center:48cqh;--finder-height:max(120px,min(34cqh,calc(104cqh - 356px)));--finder-controls-gap:12px}
.camera-controls{height:auto;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:62px 46px;grid-template-areas:'shutter shutter' 'reset zoom';gap:10px}
}
`;


const DEFAULTS = {
  START_TENSION: 34,
  MAX_TENSION: 100,
  MIN_ZOOM: 1.1,
  MAX_ZOOM: 1.55,
  PHOTO_IMPACT: 3,
  SIM_STEP_MS: 80,
  GAME_TITLE: 'Town Square Observer',
  GUIDE: 'Drag to explore the town',
  RESET_LABEL: 'Reset',
  CONTINUE_LABEL: 'Keep observing',
  RESET_WORLD_LABEL: 'Reset the world',
};

const SOUND_PATHS = {
  // crisp camera feedback for a successful shutter press.
  shutter: './assets/sfx_shutter.mp3',
  // restrained feedback for a new newspaper / interface confirmation.
  event: './assets/sfx_event.mp3',
  // environmental feedback when the photographed social state is friendly.
  friendly: './assets/sfx_friendly.mp3',
  // environmental feedback when the photographed social state is tense.
  conflict: './assets/sfx_conflict.mp3',
};

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function buildConfig(json) {
  const next = { ...DEFAULTS };
  if (json && Array.isArray(json.tweaks)) json.tweaks.forEach((item) => { next[item.id] = item.value; });
  if (json && Array.isArray(json.texts)) json.texts.forEach((item) => { next[item.id] = item.value; });
  return next;
}

const WORLD = { width: 3200, height: 1900, startX: 1600, startY: 1080 };
const TOWN_GRASS='#f5f4ef';
const TOWN_SPOTS = [
  { x: 1600, y: 1080, place: 'Town Square', kinds: ['fight', 'friendly', 'dance'], offset: 0, count: 2 },
  { x: 930, y: 1050, place: 'Corner Café', kinds: ['kindness', 'music', 'friendly'], offset: 5, count: 2 },
  { x: 2320, y: 1080, place: 'Fountain Walk', kinds: ['splash', 'trip', 'friendly'], offset: 2, count: 2 },
  { x: 2820, y: 1020, place: 'Market Lane', kinds: ['juggle', 'dance', 'kindness'], offset: 9, count: 2 },
  { x: 1610, y: 500, place: 'Green Park', kinds: ['soccer', 'trip', 'friendly'], offset: 7, count: 2 },
  { x: 390, y: 1030, place: 'West Garden', kinds: ['music', 'dance', 'friendly'], offset: 1, count: 2 },
];
const STORIES = {
  fight: { category: 'conflict', priority: 100, section: 'BREAKING / LOCAL', headline: 'Fight breaks out in the square', caption: 'Two neighbors trade shoves as a heated argument turns into a scuffle.' },
  friendly: { category: 'friendly', priority: 40, section: 'PEOPLE / COMMUNITY', headline: 'A small act of friendship', caption: 'Two neighbors stop for a cheerful greeting and a high five.' },
  kindness: { category: 'friendly', priority: 65, section: 'PEOPLE / COMMUNITY', headline: 'A helping hand makes the day', caption: 'A passerby helps gather a neighbor’s scattered shopping.' },
  music: { category: 'friendly', priority: 55, section: 'ARTS / STREET LIFE', headline: 'Street musician draws a crowd', caption: 'An impromptu guitar performance turns the pavement into a tiny stage.' },
  dance: { category: 'friendly', priority: 50, section: 'ARTS / STREET LIFE', headline: 'Neighbors dance in the street', caption: 'A spontaneous dance gives the afternoon a lighter rhythm.' },
  splash: { category: 'calm', priority: 75, section: 'LOCAL / LITTLE DRAMAS', headline: 'A splash catches a passerby', caption: 'A mischievous splash by the fountain leaves one neighbor dripping.' },
  trip: { category: 'calm', priority: 80, section: 'LOCAL / LITTLE DRAMAS', headline: 'A stumble stops the afternoon', caption: 'A walker loses their footing while a nearby neighbor rushes to help.' },
  juggle: { category: 'friendly', priority: 60, section: 'ARTS / STREET LIFE', headline: 'Market performer steals the show', caption: 'Flying fruit and quick hands bring a little spectacle to the market.' },
  soccer: { category: 'friendly', priority: 58, section: 'SPORT / AROUND TOWN', headline: 'A friendly kickabout in the park', caption: 'Two locals trade passes in a lively game on the grass.' },
};

function sceneScale(width, height, zoom) {
  return Math.min(width / 780, height / 1100) * zoom;
}

function cameraFor(frame, width, height, zoom) {
  const scale = sceneScale(width, height, zoom);
  const halfW = Math.min(WORLD.width / 2, width / scale / 2);
  const halfH = Math.min(WORLD.height / 2, height / scale / 2);
  return { scale, x: clamp(frame.x, halfW, WORLD.width - halfW), y: clamp(frame.y, halfH, WORLD.height - halfH) };
}

function createResidents() {
  const residents = [];
  const shirts = ['#cb6752','#48889b','#d1a746','#699263','#a77fa0','#bc8353'];
  TOWN_SPOTS.forEach((spot, index) => {
    for (let role = 0; role < spot.count; role++) residents.push({ id: residents.length, x: spot.x + (role ? 48 : -48), y: spot.y, homeX: spot.x, homeY: spot.y, role, spot: index, shirt: shirts[(index + role) % shirts.length], size: .96 + (index % 3) * .04 });
  });
  for (let i = 0; i < 16; i++) residents.push({ id: residents.length, x: 150 + (i * 197) % 2850, y: 700 + (i * 143) % 800, homeX: 150 + (i * 197) % 2850, homeY: 700 + (i * 143) % 800, role: 0, spot: -1, shirt: shirts[i % shirts.length], size: .88 + (i % 4) * .05 });
  return residents;
}

function initialSim(tension) {
  const sim = { residents: createResidents(), tension, elapsed: 0, lastStep: 0, cycle: 0, events: [] };
  updateTown(sim, 0);
  return sim;
}

function updateTown(sim, dt) {
  sim.elapsed += dt;
  sim.cycle = sim.elapsed / 1000;
  sim.events = TOWN_SPOTS.map((spot, index) => {
    const local = sim.cycle + spot.offset;
    const phase = local % 16;
    const kind = phase < 12.5 ? spot.kinds[Math.floor(local / 16) % spot.kinds.length] : 'calm';
    return { ...spot, id: index, kind, phase, people: sim.residents.filter(p => p.spot === index).map(p => p.id) };
  });
  sim.residents.forEach(p => {
    if (p.spot < 0) {
      p.x = clamp(p.homeX + Math.sin(sim.cycle * .11 + p.id) * 105, 110, WORLD.width - 110);
      p.y = clamp(p.homeY + Math.cos(sim.cycle * .14 + p.id * .7) * 65, 680, 1570);
      p.kind = 'walk'; p.phase = sim.cycle;
      return;
    }
    const ev = sim.events[p.spot], side = p.role ? 1 : -1;
    p.kind = ev.kind; p.phase = ev.phase;
    const pace = ev.kind === 'fight' ? Math.sin(ev.phase * 7) * 12 : Math.sin(ev.phase * 2.4) * 3;
    const gap = ['friendly', 'kindness'].includes(ev.kind) ? 40 : 54;
    p.x = ev.x + side * (gap + pace);
    p.y = ev.y + (ev.kind === 'dance' ? Math.sin(ev.phase * 5 + p.role) * 7 : 0);
  });
}

function storyForCrop(sim, bounds) {
  const inside = p => p.x - 22 * p.size >= bounds.left && p.x + 22 * p.size <= bounds.right && p.y - 62 * p.size >= bounds.top && p.y + 62 * p.size <= bounds.bottom;
  const cx = (bounds.left + bounds.right) / 2, cy = (bounds.top + bounds.bottom) / 2;
  const candidates = sim.events.filter(ev => STORIES[ev.kind] && ev.people.every(id => inside(sim.residents.find(p => p.id === id))));
  candidates.sort((a, b) => {
    const score = ev => STORIES[ev.kind].priority - Math.hypot(ev.x - cx, ev.y - cy) * .06;
    return score(b) - score(a);
  });
  if (candidates.length) {
    const ev = candidates[0];
    return { ...STORIES[ev.kind], kind: ev.kind, place: ev.place };
  }
  const people = sim.residents.filter(inside).length;
  return { kind: 'calm', category: 'calm', section: 'LOCAL / DAILY LIFE', place: 'Around town', headline: people ? 'An ordinary moment, worth a look' : 'A quiet corner of the town', caption: people ? 'Life carries on between the bigger stories. This frame catches a quieter moment.' : 'For a moment, the streets belong to the open square and the afternoon light.' };
}


function playVibrate(style) {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style });
  } catch (e) { /* optional host haptics */ }
}

function App() {
  const [cfg, setCfg] = useState(DEFAULTS);
  const cfgRef = useRef(DEFAULTS);
  const [guideVisible, setGuideVisible] = useState(true);
  const [active, setActive] = useState(false);
  const [frame, setFrame] = useState({ x: WORLD.startX, y: WORLD.startY });
  const [zoom, setZoom] = useState(DEFAULTS.MIN_ZOOM);
  const [photoCount, setPhotoCount] = useState(0);
  const [friendlyCount, setFriendlyCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [calmCount, setCalmCount] = useState(0);
  const [tension, setTension] = useState(DEFAULTS.START_TENSION);
  const [paper, setPaper] = useState(null);
  const [recap, setRecap] = useState(false);
  const [news, setNews] = useState([]);

  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const rafRef = useRef(0);
  const simRef = useRef(initialSim(DEFAULTS.START_TENSION));
  const frameStateRef = useRef(frame);
  const zoomRef = useRef(zoom);
  const activeRef = useRef(active);
  const modalRef = useRef(false);
  const pointersRef = useRef(new Map());
  const dragRef = useRef(null);
  const audioRef = useRef({ ctx: null, gain: null, buffers: {}, loading: {}, sources: new Set() });
  const timersRef = useRef(new Set());

  useEffect(() => {
    let alive = true;
    fetch('./game.config.json')
      .then((response) => response.json())
      .then((json) => {
        if (!alive) return;
        const next = buildConfig(json);
        cfgRef.current = next;
        setCfg(next);
        simRef.current.tension = next.START_TENSION;
        setTension(next.START_TENSION);
        setZoom(next.MIN_ZOOM);
        zoomRef.current = next.MIN_ZOOM;
      })
      .catch(() => { /* defaults keep the game playable */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => { frameStateRef.current = frame; }, [frame]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { modalRef.current = !!paper || recap; }, [paper, recap]);

  const ensureAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio.ctx) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;
        audio.ctx = new AudioContextClass();
        audio.gain = audio.ctx.createGain();
        audio.gain.gain.value = 0.72;
        audio.gain.connect(audio.ctx.destination);
      } catch (e) { return null; }
    }
    try { if (audio.ctx.state === 'suspended') audio.ctx.resume(); } catch (e) { /* optional */ }
    Object.entries(SOUND_PATHS).forEach(([key, path]) => {
      if (!audio.loading[key] && !audio.buffers[key]) {
        audio.loading[key] = fetch(path)
          .then((r) => r.arrayBuffer())
          .then((data) => audio.ctx.decodeAudioData(data))
          .then((buffer) => { audio.buffers[key] = buffer; return buffer; })
          .catch(() => null);
      }
    });
    return audio;
  }, []);

  const playSound = useCallback((key) => {
    const audio = ensureAudio();
    if (!audio || !audio.ctx) return;
    const play = (buffer) => {
      if (!buffer || !audio.ctx || !audio.gain) return;
      try {
        const source = audio.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(audio.gain);
        audio.sources.add(source);
        source.onended = () => audio.sources.delete(source);
        source.start(0);
      } catch (e) { /* sound is non-blocking */ }
    };
    if (audio.buffers[key]) play(audio.buffers[key]);
    else if (audio.loading[key]) audio.loading[key].then(play);
  }, [ensureAudio]);

  const markActive = useCallback(() => {
    ensureAudio();
    if (!activeRef.current) {
      activeRef.current = true;
      setActive(true);
      setGuideVisible(false);
      simRef.current.lastStep = performance.now();
      console.info('[observer] observation started');
    }
  }, [ensureAudio]);

  const setFrameSafe = useCallback((next) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const camera = cameraFor(next, rect.width, rect.height, zoomRef.current);
    const safe = { x: camera.x, y: camera.y };
    frameStateRef.current = safe;
    setFrame(safe);
  }, []);

  const handleFramePointerDown = useCallback((event) => {
    if (modalRef.current || !feedSession.active || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    markActive();
    const current = frameStateRef.current;
    if (pointersRef.current.size === 1) {
      dragRef.current = { startX: event.clientX, startY: event.clientY, frameX: current.x, frameY: current.y };
    }
  }, [markActive]);

  const handleFramePointerMove = useCallback((event) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const pts = [...pointersRef.current.values()];
    if (pts.length >= 2) {
      const distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (dragRef.current && dragRef.current.pinchDistance) {
        const ratio = distance / dragRef.current.pinchDistance;
        const nextZoom = clamp(dragRef.current.pinchZoom * ratio, cfgRef.current.MIN_ZOOM, cfgRef.current.MAX_ZOOM);
        zoomRef.current = nextZoom;
        setZoom(nextZoom);
      } else if (dragRef.current) {
        dragRef.current.pinchDistance = distance;
        dragRef.current.pinchZoom = zoomRef.current;
      }
      return;
    }
    if (!dragRef.current) return;
    const scale = sceneScale(rect.width, rect.height, zoomRef.current);
    const dx = (event.clientX - dragRef.current.startX) / scale;
    const dy = (event.clientY - dragRef.current.startY) / scale;
    setFrameSafe({ x: dragRef.current.frameX - dx, y: dragRef.current.frameY - dy });
  }, [setFrameSafe]);

  const handleFramePointerUp = useCallback((event) => {
    pointersRef.current.delete(event.pointerId);
    const remaining = [...pointersRef.current.values()][0];
    dragRef.current = remaining ? { startX: remaining.x, startY: remaining.y, frameX: frameStateRef.current.x, frameY: frameStateRef.current.y } : null;
  }, []);

  const handleWheel = useCallback((event) => {
    if (modalRef.current || !feedSession.active) return;
    markActive();
    const next = clamp(zoomRef.current + (event.deltaY < 0 ? 0.08 : -0.08), cfgRef.current.MIN_ZOOM, cfgRef.current.MAX_ZOOM);
    zoomRef.current = next;
    setZoom(next);
  }, [markActive]);

  const adjustZoom = useCallback((amount) => {
    markActive();
    const next = clamp(zoomRef.current + amount, cfgRef.current.MIN_ZOOM, cfgRef.current.MAX_ZOOM);
    zoomRef.current = next;
    setZoom(next);
    playSound('event');
  }, [markActive, playSound]);

  const drawScene = useCallback((now) => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    const rect = root.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const sim = simRef.current;
    const stepMs = cfgRef.current.SIM_STEP_MS;
    const running = activeRef.current && feedSession.active && !modalRef.current;
    if (running && now - sim.lastStep >= stepMs) {
      const dt = Math.min(now - sim.lastStep, 100);
      sim.lastStep = now;
      updateTown(sim, dt);
    } else if (!running) sim.lastStep = now;

    const camera = cameraFor(frameStateRef.current, width, height, zoomRef.current);
    ctx.save();
    ctx.fillStyle = TOWN_GRASS;ctx.fillRect(0, 0, width, height);
    ctx.translate(width / 2, height / 2);ctx.scale(camera.scale, camera.scale);ctx.translate(-camera.x, -camera.y);
    const motionTime = !activeRef.current && !reducedMotionQuery.matches ? now / 1000 : sim.cycle;
    drawTown(ctx, width / camera.scale, height / camera.scale, sim, motionTime);
    ctx.restore();
    const finder=frameRef.current?.getBoundingClientRect();
    const story = storyForCrop(sim, finder?{left:camera.x+(finder.left-rect.left-width/2)/camera.scale,right:camera.x+(finder.right-rect.left-width/2)/camera.scale,top:camera.y+(finder.top-rect.top-height/2)/camera.scale,bottom:camera.y+(finder.bottom-rect.top-height/2)/camera.scale}:{left:camera.x-width*.41/camera.scale,right:camera.x+width*.41/camera.scale,top:camera.y-height*.17/camera.scale,bottom:camera.y+height*.25/camera.scale});
    canvas.setAttribute('aria-label', `${story.place}. ${story.headline}. Drag to pan across the town.`);
    canvas.dataset.cameraX = Math.round(camera.x);
    canvas.dataset.cameraY = Math.round(camera.y);
    canvas.dataset.currentEvent = story.kind;

    rafRef.current = requestAnimationFrame(drawScene);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawScene);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawScene]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    audioRef.current.sources.forEach((source) => { try { source.stop(); } catch (e) {} });
    try { audioRef.current.ctx?.close(); } catch (e) {}
  }, []);

  const capturePhoto = useCallback(() => {
    if (modalRef.current || !feedSession.active) return;
    markActive();
    const canvas = canvasRef.current;
    const target = frameRef.current;
    if (!canvas || !target) return;
    playSound('shutter');
    playVibrate('medium');
    const rect = target.getBoundingClientRect();
    const sourceRect = canvas.getBoundingClientRect();
    const ratioX = canvas.width / sourceRect.width;
    const ratioY = canvas.height / sourceRect.height;
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round(rect.width * ratioX));
    crop.height = Math.max(1, Math.round(rect.height * ratioY));
    const cropCtx = crop.getContext('2d');
    if (cropCtx) {
      cropCtx.drawImage(canvas, (rect.left - sourceRect.left) * ratioX, (rect.top - sourceRect.top) * ratioY, crop.width, crop.height, 0, 0, crop.width, crop.height);
    }
    const sim = simRef.current;
    const camera = cameraFor(frameStateRef.current, sourceRect.width, sourceRect.height, zoomRef.current);
    const bounds = {
      left: camera.x + (rect.left - sourceRect.left - sourceRect.width / 2) / camera.scale,
      right: camera.x + (rect.right - sourceRect.left - sourceRect.width / 2) / camera.scale,
      top: camera.y + (rect.top - sourceRect.top - sourceRect.height / 2) / camera.scale,
      bottom: camera.y + (rect.bottom - sourceRect.top - sourceRect.height / 2) / camera.scale,
    };
    const story = storyForCrop(sim, bounds);
    const eventType = story.category;
    const headline = story.headline;
    const image = crop.toDataURL('image/jpeg', 0.88);
    const nextTension = clamp(
      simRef.current.tension + (eventType === 'conflict' ? cfgRef.current.PHOTO_IMPACT * 2 : eventType === 'friendly' ? -cfgRef.current.PHOTO_IMPACT : 1),
      0,
      cfgRef.current.MAX_TENSION,
    );
    simRef.current.tension = nextTension;
    setTension(nextTension);
    setPhotoCount((count) => count + 1);
    if (eventType === 'friendly') setFriendlyCount((count) => count + 1);
    else if (eventType === 'conflict') setConflictCount((count) => count + 1);
    else setCalmCount((count) => count + 1);
    setNews((items) => [{ headline, type: eventType, image }, ...items].slice(0, 12));
    modalRef.current = true;
    setPaper({ ...story, headline, type: eventType, image });
    const eventTimer = setTimeout(() => {
      playSound('event');
      if (eventType === 'friendly') {
        const timer = setTimeout(() => playSound('friendly'), 180);
        timersRef.current.add(timer);
      } else if (eventType === 'conflict') {
        const timer = setTimeout(() => playSound('conflict'), 180);
        timersRef.current.add(timer);
      }
    }, 120);
    timersRef.current.add(eventTimer);
    console.info('[observer] photo captured', { event: eventType, tension: nextTension });
  }, [markActive, playSound]);

  const resetButton = useCallback(() => {
    playSound('event');
    playVibrate('light');
    modalRef.current = true;
    setRecap(true);
  }, [playSound]);

  const continueObserving = useCallback(() => {
    playSound('event');
    modalRef.current = false;
    setRecap(false);
  }, [playSound]);

  const resetWorld = useCallback(() => {
    playSound('event');
    playVibrate('heavy');
    simRef.current = initialSim(cfgRef.current.START_TENSION);
    frameStateRef.current = { x: WORLD.startX, y: WORLD.startY };
    zoomRef.current = cfgRef.current.MIN_ZOOM;
    setFrame({ x: WORLD.startX, y: WORLD.startY });
    setZoom(cfgRef.current.MIN_ZOOM);
    setPhotoCount(0);
    setFriendlyCount(0);
    setConflictCount(0);
    setCalmCount(0);
    setTension(cfgRef.current.START_TENSION);
    setNews([]);
    setPaper(null);
    setRecap(false);
    modalRef.current = false;
    pointersRef.current.clear();
    dragRef.current = null;
    activeRef.current = false;
    setActive(false);
    setGuideVisible(true);
    console.info('[observer] world reset');
  }, [playSound]);

  const tensionLabel = tension > 67 ? 'restless' : tension < 36 ? 'gentle' : 'watchful';

  return (
    <main ref={rootRef} className="observer-app" data-testid="observer-app">
      <canvas ref={canvasRef} className="town-canvas" aria-label="A living town to explore" onPointerDown={handleFramePointerDown} onPointerMove={handleFramePointerMove} onPointerUp={handleFramePointerUp} onPointerCancel={handleFramePointerUp} onLostPointerCapture={handleFramePointerUp} />
      {active && (
        <div className="tension-wrap" aria-label={`Tension: ${tensionLabel}`}>
          <span className="tension-caption">{tensionLabel}</span>
          <div className="tension-track"><div className="tension-fill" style={{ width: `${tension}%` }} /></div>
        </div>
      )}
      {guideVisible && <div className="guide" data-testid="guide">{cfg.GUIDE}</div>}
      <section
        ref={frameRef}
        className={`viewfinder ${active ? 'viewfinder-active' : ''}`}
        data-testid="viewfinder"
        style={{ left: "50%" }}
        onPointerDown={handleFramePointerDown}
        onPointerMove={handleFramePointerMove}
        onPointerUp={handleFramePointerUp}
        onPointerCancel={handleFramePointerUp}
        onLostPointerCapture={handleFramePointerUp}
        onWheel={handleWheel}
      >
        <div className="finder-corner corner-tl" /><div className="finder-corner corner-tr" /><div className="finder-corner corner-bl" /><div className="finder-corner corner-br" />
        <div className="finder-crosshair"><span /><span /></div>
      </section>
      <div className="camera-controls" role="group" aria-label="Camera controls">
        <button type="button" className="shutter" data-testid="shutter" aria-label="Take photo" onPointerDown={(e) => { e.stopPropagation(); ensureAudio(); }} onClick={(e) => { e.stopPropagation(); capturePhoto(); }}><span /></button>
        <div className="zoom-readout"><button type="button" data-testid="zoom-out" aria-label="Zoom out" onPointerDown={(e) => { e.stopPropagation(); ensureAudio(); }} onClick={(e) => { e.stopPropagation(); adjustZoom(-0.08); }}>−</button><span data-testid="zoom-value">{Math.round(zoom * 100)}%</span><button type="button" data-testid="zoom-in" aria-label="Zoom in" onPointerDown={(e) => { e.stopPropagation(); ensureAudio(); }} onClick={(e) => { e.stopPropagation(); adjustZoom(0.08); }}>+</button></div>
        <button type="button" className="reset-control" data-testid="reset" aria-label={cfg.RESET_LABEL} onPointerDown={ensureAudio} onClick={resetButton}><span className="reset-icon" /><span className="reset-label">{cfg.RESET_LABEL}</span></button>
      </div>
      <div className="bottom-hint">{active ? 'A living square, one frame at a time.' : 'Move closer to the life of the square.'}</div>

      {paper && !recap && (
        <div className="paper-backdrop" data-testid="newspaper">
          <article className="newspaper" data-story-kind={paper.kind}>
            <div className="paper-kicker">THE DAILY SQUARE</div>
            <div className="paper-rule" />
            <h1 data-testid="headline">{paper.headline}</h1>
            <div className="paper-photo"><img src={paper.image} alt="The photographed town square" /></div>
            <p className="paper-caption" data-testid="story-caption">{paper.caption}</p><div className="paper-meta"><span>{paper.place} · {paper.section}</span><span>{photoCount.toString().padStart(2, '0')}</span></div>
            <button type="button" className="paper-close" data-testid="close-paper" onPointerDown={ensureAudio} onClick={() => { playSound('event'); modalRef.current = false; setPaper(null); }}>Return to the square</button>
          </article>
        </div>
      )}

      {recap && (
        <div className="recap-backdrop" data-testid="recap">
          <section className="recap-sheet">
            <div className="paper-kicker">FIELD NOTES / RUN RECAP</div>
            <h2>The square remembers</h2>
            <div className="recap-count" data-testid="recap-photos">{photoCount}</div>
            <div className="recap-label">photographs made</div>
            <div className="recap-grid"><div><b>{friendlyCount}</b><span>kind moments</span></div><div><b>{conflictCount}</b><span>tense moments</span></div><div><b>{calmCount}</b><span>quiet moments</span></div></div>
            {news.length > 0 && <div className="history"><span>recent headlines</span>{news.slice(0, 2).map((item, index) => <p key={`${item.headline}-${index}`}>{item.headline}</p>)}</div>}
            <div className="recap-actions"><button type="button" className="secondary-action" data-testid="continue" onPointerDown={ensureAudio} onClick={continueObserving}>{cfg.CONTINUE_LABEL}</button><button type="button" className="primary-action" data-testid="reset-world" onPointerDown={ensureAudio} onClick={resetWorld}>{cfg.RESET_WORLD_LABEL}</button></div>
          </section>
        </div>
      )}
    </main>
  );
}

// Restrained reference art. World coordinates and event poses are unchanged.
const TOWN_INK='#252627';
function townEllipse(ctx,x,y,rx,ry,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
function drawTown(ctx,viewW,viewH,sim,motionTime){
  const pad=Math.max(viewW,viewH,200);
  ctx.fillStyle=TOWN_GRASS;ctx.fillRect(-pad,-pad,WORLD.width+pad*2,WORLD.height+pad*2);
  // Sparse ground flecks keep the open space legible without framing the scene.
  ctx.fillStyle='#d8d8d1';for(let i=0;i<135;i++){const x=80+(i*239)%3050,y=110+(i*367)%1700;ctx.fillRect(x,y,2,2);}
  ctx.strokeStyle='#cecfca';ctx.lineWidth=3;ctx.lineCap='round';
  for(const [x,y] of [[740,1260],[1940,1390],[2620,1320]]){ctx.beginPath();ctx.moveTo(x-50,y);ctx.lineTo(x+50,y);ctx.moveTo(x-40,y-25);ctx.lineTo(x+40,y-25);ctx.moveTo(x-40,y-25);ctx.lineTo(x-40,y+22);ctx.moveTo(x+40,y-25);ctx.lineTo(x+40,y+22);ctx.stroke();}
  ctx.beginPath();ctx.ellipse(2300,858,72,20,0,0,Math.PI*2);ctx.moveTo(2300,838);ctx.lineTo(2300,800);ctx.stroke();
  [...sim.residents].sort((a,b)=>a.y-b.y).forEach(p=>drawResident(ctx,p,motionTime));
  sim.events.forEach(ev=>drawEvent(ctx,ev,motionTime));
}
function drawResident(ctx,p,time){
  const t=reducedMotionQuery.matches?1:time,side=p.role?1:-1,fight=p.kind==='fight',dance=p.kind==='dance',wave=Math.sin(t*(fight?9:5)+p.role*Math.PI);
  ctx.save();ctx.translate(p.x,p.y);ctx.scale(p.size,p.size);
  townEllipse(ctx,1,62,21,4,'#2526270b');
  if(p.kind==='trip'&&!p.role){ctx.translate(0,22);ctx.rotate(-.9+Math.sin(t*3)*.1);}else ctx.rotate(fight?wave*.12:dance?wave*.17:0);ctx.translate(0,dance?-Math.abs(wave)*9:0);
  const stride=p.kind==='walk'?Math.sin(t*3+p.id)*10:dance?wave*13:0;
  ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=TOWN_INK;ctx.lineWidth=4;
  ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(0,27);ctx.lineTo(-13-stride,57);ctx.moveTo(0,27);ctx.lineTo(13+stride,57);ctx.stroke();
  let arms=[[0,0,-26,20],[0,0,26,20]];
  if(fight)arms=p.role?[[0,0,-34+wave*9,-15],[0,0,29,-25-wave*6]]:[[0,0,-25,-25+wave*7],[0,0,36+wave*9,-14]];
  if(dance||p.kind==='friendly')arms=[[0,0,-31,-24-wave*9],[0,0,31,-26+wave*9]];
  if(p.kind==='kindness')arms=[[0,0,-28,34],[0,0,29,38+wave*3]];
  if(p.kind==='soccer')arms=[[0,0,-27,-6],[0,0,27,14]];
  if(p.kind==='soccer'&&wave>.2){ctx.beginPath();ctx.moveTo(0,27);ctx.lineTo(-side*37,45);ctx.stroke();}
  if(p.kind==='music')arms=p.role?[[0,0,-28,-12+wave*9],[0,0,28,-15-wave*9]]:[[0,0,-28,14],[0,0,28,10+wave*8]];
  if(p.kind==='juggle'&&!p.role)arms=[[0,0,-29,-12-wave*9],[0,0,29,-12+wave*9]];
  ctx.beginPath();arms.forEach(([a,b,c,d])=>{ctx.moveTo(a,b);ctx.lineTo(c,d);});ctx.stroke();
  townEllipse(ctx,0,-29,19,20,TOWN_GRASS);ctx.beginPath();ctx.ellipse(0,-29,19,20,0,0,Math.PI*2);ctx.stroke();
  townEllipse(ctx,-6,-29,2,2,TOWN_INK);townEllipse(ctx,6,-29,2,2,TOWN_INK);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-4,-20);ctx.quadraticCurveTo(0,fight?-24:-16,4,-20);ctx.stroke();
  if(p.kind==='music'&&!p.role){ctx.save();ctx.translate(0,15);ctx.rotate(-.45);ctx.fillStyle=TOWN_GRASS;ctx.beginPath();ctx.ellipse(-5,0,14,19,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(-3,0);ctx.lineTo(34,0);ctx.stroke();townEllipse(ctx,-5,0,4,4,TOWN_INK);ctx.restore();}
  ctx.restore();
}

function drawEvent(ctx,ev,time){
  if(ev.kind==='calm')return;
  const t=reducedMotionQuery.matches?1:time;
  ctx.save();ctx.translate(ev.x,ev.y);ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=3;
  if(ev.kind==='fight'){
    ctx.strokeStyle='#414343';ctx.beginPath();ctx.moveTo(-18,-83);ctx.lineTo(-7,-72);ctx.lineTo(-1,-88);ctx.lineTo(9,-74);ctx.lineTo(19,-85);ctx.stroke();
    const pulse=.75+Math.sin(t*12)*.15;ctx.save();ctx.translate(Math.sin(t*7)*9,-4);ctx.scale(pulse,pulse);ctx.beginPath();for(let i=0;i<12;i++){const a=i*Math.PI/6,r=i%2?9:21;const x=Math.cos(a)*r,y=Math.sin(a)*r;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();ctx.fillStyle='#eeeee7';ctx.fill();ctx.stroke();ctx.restore();
    ctx.fillStyle='#414343';ctx.font='700 24px system-ui';ctx.textAlign='center';ctx.fillText('!',-63,-65);ctx.fillText('!',63,-65);
  }else if(ev.kind==='music'||ev.kind==='dance'){
    ctx.fillStyle='#555957';ctx.font='700 29px Georgia';for(let i=0;i<3;i++)ctx.fillText(i%2?'♪':'♫',-16+i*28,-89-Math.sin(t*2+i)*12);
  }else if(ev.kind==='friendly'){
    ctx.strokeStyle='#555957';ctx.beginPath();ctx.moveTo(0,-72);ctx.bezierCurveTo(-31,-91,-12,-111,0,-94);ctx.bezierCurveTo(12,-111,31,-91,0,-72);ctx.stroke();
  }else if(ev.kind==='kindness'){
    ctx.fillStyle='#d4d4c9';ctx.fillRect(-8,40,33,26);ctx.strokeStyle='#555957';ctx.strokeRect(-8,40,33,26);ctx.beginPath();ctx.arc(8,40,9,Math.PI,0);ctx.stroke();[-23,3,36].forEach((x,i)=>{ctx.fillStyle=['#a8aca7','#c2c4b9','#8e9b90'][i];ctx.beginPath();ctx.arc(x,66+Math.sin(t*2+i)*2,7,0,Math.PI*2);ctx.fill();});
  }else if(ev.kind==='soccer'){
    const x=Math.sin(t*2.3)*48;ctx.fillStyle='#f5f4ef';ctx.strokeStyle='#414343';ctx.beginPath();ctx.arc(x,51-Math.abs(Math.cos(t*2.3))*16,12,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(x-4,42);ctx.lineTo(x+5,50);ctx.lineTo(x-4,57);ctx.stroke();
  }else if(ev.kind==='splash'){
    ctx.strokeStyle='#9aa9a2';for(let i=0;i<6;i++){const f=(t*.8+i/6)%1;ctx.beginPath();ctx.moveTo(-28+f*75,-25-Math.sin(f*Math.PI)*65);ctx.lineTo(-26+f*75,-18-Math.sin(f*Math.PI)*65);ctx.stroke();}
  }else if(ev.kind==='trip'){
    ctx.strokeStyle='#7b807b';ctx.beginPath();ctx.moveTo(-94,51);ctx.lineTo(-109,41);ctx.moveTo(-98,61);ctx.lineTo(-117,65);ctx.stroke();ctx.fillStyle='#c4c7bf';ctx.beginPath();ctx.ellipse(-90,61,9,5,0,0,Math.PI*2);ctx.fill();
  }else if(ev.kind==='juggle'){
    for(let i=0;i<3;i++){const f=(t*.5+i/3)%1;ctx.fillStyle=['#909c91','#c2c8bc','#a4a8a1'][i];ctx.beginPath();ctx.arc(-54+Math.cos(f*Math.PI*2)*38,-58-Math.abs(Math.sin(f*Math.PI*2))*53,9,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#555957';ctx.stroke();}
  }
  ctx.restore();
}

const styles = `
@font-face {
  font-family: 'Encode Sans SC';
  src: url('./assets/fonts/encode_sans_sc/EncodeSansSemiCondensed-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

:root {
  --font-display: "Encode Sans SC", "PingFang SC", system-ui, sans-serif;
  --font-body:    "Encode Sans SC", "PingFang SC", system-ui, sans-serif;
  --font-mono:    ui-monospace, Menlo, monospace;
  --ivory: #f5f4ef;
  --ink: #252627;
  --muted: #777c77;
  --rust: #aa604e;
}
* { box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
body { background: #f5f4ef; -webkit-tap-highlight-color: transparent; color: var(--ink); }
button { font: inherit; color: inherit; }
.observer-app { position: relative; width: 100%; height: 100%; overflow: clip; isolation: isolate; user-select: none; touch-action: none; font-family: var(--font-body); }
.town-canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.topline { position: absolute; z-index: 2; top: max(18px, env(safe-area-inset-top, 0px)); left: 22px; right: 22px; display: flex; justify-content: space-between; align-items: center; pointer-events: none; }
.brand { font-family: var(--font-display); font-size: clamp(16px, 4.5vw, 22px); letter-spacing: .06em; color: #4b4038; text-shadow: 0 1px 0 #f5eddd; }
.stats { display: flex; gap: 7px; align-items: baseline; color: #655a4f; font-family: var(--font-display); font-size: 18px; }
.stats-dot { font-family: var(--font-body); font-size: 11px; letter-spacing: .16em; text-transform: uppercase; }
.guide { position: absolute; z-index: 3; top: 17%; left: 18px; right: 18px; text-align: center; color: #66594c; font-family: var(--font-body); font-size: clamp(13px, 3.8vw, 17px); letter-spacing: .015em; animation: breathe 2.5s ease-in-out infinite; pointer-events: none; }
@keyframes breathe { 0%,100% { opacity: .48; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-2px); } }
.viewfinder { position: absolute; z-index: 4; width: min(77%, 390px); height: min(48%, 330px); transform: translate(-50%, -50%); border: 1px solid rgba(72,61,50,.42); background: rgba(244,238,224,.045); box-shadow: 0 0 0 9999px rgba(46,38,31,.035), inset 0 0 34px rgba(70,57,43,.07); touch-action: none; cursor: grab; }
.viewfinder:active { cursor: grabbing; }
.viewfinder-active { border-color: rgba(72,61,50,.62); }
.finder-corner { position: absolute; width: 28px; height: 28px; border-color: #51463d; border-style: solid; opacity: .88; }
.corner-tl { left: -2px; top: -2px; border-width: 3px 0 0 3px; }.corner-tr { right: -2px; top: -2px; border-width: 3px 3px 0 0; }.corner-bl { left: -2px; bottom: -2px; border-width: 0 0 3px 3px; }.corner-br { right: -2px; bottom: -2px; border-width: 0 3px 3px 0; }
.finder-crosshair { position: absolute; left: 50%; top: 50%; width: 25px; height: 25px; transform: translate(-50%,-50%); opacity: .3; }
.finder-crosshair span:first-child { position: absolute; left: 12px; top: 0; bottom: 0; width: 1px; background: #544940; }.finder-crosshair span:last-child { position: absolute; top: 12px; left: 0; right: 0; height: 1px; background: #544940; }
.zoom-readout { position: absolute; top: 12px; right: 12px; display: flex; align-items: center; gap: 6px; padding: 4px 6px; color: #5c5148; background: rgba(244,236,218,.73); border: 1px solid rgba(88,74,61,.23); font-family: var(--font-mono); font-size: 12px; pointer-events: auto; }
.zoom-readout button { border: 0; background: transparent; padding: 0 4px; min-width: 24px; min-height: 24px; cursor: pointer; font-size: 19px; line-height: 18px; }
.shutter { position: absolute; left: 50%; bottom: -31px; width: 62px; height: 62px; transform: translateX(-50%); border-radius: 50%; border: 3px solid #f4eddd; background: var(--rust); box-shadow: 0 2px 0 rgba(61,48,39,.2), 0 0 0 1px rgba(92,63,51,.56); cursor: pointer; display: grid; place-items: center; pointer-events: auto; }
.shutter span { width: 39px; height: 39px; border-radius: 50%; border: 1px solid rgba(255,244,222,.86); box-shadow: inset 0 0 0 3px rgba(124,58,45,.22); }
.shutter:active { transform: translateX(-50%) scale(.95); }
.tension-wrap { position: absolute; z-index: 3; top: max(52px, calc(env(safe-area-inset-top, 0px) + 42px)); right: 22px; width: min(34%, 132px); display: flex; flex-direction: column; gap: 4px; align-items: flex-end; pointer-events: none; }
.tension-caption { font-size: 11px; letter-spacing: .11em; text-transform: uppercase; color: #6e6052; }
.tension-track { width: 100%; height: 5px; background: rgba(100,84,68,.17); overflow: hidden; border-radius: 4px; }.tension-fill { height: 100%; background: linear-gradient(90deg, #829274, #aa604e); transition: width .4s ease; }
.bottom-hint { position: absolute; z-index: 2; left: 92px; right: 18px; bottom: max(20px, env(safe-area-inset-bottom, 0px)); text-align: center; color: #796b5c; font-size: 12px; letter-spacing: .08em; opacity: .75; pointer-events: none; }
.reset-control { position: absolute; z-index: 5; left: 20px; bottom: max(18px, env(safe-area-inset-bottom, 0px)); border: 0; background: rgba(244,236,218,.72); padding: 7px 10px 7px 8px; color: #635649; font-family: var(--font-display); font-size: 13px; cursor: pointer; display: flex; gap: 7px; align-items: center; }
.reset-icon { width: 14px; height: 14px; border: 1.5px solid #766655; border-right-color: transparent; border-radius: 50%; position: relative; }.reset-icon:after { content: ''; position: absolute; right: -2px; top: -2px; border-left: 4px solid #766655; border-top: 3px solid transparent; border-bottom: 3px solid transparent; }
.paper-backdrop, .recap-backdrop { position: absolute; z-index: 10; inset: 0; display: grid; place-items: center; padding: 22px; background: rgba(58,48,40,.35); }
.newspaper, .recap-sheet { width: min(88%, 370px); max-height: 92%; overflow: auto; background: #f4eddd; border: 1px solid #b5a690; box-shadow: 5px 7px 0 rgba(64,49,38,.13); padding: 20px 18px 17px; color: #443b34; transform: rotate(-.7deg); }
.paper-kicker { font-family: var(--font-display); font-size: 11px; letter-spacing: .2em; color: #856b58; }.paper-rule { border-top: 2px solid #584b41; margin: 8px 0 12px; }
.newspaper h1, .recap-sheet h2 { margin: 0 0 12px; font-family: var(--font-display); font-size: clamp(24px, 7vw, 33px); line-height: 1.03; font-weight: 400; letter-spacing: -.02em; }.paper-photo { width: 100%; aspect-ratio: 1.28; background: #ded2bd; overflow: hidden; border: 5px solid #e1d6c1; outline: 1px solid #a99a83; }.paper-photo img { display: block; width: 100%; height: 100%; object-fit: cover; }.paper-meta { display: flex; justify-content: space-between; margin: 10px 0 15px; font-family: var(--font-mono); color: #7d6958; font-size: 10px; letter-spacing: .09em; }
.paper-close, .primary-action, .secondary-action { min-height: 42px; padding: 9px 15px; border: 1px solid #8d7561; cursor: pointer; font-family: var(--font-display); font-size: 16px; }.paper-close, .primary-action { background: #aa604e; color: #fff6e7; }.secondary-action { background: transparent; color: #665548; }.recap-sheet { transform: rotate(.4deg); text-align: center; }.recap-sheet h2 { margin-top: 14px; font-size: 29px; }.recap-count { margin-top: 5px; font-family: var(--font-display); font-size: 56px; line-height: 1; color: #aa604e; }.recap-label { color: #796a5c; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; }.recap-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin: 22px 0 17px; border-top: 1px solid #c7b8a1; border-bottom: 1px solid #c7b8a1; padding: 12px 0; }.recap-grid div { display: flex; flex-direction: column; gap: 3px; }.recap-grid b { font-family: var(--font-display); font-size: 23px; font-weight: 400; }.recap-grid span { font-size: 10px; color: #806e5d; line-height: 1.1; }.history { text-align: left; margin: 13px 0 17px; padding-top: 2px; }.history > span { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #806e5d; }.history p { margin: 7px 0 0; font-family: var(--font-display); font-size: 14px; line-height: 1.15; }.recap-actions { display: grid; gap: 8px; }
@media (max-height: 600px) { .viewfinder { height: min(43%, 260px); } .guide { top: 13%; } .bottom-hint { display: none; } .newspaper, .recap-sheet { max-height: 88%; padding-top: 14px; } }
`;

function StyledApp() { return <><style>{styles}</style><App /></>; }

createRoot(document.getElementById('root')).render(<><StyledApp/><BatchPolish/></>);
