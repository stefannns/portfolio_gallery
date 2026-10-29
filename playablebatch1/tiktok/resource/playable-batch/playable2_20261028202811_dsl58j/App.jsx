import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';


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

const GAME_NUMBER=82;
const POLISH_CSS=BASE_CSS+"";

const DEFAULT_CFG={WORLD_WIDTH:360,WORLD_HEIGHT:780,GRAVITY:1,DROP_INTERVAL_MS:92,MAX_SEGMENTS:42,CONE_TOP_Y:360,GAME_HINT:'Hold and swirl',HEIGHT_LABEL:'cm',VANILLA:'Vanilla',CHOCOLATE:'Chocolate',STRAWBERRY:'Strawberry',RESULT_TITLE:'Complete!',RESULT_HEIGHT:'Final height',PLAY_AGAIN:'Play again',POST_PLAY:'Post my play',BEST_LABEL:'Personal best'};
const MATERIALS={vanilla:0xfff1d3,chocolate:0x764b3b,strawberry:0xf2b0b7};
const CREAM_RADIUS=.27,ROPE_STEP=.085,PAD_LIMIT=.95,SERVE_STEP_MS=1000/120;
const CONE_RADIUS=.78,CONE_HEIGHT=1.35,NOZZLE_GAP=1.04,SETTLE_MS=900;
const FLIGHT_SECONDS=.24,FLOW_LENGTH_PER_SECOND=1.12,STRAND_FLATTENING=.82;
function padTarget(clientX,clientY,rect){
  const travel=Math.max(1,Math.min(rect.width,rect.height)/2-12);
  let u=(clientX-rect.left-rect.width/2)/travel,v=(clientY-rect.top-rect.height/2)/travel;
  const length=Math.hypot(u,v);if(length>1){u/=length;v/=length;}
  return {u,v,travel,x:(u*.936+v*.351)*PAD_LIMIT,z:(-u*.351+v*.936)*PAD_LIMIT};
}
function newServe(top=.36){
  return {top,points:[],pending:[],drops:[],airborneRuns:[],lastLay:null,flightSeconds:FLIGHT_SECONDS,cone:{x:0,y:0,z:0},target:{x:0,z:0},nozzle:{x:0,y:top+NOZZLE_GAP,z:0},holding:false,started:false,accumulator:0,emitClock:0,emitted:0,elapsed:0,pourTime:0,peak:0,finalHeight:0,flow:0,settling:0,firstLandingMs:null,pointerId:null,pointerLast:null,pointerOrigin:null,generatedVolume:0,landedVolume:0,spilledVolume:0,pathDistance:0,footprint:[],moving:true,rest:0,idleDrift:{x:0,z:0},depositRevision:0};
}
function startPour(w){w.holding=true;w.started=true;w.accumulator=0;}
function coneCatchHeight(w,p){
  const r=Math.hypot(p.x-w.cone.x,p.z-w.cone.z);
  if(r>=CONE_RADIUS+CREAM_RADIUS*.12)return null;
  const inner=Math.min(r,CONE_RADIUS-CREAM_RADIUS*.35),slope=CONE_HEIGHT/CONE_RADIUS;
  return w.top+w.cone.y-CONE_HEIGHT+inner*slope+CREAM_RADIUS*Math.sqrt(1+slope*slope);
}
function supportLevel(w,x,z,stroke){
  let y=coneCatchHeight(w,{x:x+w.cone.x,z:z+w.cone.z});
  if(y===null)return null;
  y-=w.cone.y;
  const diameter=CREAM_RADIUS*2*.96;
  for(const p of w.points){
    if(stroke-p.stroke<CREAM_RADIUS*2.5)continue;
    const d=Math.hypot(x-p.local.x,z-p.local.z);if(d>=diameter)continue;
    y=Math.max(y,p.local.y+Math.sqrt(diameter*diameter-d*d)*STRAND_FLATTENING);
  }
  return y;
}
function movementFootprint(w,dt){
  w.footprint.push({x:-w.cone.x,z:-w.cone.z,t:w.elapsed});
  while(w.footprint[0]?.t<w.elapsed-950)w.footprint.shift();
  let x=0,z=0;for(const p of w.footprint){x+=p.x;z+=p.z;}x/=w.footprint.length;z/=w.footprint.length;
  let spread=0;for(const p of w.footprint)spread+=(p.x-x)**2+(p.z-z)**2;
  w.moving=w.pourTime<.95||Math.sqrt(spread/w.footprint.length)>.022;
  w.rest+=(Number(!w.moving)-w.rest)*(1-Math.exp(-dt/.22));
  if(w.moving){w.idleDrift.x*=Math.exp(-dt/ .3);w.idleDrift.z*=Math.exp(-dt/.3);}
  else {const angle=Math.atan2(-w.cone.z,-w.cone.x)||.25;w.idleDrift.x+=Math.cos(angle)*.075*dt;w.idleDrift.z+=Math.sin(angle)*.075*dt;}
}
function landingTarget(w,parcel){
  return {x:parcel.x*.55-w.cone.x*.45,z:parcel.z*.55-w.cone.z*.45};
}
function layCream(w,parcel){
  const target=landingTarget(w,parcel),last=w.lastLay??w.points.at(-1),dt=1/60;
  target.x+=w.idleDrift.x;target.z+=w.idleDrift.z;
  if(Math.hypot(target.x,target.z)>CONE_RADIUS+CREAM_RADIUS*.1){
    w.spilledVolume+=parcel.volume;w.drops.push({x:target.x+w.cone.x,z:target.z+w.cone.z,y:w.top+w.cone.y,age:0});return;
  }
  let x=target.x,z=target.z;
  if(last){const dx=x-last.local.x,dz=z-last.local.z,d=Math.hypot(dx,dz),travel=Math.min(d,FLOW_LENGTH_PER_SECOND*dt*2.3),amount=d?travel/d:0;x=last.local.x+dx*amount;z=last.local.z+dz*amount;}
  const horizontal=last?Math.hypot(x-last.local.x,z-last.local.z):0;
  const stroke=w.pathDistance+horizontal;
  let y=supportLevel(w,x,z,stroke);if(y===null){w.spilledVolume+=parcel.volume;return;}
  if(last&&w.rest>.03){y=Math.max(y,last.local.y+.25*w.rest*dt);}
  // Adjacent material is one cohesive ribbon. A gentle slope gives continuous
  // coils; old turns provide the support for the next layer above them.
  if(last){const rise=Math.max(.006,horizontal*.85);y=Math.min(y,last.local.y+rise);const base=coneCatchHeight(w,{x:x+w.cone.x,z:z+w.cone.z});if(base!==null)y=Math.max(y,base-w.cone.y);}
  const gap=last&&Math.hypot(x-last.local.x,y-last.local.y,z-last.local.z)>.55;
  const tail=w.points.at(-1),distance=tail?Math.hypot(x-tail.local.x,y-tail.local.y,z-tail.local.z):Infinity;
  const local={x,y,z};
  if(tail&&distance<.035&&!gap){
    tail.volume+=parcel.volume;
  }else w.points.push({local,x:x+w.cone.x,y:y+w.cone.y,z:z+w.cone.z,settled:true,volume:parcel.volume,stroke,start:!last||!!gap});
  w.lastLay={local,stroke};
  w.pathDistance=stroke+(w.rest>.03?.25*w.rest*dt:0);w.landedVolume+=parcel.volume;w.depositRevision++;
  if(w.firstLandingMs===null)w.firstLandingMs=w.elapsed;
}
function updateFallingStream(w){
  const runs=[];let run=[];const last=w.points.at(-1);
  if(last)run.push({x:last.local.x+w.cone.x,y:last.local.y+w.cone.y,z:last.local.z+w.cone.z});
  for(const parcel of w.pending){
    const target=landingTarget(w,parcel),surface=supportLevel(w,target.x,target.z,w.pathDistance),t=Math.min(1,Math.max(0,(w.elapsed-parcel.born)/(w.flightSeconds*1000))),fall=t*t*(1.4-.4*t);
    const y=surface===null?w.top+w.cone.y-.2:surface+w.cone.y;
    run.push({x:(target.x+w.cone.x)*t,y:w.nozzle.y+(y-w.nozzle.y)*fall,z:(target.z+w.cone.z)*t});
  }
  if(w.holding)run.push({...w.nozzle});
  if(run.length>1)runs.push(run);
  for(const drop of w.drops){const age=drop.age,dy=2.2*age+4.9*age*age;runs.push([{x:drop.x,y:drop.y-dy,z:drop.z},{x:drop.x+.008,y:drop.y-dy+.12,z:drop.z}]);}
  w.airborneRuns=runs;
}
function simulateServe(w,cfg){
  const dt=SERVE_STEP_MS/1000,c=w.cone,follow=1-Math.exp(-dt/.045);
  w.flightSeconds=FLIGHT_SECONDS/Math.sqrt(Math.max(.2,Math.min(4,Number(cfg.GRAVITY)||1)));
  c.x+=(w.target.x-c.x)*follow;c.z+=(w.target.z-c.z)*follow;
  if(w.holding)c.y+=(-w.peak-c.y)*(1-Math.exp(-dt/.18));
  for(const p of w.points){p.x=p.local.x+c.x;p.y=p.local.y+c.y;p.z=p.local.z+c.z;}
  if(w.holding){
    w.pourTime+=dt;movementFootprint(w,dt);w.emitClock+=SERVE_STEP_MS;
    const volumeRate=Math.PI*CREAM_RADIUS**2*FLOW_LENGTH_PER_SECOND*(92/Math.max(60,Number(cfg.DROP_INTERVAL_MS)||92));
    while(w.emitClock+1e-7>=1000/60){w.emitClock-=1000/60;const volume=volumeRate/60;w.pending.push({x:-c.x,z:-c.z,born:w.elapsed,volume});w.generatedVolume+=volume;w.emitted++;}
    if(w.pourTime>=Math.max(24,Number(cfg.MAX_SEGMENTS)||42)*.8||w.points.length>=Math.max(24,Number(cfg.MAX_SEGMENTS)||42)*8){w.holding=false;w.pointerId=null;w.settling=SETTLE_MS;}
  }
  w.elapsed+=SERVE_STEP_MS;
  while(w.pending.length&&w.elapsed-w.pending[0].born>=w.flightSeconds*1000-1e-7)layCream(w,w.pending.shift());
  for(const drop of w.drops)drop.age+=dt;w.drops=w.drops.filter(drop=>drop.age<.55);
  w.peak=finishedHeight(w);w.flow+=(Number(w.holding)-w.flow)*(1-Math.exp(-dt/.10));updateFallingStream(w);
  if(w.settling>0){w.settling=Math.max(0,w.settling-SERVE_STEP_MS);if(!w.settling){if(w.pending.length||w.drops.length)w.settling=SERVE_STEP_MS;else return true;}}
  return false;
}
function advanceServe(w,elapsedMs,cfg){
  w.accumulator=Math.min(64,w.accumulator+Math.max(0,elapsedMs));let finished=false;
  while(w.accumulator+1e-7>=SERVE_STEP_MS){finished=simulateServe(w,cfg)||finished;w.accumulator-=SERVE_STEP_MS;}
  return finished;
}
function finishedHeight(w){
  let peak=0;for(const p of w.points)if(Math.hypot(p.local.x,p.local.z)<CONE_RADIUS+CREAM_RADIUS*.1)peak=Math.max(peak,p.local.y+CREAM_RADIUS*STRAND_FLATTENING-w.top);
  return Math.max(0,peak);
}
function creamSections(points){
  const landed=[];let run=[];
  for(const p of points){if(p.start&&run.length){landed.push(run);run=[];}run.push(p);}
  if(run.length)landed.push(run);
  return {landed,falling:[]};
}

function flutedTube(points,radius=CREAM_RADIUS,finished=false,segments,flatten=1) {
  const path=points.filter((p,i)=>!i||Math.hypot(p.x-points[i-1].x,p.y-points[i-1].y,p.z-points[i-1].z)>.0001);
  if(path.length<2)return null;
  const curve=new THREE.CatmullRomCurve3(path.map(p=>new THREE.Vector3(p.x,p.y,p.z)),false,'centripetal');
  // Sample each control span at a fixed density. Global arc-length sampling
  // shifts every old ring whenever a fresh piece is appended, which made an
  // otherwise stationary swirl look as though it was twitching.
  const count=segments??(path.length-1)*3,sides=48,samples=[],distances=[0],frames={normals:[],binormals:[]};
  for(let i=0;i<=count;i++){samples.push(curve.getPoint(i/count));if(i)distances.push(distances[i-1]+samples[i].distanceTo(samples[i-1]));}
  let previousTangent,normal;
  for(let i=0;i<=count;i++){
    const tangent=samples[Math.min(count,i+1)].clone().sub(samples[Math.max(0,i-1)]).normalize();
    if(!i)normal=new THREE.Vector3(Math.abs(tangent.x)>.9?0:1,0,Math.abs(tangent.x)>.9?1:0).projectOnPlane(tangent).normalize();
    else{const axis=new THREE.Vector3().crossVectors(previousTangent,tangent);if(axis.lengthSq()>1e-12)normal.applyAxisAngle(axis.normalize(),Math.acos(THREE.MathUtils.clamp(previousTangent.dot(tangent),-1,1)));normal.projectOnPlane(tangent).normalize();}
    frames.normals.push(normal.clone());frames.binormals.push(new THREE.Vector3().crossVectors(tangent,normal).normalize());previousTangent=tangent;
  }
  const length=distances[count],vertices=(count+1)*(sides+1)+2,positions=new Float32Array(vertices*3),uv=new Float32Array(vertices*2),indices=new (vertices>65535?Uint32Array:Uint16Array)((count*sides*2+sides*2)*3);
  let pi=0,ui=0,ii=0;
  for(let i=0;i<=count;i++){
    const center=samples[i],n=frames.normals[i],b=frames.binormals[i];
    const remaining=length-distances[i],tip=finished?Math.max(.018,Math.min(1,remaining/(radius*2.6))):1;
    const start=.78+.22*Math.min(1,distances[i]/(radius*1.3));
    for(let j=0;j<=sides;j++){
      // Six deeply fluted nozzle ridges, sampled smoothly instead of the old
      // twelve-sided round cord. The crest stays soft rather than serrated.
      const angle=j/sides*Math.PI*2,ringRadius=radius*(.90+.24*Math.cos(angle*6))*tip*start;
      const cosine=Math.cos(angle)*ringRadius,sine=Math.sin(angle)*ringRadius;
      positions[pi++]=center.x+n.x*cosine+b.x*sine;positions[pi++]=center.y+(n.y*cosine+b.y*sine)*flatten;positions[pi++]=center.z+n.z*cosine+b.z*sine;uv[ui++]=i/count;uv[ui++]=j/sides;
      if(i<count&&j<sides){const a=i*(sides+1)+j,c=a+sides+1;indices[ii++]=a;indices[ii++]=a+1;indices[ii++]=c;indices[ii++]=c;indices[ii++]=a+1;indices[ii++]=c+1;}
    }
  }
  // Close the beginning and tapered tip so neither end looks like a cut pipe.
  const first=samples[0],last=samples[count],cap=(count+1)*(sides+1);
  positions.set([first.x,first.y,first.z,last.x,last.y,last.z],pi);uv.set([0,.5,1,.5],ui);
  for(let j=0;j<sides;j++){indices[ii++]=cap;indices[ii++]=j+1;indices[ii++]=j;const end=count*(sides+1);indices[ii++]=cap+1;indices[ii++]=end+j;indices[ii++]=end+j+1;}
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeVertexNormals();
  const normals=geometry.attributes.normal;
  for(let i=0;i<=count;i++){const a=i*(sides+1),b=a+sides,n=new THREE.Vector3().fromBufferAttribute(normals,a).add(new THREE.Vector3().fromBufferAttribute(normals,b)).normalize();normals.setXYZ(a,n.x,n.y,n.z);normals.setXYZ(b,n.x,n.y,n.z);}
  geometry.computeBoundingSphere();
  return geometry;
}

function previewSwirl(top,progress){
  const points=[],count=Math.max(2,Math.round(145*progress));
  for(let i=0;i<count;i++){
    const t=i/144,angle=t*Math.PI*2*3.65-Math.PI/2,r=.53*Math.pow(Math.max(0,1-t),.72);
    const curl=Math.max(0,(t-.88)/.12);
    points.push({x:Math.cos(angle)*r+curl*curl*.09,y:top+.10+t*1.32+curl*.10,z:Math.sin(angle)*r});
  }
  return points;
}

function App(){
  const active=useFeedActive(),[cfg,setCfg]=useState(DEFAULT_CFG),[flavor,setFlavor]=useState('vanilla'),[height,setHeight]=useState(0),[phase,setPhase]=useState('ready'),[hint,setHint]=useState(true),[error,setError]=useState(''),[best,setBest]=useState(()=>{try{return Number(localStorage.getItem('softserve81-best-v2'))||0;}catch{return 0;}}),[submitting,setSubmitting]=useState(false);
  const canvasRef=useRef(null),world=useRef(null),padRef=useRef(null),dotRef=useRef(null),activeRef=useRef(active),cfgRef=useRef(cfg),phaseRef=useRef('ready'),flavorRef=useRef(flavor),audioRef=useRef(null),samples=useRef(new Map());
  const canSubmit=typeof tt!=='undefined'&&typeof tt.playableRecordingSubmission==='function';
  useEffect(()=>{cfgRef.current=cfg;},[cfg]);
  useEffect(()=>{flavorRef.current=flavor;world.current?.creamMaterial.color.setHex(MATERIALS[flavor]);},[flavor]);
  useEffect(()=>{activeRef.current=active;const w=world.current;if(w&&!active&&w.holding){w.holding=false;w.pointerId=null;w.settling=SETTLE_MS;phaseRef.current='settling';setPhase('settling');}if(w)w.accumulator=0;},[active]);
  useEffect(()=>{fetch('./game.config.json').then(r=>r.json()).then(raw=>setCfg({...DEFAULT_CFG,...Object.fromEntries([...raw.tweaks,...raw.texts].map(x=>[x.id,x.value]))})).catch(()=>{});},[]);
  const sound=type=>{
    if(!activeRef.current)return;
    try{const ctx=audioRef.current||(audioRef.current=new(window.AudioContext||window.webkitAudioContext)());ctx.resume().catch(()=>{});const file=type==='finish'?'sfx_result.mp3':'sfx_reset.mp3';let sample=samples.current.get(file);if(!sample){sample=fetch('./assets/'+file).then(r=>r.arrayBuffer()).then(b=>ctx.decodeAudioData(b)).catch(()=>null);samples.current.set(file,sample);}sample.then(buffer=>{if(!buffer||!activeRef.current||ctx.state!=='running')return;const node=ctx.createBufferSource(),gain=ctx.createGain();gain.gain.value=type==='finish'?.11:.07;node.buffer=buffer;node.connect(gain);gain.connect(ctx.destination);node.start();node.onended=()=>{node.disconnect();gain.disconnect();};});}catch{}
  };
  const restart=()=>{const w=world.current;if(!w)return;Object.assign(w,newServe(w.top));w.renderClock=99;w.creamDirty=true;w.landedSignature=null;w.fitZoom=null;phaseRef.current='ready';setPhase('ready');setHeight(0);setHint(true);if(dotRef.current)dotRef.current.style.transform='translate(0px,0px)';sound('tap');};
  useEffect(()=>{
    const canvas=canvasRef.current;let renderer;
    try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});}catch{setError('The 3D view could not open. Please try another browser.');return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setClearColor(0xfff9ed);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-2.3,2.3,2.3,-2.3,.1,40);camera.position.set(2.8,4.2,7.5);camera.lookAt(0,.7,0);
    const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;scene.environmentIntensity=.35;room.dispose();pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xfffdf1,0x9b9d83,2.0));
    const key=new THREE.DirectionalLight(0xfff3d6,2.9);key.position.set(-3.5,6,4);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-3;key.shadow.camera.right=3;key.shadow.camera.top=4;key.shadow.camera.bottom=-4;key.shadow.normalBias=.015;scene.add(key);
    const top=.36+(360-cfg.CONE_TOP_Y)/300,coneGroup=new THREE.Group();scene.add(coneGroup);
    const waffleMaterial=new THREE.MeshStandardMaterial({color:0xb78c4a,roughness:.95});
    const cone=new THREE.Mesh(new THREE.CylinderGeometry(CONE_RADIUS,.008,CONE_HEIGHT,64,1,true),waffleMaterial);cone.position.y=top-CONE_HEIGHT/2;cone.castShadow=true;cone.receiveShadow=true;coneGroup.add(cone);
    const inside=new THREE.Mesh(new THREE.CylinderGeometry(CONE_RADIUS-.025,.008,CONE_HEIGHT,64,1,true),new THREE.MeshStandardMaterial({color:0xa67c3c,roughness:1,side:THREE.BackSide}));inside.position.copy(cone.position);inside.receiveShadow=true;coneGroup.add(inside);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(CONE_RADIUS,.028,10,80),new THREE.MeshStandardMaterial({color:0xdab574,roughness:.88}));rim.rotation.x=Math.PI/2;rim.position.y=top;rim.castShadow=true;coneGroup.add(rim);
    const ribMaterial=new THREE.MeshStandardMaterial({color:0xd3aa66,roughness:1});
    for(const direction of [-1,1])for(let k=0;k<24;k++){
      const points=[];for(let j=0;j<=30;j++){const t=.015+j/30*.975,r=.01+t*CONE_RADIUS,a=k/24*Math.PI*2+direction*t*3.2;points.push(new THREE.Vector3(Math.cos(a)*r,top-CONE_HEIGHT+t*CONE_HEIGHT,Math.sin(a)*r));}
      const rib=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),30,.0055,4,false),ribMaterial);coneGroup.add(rib);
    }
    // A fixed, desaturated metal dispenser. Only the stem is allowed to
    // continue beyond the top edge, as it does on the reference machine.
    const dispenser=new THREE.Group(),metal=new THREE.MeshStandardMaterial({color:0x647a72,roughness:.65,metalness:.15}),outlet=top+NOZZLE_GAP;
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(.17,.17,5.5,32),metal);stem.position.y=outlet+2.96;
    const collar=new THREE.Mesh(new THREE.CylinderGeometry(.35,.35,.12,48),metal);collar.position.y=outlet+.25;
    const neck=new THREE.Mesh(new THREE.CylinderGeometry(.29,.29,.24,48),metal);neck.position.y=outlet+.11;
    const lip=new THREE.Mesh(new THREE.TorusGeometry(.294,.014,8,48),new THREE.MeshStandardMaterial({color:0x7b9188,roughness:.7}));lip.rotation.x=Math.PI/2;lip.position.y=outlet+.012;dispenser.add(stem,collar,neck,lip);scene.add(dispenser);
    const creamMaterial=new THREE.MeshStandardMaterial({color:MATERIALS[flavorRef.current],roughness:.69,metalness:0});
    const demo=new THREE.Mesh(flutedTube(previewSwirl(top,1),CREAM_RADIUS,true),creamMaterial);demo.castShadow=true;demo.receiveShadow=true;coneGroup.add(demo);
    const w={...newServe(top),scene,camera,renderer,coneGroup,dispenser,creamMaterial,demo,cream:null,lastTime:performance.now(),renderClock:99,fitZoom:null,drawCount:0};world.current=w;
    const viewUp=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion),viewRight=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),v=new THREE.Vector3();
    const resize=()=>{const r=canvas.getBoundingClientRect();renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);const size=4.6*(cfg.WORLD_HEIGHT/780)*(360/cfg.WORLD_WIDTH);camera.top=size/2;camera.bottom=-size/2;camera.left=-size*r.width/Math.max(1,r.height)/2;camera.right=-camera.left;camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();let raf;
    const frame=now=>{
      raf=requestAnimationFrame(frame);const elapsed=Math.min(64,Math.max(0,now-w.lastTime));w.lastTime=now;if(document.hidden){w.accumulator=0;return;}
      const preview=!activeRef.current&&!w.started;demo.visible=preview;dispenser.visible=!preview&&phaseRef.current!=='result';
      if(preview)coneGroup.rotation.y=reducedMotionQuery.matches?0:Math.sin(now*.0004)*.11;else coneGroup.rotation.y=0;
      if(activeRef.current&&['playing','settling'].includes(phaseRef.current)){
        const done=advanceServe(w,elapsed,cfgRef.current);w.creamDirty=true;
        if(!w.holding&&phaseRef.current==='playing'){phaseRef.current='settling';setPhase('settling');}
        if(done){w.finalHeight=finishedHeight(w);const value=w.finalHeight*10;setHeight(value);setBest(previous=>{const next=Math.max(previous,value);try{localStorage.setItem('softserve81-best-v2',String(next));}catch{}return next;});phaseRef.current='result';setPhase('result');sound('finish');}
      }
      coneGroup.position.set(w.cone.x,w.cone.y,w.cone.z);
      const measured=Math.max(0,(phaseRef.current==='result'?w.finalHeight:w.peak)*10);if(w.drawCount%8===0&&phaseRef.current!=='result')setHeight(measured);
      w.renderClock+=elapsed;
      if(w.creamDirty&&w.renderClock>=33){
        w.renderClock=0;w.creamDirty=false;
        const sections=creamSections(w.points);sections.falling=w.airborneRuns;const landed=w.points.filter(p=>p.settled&&!p.spilled).length;
        const smooth=points=>points.map((p,i)=>{if(!i||i===points.length-1)return p;const a=points[i-1],b=points[i+1];return{x:p.x*.7+(a.x+b.x)*.15,y:p.y*.7+(a.y+b.y)*.15,z:p.z*.7+(a.z+b.z)*.15};});
        const final=phaseRef.current==='result',signature=w.points.map(p=>p.spilled?'x':p.settled?'s':'f').join('')+':'+w.depositRevision+':'+final;
        if(w.landedSignature!==signature){
          w.landedSignature=signature;
          if(w.cream){coneGroup.remove(w.cream);w.cream.traverse(obj=>obj.geometry?.dispose());}
          w.cream=new THREE.Group();
          for(const run of sections.landed){const p=run[0].local,geometry=run.length===1?new THREE.SphereGeometry(CREAM_RADIUS,24,16).scale(1,STRAND_FLATTENING,1).translate(p.x,p.y,p.z):flutedTube(smooth(run.map(p=>p.local)),CREAM_RADIUS,final,undefined,STRAND_FLATTENING);if(geometry){const mesh=new THREE.Mesh(geometry,creamMaterial);mesh.castShadow=true;mesh.receiveShadow=true;w.cream.add(mesh);}}
          coneGroup.add(w.cream);
        }
        // Only the short unlanded tail is simulated and rebuilt continuously.
        // Deposited geometry rides with the cone as a stable local-space mesh.
        if(w.stream){scene.remove(w.stream);w.stream.traverse(obj=>obj.geometry?.dispose());}
        w.stream=new THREE.Group();
        for(const run of sections.falling){const geometry=flutedTube(smooth(run),CREAM_RADIUS,!w.holding);if(geometry){const mesh=new THREE.Mesh(geometry,creamMaterial);mesh.castShadow=true;mesh.receiveShadow=true;w.stream.add(mesh);}}
        scene.add(w.stream);
        w.landedCount=landed;
      }
      scene.updateMatrixWorld(true);
      let left=Infinity,right=-Infinity,lower=Infinity,upper=-Infinity;
      const include=(x,y,z,r=0)=>{v.set(x,y,z);const px=v.dot(viewRight),py=v.dot(viewUp);left=Math.min(left,px-r);right=Math.max(right,px+r);lower=Math.min(lower,py-r);upper=Math.max(upper,py+r);};
      include(w.cone.x,top-CONE_HEIGHT+w.cone.y,w.cone.z,.04);include(w.cone.x,top+w.cone.y,w.cone.z,CONE_RADIUS+.08);
      if(preview){include(0,top+1.55,0,.24);}else{
        for(const p of w.points)if(!p.spilled)include(p.x,p.y,p.z,CREAM_RADIUS*1.15);for(const run of w.airborneRuns)for(const p of run)include(p.x,p.y,p.z,CREAM_RADIUS);
        if(dispenser.visible)include(0,outlet+.28,0,.24);
      }
      const cw=canvas.clientWidth,ch=canvas.clientHeight,result=phaseRef.current==='result';
      if(cw&&ch){
        const zoom=Math.min(result?1.75:preview?1.3:1.12,(camera.right-camera.left)*(cw-36)/cw/Math.max(.1,2*Math.max(Math.abs(left),Math.abs(right))),(camera.top-camera.bottom)*(ch-34)/ch/Math.max(.1,upper-lower));
        camera.zoom+=(zoom-camera.zoom)*(reducedMotionQuery.matches?1:1-Math.exp(-elapsed/220));camera.zoom=Math.min(camera.zoom,zoom*1.02);camera.updateProjectionMatrix();
        const center=(upper+lower)/2+(result?0:.18),shift=center-camera.position.dot(viewUp);camera.position.addScaledVector(viewUp,shift*(reducedMotionQuery.matches?1:1-Math.exp(-elapsed/180)));camera.updateMatrixWorld(true);
        const half=(camera.top-camera.bottom)/camera.zoom/2,margin=12/ch*half*2,current=camera.position.dot(viewUp),actualCenter=Math.max(upper-half+margin,Math.min(lower+half-margin,current));camera.position.addScaledVector(viewUp,actualCenter-current);camera.updateMatrixWorld(true);canvas.dataset.sceneTopPx=((half-upper+actualCenter)/(half*2)*ch).toFixed(1);canvas.dataset.sceneBottomPx=((half-lower+actualCenter)/(half*2)*ch).toFixed(1);
      }
      w.drawCount++;canvas.dataset.creamPoints=String(w.points.length);canvas.dataset.coneFill='none';canvas.dataset.holding=String(w.holding);canvas.dataset.previewSwirl=String(preview);canvas.dataset.coneX=w.cone.x.toFixed(4);canvas.dataset.coneZ=w.cone.z.toFixed(4);canvas.dataset.coneY=w.cone.y.toFixed(4);canvas.dataset.nozzleX='0';canvas.dataset.nozzleZ='0';canvas.dataset.height=measured.toFixed(2);canvas.dataset.interaction='move-cone';canvas.dataset.creamRadius=String(CREAM_RADIUS);canvas.dataset.ridgeCount='6';canvas.dataset.settledPoints=String(w.points.filter(p=>p.settled).length);canvas.dataset.fallingPoints=String(w.pending.length+w.drops.length);canvas.dataset.spilledPoints=String(w.spilledVolume.toFixed(5));canvas.dataset.firstLandingMs=String(w.firstLandingMs??'');canvas.dataset.generatedVolume=w.generatedVolume.toFixed(5);canvas.dataset.landedVolume=w.landedVolume.toFixed(5);canvas.dataset.motionState=w.moving?'moving':'still';
      renderer.render(scene,camera);
    };raf=requestAnimationFrame(frame);
    return()=>{cancelAnimationFrame(raf);observer.disconnect();scene.traverse(obj=>{obj.geometry?.dispose();if(obj.material&&!Array.isArray(obj.material))obj.material.dispose();});environment.dispose();renderer.dispose();world.current=null;};
  },[cfg.WORLD_WIDTH,cfg.WORLD_HEIGHT,cfg.CONE_TOP_Y]);
  useEffect(()=>{const hide=()=>{const w=world.current;if(document.hidden&&w?.holding){w.holding=false;w.pointerId=null;w.settling=SETTLE_MS;phaseRef.current='settling';setPhase('settling');}};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);},[]);
  useEffect(()=>()=>{audioRef.current?.close().catch(()=>{});},[]);
  const move=e=>{
    const w=world.current;if(!w||w.pointerId!==e.pointerId||!w.pointerLast)return;
    const dx=e.clientX-w.pointerLast.x,dy=e.clientY-w.pointerLast.y,scale=3/Math.max(1,canvasRef.current?.clientWidth||402);
    w.pointerLast={x:e.clientX,y:e.clientY};
    let x=w.target.x+(dx*.936+dy*.351)*scale,z=w.target.z+(-dx*.351+dy*.936)*scale;
    const reach=CONE_RADIUS*1.7,length=Math.hypot(x,z);if(length>reach){x*=reach/length;z*=reach/length;}w.target={x,z};
    const rect=e.currentTarget.getBoundingClientRect(),t=padTarget(rect.left+rect.width/2+e.clientX-w.pointerOrigin.x,rect.top+rect.height/2+e.clientY-w.pointerOrigin.y,rect);
    if(dotRef.current)dotRef.current.style.transform=`translate(${t.u*t.travel}px,${t.v*t.travel}px)`;
  };
  const begin=()=>{const w=world.current;if(!w||!activeRef.current||phaseRef.current!=='ready')return false;startPour(w,cfgRef.current);phaseRef.current='playing';setPhase('playing');setHint(false);sound('tap');return true;};
  const start=e=>{const w=world.current;if(!w||e.isPrimary===false||e.button>0||w.pointerId!==null)return;e.preventDefault();e.stopPropagation();if(!begin())return;w.pointerId=e.pointerId;w.pointerLast=w.pointerOrigin={x:e.clientX,y:e.clientY};try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}};
  const release=()=>{const w=world.current;if(!w?.holding)return;w.holding=false;w.pointerId=null;w.settling=SETTLE_MS;phaseRef.current='settling';setPhase('settling');if(dotRef.current)dotRef.current.style.transform='translate(0px,0px)';};
  const end=e=>{if(world.current?.pointerId!==e.pointerId)return;e.preventDefault();e.stopPropagation();release();try{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}catch{}};
  const keyDown=e=>{if(e.code==='Space'){e.preventDefault();if(!e.repeat)begin();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)){e.preventDefault();const w=world.current;if(!w)return;const r=padRef.current.getBoundingClientRect(),t=padTarget(r.left+r.width/2+(e.code==='ArrowLeft'?-50:e.code==='ArrowRight'?50:0),r.top+r.height/2+(e.code==='ArrowUp'?-50:e.code==='ArrowDown'?50:0),r);w.target={x:t.x,z:t.z};if(dotRef.current)dotRef.current.style.transform=`translate(${t.u*t.travel}px,${t.v*t.travel}px)`;}};
  const rating=height<2?1:height<5?2:height<9?3:height<14?4:5;
  const postPlay=()=>{if(!canSubmit||submitting)return;setSubmitting(true);tt.playableRecordingSubmission({complete(){setSubmitting(false);},fail(){setSubmitting(false);}});};
  return <main className="softserve-app" data-phase={phase}>
    <div className="serve-art"><canvas ref={canvasRef} className="softserve-canvas" aria-label="Three dimensional hollow waffle cone below a fixed soft serve dispenser"/></div>
    <div className="serve-flavors" aria-label="Flavor">{Object.keys(MATERIALS).map(name=><button key={name} aria-label={cfg[name.toUpperCase()]} title={cfg[name.toUpperCase()]} aria-pressed={flavor===name} className={flavor===name?'selected':''} onClick={()=>{setFlavor(name);sound('tap');}}><i style={{background:'#'+MATERIALS[name].toString(16)}}/></button>)}</div>
    <div className="serve-hud" aria-label="Height"><b>{height.toFixed(1)}</b><span>{cfg.HEIGHT_LABEL}</span></div>
    <div className="serve-controls">
      {hint&&<p className="serve-guide">{cfg.GAME_HINT}</p>}
      <div ref={padRef} className="swirl-pad" role="button" tabIndex={0} aria-label="Hold and move the cone to swirl. Release to finish." onPointerDown={start} onPointerMove={e=>{if(world.current?.holding)move(e);}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onKeyDown={keyDown} onKeyUp={e=>{if(e.code==='Space'){e.preventDefault();release();}}} onBlur={release}><span className="pad-orbit"/><i ref={dotRef} className="pad-dot"/></div>
    </div>
    {phase==='result'&&<div className="serve-result" role="status"><span>{cfg.RESULT_TITLE}</span><strong>{height.toFixed(1)}<small> {cfg.HEIGHT_LABEL}</small></strong><div className="serve-stars" aria-label={rating+' out of 5 stars'}>{'★'.repeat(rating)}<i>{'☆'.repeat(5-rating)}</i></div><p>{cfg.BEST_LABEL} <b>{best.toFixed(1)} {cfg.HEIGHT_LABEL}</b></p><div className="serve-actions"><button onClick={restart}>{cfg.PLAY_AGAIN}<span aria-hidden="true"> ↻</span></button>{canSubmit&&<button className="post-play" disabled={submitting} onClick={postPlay}>{cfg.POST_PLAY}</button>}</div></div>}
    {error&&<p className="serve-error">{error}</p>}
    <style>{`
    @font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Regular.woff2')}@font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Bold.woff2');font-weight:700}
    *{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{background:#fff9ed;color:#44574f;font-family:Poppins,system-ui,sans-serif}.softserve-app{--control-height:180px;position:relative;width:100%;height:100%;overflow:hidden;background:#fff9ed}.serve-art{position:absolute;inset:0 0 calc(var(--control-height) + 27px);overflow:hidden}.softserve-canvas{display:block;width:100%;height:100%}.serve-hud{position:absolute;right:23px;bottom:calc(var(--control-height) + 10px);display:flex;align-items:baseline;gap:5px;pointer-events:none}.serve-hud b{font-size:29px;line-height:1.2;letter-spacing:-.8px}.serve-hud span{font-size:23px;font-weight:700}.serve-controls{position:absolute;bottom:0;left:0;right:0;height:var(--control-height);background:#e9eedd;border-top:1px solid #dfe5d6;border-radius:29px 29px 0 0;display:grid;place-items:center}.swirl-pad{position:relative;width:180px;height:180px;border-radius:50%;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;outline:none;display:grid;place-items:center}.swirl-pad:focus-visible{outline:2px solid #5c7a6d;outline-offset:-5px}.softserve-app[data-phase=playing] .swirl-pad{cursor:grabbing}.pad-orbit{width:112px;height:112px;border:2px dotted #bccab7;border-radius:50%;pointer-events:none}.pad-dot{position:absolute;left:calc(50% - 7px);top:calc(50% - 7px);width:14px;height:14px;border:3px solid #9bad9c;border-radius:50%;background:#718f7b;box-shadow:0 0 0 4px #7e9b851b;pointer-events:none}.serve-guide{position:absolute;top:12px;left:12px;right:12px;text-align:center;margin:0;font-size:15px;font-weight:700;line-height:1.4;pointer-events:none;animation:batchBreathe 2.6s ease-in-out infinite}.softserve-app[data-phase=ready] .pad-orbit{animation:orbitBreathe 2.6s ease-in-out infinite}.serve-flavors{position:absolute;left:18px;top:43%;display:flex;flex-direction:column;gap:8px;z-index:2}.serve-flavors button{display:grid;place-items:center;width:36px;height:36px;border:1px solid transparent;border-radius:50%;background:#fffc;cursor:pointer}.serve-flavors button.selected{border-color:#93a38f;background:#fff}.serve-flavors i{width:21px;height:21px;border:1px solid #b7a88c;border-radius:50%;pointer-events:none}.serve-result{position:absolute;bottom:14px;left:17px;right:17px;border-radius:23px;background:#fffef5ed;border:1px solid #e6e0ce;padding:12px 16px 14px;text-align:center;display:flex;flex-direction:column;align-items:center;box-shadow:0 12px 35px #8d78581a}.serve-result>span{font-size:14px;font-weight:700;color:#7a8377}.serve-result strong{font-size:44px;line-height:1.2;font-weight:700;letter-spacing:-1.5px}.serve-result small{font-size:19px;letter-spacing:0}.serve-stars{font-size:27px;line-height:1.15;letter-spacing:1px;color:#cba64b}.serve-stars i{font-style:normal;color:#cfcfc2}.serve-result p{font-size:11px;line-height:1.5;margin:6px 0 10px}.serve-result p b{font-size:15px;margin-left:5px}.serve-actions{display:flex;gap:8px;width:100%}.serve-actions button{flex:1;min-height:44px;padding:0 12px;border:0;border-radius:13px;background:#45665b;box-shadow:0 3px 0 #314e43;color:#fff;font:700 14px Poppins,system-ui;cursor:pointer}.serve-actions button.post-play{background:#e3e8dd;box-shadow:0 3px 0 #c7cebf;color:#44574f}.serve-actions button:active{transform:translateY(2px);box-shadow:none}.serve-actions button:disabled{opacity:.6}.serve-error{position:absolute;left:24px;right:24px;top:38%;font-size:16px;text-align:center}.softserve-app[data-phase=result] .serve-art{bottom:215px}.softserve-app[data-phase=result] .serve-controls,.softserve-app[data-phase=result] .serve-hud,.softserve-app[data-phase=result] .serve-flavors{display:none}.softserve-app[data-phase=settling] .swirl-pad{opacity:0;pointer-events:none;transition:opacity .2s}.softserve-app[data-phase=settling] .serve-flavors{pointer-events:none}[data-feed-preview=true] .serve-art{top:108px;bottom:82px}[data-feed-preview=true] .serve-controls{display:contents}[data-feed-preview=true] .serve-guide{top:19%;left:20px;right:20px;font-size:20px;line-height:1.35;font-weight:700}[data-feed-preview=true] .serve-hud,[data-feed-preview=true] .serve-flavors,[data-feed-preview=true] .swirl-pad{display:none}@keyframes orbitBreathe{50%{opacity:.45;transform:scale(1.04)}}@media(max-height:540px){.softserve-app{--control-height:150px}.swirl-pad{width:150px;height:150px}.pad-orbit{width:96px;height:96px}.serve-guide{top:6px;font-size:13px}.serve-hud b{font-size:26px}.serve-hud span{font-size:20px}.serve-result{bottom:9px;padding:8px 12px 11px}.serve-result strong{font-size:38px}.softserve-app[data-phase=result] .serve-art{bottom:195px}}@media(prefers-reduced-motion:reduce){.serve-guide,.pad-orbit{animation:none!important}.swirl-pad{transition:none!important}}
    `}</style>
  </main>;
}
createRoot(document.getElementById('root')).render(<><App/><BatchPolish/></>);
