import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Matter from 'matter-js';


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
  const demoPaletteRef=useRef(null);if(!demoPaletteRef.current)demoPaletteRef.current=PALETTES[chooseShapeColor()];const demoPalette=demoPaletteRef.current;
  return <>
    <style>{POLISH_CSS}</style>
    {!active && [80,81,84].includes(GAME_NUMBER) && <div className={'preview-example example-' + GAME_NUMBER} aria-hidden="true">
      {GAME_NUMBER === 80 && <svg viewBox="0 0 320 220"><path className="example-blob" d="M78 61C112 16 184 23 192 66C206 88 248 75 249 113C251 162 200 176 165 166C117 195 69 166 80 124C40 101 47 78 78 61Z" fill={demoPalette.fill} stroke={demoPalette.stroke} strokeWidth="2"/><PreviewSquishyEyes/></svg>}
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

const GAME_NUMBER=80;
const POLISH_CSS=BASE_CSS+".hint{top:24%;left:30px;right:30px;transform:translateY(-50%);font-size:18px;line-height:1.3;text-align:center;white-space:normal;color:#674c54;animation:batchBreathe 2.6s ease-in-out infinite}.controls{left:50%;right:auto;bottom:50px;transform:translateX(-50%);gap:12px}.tool-button{width:48px;height:48px;border:1px solid #e6d9d6;box-shadow:0 4px 14px #7e666414}[data-feed-preview=true] .controls{visibility:hidden}";

const DEFAULT_CFG = {
  DRAW_HINT: 'Draw a closed shape',
  MAX_SHAPES: 9,
  CALM_GRAVITY: 0.04,
  SETTLE_GRAVITY: 1,
  MIN_POINTS: 14,
  CLOSE_DISTANCE: 42,
  MAX_POINT_DISTANCE: 18,
};

const PALETTES = [
  { fill: '#F7AFC5', hi: '#FFDCE6', stroke: '#A95274', eye: '#49324B' },
  { fill: '#A9D9D0', hi: '#E0F6ED', stroke: '#4A8D85', eye: '#303F4A' },
  { fill: '#FFD28D', hi: '#FFF0C8', stroke: '#B87644', eye: '#49383A' },
  { fill: '#B9B3F2', hi: '#E9E7FF', stroke: '#6D65AF', eye: '#3C395D' },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const EYE_FILES=['classic','sleepy','googly','happy'].map(name=>'./assets/eyes-frame-'+name+'.webp');
let eyeBag=[];
function chooseEyeStyle(){if(!eyeBag.length){eyeBag=[0,1,2,3];for(let i=3;i>0;i--){const j=Math.floor(Math.random()*(i+1));[eyeBag[i],eyeBag[j]]=[eyeBag[j],eyeBag[i]];}}return eyeBag.pop();}
function closedOutline(rawPoints){
  const points=[];for(const p of rawPoints){if(!points.length||Math.hypot(p.x-points.at(-1).x,p.y-points.at(-1).y)>=5)points.push({x:p.x,y:p.y});}
  if(points.length>3&&Math.hypot(points[0].x-points.at(-1).x,points[0].y-points.at(-1).y)<6)points.pop();
  if(points.length<3)return null;
  let area=0,length=0;const edges=[];
  points.forEach((p,i)=>{const q=points[(i+1)%points.length],d=Math.hypot(q.x-p.x,q.y-p.y);area+=p.x*q.y-q.x*p.y;edges.push(d);length+=d;});
  if(Math.abs(area)/2<250||length<65)return null;
  const ring=[];let edge=0,used=0;
  for(let i=0;i<24;i++){const d=i*length/24;while(edge<points.length-1&&used+edges[edge]<d){used+=edges[edge++];}const a=points[edge],b=points[(edge+1)%points.length],t=(d-used)/(edges[edge]||1);ring.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
  return ring;
}

let colorBag=[],lastRandomColor=-1;
function chooseShapeColor(){
  if(!colorBag.length){colorBag=PALETTES.map((_,i)=>i);for(let i=colorBag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[colorBag[i],colorBag[j]]=[colorBag[j],colorBag[i]];}if(colorBag.at(-1)===lastRandomColor)[colorBag[0],colorBag[colorBag.length-1]]=[colorBag.at(-1),colorBag[0]];}
  return lastRandomColor=colorBag.pop();
}
function analyzeEyeWhites(pixels,width,height){
  const size=width*height,white=new Uint8Array(size),mask=new Uint8ClampedArray(size*4),dist=new Float32Array(size),seen=new Uint8Array(size),queue=new Int32Array(size),components=[];
  for(let i=0;i<size;i++){const j=i*4,min=Math.min(pixels[j],pixels[j+1],pixels[j+2]),max=Math.max(pixels[j],pixels[j+1],pixels[j+2]);if(pixels[j+3]>127&&min>224&&max-min<24){white[i]=1;dist[i]=1e6;mask.set([255,255,255,255],j);}}
  const diagonal=Math.SQRT2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(!white[i])continue;let d=dist[i];if(!x||!y||x===width-1||y===height-1)d=1;else d=Math.min(d,dist[i-1]+1,dist[i-width]+1,dist[i-width-1]+diagonal,dist[i-width+1]+diagonal);dist[i]=d;}
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){const i=y*width+x;if(!white[i])continue;if(x<width-1&&y<height-1&&x>0)dist[i]=Math.min(dist[i],dist[i+1]+1,dist[i+width]+1,dist[i+width+1]+diagonal,dist[i+width-1]+diagonal);}
  for(let start=0;start<size;start++){
    if(!white[start]||seen[start])continue;let head=0,tail=1,best=start;queue[0]=start;seen[start]=1;
    while(head<tail){const i=queue[head++],x=i%width,y=(i/width)|0;if(dist[i]>dist[best])best=i;const neighbors=[];if(x)neighbors.push(i-1);if(x<width-1)neighbors.push(i+1);if(y)neighbors.push(i-width);if(y<height-1)neighbors.push(i+width);for(const j of neighbors)if(white[j]&&!seen[j]){seen[j]=1;queue[tail++]=j;}}
    if(tail>30){const room=dist[best]*.92;components.push({area:tail,cx:best%width,cy:(best/width)|0,radius:room*.62,travelX:room*.25,travelY:room*.18,room});}
  }
  const pupils=components.sort((a,b)=>b.area-a.area).slice(0,2).sort((a,b)=>a.cx-b.cx);
  return {mask,pupils};
}
function createEyeFrame(src){
  const image=new Image(),frame={image,mask:null,layer:document.createElement('canvas'),pupils:[]};
  image.onload=()=>{try{const w=image.naturalWidth,h=image.naturalHeight,sample=document.createElement('canvas');sample.width=w;sample.height=h;const sampleCtx=sample.getContext('2d',{willReadFrequently:true});sampleCtx.drawImage(image,0,0);const analysis=analyzeEyeWhites(sampleCtx.getImageData(0,0,w,h).data,w,h);if(analysis.pupils.length!==2)return;const mask=document.createElement('canvas');mask.width=w;mask.height=h;mask.getContext('2d').putImageData(new ImageData(analysis.mask,w,h),0,0);frame.layer.width=w;frame.layer.height=h;frame.mask=mask;frame.pupils=analysis.pupils;}catch{}};
  image.src=src;return frame;
}
function pupilTarget(time,seed,pointer,cx,cy,reduced=false){
  if(reduced)return {x:0,y:0};
  let x,y;
  if(pointer?.at>0&&time-pointer.at<1700){x=(pointer.x-cx)/145;y=(pointer.y-cy)/145;}
  else{x=Math.sin(time*.00105+seed)*.76;y=Math.sin(time*.00074+seed*1.7)*.48;}
  const length=Math.max(1,Math.hypot(x,y));return {x:x/length,y:y/length};
}
function paintPupilEyes(ctx,frame,width,gaze){
  if(!frame?.mask)return false;
  const image=frame.image,h=width*image.naturalHeight/image.naturalWidth,layer=frame.layer,p=layer.getContext('2d');
  ctx.drawImage(image,-width/2,-h/2,width,h);
  p.globalCompositeOperation='source-over';p.clearRect(0,0,layer.width,layer.height);p.fillStyle='#201d23';
  for(const eye of frame.pupils){p.beginPath();p.arc(eye.cx+gaze.x*eye.travelX,eye.cy+gaze.y*eye.travelY,eye.radius,0,Math.PI*2);p.fill();}
  // The white openings mask only the moving black centers. The original
  // outlines, lids and whites are painted once in a stationary frame.
  p.globalCompositeOperation='destination-in';p.drawImage(frame.mask,0,0);p.globalCompositeOperation='source-over';
  ctx.drawImage(layer,-width/2,-h/2,width,h);return true;
}
function PreviewSquishyEyes(){
  const ref=useRef(null);
  useEffect(()=>{const canvas=ref.current,ctx=canvas.getContext('2d'),frame=createEyeFrame(EYE_FILES[0]);canvas.width=280;canvas.height=160;let raf;
    const draw=time=>{raf=requestAnimationFrame(draw);if(document.hidden)return;ctx.clearRect(0,0,280,160);ctx.save();ctx.translate(140,80);paintPupilEyes(ctx,frame,280,pupilTarget(time,0,null,0,0,reducedMotionQuery.matches));ctx.restore();};raf=requestAnimationFrame(draw);return()=>cancelAnimationFrame(raf);
  },[]);
  return <foreignObject x="116" y="71" width="75" height="43"><canvas ref={ref} style={{width:'100%',height:'100%',display:'block'}}/></foreignObject>;
}

function vibrate(style = 'light') {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style });
  } catch (_) {}
}

const CONTACT_REARM_MS=300,CONTACT_MIN_SPEED=.35,CONTACT_SOUND_GAP_MS=340;
function noteShapeContacts(contacts,pairs,now,allowImpact=true){
  const grouped=new Map();
  for(const pair of pairs||[]){
    const a=pair.bodyA,b=pair.bodyB,aid=(a?.label||'').split(':')[0],bid=(b?.label||'').split(':')[0];
    if(!aid.startsWith('doodle-')||!bid.startsWith('doodle-')||aid===bid)continue;
    const key=aid<bid?aid+'|'+bid:bid+'|'+aid,n=pair.collision?.normal;
    const vx=(a.velocity?.x||0)-(b.velocity?.x||0),vy=(a.velocity?.y||0)-(b.velocity?.y||0),speed=n?Math.abs(vx*n.x+vy*n.y):Math.hypot(vx,vy);
    grouped.set(key,Math.max(grouped.get(key)||0,speed));
  }
  let impact=false;
  for(const [key,speed] of grouped){const seen=contacts.get(key);contacts.set(key,now);if(allowImpact&&(seen===undefined||now-seen>=CONTACT_REARM_MS)&&speed>=CONTACT_MIN_SPEED)impact=true;}
  for(const [key,seen] of contacts)if(now-seen>4000)contacts.delete(key);
  return impact;
}

function makeAudioController() {
  const audio = { ctx: null, gain: null, loading: {}, buffers: {}, sources:new Set(), contactSource:null, lastContactAt:-Infinity, epoch:0, disposed:false };
  const stats={contactPlays:0,contactSuppressed:0};
  const files = {
    tap: './assets/sfx_tap.mp3',
    plop: './assets/sfx_plop.mp3',
    contact: './assets/sfx_contact.mp3',
  };

  const unlock = () => {
    if (typeof window === 'undefined'||audio.disposed) return null;
    if (!audio.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      try {
        audio.ctx = new AudioContext();
        audio.gain = audio.ctx.createGain();
        audio.gain.gain.value = 0.24;
        audio.gain.connect(audio.ctx.destination);
      } catch (_) {
        return null;
      }
    }
    try {
      if (audio.ctx.state === 'suspended') audio.ctx.resume();
    } catch (_) {}
    return audio.ctx;
  };

  const beep = (kind) => {
    const ctx = unlock();
    if (!ctx || !audio.gain) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      const isContact = kind === 'contact';
      osc.type = isContact ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(isContact ? 190 : kind === 'plop' ? 320 : 520, now);
      osc.frequency.exponentialRampToValueAtTime(isContact ? 130 : kind === 'plop' ? 210 : 440, now + 0.11);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      osc.connect(gain);
      gain.connect(audio.gain);
      audio.sources.add(osc);
      if(isContact){audio.contactSource=osc;stats.contactPlays++;}
      osc.onended=()=>{audio.sources.delete(osc);if(audio.contactSource===osc)audio.contactSource=null;osc.disconnect();gain.disconnect();};
      osc.start(now);
      osc.stop(now + 0.16);
    } catch (_) {}
  };

  const load = (kind) => {
    const ctx = unlock();
    if (!ctx) return Promise.reject(new Error('audio unavailable'));
    if (audio.buffers[kind]) return Promise.resolve(audio.buffers[kind]);
    if (audio.loading[kind]) return audio.loading[kind];
    audio.loading[kind] = fetch(files[kind])
      .then((response) => {
        if (!response.ok) throw new Error('sound request failed');
        return response.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        audio.buffers[kind] = buffer;
        return buffer;
      });
    return audio.loading[kind];
  };

  const play = (kind) => {
    if(audio.disposed||!feedSession.active||document.hidden)return;
    const requestedAt=performance.now(),epoch=audio.epoch,isContact=kind==='contact';
    if(isContact){
      if(audio.contactSource||requestedAt-audio.lastContactAt<CONTACT_SOUND_GAP_MS){stats.contactSuppressed++;return;}
      audio.lastContactAt=requestedAt;
    }
    const ctx = unlock();
    if (!ctx) return;
    const current=()=>!audio.disposed&&audio.epoch===epoch&&feedSession.active&&!document.hidden&&(!isContact||performance.now()-requestedAt<=250);
    load(kind).then((buffer) => {
      if (!current()||!audio.ctx||audio.ctx.state!=='running'||(isContact&&audio.contactSource)) return;
      const source = audio.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(audio.gain);
      audio.sources.add(source);
      if(isContact){audio.contactSource=source;stats.contactPlays++;}
      source.onended=()=>{audio.sources.delete(source);if(audio.contactSource===source)audio.contactSource=null;source.disconnect();};
      source.start(0);
    }).catch(() => {if(current()&&(!isContact||!audio.contactSource))beep(kind);});
  };

  const stop=()=>{audio.epoch++;for(const source of [...audio.sources]){try{source.stop();}catch{}try{source.disconnect();}catch{}}audio.sources.clear();audio.contactSource=null;};
  const dispose = () => {
    audio.disposed=true;stop();
    try { if (audio.ctx) audio.ctx.close(); } catch (_) {}
    audio.ctx = null;
  };
  return { play, unlock, stop, dispose, stats };
}

function App() {
  const canvasRef = useRef(null);
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const shapesRef = useRef([]);
  const rafRef = useRef(0);
  const resizeObserverRef = useRef(null);
  const cfgRef = useRef(DEFAULT_CFG);
  const paletteRef = useRef(0);
  const gravityModeRef = useRef('calm');
  const hintRef = useRef(true);
  const pointerRef = useRef({ x: 0, y: 0, at: 0 });
  const drawingRef = useRef([]);
  const activePointerRef = useRef(null);
  const dragRef = useRef(null);
  const gyroRef = useRef({ pitch: 0, roll: 0 });
  const gyroStartedRef = useRef(false);
  const gyroWebHandlerRef = useRef(null);
  const contactsRef = useRef(new Map());
  const audioRef = useRef(null);
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [gravityMode, setGravityMode] = useState('calm');
  const [hintVisible, setHintVisible] = useState(true);
  const [shapeCount, setShapeCount] = useState(0);
  const [dragCount, setDragCount] = useState(0);

  cfgRef.current = cfg;
  paletteRef.current = paletteIndex;
  gravityModeRef.current = gravityMode;
  hintRef.current = hintVisible;

  useEffect(() => {
    let cancelled = false;
    fetch('./game.config.json')
      .then((response) => response.json())
      .then((raw) => {
        if (cancelled) return;
        const next = { ...DEFAULT_CFG };
        [...(raw.tweaks || []), ...(raw.texts || [])].forEach((item) => {
          next[item.id] = item.value;
        });
        setCfg(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const getPoint = useCallback((event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const startTilt = useCallback(() => {
    if (gyroStartedRef.current) return;
    gyroStartedRef.current = true;
    if (typeof tt !== 'undefined' && tt.startGyroscope) {
      const handler = (payload) => {
        if (!payload || payload.result === -1) return;
        gyroRef.current.pitch = payload.pitch || 0;
        gyroRef.current.roll = payload.roll || 0;
      };
      gyroWebHandlerRef.current = handler;
      try {
        if (tt.onGyroscopeChange) tt.onGyroscopeChange(handler);
        tt.startGyroscope({ interval: 50, fail: () => {} });
      } catch (_) {}
      return;
    }
    if (typeof DeviceOrientationEvent === 'undefined') return;
    const d2r = Math.PI / 180;
    const handler = (event) => {
      gyroRef.current.pitch = (event.beta || 0) * d2r;
      gyroRef.current.roll = (event.gamma || 0) * d2r;
    };
    gyroWebHandlerRef.current = handler;
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then((permission) => {
          if (permission === 'granted') window.addEventListener('deviceorientation', handler);
        }).catch(() => {});
      } else {
        window.addEventListener('deviceorientation', handler);
      }
    } catch (_) {}
  }, []);

  const pointHitsShape = useCallback((point) => {
    for (let i = shapesRef.current.length - 1; i >= 0; i -= 1) {
      const shape = shapesRef.current[i];
      const hits = Matter.Query.point(shape.bodies, point);
      if (hits.length) return { shape, body: hits[0] };
      let inside = false;
      const vertices = shape.ring.map((body) => body.position);
      for (let a = 0, b = vertices.length - 1; a < vertices.length; b = a, a += 1) {
        const crosses = ((vertices[a].y > point.y) !== (vertices[b].y > point.y)) &&
          (point.x < ((vertices[b].x - vertices[a].x) * (point.y - vertices[a].y)) / (vertices[b].y - vertices[a].y) + vertices[a].x);
        if (crosses) inside = !inside;
      }
      if (inside) return { shape, body: shape.center };
    }
    return null;
  }, []);

  const addShape = useCallback((rawPoints) => {
    const currentCfg = cfgRef.current;
    // Release joins the outline back to its beginning. A straight stroke has
    // no enclosed area and is not inflated into a narrow path-shaped ribbon.
    const ringPoints=closedOutline(rawPoints);if(!ringPoints)return false;
    const id = `doodle-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const minDimension = Math.max(18, Math.min(
      Math.max(...ringPoints.map((p) => p.x)) - Math.min(...ringPoints.map((p) => p.x)),
      Math.max(...ringPoints.map((p) => p.y)) - Math.min(...ringPoints.map((p) => p.y)),
    ));
    const radius = clamp(minDimension * 0.045, 5, 10);
    const collisionGroup=Matter.Body.nextGroup(true);
    const bodies = ringPoints.map((point) => Matter.Bodies.circle(point.x, point.y, radius, {
      label: `${id}:ring`,collisionFilter:{group:collisionGroup},
      friction: 0.62,
      frictionAir: 0.024,
      restitution: 0.34,
      density: 0.0014,
    }));
    const center = ringPoints.reduce((acc, point) => ({ x: acc.x + point.x / ringPoints.length, y: acc.y + point.y / ringPoints.length }), { x: 0, y: 0 });
    const centerBody = Matter.Bodies.circle(center.x, center.y, Math.max(9, radius * 0.9), {
      label: `${id}:center`,collisionFilter:{group:collisionGroup},
      friction: 0.62,
      frictionAir: 0.03,
      restitution: 0.28,
      density: 0.0011,
    });
    const constraints = [];
    for (let i = 0; i < bodies.length; i += 1) {
      const next = bodies[(i + 1) % bodies.length];
      constraints.push(Matter.Constraint.create({
        bodyA: bodies[i], bodyB: next,
        length: distance(ringPoints[i], ringPoints[(i + 1) % ringPoints.length]),
        stiffness: 0.25, damping: 0.07,
      }));
      constraints.push(Matter.Constraint.create({
        bodyA: centerBody, bodyB: bodies[i],
        length: distance(center, ringPoints[i]),
        stiffness: 0.12, damping: 0.055,
      }));
    }
    const composite = Matter.Composite.create({ label: `softbody:${id}` });
    Matter.Composite.add(composite, [...bodies, centerBody, ...constraints]);
    const shape = { composite, bodies: [...bodies, centerBody], ring: bodies, center: centerBody, color: paletteRef.current, eyeStyle:chooseEyeStyle(), gaze:{x:0,y:0,seed:Math.random()*Math.PI*2}, createdAt: performance.now() };
    Matter.Composite.add(engineRef.current.world, composite);
    shapesRef.current.push(shape);
    if (shapesRef.current.length > currentCfg.MAX_SHAPES) {
      const oldest = shapesRef.current.shift();
      Matter.Composite.remove(engineRef.current.world, oldest.composite);
    }
    setShapeCount(shapesRef.current.length);
    if (hintRef.current) {
      hintRef.current = false;
      setHintVisible(false);
    }
    audioRef.current?.play('plop');
    vibrate('medium');
    console.info('[doodle] created', { count: shapesRef.current.length, points: ringPoints.length });
    return true;
  }, []);

  const clearShapes = useCallback(() => {
    if (!engineRef.current) return;
    if (dragRef.current) {
      Matter.Composite.remove(engineRef.current.world, dragRef.current.constraint);
      dragRef.current = null;
    }
    shapesRef.current.forEach((shape) => Matter.Composite.remove(engineRef.current.world, shape.composite));
    shapesRef.current = [];
    contactsRef.current.clear();
    drawingRef.current = [];
    hintRef.current = true;
    setHintVisible(true);
    setShapeCount(0);
    audioRef.current?.stop();
    audioRef.current?.play('tap');
    vibrate('light');
    console.info('[doodle] cleared');
  }, []);

  const handlePointerDown = useCallback((event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.isPrimary === false) return;
    event.preventDefault();
    audioRef.current?.unlock();
    startTilt();
    const point = getPoint(event);
    pointerRef.current = {...point,at:performance.now()};
    activePointerRef.current = event.pointerId;
    try{canvasRef.current.setPointerCapture?.(event.pointerId);}catch{}
    const hit = pointHitsShape(point);
    if (hit) {
      const constraint = Matter.Constraint.create({
        pointA: point,
        bodyB: hit.body,
        stiffness: 0.16,
        damping: 0.12,
      });
      Matter.Composite.add(engineRef.current.world, constraint);
      dragRef.current = { constraint, shape: hit.shape };
    } else {
      const next=chooseShapeColor();paletteRef.current=next;setPaletteIndex(next);
      drawingRef.current = [point];
    }
  }, [getPoint, pointHitsShape, startTilt]);

  const handlePointerMove = useCallback((event) => {
    const point = getPoint(event);pointerRef.current = {...point,at:performance.now()};
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    if (dragRef.current) {
      dragRef.current.constraint.pointA.x = point.x;
      dragRef.current.constraint.pointA.y = point.y;
      return;
    }
    const points = drawingRef.current;
    const previous = points[points.length - 1];
    if (!previous || distance(previous, point) >= 4) points.push(point);
  }, [getPoint]);

  const handlePointerUp = useCallback((event) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    const point = getPoint(event);
    pointerRef.current = {...point,at:performance.now()};
    if (dragRef.current) {
      Matter.Composite.remove(engineRef.current.world, dragRef.current.constraint);
      dragRef.current = null;
      setDragCount((count) => count + 1);
      audioRef.current?.play('contact');
      vibrate('medium');
    } else {
      addShape(drawingRef.current);
      drawingRef.current = [];
    }
    activePointerRef.current = null;
    try { canvasRef.current.releasePointerCapture?.(event.pointerId); } catch (_) {}
  }, [addShape, getPoint]);

  useEffect(() => {
    audioRef.current = makeAudioController();
    const unsubscribeAudio=feedSession.subscribe(active=>{if(!active)audioRef.current?.stop();});
    const canvas = canvasRef.current;
    const host = hostRef.current;
    const engine = Matter.Engine.create();
    engine.gravity.y = DEFAULT_CFG.CALM_GRAVITY;
    engine.gravity.scale = 0.001;
    engineRef.current = engine;

    const addBounds = () => {
      const width = canvas.clientWidth || 320;
      const height = canvas.clientHeight || 640;
      const oldBounds = engine.__doodleBounds || [];
      oldBounds.forEach((body) => Matter.Composite.remove(engine.world, body));
      const thickness = 70;
      const bounds = [
        Matter.Bodies.rectangle(width / 2, -thickness / 2, width + thickness * 2, thickness, { isStatic: true, label: 'doodle:bound' }),
        Matter.Bodies.rectangle(width / 2, height - 112 + thickness / 2, width + thickness * 2, thickness, { isStatic: true, label: 'doodle:bound' }),
        Matter.Bodies.rectangle(-thickness / 2, height / 2, thickness, height + thickness * 2, { isStatic: true, label: 'doodle:bound' }),
        Matter.Bodies.rectangle(width + thickness / 2, height / 2, thickness, height + thickness * 2, { isStatic: true, label: 'doodle:bound' }),
      ];
      engine.__doodleBounds = bounds;
      Matter.Composite.add(engine.world, bounds);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };
    addBounds();
    resizeObserverRef.current = new ResizeObserver(addBounds);
    resizeObserverRef.current.observe(host);

    const onCollision = (event) => {
      if(!feedSession.active||document.hidden)return;
      if(noteShapeContacts(contactsRef.current,event.pairs,performance.now())){
        audioRef.current?.play('contact');
        vibrate('light');
      }
    };
    const onContactActive=event=>{noteShapeContacts(contactsRef.current,event.pairs,performance.now(),false);};
    Matter.Events.on(engine, 'collisionStart', onCollision);
    Matter.Events.on(engine, 'collisionActive', onContactActive);

    const eyeFrames=EYE_FILES.map(createEyeFrame);
    const ctx = canvas.getContext('2d');
    const drawShape = (shape, context,time,elapsed) => {
      const ring = shape.ring;
      if (!ring.length) return;
      const points = ring.map((body) => body.position);
      let cx = 0; let cy = 0;
      points.forEach((point) => { cx += point.x; cy += point.y; });
      cx /= points.length; cy /= points.length;
      const palette = PALETTES[shape.color % PALETTES.length];
      context.save();
      context.fillStyle = palette.fill;
      context.strokeStyle = palette.stroke;
      context.lineWidth = 2.3;
      context.lineJoin = 'round';
      const first = points[0];
      const last = points[points.length - 1];
      context.beginPath();
      context.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
      points.forEach((point, index) => {
        const next = points[(index + 1) % points.length];
        context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
      });
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();

      const eyeGap = clamp(Math.min(34, Math.max(21, points.length ? (Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x))) * 0.22 : 24)), 18, 34);
      const eyeRadius = clamp(eyeGap * 0.45, 9, 16);
      context.save();
      context.translate(cx, cy - eyeRadius * 0.2);
      const eyeWidth=clamp(eyeGap*2.25,40,79),gaze=shape.gaze,target=pupilTarget(time,gaze.seed,pointerRef.current,cx,cy,reducedMotionQuery.matches),follow=reducedMotionQuery.matches?1:1-Math.exp(-elapsed/90);
      gaze.x+=(target.x-gaze.x)*follow;gaze.y+=(target.y-gaze.y)*follow;
      if(!paintPupilEyes(context,eyeFrames[shape.eyeStyle],eyeWidth,gaze))for(const side of[-1,1]){context.fillStyle='#fff';context.beginPath();context.ellipse(side*eyeGap*.52,0,eyeRadius,eyeRadius*1.16,0,0,Math.PI*2);context.fill();context.fillStyle='#25232b';context.beginPath();context.arc(side*eyeGap*.52+gaze.x*eyeRadius*.22,gaze.y*eyeRadius*.18,eyeRadius*.47,0,Math.PI*2);context.fill();}
      context.restore();
    };

    let lastRender=0;
    const render = (time) => {
      const elapsed=Math.min(50,Math.max(0,time-(lastRender||time-16.667)));lastRender=time;
      if(document.hidden){rafRef.current=requestAnimationFrame(render);return;}
      const width = canvas.clientWidth || 320;
      const height = canvas.clientHeight || 640;
      const dpr = window.devicePixelRatio || 1;
      if(feedSession.active)Matter.Engine.update(engine, 16.666);
      const gyro = gyroRef.current;
      const baseGravity = gravityModeRef.current === 'calm' ? cfgRef.current.CALM_GRAVITY : cfgRef.current.SETTLE_GRAVITY;
      engine.gravity.y = baseGravity + clamp(gyro.pitch * 0.035, -0.12, 0.12);
      engine.gravity.x = clamp(gyro.roll * 0.5, -0.7, 0.7);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#FFF6E8';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(212, 166, 128, 0.12)';
      for (let x = 24; x < width; x += 52) {
        for (let y = 86; y < height; y += 64) {
          ctx.beginPath(); ctx.arc(x + ((y / 64) % 2) * 11, y, 1.4, 0, Math.PI * 2); ctx.fill();
        }
      }
      shapesRef.current.forEach((shape) => drawShape(shape, ctx,time,elapsed));
      canvas.dataset.shapeColors=shapesRef.current.map(s=>PALETTES[s.color].fill).join(",");canvas.dataset.pupilGlances=JSON.stringify(shapesRef.current.map(s=>({style:s.eyeStyle,x:+s.gaze.x.toFixed(3),y:+s.gaze.y.toFixed(3)})));canvas.dataset.eyeFrameReady=String(eyeFrames.filter(frame=>frame.mask).length);
      canvas.dataset.contactSounds=String(audioRef.current?.stats.contactPlays||0);
      const draft = drawingRef.current;
      if (draft.length > 1) {
        ctx.save();
        ctx.strokeStyle = PALETTES[paletteRef.current].stroke;
        ctx.globalAlpha = 0.72;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([7, 8]);
        ctx.beginPath(); ctx.moveTo(draft[0].x, draft[0].y);
        draft.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.closePath();ctx.fillStyle=PALETTES[paletteRef.current].fill;ctx.globalAlpha=.22;ctx.fill();ctx.globalAlpha=.8;ctx.stroke(); ctx.restore();
      }
      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      Matter.Events.off(engine, 'collisionStart', onCollision);
      Matter.Events.off(engine, 'collisionActive', onContactActive);
      unsubscribeAudio();
      resizeObserverRef.current?.disconnect();
      if (typeof tt !== 'undefined' && tt.stopGyroscope) { try { tt.stopGyroscope(); } catch (_) {} }
      if (gyroWebHandlerRef.current) window.removeEventListener('deviceorientation', gyroWebHandlerRef.current);
      audioRef.current?.dispose();
      Matter.Composite.clear(engine.world, false);
      engineRef.current = null;
    };
  }, []);

  const togglePalette = () => {
    shapesRef.current.forEach(shape=>{shape.color=chooseShapeColor();});
    const next = chooseShapeColor();
    setPaletteIndex(next);
    paletteRef.current = next;
    audioRef.current?.play('tap');
    vibrate('light');
  };
  const toggleGravity = () => {
    const next = gravityMode === 'calm' ? 'settle' : 'calm';
    setGravityMode(next);
    gravityModeRef.current = next;
    audioRef.current?.play('tap');
    vibrate('light');
  };

  return (
    <div ref={hostRef} className="doodle-app" data-shape-count={shapeCount} data-shape-colors={shapesRef.current.map(s=>PALETTES[s.color].fill).join(",")} data-random-colors="true" data-eye-styles={shapesRef.current.map(s=>s.eyeStyle).join(",")} data-closed-shapes="true" data-drag-count={dragCount} data-gravity-mode={gravityMode}>
      <canvas
        ref={canvasRef}
        className="doodle-canvas"
        aria-label="Interactive drawing canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={event=>{drawingRef.current=[];handlePointerUp(event);}}
      />
      {hintVisible && <div className="hint" data-testid="draw-hint">{cfg.DRAW_HINT}</div>}
      <div className="controls" aria-label="Drawing controls">
        <button type="button" className="tool-button" aria-label="Shuffle colors" data-testid="palette-button" onClick={togglePalette}>
          <span className="palette-swatch" style={{ background: PALETTES[paletteIndex].fill }} />
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.2a7.8 7.8 0 1 0 0 15.6h1.35a2 2 0 0 0 1.42-3.42l-.42-.42a1.35 1.35 0 0 1 .96-2.3H17A4.8 4.8 0 0 0 21.8 8.9C20.55 6.08 16.8 4.2 12 4.2Z" /><circle cx="7.8" cy="10" r="1" /><circle cx="10.7" cy="7.6" r="1" /><circle cx="14.2" cy="7.5" r="1" /></svg>
        </button>
        <button type="button" className="tool-button" aria-label="Toggle gravity" data-testid="gravity-button" onClick={toggleGravity}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v14M7 12l5 5 5-5M5 6h14" /></svg>
        </button>
        <button type="button" className="tool-button" aria-label="Clear canvas" data-testid="clear-button" onClick={clearShapes}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2m-8 0 1 13h8l1-13M10 10v7m4-7v7" /></svg>
        </button>
      </div>
      <style>{`
@font-face {
  font-family: 'DynaPuff';
  src: url('./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

:root {
  --font-display: "DynaPuff", "PingFang SC", system-ui, sans-serif;
  --font-body:    "DynaPuff", "PingFang SC", system-ui, sans-serif;
  --font-mono:   ui-monospace, Menlo, monospace;
}

* { box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
body { background: #FFF6E8; -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
.doodle-app { position: relative; width: 100%; height: 100%; min-height: 0; overflow: clip; background: #FFF6E8; }
.doodle-canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.hint { position: absolute; top: max(26px, env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); color: #785B57; font-family: var(--font-body); font-size: 17px; line-height: 1.2; white-space: nowrap; letter-spacing: .01em; pointer-events: none; }
.controls { position: absolute; right: 16px; bottom: max(18px, env(safe-area-inset-bottom, 0px)); display: flex; gap: 10px; align-items: center; }
.tool-button { position: relative; display: grid; place-items: center; width: 46px; height: 46px; padding: 0; border: 0; border-radius: 50%; color: #705757; background: rgba(255,255,255,.94); box-shadow: 0 5px 13px rgba(134, 94, 83, .17), 0 1px 2px rgba(134,94,83,.13); cursor: pointer; transition: transform .16s ease, box-shadow .16s ease; }
.tool-button:active { transform: translateY(2px) scale(.96); box-shadow: 0 2px 6px rgba(134,94,83,.14); }
.tool-button svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.palette-swatch { position: absolute; right: 9px; top: 9px; width: 7px; height: 7px; border-radius: 50%; border: 1px solid rgba(91,64,67,.3); }
@media (max-width: 360px) { .controls { right: 12px; gap: 7px; } .tool-button { width: 42px; height: 42px; } }
      `}</style>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<><App/><BatchPolish/></>);
