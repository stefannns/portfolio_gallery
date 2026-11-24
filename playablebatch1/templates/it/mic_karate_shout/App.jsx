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
 document.head.append(style);root.style.background=background;mountPlayableMarkup(root, '<div class="fit">'+markup+'</div>');
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
  idle:'Attiva microfono',requesting:'Connessione…',active:'Microfono attivo',paused:'Microfono in pausa',
  start:'Attiva microfono',stop:'Disattiva microfono',listening:'',
  fallback:'',unavailable:'Non disponibile · usa il pulsante'
 }:{
  idle:"Attiva microfono",requesting:"Connessione…",active:"Mic attivo",paused:"Mic in pausa",
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
   const icon=onAir?'<span class="mic-record-dot" aria-hidden="true"></span>':'<svg class="mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
   const label=pending?copy.requesting:onAir?copy.active:hasStream?copy.paused:copy.idle;
   mountPlayableMarkup(button, icon+'<span class="mic-button-label">'+label+'</span>');
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
  ctx.setTransform(d*s,0,0,d*s,d*x,d*y);
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

mount(`.fit{background:#e9e2c8}.guide{top:106px;font:17px Playful,Arial;color:#565c3d}.hud{font-size:17px;color:#5e5a3d;font-family:Playful,Arial}.capability{border-color:#8f733c55;background:#fff6da}.mic-status{color:#72583f}.result{background:#fff3d5}.result h2{font-family:Playful,Arial}.pill{background:#847443}`,`<canvas class="stage" aria-label="Sfida di precisione del karate"></canvas><div class="hud center"><span class="round-label">1 tavola</span></div><div class="guide">Grida al momento giusto</div>${micMarkup("Tieni per gridare")}${resultMarkup()}`,'#e9e2c8');
installSingleGuideStatus('microphone');
const {ctx,bounds}=fullBleedStageCanvas(),readyImage=image('./assets/karate-ready.webp'),chopImage=image('./assets/karate-chop.webp'),dojoImage=image('./assets/dojo-interior-v1.webp');
// Keep the generated floor seam at the established gameplay floor line while
// uniformly covering every host ratio, including the full-bleed side extensions.
function drawDojoBackground(){
 ctx.fillStyle='#e9e2c8';ctx.fillRect(bounds.left,bounds.top,bounds.right-bounds.left,bounds.bottom-bounds.top);
 if(!dojoImage.width){ctx.fillStyle='#d0a367';ctx.fillRect(bounds.left,435,bounds.right-bounds.left,Math.max(0,bounds.bottom-435));return;}
 const seam=dojoImage.height*.755;
 const scale=Math.max((bounds.right-bounds.left)/dojoImage.width,(435-bounds.top)/seam,(bounds.bottom-435)/(dojoImage.height-seam));
 const width=dojoImage.width*scale,height=dojoImage.height*scale;
 ctx.drawImage(dojoImage,(bounds.left+bounds.right-width)/2,435-seam*scale,width,height);
}
let roundNo=1,cleared=0,power=0,clock=0,phase='ready',pause=0,armed=true,chop=0,fragments=[];
function reset(){roundNo=1;cleared=0;power=0;clock=0;phase='ready';pause=0;armed=true;fragments=[];chop=0;$('.round-label').textContent="1 tavola";state('ready');}
function woodCrack(){if(!audio)return;const n=audio.createBufferSource(),g=audio.createGain(),b=audio.createBuffer(1,audio.sampleRate*.13,audio.sampleRate);const a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1)*Math.exp(-i/a.length*15);n.buffer=b;g.gain.value=.28;n.connect(g);g.connect(audio.destination);n.start();n.onended=()=>{n.disconnect();g.disconnect();};}
function shout(){if(!armed||phase==='result'||pause>0)return;gesture();armed=false;chop=.43;phase='playing';const threshold=Math.min(.92,.69+roundNo*.025);if(power>=threshold){woodCrack();cleared+=roundNo;pause=1.05;for(let j=0;j<roundNo*5;j++)fragments.push({x:275,y:360-roundNo*8,vx:rand(-160,160),vy:rand(-180,-70),r:rand(0,6)});state('hit');}else{pause=.8;phase='failed';fail();state('miss');}}
micControls();installMicrophoneRecordingControl();reset();loop((dt)=>{const v=voice();clock+=dt;power=(Math.sin(clock*(2.4+roundNo*.13))+1)/2;if(v<.1)armed=true;if(v>.3&&armed)shout();chop=Math.max(0,chop-dt);if(pause>0){pause-=dt;if(pause<=0){if(phase==='failed'){phase='result';result("Trova il momento giusto",cleared,"Tavole rotte",reset);}else{roundNo++;$('.round-label').textContent=roundNo+" tavole";state('playing');}}}for(const f of fragments){f.x+=f.vx*dt;f.y+=f.vy*dt;f.vy+=600*dt;f.r+=dt*3;}fragments=fragments.filter(f=>f.y<560);
 drawDojoBackground();
 round(ctx,48,160,294,17,8,'#acb98c','#786b43');const gr=ctx.createLinearGradient(48,0,342,0);gr.addColorStop(0,'#b7d59d');gr.addColorStop(.8,'#e8ce84');gr.addColorStop(1,'#dd8a54');round(ctx,50,162,290*power,13,6,gr);ctx.fillStyle='#5e5534';ctx.beginPath();ctx.moveTo(48+power*294,151);ctx.lineTo(43+power*294,144);ctx.lineTo(53+power*294,144);ctx.fill();text(ctx,"ORA",329,195,12,'#8b6a38');
 round(ctx,235,375,12,90,2,'#6b4b2f','#44311e');round(ctx,321,375,12,90,2,'#6b4b2f','#44311e');round(ctx,222,367,124,14,2,'#b27b46','#765533');for(let i=0;i<roundNo&&i<12;i++){if(pause>0&&phase!=='failed')continue;round(ctx,223,359-i*7,124,6,1,'#e1b37a','#946637');line(ctx,232,361-i*7,333,361-i*7,'#f6d7a155',1);}
 const im=chop>0?chopImage:readyImage;if(im.width)ctx.drawImage(im,22,258,218,218);for(const f of fragments){ctx.save();ctx.translate(f.x,f.y);ctx.rotate(f.r);round(ctx,-12,-3,24,6,1,'#d6a56d','#916332');ctx.restore();}});

configure(()=>{if($('.guide'))$('.guide').textContent=String(setting('GUIDE',"Grida al momento giusto"));});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n.hud{font-family:Playful,UIBody,sans-serif;font-size:28px}.guide{font-size:18px;top:100px}.mic-status{color:#5c402a}";
  document.head.append(uiStyle);
})();
