// Edizione italiana separata: logica, tempistiche e risorse del gioco originali.
document.documentElement.lang="it";
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
function resultMarkup(label="Rigioca"){return `<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${label}</button></section></div>`;}
function flash(){const e=$('.flash');if(!e)return;e.classList.remove('fire');void e.offsetWidth;e.classList.add('fire');}
const lifecycle=[];
function setActive(next){active=next;if(!next)audio?.suspend().catch(()=>{});for(const fn of lifecycle)fn(next);}
on(window,'message',e=>{if(e.source===parent&&e.data?.type==='playable-active')setActive(e.data.active===true);});
on(document,'visibilitychange',()=>{setActive(!document.hidden);});
on(window,'pagehide',()=>{disposed=true;listeners.splice(0).forEach(off=>off());cleanups.splice(0).forEach(fn=>fn());audio?.close().catch(()=>{});});
const configValues={};
function setting(id,fallback){return configValues[id]??fallback;}
async function configure(callback=()=>{}){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),1600);try{const r=await fetch('./game.config.json',{signal:ctl.signal});if(!r.ok)throw Error("Configurazione non disponibile");const c=await r.json();for(const group of ['texts','tweaks','images'])for(const v of c[group]||[])configValues[v.id]=group==='images'?v.path:v.value;for(const binding of assetImages){const path=assetPath(binding.path);if(binding.im.getAttribute('src')!==path)binding.im.src=path;}for(const im of root.querySelectorAll('img[src^="./assets/"]'))im.src=assetPath(im.getAttribute('src'));callback();root.dataset.config='loaded';}catch(_){root.dataset.config='defaults';}finally{clearTimeout(timer);}}

// Real camera frames only. Never substitute a sample portrait for the user.
let camStream=null,camFacing='user',camPending=false,camRequest=0,camReady=false;
const camItalian=true;
const camText=(en,it)=>camItalian?it:en;
function cameraSource(){
 const v=$('video.preview');
 return camReady&&camStream?.getVideoTracks().some(t=>t.readyState==='live'&&t.enabled)&&v?.readyState>=2&&v.videoWidth>0&&v.videoHeight>0?v:null;
}
function cameraUI(kind,message){
 root.dataset.camera=kind;
 const status=$('.cam-status'),button=$('.cam-enable');
 if(status)status.textContent=message;
 if(button){button.disabled=false;button.setAttribute('aria-pressed',String(kind==='enabled'));button.textContent=camPending?camText("Connessione… · Annulla",'Connessione… · Annulla'):kind==='enabled'?camText("Fotocamera attiva · Interrompi","Fotocamera attiva · Interrompi"):camText("Attiva fotocamera",'Attiva fotocamera');}
 for(const b of root.querySelectorAll('.shutter,.cam-capture'))b.disabled=!cameraSource();
 syncMemeCameraControls();
}
function stopCamera(){
 camRequest++;camReady=false;camPending=false;
 const old=camStream;camStream=null;old?.getTracks().forEach(t=>t.stop());
 const v=$('video.preview');if(v){v.pause();v.srcObject=null;}
 cameraUI('idle',camText("Attiva la fotocamera per scattare una foto",'Attiva la fotocamera per scattare una foto'));
}
async function startCamera(){
 if(camPending)return;
 stopCamera();const request=++camRequest;camPending=true;
 cameraUI('requesting',camText("In attesa della fotocamera…",'In attesa della fotocamera…'));
 let stream;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error("Fotocamera non disponibile");
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:camFacing}},audio:false});
  if(disposed||!active||request!==camRequest){stream.getTracks().forEach(t=>t.stop());return;}
  camStream=stream;const v=$('video.preview');v.muted=true;v.playsInline=true;v.srcObject=stream;
  let playbackTimeout;try{await Promise.race([v.play(),new Promise((resolve,reject)=>{playbackTimeout=setTimeout(()=>reject(Error("La fotocamera non si è avviata")),7000);})]);}finally{clearTimeout(playbackTimeout);}
  await new Promise((resolve,reject)=>{
   let timer;
   const cleanup=()=>{clearTimeout(timer);v.removeEventListener('loadeddata',ready);v.removeEventListener('canplay',ready);};
   const ready=()=>{if(v.readyState>=2&&v.videoWidth>0&&v.videoHeight>0){cleanup();resolve();}};
   v.addEventListener('loadeddata',ready);v.addEventListener('canplay',ready);
   timer=setTimeout(()=>{cleanup();reject(Error("Nessuna immagine ricevuta dalla fotocamera"));},7000);ready();
  });
  if(disposed||!active||request!==camRequest){stream.getTracks().forEach(t=>t.stop());return;}
  camReady=true;camPending=false;
  for(const track of stream.getVideoTracks())on(track,'ended',()=>{if(camStream!==stream)return;stopCamera();cameraUI('unavailable',camText("Fotocamera scollegata · riprova",'Fotocamera scollegata · riprova'));});
  cameraUI('enabled',camText("Fotocamera pronta · scatta una foto",'Fotocamera pronta · scatta una foto'));
 }catch(error){
  stream?.getTracks().forEach(t=>t.stop());if(request!==camRequest)return;
  stopCamera();const denied=error?.name==='NotAllowedError'||error?.name==='SecurityError';
  cameraUI('unavailable',denied?camText("Accesso alla fotocamera bloccato · consenti e riprova",'Accesso alla fotocamera bloccato · consenti e riprova'):camText("Nessuna immagine dalla fotocamera · riprova",'Nessuna immagine dalla fotocamera · riprova'));
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
 x.fillStyle='#68645b';x.font=`500 ${Math.max(15,w/23)}px UIBody,Arial`;x.textAlign='center';x.textBaseline='middle';x.fillText(camPending?camText("Connessione…",'Connessione…'):camText("La tua fotocamera",'La tua fotocamera'),w/2,h/2+Math.min(w,h)*.25);
}
function cameraControls(){
 $('video.preview')?.setAttribute('aria-hidden','true');
 const style=document.createElement('style');style.textContent='.preview{display:block!important;position:absolute!important;width:1px!important;height:1px!important;left:0;bottom:0;opacity:.001;pointer-events:none}.cam-enable[aria-pressed="true"]{border-color:#47754b;background:#edf5e9;color:#315b35}';document.head.append(style);
 on($('.cam-enable'),'click',()=>{unlockAudio();if(camStream||camPending)stopCamera();else startCamera();});
 if($('.cam-flip'))on($('.cam-flip'),'click',()=>{camFacing=camFacing==='user'?'environment':'user';stopCamera();startCamera();});
 lifecycle.push(next=>{if(!next)stopCamera();});cleanups.push(stopCamera);cameraUI('idle',camText("Attiva la fotocamera per scattare una foto",'Attiva la fotocamera per scattare una foto'));
}

// Full-bleed print-paper stays attached to the viewport, not the fitted game stage.
function paintPaperBackdrop(){
 const path=String(setting('PAPER_BACKDROP','./assets/paper-print-v1.svg'));
 root.style.backgroundColor='#e9e0c7';
 root.style.backgroundImage='url('+JSON.stringify(path)+')';
 root.style.backgroundSize='256px 256px';
 root.style.backgroundRepeat='repeat';
}
function installPrintedPaper(){
 paintPaperBackdrop();
 const style=document.createElement('style');
 style.textContent=`#root{position:relative;isolation:isolate;color:#282723}
 #root .fit{background:transparent!important}
 #root .paper-overlay{position:absolute;inset:0;z-index:40;background:#28272338;pointer-events:auto;isolation:isolate}
 #root .paper-overlay[hidden]{display:none!important}
 #root .paper-result-fit{position:absolute;width:390px;height:598px;transform-origin:0 0;font-family:UIBody,system-ui,sans-serif;pointer-events:auto}
 #root .paper-result-fit .modal{background:transparent}
 #root .result,#root .comparison,#root .strip-view{background:#fbf7e9;color:#282723;border:2px solid #282723;border-radius:12px;box-shadow:4px 5px 0 #28272322}
 #root .pill{background:#282723;color:#fff9e9;border:2px solid #282723;box-shadow:0 3px 0 #28272325}
 #root .capability,#root .stop-sugar{color:#282723;background:#fbf7e9;border:2px solid #282723;box-shadow:0 2px 0 #2827231c}
 #root .capability:disabled,#root .pill:disabled{box-shadow:none}
 #root .shutter{border-color:#282723;background:#fbf7e9}
 #root .eyebrow,#root .booth-label,#root .guide{color:#282723}
 #root .cam-status,#root .mic-status,#root .target-label{color:#625c4b}
 #root .pose-pair .meme-reference,#root .pose-pair .live{border:2px solid #282723;border-radius:7px;box-shadow:3px 4px 0 #2827231e}#root .shutter{box-shadow:inset 0 0 0 5px #e9e0c7}#root .pair canvas,#root .pair img{border:1px solid #28272340;border-radius:3px}`;
 document.head.append(style);
 const fit=root.querySelector('.fit');
 const panel=fit.querySelector('.comparison,.strip-view,.modal');
 if(!panel)return;
 // Reuse the existing card and its exact390×598 measurements inside a viewport-wide scrim.
 const overlay=document.createElement('div'),frame=document.createElement('div');
 overlay.className='paper-overlay';frame.className='paper-result-fit';
 overlay.hidden=panel.hidden;frame.append(panel);overlay.append(frame);root.append(overlay);
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
 function sync(){overlay.hidden=panel.hidden;fit.inert=!panel.hidden;}
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

mount(`body{color:#292922}.fit{background:#e6e4dc}.eyebrow{position:absolute;top:58px;width:100%;text-align:center;letter-spacing:2.5px;font-size:10px}.meme-reference{position:absolute;left:78px;top:95px;width:234px;height:165px;object-fit:cover;border:8px solid #faf9f1;box-shadow:0 2px 7px #4442;transform:rotate(-3deg)}.live{position:absolute;left:78px;top:294px;width:234px;height:160px;border:8px solid #faf9f1;box-shadow:0 2px 7px #4442;transform:rotate(2deg);background:#d2cfc4;overflow:hidden}.live canvas{width:100%;height:100%;object-fit:cover}.preview{display:none}.guide{top:272px;font-size:16px}.shutter{position:absolute;left:168px;top:480px;border:3px solid #292922;background:#fff;width:54px;height:54px;border-radius:50%;box-shadow:inset 0 0 0 5px #e6e4dc}.cam-status{bottom:122px;font-size:11px}.bottom{bottom:18px}.comparison{position:absolute;inset:80px 30px 105px;z-index:15;background:#f9f7ef;padding:22px 14px;box-shadow:0 4px 20px #0002;text-align:center}.comparison[hidden]{display:none}.comparison h2{font-size:24px;margin:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:24px 0}.pair canvas,.pair img{width:100%;height:205px;object-fit:cover}.pair small{display:block;text-transform:uppercase;letter-spacing:2px;font-size:9px;margin:8px}.countdown{position:absolute;top:350px;width:100%;text-align:center;z-index:12;font-size:60px;font-weight:800;color:white;text-shadow:0 2px 5px #0008}`,`<div class="guide">Imita l’espressione</div><div class="pose-pair"><div class="meme-photo-frame meme-reference-frame" data-focal="wet-kitty"><img class="meme-reference" alt="Espressione da imitare" src="./assets/meme-4.png"></div><div class="live"><canvas class="selfie" width="400" height="400"></canvas><div class="countdown"></div></div></div><video class="preview" playsinline autoplay muted></video><div class="status cam-status" role="status" aria-live="polite" hidden></div><div class="bottom"><button class="capability cam-enable">Attiva fotocamera</button><button class="shutter" aria-label="Scatta foto" hidden disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/></svg><span class="shutter-label">Scatta foto</span></button></div><section class="comparison" hidden aria-label="Risultato del confronto" aria-describedby="meme-result-description"><div class="match-summary"><div class="match-value" data-ready="false" aria-live="polite" aria-atomic="true"><strong class="match-number">—</strong><span class="match-percent-sign">%</span></div><p class="match-label" id="meme-result-description">La tua versione del meme.</p></div><div class="pair"><div><div class="meme-photo-frame meme-result-frame" data-focal="wet-kitty"><img alt="Espressione originale"></div></div><div><canvas width="320" height="320" aria-label="La foto che hai scattato"></canvas></div></div><button class="pill next">Avanti</button></section><div class="flash"></div>`,'#e6e4dc');
installPrintedPaper();
// A playful pixel-based comparison, not face identification or emotion recognition.
function memeImageFeatures(data,width=32,height=32){
 const count=width*height,gray=new Float64Array(count),colors=new Float64Array(12),blocks=new Float64Array(64),blockCounts=new Uint16Array(64),edges=new Float64Array(64);
 let mean=0,squares=0;
 for(let i=0;i<count;i++){
  const r=data[i*4],g=data[i*4+1],b=data[i*4+2],value=.2126*r+.7152*g+.0722*b;
  gray[i]=value;mean+=value;squares+=value*value;
  colors[Math.min(3,r>>6)]+=1/count;colors[4+Math.min(3,g>>6)]+=1/count;colors[8+Math.min(3,b>>6)]+=1/count;
  const x=i%width,y=Math.floor(i/width),block=Math.floor(y*8/height)*8+Math.floor(x*8/width);blocks[block]+=value;blockCounts[block]++;
 }
 mean/=count;const deviation=Math.sqrt(Math.max(0,squares/count-mean*mean));let blockSquares=0;
 for(let i=0;i<64;i++){blocks[i]/=Math.max(1,blockCounts[i]);blockSquares+=(blocks[i]-mean)**2;}
 const blockDeviation=Math.max(6,Math.sqrt(blockSquares/64));
 for(let i=0;i<64;i++)blocks[i]=Math.max(-2.5,Math.min(2.5,(blocks[i]-mean)/blockDeviation));
 for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
  const i=y*width+x,dx=gray[i+1]-gray[i-1],dy=gray[i+width]-gray[i-width],magnitude=Math.hypot(dx,dy);
  const angle=(Math.atan2(dy,dx)+Math.PI)%Math.PI,bin=Math.min(3,Math.floor(angle/Math.PI*4));
  const cell=Math.floor(y*4/height)*4+Math.floor(x*4/width);edges[cell*4+bin]+=magnitude;
 }
 return{mean,deviation,blocks,edges,colors};
}
function memeVisualSimilarity(a,b){
 const tone=Math.max(0,1-Math.abs(a.mean-b.mean)/255);let color=0;
 for(let i=0;i<12;i++)color+=Math.min(a.colors[i],b.colors[i]);color/=3;
 if(a.deviation<4&&b.deviation<4)return Math.round(100*(.6*tone+.4*color));
 if(a.deviation<4||b.deviation<4)return Math.round(100*(.25*tone+.15*color));
 let difference=0,dot=0,aa=0,bb=0;
 for(let i=0;i<64;i++){difference+=Math.abs(a.blocks[i]-b.blocks[i]);dot+=a.edges[i]*b.edges[i];aa+=a.edges[i]**2;bb+=b.edges[i]**2;}
 const structure=Math.max(0,1-difference/128),edge=aa&&bb?Math.min(1,dot/Math.sqrt(aa*bb)):0;
 return Math.round(100*Math.max(0,Math.min(1,(.65*structure+.25*edge+.10*color)*(.75+.25*tone))));
}
function analyseMemeImage(source){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
 const context=canvas.getContext('2d',{willReadFrequently:true});
 if(source.dataset?.memeFocal==='wet-kitty'){
  const width=source.naturalWidth||source.width,height=source.naturalHeight||source.height;
  if(!width||!height)throw Error('Image not ready');
  context.drawImage(source,0,height*25/640,width*360/594,height*360/640,0,0,32,32);
 }else if(!cover(context,source,0,0,32,32))throw Error('Image not ready');
 return memeImageFeatures(context.getImageData(0,0,32,32).data);
}
let memeMatchRequest=0;
async function showMemeMatch(photo,reference){
 const request=++memeMatchRequest,value=$('.match-value'),number=$('.match-number'),label=$('.match-label');
 value.dataset.ready='false';number.textContent='—';label.textContent=camText("La tua versione del meme.",'La tua versione del meme.');delete root.dataset.matchScore;
 try{
  if(!reference.complete||!reference.naturalWidth){if(typeof reference.decode==='function')await reference.decode();else throw Error("L’immagine di riferimento si sta caricando");}
  const score=memeVisualSimilarity(analyseMemeImage(photo),analyseMemeImage(reference));
  if(request!==memeMatchRequest||!taken)return;
  number.textContent=String(score);value.dataset.ready='true';root.dataset.matchScore=String(score);
 }catch(_){if(request===memeMatchRequest)label.textContent=camText("Riprova il confronto con un’altra foto.",'Riprova il confronto con un’altra foto.');}
}
function installMemeComparison(){
 const style=document.createElement('style');
 style.textContent=`#root .comparison{left:30px;right:30px;top:50%;bottom:auto;transform:translateY(-50%);width:auto;max-height:calc(100% - 80px);padding:22px 18px;display:flex;flex-direction:column;align-items:stretch;gap:16px;overflow-y:auto;text-align:center}
 #root .comparison[hidden]{display:none!important}
 #root .comparison .match-summary{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}
 #root .comparison .match-value{white-space:nowrap;font:700 52px/1 UIBody,system-ui,sans-serif;letter-spacing:-2px;font-variant-numeric:tabular-nums}
 #root .comparison .match-percent-sign{font-size:26px;letter-spacing:0;margin-left:1px}
 #root .comparison .match-value[data-ready="false"] .match-percent-sign{visibility:hidden}
 #root .comparison .match-label{max-width:100%;margin:0;text-align:center;font:400 16px/1.4 UIBody,system-ui,sans-serif;text-wrap:balance;overflow-wrap:anywhere}
 #root .comparison .pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin:0}
 #root .comparison .pair>div{min-width:0}
 #root .comparison .pair img,#root .comparison .pair canvas{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:cover}
 #root .comparison .next{align-self:center;min-width:180px;max-width:100%;min-height:44px;margin:0;padding:10px 20px;white-space:normal}`;
 document.head.append(style);cleanups.push(()=>style.remove());
 $('.match-label').textContent=camText("La tua versione del meme.",'La tua versione del meme.');
 $('.comparison .next').textContent=camText("Avanti",'Avanti');
}


function installMemeCameraCopy(){
 const fit=$('.fit'),status=$('.cam-status');
 const style=document.createElement('style');
 style.textContent=`#root .fit>.guide{position:absolute;top:30px;left:30px;right:30px;width:auto;margin:0;text-align:center;font:600 18px/1.4 Playful,UIBody,sans-serif}
 #root .pose-pair{grid-template-rows:repeat(2,minmax(0,1fr))}
 #root .cam-status{top:62px;bottom:auto;left:30px;right:30px;margin:0;font:400 12px/1.3 UIBody,system-ui,sans-serif}
 #root .cam-status[hidden]{display:none!important}#root .fit.camera-copy-error .pose-pair{top:110px}`;
 document.head.append(style);cleanups.push(()=>style.remove());
 $('.guide').textContent=camText("Imita l’espressione",'Imita l’espressione');
 function sync(){const error=root.dataset.camera==='unavailable';status.hidden=!error;if(!error)status.textContent='';fit.classList.toggle('camera-copy-error',error);}
 const observer=new MutationObserver(sync);observer.observe(root,{attributes:true,attributeFilter:['data-camera']});cleanups.push(()=>observer.disconnect());sync();
}

installMemeCameraCopy();installMemeComparison();
let expression=0,countdown=-1,taken=false;
function syncMemeCameraControls(){
 const ready=Boolean(cameraSource()),enable=$('.cam-enable'),shutter=$('.shutter');
 if(!enable||!shutter)return;
 enable.hidden=ready;shutter.hidden=!ready;shutter.disabled=!ready||countdown>=0||taken;
 const label=camText("Scatta foto",'Scatta foto'),copy=$('.shutter-label');
 if(copy&&copy.textContent!==label)copy.textContent=label;
 if(shutter.getAttribute('aria-label')!==label)shutter.setAttribute('aria-label',label);
}
const memeTargets=['./assets/meme-4.png','./assets/meme-1.webp','./assets/meme-2.webp','./assets/meme-3.webp'];
const portraits=memeTargets.map(path=>image(path));
portraits[0].dataset.memeFocal='wet-kitty';
function syncMemeReference(){
 const focal=expression===0?'wet-kitty':'none',reference=$('.meme-reference'),resultReference=$('.pair img');
 reference.src=portraits[expression].src;resultReference.src=portraits[expression].src;
 for(const frame of root.querySelectorAll('.meme-photo-frame'))frame.dataset.focal=focal;
 root.dataset.expression=memeTargets[expression];root.dataset.expressionCount=String(portraits.length);
}
syncMemeReference();
cameraControls();
on($('.shutter'),'click',()=>{if(taken||countdown>=0||!cameraSource())return;gesture();countdown=3;syncMemeCameraControls();state('countdown');sound(550,.06,.12);});
on($('.next'),'click',()=>{gesture();memeMatchRequest++;expression=(expression+1)%portraits.length;taken=false;$('.comparison').hidden=true;syncMemeReference();syncMemeCameraControls();state('ready');});
loop(dt=>{
 syncMemeCameraControls();
 paintCamera($('.selfie'),'#f0ede5');
 if(countdown>=0){
  if(!cameraSource()){countdown=-1;$('.countdown').textContent='';state('ready');return;}
  const old=Math.ceil(countdown);countdown-=dt;$('.countdown').textContent=countdown>0?Math.ceil(countdown):'';
  if(Math.ceil(countdown)<old&&countdown>0)sound(550,.05,.1);
  if(countdown<=0){countdown=-1;const photo=takePhoto(320,320);if(!photo)return;taken=true;flash();sound(120,.08,.18,'triangle',70);$('.pair canvas').getContext('2d').drawImage(photo,0,0);syncMemeReference();$('.comparison').hidden=false;showMemeMatch(photo,portraits[expression]);$('.next').focus({preventScroll:true});state('comparison');}
 }
});state('ready');

configure(()=>{paintPaperBackdrop();syncMemeReference();if($('.guide')){const copy=String(setting('GUIDE',"Imita l’espressione"));$('.guide').textContent=["Imita l’espressione","Imita l’espressione · scatta un selfie","Imita l’espressione · scatta un selfie"].includes(copy)?camText("Imita l’espressione",'Imita l’espressione'):copy;}});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n\n.eyebrow{top:30px;font-size:12px;line-height:1.4;letter-spacing:2px}\n.meme-reference{top:90px;height:150px}\n.guide{top:249px;font-size:18px;line-height:1.4}\n.live{top:283px;height:153px}\n.shutter{top:450px;width:50px;height:50px;left:170px}\n.cam-status{top:62px;bottom:auto;font-size:12px;color:#655f54;line-height:1.4}\n.comparison{inset:30px 30px 50px;padding:26px 18px;overflow:auto;border-radius:16px}\n.comparison h2{font:600 24px/1.3 Playful,UIBody,sans-serif;margin:10px 0 16px}\n.pair{gap:12px;margin:18px 0 24px}.pair canvas,.pair img{height:220px}\n.pair small{font-size:12px;letter-spacing:1px;margin:8px 0}\n";
  document.head.append(uiStyle);
})();

// Square reference/camera cards; keep controls in a single non-overlapping row.
(()=>{const style=document.createElement('style');style.textContent='.pose-pair{position:absolute;left:30px;right:30px;top:88px;bottom:128px;display:grid;grid-template-rows:minmax(0,1fr) auto minmax(0,1fr);justify-items:center;gap:10px}.pose-pair .meme-reference,.pose-pair .live{position:relative;inset:auto;display:block;width:auto;height:100%;max-width:100%;aspect-ratio:1;border:0;border-radius:8px;object-fit:cover;transform:none;box-shadow:0 2px 7px #4442}.pose-pair .live canvas{width:100%;height:100%;object-fit:cover}.pose-pair .guide{position:static;inset:auto;width:100%;margin:0;font-size:17px;line-height:1.35}.live .countdown{position:absolute;inset:0;display:grid;place-items:center;font-size:54px;pointer-events:none}.bottom{bottom:50px;gap:0;min-height:48px;justify-content:center}#root .bottom .shutter,#root .bottom .cam-enable{position:static;inset:auto;flex:0 1 230px;width:230px;max-width:100%;height:auto;min-height:48px;margin:0;padding:10px 18px;font-size:16px;line-height:1.3}#root .bottom .shutter{display:flex;align-items:center;justify-content:center;gap:10px;border:2px solid #282723;border-radius:24px;box-shadow:0 2px 0 #2827231c;background:#fbf7e9;color:#282723}#root .bottom .shutter svg{width:22px;height:22px;flex:none}#root .bottom [hidden]{display:none!important}.cam-status{top:54px;font-size:12px;line-height:1.3}.pair canvas,.pair img{height:auto;aspect-ratio:1;object-fit:cover}';document.head.append(style);})();

// User-supplied fourth expression: keep the original PNG and frame its face in UI.
// The same normalized source rectangle is used by the reference, result and analysis.
(() => {
 const style=document.createElement('style');
 style.textContent=`
 #root .pose-pair{grid-template-rows:repeat(2,minmax(0,1fr))}
 #root .meme-photo-frame{position:relative;overflow:hidden;isolation:isolate;background:#e9e0c7}
 #root .pose-pair>.meme-reference-frame{display:block;position:relative;inset:auto;width:auto;height:100%;max-width:100%;aspect-ratio:1;border:2px solid #282723;border-radius:7px;box-shadow:3px 4px 0 #2827231e;transform:none}
 #root .comparison .meme-result-frame{display:block;width:100%;height:auto;aspect-ratio:1;border:1px solid #28272340;border-radius:3px}
 #root .meme-photo-frame>img{position:absolute!important;inset:0!important;display:block!important;width:100%!important;height:100%!important;max-width:none!important;aspect-ratio:auto!important;border:0!important;border-radius:0!important;box-shadow:none!important;transform:none!important;object-fit:cover!important}
 #root .meme-photo-frame[data-focal="wet-kitty"]>img{inset:auto!important;left:0!important;top:-6.9444444444%!important;width:165%!important;height:177.7777777778%!important;object-fit:fill!important}
 `;
 document.head.append(style);
})();
