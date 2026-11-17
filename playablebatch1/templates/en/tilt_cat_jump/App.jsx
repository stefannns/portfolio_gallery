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
  if(gyro&&tt?.startGyroscope&&tt?.onGyroscopeChange){gyroOn=true;tt.onGyroscopeChange(orientation);tt.startGyroscope({interval:50,fail:()=>{gyroOn=false;running=false;setButton('Enable tilt');}});}
  if(shake&&tt?.startAccelerometer&&tt?.onAccelerometerChange){tt.startAccelerometer({success:()=>{accelOn=true;tt.onAccelerometerChange(acceleration);},fail:()=>{running=false;setButton('Enable motion');}});}
  if((gyro&&!gyroOn)||(!gyro&&shake&&!tt?.startAccelerometer)){running=false;setButton('Motion unavailable');return;}
  setButton('Motion on',true);
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
 try{timeout=setTimeout(()=>controller.abort(),1800);const response=await fetch('./game.config.json',{signal:controller.signal});if(!response.ok)throw new Error('Configuration unavailable');const config=await response.json();for(const group of ['texts','tweaks','images']){for(const value of Array.isArray(config[group])?config[group]:[]){if(value&&typeof value.id==='string')settings[value.id]=group==='images'?value.path:value.value;}}onChange();root.dataset.config='loaded';}
 catch(_){root.dataset.config='defaults';}finally{clearTimeout(timeout);}
}

addStyle(`@font-face{font-family:Bangers;src:url('./assets/Bangers-Regular.woff2')}body{background:#fbf0ce;color:#56341d}.cat-game{position:relative;width:100%;height:100%;overflow:hidden;touch-action:none}canvas{width:100%;height:100%;display:block}.cat-game .guide{color:#69422b;text-shadow:0 1px #fff;font-family:Bangers,Arial,sans-serif;font-size:23px;top:33%}.hud{position:absolute;top:27px;left:30px;right:30px;display:flex;justify-content:space-between;font:28px Bangers,Arial,sans-serif;pointer-events:none}.cat-game .sensor{background:#fff5dfcf;border-color:#c89a6d;color:#69422b;bottom:24px}.result{position:absolute;inset:0;z-index:15;display:grid;place-items:center;background:#57341e36;backdrop-filter:blur(3px)}.result[hidden]{display:none}.card{width:calc(100% - 60px);max-width:330px;text-align:center;background:#fff4d9;border:2px solid #a16a43;border-radius:18px;padding:28px 22px;box-shadow:0 6px 0 #d8b887,0 18px 45px #44281140}.card h1{font:32px Bangers;margin:0 0 12px}.height{font:58px Bangers;color:#b96932}.card p{font-size:14px}.card button{border:2px solid #8d4d29;border-radius:12px;background:#c78b58;color:#fff5de;font:22px Bangers;padding:10px 25px;box-shadow:0 3px 0 #8b4e2c}`);
root.innerHTML=`<div class="cat-game"><canvas aria-label="Cat jumping between wooden shelves"></canvas><div class="hud"><span class="score">0m</span><span class="time">60s</span></div><div class="guide">Tilt to guide the laser</div><button class="sensor">Enable tilt</button><div class="result" hidden><div class="card"><h1>A pawsome climb!</h1><div class="height">0m</div><p>Chase a little higher?</p><button>Try again</button></div></div></div>`;
const canvas=root.querySelector('canvas'),view=canvasSize(canvas),{ctx}=view,cat=new Image(),idleCat=new Image();cat.src='./assets/leaping-tabby.webp';idleCat.src='./assets/idle-tabby-v1.webp';
const backdrop=new Image(),platformArt=new Image(),shelfCache=new Map();
backdrop.src='./assets/storybook-v2/cozy-wall.webp';platformArt.src='./assets/storybook-v3/honey-shelf-front.webp';
platformArt.onload=()=>shelfCache.clear();
const scoreEl=root.querySelector('.score'),timeEl=root.querySelector('.time'),result=root.querySelector('.result');
let roundSeconds=60,phase='ready',remaining=60,camera=0,bestHeight=0,platforms=[],catX=195,catY=400,vy=0,vx=0,laserX=195,laserY=260,initialY=400,squash=0,targetX=195,standingOn=null,catFacing=-1,keys=new Set();
function H(){return view.H*390/view.W;}
function nextShelf(previous){
 const step=(previous.step||0)+1,wide=step%3===0,center=previous.x+previous.w/2;
 // Longer sideways crossings use a smaller rise so they remain reachable.
 const direction=wide?(center>=195?-1:1):center>245?-1:center<145?1:Math.random()<.5?-1:1;
 const distance=wide?165+Math.random()*60:45+Math.random()*75;
 const nextCenter=clamp(center+direction*distance,65,325);
 return {x:nextCenter-46,y:previous.y-(wide?48+Math.random()*14:69+Math.random()*12),w:92,step};
}
function reset(){phase='ready';catFacing=-1;remaining=roundSeconds;camera=0;bestHeight=0;catX=195;laserX=195;initialY=H()-163;catY=initialY;vy=0;vx=0;squash=0;targetX=195;platforms=[{x:148,y:initialY+35,w:94,step:0}];standingOn=platforms[0];root.dataset.grounded='true';for(let i=1;i<60;i++)platforms.push(nextShelf(platforms[platforms.length-1]));laserY=H()*.45;result.hidden=true;scoreEl.textContent='0m';timeEl.textContent=roundSeconds+'s';root.dataset.phase=phase;root.querySelector('.guide').classList.remove('gone');}
const motion=sensorInput({gyro:true,onTilt:s=>{targetX=clamp(195+s.x*175,30,360);laserY=clamp(H()*.35+s.y*H()*.2,95,H()*.65);if(phase==='ready'&&(Math.abs(s.x)>.08||Math.abs(s.y)>.08))start();}});
function laserIsAbove(){return laserY<catY-camera-6;}
function jumpFromShelf(){
 if(!standingOn||!laserIsAbove())return;
 standingOn=null;vy=-540;vx=clamp((targetX-catX)*2.7,-440,440);squash=.18;
 tone(480+Math.random()*70,.065,.07,'sine',620);
}
function start(){if(phase!=='ready')return;unlockAudio();hideGuide();phase='playing';root.dataset.phase=phase;jumpFromShelf();}
function finish(){phase='finished';root.dataset.phase=phase;result.hidden=false;root.querySelector('.height').textContent=Math.floor(bestHeight/8)+'m';tone(440,.3,.12,'sine',220);}
listen(root.querySelector('.card button'),'click',reset);
listen(canvas,'pointerdown',e=>{unlockAudio();motion.start();canvas.setPointerCapture(e.pointerId);aim(e);start();});
function aim(e){const r=canvas.getBoundingClientRect();targetX=clamp((e.clientX-r.left)*390/r.width,25,365);laserY=clamp((e.clientY-r.top)*390/r.width,70,H()*.8);}
listen(canvas,'pointermove',e=>{if(e.buttons||e.pointerType==='touch')aim(e);});
listen(window,'keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();keys.add(e.key);start();motion.start();}});listen(window,'keyup',e=>keys.delete(e.key));
function shelfSprite(width){
 if(!platformArt.complete||!platformArt.naturalWidth)return null;
 if(shelfCache.has(width))return shelfCache.get(width);
 const sprite=document.createElement('canvas');sprite.width=Math.ceil(width*2);sprite.height=26;
 const brush=sprite.getContext('2d'),sw=platformArt.naturalWidth,sh=platformArt.naturalHeight;
 // Keep the generated rounded ends intact while the wooden middle fits each bay.
 const cap=sw*52/1024,edge=Math.min(sprite.width*.18,cap*sprite.height/sh);
 brush.drawImage(platformArt,0,0,cap,sh,0,0,edge,sprite.height);
 brush.drawImage(platformArt,cap,0,sw-cap*2,sh,edge,0,sprite.width-edge*2,sprite.height);
 brush.drawImage(platformArt,sw-cap,0,cap,sh,sprite.width-edge,0,edge,sprite.height);
 shelfCache.set(width,sprite);return sprite;
}
function shelf(p){
 const y=p.y-camera,sprite=shelfSprite(p.w);ctx.save();
 ctx.shadowColor='#85593833';ctx.shadowBlur=5;ctx.shadowOffsetY=4;
 if(sprite){
  // Alpha-trimmed artwork's straight opaque top is row3/67. Align it to p.y;
  // all wooden front-face depth stays below the unchanged landing plane.
  ctx.drawImage(sprite,p.x,y-13*(3/67),p.w,13);
 }else{
  ctx.fillStyle='#c18b5a';ctx.beginPath();ctx.roundRect(p.x,y,p.w,13,4);ctx.fill();
 }
 ctx.restore();
}
function decor(){
 const h=H();ctx.fillStyle='#fcf2d5';ctx.fillRect(0,0,390,h);
 if(backdrop.complete&&backdrop.naturalWidth){
  // Fixed full-bleed cover keeps all framed pictures upright and avoids an
  // obvious wallpaper repeat as the endless platforms move upward.
  const scale=Math.max(390/backdrop.naturalWidth,h/backdrop.naturalHeight);
  const w=backdrop.naturalWidth*scale,hh=backdrop.naturalHeight*scale;
  ctx.drawImage(backdrop,(390-w)/2,(h-hh)/2,w,hh);
 }
}
reset();
// Ground contact persists while the laser is below the cat. A running jump
// completes normally; the next launch waits until the laser is above again.
function updateCat(dt){
 remaining=Math.max(0,remaining-dt);
 if(keys.has('ArrowLeft'))targetX=Math.max(25,targetX-260*dt);
 if(keys.has('ArrowRight'))targetX=Math.min(365,targetX+260*dt);
 const wanted=clamp((targetX-catX)*5.5,-420,420);
 vx+=(wanted-vx)*(1-Math.exp(-(standingOn?12:5.5)*dt));
 const nextX=clamp(catX+vx*dt,25,365);if(nextX===25||nextX===365)vx=0;catX=nextX;
 if(standingOn){
  if(catX+23<=standingOn.x||catX-23>=standingOn.x+standingOn.w)standingOn=null;
  else{catY=standingOn.y-35;vy=0;jumpFromShelf();}
 }
 if(!standingOn){
  const oldY=catY;vy+=1120*dt;catY+=vy*dt;
  if(vy>0)for(const p of platforms){
   if(oldY+35<=p.y+2&&catY+35>=p.y&&catX+23>p.x&&catX-23<p.x+p.w){
    catY=p.y-35;vy=0;standingOn=p;squash=.18;jumpFromShelf();break;
   }
  }
 }
 if(catY-camera<H()*.43)camera=catY-H()*.43;
 bestHeight=Math.max(bestHeight,initialY-catY);
 const top=platforms[platforms.length-1];
 if(top.y>camera-250)platforms.push(nextShelf(top));
 platforms=platforms.filter(p=>p.y<camera+H()+150);
 scoreEl.textContent=Math.floor(bestHeight/8)+'m';timeEl.textContent=Math.ceil(remaining)+'s';
 root.dataset.grounded=String(!!standingOn);
 if(catY-camera>H()+90||remaining<=0)finish();
}

// Both sprites face left at rest. Remember movement direction through the low-vx dead zone.
const idleFeet={x:293.5/570,y:451.5/454};
const reducedIdleMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||false;
function drawCat(t){
 if(vx>15)catFacing=1;else if(vx<-15)catFacing=-1;
 ctx.save();
 if(standingOn&&idleCat.complete&&idleCat.naturalWidth){
  // Breathing/landing squash pivots at the paw baseline, never at the body center.
  const breathe=phase==='playing'&&hostActive&&!reducedIdleMotion?Math.sin(t*2.5)*.009:0;
  const landing=phase==='playing'&&squash>0?1-.06*(squash/.18):1,sy=landing*(1+breathe);
  const scale=70/idleCat.naturalHeight;
  ctx.translate(catX,catY-camera+35);if(catFacing>0)ctx.scale(-1,1);
  ctx.scale(1/Math.sqrt(sy),sy);
  ctx.drawImage(idleCat,-idleCat.naturalWidth*idleFeet.x*scale,-idleCat.naturalHeight*idleFeet.y*scale,idleCat.naturalWidth*scale,idleCat.naturalHeight*scale);
 }else{
  ctx.translate(catX,catY-camera);if(catFacing>0)ctx.scale(-1,1);
  const sy=squash?.86:1+Math.min(.06,Math.abs(vy)/8000);ctx.scale(1/sy,sy);
  if(cat.complete&&cat.naturalWidth)ctx.drawImage(cat,-47,-35,94,70);
 }
 ctx.restore();
}

runLoop((dt,t)=>{if(phase==='playing')updateCat(dt);
 squash=Math.max(0,squash-dt);laserX+=(targetX-laserX)*(1-Math.exp(-14*dt));ctx.save();ctx.scale(view.W/390,view.W/390);decor();for(const p of platforms)if(p.y-camera>-15&&p.y-camera<H()+15)shelf(p);
 ctx.fillStyle='#ed315b22';ctx.beginPath();ctx.arc(laserX,laserY,17,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ff316144';ctx.beginPath();ctx.arc(laserX,laserY,10,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d71e42';ctx.beginPath();ctx.arc(laserX,laserY,5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff9';ctx.beginPath();ctx.arc(laserX-1,laserY-1,1.4,0,Math.PI*2);ctx.fill();
 drawCat(t);ctx.restore();});


configure(()=>{root.querySelector('.guide').textContent=String(setting('GUIDE',"Tilt to guide the laser"));const path=setting('CAT','./assets/leaping-tabby.webp');if(cat.getAttribute('src')!==path)cat.src=path;const idlePath=String(setting('CAT_IDLE','./assets/idle-tabby-v1.webp'));if(idleCat.getAttribute('src')!==idlePath)idleCat.src=idlePath;const wall=String(setting('BACKDROP','./assets/storybook-v2/cozy-wall.webp')),shelfPath=String(setting('PLATFORM','./assets/storybook-v3/honey-shelf-front.webp'));if(backdrop.getAttribute('src')!==wall)backdrop.src=wall;if(platformArt.getAttribute('src')!==shelfPath){shelfCache.clear();platformArt.src=shelfPath;}roundSeconds=clamp(Number(setting('ROUND_SECONDS',60))||60,20,120);if(phase==='ready'){remaining=roundSeconds;timeEl.textContent=roundSeconds+'s';}});

})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.cat-game .hud{top:30px;font-size:28px}\n.cat-game .guide{font-family:Bangers,UIBody,sans-serif;font-size:20px;letter-spacing:.5px;line-height:1.3}\n.cat-game .sensor{bottom:50px;min-height:44px;font:700 14px/1.3 UIBody,system-ui,sans-serif}\n.cat-game .result{padding:30px 30px 50px;display:grid;overflow:auto}\n.cat-game .card{width:100%;max-width:330px;padding:28px 22px}\n.card h1{font:400 24px/1.3 Bangers,UIBody,sans-serif}\n.height{font:400 48px/1.15 Bangers,UIBody,sans-serif}\n.card p{font:400 15px/1.6 UIBody,system-ui,sans-serif}\n.card button{font:400 20px/1.3 Bangers,UIBody,sans-serif;min-height:44px}\n";
  document.head.append(uiStyle);
})();
