
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
const POLISH_CSS=BASE_CSS+".brand,.bottom-hint{display:none}.topline{top:30px;left:30px;right:30px;justify-content:center}.stats{font:700 28px/1 system-ui,sans-serif;color:#292d2b}.stats-dot{display:none}.guide{top:24%;left:30px;right:30px;transform:translateY(-50%);font:700 18px/1.3 system-ui,sans-serif;color:#2f3631;letter-spacing:0;animation:batchBreathe 2.5s ease-in-out infinite}.viewfinder{width:82%;height:42%;box-shadow:none;background:transparent;border-color:rgba(40,45,42,.25)}.zoom-readout{top:8px;right:8px;border-radius:24px;padding:0 3px;background:#fbfaf3ee;gap:1px}.zoom-readout button{min-width:44px;min-height:44px;font-size:22px}.zoom-readout span{min-width:36px;text-align:center}.shutter{background:#303a35;border-color:#fffdf3}.reset-control{left:30px;bottom:50px;min-height:44px;border-radius:24px;padding:0 15px;font-size:14px;background:#fdfcf5e6;border:1px solid #c9cec2;color:#354239}.tension-wrap{top:72px;right:30px;width:86px}.tension-caption{font-size:10px}.newspaper,.recap-sheet{background:#fffef6;color:#2c352e;border-color:#788374;box-shadow:4px 7px 0 #2e39241c;max-height:88%;width:100%;padding:20px}.newspaper h1{font:700 clamp(23px,6vw,29px)/1.08 Georgia,serif}.paper-close,.primary-action{background:#354a40;border-color:#354a40;min-height:46px;border-radius:3px}.secondary-action{min-height:46px}.recap-count{color:#354a40}.paper-backdrop,.recap-backdrop{padding:30px}.recap-label,.recap-grid span{font-size:12px;letter-spacing:0;text-transform:none}[data-feed-preview=true] .stats,[data-feed-preview=true] .tension-wrap,[data-feed-preview=true] .reset-control,[data-feed-preview=true] .zoom-readout,[data-feed-preview=true] .shutter{visibility:hidden}"+".observer-app{container-type:size}.town-canvas{touch-action:none;cursor:grab}.town-canvas:active{cursor:grabbing}.guide{background:#faf8eeeb;border-radius:24px;padding:10px 14px;left:50%;right:auto;white-space:nowrap;transform:translate(-50%,-50%)}@media(max-width:350px){.guide{font-size:16px;padding:10px 12px}.newspaper{padding:15px}.paper-caption{font-size:14px}}";
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
  music: './assets/music_town.mp3',
};

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function buildConfig(json) {
  const next = { ...DEFAULTS };
  if (json && Array.isArray(json.tweaks)) json.tweaks.forEach((item) => { next[item.id] = item.value; });
  if (json && Array.isArray(json.texts)) json.texts.forEach((item) => { next[item.id] = item.value; });
  if (json && Array.isArray(json.images)) json.images.forEach((item) => { if (item.path) next[item.id] = item.path; });
  return next;
}

const WORLD = { width: 3200, height: 1900, startX: 1600, startY: 1080 };
const FOUNTAIN = { x: 2300, y: 835, nozzleY: -31 };
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
  fight: { category: 'conflict', priority: 100, headline: 'Fight breaks out in the square', caption: 'Two neighbors trade shoves as a heated argument turns into a scuffle.' },
  friendly: { category: 'friendly', priority: 40, headline: 'A small act of friendship', caption: 'Two neighbors stop for a cheerful greeting and a high five.' },
  kindness: { category: 'friendly', priority: 65, headline: 'A helping hand makes the day', caption: 'A passerby helps gather a neighbor’s scattered shopping.' },
  music: { category: 'friendly', priority: 55, headline: 'Street musician draws a crowd', caption: 'An impromptu guitar performance turns the pavement into a tiny stage.' },
  dance: { category: 'friendly', priority: 50, headline: 'Neighbors dance in the street', caption: 'A spontaneous dance gives the afternoon a lighter rhythm.' },
  splash: { category: 'calm', priority: 75, headline: 'A splash catches a passerby', caption: 'Water sprays from the fountain, leaving a passing neighbor dripping.' },
  trip: { category: 'calm', priority: 80, headline: 'A stumble stops the afternoon', caption: 'A walker loses their footing while a nearby neighbor rushes to help.' },
  juggle: { category: 'friendly', priority: 60, headline: 'Market performer steals the show', caption: 'Flying fruit and quick hands bring a little spectacle to the market.' },
  soccer: { category: 'friendly', priority: 58, headline: 'A friendly kickabout in the park', caption: 'Two locals trade passes in a lively game on the grass.' },
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
  const candidates = sim.events.filter(ev => {
    if (!STORIES[ev.kind]) return false;
    if (ev.kind === 'splash') {
      const passerby = sim.residents.find(p => p.spot === ev.id && p.role === 1);
      const nozzleY = FOUNTAIN.y + FOUNTAIN.nozzleY;
      return passerby && inside(passerby) && FOUNTAIN.x >= bounds.left && FOUNTAIN.x <= bounds.right && nozzleY >= bounds.top && nozzleY <= bounds.bottom;
    }
    return ev.people.every(id => inside(sim.residents.find(p => p.id === id)));
  });
  candidates.sort((a, b) => {
    const score = ev => STORIES[ev.kind].priority - Math.hypot(ev.x - cx, ev.y - cy) * .06;
    return score(b) - score(a);
  });
  if (candidates.length) {
    const ev = candidates[0];
    return { ...STORIES[ev.kind], kind: ev.kind, place: ev.place };
  }
  const people = sim.residents.filter(inside).length;
  return { kind: 'calm', category: 'calm', place: 'Around town', headline: people ? 'An ordinary moment, worth a look' : 'A quiet corner of the town', caption: people ? 'Life carries on between the bigger stories. This frame catches a quieter moment.' : 'For a moment, the streets belong to the open square and the afternoon light.' };
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
    try { if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {}); } catch (e) { /* optional */ }
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

  useEffect(() => {
    if (!active) return;
    const audio = audioRef.current;
    const { ctx } = audio;
    if (!ctx) return;

    let music;
    let generation = 0;
    const syncMusic = (enabled) => {
      const request = ++generation;
      if (!enabled) {
        if (!music) return;
        const now = ctx.currentTime;
        music.gain.gain.setTargetAtTime(0, now, .045);
        music.source.stop(now + .22);
        music = null;
        return;
      }
      if (music) return;

      const ready = audio.buffers.music ?? audio.loading.music;
      Promise.resolve(ready).then((buffer) => {
        if (request !== generation || !buffer || ctx.state === 'closed') return;
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = buffer;
        source.loop = true;
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(audio.gain);
        gain.gain.setTargetAtTime(.24, ctx.currentTime, .2);
        source.onended = () => { source.disconnect(); gain.disconnect(); };
        source.start();
        music = { source, gain };
      }).catch(() => { /* music is optional */ });
    };
    syncMusic(feedSession.active);
    const unsubscribe = feedSession.subscribe(syncMusic);
    return () => { unsubscribe(); syncMusic(false); };
  }, [active]);

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
    const liveSim=simRef.current;
    const idle=window.PlayableIdlePreview;
    if(idle.active&&!drawScene.idleTown)drawScene.idleTown=JSON.parse(JSON.stringify(liveSim));
    if(!idle.preview)drawScene.idleTown=null;
    const sim=idle.active?drawScene.idleTown:liveSim;
    const stepMs = cfgRef.current.SIM_STEP_MS;
    const running = !document.hidden && ((activeRef.current && feedSession.active && !modalRef.current) || (idle.active&&!idle.reduced));
    if (running && now - sim.lastStep >= stepMs) {
      const dt = Math.min(now - sim.lastStep, 100);
      sim.lastStep = now;
      updateTown(sim, dt);
    } else if (!running) sim.lastStep = now;

    const camera = cameraFor(frameStateRef.current, width, height, zoomRef.current);
    if(idle.active){camera.x+=Math.sin(idle.seconds*.3)*70;camera.y+=Math.sin(idle.seconds*.23)*24;idle.stamp(canvas,'town-observation');}
    ctx.save();
    ctx.fillStyle = TOWN_GRASS;ctx.fillRect(0, 0, width, height);
    ctx.translate(width / 2, height / 2);ctx.scale(camera.scale, camera.scale);ctx.translate(-camera.x, -camera.y);
    const motionTime = idle.active ? idle.seconds : sim.cycle;
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
            <h1 data-testid="headline">{paper.headline}</h1>
            <div className="paper-photo"><img src={paper.image} alt="The photographed town square" /></div>
            <p className="paper-caption" data-testid="story-caption">{paper.caption}</p>
            <button type="button" className="paper-close" data-testid="close-paper" onClick={() => { modalRef.current = false; setPaper(null); }}>Return to the square</button>
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

// Original town layout and dimensions; scenery restyled to match the current stick figures.
const TOWN_INK='#252627';
function townRound(ctx,x,y,w,h,r,fill,stroke=null,lw=3){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.stroke();}}
function townEllipse(ctx,x,y,rx,ry,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
function townFlower(ctx,x,y,color){ctx.strokeStyle=TOWN_INK;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,y+17);ctx.lineTo(x,y);ctx.stroke();for(let i=0;i<5;i++){const a=i*Math.PI*2/5;townEllipse(ctx,x+Math.cos(a)*5,y+Math.sin(a)*5,4,4,color);ctx.strokeStyle=TOWN_INK;ctx.lineWidth=1.5;ctx.stroke();}townEllipse(ctx,x,y,3,3,TOWN_INK);}
function drawTown(ctx,viewW,viewH,sim,motionTime){
  // Carry the lawns past every camera edge instead of framing them in sand.
  const grassPad=Math.max(viewW,viewH,200);
  ctx.fillStyle=TOWN_GRASS;ctx.fillRect(-grassPad,-grassPad,WORLD.width+grassPad*2,WORLD.height+grassPad*2);
  townRound(ctx,-grassPad,1360,WORLD.width+grassPad*2,WORLD.height-1360+grassPad,90,'#f5f4ef');
  // Broad warm paving, small offset stones and a circular civic square.
  townRound(ctx,75,755,3050,625,45,'#f5f4ef','#d5d7d2',2);
  for(let row=0;row<8;row++)for(let col=0;col<34;col++){
    const x=75+col*92-(row%2)*46,y=766+row*79;
    townRound(ctx,x+3,y+3,86,72,9,'#f5f4ef','#e5e5df',1);
  }
  ctx.strokeStyle='#b9bcb6';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(1600,1080,245,215,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.ellipse(1600,1080,230,201,0,0,Math.PI*2);ctx.stroke();
  for(let i=0;i<12;i++){const a=i*Math.PI/6;ctx.beginPath();ctx.moveTo(1600+Math.cos(a)*213,1080+Math.sin(a)*186);ctx.lineTo(1600+Math.cos(a)*230,1080+Math.sin(a)*201);ctx.stroke();}
  // Backdrop architecture stays outside the photographed action lanes.
  drawBuilding(ctx,520,470,300,220,'#f5f4ef','CORNER CAFÉ');
  drawBuilding(ctx,1000,440,330,250,'#f5f4ef','THE DAILY SQUARE');
  drawBuilding(ctx,1960,430,350,260,'#f5f4ef','TOWN HALL');
  drawBuilding(ctx,2570,485,350,205,'#f5f4ef','MARKET');
  // A striped produce stand and separate crates, rather than flat bars.
  townEllipse(ctx,2820,869,180,23,'#2526270b');townRound(ctx,2665,770,295,90,10,'#f5f4ef',TOWN_INK,3);
  for(let i=0;i<7;i++)townRound(ctx,2655+i*45,728,46,64,[8,8,18,18],i%2?'#f5f4ef':'#f5f4ef',TOWN_INK,2);
  for(let k=0;k<3;k++){townRound(ctx,2683+k*88,800,78,44,3,'#f5f4ef',TOWN_INK,2);for(let i=0;i<7;i++)townEllipse(ctx,2693+k*88+(i%4)*17,807+Math.floor(i/4)*16,9,9,['#f5f4ef','#f5f4ef','#f5f4ef'][k]);}
  drawFountain(ctx,FOUNTAIN.x,FOUNTAIN.y);
  drawBench(ctx,740,1260,1);drawBench(ctx,1940,1390,1);drawBench(ctx,2620,1320,-1);
  // Lawn edges are planted, leaving the people and their event silhouettes clear.
  [[170,660,1.6],[400,560,1.4],[1210,280,1.5],[1860,280,1.7],[2380,420,1.3],[3080,650,1.5],[340,1450,1.3],[1240,1490,1.5],[2050,1600,1.4],[2960,1480,1.7]].forEach(args=>drawTree(ctx,...args));
  for(let i=0;i<48;i++){const x=120+(i*193)%2960,y=i%2?1460+(i*31)%210:580+(i*17)%130;townFlower(ctx,x,y,['#f5f4ef','#f5f4ef','#f5f4ef'][i%3]);}
  ctx.save();ctx.strokeStyle='#b9bcb6';ctx.lineWidth=3;ctx.strokeRect(1430,350,360,260);ctx.beginPath();ctx.moveTo(1610,350);ctx.lineTo(1610,610);ctx.stroke();ctx.beginPath();ctx.arc(1610,480,60,0,Math.PI*2);ctx.stroke();ctx.restore();
  [[1370,648],[1835,718],[2220,1450],[500,1340]].forEach(([x,y])=>{townEllipse(ctx,x,y+7,33,10,'#2526270b');townRound(ctx,x-26,y-25,52,32,6,'#f5f4ef',TOWN_INK,2);for(let i=0;i<4;i++)townFlower(ctx,x-18+i*12,y-27,['#f5f4ef','#f5f4ef'][i%2]);});
  ctx.fillStyle='#7b807b';ctx.font='600 15px system-ui,sans-serif';ctx.textAlign='center';
  [['WEST GARDEN',390,1335],['CAFÉ CORNER',930,1310],['TOWN SQUARE',1600,1340],['FOUNTAIN WALK',2320,1340],['MARKET LANE',2820,1300],['GREEN PARK',1610,685]].forEach(([t,x,y])=>ctx.fillText(t,x,y));
  [...sim.residents].sort((a,b)=>a.y-b.y).forEach(p=>drawResident(ctx,p,motionTime));
  sim.events.forEach(ev=>drawEvent(ctx,ev,motionTime,sim));
}
function drawBuilding(ctx,x,y,w,h,color,name){
  ctx.save();ctx.translate(x,y);ctx.lineJoin='round';
  townRound(ctx,15,14,w,h,8,'#2526270b');townRound(ctx,0,0,w,h,5,color,TOWN_INK,4);
  ctx.fillStyle='#f5f4ef';ctx.strokeStyle=TOWN_INK;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-14,8);ctx.lineTo(20,-42);ctx.lineTo(w-22,-42);ctx.lineTo(w+15,8);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.strokeStyle=TOWN_INK;ctx.lineWidth=2;for(let i=20;i<w;i+=33){ctx.beginPath();ctx.moveTo(i,-38);ctx.lineTo(i-13,4);ctx.stroke();}
  townRound(ctx,w-64,-72,28,38,3,'#f5f4ef',TOWN_INK,3);
  for(let i=0;i<4;i++){
    const wx=24+i*(w-44)/4;townRound(ctx,wx,30,42,56,10,'#f5f4ef',TOWN_INK,3);townRound(ctx,wx+6,37,30,36,6,'#f5f4ef');ctx.strokeStyle=TOWN_INK;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(wx+21,38);ctx.lineTo(wx+21,73);ctx.moveTo(wx+6,56);ctx.lineTo(wx+36,56);ctx.stroke();townRound(ctx,wx-4,81,50,10,2,'#f5f4ef',TOWN_INK,2);
  }
  townRound(ctx,15,104,w-30,36,4,'#f5f4ef',TOWN_INK,3);ctx.fillStyle=TOWN_INK;ctx.textAlign='center';ctx.font='700 16px system-ui,sans-serif';ctx.fillText(name,w/2,129);
  townRound(ctx,w/2-27,h-66,54,66,[20,20,0,0],'#f5f4ef',TOWN_INK,3);townEllipse(ctx,w/2+15,h-31,3,3,'#f5f4ef');
  for(let side of [-1,1]){townRound(ctx,w/2+side*90-28,h-65,56,46,6,'#f5f4ef',TOWN_INK,3);ctx.strokeStyle=TOWN_INK;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(w/2+side*90,h-62);ctx.lineTo(w/2+side*90,h-22);ctx.stroke();}
  townRound(ctx,-8,h-4,w+16,12,3,'#f5f4ef',TOWN_INK,2);ctx.restore();
}
function drawTree(ctx,x,y,s){
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);townEllipse(ctx,19,78,44,13,'#2526270b');
  ctx.strokeStyle=TOWN_INK;ctx.lineCap='round';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(0,13);ctx.lineTo(0,77);ctx.stroke();ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(0,40);ctx.lineTo(-18,18);ctx.moveTo(0,30);ctx.lineTo(18,10);ctx.stroke();
  const crowns=[[-23,0,30,'#f5f4ef'],[20,-9,31,'#f5f4ef'],[-2,-28,34,'#f5f4ef']];for(const [a,b,r,c]of crowns){townEllipse(ctx,a,b,r,r,c);ctx.strokeStyle=TOWN_INK;ctx.lineWidth=2;ctx.beginPath();ctx.arc(a,b,r,0,Math.PI*2);ctx.stroke();}
  ctx.strokeStyle=TOWN_INK;ctx.lineWidth=4;ctx.beginPath();ctx.arc(-8,-35,16,3.5,5);ctx.stroke();ctx.restore();
}
function drawBench(ctx,x,y,flip){ctx.save();ctx.translate(x,y);ctx.scale(flip,1);townEllipse(ctx,5,34,65,10,'#2526270b');ctx.strokeStyle=TOWN_INK;ctx.lineWidth=3;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-44,-30);ctx.lineTo(-44,32);ctx.moveTo(44,-30);ctx.lineTo(44,32);ctx.stroke();for(let y=-29;y<7;y+=14)townRound(ctx,-57,y,114,10,3,'#f5f4ef',TOWN_INK,2);ctx.restore();}
function drawFountain(ctx,x,y){ctx.save();ctx.translate(x,y);townEllipse(ctx,10,54,109,25,'#2526270b');townEllipse(ctx,0,34,102,32,'#f5f4ef');ctx.strokeStyle=TOWN_INK;ctx.lineWidth=3;ctx.stroke();townEllipse(ctx,0,24,102,32,'#f5f4ef');ctx.strokeStyle=TOWN_INK;ctx.lineWidth=3;ctx.stroke();townEllipse(ctx,0,23,81,23,'#eceee8');ctx.strokeStyle=TOWN_INK;ctx.lineWidth=2;ctx.stroke();ctx.strokeStyle=TOWN_INK;ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,23,80,22,0,.2,2.6);ctx.stroke();townRound(ctx,-11,-27,22,53,4,'#f5f4ef',TOWN_INK,2);townEllipse(ctx,0,-28,29,10,'#f5f4ef');ctx.strokeStyle=TOWN_INK;ctx.stroke();ctx.strokeStyle='#777c77';ctx.lineWidth=3;for(let side of[-1,1]){ctx.beginPath();ctx.moveTo(side*3,-31);ctx.quadraticCurveTo(side*31,-88,side*55,15);ctx.stroke();}townEllipse(ctx,0,-38,6,10,'#f5f4ef');ctx.restore();}
function drawResident(ctx,p,time){
  const t=reducedMotionQuery.matches?1:time,side=p.role?1:-1,fight=p.kind==='fight',dance=p.kind==='dance',wave=Math.sin(t*(fight?9:5)+p.role*Math.PI);
  const soaked=p.kind==='splash'&&p.role===1;
  ctx.save();ctx.translate(p.x,p.y);ctx.scale(p.size,p.size);
  townEllipse(ctx,1,62,21,4,'#2526270b');
  if(p.kind==='trip'&&!p.role){ctx.translate(0,22);ctx.rotate(-.9+Math.sin(t*3)*.1);}else ctx.rotate(fight?wave*.12:dance?wave*.17:0);ctx.translate(0,dance?-Math.abs(wave)*9:0);
  if(soaked){ctx.translate(2,0);ctx.rotate(.08+Math.sin(t*8)*.025);}
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
  if(soaked)arms=[[0,0,-23,-38],[0,0,15,-31]];
  ctx.beginPath();arms.forEach(([a,b,c,d])=>{ctx.moveTo(a,b);ctx.lineTo(c,d);});ctx.stroke();
  townEllipse(ctx,0,-29,19,20,TOWN_GRASS);ctx.beginPath();ctx.ellipse(0,-29,19,20,0,0,Math.PI*2);ctx.stroke();
  townEllipse(ctx,-6,-29,2,2,TOWN_INK);townEllipse(ctx,6,-29,2,2,TOWN_INK);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-4,-20);ctx.quadraticCurveTo(0,fight?-24:-16,4,-20);ctx.stroke();
  if(p.kind==='music'&&!p.role){ctx.save();ctx.translate(0,15);ctx.rotate(-.45);ctx.fillStyle=TOWN_GRASS;ctx.beginPath();ctx.ellipse(-5,0,14,19,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(-3,0);ctx.lineTo(34,0);ctx.stroke();townEllipse(ctx,-5,0,4,4,TOWN_INK);ctx.restore();}
  ctx.restore();
}

function fountainSplashPoint(target,f){
  const start={x:FOUNTAIN.x+3,y:FOUNTAIN.y+FOUNTAIN.nozzleY};
  const end={x:target.x-8,y:target.y-29*target.size};
  const control={x:start.x+(end.x-start.x)*.7+30,y:start.y-110};
  return {x:(1-f)*(1-f)*start.x+2*(1-f)*f*control.x+f*f*end.x,y:(1-f)*(1-f)*start.y+2*(1-f)*f*control.y+f*f*end.y};
}

function drawEvent(ctx,ev,time,sim){
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
    const target=sim.residents.find(p=>p.spot===ev.id&&p.role===1);
    if(target){
      // Cancel the event's person-centered transform: every drop starts at the actual nozzle.
      ctx.translate(-ev.x,-ev.y);ctx.strokeStyle='#89938f';ctx.lineWidth=3;
      for(let i=0;i<15;i++){
        const f=(t*.8+i/15)%1,a=fountainSplashPoint(target,Math.max(0,f-.028)),b=fountainSplashPoint(target,f);
        const spread=Math.sin(i*4.7)*f*4;
        ctx.beginPath();ctx.moveTo(a.x+spread,a.y);ctx.lineTo(b.x+spread,b.y);ctx.stroke();
      }
      const impact=fountainSplashPoint(target,1);
      for(let i=0;i<5;i++){
        const f=(t*1.5+i/5)%1,side=i%2?1:-1;
        const x=impact.x+side*(4+f*22),y=impact.y+f*f*58-8*Math.sin(f*Math.PI);
        ctx.globalAlpha=1-f;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+side*2,y+5);ctx.stroke();
      }
    }
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
.paper-kicker { font-family: var(--font-display); font-size: 11px; letter-spacing: .2em; color: #856b58; }
.newspaper h1, .recap-sheet h2 { margin: 0 0 12px; font-family: var(--font-display); font-size: clamp(24px, 7vw, 33px); line-height: 1.03; font-weight: 400; letter-spacing: -.02em; }
.paper-close, .primary-action, .secondary-action { min-height: 42px; padding: 9px 15px; border: 1px solid #8d7561; cursor: pointer; font-family: var(--font-display); font-size: 16px; }.paper-close, .primary-action { background: #aa604e; color: #fff6e7; }.secondary-action { background: transparent; color: #665548; }.recap-sheet { transform: rotate(.4deg); text-align: center; }.recap-sheet h2 { margin-top: 14px; font-size: 29px; }.recap-count { margin-top: 5px; font-family: var(--font-display); font-size: 56px; line-height: 1; color: #aa604e; }.recap-label { color: #796a5c; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; }.recap-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin: 22px 0 17px; border-top: 1px solid #c7b8a1; border-bottom: 1px solid #c7b8a1; padding: 12px 0; }.recap-grid div { display: flex; flex-direction: column; gap: 3px; }.recap-grid b { font-family: var(--font-display); font-size: 23px; font-weight: 400; }.recap-grid span { font-size: 10px; color: #806e5d; line-height: 1.1; }.history { text-align: left; margin: 13px 0 17px; padding-top: 2px; }.history > span { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #806e5d; }.history p { margin: 7px 0 0; font-family: var(--font-display); font-size: 14px; line-height: 1.15; }.recap-actions { display: grid; gap: 8px; }
@media (max-height: 600px) { .viewfinder { height: min(43%, 260px); } .guide { top: 13%; } .bottom-hint { display: none; } .newspaper, .recap-sheet { max-height: 88%; padding-top: 14px; } }
`;

const printStyles = `
@font-face {
  font-family: SpecialElite;
  src: url('./assets/fonts/special-elite/SpecialElite-Regular.ttf') format('truetype');
  font-display: swap;
}
.observer-app {
  --font-display: SpecialElite, 'Courier New', monospace;
  --font-body: SpecialElite, 'Courier New', monospace;
  --font-mono: SpecialElite, 'Courier New', monospace;
}
.observer-app .guide, .observer-app .stats { font-family: SpecialElite, monospace; }
.newspaper, .recap-sheet {
  position: relative;
  background-color: #efefef;
  background-image: url('./assets/worn-newsprint-gray-v4.webp');
  background-size: 100% 100%;
  border: 1px solid #929292;
  border-top: 7px double #252525;
  border-bottom: 4px double #252525;
  box-shadow: inset 0 0 24px #30303018, 3px 6px 18px #1113;
  padding: 20px 18px 17px;
  color: #252525;
  transform: rotate(-.4deg);
}
.recap-sheet {
  background-image: linear-gradient(#efcf7624, #efcf7624), url('./assets/worn-newsprint-gray-v4.webp');
}
.recap-sheet .paper-kicker {
  text-align: center;
  font: 400 11px SpecialElite, monospace;
  letter-spacing: .17em;
  color: #444;
}
.recap-sheet h2 {
  font: 400 clamp(24px, 6.8vw, 31px)/1.1 SpecialElite, monospace;
  letter-spacing: -.04em;
  text-align: center;
  text-transform: uppercase;
  text-shadow: .3px .3px #25252565;
}
.newspaper {
  max-height: 100%;
  text-align: center;
  background-color: ${TOWN_GRASS};
  background-image: linear-gradient(${TOWN_GRASS}b8, ${TOWN_GRASS}b8), url('./assets/worn-newsprint-gray-v4.webp');
}
.newspaper h1 {
  margin: 0 0 14px;
  font: 900 clamp(24px, 7.3vw, 34px)/1.03 Georgia, 'Times New Roman', serif;
  letter-spacing: -.025em;
  text-transform: uppercase;
  text-wrap: balance;
  text-shadow: .4px .4px #25252565;
}
.newspaper .paper-photo img {
  display: block;
  margin: 0 auto;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: min(33cqh, 240px);
  border: 5px solid #252525;
  background: ${TOWN_GRASS};
}
.newspaper .paper-caption {
  margin: 14px 0 16px;
  font: 400 16px/1.35 SpecialElite, 'Courier New', monospace;
  color: #303030;
}
.paper-close, .primary-action, .secondary-action {
  font-family: SpecialElite, monospace;
  background: #252525;
  color: #f4f4f4;
  border: 1px solid #252525;
  border-radius: 0;
  box-shadow: 2px 2px 0 #999;
}
.paper-close { width: 100%; font-size: 16px; }
.secondary-action { background: transparent; color: #252525; }
.recap-count { color: #252525; }
.history p { line-height: 1.3; }
@media (max-height: 490px) {
  .paper-backdrop { padding-block: 24px; }
  .newspaper { padding-block: 13px; }
  .newspaper h1 { margin-bottom: 10px; }
  .newspaper .paper-photo img { max-height: 26cqh; }
  .newspaper .paper-caption { margin-block: 10px; }
}
`;

function StyledApp() { return <><style>{styles}</style><App /></>; }

createRoot(document.getElementById('root')).render(<><StyledApp/><BatchPolish/><style>{printStyles}</style></>);
