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
    <style>{POLISH_CSS}</style>
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

const GAME_NUMBER=83;
const POLISH_CSS=BASE_CSS+".counter{top:30px;font-size:28px}.hint{top:24%;left:30px;right:30px;transform:translateY(-50%);font-size:18px;font-weight:700;line-height:1.3;color:#f4f3ec;animation:batchBreathe 2.6s ease-in-out infinite}.hint.is-hidden{animation:none;opacity:0;transform:translateY(-50%)}.reset-button{top:auto;right:30px;bottom:50px;width:46px;height:46px;background:#111;border-color:#444}[data-feed-preview=true] .counter,[data-feed-preview=true] .reset-button{visibility:hidden}";

const FALLBACK_CFG = {
  INITIAL_PAPER_LENGTH: 156,
  MAX_PAPER_LENGTH: 304,
  RECYCLE_LENGTH: 118,
  PULL_THRESHOLD: 28,
  PAPER_WIDTH: 72,
  PHASE_PER_PIXEL: 0.9,
  HINT_TEXT: 'Pull down to unwind',
  RESET_LABEL: 'Reset'
};

function inflateConfig(json) {
  const next = { ...FALLBACK_CFG };
  if (json && Array.isArray(json.tweaks)) {
    json.tweaks.forEach((item) => {
      if (item && item.id && typeof item.value === 'number') next[item.id] = item.value;
    });
  }
  if (json && Array.isArray(json.texts)) {
    json.texts.forEach((item) => {
      if (item && item.id && typeof item.value === 'string') next[item.id] = item.value;
    });
  }
  return next;
}

function vibrate(style) {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style: style || 'light' });
  } catch (error) {
    // Haptics are optional outside the host container.
  }
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

const ROLL_INITIAL_RADIUS=76,ROLL_MIN_RADIUS=38,ROLL_CORE_RADIUS=34,ROLL_PAPER_SUPPLY=2400;
const ROLL_DROP_MS=440,ROLL_ENTER_AT_MS=280,ROLL_ENTER_MS=580;
const PAPER_COAST_MS=950,PAPER_STOP_SPEED=.012,PAPER_MAX_SPEED=3.4;
const PULL_MAX_SPEED=2.4,PAPER_RELEASE_GAIN=1.45;
function samplePullSpeed(previous,distance,elapsed,first=false){
  if(distance<-2)return 0;
  // Ignore the tiny final finger/mouse jitter that used to brake a good pull.
  if(Math.abs(distance)<.5&&!first)return previous;
  const dt=Math.max(1,elapsed),speed=Math.min(PULL_MAX_SPEED,Math.max(0,distance)/dt);
  return first?speed:previous+(speed-previous)*(1-Math.exp(-dt/55));
}
function releasePullSpeed(speed,idleMs){
  if(idleMs>=260)return 0;
  return Math.min(PAPER_MAX_SPEED,Math.max(0,speed)*PAPER_RELEASE_GAIN)*Math.exp(-Math.max(0,idleMs-70)/110);
}
function advancePaperMomentum(speed,elapsed){
  const v=Math.min(PAPER_MAX_SPEED,Math.max(0,speed));
  if(v<=PAPER_STOP_SPEED)return {velocity:0,distance:0};
  const stopAt=PAPER_COAST_MS*Math.log(v/PAPER_STOP_SPEED),dt=Math.min(Math.max(0,elapsed),stopAt),decay=Math.exp(-dt/PAPER_COAST_MS);
  return {velocity:dt>=stopAt?0:v*decay,distance:v*PAPER_COAST_MS*(1-decay)};
}
function beginRollCycle(cycle,unwound,phase){
  if(cycle.stage!=='ready'||unwound<ROLL_PAPER_SUPPLY)return false;
  Object.assign(cycle,{stage:'drop',elapsed:0,oldUnwound:unwound,oldPhase:phase});return true;
}
function advanceRollCycle(cycle,elapsed){
  if(cycle.stage==='ready')return false;
  cycle.elapsed+=Math.max(0,elapsed);
  if(cycle.elapsed>=ROLL_ENTER_AT_MS+ROLL_ENTER_MS){cycle.stage='ready';cycle.elapsed=0;return true;}
  cycle.stage=cycle.elapsed>=ROLL_ENTER_AT_MS?'enter':'drop';return false;
}
function rollCyclePose(elapsed,height,reduced=false){
  const drop=Math.min(1,Math.max(0,elapsed/ROLL_DROP_MS)),enter=Math.min(1,Math.max(0,(elapsed-ROLL_ENTER_AT_MS)/ROLL_ENTER_MS));
  return {showOld:elapsed<ROLL_DROP_MS,showNew:elapsed>=ROLL_ENTER_AT_MS,oldY:reduced?0:(height+200)*drop*drop,oldAngle:reduced?0:.18*drop*drop,oldAlpha:reduced?1-drop:1,newY:reduced?0:-(height+160)*(1-enter)**3,newAlpha:reduced?enter:1};
}
function unwindPaper(distance,cfg,lengthRef,phaseRef,unwoundRef){
  const pulled=Math.max(0,Number(distance)||0);if(!pulled)return;
  lengthRef.current+=pulled;
  if(lengthRef.current>cfg.MAX_PAPER_LENGTH)lengthRef.current-=Math.ceil((lengthRef.current-cfg.MAX_PAPER_LENGTH)/Math.max(1,cfg.RECYCLE_LENGTH))*Math.max(1,cfg.RECYCLE_LENGTH);
  phaseRef.current+=pulled*cfg.PHASE_PER_PIXEL;
  unwoundRef.current+=pulled;
}
function rollGeometry(cfg,unwound=0){
  // Paper volume follows the annular cross-section: the cardboard core stays
  // fixed while its surrounding paper becomes thinner with each real pull.
  const remaining=Math.max(0,1-Math.max(0,Number(unwound)||0)/ROLL_PAPER_SUPPLY);
  const radius=Math.sqrt(ROLL_MIN_RADIUS**2+(ROLL_INITIAL_RADIUS**2-ROLL_MIN_RADIUS**2)*remaining);
  const cx=138,cy=298,rx=radius,ry=radius,depth=cfg.PAPER_WIDTH*1.39,slant=-17;
  return{cx,cy,rx,ry,depth,slant,coreRadius:ROLL_CORE_RADIUS,remaining,left:cx+rx,right:cx+rx+depth,sheetTop:cy+10};
}
function rollHit(point,cfg,unwound=0){
  const g=rollGeometry(cfg,unwound);
  const face=((point.x-g.cx)/g.rx)**2+((point.y-g.cy)/g.ry)**2<=1.15;
  const sheet=point.x>=g.left-12&&point.x<=g.right+12&&point.y>=g.sheetTop-24;
  const body=point.x>=g.cx&&point.x<=g.right+8&&point.y>=g.cy-g.ry+g.slant-8&&point.y<=g.sheetTop;
  return face||sheet||body;
}
function paintPaperRoll(ctx,cfg,phase,sway,bottom,unwound=0){
  const g=rollGeometry(cfg,unwound),{cx,cy,rx,ry,depth,slant}=g,bx=cx+depth,by=cy+slant;
  // The back cylinder and its shaded underside are continuous with the front
  // face. A single white surface turns over the back into the hanging sheet.
  ctx.fillStyle='#5c5c5c';ctx.beginPath();ctx.moveTo(cx,cy-ry);ctx.lineTo(bx,by-ry);ctx.bezierCurveTo(bx+rx*.56,by-ry,bx+rx,by-ry*.45,bx+rx,by);ctx.bezierCurveTo(bx+rx,by+ry*.55,bx+rx*.55,by+ry,bx,by+ry);ctx.lineTo(cx,cy+ry);ctx.closePath();ctx.fill();
  ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(cx,cy-ry);ctx.lineTo(bx,by-ry);ctx.bezierCurveTo(bx+rx*.56,by-ry,bx+rx,by-ry*.45,bx+rx,by);ctx.lineTo(g.right,by+10);ctx.lineTo(g.left,cy+10);ctx.closePath();ctx.fill();
  // Both perforations and the paper edge use the same sloping plane. The
  // sheet deliberately continues beyond the screen, as in the reference.
  ctx.beginPath();ctx.moveTo(g.left,g.sheetTop);ctx.lineTo(g.right,g.sheetTop+slant);ctx.bezierCurveTo(g.right+sway,bottom-90,g.right+sway,bottom-30,g.right+sway,bottom);ctx.lineTo(g.left+sway,bottom);ctx.bezierCurveTo(g.left+sway,bottom-30,g.left+sway,bottom-90,g.left,g.sheetTop);ctx.closePath();ctx.fill();
  ctx.save();ctx.clip();ctx.strokeStyle='#969696';ctx.lineWidth=.8;ctx.setLineDash([1.5,3.5]);
  const spacing=156,offset=((phase%spacing)+spacing)%spacing;
  for(let y=g.sheetTop-spacing+offset;y<bottom+spacing;y+=spacing){ctx.beginPath();ctx.moveTo(g.left-3,y);ctx.lineTo(g.right+4,y+slant);ctx.stroke();}
  ctx.restore();
  // Large gray front face, a clean black cardboard opening, no end cap or
  // unrelated stripes. This flat silhouette supplies the apparent 3D volume.
  ctx.fillStyle='#d9d9d9';ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#000';ctx.beginPath();ctx.ellipse(cx,cy,g.coreRadius,g.coreRadius,0,0,Math.PI*2);ctx.fill();
  return g;
}
function PaperCanvas({cfg,lengthRef,phaseRef,angleRef,velocityRef,dragRef,unwoundRef,cycleRef,onRollEmpty,onRollComplete}){
  const canvasRef=useRef(null),frameRef=useRef(0),lastRef=useRef(0);
  useEffect(()=>{
    const canvas=canvasRef.current,ctx=canvas.getContext('2d');let width=390,height=598,scale=1,ox=0,oy=0;
    const resize=()=>{const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);width=Math.max(1,r.width);height=Math.max(1,r.height);scale=Math.min(width/390,height/598);ox=(width-390*scale)/2;oy=(height-598*scale)/2;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);};
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
    const draw=time=>{
      frameRef.current=requestAnimationFrame(draw);const dt=Math.min(Math.max(time-(lastRef.current||time),0),64);lastRef.current=time;if(document.hidden)return;
      const preview=!feedSession.active,drag=dragRef.current,cycle=cycleRef.current;
      if(!preview&&cycle.stage==='ready'){
        if(!drag.active){const coast=advancePaperMomentum(velocityRef.current,dt);velocityRef.current=coast.velocity;unwindPaper(coast.distance,cfg,lengthRef,phaseRef,unwoundRef);}
        if(unwoundRef.current>=ROLL_PAPER_SUPPLY)onRollEmpty();
      }
      if(!preview&&advanceRollCycle(cycle,dt))onRollComplete();
      angleRef.current=phaseRef.current/rollGeometry(cfg,unwoundRef.current).rx;
      ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);ctx.save();ctx.translate(ox,oy);ctx.scale(scale,scale);
      const demoPhase=preview&&!reducedMotionQuery.matches?Math.sin(time*.001)*7:0;
      const sway=reducedMotionQuery.matches?0:Math.min(2,Math.abs(velocityRef.current)*.45);
      const bottom=(height-oy)/scale+80;
      let g;
      if(cycle.stage==='ready')g=paintPaperRoll(ctx,cfg,phaseRef.current+demoPhase,sway,bottom,unwoundRef.current);
      else{
        const pose=rollCyclePose(cycle.elapsed,(height-oy)/scale,reducedMotionQuery.matches);
        if(pose.showOld){ctx.save();ctx.globalAlpha=pose.oldAlpha;ctx.translate(138,298+pose.oldY);ctx.rotate(pose.oldAngle);ctx.translate(-138,-298);paintPaperRoll(ctx,cfg,cycle.oldPhase,0,bottom,cycle.oldUnwound);ctx.restore();}
        if(pose.showNew){ctx.save();ctx.globalAlpha=pose.newAlpha;ctx.translate(0,pose.newY);paintPaperRoll(ctx,cfg,0,0,bottom,0);ctx.restore();}
        g=rollGeometry(cfg,pose.showNew?0:cycle.oldUnwound);
      }
      ctx.restore();canvas.dataset.paperLeft=g.left.toFixed(2);canvas.dataset.paperRight=g.right.toFixed(2);canvas.dataset.paperTop=g.sheetTop;canvas.dataset.phase=phaseRef.current.toFixed(1);canvas.dataset.paperLength=lengthRef.current.toFixed(1);canvas.dataset.rollDiameter=(g.rx*2).toFixed(2);canvas.dataset.unwound=unwoundRef.current.toFixed(1);canvas.dataset.rollStage=cycle.stage;canvas.dataset.cycleElapsed=cycle.elapsed.toFixed(0);canvas.dataset.coastVelocity=velocityRef.current.toFixed(4);canvas.dataset.coasting=String(!preview&&!drag.active&&cycle.stage==='ready'&&velocityRef.current>0);
    };frameRef.current=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(frameRef.current);observer.disconnect();};
  },[cfg,lengthRef,phaseRef,angleRef,velocityRef,dragRef,unwoundRef,cycleRef,onRollEmpty,onRollComplete]);
  return <canvas ref={canvasRef} className="paper-canvas" aria-label="Perspective paper roll with a hanging perforated sheet"/>;
}

function App() {
  const [cfg, setCfg] = useState(FALLBACK_CFG);
  const [count, setCount] = useState(0);
  const [hintVisible, setHintVisible] = useState(true);
  const [dragging, setDragging] = useState(false);
  const lengthRef = useRef(FALLBACK_CFG.INITIAL_PAPER_LENGTH);
  const phaseRef = useRef(0);
  const unwoundRef = useRef(0);
  const cycleRef = useRef({stage:'ready',elapsed:0,oldUnwound:0,oldPhase:0});
  const gestureRef = useRef(null);
  const angleRef = useRef(0);
  const velocityRef = useRef(0);
  const dragRef = useRef({ active: false, pointerId: null, lastY: 0, lastTime: 0, total: 0, valid: false });
  const active=useFeedActive();
  useEffect(()=>{if(!active){dragRef.current.active=false;dragRef.current.pointerId=null;velocityRef.current=0;setDragging(false);}},[active]);
  const countRef = useRef(0);
  const hintRef = useRef(true);
  const audioRef = useRef({ ctx: null, master: null, buffer: null, loadPromise: null, sources: new Set() });

  useEffect(() => {
    let mounted = true;
    fetch('./game.config.json')
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (mounted && json) setCfg(inflateConfig(json));
      })
      .catch(() => {
        // Fallback values keep the toy playable when configuration is unavailable.
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    lengthRef.current = cfg.INITIAL_PAPER_LENGTH;
    if (typeof window !== 'undefined') {
      window.__audioDegraded = ['paper_friction', 'roll_sound'];
      window.__audioLog = window.__audioLog || [];
      window.__paperGame = {
        getState: () => ({
          count: countRef.current,
          paperLength: lengthRef.current,
          phase: phaseRef.current,
          unwoundLength: unwoundRef.current,
          rollDiameter: rollGeometry(cfg,unwoundRef.current).rx*2,
          rollStage: cycleRef.current.stage,
          dragging: dragRef.current.active,
          hintVisible: hintRef.current
        })
      };
    }
    return () => {
      if (typeof window !== 'undefined') delete window.__paperGame;
    };
  }, [cfg]);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      audio.sources.forEach((source) => {
        try { source.stop(); } catch (error) { /* already stopped */ }
      });
      audio.sources.clear();
      if (audio.ctx) audio.ctx.close().catch(() => {});
    };
  }, []);

  const ensureAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return audio;
      try {
        audio.ctx = new AudioContextClass();
        audio.master = audio.ctx.createGain();
        audio.master.gain.value = 0.28;
        audio.master.connect(audio.ctx.destination);
        audio.ctx.resume().catch(() => {});
      } catch (error) {
        audio.ctx = null;
      }
    } else if (audio.ctx.state === 'suspended') {
      audio.ctx.resume().catch(() => {});
    }
    if (!audio.loadPromise && audio.ctx) {
      const contextAtLoad = audio.ctx;
      audio.loadPromise = fetch('./assets/sfx_reset.mp3')
        .then((response) => response.arrayBuffer())
        .then((arrayBuffer) => contextAtLoad.decodeAudioData(arrayBuffer))
        .then((buffer) => { audio.buffer = buffer; return buffer; })
        .catch(() => null);
    }
    return audio;
  }, []);

  const fallbackResetBeep = useCallback(() => {
    const audio = audioRef.current;
    if (!audio.ctx || !audio.master) return;
    try {
      const now = audio.ctx.currentTime;
      const oscillator = audio.ctx.createOscillator();
      const gain = audio.ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(620, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      oscillator.connect(gain);
      gain.connect(audio.master);
      oscillator.start(now);
      oscillator.stop(now + 0.14);
      if (typeof window !== 'undefined') window.__audioLog.push({ type: 'beep', event: 'reset' });
    } catch (error) {
      // Audio is optional and never blocks the interaction.
    }
  }, []);

  const playResetSound = useCallback(() => {
    const audio = ensureAudio();
    const playBuffer = () => {
      if (!audio.ctx || !audio.master || !audio.buffer || audio.ctx.state !== 'running') {
        fallbackResetBeep();
        return;
      }
      try {
        const source = audio.ctx.createBufferSource();
        source.buffer = audio.buffer;
        source.connect(audio.master);
        audio.sources.add(source);
        source.onended = () => audio.sources.delete(source);
        source.start();
        if (typeof window !== 'undefined') window.__audioLog.push({ type: 'library', event: 'reset', path: './assets/sfx_reset.mp3' });
      } catch (error) {
        fallbackResetBeep();
      }
    };
    if (audio.loadPromise) audio.loadPromise.then(playBuffer);
    else playBuffer();
  }, [ensureAudio, fallbackResetBeep]);

  const onRollEmpty = useCallback(() => {
    if(!beginRollCycle(cycleRef.current,unwoundRef.current,phaseRef.current))return;
    const pointerId=dragRef.current.pointerId,layer=gestureRef.current;
    dragRef.current={active:false,pointerId:null,lastY:0,lastTime:0,total:0,valid:false};velocityRef.current=0;setDragging(false);
    try{if(pointerId!==null&&layer?.hasPointerCapture(pointerId))layer.releasePointerCapture(pointerId);}catch{}
  },[]);

  const onRollComplete = useCallback(() => {
    lengthRef.current=cfg.INITIAL_PAPER_LENGTH;phaseRef.current=0;unwoundRef.current=0;angleRef.current=0;velocityRef.current=0;
    countRef.current+=1;setCount(countRef.current);vibrate('medium');
    try{const audio=ensureAudio();if(audio.ctx?.state==='running'&&audio.master){const ctx=audio.ctx,now=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.setValueAtTime(620,now);osc.frequency.exponentialRampToValueAtTime(880,now+.10);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.08,now+.015);gain.gain.exponentialRampToValueAtTime(.0001,now+.17);osc.connect(gain);gain.connect(audio.master);osc.start(now);osc.stop(now+.18);osc.onended=()=>{osc.disconnect();gain.disconnect();};}}catch{}
  },[cfg.INITIAL_PAPER_LENGTH,ensureAudio]);

  const getScenePoint = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / 390, rect.height / 598);
    return {
      x: (event.clientX - rect.left - (rect.width - 390 * scale) / 2) / scale,
      y: (event.clientY - rect.top - (rect.height - 598 * scale) / 2) / scale
    };
  }, []);

  const handlePointerDown = useCallback((event) => {
    if(!feedSession.active||cycleRef.current.stage!=='ready'||event.isPrimary===false||event.button>0||dragRef.current.active)return;
    const point = getScenePoint(event);
    if(!rollHit(point,cfg,unwoundRef.current))return;
    event.preventDefault();event.stopPropagation();
    try{event.currentTarget.setPointerCapture(event.pointerId);}catch{}
    const now = performance.now();
    dragRef.current = { active: true, pointerId: event.pointerId, lastY: point.y, lastTime: now, lastMotionTime:now, hasVelocity:false, total: 0, valid: false };
    velocityRef.current=0;
    ensureAudio();
    setDragging(true);
  }, [cfg, ensureAudio, getScenePoint]);

  const handlePointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId || cycleRef.current.stage!=='ready') return;
    event.preventDefault();event.stopPropagation();
    const point = getScenePoint(event);
    const now = performance.now();
    const dy = point.y - drag.lastY;
    const elapsed = Math.max(8, now - drag.lastTime);
    drag.lastY = point.y;
    drag.lastTime = now;
    velocityRef.current=samplePullSpeed(velocityRef.current,dy,elapsed,!drag.hasVelocity);
    if(Math.abs(dy)>.5)drag.lastMotionTime=now;
    if(dy<-2)drag.hasVelocity=false;else if(dy>.5)drag.hasVelocity=true;
    if (dy <= 0) {
      return;
    }
    if (!drag.valid) {
      drag.valid = true;
      hintRef.current = false;
      setHintVisible(false);
      vibrate('light');
      console.info('[paper-roll] first valid pull');
    }
    drag.total += dy;
    unwindPaper(dy,cfg,lengthRef,phaseRef,unwoundRef);
    if(unwoundRef.current>=ROLL_PAPER_SUPPLY)onRollEmpty();
  }, [cfg.MAX_PAPER_LENGTH, cfg.RECYCLE_LENGTH, cfg.PHASE_PER_PIXEL, getScenePoint,onRollEmpty]);

  const finishPointer = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    dragRef.current = { active: false, pointerId: null, lastY: 0, lastTime: 0, total: 0, valid: false };
    setDragging(false);
    velocityRef.current=event.type==='pointerup'&&drag.valid?releasePullSpeed(velocityRef.current,performance.now()-(drag.lastMotionTime??drag.lastTime??performance.now())):0;
    try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}catch{}
  }, []);

  const reset = useCallback(() => {
    dragRef.current = { active: false, pointerId: null, lastY: 0, lastTime: 0, total: 0, valid: false };
    lengthRef.current = cfg.INITIAL_PAPER_LENGTH;
    phaseRef.current = 0;
    unwoundRef.current = 0;
    cycleRef.current={stage:'ready',elapsed:0,oldUnwound:0,oldPhase:0};
    angleRef.current = 0;
    velocityRef.current = 0;
    countRef.current = 0;
    hintRef.current = true;
    setCount(0);
    setHintVisible(true);
    setDragging(false);
    playResetSound();
    vibrate('light');
    console.info('[paper-roll] reset');
  }, [cfg.INITIAL_PAPER_LENGTH, playResetSound]);

  return (
    <main className="paper-stage" data-pull-count={count} data-dragging={dragging}>
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

        .paper-stage {
          position: relative;
          width: 100%;
          height: 100%;
          min-height: 0;
          overflow: clip;
          background: #000;
          color: #f4f4f1;
          font-family: var(--font-body);
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
        }
        .paper-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
          cursor: grab;
        }
        .paper-canvas:active { cursor: grabbing; }
        .counter {
          position: absolute;
          z-index: 2;
          top: 25px;
          left: 50%;
          transform: translateX(-50%);
          color: #f3f3ef;
          font: 700 28px/1 var(--font-display);
          letter-spacing: 0.04em;
          pointer-events: none;
        }
        .hint {
          position: absolute;
          z-index: 2;
          top: 108px;
          left: 16px;
          right: 16px;
          text-align: center;
          color: rgba(235, 235, 231, 0.82);
          font: 400 16px/1.25 var(--font-body);
          letter-spacing: 0.01em;
          pointer-events: none;
          animation: hintBreathe 2.6s ease-in-out infinite alternate;
          transform: translateY(0);
        }
        .hint.is-hidden {
          opacity: 0;
          transform: translateY(-7px);
          animation: none;
        }
        @keyframes hintBreathe {
          from { opacity: 0.66; }
          to { opacity: 1; }
        }
        .reset-button {
          position: absolute;
          z-index: 3;
          top: 20px;
          right: 18px;
          width: 42px;
          height: 42px;
          display: grid;
          place-items: center;
          padding: 0;
          border: 1px solid rgba(240,240,236,0.28);
          border-radius: 50%;
          background: rgba(10,10,10,0.78);
          color: #efefeb;
          cursor: pointer;
          touch-action: manipulation;
        }
        .reset-button:active { transform: scale(0.94); }
        .reset-button svg { width: 20px; height: 20px; display: block; }
        .reset-button path { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        @media (prefers-reduced-motion: reduce) {
          .hint { transition: none; }
        }
      `}</style>
      <PaperCanvas
        cfg={cfg}
        lengthRef={lengthRef}
        phaseRef={phaseRef}
        unwoundRef={unwoundRef}
        cycleRef={cycleRef}
        onRollEmpty={onRollEmpty}
        onRollComplete={onRollComplete}
        angleRef={angleRef}
        velocityRef={velocityRef}
        dragRef={dragRef}
      />
      <div className="counter" aria-live="polite">{count}</div>
      <div className={hintVisible ? 'hint' : 'hint is-hidden'}>{cfg.HINT_TEXT}</div>
      <button className="reset-button" type="button" aria-label={cfg.RESET_LABEL} onClick={reset}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 8.5A8 8 0 1 1 6.8 17" />
          <path d="M5 4.8v3.8h3.8" />
        </svg>
      </button>
      <div
        ref={gestureRef}
        className={dragging ? 'gesture-layer is-dragging' : 'gesture-layer'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onLostPointerCapture={finishPointer}
      />
      <style>{`.gesture-layer { position:absolute; inset:0; z-index:1; touch-action:none; } .gesture-layer.is-dragging { cursor: grabbing; } .reset-button { z-index:4; } .counter, .hint { z-index:2; }`}</style>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<><App/><BatchPolish/></>);
