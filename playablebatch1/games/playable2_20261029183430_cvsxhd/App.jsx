
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

// Play again confirmation: arcade-cabinet plastic button press from the selected library cue.
const PINGPONG_CLICK = './assets/sfx_pingpong_click.mp3';
// Match result: compact celebratory victory fanfare from the selected library cue.
const RESULT_CHIME = './assets/sfx_result_chime.mp3';

const fallbackConfig = {
  MATCH_POINTS: 5,
  BALL_SPEED: 0.38,
  AI_SPEED: 0.24,
  AI_MISS_CHANCE: 0.22,
  AI_REACTION_MS: 140,
  BALL_ACCEL_PER_SECOND: 0.012,
  BALL_ACCEL_PER_HIT: 0.025,
  BALL_MAX_MULTIPLIER: 2.1,
  PADDLE_WIDTH: 86,
  BALL_SIZE: 16,
  SCORE_PAUSE_MS: 650,
  GUIDE_TEXT: 'Drag to play against the computer',
  YOU_WIN: 'You win!',
  YOU_LOSE: 'Computer wins',
  FINAL_SCORE: 'Final score',
  PLAY_AGAIN: 'Play again',
};

function pongMatchSpeed(cfg,pace){
  const factor=Math.min(Math.max(1,Number(cfg.BALL_MAX_MULTIPLIER)||2.1),1+pace.elapsed/1000*Math.max(0,Number(cfg.BALL_ACCEL_PER_SECOND)||0)+pace.hits*Math.max(0,Number(cfg.BALL_ACCEL_PER_HIT)||0));
  return Math.max(.05,Number(cfg.BALL_SPEED)||.38)*Math.hypot(1,.42)*factor;
}
function setPongSpeed(ball,speed){
  const length=Math.hypot(ball.vx,ball.vy)||1,vertical=Math.sign(ball.vy)||1;
  ball.vx=Math.max(-speed*.8,Math.min(speed*.8,ball.vx/length*speed));
  ball.vy=vertical*Math.sqrt(Math.max(0,speed*speed-ball.vx*ball.vx));
}
function reflectPongX(x,width,radius){
  const span=Math.max(1,width-radius*2),period=span*2,at=((x-radius)%period+period)%period;
  return radius+(at>span?period-at:at);
}
function planBotReturn(ball,blue,width,height,cfg,random=Math.random){
  const radius=cfg.BALL_SIZE/2,half=cfg.PADDLE_WIDTH/2,px=ball.x/100*width,py=ball.y/100*height;
  const travel=Math.max(0,(height*.12+7+radius-py)/Math.min(-.001,ball.vy));
  const landing=reflectPongX(px+ball.vx*travel,width,radius),miss=random()<Math.max(0,Math.min(1,Number(cfg.AI_MISS_CHANCE)||0));
  let error=(random()-.5)*half*.38;
  if(miss){
    let side=Math.sign(blue-landing)||(random()<.5?-1:1),distance=half+radius+18+random()*22;
    if(Math.abs(Math.max(half,Math.min(width-half,landing+side*distance))-landing)<half+radius+8)side*=-1;
    error=side*distance;
  }
  return{incoming:true,targetX:Math.max(half,Math.min(width-half,landing+error)),wait:Math.max(0,Number(cfg.AI_REACTION_MS)||0)*(.75+random()*.5),miss};
}
function movePongBot(bot,ball,paddles,width,height,cfg,elapsed,random=Math.random){
  const half=cfg.PADDLE_WIDTH/2,current=paddles.blue/100*width;
  if(ball.vy<0){if(!bot.incoming)Object.assign(bot,planBotReturn(ball,current,width,height,cfg,random));}
  else Object.assign(bot,{incoming:false,targetX:width/2,wait:0,miss:false});
  bot.wait=Math.max(0,bot.wait-elapsed);if(bot.wait>0)return;
  const delta=bot.targetX-current,limit=Math.max(0,Number(cfg.AI_SPEED)||0)*elapsed*(ball.vy<0?1:.65),step=Math.min(limit,Math.abs(delta)*(1-Math.exp(-elapsed/55)));
  paddles.blue=Math.max(half,Math.min(width-half,current+Math.sign(delta)*step))/width*100;
}

const audioState = {
  context: null,
  gain: null,
  buffers: new Map(),
  pending: new Map(),
};

const feedSession = (() => {
  const embedded = parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !embedded;
  window.addEventListener('message', event => {
    if (embedded && event.source === parent && event.origin === location.origin && event.data?.type === 'playable-active') active = event.data.active === true;
  });
  return { get active() { return active && !document.hidden; } };
})();

function unlockAudio() {
  if (!feedSession.active) return null;
  try {
    if (!audioState.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      audioState.context = new AudioContextClass();
      audioState.gain = audioState.context.createGain();
      audioState.gain.gain.value = 0.18;
      audioState.gain.connect(audioState.context.destination);
    }
    if (audioState.context.state === 'suspended') audioState.context.resume();
    return audioState.context;
  } catch (error) {
    return null;
  }
}

function playFile(path) {
  const context = unlockAudio();
  if (!context || !audioState.gain) return;
  let loadPromise = audioState.pending.get(path);
  if (!loadPromise) {
    loadPromise = fetch(path)
      .then((response) => {
        if (!response.ok) throw new Error('sound fetch failed');
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => context.decodeAudioData(arrayBuffer))
      .then((buffer) => {
        audioState.buffers.set(path, buffer);
        return buffer;
      })
      .catch(() => null);
    audioState.pending.set(path, loadPromise);
  }
  loadPromise.then((buffer) => {
    if (!buffer || !audioState.context || audioState.context.state !== 'running' || !feedSession.active) return;
    try {
      const source = audioState.context.createBufferSource();
      source.buffer = buffer;
      source.connect(audioState.gain);
      source.start();
    } catch (error) {
      // Audio is feedback only; gameplay continues if decoding or playback is unavailable.
    }
  });
}

function playBeep(kind) {
  const context = unlockAudio();
  if (!context || !audioState.gain) return;
  const now = context.currentTime;
  const sequence = kind === 'score' ? [440, 660] : kind === 'serve' ? [520, 760] : [880];
  const spacing = kind === 'score' ? 0.075 : 0;
  sequence.forEach((frequency, index) => {
    try {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = kind === 'hit' ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, now + index * spacing);
      envelope.gain.setValueAtTime(0.0001, now + index * spacing);
      envelope.gain.exponentialRampToValueAtTime(0.11, now + index * spacing + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + index * spacing + 0.075);
      oscillator.connect(envelope);
      envelope.connect(audioState.gain);
      oscillator.start(now + index * spacing);
      oscillator.stop(now + index * spacing + 0.08);
    } catch (error) {
      // Native Web Audio is an optional enhancement.
    }
  });
}

function vibrate(style) {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style: style || 'light' });
  } catch (error) {
    // Haptics are not available in a regular browser.
  }
}

function useRecordingSubmission() {
  const canSubmit = typeof tt !== 'undefined' && typeof tt.playableRecordingSubmission === 'function';
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const restore = () => setSubmitting(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') restore();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', restore);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', restore);
    };
  }, []);

  const submitRecording = () => {
    if (submitting || !canSubmit) return;
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

function PostMyPlayButton({ text }) {
  const { canSubmit, submitting, submitRecording } = useRecordingSubmission();
  if (!canSubmit) return null;
  return (
    <button className="result-button secondary" type="button" disabled={submitting} onClick={() => {
      unlockAudio();
      playBeep('serve');
      submitRecording();
    }}>
      {submitting ? '...' : 'Post my play'}
    </button>
  );
}

function App() {
  const [cfg, setCfg] = useState(fallbackConfig);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [guideVisible, setGuideVisible] = useState(true);
  const [score, setScore] = useState([0, 0]);
  const [gameOver, setGameOver] = useState(false);
  const [result, setResult] = useState('');
  const [roundPulse, setRoundPulse] = useState(false);
  const courtRef = useRef(null);
  const frameRef = useRef(0);
  const roundTimerRef = useRef(0);
  const lastTimeRef = useRef(0);
  const activeRef = useRef(false);
  const gameOverRef = useRef(false);
  const startedRef = useRef(false);
  const scoreRef = useRef([0, 0]);
  const paddleRef = useRef({ red: 50, blue: 50 });
  const ballRef = useRef({ x: 50, y: 50, vx: 0, vy: 0 });
  const botRef=useRef({incoming:false,targetX:0,wait:0,miss:false});
  const paceRef=useRef({elapsed:0,hits:0});
  const dragsRef = useRef(new Map());
  const redPaddleEl = useRef(null);
  const bluePaddleEl = useRef(null);
  const ballEl = useRef(null);

  useEffect(() => {
    let mounted = true;
    fetch('./game.config.json')
      .then((response) => response.ok ? response.json() : {})
      .then((raw) => {
        if (!mounted) return;
        const next = { ...fallbackConfig };
        [...(raw.tweaks || []), ...(raw.texts || [])].forEach((item) => {
          next[item.id] = item.value;
        });
        setCfg(next);
        setReady(true);
      })
      .catch(() => {
        if (mounted) setReady(true);
      });
    return () => { mounted = false; };
  }, []);

  const applyPositions = useCallback(() => {
    const idle=window.PlayableIdlePreview,t=idle.seconds,preview=idle.active,x=50+Math.sin(t*.95)*24;
    const previewBlue = 20;
    const previewRed = 72;
    const ballInset = 100 * 15 / Math.max(1, courtRef.current?.clientHeight || 598);
    const travel = 1 - Math.abs(1 - (t / 1.6) % 2);
    const ball = preview ? { x, y: previewBlue + ballInset + (previewRed - previewBlue - 2 * ballInset) * travel } : ballRef.current;
    const paddle=preview?{red:x,blue:50+Math.sin((t-.2)*.95)*24}:paddleRef.current;
    if(preview)idle.stamp(courtRef.current,'computer-rally');
    if (redPaddleEl.current) redPaddleEl.current.style.left = `${paddle.red}%`;
    if (redPaddleEl.current) redPaddleEl.current.style.top = preview ? `${previewRed}%` : '88%';
    if (bluePaddleEl.current) bluePaddleEl.current.style.left = `${paddle.blue}%`;
    if (bluePaddleEl.current) bluePaddleEl.current.style.top = preview ? `${previewBlue}%` : '12%';
    if (ballEl.current) {
      ballEl.current.style.left = `${ball.x}%`;
      ballEl.current.style.top = `${ball.y}%`;
    }
  }, []);

  const resetObjects = useCallback((resetPaddles = true) => {
    if (resetPaddles) paddleRef.current = { red: 50, blue: 50 };
    ballRef.current = { x: 50, y: 50, vx: 0, vy: 0 };
    botRef.current={incoming:false,targetX:0,wait:0,miss:false};
    applyPositions();
  }, [applyPositions]);

  const startBall = useCallback(() => {
    const direction = Math.random() > 0.5 ? 1 : -1;
    const vertical = Math.random() > 0.5 ? 1 : -1;
    ballRef.current = { x: 50, y: 50, vx: direction * cfg.BALL_SPEED * 0.42, vy: vertical * cfg.BALL_SPEED };
    setPongSpeed(ballRef.current,pongMatchSpeed(cfg,paceRef.current));
    activeRef.current = true;
    applyPositions();
  }, [applyPositions, cfg]);

  const finishMatch = useCallback((playerWon) => {
    activeRef.current = false;
    gameOverRef.current = true;
    dragsRef.current.clear();
    setGameOver(true);
    setResult(playerWon ? cfg.YOU_WIN : cfg.YOU_LOSE);
    playFile(RESULT_CHIME);
    vibrate('notification_success');
    console.log('[table-tennis] match finished', { playerWon, score: scoreRef.current });
  }, [cfg.YOU_LOSE, cfg.YOU_WIN]);

  const registerPoint = useCallback((playerWon) => {
    if (gameOverRef.current || !activeRef.current) return;
    activeRef.current = false;
    const nextScore = [...scoreRef.current];
    nextScore[playerWon ? 0 : 1] += 1;
    scoreRef.current = nextScore;
    setScore(nextScore);
    setRoundPulse(true);
    window.setTimeout(() => setRoundPulse(false), 220);
    playBeep('score');
    vibrate('medium');
    // Preserve both players' held positions between points.
    resetObjects(false);
    console.log('[table-tennis] point', { playerWon, score: nextScore });
    if (nextScore[0] >= cfg.MATCH_POINTS || nextScore[1] >= cfg.MATCH_POINTS) {
      finishMatch(nextScore[0] >= cfg.MATCH_POINTS);
      return;
    }
    roundTimerRef.current = window.setTimeout(() => {
      if (!gameOverRef.current) startBall();
    }, cfg.SCORE_PAUSE_MS);
  }, [cfg.MATCH_POINTS, cfg.SCORE_PAUSE_MS, finishMatch, resetObjects, startBall]);

  const tick = useCallback((time) => {
    const elapsed = lastTimeRef.current ? Math.min(time - lastTimeRef.current, 32) : 16;
    lastTimeRef.current = time;
    if (activeRef.current && !gameOverRef.current && feedSession.active && courtRef.current) {
      const court = courtRef.current;
      const width = court.clientWidth;
      const height = court.clientHeight;
      const ball = ballRef.current;
      const paddles = paddleRef.current;
      const ballRadius = cfg.BALL_SIZE / 2;
      const paddleHalf = cfg.PADDLE_WIDTH / 2;
      const redY = height * 0.88,blueY = height * 0.12;
      // Short substeps keep fast shots from passing through a paddle.
      const steps=Math.max(1,Math.ceil(elapsed/8)),dt=elapsed/steps;
      for(let step=0;step<steps&&activeRef.current&&!gameOverRef.current;step++){
      paceRef.current.elapsed+=dt;setPongSpeed(ball,pongMatchSpeed(cfg,paceRef.current));
      movePongBot(botRef.current,ball,paddles,width,height,cfg,dt);
      const px = (ball.x / 100) * width;
      const py = (ball.y / 100) * height;
      let nextX = px + ball.vx * dt;
      let nextY = py + ball.vy * dt;
      const wallLeft = ballRadius;
      const wallRight = width - ballRadius;
      if (nextX <= wallLeft || nextX >= wallRight) {
        nextX = Math.max(wallLeft, Math.min(wallRight, nextX));
        ball.vx *= -1;
        playBeep('hit');
      }

      const redX = (paddles.red / 100) * width;
      const blueX = (paddles.blue / 100) * width;
      const paddleHeight = 14;
      const hitRed = ball.vy > 0 && nextY + ballRadius >= redY - paddleHeight / 2 && nextY - ballRadius <= redY + paddleHeight / 2 && Math.abs(nextX - redX) <= paddleHalf + ballRadius;
      const hitBlue = ball.vy < 0 && nextY - ballRadius <= blueY + paddleHeight / 2 && nextY + ballRadius >= blueY - paddleHeight / 2 && Math.abs(nextX - blueX) <= paddleHalf + ballRadius;
      if (hitRed) {
        nextY = redY - paddleHeight / 2 - ballRadius;
        ball.vy = -Math.abs(ball.vy);
        paceRef.current.hits++;
        ball.vx += ((nextX - redX) / paddleHalf) * 0.045;
        playBeep('hit');
        vibrate('light');
      } else if (hitBlue) {
        nextY = blueY + paddleHeight / 2 + ballRadius;
        ball.vy = Math.abs(ball.vy);
        paceRef.current.hits++;
        ball.vx += ((nextX - blueX) / paddleHalf) * 0.045;
        playBeep('hit');
      }
      setPongSpeed(ball,pongMatchSpeed(cfg,paceRef.current));
      ball.x = (nextX / width) * 100;
      ball.y = (nextY / height) * 100;
      if (nextY < -ballRadius) {
        registerPoint(true);
      } else if (nextY > height + ballRadius) {
        registerPoint(false);
      }
      }
    }
    applyPositions();
    frameRef.current = window.requestAnimationFrame(tick);
  }, [applyPositions, cfg, registerPoint]);

  useEffect(() => {
    if (!ready) return undefined;
    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameRef.current);
      window.clearTimeout(roundTimerRef.current);
    };
  }, [ready, tick]);

  const movePaddle = useCallback((side, clientX) => {
    const court = courtRef.current;
    if (!court) return;
    const bounds = court.getBoundingClientRect();
    const paddleHalf = cfg.PADDLE_WIDTH / 2;
    const x = Math.max(paddleHalf, Math.min(Math.max(paddleHalf, bounds.width - paddleHalf), clientX - bounds.left));
    paddleRef.current[side] = (x / bounds.width) * 100;
    applyPositions();
  }, [applyPositions, cfg.PADDLE_WIDTH]);

  const beginInteraction = useCallback((event) => {
    if (!ready || !feedSession.active || gameOverRef.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const bounds = courtRef.current.getBoundingClientRect();
    const side = 'red';
    // A single drag controls the lower human paddle anywhere on the court.
    if ([...dragsRef.current.values()].some(drag => drag.side === side)) return;
    event.preventDefault();
    unlockAudio();
    dragsRef.current.set(event.pointerId, { side, startX: event.clientX, moved: false });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
    movePaddle(side, event.clientX);
  }, [ready, movePaddle]);

  const moveInteraction = useCallback((event) => {
    const drag = dragsRef.current.get(event.pointerId);
    if (!drag || !feedSession.active || gameOverRef.current) return;
    event.preventDefault();
    if (drag.moved || Math.abs(event.clientX - drag.startX) > 3) {
      drag.moved = true;
      if (!startedRef.current) {
        startedRef.current = true;
        setStarted(true);
        setGuideVisible(false);
        startBall();
        playBeep('serve');
      }
      movePaddle(drag.side, event.clientX);
    }
  }, [movePaddle, startBall]);

  const endInteraction = useCallback((event) => {
    dragsRef.current.delete(event.pointerId);
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch (error) { /* optional */ }
  }, []);

  useEffect(() => {
    const clearTouches = () => dragsRef.current.clear();
    window.addEventListener('blur', clearTouches);
    document.addEventListener('visibilitychange', clearTouches);
    return () => {
      window.removeEventListener('blur', clearTouches);
      document.removeEventListener('visibilitychange', clearTouches);
    };
  }, []);

  const restart = useCallback(() => {
    unlockAudio();
    playFile(PINGPONG_CLICK);
    window.clearTimeout(roundTimerRef.current);
    activeRef.current = false;
    gameOverRef.current = false;
    startedRef.current = false;
    dragsRef.current.clear();
    paceRef.current={elapsed:0,hits:0};
    scoreRef.current = [0, 0];
    setScore([0, 0]);
    setGameOver(false);
    setResult('');
    setStarted(false);
    setGuideVisible(true);
    resetObjects();
    console.log('[table-tennis] replay');
  }, [resetObjects]);

  useEffect(() => () => {
    if (audioState.context && audioState.context.state !== 'closed') {
      audioState.context.close().catch(() => {});
    }
  }, []);

  return (
    <main className="game-root">
      <section
        ref={courtRef}
        className={`court ${started ? 'is-playing' : 'is-ready'} ${roundPulse ? 'point-pulse' : ''}`}
        data-testid="court"
        aria-label="Single player Pong against the computer. Drag to move the lower red paddle."
        onPointerDown={beginInteraction}
        onPointerMove={moveInteraction}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
        onLostPointerCapture={endInteraction}
      >
        <div className="court-line court-line-vertical" />
        <div className="court-line court-line-horizontal" />
        <div className="net" aria-hidden="true" />
        <div ref={bluePaddleEl} className="paddle paddle-blue" style={{ width: cfg.PADDLE_WIDTH }} aria-label="Computer paddle" />
        <div ref={redPaddleEl} className="paddle paddle-red" style={{ width: cfg.PADDLE_WIDTH }} aria-label="Your paddle" />
        <div ref={ballEl} className="ball" style={{ width: cfg.BALL_SIZE, height: cfg.BALL_SIZE }} aria-label="Ball" />
        {guideVisible && !gameOver && <div className="guide">{cfg.GUIDE_TEXT}</div>}
        {started && !gameOver && (
          <div className="scoreboard" aria-label={`Blue ${score[1]}, Red ${score[0]}`}>
            <span className="score-blue"><i />{score[1]}</span><b aria-hidden="true">—</b><span className="score-red"><i />{score[0]}</span>
          </div>
        )}
        {gameOver && (
          <div className="result-overlay" data-testid="result-overlay">
            <div className="result-card">
              <div className={`result-mark ${score[0] >= cfg.MATCH_POINTS ? 'red' : 'blue'}`} />
              <h1>{result}</h1>
              <p>{cfg.FINAL_SCORE}</p>
              <strong data-testid="final-score"><span className="score-blue">{score[1]}</span> — <span className="score-red">{score[0]}</span></strong>
              <div className="result-actions">
                <button className="result-button" type="button" onClick={restart}>{cfg.PLAY_AGAIN}</button>
                <PostMyPlayButton text={cfg.PLAY_AGAIN} />
              </div>
            </div>
          </div>
        )}
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
}

* { box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
body { background: #082c24; -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
.game-root { width: 100%; height: 100%; overflow: clip; display: flex; justify-content: center; background: #082c24; }
.court { position: relative; width: min(100%, 520px); height: 100%; overflow: hidden; touch-action: none; user-select: none; background: #2e8a62; border: 1px solid rgba(229, 249, 231, .48); box-shadow: inset 0 0 0 7px rgba(15, 87, 58, .14), inset 0 0 80px rgba(9, 61, 43, .18); }
.court::before { content: ''; position: absolute; inset: 8px; border: 1px solid rgba(236, 255, 235, .45); pointer-events: none; }
.court::after { content: ''; position: absolute; left: 8px; right: 8px; top: 50%; height: 1px; background: rgba(238, 255, 237, .36); pointer-events: none; }
.court-line-vertical { position: absolute; top: 8px; bottom: 8px; left: 50%; width: 1px; background: rgba(231, 255, 234, .16); }
.court-line-horizontal { display: none; }
.net { position: absolute; left: 8px; right: 8px; top: 50%; height: 2px; transform: translateY(-1px); background: rgba(237, 255, 235, .48); opacity: .38; }
.paddle { position: absolute; z-index: 3; width: 86px; height: 14px; border-radius: 999px; transform: translate(-50%, -50%); }
.paddle-red { left: 50%; top: 88%; background: #f0444f; box-shadow: 0 5px 0 rgba(117, 26, 40, .25), 0 0 20px rgba(255, 75, 83, .2); }
.paddle-blue { left: 50%; top: 12%; background: #2779e8; box-shadow: 0 5px 0 rgba(17, 43, 111, .24), 0 0 20px rgba(52, 128, 255, .18); }
.ball { position: absolute; z-index: 4; left: 50%; top: 50%; width: 16px; height: 16px; transform: translate(-50%, -50%); border-radius: 50%; background: #fffef0; border: 2px solid rgba(255, 255, 255, .82); box-shadow: 2px 3px 0 rgba(13, 74, 51, .22), 0 0 12px rgba(255, 255, 220, .36); }
.guide { position: absolute; z-index: 6; left: 20px; right: 20px; top: 34%; text-align: center; color: #f1fff0; font: 700 18px/1.2 var(--font-body); letter-spacing: .01em; text-shadow: 0 2px 8px rgba(7, 59, 39, .22); animation: breathe 1.8s ease-in-out infinite; }
.scoreboard { position: absolute; z-index: 7; top: calc(12% + 24px); left: 50%; transform: translateX(-50%); display: flex; flex-direction: row; writing-mode: horizontal-tb; pointer-events: none; align-items: center; gap: 13px; min-width: 76px; justify-content: center; color: #f3fff0; font: 700 28px/1 var(--font-display); text-shadow: 0 2px 6px rgba(6, 67, 40, .32); }
.scoreboard span { display: inline-flex; align-items: center; gap: 7px; writing-mode: horizontal-tb; transform: none; font-variant-numeric: tabular-nums; }
.scoreboard b { font-size: 18px; font-weight: 400; opacity: .65; }
.scoreboard i { display: block; width: 9px; height: 9px; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255,255,255,.7); }
.score-blue i, .result-mark.blue { background: #2779e8; }
.score-red i, .result-mark.red { background: #f0444f; }
.guide, .net, .court-line, .paddle, .ball { pointer-events: none; }
.point-pulse::before { animation: flash .22s ease-out; }
.result-overlay { position: absolute; z-index: 10; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(7, 48, 35, .38); }
.result-card { width: min(84%, 330px); padding: 28px 22px 24px; text-align: center; color: #f3fff0; border: 1px solid rgba(235, 255, 236, .56); border-radius: 22px; background: rgba(16, 88, 59, .92); box-shadow: 0 18px 50px rgba(4, 37, 27, .3); }
.result-mark { width: 12px; height: 12px; margin: 0 auto 14px; border-radius: 50%; background: #f0444f; box-shadow: 0 0 0 7px rgba(240, 68, 79, .13); }
.result-mark.blue { box-shadow: 0 0 0 7px rgba(39, 121, 232, .15); }
.result-card h1 { margin: 0; font: 700 24px/1.2 var(--font-display); }
.result-card p { margin: 17px 0 4px; color: rgba(236, 255, 234, .72); font: 400 14px/1.3 var(--font-body); }
.result-card strong { display: block; font: 700 28px/1.15 var(--font-display); letter-spacing: .03em; writing-mode: horizontal-tb; }
.result-actions { display: flex; justify-content: center; gap: 10px; margin-top: 24px; }
.result-button { min-width: 130px; min-height: 46px; padding: 10px 18px; border: 0; border-radius: 999px; color: #145339; background: #f4ffe9; font: 700 15px/1 var(--font-display); box-shadow: 0 5px 0 rgba(6, 58, 38, .25); cursor: pointer; }
.result-button:active { transform: translateY(2px); box-shadow: 0 3px 0 rgba(6, 58, 38, .25); }
.result-button.secondary { min-width: 46px; padding: 10px 13px; color: #f4ffe9; background: transparent; border: 1px solid rgba(244, 255, 233, .62); box-shadow: none; }
.result-button:disabled { opacity: .55; cursor: default; }
@keyframes breathe { 0%, 100% { opacity: .58; transform: scale(.985); } 50% { opacity: 1; transform: scale(1); } }
@keyframes flash { 0% { box-shadow: inset 0 0 0 7px rgba(255, 255, 220, .3); } 100% { box-shadow: inset 0 0 0 7px rgba(15, 87, 58, .14); } }
@media (max-height: 560px) { .guide { top: 29%; font-size: 16px; } .result-card { padding: 20px 18px; } .result-actions { margin-top: 16px; } }
.court { container-type:size; }
.scoreboard { top:50%; left:44px; right:auto; transform:translate(-50%,-50%) rotate(90deg); gap:12px; font-size:28px; }
.guide { top:32%; left:50%; right:auto; width:max-content; max-width:calc(100% - 60px); color:#f1fff0; font-size:18px; line-height:1.35; transform:translate(-50%,-50%); animation:sidewaysBreathe 1.8s ease-in-out infinite; }
@keyframes sidewaysBreathe { 0%,100% { opacity:.6; } 50% { opacity:1; } }
.result-overlay { padding:0; }
.result-card { flex:0 0 auto; width:min(320px,calc(100cqh - 100px)); max-width:none; padding:24px 22px; transform:rotate(90deg); }
.result-card h1 { font-size:24px; }
.result-card p { margin-top:14px; }
.result-actions { margin-top:20px; flex-wrap:wrap; }
.result-button { min-height:46px; font-size:16px; }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }

`;

function Root() {
  return <><style>{styles}</style><App /></>;
}

createRoot(document.getElementById('root')).render(<Root />);

/* FEEDBACK_20261103_90 */
(()=>{const style=document.createElement("style");style.textContent=".scoreboard{top:30px;left:50%;right:auto;transform:translateX(-50%);gap:13px}.result-overlay{padding:28px}.result-card{transform:none;width:min(100%,330px)}.guide{top:26%}.result-mark{box-shadow:none}";document.body.append(style);})();
