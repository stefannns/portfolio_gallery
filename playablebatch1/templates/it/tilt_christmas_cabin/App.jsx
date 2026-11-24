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
import * as THREE from 'three';
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

addStyle(`body{background:#26180f;color:#ffedce}.cabin{position:relative;width:100%;height:100%;touch-action:none;overflow:hidden;background:#24170e url('./assets/christmas-panorama.webp') center/cover}.cabin canvas{display:block;width:100%;height:100%}.cabin .guide{top:33%;font-size:18px;font-weight:500;color:#fff0d8;text-shadow:0 2px 8px #000,0 1px 3px #000;background:#2012083b;border-radius:30px;padding:9px 6px}.cabin .sensor{background:#302116ae;border-color:#f7d9a866;color:#f9e5c8;bottom:26px}.recenter{position:absolute;right:25px;top:27px;width:40px;height:40px;border:1px solid #eadac252;background:#2b21184d;border-radius:50%;color:#fff4dd;font-size:25px;display:grid;place-items:center}.load-error{position:absolute;top:46%;left:30px;right:30px;text-align:center;text-shadow:0 1px 4px #000;font-size:15px}.load-error:empty{display:none}`);
mountPlayableMarkup(root, `<div class="cabin"><div class="scene" style="width:100%;height:100%"></div><div class="guide">Gira il telefono per guardarti intorno</div><button class="recenter" aria-label="Centra la visuale">⌖</button><button class="sensor">Attiva movimento</button><div class="load-error" role="status"></div></div>`);
const container=root.querySelector('.scene'),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(87,1,.1,80),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));renderer.outputColorSpace=THREE.SRGBColorSpace;container.append(renderer.domElement);renderer.domElement.setAttribute('aria-label',"Vista a 360 gradi della baita di Natale");
const geometry=new THREE.SphereGeometry(30,64,40),material=new THREE.MeshBasicMaterial({side:THREE.BackSide,color:0xffffff}),sphere=new THREE.Mesh(geometry,material);scene.add(sphere);
const texture=new THREE.TextureLoader().load('./assets/christmas-panorama.webp',()=>{root.dataset.loaded='true';root.querySelector('.cabin').style.backgroundImage='none';},undefined,()=>root.querySelector('.load-error').textContent="Impossibile caricare la baita. Ricarica la pagina.");texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.wrapS=THREE.RepeatWrapping;material.map=texture;
let yaw=0,pitch=0,smoothYaw=0,smoothPitch=0,dragging=false,lastPointer=null,gyroPrevious=null,ambient=false;
const qCurrent=new THREE.Quaternion(),qPrevious=new THREE.Quaternion(),qInverse=new THREE.Quaternion(),qDelta=new THREE.Quaternion(),qScreen=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2),euler=new THREE.Euler();
function gyroLook(s){euler.set(s.pitch,s.yaw,-s.roll,'YXZ');qCurrent.setFromEuler(euler).multiply(qScreen);if(!gyroPrevious){qPrevious.copy(qCurrent);gyroPrevious=true;return;}qInverse.copy(qPrevious).invert();qDelta.copy(qCurrent).multiply(qInverse);euler.setFromQuaternion(qDelta,'YXZ');yaw-=euler.y;pitch=clamp(pitch+euler.x,-1.15,1.15);qPrevious.copy(qCurrent);hideGuide();}
const motion=sensorInput({gyro:true,onTilt:gyroLook});
function resize(){const r=container.getBoundingClientRect();renderer.setSize(r.width,r.height);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();}resize();listen(window,'resize',resize);
let crackleTime=0;
function fireAmbience(dt){if(!ambient||!audio||!hostActive)return;crackleTime-=dt;if(crackleTime<=0){crackleTime=.15+Math.random()*.55;const length=.015+Math.random()*.025,buffer=audio.createBuffer(1,Math.ceil(audio.sampleRate*length),audio.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.exp(-i/data.length*5);const n=audio.createBufferSource(),g=audio.createGain(),filter=audio.createBiquadFilter();n.buffer=buffer;filter.type='lowpass';filter.frequency.value=1000;g.gain.value=.025;n.connect(filter);filter.connect(g);g.connect(audio.destination);n.start();n.onended=()=>{n.disconnect();g.disconnect();filter.disconnect();};}}
listen(renderer.domElement,'pointerdown',e=>{unlockAudio();ambient=true;motion.start();dragging=true;lastPointer={x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId);});
listen(renderer.domElement,'pointermove',e=>{if(!dragging)return;yaw-=(e.clientX-lastPointer.x)*.006;pitch=clamp(pitch+(e.clientY-lastPointer.y)*.005,-1.15,1.15);lastPointer={x:e.clientX,y:e.clientY};hideGuide();});
for(const ev of ['pointerup','pointercancel','lostpointercapture'])listen(renderer.domElement,ev,()=>{dragging=false;lastPointer=null;});
listen(root.querySelector('.recenter'),'click',()=>{yaw=0;pitch=0;gyroPrevious=null;motion.recenter();});
listen(window,'keydown',e=>{if(e.key.startsWith('Arrow')){e.preventDefault();if(e.key==='ArrowLeft')yaw+=.14;if(e.key==='ArrowRight')yaw-=.14;if(e.key==='ArrowUp')pitch=clamp(pitch+.12,-1.15,1.15);if(e.key==='ArrowDown')pitch=clamp(pitch-.12,-1.15,1.15);hideGuide();}});
runLoop(dt=>{smoothYaw+=(yaw-smoothYaw)*(1-Math.exp(-15*dt));smoothPitch+=(pitch-smoothPitch)*(1-Math.exp(-15*dt));const a=smoothYaw+Math.PI/2;camera.lookAt(Math.sin(a)*Math.cos(smoothPitch)*10,Math.sin(smoothPitch)*10,-Math.cos(a)*Math.cos(smoothPitch)*10);renderer.render(scene,camera);fireAmbience(dt);root.dataset.view=String(Math.round(smoothYaw*100));});
listen(window,'pagehide',()=>{texture.dispose();geometry.dispose();material.dispose();renderer.dispose();});


configure(()=>{root.querySelector('.guide').textContent=String(setting('GUIDE',"Gira il telefono per guardarti intorno"));const path=String(setting('PANORAMA','./assets/christmas-panorama.webp'));if(path!=='./assets/christmas-panorama.webp'){new THREE.TextureLoader().load(path,next=>{next.colorSpace=THREE.SRGBColorSpace;next.minFilter=THREE.LinearFilter;material.map=next;material.needsUpdate=true;texture.dispose();});}});

})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.cabin .guide{font:600 18px/1.4 UIBody,system-ui,sans-serif;padding:10px 14px;background:#20120866}\n.cabin .sensor{bottom:50px;font:700 14px/1.3 UIBody,system-ui,sans-serif;min-height:44px}\n.recenter{right:30px;top:30px;width:44px;height:44px;min-height:44px}\n";
  document.head.append(uiStyle);
})();
