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

addStyle(`body{background:#291416;color:#f6dbd5}.etch{width:100%;height:100%;position:relative;touch-action:none;overflow:hidden}canvas{width:100%;height:100%;display:block}.etch .guide{top:32%;white-space:pre-line;color:#790d25;text-shadow:0 1px #fff8}.etch .sensor{bottom:18px;background:#59131b;font-family:monospace;font-size:12px}.erase{position:absolute;bottom:19px;right:30px;width:38px;height:38px;border:1px solid #a95058;border-radius:50%;background:#721426;color:#fbd9c9;font-size:23px}.etch .sensor{left:30px;transform:none}`);
root.innerHTML=`<div class="etch"><canvas aria-label="Etch A Sketch drawing surface"></canvas><div class="etch-intro"><div class="guide">Tilt to draw
Shake to erase</div><button class="sensor">Enable tilt</button></div><button class="erase" aria-label="Erase drawing">↺</button></div>`;
const canvas=root.querySelector('canvas'),view=canvasSize(canvas),{ctx}=view;
let points=[],cursor={x:.5,y:.5},drawing=false,erasePulse=0,knob=0;

// One softly filtered mechanical texture follows real drawing movement, never a sound per point.
let etchFeedback=null,etchNoise=null,lastEtchMove=-Infinity;
function stopEtchFeedback(immediate=false){
 const sound=etchFeedback;if(!sound)return;etchFeedback=null;
 try{
  const now=audio.currentTime;sound.gain.gain.cancelScheduledValues(now);
  if(immediate)sound.gain.gain.setValueAtTime(0,now);else sound.gain.gain.setTargetAtTime(0,now,.015);
  sound.source.stop(immediate?0:now+.06);
 }catch(_){sound.source.disconnect();sound.filter.disconnect();sound.gain.disconnect();}
 if(immediate){sound.source.disconnect();sound.filter.disconnect();sound.gain.disconnect();}
}
function trackEtchMovement(distance,mode){
 if(!audio||audio.state!=='running'||!hostActive||document.hidden||disposed)return;
 try{
  if(!etchNoise){etchNoise=audio.createBuffer(1,audio.sampleRate,audio.sampleRate);const data=etchNoise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;}
  if(!etchFeedback){
   const source=audio.createBufferSource(),filter=audio.createBiquadFilter(),gain=audio.createGain();
   source.buffer=etchNoise;source.loop=true;filter.type='bandpass';filter.Q.value=.7;gain.gain.setValueAtTime(0,audio.currentTime);
   source.connect(filter).connect(gain).connect(audio.destination);source.start();
   source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};etchFeedback={source,filter,gain,quiet:false};
  }
  const intensity=clamp(distance/5,0,1),now=audio.currentTime;
  etchFeedback.filter.frequency.setTargetAtTime((mode==='tilt'?520:850)+intensity*350,now,.035);
  etchFeedback.gain.gain.cancelScheduledValues(now);etchFeedback.gain.gain.setTargetAtTime((mode==='tilt'?.025:.035)+intensity*(mode==='tilt'?.025:.035),now,.025);
  etchFeedback.quiet=false;lastEtchMove=performance.now();
 }catch(_){stopEtchFeedback(true);}
}
function updateEtchFeedback(){
 if(!etchFeedback)return;
 if(!hostActive||document.hidden||audio?.state!=='running'){stopEtchFeedback(true);return;}
 const idle=performance.now()-lastEtchMove;
 if(idle>120&&!etchFeedback.quiet){etchFeedback.gain.gain.setTargetAtTime(0,audio.currentTime,.025);etchFeedback.quiet=true;}
 if(idle>280)stopEtchFeedback();
}
function pauseEtchFeedback(){drawing=false;keys.clear();stopEtchFeedback(true);}
listen(document,'visibilitychange',()=>{if(document.hidden)pauseEtchFeedback();});
listen(window,'message',event=>{if(event.source===parent&&event.data?.type==='playable-active'&&event.data.active!==true)pauseEtchFeedback();});
listen(window,'pagehide',pauseEtchFeedback,{capture:true});

const motion=sensorInput({gyro:true,shake:true,onShake:erase});
function erase(){if(!hostActive)return;stopEtchFeedback(true);points=[];erasePulse=1;hideGuide();tone(120,.18,.12,'triangle',60);root.dataset.strokes='0';}
listen(root.querySelector('.erase'),'click',()=>{unlockAudio();erase();});
const keys=new Set();listen(window,'keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();keys.add(e.key);motion.start();unlockAudio();}if(e.key==='Backspace'){e.preventDefault();unlockAudio();erase();}});listen(window,'keyup',e=>keys.delete(e.key));
function area(){return{x:30,y:90,w:view.W-60,h:view.H-202};}
function add(x,y,mode='pointer'){const previous={...cursor};cursor.x=clamp(x,0,1);cursor.y=clamp(y,0,1);const a=area(),distance=Math.hypot((cursor.x-previous.x)*a.w,(cursor.y-previous.y)*a.h);if(mode!=='silent'&&distance>.12)trackEtchMovement(distance,mode);points.push([cursor.x,cursor.y]);if(points.length>16000)points.splice(0,4000);root.dataset.strokes=String(points.length);hideGuide();}
listen(canvas,'pointerdown',e=>{unlockAudio();motion.start();canvas.setPointerCapture(e.pointerId);const r=canvas.getBoundingClientRect(),a=area(),x=e.clientX-r.left,y=e.clientY-r.top;if(x>a.x&&x<a.x+a.w&&y>a.y&&y<a.y+a.h){drawing=true;points.push(null);add((x-a.x)/a.w,(y-a.y)/a.h,'silent');}});
listen(canvas,'pointermove',e=>{if(!drawing)return;const r=canvas.getBoundingClientRect(),a=area();add((e.clientX-r.left-a.x)/a.w,(e.clientY-r.top-a.y)/a.h);});
for(const ev of ['pointerup','pointercancel','lostpointercapture'])listen(canvas,ev,()=>{drawing=false;stopEtchFeedback();});
function rounded(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
runLoop((dt)=>{const W=view.W,H=view.H,a=area();const x=motion.state.x+(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0),y=motion.state.y+(keys.has('ArrowDown')?1:0)-(keys.has('ArrowUp')?1:0);if(!drawing&&(Math.abs(x)+Math.abs(y)>.06)){if(!points.length)points.push([cursor.x,cursor.y]);add(cursor.x+x*dt*.42,cursor.y+y*dt*.32,'tilt');knob+=dt*x*3;}updateEtchFeedback();
 ctx.clearRect(0,0,W,H);const bg=ctx.createRadialGradient(W*.45,H*.35,20,W*.5,H*.5,H*.7);bg.addColorStop(0,'#4e2225');bg.addColorStop(1,'#190f11');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
 ctx.shadowColor='#0009';ctx.shadowBlur=18;ctx.shadowOffsetY=8;rounded(12,27,W-24,H-41,23,'#6f0f21','#a23843');ctx.shadowBlur=0;ctx.shadowOffsetY=0;const red=ctx.createLinearGradient(0,30,W,H);red.addColorStop(0,'#ee3450');red.addColorStop(.2,'#c81735');red.addColorStop(.75,'#9e0c29');red.addColorStop(1,'#720e23');ctx.lineWidth=2;rounded(20,33,W-40,H-55,18,red,'#ee62715c');rounded(a.x-6,a.y-6,a.w+12,a.h+12,10,'#7b1126','#ef65704d');
 const screen=ctx.createLinearGradient(a.x,0,a.x+a.w,0);screen.addColorStop(0,'#cdcec1');screen.addColorStop(.5,'#d7d9cb');screen.addColorStop(1,'#c8cbbf');rounded(a.x,a.y,a.w,a.h,7,screen,'#9aab9b');ctx.save();ctx.beginPath();ctx.roundRect(a.x,a.y,a.w,a.h,7);ctx.clip();ctx.strokeStyle='#63705b08';ctx.lineWidth=3;for(let i=12;i<a.w;i+=23){ctx.beginPath();ctx.moveTo(a.x+i,a.y);ctx.lineTo(a.x+i,a.y+a.h);ctx.stroke();}ctx.strokeStyle='#850e2d';ctx.lineWidth=2.1;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();let first=true;for(const p of points){if(!p){first=true;continue;}const px=a.x+p[0]*a.w,py=a.y+p[1]*a.h;if(first){ctx.moveTo(px,py);first=false;}else ctx.lineTo(px,py);}ctx.stroke();ctx.beginPath();ctx.arc(a.x+cursor.x*a.w,a.y+cursor.y*a.h,7,0,Math.PI*2);ctx.lineWidth=1.6;ctx.stroke();ctx.restore();
 ctx.fillStyle='#f8e0cc';ctx.textAlign='center';ctx.font='700 11px monospace';ctx.letterSpacing='3px';ctx.fillText('ETCH',W/2,56);ctx.font='700 8px monospace';ctx.fillText('A SKETCH',W/2,68);ctx.letterSpacing='0px';
 for(const bx of [52,W-52]){ctx.save();ctx.translate(bx,59);ctx.rotate(bx===52?knob:-knob);let g=ctx.createRadialGradient(-5,-7,1,0,0,18);g.addColorStop(0,'#c93c4b');g.addColorStop(.65,'#a4122a');g.addColorStop(1,'#680c1c');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,16,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#f16c6c66';ctx.lineWidth=2;ctx.stroke();ctx.strokeStyle='#550d20';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-5,-5);ctx.lineTo(5,5);ctx.moveTo(-5,5);ctx.lineTo(5,-5);ctx.stroke();ctx.restore();}
 if(erasePulse>0){ctx.globalAlpha=erasePulse*.6;rounded(a.x,a.y,a.w,a.h,7,'#e6e9d9');ctx.globalAlpha=1;erasePulse=Math.max(0,erasePulse-dt*2.5);}
});


configure(()=>{root.querySelector('.guide').textContent=String(setting('GUIDE',"Tilt to draw\nShake to erase"));});

// Keep the real permission control in the drawing frame, immediately under its guide.
addStyle(`.etch .etch-intro{position:absolute;left:42px;right:42px;top:32%;z-index:10;display:flex;flex-direction:column;align-items:center;gap:12px;pointer-events:none}.etch .etch-intro .guide{position:static;inset:auto;width:100%;margin:0}.etch .etch-intro .sensor{position:static;inset:auto;transform:none;align-self:center;max-width:100%;margin:0;white-space:normal;pointer-events:auto}`);

})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n@font-face{font-family:UIPixel;src:url('./assets/ui/Silkscreen-Regular.ttf') format('truetype');font-display:swap}\n.etch .sensor{bottom:50px;font-family:UIPixel,monospace;font-size:14px;min-height:44px;padding:10px 16px}\n.erase{bottom:50px;right:30px;width:44px;height:44px;min-height:44px;font-size:24px}\n.etch .guide{font-family:UIPixel,monospace;font-size:18px;line-height:1.5;top:32%;font-weight:400}\n";
  document.head.append(uiStyle);
})();
