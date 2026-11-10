
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
    [data-idle-clean-tool=spray] .idle-clean-spray,[data-idle-clean-tool=brush] .idle-clean-brush,[data-idle-clean-tool=rinse] .idle-clean-rinse,[data-idle-clean-tool=vacuum] .idle-clean-vacuum{display:block}
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

const FALLBACK_CFG = {
  GRID_COLS: 14, GRID_ROWS: 20, CLEAN_GOAL: 0.92, BRUSH_POWER: 0.22, RINSE_POWER: 0.3, VACUUM_POWER: 0.32,
  GAME_TITLE: 'Rug Restore', GUIDE: 'Spray → Scrub → Rinse → Dry', COMPLETE: 'Satisfyingly clean!', NEXT_ITEM: 'Next item',
  SPRAY: 'Spray', BRUSH: 'Scrub', RINSE: 'Rinse', VACUUM: 'Dry', CLEANED: 'CLEANED',
  RUG_MAIN: './assets/rug-overhead.webp', UPHOLSTERY_MAIN: './assets/upholstery-overhead.webp',
  TOOL_SPRAY: './assets/tool-spray-photo-v1.webp', TOOL_BRUSH: './assets/tool-brush-photo-v1.webp',
  TOOL_RINSE: './assets/tool-rinse-photo-v1.webp', TOOL_DRY: './assets/tool-dry-photo-v1.webp'
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
      const wave = Math.sin((x + 2) * 2.17 + seed * .7) * .12 + Math.cos((y + 1) * 1.51 + seed) * .1;
      const edge = Math.min(x, cols - 1 - x, y, rows - 1 - y) / Math.min(cols, rows);
      const dirt = Math.max(.6, Math.min(1, .8 + wave + (edge < .08 ? .08 : 0)));
      cells.push({ dirt, initialDirt: dirt, detergent: 0, primed: false, scrubbed: false,
        rinsed: 0, cleaned: false, foam: 0, wet: 0, scrub: 0, dry: 0 });
    }
  }
  return cells;
}

function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }

function treatCell(cell, tool, amount, cfg) {
  if (cell.cleaned || amount <= 0) return 0;
  const before = cell.dirt;
  if (tool === 'spray') {
    cell.wet = clamp(cell.wet + .12 * amount);
    if (!cell.scrubbed) {
      cell.detergent = clamp(cell.detergent + .24 * amount);
      cell.foam = clamp(cell.foam + .025 * amount, 0, .12);
      if (cell.detergent >= .28) cell.primed = true;
    }
  } else if (tool === 'brush') {
    if (cell.primed && cell.rinsed < .88) {
      cell.scrub = clamp(cell.scrub + Number(cfg.BRUSH_POWER || .22) * .7 * amount);
      cell.dirt = cell.initialDirt * (1 - clamp(cell.scrub / .62));
      cell.foam = clamp(cell.foam + .36 * amount);
      cell.wet = clamp(cell.wet + .06 * amount);
      cell.rinsed = 0;
      cell.dry = 0;
      if (cell.scrub >= .62) { cell.scrubbed = true; cell.dirt = 0; }
    }
  } else if (tool === 'rinse') {
    cell.wet = clamp(cell.wet + Number(cfg.RINSE_POWER || .3) * .75 * amount);
    cell.foam = clamp(cell.foam - .34 * amount);
    if (cell.primed && cell.scrubbed) {
      cell.rinsed = clamp(cell.rinsed + Number(cfg.RINSE_POWER || .3) * .8 * amount);
      if (cell.rinsed >= .88) {
        cell.rinsed = 1;
        cell.dirt = 0;
        cell.foam = 0;
        cell.wet = 1;
      }
    } else {
      // Rinsing raw dirt or unused detergent cannot skip the scrub stage.
      cell.detergent = clamp(cell.detergent - .24 * amount);
      if (cell.detergent < .12) { cell.primed = false; cell.scrub = 0; cell.scrubbed = false; }
    }
  } else if (tool === 'vacuum' && cell.scrubbed && cell.rinsed >= .88 && cell.foam <= .035) {
    cell.dry = clamp(cell.dry + Number(cfg.VACUUM_POWER || .32) * .85 * amount);
    cell.wet = 1 - cell.dry;
    if (cell.dry >= .9) {
      cell.cleaned = true;
      cell.dry = 1;
      cell.wet = cell.foam = cell.dirt = 0;
    }
  }
  return Math.max(0, before - cell.dirt);
}

function cellIsClean(cell) {
  return cell.cleaned === true && cell.rinsed >= .88 && cell.dry >= .9 && cell.wet <= .08;
}

function cellCleaningProgress(cell) {
  if (cellIsClean(cell)) return 1;
  // Each step contributes one quarter, including valid work within that step.
  const sprayed = cell.primed ? 1 : clamp(cell.detergent / .28);
  const scrubbed = cell.primed ? (cell.scrubbed ? 1 : clamp(cell.scrub / .62)) : 0;
  const rinsed = cell.scrubbed ? clamp(cell.rinsed / .88) : 0;
  const dried = cell.scrubbed && cell.rinsed >= .88 && cell.foam <= .035 ? clamp(cell.dry / .9) : 0;
  return (sprayed + scrubbed + rinsed + dried) / 4;
}

function finishCleaningGrid(cells) {
  // The configured completion tolerance still applies, but success shows the
  // fully dry original artwork rather than a few leftover wet edge cells.
  for (const cell of cells) {
    Object.assign(cell, { dirt: 0, foam: 0, wet: 0, primed: true, scrubbed: true,
      scrub: 1, rinsed: 1, dry: 1, cleaned: true });
  }
}

function toolPrerequisite(cell, tool) {
  if (!cell || cell.cleaned || tool === 'spray') return '';
  if (tool === 'brush' && !cell.primed) return 'Spray first';
  if (tool === 'rinse' && !cell.scrubbed) return cell.primed ? 'Scrub first' : 'Spray first';
  if (tool === 'vacuum' && (cell.rinsed < .88 || cell.foam > .035)) return 'Rinse first';
  return '';
}

function vibrate(style = 'light') {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style });
  } catch (error) { /* haptics are optional */ }
}

function useSound() {
  const audio = useRef({ ctx: null, gain: null, buffer: null, loadPromise: null, source: null, tone: null, noise: null, brushNoise: null });
  const ensureAudio = useCallback(() => {
    const current = audio.current;
    if (!current.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      current.ctx = new AudioContextClass();
      current.gain = current.ctx.createGain();
      current.gain.gain.value = .22;
      current.gain.connect(current.ctx.destination);
    }
    if (current.ctx.state === 'suspended') current.ctx.resume().catch(() => {});
    if (!current.loadPromise) {
      current.loadPromise = fetch('./assets/sfx_tool_select.mp3')
        .then(response => response.arrayBuffer())
        .then(data => current.ctx.decodeAudioData(data))
        .then(buffer => { current.buffer = buffer; return buffer; }).catch(() => null);
    }
    return current;
  }, []);

  const playSelect = useCallback(() => {
    const current = ensureAudio();
    if (!current) return;
    const play = buffer => {
      if (!buffer || current.ctx.state !== 'running') return;
      try {
        const source = current.ctx.createBufferSource();source.buffer = buffer;
        source.connect(current.gain);source.start();current.source = source;
        source.onended = () => source.disconnect();
      } catch { /* Audio never blocks interaction. */ }
    };
    if (current.buffer) play(current.buffer);else current.loadPromise?.then(play);
  }, [ensureAudio]);

  const startAction = useCallback(tool => {
    const current = ensureAudio();
    if (!current?.ctx || current.tone) return;
    const ctx = current.ctx, brush = tool === 'brush';
    const key = brush ? 'brushNoise' : 'noise';
    if (!current[key]) {
      const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * 2), ctx.sampleRate);
      const data = buffer.getChannelData(0);let soft = 0, bristle = 0;
      for (let i = 0; i < data.length; i += 1) {
        const random = Math.random() * 2 - 1;
        soft = soft * .72 + random * .28;bristle = bristle * .24 + random * .76;
        const stroke = .55 + .45 * Math.sin(Math.PI * i / ctx.sampleRate * 3.5) ** 2;
        data[i] = brush ? (soft * .6 + bristle * .4) * stroke : soft;
      }
      current[key] = buffer;
    }
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = current[key];source.loop = true;
    filter.type = tool === 'rinse' || tool === 'vacuum' ? 'lowpass' : 'bandpass';
    filter.frequency.value = { spray: 3200, brush: 1750, rinse: 1800, vacuum: 780 }[tool];
    filter.Q.value = brush ? .65 : .55;
    gain.gain.setValueAtTime(.0001, ctx.currentTime);
    source.connect(filter);filter.connect(gain);gain.connect(current.gain);source.start();
    const voice = { oscillator: source, gain, filter, tool };
    source.onended = () => { source.disconnect();filter.disconnect();gain.disconnect(); };
    current.tone = voice;
  }, [ensureAudio]);

  const moveAction = useCallback((tool, effort = .6) => {
    const current = audio.current, voice = current.tone;
    if (!voice || !current.ctx) return;
    const now = current.ctx.currentTime, strength = clamp(effort);
    const base = { spray: .18, brush: 1.05, rinse: .23, vacuum: .24 }[tool] || .2;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(base * (.55 + .55 * strength), now, .018);
    // A held but motionless brush is quiet. Repeated moves refresh one voice.
    voice.gain.gain.setTargetAtTime(.0001, now + .13, .035);
    if (tool === 'brush') voice.filter.frequency.setTargetAtTime(1050 + strength * 1450, now, .025);
  }, []);

  const stopAction = useCallback(() => {
    const current = audio.current;
    if (!current.tone || !current.ctx) return;
    const voice = current.tone, now = current.ctx.currentTime;current.tone = null;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(.0001, now, .02);voice.oscillator.stop(now + .09);
    } catch { /* Already stopped. */ }
  }, []);

  useEffect(() => () => {
    stopAction();const current = audio.current;
    try { current.source?.stop();current.ctx?.close(); } catch { /* Optional cleanup. */ }
  }, [stopAction]);
  useEffect(() => feedSession.subscribe(active => {
    if (active) {
      if (audio.current.ctx?.state === 'suspended') audio.current.ctx.resume().catch(() => {});
    } else {
      stopAction();try { audio.current.source?.stop(); } catch { /* Optional. */ }
      audio.current.ctx?.suspend().catch(() => {});
    }
  }), [stopAction]);
  return { playSelect, startAction, moveAction, stopAction };
}

function ToolIcon({ type, config }) {
  const id = { spray: 'TOOL_SPRAY', brush: 'TOOL_BRUSH', rinse: 'TOOL_RINSE', vacuum: 'TOOL_DRY' }[type];
  return <ToolArtwork key={config[id]} type={type} src={config[id]} />;
}

const TOOL_OUTLINES = {
  spray: 'M19 16h15l4 4v4H19zM23 24v15c0 2 2 3 5 3h3c2 0 3-1 3-3V24M23 12h10v4H23zM16 12h7M37 11l5-3M40 16l6-1',
  brush: 'M10 31l20-20c2-2 5-2 7 0l1 1c2 2 2 5 0 7L18 38c-2 2-6 2-8 0s-2-5 0-7zM27 14l7 7M13 34l-3 7M18 31l-3 8M23 27l-3 9',
  rinse: 'M9 16h18l4 4v5H18l-9-5zM27 20l8-6 5 3-9 9M37 27c0 4-4 6-4 9a4 4 0 0 0 8 0c0-3-4-5-4-9z',
  vacuum: 'M9 34h12l5-10h13l3 10H9zM26 24V13h8l3 5M13 34v5M36 34v5M18 20h8'
};

function ToolArtwork({ type, src }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img className="toolArtwork" src={src} alt="" aria-hidden="true" draggable="false" onError={() => setFailed(true)} />;
  }
  return <svg className="toolArtwork" viewBox="0 0 48 48" aria-hidden="true"
    fill="none" stroke="#315b5a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={TOOL_OUTLINES[type]} />
  </svg>;
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

function cleaningDemoPhase(seconds) {
  const time = seconds % 13, elapsed = Math.max(0, time - .8);
  return { visible: time >= .8, part: Math.min(4, Math.floor(elapsed / 2.6)), sweep: clamp((elapsed % 2.6) / 2.15) };
}

function previewCleaningCell(original, index, cols, rows, demo) {
  const x = (index % cols + .5) / cols, y = (Math.floor(index / cols) + .5) / rows;
  if (!demo.visible || !(y > .44 && y < .65 && x > .14 && x < .86)) return original;
  const passed = x < .2 + .6 * demo.sweep;
  const cell = { ...original };
  if (demo.part === 0 && !passed) return cell;
  cell.primed = true;cell.detergent = .8;cell.wet = .45;cell.foam = .04;
  if (demo.part > 1 || (demo.part === 1 && passed)) {
    cell.dirt = 0;cell.scrub = 1;cell.scrubbed = true;cell.foam = 1;cell.wet = .65;
  }
  if (demo.part > 2 || (demo.part === 2 && passed)) {
    cell.rinsed = 1;cell.foam = 0;cell.wet = 1;
  }
  if (demo.part > 3 || (demo.part === 3 && passed)) {
    cell.cleaned = true;cell.dry = 1;cell.wet = 0;
  }
  return cell;
}

function paintCleaningCell(ctx, cell, index, cellW, cellH, cols) {
  const x = (index % cols) * cellW + cellW / 2, y = Math.floor(index / cols) * cellH + cellH / 2;
  const random = n => { const p = Math.sin(index * 53.71 + n * 17.13) * 43758.54;return p - Math.floor(p); };
  if (cell.dirt > .03) {
    const grime = cell.dirt, radius = Math.max(cellW, cellH) * .95;
    const gradient = ctx.createRadialGradient(x - cellW * .1, y - cellH * .12, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(42,30,22,${grime * .84})`);
    gradient.addColorStop(.65, `rgba(49,37,27,${grime * .62})`);
    gradient.addColorStop(1, 'rgba(35,25,18,0)');
    ctx.fillStyle = gradient;ctx.beginPath();ctx.ellipse(x, y, cellW * .87, cellH * .87, 0, 0, Math.PI * 2);ctx.fill();
    for (let n = 0; n < 4; n += 1) {
      ctx.fillStyle = `rgba(23,17,12,${grime * .34})`;
      ctx.beginPath();ctx.ellipse(x + (random(n) - .5) * cellW, y + (random(n + 11) - .5) * cellH, .7 + random(n + 2) * 1.6, .5 + random(n + 7), .4, 0, Math.PI * 2);ctx.fill();
    }
  }
  if (cell.wet > .03) {
    const wet = ctx.createRadialGradient(x, y, 0, x, y, cellW * 1.05);
    wet.addColorStop(0, `rgba(8,31,36,${cell.wet * .27})`);wet.addColorStop(1, 'rgba(7,25,31,0)');
    ctx.fillStyle = wet;ctx.beginPath();ctx.ellipse(x, y, cellW, cellH * .9, -.18, 0, Math.PI * 2);ctx.fill();
    ctx.strokeStyle = `rgba(232,252,255,${cell.wet * .31})`;ctx.lineWidth = .8;
    ctx.beginPath();ctx.moveTo(x - cellW * .33, y - cellH * .12);ctx.quadraticCurveTo(x, y - cellH * .26, x + cellW * .32, y - cellH * .15);ctx.stroke();
    if (cell.wet > .45 && cell.foam < .2) {
      for (let n = 0; n < 3; n += 1) {
        const bx = x + (random(n + 31) - .5) * cellW, by = y + (random(n + 44) - .5) * cellH;
        ctx.fillStyle = `rgba(198,233,242,${cell.wet * .15})`;ctx.beginPath();ctx.ellipse(bx, by, 1.4, 2.4, -.25, 0, Math.PI * 2);ctx.fill();
        ctx.strokeStyle = `rgba(248,255,255,${cell.wet * .48})`;ctx.lineWidth = .65;ctx.beginPath();ctx.ellipse(bx, by, 1.2, 2.1, -.25, 3.1, 4.8);ctx.stroke();
      }
    }
  }
  if (cell.foam > .035) {
    const foam = cell.foam, cloud = ctx.createRadialGradient(x, y, 0, x, y, cellW * .95);
    cloud.addColorStop(0, `rgba(250,255,252,${foam * .94})`);
    cloud.addColorStop(.6, `rgba(240,249,245,${foam * .82})`);cloud.addColorStop(1, 'rgba(248,255,252,0)');
    ctx.fillStyle = cloud;ctx.beginPath();ctx.ellipse(x, y, cellW * .99, cellH * .95, .12, 0, Math.PI * 2);ctx.fill();
    for (let n = 0; n < Math.ceil(foam * 20); n += 1) {
      const bx = x + (random(n) - .5) * cellW * 1.45, by = y + (random(n + 21) - .5) * cellH * 1.45;
      const r = .9 + random(n + 7) * Math.min(3.5, cellW * .16);
      ctx.fillStyle = `rgba(250,255,253,${foam * .64})`;ctx.beginPath();ctx.arc(bx, by, r, 0, Math.PI * 2);ctx.fill();
      ctx.strokeStyle = `rgba(116,163,163,${foam * .22})`;ctx.lineWidth = .75;ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${foam * .94})`;ctx.lineWidth = 1;ctx.beginPath();ctx.arc(bx - .2, by - .2, r * .72, 3.35, 4.9);ctx.stroke();
    }
  }
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
  const { playSelect, startAction, moveAction, stopAction } = useSound();
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
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { width, height, dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);ctx.clearRect(0, 0, width, height);
    const cols = Number(cfg.GRID_COLS) || 14, rows = Number(cfg.GRID_ROWS) || 20;
    const idle = window.PlayableIdlePreview, demo = cleaningDemoPhase(idle.seconds);
    if (idle.active && stageRef.current) {
      stageRef.current.dataset.idleCleanTool = !demo.visible || demo.part >= 4 ? 'done' : ['spray','brush','rinse','vacuum'][demo.part];
      stageRef.current.style.setProperty('--idle-clean-x', (20 + 60 * demo.sweep) + '%');
      stageRef.current.style.setProperty('--idle-clean-y', (54 + Math.sin(demo.sweep * Math.PI * 2) * 5) + '%');
      idle.stamp(canvas, 'spray-scrub-rinse-dry');
    }
    cellsRef.current.forEach((original, index) => {
      const cell = idle.active ? previewCleaningCell(original, index, cols, rows, demo) : original;
      paintCleaningCell(ctx, cell, index, width / cols, height / rows, cols);
    });
    // Counts describe the real grid, not the decorative feed demonstration.
    canvas.dataset.dirtyCells = String(cellsRef.current.filter(c => c.dirt > .03).length);
    canvas.dataset.foamyCells = String(cellsRef.current.filter(c => c.foam > .2).length);
    canvas.dataset.scrubbedCells = String(cellsRef.current.filter(c => c.scrubbed).length);
    canvas.dataset.rinsedCells = String(cellsRef.current.filter(c => c.rinsed >= .88).length);
    canvas.dataset.driedCells = String(cellsRef.current.filter(cellIsClean).length);
    canvas.dataset.wetCells = String(cellsRef.current.filter(c => c.wet > .2).length);
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
    const cellCount = cellsRef.current.length;
    const value = cellCount ? cellsRef.current.reduce((sum, cell) => sum + cellCleaningProgress(cell), 0) / cellCount : 0;
    const finishedCoverage = cellCount ? cleanCount / cellCount : 0;
    if (Math.abs(value - progressRef.current) > 0.002 || value >= 1) {
      progressRef.current = value;
      setProgress(value);
    }
    if (finishedCoverage >= Number(cfg.CLEAN_GOAL || 0.92) && !completedRef.current) {
      completedRef.current = true;
      finishCleaningGrid(cellsRef.current);progressRef.current=1;setProgress(1);drawOverlay();
      pointerRef.current.active = false;
      fxRef.current.lastMove = 0;
      setComplete(true);
      stopAction();
      vibrate('notification_success');
      console.info('[rug-restore] complete', { item: itemIndex, progress: 1 });
    }
  }, [cfg, complete, drawOverlay, itemIndex, stopAction]);

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
    if(emitting && fx.tool==='brush'){
      const hit={x:fx.point.x*width,y:fx.point.y*height},tilt=Math.sin(now*.035)*.13;
      ctx.save();ctx.translate(hit.x,hit.y);ctx.rotate(tilt);ctx.lineCap='round';
      for(let i=0;i<3;i++){ctx.strokeStyle=`rgba(249,255,251,${.44-i*.08})`;ctx.lineWidth=3.5-i*.5;ctx.beginPath();ctx.ellipse(0,0,15+i*6,6+i*3,0,.1,Math.PI*1.35);ctx.stroke();}
      ctx.restore();
    }
    const alive=[];
    for(const p of fx.particles){
      p.age+=dt;if(p.age>=p.life)continue;
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=p.gravity*dt;
      const fade=Math.sin(Math.PI*Math.min(1,p.age/p.life))*(1-p.age/p.life*.4);
      if(p.kind==='mist'){
        ctx.strokeStyle=`rgba(240,252,255,${p.alpha*fade})`;ctx.lineWidth=p.radius;
        ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-p.vx*.009,p.y-p.vy*.009);ctx.stroke();
      }else if(p.kind==='foam'){
        const r=p.radius*(1+p.age*.25);
        ctx.fillStyle=`rgba(250,255,252,${fade*.8})`;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=`rgba(125,180,180,${fade*.3})`;ctx.lineWidth=.8;ctx.stroke();
        ctx.strokeStyle=`rgba(255,255,255,${fade})`;ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(p.x-.3,p.y-.4,r*.7,3.2,4.8);ctx.stroke();
      }else if(p.kind==='air'){
        ctx.strokeStyle=`rgba(244,255,253,${fade*.35})`;ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-p.vx*.07,p.y-p.vy*.07);ctx.stroke();
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

  const animateToolEffect = useCallback((point, activeTool, removedDirt, allowed = true) => {
    if (!allowed) return;
    const fx = fxRef.current, { width, height } = sizeRef.current;
    fx.point = point;fx.tool = activeTool;fx.dirt = removedDirt;fx.lastMove = performance.now();
    const hit = { x: point.x * width, y: point.y * height };
    const origin = activeTool === 'rinse' ? { x: hit.x - 29, y: hit.y - 40 } : { x: hit.x + 32, y: hit.y - 32 };
    const base = Math.atan2(hit.y - origin.y, hit.x - origin.x);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const count = reduced ? 3 : { spray: 7, brush: 12, rinse: 10, vacuum: 5 }[activeTool];
    for (let i = 0; i < count; i += 1) {
      if (activeTool === 'spray') {
        const a = base + (Math.random() - .5) * .64, speed = 155 + Math.random() * 105;
        fx.particles.push({ kind: 'mist', x: origin.x + (Math.random() - .5) * 2, y: origin.y + (Math.random() - .5) * 2, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, age: 0, life: .18 + Math.random() * .17, gravity: 25, radius: .45 + Math.random() * .65, alpha: .2 + Math.random() * .25 });
      } else if (activeTool === 'brush') {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 25;
        fx.particles.push({ kind: 'foam', x: hit.x + Math.cos(a) * r, y: hit.y + Math.sin(a) * r * .65, vx: Math.cos(a) * (8 + Math.random() * 16), vy: -8 + Math.sin(a) * 13, age: 0, life: .45 + Math.random() * .65, gravity: -2, radius: 1.6 + Math.random() * 4.2 });
      } else if (activeTool === 'vacuum') {
        const a = Math.random() * Math.PI * 2;
        fx.particles.push({ kind: 'air', x: hit.x + (Math.random() - .5) * 28, y: hit.y + (Math.random() - .5) * 18, vx: Math.cos(a) * 35, vy: -20 + Math.sin(a) * 17, age: 0, life: .22 + Math.random() * .2, gravity: 0, radius: .8 });
      } else {
        const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 20;
        fx.particles.push({ kind: 'water', x: hit.x + Math.cos(a) * r, y: hit.y + Math.sin(a) * r * .6, vx: (Math.random() - .5) * 36, vy: 20 + Math.random() * 42, age: 0, life: .28 + Math.random() * .42, gravity: 55, radius: .6 + Math.random() * .85, dirty: false });
      }
    }
    if (fx.particles.length > 260) fx.particles.splice(0, fx.particles.length - 260);
    if (!fx.frame) { fx.lastTime = performance.now();fx.frame = requestAnimationFrame(drawEffects); }
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
    const reason=toolPrerequisite(center,tool);
    if(reason){setActionHint(reason);clearTimeout(hintTimerRef.current);hintTimerRef.current=window.setTimeout(()=>setActionHint(''),1400);}else setActionHint('');
    moveAction(tool,clamp(Math.hypot(next.x-pointer.last.x,next.y-pointer.last.y)/.018));
    const removed=applyLine(pointer.last,next);
    animateToolEffect(next,tool,removed,!reason);
    pointer.last = next;
  }, [animateToolEffect, applyLine, cfg, complete, hasStarted, moveAction, pointFromEvent, startAction, tool]);

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

  useEffect(()=>{let frame,last=0;const draw=now=>{if(window.PlayableIdlePreview.active&&now-last>=33){drawOverlay();last=now;}frame=requestAnimationFrame(draw);};frame=requestAnimationFrame(draw);return()=>{cancelAnimationFrame(frame);drawOverlay();};},[drawOverlay,feedActive]);
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
  const displayedProgress = complete ? 100 : Math.min(99, Math.round(progress * 100));

  return <div className="appShell" data-surface={surface.id} data-tool={tool} data-progress={progress.toFixed(4)}>
    <header className="topHud" style={{ visibility: hasStarted && !complete ? 'visible' : 'hidden' }}>
      <div className="progressPill" aria-label={`${displayedProgress}% complete`}><strong>{displayedProgress}%</strong></div>
    </header>
    <main className="playArea">
      {!hasStarted && <div className="guideText">{cfg.GUIDE}</div>}
      <div className="stageWrap">
        <div className={`rugStage ${complete ? 'isComplete' : ''}`} ref={stageRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endStroke} onPointerCancel={endStroke} onLostPointerCapture={endStroke}>
          <img className="rugImage" src={surface.src} alt={surface.label} draggable="false" />
          <canvas className="textureOverlay" ref={canvasRef} aria-hidden="true" />
          <canvas className="actionEffects" ref={effectsCanvasRef} aria-hidden="true" />
          <div className="fiberGloss" aria-hidden="true" />
          <span className="idle-clean-tool" aria-hidden="true">{['spray','brush','rinse','vacuum'].map(type=><span key={type} className={'idle-clean-'+type}><ToolIcon type={type} config={cfg}/></span>)}</span>
          {toolCursor && !complete && <span className={`toolCursor cursor-${tool}`} aria-hidden="true" style={{ left: `${toolCursor.x * 100}%`, top: `${toolCursor.y * 100}%` }}><ToolIcon type={tool} config={cfg} /></span>}
          {complete && <div className="completionOverlay">
            <h1 className="completionText" role="status" aria-live="polite">{cfg.COMPLETE}</h1>
            <button className="completionAction" type="button" onClick={nextItem}>{cfg.NEXT_ITEM}</button>
          </div>}
        </div>
      </div>
      {actionHint && !complete && <div className="toolFeedback" role="status">{actionHint}</div>}
    </main>
    <nav className="toolDock" aria-label="Cleaning tools" aria-hidden={complete} style={{visibility: complete ? 'hidden' : undefined}}>
      {tools.map((item) => <button className={`toolButton ${tool === item.id ? 'selected' : ''}`} type="button" key={item.id} disabled={complete} onClick={() => chooseTool(item.id)} aria-label={item.label}>
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
      @media (max-height: 620px) { .topHud { height: 56px; } .stageWrap { padding-top: 20px; padding-bottom: 8px; } .toolButton { min-height: 64px; } .toolIcon { height: 29px; width: 29px; } .toolIcon svg { width: 27px; height: 27px; } }
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
      .toolButton:focus-visible, .completionAction:focus-visible { outline: 3px solid #94dcf4; outline-offset: 2px; }
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


      .completionOverlay { position:absolute; z-index:8; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; padding:20px; background:transparent; animation:completionIn .24s ease-out both; }
      .completionText { max-width:100%; margin:0; text-align:center; color:#fff; font:700 clamp(20px,6cqi,24px)/1.25 var(--font-display); overflow-wrap:anywhere; text-shadow:0 2px 5px #061b18,0 0 16px #061b18; }
      .completionAction { min-height:44px; max-width:100%; padding:10px 20px; border:0; border-radius:999px; background:#fffaf0; color:#18352e; font:700 15px/1.4 var(--font-body); cursor:pointer; overflow-wrap:anywhere; }
      .completionAction:active { transform:scale(.97); }
      .completionAction:focus-visible { outline:3px solid #94dcf4; outline-offset:3px; }
      @keyframes completionIn { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }

      .actionEffects { position:absolute; inset:0; z-index:4; display:block; pointer-events:none; }
      .cursor-brush { margin-left:-24px; margin-top:-25px; transform:rotate(-10deg); }
      .cursor-spray { margin-left:22px; margin-top:-42px; transform:rotate(-6deg); }
      .cursor-rinse { margin-left:-65px; margin-top:-62px; transform:none; }
      .toolFeedback { position:absolute; left:50%; bottom:12px; z-index:7; transform:translateX(-50%); padding:6px 12px; border-radius:999px; background:rgba(5,24,22,.9); color:#fff4d5; font:700 13px/1.3 var(--font-body); pointer-events:none; }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
    `}</style>
  </div>;
}

/* White DIY work surface and tool tray. */
const lightTheme = `
  body, .appShell { background: #fff; }
  .appShell { color: #292929; }
  .appShell::before { display: none; }
  .topHud, .brandMark, .itemMark, .progressPill strong { color: #292929; }
  .rugStage { background: #f2f2f0; box-shadow: 0 8px 24px #00000014, 0 0 0 1px #e5e5e3; }
  .rugImage { filter: brightness(1.13) saturate(.92); }
  .toolDock { background: #fff; border: 0; }
  .toolButton { background: #f5f5f3; color: #333; }
  .toolButton.selected { background: #ffdf84; color: #252525; }
  .toolButton.selected::before { border: 1px solid #edc364; box-shadow: none; }
  .toolArtwork { filter: none; }
  .guideText { background: #fffffff2; color: #292929; border: 1px solid #e1e1df; text-shadow: none; }
  .toolFeedback { background: #fff; color: #333; box-shadow: 0 3px 12px #0002; }
  .completionText { color: #fff; text-shadow: 0 2px 5px #252525, 0 0 15px #252525; }
  .completionAction { background: #ffdf84; color: #252525; }
  .toolButton:focus-visible, .completionAction:focus-visible { outline-color: #655326; }
`;

/* CLEAN87_LARGER_TOOLS_20261103 */
(()=>{const style=document.createElement("style");style.textContent=".toolDock{flex-basis:132px;gap:4px;padding:4px 25px 16px}.toolButton{width:calc((100% - 12px)/4);height:112px;min-height:112px;padding:3px 1px}.toolIcon{width:min(88px,100%);height:86px;margin:0 auto 2px}.toolLabel{line-height:18px}.toolCursor{width:96px;height:96px;margin-left:-48px;margin-top:-48px;transform-origin:50% 50%}.cursor-brush{margin-left:-48px;margin-top:-48px;transform-origin:50% 50%;transform:rotate(-10deg)}.cursor-spray{margin-left:12.8px;margin-top:-52.16px;transform-origin:20% 21%;transform:rotate(-6deg)}.cursor-rinse{margin-left:-53.96px;margin-top:-102.4px;transform-origin:26% 65%;transform:none}.cursor-vacuum{margin-left:-24px;margin-top:-62.4px;transform-origin:25% 65%;transform:none}";document.body.append(style);})();

createRoot(document.getElementById('root')).render(<><App /><style>{lightTheme}</style></>);
