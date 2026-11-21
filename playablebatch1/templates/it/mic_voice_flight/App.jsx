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
function cover(ctx,im,x,y,w,h){if(!im||!im.width)return;const iw=im.videoWidth||im.width,ih=im.videoHeight||im.height;if(!iw||!ih)return;const scale=Math.max(w/iw,h/ih);ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.drawImage(im,x+(w-iw*scale)/2,y+(h-ih*scale)/2,iw*scale,ih*scale);ctx.restore();}
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

// W3C microphone input per the supplied H5 SDK; no recording or uploads.
let micStream=null,micContext=null,micAnalyser=null,micBuffer=null,micRequested=false,manualVoice=false,voiceControlMode='';
let voiceChoiceRefresh=()=>{};
function stopMic(){micStream?.getTracks().forEach(t=>t.stop());micStream=null;micContext?.close().catch(()=>{});micContext=micAnalyser=micBuffer=null;micRequested=false;}
async function enableMic(){if(micRequested)return;micRequested=true;try{if(!navigator.mediaDevices?.getUserMedia)throw Error("Microfono non disponibile");micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false}});if(disposed||!active||voiceControlMode==='hold'){stopMic();return;}micContext=new (window.AudioContext||window.webkitAudioContext)();await micContext.resume();const source=micContext.createMediaStreamSource(micStream);micAnalyser=micContext.createAnalyser();micAnalyser.fftSize=1024;source.connect(micAnalyser);micBuffer=new Float32Array(micAnalyser.fftSize);$('.mic-enable').textContent="Mic attivo";$('.mic-status').textContent="In ascolto · puoi anche tenere premuto o usare Spazio";root.dataset.microphone='enabled';}catch(_){micRequested=false;$('.mic-enable').textContent="Attiva microfono";$('.mic-status').textContent="Microfono non disponibile · tieni premuto per giocare";root.dataset.microphone='unavailable';}}
function voice(){if(manualVoice)return .9;if(!micAnalyser||!active)return 0;micAnalyser.getFloatTimeDomainData(micBuffer);let sum=0;for(const n of micBuffer)sum+=n*n;return clamp((Math.sqrt(sum/micBuffer.length)-.012)*14,0,1);}
function micControls(){on($('.mic-enable'),'click',()=>{unlockAudio();enableMic();});const hold=$('.voice-hold');on(hold,'pointerdown',e=>{e.preventDefault();gesture();selectVoiceControl('hold');manualVoice=true;hold.setPointerCapture(e.pointerId);});for(const type of ['pointerup','pointercancel','lostpointercapture'])on(hold,type,()=>manualVoice=false);on(window,'keydown',e=>{if(e.code==='Space'&&!e.repeat){e.preventDefault();gesture();selectVoiceControl('hold');manualVoice=true;}});on(window,'keyup',e=>{if(e.code==='Space')manualVoice=false;});lifecycle.push(next=>{if(!next){manualVoice=false;micContext?.suspend().catch(()=>{});if(micStream)for(const t of micStream.getTracks())t.enabled=false;}else{micContext?.resume().catch(()=>{});if(micStream)for(const t of micStream.getTracks())t.enabled=true;}});cleanups.push(stopMic);installVoiceControlChoice();}
function micMarkup(action="Tieni premuto"){return `<div class="status mic-status" hidden></div><div class="bottom"><button class="capability mic-enable">Attiva microfono</button><button class="capability voice-hold">${action}</button></div>`;}


// Keep the chosen input in one centered slot; a failed/stopped microphone restores fallback.
function selectVoiceControl(mode){
 voiceControlMode=mode;
 if(mode==='hold'&&(micStream||micRequested))stopMic();
 voiceChoiceRefresh();
}
function installVoiceControlChoice(){
 const mic=$('.mic-enable'),hold=$('.voice-hold'),bar=mic.parentElement,status=$('.mic-status');
 const italian=true;
 const style=document.createElement('style');
 style.textContent='#root .bottom.voice-mode-selected{display:flex!important;justify-content:center!important;align-items:center!important}#root .bottom.voice-mode-selected>.capability{flex:0 1 auto!important;width:auto!important;min-width:150px;max-width:260px}#root .bottom>.capability[hidden]{display:none!important}';
 document.head.append(style);
 function renderChoice(){
  if(disposed)return;
  mic.hidden=voiceControlMode==='hold';hold.hidden=voiceControlMode==='voice';
  bar.classList.toggle('voice-mode-selected',Boolean(voiceControlMode));
  root.dataset.voiceControl=voiceControlMode||'choice';
  if(voiceControlMode==='hold'){status.textContent='';status.hidden=true;}
 }
 voiceChoiceRefresh=renderChoice;
 // Runs before the recording controller's capture-phase permission handler.
 on(mic,'click',()=>selectVoiceControl('voice'),{capture:true});
 const observer=new MutationObserver(()=>{
  const state=root.dataset.microphone;
  if(voiceControlMode==='voice'&&['unavailable','error','off'].includes(state))voiceControlMode='';
  if(voiceControlMode==='hold'&&micStream)stopMic();
  renderChoice();
 });
 observer.observe(root,{attributes:true,attributeFilter:['data-microphone']});
 cleanups.push(()=>observer.disconnect());renderChoice();
}

// Enhances the existing microphone helper; capture is analyzed live, never recorded or stored.
function installMicrophoneRecordingControl(){
 const button=$('.mic-enable'),status=$('.mic-status');
 const language=new URLSearchParams(location.search).get('lang')||document.documentElement.lang||'en';
 const italian=true;
 const copy=italian?{
  idle:'Mic spento',requesting:'Connessione…',active:'Mic attivo',paused:'Mic in pausa',
  start:'Attiva microfono',stop:'Disattiva microfono',listening:'',
  fallback:'',unavailable:'Non disponibile · usa il pulsante'
 }:{
  idle:"Mic spento",requesting:"Connessione…",active:"Mic attivo",paused:"Mic in pausa",
  start:"Attiva microfono",stop:"Disattiva microfono",listening:'',
  fallback:'',unavailable:"Microfono non disponibile · tieni premuto per giocare"
 };
 const style=document.createElement('style');
 style.textContent='.bottom .capability.mic-enable{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;flex:1 1 174px}.mic-enable .mic-icon{width:18px;height:18px;flex:none}.mic-enable .mic-record-dot{width:10px;height:10px;flex:none;background:currentColor;border-radius:50%}.bottom .capability.mic-enable.is-listening{background:#d94646;border-color:#d94646;color:#fff;box-shadow:0 2px 8px #bd333326}.mic-enable .mic-button-label{white-space:nowrap}';
 document.head.append(style);
 let pending=false,unavailable=false,lastState='',boundStream=null,boundContext=null;
 function listening(){
  const tracks=micStream?.getAudioTracks?.()||[];
  return active&&!!micAnalyser&&micContext?.state==='running'&&tracks.some(track=>track.readyState==='live'&&track.enabled&&!track.muted);
 }
 function refresh(){
  if(disposed)return;
  const onAir=listening(),hasStream=!!micStream?.getAudioTracks?.().some(track=>track.readyState==='live');
  const state=pending?'requesting':onAir?'active':hasStream?'paused':unavailable?'unavailable':'idle';
  button.disabled=pending;button.setAttribute('aria-pressed',String(onAir));button.classList.toggle('is-listening',onAir);
  button.setAttribute('aria-label',hasStream?copy.stop:copy.start);button.dataset.micState=state;
  root.dataset.microphone=onAir?'enabled':state==='idle'?'off':state;
  if(state!==lastState){
   const icon=onAir?'<span class="mic-record-dot" aria-hidden="true"></span>':'<svg class="mic-icon" viewBox="0 0 16 16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="M6 1h4v1h1v7h-1v1H6V9H5V2h1zM3 7h1v3h1v1h6v-1h1V7h1v4h-1v1H9v2h3v1H4v-1h3v-2H4v-1H3z"/></svg>';
   const label=pending?copy.requesting:onAir?copy.active:hasStream?copy.paused:copy.idle;
   button.innerHTML=icon+'<span class="mic-button-label">'+label+'</span>';
   status.textContent=onAir?copy.listening:unavailable?copy.unavailable:copy.fallback;
   lastState=state;
  }
 }
 function bindState(){
  if(micStream&&boundStream!==micStream){
   boundStream=micStream;
   for(const track of micStream.getAudioTracks()){
    on(track,'ended',()=>{stopMic();unavailable=false;refresh();});
    on(track,'mute',refresh);on(track,'unmute',refresh);
   }
  }
  if(micContext&&boundContext!==micContext){boundContext=micContext;on(micContext,'statechange',refresh);}
 }
 // Capture-phase handling replaces the original enable-only click behavior.
 on(button,'click',async event=>{
  event.preventDefault();event.stopImmediatePropagation();
  if(pending||disposed)return;
  if(micStream){stopMic();unavailable=false;refresh();return;}
  unlockAudio();unavailable=false;pending=true;refresh();
  await enableMic();
  pending=false;
  if(disposed||!active){stopMic();refresh();return;}
  if(!micStream||!micContext||!micAnalyser){stopMic();unavailable=true;}
  bindState();lastState='';refresh();
 },{capture:true});
 lifecycle.push(()=>{Promise.resolve().then(()=>{bindState();refresh();});});
 bindState();refresh();
}

// Keep the established 390 × 598 gameplay/UI transform, while painting
// the same scene across the actual host viewport instead of flat side gutters.
function fullBleedStageCanvas(){
 const canvas=$('canvas.stage'),ctx=canvas.getContext('2d'),fit=$('.fit');
 const bounds={left:0,top:0,right:390,bottom:598};
 root.style.position='relative';root.style.isolation='isolate';
 root.prepend(canvas);fit.style.background='transparent';fit.style.zIndex='1';
 Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',zIndex:'0',pointerEvents:'none'});
 function resizeScene(){
  const r=root.getBoundingClientRect();if(!r.width||!r.height)return;
  const d=Math.min(2,window.devicePixelRatio||1),s=Math.min(r.width/390,r.height/598);
  const x=(r.width-390*s)/2,y=(r.height-598*s)/2;
  const width=Math.round(r.width*d),height=Math.round(r.height*d);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  ctx.setTransform(d*s,0,0,d*s,d*x,d*y);ctx.imageSmoothingEnabled=false;
  Object.assign(bounds,{left:-x/s,top:-y/s,right:(r.width-x)/s,bottom:(r.height-y)/s});
  fit.style.transform=`translate(${x}px,${y}px) scale(${s})`;
 }
 resizeScene();on(window,'resize',resizeScene);
 if(typeof ResizeObserver!=='undefined'){
  const observer=new ResizeObserver(resizeScene);observer.observe(root);cleanups.push(()=>observer.disconnect());
 }
 return{canvas,ctx,bounds};
}

// One game-action guide; capability state is text only while permission/error needs it.
function installSingleGuideStatus(kind){
 const status=$(kind==='camera'?'.cam-status':'.mic-status');if(!status)return;
 const italian=true;
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 function refresh(){
  let message='';
  if(kind==='camera'){
   if(['requesting','unavailable'].includes(root.dataset.camera))message=status.textContent;
  }else{
   const state=$('.mic-enable')?.dataset.micState||root.dataset.microphone;
   if(state==='requesting')message=italian?'Consenti l’accesso al microfono':"Consenti l’accesso al microfono";
   else if(['unavailable','error'].includes(state))message=italian?'Microfono non disponibile':"Microfono non disponibile";
  }
  if(status.textContent!==message)status.textContent=message;
  const hidden=!message.trim();if(status.hidden!==hidden)status.hidden=hidden;
 }
 const textObserver=new MutationObserver(refresh);textObserver.observe(status,{childList:true,characterData:true,subtree:true});
 const stateObserver=new MutationObserver(refresh);stateObserver.observe(root,{attributes:true,attributeFilter:[kind==='camera'?'data-camera':'data-microphone']});
 const button=$('.mic-enable');if(button)stateObserver.observe(button,{attributes:true,attributeFilter:['data-mic-state']});
 refresh();cleanups.push(()=>{textObserver.disconnect();stateObserver.disconnect();});
}

mount(`.fit{background:#93c7c3}.guide{top:186px;font-family:Playful,Arial;color:#fff;text-shadow:0 2px #36776c80}.hud{color:#fff;font-family:Playful,Arial;text-shadow:0 3px #36776c80}.result{background:#fff0c8}.result h2{font-family:Playful,Arial}.result .value{color:#b46c38}.pill{background:#bc783e}.capability{color:#325b52;border-color:#59998d55}`,`<canvas class="stage" aria-label="Volo con la voce"></canvas><div class="hud center"><span class="score">0</span></div><div class="guide">Fai un suono per salire · taci per scendere</div>${micMarkup("Tieni per volare")}${resultMarkup()}`,'#93c7c3');
installSingleGuideStatus('microphone');
const {canvas,ctx,bounds}=fullBleedStageCanvas();let phase='ready',bird={y:300,v:0},pipes=[],flight=0,spawn=0,score=0,wing=0;
// Generated raster artwork is loaded once. Static layers are painted only when
// an image or the host viewport changes, not reconstructed on animation frames.
const flightArt={
 sky:image('./assets/pixel-v2/sky-hills.webp'),
 ground:image('./assets/pixel-v2/grass-ground.webp'),
 bird:image('./assets/pixel-v2/bird-flap.webp'),
 pipe:image('./assets/pixel-v2/garden-pipe.webp')
};
// Final source crop coordinates are filled after inspecting the approved assets.
const flightArtMetrics={
  "groundOpaqueY": 9,
  "groundBodyY": 26,
  "groundFill": "#c28b46",
  "birdPanelWidth": 110,
  "birdBodyDiameter": 42,
  "birdFrames": [
    {
      "eyeBox": [
        60,
        47,
        71,
        60
      ],
      "yellowBox": [
        35,
        38,
        74,
        76
      ],
      "anchorX": 55.5,
      "anchorY": 58.5,
      "bodyDiameter": 42
    },
    {
      "eyeBox": [
        61,
        47,
        72,
        60
      ],
      "yellowBox": [
        36,
        38,
        75,
        76
      ],
      "anchorX": 56.5,
      "anchorY": 58.5,
      "bodyDiameter": 42
    }
  ],
  "pipeCap": {
    "x": 0,
    "y": 0,
    "w": 52,
    "h": 23
  },
  "pipeBody": {
    "x": 7,
    "y": 28,
    "w": 39,
    "h": 16
  }
};
let flightArtRevision=0,flightLayerKey='',flightSkyLayer=null,flightGroundLayer=null;
Object.values(flightArt).forEach(im=>on(im,'load',()=>{flightArtRevision++;}));
const artReady=im=>im.complete&&im.naturalWidth>0;

function cachedFlightLayers(){
 const key=[canvas.width,canvas.height,bounds.left,bounds.top,bounds.right,bounds.bottom,flightArtRevision].join('/');
 if(key===flightLayerKey)return;
 flightLayerKey=key;
 const transform=ctx.getTransform();
 const layer=()=>{
  const im=document.createElement('canvas');im.width=canvas.width;im.height=canvas.height;
  const brush=im.getContext('2d');brush.setTransform(transform.a,transform.b,transform.c,transform.d,transform.e,transform.f);brush.imageSmoothingEnabled=false;
  return{im,brush};
 };
 const sky=layer(),ground=layer();flightSkyLayer=sky.im;flightGroundLayer=ground.im;
 const width=bounds.right-bounds.left;
 sky.brush.fillStyle='#39c5e7';sky.brush.fillRect(bounds.left,bounds.top,width,bounds.bottom-bounds.top);
 if(artReady(flightArt.sky)){
  const im=flightArt.sky,height=498-bounds.top;
  const scale=Math.max(width/im.naturalWidth,height/im.naturalHeight);
  const w=im.naturalWidth*scale,h=im.naturalHeight*scale;
  // Bottom-anchor the pixel hills to the unchanged ground line. Cover all
  // portrait host widths without introducing a separate edge/gutter color.
  sky.brush.drawImage(im,(bounds.left+bounds.right-w)/2,498-h,w,h);
 }
 const brush=ground.brush;
 brush.fillStyle=flightArtMetrics.groundFill;
 brush.fillRect(bounds.left,498,width,Math.max(0,bounds.bottom-498));
 if(artReady(flightArt.ground)){
  const im=flightArt.ground,tileWidth=256,scale=tileWidth/im.naturalWidth;
  const sourceOpaqueY=flightArtMetrics.groundOpaqueY,sourceBodyY=flightArtMetrics.groundBodyY;
  const y=498-sourceOpaqueY*scale,edgeHeight=sourceBodyY*scale,bodyTop=y+edgeHeight;
  brush.save();brush.beginPath();brush.rect(bounds.left,495,width,Math.max(0,bounds.bottom-495));brush.clip();
  // Crisp grass tips stay at495, with the opaque terrain band at498.
  // Repeat native-pixel terrain at a fixed scale; never stretch soil pixels vertically.
  for(let x=Math.floor(bounds.left/tileWidth)*tileWidth;x<bounds.right;x+=tileWidth){
   brush.drawImage(im,0,0,im.naturalWidth,sourceBodyY,x,y,tileWidth,edgeHeight);
   const sourceBodyHeight=im.naturalHeight-sourceBodyY,tileHeight=sourceBodyHeight*scale;
   for(let row=bodyTop;row<bounds.bottom;row+=tileHeight){
    const height=Math.min(tileHeight,bounds.bottom-row);
    brush.drawImage(im,0,sourceBodyY,im.naturalWidth,height/scale,x,row,tileWidth,height);
   }
  }
  brush.restore();
 }
}

function drawFlightLayer(layer){
 ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(layer,0,0);ctx.restore();
}

function drawPixelPipe(x,top,height,inverted=false){
 const im=flightArt.pipe;if(!artReady(im)||height<=0)return;
 const cap=flightArtMetrics.pipeCap,body=flightArtMetrics.pipeBody;
 if(!cap.w||!body.w)return;
 const capWidth=62,bodyWidth=54,capHeight=cap.h*capWidth/cap.w;
 const bodyScale=bodyWidth/body.w,bodyTop=Math.max(0,capHeight-2);
 const bodyHeight=Math.max(0,height-bodyTop);
 ctx.save();
 if(inverted){ctx.translate(x+27,top+height);ctx.scale(1,-1);ctx.translate(-27,0);}
 else ctx.translate(x,top);
 // A native-pixel shaft sample repeats; cap proportions and54px body stay fixed.
 const tileHeight=body.h*bodyScale;
 for(let offset=0;offset<bodyHeight;offset+=tileHeight){
  const height=Math.min(tileHeight,bodyHeight-offset);
  ctx.drawImage(im,body.x,body.y,body.w,height/bodyScale,0,bodyTop+offset,bodyWidth,height);
 }
 ctx.drawImage(im,cap.x,cap.y,cap.w,cap.h,-4,0,capWidth,capHeight);
 ctx.restore();
}

function drawPixelBird(){
 const im=flightArt.bird;if(!artReady(im)||!flightArtMetrics.birdBodyDiameter)return;
 const panel=flightArtMetrics.birdPanelWidth||im.naturalWidth/2;
 const frame=Math.sin(wing)>=0?0:1,metrics=flightArtMetrics.birdFrames?.[frame];
 // The body remains36px across, matching the original collision footprint.
 const bodyDiameter=metrics?.bodyDiameter||flightArtMetrics.birdBodyDiameter;
 const scale=36/bodyDiameter,anchorX=metrics?.anchorX??flightArtMetrics.birdAnchorX;
 const anchorY=metrics?.anchorY??flightArtMetrics.birdAnchorY;
 ctx.save();ctx.translate(100,Math.round(bird.y));
 ctx.drawImage(im,frame*panel,0,panel,im.naturalHeight,
  -anchorX*scale,-anchorY*scale,
  panel*scale,im.naturalHeight*scale);
 ctx.restore();
}

function renderPixelFlight(){
 cachedFlightLayers();drawFlightLayer(flightSkyLayer);
 for(const p of pipes){
  drawPixelPipe(p.x,bounds.top,p.gap-82-bounds.top,true);
  drawPixelPipe(p.x,p.gap+82,500-p.gap-82);
 }
 drawFlightLayer(flightGroundLayer);drawPixelBird();
}

function reset(){phase='ready';bird={y:300,v:0};pipes=[{x:390,gap:270,passed:false}];spawn=1.8;flight=0;score=0;$('.score').textContent='0';state('ready');}
function end(){if(phase!=='playing')return;phase='result';fail();result("Fine partita",score,"Tubi superati",reset);}
micControls();installMicrophoneRecordingControl();reset();
loop((dt,t)=>{const v=voice();if(v>.12&&phase==='ready'){phase='playing';gesture();state('playing');}if(phase==='playing'){flight+=dt;wing+=dt*(v>.1?20:5);bird.v+=(v>.1?-600*v:450)*dt;bird.v=clamp(bird.v,-210,280);bird.y+=bird.v*dt;spawn-=dt;if(spawn<=0){pipes.push({x:430,gap:rand(205,335),passed:false});spawn=1.65;}const speed=Math.min(170,110+flight*1.3);for(const p of pipes){p.x-=speed*dt;if(!p.passed&&p.x+54<100){p.passed=true;score++;$('.score').textContent=score;sound(760,.07,.12);}if(p.x<118&&p.x+54>82&&(bird.y-13<p.gap-82||bird.y+13>p.gap+82))end();}pipes=pipes.filter(p=>p.x>-70);if(bird.y<70||bird.y>484)end();}
 renderPixelFlight();});

configure(()=>{if($('.guide'))$('.guide').textContent=String(setting('GUIDE',"Fai un suono per salire · taci per scendere"));});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n.hud{font-family:Playful,UIBody,sans-serif;font-size:28px}.mic-status{color:#284f49}.capability{color:#284f49;background:#fffaf0}";
  document.head.append(uiStyle);
})();

// Pixel Flight UI — 2026-11-16; source fonts and controls stay fully editable.
(() => {
 const pixelStyle=document.createElement('style');
 pixelStyle.textContent=`
 @font-face{font-family:FlightPixel;src:url('./assets/ui/Silkscreen-Regular.ttf') format('truetype');font-weight:400;font-style:normal;font-display:swap}
 html,body,#root,.fit,.guide,.hud,.mic-status,.capability,.pill,.result,.result h2,.result p,.result .value,button{font-family:FlightPixel,monospace!important;font-weight:400!important}
 canvas{image-rendering:pixelated}
 .hud{font-size:28px;line-height:1.25;color:#fff;text-shadow:-2px -2px #172c38,2px -2px #172c38,-2px 2px #172c38,2px 2px #172c38,0 3px #172c38}
 .guide{font-size:18px;line-height:1.45;color:#fff!important;text-shadow:-2px 0 #172c38,2px 0 #172c38,0 -2px #172c38,0 2px #172c38,-2px -2px #172c38,2px -2px #172c38,-2px 2px #172c38,2px 2px #172c38}
 .mic-status{font-size:12px;line-height:1.5;color:#fff!important;text-shadow:-1px 0 #172c38,1px 0 #172c38,0 -1px #172c38,0 1px #172c38,-1px -1px #172c38,1px -1px #172c38,-1px 1px #172c38,1px 1px #172c38}
 .bottom{gap:8px;align-items:stretch}
 .bottom .capability,.pill{font-size:14px!important;line-height:1.4;min-height:44px;border:3px solid #183b3d;border-radius:0;background:#fff1c9;color:#183b3d;box-shadow:3px 3px 0 #183b3d;padding:9px 10px}
 .bottom .capability:active,.pill:active{transform:translate(2px,2px);box-shadow:1px 1px 0 #183b3d}
 .bottom .capability.mic-enable{flex:1 1 174px;gap:6px}
 .bottom .capability.mic-enable.is-listening{background:#d94646;border-color:#183b3d;color:#fff;box-shadow:3px 3px 0 #183b3d}
 .mic-enable .mic-icon{width:16px;height:16px;shape-rendering:crispEdges}
 .mic-enable .mic-record-dot{width:8px;height:8px;border-radius:0;clip-path:polygon(25% 0,75% 0,75% 25%,100% 25%,100% 75%,75% 75%,75% 100%,25% 100%,25% 75%,0 75%,0 25%,25% 25%)}
 .result{background:#fff1c9;border:4px solid #183b3d;border-radius:0;box-shadow:6px 6px 0 #183b3d;color:#183b3d}
 .result h2{font-size:24px;line-height:1.35}.result p{font-size:13px;line-height:1.7}
 .result .value{font-size:48px;color:#3b7d42;text-shadow:2px 2px #b3d483}
 .result .pill{font-size:14px!important;background:#b5e27c;color:#183b3d}
 button:focus-visible{outline:3px solid #fff;outline-offset:4px}
 `;
 document.head.append(pixelStyle);
})();
