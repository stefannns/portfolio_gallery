
/* BATCH2_IDLE_20261102 */
/* Game-owned, silent demonstration clock. Never dispatches gameplay input. */
(() => {
  'use strict';
  if (window.PlayableIdlePreview) return;
  const query = new URLSearchParams(location.search);
  const hosted = query.get('feedReview') === '1' || query.get('host') === 'fyp';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let preview = hosted, elapsed = 0, last = performance.now();
  const listeners = new Set();
  const sync = () => {
    const html = document.documentElement;
    html.dataset.batch2Idle = String(preview);
    html.dataset.batch2IdlePaused = String(document.hidden);
    html.dataset.batch2IdleReduced = String(reduced.matches);
    if (!preview) for (const node of document.querySelectorAll('[data-idle-preview]')) node.dataset.idlePreview='off';
    last = performance.now();
    for (const fn of listeners) fn(preview && !document.hidden);
  };
  const clock = () => {
    const now = performance.now();
    if (preview && !document.hidden && !reduced.matches) elapsed += Math.min(64, Math.max(0, now - last));
    last = now;
    return reduced.matches ? 1600 : elapsed;
  };
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const ease = t => (t = clamp(t), t * t * (3 - 2 * t));
  const trace = (ctx, points, progress = 1) => {
    if (!points.length) return;
    const distances = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    let left = distances.reduce((a, b) => a + b, 0) * clamp(progress);
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1], q = points[i], d = distances[i - 1];
      const t = Math.min(1, left / Math.max(.01, d));
      ctx.lineTo(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
      left -= d; if (left <= 0) break;
    }
    ctx.stroke();
  };
  const onPath = (points, progress) => {
    const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    let distance = lengths.reduce((a, b) => a + b, 0) * clamp(progress);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = lengths[i - 1];
      if (distance <= length || i === points.length - 1) {
        const t = clamp(distance / Math.max(.01, length));
        return {x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t};
      }
      distance -= length;
    }
    return points[0];
  };
  const stamp = (canvas, kind, phase = clock()) => {
    if (!canvas) return;
    canvas.dataset.idlePreview = preview ? kind : 'off';
    canvas.dataset.idlePhase = String(Math.round(phase));
  };
  function ant(ctx, w, h, image) {
    const t = clock() / 1000, p = (t % 5.4) / 5.4;
    const cx = w*.5, cy = h*.51, rx = Math.min(w*.29, 105), ry = Math.min(h*.16, 78);
    const path = Array.from({length:81}, (_, i) => ({x:cx+Math.cos(i/80*Math.PI*2)*rx,y:cy+Math.sin(i/80*Math.PI*2)*ry}));
    ctx.save(); ctx.lineWidth = 5; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#242322';
    ctx.globalAlpha = p>.88 ? (1-p)/.12 : 1;
    trace(ctx, path, ease(p/.48));
    const x=cx+Math.sin(t*2.1)*rx*.63, y=cy+Math.sin(t*2.8)*ry*.59;
    ctx.translate(x,y);ctx.rotate(Math.atan2(Math.cos(t*2.8)*ry,Math.cos(t*2.1)*rx)+Math.PI/2);
    if(image?.complete&&image.naturalWidth)ctx.drawImage(image,-17,-17,34,34);
    else {ctx.fillStyle='#242322';for(const [y,r]of [[-7,5],[0,4],[7,6]]){ctx.beginPath();ctx.ellipse(0,y,r,r*1.2,0,0,Math.PI*2);ctx.fill();}}
    ctx.restore();stamp(ctx.canvas,'ant-loop');
  }
  function army(state,w,h){
    const t=clock()/1000;
    const players=state.entities.filter(e=>e.team==='player'),cx=players.reduce((n,e)=>n+e.x,0)/Math.max(1,players.length),cy=players.reduce((n,e)=>n+e.y,0)/Math.max(1,players.length);
    return {...state,particles:[],playerTarget:{x:w*(.5+Math.sin(t*.8)*.18),y:h*(.43+Math.cos(t*.8)*.04)},entities:state.entities.map((entity,i)=>({...entity,x:entity.team==='player'?w*(.5+Math.sin(t*.8)*.14)+(entity.x-cx)*.7:entity.x+Math.sin(t*1.5+i*.7)*8,y:entity.team==='player'?h*(.57+Math.cos(t*.8)*.04)+(entity.y-cy)*.7:entity.y+Math.cos(t*1.5+i*.7)*8}))};
  }
  function blade(ctx,w,h,top,bottom){
    const t=clock()/1000,p=(t%5.8)/5.8,cx=w/2,cy=(top+bottom)/2;
    const points=[[-.22,.16],[-.11,.02],[.04,.04],[.17,-.17],[.24,-.11]].map(([x,y])=>({x:cx+x*w,y:cy+y*(bottom-top)}));
    ctx.save();ctx.strokeStyle='#303936';ctx.lineWidth=6;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.globalAlpha=p>.9?(1-p)/.1:1;
    if(p<.5)trace(ctx,points,ease(p/.45));
    else {ctx.translate(cx,cy);ctx.rotate((p-.5)*Math.PI*3.4);trace(ctx,points.map(v=>({x:v.x-cx,y:v.y-cy})));ctx.fillStyle='#303936';ctx.beginPath();ctx.arc(0,0,11,0,Math.PI*2);ctx.fill();}
    ctx.restore();stamp(ctx.canvas,'draw-and-spin-blade');
  }
  function roadPose(key){
    const t=clock()/1000,offset=key==='player'?0:key==='copL'?1.3:2.2;
    const q=t*.75-offset,x=375+Math.sin(q)*130,y=key==='player'?800:1040+(key==='copR'?60:0);
    return{x:x+(key==='copL'?-85:key==='copR'?85:0),y:y+Math.cos(q)*28,angle:-Math.PI/2+Math.cos(q)*.18};
  }
  function road(ctx){
    const p=roadPose('player');ctx.save();ctx.strokeStyle='#ffffff88';ctx.setLineDash([11,12]);ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.bezierCurveTo(p.x+100,p.y-100,340,p.y-220,420,p.y-340);ctx.stroke();ctx.restore();stamp(ctx.canvas,'escape-route');
  }
  function route(start,end,circles,w){
    const nodes=[start,end];
    for(const circle of circles)for(let i=0;i<12;i++){const a=i*Math.PI/6,r=circle.circleRadius+16;const p={x:circle.position.x+Math.cos(a)*r,y:circle.position.y+Math.sin(a)*r};if(p.x>15&&p.x<w-15)nodes.push(p);}
    const distance=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),visited=new Set();distance[0]=0;
    const clear=(a,b)=>circles.every(c=>{const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((c.position.x-a.x)*dx+(c.position.y-a.y)*dy)/Math.max(.01,dx*dx+dy*dy));return Math.hypot(a.x+dx*t-c.position.x,a.y+dy*t-c.position.y)>c.circleRadius+7;});
    for(let pass=0;pass<nodes.length;pass++){let k=-1;for(let j=0;j<nodes.length;j++)if(!visited.has(j)&&(k<0||distance[j]<distance[k]))k=j;if(k<0||!Number.isFinite(distance[k]))break;if(k===1)break;visited.add(k);for(let j=0;j<nodes.length;j++){if(visited.has(j)||!clear(nodes[k],nodes[j]))continue;const d=distance[k]+Math.hypot(nodes[k].x-nodes[j].x,nodes[k].y-nodes[j].y);if(d<distance[j]){distance[j]=d;previous[j]=k;}}}
    if(previous[1]<0)return[start,{x:20,y:start.y+24},{x:20,y:end.y-28},end];
    const path=[];for(let k=1;k>=0;k=previous[k]){path.unshift(nodes[k]);if(k===0)break;}return path;
  }
  let sodaCache=null;
  function soda(ctx,source,cup,cupW,cupH,bodies,w){
    if(!source||!cup)return;const t=clock()/1000,p=t%5.6;
    const circles=bodies.filter(b=>b.label==='obstacle'),key=JSON.stringify([source,cup,w,circles.map(c=>[c.position.x,c.position.y,c.circleRadius])]);
    if(sodaCache?.key!==key)sodaCache={key,points:route({x:source.x,y:source.y+21},{x:cup.x,y:cup.y-cupH*.42},circles,w)};
    const points=sodaCache.points;ctx.save();ctx.strokeStyle='#242322';ctx.lineWidth=5;ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=p>5?(5.6-p)/.6:1;trace(ctx,points,ease(p/1.7));
    if(p>1.4&&p<5){for(let i=0;i<15;i++){const q=((p-1.4)*.65-i*.067);if(q<0||q>1)continue;const at=onPath(points,q);ctx.fillStyle='#59c6b1';ctx.strokeStyle='#242322';ctx.lineWidth=1;ctx.beginPath();ctx.arc(at.x,at.y,4,0,Math.PI*2);ctx.fill();ctx.stroke();}}
    ctx.restore();stamp(ctx.canvas,'guided-soda-route');
  }
  const style=document.createElement('style');style.dataset.batch2IdleStyle='';style.textContent=`
    html[data-batch2-idle=true] .idle-memory-deck{display:block}
    .idle-memory-deck{position:absolute;inset:0;display:none;overflow:hidden;pointer-events:none}
    .idle-memory-deck img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;animation:idle-memory-photo 7.2s linear infinite}
    .idle-memory-deck img:nth-child(2){animation-delay:-4.8s}.idle-memory-deck img:nth-child(3){animation-delay:-2.4s}
    .idle-clean-tool{display:none;position:absolute;z-index:5;left:var(--idle-clean-x,25%);top:var(--idle-clean-y,54%);width:76px;height:95px;pointer-events:none;transform:translate(-50%,-35%)}
    .idle-clean-tool>span{display:none;width:100%;height:100%}.idle-clean-tool img{width:100%;height:100%;object-fit:contain}
    html[data-batch2-idle=true] .idle-clean-tool{display:block}
    [data-idle-clean-tool=spray] .idle-clean-spray,[data-idle-clean-tool=brush] .idle-clean-brush,[data-idle-clean-tool=rinse] .idle-clean-rinse{display:block}
    html[data-batch2-idle=true] .video-window>img{visibility:hidden}
    @keyframes idle-memory-photo{0%,29%{opacity:1;transform:scale(1)}33%,96%{opacity:0;transform:scale(1.035)}100%{opacity:1;transform:scale(1)}}
    html[data-batch2-idle=true] .tool-swing{animation:idle-tool-hit 2.6s ease-in-out infinite!important;transform-origin:70% 75%}
    html[data-batch2-idle=true] .target-art{animation:idle-stick-react 2.6s ease-in-out infinite!important;transform-origin:50% 75%}
    @keyframes idle-tool-hit{0%,32%,100%{transform:translate(10px,5px) rotate(-25deg)}46%{transform:translate(-30px,-8px) rotate(-64deg)}55%,70%{transform:translate(6px,7px) rotate(-20deg)}}
    @keyframes idle-stick-react{0%,45%,72%,100%{transform:rotate(0) scale(1)}50%{transform:translate(-4px,2px) rotate(-3deg) scale(1.025,.97)}60%{transform:rotate(1.5deg) scale(.99,1.01)}}
    html[data-batch2-idle-paused=true] :is(.idle-memory-deck img,.tool-swing,.target-art){animation-play-state:paused!important}
    html[data-batch2-idle-reduced=true] :is(.idle-memory-deck img,.tool-swing,.target-art){animation:none!important}
    html[data-batch2-idle-reduced=true] .idle-memory-deck img:first-child{opacity:1}
  `;document.head.append(style);
  window.PlayableIdlePreview=Object.freeze({get active(){return preview&&!document.hidden;},get preview(){return preview;},get reduced(){return reduced.matches;},get seconds(){return clock()/1000;},clock,ease,clamp,stamp,trace,onPath,ant,army,blade,road,roadPose,soda,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}});
  addEventListener('message',event=>{if(parent===window||event.source!==parent||event.origin!==location.origin||event.data?.type!=='playable-active')return;const next=event.data.active!==true;if(next!==preview){preview=next;elapsed=0;}sync();});
  document.addEventListener('visibilitychange',sync);reduced.addEventListener?.('change',sync);addEventListener('pagehide',()=>{preview=false;sync();listeners.clear();},{once:true});sync();
})();

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
  return{cx,cy,rx,ry,depth,slant,coreRadius:ROLL_CORE_RADIUS,remaining,left:cx+rx,right:cx+rx+depth,sheetTop:cy};
}
function rollHit(point,cfg,unwound=0){
  const g=rollGeometry(cfg,unwound);
  const face=((point.x-g.cx)/g.rx)**2+((point.y-g.cy)/g.ry)**2<=1.15;
  const sheet=point.x>=g.left-12&&point.x<=g.right+12&&point.y>=g.sheetTop-24;
  const body=point.x>=g.cx&&point.x<=g.right+8&&point.y>=g.cy-g.ry+g.slant-8&&point.y<=g.sheetTop;
  return face||sheet||body;
}
const PAPER_PRINT_SPACING=156,PAPER_PRINT_DENSITY=3;
const PAPER_STYLES = [
  { id: 'plain', name: 'Plain White', paper: '#ffffff' },
  { id: 'banknote', name: 'Banknote', paper: '#d8f0df', ink: '#376b55' },
  { id: 'scratch-card', name: 'Scratch Card', paper: '#fff1d3', ink: '#dc655c' },
  { id: 'ticket', name: 'Ticket', paper: '#e2f1ff', ink: '#3b74b8' },
  { id: 'smileys', name: 'Smileys', paper: '#eee4fa', ink: '#8053a1' },
  { id: 'airmail', name: 'Airmail', paper: '#faf1df', ink: '#345d86', draw: drawAirmail },
  { id: 'gingham', name: 'Picnic Gingham', paper: '#fff0f2', ink: '#bd3657', draw: drawGingham },
  { id: 'bakery', name: 'Midnight Bakery', paper: '#f1e5f7', sections: 3, draw: drawBakery },
  { id: 'cat-paws', name: 'Cat Paws', paper: '#fbe1d8', ink: '#9a534e', sections: 3, draw: drawCatPaws },
  { id: 'ghosts', name: 'Ghost Party', paper: '#a58aba', sections: 3, draw: drawGhosts }
];

function drawAirmail(ctx, width) {
  const stampWidth = width * .58;
  ctx.save();
  ctx.translate(0, 17);
  ctx.textAlign = 'center';
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText('AIR MAIL', 0, -51, width);
  ctx.setLineDash([1.5, 2]);
  ctx.strokeRect(-stampWidth / 2, -40, stampWidth, 55);
  ctx.setLineDash([]);
  ctx.strokeRect(-stampWidth / 2 + 4, -36, stampWidth - 8, 47);
  ctx.beginPath();
  ctx.ellipse(0, -12, stampWidth * .3, 17, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-11, -13);
  ctx.lineTo(12, -19);
  ctx.lineTo(3, -2);
  ctx.lineTo(-1, -9);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-1, -9);
  ctx.lineTo(12, -19);
  ctx.stroke();
  ctx.restore();
  for (const edge of [-1, 1]) {
    for (let stripe = 0; stripe < 8; stripe++) {
      ctx.fillStyle = stripe % 2 ? '#c84947' : '#345d86';
      ctx.save();
      ctx.translate(edge * width * .46, stripe * 16 - 57);
      ctx.rotate(.45);
      ctx.fillRect(-2, -4, 4, 8);
      ctx.restore();
    }
  }
}

function drawGingham(ctx, width) {
  const cell = width / 6;
  ctx.globalAlpha = .26;
  for (let col = 0; col < 6; col += 2) ctx.fillRect(-width / 2 + col * cell, -65, cell, 130);
  for (let row = 0; row < 10; row += 2) ctx.fillRect(-width / 2, -65 + row * 13, width, 13);
  ctx.globalAlpha = 1;
  ctx.strokeRect(-width / 2, -65, width, 130);
}

// A three-sheet tile gives the scattered motifs room to vary as the roll turns.
function drawPaperMotifs(ctx, width, motifs) {
  const fit = Math.min(1, width / 87);
  for (const [paint, x, y, angle, size] of motifs) {
    ctx.save();
    ctx.translate(x * width, y);
    ctx.rotate(angle);
    ctx.scale(fit * size, fit * size);
    paint(ctx);
    ctx.restore();
  }
}

function paintCroissant(ctx) {
  ctx.fillStyle = '#efb15e';
  ctx.strokeStyle = '#8c492f';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-19, 7);
  ctx.bezierCurveTo(-20, -4, -11, -13, 0, -12);
  ctx.bezierCurveTo(11, -13, 20, -4, 19, 7);
  ctx.quadraticCurveTo(16, 12, 9, 4);
  ctx.quadraticCurveTo(0, -2, -9, 4);
  ctx.quadraticCurveTo(-16, 12, -19, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#b46d36';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(-11, -8);
  ctx.quadraticCurveTo(-12, -1, -9, 4);
  ctx.moveTo(-4, -12);
  ctx.quadraticCurveTo(-6, -5, -4, 1);
  ctx.moveTo(5, -12);
  ctx.quadraticCurveTo(7, -6, 5, 1);
  ctx.moveTo(12, -7);
  ctx.quadraticCurveTo(14, -1, 9, 4);
  ctx.stroke();
}

function paintPretzel(ctx) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-8, 2);
  ctx.bezierCurveTo(9, -15, 15, -15, 16, -3);
  ctx.bezierCurveTo(18, 14, -18, 14, -16, -3);
  ctx.bezierCurveTo(-15, -15, -9, -15, 8, 2);
  ctx.strokeStyle = '#88452e';
  ctx.lineWidth = 6.5;
  ctx.stroke();
  ctx.strokeStyle = '#c87c47';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.strokeStyle = '#fff0c8';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-12, -7);
  ctx.lineTo(-11, -8);
  ctx.moveTo(12, -8);
  ctx.lineTo(13, -7);
  ctx.moveTo(1, 8);
  ctx.lineTo(3, 8);
  ctx.moveTo(-10, 6);
  ctx.lineTo(-9, 7);
  ctx.stroke();
}

function paintCrumbs(ctx) {
  ctx.fillStyle = '#b97648';
  ctx.fillRect(-6, -1, 3, 2);
  ctx.fillRect(0, 4, 2, 2);
  ctx.fillRect(4, -4, 2, 3);
}

function drawBakery(ctx, width) {
  drawPaperMotifs(ctx, width, [
    [paintCroissant, -.15, -55, -.48, .94],
    [paintCrumbs, .31, -44, .7, .9],
    [paintPretzel, .20, -11, .45, .78],
    [paintCrumbs, -.32, 8, -.4, 1.12],
    [paintCroissant, -.10, 36, .44, 1.06],
    [paintPretzel, .24, 75, -.62, .82],
    [paintCroissant, -.19, 106, -.17, .79],
    [paintCrumbs, .32, 121, .3, .85],
    [paintPretzel, .05, 151, .16, 1.02],
    [paintCrumbs, -.32, 170, -.5, 1],
    [paintCroissant, .16, 196, .60, 1],
    [paintPretzel, -.23, 232, -.32, .79],
    [paintCrumbs, .26, 248, .56, 1],
    [paintCroissant, -.02, 277, -.22, 1.08],
    [paintCrumbs, -.30, 307, .6, 1.05],
    [paintPretzel, .23, 330, .54, .81],
    [paintCroissant, -.21, 364, -.41, .82],
  ]);
}

function paintCatPaw(ctx) {
  const toes = [
    [-12, -4, 3.4, 4.5, -.5],
    [-5, -10, 3.5, 4.8, -.2],
    [4.5, -10.5, 3.5, 4.8, .18],
    [12, -5, 3.4, 4.5, .52],
  ];
  for (const toe of toes) {
    ctx.beginPath();
    ctx.ellipse(...toe, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.bezierCurveTo(-5, -3, -6, 2, -10, 6);
  ctx.bezierCurveTo(-13, 10, -9, 15, -4, 13);
  ctx.quadraticCurveTo(0, 11, 4, 13);
  ctx.bezierCurveTo(9, 15, 13, 10, 10, 6);
  ctx.bezierCurveTo(6, 2, 5, -3, 0, -3);
  ctx.fill();
}

function drawCatPaws(ctx, width) {
  drawPaperMotifs(ctx, width, [
    [paintCatPaw, -.19, -56, -.41, .92],
    [paintCatPaw, .21, -30, .35, .73],
    [paintCatPaw, -.27, -3, -.17, .81],
    [paintCatPaw, .04, 27, .18, 1.06],
    [paintCatPaw, .25, 61, .49, .79],
    [paintCatPaw, -.22, 77, -.35, .68],
    [paintCatPaw, -.07, 108, -.56, .95],
    [paintCatPaw, .26, 136, .28, .89],
    [paintCatPaw, -.21, 161, -.24, .83],
    [paintCatPaw, .11, 191, .35, 1],
    [paintCatPaw, -.24, 219, -.55, .76],
    [paintCatPaw, .22, 239, .51, .89],
    [paintCatPaw, -.04, 270, -.15, .99],
    [paintCatPaw, -.25, 304, -.31, .73],
    [paintCatPaw, .26, 320, .34, .85],
    [paintCatPaw, .01, 358, .07, 1.04],
  ]);
}

function paintGhost(ctx) {
  ctx.fillStyle = '#fffaf4';
  ctx.strokeStyle = '#564565';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-13, 9);
  ctx.lineTo(-12, -2);
  ctx.bezierCurveTo(-11, -18, 11, -18, 12, -2);
  ctx.quadraticCurveTo(13, 5, 16, 9);
  ctx.quadraticCurveTo(13, 14, 8, 9);
  ctx.quadraticCurveTo(4, 15, 0, 10);
  ctx.quadraticCurveTo(-4, 15, -7, 10);
  ctx.quadraticCurveTo(-14, 15, -13, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#efafb9';
  ctx.beginPath();
  ctx.ellipse(-6.5, 1, 2.2, 1.4, 0, 0, Math.PI * 2);
  ctx.moveTo(10.7, 1);
  ctx.ellipse(8.5, 1, 2.2, 1.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#564565';
  ctx.beginPath();
  ctx.ellipse(-3, -4, 1.5, 2.3, 0, 0, Math.PI * 2);
  ctx.moveTo(6.5, -4);
  ctx.ellipse(5, -4, 1.5, 2.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-.5, .5);
  ctx.quadraticCurveTo(1, 3, 2.5, .5);
  ctx.stroke();
}

function paintSpark(ctx) {
  ctx.fillStyle = '#f4d79c';
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.quadraticCurveTo(1, -1, 5, 0);
  ctx.quadraticCurveTo(1, 1, 0, 6);
  ctx.quadraticCurveTo(-1, 1, -5, 0);
  ctx.quadraticCurveTo(-1, -1, 0, -6);
  ctx.fill();
}

function drawGhosts(ctx, width) {
  drawPaperMotifs(ctx, width, [
    [paintGhost, -.18, -56, -.38, .98],
    [paintSpark, .32, -55, .2, 1.04],
    [paintGhost, .22, -16, .34, .75],
    [paintSpark, -.30, -9, .45, .76],
    [paintGhost, -.08, 28, -.14, 1.13],
    [paintSpark, .34, 45, -.3, .88],
    [paintGhost, -.24, 78, -.21, .82],
    [paintGhost, .21, 111, .48, .88],
    [paintSpark, -.28, 123, .1, 1.05],
    [paintGhost, -.06, 152, -.38, 1.05],
    [paintSpark, .28, 173, -.2, .8],
    [paintGhost, .19, 199, .22, 1],
    [paintGhost, -.24, 231, -.49, .77],
    [paintSpark, .27, 241, .38, 1.04],
    [paintGhost, -.03, 274, .14, 1.16],
    [paintSpark, -.30, 308, -.2, .82],
    [paintGhost, .20, 323, .35, .92],
    [paintGhost, -.21, 365, -.24, .81],
    [paintSpark, .31, 370, .1, .95],
  ]);
}

const paperPrintCache=new Map();
function paperPrintTexture(kind,width){
  if(!kind)return null;
  const key=kind+':'+width.toFixed(3);if(paperPrintCache.has(key))return paperPrintCache.get(key);
  const { ink: tone, draw, sections = 1 } = PAPER_STYLES[kind];
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(width*PAPER_PRINT_DENSITY);canvas.height=sections*PAPER_PRINT_SPACING*PAPER_PRINT_DENSITY;
  const ctx=canvas.getContext('2d'),w=width*.87;ctx.scale(canvas.width/width,PAPER_PRINT_DENSITY);ctx.translate(width/2,78);ctx.lineWidth=1;
    if(tone) ctx.strokeStyle=ctx.fillStyle=tone;
    if(draw){
      draw(ctx, w, sections);
    }else if(kind===1){
      ctx.strokeRect(-w/2,-61,w,122);ctx.strokeRect(-w/2+4,-57,w-8,114);ctx.beginPath();ctx.ellipse(0,0,w*.31,34,0,0,Math.PI*2);ctx.stroke();ctx.font='bold 28px Georgia';ctx.textAlign='center';ctx.fillText('100',0,9);ctx.font='bold 10px Georgia';ctx.fillText('100',-w/2+18,-43);ctx.fillText('100',w/2-18,50);for(let j=0;j<6;j++){ctx.beginPath();ctx.moveTo(-w/2+8,-30+j*10);ctx.lineTo(-w*.34,-30+j*10);ctx.moveTo(w*.34,-30+j*10);ctx.lineTo(w/2-8,-30+j*10);ctx.stroke();}
    }else if(kind===2){
      ctx.fillRect(-w/2,-60,w,27);ctx.fillStyle='#fff';ctx.font='bold 13px Arial';ctx.textAlign='center';ctx.fillText('LUCKY 7',0,-42);ctx.fillStyle='#babfc5';for(let j=0;j<6;j++){const x=-w*.27+(j%2)*w*.52,yy=-15+Math.floor(j/2)*24;ctx.fillRect(x-13,yy-9,26,18);ctx.strokeRect(x-13,yy-9,26,18);ctx.fillStyle='#7b858f';ctx.beginPath();ctx.moveTo(x-9,yy+5);ctx.lineTo(x+8,yy-5);ctx.stroke();ctx.fillStyle='#babfc5';}ctx.strokeRect(-w/2,-60,w,122);
    }else if(kind===3){
      ctx.setLineDash([3,3]);ctx.strokeRect(-w/2,-60,w,122);ctx.setLineDash([]);ctx.font='bold 15px Arial';ctx.textAlign='center';ctx.fillText('ADMIT ONE',0,-30);ctx.font='bold 32px Georgia';ctx.fillText('★',0,8);ctx.font='10px monospace';ctx.fillText('NO. 018247',0,40);for(let j=0;j<22;j++){ctx.fillRect(-w/2+8+j*(w-16)/22,46,j%3===0?2:1,9);}
    }else{
      ctx.fillStyle='#e6d5f6';ctx.fillRect(-w/2,-61,w,122);ctx.fillStyle=tone;for(let j=0;j<9;j++){let x=(j%3-1)*w*.30,yy=-39+Math.floor(j/3)*39;ctx.beginPath();ctx.arc(x,yy,9,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(x-5,yy+1);ctx.quadraticCurveTo(x,yy+7,x+5,yy+1);ctx.stroke();ctx.fillRect(x-4,yy-3,1.5,1.5);ctx.fillRect(x+3,yy-3,1.5,1.5);}}

  paperPrintCache.set(key,canvas);return canvas;
}
// u follows the roll axis; v measures paper length from the tangent where
// the curved surface becomes the hanging sheet. Both use one continuous UV.
function paperSurfacePoint(g,u,v,bottom,sway=0){
  if(v<0){const angle=v/g.rx;return{x:g.cx+g.rx*Math.cos(angle)+u*g.depth,y:g.cy+g.ry*Math.sin(angle)+u*g.slant};}
  const t=Math.max(0,Math.min(1,v/Math.max(1,(bottom-g.sheetTop)*.75))),bend=sway*t*t*(3-2*t);
  return{x:g.left+u*g.depth+bend,y:g.sheetTop+v+u*g.slant};
}
function tracePaperSurface(ctx,g,from,to,bottom,sway){
  const steps=Math.max(1,Math.ceil((to-from)/4)),point=(u,v)=>{const p=paperSurfacePoint(g,u,v,bottom,sway);ctx.lineTo(p.x,p.y);};
  const start=paperSurfacePoint(g,0,from,bottom,sway);ctx.beginPath();ctx.moveTo(start.x,start.y);point(1,from);
  for(let i=1;i<=steps;i++)point(1,from+(to-from)*i/steps);
  point(0,to);for(let i=steps-1;i>=0;i--)point(0,from+(to-from)*i/steps);ctx.closePath();
}
function paintPaperPrint(ctx,g,phase,bottom,kind,from,to,sway=0){
  const texture=paperPrintTexture(kind,g.depth);if(!texture)return;
  const density=PAPER_PRINT_DENSITY, repeatLength=texture.height/density, step=from<0?2:16;
  // Each narrow band is sheared along the paper's width axis, rather than
  // rotating its length axis. Curved bands also compress as they turn away.
  for(let v=from;v<to-1e-7;){
    let sample=((v-phase)%repeatLength+repeatLength)%repeatLength;
    if(repeatLength-sample<1e-6)sample=0;
    const length=Math.min(step,to-v,repeatLength-sample),end=v+length;
    const a=paperSurfacePoint(g,0,v,bottom,sway),d=paperSurfacePoint(g,0,end,bottom,sway),pixels=length*density;
    ctx.save();ctx.transform(g.depth/texture.width,g.slant/texture.width,(d.x-a.x)/pixels,(d.y-a.y)/pixels,a.x,a.y);
    ctx.drawImage(texture,0,sample*density,texture.width,pixels,0,0,texture.width,pixels+.12);ctx.restore();v=end;
  }
}
function paperRollColors(printIndex){
  const kind=printIndex%PAPER_STYLES.length,paper=PAPER_STYLES[kind].paper;
  const shade=light=>'#'+paper.slice(1).match(/../g).map(channel=>Math.round(parseInt(channel,16)*light).toString(16).padStart(2,'0')).join('');
  return {kind,paper,side:shade(.85),back:shade(.36)};
}
function paintPaperRoll(ctx,cfg,phase,sway,bottom,unwound=0,printIndex=0){
  const g=rollGeometry(cfg,unwound),{cx,cy,rx,ry,depth,slant}=g,bx=cx+depth,by=cy+slant,{kind,paper,side,back}=paperRollColors(printIndex);
  const curvedStart=-Math.PI*rx/2,sheetEnd=Math.max(0,bottom-g.sheetTop)+Math.abs(slant);
  ctx.fillStyle=back;ctx.beginPath();ctx.moveTo(cx,cy-ry);ctx.lineTo(bx,by-ry);ctx.bezierCurveTo(bx+rx*.56,by-ry,bx+rx,by-ry*.45,bx+rx,by);ctx.bezierCurveTo(bx+rx,by+ry*.55,bx+rx*.55,by+ry,bx,by+ry);ctx.lineTo(cx,cy+ry);ctx.closePath();ctx.fill();
  for(const [from,to] of [[curvedStart,0],[0,sheetEnd]]){
    tracePaperSurface(ctx,g,from,to,bottom,sway);ctx.fillStyle=paper;ctx.fill();
    if(kind){ctx.save();ctx.clip();paintPaperPrint(ctx,g,phase,bottom,kind,from,to,sway);ctx.restore();}
  }
  // Cut lines share the texture's UV phase and the exact same projected width.
  ctx.save();ctx.strokeStyle='#969696';ctx.lineWidth=.8;ctx.setLineDash([1.5,3.5]);
  const first=Math.ceil((curvedStart-phase)/PAPER_PRINT_SPACING);
  for(let k=first;;k++){const v=phase+k*PAPER_PRINT_SPACING;if(v>sheetEnd)break;const a=paperSurfacePoint(g,0,v,bottom,sway),b=paperSurfacePoint(g,1,v,bottom,sway);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  ctx.restore();
  ctx.fillStyle=side;ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#000';ctx.beginPath();ctx.ellipse(cx,cy,g.coreRadius,g.coreRadius,0,0,Math.PI*2);ctx.fill();
  return g;
}
const PAPER_PROGRESS_KEY = 'paper-roll-patterns-v3';
const rollsPerFinish = tier => 2 ** tier;
const upgradeCost = tier => tier * rollsPerFinish(tier - 1);
const rollsToSpend = ({ count, spent }) => count - spent;
const rollLabel = count => count === 1 ? '1 roll' : `${count.toLocaleString()} rolls`;

function readPaperProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PAPER_PROGRESS_KEY));
    if (Number.isSafeInteger(saved?.count) && saved.count >= 0) {
      const requested = Number.isInteger(saved.unlocked) ? saved.unlocked : 0;
      const unlocked = Math.max(0, Math.min(requested, PAPER_STYLES.length - 1));
      const spent = Number.isSafeInteger(saved.spent) ? Math.max(0, Math.min(saved.spent, saved.count)) : 0;
      const index = PAPER_STYLES.findIndex(style => style.id === saved.equipped);
      return { count: saved.count, spent, unlocked, equipped: index > 0 && index <= unlocked ? index : 0 };
    }
  } catch { /* The shop works for the session when browser storage is unavailable. */ }
  return { count: 0, spent: 0, unlocked: 0, equipped: 0 };
}

function PatternSwatch({ index }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = PAPER_STYLES[index].paper;
    ctx.fillRect(0, 0, 88, 88);
    const texture = paperPrintTexture(index, 88);
    if (texture) {
      const section = PAPER_PRINT_SPACING * PAPER_PRINT_DENSITY;
      ctx.drawImage(texture, 0, section * .16, texture.width, section * .68, 0, 0, 88, 88);
    }
  }, [index]);
  return <canvas ref={canvasRef} className="pattern-swatch" width="88" height="88" aria-hidden="true" />;
}

function PatternShop({ progress, onChoose, onClose }) {
  const closeRef = useRef(null);
  const balance = rollsToSpend(progress);
  useEffect(() => { closeRef.current?.focus(); }, []);

  const onKeyDown = (event) => {
    if (event.key === 'Escape') onClose();
    if (event.key !== 'Tab') return;
    const buttons = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled)'));
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className="pattern-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="pattern-panel" role="dialog" aria-modal="true" aria-labelledby="pattern-title" onKeyDown={onKeyDown}>
        <header className="pattern-header">
          <div>
            <h1 id="pattern-title">Paper shop</h1>
            <p aria-live="polite">{rollLabel(balance)} to spend</p>
          </div>
          <button ref={closeRef} className="pattern-close" aria-label="Close paper shop" onClick={onClose}>×</button>
        </header>
        <p className="pattern-note">Earn {rollLabel(rollsPerFinish(progress.unlocked))} per finish. Switching prints keeps your boost.</p>
        <ul className="pattern-list">
          {PAPER_STYLES.map((style, index) => {
            const owned = index <= progress.unlocked;
            const equipped = index === progress.equipped;
            const next = index === progress.unlocked + 1;
            const price = upgradeCost(index);
            const canBuy = next && balance >= price;
            const label = equipped ? 'In use' : owned ? 'Use' : canBuy ? `Buy · ${rollLabel(price)}` : rollLabel(price);
            return (
              <li className="pattern-row" key={style.id}>
                <PatternSwatch index={index} />
                <span className="pattern-name">
                  {style.name}
                  {!owned && <small className="pattern-rate">×{rollsPerFinish(index)} earnings</small>}
                </span>
                <button type="button" className={canBuy ? 'pattern-buy' : ''} disabled={equipped || (!owned && !canBuy)}
                  aria-label={`${style.name}, ${label}`} onClick={() => {
                    onChoose(index);
                    closeRef.current?.focus({ preventScroll: true });
                  }}>{label}</button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function PaperCanvas({cfg,lengthRef,phaseRef,angleRef,velocityRef,dragRef,unwoundRef,cycleRef,progressRef,onRollEmpty,onRollComplete}){
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
      const idle=window.PlayableIdlePreview,demoStep=idle.seconds%4.3,demoPull=idle.reduced?.5:demoStep<3?Math.max(0,Math.sin(Math.min(1,demoStep/2.5)*Math.PI/2)):Math.max(0,1-idle.ease((demoStep-3)/1.3)),demoPhase=preview?demoPull*94:0;if(preview)idle.stamp(canvas,"paper-pull");
      const sway=reducedMotionQuery.matches?0:Math.min(2,Math.abs(velocityRef.current)*.45);
      const bottom=(height-oy)/scale+80;
      let g;
      const patternIndex = progressRef.current.equipped;
      if(cycle.stage==='ready')g=paintPaperRoll(ctx,cfg,phaseRef.current+demoPhase,sway,bottom,preview?demoPull*75:unwoundRef.current,patternIndex);
      else{
        const pose=rollCyclePose(cycle.elapsed,(height-oy)/scale,reducedMotionQuery.matches);
        if(pose.showOld){ctx.save();ctx.globalAlpha=pose.oldAlpha;ctx.translate(138,298+pose.oldY);ctx.rotate(pose.oldAngle);ctx.translate(-138,-298);paintPaperRoll(ctx,cfg,cycle.oldPhase,0,bottom,cycle.oldUnwound,patternIndex);ctx.restore();}
        if(pose.showNew){ctx.save();ctx.globalAlpha=pose.newAlpha;ctx.translate(0,pose.newY);paintPaperRoll(ctx,cfg,0,0,bottom,0,patternIndex);ctx.restore();}
        g=rollGeometry(cfg,pose.showNew?0:cycle.oldUnwound);
      }
      ctx.restore();
      canvas.dataset.paperPrint = PAPER_STYLES[patternIndex].id;
      canvas.dataset.paperLeft=g.left.toFixed(2);canvas.dataset.paperRight=g.right.toFixed(2);canvas.dataset.paperTop=g.sheetTop;canvas.dataset.phase=phaseRef.current.toFixed(1);canvas.dataset.paperLength=lengthRef.current.toFixed(1);canvas.dataset.rollDiameter=(g.rx*2).toFixed(2);canvas.dataset.unwound=unwoundRef.current.toFixed(1);canvas.dataset.rollStage=cycle.stage;canvas.dataset.cycleElapsed=cycle.elapsed.toFixed(0);canvas.dataset.coastVelocity=velocityRef.current.toFixed(4);canvas.dataset.coasting=String(!preview&&!drag.active&&cycle.stage==='ready'&&velocityRef.current>0);
    };frameRef.current=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(frameRef.current);observer.disconnect();};
  },[cfg,lengthRef,phaseRef,angleRef,velocityRef,dragRef,unwoundRef,cycleRef,progressRef,onRollEmpty,onRollComplete]);
  return <canvas ref={canvasRef} className="paper-canvas" aria-label="Perspective paper roll with a hanging perforated sheet"/>;
}

function App() {
  const [cfg, setCfg] = useState(FALLBACK_CFG);
  const [progress, setProgress] = useState(readPaperProgress);
  const progressRef = useRef(progress);
  const [shopOpen, setShopOpen] = useState(false);
  const shopButton = useRef(null);
  const saveProgress = useCallback((next) => {
    progressRef.current = next;
    setProgress(next);
    try {
      localStorage.setItem(PAPER_PROGRESS_KEY, JSON.stringify({
        ...next, equipped: PAPER_STYLES[next.equipped].id,
      }));
    } catch { /* Browser storage may be unavailable in the host. */ }
  }, []);
  const choosePattern = (index) => {
    const current = progressRef.current;
    if (index <= current.unlocked) {
      saveProgress({ ...current, equipped: index });
      return;
    }
    const price = upgradeCost(index);
    if (index !== current.unlocked + 1 || rollsToSpend(current) < price) return;
    saveProgress({ ...current, spent: current.spent + price, unlocked: index, equipped: index });
  };
  const closeShop = () => {
    setShopOpen(false);
    requestAnimationFrame(() => shopButton.current?.focus());
  };
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
  useEffect(()=>{if(!active){setShopOpen(false);dragRef.current.active=false;dragRef.current.pointerId=null;velocityRef.current=0;setDragging(false);}},[active]);
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
          count: progressRef.current.count,
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
    const current = progressRef.current;
    saveProgress({ ...current, count: current.count + rollsPerFinish(current.unlocked) });
    vibrate('medium');
    try{const audio=ensureAudio();if(audio.ctx?.state==='running'&&audio.master){const ctx=audio.ctx,now=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.setValueAtTime(620,now);osc.frequency.exponentialRampToValueAtTime(880,now+.10);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.08,now+.015);gain.gain.exponentialRampToValueAtTime(.0001,now+.17);osc.connect(gain);gain.connect(audio.master);osc.start(now);osc.stop(now+.18);osc.onended=()=>{osc.disconnect();gain.disconnect();};}}catch{}
  },[cfg.INITIAL_PAPER_LENGTH,ensureAudio,saveProgress]);

  const getScenePoint = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / 390, rect.height / 598);
    return {
      x: (event.clientX - rect.left - (rect.width - 390 * scale) / 2) / scale,
      y: (event.clientY - rect.top - (rect.height - 598 * scale) / 2) / scale
    };
  }, []);

  const handlePointerDown = useCallback((event) => {
    if(shopOpen||!feedSession.active||cycleRef.current.stage!=='ready'||event.isPrimary===false||event.button>0||dragRef.current.active)return;
    const point = getScenePoint(event);
    if(!rollHit(point,cfg,unwoundRef.current))return;
    event.preventDefault();event.stopPropagation();
    try{event.currentTarget.setPointerCapture(event.pointerId);}catch{}
    const now = performance.now();
    dragRef.current = { active: true, pointerId: event.pointerId, lastY: point.y, lastTime: now, lastMotionTime:now, hasVelocity:false, total: 0, valid: false };
    velocityRef.current=0;
    ensureAudio();
    setDragging(true);
  }, [cfg, ensureAudio, getScenePoint, shopOpen]);

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
    hintRef.current = true;
    setHintVisible(true);
    setDragging(false);
    playResetSound();
    vibrate('light');
    console.info('[paper-roll] reset');
  }, [cfg.INITIAL_PAPER_LENGTH, playResetSound]);

  return (
    <main className="paper-stage" data-pull-count={progress.count} data-dragging={dragging} data-shop-open={shopOpen}>
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
          text-align: center;
          pointer-events: none;
        }
        .counter-rate { display: block; margin-top: 6px; color: #ffd274; font: 700 12px/1.2 var(--font-body); letter-spacing: 0; }
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
        .paper-stage[data-shop-open="true"] { touch-action: auto; }
        .pattern-open {
          position: absolute; z-index: 4; left: 30px; bottom: 50px;
          width: 46px; height: 46px; display: grid; place-items: center; padding: 0;
          border: 1px solid #ddd9cf; border-radius: 50%; background: #f8f6ef; color: #222;
          cursor: pointer; touch-action: manipulation;
        }
        .pattern-open svg { width: 23px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
        .pattern-ready { position: absolute; top: 0; right: 0; width: 11px; height: 11px; border-radius: 50%; background: #ffd274; border: 2px solid #161616; }
        [data-feed-preview="true"] .pattern-open { visibility: hidden; }
        .pattern-backdrop {
          position: absolute; z-index: 6; inset: 0; display: grid; grid-template-rows: minmax(0, 1fr); place-items: center;
          padding: 30px; background: #0009;
        }
        .pattern-panel {
          display: flex; flex-direction: column; width: min(100%, 356px); max-height: 100%;
          padding: 16px 14px 12px; box-sizing: border-box; overflow: hidden;
          border: 1px solid #49443b; border-radius: 22px; background: #1b1a17; color: #faf6ed;
        }
        .pattern-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .pattern-header h1 { margin: 0; font-size: 23px; }
        .pattern-header p, .pattern-note { margin: 3px 0 0; color: #d6cdbc; font-size: 12px; }
        .pattern-note { margin: 10px 0; }
        .pattern-list { display: grid; gap: 6px; min-height: 0; margin: 0; padding: 0 4px 0 0; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; list-style: none; }
        .pattern-row {
          display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 9px;
          padding: 5px 7px; border-radius: 11px; background: #2a2823;
        }
        .pattern-swatch { width: 40px; height: 40px; border-radius: 7px; }
        .pattern-name { font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
        .pattern-rate { display: block; margin-top: 2px; color: #ffd274; font-size: 11px; }
        .pattern-close, .pattern-row button {
          min-height: 44px; padding: 0 9px; border: 0; border-radius: 9px;
          background: #efebe0; color: #201e19; font: 700 11px/1.15 var(--font-body); cursor: pointer;
        }
        .pattern-close { min-width: 44px; padding: 0; font-size: 21px; }
        .pattern-row button:disabled { background: #3d3931; color: #d6cdbc; cursor: default; }
        .pattern-row .pattern-buy { background: #ffd274; }
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
        progressRef={progressRef}
        onRollEmpty={onRollEmpty}
        onRollComplete={onRollComplete}
        angleRef={angleRef}
        velocityRef={velocityRef}
        dragRef={dragRef}
      />
      <div className="counter" role="status" aria-label="Total rolls earned">
        {progress.count.toLocaleString()}
        <small className="counter-rate">{rollsPerFinish(progress.unlocked)}× per roll</small>
      </div>
      <button className="pattern-open" type="button" ref={shopButton} aria-label="Open paper shop" aria-haspopup="dialog"
        aria-expanded={shopOpen} tabIndex={shopOpen ? -1 : 0} onClick={() => {
          const pointerId = dragRef.current.pointerId;
          const layer = gestureRef.current;
          if (pointerId !== null && layer?.hasPointerCapture(pointerId)) layer.releasePointerCapture(pointerId);
          velocityRef.current = 0;
          setShopOpen(true);
        }}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 4h3l2.3 10.5h10.3L21 7H7"/><circle cx="10" cy="19" r="1.2"/><circle cx="17" cy="19" r="1.2"/>
        </svg>
        {progress.unlocked < PAPER_STYLES.length - 1 && rollsToSpend(progress) >= upgradeCost(progress.unlocked + 1) &&
          <span className="pattern-ready" aria-hidden="true" />}
      </button>
      <div className={hintVisible ? 'hint' : 'hint is-hidden'}>{cfg.HINT_TEXT}</div>
      <button className="reset-button" type="button" aria-label={cfg.RESET_LABEL} tabIndex={shopOpen ? -1 : 0} onClick={reset}>
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
      {shopOpen && <PatternShop progress={progress} onChoose={choosePattern} onClose={closeShop} />}
      <style>{`.gesture-layer { position:absolute; inset:0; z-index:1; touch-action:none; } .gesture-layer.is-dragging { cursor: grabbing; } .reset-button { z-index:4; } .counter, .hint { z-index:2; }`}</style>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<><App/><BatchPolish/></>);
