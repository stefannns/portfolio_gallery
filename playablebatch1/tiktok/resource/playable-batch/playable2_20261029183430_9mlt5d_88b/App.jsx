
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const CSS = `
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
body { background: #f1f6ff; color: #282b2c; -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
.app-shell { width: 100%; height: 100%; min-height: 0; overflow: clip; position: relative; background: #f1f6ff; font-family: var(--font-body); }
.canvas { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; position: relative; }
.topline { flex: 0 0 auto; height: 58px; display: flex; align-items: center; justify-content: center; position: relative; z-index: 3; }
.wordmark { color: #303536; letter-spacing: .22em; font-family: var(--font-display); font-weight: 700; font-size: 13px; text-transform: uppercase; opacity: .78; }
.stage-area { flex: 1 1 auto; min-height: 0; position: relative; display: flex; align-items: stretch; justify-content: center; overflow: hidden; }
.orbit-stage { width: min(100%, 480px); height: 100%; min-height: 0; position: relative; touch-action: manipulation; }
.orbit-svg { width: 100%; height: 100%; display: block; overflow: visible; }
.intro-guide { position: absolute; z-index: 5; top: 28px; left: 50%; transform: translateX(-50%); white-space: nowrap; color: #353a39; font-family: var(--font-display); font-weight: 700; font-size: clamp(13px, 3.8cqi, 17px); letter-spacing: .01em; animation: breathe 2.2s ease-in-out infinite; pointer-events: none; }
@keyframes breathe { 0%, 100% { opacity: .48; transform: translateX(-50%) translateY(0); } 50% { opacity: 1; transform: translateX(-50%) translateY(-3px); } }
.hud { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); z-index: 5; width: min(88%, 360px); display: flex; justify-content: center; align-items: flex-start; text-align: center; pointer-events: none; }
.hud-item { min-width: 62px; color: #303536; }
.hud-item.center { text-align: center; }
.hud-item.right { text-align: right; }
.hud-value { display: block; font-family: var(--font-display); font-weight: 700; font-size: 26px; line-height: 1; letter-spacing: -.04em; }
.hud-label { display: block; margin-top: 5px; font-family: var(--font-body); font-size: 10px; letter-spacing: .15em; text-transform: uppercase; color: #8d928b; }
.pause-control { position: absolute; z-index: 8; right: 22px; bottom: 20px; width: 46px; height: 46px; border: 1px solid rgba(48,53,54,.18); border-radius: 50%; background: rgba(241,246,255,.88); color: #303536; display: grid; place-items: center; cursor: pointer; box-shadow: 0 5px 16px rgba(48,53,54,.06); backdrop-filter: blur(8px); }
.pause-control:active { transform: scale(.94); }
.pause-control svg { width: 18px; height: 18px; }
.status-note { position: absolute; z-index: 5; left: 50%; bottom: 22px; transform: translateX(-50%); color: #78817a; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; pointer-events: none; }
.result-layer { position: absolute; z-index: 12; inset: 0; display: flex; align-items: center; justify-content: center; padding: 70px 24px 44px; background: rgba(241,246,255,.88); }
.result-card { width: min(100%, 350px); text-align: center; color: #303536; }
.result-kicker { font-family: var(--font-body); font-size: 11px; letter-spacing: .28em; text-transform: uppercase; color: #8b938a; margin-bottom: 11px; }
.result-title { font-family: var(--font-display); font-size: 25px; line-height: 1.1; font-weight: 700; margin: 0 0 25px; }
.result-stats { display: flex; justify-content: center; align-items: center; gap: 31px; margin-bottom: 27px; }
.result-stat { min-width: 76px; }
.result-number { display: block; font-family: var(--font-display); font-size: 42px; line-height: 1; font-weight: 700; letter-spacing: -.07em; }
.result-label { display: block; margin-top: 8px; color: #8b938a; font-size: 10px; letter-spacing: .16em; text-transform: uppercase; }
.retry-button { min-height: 48px; padding: 0 28px; border: 0; border-radius: 24px; background: #303536; color: #f7f3eb; font-family: var(--font-display); font-size: 15px; font-weight: 700; cursor: pointer; box-shadow: 0 8px 16px rgba(48,53,54,.13); }
.retry-button:active { transform: translateY(1px) scale(.98); }
.result-actions { display: flex; justify-content: center; align-items: center; gap: 10px; flex-wrap: wrap; }
.unlocks { margin-top: 30px; }
.unlocks-label { color: #8b938a; font-size: 10px; letter-spacing: .2em; text-transform: uppercase; margin-bottom: 11px; }
.swatches { display: flex; justify-content: center; gap: 9px; flex-wrap: wrap; }
.swatch { width: 27px; height: 27px; padding: 0; border-radius: 50%; border: 2px solid transparent; cursor: pointer; position: relative; }
.swatch.selected { border-color: #303536; box-shadow: 0 0 0 2px #f1f6ff; }
.swatch.locked { opacity: .2; cursor: default; }
.swatch span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-height: 620px) { .topline { height: 42px; } .intro-guide { top: 15px; } .result-layer { padding-top: 40px; } .result-title { margin-bottom: 17px; } .unlocks { margin-top: 17px; } }
.topline { display:none; }
.intro-guide { top:26%; width:max-content; max-width:calc(100% - 60px); white-space:normal; text-align:center; font-size:18px; line-height:1.35; letter-spacing:0; }
.hud { top:30px; left:30px; right:30px; width:auto; transform:none; }
.hud-value { font-size:28px; line-height:1.15; letter-spacing:0; }
.hud-label { font-size:11px; letter-spacing:.04em; color:#72796f; }
.pause-control { right:30px; bottom:50px; width:46px; height:46px; }
.status-note { bottom:64px; }
.result-layer { padding:30px 30px 50px; }
.result-title { font-size:24px; }
.swatches { display:grid; grid-template-columns:repeat(4,44px); gap:8px 12px; }
.swatch { width:44px; height:44px; }
.swatch:focus-visible,.retry-button:focus-visible,.pause-control:focus-visible { outline:3px solid #607f6a; outline-offset:3px; }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }

.hud { justify-content:center; }

`;

const DEFAULT_CFG = {
  BG_PAPER: './assets/yellow-paper-dots-v3.svg',
  ORBIT_SPEED: 0.0018,
  FLIGHT_MS: 560,
  TARGET_RADIUS: 52,
  SWEET_HALF_ANGLE: 0.42,
  FLIGHT_SPEED: 0.42,
  CAPTURE_BAND: 8,
  SPEED_PER_LAUNCH: 15,
  SCORE_PER_CATCH: 1,
  GAME_TITLE: 'Orbit Jump B',
  GUIDE: 'Tap to launch, aim at next orbit',
  SCORE_LABEL: 'Score',
  BEST_LABEL: 'Best',
  PERFECT_LABEL: 'Perfect',
  MISS_LABEL: 'Miss',
  PAUSED_LABEL: 'Paused',
  PLAY_AGAIN: 'Play again',
  UNLOCKED_LABEL: 'Unlocked',
  PAUSE_LABEL: 'Pause',
  RESUME_LABEL: 'Resume',
};

const PALETTES = {
 charcoal:{name:'charcoal',ink:'#20211f',planet:'#fffdf5',planetHi:'#fffdf5',sage:'#3c9758',faint:'#20211f'},
 sage:{name:'sage',ink:'#16756e',planet:'#9fe2cd',planetHi:'#edfff5',sage:'#19bb78',faint:'#acd8d1'},
 ivory:{name:'ivory',ink:'#3375bd',planet:'#c3e3ff',planetHi:'#f2fbff',sage:'#20bc7d',faint:'#bfd5ee'},
 'matte gold':{name:'matte gold',ink:'#d37821',planet:'#ffd28b',planetHi:'#fff3d8',sage:'#24ba7f',faint:'#ebce9e'},
 'slate blue':{name:'slate blue',ink:'#3c5be5',planet:'#b7c9ff',planetHi:'#edf3ff',sage:'#20bf84',faint:'#bdc9ec'},
 'powder pink':{name:'powder pink',ink:'#ce5982',planet:'#ffbfd6',planetHi:'#fff1f6',sage:'#25b983',faint:'#e9bed2'},
 'soft peach':{name:'soft peach',ink:'#d86e48',planet:'#ffd2b5',planetHi:'#fff3e8',sage:'#20be85',faint:'#edc8b3'},
 'pale lilac':{name:'pale lilac',ink:'#8454d9',planet:'#d6beff',planetHi:'#f7efff',sage:'#27be85',faint:'#d3c0ed'}
};
const UNLOCKS = ['charcoal', 'sage', 'ivory', 'matte gold', 'slate blue', 'powder pink', 'soft peach', 'pale lilac'];
function safeNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function speedMultiplier(launches, cfg) {
  const increase = Math.max(0, safeNumber(cfg.SPEED_PER_LAUNCH, 15)) / 100;
  return Math.pow(1 + increase, Math.max(0, launches));
}

function flattenConfig(data) {
  const next = { ...DEFAULT_CFG };
  (data?.tweaks || []).forEach((item) => { next[item.id] = safeNumber(item.value, next[item.id]); });
  (data?.texts || []).forEach((item) => { next[item.id] = typeof item.value === 'string' ? item.value : next[item.id]; });
  (data?.images || []).forEach((item) => { if (typeof item.path === 'string') next[item.id] = item.path; });
  return next;
}

function useRecordingSubmission() {
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
  const submitRecording = useCallback(() => {
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    tt.playableRecordingSubmission({
      success() {},
      fail(err) {
        console.error('[post_my_play] playableRecordingSubmission failed', err && (err.errMsg || err.message));
        setSubmitting(false);
      },
      complete() {},
    });
  }, [canSubmit, submitting]);
  return { canSubmit, submitting, submitRecording };
}

function PostMyPlayButton() {
  const { canSubmit, submitting, submitRecording } = useRecordingSubmission();
  if (!canSubmit) return null;
  return <button type="button" className="retry-button" disabled={submitting} onClick={submitRecording} style={{ opacity: submitting ? 0.55 : 1 }}>Post my play</button>;
}

function vibrate(style) {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style: style || 'light' });
  } catch (error) { /* optional haptics */ }
}

function pointOnCircle(cx, cy, radius, angle) {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

function arcPath(cx, cy, radius, startAngle, endAngle) {
  const start = pointOnCircle(cx, cy, radius, startAngle);
  const end = pointOnCircle(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function rayCircleEntry(start, direction, center, radius) {
  const x = start.x - center.x, y = start.y - center.y;
  const along = x * direction.x + y * direction.y;
  const outside = x * x + y * y - radius * radius;
  if (outside <= 0) return 0;
  const discriminant = along * along - outside;
  if (discriminant < -1e-8) return null;
  const distance = -along - Math.sqrt(Math.max(0, discriminant));
  return distance >= -1e-8 ? Math.max(0, distance) : null;
}

function traceOrbitLaunch(orbit, destination, angle, spin = 1, band = 8) {
  const start = pointOnCircle(orbit.x, orbit.y, orbit.r, angle);
  // Differentiate the circular motion: launch along velocity, never toward a preset target.
  const direction = { x: -Math.sin(angle) * spin, y: Math.cos(angle) * spin };
  const ahead = (destination.x - start.x) * direction.x + (destination.y - start.y) * direction.y;
  const nearest = { x: start.x + direction.x * Math.max(0, ahead), y: start.y + direction.y * Math.max(0, ahead) };
  const clearance = Math.hypot(nearest.x - destination.x, nearest.y - destination.y);
  // Catch as soon as the flight reaches the next orbit. Center-bound
  // trajectories cross that ring too; the planet is no longer a hazard.
  const ringDistance = rayCircleEntry(start, direction, destination, destination.r);
  const nearDistance = rayCircleEntry(start, direction, destination, destination.r + band);
  const catches = ringDistance !== null || (ahead > 0 && nearDistance !== null);
  const distance = catches ? (ringDistance ?? Math.max(0, ahead)) : null;
  return { start, direction, destination, distance, outcome: catches ? 'catch' : 'miss', clearance, perfect: catches && Math.abs(clearance - destination.r) <= band };
}

function launchHintWindows(orbit, destination, spin, band) {
  const count = 1024, step = Math.PI * 2 / count, groups = [];
  let group = null;
  for (let index = 0; index < count; index += 1) {
    const angle = (index + .5) * step;
    const trajectory = traceOrbitLaunch(orbit, destination, angle, spin, band);
    if (trajectory.outcome !== 'catch') { group = null; continue; }
    if (!group) { group = []; groups.push(group); }
    group.push({ index, angle, distance: trajectory.distance });
  }
  // A window crossing zero radians is one arc, rather than two separate hints.
  if (groups.length > 1 && groups[0][0].index === 0 && groups[groups.length - 1][groups[groups.length - 1].length - 1].index === count - 1) {
    const first = groups.shift();
    groups[groups.length - 1].push(...first.map(sample => ({ ...sample, angle: sample.angle + Math.PI * 2 })));
  }
  // Highlight every successful launch angle, including paths through the center.
  return groups.filter(samples => samples.length >= 2).map(samples => {
    const startAngle = samples[0].angle + step * .25;
    const endAngle = samples[samples.length - 1].angle - step * .25;
    return {
      startAngle, endAngle, centerAngle: (startAngle + endAngle) / 2,
      start: pointOnCircle(orbit.x, orbit.y, orbit.r, startAngle),
      end: pointOnCircle(orbit.x, orbit.y, orbit.r, endAngle),
      path: arcPath(orbit.x, orbit.y, orbit.r, startAngle, endAngle),
    };
  });
}

const feedSession = (() => {
  const embedded = parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !embedded;
  window.addEventListener('message', event => {
    if (embedded && event.source === parent && event.origin === location.origin && event.data?.type === 'playable-active') active = event.data.active === true;
  });
  return { get active() { return active && !document.hidden; } };
})();

function App() {
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const cfgRef = useRef(DEFAULT_CFG);
  const [status, setStatus] = useState('ready');
  const statusRef = useRef('ready');
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const launchCountRef = useRef(0);
  const [games, setGames] = useState(() => {
    try { return Number(localStorage.getItem('orbit-jump-88b-games') || 0); } catch (error) { return 0; }
  });
  const gamesRef = useRef(games);
  const [level, setLevel] = useState(0);
  const levelRef = useRef(0);
  const [paletteName, setPaletteName] = useState('charcoal');
  const [lastResult, setLastResult] = useState('miss');
  const [catchPulse, setCatchPulse] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const stageRef = useRef(null);
  const playerRef = useRef(null);
  const launchGuideRef = useRef(null);
  const trailRefs = useRef([]);
  const rafRef = useRef(0);
  const timeoutRefs = useRef([]);
  const angleRef = useRef(-Math.PI / 2);
  const spinRef = useRef(1);
  const currentOrbitRef = useRef({ x: 200, y: 335, r: 98 });
  const flightRef = useRef(null);
  const audioRef = useRef({ ctx: null, gain: null, buffers: new Map(), sources: new Set() });
  const gameCountedRef = useRef(false);

  const palette = PALETTES[paletteName] || PALETTES.charcoal;
  cfgRef.current = cfg;
  statusRef.current = status;
  scoreRef.current = score;
  levelRef.current = level;

  useEffect(() => {
    let cancelled = false;
    fetch('./game.config.json')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled && data) setCfg(flattenConfig(data)); })
      .catch(() => { /* fallback config keeps the game playable */ });
    return () => { cancelled = true; };
  }, []);

  const ensureAudio = useCallback(() => {
    if (!feedSession.active) return null;
    const audio = audioRef.current;
    if (!audio.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      audio.ctx = new AudioContextClass();
      audio.gain = audio.ctx.createGain();
      audio.gain.gain.value = 0.18;
      audio.gain.connect(audio.ctx.destination);
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
    return audio.ctx;
  }, []);

  const playCue = useCallback((kind) => {
    const audio = audioRef.current;
    const ctx = ensureAudio();
    if (!ctx) return;
    const now=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain(),miss=kind==='miss';
    const duration=miss?.18:kind==='launch'?.10:.075;osc.type='sine';osc.frequency.setValueAtTime(miss?165:kind==='catch'?640:kind==='launch'?380:500,now);osc.frequency.exponentialRampToValueAtTime(miss?78:kind==='launch'?760:370,now+duration);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(miss?.3:.36,now+.005);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);osc.connect(gain);gain.connect(audio.gain);audio.sources.add(osc);osc.start(now);osc.stop(now+duration+.015);osc.onended=()=>{audio.sources.delete(osc);osc.disconnect();gain.disconnect();};
  }, [ensureAudio]);

  const targetLayout = useCallback((index) => {
    const layouts = [
      { x: 307, y: 202, orbit: 51, arc: 2.15 },
      { x: 92, y: 205, orbit: 56, arc: 0.85 },
      { x: 305, y: 446, orbit: 50, arc: -2.45 },
      { x: 91, y: 443, orbit: 57, arc: -0.7 },
      { x: 318, y: 326, orbit: 49, arc: 2.8 },
      { x: 83, y: 325, orbit: 54, arc: 0.25 },
    ];
    const base = layouts[index % layouts.length];
    return { ...base, orbit: safeNumber(cfgRef.current.TARGET_RADIUS, base.orbit) };
  }, []);

  const drawMotion = useCallback((point, trailingPoint, opacity = 1) => {
    if (playerRef.current) playerRef.current.setAttribute('transform', `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`);
    trailRefs.current.forEach((line, index) => {
      if (!line) return;
      const t = (index + 1) / 4;
      const x = point.x + (trailingPoint.x - point.x) * t;
      const y = point.y + (trailingPoint.y - point.y) * t;
      line.setAttribute('x1', '0');
      line.setAttribute('y1', '0');
      line.setAttribute('x2', (x - point.x).toFixed(2));
      line.setAttribute('y2', (y - point.y).toFixed(2));
      line.style.opacity = String(opacity * (1 - index * .2));
    });
  }, []);

  const completeMiss = useCallback(() => {
    if (statusRef.current === 'over') return;
    statusRef.current = 'over';
    setStatus('over');
    setLastResult('miss');
    playCue('miss');
    vibrate('notification_error');
    const nextGames = gamesRef.current + 1;
    gamesRef.current = nextGames;
    setGames(nextGames);
    try { localStorage.setItem('orbit-jump-88b-games', String(nextGames)); } catch (error) { /* storage optional */ }
    console.info('[Orbit Jump B] miss', { score: scoreRef.current });
  }, [playCue]);

  const completeCatch = useCallback(() => {
    const nextScore = scoreRef.current + safeNumber(cfgRef.current.SCORE_PER_CATCH, 1);
    scoreRef.current = nextScore;
    setScore(nextScore);
    playCue('catch');
    vibrate('medium');
    setCatchPulse(true);
    timeoutRefs.current.push(window.setTimeout(() => setCatchPulse(false), 500));
    const nextLevel = levelRef.current + 1;
    levelRef.current = nextLevel;
    setLevel(nextLevel);
    console.info('[Orbit Jump B] catch', { score: nextScore, orbit: nextLevel });
  }, [playCue]);

  const launch = useCallback(() => {
    if (statusRef.current === 'over' || statusRef.current === 'paused' || flightRef.current) return;
    const orbit = currentOrbitRef.current;
    const layout = targetLayout(levelRef.current);
    const destination = { x: layout.x, y: layout.y, r: layout.orbit };
    launchCountRef.current += 1;
    flightRef.current = {
      ...traceOrbitLaunch(orbit, destination, angleRef.current, spinRef.current, safeNumber(cfgRef.current.CAPTURE_BAND, 8)),
      travelled: 0,
      speed: Math.max(0.1, safeNumber(cfgRef.current.FLIGHT_SPEED, 0.42)) * speedMultiplier(launchCountRef.current, cfgRef.current),
    };
    if (!hasInteracted) setHasInteracted(true);
    if (!gameCountedRef.current) gameCountedRef.current = true;
    statusRef.current = 'active';
    setStatus('active');
    playCue('launch');
    vibrate('light');
    console.info('[Orbit Jump B] tangent launch', { direction: flightRef.current.direction, angle: Number(angleRef.current.toFixed(2)) });
  }, [hasInteracted, playCue, targetLayout]);

  const handleStageClick = useCallback((event) => {
    if (event.defaultPrevented || !feedSession.active || flightRef.current || statusRef.current === 'over' || statusRef.current === 'paused') return;
    launch();
  }, [launch]);

  const togglePause = useCallback((event) => {
    event.stopPropagation();
    if (statusRef.current === 'over' || !hasInteracted) return;
    playCue('click');
    vibrate('light');
    const next = statusRef.current === 'paused' ? 'active' : 'paused';
    statusRef.current = next;
    setStatus(next);
  }, [hasInteracted, playCue]);

  const resetGame = useCallback(() => {
    playCue('click');
    vibrate('light');
    flightRef.current = null;
    angleRef.current = -Math.PI / 2;
    spinRef.current = 1;
    currentOrbitRef.current = { x: 200, y: 335, r: 98 };
    levelRef.current = 0;
    scoreRef.current = 0;
    launchCountRef.current = 0;
    gameCountedRef.current = false;
    setScore(0);
    setLevel(0);
    setLastResult('miss');
    setHasInteracted(true);
    statusRef.current = 'active';
    setStatus('active');
    console.info('[Orbit Jump] restart');
  }, [playCue]);

  useEffect(() => {
    let lastTime = performance.now();
    let launchHighlightOpacity = 0;
    const highlightMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const tick = (time) => {
      const rawDt = time - lastTime;
      const dt = Math.min(Math.max(rawDt, 0), 32);
      lastTime = time;
      const currentStatus = statusRef.current;
      const running = (currentStatus === 'ready' || currentStatus === 'active') && !document.hidden && (currentStatus === 'ready' || feedSession.active) && !(window.PlayableIdlePreview.preview&&window.PlayableIdlePreview.reduced);
      if (running) {
        if (!flightRef.current) angleRef.current += safeNumber(cfgRef.current.ORBIT_SPEED, .0018) * speedMultiplier(launchCountRef.current, cfgRef.current) * spinRef.current * dt;
      }
      if (flightRef.current && running) {
        const flight = flightRef.current;
        flight.travelled += flight.speed * dt;
        const reached = flight.distance !== null && flight.travelled >= flight.distance;
        const distance = reached ? flight.distance : flight.travelled;
        const point = {
          x: flight.start.x + flight.direction.x * distance,
          y: flight.start.y + flight.direction.y * distance,
        };
        const prior = { x: point.x - flight.direction.x * 30, y: point.y - flight.direction.y * 30 };
        drawMotion(point, prior, 1);
        if (reached || point.x < -25 || point.x > 425 || point.y < -97 || point.y > 603 || flight.travelled > 1400) {
          flightRef.current = null;
          if (reached && flight.outcome === 'catch') {
            currentOrbitRef.current = flight.destination;
            angleRef.current = Math.atan2(point.y - flight.destination.y, point.x - flight.destination.x);
            const cross = (point.x - flight.destination.x) * flight.direction.y - (point.y - flight.destination.y) * flight.direction.x;
            spinRef.current = cross < 0 ? -1 : 1;
            completeCatch();
          } else {
            completeMiss();
          }
        }
      } else if (!flightRef.current && currentStatus !== 'over') {
        const orbit = currentOrbitRef.current;
        const point = pointOnCircle(orbit.x, orbit.y, orbit.r, angleRef.current);
        const trail = pointOnCircle(orbit.x, orbit.y, orbit.r, angleRef.current - .12 * spinRef.current);
        drawMotion(point, trail, currentStatus === 'paused' || currentStatus === 'over' ? .25 : .72);
      }
      if (stageRef.current) {
        window.PlayableIdlePreview.stamp(stageRef.current,"orbit-and-launch-window");
        stageRef.current.dataset.angle = String(angleRef.current);
        stageRef.current.dataset.orbitX = String(currentOrbitRef.current.x);
        stageRef.current.dataset.orbitY = String(currentOrbitRef.current.y);
        stageRef.current.dataset.motion = flightRef.current ? 'flight' : 'orbit';
        stageRef.current.dataset.speedMultiplier = String(speedMultiplier(launchCountRef.current, cfgRef.current));
      }
      if (launchGuideRef.current) {
        const target = flightRef.current || statusRef.current === 'over' ? 0 : 1;
        launchHighlightOpacity = highlightMotion.matches ? target : launchHighlightOpacity + (target - launchHighlightOpacity) * (1 - Math.exp(-dt / (target ? 220 : 75)));
        launchGuideRef.current.style.opacity = String(launchHighlightOpacity);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [completeCatch, completeMiss, drawMotion, targetLayout]);

  useEffect(() => () => {
    timeoutRefs.current.forEach((id) => window.clearTimeout(id));
    audioRef.current.sources.forEach((source) => { try { source.stop(); } catch (error) { /* already ended */ } });
    if (audioRef.current.ctx) audioRef.current.ctx.close().catch(() => {});
  }, []);

  const layout = targetLayout(level);
  const currentOrbit = currentOrbitRef.current;
  const launchHints = useMemo(() => launchHintWindows(currentOrbit, { x: layout.x, y: layout.y, r: layout.orbit }, spinRef.current, safeNumber(cfg.CAPTURE_BAND, 8)),
    [currentOrbit, layout.x, layout.y, layout.orbit, cfg.CAPTURE_BAND, spinRef.current]);
  const unlocked = useMemo(() => {
    const conditions = {
      charcoal: true,
      sage: score >= 10,
      ivory: games >= 10,
      'matte gold': score >= 25,
      'slate blue': score >= 30,
      'powder pink': score >= 50,
      'soft peach': games >= 20,
      'pale lilac': score >= 40,
    };
    return conditions;
  }, [games, score]);

  const stageStatusText = status === 'paused' ? cfg.PAUSED_LABEL : (lastResult === 'miss' && status === 'over' ? cfg.MISS_LABEL : '');
  const background = '#ffd34d';

  return (
    <>
      <style>{CSS}</style>
      <main className="app-shell" style={{ background, backgroundImage: `url("${cfg.BG_PAPER}")`, backgroundSize: 'cover', '--paper-image': `url("${cfg.BG_PAPER}")` }}>
        <div className="canvas">
          <div className="topline"><div className="wordmark">{cfg.GAME_TITLE}</div></div>
          <div className="stage-area">
            <div
              className="orbit-stage"
              data-testid="orbit-stage"
              ref={stageRef}
              onPointerDown={() => { ensureAudio(); }}
              onClick={handleStageClick}
              style={{ containerType: 'inline-size' }}
            >
              {!hasInteracted && status === 'ready' && <div className="intro-guide">{cfg.GUIDE}</div>}
              {hasInteracted && status !== 'over' && (
                <div className="hud">
                  <div className="hud-item"><span className="hud-value score-value">{score}</span><span className="hud-label">{cfg.SCORE_LABEL}</span></div>
                </div>
              )}
              <svg className="orbit-svg" viewBox="0 -72 400 650" role="img" aria-label={cfg.GAME_TITLE}>
                <circle cx={currentOrbit.x} cy={currentOrbit.y} r={currentOrbit.r} fill="none" stroke={palette.ink} strokeWidth="2.3" opacity=".72" />
                <g ref={launchGuideRef} style={{opacity:0}} data-testid="launch-sweet-guide" pointerEvents="none" aria-hidden="true">
                  {launchHints.map((hint, index) => <g key={index}>
                    <path d={hint.path} fill="none" stroke={palette.sage} strokeWidth="15" opacity=".18" strokeLinecap="butt" />
                    <path data-testid="launch-sweet-strip" d={hint.path} fill="none" stroke={palette.sage} strokeWidth="5.5" opacity=".98" strokeLinecap="butt" />
                  </g>)}
                </g>
                <circle cx={currentOrbit.x + 3} cy={currentOrbit.y + 5} r="32" fill={palette.ink} opacity=".13" />
                <circle cx={currentOrbit.x} cy={currentOrbit.y} r="32" fill={palette.planet} stroke={palette.ink} strokeWidth="3" />
                <circle cx={layout.x} cy={layout.y} r={layout.orbit} fill="none" stroke={palette.ink} strokeWidth="2.3" opacity=".72" />
                <circle cx={layout.x + 3} cy={layout.y + 5} r="23" fill={palette.ink} opacity=".13" />
                <circle cx={layout.x} cy={layout.y} r="23" fill={palette.planet} stroke={palette.ink} strokeWidth="3" />
                <g ref={playerRef}>
                  <line ref={(el) => { trailRefs.current[0] = el; }} stroke={palette.ink} strokeWidth="2.6" strokeLinecap="round" />
                  <line ref={(el) => { trailRefs.current[1] = el; }} stroke={palette.ink} strokeWidth="1.8" strokeLinecap="round" />
                  <line ref={(el) => { trailRefs.current[2] = el; }} stroke={palette.ink} strokeWidth="1.1" strokeLinecap="round" />
                  <circle r="6.2" fill="#fffdf5" stroke={palette.ink} strokeWidth="2.3" />
                </g>
                {catchPulse && <circle cx={currentOrbit.x} cy={currentOrbit.y} r="30" fill="none" stroke={palette.sage} strokeWidth="2" opacity=".55" className="pulse-ring" />}
              </svg>
              {hasInteracted && status === 'paused' && <div className="status-note">{stageStatusText}</div>}
              {hasInteracted && status !== 'over' && (
                <button className="pause-control" type="button" aria-label={status === 'paused' ? cfg.RESUME_LABEL : cfg.PAUSE_LABEL} onClick={togglePause}>
                  {status === 'paused' ? <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4.5v11l8-5.5z" fill="currentColor" /></svg> : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4.5v11M14 4.5v11" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" /></svg>}
                </button>
              )}
            </div>
          </div>
          {status === 'over' && (
            <div className="result-layer" data-testid="result-panel">
              <div className="result-card">
                <div className="result-kicker">{cfg.MISS_LABEL}</div>
                <h1 className="result-title">{cfg.GAME_TITLE}</h1>
                <div className="result-stats">
                  <div className="result-stat"><span className="result-number result-score">{score}</span><span className="result-label">{cfg.SCORE_LABEL}</span></div>
                </div>
                <div className="result-actions">
                  <button type="button" className="retry-button" onClick={resetGame}>{cfg.PLAY_AGAIN}</button>
                  <PostMyPlayButton />
                </div>

              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);

/* FEEDBACK_20261103_88B */
(()=>{const style=document.createElement('style');style.textContent=`
@font-face{font-family:DynaPuff;src:url('./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2') format('woff2');font-weight:600;font-style:normal;font-display:swap}
:root{--font-display:DynaPuff,Poppins,sans-serif;--font-body:DynaPuff,Poppins,sans-serif}
body,.app-shell{background-color:#ffd34d;color:#20211f}
.app-shell{user-select:none;-webkit-user-select:none;font-weight:600}
.intro-guide{color:#20211f;font-weight:600}
.hud-item,.hud-label,.result-card,.result-kicker,.result-label,.status-note{color:#20211f}
.hud-value{display:inline-block;position:relative;min-width:64px;padding:3px 10px 5px;border:2.5px solid #20211f;border-radius:2px;background:#ffd34d;font-size:44px;font-weight:600;line-height:1.05;box-shadow:2px 4px 0 #20211f26}
.hud-value::after{content:'';position:absolute;left:0;right:0;top:50%;border-top:1px solid #20211f66;pointer-events:none}
.hud-label{font-size:11px;font-weight:600;letter-spacing:.04em;margin-top:7px}
.pause-control{background:#20211f;color:#fffdf5;border:2.5px solid #20211f;box-shadow:2px 4px 0 #20211f26;backdrop-filter:none}
.pause-control svg{width:21px;height:21px}
.result-layer{background-color:#ffd34df5;background-image:var(--paper-image);background-size:cover;backdrop-filter:none}
.result-title{font-weight:600}
.result-kicker,.result-label{font-weight:600;letter-spacing:.05em}
.result-number{display:inline-block;min-width:100px;padding:7px 16px 10px;font-size:56px;font-weight:600;letter-spacing:0;border:3px solid #20211f;border-radius:2px;background:#fffdf5;box-shadow:3px 5px 0 #20211f26}
.retry-button{border:2.5px solid #20211f;border-radius:6px;background:#ffd34d;color:#20211f;font-weight:600;font-size:18px;box-shadow:3px 5px 0 #20211f33}
.retry-button:active{transform:translate(2px,3px);box-shadow:1px 2px 0 #20211f33}
.retry-button:focus-visible,.pause-control:focus-visible{outline:3px solid #20211f;outline-offset:4px}
`;document.body.append(style);})();
