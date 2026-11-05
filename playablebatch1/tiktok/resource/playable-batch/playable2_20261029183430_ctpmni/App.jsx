
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
    html[data-batch2-idle=true] .tool-swing{animation:idle-tool-hit 2.6s ease-in-out infinite!important;transform-origin:var(--weapon-grip-x) var(--weapon-grip-y)}
    html[data-batch2-idle=true] .tool-swing[data-strike-motion=jab]{animation-name:idle-tool-jab!important}
    html[data-batch2-idle=true] .target-art{animation:idle-stick-react 2.6s ease-in-out infinite!important;transform-origin:50% 75%}
    @keyframes idle-tool-hit{0%,25%,100%{transform:rotate(58deg);opacity:0;visibility:hidden}30%,68%{opacity:1;visibility:visible}34%{transform:rotate(82deg)}46%{transform:rotate(0deg)}52%{transform:rotate(-12deg)}72%{transform:rotate(58deg);opacity:0;visibility:hidden}}
    @keyframes idle-tool-jab{0%,32%,100%{transform:translateX(18px);opacity:0;visibility:hidden}36%,68%{opacity:1;visibility:visible}46%{transform:translateX(0)}55%{transform:translateX(6px)}72%{transform:translateX(18px);opacity:0;visibility:hidden}}
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

const SOUND_FILES = {
  ui: './assets/sfx_ui.mp3',
  light: './assets/sfx_light_hit.mp3',
  heavy: './assets/sfx_heavy_hit.mp3',
  tech: './assets/sfx_tech_hit.mp3',
  boom: './assets/sfx_boom_hit.mp3',
  clear: './assets/sfx_clear.mp3'
};

const DEFAULT_ART = {
  "CHARACTER_MAIN": "./assets/character-imagegen-v2.webp",
  "BACKGROUND_MAIN": "./assets/background-imagegen-v2.webp",
  "TOOL_FIST": "./assets/weapons/fist-imagegen-v2.webp",
  "TOOL_BAT": "./assets/weapons/bat-imagegen-v2.webp",
  "TOOL_KATANA": "./assets/weapons/katana-imagegen-v2.webp",
  "TOOL_SLEDGE": "./assets/weapons/sledge-imagegen-v2.webp",
  "TOOL_LASER": "./assets/weapons/laser-imagegen-v2.webp",
  "TOOL_CHAINSAW": "./assets/weapons/chainsaw-imagegen-v2.webp",
  "TOOL_ROCKET": "./assets/weapons/rocket-imagegen-v2.webp",
  "TOOL_AXE": "./assets/weapons/axe-imagegen-v2.webp",
  "TOOL_BOMB": "./assets/weapons/bomb-imagegen-v2.webp",
  "TOOL_UFO": "./assets/weapons/ufo-imagegen-v2.webp",
  "TOOL_COMET": "./assets/weapons/comet-imagegen-v2.webp",
  "TOOL_ATOMIC": "./assets/weapons/atomic-imagegen-v2.webp",
  "TOOL_PLASMA": "./assets/weapons/plasma-imagegen-v2.webp",
  "TOOL_BLACKHOLE": "./assets/weapons/blackhole-imagegen-v2.webp",
  "TOOL_GALAXY": "./assets/weapons/galaxy-imagegen-v2.webp",
  "TOOL_ADMIN": "./assets/weapons/admin-imagegen-v2.webp",
  "TOOL_AUTO": "./assets/weapons/auto-imagegen-v2.webp"
};

const FALLBACK_CFG = {
  ...DEFAULT_ART,
  BASE_HEALTH: 1000000, HEALTH_MULTIPLIER: 4, LEVEL_REWARD: 1000,
  AUTO_COST: 10000, ADMIN_DAMAGE: 15000000, AUTO_INTERVAL: 760,
  GAME_TITLE: 'STICKMAN CLICKER PRO', GUIDE: 'Tap to hit and upgrade', HEALTH_LABEL: 'HP',
  LEVEL_LABEL: 'LEVEL', COINS_LABEL: 'COINS', STORE_LABEL: 'ARSENAL', EQUIPPED: 'EQUIPPED',
  OWNED: 'OWNED', UNAFFORDABLE: 'LOCKED', FREE: 'FREE', AUTO_NAME: 'AUTO', AUTO_ON: 'ON',
  AUTO_OFF: 'OFF', ADMIN_NAME: 'ADMIN HAMMER', CLEARED: 'CLEARED', REWARD: 'BONUS', NEED_MORE: 'Need more coins',
  tools: [
    { id: 'fist', name: 'FIST', damage: 1, price: 0, sound: 'light', accent: '#334155' },
    { id: 'bat', name: 'WOODEN BAT', damage: 3, price: 50, sound: 'light', accent: '#b87537' },
    { id: 'katana', name: 'KATANA', damage: 8, price: 200, sound: 'tech', accent: '#56b4d3' },
    { id: 'sledge', name: 'SLEDGEHAMMER', damage: 20, price: 600, sound: 'heavy', accent: '#e26d5a' },
    { id: 'laser', name: 'LASER SWORD', damage: 50, price: 1500, sound: 'tech', accent: '#ef476f' },
    { id: 'chainsaw', name: 'CHAINSAW', damage: 150, price: 5000, sound: 'heavy', accent: '#f59e0b' },
    { id: 'rocket', name: 'ROCKET', damage: 400, price: 15000, sound: 'boom', accent: '#fb7185' },
    { id: 'axe', name: 'FIRE AXE', damage: 1200, price: 50000, sound: 'heavy', accent: '#ef4444' },
    { id: 'bomb', name: 'BOMB', damage: 3500, price: 150000, sound: 'boom', accent: '#7c3aed' },
    { id: 'ufo', name: 'UFO BLASTER', damage: 10000, price: 500000, sound: 'tech', accent: '#22c55e' },
    { id: 'comet', name: 'COMET', damage: 30000, price: 2000000, sound: 'boom', accent: '#06b6d4' },
    { id: 'atomic', name: 'ATOMIC BOMB', damage: 100000, price: 10000000, sound: 'boom', accent: '#f97316' },
    { id: 'plasma', name: 'PLASMA CANNON', damage: 300000, price: 50000000, sound: 'tech', accent: '#a855f7' },
    { id: 'blackhole', name: 'BLACK HOLE', damage: 1000000, price: 250000000, sound: 'boom', accent: '#111827' },
    { id: 'galaxy', name: 'GALAXY', damage: 3000000, price: 1000000000, sound: 'boom', accent: '#2563eb' }
  ]
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


function flattenConfig(raw) {
  const next = { ...FALLBACK_CFG };
  (raw?.tweaks || []).forEach(item => { next[item.id] = item.value; });
  (raw?.texts || []).forEach(item => { next[item.id] = item.value; });
  (raw?.images || []).forEach(item => { if (typeof item.path === 'string') next[item.id] = item.path; });
  if (Array.isArray(raw?.tools) && raw.tools.length) next.tools = raw.tools;
  return next;
}

function formatNumber(value) {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

function formatShort(value) {
  if (value >= 1000000000) return `${(value / 1000000000).toFixed(value % 1000000000 ? 1 : 0)}B`;
  if (value >= 1000000) return `${(value / 1000000).toFixed(value % 1000000 ? 1 : 0)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 ? 1 : 0)}K`;
  return String(value);
}

function makeInitialGame(cfg) {
  return {
    level: 1,
    health: cfg.BASE_HEALTH,
    coins: 0,
    equipped: 'fist',
    owned: ['fist', 'admin'],
    autoPurchased: false,
    autoActive: false,
    hits: 0,
    defeated: false,
    reward: 0
  };
}

function vibrate(style = 'light') {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style });
  } catch (e) { /* optional host haptics */ }
}

function Icon({ type }) {
  if (type === 'coin') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5c.8-1.5 4.2-1.5 5 0 .8 1.6-1.1 2.1-2.5 2.5s-3.3.9-2.5 2.5c.8 1.5 4.2 1.5 5 0"/></svg>;
  if (type === 'bolt') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 5 13h6l-1 9 8.5-12h-6z"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="8"/></svg>;
}

function StickFigure({ pulse, defeated, src }) {
  const targetRef = useRef(null);
  const previousPulse = useRef(pulse);
  useEffect(() => {
    if (previousPulse.current === pulse) return;
    previousPulse.current = pulse;
    const target = targetRef.current;
    if (!target || !pulse || defeated || !target.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = target.animate([
      { transform: 'translateY(0) rotate(0deg) scale(1)' },
      { transform: 'translateY(4px) rotate(-4deg) scale(1.07,.94)', offset: .32 },
      { transform: 'translateY(0) rotate(2deg) scale(.99,1.02)', offset: .7 },
      { transform: 'translateY(0) rotate(0deg) scale(1)' },
    ], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
    return () => animation.cancel();
  }, [pulse, defeated]);
  return <span ref={targetRef} className={`stick-figure target-art ${defeated ? 'is-defeated' : ''}`}><img className="character-art" src={src} alt="Simple black stick figure" draggable="false" /></span>;
}

// Grip and striking point in the supplied square image frame. Inventory art
// stays unchanged; only the attack sprite is aligned from grip toward target.
const WEAPON_STRIKE_POSES = {
  fist:      { grip: [.50,.86], tip: [.50,.25], motion: 'jab' },
  bat:       { grip: [.15,.86], tip: [.80,.20], motion: 'swing' },
  katana:    { grip: [.20,.81], tip: [.83,.16], motion: 'swing' },
  sledge:    { grip: [.19,.82], tip: [.65,.24], motion: 'swing' },
  laser:     { grip: [.20,.83], tip: [.81,.20], motion: 'swing' },
  chainsaw:  { grip: [.25,.62], tip: [.81,.30], motion: 'jab' },
  rocket:    { grip: [.22,.79], tip: [.78,.22], motion: 'jab' },
  axe:       { grip: [.18,.86], tip: [.67,.23], motion: 'swing' },
  bomb:      { grip: [.82,.58], tip: [.46,.58], motion: 'jab' },
  ufo:       { grip: [.84,.43], tip: [.42,.43], motion: 'jab' },
  comet:     { grip: [.78,.25], tip: [.25,.70], motion: 'jab' },
  atomic:    { grip: [.25,.74], tip: [.78,.25], motion: 'jab' },
  plasma:    { grip: [.40,.78], tip: [.88,.32], motion: 'jab' },
  blackhole: { grip: [.86,.52], tip: [.43,.52], motion: 'jab' },
  galaxy:    { grip: [.85,.50], tip: [.45,.50], motion: 'jab' },
  admin:     { grip: [.25,.83], tip: [.68,.28], motion: 'swing' },
  auto:      { grip: [.85,.50], tip: [.50,.50], motion: 'jab' },
};

function weaponStrikePose(id) {
  const pose = WEAPON_STRIKE_POSES[id] || WEAPON_STRIKE_POSES.fist;
  const dx = pose.tip[0] - pose.grip[0], dy = pose.tip[1] - pose.grip[1];
  return { ...pose, angle: 180 - Math.atan2(dy, dx) * 180 / Math.PI,
    style: { '--weapon-art-angle': (180 - Math.atan2(dy, dx) * 180 / Math.PI) + 'deg',
      '--weapon-grip-x': (pose.grip[0] * 80) + 'px', '--weapon-grip-y': (pose.grip[1] * 80) + 'px',
      '--weapon-reach': (Math.hypot(dx, dy) * 80) + 'px' } };
}

function ToolGlyph({ id, config }) {
  const slot = 'TOOL_' + id.toUpperCase();
  return <img className="weapon-art" src={config?.[slot] || DEFAULT_ART[slot] || DEFAULT_ART.TOOL_FIST} alt="" aria-hidden="true" draggable="false" />;
}

function App() {
  const [cfg, setCfg] = useState(FALLBACK_CFG);
  const [ready, setReady] = useState(false);
  const [game, setGame] = useState(() => makeInitialGame(FALLBACK_CFG));
  const [guideVisible, setGuideVisible] = useState(true);
  const [effects, setEffects] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [hitPulse, setHitPulse] = useState(0);
  const [weaponVisible, setWeaponVisible] = useState(false);
  const [clearPulse, setClearPulse] = useState(0);
  const gameRef = useRef(game);
  const sessionStartedRef = useRef(false);
  const cfgRef = useRef(cfg);
  const levelTimer = useRef(null);
  const feedbackTimer = useRef(null);
  const weaponTimer = useRef(null);
  const audioRef = useRef({ ctx: null, gain: null, buffers: {}, loading: {}, sources: new Set() });

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => {
    Object.entries(cfg).filter(([key, value]) => (key === 'CHARACTER_MAIN' || key === 'BACKGROUND_MAIN' || key.startsWith('TOOL_')) && typeof value === 'string')
      .forEach(([, src]) => { const image = new Image(); image.src = src; });
  }, [cfg]);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);

  useEffect(() => {
    let alive = true;
    fetch('./game.config.json')
      .then(response => response.json())
      .then(raw => {
        if (!alive) return;
        const loaded = flattenConfig(raw);
        setCfg(loaded);
        cfgRef.current = loaded;
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem('stickman-clicker-save') || 'null'); } catch (e) { saved = null; }
        const initial = makeInitialGame(loaded);
        if (saved && typeof saved === 'object') {
          const owned = Array.isArray(saved.owned) ? Array.from(new Set(['fist', 'admin', ...saved.owned])) : initial.owned;
          const equipped = loaded.tools.some(tool => tool.id === saved.equipped) || saved.equipped === 'admin' ? saved.equipped : 'fist';
          initial.level = Math.max(1, Number(saved.level) || 1);
          initial.health = Math.max(0, Number(saved.health) || loaded.BASE_HEALTH * Math.pow(loaded.HEALTH_MULTIPLIER, initial.level - 1));
          initial.coins = Math.max(0, Number(saved.coins) || 0);
          initial.owned = owned;
          initial.equipped = equipped;
          initial.autoPurchased = Boolean(saved.autoPurchased);
          initial.autoActive = Boolean(saved.autoPurchased && saved.autoActive);
          initial.hits = Math.max(0, Number(saved.hits) || 0);
        }
        gameRef.current = initial;
        setGame(initial);
        setReady(true);
      })
      .catch(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem('stickman-clicker-save', JSON.stringify({
        level: game.level, health: game.health, coins: game.coins, equipped: game.equipped,
        owned: game.owned, autoPurchased: game.autoPurchased, autoActive: game.autoActive, hits: game.hits
      }));
    } catch (e) { /* storage is optional */ }
  }, [game, ready]);

  const unlockAudio = useCallback(() => {
    if (!feedSession.active) return audioRef.current;
    try {
      const holder = audioRef.current;
      if (!holder.ctx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return holder;
        holder.ctx = new AudioContextClass();
        holder.gain = holder.ctx.createGain();
        holder.gain.gain.value = 0.18;
        holder.gain.connect(holder.ctx.destination);
      }
      if (holder.ctx.state === 'suspended') holder.ctx.resume();
    } catch (e) { /* audio enhancement is optional */ }
    return audioRef.current;
  }, []);

  const playSound = useCallback((name) => {
    if (!feedSession.active) return;
    const holder = unlockAudio();
    if (!holder.ctx) return;
    if (!holder.loading[name] && !holder.buffers[name]) {
      holder.loading[name] = fetch(SOUND_FILES[name])
        .then(response => response.arrayBuffer())
        .then(data => holder.ctx.decodeAudioData(data))
        .then(buffer => { holder.buffers[name] = buffer; return buffer; })
        .catch(() => null);
    }
    const pending = holder.loading[name] || Promise.resolve(holder.buffers[name]);
    pending.then(buffer => {
      if (!buffer || !holder.ctx || holder.ctx.state !== 'running' || !feedSession.active) return;
      try {
        const source = holder.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(holder.gain);
        holder.sources.add(source);
        source.onended = () => holder.sources.delete(source);
        source.start(0);
      } catch (e) { /* skip a failed cue */ }
    });
  }, [unlockAudio]);

  const showFeedback = useCallback((message) => {
    setFeedback(message);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(''), 1100);
  }, []);

  const createImpact = useCallback((tool, damage) => {
    const token = Date.now() + Math.random();
    const sparks = Array.from({ length: tool.id === 'admin' ? 16 : 9 }, (_, index) => ({
      id: `${token}-${index}`,
      angle: Math.round((360 / (tool.id === 'admin' ? 16 : 9)) * index + Math.random() * 18),
      distance: 40 + Math.random() * 70,
      size: 4 + Math.random() * 6
    }));
    setEffects(prev => [...prev.slice(-3), { id: token, damage, accent: tool.accent || '#ff4d6d', sparks }]);
    setHitPulse(token);
    setWeaponVisible(true);
    if (weaponTimer.current) clearTimeout(weaponTimer.current);
    weaponTimer.current = setTimeout(() => setWeaponVisible(false), 300);
    setTimeout(() => setEffects(prev => prev.filter(item => item.id !== token)), 680);
  }, []);

  const attack = useCallback(() => {
    if (!feedSession.active) return;
    const current = gameRef.current;
    const currentCfg = cfgRef.current;
    if (current.defeated) return;
    sessionStartedRef.current = true;
    unlockAudio();
    const tool = current.equipped === 'admin'
      ? { id: 'admin', name: currentCfg.ADMIN_NAME, damage: currentCfg.ADMIN_DAMAGE, sound: 'boom', accent: '#f43f5e' }
      : currentCfg.tools.find(item => item.id === current.equipped) || currentCfg.tools[0];
    const damage = Number(tool.damage) || 1;
    const nextHealth = Math.max(0, current.health - damage);
    const didDefeat = nextHealth === 0;
    const reward = didDefeat ? currentCfg.LEVEL_REWARD * current.level : 0;
    const next = {
      ...current,
      health: nextHealth,
      coins: current.coins + damage + reward,
      hits: current.hits + 1,
      defeated: didDefeat,
      reward
    };
    gameRef.current = next;
    setGame(next);
    setGuideVisible(false);
    createImpact(tool, damage);
    playSound(didDefeat ? 'clear' : (tool.sound || 'light'));
    vibrate(didDefeat ? 'notification_success' : 'light');
    if (didDefeat) {
      setClearPulse(Date.now());
      if (levelTimer.current) clearTimeout(levelTimer.current);
      levelTimer.current = setTimeout(() => {
        const after = gameRef.current;
        const advanced = {
          ...after,
          level: after.level + 1,
          health: currentCfg.BASE_HEALTH * Math.pow(currentCfg.HEALTH_MULTIPLIER, after.level),
          defeated: false,
          reward: 0
        };
        gameRef.current = advanced;
        setGame(advanced);
      }, 620);
    }
  }, [createImpact, playSound, unlockAudio]);

  useEffect(() => {
    if (!game.autoActive || !game.autoPurchased) return undefined;
    const id = setInterval(() => { if (sessionStartedRef.current && feedSession.active) attack(); }, Math.max(300, Number(cfg.AUTO_INTERVAL) || 760));
    return () => clearInterval(id);
  }, [attack, cfg.AUTO_INTERVAL, game.autoActive, game.autoPurchased]);

  useEffect(() => () => {
    if (levelTimer.current) clearTimeout(levelTimer.current);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    if (weaponTimer.current) clearTimeout(weaponTimer.current);
    audioRef.current.sources.forEach(source => { try { source.stop(); } catch (e) {} });
    if (audioRef.current.ctx) { try { audioRef.current.ctx.close(); } catch (e) {} }
  }, []);

  const toolMap = useMemo(() => Object.fromEntries(cfg.tools.map(tool => [tool.id, tool])), [cfg.tools]);
  const currentTool = game.equipped === 'admin'
    ? { id: 'admin', name: cfg.ADMIN_NAME, damage: cfg.ADMIN_DAMAGE, price: 0, accent: '#f43f5e', sound: 'boom' }
    : (toolMap[game.equipped] || cfg.tools[0]);
  const maxHealth = cfg.BASE_HEALTH * Math.pow(cfg.HEALTH_MULTIPLIER, game.level - 1);
  const healthRatio = maxHealth ? Math.max(0, Math.min(1, game.health / maxHealth)) : 0;
  const hasInteracted = !guideVisible;

  function handleTool(tool) {
    unlockAudio();
    if (game.owned.includes(tool.id)) {
      if (game.equipped === tool.id) return;
      const next = { ...game, equipped: tool.id };
      gameRef.current = next;
      setGame(next);
      playSound('ui');
      vibrate('light');
      showFeedback(tool.name);
      return;
    }
    if (game.coins >= tool.price) {
      const next = { ...game, coins: game.coins - tool.price, equipped: tool.id, owned: [...game.owned, tool.id] };
      gameRef.current = next;
      setGame(next);
      playSound('ui');
      vibrate('medium');
      showFeedback(tool.name);
    } else {
      vibrate('notification_error');
      showFeedback(cfg.NEED_MORE);
    }
  }

  function handleAuto() {
    unlockAudio();
    if (!game.autoPurchased) {
      if (game.coins < cfg.AUTO_COST) {
        vibrate('notification_error');
        showFeedback(cfg.NEED_MORE);
        return;
      }
      const next = { ...game, coins: game.coins - cfg.AUTO_COST, autoPurchased: true, autoActive: true };
      gameRef.current = next;
      setGame(next);
      playSound('ui');
      vibrate('medium');
      showFeedback(cfg.AUTO_NAME);
      return;
    }
    const next = { ...game, autoActive: !game.autoActive };
    gameRef.current = next;
    setGame(next);
    playSound('ui');
    vibrate('light');
  }

  function handleAdmin() {
    unlockAudio();
    if (game.equipped === 'admin') return;
    const next = { ...game, equipped: 'admin' };
    gameRef.current = next;
    setGame(next);
    playSound('ui');
    vibrate('heavy');
    showFeedback(cfg.ADMIN_NAME);
  }

  const strikePose = weaponStrikePose(currentTool.id);
  return (
    <div className="app-shell">
      <style>{`
        @font-face {
          font-family: 'Bangers';
          src: url('./assets/fonts/bangers/Bangers-Regular.woff2') format('woff2');
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }

        :root {
          --font-display: "Bangers", "PingFang SC", system-ui, sans-serif;
          --font-body:    -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
          --font-mono:    ui-monospace, Menlo, monospace;
        }

        * { box-sizing: border-box; }
        button { font: inherit; }
        .app-shell { width: 100%; height: 100%; min-height: 0; overflow: clip; position: relative; color: #18202b; background: #e7eaee; font-family: var(--font-body); user-select: none; -webkit-user-select: none; }
        .room { position: absolute; inset: 0; overflow: hidden; background: radial-gradient(ellipse at 50% 38%, #fff 0%, #f1f3f5 38%, #d8dde3 100%); }
        .room::before { content: ''; position: absolute; inset: 0; opacity: .38; background: linear-gradient(90deg, transparent 0 49.7%, rgba(99,110,123,.16) 50%, transparent 50.3%), linear-gradient(0deg, transparent 0 62%, rgba(255,255,255,.8) 62.2%, transparent 62.5%); pointer-events: none; }
        .room::after { content: ''; position: absolute; left: -20%; right: -20%; bottom: -15%; height: 57%; transform: perspective(420px) rotateX(57deg); transform-origin: bottom; opacity: .45; background: repeating-linear-gradient(90deg, rgba(110,120,132,.13) 0 1px, transparent 1px 54px), repeating-linear-gradient(0deg, rgba(110,120,132,.14) 0 1px, transparent 1px 34px); pointer-events: none; }
        .shell-content { position: relative; z-index: 2; height: 100%; min-height: 0; display: flex; flex-direction: column; }
        .topbar { flex: 0 0 52px; display: flex; align-items: center; justify-content: center; position: relative; padding: 8px 18px 0; }
        .brand { font-family: var(--font-display); letter-spacing: 1.8px; font-size: clamp(20px, 6vw, 28px); color: #202b38; text-shadow: 2px 2px 0 rgba(255,255,255,.95); }
        .brand::after { content: ''; display: block; width: 42px; height: 3px; margin: 1px auto 0; border-radius: 4px; background: #ef476f; }
        .stats { position: absolute; inset: 8px 14px auto; display: flex; justify-content: space-between; align-items: flex-start; pointer-events: none; opacity: 0; transform: translateY(-5px); transition: opacity .25s, transform .25s; }
        .stats.visible { opacity: 1; transform: translateY(0); }
        .stat { min-width: 72px; }
        .stat.right { text-align: right; }
        .stat-label { display: block; font-family: var(--font-display); font-size: 12px; letter-spacing: 1px; color: #697586; }
        .stat-value { display: block; font-family: var(--font-display); font-size: 25px; line-height: 22px; color: #18202b; }
        .stat-value.coin-value { color: #dd9c17; }
        .main-zone { flex: 1 1 auto; min-height: 0; position: relative; display: flex; flex-direction: column; }
        .hint { flex: 0 0 30px; text-align: center; font-family: var(--font-display); letter-spacing: .7px; font-size: clamp(16px, 4.7vw, 20px); color: #526171; opacity: 0; transform: translateY(-6px); transition: opacity .35s, transform .35s; }
        .hint.visible { opacity: .92; transform: translateY(0); animation: breathe 1.8s ease-in-out infinite; }
        @keyframes breathe { 50% { opacity: .46; } }
        .arena { flex: 1 1 auto; min-height: 0; position: relative; display: grid; place-items: center; overflow: hidden; cursor: pointer; touch-action: manipulation; }
        .arena::before { content: ''; position: absolute; width: min(340px, 76%); height: min(280px, 62%); border-radius: 50%; background: radial-gradient(ellipse, rgba(63,73,86,.19) 0%, rgba(63,73,86,.07) 42%, transparent 71%); transform: translateY(34%); filter: blur(5px); }
        .figure-button { position: relative; z-index: 2; width: min(260px, 67%); height: min(350px, 88%); border: 0; background: transparent; padding: 0; display: grid; place-items: center; cursor: pointer; touch-action: manipulation; transition: transform .14s ease; }
        .figure-button:active { transform: scale(.97); }
        .stick-figure { width: 100%; height: 100%; overflow: visible; }
        .figure-ink { transform-origin: 110px 180px; transition: transform .12s ease; }
        .stick-figure.is-hit .figure-ink { animation: squash .26s ease-out; }
        .stick-figure.is-defeated .figure-ink { animation: flop .58s ease-in forwards; }
        .figure-shadow { fill: rgba(49,58,68,.2); }
        .figure-ink { fill: none; stroke: #101820; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }
        .figure-ink .head { fill: rgba(255,255,255,.72); stroke: #101820; }
        .face-eye, .face-mouth { stroke-width: 5; }
        .face-mouth { transition: d .1s; }
        .dizzy { fill: none; stroke: #ef476f; stroke-width: 5; stroke-linecap: round; animation: floatDizzy .58s ease-out both; }
        @keyframes squash { 0% { transform: scale(1,1); } 32% { transform: scale(1.12,.84) translateY(9px); } 100% { transform: scale(1,1); } }
        @keyframes flop { 0% { transform: rotate(0deg) translateY(0); } 80% { transform: rotate(17deg) translateY(12px); } 100% { transform: rotate(22deg) translateY(20px); opacity: .4; } }
        @keyframes floatDizzy { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(-6px); } }
        .tool-swing { position: absolute; z-index: 3; width: 68px; height: 68px; right: calc(50% - min(160px, 35%)); top: 49%; transform: rotate(-26deg); transition: transform .12s; pointer-events: none; filter: drop-shadow(2px 3px 0 rgba(42,50,60,.12)); }
        .tool-swing svg { width: 100%; height: 100%; }
        .tool-swing.is-hit { animation: toolSwing .26s ease-out; }
        @keyframes toolSwing { 0% { transform: rotate(-26deg) translate(0,0); } 45% { transform: rotate(33deg) translate(-10px,8px); } 100% { transform: rotate(-26deg) translate(0,0); } }
        .impact { position: absolute; z-index: 4; left: 50%; top: 43%; pointer-events: none; animation: impactFade .68s ease-out forwards; }
        .damage { position: absolute; left: 0; top: 0; white-space: nowrap; transform: translate(-50%,-50%); font-family: var(--font-display); font-size: clamp(24px, 7vw, 34px); color: var(--impact-color); text-shadow: 2px 2px 0 #fff; animation: damageFloat .68s ease-out forwards; }
        .spark { position: absolute; width: var(--spark-size); height: var(--spark-size); margin: calc(var(--spark-size) / -2); border-radius: 50%; background: var(--impact-color); box-shadow: 0 0 0 2px rgba(255,255,255,.5); animation: sparkFly .55s cubic-bezier(.2,.8,.2,1) forwards; transform: rotate(var(--angle)) translateX(0); }
        @keyframes damageFloat { 0% { opacity: 0; transform: translate(-50%, -20% ) scale(.7); } 16% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -170%) scale(1.1); } }
        @keyframes sparkFly { to { opacity: 0; transform: rotate(var(--angle)) translateX(var(--distance)); } }
        @keyframes impactFade { from { opacity: 1; } to { opacity: .98; } }
        .health-strip { position: absolute; z-index: 4; left: 50%; bottom: 13%; transform: translateX(-50%); width: min(260px, 64%); transition: opacity .25s; }
        .health-strip.prestart { opacity: 0; pointer-events: none; }
        .health-numbers { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; font-family: var(--font-display); color: #556273; font-size: 15px; letter-spacing: .5px; }
        .health-number { color: #202b38; font-size: 19px; }
        .health-track { height: 11px; padding: 2px; border: 2px solid #202b38; border-radius: 10px; background: rgba(255,255,255,.62); box-shadow: 0 2px 0 rgba(27,38,49,.1); }
        .health-fill { height: 100%; border-radius: 5px; background: linear-gradient(90deg, #ef476f, #ff8a5b); transition: width .2s ease; }
        .clear-burst { position: absolute; z-index: 6; left: 50%; top: 38%; transform: translate(-50%,-50%); pointer-events: none; text-align: center; animation: clearIn .62s ease-out both; }
        .clear-burst strong { display: block; font-family: var(--font-display); letter-spacing: 2px; font-size: clamp(34px, 11vw, 54px); color: #ef476f; text-shadow: 3px 3px 0 #fff; }
        .clear-burst span { display: block; margin-top: -5px; font-family: var(--font-display); font-size: 20px; color: #e09c19; }
        @keyframes clearIn { 0% { opacity: 0; transform: translate(-50%,-38%) scale(.6) rotate(-7deg); } 30% { opacity: 1; transform: translate(-50%,-50%) scale(1.1) rotate(3deg); } 100% { opacity: 0; transform: translate(-50%,-72%) scale(1) rotate(0); } }
        .feedback { position: absolute; z-index: 8; left: 50%; bottom: 4%; transform: translateX(-50%); padding: 7px 14px; border-radius: 20px; background: rgba(24,32,43,.9); color: #fff; font-family: var(--font-display); font-size: 17px; letter-spacing: .5px; white-space: nowrap; animation: feedbackIn .2s ease-out; }
        @keyframes feedbackIn { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
        .store { flex: 0 0 161px; min-height: 0; position: relative; padding: 5px 0 max(16px, env(safe-area-inset-bottom, 0px)); background: linear-gradient(180deg, rgba(247,249,250,.16), rgba(222,227,233,.78)); }
        .store-top { height: 24px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; }
        .store-title { font-family: var(--font-display); font-size: 18px; letter-spacing: 1.2px; color: #465363; }
        .store-rule { height: 2px; flex: 1; margin-left: 10px; background: rgba(70,83,99,.22); }
        .cards { height: 123px; display: flex; gap: 9px; overflow-x: auto; overflow-y: hidden; padding: 6px 14px 2px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
        .cards::-webkit-scrollbar { display: none; }
        .tool-card { flex: 0 0 104px; height: 112px; position: relative; border: 2px solid rgba(33,45,58,.14); border-radius: 14px; background: rgba(255,255,255,.79); box-shadow: 0 3px 0 rgba(46,57,69,.08); padding: 7px 7px 6px; text-align: left; color: #263444; cursor: pointer; transition: transform .12s, border-color .12s, background .12s; }
        .tool-card:active { transform: translateY(2px); }
        .tool-card.equipped { border-color: var(--accent); background: rgba(255,255,255,.98); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 24%, transparent), 0 3px 0 rgba(46,57,69,.08); }
        .tool-card.locked { opacity: .72; }
        .tool-card.special { background: linear-gradient(145deg, #fff1f2, #fff); border-color: #f43f5e; }
        .tool-glyph { height: 42px; display: grid; place-items: center; }
        .tool-glyph svg { width: 43px; height: 43px; }
        .tool-name { display: block; height: 24px; overflow: hidden; font-family: var(--font-display); font-size: 14px; line-height: 14px; letter-spacing: .4px; }
        .tool-detail { display: flex; align-items: center; justify-content: space-between; gap: 3px; font-family: var(--font-mono); font-size: 11px; color: #687587; }
        .tool-damage { color: var(--accent); font-weight: 800; }
        .tool-price { white-space: nowrap; }
        .status-pill { position: absolute; top: 5px; right: 5px; padding: 2px 4px; border-radius: 5px; color: #fff; background: var(--accent); font-family: var(--font-display); font-size: 9px; letter-spacing: .4px; }
        .auto-card { display: flex; flex-direction: column; justify-content: space-between; }
        .auto-icon { height: 42px; display: grid; place-items: center; color: #d79a14; }
        .auto-icon svg { width: 40px; height: 40px; stroke: currentColor; fill: none; stroke-width: 2.5; }
        .auto-switch { display: flex; justify-content: space-between; align-items: center; font-family: var(--font-display); font-size: 14px; }
        .switch-dot { width: 30px; height: 17px; border-radius: 10px; background: #c8ced5; position: relative; }
        .switch-dot::after { content: ''; width: 13px; height: 13px; position: absolute; top: 2px; left: 2px; border-radius: 50%; background: #fff; transition: transform .2s; }
        .auto-card.active .switch-dot { background: #55b98a; }
        .auto-card.active .switch-dot::after { transform: translateX(13px); }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
        @media (max-height: 620px) {
          .topbar { flex-basis: 44px; }
          .store { flex-basis: 144px; }
          .cards { height: 109px; }
          .tool-card { height: 101px; }
          .tool-glyph { height: 34px; }
          .tool-glyph svg { width: 35px; height: 35px; }
          .health-strip { bottom: 7%; }
        }

        @font-face { font-family:'Poppins'; src:url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2'); font-weight:400; font-display:swap; }
        @font-face { font-family:'Poppins'; src:url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2'); font-weight:700; font-display:swap; }
        :root { --font-display:'Poppins',system-ui,sans-serif; --font-body:'Poppins',system-ui,sans-serif; }
        html,body,#root { width:100%; height:100%; margin:0; padding:0; overflow:hidden; }
        .topbar { flex:0 0 78px; padding:0; }
        .brand { display:none; }
        .stats { inset:30px 30px auto; }
        .stat-label { font-size:11px; line-height:1.3; letter-spacing:.02em; }
        .stat-value { font-size:28px; line-height:1.15; }
        .stat-value.coin-value { color:#a76b00; }
        .hint { position:absolute; z-index:5; top:calc(50% - 130px); left:30px; right:30px; height:auto; min-height:25px; font-size:18px; line-height:1.35; font-weight:700; letter-spacing:0; color:#3c4857; pointer-events:none; }
        .arena { padding:112px 30px 52px; }
        .figure-button { width:min(220px,76%); height:100%; max-height:300px; }
        .health-strip { left:30px; bottom:18px; width:calc(100% - 60px); transform:none; }
        .health-numbers { font-size:11px; line-height:1.3; }
        .health-number { font-size:13px; }
        .health-track { height:9px; }
        .damage,.clear-burst strong { font-family:'Bangers',system-ui,sans-serif; }
        .feedback { bottom:58px; max-width:calc(100% - 60px); white-space:normal; text-align:center; font-size:13px; }
        .store { flex:0 0 20%; min-height:122px; max-height:148px; padding:3px 30px 12px; }
        .store-top { height:18px; padding:0; }
        .store-title { font-size:11px; line-height:18px; letter-spacing:.08em; }
        .cards { height:calc(100% - 18px); gap:8px; padding:3px 0 4px; scroll-snap-type:x proximity; }
        .tool-card { flex-basis:110px; height:100%; min-height:82px; padding:5px 6px; scroll-snap-align:start; }
        .tool-glyph,.auto-icon { height:28px; }
        .tool-glyph svg,.auto-icon svg { width:28px; height:28px; }
        .tool-name { height:28px; font-size:11px; line-height:14px; letter-spacing:0; overflow:visible; overflow-wrap:anywhere; }
        .tool-detail { font-family:var(--font-body); font-size:10px; line-height:14px; }
        .status-pill { display:none; }
        .auto-switch { font-size:12px; }
        .auto-card { min-width:110px; }
        html[data-feed-preview="true"] .store { visibility:hidden; }

        .store { flex:0 0 122px; min-height:122px; max-height:122px; padding:4px 30px 50px; }
        .store-top { display:none; }
        .cards { height:100%; min-height:0; padding:0; }
        .tool-card,.auto-card { display:grid; grid-template-columns:34px 1fr; grid-template-rows:1fr auto; gap:2px 6px; flex-basis:154px; min-height:68px; height:68px; padding:8px; }
        .tool-glyph,.auto-icon { grid-row:1 / 3; align-self:center; height:34px; }
        .tool-glyph svg,.auto-icon svg { width:34px; height:34px; }
        .tool-name { height:auto; min-height:28px; align-self:end; font-size:12px; line-height:14px; font-weight:700; }
        .tool-detail { font-size:11px; line-height:14px; align-self:start; }
        .auto-switch { align-self:center; gap:4px; }

        .app-shell { background:#f5f5f2; }
        .room { background-size:cover; background-position:center center; background-repeat:no-repeat; }
        .room::before,.room::after,.arena::before { display:none; }
        .arena { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:96px 30px 64px; }
        .figure-button { display:block; flex:1 1 0; min-height:0; height:0; max-height:300px; }
        html[data-feed-preview="true"] .hint { top:calc(50% - 164px); }
        .target-art { display:block; width:100%; height:100%; min-height:0; min-width:0; position:relative; transform-origin:50% 72%; transition:opacity .22s,filter .22s,transform .22s; }
        .character-art { position:relative; z-index:1; display:block; width:100%; height:100%; object-fit:contain; user-select:none; pointer-events:none; }
        .figure-button::after { content:''; position:absolute; z-index:-1; bottom:0; left:21%; width:58%; height:12px; border-radius:50%; background:rgba(37,38,39,.12); filter:blur(4px); pointer-events:none; }
        .target-art.is-defeated { opacity:.38; transform:rotate(8deg) scale(.94); filter:grayscale(.35); }
        .weapon-art { display:block; width:100%; height:100%; object-fit:contain; pointer-events:none; user-select:none; }
        .tool-swing { width:80px; height:80px; right:auto; left:calc(50% + var(--weapon-reach) - var(--weapon-grip-x)); top:calc(43% - var(--weapon-grip-y)); transform-origin:var(--weapon-grip-x) var(--weapon-grip-y); transform:rotate(58deg); transition:none; opacity:0; visibility:hidden; filter:drop-shadow(0 3px 1px rgba(24,48,58,.12)); }
        .tool-swing .weapon-art { transform:rotate(var(--weapon-art-angle)); transform-origin:var(--weapon-grip-x) var(--weapon-grip-y); }
        .tool-swing.is-hit { opacity:1; visibility:visible; animation:weaponHeadSwing .3s ease-out; }
        .tool-swing[data-strike-motion=jab] { transform:translateX(18px); }
        .tool-swing[data-strike-motion=jab].is-hit { animation:weaponPointJab .26s ease-out; }
        @keyframes weaponHeadSwing { 0% { transform:rotate(58deg); } 25% { transform:rotate(82deg); } 48% { transform:rotate(0deg); } 60% { transform:rotate(-12deg); } 100% { transform:rotate(58deg); } }
        @keyframes weaponPointJab { 0%,100% { transform:translateX(18px); } 45% { transform:translateX(0); } 70% { transform:translateX(6px); } }
        .hint { top:calc(50% - 150px); color:#252627; text-shadow:0 1px 0 rgba(255,255,255,.4); }
        .stat { min-width:88px; padding:8px 13px; border:0; border-radius:0; background:none; box-shadow:none; }
        .stats { justify-content:center; }
        .stat.right { min-width:0; padding:0; border:0; border-radius:0; background:none; box-shadow:none; text-align:center; }
        .character-slot { position:relative; width:min(220px,76%); flex:1 1 0; min-height:0; height:0; max-height:300px; }
        .character-slot .figure-button { width:100%; height:100%; max-height:none; }
        .character-level { position:absolute; z-index:4; left:50%; bottom:calc(100% + 12px); transform:translateX(-50%); text-align:center; pointer-events:none; opacity:0; visibility:hidden; transition:opacity .25s; }
        .character-level.visible { opacity:1; visibility:visible; }
        .stat-value { color:#252627; }
        .stat-value.coin-value { color:#252627; }
        .tool-card { background:#ffffff; border-color:#d8dbd6; box-shadow:none; }
        .tool-card.equipped { background:#fffdf5; border-color:#baa267; }
        .tool-card.locked { opacity:.8; }
        .tool-glyph,.auto-icon { width:38px; height:38px; margin-left:-2px; }
        .health-track { border-color:#cdd1ca; background:#e7e9e3; }
        .health-fill { background:#b96f65; }
        .health-number,.health-numbers { color:#555957; text-shadow:0 1px 0 rgba(255,255,255,.4); }
        @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }

      `}</style>
      <div className="room" aria-hidden="true" style={{ backgroundImage: `url("${cfg.BACKGROUND_MAIN}")` }} />
      <div className="shell-content">
        <header className="topbar">
          <div className={`stats ${hasInteracted ? 'visible' : ''}`} aria-live="polite" aria-hidden={!hasInteracted}>
            <div className="stat right"><span className="stat-label">{cfg.COINS_LABEL}</span><span className="stat-value coin-value">{formatShort(game.coins)}</span></div>
          </div>
        </header>
        <main className="main-zone">
          <div className={`hint ${guideVisible ? 'visible' : ''}`}>{cfg.GUIDE}</div>
          <section className="arena" aria-label="Attack arena" onClick={attack}>
            <div className="character-slot" data-idle-demo="silent-hit-reaction">
              <div className={`stat character-level ${hasInteracted ? 'visible' : ''}`} aria-live="polite" aria-hidden={!hasInteracted}>
                <span className="stat-label">{cfg.LEVEL_LABEL}</span><span className="stat-value">{game.level}</span>
              </div>
              <button className="figure-button" aria-label="Tap to hit the stickman" onClick={event => { event.stopPropagation(); attack(); }}>
                <StickFigure pulse={hitPulse} defeated={game.defeated} src={cfg.CHARACTER_MAIN} />
              </button>
            </div>
            <div key={hitPulse} className={`tool-swing ${weaponVisible ? 'is-hit' : ''}`} data-weapon={currentTool.id} data-strike-motion={strikePose.motion} style={{ color: currentTool.accent, ...strikePose.style }}><ToolGlyph id={currentTool.id} config={cfg} /></div>
            {effects.map(effect => (
              <div className="impact" key={effect.id} style={{ '--impact-color': effect.accent }}>
                <div className="damage">-{formatShort(effect.damage)}</div>
                {effect.sparks.map(spark => <i className="spark" key={spark.id} style={{ '--angle': `${spark.angle}deg`, '--distance': `${spark.distance}px`, '--spark-size': `${spark.size}px` }} />)}
              </div>
            ))}
            {game.defeated && game.reward > 0 && <div className="clear-burst" key={clearPulse}><strong>{cfg.CLEARED}</strong><span>+{formatNumber(game.reward)} {cfg.REWARD}</span></div>}
            <div className={`health-strip ${hasInteracted ? '' : 'prestart'}`} aria-hidden={!hasInteracted}>
              <div className="health-numbers"><span>{cfg.HEALTH_LABEL}</span><span className="health-number">{formatNumber(game.health)} / {formatNumber(maxHealth)}</span></div>
              <div className="health-track"><div className="health-fill" style={{ width: `${healthRatio * 100}%` }} /></div>
            </div>
            {feedback && <div className="feedback" role="status">{feedback}</div>}
          </section>
        </main>
        <section className="store" aria-label={cfg.STORE_LABEL}>
          <div className="store-top"><span className="store-title">{cfg.STORE_LABEL}</span><span className="store-rule" /></div>
          <div className="cards">
            {cfg.tools.map(tool => {
              const owned = game.owned.includes(tool.id);
              const equipped = game.equipped === tool.id;
              const affordable = game.coins >= tool.price;
              return <button key={tool.id} className={`tool-card ${equipped ? 'equipped' : ''} ${!owned && !affordable ? 'locked' : ''}`} aria-pressed={equipped} style={{ '--accent': tool.accent }} onClick={() => handleTool(tool)} aria-label={`${tool.name}, damage ${tool.damage}, price ${tool.price}`}>
                {equipped && <span className="status-pill">{cfg.EQUIPPED}</span>}
                {!equipped && owned && <span className="status-pill">{cfg.OWNED}</span>}
                <span className="tool-glyph"><ToolGlyph id={tool.id} config={cfg} /></span>
                <span className="tool-name">{tool.name}</span>
                <span className="tool-detail"><b className="tool-damage">{formatShort(tool.damage)}</b><span className="tool-price">{tool.price === 0 ? cfg.FREE : formatShort(tool.price)}</span></span>
              </button>;
            })}
            <button className={`tool-card special ${game.equipped === 'admin' ? 'equipped' : ''}`} style={{ '--accent': '#f43f5e' }} onClick={handleAdmin} aria-label={`${cfg.ADMIN_NAME}, damage ${cfg.ADMIN_DAMAGE}`}>
              {game.equipped === 'admin' && <span className="status-pill">{cfg.EQUIPPED}</span>}
              <span className="tool-glyph"><ToolGlyph id="admin" config={cfg} /></span>
              <span className="tool-name">{cfg.ADMIN_NAME}</span>
              <span className="tool-detail"><b className="tool-damage">{formatShort(cfg.ADMIN_DAMAGE)}</b><span className="tool-price">{cfg.FREE}</span></span>
            </button>
            <button className={`tool-card auto-card ${game.autoActive ? 'active' : ''} ${!game.autoPurchased && game.coins < cfg.AUTO_COST ? 'locked' : ''}`} style={{ '--accent': '#d79a14' }} onClick={handleAuto} aria-label={`${cfg.AUTO_NAME}, ${game.autoPurchased ? cfg.AUTO_OFF : formatNumber(cfg.AUTO_COST)}`}>
              <span className="auto-icon"><ToolGlyph id="auto" config={cfg} /></span>
              <span className="auto-switch"><b>{cfg.AUTO_NAME}</b><i className="switch-dot" /></span>
              <span className="tool-detail"><span>{game.autoPurchased ? (game.autoActive ? cfg.AUTO_ON : cfg.AUTO_OFF) : 'UPGRADE'}</span><span className="tool-price">{game.autoPurchased ? '' : formatShort(cfg.AUTO_COST)}</span></span>
            </button>
          </div>
        </section>
      </div>
      {!ready && <div className="sr-only" aria-live="polite">Loading</div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

/* FEEDBACK_20261103_89: original neutral palette with newer artwork. */
(()=>{const style=document.createElement("style");style.textContent=".room{background-color:#f5f5f2;background-blend-mode:luminosity}.character-art{filter:none}";document.body.append(style);})();
