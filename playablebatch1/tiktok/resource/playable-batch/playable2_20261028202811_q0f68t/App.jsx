
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

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

const GAME_NUMBER=85;
const POLISH_CSS=BASE_CSS+":root{--ink:#233342;--muted:#657486;--blue:#1479e7;--cyan:#1479e7;--line:#d9e1e8}.app-root{padding:0;background:#101619}.game-shell{width:100%;height:100%;max-width:none;aspect-ratio:auto;border:0;border-radius:0;background:#101619;box-shadow:none}.ambient,.signal-dot,.attachment-top,.bottom-note,.video-copy b,.video-glow,.play-pulse,.orbit,.next-thread{display:none}.topline{top:30px;left:30px;right:30px;display:flex;justify-content:center}.sender-chip{font-size:14px;letter-spacing:0;text-transform:none;color:#e4edf2}.sender-avatar{background:#7da9a2;box-shadow:none;border:0;width:30px;height:30px}.round-hud{font-size:22px;text-shadow:none;color:#d7e4e8}.hint{top:24%;left:30px;right:30px;transform:translateY(-50%);white-space:normal;font:700 18px/1.3 var(--font-body);color:white;letter-spacing:0;animation:batchBreathe 2.6s ease-in-out infinite}.attachment{left:30px;right:30px;top:31%;bottom:50px;border:0;border-radius:12px;background:#fff;padding:12px;box-shadow:0 10px 30px #0003}.video-stage{padding:0}.video-copy{padding:10px 12px;margin:0;background:#1479e7;border-radius:6px 6px 0 0}.video-copy span{color:#fff;font:700 17px/1.3 var(--font-body);text-transform:none;letter-spacing:0}.video-window{border:0;border-radius:0;background:#eff4f4}.video-window:after{display:none}.video-window img{width:100%;height:100%;object-fit:cover;filter:none;animation:momentPhoto 1s ease both}.replay-button{font-size:14px;min-height:44px;color:#2a5365;border:1px solid #d3dfe6;background:#f4f8fa;border-radius:8px;margin-top:10px}.replay-button svg{stroke:#2a637c}.attachment.grid{top:88px;padding:0 10px 10px;bottom:50px}.grid-stage{padding:0}.grid-heading{margin:0 -10px 8px;padding:12px 14px;background:#1479e7;color:#fff;min-height:62px;border-radius:10px 10px 0 0;font:700 17px/1.25 var(--font-body);gap:12px}.grid-heading b{background:white;color:#1479e7;border:0;border-radius:50%;min-width:28px;height:28px;font-size:14px}.memory-grid{gap:5px}.memory-tile{border:0;border-radius:4px;background:#eaf1f4}.memory-tile img{width:100%;height:100%;object-fit:cover;filter:none;transition:none}.memory-tile:hover img{transform:none}.memory-tile.is-selected{border:3px solid #1479e7;box-shadow:none;background:#d9eaff}.memory-tile.is-selected img{transform:none}.tile-check{width:25px;height:25px;border-radius:50%;background:#fff9;border:2px solid white;top:5px;right:5px}.is-selected .tile-check{background:#1479e7;border-color:white}.is-selected .tile-check svg{stroke:white}.grid-actions{justify-content:space-between;gap:10px;padding-top:9px}.grid-replay{margin:0;min-height:44px}.verify-button{min-height:44px;min-width:118px;padding:0 20px;border-radius:8px;background:#1479e7;color:#fff;font-size:15px;box-shadow:none}.verify-button svg{stroke:white}.failure-feedback{font-size:13px;color:#a64242;margin:8px 0 0}.attachment.success{top:24%;bottom:20%;padding:20px}.success-label{color:#1d6da8;font-size:26px}.success-stage p{color:#536273;font-size:16px}.unlock-symbol{background:#e4f1ff;box-shadow:none;border-color:#bdd9f7;animation:none}.unlock-symbol svg{stroke:#1479e7}.unlock-orbit{margin-bottom:12px}.success-stage{padding:0}@keyframes momentPhoto{from{transform:scale(1.04);opacity:.4}to{transform:scale(1);opacity:1}}[data-feed-preview=true] .topline{visibility:hidden}[data-feed-preview=true] .attachment{top:33%;bottom:22%}[data-feed-preview=true] .replay-button{display:none}@media(max-height:540px){.attachment.grid{top:70px;bottom:38px}.grid-heading{min-height:48px;font-size:15px;padding:9px 12px}.grid-actions{padding-top:6px}.grid-replay,.verify-button{min-height:42px}.failure-feedback{font-size:12px;margin-top:4px}} .video-window img{object-fit:contain}.memory-tile{padding:0}[data-feed-preview=true] .attachment{left:14%;right:14%} .attachment.grid{top:calc(50% + 19px);bottom:auto;height:auto;max-height:calc(100% - 130px);transform:translateY(-50%)}.memory-grid{width:min(100%,max(150px,calc(100cqh - 260px)));aspect-ratio:1;flex:0 0 auto;align-self:center}.grid-actions{margin-top:0}";

const DEFAULT_CONFIG = {
  VIDEO_STEP_MS: 900,
  SUCCESS_PAUSE_MS: 1500,
  TARGET_COUNT: 3,
  GAME_NAME: 'Memory Drop',
  HINT_TEXT: 'Watch, then choose',
  WATCH_LABEL: 'WATCH',
  PICK_LABEL: 'Select the moments you saw',
  VERIFY_LABEL: 'Verify',
  REPLAY_LABEL: 'Replay',
  SUCCESS_LABEL: 'Unlocked',
  SUCCESS_MESSAGE: 'You kept the thread.',
  FAIL_MESSAGE: 'Not quite. Try again or replay.',
  DOG_SKATE: './assets/dog_skate.webp',
  OFFICE_CHAIR: './assets/office_chair.webp',
  LAUGHING_BABY: './assets/laughing_baby.webp',
  CAT: './assets/cat.webp',
  RAMEN: './assets/ramen.webp',
  SUNSET: './assets/sunset.webp',
  COFFEE: './assets/coffee.webp',
  TACO: './assets/taco.webp',
  PLANT: './assets/plant.webp',
  DAY_BICYCLE: './assets/memory-sets/day_bicycle.webp',
  DAY_FRISBEE: './assets/memory-sets/day_frisbee.webp',
  DAY_VIOLIN: './assets/memory-sets/day_violin.webp',
  DAY_ICE_CREAM: './assets/memory-sets/day_ice_cream.webp',
  DAY_TRAM: './assets/memory-sets/day_tram.webp',
  DAY_KAYAK: './assets/memory-sets/day_kayak.webp',
  DAY_BALLOON: './assets/memory-sets/day_balloon.webp',
  DAY_FLOWERS: './assets/memory-sets/day_flowers.webp',
  DAY_FERRIS: './assets/memory-sets/day_ferris.webp',
  HOME_RABBIT: './assets/memory-sets/home_rabbit.webp',
  HOME_PANCAKES: './assets/memory-sets/home_pancakes.webp',
  HOME_YARN: './assets/memory-sets/home_yarn.webp',
  HOME_KETTLE: './assets/memory-sets/home_kettle.webp',
  HOME_GUITAR: './assets/memory-sets/home_guitar.webp',
  HOME_CAKE: './assets/memory-sets/home_cake.webp',
  HOME_BOOK: './assets/memory-sets/home_book.webp',
  HOME_FISH: './assets/memory-sets/home_fish.webp',
  HOME_DUCK: './assets/memory-sets/home_duck.webp'
};

const CLASSIC_ITEMS = [
  { id: 'DOG_SKATE', name: 'Skateboard dog' },
  { id: 'OFFICE_CHAIR', name: 'Wobbling office chair' },
  { id: 'LAUGHING_BABY', name: 'Laughing baby' },
  { id: 'CAT', name: 'Gray kitten' },
  { id: 'RAMEN', name: 'Ramen bowl' },
  { id: 'SUNSET', name: 'Sunset beach' },
  { id: 'COFFEE', name: 'Coffee cup' },
  { id: 'TACO', name: 'Taco' },
  { id: 'PLANT', name: 'Houseplant' }
];
const ROUND_PACKS = [
  ['DOG_SKATE', 'OFFICE_CHAIR', 'LAUGHING_BABY'],
  ['CAT', 'RAMEN', 'SUNSET'],
  ['COFFEE', 'TACO', 'PLANT']
];
const DAY_OUT_ITEMS = [
  {
    "id": "DAY_BICYCLE",
    "name": "Red bicycle"
  },
  {
    "id": "DAY_FRISBEE",
    "name": "Frisbee dog"
  },
  {
    "id": "DAY_VIOLIN",
    "name": "Street violinist"
  },
  {
    "id": "DAY_ICE_CREAM",
    "name": "Ice cream cone"
  },
  {
    "id": "DAY_TRAM",
    "name": "Yellow tram"
  },
  {
    "id": "DAY_KAYAK",
    "name": "Yellow kayak"
  },
  {
    "id": "DAY_BALLOON",
    "name": "Rainbow balloon"
  },
  {
    "id": "DAY_FLOWERS",
    "name": "Flower stall"
  },
  {
    "id": "DAY_FERRIS",
    "name": "Ferris wheel"
  }
];
const COZY_HOME_ITEMS = [
  {
    "id": "HOME_RABBIT",
    "name": "Pet rabbit"
  },
  {
    "id": "HOME_PANCAKES",
    "name": "Blueberry pancakes"
  },
  {
    "id": "HOME_YARN",
    "name": "Knitting yarn"
  },
  {
    "id": "HOME_KETTLE",
    "name": "Red tea kettle"
  },
  {
    "id": "HOME_GUITAR",
    "name": "Blue guitar"
  },
  {
    "id": "HOME_CAKE",
    "name": "Strawberry cake"
  },
  {
    "id": "HOME_BOOK",
    "name": "Rainy-day book"
  },
  {
    "id": "HOME_FISH",
    "name": "Goldfish"
  },
  {
    "id": "HOME_DUCK",
    "name": "Rubber duck"
  }
];
const ALL_ITEMS = [...CLASSIC_ITEMS, ...DAY_OUT_ITEMS, ...COZY_HOME_ITEMS];
// Keep nine choices per round. Each set has its own three watched sequences.
const packsOf = items => [0, 3, 6].map(start => items.slice(start, start + 3).map(item => item.id));
const MEMORY_SETS = [
  { id: 'classic', items: CLASSIC_ITEMS, packs: ROUND_PACKS },
  { id: 'day-out', items: DAY_OUT_ITEMS, packs: packsOf(DAY_OUT_ITEMS) },
  { id: 'cozy-home', items: COZY_HOME_ITEMS, packs: packsOf(COZY_HOME_ITEMS) }
];
const PREVIEW_ITEMS = [CLASSIC_ITEMS[0], DAY_OUT_ITEMS[6], COZY_HOME_ITEMS[0]];

const SOUND_SELECT = './assets/sfx_select.mp3';
const SOUND_VERIFY = './assets/sfx_verify.mp3';
const SOUND_SUCCESS = './assets/sfx_success.mp3';
const SOUND_FAIL = './assets/sfx_fail.mp3';

function flattenConfig(raw) {
  const cfg = { ...DEFAULT_CONFIG };
  (raw?.tweaks || []).forEach((item) => { cfg[item.id] = item.value; });
  (raw?.texts || []).forEach((item) => { cfg[item.id] = item.value; });
  (raw?.images || []).forEach((item) => { cfg[item.id] = item.path; });
  return cfg;
}

function vibrate(style) {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style: style || 'light' });
  } catch (e) { /* optional haptics */ }
}

function connectedCorrectGroup(items,targets){
  const correct=new Set(items.map((item,i)=>targets.includes(item.id)?i:-1).filter(i=>i>=0));
  if(correct.size<3)return false;
  const seen=new Set(),queue=[correct.values().next().value];
  while(queue.length){const i=queue.pop();if(seen.has(i))continue;seen.add(i);for(const j of correct){if(!seen.has(j)&&Math.abs(Math.floor(i/3)-Math.floor(j/3))+Math.abs(i%3-j%3)===1)queue.push(j);}}
  return seen.size===correct.size;
}
function shuffledMemoryGrid(items,targets,seed){
  let state=seed>>>0;
  const random=()=>{let n=state=(state+0x6d2b79f5)>>>0;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};
  let shuffled;
  for(let attempt=0;attempt<60;attempt++){
    shuffled=items.slice();for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    if(!connectedCorrectGroup(shuffled,targets))return shuffled;
  }
  // A bounded fallback keeps a highly unlucky shuffle from producing one
  // contiguous answer cluster. It does not force one answer into every row.
  const answers=shuffled.filter(item=>targets.includes(item.id)),others=shuffled.filter(item=>!targets.includes(item.id));
  const slots=[0,2,7,4];if(answers.length>slots.length)return shuffled;
  const grid=Array(items.length);answers.forEach((item,i)=>{grid[slots[i]]=item;});let index=0;return Array.from(grid,item=>item||others[index++]);
}

function App() {
  const feedActive = useFeedActive();
  const [cfg, setCfg] = useState(DEFAULT_CONFIG);
  const [phase, setPhase] = useState('video');
  const [round, setRound] = useState(1);
  const [gridSeed] = useState(()=>Math.floor(Math.random()*4294967296));
  const [videoIndex, setVideoIndex] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [feedback, setFeedback] = useState('');
  const [hintSeen, setHintSeen] = useState(false);
  const [ready, setReady] = useState(false);
  const audioRef = useRef({ ctx: null, gain: null, buffers: new Map(), loading: new Map(), sources: new Set() });

  useEffect(() => {
    let alive = true;
    fetch('./game.config.json').then((res) => res.ok ? res.json() : {}).then((raw) => {
      if (alive) setCfg(flattenConfig(raw));
    }).catch(() => { /* defaults keep the game playable */ }).finally(() => {
      if (alive) setReady(true);
    });
    return () => { alive = false; };
  }, []);

  const getAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      try {
        audio.ctx = new AudioContextClass();
        audio.gain = audio.ctx.createGain();
        audio.gain.gain.value = 0.2;
        audio.gain.connect(audio.ctx.destination);
      } catch (e) { return null; }
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
    return audio;
  }, []);

  const playSound = useCallback((url) => {
    const audio = getAudio();
    if (!audio) return;
    console.info('[sound]', url);
    const ctx = audio.ctx;
    let load = audio.loading.get(url);
    if (!load && !audio.buffers.has(url)) {
      load = fetch(url).then((res) => res.arrayBuffer()).then((data) => ctx.decodeAudioData(data)).then((buffer) => {
        audio.buffers.set(url, buffer);
        audio.loading.delete(url);
        return buffer;
      }).catch(() => { audio.loading.delete(url); return null; });
      audio.loading.set(url, load);
    }
    const finish = (buffer) => {
      if (!buffer || !audio.ctx || audio.ctx.state === 'closed') return;
      try {
        const source = audio.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(audio.gain);
        audio.sources.add(source);
        source.onended = () => audio.sources.delete(source);
        source.start(0);
      } catch (e) { /* audio is non-blocking */ }
    };
    if (audio.buffers.has(url)) finish(audio.buffers.get(url));
    else if (load) load.then(finish);
  }, [getAudio]);

  useEffect(() => () => {
    const audio = audioRef.current;
    audio.sources.forEach((source) => { try { source.stop(); } catch (e) {} });
    audio.sources.clear();
    if (audio.ctx) audio.ctx.close().catch(() => {});
  }, []);

  const imageSet = MEMORY_SETS[(round - 1) % MEMORY_SETS.length];
  const targets = useMemo(() => imageSet.packs[Math.floor((round - 1) / MEMORY_SETS.length) % imageSet.packs.length].slice(0, cfg.TARGET_COUNT), [round, cfg.TARGET_COUNT, imageSet]);
  const currentMoment = targets[videoIndex] || targets[0];
  const gridItems = useMemo(()=>shuffledMemoryGrid(imageSet.items,targets,(gridSeed+Math.imul(round,1664525))>>>0),[round,targets,gridSeed,imageSet]);

  useEffect(() => {
    if (phase !== 'video' || !feedActive || document.hidden) return undefined;
    const timer = window.setTimeout(() => {
      if (videoIndex < targets.length - 1) setVideoIndex((value) => value + 1);
      else {setHintSeen(true);setPhase('grid');}
    }, cfg.VIDEO_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [phase, videoIndex, targets.length, cfg.VIDEO_STEP_MS, feedActive]);

  useEffect(()=>{
    if(!feedActive){setVideoIndex(0);setSelected(new Set());setFeedback('');setHintSeen(false);setPhase('video');}
  },[feedActive]);
  const nextRound=()=>{setRound(value=>value+1);setVideoIndex(0);setSelected(new Set());setFeedback('');setPhase('video');};

  const beginReplay = useCallback(() => {
    setHintSeen(true);
    setFeedback('');
    setSelected(new Set());
    setVideoIndex(0);
    setPhase('video');
    playSound(SOUND_VERIFY); // replay control: formal confirmation cue
    vibrate('light');
  }, [playSound]);

  const toggleTile = useCallback((id) => {
    setHintSeen(true);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setFeedback('');
    playSound(SOUND_SELECT); // grid toggle: soft selection tap
    vibrate('light');
  }, [playSound]);

  const verify = useCallback(() => {
    playSound(SOUND_VERIFY); // Verify button: formal confirmation cue
    vibrate('medium');
    const isCorrect = selected.size === targets.length && targets.every((id) => selected.has(id));
    if (isCorrect) {
      console.info('[memory]', 'round complete', round, targets);
      playSound(SOUND_SUCCESS); // correct memory set: neon check chime
      vibrate('notification_success');
      setPhase('success');
    } else {
      console.info('[memory]', 'retry', { selected: selected.size, expected: targets.length });
      playSound(SOUND_FAIL); // incorrect memory set: gentle miss cue
      vibrate('notification_error');
      setFeedback(cfg.FAIL_MESSAGE);
    }
  }, [cfg.FAIL_MESSAGE, playSound, round, selected, targets]);

  if (!ready) return <div className="loading-screen">Loading memory…</div>;

  return (
    <main className="app-root">
      <section className="game-shell" data-testid="game-shell" data-memory-set={imageSet.id} aria-label={cfg.GAME_NAME}>
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />
        <header className="topline">
          <div className="round-hud" data-testid="round-hud">{String(round).padStart(2, '0')}</div>
          <div className="signal-dot" aria-hidden="true" />
        </header>

        {!hintSeen && phase !== 'success' && <p className="hint" data-testid="hint">{cfg.HINT_TEXT}</p>}

        <div className={`attachment ${phase}`}>
          <div className="attachment-top">
            <span className="attachment-kicker">ATTACHMENT</span>
            <span className="attachment-line" />
            <span className="attachment-mark">•••</span>
          </div>

          {phase === 'video' && (
            <div className="video-stage" data-testid="video-stage">
              <div className="video-copy"><span>{cfg.WATCH_LABEL}</span><b>memory moment</b></div>
              <div className="video-window">
                <div className="idle-memory-deck" aria-hidden="true">{PREVIEW_ITEMS.map(item=><img key={item.id} src={cfg[item.id]} alt="" draggable="false" />)}</div>
                <div className="video-glow" />
                <img src={cfg[currentMoment]} alt={ALL_ITEMS.find((item) => item.id === currentMoment)?.name || 'Memory moment'} />
                <div className="play-pulse" aria-hidden="true"><span /></div>
              </div>
              <button className="replay-button" data-testid="replay" onClick={beginReplay} type="button">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8.5A7.5 7.5 0 1 0 19.3 14" /><path d="M19 4v4.5h-4.5" /></svg>
                <span>{cfg.REPLAY_LABEL}</span>
              </button>
            </div>
          )}

          {phase === 'grid' && (
            <div className="grid-stage" data-testid="grid-stage">
              <div className="grid-heading">
                <span>{cfg.PICK_LABEL}</span>
                <b data-testid="selected-count">{selected.size}</b>
              </div>
              <div className="memory-grid">
                {gridItems.map((item) => {
                  const active = selected.has(item.id);
                  const isTarget = targets.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      className={`memory-tile${active ? ' is-selected' : ''}`}
                      data-testid={`tile-${item.id}`}
                      data-testid-tile="true"
                      data-testid2="tile"
                      data-tile="true"
                      data-id={item.id}
                      data-target={String(isTarget)}
                      aria-label={item.name}
                      aria-pressed={active}
                      onClick={() => toggleTile(item.id)}
                      type="button"
                    >
                      <img src={cfg[item.id]} alt="" />
                      <span className="tile-check" aria-hidden="true"><svg viewBox="0 0 18 18"><path d="m4 9 3.2 3.2L14 5.5" /></svg></span>
                    </button>
                  );
                })}
              </div>
              <div className="grid-actions">
                <button className="replay-button grid-replay" onClick={beginReplay} type="button">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8.5A7.5 7.5 0 1 0 19.3 14" /><path d="M19 4v4.5h-4.5" /></svg>
                  <span>{cfg.REPLAY_LABEL}</span>
                </button>
                <button className="verify-button" data-testid="verify" onClick={verify} type="button"><span>{cfg.VERIFY_LABEL}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.2 4.2L19 6.5" /></svg></button>
              </div>
              {feedback && <p className="failure-feedback" data-testid="failure-feedback">{feedback}</p>}
            </div>
          )}

          {phase === 'success' && (
            <div className="success-stage" data-testid="success-stage">
              <div className="unlock-orbit"><span className="orbit orbit-a" /><span className="orbit orbit-b" /><div className="unlock-symbol"><svg viewBox="0 0 44 44" aria-hidden="true"><path d="M14 20v-5.2a8 8 0 0 1 16 0V20" /><rect x="10" y="19" width="24" height="18" rx="4" /><path d="m17 28 3.5 3.5L28 24" /></svg></div></div>
              <div className="success-label">{cfg.SUCCESS_LABEL}</div>
              <p>{cfg.SUCCESS_MESSAGE}</p>
              <button className="verify-button next-round" onClick={nextRound}>Next round</button>
            </div>
          )}
        </div>
        <footer className="bottom-note"><span className="note-dot" /> private attachment <span className="note-dot" /></footer>
      </section>
    </main>
  );
}

const styles = `
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
  --ink: #f4f7ff;
  --muted: #9ca9c8;
  --line: rgba(169, 190, 231, .16);
  --blue: #5d9bff;
  --cyan: #69e1e4;
  --panel: rgba(24, 35, 62, .88);
}

* { box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; margin: 0; }
body { overflow: hidden; background: #080c18; color: var(--ink); -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
.app-root { width: 100%; height: 100%; min-height: 0; display: grid; place-items: center; overflow: clip; padding: 10px; font-family: var(--font-body); }
.loading-screen { width: 100%; height: 100%; display: grid; place-items: center; color: #aeb9d3; font: 400 14px var(--font-body); }
.game-shell { position: relative; width: min(390px, calc(100% - 2px)); height: min(598px, calc(100% - 2px)); aspect-ratio: 390 / 598; overflow: hidden; container-type: size; isolation: isolate; background: radial-gradient(circle at 18% 13%, #263d66 0, transparent 30%), radial-gradient(circle at 89% 74%, #1b3c4c 0, transparent 32%), linear-gradient(150deg, #111a31 0%, #0b1122 53%, #0a1421 100%); border: 1px solid rgba(158, 190, 237, .17); border-radius: 27px; box-shadow: 0 24px 70px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.08); }
.ambient { position: absolute; z-index: -1; border-radius: 50%; filter: blur(2px); opacity: .42; pointer-events: none; }
.ambient-one { width: 170px; height: 170px; left: -92px; top: 272px; background: #425a99; }
.ambient-two { width: 190px; height: 190px; right: -106px; top: 76px; background: #1d6f76; }
.topline { position: absolute; left: 21px; right: 21px; top: 17px; height: 38px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; z-index: 5; }
.sender-chip { display: flex; align-items: center; gap: 8px; color: #c7d0e5; font: 700 10px var(--font-display); letter-spacing: .08em; text-transform: uppercase; }
.sender-avatar { position: relative; width: 27px; height: 27px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.4); border-radius: 50%; background: linear-gradient(135deg, #91aaf4, #5c6be4); box-shadow: 0 5px 14px rgba(35,71,165,.4); }
.sender-avatar span { font: 700 12px var(--font-display); color: white; }
.sender-avatar i { position: absolute; right: -1px; bottom: 0; width: 7px; height: 7px; border: 2px solid #111a31; border-radius: 50%; background: #77e4ba; }
.round-hud { justify-self: center; font: 700 22px var(--font-display); letter-spacing: .06em; color: #f6f9ff; text-shadow: 0 2px 12px rgba(104,169,255,.55); }
.signal-dot { justify-self: end; width: 7px; height: 7px; border-radius: 50%; background: #68e1c4; box-shadow: 0 0 0 5px rgba(104,225,196,.1), 0 0 15px #68e1c4; }
.hint { position: absolute; z-index: 4; top: 65px; left: 50px; right: 50px; margin: 0; text-align: center; white-space: nowrap; color: #c1cce3; font: 400 11px/1.45 var(--font-body); letter-spacing: .01em; animation: hint-in .45s ease both; }
@keyframes hint-in { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
.attachment { position: absolute; left: 24px; right: 24px; top: 95px; bottom: 39px; min-height: 0; padding: 14px 14px 15px; border: 1px solid var(--line); border-radius: 21px; background: linear-gradient(145deg, rgba(34,48,82,.82), rgba(14,23,44,.89)); box-shadow: inset 0 1px rgba(255,255,255,.06), 0 18px 40px rgba(2,8,21,.25); display: flex; flex-direction: column; }
.attachment-top { flex: 0 0 auto; height: 20px; display: flex; align-items: center; gap: 8px; color: #7585a8; font: 700 9px var(--font-display); letter-spacing: .16em; }
.attachment-line { height: 1px; flex: 1; background: var(--line); }
.attachment-mark { color: #667897; font-size: 12px; letter-spacing: 2px; margin-top: -5px; }
.video-stage, .grid-stage, .success-stage { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.video-stage { padding: 11px 6px 0; }
.video-copy { display: flex; justify-content: space-between; align-items: baseline; margin: 0 1px 9px; }
.video-copy span { color: var(--cyan); font: 700 10px var(--font-display); letter-spacing: .16em; }
.video-copy b { color: #8191b2; font: 400 10px var(--font-body); }
.video-window { position: relative; flex: 1; min-height: 0; overflow: hidden; display: grid; place-items: center; border: 1px solid rgba(157, 188, 232, .18); border-radius: 15px; background: radial-gradient(circle at 50% 36%, rgba(73,113,174,.3), rgba(14,24,47,.76) 67%); }
.video-window:after { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(255,255,255,.07), transparent 37%, rgba(65,215,221,.05)); pointer-events: none; }
.video-window img { position: relative; z-index: 1; width: 78%; height: 78%; object-fit: contain; animation: moment-pop .9s cubic-bezier(.2,.8,.2,1) both; filter: drop-shadow(0 12px 16px rgba(0,0,0,.25)); }
.video-glow { position: absolute; width: 47%; aspect-ratio: 1; border-radius: 50%; background: rgba(103, 224, 225, .18); filter: blur(26px); }
.play-pulse { position: absolute; z-index: 2; right: 12px; bottom: 12px; width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.35); border-radius: 50%; background: rgba(7,15,31,.52); }
.play-pulse span { width: 0; height: 0; margin-left: 2px; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 7px solid #dceaff; }
@keyframes moment-pop { from { opacity: 0; transform: scale(.72) rotate(-4deg); } to { opacity: 1; transform: scale(1) rotate(0); } }
.replay-button { flex: 0 0 auto; align-self: center; display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; margin-top: 11px; padding: 0 14px; border: 1px solid rgba(157, 188, 232, .2); border-radius: 12px; color: #cbd8f0; background: rgba(8,17,34,.42); font: 700 11px var(--font-display); cursor: pointer; transition: transform .16s ease, border-color .16s ease, background .16s ease; }
.replay-button:active, .verify-button:active, .memory-tile:active { transform: scale(.96); }
.replay-button:hover { border-color: rgba(105,225,228,.55); background: rgba(34,72,97,.45); }
.replay-button svg { width: 15px; height: 15px; fill: none; stroke: #7de4e5; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.grid-stage { padding: 12px 1px 0; }
.grid-heading { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; margin: 0 2px 10px; color: #edf2ff; font: 700 14px var(--font-display); }
.grid-heading b { display: grid; place-items: center; min-width: 26px; height: 23px; padding: 0 7px; border: 1px solid rgba(101,225,226,.28); border-radius: 8px; color: var(--cyan); background: rgba(64,178,186,.1); font: 700 12px var(--font-display); }
.memory-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); gap: 8px; }
.memory-tile { position: relative; min-width: 0; min-height: 0; overflow: hidden; display: grid; place-items: center; border: 1px solid rgba(165,190,232,.14); border-radius: 13px; background: linear-gradient(145deg, rgba(39,57,91,.82), rgba(20,30,55,.82)); cursor: pointer; transition: transform .16s ease, border-color .16s ease, background .16s ease, box-shadow .16s ease; }
.memory-tile img { width: 78%; height: 78%; object-fit: contain; filter: drop-shadow(0 5px 6px rgba(0,0,0,.23)); transition: transform .2s ease; }
.memory-tile:hover img { transform: scale(1.06); }
.memory-tile.is-selected { border-color: #68e1e4; background: linear-gradient(145deg, rgba(44,111,133,.72), rgba(24,61,83,.83)); box-shadow: inset 0 0 0 1px rgba(104,225,228,.18), 0 0 15px rgba(72,201,214,.13); }
.memory-tile.is-selected img { transform: scale(.9); }
.tile-check { position: absolute; right: 6px; top: 6px; width: 18px; height: 18px; display: grid; place-items: center; border: 1px solid rgba(191,213,246,.32); border-radius: 6px; background: rgba(12,22,43,.5); transition: background .16s ease, border-color .16s ease; }
.tile-check svg { width: 13px; height: 13px; fill: none; stroke: transparent; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.is-selected .tile-check { border-color: #8cf5ed; background: #55bfc5; }
.is-selected .tile-check svg { stroke: #082335; }
.grid-actions { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; gap: 9px; padding-top: 10px; }
.grid-replay { margin-top: 0; min-height: 38px; padding: 0 11px; }
.verify-button { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 9px; padding: 0 17px; border: 0; border-radius: 12px; color: #081b30; background: linear-gradient(135deg, #8ce8e0, #70aefa); box-shadow: 0 8px 18px rgba(74,169,218,.22); font: 700 12px var(--font-display); cursor: pointer; transition: transform .16s ease, filter .16s ease; }
.verify-button:hover { filter: brightness(1.08); }
.verify-button svg { width: 16px; height: 16px; fill: none; stroke: #103658; stroke-width: 2.3; stroke-linecap: round; stroke-linejoin: round; }
.failure-feedback { flex: 0 0 auto; min-height: 17px; margin: 7px 0 -2px; text-align: center; color: #ffc7b9; font: 400 10px var(--font-body); animation: feedback-in .25s ease both; }
@keyframes feedback-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
.success-stage { align-items: center; justify-content: center; text-align: center; padding: 10px 10px 30px; animation: success-in .5s ease both; }
@keyframes success-in { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: scale(1); } }
.unlock-orbit { position: relative; width: 130px; height: 130px; display: grid; place-items: center; margin-bottom: 17px; }
.unlock-symbol { position: relative; z-index: 2; width: 76px; height: 76px; display: grid; place-items: center; border: 1px solid rgba(146,240,229,.72); border-radius: 25px; background: linear-gradient(145deg, rgba(105,225,228,.23), rgba(91,143,242,.22)); box-shadow: 0 0 35px rgba(103,225,226,.23), inset 0 0 18px rgba(170,255,240,.09); animation: unlock-breathe 1.4s ease-in-out infinite alternate; }
.unlock-symbol svg { width: 43px; height: 43px; fill: none; stroke: #9af4e9; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
@keyframes unlock-breathe { from { transform: scale(.94) rotate(-3deg); } to { transform: scale(1.04) rotate(3deg); } }
.orbit { position: absolute; border: 1px solid rgba(108,222,234,.35); border-radius: 50%; transform: rotate(23deg); }
.orbit-a { width: 112px; height: 48px; animation: orbit-a 2.8s linear infinite; }
.orbit-b { width: 48px; height: 112px; border-color: rgba(119,164,250,.36); animation: orbit-b 3.5s linear infinite reverse; }
@keyframes orbit-a { to { transform: rotate(383deg); } }
@keyframes orbit-b { to { transform: rotate(-337deg); } }
.success-label { color: #8df0e4; font: 700 20px var(--font-display); letter-spacing: .02em; }
.success-stage p { margin: 5px 0 15px; color: #dce7fb; font: 400 12px var(--font-body); }
.next-thread { color: #8394b4; font: 700 9px var(--font-display); letter-spacing: .18em; text-transform: uppercase; }
.bottom-note { position: absolute; left: 0; right: 0; bottom: 13px; display: flex; align-items: center; justify-content: center; gap: 7px; color: #657494; font: 700 8px var(--font-display); letter-spacing: .14em; text-transform: uppercase; }
.note-dot { width: 3px; height: 3px; border-radius: 50%; background: #61cfd0; }
@media (max-height: 520px) { .app-root { padding: 3px; } .game-shell { width: min(390px, calc(100% - 2px)); height: min(598px, calc(100% - 2px)); } .attachment { top: 69px; bottom: 27px; } .topline { top: 9px; } .hint { top: 49px; } .bottom-note { bottom: 5px; } }
`;

function Root() {
  return <><style>{styles}</style><App /></>;
}

createRoot(document.getElementById('root')).render(<><Root/><BatchPolish/></>);
