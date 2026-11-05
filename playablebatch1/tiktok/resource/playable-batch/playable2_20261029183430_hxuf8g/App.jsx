
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

const DEFAULTS = {
  BOARD_INSET: 30,
  PADDLE_WIDTH: 148,
  PADDLE_HEIGHT: 16,
  PADDLE_BOTTOM: 76,
  BALL_RADIUS: 8,
  START_SPEED: 340,
  MAX_SPEED: 720,
  SPEED_STEP: 44,
  GUIDE: 'Drag to keep it bouncing',
  RESULT_TITLE: 'Rally over',
  FINAL_SCORE: 'Final score',
  BEST_SCORE: 'Best',
  PLAY_AGAIN: 'Play again',
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


function readConfig(data) {
  const next = { ...DEFAULTS };
  (data.tweaks || []).forEach((item) => { if (item && item.id in next) next[item.id] = Number(item.value); });
  (data.texts || []).forEach((item) => { if (item && item.id in next) next[item.id] = String(item.value); });
  return next;
}

function vibrate(style) {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style: style || 'light' });
  } catch (error) {
    // Haptics are optional outside the host.
  }
}

function useSound(setLastSound) {
  const audioRef=useRef(null),lastRef=useRef(0);
  const playSound=useCallback(kind=>{if(!feedSession.active)return;const stamp=performance.now();if(kind==='hit'&&stamp-lastRef.current<65)return;lastRef.current=stamp;setLastSound(kind);
    try{let ctx=audioRef.current;if(!ctx){const C=window.AudioContext||window.webkitAudioContext;if(!C)return;ctx=audioRef.current=new C();}ctx.resume().catch(()=>{});const now=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain();const miss=kind==='miss',duration=miss?.19:kind==='hit'?.075:.09;osc.type='sine';osc.frequency.setValueAtTime(miss?170:kind==='hit'?520:420,now);osc.frequency.exponentialRampToValueAtTime(miss?72:kind==='hit'?260:340,now+duration);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(miss?.085:kind==='hit'?.11:.065,now+.004);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);osc.connect(gain);gain.connect(ctx.destination);osc.start(now);osc.stop(now+duration+.015);osc.onended=()=>{osc.disconnect();gain.disconnect();};}catch{}
  },[setLastSound]);
  useEffect(()=>()=>{audioRef.current?.close().catch(()=>{});},[]);return playSound;
}

function useRecordingSubmission(onSound) {
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

  const submitRecording = () => {
    if (submitting || !canSubmit) return;
    onSound();
    setSubmitting(true);
    tt.playableRecordingSubmission({
      success() {},
      fail(error) {
        console.error('[post_my_play] playableRecordingSubmission failed', error && (error.errMsg || error.message));
        setSubmitting(false);
      },
      complete() {},
    });
  };

  return { canSubmit, submitting, submitRecording };
}

function PostMyPlayButton({ label, onSound }) {
  const { canSubmit, submitting, submitRecording } = useRecordingSubmission(onSound);
  if (!canSubmit) return null;
  return <button type="button" className="resultButton secondary" disabled={submitting} onClick={submitRecording}>{submitting ? '…' : label}</button>;
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

function App() {
  const [cfg, setCfg] = useState(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [score, setScore] = useState(0);
  const [lastSound, setLastSound] = useState('');
  const canvasRef = useRef(null);
  const boardRef = useRef({ width: 0, height: 0, dpr: 1 });
  const gameRef = useRef({
    active: false,
    score: 0,
    paddleX: 0,
    dragging: false,
    pulse: 0,
    ball: { x: 0, y: 0, vx: 0, vy: 0, trail: [] },
  });
  const playSound = useSound(setLastSound);

  useEffect(() => {
    let mounted = true;
    fetch('./game.config.json')
      .then((response) => response.ok ? response.json() : {})
      .then((data) => { if (mounted) setCfg(readConfig(data || {})); })
      .catch(() => {})
      .finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, []);

  const pointFromEvent = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    return event.clientX - rect.left;
  }, []);

  const setPaddleFromX = useCallback((x) => {
    const width = boardRef.current.width;
    if (!width) return;
    const half = cfg.PADDLE_WIDTH / 2;
    const left = cfg.BOARD_INSET + half;
    const right = width - cfg.BOARD_INSET - half;
    gameRef.current.paddleX = Math.max(left, Math.min(right, x));
  }, [cfg.BOARD_INSET, cfg.PADDLE_WIDTH]);

  const startRound = useCallback((initialX) => {
    const board = boardRef.current;
    if (!board.width || !board.height) return;
    const game = gameRef.current;
    setPaddleFromX(initialX);
    game.active = true;
    game.score = 0;
    game.pulse = 0;
    game.ball = {
      x: game.paddleX,
      y: Math.max(92, board.height * 0.19),
      // Scale both velocity components so the quicker serve keeps its familiar angle.
      vx: cfg.START_SPEED * (32 / 222),
      vy: cfg.START_SPEED,
      trail: [],
    };
    setScore(0);
    setPhase('playing');
    playSound('reset');
    vibrate('light');
    console.log('[paddle-survival] rally started', { width: Math.round(board.width), height: Math.round(board.height) });
  }, [cfg.START_SPEED, playSound, setPaddleFromX]);

  const resetRound = useCallback(() => {
    const game = gameRef.current;
    game.active = false;
    game.score = 0;
    game.pulse = 0;
    game.dragging = false;
    game.paddleX = boardRef.current.width / 2;
    game.ball = { x: game.paddleX, y: Math.max(92, boardRef.current.height * .19), vx: 0, vy: 0, trail: [] };
    setScore(0);
    setPhase('idle');
    playSound('reset');
    vibrate('light');
    console.log('[paddle-survival] rally reset');
  }, [playSound]);

  const handlePointerDown = useCallback((event) => {
    if (event.pointerType !== 'mouse' && event.isPrimary === false) return;
    if (!ready || !feedSession.active || phase === 'over') return;
    const x = pointFromEvent(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gameRef.current.dragging = true;
    setPaddleFromX(x);
    if (!gameRef.current.active) startRound(x);
  }, [phase, pointFromEvent, ready, setPaddleFromX, startRound]);

  const handlePointerMove = useCallback((event) => {
    if (!feedSession.active || !gameRef.current.dragging || (event.pointerType !== 'mouse' && event.isPrimary === false)) return;
    setPaddleFromX(pointFromEvent(event));
  }, [pointFromEvent, setPaddleFromX]);

  const stopDragging = useCallback((event) => {
    if (event.pointerType !== 'mouse' && event.isPrimary === false) return;
    gameRef.current.dragging = false;
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    let frame = 0;
    let lastTime = performance.now();
    let resizeObserver;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      boardRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      if (!gameRef.current.paddleX) gameRef.current.paddleX = rect.width / 2;
    };
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }

    const draw = (time) => {
      const board = boardRef.current;
      const game = gameRef.current;
      const width = board.width;
      const height = board.height;
      const dpr = board.dpr;
      const dtMs = Math.min(Math.max(time - lastTime, 0), 32);
      lastTime = time;
      const dt = dtMs / 1000;
      const courtLeft = cfg.BOARD_INSET;
      const courtRight = width - cfg.BOARD_INSET;
      const courtTop = 98;
      const radius = cfg.BALL_RADIUS;
      const playingPaddleY = height - cfg.PADDLE_BOTTOM - Math.min(82, height * .13);
      const paddleY = window.PlayableIdlePreview.preview
        ? Math.min(height * .65, playingPaddleY)
        : playingPaddleY;
      const courtBottom = paddleY + cfg.PADDLE_HEIGHT + 10;

      if (game.active && feedSession.active) {
        const steps = Math.max(1, Math.min(4, Math.ceil(dtMs / 8)));
        const stepDt = dt / steps;
        for (let step = 0; step < steps && game.active; step += 1) {
          const ball = game.ball;
          const oldY = ball.y;
          ball.x += ball.vx * stepDt;
          ball.y += ball.vy * stepDt;
          if (ball.x - radius <= courtLeft) { ball.x = courtLeft + radius; ball.vx = Math.abs(ball.vx); }
          if (ball.x + radius >= courtRight) { ball.x = courtRight - radius; ball.vx = -Math.abs(ball.vx); }
          if (ball.y - radius <= courtTop) { ball.y = courtTop + radius; ball.vy = Math.abs(ball.vy); }

          const crossedPaddle = ball.vy > 0 && oldY + radius <= paddleY + 2 && ball.y + radius >= paddleY;
          const withinPaddle = Math.abs(ball.x - game.paddleX) <= cfg.PADDLE_WIDTH / 2 + radius;
          if (crossedPaddle && withinPaddle) {
            ball.y = paddleY - radius - 0.2;
            const offset = Math.max(-1, Math.min(1, (ball.x - game.paddleX) / (cfg.PADDLE_WIDTH / 2)));
            game.score += 1;
            const nextSpeed = Math.min(cfg.MAX_SPEED, Math.hypot(ball.vx, ball.vy) + cfg.SPEED_STEP);
            const horizontalRatio = Math.max(-0.72, Math.min(0.72, offset * 0.9));
            ball.vx = nextSpeed * horizontalRatio;
            ball.vy = -Math.sqrt(Math.max(1, nextSpeed * nextSpeed - ball.vx * ball.vx));
            game.pulse = 1;
            setScore(game.score);
            playSound('hit');
            vibrate('medium');
            console.log('[paddle-survival] clean catch', { score: game.score, speed: Math.round(nextSpeed) });
          }
          if (ball.y - radius > courtBottom + 12) {
            game.active = false;
            game.score = Math.max(0, game.score);
            setPhase('over');
            setScore(game.score);
            playSound('miss');
            vibrate('notification_error');
            console.log('[paddle-survival] rally ended', { score: game.score });
          }
          ball.trail.push({ x: ball.x, y: ball.y });
          if (ball.trail.length > 8) ball.trail.shift();
        }
        game.pulse = Math.max(0, game.pulse - dt * 5.5);
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.lineWidth = 3.5;
      context.strokeStyle = '#403a34';
      roundedRect(context, courtLeft, courtTop, courtRight - courtLeft, courtBottom - courtTop, 14);
      context.stroke();
      context.strokeStyle = 'rgba(46, 43, 39, 0.08)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(courtLeft + 20, courtBottom - 14);
      context.lineTo(courtRight - 20, courtBottom - 14);
      context.stroke();

      const idle=window.PlayableIdlePreview,preview=idle.active,t=idle.seconds;
      const paddleX = preview?width/2+Math.sin(t*1.12)*(courtRight-courtLeft-cfg.PADDLE_WIDTH)*.36:game.paddleX || width / 2;
      context.save();
      context.shadowColor = 'rgba(38, 35, 31, 0.15)';
      context.shadowBlur = 0;
      context.shadowOffsetY = 0;
      context.fillStyle = '#252627';
      roundedRect(context, paddleX - cfg.PADDLE_WIDTH / 2, paddleY, cfg.PADDLE_WIDTH, cfg.PADDLE_HEIGHT, cfg.PADDLE_HEIGHT / 2);
      context.fill();
      context.restore();

      if (game.pulse > 0) {
        context.save();
        context.strokeStyle = `rgba(123, 142, 127, ${game.pulse * 0.48})`;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(paddleX, paddleY + cfg.PADDLE_HEIGHT / 2, 18 + (1 - game.pulse) * 18, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }

      let ballX = game.ball.x || width / 2;
      let ballY = game.ball.y || Math.max(92, height * 0.19);
      if(preview){ballX=paddleX;const v=1-Math.abs(1-(t/1.7)%2);ballY=courtTop+radius+(paddleY-courtTop-radius*2)*v;idle.stamp(canvas,'paddle-rally');}else if (!game.active) ballY += Math.sin(time / 420) * 3;
      const trail = game.ball.trail || [];
      trail.forEach((point, index) => {
        const alpha = ((index + 1) / trail.length) * 0.13;
        context.fillStyle = `rgba(35, 33, 31, ${alpha})`;
        context.beginPath();
        context.arc(point.x, point.y, Math.max(2, radius * (index + 1) / trail.length * 0.8), 0, Math.PI * 2);
        context.fill();
      });
      context.save();
      context.shadowColor = 'rgba(31, 28, 25, 0.2)';
      context.shadowBlur = 5;
      context.shadowOffsetY = 4;
      context.fillStyle = '#252627';
      context.beginPath();
      context.arc(ballX, ballY, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener('resize', resize);
    };
  }, [cfg, playSound, ready]);

  return (
    <main className="app" data-phase={phase} data-score={score} data-last-sound={lastSound}>
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
body { background: #f5f4ef; -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
.app { position: relative; width: 100%; height: 100%; overflow: clip; background: #f5f4ef; color: #252627; user-select: none; touch-action: none; }
.gameCanvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
.hud { position: absolute; z-index: 2; top: max(18px, env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 14px; color: #252627; font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: 0.03em; pointer-events: none; }
.hudDot { width: 4px; height: 4px; border-radius: 50%; background: #b9794e; }
.hint { position: absolute; z-index: 2; top: 30%; left: 50%; transform: translate(-50%, -50%); width: max-content; max-width: calc(100% - 48px); color: rgba(41, 39, 36, 0.72); font-family: var(--font-body); font-size: 17px; font-weight: 700; text-align: center; letter-spacing: -0.02em; animation: breathe 2.4s ease-in-out infinite; pointer-events: none; }
.resultOverlay { position: absolute; inset: 0; z-index: 4; display: flex; align-items: center; justify-content: center; padding: 28px; background: rgba(244, 237, 227, 0.94); }
.resultContent { width: min(100%, 330px); text-align: center; }
.resultTitle { margin: 0 0 28px; font-family: var(--font-display); font-size: 24px; line-height: 1.2; font-weight: 700; letter-spacing: -0.04em; }
.resultStats { display: flex; justify-content: center; gap: 34px; margin-bottom: 34px; }
.stat { display: grid; gap: 5px; min-width: 86px; }
.statLabel { color: rgba(41, 39, 36, 0.54); font-family: var(--font-body); font-size: 12px; font-weight: 400; }
.statValue { color: #252627; font-family: var(--font-display); font-size: 34px; line-height: 1; font-weight: 700; }
.resultActions { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; }
.resultButton { min-height: 52px; padding: 0 25px; border: 0; border-radius: 999px; color: #f8f1e8; background: #252627; box-shadow: 0 9px 18px rgba(41, 39, 36, 0.14); font-family: var(--font-display); font-size: 16px; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.resultButton.secondary { color: #252627; background: transparent; border: 1px solid rgba(41, 39, 36, 0.25); box-shadow: none; }
.resultButton:disabled { opacity: 0.55; cursor: default; }
@keyframes breathe { 0%, 100% { opacity: 0.56; transform: translate(-50%, -50%) translateY(0); } 50% { opacity: 0.92; transform: translate(-50%, -50%) translateY(-4px); } }

.hud { top:30px; left:30px; right:30px; transform:none; justify-content:center; gap:20px; font-size:28px; line-height:1; letter-spacing:0; }
.hudStat { display:grid; gap:5px; text-align:center; }
.hudStat:last-child { text-align:center; }
.hudStat strong { font-size:28px; line-height:1.15; }
.hudStat small { font-size:11px; font-weight:400; line-height:1.3; opacity:.65; }
.hint { top:32%; max-width:calc(100% - 60px); color:#3d3831; font-size:18px; line-height:1.35; letter-spacing:0; }
.resultOverlay { padding:30px 30px 50px; }
.resultButton { min-height:48px; font-size:16px; }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }

      `}</style>
      <canvas
        ref={canvasRef}
        className="gameCanvas"
        aria-label="Paddle survival game"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onLostPointerCapture={stopDragging}
      />
      {phase === 'playing' && <div className="hud" aria-label={`Score ${score}`}><span className="hudStat"><strong>{score}</strong><small>Score</small></span></div>}
      {phase === 'idle' && ready && <div className="hint" data-testid="hint">{cfg.GUIDE}</div>}
      {phase === 'over' && (
        <section className="resultOverlay" aria-label="Rally result">
          <div className="resultContent">
            <h1 className="resultTitle">{cfg.RESULT_TITLE}</h1>
            <div className="resultStats">
              <div className="stat"><span className="statLabel">{cfg.FINAL_SCORE}</span><strong className="statValue">{score}</strong></div>
            </div>
            <div className="resultActions">
              <button type="button" className="resultButton" onClick={resetRound}>{cfg.PLAY_AGAIN}</button>
              <PostMyPlayButton label="Post my play" onSound={() => playSound('reset')} />
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
