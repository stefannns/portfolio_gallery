import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// Keep startup usable when the host stalls the local config request.
async function loadGameConfig() {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let deadline;
  try {
    const request = fetch('./game.config.json', { signal: controller?.signal }).then(response => {
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

// The feed cover can animate without touching the real game state.
let inFeedCover = window.parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
if (inFeedCover) {
  document.documentElement.dataset.feedCover = 'true';
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    inFeedCover = event.data.active !== true;
    document.documentElement.dataset.feedCover = String(inFeedCover);
  });
}

const css = `
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
html, body, #root { width:100%; height:100%; margin:0; }
.game { width:100%; height:100%; overflow:clip; position:relative; background:#fff; color:#111; font-family:var(--font-body); touch-action:manipulation; user-select:none; }
.stage { position:absolute; inset:0; width:100%; height:100%; touch-action:none; }
.stage svg { width:100%; height:100%; display:block; }
.hint { font-family:var(--font-body); font-size:18px; font-weight:700; fill:#242424; animation:breathe 2.7s ease-in-out infinite; }
@keyframes breathe { 0%,100%{opacity:.72} 50%{opacity:1} }
@media (prefers-reduced-motion: reduce) { .hint {animation:none} }
.level-number { font-family:var(--font-display); font-size:48px; font-weight:700; fill:#fff; text-anchor:middle; dominant-baseline:central; }
.queue-number { font-family:var(--font-display); font-size:12px; font-weight:700; fill:white; text-anchor:middle; dominant-baseline:central; }
.menu-button { position:absolute; top:max(18px, env(safe-area-inset-top, 0px)); right:30px; width:44px; height:44px; border:0; padding:10px; background:transparent; border-radius:50%; color:#111; display:grid; place-items:center; cursor:pointer; }
[data-feed-cover="true"] .menu-button,[data-feed-cover="true"] .level-number,[data-feed-cover="true"] .live-pins{visibility:hidden}
.cover-pins{display:none}
[data-feed-cover="true"] .cover-pins{display:block}
.cover-attached{opacity:0;transform-origin:195px 216px;animation:cover-spin 1.9s linear infinite}
.cover-shot{animation:cover-shot 1.9s linear infinite}
@keyframes cover-spin{0%,27.99%{transform:rotate(0deg);opacity:0}28%{transform:rotate(0deg);opacity:1}92%{transform:rotate(100deg);opacity:1}100%{transform:rotate(112deg);opacity:0}}
@keyframes cover-shot{0%,18%{transform:translateY(0);opacity:1}27.99%{transform:translateY(-77px);opacity:1}28%,100%{transform:translateY(-77px);opacity:0}}
@media(prefers-reduced-motion:reduce){.cover-attached,.cover-shot{animation:none}}
.menu-button:focus-visible,.level-choice:focus-visible,.close:focus-visible { outline:2px solid #666; outline-offset:3px; }
.menu { position:absolute; top:max(65px, env(safe-area-inset-top, 0px)); right:20px; width:min(260px, calc(100% - 40px)); padding:18px; background:#fff; border:1px solid #e5e5e5; box-shadow:0 10px 32px #00000019; border-radius:16px; }
.menu-head { display:flex; justify-content:space-between; align-items:center; font:700 16px var(--font-display); margin-bottom:12px; }
.close { border:0; background:transparent; font:400 24px var(--font-display); line-height:1; cursor:pointer; }
.grid { display:grid; grid-template-columns:repeat(5,1fr); gap:6px; }
.level-choice { width:100%; aspect-ratio:1; border-radius:50%; border:1px solid #e1e1e1; background:#fff; font:700 13px var(--font-display); cursor:pointer; }
.level-choice.current { background:#111; border-color:#111; color:#fff; }
.level-choice:disabled { color:#c5c5c5; border-color:#f1f1f1; cursor:default; }
`;

// Short sounds: launch, attachment, collision, clear, and selection.
if (window.SFX) window.SFX.register({ launch:'./assets/sfx_launch.mp3', attach:'./assets/sfx_attach.mp3', clear:'./assets/sfx_clear.mp3', collision:'./assets/sfx_fail.mp3', select:'./assets/sfx_select.mp3', choose:'./assets/sfx_attach_tick.mp3' });
const play = (key) => { try { if(key==='clear'||key==='collision') window.SFX?.playOnce(key); else window.SFX?.play(key); } catch (_) {} };
const CX=195, CY=216, R=59, OUT=121, START_Y=414, END_Y=CY+OUT;
const defaults = { FLIGHT_MS:120, PAUSE_MS:250, REVERSE_INTERVAL_MS:3500, REVERSE_FROM_LEVEL:7, GUIDE:'Tap to pin the wheel', LEVELS:'Levels' };
const levelSpeeds = [84,88,92,96,101,106,111,116,121,126,131,136,141,146,150];
const levelPinCounts = [6,6,6,6,7,7,7,7,7,7,7,8,8,8,8];

function startingPins(level) {
  const count = Math.floor(level / 2);
  const firstAngle = (220 + level * 47) % 360;
  // Keep a large open arc for the shot queue, even on the busiest wheels.
  return Array.from({length:count}, (_, index) => (firstAngle + index * 22) % 360);
}
function angleDist(a,b) { return Math.abs(((a-b+540)%360)-180); }
function pointSegment(px,py,ax,ay,bx,by) { const dx=bx-ax,dy=by-ay; const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1))); return Math.hypot(px-(ax+t*dx),py-(ay+t*dy)); }
function App() {
  const [cfg,setCfg] = useState(defaults);
  const readyRef=useRef(false), pendingLaunch=useRef(false);
  const [view,setView] = useState({level:1, pinCount:6, remaining:6, pins:[], phase:'idle', angle:0, started:false, unlocked:1, menu:false});
  const state = useRef({...view, angle:0, elapsed:0, flight:0, resultTime:0, launches:0});
  const cfgRef=useRef(defaults), wheelRef=useRef(null), flyRef=useRef(null), frameRef=useRef(0), lastRef=useRef(0), pressRef=useRef(null);
  const sync = () => { const s=state.current; setView({...s, pins:[...s.pins]}); };
  const setup = (level, preserveStarted=true) => {
    const s=state.current, c=cfgRef.current;
    s.level=level; s.pinCount=c[`LEVEL_${level}_PINS`] ?? levelPinCounts[level-1]; s.remaining=s.pinCount; s.pins=startingPins(level);
    s.phase='idle'; s.elapsed=0; s.flight=0; s.resultTime=0; s.menu=false;
    if (!preserveStarted) { s.started=false; s.angle=0; }
    window.SFX?.reset?.(); sync(); console.log('level setup', level, 'pins', s.remaining);
  };
  const launch = () => {
    const s=state.current;
    if(inFeedCover || s.phase!=='idle' || s.menu)return;
    s.started=true;s.phase='flying';s.flight=0;s.launches++;play('launch');sync();console.log('launch',s.level,s.remaining);
  };
  useEffect(() => {
    let live=true;
    loadGameConfig().then(config=>{
      if(!live)return;
      const data=config||{};
      const c={...defaults}; for(const item of [...(data.tweaks||[]),...(data.texts||[])]) c[item.id]=item.value;
      for(const item of data.images||[]) c[item.id]=item.path;
      cfgRef.current=c;
      setCfg(c);
      setup(1,false);
      readyRef.current=true;
      if(pendingLaunch.current){
        pendingLaunch.current=false;
        launch();
      }
    });
    try { state.current.unlocked=Math.max(1, Math.min(15,Number(localStorage.getItem('pin-wheel-unlocked'))||1)); } catch(_) {}
    return ()=>{live=false};
  },[]);
  useEffect(() => {
    const tick = (t) => {
      const s=state.current, c=cfgRef.current;
      let dt=lastRef.current ? t-lastRef.current : 0; lastRef.current=t;
      if(dt>100) dt=16; dt=Math.min(dt,32);
      if(document.hidden || s.menu || inFeedCover) dt=0;
      s.elapsed+=dt;
      // Keep turning through the brief clear or retry feedback.
      const dir=s.level>=c.REVERSE_FROM_LEVEL && Math.floor(s.elapsed/c.REVERSE_INTERVAL_MS)%2 ? -1 : 1;
      const angularSpeed=dir*(c[`LEVEL_${s.level}_SPEED`]??levelSpeeds[s.level-1]);
      const flightMs=c.FLIGHT_MS || defaults.FLIGHT_MS;
      s.angle=(s.angle + angularSpeed*dt/1000 + 360)%360;
      if(wheelRef.current) wheelRef.current.setAttribute('transform',`rotate(${s.angle} ${CX} ${CY})`);
      if(s.phase==='idle' || s.phase==='flying') {
        if(s.phase==='flying') {
          const prev=s.flight; s.flight=Math.min(flightMs,s.flight+dt);
          const y=START_Y+(END_Y-START_Y)*s.flight/flightMs;
          if(flyRef.current) flyRef.current.setAttribute('transform',`translate(0 ${y-START_Y})`);
          // Sample every 4ms across the swept segment, including the final landing frame.
          let hit=false, impactY=y, impactX=CX;
          for(let u=prev;u<=s.flight+0.01;u+=4) {
            const sampleY=START_Y+(END_Y-START_Y)*Math.min(u,s.flight)/flightMs;
            const sampleAngle=s.angle-angularSpeed*(s.flight-u)/1000;
            for(const a of s.pins) {
              const rad=(a+sampleAngle)*Math.PI/180;
              const x=CX+Math.cos(rad)*OUT, py=CY+Math.sin(rad)*OUT;
              // Needle ball versus the entire moving vertical shaft, plus the shaft near its root.
              const nearY=Math.max(sampleY-62,Math.min(sampleY,py));
              if(Math.hypot(x-CX,py-nearY)<14) {hit=true;impactY=sampleY;impactX=x;break;}
              const ax=CX+Math.cos(rad)*R, ay=CY+Math.sin(rad)*R;
              const bx=CX+Math.cos(rad)*OUT, by=CY+Math.sin(rad)*OUT;
              // Also test the moving ball against the stationary shaft, and both shaft endpoints.
              if(pointSegment(CX,sampleY,ax,ay,bx,by)<13 || pointSegment(ax,ay,CX,sampleY-62,CX,sampleY)<2.5 || pointSegment(CX,sampleY-62,ax,ay,bx,by)<2.5) {hit=true;impactY=sampleY;impactX=bx;break;}
              if(Math.abs(bx-ax)>0.0001) {
                const k=(CX-ax)/(bx-ax), iy=ay+k*(by-ay);
                if(k>=0&&k<=1&&iy>=sampleY-62&&iy<=sampleY) {hit=true;impactY=sampleY;impactX=bx;break;}
              }
            }
            if(hit) break;
          }
          // Include the exact landing endpoint even if the sampling step doesn't divide dt.
          if(!hit && s.flight >= flightMs) {
            hit=s.pins.some(a=>angleDist((a+s.angle+360)%360,90)<13);
          }
          if(hit) {
            s.phase='collision';s.resultTime=0;s.impactY=impactY;
            s.reboundDir=Math.abs(impactX-CX)>1?(impactX>CX?-1:1):(angularSpeed>0?1:-1);
            if(flyRef.current) flyRef.current.setAttribute('transform',`translate(0 ${impactY-START_Y})`);
            play('collision');sync();console.log('collision',s.level);
          }
          else if(s.flight >= flightMs) {
            s.pins.push((90-s.angle+360)%360);s.remaining--;
            if(s.remaining===0) {
              s.phase='clear'; s.resultTime=0; play('clear');
              s.unlocked=Math.max(s.unlocked,Math.min(15,s.level+1));
              try {localStorage.setItem('pin-wheel-unlocked',String(s.unlocked));}catch(_){}
              console.log('level clear',s.level,'unlocked',s.unlocked);
            } else {s.phase='idle';play('attach');console.log('attach',s.level,s.remaining);}
            sync();
          }
        }
      } else if(s.phase==='collision' || s.phase==='clear') {
        s.resultTime+=dt;
        if(s.phase==='collision' && flyRef.current) {
          // A short recoil gives way to gravity: the failed pin tumbles off the wheel.
          const t=s.resultTime/1000, x=s.reboundDir*(70*t+90*t*t);
          const y=s.impactY+75*t+620*t*t, rotation=s.reboundDir*Math.min(110,200*t);
          flyRef.current.setAttribute('transform',`translate(${x} ${y-START_Y}) rotate(${rotation} ${CX} ${START_Y})`);
        }
        const pause=s.phase==='collision'?700:(c.PAUSE_MS??defaults.PAUSE_MS);
        if(s.resultTime >= pause) {
          if(s.phase==='collision') setup(s.level);
          else setup(s.level<15?s.level+1:15);
        }
      }
      frameRef.current=requestAnimationFrame(tick);
    };
    frameRef.current=requestAnimationFrame(tick);
    const visibility=()=>{lastRef.current=0;};document.addEventListener('visibilitychange',visibility);
    return ()=>{cancelAnimationFrame(frameRef.current);document.removeEventListener('visibilitychange',visibility);};
  },[]);
  const down=(e)=>{
    if(inFeedCover || e.isPrimary===false || e.button>0 || pressRef.current!==null) return;
    pressRef.current=e.pointerId;
    try{e.currentTarget.setPointerCapture(e.pointerId)}catch(_){}
    if(!readyRef.current){pendingLaunch.current=true;return;}
    launch();
  };
  const cancel=e=>{if(pressRef.current===e.pointerId)pressRef.current=null;};
  const up=cancel;
  const toggle=()=>{if(!readyRef.current)return;const s=state.current; if(s.phase==='flying'||s.phase==='clear'||s.phase==='collision')return; s.menu=!s.menu; play('select');sync();};
  const choose=(n)=>{if(n>state.current.unlocked)return;play('choose');setup(n);};
  const nextPin=view.pinCount-view.remaining+1;
  const queueGap=Math.min(27,124/Math.max(1,view.pinCount-1));
  const queueRadius=Math.min(10,queueGap*.43);
  return <div className="game" data-testid="game" data-level={view.level} data-remaining={view.remaining} data-phase={view.phase} data-pins={JSON.stringify(view.pins)} data-launches={view.launches||0} data-unlocked={view.unlocked}>
    <style>{css}</style>
    <div className="stage" data-testid="stage" onPointerDown={down} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      <svg viewBox="0 0 390 598" preserveAspectRatio="xMidYMid meet" aria-label="Pin the wheel">
        <rect width="390" height="598" fill={view.phase==='collision'?'#f9e5e4':view.phase==='clear'?'#e3f5e9':'#fff'}/>
        {!view.started && <text className="hint" x="195" y="72" textAnchor="middle">{cfg.GUIDE}</text>}
        <g className="cover-pins" aria-hidden="true">
          <g className="cover-attached">
            <line x1={CX} x2={CX} y1={CY+R} y2={END_Y} stroke="#101010" strokeWidth="2.4"/><circle cx={CX} cy={END_Y} r="10" fill="#101010"/>
          </g>
          <g className="cover-shot"><line x1={CX} x2={CX} y1={START_Y-62} y2={START_Y} stroke="#101010" strokeWidth="2.4"/><circle cx={CX} cy={START_Y} r="10" fill="#101010"/><text className="queue-number" x={CX} y={START_Y+1}>1</text></g>
        </g>
        <g className="live-pins" ref={wheelRef} data-testid="wheel" transform={`rotate(${view.angle} ${CX} ${CY})`}>
          {view.pins.map((a,i)=>{const r=a*Math.PI/180;return <g key={i}><line x1={CX+Math.cos(r)*R} y1={CY+Math.sin(r)*R} x2={CX+Math.cos(r)*OUT} y2={CY+Math.sin(r)*OUT} stroke="#101010" strokeWidth="2.4"/><circle cx={CX+Math.cos(r)*OUT} cy={CY+Math.sin(r)*OUT} r="9" fill="#101010"/></g>})}
        </g>
        <circle cx={CX} cy={CY} r={R} fill="#101010"/>
        <text x={CX} y={CY+1} className="level-number">{view.level}</text>
        {(view.phase==='flying'||view.phase==='collision') && <g ref={flyRef} data-testid="flying"><line x1={CX} y1={START_Y-62} x2={CX} y2={START_Y} stroke="#101010" strokeWidth="2.4"/><circle cx={CX} cy={START_Y} r="12" fill="#101010"/><text className="queue-number" x={CX} y={START_Y+1}>{nextPin}</text></g>}
        {Array.from({length:Math.max(0,view.remaining-((view.phase==='flying'||view.phase==='collision')?1:0))},(_,i)=>{
          const index=i+((view.phase==='flying'||view.phase==='collision')?1:0);
          const num=nextPin+index;
          const y=START_Y+index*queueGap;
          return <g className="live-pins" key={num}><line x1={CX} y1={y-Math.min(18,queueGap-queueRadius)} x2={CX} y2={y-queueRadius} stroke="#101010" strokeWidth="2"/><circle cx={CX} cy={y} r={queueRadius} fill="#101010"/><text className="queue-number" style={{fontSize:Math.min(12,queueRadius*1.35)}} x={CX} y={y+1}>{num}</text></g>
        })}
      </svg>
    </div>
    <button className="menu-button" aria-label={cfg.LEVELS} data-testid="levels-button" onClick={toggle}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h2M10 6h10M4 12h2M10 12h10M4 18h2M10 18h10"/></svg></button>
    {view.menu && <div className="menu" data-testid="menu"><div className="menu-head"><span>{cfg.LEVELS}</span><button className="close" aria-label="Close" onClick={toggle}>×</button></div><div className="grid">{Array.from({length:15},(_,i)=><button className={`level-choice ${view.level===i+1?'current':''}`} key={i} disabled={i+1>view.unlocked} onClick={()=>choose(i+1)}>{i+1}</button>)}</div></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);
