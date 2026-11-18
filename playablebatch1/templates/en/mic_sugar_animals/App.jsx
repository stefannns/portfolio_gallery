import * as THREE from 'three';
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

// W3C microphone input per the supplied H5 SDK; no recording or uploads.
let micStream=null,micContext=null,micAnalyser=null,micBuffer=null,micRequested=false,manualVoice=false,voiceControlMode='';
let voiceChoiceRefresh=()=>{};
function stopMic(){micStream?.getTracks().forEach(t=>t.stop());micStream=null;micContext?.close().catch(()=>{});micContext=micAnalyser=micBuffer=null;micRequested=false;}
async function enableMic(){if(micRequested)return;micRequested=true;try{if(!navigator.mediaDevices?.getUserMedia)throw Error('No microphone');micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false}});if(disposed||!active||voiceControlMode==='hold'){stopMic();return;}micContext=new (window.AudioContext||window.webkitAudioContext)();await micContext.resume();const source=micContext.createMediaStreamSource(micStream);micAnalyser=micContext.createAnalyser();micAnalyser.fftSize=1024;source.connect(micAnalyser);micBuffer=new Float32Array(micAnalyser.fftSize);$('.mic-enable').textContent='Mic on';$('.mic-status').textContent='Listening · Space or hold also works';root.dataset.microphone='enabled';}catch(_){micRequested=false;$('.mic-enable').textContent='Enable microphone';$('.mic-status').textContent='Mic unavailable · hold the button to play';root.dataset.microphone='unavailable';}}
function voice(){if(manualVoice)return .9;if(!micAnalyser||!active)return 0;micAnalyser.getFloatTimeDomainData(micBuffer);let sum=0;for(const n of micBuffer)sum+=n*n;return clamp((Math.sqrt(sum/micBuffer.length)-.012)*14,0,1);}
function micControls(){on($('.mic-enable'),'click',()=>{unlockAudio();enableMic();});const hold=$('.voice-hold');on(hold,'pointerdown',e=>{e.preventDefault();gesture();selectVoiceControl('hold');manualVoice=true;hold.setPointerCapture(e.pointerId);});for(const type of ['pointerup','pointercancel','lostpointercapture'])on(hold,type,()=>manualVoice=false);on(window,'keydown',e=>{if(e.code==='Space'&&!e.repeat){e.preventDefault();gesture();selectVoiceControl('hold');manualVoice=true;}});on(window,'keyup',e=>{if(e.code==='Space')manualVoice=false;});lifecycle.push(next=>{if(!next){manualVoice=false;micContext?.suspend().catch(()=>{});if(micStream)for(const t of micStream.getTracks())t.enabled=false;}else{micContext?.resume().catch(()=>{});if(micStream)for(const t of micStream.getTracks())t.enabled=true;}});cleanups.push(stopMic);installVoiceControlChoice();}
function micMarkup(action='Hold to try'){return `<div class="status mic-status" hidden></div><div class="bottom"><button class="capability mic-enable">Enable microphone</button><button class="capability voice-hold">${action}</button></div>`;}


// Keep the chosen input in one centered slot; a failed/stopped microphone restores fallback.
function selectVoiceControl(mode){
 voiceControlMode=mode;
 if(mode==='hold'&&(micStream||micRequested))stopMic();
 voiceChoiceRefresh();
}
function installVoiceControlChoice(){
 const mic=$('.mic-enable'),hold=$('.voice-hold'),bar=mic.parentElement,status=$('.mic-status');
 const italian=(new URLSearchParams(location.search).get('lang')||document.documentElement.lang||'en').toLowerCase().startsWith('it');
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
 const italian=language.toLowerCase().startsWith('it');
 const copy=italian?{
  idle:'Attiva microfono',requesting:'Connessione…',active:'Microfono attivo',paused:'Microfono in pausa',
  start:'Attiva microfono',stop:'Disattiva microfono',listening:'',
  fallback:'',unavailable:'Non disponibile · usa il pulsante'
 }:{
  idle:'Start microphone',requesting:'Connecting…',active:'Mic on',paused:'Mic paused',
  start:'Start microphone',stop:'Stop microphone',listening:'',
  fallback:'',unavailable:'Mic unavailable · hold the button to play'
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
   const icon=onAir?'<span class="mic-record-dot" aria-hidden="true"></span>':'<svg class="mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
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

// Full-bleed print-paper stays attached to the viewport, not the fitted game stage.
function paintPaperBackdrop(){
 const path=String(setting('PAPER_BACKDROP','./assets/paper-print-v1.svg'));
 root.style.backgroundColor='#eadbbb';
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
 #root .result,#root .comparison,#root .strip-view{background:#f9f0dc;color:#282723;border:2px solid #282723;border-radius:12px;box-shadow:4px 5px 0 #28272322}
 #root .pill{background:#282723;color:#fff9e9;border:2px solid #282723;box-shadow:0 3px 0 #28272325}
 #root .capability,#root .stop-sugar{color:#282723;background:#f9f0dc;border:2px solid #282723;box-shadow:0 2px 0 #2827231c}
 #root .capability:disabled,#root .pill:disabled{box-shadow:none}
 #root .shutter{border-color:#282723;background:#f9f0dc}
 #root .eyebrow,#root .booth-label,#root .guide{color:#282723}
 #root .cam-status,#root .mic-status,#root .target-label{color:#625c4b}
 #root .scene,#root .scene canvas{background:transparent}#root .meter{background:#cbbd9d;border:1px solid #28272355}#root .meter div{background:#8c6d44}#root .dot{background:#c9b78f;border:1px solid #28272355}#root .dot.done{background:#8c6d44}`;
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

// One game-action guide; capability state is text only while permission/error needs it.
function installSingleGuideStatus(kind){
 const status=$(kind==='camera'?'.cam-status':'.mic-status');if(!status)return;
 const italian=(new URLSearchParams(location.search).get('lang')||document.documentElement.lang||'en').toLowerCase().startsWith('it');
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 function refresh(){
  let message='';
  if(kind==='camera'){
   if(['requesting','unavailable'].includes(root.dataset.camera))message=status.textContent;
  }else{
   const state=$('.mic-enable')?.dataset.micState||root.dataset.microphone;
   if(state==='requesting')message=italian?'Consenti l’accesso al microfono':'Allow microphone access';
   else if(['unavailable','error'].includes(state))message=italian?'Microfono non disponibile':'Microphone unavailable';
  }
  if(status.textContent!==message)status.textContent=message;
  const hidden=!message.trim();if(status.hidden!==hidden)status.hidden=hidden;
 }
 const textObserver=new MutationObserver(refresh);textObserver.observe(status,{childList:true,characterData:true,subtree:true});
 const stateObserver=new MutationObserver(refresh);stateObserver.observe(root,{attributes:true,attributeFilter:[kind==='camera'?'data-camera':'data-microphone']});
 const button=$('.mic-enable');if(button)stateObserver.observe(button,{attributes:true,attributeFilter:['data-mic-state']});
 refresh();cleanups.push(()=>{textObserver.disconnect();stateObserver.disconnect();});
}

mount(`.fit{background:#f4e8d6}.scene{position:absolute;inset:0}.scene canvas{width:100%;height:100%;display:block}.target{position:absolute;inset:0;width:390px;height:598px;pointer-events:none;z-index:2}.guide{top:93px;font:17px Playful,Arial;color:#a87952}.hud{font-size:18px;gap:13px}.dots{display:flex;gap:9px}.dot{width:7px;height:7px;background:#d5b394;border-radius:50%}.dot.done{background:#a3633c}.meter{position:absolute;left:80px;right:80px;bottom:115px;height:7px;background:#e1cbb0;border-radius:8px;overflow:hidden}.meter div{height:100%;background:#bf8054;width:0}.target-label{position:absolute;top:451px;left:30px;right:30px;text-align:center;font-size:11px;color:#b09270}.stop-sugar{position:absolute;right:29px;top:30px;background:transparent;border:1px solid #b69a73;border-radius:20px;min-height:34px;font-size:13px;padding:5px 14px}.capability{background:#fff9ed;color:#96704f;border-color:#d8c4ac}.result{background:#fff6e8}.pill{background:#b88155}`,`<div class="scene"></div><svg class="target" viewBox="0 0 390 598"><g class="outline" fill="none" stroke="#9b7350" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 5" opacity=".8"><ellipse cx="195" cy="322" rx="66" ry="75"/><circle cx="195" cy="225" r="51"/><ellipse cx="160" cy="177" rx="20" ry="24"/><ellipse cx="230" cy="177" rx="20" ry="24"/></g></svg><div class="hud center"><div class="dots"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div></div><button class="stop-sugar">Stop</button><div class="guide">Blow to fill · stop at the outline</div><div class="target-label"></div><div class="meter"><div></div></div>${micMarkup('Hold to blow')}${resultMarkup()}`,'#f4e8d6');
installSingleGuideStatus('microphone');
installPrintedPaper();
const scene=new THREE.Scene(),cam=new THREE.OrthographicCamera(-1.95,1.95,2.99,-2.99,.1,50),renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});renderer.setSize(390,598);renderer.setPixelRatio(Math.min(2,devicePixelRatio||1));renderer.outputColorSpace=THREE.SRGBColorSpace;$('.scene').append(renderer.domElement);cam.position.set(0,0,8);scene.add(new THREE.HemisphereLight(0xfff8e2,0xcda181,1.8));const light=new THREE.DirectionalLight(0xffffff,2.6);light.position.set(-3,5,6);scene.add(light);
// A small reflected studio gives the sugar bright glints while the paper
// remains visible through the transmissive material and transparent canvas.
const studio=document.createElement('canvas');studio.width=256;studio.height=128;
const studioBrush=studio.getContext('2d'),studioWash=studioBrush.createLinearGradient(0,0,0,128);
studioWash.addColorStop(0,'#fff9ed');studioWash.addColorStop(.48,'#d8c6ae');studioWash.addColorStop(1,'#79634d');
studioBrush.fillStyle=studioWash;studioBrush.fillRect(0,0,256,128);
studioBrush.fillStyle='#ffffff';studioBrush.fillRect(28,18,34,58);studioBrush.fillRect(177,28,19,48);
studioBrush.fillStyle='#fff0d1';studioBrush.fillRect(100,9,65,8);
const studioTexture=new THREE.CanvasTexture(studio);studioTexture.mapping=THREE.EquirectangularReflectionMapping;studioTexture.colorSpace=THREE.SRGBColorSpace;
const studioGenerator=new THREE.PMREMGenerator(renderer),studioEnvironment=studioGenerator.fromEquirectangular(studioTexture);
scene.environment=studioEnvironment.texture;studioGenerator.dispose();studioTexture.dispose();
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.transmissionResolutionScale=.75;
const rimLight=new THREE.DirectionalLight(0xffe6be,2);rimLight.position.set(3,2,-3);scene.add(rimLight);
cleanups.push(()=>studioEnvironment.dispose());
// The same paper is present behind the 3D sugar so refraction can reveal it.
// Its pattern is aligned to the root's CSS pixels, including fitted gutters.
const candyPaper=document.createElement('canvas');candyPaper.width=390;candyPaper.height=598;
const candyPaperBrush=candyPaper.getContext('2d'),candyPaperImage=new Image();
const candyPaperTexture=new THREE.CanvasTexture(candyPaper);candyPaperTexture.colorSpace=THREE.SRGBColorSpace;
const candyPaperPlane=new THREE.Mesh(new THREE.PlaneGeometry(3.9,5.98),new THREE.MeshBasicMaterial({map:candyPaperTexture,toneMapped:false}));
candyPaperPlane.position.z=-1.3;candyPaperPlane.renderOrder=-1;scene.add(candyPaperPlane);
function drawCandyPaper(){
 const box=renderer.domElement.getBoundingClientRect(),host=root.getBoundingClientRect(),scale=box.width/390;
 candyPaperBrush.setTransform(1,0,0,1,0,0);candyPaperBrush.fillStyle='#eadbbb';candyPaperBrush.fillRect(0,0,390,598);
 if(scale>0&&candyPaperImage.complete&&candyPaperImage.naturalWidth){
  const left=box.left-host.left,top=box.top-host.top;
  candyPaperBrush.setTransform(1/scale,0,0,1/scale,-left/scale,-top/scale);
  candyPaperBrush.fillStyle=candyPaperBrush.createPattern(candyPaperImage,'repeat');
  candyPaperBrush.fillRect(left,top,390*scale,598*scale);
 }
 candyPaperTexture.needsUpdate=true;
}
function syncCandyPaper(){
 const path=String(setting('PAPER_BACKDROP','./assets/paper-print-v1.svg'));
 if(candyPaperImage.getAttribute('src')!==path)candyPaperImage.src=path;else drawCandyPaper();
}
candyPaperImage.onload=drawCandyPaper;syncCandyPaper();drawCandyPaper();
const candyPaperResize=new ResizeObserver(drawCandyPaper);candyPaperResize.observe(root);
cleanups.push(()=>{candyPaperResize.disconnect();candyPaperTexture.dispose();candyPaperPlane.geometry.dispose();candyPaperPlane.material.dispose();});
let animal=new THREE.Group();scene.add(animal);const shapeParts=[];let growth=.18,roundNo=0,phase='ready',wasBlowing=false,quiet=0,celebrate=0;
function buildAnimal(){shapeParts.length=0;animal.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});scene.remove(animal);animal=new THREE.Group();scene.add(animal);const tint=[0xf0b14d,0xf3cc64,0xee9cac][roundNo];const candy=new THREE.MeshPhysicalMaterial({color:tint,roughness:.12,metalness:0,transmission:.9,thickness:.85,ior:1.46,attenuationColor:new THREE.Color(tint),attenuationDistance:1.4,clearcoat:1,clearcoatRoughness:.07,envMapIntensity:.5,opacity:1});function ball(x,y,z,sx,sy,sz,material=candy){const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,32,24),material.clone());mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);animal.add(mesh);if(material===candy)shapeParts.push({x,y,sx,sy});return mesh;}ball(0,-.22,0,.65,.74,.48);ball(0,.73,.02,.5,.49,.42);if(roundNo===1){ball(-.25,1.29,0,.13,.45,.13);ball(.25,1.29,0,.13,.45,.13);}else{ball(-.35,1.17,0,.18,.2,.16);ball(.35,1.17,0,.18,.2,.16);}ball(-.57,-.05,0,.18,.29,.18);ball(.57,-.05,0,.18,.29,.18);ball(-.29,-.84,.07,.24,.22,.28);ball(.29,-.84,.07,.24,.22,.28);const dark=new THREE.MeshStandardMaterial({color:0x68412c,roughness:.3});ball(-.16,.79,.414,.032,.045,.02,dark);ball(.16,.79,.414,.032,.045,.02,dark);ball(0,.63,.448,.055,.04,.023,dark);const pink=new THREE.MeshStandardMaterial({color:0xf8c4a3,roughness:.3});ball(-.27,.64,.37,.06,.035,.03,pink);ball(.27,.64,.37,.06,.035,.03,pink);animal.position.y=-.05;candy.dispose();dark.dispose();pink.dispose();}
// Trace the union of the model's projected body parts at its target size.
// This gives the bear one continuous silhouette, including its ears, arms and feet.
function setOutline(){
 const width=390,height=598,stride=width+1,mask=document.createElement('canvas');
 mask.width=width;mask.height=height;
 const brush=mask.getContext('2d');brush.fillStyle='#fff';
 for(const part of shapeParts){
  brush.beginPath();
  brush.ellipse(195+part.x*100,299-(part.y+animal.position.y)*100,part.sx*100,part.sy*100,0,0,Math.PI*2);
  brush.fill();
 }
 const pixels=brush.getImageData(0,0,width,height).data,edges=new Map();
 const filled=(x,y)=>x>=0&&x<width&&y>=0&&y<height&&pixels[(y*width+x)*4+3]>=128;
 const edge=(x,y,x2,y2)=>{const key=y*stride+x;const list=edges.get(key)||[];list.push(y2*stride+x2);edges.set(key,list);};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(filled(x,y)){
  if(!filled(x,y-1))edge(x,y,x+1,y);
  if(!filled(x+1,y))edge(x+1,y,x+1,y+1);
  if(!filled(x,y+1))edge(x+1,y+1,x,y+1);
  if(!filled(x-1,y))edge(x,y+1,x,y);
 }
 let contour=[];
 while(edges.size){
  const start=edges.keys().next().value,points=[];let key=start;
  do{
   points.push([key%stride,Math.floor(key/stride)]);
   const list=edges.get(key);if(!list?.length)break;
   const next=list.pop();if(!list.length)edges.delete(key);key=next;
  }while(key!==start);
  if(points.length>contour.length)contour=points;
 }
 const points=contour.filter((_,i)=>i%3===0);
 if(points.length<3)return;
 const middle=(a,b)=>((a[0]+b[0])/2).toFixed(1)+' '+((a[1]+b[1])/2).toFixed(1);
 let path='M'+middle(points[points.length-1],points[0]);
 points.forEach((p,i)=>{path+='Q'+p.join(' ')+' '+middle(p,points[(i+1)%points.length]);});
 $('.outline').innerHTML='<path d="'+path+'Z"/>';
 $('.target').setAttribute('aria-label',roundNo===1?'Rabbit target outline':'Bear target outline');
}
// A slightly lower noise floor and higher gain respond to gentler breaths.
function breathLevel(){
 if(manualVoice)return .9;
 if(!micAnalyser||!active)return 0;
 micAnalyser.getFloatTimeDomainData(micBuffer);
 let sum=0;for(const n of micBuffer)sum+=n*n;
 return clamp((Math.sqrt(sum/micBuffer.length)-.009)*clamp(Number(setting('MIC_SENSITIVITY',18)),12,26),0,1);
}
function reset(){growth=.18;roundNo=0;phase='ready';quiet=0;wasBlowing=false;celebrate=0;$('.target-label').textContent='';$('.target').style.opacity='1';root.querySelectorAll('.dot').forEach(e=>e.classList.remove('done'));buildAnimal();setOutline();state('ready');}
function stop(){if(phase!=='playing')return;if(growth>=.9&&growth<=1.13){phase='celebrate';celebrate=1.2;success();root.querySelectorAll('.dot')[roundNo].classList.add('done');$('.target-label').textContent='Just right!';state('matched');}else if(growth>1.13){phase='result';fail();result('Too much air!',roundNo+'/3','Keep a little room for the last breath.',reset);}else{$('.target-label').textContent='A little more air…';}}
on($('.stop-sugar'),'click',()=>{gesture();stop();});micControls();installMicrophoneRecordingControl();reset();loop((dt,t)=>{const v=breathLevel();if(v>.12&&phase==='ready'){phase='playing';gesture();state('playing');}if(phase==='playing'){if(v>.12){growth+=dt*v*.32;wasBlowing=true;quiet=0;}else if(wasBlowing){quiet+=dt;if(quiet>.55){wasBlowing=false;stop();}}if(growth>1.32){phase='result';fail();result('Pop!',roundNo+'/3','Stop when the sugar meets the outline.',reset);}}if(phase==='celebrate'){celebrate-=dt;if(celebrate<=0){roundNo++;if(roundNo===3){phase='result';result('Sweet little collection','3/3','Three sugar animals, made with a breath.',reset);}else{phase='ready';growth=.18;quiet=0;wasBlowing=false;buildAnimal();setOutline();$('.target-label').textContent='Blow the next little friend';state('ready');}}}const s=Math.min(1.32,growth);animal.scale.set(s,s,s);animal.rotation.y=Math.sin(t*.8)*.07;$('.meter div').style.width=clamp(growth/1.32*100,0,100)+'%';root.dataset.growth=growth.toFixed(3);renderer.render(scene,cam);});cleanups.push(()=>{animal.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});renderer.dispose();});

configure(()=>{paintPaperBackdrop();syncCandyPaper();if($('.guide'))$('.guide').textContent=String(setting('GUIDE',"Blow to fill the outline \u00b7 stop in time"));});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n\n.guide{font-size:18px;top:93px;color:#805332}\n.hud{font-size:28px}.stop-sugar{top:30px;right:30px;min-height:44px;font-size:14px;padding:9px 15px}\n.target-label{top:430px;font-size:12px;color:#886443}\n.meter{bottom:138px}.mic-status{bottom:108px;color:#775235}\n";
  document.head.append(uiStyle);
})();
