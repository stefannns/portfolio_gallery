import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// Orbit Switch — editable recreation from the supplied 26.8-second recording.
// All artwork is intentionally flat geometry, as in the reference.
const TAU = Math.PI * 2;
const DEFAULTS = {
  speed: 1.72,
  guide: 'Tap to switch sides',
  high: 'High score:',
  lost: 'YOU LOST',
  replay: 'Tap to start'
};
const CSS = `
html,body,#root {margin:0;width:100%;height:100%;overflow:hidden;background:#efda96}
*{box-sizing:border-box} body{-webkit-tap-highlight-color:transparent}
.orbit-game{position:relative;width:100%;height:100%;overflow:hidden;user-select:none;font-family:Arial,Helvetica,sans-serif;color:#111;touch-action:manipulation}
.orbit-game canvas{display:block;width:100%;height:100%;touch-action:none}
.score{position:absolute;top:30px;right:30px;font-size:28px;font-weight:400;line-height:1;pointer-events:none;font-variant-numeric:tabular-nums}
.guide{position:absolute;left:30px;right:30px;top:39%;margin:0;text-align:center;font-size:18px;line-height:1.4;color:#111;pointer-events:none;animation:breathe 2.4s ease-in-out infinite}
.result{position:absolute;left:30px;right:30px;top:50%;transform:translateY(-50%);text-align:center;pointer-events:none;animation:reveal .45s ease-out both}
.high{font-size:18px;line-height:1.4;letter-spacing:.3px;margin:0 0 25px}
.lost{font-size:13px;letter-spacing:.5px;margin:0 0 24px;animation:reveal .5s .3s both}
.replay{font:400 18px/1.4 Arial,Helvetica,sans-serif;color:#111;border:0;background:transparent;padding:10px 18px;pointer-events:auto;cursor:pointer;animation:breathe 2.4s ease-in-out infinite}
@keyframes breathe{0%,100%{opacity:1}50%{opacity:.56}} @keyframes reveal{from{opacity:0}to{opacity:1}}
.orbit-game[data-paused=true] .guide{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.guide,.replay,.result,.lost{animation:none}}
`;
const normalize = a => ((a % TAU) + TAU) % TAU;
const angleDistance = (a,b) => Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
function readBest() { try { return Number(localStorage.getItem('orbit-switch-best')) || 0; } catch { return 0; } }
function makeRound(best, round = 0) {
  const pins = round % 2 ? [0,.78,1.84] : [-1.12,.82,2.88];
  return { phase:'waiting', angle:-Math.PI/2, lane:1, radiusLane:1, score:0, best,
    pins, target:{angle:2.62,lane:-1}, trail:[], particles:[], waves:[], age:0, deathAge:0,
    switches:0, hits:0, round, active:false, bg:[239,218,150], targetBg:[239,218,150] };
}
function App() {
  const canvasRef = useRef(null);
  const gameRef = useRef(makeRound(readBest()));
  const audioRef = useRef(null);
  const [view,setView] = useState({phase:'waiting',score:0,best:readBest(),paused:false});
  const [config,setConfig] = useState(DEFAULTS);
  const configRef = useRef(DEFAULTS);
  const feedMode = new URLSearchParams(location.search).has('feedReview');
  const enabledRef = useRef(!feedMode);
  const reduced = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false);
  function sync() {
    const g=gameRef.current;
    setView({phase:g.phase,score:g.score,best:g.best,paused:!enabledRef.current});
  }
  function sound(kind) {
    try {
      const AC=window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioRef.current) audioRef.current=new AC();
      const ac=audioRef.current;
      if(ac.state==='suspended') ac.resume().catch(()=>{});
      const osc=ac.createOscillator(), gain=ac.createGain(), now=ac.currentTime;
      osc.type=kind==='loss'?'triangle':'sine';
      osc.frequency.setValueAtTime(kind==='hit'?720:kind==='loss'?170:320,now);
      osc.frequency.exponentialRampToValueAtTime(kind==='hit'?1100:kind==='loss'?65:210,now+.12);
      gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(kind==='loss'?.09:.055,now+.008);
      gain.gain.exponentialRampToValueAtTime(.0001,now+.18);
      osc.connect(gain);gain.connect(ac.destination);osc.start();osc.stop(now+.2);
    } catch { /* Audio denial never blocks play. */ }
  }
  function action() {
    if (!enabledRef.current || document.hidden) return;
    let g=gameRef.current;
    if(g.phase==='lost') {
      if(g.deathAge<.55) return;
      gameRef.current=makeRound(g.best,g.round+1);g=gameRef.current;
    }
    if(g.phase==='waiting') {g.phase='playing';g.active=true;sound('switch');}
    else {g.lane*=-1;g.switches++;sound('switch');}
    sync();
  }
  useEffect(()=>{
    const style=document.createElement('style');style.textContent=CSS;document.head.append(style);
    document.documentElement.lang='en';
    const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),1500);
    fetch('./game.config.json',{signal:abort.signal}).then(r=>r.ok?r.json():null).then(data=>{
      if(!data)return;const next={...DEFAULTS};
      for(const item of data.texts || []) if(['guide','high','lost','replay'].includes(item.id)) next[item.id]=item.value || DEFAULTS[item.id];
      const speed=(data.tweaks || []).find(t=>t.id==='speed');if(speed) next.speed=Math.max(.8,Math.min(3,Number(speed.value)||DEFAULTS.speed));
      configRef.current=next;setConfig(next);
    }).catch(()=>{}).finally(()=>clearTimeout(timer));
    const onHost=e=>{
      if(e.source!==window.parent || e.origin!==location.origin)return;
      if(e.data?.type!=='playable-active')return;
      enabledRef.current=Boolean(e.data.active);
      if(!enabledRef.current) audioRef.current?.suspend().catch(()=>{});
      sync();
    };
    const onVisibility=()=>{if(document.hidden)audioRef.current?.suspend().catch(()=>{});};
    const onKey=e=>{if(e.code==='Space' || e.code==='Enter'){e.preventDefault();if(!e.repeat)action();}};
    window.addEventListener('message',onHost);document.addEventListener('visibilitychange',onVisibility);window.addEventListener('keydown',onKey);
    return()=>{abort.abort();clearTimeout(timer);style.remove();window.removeEventListener('message',onHost);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('keydown',onKey);audioRef.current?.close().catch(()=>{});};
  },[]);
  useEffect(()=>{
    const canvas=canvasRef.current, ctx=canvas.getContext('2d');
    let raf=0,last=performance.now(),w=390,h=598;
    function size(){const rect=canvas.getBoundingClientRect();w=rect.width||390;h=rect.height||598;const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}
    size();const observer=typeof ResizeObserver==='function'?new ResizeObserver(size):null;observer?.observe(canvas);window.addEventListener('resize',size);
    function burst(angle,lane,count=18) {
      const g=gameRef.current;for(let i=0;i<count;i++)g.particles.push({angle,lane,dx:0,dy:0,vx:(Math.random()-.5)*110,vy:(Math.random()-.5)*110,life:.6,max:.6,size:1+Math.random()*2.6});
    }
    function lose(){const g=gameRef.current;g.phase='lost';g.deathAge=0;g.best=Math.max(g.best,g.score);g.targetBg=[190,154,147];burst(g.angle,g.radiusLane,30);g.waves.push({age:0});try{localStorage.setItem('orbit-switch-best',String(g.best));}catch{}sound('loss');sync();}
    function hit(){const g=gameRef.current;burst(g.target.angle,g.target.lane);g.score++;g.hits++;g.waves.push({age:0});
      // Seeded-looking random next targets, spaced away from the ball and pins.
      let next=g.angle+1.35+Math.random()*1.55;const lane=Math.random()<.5?-1:1;
      for(let i=0;i<12 && g.pins.some(p=>angleDistance(next,p)<.3);i++)next+=.32;
      g.target={angle:normalize(next),lane};
      g.targetBg=g.score<5?[239,218,150]:g.score<10?[203,173,152]:[212,157,129];sound('hit');sync();
    }
    function update(dt){const g=gameRef.current;
      if(g.phase==='playing') {
        g.age+=dt;const speed=configRef.current.speed*(1+Math.min(g.score,20)*.015);
        const before=g.angle;g.angle=normalize(g.angle+dt*speed);g.radiusLane+=(g.lane-g.radiusLane)*Math.min(1,dt*32);
        // Swept angular collision avoids tunneling even when a frame is late.
        const crosses=(a,margin)=>normalize(a-before)<=dt*speed+margin || angleDistance(g.angle,a)<margin;
        if(g.radiusLane<-.48 && g.pins.some(p=>crosses(p,.073)))lose();
        else if(g.lane===g.target.lane && Math.abs(g.radiusLane-g.target.lane)<.35 && crosses(g.target.angle,.065))hit();
        // Missing a pickup is allowed; only touching a black inner pin ends play.
      } else if(g.phase==='lost')g.deathAge+=dt;
      if(g.phase!=='lost' && !reduced.current){g.trail.push({angle:g.phase==='waiting'?-Math.PI/2+Math.sin(g.age)*.07:g.angle,lane:g.radiusLane,life:.2});if(g.trail.length>18)g.trail.shift();}
      if(g.phase==='waiting')g.age+=dt;
      g.trail.forEach(t=>t.life-=dt);g.trail=g.trail.filter(t=>t.life>0);
      g.particles.forEach(p=>{p.life-=dt;p.dx+=p.vx*dt;p.dy+=p.vy*dt;});g.particles=g.particles.filter(p=>p.life>0);
      g.waves.forEach(p=>p.age+=dt);g.waves=g.waves.filter(p=>p.age<.65);
      g.bg=g.bg.map((c,i)=>c+(g.targetBg[i]-c)*Math.min(1,dt*3));
    }
    function paint(){const g=gameRef.current, scale=Math.min(w/390,h/598), cx=w/2,cy=h/2;
      const r=Math.min(w*.335,h*.26), line=5*scale, gap=11*scale, ball=5.6*scale;
      ctx.fillStyle=`rgb(${g.bg.map(Math.round).join(',')})`;ctx.fillRect(0,0,w,h);
      ctx.strokeStyle='#080807';ctx.lineWidth=line;ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.stroke();
      g.pins.forEach(a=>{ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*(r-line/2),cy+Math.sin(a)*(r-line/2));ctx.lineTo(cx+Math.cos(a)*(r-18*scale),cy+Math.sin(a)*(r-18*scale));ctx.stroke();});
      const tr=r+g.target.lane*gap;
      ctx.save();ctx.translate(cx+Math.cos(g.target.angle)*tr,cy+Math.sin(g.target.angle)*tr);ctx.rotate(g.target.angle+Math.PI/2);ctx.fillStyle='#fff';ctx.fillRect(-3.6*scale,-3.6*scale,7.2*scale,7.2*scale);ctx.restore();
      g.waves.forEach(p=>{ctx.strokeStyle=`rgba(255,255,255,${(1-p.age/.65)*.46})`;ctx.lineWidth=1.3*scale;ctx.beginPath();ctx.arc(cx,cy,r*(.1+p.age*2.7),0,TAU);ctx.stroke();});
      g.trail.forEach(t=>{const rr=r+t.lane*gap;ctx.fillStyle=`rgba(255,255,255,${t.life*.9})`;ctx.beginPath();ctx.arc(cx+Math.cos(t.angle)*rr,cy+Math.sin(t.angle)*rr,ball*.48,0,TAU);ctx.fill();});
      g.particles.forEach(p=>{const rr=r+p.lane*gap;ctx.fillStyle=`rgba(255,255,255,${p.life/p.max})`;ctx.beginPath();ctx.arc(cx+Math.cos(p.angle)*rr+p.dx*scale,cy+Math.sin(p.angle)*rr+p.dy*scale,p.size*scale,0,TAU);ctx.fill();});
      if(g.phase!=='lost' || g.deathAge<.35){const a=g.phase==='waiting'?-Math.PI/2+Math.sin(g.age)*.05:g.angle,rr=r+g.radiusLane*gap;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr,ball,0,TAU);ctx.fill();}
      canvas.dataset.phase=g.phase;canvas.dataset.lane=String(g.lane);canvas.dataset.angle=String(g.angle);canvas.dataset.score=String(g.score);canvas.dataset.switches=String(g.switches);canvas.dataset.targetAngle=String(g.target.angle);canvas.dataset.targetLane=String(g.target.lane);canvas.dataset.pins=JSON.stringify(g.pins);canvas.dataset.enabled=String(enabledRef.current);
    }
    function frame(now){const dt=Math.min((now-last)/1000,.035);last=now;if(!document.hidden){if(enabledRef.current || gameRef.current.phase==='waiting')update(dt);paint();}raf=requestAnimationFrame(frame);}
    raf=requestAnimationFrame(frame);return()=>{cancelAnimationFrame(raf);observer?.disconnect();window.removeEventListener('resize',size);};
  },[]);
  return <main className="orbit-game" data-paused={view.paused} aria-label="Orbit Switch game" onPointerDown={e=>{if(e.isPrimary!==false && e.button===0){e.preventDefault();action();}}}>
    <canvas ref={canvasRef} aria-label="Circular track: tap to change between inside and outside" />
    <div className="score" aria-label="Score">{view.score}</div>
    {view.phase==='waiting' && <p className="guide">{config.guide}</p>}
    {view.phase==='lost' && <section className="result" aria-label="Game over"><p className="high">{config.high} {view.best}</p><p className="lost">{config.lost}</p><button className="replay" onPointerDown={e=>{e.stopPropagation();e.preventDefault();action();}}>{config.replay}</button></section>}
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
