
document.documentElement.lang = "it";
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
function resultMarkup(label="Gioca ancora"){return `<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${label}</button></section></div>`;}
function flash(){const e=$('.flash');if(!e)return;e.classList.remove('fire');void e.offsetWidth;e.classList.add('fire');}
const lifecycle=[];
function setActive(next){active=next;if(!next)audio?.suspend().catch(()=>{});for(const fn of lifecycle)fn(next);}
on(window,'message',e=>{if(e.source===parent&&e.data?.type==='playable-active')setActive(e.data.active===true);});
on(document,'visibilitychange',()=>{setActive(!document.hidden);});
on(window,'pagehide',()=>{disposed=true;listeners.splice(0).forEach(off=>off());cleanups.splice(0).forEach(fn=>fn());audio?.close().catch(()=>{});});
const configValues={};
function setting(id,fallback){return configValues[id]??fallback;}
async function configure(callback=()=>{}){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),1600);try{const r=await fetch('./game.config.json',{signal:ctl.signal});if(!r.ok)throw Error("Configurazione non disponibile");const c=await r.json();for(const group of ['texts','tweaks','images'])for(const v of c[group]||[])configValues[v.id]=group==='images'?v.path:v.value;for(const binding of assetImages){const path=assetPath(binding.path);if(binding.im.getAttribute('src')!==path)binding.im.src=path;}for(const im of root.querySelectorAll('img[src^="./assets/"]'))im.src=assetPath(im.getAttribute('src'));callback();root.dataset.config='loaded';}catch(_){root.dataset.config='defaults';}finally{clearTimeout(timer);}}

// The host owns access to friend profiles. Samples are local review fallbacks.
let friends=[{nickname:'Bean',avatar:'./assets/friend-bean.webp'},{nickname:'Kitty',avatar:'./assets/friend-kitty.webp'},{nickname:'Cloudy',avatar:'./assets/friend-cloudy.webp'},{nickname:'Starry',avatar:'./assets/friend-starry.webp'}];
let friendsChanged=()=>{};
function loadFriends(){
 function preload(list,host){friends=list.slice(0,24).map(f=>({nickname:String(f.nickname||"Amico"),avatar:f.avatar,image:null}));for(const f of friends){let im;try{im=host?window.tt.createImage():new Image();im.onload=()=>{f.image=im;friendsChanged();};im.onerror=()=>{f.image=null;};im.src=f.avatar;}catch(_){f.image=null;}}friendsChanged();}
 preload(friends,false);root.dataset.friends='sample';
 if(!window.tt?.getFriendsInfo||!window.tt?.createImage)return;
 window.tt.getFriendsInfo({success(data){const list=Array.isArray(data?.friends)?data.friends.filter(f=>f&&typeof f.avatar==='string'):[];if(list.length){preload(list,true);root.dataset.friends='host';}},fail(){root.dataset.friends='sample';}});
}
function avatar(ctx,index,x,y,r,ring='#fff'){
 const f=friends[((index%friends.length)+friends.length)%friends.length];ctx.save();ctx.shadowColor='#25212d20';ctx.shadowBlur=6;circle(ctx,x,y,r,ring);ctx.shadowBlur=0;if(f?.image)cropCircle(ctx,f.image,x,y,Math.max(1,r-2));else{circle(ctx,x,y,Math.max(1,r-2),['#efb5a9','#b3d6ce','#e3cb8f','#c6b8df'][index%4]);text(ctx,Array.from(f?.nickname||'?')[0],x,y,r*.7,'#fff');}ctx.restore();
}
function friendName(index){return friends[((index%friends.length)+friends.length)%friends.length]?.nickname||"Amico";}
function drawName(ctx,index,x,y,size=13){text(ctx,Array.from(friendName(index)).slice(0,15).join(''),x,y,size);}
loadFriends();

// Full-host printed paper; gameplay remains on its existing 390 × 598 stage.
function installPrintedPaper(){
 const fit=$('.fit'),modal=$('.modal'),base='#f1e9d3';
 root.classList.add('printed-paper');root.style.position='relative';root.style.isolation='isolate';
 document.body.style.backgroundColor=base;root.style.backgroundColor=base;
 fit.style.background='transparent';fit.style.zIndex='1';
 if(modal)root.append(modal);
 const style=document.createElement('style');
 style.textContent=`#root.printed-paper{color:#282723}
 #root.printed-paper .fit{background:transparent}
 #root.printed-paper .guide,#root.printed-paper .hud,#root.printed-paper .count,#root.printed-paper .question,#root.printed-paper .next,#root.printed-paper .round{color:#282723}
 #root.printed-paper .pill,#root.printed-paper .tilt-enable{background:#fffbee;color:#282723;border:2px solid #282723;border-radius:10px;box-shadow:2px 3px 0 #28272326}
 #root.printed-paper .bottom .reset{background:#fffbee;color:#282723;border:2px solid #282723;box-shadow:2px 3px 0 #28272326}
 #root.printed-paper>.modal{z-index:30;background:#28272345}
 #root.printed-paper>.modal>.result{width:320px;max-width:320px;max-height:var(--paper-result-height);transform:scale(var(--paper-scale));background:#fffbee;color:#282723;border:2px solid #282723;border-radius:12px;box-shadow:4px 5px 0 #28272333}
 #root.printed-paper .result h2,#root.printed-paper .result .value{color:#282723}
 #root.printed-paper .answers button{background:#fffbee;color:#282723;border:2px solid #282723;border-radius:10px;box-shadow:2px 3px 0 #28272326}
 #root.printed-paper .card{border:2px solid #282723;box-shadow:3px 4px 0 #28272326}
 #root.printed-paper .award-label,#root.printed-paper .award-title,#root.printed-paper .award-sub{color:#51463c}`;
 document.head.append(style);cleanups.push(()=>style.remove());
 function refresh(){
  const bounds=root.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
  const scale=Math.min(bounds.width/390,bounds.height/598),x=(bounds.width-390*scale)/2,y=(bounds.height-598*scale)/2;
  fit.style.transform=`translate(${x}px,${y}px) scale(${scale})`;
  const path=String(setting('PAPER_BACKDROP','./assets/paper-print-v1.svg'));
  root.style.backgroundImage=`url("${path.replace(/"/g,'%22')}")`;
  root.style.backgroundRepeat='repeat';root.style.backgroundSize=`${256*scale}px ${256*scale}px`;
  root.style.setProperty('--paper-scale',String(scale));
  root.style.setProperty('--paper-result-height',`${Math.max(220,bounds.height/scale-80)}px`);
  if(modal)modal.style.padding=`${30*scale}px ${30*scale}px ${50*scale}px`;
 }
 refresh();on(window,'resize',refresh);
 if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(refresh);observer.observe(root);cleanups.push(()=>observer.disconnect());}
 return refresh;
}
mount(`.fit{background:transparent}.guide{top:420px;font-size:15px;color:#908576}.question{position:absolute;left:35px;right:35px;top:145px;font-weight:700;font-size:23px;line-height:1.35;text-align:center}.count{position:absolute;top:46px;left:30px;right:30px;text-align:center;font-size:13px;letter-spacing:2px;color:#756e63}.choice{position:absolute;top:264px;width:140px;height:142px;background:transparent;border-radius:80px}.choice.left{left:30px}.choice.right{right:30px}.tilt-enable{font-size:13px;border:1px solid #bbb1a2;background:transparent;border-radius:24px;padding:9px 18px}.result{background:#fffdf8}.result .value{font-size:24px;line-height:1.3;overflow-wrap:anywhere}.winner-avatar{display:block;width:104px;height:104px;margin:14px auto 6px}.result h2{margin:0}.result p:empty{display:none}.result p{margin:12px 0 22px}.result p{white-space:pre-line;font-size:14px;line-height:1.8}`,`<canvas class="stage" aria-label="Scegli tra gli amici"></canvas><div class="count">Domanda 1 / 5</div><div class="question"></div><button class="choice left" data-choice="0" aria-label="Scegli l’amico a sinistra"></button><button class="choice right" data-choice="1" aria-label="Scegli l’amico a destra"></button><div class="guide">Inclina il telefono o tocca un amico</div><div class="bottom"><button class="tilt-enable">Attiva inclinazione</button></div>${resultMarkup()}`,'#f1e9d3');
const refreshPrintedPaper=installPrintedPaper();
const {ctx}=stageCanvas(),questions=["Chi ha più probabilità di diventare famoso?","Chi sopravviverebbe su un’isola deserta?","Chi organizzerebbe la sorpresa migliore?","Chi si lancia sempre in un’avventura?","Chi farebbe ridere tutti?"];
// Compare the same two friends across all five questions; reveal one overall winner.
let roundNo=0,choices=[],scores=[0,0],champion=-1,participantFriends=friends,tilt=0,baseline=null,dwell=0,waiting=0,phase='ready',chosen=-1,tiltArmed=true,tiltListening=false;
const choiceButtons=Array.from(root.querySelectorAll('.choice'));
const winnerCanvas=document.createElement('canvas');winnerCanvas.className='winner-avatar';winnerCanvas.width=160;winnerCanvas.height=160;winnerCanvas.setAttribute('role','img');winnerCanvas.setAttribute('aria-label',"L’amico scelto");$('.result h2').after(winnerCanvas);
function drawWinner(){const winnerCtx=winnerCanvas.getContext('2d');winnerCtx.clearRect(0,0,160,160);if(champion>=0)avatar(winnerCtx,champion,80,80,76,'#819a70');}
function setChoicesEnabled(enabled){for(const button of choiceButtons)button.disabled=!enabled;}
function nextPair(){
 chosen=-1;dwell=0;setChoicesEnabled(true);
 $('.question').textContent=questions[roundNo];
 $('.count').textContent="Domanda "+(roundNo+1)+' / '+questions.length;
 for(let side=0;side<2;side++)choiceButtons[side].setAttribute('aria-label',friendName(choices[side]));
 state(roundNo?'playing':'ready');
}
function finish(){
 phase='result';waiting=0;dwell=0;setChoicesEnabled(false);stopTilt();
 result("La scelta finale",friendName(champion),"",reset);
 drawWinner();if(roundNo>0)success();
}
function reset(){
 if(participantFriends!==friends||choices.length!==2){choices=shuffle([...Array(friends.length).keys()]).slice(0,2);}
 roundNo=0;participantFriends=friends;scores=[0,0];champion=-1;phase='ready';waiting=0;tiltArmed=true;dwell=0;chosen=-1;
 $('.modal').hidden=true;
 if(choices[1]===undefined){champion=choices[0];finish();return;}
 nextPair();
}
function choose(side){
 if(!active||document.hidden||waiting>0||phase==='result'||(side!==0&&side!==1))return;
 gesture();chosen=side;scores[side]++;tiltArmed=false;dwell=0;
 setChoicesEnabled(false);sound(520,.08,.16);waiting=.65;phase='playing';state('chosen');
}
choiceButtons.forEach(b=>on(b,'click',()=>choose(Number(b.dataset.choice))));
function gyro(p){
 if(!active||!p)return;const roll=Number(p.roll??p.z);if(!Number.isFinite(roll))return;
 if(baseline===null)baseline=roll;tilt=clamp((roll-baseline)/.45,-1,1);
}
function stopTilt(){
 if(tiltListening){try{window.tt?.offGyroscopeChange?.(gyro);window.tt?.stopGyroscope?.({});}catch(_){/* Touch choices remain available. */}}
 tiltListening=false;baseline=null;tilt=0;dwell=0;tiltArmed=true;$('.tilt-enable').textContent="Attiva inclinazione";
}
on($('.tilt-enable'),'click',()=>{
 gesture();if(phase==='result')return;
 if(typeof window.tt?.startGyroscope!=='function'||typeof window.tt?.onGyroscopeChange!=='function'){$('.tilt-enable').textContent="Tocca un amico per scegliere";return;}
 if(tiltListening)return;
 try{
  window.tt.onGyroscopeChange(gyro);tiltListening=true;
  window.tt.startGyroscope({interval:50,success:()=>{if(active&&phase!=='result')$('.tilt-enable').textContent="Inclinazione attiva";else stopTilt();},fail:()=>{stopTilt();$('.tilt-enable').textContent="Tocca un amico per scegliere";}});
 }catch(_){stopTilt();$('.tilt-enable').textContent="Tocca un amico per scegliere";}
});
lifecycle.push(next=>{if(!next)stopTilt();});cleanups.push(stopTilt);
on(window,'keydown',e=>{if(e.repeat)return;if(e.key==='ArrowLeft')choose(0);if(e.key==='ArrowRight')choose(1);});
friendsChanged=()=>{
 // Image loads only repaint; a new native friend list starts a fresh contest.
 if(friends!==participantFriends)reset();else if(phase==='result')drawWinner();
};
reset();
loop(dt=>{
 if(phase==='result')return;
 if(waiting>0){
  waiting-=dt;
  if(waiting<=0){
   roundNo++;
   if(roundNo===questions.length){champion=choices[scores[0]>scores[1]?0:1];finish();return;}
   nextPair();
  }
 }else if(Math.abs(tilt)<.25){tiltArmed=true;dwell=0;}
 else if(tiltArmed&&Math.abs(tilt)>.55){dwell+=dt;if(dwell>.3)choose(tilt<0?0:1);}
 else dwell=0;
 ctx.clearRect(0,0,390,598);
 for(let i=0;i<2;i++){
  const x=i?285:105;avatar(ctx,choices[i],x,327,58,chosen===i?'#819a70':'#fff');drawName(ctx,choices[i],x,402,13);
  if(chosen===i){ctx.lineWidth=3;circle(ctx,x,327,63,null,'#819a70');}
  if(dwell>0&&((tilt<0?0:1)===i)){ctx.strokeStyle='#819a70';ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,327,64,-Math.PI/2,-Math.PI/2+clamp(dwell/.3,0,1)*Math.PI*2);ctx.stroke();}
 }
 text(ctx,"oppure",195,327,13,'#a49a8d','Georgia');
});

configure(()=>{refreshPrintedPaper();if($('.guide'))$('.guide').textContent=String(setting('GUIDE',"Inclina il telefono o tocca un amico"));});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n\n.count{top:30px;font:600 28px/1.2 Playful,UIBody,sans-serif;letter-spacing:0;color:#665c4d}\n.question{font:600 24px/1.35 Playful,UIBody,sans-serif}\n.guide{top:425px;font:400 18px/1.4 UIBody,system-ui,sans-serif;color:#6f6657}\n.tilt-enable{font:700 14px/1.3 UIBody,system-ui,sans-serif;min-height:44px}\n.result p{font-size:15px;line-height:1.7}\n";
  document.head.append(uiStyle);
})();
