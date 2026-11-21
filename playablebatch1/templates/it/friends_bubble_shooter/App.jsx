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
 const fit=$('.fit'),modal=$('.modal'),base='#e1ebef';
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
mount(`.fit{background:transparent}.guide{top:76px;font-size:16px;color:#768899}.hud{top:27px;color:#64768d;font-family:Playful,Arial}.result{background:#fff4fa}.pill{background:#8c83b8}.bottom{bottom:20px}`,`<canvas class="stage" aria-label="Bolle degli amici"></canvas><div class="hud center"><span class="score">0</span></div><div class="guide">Mira · rilascia · abbina tre</div><div class="bottom"><button class="capability reset" aria-label="Ricomincia">↻</button></div>${resultMarkup()}`,'#e1ebef');
const refreshPrintedPaper=installPrintedPaper();
const {canvas,ctx}=stageCanvas();let bubbles=[],shot=null,aim={x:195,y:200},aiming=false,current=0,score=0,misses=0,phase='ready',particles=[];
const R=20,X=39,Y=138,DX=43,DY=37;
function loc(r,c){return{x:X+c*DX+(r%2)*DX/2,y:Y+r*DY};}
function exists(r,c){return bubbles.find(b=>b.r===r&&b.c===c);}
function neighbors(b){return bubbles.filter(n=>n!==b&&Math.hypot(loc(n.r,n.c).x-loc(b.r,b.c).x,loc(n.r,n.c).y-loc(b.r,b.c).y)<45);}
function reset(){bubbles=[];for(let r=0;r<4;r++)for(let c=0;c<(r%2?7:8);c++)bubbles.push({r,c,type:Math.floor(Math.random()*Math.min(4,friends.length))});shot=null;current=0;score=0;misses=0;phase='ready';particles=[];$('.score').textContent='0';state('ready');}
function settle(){const options=[];for(let r=0;r<10;r++)for(let c=0;c<(r%2?7:8);c++){if(exists(r,c))continue;const p=loc(r,c);if(r===0||bubbles.some(b=>Math.hypot(loc(b.r,b.c).x-p.x,loc(b.r,b.c).y-p.y)<45))options.push({r,c,d:Math.hypot(p.x-shot.x,p.y-shot.y)});}options.sort((a,b)=>a.d-b.d);const pos=options[0];if(!pos){end(false);return;}const added={r:pos.r,c:pos.c,type:shot.type};bubbles.push(added);shot=null;const group=[],todo=[added],visited=new Set();while(todo.length){const b=todo.pop();if(visited.has(b))continue;visited.add(b);group.push(b);todo.push(...neighbors(b).filter(n=>n.type===added.type));}if(group.length>=3){const removed=new Set(group);bubbles=bubbles.filter(b=>!removed.has(b));const attached=new Set(),queue=bubbles.filter(b=>b.r===0);while(queue.length){const b=queue.pop();if(attached.has(b))continue;attached.add(b);queue.push(...neighbors(b));}const floating=bubbles.filter(b=>!attached.has(b));bubbles=bubbles.filter(b=>attached.has(b));for(const b of [...group,...floating]){const p=loc(b.r,b.c);particles.push({...p,type:b.type,vy:rand(40,100),life:.5});}score+=(group.length+floating.length)*10;$('.score').textContent=score;misses=0;sound(700,.1,.15);}else misses++;if(misses>=5){for(const b of bubbles)b.r++;for(let c=0;c<8;c++)bubbles.push({r:0,c,type:Math.floor(Math.random()*Math.min(4,friends.length))});misses=0;}current=Math.floor(Math.random()*Math.min(4,friends.length));root.dataset.bubbles=bubbles.length;if(!bubbles.length)end(true);else if(bubbles.some(b=>loc(b.r,b.c).y>450))end(false);}
function end(won){phase='result';won?success():fail();result(won?"Tutto libero!":"Quasi!",score,won?"Hai liberato tutte le bolle degli amici.":"Tieni le bolle sopra la linea.",reset);}
on(canvas,'pointerdown',e=>{if(shot||phase==='result')return;const p=point(e);if(p.y>535||p.y<102)return;aiming=true;aim=p;canvas.setPointerCapture(e.pointerId);});on(canvas,'pointermove',e=>{if(aiming)aim=point(e);});on(canvas,'pointerup',()=>{if(!aiming)return;aiming=false;gesture();const dx=aim.x-195,dy=Math.min(-50,aim.y-506),l=Math.hypot(dx,dy);shot={x:195,y:506,vx:dx/l*450,vy:dy/l*450,type:current};phase='playing';state('playing');sound(300,.06,.13,'sine',450);});on(canvas,'pointercancel',()=>aiming=false);on($('.reset'),'click',()=>{gesture();reset();});reset();
loop(dt=>{if(shot&&phase!=='result'){const steps=4;for(let k=0;k<steps&&shot;k++){shot.x+=shot.vx*dt/steps;shot.y+=shot.vy*dt/steps;if(shot.x<R+21){shot.x=R+21;shot.vx=Math.abs(shot.vx);}if(shot.x>369-R){shot.x=369-R;shot.vx=-Math.abs(shot.vx);}if(shot.y<=Y||bubbles.some(b=>{const p=loc(b.r,b.c);return Math.hypot(shot.x-p.x,shot.y-p.y)<R*2-2;}))settle();}}for(const p of particles){p.life-=dt;p.y+=p.vy*dt;p.vy+=500*dt;}particles=particles.filter(p=>p.life>0);ctx.clearRect(0,0,390,598);ctx.save();ctx.setLineDash([3,5]);line(ctx,30,461,360,461,'#b1bdc9',1);ctx.restore();for(const b of bubbles){const p=loc(b.r,b.c);avatar(ctx,b.type,p.x,p.y,R,'#fcfcff');}for(const p of particles){ctx.globalAlpha=p.life*2;avatar(ctx,p.type,p.x,p.y,R);ctx.globalAlpha=1;}avatar(ctx,current,195,506,R,'#fff');if(shot)avatar(ctx,shot.type,shot.x,shot.y,R);if(aiming){const dx=aim.x-195,dy=Math.min(-50,aim.y-506),l=Math.hypot(dx,dy);ctx.save();ctx.setLineDash([2,8]);line(ctx,195,481,195+dx/l*120,506+dy/l*120,'#8395ad',3);ctx.restore();}round(ctx,148,525,94,5,3,'#a4bdd0');});

configure(()=>{refreshPrintedPaper();if($('.guide'))$('.guide').textContent=String(setting('GUIDE',"Mira · rilascia · abbina tre amici"));});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n\n.guide{top:76px;font-size:18px;color:#53677f}\n.bottom{top:30px;bottom:auto;justify-content:flex-end;pointer-events:none}\n.bottom .reset{pointer-events:auto;width:44px;height:44px;padding:0;border-radius:50%;font-size:24px;background:#fff;color:#64768d;border:1px solid #7d94b666}\n";
  document.head.append(uiStyle);
})();
