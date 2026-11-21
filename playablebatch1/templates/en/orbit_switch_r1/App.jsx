/* Bundled DynaPuff font notice (kept out of runtime assets).
Copyright 2021 The DynaPuff Project Authors (https://github.com/googlefonts/dynapuff)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.

*/
import React, { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// Orbit Switch — editable recreation from the supplied 26.8-second recording.
// All artwork is intentionally flat geometry, as in the reference.
const TAU = Math.PI * 2;
const PICKUP_SIZE = 14, BALL_RADIUS = 8;
const SPIKE_MOTION_SCORE = 7, OUTER_SPIKE_SCORES = [10,15,20];
const OUTER_WARNING_SECONDS = 1.6;
const smooth = n => {const t=Math.max(0,Math.min(1,n));return t*t*(3-2*t);};
// Capture the host before React effects register, including the first activation.
const inFeed=new URLSearchParams(location.search).has('feedReview');
let initialHostActive=!inFeed;
function captureInitialHostState(event){if(event.source===window.parent&&event.origin===location.origin&&event.data?.type==='playable-active')initialHostActive=event.data.active===true;}
window.addEventListener('message',captureInitialHostState);

const DEFAULTS = {
  speed: 1.72,
  guide: 'Tap to switch sides',
  lost: 'Run over',
  replay: 'Play again'
};
const CSS = `
@font-face{font-family:OrbitPuff;src:url('./assets/fonts/DynaPuff-SemiBold.woff2') format('woff2');font-weight:600;font-style:normal;font-display:swap}
html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#efda96}
*{box-sizing:border-box}body{-webkit-tap-highlight-color:transparent}
.orbit-game{--u:1;position:relative;width:100%;height:100%;overflow:hidden;user-select:none;font-family:OrbitPuff,'Trebuchet MS',sans-serif;font-weight:600;color:#111;touch-action:manipulation}
.orbit-game canvas{display:block;width:100%;height:100%;touch-action:none}
.score{position:absolute;top:calc(30px*var(--u));left:calc(30px*var(--u));right:calc(30px*var(--u));font-size:calc(28px*var(--u));line-height:1.2;text-align:center;pointer-events:none;font-variant-numeric:tabular-nums}
.guide{position:absolute;left:calc(30px*var(--u));right:calc(30px*var(--u));top:50%;transform:translateY(-50%);margin:0;text-align:center;font-size:calc(18px*var(--u));line-height:1.4;overflow-wrap:anywhere;pointer-events:none;animation:breathe 2.4s ease-in-out infinite}
.result{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:calc(30px*var(--u)) calc(30px*var(--u)) calc(50px*var(--u));background:#efda96;text-align:center;animation:reveal .2s ease-out both}
.result-card{display:flex;flex-direction:column;align-items:center;gap:calc(20px*var(--u));width:calc(300px*var(--u));max-width:100%;max-height:100%;overflow-y:auto;padding:calc(6px*var(--u)) calc(6px*var(--u)) calc(10px*var(--u));scrollbar-width:thin}
.lost{margin:0;font-size:calc(24px*var(--u));line-height:1.25;overflow-wrap:anywhere;max-width:100%}
.result-number{display:grid;place-items:center;flex:none;width:calc(144px*var(--u));height:calc(144px*var(--u));max-width:100%;padding:calc(10px*var(--u));border:calc(5px*var(--u)) solid #111;border-radius:50%;background:#fffdf1;color:#111;line-height:1;font-variant-numeric:tabular-nums;box-shadow:calc(4px*var(--u)) calc(5px*var(--u)) 0 #1112}
.result-number span{max-width:100%;overflow-wrap:anywhere}
.replay{font:600 calc(18px*var(--u))/1.4 OrbitPuff,'Trebuchet MS',sans-serif;color:#fffdf1;border:calc(2px*var(--u)) solid #111;border-radius:calc(12px*var(--u));background:#111;min-height:48px;width:100%;max-width:100%;padding:calc(12px*var(--u)) calc(20px*var(--u));box-shadow:0 calc(4px*var(--u)) 0 #1113;cursor:pointer;touch-action:manipulation;white-space:normal;overflow-wrap:anywhere}
.replay:active{transform:translateY(2px);box-shadow:none}.replay:focus-visible{outline:3px solid #7a3db8;outline-offset:4px}
@keyframes breathe{0%,100%{opacity:1}50%{opacity:.56}}@keyframes reveal{from{opacity:0}to{opacity:1}}
.orbit-game[data-paused=true] .guide{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.guide,.result{animation:none}}
`;
const normalize = a => ((a % TAU) + TAU) % TAU;
const angleDistance = (a,b) => Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
// Spikes use the same current angular pose for painting and swept collision.
function innerPinAngle(g,index,time=g.pinMotionAge) {
  return g.pins[index]+.28*smooth(time/1.5)*Math.sin(time*(.82+index*.11)+index*2.1);
}
function outerPinAngles(pins) {
  const chosen=[];
  for(let i=0;i<3;i++){
    let best=0,clearance=-1;
    for(let j=0;j<180;j++){
      const angle=j*TAU/180;
      const gap=Math.min(...pins.concat(chosen).map(other=>angleDistance(angle,other)));
      if(gap>clearance){clearance=gap;best=angle;}
    }
    chosen.push(best);
  }
  return chosen;
}
function sweepsPin(ballBefore,ballStep,pinBefore,pinAfter,margin) {
  const start=Math.atan2(Math.sin(ballBefore-pinBefore),Math.cos(ballBefore-pinBefore));
  const end=start+ballStep-(pinAfter-pinBefore);
  return Math.min(start,end)<=margin && Math.max(start,end)>=-margin;
}
function makeRound(round = 0) {
  const pins = round % 2 ? [0,.78,1.84] : [-1.12,.82,2.88];
  return { phase:'waiting', angle:-Math.PI/2, lane:1, radiusLane:1, score:0,
    pins, pinMotionAge:0, outerPins:outerPinAngles(pins), outerAges:[0,0,0], target:{angle:2.62,lane:-1}, trail:[], particles:[], waves:[], age:0, deathAge:0,
    switches:0, hits:0, round, active:false, bg:[239,218,150], targetBg:[239,218,150] };
}
function App() {
  const canvasRef = useRef(null);
  const gameRef = useRef(makeRound());
  const audioRef = useRef(null);
  const voicesRef=useRef(new Set()),lastSoundRef=useRef({});
  const [view,setView] = useState({phase:'waiting',score:0,paused:false});
  const [config,setConfig] = useState(DEFAULTS);
  const configRef = useRef(DEFAULTS);
  const enabledRef = useRef(initialHostActive);
  const reduced = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false);
  function sync() {
    const g=gameRef.current;
    setView({phase:g.phase,score:g.score,paused:!enabledRef.current||document.hidden});
  }
  function unlockAudio(){
    try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;audioRef.current ||= new AC();if(audioRef.current.state==='suspended')audioRef.current.resume().catch(()=>{});}catch{}
  }
  function stopSounds(){
    for(const voice of voicesRef.current){try{voice.osc.stop();}catch{}voice.osc.disconnect();voice.gain.disconnect();}
    voicesRef.current.clear();lastSoundRef.current={};
  }
  function sound(kind) {
    const ac=audioRef.current;if(!ac||ac.state!=='running'||!enabledRef.current||document.hidden)return;
    const now=ac.currentTime;if(now-(lastSoundRef.current[kind]??-1)<.07)return;lastSoundRef.current[kind]=now;
    try {
      const osc=ac.createOscillator(),gain=ac.createGain(),voice={osc,gain};
      osc.type=kind==='loss'?'triangle':'sine';
      osc.frequency.setValueAtTime(kind==='hit'?720:kind==='loss'?170:320,now);
      osc.frequency.exponentialRampToValueAtTime(kind==='hit'?1100:kind==='loss'?65:210,now+.12);
      gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(kind==='loss'?.22:kind==='hit'?.20:.18,now+.008);
      gain.gain.exponentialRampToValueAtTime(.0001,now+.18);
      osc.connect(gain);gain.connect(ac.destination);voicesRef.current.add(voice);
      osc.onended=()=>{voicesRef.current.delete(voice);osc.disconnect();gain.disconnect();};osc.start(now);osc.stop(now+.2);
    } catch { /* Audio denial never blocks play. */ }
  }
  function action() {
    if (!enabledRef.current || document.hidden) return;
    unlockAudio();let g=gameRef.current;
    if(g.phase==='lost') {
      if(g.deathAge<.55) return;
      gameRef.current=makeRound(g.round+1);g=gameRef.current;
    }
    if(g.phase==='waiting') {g.phase='playing';g.active=true;sound('switch');}
    else {g.lane*=-1;g.switches++;sound('switch');}
    sync();
  }
  useLayoutEffect(()=>{
    const style=document.createElement('style');style.textContent=CSS;document.head.append(style);
    document.documentElement.lang='en';
    window.addEventListener('message',captureInitialHostState);enabledRef.current=initialHostActive;sync();
    const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),1500);
    fetch('./game.config.json',{signal:abort.signal}).then(r=>r.ok?r.json():null).then(data=>{
      if(!data)return;const next={...DEFAULTS};
      for(const item of data.texts || []) if(['guide','lost','replay'].includes(item.id)) next[item.id]=item.value || DEFAULTS[item.id];
      const speed=(data.tweaks || []).find(t=>t.id==='speed');if(speed) next.speed=Math.max(.8,Math.min(3,Number(speed.value)||DEFAULTS.speed));
      configRef.current=next;setConfig(next);
    }).catch(()=>{}).finally(()=>clearTimeout(timer));
    const onHost=e=>{
      if(e.source!==window.parent || e.origin!==location.origin)return;
      if(e.data?.type!=='playable-active')return;
      enabledRef.current=Boolean(e.data.active);
      if(!enabledRef.current){stopSounds();audioRef.current?.suspend().catch(()=>{});}else audioRef.current?.resume().catch(()=>{});
      sync();
    };
    const onVisibility=()=>{if(document.hidden){stopSounds();audioRef.current?.suspend().catch(()=>{});}else if(enabledRef.current)audioRef.current?.resume().catch(()=>{});sync();};
    const onKey=e=>{if(e.target?.closest?.('button'))return;if(e.code==='Space' || e.code==='Enter'){e.preventDefault();if(!e.repeat)action();}};
    window.addEventListener('message',onHost);document.addEventListener('visibilitychange',onVisibility);window.addEventListener('keydown',onKey);
    return()=>{abort.abort();clearTimeout(timer);style.remove();window.removeEventListener('message',onHost);window.removeEventListener('message',captureInitialHostState);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('keydown',onKey);stopSounds();audioRef.current?.close().catch(()=>{});};
  },[]);
  useLayoutEffect(()=>{
    const canvas=canvasRef.current, ctx=canvas.getContext('2d');
    let raf=0,last=performance.now(),w=390,h=598;
    function size(){const rect=canvas.getBoundingClientRect();w=rect.width||390;h=rect.height||598;canvas.parentElement.style.setProperty('--u',String(Math.min(w/390,h/598)));const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);paint();}
    size();const observer=typeof ResizeObserver==='function'?new ResizeObserver(size):null;observer?.observe(canvas);window.addEventListener('resize',size);
    function burst(angle,lane,count=18) {
      const g=gameRef.current;for(let i=0;i<count;i++)g.particles.push({angle,lane,dx:0,dy:0,vx:(Math.random()-.5)*110,vy:(Math.random()-.5)*110,life:.6,max:.6,size:1+Math.random()*2.6});
    }
    function lose(){const g=gameRef.current;g.phase='lost';g.deathAge=0;g.targetBg=[190,154,147];burst(g.angle,g.radiusLane,30);g.waves.push({age:0});sound('loss');sync();}
    function hit(){const g=gameRef.current;burst(g.target.angle,g.target.lane);g.score++;g.hits++;g.waves.push({age:0});
      // Seeded-looking random next targets, spaced away from the ball and pins.
      let next=g.angle+1.35+Math.random()*1.55;const lane=Math.random()<.5?-1:1;
      const hazards=lane<0?g.pins.map((_,i)=>innerPinAngle(g,i)):g.outerPins;
      for(let i=0;i<24 && hazards.some(p=>angleDistance(next,p)<.36);i++)next+=.32;
      g.target={angle:normalize(next),lane};
      g.targetBg=g.score<5?[239,218,150]:g.score<10?[203,173,152]:[212,157,129];sound('hit');sync();
    }
    function update(dt){const g=gameRef.current;
      if(g.phase==='playing') {
        g.age+=dt;const speed=configRef.current.speed*(1+Math.min(g.score,20)*.015);
        const before=g.angle,ballStep=dt*speed,oldMotion=g.pinMotionAge;
        const oldPins=g.pins.map((_,i)=>innerPinAngle(g,i,oldMotion));
        if(g.score>=SPIKE_MOTION_SCORE)g.pinMotionAge+=dt;
        for(let i=0;i<g.outerAges.length;i++)if(g.score>=OUTER_SPIKE_SCORES[i])g.outerAges[i]=Math.min(OUTER_WARNING_SECONDS,g.outerAges[i]+dt);
        g.angle=normalize(g.angle+ballStep);g.radiusLane+=(g.lane-g.radiusLane)*Math.min(1,dt*32);
        // Relative swept motion catches either body crossing the other between frames.
        const innerCollision=g.radiusLane<-.48 && g.pins.some((_,i)=>sweepsPin(before,ballStep,oldPins[i],innerPinAngle(g,i),.073));
        const outerCollision=g.radiusLane>.48 && g.outerPins.some((p,i)=>g.outerAges[i]>=OUTER_WARNING_SECONDS && sweepsPin(before,ballStep,p,p,.073));
        const scale=Math.min(w/390,h/598),r=Math.min(w*.335,h*.26),gap=14*scale;
        const pickupMargin=Math.asin(Math.min(.95,(BALL_RADIUS+PICKUP_SIZE/2+.5)*scale/(r+g.target.lane*gap)));
        const crosses=(a,margin)=>sweepsPin(before,ballStep,a,a,margin);
        if(innerCollision || outerCollision)lose();
        else if(g.lane===g.target.lane && Math.abs(g.radiusLane-g.target.lane)<.35 && crosses(g.target.angle,pickupMargin))hit();
        // Missing a pickup is allowed; only touching a fully emerged red spike ends play.
      } else if(g.phase==='lost')g.deathAge+=dt;
      if(g.phase==='playing' && !reduced.current){g.trail.push({angle:g.angle,lane:g.radiusLane,life:.2});if(g.trail.length>18)g.trail.shift();}
      g.trail.forEach(t=>t.life-=dt);g.trail=g.trail.filter(t=>t.life>0);
      g.particles.forEach(p=>{p.life-=dt;p.dx+=p.vx*dt;p.dy+=p.vy*dt;});g.particles=g.particles.filter(p=>p.life>0);
      g.waves.forEach(p=>p.age+=dt);g.waves=g.waves.filter(p=>p.age<.65);
      g.bg=g.bg.map((c,i)=>c+(g.targetBg[i]-c)*Math.min(1,dt*3));
    }
    function paint(){const g=gameRef.current, scale=Math.min(w/390,h/598), cx=w/2,cy=h/2;
      const r=Math.min(w*.335,h*.26), line=7*scale, gap=14*scale, ball=BALL_RADIUS*scale;
      ctx.fillStyle=`rgb(${g.bg.map(Math.round).join(',')})`;ctx.fillRect(0,0,w,h);
      ctx.strokeStyle='#080807';ctx.lineWidth=line;ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.stroke();
      ctx.fillStyle='#e53935';
      function drawSpike(a,lane,progress=1) {
        const ux=Math.cos(a),uy=Math.sin(a),base=r+lane*line/2,half=6*scale;
        const tip=base+lane*(18*scale-line/2)*smooth(progress);
        ctx.globalAlpha=.2+.8*smooth(progress);
        ctx.beginPath();ctx.moveTo(cx+ux*base-uy*half,cy+uy*base+ux*half);
        ctx.lineTo(cx+ux*tip,cy+uy*tip);
        ctx.lineTo(cx+ux*base+uy*half,cy+uy*base-ux*half);ctx.closePath();ctx.fill();
        ctx.globalAlpha=1;
      }
      g.pins.forEach((_,i)=>drawSpike(innerPinAngle(g,i),-1));
      // New outside spikes visibly extend for 1.6s before they can hurt the ball.
      g.outerPins.forEach((a,i)=>{if(g.outerAges[i]>0)drawSpike(a,1,g.outerAges[i]/OUTER_WARNING_SECONDS);});
      const tr=r+g.target.lane*gap;
      ctx.save();ctx.translate(cx+Math.cos(g.target.angle)*tr,cy+Math.sin(g.target.angle)*tr);ctx.rotate(g.target.angle+Math.PI/2);ctx.fillStyle='#fff';ctx.fillRect(-PICKUP_SIZE/2*scale,-PICKUP_SIZE/2*scale,PICKUP_SIZE*scale,PICKUP_SIZE*scale);ctx.restore();
      g.waves.forEach(p=>{ctx.strokeStyle=`rgba(255,255,255,${(1-p.age/.65)*.46})`;ctx.lineWidth=1.8*scale;ctx.beginPath();ctx.arc(cx,cy,r*(.1+p.age*2.7),0,TAU);ctx.stroke();});
      g.trail.forEach(t=>{const rr=r+t.lane*gap;ctx.fillStyle=`rgba(255,255,255,${t.life*.9})`;ctx.beginPath();ctx.arc(cx+Math.cos(t.angle)*rr,cy+Math.sin(t.angle)*rr,ball*.48,0,TAU);ctx.fill();});
      g.particles.forEach(p=>{const rr=r+p.lane*gap;ctx.fillStyle=`rgba(255,255,255,${p.life/p.max})`;ctx.beginPath();ctx.arc(cx+Math.cos(p.angle)*rr+p.dx*scale,cy+Math.sin(p.angle)*rr+p.dy*scale,p.size*scale,0,TAU);ctx.fill();});
      if(g.phase!=='lost' || g.deathAge<.35){const a=g.angle,rr=r+g.radiusLane*gap;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr,ball,0,TAU);ctx.fill();}
      canvas.dataset.phase=g.phase;canvas.dataset.lane=String(g.lane);canvas.dataset.angle=String(g.angle);canvas.dataset.score=String(g.score);canvas.dataset.switches=String(g.switches);canvas.dataset.targetAngle=String(g.target.angle);canvas.dataset.targetLane=String(g.target.lane);canvas.dataset.pins=JSON.stringify(g.pins.map((_,i)=>normalize(innerPinAngle(g,i))));canvas.dataset.outerPins=JSON.stringify(g.outerPins.map((angle,i)=>({angle,progress:g.outerAges[i]/OUTER_WARNING_SECONDS,active:g.outerAges[i]>=OUTER_WARNING_SECONDS})));canvas.dataset.pickupSize=String(PICKUP_SIZE);canvas.dataset.enabled=String(enabledRef.current);
    }
    function frame(now){const dt=Math.min((now-last)/1000,.035);last=now;if(!document.hidden){if(enabledRef.current && gameRef.current.phase!=='waiting')update(dt);paint();}raf=requestAnimationFrame(frame);}
    raf=requestAnimationFrame(frame);return()=>{cancelAnimationFrame(raf);observer?.disconnect();window.removeEventListener('resize',size);};
  },[]);
  return <main className="orbit-game" data-paused={view.paused} aria-label="Orbit Switch game" onPointerDown={e=>{if(view.phase!=='lost' && e.isPrimary!==false && e.button===0){e.preventDefault();action();}}}>
    <canvas ref={canvasRef} aria-label="Circular track: tap to change between inside and outside" />
    {view.phase!=='lost' && <div className="score" aria-label="Score">{view.score}</div>}
    {view.phase==='waiting' && <p className="guide">{config.guide}</p>}
    {view.phase==='lost' && <section className="result" role="dialog" aria-modal="true" aria-labelledby="orbit-result-title">
      <div className="result-card">
        <h2 className="lost" id="orbit-result-title">{config.lost}</h2>
        <output className="result-number" aria-label="Final score" style={{fontSize:`calc(${Math.max(24,56-Math.max(0,String(view.score).length-3)*8)}px*var(--u))`}}><span>{view.score}</span></output>
        <button className="replay" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();action();}}>{config.replay}</button>
      </div>
    </section>}
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
