// Readable editable source: styles, markup and game logic are contained here.
(()=>{
"use strict";
// These helpers are inlined into each readable App.jsx; no external game scripts.
const root = document.getElementById('root');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const lastItem = a => a[a.length-1];
const shuffle = a => { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const listeners = [], cleanups = [];
let active = true, disposed = false, audio;
function on(target, type, fn, options){target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));}
function mount(css, markup, background='#faf8f1'){
 const style=document.createElement('style');
 style.textContent=`@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}`+css;
 document.head.append(style);root.style.background=background;root.innerHTML='<div class="fit">'+markup+'</div>';
 const fit=root.querySelector('.fit');function resize(){const r=root.getBoundingClientRect(),s=Math.min(r.width/390,r.height/598);fit.style.transform=`translate(${(r.width-390*s)/2}px,${(r.height-598*s)/2}px) scale(${s})`;root.dataset.layout=`${Math.round(r.width)}x${Math.round(r.height)}`;}resize();on(window,'resize',resize);
}
function $(s){return root.querySelector(s);}
function guideOff(){ $('.guide')?.classList.add('gone'); }
function state(s){root.dataset.phase=s;}
function gesture(){unlockAudio();guideOff();}
function unlockAudio(){try{audio ||= new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume().catch(()=>{});}catch(_){}}
function sound(freq=450,duration=.08,volume=.18,type='sine',end=0){if(!audio||!active)return;try{const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime;o.type=type;o.frequency.setValueAtTime(freq,t);if(end)o.frequency.exponentialRampToValueAtTime(Math.max(30,end),t+duration);g.gain.setValueAtTime(.001,t);g.gain.exponentialRampToValueAtTime(volume,t+.006);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+duration+.02);o.onended=()=>{o.disconnect();g.disconnect();};}catch(_){}}
function success(){sound(523,.12,.18);setTimeout(()=>sound(784,.17,.16),100);}
function fail(){sound(180,.22,.18,'triangle',65);}
function loop(step){let previous=0;function frame(t){if(disposed)return;const dt=Math.min(.035,(t-(previous||t))/1000);previous=t;if(!document.hidden)step(active?dt:0,t/1000);requestAnimationFrame(frame);}requestAnimationFrame(frame);}
function stageCanvas(){const canvas=$('canvas.stage'),ctx=canvas.getContext('2d'),d=Math.min(2,window.devicePixelRatio||1);canvas.width=390*d;canvas.height=598*d;ctx.scale(d,d);return{canvas,ctx};}
function point(e,canvas=$('canvas.stage')){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*390/r.width,y:(e.clientY-r.top)*598/r.height};}
function roundPath(ctx,x,y,w,h,r){r=Math.min(Math.abs(w)/2,Math.abs(h)/2,r);ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}
function round(ctx,x,y,w,h,r,fill,stroke){ctx.beginPath();roundPath(ctx,x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function circle(ctx,x,y,r,fill,stroke){ctx.beginPath();ctx.arc(x,y,Math.max(.01,r),0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function line(ctx,x,y,x2,y2,color,width=2){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
function text(ctx,s,x,y,size=18,color='#25252a',font='UIBody',align='center'){ctx.font=`700 ${size}px ${font}`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(s,x,y);}
const assetImages=[];
function assetPath(path){const id=path.split('/').pop().replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9]/g,'_').toUpperCase();return String(setting(id,path));}
function image(path){const im=new Image();im.onerror=()=>{root.dataset.assetIssue='image';};im.src=assetPath(path);assetImages.push({im,path});return im;}
function cover(ctx,im,x,y,w,h){if(!im)return false;const iw=im.videoWidth||im.naturalWidth||im.width,ih=im.videoHeight||im.naturalHeight||im.height;if(!iw||!ih)return false;const scale=Math.max(w/iw,h/ih);ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.drawImage(im,x+(w-iw*scale)/2,y+(h-ih*scale)/2,iw*scale,ih*scale);ctx.restore();return true;}
function cropCircle(ctx,im,x,y,r){ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();cover(ctx,im,x-r,y-r,r*2,r*2);ctx.restore();}
function result(title,value,detail,again){const modal=$('.modal');if(!modal)return;modal.hidden=false;modal.querySelector('h2').textContent=title;modal.querySelector('.value').textContent=value;modal.querySelector('p').textContent=detail;const button=modal.querySelector('button');button.onclick=()=>{modal.hidden=true;gesture();again();};state('result');}
function resultMarkup(label='Play again'){return `<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${label}</button></section></div>`;}
function flash(){const e=$('.flash');if(!e)return;e.classList.remove('fire');void e.offsetWidth;e.classList.add('fire');}
const lifecycle=[];
function setActive(next){active=next;if(!next)audio?.suspend().catch(()=>{});for(const fn of lifecycle)fn(next);}
on(window,'message',e=>{if(e.source===parent&&e.data?.type==='playable-active')setActive(e.data.active===true);});
on(document,'visibilitychange',()=>{setActive(!document.hidden);});
on(window,'pagehide',()=>{disposed=true;listeners.splice(0).forEach(off=>off());cleanups.splice(0).forEach(fn=>fn());audio?.close().catch(()=>{});});
const configValues={};
function setting(id,fallback){return configValues[id]??fallback;}
async function configure(callback=()=>{}){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),1600);try{const r=await fetch('./game.config.json',{signal:ctl.signal});if(!r.ok)throw Error('Config unavailable');const c=await r.json();for(const group of ['texts','tweaks','images'])for(const v of c[group]||[])configValues[v.id]=group==='images'?v.path:v.value;for(const binding of assetImages){const path=assetPath(binding.path);if(binding.im.getAttribute('src')!==path)binding.im.src=path;}for(const im of root.querySelectorAll('img[src^="./assets/"]'))im.src=assetPath(im.getAttribute('src'));callback();root.dataset.config='loaded';}catch(_){root.dataset.config='defaults';}finally{clearTimeout(timer);}}

// Real camera frames only. Never substitute a sample portrait for the user.
let camStream=null,camFacing='user',camPending=false,camRequest=0,camReady=false;
const camItalian=new URLSearchParams(location.search).get('lang')==='it'||document.documentElement.lang==='it';
const camText=(en,it)=>camItalian?it:en;
function cameraSource(){
 const v=$('video.preview');
 return camReady&&camStream?.getVideoTracks().some(t=>t.readyState==='live'&&t.enabled)&&v?.readyState>=2&&v.videoWidth>0&&v.videoHeight>0?v:null;
}
function cameraUI(kind,message){
 root.dataset.camera=kind;
 const status=$('.cam-status'),button=$('.cam-enable');
 if(status)status.textContent=message;
 if(button){button.disabled=false;button.setAttribute('aria-pressed',String(kind==='enabled'));button.textContent=camPending?camText('Connecting… · Cancel','Connessione… · Annulla'):kind==='enabled'?camText('Camera on · Stop','Fotocamera attiva · Stop'):camText('Enable camera','Attiva fotocamera');}
 for(const b of root.querySelectorAll('.shutter,.cam-capture'))b.disabled=!cameraSource();
}
function stopCamera(){
 camRequest++;camReady=false;camPending=false;
 const old=camStream;camStream=null;old?.getTracks().forEach(t=>t.stop());
 const v=$('video.preview');if(v){v.pause();v.srcObject=null;}
 cameraUI('idle',camText('Enable your camera to take a photo','Attiva la fotocamera per scattare una foto'));
}
async function startCamera(){
 if(camPending)return;
 stopCamera();const request=++camRequest;camPending=true;
 cameraUI('requesting',camText('Waiting for your camera…','In attesa della fotocamera…'));
 let stream;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera API unavailable');
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:camFacing}},audio:false});
  if(disposed||!active||request!==camRequest){stream.getTracks().forEach(t=>t.stop());return;}
  camStream=stream;const v=$('video.preview');v.muted=true;v.playsInline=true;v.srcObject=stream;
  let playbackTimeout;try{await Promise.race([v.play(),new Promise((resolve,reject)=>{playbackTimeout=setTimeout(()=>reject(Error('Camera playback did not start')),7000);})]);}finally{clearTimeout(playbackTimeout);}
  await new Promise((resolve,reject)=>{
   let timer;
   const cleanup=()=>{clearTimeout(timer);v.removeEventListener('loadeddata',ready);v.removeEventListener('canplay',ready);};
   const ready=()=>{if(v.readyState>=2&&v.videoWidth>0&&v.videoHeight>0){cleanup();resolve();}};
   v.addEventListener('loadeddata',ready);v.addEventListener('canplay',ready);
   timer=setTimeout(()=>{cleanup();reject(Error('No camera frame received'));},7000);ready();
  });
  if(disposed||!active||request!==camRequest){stream.getTracks().forEach(t=>t.stop());return;}
  camReady=true;camPending=false;
  for(const track of stream.getVideoTracks())on(track,'ended',()=>{if(camStream!==stream)return;stopCamera();cameraUI('unavailable',camText('Camera disconnected · try again','Fotocamera scollegata · riprova'));});
  cameraUI('enabled',camText('Camera ready · take a photo','Fotocamera pronta · scatta una foto'));
 }catch(error){
  stream?.getTracks().forEach(t=>t.stop());if(request!==camRequest)return;
  stopCamera();const denied=error?.name==='NotAllowedError'||error?.name==='SecurityError';
  cameraUI('unavailable',denied?camText('Camera access is blocked · allow it and retry','Accesso alla fotocamera bloccato · consenti e riprova'):camText('No camera image received · try again','Nessuna immagine dalla fotocamera · riprova'));
 }
}
function takePhoto(width=600,height=800,mirror=true){
 const source=cameraSource();if(!source)return null;
 const c=document.createElement('canvas');c.width=width;c.height=height;const x=c.getContext('2d');
 if(mirror&&camFacing==='user'){x.translate(width,0);x.scale(-1,1);}
 return cover(x,source,0,0,width,height)?c:null;
}
function paintCamera(canvas,background='#f0ede5'){
 const x=canvas.getContext('2d'),w=canvas.width,h=canvas.height;x.fillStyle=background;x.fillRect(0,0,w,h);
 const source=cameraSource();if(source){x.save();if(camFacing==='user'){x.translate(w,0);x.scale(-1,1);}cover(x,source,0,0,w,h);x.restore();return;}
 x.save();x.translate(w/2,h/2-8);const s=Math.min(w,h)/160;x.scale(s,s);x.strokeStyle='#767268';x.lineWidth=3;x.lineJoin='round';x.beginPath();roundPath(x,-29,-19,58,38,6);x.stroke();x.beginPath();x.arc(0,0,10,0,Math.PI*2);x.stroke();x.beginPath();x.moveTo(-17,-19);x.lineTo(-12,-27);x.lineTo(12,-27);x.lineTo(17,-19);x.stroke();x.restore();
 x.fillStyle='#68645b';x.font=`500 ${Math.max(15,w/23)}px UIBody,Arial`;x.textAlign='center';x.textBaseline='middle';x.fillText(camPending?camText('Connecting…','Connessione…'):camText('Your camera image','La tua fotocamera'),w/2,h/2+Math.min(w,h)*.25);
}
function cameraControls(){
 $('video.preview')?.setAttribute('aria-hidden','true');
 const style=document.createElement('style');style.textContent='.preview{display:block!important;position:absolute!important;width:1px!important;height:1px!important;left:0;bottom:0;opacity:.001;pointer-events:none}.cam-enable[aria-pressed="true"]{border-color:#47754b;background:#edf5e9;color:#315b35}';document.head.append(style);
 on($('.cam-enable'),'click',()=>{unlockAudio();if(camStream||camPending)stopCamera();else startCamera();});
 if($('.cam-flip'))on($('.cam-flip'),'click',()=>{camFacing=camFacing==='user'?'environment':'user';stopCamera();startCamera();});
 lifecycle.push(next=>{if(!next)stopCamera();});cleanups.push(stopCamera);cameraUI('idle',camText('Enable your camera to take a photo','Attiva la fotocamera per scattare una foto'));
}

// Full-bleed print-paper stays attached to the viewport, not the fitted game stage.
function paintPaperBackdrop(){
 const path=String(setting('PAPER_BACKDROP','./assets/paper-print-v1.svg'));
 root.style.backgroundColor='#efd77b';
 root.style.backgroundImage='url('+JSON.stringify(path)+')';
 root.style.backgroundSize='256px 256px';
 root.style.backgroundRepeat='repeat';
}
function installPrintedPaper(){
 paintPaperBackdrop();
 const style=document.createElement('style');
 style.textContent=`#root{position:relative;isolation:isolate;color:#282723}
 #root .fit{background:transparent!important}
 #root .paper-overlay{position:absolute;inset:0;z-index:40;background:transparent;pointer-events:auto;isolation:isolate}
 #root .paper-overlay[hidden]{display:none!important}
 #root .paper-result-fit{position:absolute;width:390px;height:598px;transform-origin:0 0;font-family:UIBody,system-ui,sans-serif;pointer-events:auto}
 #root .paper-result-fit .modal{background:transparent}
 #root .result,#root .comparison{background:#fff4c7;color:#282723;border:2px solid #282723;border-radius:12px;box-shadow:4px 5px 0 #28272322}
 #root .pill{background:#282723;color:#fff9e9;border:2px solid #282723;box-shadow:0 3px 0 #28272325}
 #root .capability,#root .stop-sugar{color:#282723;background:#fff4c7;border:2px solid #282723;box-shadow:0 2px 0 #2827231c}
 #root .capability:disabled,#root .pill:disabled{box-shadow:none}
 #root .shutter{border-color:#282723;background:#fff4c7}
 #root .eyebrow,#root .booth-label,#root .guide{color:#282723}
 #root .cam-status,#root .mic-status,#root .target-label{color:#625c4b}
 #root .live-booth{border-color:#282723;border-radius:10px;box-shadow:4px 5px 0 #28272325}#root .doodles{opacity:.72}#root .shutter{box-shadow:inset 0 0 0 5px #fff4c7,inset 0 0 0 7px #282723}#root .strip-view{padding:0}#root .strip-view canvas{filter:drop-shadow(2px 3px 0 #28272328)}`;
 document.head.append(style);
 const fit=root.querySelector('.fit');
 const panel=fit.querySelector('.comparison,.strip-view,.modal');
 if(!panel)return;
 // Reuse the existing card and its exact390×598 measurements inside a viewport-wide scrim.
 const overlay=document.createElement('div'),frame=document.createElement('div');
 overlay.className='paper-overlay';frame.className='paper-result-fit';
 overlay.hidden=panel.hidden;frame.append(panel);overlay.append(frame);root.append(overlay);
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
 function sync(){overlay.hidden=panel.hidden;fit.inert=!panel.hidden;fit.style.visibility=panel.hidden?'visible':'hidden';}
 const visibility=new MutationObserver(sync);visibility.observe(panel,{attributes:true,attributeFilter:['hidden']});
 function resize(){
  const bounds=root.getBoundingClientRect(),scale=Math.min(bounds.width/390,bounds.height/598);
  const transform=`translate(${(bounds.width-390*scale)/2}px,${(bounds.height-598*scale)/2}px) scale(${scale})`;
  frame.style.transform=transform;fit.style.transform=transform;
 }
 sync();resize();on(window,'resize',resize);
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;
 observer?.observe(root);cleanups.push(()=>{visibility.disconnect();observer?.disconnect();});
}



// Reuse the same imperfect ink shapes in the scene, result and saved photo-strip footer.
const BOOTH_FISH_PATH='M-7 0C-2-10 10-10 15-1C12 9-2 9-7 0ZM-7 0-15-7-14 7ZM-1-7 2-12 6-8';
const BOOTH_FACE_PATH='M0-13C17-14 18 13 1 14C-17 15-18-12 0-13ZM-7 4Q0 13 7 3';
function boothFishSVG(x,y,s=1){return `<g transform="translate(${x} ${y}) scale(${s})"><path d="${BOOTH_FISH_PATH}"/><circle cx="9" cy="-2" r="1.2" fill="#282723" stroke="none"/></g>`;}
function boothFaceSVG(x,y,s=1){return `<g transform="translate(${x} ${y}) scale(${s})"><path d="${BOOTH_FACE_PATH}"/><g fill="#282723" stroke="none"><circle cx="-5" cy="-3" r="1.25"/><circle cx="5" cy="-3" r="1.25"/></g></g>`;}
function boothFlowerSVG(x,y,s=1){return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-3-6C-12-19 4-22 3-8C15-20 23-4 8-2C24 4 10 19 4 6C2 23-15 18-7 4C-23 5-24-12-9-8Q-6-8-3-6Z"/><path d="M3 5q-2 10 1 17m-1-5q10-7 11-2-4 7-11 2"/><circle r="3.7"/></g>`;}
function boothLeafSVG(x,y,s=1){return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-10 13Q-20-5 9-15Q21 4-10 13ZM-11 16 6-10M-7 9-11 0M-3 3 7 2"/></g>`;}
function printBoothDoodle(ctx,kind,x,y,s=1){
 ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle='#282723';ctx.fillStyle='#282723';ctx.lineWidth=1.8;ctx.lineCap='round';ctx.lineJoin='round';
 ctx.stroke(new Path2D(kind==='fish'?BOOTH_FISH_PATH:BOOTH_FACE_PATH));
 for(const [cx,cy] of kind==='fish'?[[9,-2]]:[[-5,-3],[5,-3]]){ctx.beginPath();ctx.arc(cx,cy,1.25,0,Math.PI*2);ctx.fill();}
 ctx.restore();
}

mount(`#root .booth-label{position:absolute;left:30px;right:30px;top:30px;text-align:center;font:24px/1.3 Playful,UIBody,sans-serif;transform:none}
#root .doodles{position:absolute;inset:0;width:100%;height:100%;z-index:10;pointer-events:none;opacity:.75}
#root .live-booth{position:absolute;left:39px;top:118px;width:312px;height:293px;background:#eee9dd;border:4px solid #282723;transform:none;border-radius:10px;overflow:hidden;box-shadow:4px 5px 0 #28272325}
#root .live-booth canvas{display:block;width:100%;height:100%;filter:grayscale(1)}
#root .guide{top:432px;left:30px;right:30px;margin:0;font:400 18px/1.35 UIBody,system-ui,sans-serif}
#root .countdown{position:absolute;left:39px;top:118px;width:312px;height:293px;display:grid;place-items:center;pointer-events:none;text-align:center;font:70px/1 Playful,UIBody,sans-serif;color:#fff;text-shadow:2px 2px #28272388}
#root .cam-status{top:77px;bottom:auto;left:30px;right:30px;font:400 12px/1.4 UIBody,system-ui,sans-serif;color:#625c4b;margin:0}
#root .bottom{left:30px;right:30px;bottom:50px;display:grid;grid-template-columns:minmax(0,1fr);gap:0;align-items:center;justify-items:center;min-height:58px}
#root .bottom .capability{grid-area:1/1;width:230px;max-width:100%;min-width:0;min-height:48px;padding:8px 14px;font-size:14px;line-height:1.3}
#root .bottom .shutter{position:relative;grid-area:1/1;left:auto;bottom:auto;display:flex;align-items:center;justify-content:center;gap:10px;width:230px;max-width:100%;height:58px;min-height:58px;padding:8px 14px;border:2px solid #282723;border-radius:24px;background:#fff4c7;color:#282723;box-shadow:0 2px 0 #28272325;font:700 16px/1.3 UIBody,system-ui,sans-serif}#root .shutter svg{width:23px;height:23px;flex:none;pointer-events:none}
#root .strip-view{position:absolute;inset:30px 30px 50px;z-index:15;display:grid;grid-template-rows:minmax(0,1fr) auto minmax(18px,auto);gap:12px;align-items:center;justify-items:center;background:transparent;border:0;border-radius:0;padding:0;box-shadow:none}
#root .strip-view[hidden]{display:none}
#root .strip-view .strip{position:relative;z-index:1;align-self:center;height:100%;max-height:100%;width:auto;max-width:100%;min-height:0;min-width:0;object-fit:contain;filter:drop-shadow(2px 3px 0 #28272328)}
#root .strip-actions{position:relative;z-index:1;display:grid;grid-template-columns:1.15fr 1fr;gap:12px;width:100%}
#root .strip-actions .pill{position:static;min-width:0;min-height:48px;margin:0;padding:10px 8px;font:700 14px/1.3 UIBody,system-ui,sans-serif}
#root .save-status{position:relative;z-index:1;min-height:18px;margin:0;width:100%;color:#625c4b;text-align:center;font:400 12px/1.4 UIBody,system-ui,sans-serif;overflow-wrap:anywhere}
#root .strip-doodles{position:absolute;inset:0;width:100%;height:100%;z-index:2;opacity:.7;pointer-events:none}
.preview{display:none}`,`<div class="booth-label">DOODLE BOOTH</div><svg class="doodles" viewBox="0 0 390 598" fill="none" stroke="#282723" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${boothFishSVG(18,215)}${boothFaceSVG(20,342)}${boothFlowerSVG(371,199,.65)}${boothLeafSVG(373,341,.68)}<path d="M4 94q10-2 11-13 2 11 12 14-11 1-13 12-1-11-10-13ZM366 94q9-2 11-13 0 12 10 14-11 1-13 12-1-10-8-13ZM24 467q8-1 9-9 2 8 9 10-8 1-10 9-1-8-8-10ZM358 464l5-8 1 10 10 3-10 3-2 8-2-9-8-4Z"/></svg><div class="live-booth"><canvas width="640" height="600" aria-label="Live camera preview"></canvas></div><video class="preview" playsinline autoplay muted></video><div class="guide">Three poses. One little memory.</div><div class="countdown" aria-live="polite"></div><div class="status cam-status">Enable your camera to take a photo</div><div class="bottom"><button class="capability cam-enable">Enable camera</button><button class="shutter" aria-label="Take photo strip" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5 7 7l1.6-3h6.7L17 7l3.4.4.2 12-17.2.2Z"/><path d="M16.6 12.7c.2 6.1-9.4 6.1-9.2.1-.1-6 9.3-6.2 9.2-.1Z"/></svg><span class="shutter-label">Take photos</span></button></div><div class="strip-view" hidden aria-label="Your photo strip"><svg class="strip-doodles" viewBox="0 0 330 518" fill="none" stroke="#282723" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${boothFishSVG(43,128,1.35)}${boothFaceSVG(285,318,1.3)}${boothFlowerSVG(283,142,.8)}${boothLeafSVG(44,331,.95)}<path d="M23 224q9-1 10-12 2 10 12 13-11 1-13 12-1-10-9-13ZM286 232l5-9 2 10 10 3-10 3-2 10-2-10-9-4Z"/></svg><canvas class="strip" width="720" height="2100" role="img" aria-label="Your three-photo strip"></canvas><div class="strip-actions"><button class="pill save-strip">Save image</button><button class="pill retake">Retake</button></div><p class="save-status" role="status" aria-live="polite"></p></div><div class="flash"></div>`,'#efd77b');
installPrintedPaper();
let boothPhase='ready',wait=0,shots=[];

let savingStrip=false,saveRequest=0,saveTimer;
function setSaveState(kind,message=''){
 const button=$('.save-strip');savingStrip=kind==='saving';
 button.disabled=savingStrip;button.setAttribute('aria-busy',String(savingStrip));
 button.textContent=savingStrip?camText('Saving…','Salvataggio…'):camText('Save image','Salva immagine');
 $('.save-status').textContent=message;root.dataset.save=kind;
}
function resetSaveState(){saveRequest++;clearTimeout(saveTimer);setSaveState('ready');}
function saveStrip(){
 if(savingStrip||boothPhase!=='result'||shots.length!==3)return;
 const request=++saveRequest;let settled=false;
 function done(kind,message){if(settled||request!==saveRequest||disposed)return;settled=true;clearTimeout(saveTimer);setSaveState(kind,message);}
 setSaveState('saving',camText('Saving your photo strip…','Salvataggio delle tue foto…'));
 try{
  const dataURL=$('.strip').toDataURL('image/png');
  if(!dataURL.startsWith('data:image/'))throw Error('No photo export');
  const filename='doodle-booth-'+Date.now();
  if(typeof window.tt?.saveDataURL==='function'){
   saveTimer=setTimeout(()=>done('error',camText('No save confirmation. You can try again.','Nessuna conferma. Puoi riprovare.')),15000);
   window.tt.saveDataURL({dataURL,filename,extension:'png',saveToAlbum:'image',
    success(){done('saved',camText('Saved to your photos.','Salvato nelle tue foto.'));},
    fail(error){console.warn('[photo-booth] Save failed:',error?.message||'Unavailable');done('error',camText('Could not save. Check photo access, then retry.','Impossibile salvare. Controlla i permessi e riprova.'));},
    complete(){if(!settled)done('error',camText('No save confirmation. You can try again.','Nessuna conferma. Puoi riprovare.'));}
   });
  }else{
   // The SDK documents this browser-only fallback; it does not claim an album save.
   const download=document.createElement('a');download.href=dataURL;download.download=filename+'.png';download.hidden=true;document.body.append(download);download.click();download.remove();
   done('downloaded',camText('Download started. Check your downloads.','Download avviato. Controlla i download.'));
  }
 }catch(error){console.warn('[photo-booth] Export failed:',error?.message||'Unavailable');done('error',camText('Could not save this image. Please try again.','Impossibile salvare questa immagine. Riprova.'));}
}
on($('.save-strip'),'click',saveStrip);
cleanups.push(()=>{saveRequest++;clearTimeout(saveTimer);});
$('.retake').textContent=camText('Retake','Riscatta');
$('.strip-view').setAttribute('aria-label',camText('Your photo strip','Le tue foto'));
$('.shutter').setAttribute('aria-label',camText('Take photo strip','Scatta tre foto'));
resetSaveState();


// One control slot: camera permission first, then the actual three-photo action.
let cameraActionState='';
function syncBoothCameraAction(){
 const ready=Boolean(cameraSource()),shooting=boothPhase==='shooting',key=String(ready)+':'+String(shooting);
 if(cameraActionState===key)return;cameraActionState=key;
 const enable=$('.cam-enable'),shutter=$('.shutter');
 enable.hidden=ready;shutter.hidden=!ready;shutter.disabled=!ready||shooting;
 shutter.setAttribute('aria-busy',String(shooting));
 $('.shutter-label').textContent=shooting?camText('Taking photos…','Scatto in corso…'):camText('Take photos','Scatta foto');
}
cameraControls();syncBoothCameraAction();$('.guide').textContent=camText('Three poses. One little memory.','Tre pose. Un piccolo ricordo.');on($('.shutter'),'click',()=>{if(boothPhase!=='ready'||!cameraSource())return;gesture();shots=[];wait=3;boothPhase='shooting';syncBoothCameraAction();state('shooting');});
on($('.retake'),'click',()=>{resetSaveState();gesture();$('.strip-view').hidden=true;boothPhase='ready';state('ready');});
function finishStrip(){const c=$('.strip'),x=c.getContext('2d');x.setTransform(2,0,0,2,0,0);x.fillStyle='#fffdf3';x.fillRect(0,0,360,1050);shots.forEach((p,i)=>{x.save();x.filter='grayscale(1) contrast(1.1)';x.drawImage(p,20,20+i*316,320,300);x.restore();});x.strokeStyle='#262323';x.lineWidth=2;x.strokeRect(9,9,342,1032);text(x,'GOOD LITTLE MOMENTS',180,989,14,'#292724','UIBody');text(x,new Date().toLocaleDateString(camItalian?'it-IT':'en-US',{month:'short',day:'numeric',year:'numeric'}),180,1015,11,'#666','UIBody');printBoothDoodle(x,'fish',42,991,1.2);printBoothDoodle(x,'face',321,996,1.05);resetSaveState();$('.strip-view').hidden=false;boothPhase='result';state('result');success();}
loop(dt=>{
 syncBoothCameraAction();
 paintCamera($('.live-booth canvas'),'#eee9dd');
 if(boothPhase==='shooting'){
  if(!cameraSource()){boothPhase='ready';shots=[];$('.countdown').textContent='';state('ready');return;}
  wait-=dt;$('.countdown').textContent=wait>0?Math.ceil(wait):'';
  if(wait<=0){const photo=takePhoto(640,600);if(!photo)return;shots.push(photo);flash();sound(100,.08,.18,'triangle',60);root.dataset.shots=shots.length;if(shots.length===3)finishStrip();else wait=2.2;}
 }
});state('ready');

configure(()=>{paintPaperBackdrop();if($('.guide')){const copy=String(setting('GUIDE',"Three poses. One little memory."));$('.guide').textContent=copy==='Three poses. One little memory.'?camText(copy,'Tre pose. Un piccolo ricordo.'):copy;}});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n\n.booth-label{top:30px;font-size:24px;line-height:1.3}\n.guide{top:414px;font:400 18px/1.4 UIBody,system-ui,sans-serif}\n.shutter{bottom:100px;min-height:52px}\n.cam-status{top:78px;bottom:auto;font-size:12px;color:#655e50}\n.strip-view{inset:30px 30px 50px;flex-direction:column;gap:14px}\n.strip-view canvas{max-height:calc(100% - 68px);height:auto;max-width:100%;width:auto}\n.retake{position:static;min-height:44px;flex:none;margin:0}\n";
  document.head.append(uiStyle);
})();
