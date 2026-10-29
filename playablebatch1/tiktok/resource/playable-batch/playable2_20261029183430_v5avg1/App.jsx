import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

const FALLBACK_CFG = {
  GRID_COLS: 14, GRID_ROWS: 20, CLEAN_GOAL: 0.92, BRUSH_POWER: 0.22, RINSE_POWER: 0.3, VACUUM_POWER: 0.32,
  GAME_TITLE: 'Rug Restore', GUIDE: 'Spray → Scrub → Rinse', COMPLETE: 'Satisfyingly clean!', NEXT_ITEM: 'Next item',
  SPRAY: 'Spray', BRUSH: 'Scrub', RINSE: 'Rinse', VACUUM: 'Dry', CLEANED: 'CLEANED',
  RUG_MAIN: './assets/rug-overhead.webp', UPHOLSTERY_MAIN: './assets/upholstery-overhead.webp',
  TOOL_SPRAY: './assets/tool-spray.svg', TOOL_BRUSH: './assets/tool-brush.svg',
  TOOL_RINSE: './assets/tool-rinse.svg', TOOL_DRY: './assets/tool-dry.svg'
};

const feedSession = (() => {
  const embedded = window.parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !embedded;
  const listeners = new Set();
  const update = () => {
    document.documentElement.dataset.feedPreview = String(!active);
    for (const listener of listeners) listener(active && !document.hidden);
  };
  window.addEventListener('message', event => {
    if (!embedded || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
    update();
  });
  document.addEventListener('visibilitychange', update);
  update();
  return { get active() { return active && !document.hidden; }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
})();

function useFeedActive() {
  const [active, setActive] = useState(feedSession.active);
  useEffect(() => feedSession.subscribe(setActive), []);
  return active;
}

function unwrapConfig(raw) {
  const result = { ...FALLBACK_CFG };
  (raw?.tweaks || []).forEach((item) => { result[item.id] = item.value; });
  (raw?.texts || []).forEach((item) => { result[item.id] = item.value; });
  (raw?.images || []).forEach((item) => { result[item.id] = item.path; });
  return result;
}

function makeGrid(cols, rows, seed = 1) {
  const cells = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const wave = Math.sin((x + 2) * 2.17 + seed * 0.7) * 0.12 + Math.cos((y + 1) * 1.51 + seed) * 0.1;
      const edge = Math.min(x, cols - 1 - x, y, rows - 1 - y) / Math.min(cols, rows);
      cells.push({
        dirt: Math.max(0.34, Math.min(0.96, 0.66 + wave + (edge < 0.08 ? 0.12 : 0))),
        initialDirt: Math.max(0.34, Math.min(0.96, 0.66 + wave + (edge < 0.08 ? 0.12 : 0))),
        detergent: 0, primed: false, scrubbed: false, rinsed: 0, cleaned: false,
        foam: 0,
        wet: 0,
        scrub: 0,
        dry: 0
      });
    }
  }
  return cells;
}

function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function treatCell(cell, tool, amount, cfg) {
  const before = cell.dirt;
  if (tool === 'spray') {
    cell.wet = clamp(cell.wet + .09 * amount);
    if (!cell.cleaned) {
      cell.detergent = clamp(cell.detergent + .24 * amount);
      cell.foam = clamp(cell.foam + .1 * amount);
      if (cell.detergent >= .28) cell.primed = true;
    }
  } else if (tool === 'brush') {
    if (cell.primed && !cell.cleaned) {
      cell.scrub = clamp(cell.scrub + Number(cfg.BRUSH_POWER || .22) * .7 * amount);
      cell.foam = clamp(cell.foam + .12 * amount);
      cell.wet = clamp(cell.wet + .025 * amount);
      if (cell.scrub >= .62) cell.scrubbed = true;
    }
  } else if (tool === 'rinse') {
    cell.wet = clamp(cell.wet + Number(cfg.RINSE_POWER || .3) * .55 * amount);
    cell.foam = clamp(cell.foam - .3 * amount);
    if (cell.primed && cell.scrubbed) {
      cell.rinsed = clamp(cell.rinsed + Number(cfg.RINSE_POWER || .3) * .8 * amount);
      cell.dirt = cell.initialDirt * (1 - cell.rinsed);
      if (cell.rinsed >= .88) {
        cell.cleaned = true;
        cell.dirt = 0;
        cell.foam = 0;
      }
    } else if (!cell.cleaned) {
      // Washing away unused detergent is not a shortcut past the scrub step.
      cell.detergent = clamp(cell.detergent - .24 * amount);
      if (cell.detergent < .12) {
        cell.primed = false;
        cell.scrub = 0;
        cell.scrubbed = false;
      }
    }
  } else if (tool === 'vacuum') {
    cell.wet = clamp(cell.wet - Number(cfg.VACUUM_POWER || .32) * amount);
    if (cell.cleaned) cell.dry = clamp(cell.dry + .2 * amount);
  }
  return Math.max(0, before - cell.dirt);
}

function cellIsClean(cell) { return cell.cleaned === true; }

function vibrate(style = 'light') {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style });
  } catch (error) { /* haptics are optional */ }
}

function useSound() {
  const audio = useRef({ ctx: null, gain: null, buffer: null, loadPromise: null, source: null, tone: null, noise: null });
  const ensureAudio = useCallback(() => {
    const current = audio.current;
    if (!current.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      current.ctx = new AudioContextClass();
      current.gain = current.ctx.createGain();
      current.gain.gain.value = 0.22;
      current.gain.connect(current.ctx.destination);
    }
    if (current.ctx.state === 'suspended') current.ctx.resume();
    if (!current.loadPromise) {
      current.loadPromise = fetch('./assets/sfx_tool_select.mp3')
        .then((response) => response.arrayBuffer())
        .then((data) => current.ctx.decodeAudioData(data))
        .then((buffer) => { current.buffer = buffer; return buffer; })
        .catch(() => null);
    }
    return current;
  }, []);

  const playSelect = useCallback(() => {
    const current = ensureAudio();
    if (!current) return;
    const play = (buffer) => {
      if (!buffer || !current.ctx || current.ctx.state !== 'running') return;
      try {
        const source = current.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(current.gain);
        source.start(0);
        current.source = source;
      } catch (error) { /* audio is non-blocking */ }
    };
    if (current.buffer) play(current.buffer);
    else current.loadPromise?.then(play);
  }, [ensureAudio]);

  const startAction = useCallback((tool) => {
    const current = ensureAudio();
    if (!current?.ctx || current.tone) return;
    if (tool === 'spray' || tool === 'rinse') {
      if (!current.noise) {
        current.noise = current.ctx.createBuffer(1, current.ctx.sampleRate * 2, current.ctx.sampleRate);
        const data = current.noise.getChannelData(0);
        let soft = 0;
        for (let i = 0; i < data.length; i += 1) { soft = soft * .72 + (Math.random() * 2 - 1) * .28; data[i] = soft; }
      }
      const source = current.ctx.createBufferSource();
      source.buffer = current.noise;
      source.loop = true;
      const filter = current.ctx.createBiquadFilter();
      filter.type = tool === 'spray' ? 'bandpass' : 'lowpass';
      filter.frequency.value = tool === 'spray' ? 3200 : 1800;
      filter.Q.value = .55;
      const gain = current.ctx.createGain();
      gain.gain.setValueAtTime(.0001, current.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(tool === 'spray' ? .15 : .18, current.ctx.currentTime + .07);
      source.connect(filter); filter.connect(gain); gain.connect(current.gain); source.start();
      current.tone = { oscillator: source, gain };
      return;
    }
    const frequencies = { spray: 540, brush: 220, rinse: 390, vacuum: 125 };
    const oscillator = current.ctx.createOscillator();
    const gain = current.ctx.createGain();
    oscillator.type = tool === 'vacuum' ? 'sawtooth' : 'triangle';
    oscillator.frequency.value = frequencies[tool] || 260;
    gain.gain.setValueAtTime(0.0001, current.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.028, current.ctx.currentTime + 0.08);
    oscillator.connect(gain);
    gain.connect(current.gain);
    oscillator.start();
    current.tone = { oscillator, gain };
  }, [ensureAudio]);

  const stopAction = useCallback(() => {
    const current = audio.current;
    if (!current.tone || !current.ctx) return;
    const now = current.ctx.currentTime;
    try {
      current.tone.gain.gain.cancelScheduledValues(now);
      current.tone.gain.gain.setValueAtTime(Math.max(0.0001, current.tone.gain.gain.value), now);
      current.tone.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
      current.tone.oscillator.stop(now + 0.07);
    } catch (error) { /* already stopped */ }
    current.tone = null;
  }, []);

  useEffect(() => () => {
    stopAction();
    const current = audio.current;
    try { current.source?.stop(); } catch (error) { /* already ended */ }
    try { current.ctx?.close(); } catch (error) { /* optional cleanup */ }
  }, [stopAction]);

  useEffect(() => feedSession.subscribe(active => {
    if (active) {
      if (audio.current.ctx?.state === 'suspended') audio.current.ctx.resume().catch(() => {});
      return;
    }
    stopAction();
    try { audio.current.source?.stop(); } catch (error) { /* optional */ }
    audio.current.ctx?.suspend().catch(() => {});
  }), [stopAction]);

  return { playSelect, startAction, stopAction };
}

function ToolIcon({ type, config }) {
  const id = { spray: 'TOOL_SPRAY', brush: 'TOOL_BRUSH', rinse: 'TOOL_RINSE', vacuum: 'TOOL_DRY' }[type];
  return <img className="toolArtwork" src={config[id]} alt="" aria-hidden="true" draggable="false" />;
}

function PostMyPlayButton() {
  const canSubmit = typeof tt !== 'undefined' && typeof tt.playableRecordingSubmission === 'function';
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const restore = () => setSubmitting(false);
    const onVisible = () => { if (document.visibilityState === 'visible') restore(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', restore);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', restore);
    };
  }, []);
  if (!canSubmit) return null;
  const submitRecording = () => {
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    tt.playableRecordingSubmission({
      success() {},
      fail(error) {
        console.error('[post_my_play] playableRecordingSubmission failed', error && (error.errMsg || error.message));
        setSubmitting(false);
      },
      complete() {}
    });
  };
  return <button className="resultButton secondary" type="button" disabled={submitting} onClick={submitRecording}>{submitting ? '...' : 'Post my play'}</button>;
}

function App() {
  const feedActive = useFeedActive();
  const [cfg, setCfg] = useState(FALLBACK_CFG);
  const [tool, setTool] = useState('spray');
  const [hasStarted, setHasStarted] = useState(false);
  const [complete, setComplete] = useState(false);
  const [progress, setProgress] = useState(0);
  const [itemIndex, setItemIndex] = useState(1);
  const [toolCursor, setToolCursor] = useState(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const effectsCanvasRef = useRef(null);
  const fxRef = useRef({ particles: [], frame: 0, lastTime: 0, lastMove: 0, point: null, tool: 'spray', dirt: 0 });
  const hintTimerRef = useRef(0);
  const [actionHint, setActionHint] = useState('');
  const completedRef = useRef(false);
  const cellsRef = useRef([]);
  const pointerRef = useRef({ id: null, last: null, active: false });
  const sizeRef = useRef({ width: 1, height: 1, dpr: 1 });
  const progressRef = useRef(0);
  const { playSelect, startAction, stopAction } = useSound();
  const surface = itemIndex % 2 === 1
    ? { id: 'rug', src: cfg.RUG_MAIN, label: 'Patterned wool rug viewed directly from above' }
    : { id: 'upholstery', src: cfg.UPHOLSTERY_MAIN, label: 'Woven upholstery viewed directly from above' };

  useEffect(() => {
    [cfg.RUG_MAIN, cfg.UPHOLSTERY_MAIN].forEach(src => { const image = new Image(); image.src = src; });
  }, [cfg.RUG_MAIN, cfg.UPHOLSTERY_MAIN]);

  useEffect(() => {
    let mounted = true;
    fetch('./game.config.json')
      .then((response) => response.json())
      .then((raw) => { if (mounted) setCfg(unwrapConfig(raw)); })
      .catch(() => { /* fallback keeps the game playable */ });
    return () => { mounted = false; };
  }, []);

  const resetGrid = useCallback((seed) => {
    completedRef.current = false;
    fxRef.current.particles = [];
    fxRef.current.lastMove = 0;
    setActionHint('');
    cellsRef.current = makeGrid(Number(cfg.GRID_COLS) || 14, Number(cfg.GRID_ROWS) || 20, seed);
    progressRef.current = 0;
    setProgress(0);
    setComplete(false);
    setHasStarted(false);
  }, [cfg]);

  useEffect(() => { resetGrid(itemIndex); }, [itemIndex, resetGrid]);

  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { width, height, dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const cols = Number(cfg.GRID_COLS) || 14;
    const rows = Number(cfg.GRID_ROWS) || 20;
    const cellW = width / cols;
    const cellH = height / rows;
    cellsRef.current.forEach((cell, index) => {
      const x = (index % cols) * cellW + cellW / 2;
      const y = Math.floor(index / cols) * cellH + cellH / 2;
      const grime = cell.dirt;
      if (grime > 0.03) {
        const radius = Math.max(cellW, cellH) * 0.82;
        const gradient = ctx.createRadialGradient(x - cellW * 0.1, y - cellH * 0.12, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(30, 23, 22, ${Math.min(0.62, grime * 0.62)})`);
        gradient.addColorStop(0.6, `rgba(39, 31, 27, ${Math.min(0.45, grime * 0.42)})`);
        gradient.addColorStop(1, 'rgba(18, 14, 13, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(x, y, cellW * 0.72, cellH * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(16, 12, 11, ${grime * 0.18})`;
        ctx.fillRect(x - cellW * 0.38, y - cellH * 0.12, cellW * 0.62, cellH * 0.12);
      }
      if (cell.wet > .03) {
        const wet = ctx.createRadialGradient(x, y, 0, x, y, cellW * 1.1);
        wet.addColorStop(0, `rgba(7, 20, 23, ${cell.wet * .1})`);
        wet.addColorStop(1, 'rgba(7,20,23,0)');
        ctx.fillStyle = wet;
        ctx.beginPath(); ctx.ellipse(x, y, cellW * .95, cellH * .82, -.18, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(239,252,252,${cell.wet * .16})`;
        ctx.lineWidth = .65; ctx.beginPath();ctx.moveTo(x-cellW*.3,y-cellH*.17);ctx.quadraticCurveTo(x,y-cellH*.27,x+cellW*.32,y-cellH*.12);ctx.stroke();
      }
      if (cell.foam > .035) {
        const muddy = cell.scrub > .05;
        const cloud = ctx.createRadialGradient(x, y, 0, x, y, cellW * .66);
        cloud.addColorStop(0, muddy ? `rgba(219,211,190,${cell.foam*.38})` : `rgba(245,251,247,${cell.foam*.34})`);
        cloud.addColorStop(1, 'rgba(247,252,248,0)');
        ctx.fillStyle=cloud;ctx.beginPath();ctx.ellipse(x,y,cellW*.8,cellH*.66,.12,0,Math.PI*2);ctx.fill();
        const count=Math.ceil(cell.foam*14);
        for(let b=0;b<count;b+=1){
          const seed=Math.sin(index*53.71+b*17.13)*43758.54, n=seed-Math.floor(seed);
          const seed2=Math.sin(index*23.17+b*9.93)*12435.21, m=seed2-Math.floor(seed2);
          const bx=x+(n-.5)*cellW*1.35,by=y+(m-.5)*cellH*1.2,r=.6+((b*7+index)%9)/9*1.5;
          ctx.fillStyle=`rgba(246,251,247,${cell.foam*.23})`;ctx.beginPath();ctx.arc(bx,by,r,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle=`rgba(247,255,254,${cell.foam*.48})`;ctx.lineWidth=.45;ctx.beginPath();ctx.arc(bx,by,r,.9,4.6);ctx.stroke();
        }
      }

    });
  }, [cfg]);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return undefined;
    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const fx = effectsCanvasRef.current;
      if (fx) { fx.width=canvas.width;fx.height=canvas.height;fx.style.width=canvas.style.width;fx.style.height=canvas.style.height; }
      fxRef.current.particles=[];
      drawOverlay();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [drawOverlay]);

  useEffect(() => { drawOverlay(); }, [drawOverlay, complete, itemIndex]);

  const updateProgress = useCallback(() => {
    const cleanCount = cellsRef.current.filter(cellIsClean).length;
    const value = cellsRef.current.length ? cleanCount / cellsRef.current.length : 0;
    if (Math.abs(value - progressRef.current) > 0.002 || value >= 1) {
      progressRef.current = value;
      setProgress(value);
    }
    if (value >= Number(cfg.CLEAN_GOAL || 0.92) && !completedRef.current) {
      completedRef.current = true;
      pointerRef.current.active = false;
      fxRef.current.lastMove = 0;
      setComplete(true);
      stopAction();
      vibrate('notification_success');
      console.info('[rug-restore] complete', { item: itemIndex, progress: value });
    }
  }, [cfg, complete, itemIndex, stopAction]);

  const applyAt = useCallback((point, dose = 1) => {
    const cols = Number(cfg.GRID_COLS) || 14, rows = Number(cfg.GRID_ROWS) || 20;
    const radius = { spray: .15, brush: .16, rinse: .18, vacuum: .16 }[tool] || .16;
    let removed = 0;
    cellsRef.current.forEach((cell, index) => {
      const cx=((index%cols)+.5)/cols,cy=(Math.floor(index/cols)+.5)/rows;
      const distance=Math.hypot(cx-point.x,(cy-point.y)*.92);
      if(distance<=radius)removed+=treatCell(cell,tool,clamp(1-distance/radius)*dose,cfg);
    });
    return removed;
  }, [cfg, tool]);

  const pointFromEvent = useCallback((event) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  }, []);

  const applyLine = useCallback((from, to) => {
    const distance=Math.hypot(to.x-from.x,to.y-from.y),steps=Math.max(1,Math.ceil(distance/.012));
    const dose=distance/(steps*.012);let removed=0;
    for(let index=1;index<=steps;index+=1){const t=index/steps;removed+=applyAt({x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t},dose);}
    drawOverlay();updateProgress();return removed;
  }, [applyAt, drawOverlay, updateProgress]);

  const drawEffects = useCallback(function paintWater(now) {
    const fx=fxRef.current,canvas=effectsCanvasRef.current;
    fx.frame=0;
    if(!canvas || !feedSession.active){fx.particles=[];fx.lastMove=0;return;}
    const ctx=canvas.getContext('2d'),{width,height,dpr}=sizeRef.current;
    const dt=Math.min(32,Math.max(0,now-(fx.lastTime||now)))/1000;fx.lastTime=now;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const emitting=pointerRef.current.active&&pointerRef.current.actionStarted&&fx.point&&now-fx.lastMove<110;
    if(emitting && (fx.tool==='spray'||fx.tool==='rinse')){
      const hit={x:fx.point.x*width,y:fx.point.y*height};
      const origin=fx.tool==='rinse'?{x:hit.x-29,y:hit.y-40}:{x:hit.x+32,y:hit.y-32};
      const dx=hit.x-origin.x,dy=hit.y-origin.y,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len;
      const spread=fx.tool==='rinse'?25:21;
      const fan=ctx.createLinearGradient(origin.x,origin.y,hit.x,hit.y);
      fan.addColorStop(0,'rgba(242,253,255,0)');
      fan.addColorStop(.32,fx.tool==='rinse'?'rgba(223,249,255,.13)':'rgba(241,252,253,.035)');
      fan.addColorStop(.85,fx.tool==='rinse'?'rgba(233,251,255,.12)':'rgba(246,253,252,.11)');
      fan.addColorStop(1,'rgba(242,253,255,0)');ctx.fillStyle=fan;
      ctx.beginPath();ctx.moveTo(origin.x+nx*1.3,origin.y+ny*1.3);ctx.lineTo(hit.x+nx*spread,hit.y+ny*spread);ctx.quadraticCurveTo(hit.x+dx*.15,hit.y+dy*.15,hit.x-nx*spread,hit.y-ny*spread);ctx.lineTo(origin.x-nx*1.3,origin.y-ny*1.3);ctx.closePath();ctx.fill();
      if(fx.tool==='rinse'){
        for(let i=0;i<9;i+=1){
          const offset=(i/8-.5)*spread*1.8,wave=Math.sin(now*.019+i*2.7)*1.1;
          ctx.strokeStyle=`rgba(239,253,255,${.16+(i%3)*.05})`;ctx.lineWidth=.6+(i%2)*.35;
          ctx.beginPath();ctx.moveTo(origin.x+nx*(i-4)*.3,origin.y+ny*(i-4)*.3);
          ctx.quadraticCurveTo((origin.x+hit.x)*.5+nx*(offset*.25+wave),(origin.y+hit.y)*.5+ny*(offset*.25+wave),hit.x+nx*offset,hit.y+ny*offset);ctx.stroke();
        }
        const impact=ctx.createRadialGradient(hit.x,hit.y,0,hit.x,hit.y,25);
        impact.addColorStop(0,'rgba(248,255,255,.12)');impact.addColorStop(1,'rgba(248,255,255,0)');ctx.fillStyle=impact;ctx.beginPath();ctx.ellipse(hit.x,hit.y,25,13,.1,0,Math.PI*2);ctx.fill();
      }
    }
    const alive=[];
    for(const p of fx.particles){
      p.age+=dt;if(p.age>=p.life)continue;
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=p.gravity*dt;
      const fade=Math.sin(Math.PI*Math.min(1,p.age/p.life))*(1-p.age/p.life*.4);
      if(p.kind==='mist'){
        ctx.strokeStyle=`rgba(240,252,255,${p.alpha*fade})`;ctx.lineWidth=p.radius;
        ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-p.vx*.009,p.y-p.vy*.009);ctx.stroke();
      }else{
        ctx.strokeStyle=p.dirty?`rgba(120,105,76,${fade*.27})`:`rgba(206,239,246,${fade*.38})`;
        ctx.lineWidth=p.radius*1.8;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-p.vx*.02,p.y-p.vy*.035);ctx.stroke();
        ctx.fillStyle=`rgba(249,255,255,${fade*.48})`;ctx.beginPath();ctx.arc(p.x-.4,p.y-.8,Math.max(.35,p.radius*.38),0,Math.PI*2);ctx.fill();
      }
      alive.push(p);
    }
    fx.particles=alive;
    if(alive.length||emitting)fx.frame=requestAnimationFrame(paintWater);
  }, []);

  const animateToolEffect = useCallback((point,activeTool,removedDirt) => {
    if(activeTool!=='spray'&&activeTool!=='rinse')return;
    const fx=fxRef.current,{width,height}=sizeRef.current;
    fx.point=point;fx.tool=activeTool;fx.dirt=removedDirt;fx.lastMove=performance.now();
    const hit={x:point.x*width,y:point.y*height};
    const origin=activeTool==='rinse'?{x:hit.x-29,y:hit.y-40}:{x:hit.x+32,y:hit.y-32};
    const base=Math.atan2(hit.y-origin.y,hit.x-origin.x);
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const count=reduced?3:activeTool==='spray'?7:10;
    for(let i=0;i<count;i+=1){
      if(activeTool==='spray'){
        const a=base+(Math.random()-.5)*.64,speed=155+Math.random()*105;
        fx.particles.push({kind:'mist',x:origin.x+(Math.random()-.5)*2,y:origin.y+(Math.random()-.5)*2,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,age:0,life:.18+Math.random()*.17,gravity:25,radius:.45+Math.random()*.65,alpha:.2+Math.random()*.25});
      }else{
        const a=Math.random()*Math.PI*2,r=3+Math.random()*20;
        fx.particles.push({kind:'water',x:hit.x+Math.cos(a)*r,y:hit.y+Math.sin(a)*r*.6,vx:(Math.random()-.5)*36,vy:20+Math.random()*42,age:0,life:.28+Math.random()*.42,gravity:55,radius:.6+Math.random()*.85,dirty:removedDirt>.015&&i%3!==0});
      }
    }
    if(fx.particles.length>240)fx.particles.splice(0,fx.particles.length-240);
    if(!fx.frame){fx.lastTime=performance.now();fx.frame=requestAnimationFrame(drawEffects);}
  }, [drawEffects]);

  const endStroke = useCallback((event) => {
    if (event.pointerId !== pointerRef.current.id) return;
    pointerRef.current = { id: null, last: null, active: false };
    setToolCursor(null);
    stopAction();
  }, [stopAction]);

  const onPointerDown = useCallback((event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.isPrimary === false || complete || !feedActive) return;
    const point = pointFromEvent(event);
    if (!point) return;
    pointerRef.current = { id: event.pointerId, last: point, active: true };
    setToolCursor(point);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
  }, [complete, feedActive, pointFromEvent]);

  const onPointerMove = useCallback((event) => {
    const pointer = pointerRef.current;
    if (!pointer.active || pointer.id !== event.pointerId || event.isPrimary === false || complete) return;
    const next = pointFromEvent(event);
    if (!next || !pointer.last) return;
    setToolCursor(next);
    if (Math.hypot(next.x - pointer.last.x, next.y - pointer.last.y) < 0.002) return;
    if (!hasStarted) {
      setHasStarted(true);
      vibrate('medium');
    }
    if (!pointer.actionStarted) {
      pointer.actionStarted = true;
      startAction(tool);
    }
    const cols=Number(cfg.GRID_COLS)||14,rows=Number(cfg.GRID_ROWS)||20;
    const center=cellsRef.current[Math.min(rows-1,Math.floor(next.y*rows))*cols+Math.min(cols-1,Math.floor(next.x*cols))];
    const reason=center&&!center.cleaned&&tool==='brush'&&!center.primed?'Spray first':center&&!center.cleaned&&tool==='rinse'&&!center.scrubbed?(center.primed?'Scrub first':'Spray first'):'';
    if(reason){setActionHint(reason);clearTimeout(hintTimerRef.current);hintTimerRef.current=window.setTimeout(()=>setActionHint(''),1400);}else setActionHint('');
    const removed=applyLine(pointer.last,next);
    animateToolEffect(next,tool,removed);
    pointer.last = next;
  }, [animateToolEffect, applyLine, cfg, complete, hasStarted, pointFromEvent, startAction, tool]);

  useEffect(() => {
    const stop = () => {
      pointerRef.current = { id: null, last: null, active: false };
      fxRef.current.lastMove = 0;
      fxRef.current.particles = [];
      cancelAnimationFrame(fxRef.current.frame);
      fxRef.current.frame = 0;
      effectsCanvasRef.current?.getContext('2d')?.clearRect(0,0,effectsCanvasRef.current.width,effectsCanvasRef.current.height);
      setToolCursor(null);
      stopAction();
    };
    window.addEventListener('blur', stop);
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hidden);
    const unsubscribe = feedSession.subscribe(active => { if (!active) stop(); });
    return () => { window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', hidden); unsubscribe(); };
  }, [stopAction]);

  const chooseTool = (nextTool) => {
    pointerRef.current = { id: null, last: null, active: false };
    setToolCursor(null);
    stopAction();
    fxRef.current.lastMove=0;
    setActionHint('');
    if (nextTool === tool) {
      playSelect();
      vibrate('light');
      return;
    }
    setTool(nextTool);
    playSelect();
    vibrate('light');
  };

  useEffect(() => () => { cancelAnimationFrame(fxRef.current.frame);clearTimeout(hintTimerRef.current); }, []);

  const nextItem = () => {
    stopAction();
    setItemIndex((value) => value + 1);
    setTool('spray');
    console.info('[rug-restore] next item', itemIndex + 1);
  };

  const tools = useMemo(() => [
    { id: 'spray', label: cfg.SPRAY }, { id: 'brush', label: cfg.BRUSH }, { id: 'rinse', label: cfg.RINSE }, { id: 'vacuum', label: cfg.VACUUM }
  ], [cfg]);

  return <div className="appShell" data-surface={surface.id} data-tool={tool} data-progress={progress.toFixed(4)}>
    <header className="topHud" style={{ visibility: hasStarted ? 'visible' : 'hidden' }}>
      <div className="progressPill" aria-label={`${Math.round(progress * 100)}% cleaned`}><strong>{Math.round(progress * 100)}%</strong></div>
    </header>
    <main className="playArea">
      {!hasStarted && <div className="guideText">{cfg.GUIDE}</div>}
      <div className="stageWrap">
        <div className={`rugStage ${complete ? 'isComplete' : ''}`} ref={stageRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endStroke} onPointerCancel={endStroke} onLostPointerCapture={endStroke}>
          <img className="rugImage" src={surface.src} alt={surface.label} draggable="false" />
          <canvas className="textureOverlay" ref={canvasRef} aria-hidden="true" />
          <canvas className="actionEffects" ref={effectsCanvasRef} aria-hidden="true" />
          <div className="fiberGloss" aria-hidden="true" />
          {toolCursor && !complete && <span className={`toolCursor cursor-${tool}`} aria-hidden="true" style={{ left: `${toolCursor.x * 100}%`, top: `${toolCursor.y * 100}%` }}><ToolIcon type={tool} config={cfg} /></span>}
          {complete && <div className="resultOverlay">
            <div className="resultCard">
              <div className="sparkSeal"><span /><span /><span /></div>
              <div className="resultEyebrow">{Math.round(progress * 100)}% CLEANED</div>
              <h1>{cfg.COMPLETE}</h1>
              <div className="resultActions">
                <button className="resultButton primary" type="button" onClick={nextItem}>{cfg.NEXT_ITEM}</button>
                <PostMyPlayButton />
              </div>
            </div>
          </div>}
        </div>
      </div>
      {actionHint && !complete && <div className="toolFeedback" role="status">{actionHint}</div>}
    </main>
    <nav className="toolDock" aria-label="Cleaning tools">
      {tools.map((item) => <button className={`toolButton ${tool === item.id ? 'selected' : ''}`} type="button" key={item.id} onClick={() => chooseTool(item.id)} aria-label={item.label}>
        <span className="toolIcon"><ToolIcon type={item.id} config={cfg} /></span><span className="toolLabel">{item.label}</span>
      </button>)}
    </nav>
    <style>{`
      @font-face {
        font-family: 'Poppins';
        src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: 'Poppins';
        src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');
        font-weight: 700;
        font-style: normal;
        font-display: swap;
      }

      :root {
        --font-display: "Poppins", "PingFang SC", system-ui, sans-serif;
        --font-body:    "Poppins", "PingFang SC", system-ui, sans-serif;
        --font-mono:    ui-monospace, Menlo, monospace;
      }

      * { box-sizing: border-box; }
      html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
      body { background: #071917; -webkit-tap-highlight-color: transparent; }
      button { font: inherit; }
      .appShell { width: 100%; height: 100%; min-height: 0; overflow: clip; display: flex; flex-direction: column; position: relative; color: #f9f8ef; background: radial-gradient(circle at 50% 36%, #1d4540 0%, #102f2c 40%, #071917 100%); font-family: var(--font-body); }
      .appShell::before { content: ''; pointer-events: none; position: absolute; inset: 0; opacity: .3; background-image: radial-gradient(rgba(246, 233, 183, .1) 1px, transparent 1px); background-size: 18px 18px; mask-image: linear-gradient(to bottom, black, transparent 86%); }
      .topHud { position: relative; z-index: 4; flex: 0 0 auto; height: 68px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 0 18px; letter-spacing: .12em; font-size: 10px; font-weight: 700; color: rgba(241, 238, 217, .66); }
      .brandMark, .itemMark { white-space: nowrap; }
      .itemMark { text-align: right; }
      .brandDot { width: 7px; height: 7px; display: inline-block; border-radius: 50%; margin-right: 7px; background: #e0b75c; box-shadow: 0 0 14px #e0b75c; vertical-align: 1px; }
      .progressPill { min-width: 124px; display: flex; align-items: baseline; justify-content: center; gap: 10px; padding: 8px 14px; border: 1px solid rgba(237, 218, 157, .32); border-radius: 99px; background: rgba(8, 27, 25, .34); box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }
      .progressPill span { font-size: 9px; letter-spacing: .16em; color: #e4cc8a; }
      .progressPill strong { font-family: var(--font-display); letter-spacing: .04em; font-size: 16px; color: #fff9df; }
      .playArea { position: relative; z-index: 1; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
      .guideText { position: absolute; top: 8px; left: 16px; right: 16px; z-index: 3; text-align: center; color: #fff5cf; font-family: var(--font-display); font-size: clamp(14px, 4.5cqi, 18px); font-weight: 700; letter-spacing: .025em; animation: breathe 2.8s ease-in-out infinite; text-shadow: 0 2px 14px rgba(0,0,0,.32); }
      .stageWrap { flex: 1 1 auto; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; padding: 29px 0 16px; }
      .rugStage { height: min(100%, 500px); width: auto; max-width: 88%; aspect-ratio: 3 / 4; position: relative; overflow: hidden; border-radius: 24px; isolation: isolate; touch-action: none; cursor: crosshair; background: #15211f; box-shadow: 0 22px 46px rgba(0,0,0,.4), 0 0 0 1px rgba(238, 210, 132, .3), inset 0 0 0 2px rgba(255,255,255,.08); }
      .rugStage::after { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 4; border-radius: inherit; box-shadow: inset 0 0 30px rgba(6, 17, 15, .44), inset 0 0 0 1px rgba(255,255,255,.12); }
      .rugImage { display: block; width: 100%; height: 100%; object-fit: cover; user-select: none; pointer-events: none; }
      .textureOverlay { position: absolute; inset: 0; z-index: 2; display: block; pointer-events: none; }
      .fiberGloss { position: absolute; z-index: 3; inset: 0; pointer-events: none; opacity: .34; mix-blend-mode: screen; background: linear-gradient(116deg, transparent 18%, rgba(255,245,205,.1) 42%, transparent 58%), repeating-linear-gradient(173deg, rgba(255,255,255,.025) 0 1px, transparent 1px 4px); }
      .rugStage.isComplete .fiberGloss { opacity: .58; animation: cleanShimmer 2.2s ease-in-out infinite; }
      .resultOverlay { position: absolute; z-index: 8; inset: 0; display: grid; place-items: center; padding: 18px; background: rgba(5, 26, 24, .34); backdrop-filter: blur(3px); }
      .resultCard { width: min(88%, 310px); padding: 25px 20px 21px; border: 1px solid rgba(250, 225, 150, .5); border-radius: 22px; text-align: center; background: linear-gradient(145deg, rgba(21, 65, 59, .96), rgba(8, 34, 31, .96)); box-shadow: 0 18px 40px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.13); animation: resultIn .45s cubic-bezier(.2,.8,.2,1) both; }
      .sparkSeal { height: 28px; display: flex; align-items: center; justify-content: center; gap: 5px; margin-bottom: 7px; }
      .sparkSeal span { display: block; width: 5px; height: 20px; border-radius: 5px; background: #f1ce74; transform: rotate(35deg); box-shadow: 0 0 12px rgba(241,206,116,.65); }
      .sparkSeal span:nth-child(2) { height: 28px; transform: rotate(0); }
      .sparkSeal span:nth-child(3) { transform: rotate(-35deg); }
      .resultEyebrow { font-size: 9px; letter-spacing: .2em; color: #e5c875; font-weight: 700; }
      .resultCard h1 { margin: 7px 0 22px; color: #fff8df; font-family: var(--font-display); font-size: clamp(20px, 6cqi, 27px); line-height: 1.15; }
      .resultActions { display: flex; justify-content: center; gap: 9px; flex-wrap: wrap; }
      .resultButton { min-height: 46px; padding: 0 18px; border: 0; border-radius: 14px; cursor: pointer; font-family: var(--font-display); font-size: 13px; font-weight: 700; letter-spacing: .02em; transition: transform .16s ease, filter .16s ease, opacity .16s ease; }
      .resultButton:active { transform: scale(.96); }
      .resultButton.primary { color: #19352d; background: linear-gradient(135deg, #ffe8a2, #d8ad54); box-shadow: 0 6px 18px rgba(206, 160, 66, .22); }
      .resultButton.secondary { color: #f8eabb; border: 1px solid rgba(247, 220, 147, .35); background: rgba(255,255,255,.07); }
      .toolDock { position: relative; z-index: 5; flex: 0 0 auto; display: flex; justify-content: center; gap: clamp(6px, 2.3cqi, 14px); padding: 8px 12px max(16px, env(safe-area-inset-bottom, 0px)); background: linear-gradient(to top, rgba(5, 20, 18, .92), rgba(7, 25, 23, .68)); border-top: 1px solid rgba(218, 194, 126, .17); }
      .toolButton { position: relative; min-width: 65px; width: 18%; max-width: 88px; min-height: 74px; padding: 7px 5px 5px; border: 0; border-radius: 16px; color: rgba(243, 239, 218, .64); background: transparent; cursor: pointer; transition: background .18s ease, color .18s ease, transform .16s ease; }
      .toolButton:active { transform: scale(.95); }
      .toolButton.selected { color: #fff3c6; background: rgba(237, 203, 117, .12); }
      .toolButton.selected::before { content: ''; position: absolute; inset: 1px; border: 1px solid rgba(244, 213, 131, .8); border-radius: 16px; box-shadow: 0 0 15px rgba(240, 199, 95, .14), inset 0 0 15px rgba(240, 199, 95, .06); pointer-events: none; }
      .toolIcon { width: 35px; height: 35px; display: grid; place-items: center; margin: 0 auto 3px; }
      .toolIcon svg { width: 32px; height: 32px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
      .toolLabel { position: relative; display: block; font-family: var(--font-display); font-size: 11px; font-weight: 700; letter-spacing: .02em; }
      @keyframes breathe { 0%, 100% { opacity: .56; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-2px); } }
      @keyframes resultIn { from { opacity: 0; transform: translateY(15px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @keyframes cleanShimmer { 0%, 100% { transform: translateX(-2%); opacity: .4; } 50% { transform: translateX(2%); opacity: .72; } }
      @media (max-height: 620px) { .topHud { height: 56px; } .stageWrap { padding-top: 20px; padding-bottom: 8px; } .toolButton { min-height: 64px; } .toolIcon { height: 29px; width: 29px; } .toolIcon svg { width: 27px; height: 27px; } .resultCard { padding: 17px 16px 16px; } .resultCard h1 { margin-bottom: 14px; } }
      .appShell { container-type: inline-size; }
      .stageWrap { padding-top: 48px; padding-bottom: 12px; }
      .rugStage { border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,.22), 0 0 0 1px rgba(238,210,132,.24); }
      .rugStage::after { box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
      .fiberGloss { opacity: .12; background: linear-gradient(116deg, transparent 18%, rgba(255,255,255,.06) 42%, transparent 58%); }
      .toolDock { gap: clamp(6px, 2.2cqi, 12px); padding: 5px 18px 12px; }
      .toolButton { min-height: 80px; width: 20%; max-width: 84px; min-width: 62px; padding: 5px 4px 4px; color: #c6d8d3; }
      .toolIcon { width: 44px; height: 44px; margin-bottom: 4px; }
      .toolArtwork { display: block; width: 100%; height: 100%; object-fit: contain; user-select: none; pointer-events: none; filter: drop-shadow(0 2px 2px rgba(0,0,0,.16)); }
      .toolLabel { font-size: 12px; line-height: 18px; letter-spacing: 0; }
      .toolButton.selected { color: #fff8df; background: rgba(237,203,117,.15); }
      .toolButton:focus-visible, .resultButton:focus-visible { outline: 3px solid #94dcf4; outline-offset: 2px; }
      .toolCursor { position: absolute; z-index: 5; width: 48px; height: 48px; margin-left: -12px; margin-top: -35px; pointer-events: none; transform: rotate(-12deg); }
      .cursor-vacuum { margin-left: -24px; margin-top: -25px; transform: none; }

      .topHud { height:74px; display:flex; align-items:flex-start; justify-content:center; padding:30px 30px 0; }
      .progressPill { min-width:0; padding:0; border:0; border-radius:0; background:none; box-shadow:none; }
      .progressPill strong { font-size:28px; line-height:1.15; letter-spacing:0; }
      .stageWrap { padding:10px 30px 12px; }
      .rugStage { max-width:100%; }
      .guideText { top:22%; left:50%; right:auto; width:max-content; max-width:calc(100% - 60px); padding:8px 16px; border-radius:999px; border:1px solid rgba(255,248,222,.2); background:rgba(5,24,22,.88); font-size:18px; line-height:24px; letter-spacing:0; transform:translateX(-50%); animation:cleanGuideBreathe 2.2s ease-in-out infinite; }
      @keyframes cleanGuideBreathe { 0%,100% { opacity:.65; } 50% { opacity:1; } }
      .toolDock { flex:0 0 122px; gap:8px; padding:4px 30px 50px; border:0; }
      .toolButton { width:calc((100% - 24px)/4); min-width:0; max-width:none; min-height:68px; height:68px; padding:3px 2px; }
      .toolIcon { width:40px; height:40px; margin-bottom:2px; }
      .toolLabel { font-size:12px; line-height:18px; }
      html[data-feed-preview="true"] .toolDock { visibility:hidden; }
      .resultButton { font-size:15px; min-height:46px; }


      .actionEffects { position:absolute; inset:0; z-index:4; display:block; pointer-events:none; }
      .cursor-spray { margin-left:22px; margin-top:-42px; transform:rotate(-6deg); }
      .cursor-rinse { margin-left:-65px; margin-top:-62px; transform:none; }
      .toolFeedback { position:absolute; left:50%; bottom:12px; z-index:7; transform:translateX(-50%); padding:6px 12px; border-radius:999px; background:rgba(5,24,22,.9); color:#fff4d5; font:700 13px/1.3 var(--font-body); pointer-events:none; }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
    `}</style>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
