import Matter from 'matter-js';
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

// The host owns access to friend profiles. Samples are local review fallbacks.
let friends=[{nickname:'Bean',avatar:'./assets/friend-bean.webp'},{nickname:'Kitty',avatar:'./assets/friend-kitty.webp'},{nickname:'Cloudy',avatar:'./assets/friend-cloudy.webp'},{nickname:'Starry',avatar:'./assets/friend-starry.webp'}];
let friendsChanged=()=>{};
function loadFriends(){
 function preload(list,host){friends=list.slice(0,24).map(f=>({nickname:String(f.nickname||'Friend'),avatar:f.avatar,image:null}));for(const f of friends){let im;try{im=host?window.tt.createImage():new Image();im.onload=()=>{f.image=im;friendsChanged();};im.onerror=()=>{f.image=null;};im.src=f.avatar;}catch(_){f.image=null;}}friendsChanged();}
 preload(friends,false);root.dataset.friends='sample';
 if(!window.tt?.getFriendsInfo||!window.tt?.createImage)return;
 window.tt.getFriendsInfo({success(data){const list=Array.isArray(data?.friends)?data.friends.filter(f=>f&&typeof f.avatar==='string'):[];if(list.length){preload(list,true);root.dataset.friends='host';}},fail(){root.dataset.friends='sample';}});
}
function avatar(ctx,index,x,y,r,ring='#fff'){
 const f=friends[((index%friends.length)+friends.length)%friends.length];ctx.save();ctx.shadowColor='#25212d20';ctx.shadowBlur=6;circle(ctx,x,y,r,ring);ctx.shadowBlur=0;if(f?.image)cropCircle(ctx,f.image,x,y,Math.max(1,r-2));else{circle(ctx,x,y,Math.max(1,r-2),['#efb5a9','#b3d6ce','#e3cb8f','#c6b8df'][index%4]);text(ctx,Array.from(f?.nickname||'?')[0],x,y,r*.7,'#fff');}ctx.restore();
}
function friendName(index){return friends[((index%friends.length)+friends.length)%friends.length]?.nickname||'Friend';}
function drawName(ctx,index,x,y,size=13){text(ctx,Array.from(friendName(index)).slice(0,15).join(''),x,y,size);}
loadFriends();

// Full-host printed paper; gameplay remains on its existing 390 × 598 stage.
function installPrintedPaper(){
 const fit=$('.fit'),modal=$('.modal'),base='#dce9de';
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
mount(`.fit{background:transparent}.hud{font-family:Playful,Arial;color:#42736c}.guide{top:91px;font-size:16px;color:#5d8277}.result{background:#eff5e9}.pill{background:#4b8077}.next{position:absolute;top:130px;right:45px;font-size:9px;font-weight:700;letter-spacing:1px;color:#69857a}.bottom{bottom:25px}`,`<canvas class="stage" aria-label="Drop and merge friend avatars"></canvas><div class="hud center"><span class="score">0</span></div><div class="guide">Drop a friend · match two to merge</div><div class="next">NEXT</div><div class="bottom"><button class="capability reset" aria-label="Reset game">↻</button></div>${resultMarkup()}`,'#dce9de');
const refreshPrintedPaper=installPrintedPaper();
const {canvas,ctx}=stageCanvas(),engine=Matter.Engine.create({gravity:{x:0,y:1.2}});engine.positionIterations=10;engine.velocityIterations=8;
let balls=[],mergeQueue=[],pending=new Set(),score=0,aim=195,next=0,cooldown=0,phase='ready',accum=0,overflow=0;
const radii=[19,28,39,53,69,86,105],maxLevel=5;
function addBall(x,y,level){const b=Matter.Bodies.circle(x,y,radii[level],{restitution:.25,friction:.25,frictionStatic:.4,frictionAir:.002,density:.0015});b.level=level;b.born=engine.timing.timestamp;balls.push(b);Matter.World.add(engine.world,b);return b;}
function reset(){Matter.World.clear(engine.world,false);Matter.Engine.clear(engine);balls=[];mergeQueue=[];pending.clear();score=0;aim=195;next=0;cooldown=0;phase='ready';overflow=0;const walls=[Matter.Bodies.rectangle(25,337,16,340,{isStatic:true}),Matter.Bodies.rectangle(365,337,16,340,{isStatic:true}),Matter.Bodies.rectangle(195,505,350,16,{isStatic:true})];Matter.World.add(engine.world,walls);addBall(124,472,0);addBall(234,463,1);$('.score').textContent='0';state('ready');}
Matter.Events.on(engine,'collisionStart',event=>{for(const pair of event.pairs){const a=pair.bodyA,b=pair.bodyB;if(a.level===undefined||b.level===undefined||a.level!==b.level||a.level>=maxLevel||pending.has(a.id)||pending.has(b.id))continue;pending.add(a.id);pending.add(b.id);mergeQueue.push([a,b]);}});
function drop(){if(cooldown>0||phase==='result')return;gesture();phase='playing';state('playing');addBall(clamp(aim,35+radii[next],355-radii[next]),150,next);next=Math.random()<.72?0:1;cooldown=.6;sound(340,.05,.11,'triangle');root.dataset.drops=String(Number(root.dataset.drops||0)+1);}
on(canvas,'pointerdown',e=>{const p=point(e);if(p.y<105||p.y>500)return;aim=clamp(p.x,55,335);canvas.setPointerCapture(e.pointerId);root.dataset.aiming='true';});on(canvas,'pointermove',e=>{if(root.dataset.aiming==='true')aim=clamp(point(e).x,55,335);});on(canvas,'pointerup',()=>{if(root.dataset.aiming==='true'){root.dataset.aiming='false';drop();}});on(canvas,'pointercancel',()=>root.dataset.aiming='false');on($('.reset'),'click',()=>{gesture();reset();});reset();
loop(dt=>{cooldown=Math.max(0,cooldown-dt);if(phase!=='result'){accum+=dt;while(accum>=1/120){Matter.Engine.update(engine,1000/120);accum-=1/120;}for(const [a,b] of mergeQueue.splice(0)){if(!balls.includes(a)||!balls.includes(b))continue;const x=(a.position.x+b.position.x)/2,y=(a.position.y+b.position.y)/2;Matter.World.remove(engine.world,[a,b]);balls=balls.filter(q=>q!==a&&q!==b);const n=addBall(x,y,a.level+1);Matter.Body.setVelocity(n,{x:(a.velocity.x+b.velocity.x)*.2,y:-.7});score+=2**(a.level+2);$('.score').textContent=score;sound(470+a.level*100,.09,.14);pending.delete(a.id);pending.delete(b.id);}const high=balls.some(b=>engine.timing.timestamp-b.born>1600&&b.position.y-radii[b.level]<191&&b.speed<1.1);overflow=high?overflow+dt:0;if(overflow>1.2){phase='result';fail();result('Full of friends',score,'Keep matching to make a little more room.',reset);}}
 ctx.clearRect(0,0,390,598);round(ctx,31,165,328,340,10,'#f5faf650','#a0bdb0');ctx.save();ctx.setLineDash([4,5]);line(ctx,38,192,352,192,'#abaf9e',1);ctx.restore();avatar(ctx,next,321,144,11,'#fff');if(phase!=='result'&&cooldown<=0){ctx.globalAlpha=.75;avatar(ctx,next,aim,137,radii[next],'#fff');ctx.globalAlpha=1;ctx.save();ctx.setLineDash([3,6]);line(ctx,aim,159,aim,190,'#87aaa0',1);ctx.restore();}for(const b of balls){ctx.save();ctx.translate(b.position.x,b.position.y);ctx.rotate(b.angle);avatar(ctx,b.level,0,0,radii[b.level],['#fff','#e3e9c5','#e2c5c5','#c3d2e5','#e4cd9b','#b8d5c3'][b.level]);ctx.restore();}root.dataset.balls=balls.length;});cleanups.push(()=>{Matter.Events.off(engine);Matter.World.clear(engine.world,false);Matter.Engine.clear(engine);});

configure(()=>{refreshPrintedPaper();if($('.guide'))$('.guide').textContent=String(setting('GUIDE',"Drop a friend \u00b7 match two to merge"));});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n\n.guide{top:91px;font-size:18px;color:#3c6558}.next{font-size:12px;letter-spacing:.8px;color:#456c5e;top:127px}\n.bottom{top:30px;bottom:auto;justify-content:flex-end;pointer-events:none}\n.bottom .reset{pointer-events:auto;width:44px;height:44px;min-height:44px;padding:0;border-radius:50%;font-size:24px;background:#f6fbf7;color:#42736c;border:1px solid #648b7e66}\n";
  document.head.append(uiStyle);
})();
