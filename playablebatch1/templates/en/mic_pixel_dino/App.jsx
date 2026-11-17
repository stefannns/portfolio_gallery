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
function micMarkup(action='Hold to try'){return `<div class="status mic-status">Use your voice · or hold to try</div><div class="bottom"><button class="capability mic-enable">Enable microphone</button><button class="capability voice-hold">${action}</button></div>`;}


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
  if(voiceControlMode==='hold')status.textContent=italian?'Tieni premuto · o premi Spazio':'Hold the button · or press Space';
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
  idle:'Mic spento',requesting:'Connessione…',active:'Mic attivo',paused:'Mic in pausa',
  start:'Attiva microfono',stop:'Disattiva microfono',listening:'In ascolto · tocca per disattivare',
  fallback:'Usa la voce o tieni premuto',unavailable:'Non disponibile · usa il pulsante'
 }:{
  idle:'Mic off',requesting:'Connecting…',active:'Mic on',paused:'Mic paused',
  start:'Start microphone',stop:'Stop microphone',listening:'Listening · tap to turn off',
  fallback:'Use your voice · or hold to try',unavailable:'Mic unavailable · hold the button to play'
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

mount(`.fit{background:#fff;color:#292929}.hud{font:24px monospace;justify-content:flex-end}.guide{top:200px;font:18px monospace}.capability{font-family:monospace;border-radius:0;border:2px solid #333}.status{font-family:monospace;font-size:10px}.result{background:#fff;border:3px solid #333;border-radius:0;box-shadow:7px 7px #3333}.result h2{font-family:monospace}.result .value{font:38px monospace}.pill{border-radius:0;background:#292929;font-family:monospace}`,`<canvas class="stage" aria-label="Pixel dinosaur voice jump"></canvas><div class="hud"><span class="score">00000</span></div><div class="guide">Make a sound to jump</div>${micMarkup('Hold to jump')}${resultMarkup('Run again')}`,'#fff');
const {ctx}=stageCanvas();let phase='ready',y=0,vy=0,speed=210,distance=0,ground=0,spawn=1.4,obstacles=[],armed=true;
const pixels=['00000001111110','00000001110110','00000001111110','00000001110000','10000001111100','11000011100000','11100111111000','01111111101000','00111111100000','00011111000000','00001101000000','00001001000000'];
function reset(){phase='ready';y=0;vy=0;speed=210;distance=0;spawn=1.4;obstacles=[];armed=true;$('.score').textContent='00000';state('ready');}
micControls();installMicrophoneRecordingControl();loop((dt,t)=>{const v=voice();if(v<.12)armed=true;if(v>.32&&armed&&y<=.1&&phase!=='result'){gesture();armed=false;vy=440;if(phase==='ready'){phase='playing';state('playing');}sound(340,.08,.1,'square',550);}if(phase==='playing'){distance+=speed*dt;speed=Math.min(450,speed+dt*5);ground=(ground+speed*dt)%40;vy-=1150*dt;y=Math.max(0,y+vy*dt);if(y===0)vy=0;spawn-=dt;if(spawn<=0){obstacles.push({x:440,w:pick([15,22,30]),h:pick([32,40,48])});spawn=rand(1.1,1.6)*210/speed+.35;}for(const o of obstacles){o.x-=speed*dt;if(o.x<119&&o.x+o.w>84&&y<o.h-8){phase='result';fail();result('Game over',Math.floor(distance/20).toString().padStart(5,'0'),'A little louder. A little earlier.',reset);}}obstacles=obstacles.filter(o=>o.x>-40);$('.score').textContent=Math.floor(distance/20).toString().padStart(5,'0');root.dataset.distance=Math.floor(distance);}
 ctx.fillStyle='#fff';ctx.fillRect(0,0,390,598);ctx.fillStyle='#e2e2df';for(const [x,yy] of [[32,140],[260,235],[350,110]]){ctx.fillRect(x,yy,36,2);ctx.fillRect(x+7,yy-9,22,2);ctx.fillRect(x+5,yy-7,2,7);ctx.fillRect(x+29,yy-7,2,7);}ctx.fillStyle='#4b4b49';ctx.fillRect(0,451,390,2);for(let x=-ground;x<390;x+=40)ctx.fillRect(x,460+(x%3)*3,8,1);const dy=414-y;for(let row=0;row<pixels.length;row++)for(let col=0;col<pixels[row].length;col++)if(pixels[row][col]==='1'){if(row>9&&phase==='playing'&&Math.sin(t*16)>0&&col>6)continue;ctx.fillRect(73+col*3,dy+row*3,3,3);}for(const o of obstacles){ctx.fillRect(o.x+o.w*.4,451-o.h,o.w*.26,o.h);ctx.fillRect(o.x,451-o.h*.7,o.w*.25,o.h*.4);ctx.fillRect(o.x,451-o.h*.35,o.w*.5,5);ctx.fillRect(o.x+o.w*.8,451-o.h*.8,o.w*.2,o.h*.5);ctx.fillRect(o.x+o.w*.6,451-o.h*.4,o.w*.4,5);}});reset();

configure(()=>{if($('.guide'))$('.guide').textContent=String(setting('GUIDE',"Make a sound to jump"));});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n\n@font-face{font-family:UIPixel;src:url('./assets/ui/Silkscreen-Regular.ttf') format('truetype');font-display:swap}\n.hud{justify-content:center;font:400 28px/1.25 UIPixel,monospace}\n.guide{font:400 18px/1.5 UIPixel,monospace}\n.bottom{gap:8px}.bottom .capability{font:400 13px/1.4 UIPixel,monospace;padding:9px 9px}\n.status{font:400 12px/1.5 UIPixel,monospace;color:#555}\n.result h2,.result .value{font-family:UIPixel,monospace}.pill{font-family:UIPixel,monospace;font-size:14px}\n";
  document.head.append(uiStyle);
})();
