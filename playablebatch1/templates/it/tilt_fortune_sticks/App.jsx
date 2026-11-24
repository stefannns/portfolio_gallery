// Mount game-owned markup with DOM nodes. Native hosts do not all implement
// HTML-string setters; keep mounting synchronous for the gameplay code below.
function mountPlayableMarkup(target, markup) {
  if (!target) throw new Error('Game mount target is missing');
  const source = String(markup ?? '');
  const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1].toLowerCase() === 'x';
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
    }
    return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'})[entity.toLowerCase()] || match;
  });
  while (target.firstChild) target.removeChild(target.firstChild);
  const stack = [{element:target, tag:'', svg:target.namespaceURI === 'http://www.w3.org/2000/svg'}];
  const voidTags = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
  let position = 0;
  while (position < source.length) {
    if (source.startsWith('<!--', position)) {
      const end = source.indexOf('-->', position + 4);
      position = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source[position] !== '<') {
      const next = source.indexOf('<', position);
      const end = next < 0 ? source.length : next;
      stack[stack.length - 1].element.appendChild(document.createTextNode(decode(source.slice(position, end))));
      position = end;
      continue;
    }
    let end = position + 1, quote = '';
    for (; end < source.length; end++) {
      const c = source[end];
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (end >= source.length) throw new Error('Incomplete game markup');
    const token = source.slice(position + 1, end);
    position = end + 1;
    if (/^\s*!/.test(token)) continue;
    const close = /^\s*\/\s*([\w:-]+)/.exec(token);
    if (close) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag.toLowerCase() === close[1].toLowerCase()) { stack.length = i; break; }
      }
      continue;
    }
    const opening = /^\s*([\w:-]+)/.exec(token);
    if (!opening) throw new Error('Invalid game markup');
    const tag = opening[1], parent = stack[stack.length - 1];
    const svg = tag.toLowerCase() === 'svg' || (parent.svg && parent.tag.toLowerCase() !== 'foreignobject');
    const element = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    const attributes = token.slice(opening[0].length).replace(/\/\s*$/, '');
    const attribute = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let match;
    while ((match = attribute.exec(attributes))) {
      const name = match[1], value = decode(match[2] ?? match[3] ?? match[4] ?? '');
      element.setAttribute(name, value);
    }
    parent.element.appendChild(element);
    if (!voidTags.test(tag) && !/\/\s*$/.test(token)) stack.push({element, tag, svg});
  }
  return source;
}

// Edizione italiana separata: logica, tempistiche e risorse del gioco originali.
document.documentElement.lang="it";
// Readable pre-compilation source. Game styles, markup and helpers are contained in this file.
(() => {
"use strict";
// Shared authoring helpers are inlined into each editable App.jsx at build time.
const root = document.getElementById('root');
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
let hostActive = true, disposed = false;
const listeners=[];
function listen(target,type,callback,options){target.addEventListener(type,callback,options);listeners.push(()=>target.removeEventListener(type,callback,options));}
function addStyle(css){const style=document.createElement('style');style.textContent=`*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;-webkit-tap-highlight-color:transparent}body{font-family:Arial,sans-serif}button{font:inherit;cursor:pointer;touch-action:manipulation}button:focus-visible{outline:3px solid #8ec5ff;outline-offset:4px}.guide{position:absolute;z-index:8;left:25px;right:25px;top:33%;text-align:center;font-size:18px;font-weight:700;line-height:1.35;pointer-events:none;animation:guide-breathe 2s ease-in-out infinite;transition:opacity .25s}.guide.gone{opacity:0;visibility:hidden}@keyframes guide-breathe{50%{opacity:.65;transform:scale(.975)}}.sensor{position:absolute;z-index:10;bottom:25px;left:50%;transform:translateX(-50%);border:1px solid currentColor;border-radius:24px;background:#ffffff10;color:inherit;padding:10px 19px;font-size:13px;white-space:nowrap;min-height:40px}.sensor[hidden]{display:none}@media(prefers-reduced-motion:reduce){.guide{animation:none!important}}`+css;document.head.append(style);}
function hideGuide(){root.querySelector('.guide')?.classList.add('gone');}
let audio;
function unlockAudio(){try{audio ||= new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume().catch(()=>{});}catch(_){}}
function tone(freq=400,seconds=.1,volume=.15,type='sine',end=0){if(!audio||!hostActive)return;try{const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);if(end)o.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+seconds);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(volume,t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+seconds);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+seconds+.02);o.onended=()=>{o.disconnect();g.disconnect();};}catch(_){}}
// Sensor APIs follow the supplied TikTok SDK. Browser emulation belongs to the
// review host, never to the exported game. No raw Web Sensor APIs in this pack.
function sensorInput({gyro=false,shake=false,onTilt=()=>{},onShake=()=>{}}={}){
 const tt=window.tt;let running=false,gyroOn=false,accelOn=false,baseline=null,gravity=null,samples=0,peaks=0,lastPeak=-2000,lastShake=-2000;
 const state={x:0,y:0,yaw:0,pitch:0,roll:0,received:false};
 const delta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
 function orientation(p){if(!hostActive||!p||p.result===-1)return;const pitch=Number(p.pitch??p.x)||0,yaw=Number(p.yaw??p.y)||0,roll=Number(p.roll??p.z)||0;if(!baseline)baseline={pitch,yaw,roll};state.pitch=pitch;state.yaw=yaw;state.roll=roll;state.x=clamp(delta(roll,baseline.roll)/.42,-1,1);state.y=clamp(delta(pitch,baseline.pitch)/.42,-1,1);if(Math.abs(state.x)<.025)state.x=0;if(Math.abs(state.y)<.025)state.y=0;state.received=true;onTilt(state);}
 function acceleration(p){if(!hostActive||!p)return;const q={x:Number(p.x)||0,y:Number(p.y)||0,z:Number(p.z)||0};if(!gravity)gravity={...q};const rest=Math.max(.1,Math.hypot(gravity.x,gravity.y,gravity.z));const motion=Math.hypot(q.x-gravity.x,q.y-gravity.y,q.z-gravity.z)/rest;for(const k of ['x','y','z'])gravity[k]=gravity[k]*.82+q[k]*.18;if(samples++<5)return;const now=performance.now();if(now-lastShake<1300)return;if(now-lastPeak>1400)peaks=0;if(motion>.55&&now-lastPeak>200){lastPeak=now;peaks++;if(peaks>=2){peaks=0;lastShake=now;onShake();}}}
 function setButton(text,hidden=false){const b=root.querySelector('.sensor');if(b){b.textContent=text;b.hidden=hidden;}}
 function start(){if(running||!hostActive)return;running=true;baseline=null;gravity=null;samples=0;
  if(gyro&&tt?.startGyroscope&&tt?.onGyroscopeChange){gyroOn=true;tt.onGyroscopeChange(orientation);tt.startGyroscope({interval:50,fail:()=>{gyroOn=false;running=false;setButton("Attiva inclinazione");}});}
  if(shake&&tt?.startAccelerometer&&tt?.onAccelerometerChange){tt.startAccelerometer({success:()=>{accelOn=true;tt.onAccelerometerChange(acceleration);},fail:()=>{running=false;setButton("Attiva movimento");}});}
  if((gyro&&!gyroOn)||(!gyro&&shake&&!tt?.startAccelerometer)){running=false;setButton("Movimento non disponibile");return;}
  setButton("Movimento attivo",true);
 }
 function stop(){running=false;if(gyroOn){tt?.offGyroscopeChange?.(orientation);tt?.stopGyroscope?.({});gyroOn=false;}if(accelOn){tt?.offAccelerometerChange?.(acceleration);tt?.stopAccelerometer?.();accelOn=false;}state.x=0;state.y=0;baseline=null;gravity=null;}
 const b=root.querySelector('.sensor');if(b)listen(b,'click',e=>{e.stopPropagation();unlockAudio();start();});
 listen(window,'pagehide',stop);listen(document,'visibilitychange',()=>{if(document.hidden)stop();});
 listen(window,'message',e=>{if(e.source!==parent||e.data?.type!=='playable-active')return;hostActive=e.data.active===true;if(!hostActive){stop();audio?.suspend().catch(()=>{});}});
 return{state,start,stop,recenter(){baseline=null;}};
}
function canvasSize(canvas){let W=390,H=598;const ctx=canvas.getContext('2d');function resize(){const rect=canvas.getBoundingClientRect();W=Math.max(1,rect.width);H=Math.max(1,rect.height);const d=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(W*d);canvas.height=Math.round(H*d);ctx.setTransform(d,0,0,d,0,0);}resize();listen(window,'resize',resize);return{ctx,get W(){return W;},get H(){return H;}};}
function runLoop(step){let previous=0;function frame(t){if(disposed)return;const dt=Math.min(.034,(t-(previous||t))/1000);previous=t;if(!document.hidden)step(hostActive?dt:0,t/1000);requestAnimationFrame(frame);}requestAnimationFrame(frame);}
listen(window,'pagehide',()=>{disposed=true;listeners.splice(0).forEach(off=>off());audio?.close().catch(()=>{});});
// Mount from packaged defaults immediately; editor configuration is optional
// at startup and is bounded so failed I/O cannot leave an empty scene.
const settings={};
function setting(id,fallback){return settings[id]??fallback;}
async function configure(onChange=()=>{}){
 let timeout;const controller=new AbortController();
 try{timeout=setTimeout(()=>controller.abort(),1800);const response=await fetch('./game.config.json',{signal:controller.signal});if(!response.ok)throw new Error("Configurazione non disponibile");const config=await response.json();for(const group of ['texts','tweaks','images']){for(const value of Array.isArray(config[group])?config[group]:[]){if(value&&typeof value.id==='string')settings[value.id]=group==='images'?value.path:value.value;}}onChange();root.dataset.config='loaded';}
 catch(_){root.dataset.config='defaults';}finally{clearTimeout(timeout);}
}

addStyle(`
body{background:#170b08;color:#efddac;font-family:Georgia,serif}
.fortune{height:100%;width:100%;position:relative;overflow:hidden;touch-action:none;background:linear-gradient(#16070520,#13060245),url('./assets/shrine.webp') center/cover}
.object{position:absolute;left:50%;top:49%;height:47.6%;width:15.967vh;max-width:35.7%;transform:translate(-50%,-50%);transform-origin:50% 95%;filter:drop-shadow(6px 11px 9px #0009);touch-action:none}
.tube{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;z-index:1;pointer-events:none;user-select:none;-webkit-user-drag:none}
.tube-front{z-index:4;clip-path:polygon(0 4.8%,7% 4.8%,15% 7%,30% 9%,50% 9.6%,70% 9%,85% 7%,94% 4.8%,100% 4.8%,100% 100%,0 100%)}
.sticks{position:absolute;inset:0;z-index:2;pointer-events:none}
.stick{position:absolute;display:block;max-width:none;transform-origin:50% 100%;pointer-events:none;user-select:none;-webkit-user-drag:none;will-change:transform}
.stick.chosen{z-index:6;transform-origin:50% 50%}
.fortune .guide{top:78%;color:#eed9ac;text-shadow:0 2px 4px #000;font-weight:400;font-family:Georgia,serif;font-size:18px}
.fortune .sensor{bottom:50px;background:#2e140ebb;border-color:#947345;color:#ebd9b0}
.result{position:absolute;inset:0;z-index:20;display:grid;place-items:center;background:#0c06045e}.result[hidden]{display:none}
.paper{position:relative;width:calc(100% - 60px);max-width:330px;min-height:280px;border:2px solid #d5b76d;outline:1px solid #594620;outline-offset:-10px;padding:38px 25px 28px;text-align:center;color:#553917;background:radial-gradient(ellipse at 50% 25%,#faedbd,#d5b66e);box-shadow:0 15px 40px #0008}
.seal{position:absolute;top:-18px;left:calc(50% - 17px);width:34px;height:34px;border-radius:50%;background:#791b24;border:2px solid #b99a5e;color:#f1d291;display:grid;place-items:center;font-size:18px}
.eyebrow{font:12px UIBody,Arial,sans-serif;letter-spacing:2px}.paper h1{font:24px Georgia,serif;margin:25px 0 12px}.paper p{font:16px/1.6 Georgia,serif;margin:0 0 24px}
.paper button{background:#7a1822;color:#f1deb2;border:1px solid #b58b52;padding:11px 22px;box-shadow:0 3px 6px #523a2140;font:16px Georgia,serif;min-height:44px}
.meter{position:absolute;left:calc(50% - 42px);bottom:100px;width:84px;height:2px;background:#dfbd6333;overflow:hidden}.meter i{display:block;height:100%;width:0;background:#d8b66f}
`);

mountPlayableMarkup(root, `<div class="fortune">
 <div class="object" role="img" aria-label="Scuoti il cilindro con i bastoncini della fortuna">
  <img class="tube" src="./assets/physical-v2/cylinder.webp" alt="">
  <div class="sticks"></div>
  <img class="tube tube-front" src="./assets/physical-v2/cylinder.webp" alt="" aria-hidden="true">
 </div>
 <div class="guide">Scuoti e scopri il tuo destino</div><div class="meter"><i></i></div><button class="sensor">Attiva movimento</button>
 <div class="result" hidden><div class="paper"><span class="seal">✦</span><div class="eyebrow">IL TUO RESPONSO</div><h1></h1><p></p><button>Estrai ancora</button></div></div>
</div>`);

const fortunes=[["Fortuna duratura","Prosegui con calma. Ciò che costruisci ora durerà."],["Un nuovo inizio","Un piccolo passo oggi aprirà una porta domani."],["Buona compagnia","Una persona affine è più vicina di quanto pensi."],["Fortuna discreta","La risposta arriva quando le lasci spazio."],["Un futuro luminoso","La tua pazienza sta per dare i suoi frutti."],["Una bella sorpresa","Lascia un po’ di spazio agli imprevisti."],["Fidati del tuo cammino","Hai più coraggio di quanto immagini."],["Il momento giusto","Quando arriva l’occasione, fai il primo passo."]];
const object=root.querySelector('.object'),stickTray=root.querySelector('.sticks'),result=root.querySelector('.result'),meter=root.querySelector('.meter i');
const stickPaths=[1,2,3].map(i=>'./assets/physical-v2/stick'+i+'.webp');
const ratios=[32/850,35/850,42/850],sticks=[];
const jar={angle:0,av:0,x:0,vx:0,targetX:0,frameX:0,frameY:0,thrustY:0,zoom:1};
let energy=0,phase='ready',elapsed=0,down=false,pointerId=null,lastX=0,startX=0,lastRattle=0,drawIndex=-1,shakeDirection=1,selected=null;
let shakeTime=0,lastShakeTime=-Infinity,progress=0,liftStart=0,pickStartAngle=0,pickLastAngle=0,pickStartY=0;
const ACTIVE_SHAKE_SECONDS=2.8,EXIT_ANGLE=-.28;
const pickEase=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};

// Three rows have stable depth ordering, varied lengths and individual inertia.
for(let row=0;row<3;row++)for(let col=0;col<7;col++){
 const index=row*7+col,variant=(col+row)%3,el=document.createElement('img');
 el.className='stick';el.src=stickPaths[variant];el.alt='';el.setAttribute('aria-hidden','true');el.draggable=false;
 el.style.zIndex=String(row+1);el.style.filter='brightness('+(0.87+row*.065)+')';
 const rootX=.30+col*.066+(Math.random()-.5)*.012,rootY=.74+row*.018;
 const mouthX=.21+col*.095+(Math.random()-.5)*.012;
 const rest=Math.atan((mouthX-rootX)*(369/1100)/(rootY-.065));
 const s={el,variant,row,col,rootX,rootY,length:.95+Math.random()*.11,rest,angle:rest,av:0,bob:0,bv:0,lift:0};
 sticks.push(s);stickTray.append(el);
 el.onload=()=>{if(el.naturalHeight)ratios[variant]=el.naturalWidth/el.naturalHeight;};
}
root.dataset.stickCount=String(sticks.length);

const motion=sensorInput({shake:true,onShake:()=>{shakeDirection*=-1;shake(.48,shakeDirection);}});
function shake(amount,direction=1){
 if(!hostActive||phase!=='ready')return;
 // Choose one real stick early, so the player sees it work loose over time.
 if(!selected){
  const candidates=sticks.filter(s=>s.col===6);
  selected=candidates[Math.floor(Math.random()*candidates.length)];
  selected.el.dataset.emerging='true';
 }
 const effort=clamp(Number(setting('SHAKE_EFFORT',2.45)),1,6);
 unlockAudio();hideGuide();energy=clamp(energy+amount/effort,0,1);
 const force=Math.min(1,amount*5);
 jar.av=clamp(jar.av+direction*(20+force*80),-180,180);
 for(const s of sticks){s.av-=direction*force*(.9+Math.random()*1.2);s.bv-=force*(.06+Math.random()*.12);}
 const now=performance.now();lastShakeTime=now;
 if(now-lastRattle>140){tone(460+Math.random()*250,.05,.08,'triangle',210);lastRattle=now;}
}

listen(object,'pointerdown',e=>{
 if(!hostActive||phase!=='ready'||pointerId!==null||e.isPrimary===false)return;
 unlockAudio();motion.start();object.setPointerCapture(e.pointerId);pointerId=e.pointerId;down=true;startX=lastX=e.clientX;
});
listen(object,'pointermove',e=>{
 if(!down||e.pointerId!==pointerId||phase!=='ready')return;
 const delta=e.clientX-lastX;lastX=e.clientX;jar.targetX=clamp((e.clientX-startX)*.3,-22,22);
 if(Math.abs(delta)>1)shake(Math.abs(delta)/180,Math.sign(delta));
});
function release(){
 const pointer=pointerId;down=false;pointerId=null;jar.targetX=0;
 if(pointer!==null&&object.hasPointerCapture(pointer))object.releasePointerCapture(pointer);
}
for(const event of ['pointerup','pointercancel','lostpointercapture'])listen(object,event,release);
listen(window,'keydown',e=>{if(e.code==='Space'&&!e.repeat){e.preventDefault();motion.start();shakeDirection*=-1;shake(.37,shakeDirection);}});
listen(document,'visibilitychange',()=>{if(document.hidden)release();});
listen(window,'message',e=>{if(e.source===parent&&e.data?.type==='playable-active'&&!e.data.active)release();});

function reset(){
 release();
 if(selected?.outside)stickTray.append(selected.el);
 phase='ready';energy=0;elapsed=0;selected=null;shakeTime=0;lastShakeTime=-Infinity;progress=0;liftStart=0;pickStartAngle=0;pickLastAngle=0;pickStartY=0;result.hidden=true;meter.style.width='0%';
 Object.assign(jar,{angle:0,av:0,x:0,vx:0,targetX:0,frameX:0,frameY:0,thrustY:0,zoom:1});
 for(const s of sticks){s.angle=s.rest;s.av=0;s.bob=0;s.bv=0;s.lift=0;s.outside=false;s.freePose=null;s.outsideStart=null;s.outsideProgress=0;s.el.style.visibility='visible';s.el.style.zIndex=String(s.row+1);delete s.el.dataset.emerging;}
 updateSticks(0,object.clientWidth,object.clientHeight);frameObject(object.clientWidth,object.clientHeight);
 root.dataset.phase=phase;
}
listen(root.querySelector('.paper button'),'click',reset);
function reveal(){
 let index=Math.floor(Math.random()*fortunes.length);if(index===drawIndex)index=(index+1)%fortunes.length;drawIndex=index;
 root.querySelector('.paper h1').textContent=fortunes[index][0];root.querySelector('.paper p').textContent=fortunes[index][1];
 result.hidden=false;phase='revealed';root.dataset.phase=phase;tone(660,.5,.07,'sine',880);
}

function renderStick(s,pose){
 s.pose=pose;
 s.el.style.left=(pose.x-pose.width/2)+'px';s.el.style.top=(pose.y-pose.length)+'px';s.el.style.width=pose.width+'px';s.el.style.height=pose.length+'px';s.el.style.transform='rotate('+(pose.angle*180/Math.PI)+'deg)';
}
function updateSticks(dt,W,H){
 for(const s of sticks){
  if(s===selected&&s.freePose){
   const length=s.length*H,width=clamp(length*ratios[s.variant],7,16);
   s.angle=s.freePose.angle;
   renderStick(s,{x:s.freePose.x*W,y:s.freePose.y*H,length,width,angle:s.angle});
   continue;
  }
  const emerging=s===selected,clearLift=Math.max(.01,s.rootY-.03);
  const tilt=emerging?clamp(s.lift/clearLift,0,1):0;
  const rest=emerging?s.rest*(1-tilt)+EXIT_ANGLE*tilt:s.rest;
  const stiffness=emerging?58:38+s.row*5+s.col%3*3;
  s.av+=(-(s.angle-rest)*stiffness-s.av*(emerging?10:6.5)-jar.av*Math.PI/180*.11)*dt;s.angle+=s.av*dt;
  s.bv+=(-s.bob*86-s.bv*8)*dt;s.bob=clamp(s.bob+s.bv*dt,-.065,.012);
  const baseY=(s.rootY+s.bob-s.lift)*H,rootX=s.rootX*W;
  // Constrain every shaft where it crosses the mouth. The front lip hides
  // the lower shaft, so no sprite can escape through the cylinder's sides.
  if(baseY>H*.065){
   const depth=Math.max(2,baseY-H*.065),halfWidth=clamp(s.length*H*ratios[s.variant],7,16)/2;
   const lo=Math.atan((W*.13+halfWidth-rootX)/depth),hi=Math.atan((W*.87-halfWidth-rootX)/depth);
   if(s.angle<lo){s.angle=lo;s.av=emerging?Math.max(0,s.av):Math.abs(s.av)*.3;if(!emerging)s.bv-=.01;}
   if(s.angle>hi){s.angle=hi;s.av=emerging?Math.min(0,s.av):-Math.abs(s.av)*.3;if(!emerging)s.bv-=.01;}
  }
  const length=s.length*H,width=clamp(length*ratios[s.variant],7,16);
  renderStick(s,{x:rootX,y:baseY,length,width,angle:s.angle});
 }
}

// Gently frame the leaning stick and jar together. This keeps a real full-length
// stick visible rather than lifting it through the top edge of the portrait view.
function frameObject(W,H,dt=0){
 {
  jar.frameX=0;jar.frameY=0;jar.zoom=1;
  if(selected){
   const angle=jar.angle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
   const originX=W*.5,originY=H*.95,left=root.clientWidth*.5-W*.5+jar.x,top=root.clientHeight*.49-H*.5+jar.thrustY;
   // Project exactly the same rotate/scale around the CSS transform origin.
   const project=(x,y,zoom=jar.zoom)=>({x:left+originX+zoom*((x-originX)*c-(y-originY)*s),y:top+originY+zoom*((x-originX)*s+(y-originY)*c)});
   const points=[{x:0,y:0},{x:W,y:0},{x:W,y:H},{x:0,y:H}];
   for(const stick of sticks){
    const p=stick.pose;if(!p)continue;
    const ca=Math.cos(p.angle),sa=Math.sin(p.angle),half=p.width/2;
    for(const end of [0,p.length])for(const side of [-1,1])points.push({x:p.x+sa*end+side*ca*half,y:p.y-ca*end+side*sa*half});
   }
   const unscaled=points.map(p=>project(p.x,p.y,1));
   const spanX=Math.max(...unscaled.map(p=>p.x))-Math.min(...unscaled.map(p=>p.x));
   const spanY=Math.max(...unscaled.map(p=>p.y))-Math.min(...unscaled.map(p=>p.y));
   const pickAmount=selected.outside?1-selected.outsideProgress:clamp((selected.lift-.10)/(selected.rootY+.045-.10),0,1);
   const gentleZoom=1-.18*pickEase(pickAmount);
   // Keep30px edges and leave the bottom120px for the unchanged controls.
   jar.zoom=Math.min(gentleZoom,Math.max(1,root.clientWidth-60)/Math.max(1,spanX),Math.max(1,root.clientHeight-150)/Math.max(1,spanY));
   const bounds=points.map(p=>project(p.x,p.y));
   const minX=Math.min(...bounds.map(p=>p.x)),maxX=Math.max(...bounds.map(p=>p.x));
   const minY=Math.min(...bounds.map(p=>p.y)),maxY=Math.max(...bounds.map(p=>p.y));
   const offset=(min,max,size,startPadding=30,endPadding=30)=>{
    const low=startPadding-min,high=size-endPadding-max;
    if(low<=high+.01)return clamp(0,low,Math.max(low,high));
    const fallbackLow=8-min,fallbackHigh=size-8-max;
    return fallbackLow<=fallbackHigh?clamp(0,fallbackLow,fallbackHigh):(fallbackLow+fallbackHigh)/2;
   };
   jar.frameX=offset(minX,maxX,root.clientWidth);jar.frameY=offset(minY,maxY,root.clientHeight,30,120);
   const p=selected.pose,center=project(p.x+Math.sin(p.angle)*p.length/2,p.y-Math.cos(p.angle)*p.length/2);
   center.x+=jar.frameX;center.y+=jar.frameY;
   if(selected.worldCenter&&dt>0)selected.velocity={x:(center.x-selected.worldCenter.x)/dt,y:(center.y-selected.worldCenter.y)/dt};
   selected.worldCenter=center;
  }
 }
 object.style.transform=`translate(-50%,-50%) translate(${jar.x+jar.frameX}px,${jar.frameY+jar.thrustY}px) rotate(${jar.angle}deg) scale(${jar.zoom})`;
}

// Float the real stick clear of the rim, then aside and gently down outside.
// There is no ballistic fall and it never returns into the cylinder.
runLoop(dt=>{
 const H=object.clientHeight,W=object.clientWidth;
 jar.av+=(-jar.angle*70-jar.av*10)*dt;jar.angle=clamp(jar.angle+jar.av*dt,-11,11);
 jar.vx+=((jar.targetX-jar.x)*80-jar.vx*10)*dt;jar.x+=jar.vx*dt;
 if(phase==='ready'){
  energy=Math.max(0,energy-dt*.025);
  if(selected){
   if(performance.now()-lastShakeTime<650)shakeTime+=dt;
   progress=Math.min(energy,clamp(shakeTime/ACTIVE_SHAKE_SECONDS,0,1));
   const target=(selected.rootY-.03)*.18*progress;
   selected.lift+=(target-selected.lift)*Math.min(1,dt*3.5);
   if(progress>=.999){phase='picking';elapsed=0;liftStart=selected.lift;pickStartAngle=jar.angle;pickLastAngle=jar.angle;pickStartY=jar.thrustY;release();root.dataset.phase=phase;}
  }
 }
 if(phase==='picking'){
  elapsed+=dt;
  // A short, damped final shake precedes the deliberate floating pick.
  const shakeT=clamp(elapsed/.4,0,1);
  const settle=1-pickEase(shakeT),wave=Math.sin(shakeT*Math.PI*4)*Math.sin(shakeT*Math.PI)*(1-.3*shakeT);
  jar.angle=pickStartAngle*settle+6*wave;
  jar.thrustY=pickStartY*settle+3*wave;
  if(dt>0)jar.av=(jar.angle-pickLastAngle)/dt;
  pickLastAngle=jar.angle;
  const clearLift=selected.rootY+.045;
  if(elapsed<1.35){
   selected.lift=liftStart+(clearLift-liftStart)*pickEase((elapsed-.25)/1.10);
  }else if(elapsed<1.85){
   selected.lift=clearLift+.008*Math.sin((elapsed-1.35)/.5*Math.PI);
  }else if(!selected.outsideStart){
   selected.lift=clearLift;
  }else if(elapsed<2.45){
   const t=pickEase((elapsed-1.85)/.60),from=selected.outsideStart;
   selected.freePose={x:from.x+(-.80-from.x)*t,y:from.y+(-.055-from.y)*t,angle:from.angle+(.08-from.angle)*t};
  }else{
   const t=pickEase((elapsed-2.45)/1.0);
   selected.freePose={x:-.80,y:-.055+.995*t,angle:.08};
   selected.outsideProgress=t;
  }
 }
 updateSticks(dt,W,H);frameObject(W,H,dt);meter.style.width=(progress*100)+'%';root.dataset.shakeProgress=progress.toFixed(3);
 if(phase==='picking'&&elapsed>=1.35&&!selected.outside){
  const p=selected.pose,tailBottom=p.y+Math.abs(Math.sin(p.angle))*p.width/2;
  if(tailBottom<=H*.035){
   // Both containers share identical local coordinates. Moving this same DOM
   // sprite to the foreground changes depth only; its full pose stays exact.
   object.append(selected.el);selected.el.style.zIndex='6';selected.outside=true;selected.outsideProgress=0;
  }
 }
 if(phase==='picking'&&elapsed>=1.85&&selected.outside&&!selected.outsideStart){
  const p=selected.pose;selected.outsideStart={x:p.x/W,y:p.y/H,angle:p.angle};
 }
 if(phase==='picking'&&elapsed>=3.55){jar.thrustY=0;jar.angle=0;reveal();}

});

reset();
configure(()=>{
 root.querySelector('.guide').textContent=String(setting('GUIDE',"Scuoti e scopri il tuo destino"));
 root.querySelector('.fortune').style.backgroundImage='linear-gradient(#16070520,#13060245),url('+JSON.stringify(String(setting('BACKGROUND','./assets/shrine.webp')))+')';
 root.querySelectorAll('.tube').forEach(el=>{el.src=String(setting('TUBE','./assets/physical-v2/cylinder.webp'));});
 for(const s of sticks)s.el.src=String(setting('STICK_'+(s.variant+1),stickPaths[s.variant]));
});

})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fortune .guide{font:400 18px/1.4 Georgia,serif;top:78%;left:30px;right:30px}\n.fortune .sensor{bottom:50px;min-height:44px;font:700 14px/1.3 UIBody,system-ui,sans-serif}\n.fortune .result{padding:30px 30px 50px;overflow:auto;display:grid}\n.paper{width:100%;max-width:330px;padding:36px 25px 28px}\n.paper h1{font-size:24px;line-height:1.3}.paper p{font-size:16px;line-height:1.6}\n.paper button{font-size:16px;min-height:44px}.eyebrow{font:400 12px/1.4 UIBody,system-ui,sans-serif;letter-spacing:2px}\n.fortune .meter{bottom:100px}\n";
  document.head.append(uiStyle);
})();
