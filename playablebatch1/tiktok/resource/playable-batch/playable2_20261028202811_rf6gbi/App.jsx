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
      {GAME_NUMBER === 80 && <svg viewBox="0 0 320 220"><defs><pattern id="paper80-preview" width="220" height="220" patternUnits="userSpaceOnUse"><image href="./assets/paper-grain.svg" width="220" height="220"/></pattern></defs><g className="example-blob"><path d="M78 61C112 16 184 23 192 66C206 88 248 75 249 113C251 162 200 176 165 166C117 195 69 166 80 124C40 101 47 78 78 61Z" fill={demoPalette.fill} stroke={demoPalette.stroke} strokeWidth="1.8"/><path d="M78 61C112 16 184 23 192 66C206 88 248 75 249 113C251 162 200 176 165 166C117 195 69 166 80 124C40 101 47 78 78 61Z" fill="url(#paper80-preview)" style={{mixBlendMode:'multiply',opacity:.74}}/><PreviewSquishyEyes/></g></svg>}
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
const POLISH_CSS=BASE_CSS+".hint{top:24%;left:30px;right:30px;transform:translateY(-50%);font-size:18px;line-height:1.3;text-align:center;white-space:normal;color:#242322;-webkit-text-stroke:.15px currentColor;animation:batchBreathe 2.6s ease-in-out infinite}.controls{left:50%;right:auto;bottom:50px;transform:translateX(-50%);gap:12px}.tool-button{width:48px;height:48px;border:1.6px solid #242322;box-shadow:2px 3px 0 #242322}[data-feed-preview=true] .controls{visibility:hidden}";

const DEFAULT_CFG = {
  DRAW_HINT: 'Draw a closed shape',
  MAX_SHAPES: 9,
  CALM_GRAVITY: 0.04,
  SETTLE_GRAVITY: 1,
  MIN_POINTS: 14,
  CLOSE_DISTANCE: 42,
  MAX_POINT_DISTANCE: 18,
};

const COLOR_SETS = [
  { name:'Print', colors:['#d8eb61','#59c6b1','#ee94ac'] },
  { name:'Coast', colors:['#7e9ee6','#9fd7e1','#b5a3dc'] },
  { name:'Garden', colors:['#b9cf78','#f1d878','#e99b9d'] },
  { name:'Pastel', colors:['#eaa6c1','#a6b6ec','#a9d4b7'] },
];
const PALETTES = COLOR_SETS.flatMap(set=>set.colors.map(fill=>({fill,hi:fill,stroke:'#242322',eye:'#242322'})));

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

const colorBags=COLOR_SETS.map(()=>[]),lastSetColors=COLOR_SETS.map(()=>-1);
function chooseShapeColor(setIndex=0){
  const set=((setIndex%COLOR_SETS.length)+COLOR_SETS.length)%COLOR_SETS.length;
  if(!colorBags[set].length){
    const bag=[set*3,set*3+1,set*3+2];
    for(let i=bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
    if(bag.at(-1)===lastSetColors[set])[bag[0],bag[bag.length-1]]=[bag.at(-1),bag[0]];
    colorBags[set]=bag;
  }
  return lastSetColors[set]=colorBags[set].pop();
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

/* FILLED_SOFT_PHYSICS_START */
function softArea(points){return points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)*.5;}
function createSoftShape(ringPoints,id,color){
  const minDimension=Math.max(18,Math.min(Math.max(...ringPoints.map(p=>p.x))-Math.min(...ringPoints.map(p=>p.x)),Math.max(...ringPoints.map(p=>p.y))-Math.min(...ringPoints.map(p=>p.y))));
  const radius=clamp(minDimension*.045,5,10),group=Matter.Body.nextGroup(true);
  // Nodes still collide with the walls. Filled outlines handle inter-blob contact.
  const filter={group,category:0x0002,mask:0x0001};
  const ring=ringPoints.map(p=>Matter.Bodies.circle(p.x,p.y,radius,{label:id+':ring',collisionFilter:{...filter},friction:.62,frictionAir:.018,restitution:.62,density:.0014}));
  const centerPoint=ringPoints.reduce((c,p)=>({x:c.x+p.x/ringPoints.length,y:c.y+p.y/ringPoints.length}),{x:0,y:0});
  const center=Matter.Bodies.circle(centerPoint.x,centerPoint.y,Math.max(9,radius*.9),{label:id+':center',collisionFilter:{...filter},friction:.62,frictionAir:.024,restitution:.48,density:.0011});
  const constraints=[];
  ring.forEach((body,i)=>{constraints.push(Matter.Constraint.create({bodyA:body,bodyB:ring[(i+1)%ring.length],length:distance(ringPoints[i],ringPoints[(i+1)%ring.length]),stiffness:.205,damping:.055}));constraints.push(Matter.Constraint.create({bodyA:center,bodyB:body,length:distance(centerPoint,ringPoints[i]),stiffness:.09,damping:.045}));});
  const bodies=[...ring,center],composite=Matter.Composite.create({label:'softbody:'+id});Matter.Composite.add(composite,[...bodies,...constraints]);
  return {composite,bodies,ring,center,softContacts:new WeakMap(),contactClock:0,restArea:softArea(ringPoints),restOffsets:ringPoints.map(p=>({x:p.x-centerPoint.x,y:p.y-centerPoint.y})),mass:bodies.reduce((n,b)=>n+b.mass,0),color,eyeStyle:chooseEyeStyle(),gaze:{x:0,y:0,seed:Math.random()*Math.PI*2},createdAt:performance.now()};
}
function softOutline(shape){
  const ring=shape.ring,points=[];
  ring.forEach((body,i)=>{const p=body.position,a=ring[(i+ring.length-1)%ring.length].position,b=ring[(i+1)%ring.length].position;points.push({x:(a.x+p.x)*.5,y:(a.y+p.y)*.5},{x:a.x*.125+p.x*.75+b.x*.125,y:a.y*.125+p.y*.75+b.y*.125});});
  return points;
}
function softBounds(points){let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}return {minX,minY,maxX,maxY};}
function softPointInside(p,polygon,dx=0,dy=0){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>p.y-dy)!==(b.y>p.y-dy)&&(p.x-dx)<(b.x-a.x)*(p.y-dy-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
function softPolygonsOverlap(a,b,dx=0,dy=0){
  const aa=softBounds(a),bb=softBounds(b);if(aa.maxX+dx<=bb.minX||bb.maxX<=aa.minX+dx||aa.maxY+dy<=bb.minY||bb.maxY<=aa.minY+dy)return false;
  if(softPointInside({x:a[0].x+dx,y:a[0].y+dy},b)||softPointInside(b[0],a,dx,dy))return true;
  const cross=(ax,ay,bx,by,cx,cy)=>(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
  for(let i=0;i<a.length;i++){const p=a[i],q=a[(i+1)%a.length],px=p.x+dx,py=p.y+dy,qx=q.x+dx,qy=q.y+dy;for(let j=0;j<b.length;j++){const r=b[j],s=b[(j+1)%b.length];if(Math.max(px,qx)<=Math.min(r.x,s.x)||Math.max(r.x,s.x)<=Math.min(px,qx)||Math.max(py,qy)<=Math.min(r.y,s.y)||Math.max(r.y,s.y)<=Math.min(py,qy))continue;if(cross(px,py,qx,qy,r.x,r.y)*cross(px,py,qx,qy,s.x,s.y)<-1e-8&&cross(r.x,r.y,s.x,s.y,px,py)*cross(r.x,r.y,s.x,s.y,qx,qy)<-1e-8)return true;}}
  return false;
}
function softHull(points){
  const p=points.slice().sort((a,b)=>a.x-b.x||a.y-b.y),cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),lower=[],upper=[];
  for(const v of p){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),v)<=0)lower.pop();lower.push(v);}for(let i=p.length-1;i>=0;i--){const v=p[i];while(upper.length>1&&cross(upper.at(-2),upper.at(-1),v)<=0)upper.pop();upper.push(v);}lower.pop();upper.pop();return lower.concat(upper);
}
function softSeparation(a,b){
  if(!softPolygonsOverlap(a,b))return null;
  const ah=softHull(a),bh=softHull(b),axes=[{x:0,y:1},{x:1,y:0}];for(const polygon of [ah,bh])for(let i=0;i<polygon.length;i++){const p=polygon[i],q=polygon[(i+1)%polygon.length],dx=q.x-p.x,dy=q.y-p.y,len=Math.hypot(dx,dy);if(len>1e-6)axes.push({x:-dy/len,y:dx/len});}
  let best=null;
  for(const axis of axes){let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;for(const p of ah){const d=p.x*axis.x+p.y*axis.y;amin=Math.min(amin,d);amax=Math.max(amax,d);}for(const p of bh){const d=p.x*axis.x+p.y*axis.y;bmin=Math.min(bmin,d);bmax=Math.max(bmax,d);}const negative=amax-bmin,positive=bmax-amin;if(negative<=0||positive<=0)return null;const depth=Math.min(negative,positive);if(!best||depth<best.depth-.1){const sign=positive<=negative?1:-1;best={x:axis.x*sign,y:axis.y*sign,depth};}}
  if(!best)return null;
  if(best.depth<1.5){best.depth+=.08;return best;}
  // Use the actual filled outline, so concave lobes can touch without a hull gap.
  let low=0,high=best.depth+.25;for(let i=0;i<9;i++){const mid=(low+high)*.5;if(softPolygonsOverlap(a,b,best.x*mid,best.y*mid))low=mid;else high=mid;}best.depth=high+.08;return best;
}
function softMotion(shape){const mass=shape.mass||shape.bodies.reduce((n,b)=>n+b.mass,0);return shape.bodies.reduce((v,b)=>({x:v.x+b.velocity.x*b.mass/mass,y:v.y+b.velocity.y*b.mass/mass}),{x:0,y:0});}
function moveSoftShape(shape,x,y){for(const b of shape.bodies)Matter.Body.translate(b,{x,y});}
function addSoftVelocity(shape,x,y){for(const b of shape.bodies)Matter.Body.setVelocity(b,{x:b.velocity.x+x,y:b.velocity.y+y});}
// Apply a collision impulse through the touching side, so the spring ring can
// compress and wobble rather than receiving only a rigid whole-blob rebound.
function addSoftContactVelocity(shape,normal,amount){
  const center=shape.center.position;
  const reach=Math.max(12,...shape.ring.map(b=>Math.abs((b.position.x-center.x)*normal.x+(b.position.y-center.y)*normal.y)));
  const weights=shape.bodies.map(b=>b===shape.center ? .85 : .8-clamp(((b.position.x-center.x)*normal.x+(b.position.y-center.y)*normal.y)/reach,-1,1)*.55);
  const mean=shape.bodies.reduce((sum,b,i)=>sum+weights[i]*b.mass/shape.mass,0);
  shape.bodies.forEach((b,i)=>{const impulse=amount*weights[i]/mean;Matter.Body.setVelocity(b,{x:b.velocity.x+normal.x*impulse,y:b.velocity.y+normal.y*impulse});});
}
function softNodeBounds(shape){return softBounds(shape.bodies.flatMap(b=>[{x:b.position.x-b.circleRadius,y:b.position.y-b.circleRadius},{x:b.position.x+b.circleRadius,y:b.position.y+b.circleRadius}]));}
function confineSoftShape(shape,bounds){
  for(const body of shape.bodies){
    const r=body.circleRadius,p=body.position;let x=0,y=0;
    if(p.x-r<0)x=r-p.x;else if(p.x+r>bounds.width)x=bounds.width-r-p.x;
    if(p.y-r<0)y=r-p.y;else if(p.y+r>bounds.floor)y=bounds.floor-r-p.y;
    if(x||y){const v={...body.velocity};Matter.Body.translate(body,{x,y});
      Matter.Body.setVelocity(body,{x:x*v.x<0?(Math.abs(v.x)>.7?-v.x*.58:0):v.x,y:y*v.y<0?(Math.abs(v.y)>.7?-v.y*.58:0):v.y});}
  }
}
// A weak, rotation-aware memory restores the drawn outline after a hard fling.
function recoverSoftOutline(shape,delta=8.333){
  let dot=0,cross=0;const origin=shape.center.position;
  shape.ring.forEach((body,i)=>{const rest=shape.restOffsets[i],x=body.position.x-origin.x,y=body.position.y-origin.y;dot+=rest.x*x+rest.y*y;cross+=rest.x*y-rest.y*x;});
  const angle=Math.atan2(cross,dot),c=Math.cos(angle),s=Math.sin(angle),recovery=softArea(shape.ring.map(b=>b.position))/shape.restArea<.55 ? .12 : .018;
  shape.ring.forEach((body,i)=>{const rest=shape.restOffsets[i],dx=origin.x+rest.x*c-rest.y*s-body.position.x,dy=origin.y+rest.x*s+rest.y*c-body.position.y,blend=Math.min(recovery*delta/8.333,2/Math.max(1,Math.hypot(dx,dy)));Matter.Body.translate(body,{x:dx*blend,y:dy*blend});});
}
// Gentle area pressure keeps a stretched blob full while its outline flexes.
function recoverSoftVolume(shape){
  const points=shape.ring.map(body=>body.position),area=softArea(points),error=shape.restArea-area;
  if(Math.abs(error)<Math.abs(shape.restArea)*.015)return;
  const gradients=points.map((p,i)=>{const before=points[(i+points.length-1)%points.length],after=points[(i+1)%points.length];return{x:(after.y-before.y)*.5,y:(before.x-after.x)*.5};});
  const norm=gradients.reduce((sum,g)=>sum+g.x*g.x+g.y*g.y,0);if(norm<1)return;
  const scale=error/norm*.20;
  shape.ring.forEach((body,i)=>{const g=gradients[i],length=Math.hypot(g.x,g.y),step=length?Math.min(1,3/(Math.abs(scale)*length)):0;Matter.Body.translate(body,{x:g.x*scale*step,y:g.y*scale*step});});
}
function softSupported(shape,normal,bounds){const b=softNodeBounds(shape);return normal.y>.5&&b.maxY>=bounds.floor-.6||normal.y<-.5&&b.minY<=.6||normal.x>.5&&b.maxX>=bounds.width-.6||normal.x<-.5&&b.minX<=.6;}
// Resting support propagates upward through touching blobs, so landing on a
// stack cannot push its middle layers down through the ones below.
function softSupportSet(shapes,bounds,dragged){
  const supported=new Set(),outlines=new Map(shapes.map(shape=>[shape,softOutline(shape)]));
  for(const shape of shapes)if(shape!==dragged&&softNodeBounds(shape).maxY>=bounds.floor-1&&softMotion(shape).y>-.35)supported.add(shape);
  for(let pass=0;pass<shapes.length;pass++){
    let changed=false;
    for(const upper of shapes){if(supported.has(upper)||upper===dragged)continue;
      const speed=softMotion(upper).y;if(speed<-.35||speed>1.3)continue;
      for(const lower of supported)if(upper.center.position.y<lower.center.position.y&&softPolygonsOverlap(outlines.get(upper),outlines.get(lower),0,1.6)){
        supported.add(upper);changed=true;break;
      }
    }
    if(!changed)break;
  }
  return supported;
}
function resolveFilledSoftContacts(shapes,bounds,dragged=null,delta=8.333){
  const contacts=new Map();
  for(const shape of shapes){
    recoverSoftOutline(shape,delta);shape.contactClock+=delta;
    shape.floorImpactCooldown=Math.max(0,(shape.floorImpactCooldown||0)-delta);
    const velocity=softMotion(shape);
    if(shape!==dragged&&!shape.floorImpactCooldown&&velocity.y>1.2&&softNodeBounds(shape).maxY>=bounds.floor-.8){
      addSoftContactVelocity(shape,{x:0,y:-1},velocity.y*1.58);shape.floorImpactCooldown=100;
    }
  }
  const ordered=shapes.slice().sort((a,b)=>b.center.position.y-a.center.position.y),supported=softSupportSet(ordered,bounds,dragged);
  for(let pass=0;pass<10;pass++){
    // Shape recovery runs once; later passes only finish contact separation.
    // This avoids expanding a settled blob back inside its neighbour each pass.
    for(const shape of ordered){if(pass<3)recoverSoftVolume(shape);confineSoftShape(shape,bounds);}
    let corrected=false;
    for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){
      const a=ordered[i],b=ordered[j],hit=softSeparation(softOutline(a),softOutline(b));if(!hit)continue;
      const va=softMotion(a),vb=softMotion(b),key=i+':'+j,now=Math.max(a.contactClock,b.contactClock);
      let state=a.softContacts.get(b);if(!state){state={lastTouch:-Infinity,lastBounce:-Infinity};a.softContacts.set(b,state);b.softContacts.set(a,state);}
      const first=!contacts.has(key),fresh=now-state.lastTouch>65;
      if(first){contacts.set(key,{bodyA:{label:a.center.label,velocity:{...va}},bodyB:{label:b.center.label,velocity:{...vb}},collision:{normal:{x:hit.x,y:hit.y}}});state.lastTouch=now;}
      let ia=a===dragged||softSupported(a,hit,bounds)||(supported.has(a)&&hit.y>.5)?0:1/a.mass;
      let ib=b===dragged||softSupported(b,{x:-hit.x,y:-hit.y},bounds)||(supported.has(b)&&hit.y<-.5)?0:1/b.mass;
      if(ia+ib===0){ia=1/a.mass;ib=1/b.mass;}const wa=ia/(ia+ib),wb=ib/(ia+ib);
      moveSoftShape(a,hit.x*hit.depth*wa,hit.y*hit.depth*wa);moveSoftShape(b,-hit.x*hit.depth*wb,-hit.y*hit.depth*wb);corrected=true;
      const approach=(va.x-vb.x)*hit.x+(va.y-vb.y)*hit.y,tangent={x:-hit.y,y:hit.x},slide=(va.x-vb.x)*tangent.x+(va.y-vb.y)*tangent.y;
      if(approach<0){
        const bounce=first&&approach<-.7&&(fresh||(approach<-3&&now-state.lastBounce>90))?.64:0,impulse=-approach*(1+bounce);
        if(bounce){state.lastBounce=now;addSoftContactVelocity(a,hit,impulse*wa);addSoftContactVelocity(b,{x:-hit.x,y:-hit.y},impulse*wb);}
        else{addSoftVelocity(a,hit.x*impulse*wa,hit.y*impulse*wa);addSoftVelocity(b,-hit.x*impulse*wb,-hit.y*impulse*wb);}
        const friction=clamp(slide,-impulse*.3,impulse*.3);addSoftVelocity(a,-tangent.x*friction*wa,-tangent.y*friction*wa);addSoftVelocity(b,tangent.x*friction*wb,tangent.y*friction*wb);
      }
      if(first&&Math.abs(approach)<.45&&Math.abs(slide)<.55){
        addSoftVelocity(a,-tangent.x*slide*.28*wa,-tangent.y*slide*.28*wa);addSoftVelocity(b,tangent.x*slide*.28*wb,tangent.y*slide*.28*wb);
      }
    }
    if(!corrected)break;
  }
  return [...contacts.values()];
}
// Keep fast flicks from stepping across small blobs in one collision update.
function stepSoftWorld(engine,shapes,bounds,dragged=null){
  let speed=0;for(const shape of shapes)for(const body of shape.bodies){
    const v=body.velocity,length=Math.hypot(v.x,v.y);if(length>70)Matter.Body.setVelocity(body,{x:v.x*70/length,y:v.y*70/length});speed=Math.max(speed,Math.min(length,70));
  }
  const count=clamp(Math.ceil(speed/4),2,8),delta=16.666/count,contacts=[];
  for(let step=0;step<count;step++){Matter.Engine.update(engine,delta);contacts.push(...resolveFilledSoftContacts(shapes,bounds,dragged,delta));}
  return contacts;
}
/* FILLED_SOFT_PHYSICS_END */

function App() {
  const canvasRef = useRef(null);
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const shapesRef = useRef([]);
  const rafRef = useRef(0);
  const resizeObserverRef = useRef(null);
  const cfgRef = useRef(DEFAULT_CFG);
  const paletteRef = useRef(0);
  const colorSetRef = useRef(0);
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
  const [colorSetIndex, setColorSetIndex] = useState(0);
  const [gravityMode, setGravityMode] = useState('calm');
  const [hintVisible, setHintVisible] = useState(true);
  const [shapeCount, setShapeCount] = useState(0);
  const [dragCount, setDragCount] = useState(0);

  cfgRef.current = cfg;
  colorSetRef.current = colorSetIndex;
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
    const shape = createSoftShape(ringPoints,id,paletteRef.current);
    Matter.Composite.add(engineRef.current.world, shape.composite);
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
      paletteRef.current=chooseShapeColor(colorSetRef.current);
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
    const engine = Matter.Engine.create({positionIterations:8,constraintIterations:4});
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


    const eyeFrames=EYE_FILES.map(createEyeFrame);
    const ctx = canvas.getContext('2d');
    const paperImage = new Image(); let paperPattern = null;
    paperImage.onload = () => { paperPattern = ctx.createPattern(paperImage, 'repeat'); };
    paperImage.src = './assets/paper-grain.svg';
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
      context.lineWidth = 1.8;
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
      if(feedSession.active){
        const contacts=stepSoftWorld(engine,shapesRef.current,{width,height,floor:height-112},dragRef.current?.shape);
        onCollision({pairs:contacts});
      }
      const gyro = gyroRef.current;
      const baseGravity = gravityModeRef.current === 'calm' ? cfgRef.current.CALM_GRAVITY : cfgRef.current.SETTLE_GRAVITY;
      engine.gravity.y = baseGravity + clamp(gyro.pitch * 0.035, -0.12, 0.12);
      engine.gravity.x = clamp(gyro.roll * 0.5, -0.7, 0.7);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#f39a61';
      ctx.fillRect(0, 0, width, height);
      // Faint printed guide dots belong to the paper, beneath every shape.
      ctx.save(); ctx.fillStyle='#242322'; ctx.globalAlpha=.12;
      ctx.beginPath();
      for (let x=16; x<width; x+=32) for (let y=16; y<height; y+=32) { ctx.moveTo(x+1.1,y); ctx.arc(x,y,1.1,0,Math.PI*2); }
      ctx.fill(); ctx.restore();
      shapesRef.current.forEach((shape) => drawShape(shape, ctx,time,elapsed));
      if (paperPattern) { ctx.save(); ctx.globalCompositeOperation='multiply'; ctx.globalAlpha=.74; ctx.fillStyle=paperPattern; ctx.fillRect(0,0,width,height); ctx.restore(); }
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
    const next=(colorSetRef.current+1)%COLOR_SETS.length;
    colorSetRef.current=next;
    setColorSetIndex(next);
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
    <div ref={hostRef} className="doodle-app" data-color-set={COLOR_SETS[colorSetIndex].name} data-shape-count={shapeCount} data-shape-colors={shapesRef.current.map(s=>PALETTES[s.color].fill).join(",")} data-random-colors="true" data-eye-styles={shapesRef.current.map(s=>s.eyeStyle).join(",")} data-closed-shapes="true" data-drag-count={dragCount} data-gravity-mode={gravityMode}>
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
        <button type="button" className="tool-button color-set-button" aria-label={'Change color set: '+COLOR_SETS[colorSetIndex].name} title="Tap for the next three-color set" data-testid="palette-button" onClick={togglePalette}>
          <span className="color-set-swatches" aria-hidden="true">{COLOR_SETS[colorSetIndex].colors.map(color=><span key={color} style={{background:color}}/>)}</span>
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
  font-family: 'Special Elite';
  src: url('./assets/fonts/special-elite/SpecialElite-Regular.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

:root {
  --font-display: "Special Elite", Georgia, serif;
  --font-body:    "Special Elite", Georgia, serif;
  --font-mono:   ui-monospace, Menlo, monospace;
}

* { box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
body { background: #f39a61; -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
.doodle-app { position: relative; width: 100%; height: 100%; min-height: 0; overflow: clip; background: #f39a61; }
.doodle-canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.hint { position: absolute; top: max(26px, env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); color: #242322; font-family: var(--font-body); font-size: 17px; line-height: 1.2; white-space: nowrap; letter-spacing: .01em; pointer-events: none; }
.controls { position: absolute; right: 16px; bottom: max(18px, env(safe-area-inset-bottom, 0px)); display: flex; gap: 10px; align-items: center; }
.tool-button { position: relative; display: grid; place-items: center; width: 46px; height: 46px; padding: 0; border: 1.6px solid #242322; border-radius: 50%; color: #242322; background: #fff8df url('./assets/paper-grain.svg') repeat; box-shadow: 2px 3px 0 #242322; cursor: pointer; transition: transform .16s ease, box-shadow .16s ease; }
.tool-button:active { transform: translateY(2px) scale(.96); box-shadow: 1px 1px 0 #242322; }
.tool-button svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
 .tool-button.color-set-button { width:90px; min-width:90px; border-radius:999px; }
.color-set-swatches { display:flex; gap:4px; align-items:center; }
.color-set-swatches>span { width:18px; height:18px; border:1px solid #242322; border-radius:50%; }
@media (max-width: 360px) { .controls { right: 12px; gap: 7px; } .tool-button { width: 42px; height: 42px; } }
      `}</style>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<><App/><BatchPolish/></>);

/* Current FYP palette adapter; no host UI is drawn into the game. */
(()=>{if(parent===window)return;
  // Feed palette: post a 32×12 RGBA band from the top and the bottom of the first screen. The feed
  // keeps the first valid post, so sample fast until one lands, then settle to once a second.
  const BAND = { w: 32, h: 12 };
  const post = (top, bottom) => parent.postMessage({ type: 'playable-palette', top, bottom }, '*');
  /** The game's main canvas: the largest one, if it covers a good part of the screen. */
  function mainCanvas() {
    const canvases = [...document.querySelectorAll('canvas')].filter(c => c.width && c.height);
    const source = canvases.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    return source && source.clientWidth * source.clientHeight >= innerWidth * innerHeight * 0.3 ? source : null;
  }
  function sampleCanvas(source) {
    try {
      const canvas = document.createElement('canvas'); canvas.width = BAND.w; canvas.height = 48;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      // Transparent canvas games paint their scene over a CSS background. Include that visible surface
      // rather than rejecting empty bands and leaving the generic blue/green fallback over dark games.
      for (let node = source; node && node.nodeType === 1; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        const channels = color.match(/[\d.]+/g);
        if (channels && (channels[3] === undefined || Number(channels[3]) > .5)) {
          ctx.fillStyle = color; ctx.fillRect(0,0,BAND.w,48); break;
        }
      }
      ctx.drawImage(source, 0, 0, BAND.w, 48);
      const top = Array.from(ctx.getImageData(0, 0, BAND.w, BAND.h).data);
      const bottom = Array.from(ctx.getImageData(0, 48 - BAND.h, BAND.w, BAND.h).data);
      return top.some((v, i) => i % 4 === 3 && v > 0) ? [top, bottom] : null;
    } catch { return null; }
  }
  /** DOM games: the painted background under a grid of points (images can't be read cross-origin). */
  function sampleDom() {
    const rgba = (el) => {
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const match = getComputedStyle(node).backgroundColor.match(/[\d.]+/g);
        if (match && (match[3] === undefined || Number(match[3]) > 0.5)) return [+match[0], +match[1], +match[2], 255];
      }
      return null;
    };
    const band = (y0) => {
      const out = [];
      for (let row = 0; row < BAND.h; row++) for (let col = 0; col < BAND.w; col++) {
        const x = (col + 0.5) / BAND.w * innerWidth, y = y0 + (row + 0.5) / BAND.h * innerHeight * 0.25;
        out.push(...(rgba(document.elementFromPoint(x, y)) ?? rgba(document.body) ?? rgba(document.documentElement) ?? [0, 0, 0, 0]));
      }
      return out;
    };
    const top = band(0), bottom = band(innerHeight * 0.75);
    return top.some((v, i) => i % 4 === 3 && v > 0) ? [top, bottom] : null;
  }
  let sampledOnce = false;
  function sample() {
    // Converted photo templates explicitly mark their asynchronous preload. Never lock
    // the feed palette to an empty canvas or loading veil instead of the actual scene.
    if (document.documentElement.dataset.playableLoading === 'true') return;
    const land = (found) => { if (found) { sampledOnce = true; post(...found); } return !!found; };
    const source = mainCanvas();
    if (!source) { if (document.body?.childElementCount) land(sampleDom()); return; }
    // WebGL may clear after compositing; if the direct read is empty, read inside the next frame.
    if (!land(sampleCanvas(source))) requestAnimationFrame(() => land(sampleCanvas(source)));
  }
  const schedule = () => { sample(); setTimeout(schedule, sampledOnce ? 1000 : 250); };
  // Let the app paint its first screen before reading it.
  if (document.readyState === 'complete') setTimeout(schedule, 300);
  else window.addEventListener('load', () => setTimeout(schedule, 300), { once: true });
})();
