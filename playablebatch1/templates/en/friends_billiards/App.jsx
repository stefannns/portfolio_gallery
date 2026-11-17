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

mount(`.shot-power{position:absolute;top:0;left:0;width:30px;height:96px;display:grid;place-items:center;z-index:7;pointer-events:none}.power-track{position:relative;width:9px;height:56px;border:1px solid #e0d4b550;border-radius:5px;background:#d9ceb025;overflow:hidden}.power-fill{position:absolute;inset:0;background:linear-gradient(to top,#62d879 0%,#e6dc59 46%,#f5a340 72%,#f15b4f 100%);clip-path:inset(100% 0 0)}.shot-power.at-max .power-track{border-color:#f8ac9a}.fit{background:#252b26;color:#e0d4b5}.hud{font-size:18px;top:34px;font-family:Georgia,serif}.guide{top:75px;font-size:14px;color:#d2c8ac;font-weight:500}.result{background:#eee4c9;color:#363729;border:5px solid #63513a;border-radius:8px}.pill{background:#355d4d}.bottom{bottom:18px}.reset{background:transparent;color:#cdbd9b;border:1px solid #b8a47a55;border-radius:50%;width:35px;min-height:35px;font-size:21px}`,`<canvas class="stage" aria-label="Friend billiards table"></canvas><div class="hud"><span class="pocketed">0 / 6</span><span class="shots">0 / 10</span></div><div class="shot-power" role="meter" aria-label="Shot power" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><div class="power-track"><div class="power-fill"></div></div></div><div class="guide">Pull back · release to shoot</div><div class="bottom"><button class="reset" aria-label="Reset table">↻</button></div>${resultMarkup()}`,'#252b26');
const {canvas,ctx}=stageCanvas();let balls=[],shots=0,pocketed=0,phase='ready',aim=null,moving=false,shotTime=0,pocketFlash=[],aimPointer=null,aimStart=null,aimPulled=false;
const MIN_PULL=8,MAX_PULL=70;
const SHOT_MIN_SPEED=104,SHOT_MAX_SPEED=806,RACK_SPACING=26.2,RACK_ROW_HEIGHT=RACK_SPACING*Math.sqrt(3)/2;
const powerFor=distance=>clamp((distance-MIN_PULL)/(MAX_PULL-MIN_PULL),0,1);
const powerMeter=$('.shot-power'),powerFill=$('.power-fill');
// Keep force information beside the stationary cue ball, inside the felt.
// Score nearby placements so the meter can swap sides around other balls.
function powerPosition(c){
 const width=30,height=96,candidates=[];
 for(const dx of [37,-37,57,-57,77,-77])for(const dy of [0,-30,30]){
  const x=clamp(c.x+dx-width/2,52,338-width),y=clamp(c.y-height/2+dy,132,500-height);
  let score=Math.abs(dx)*.03+Math.abs(dy)*.05;
  for(const ball of balls){
   const nearX=clamp(ball.x,x,x+width),nearY=clamp(ball.y,y,y+height);
   const clearance=Math.hypot(ball.x-nearX,ball.y-nearY)-ball.r-5;
   if(clearance<0)score+=(ball.cue?10000:100)+clearance*clearance;
  }
  candidates.push({x,y,score});
 }
 return candidates.reduce((best,p)=>p.score<best.score?p:best);
}
function updatePower(){
 const c=cue(),visible=!!c&&active&&!moving&&phase!=='result';
 powerMeter.hidden=!visible;
 const power=visible&&aim?powerFor(Math.hypot(c.x-aim.x,c.y-aim.y)):0;
 const clip='inset('+((1-power)*100).toFixed(1)+'% 0 0)',value=String(Math.round(power*100));
 if(powerFill.style.clipPath!==clip)powerFill.style.clipPath=clip;
 if(powerMeter.getAttribute('aria-valuenow')!==value)powerMeter.setAttribute('aria-valuenow',value);
 powerMeter.classList.toggle('at-max',power>=.999);
 if(visible){
  const position=powerPosition(c),transform=`translate(${position.x.toFixed(1)}px,${position.y.toFixed(1)}px)`;
  if(powerMeter.style.transform!==transform)powerMeter.style.transform=transform;
 }
}
function cancelAim(){
 const pointer=aimPointer;aim=null;aimPointer=null;aimStart=null;aimPulled=false;updatePower();
 try{if(pointer!==null&&canvas.hasPointerCapture(pointer))canvas.releasePointerCapture(pointer);}catch(_){}
}
// Compact visible mouths preserve the wooden rim; generous overlap capture stays forgiving.
const POCKET_OUTER_RADIUS=18,POCKET_INNER_RADIUS=14,POCKET_CAPTURE_RADIUS=29;
const holes=[[47,126],[343,126],[47,315],[343,315],[47,504],[343,504]];
const felt=document.createElement('canvas');felt.width=300;felt.height=380;const fc=felt.getContext('2d');fc.fillStyle='#1e5144';fc.fillRect(0,0,300,380);for(let i=0;i<18000;i++){fc.fillStyle=Math.random()<.5?'#37655128':'#112b2325';fc.fillRect(rand(0,300),rand(0,380),1,1);}
function reset(){balls=[{x:195,y:420,vx:0,vy:0,cue:true,r:13}];let i=0;for(let row=0;row<3;row++)for(let col=0;col<=row;col++)balls.push({x:195+(col-row/2)*RACK_SPACING,y:266-row*RACK_ROW_HEIGHT,vx:0,vy:0,r:13,type:i++});shots=0;pocketed=0;phase='ready';moving=false;cancelAim();pocketFlash=[];$('.pocketed').textContent='0 / 6';$('.shots').textContent='0 / 10';state('ready');}
function end(won){phase='result';cancelAim();updatePower();won?success():fail();result(won?'Table cleared':'Good shooting',pocketed+' / 6',`${shots} shots · ${pocketed===6?'Every friend is home.':'Another rack?'}`,reset);}
function cue(){return balls.find(b=>b.cue);}
function busy(){return balls.some(b=>Math.hypot(b.vx,b.vy)>4);}
// Full power still needs only70 logical pixels of pull.
// Own one pointer until release; canvas capture plus window listeners keep an outside drag alive.
function aimPoint(e){
 if(!Number.isFinite(e.clientX)||!Number.isFinite(e.clientY))return null;
 const p=point(e);return Number.isFinite(p.x)&&Number.isFinite(p.y)?p:null;
}
function moveAim(e){
 if(e.pointerId!==aimPointer||!aim)return;
 if(!active||disposed||document.hidden||moving||phase==='result'){cancelAim();return;}
 // A missed mouseup outside the browser must not leave a stale armed drag.
 if(e.pointerType==='mouse'&&e.buttons===0){finishAim(e,true);return;}
 const p=aimPoint(e);if(!p)return;
 aim=p;const c=cue();
 if(c&&aimStart&&Math.hypot(p.x-aimStart.x,p.y-aimStart.y)>=3&&Math.hypot(c.x-p.x,c.y-p.y)>=MIN_PULL)aimPulled=true;
 e.preventDefault();updatePower();
}
function finishAim(e,interrupted=false){
 if(e.pointerId!==aimPointer||!aim)return;
 if(!active||disposed||document.hidden||moving||phase==='result'){cancelAim();return;}
 const c=cue(),p=interrupted?aim:(aimPoint(e)||aim),deliberate=aimPulled;
 if(!c){cancelAim();return;}
 const dx=c.x-p.x,dy=c.y-p.y,distance=Math.hypot(dx,dy);
 // Clear identity before releasing capture: its lostcapture event and duplicate releases are inert.
 cancelAim();
 if(distance<MIN_PULL||(interrupted&&!deliberate))return;
 e.preventDefault();gesture();const speed=SHOT_MIN_SPEED+(SHOT_MAX_SPEED-SHOT_MIN_SPEED)*powerFor(distance);
 c.vx=dx/distance*speed;c.vy=dy/distance*speed;
 shots++;$('.shots').textContent=shots+' / 10';moving=true;shotTime=0;phase='playing';state('playing');updatePower();
 sound(170,.06,.19,'triangle',80);root.dataset.shots=shots;
}
on(canvas,'pointerdown',e=>{
 if(!active||disposed||document.hidden||moving||phase==='result'||aimPointer!==null||e.button!==0)return;
 const p=aimPoint(e),c=cue();if(!p||!c||Math.hypot(p.x-c.x,p.y-c.y)>65)return;
 aim=p;aimStart=p;aimPulled=false;aimPointer=e.pointerId;
 // Some embedded browsers lose/deny capture; window release remains a valid fallback.
 try{canvas.setPointerCapture(e.pointerId);}catch(_){}
 e.preventDefault();gesture();updatePower();
});
on(window,'pointermove',moveAim,{capture:true,passive:false});
on(window,'pointerup',e=>finishAim(e),{capture:true,passive:false});
on(window,'pointercancel',e=>finishAim(e,true),{capture:true,passive:false});
on(canvas,'lostpointercapture',e=>{
 if(e.pointerId!==aimPointer||!aim)return;
 if(!active||disposed||document.hidden||moving||phase==='result'){cancelAim();return;}
 // Capture transfer alone is not a cancelled shot; keep following the owned pointer.
 try{canvas.setPointerCapture(e.pointerId);if(canvas.hasPointerCapture(e.pointerId))return;}catch(_){}
 finishAim(e,true);
});
lifecycle.push(next=>{if(!next)cancelAim();});
cleanups.push(cancelAim);
on($('.reset'),'click',()=>{gesture();reset();});reset();let collisionCooldown=0;
loop(dt=>{collisionCooldown=Math.max(0,collisionCooldown-dt);if(moving&&phase!=='result'){shotTime+=dt;const fastest=balls.reduce((m,b)=>Math.max(m,Math.hypot(b.vx,b.vy)),0),steps=Math.max(4,Math.ceil(fastest*dt/4));for(let k=0;k<steps;k++){const d=dt/steps;for(const b of [...balls]){b.x+=b.vx*d;b.y+=b.vy*d;const damp=Math.exp(-1.05*d);b.vx*=damp;b.vy*=damp;const hole=holes.find(([x,y])=>Math.hypot(b.x-x,b.y-y)<POCKET_CAPTURE_RADIUS);if(hole){pocketFlash.push({x:hole[0],y:hole[1],life:.35});balls=balls.filter(q=>q!==b);if(!b.cue){pocketed++;$('.pocketed').textContent=pocketed+' / 6';sound(220,.1,.13,'sine',90);}continue;}if(b.x<60){b.x=60;b.vx=Math.abs(b.vx)*.85;}if(b.x>330){b.x=330;b.vx=-Math.abs(b.vx)*.85;}if(b.y<138){b.y=138;b.vy=Math.abs(b.vy)*.85;}if(b.y>492){b.y=492;b.vy=-Math.abs(b.vy)*.85;}}
 for(let i=0;i<balls.length;i++)for(let j=i+1;j<balls.length;j++){const a=balls[i],b=balls[j],dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy);if(dist>=26||dist<.001)continue;const nx=dx/dist,ny=dy/dist,over=(26-dist)/2+.01;a.x-=nx*over;a.y-=ny*over;b.x+=nx*over;b.y+=ny*over;const approach=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;if(approach<0){const impulse=-approach*.96;a.vx-=impulse*nx;a.vy-=impulse*ny;b.vx+=impulse*nx;b.vy+=impulse*ny;if(collisionCooldown===0&&Math.abs(approach)>35){sound(1100,.025,.08,'triangle');collisionCooldown=.05;}}}}
 if(shotTime>.3&&!busy()){moving=false;for(const b of balls){b.vx=0;b.vy=0;}if(pocketed===6)end(true);else if(shots>=10)end(false);else if(!cue()){const p={x:195,y:420,vx:0,vy:0,r:13,cue:true};while(balls.some(b=>Math.hypot(b.x-p.x,b.y-p.y)<30)&&p.y<480)p.y+=15;balls.push(p);}}}
 updatePower();
 ctx.fillStyle='#252b26';ctx.fillRect(0,0,390,598);ctx.shadowColor='#0009';ctx.shadowBlur=16;ctx.shadowOffsetY=7;round(ctx,23,104,344,422,17,'#4c3827','#8f7952');ctx.shadowBlur=0;ctx.shadowOffsetY=0;const wood=ctx.createLinearGradient(25,0,365,0);wood.addColorStop(0,'#8a6842');wood.addColorStop(.3,'#4d3929');wood.addColorStop(.7,'#59422b');wood.addColorStop(1,'#9c8056');round(ctx,28,109,334,412,14,wood);round(ctx,40,119,310,390,9,'#315a49');ctx.drawImage(felt,48,127,294,378);line(ctx,195,137,195,497,'#aac0a609',1);for(const y of [170,222,274,356,408,460])for(const x of [32,357]){ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);ctx.fillStyle='#c9bd9a';ctx.fillRect(-2,-2,4,4);ctx.restore();}for(const [x,y] of holes){circle(ctx,x,y,POCKET_OUTER_RADIUS,'#171a15','#5a5139');circle(ctx,x,y,POCKET_INNER_RADIUS,'#0b1210');}for(const b of balls){ctx.save();ctx.shadowColor='#06130c88';ctx.shadowBlur=5;ctx.shadowOffsetY=3;if(b.cue)circle(ctx,b.x,b.y,13,'#e9e8da','#e1e1d2');else avatar(ctx,b.type,b.x,b.y,13,'#e5e1d1');ctx.restore();circle(ctx,b.x-3,b.y-4,3,'#ffffff44');}const c=cue();if(aim&&c){const dx=c.x-aim.x,dy=c.y-aim.y,l=Math.max(1,Math.hypot(dx,dy)),nx=dx/l,ny=dy/l,pull=Math.min(l,MAX_PULL);ctx.save();ctx.setLineDash([3,6]);line(ctx,c.x+nx*18,c.y+ny*18,c.x+nx*150,c.y+ny*150,'#e9e7c680',1);ctx.restore();line(ctx,c.x-nx*(18+pull*.3),c.y-ny*(18+pull*.3),c.x-nx*(130+pull*.3),c.y-ny*(130+pull*.3),'#bfac74',4);line(ctx,c.x-nx*(18+pull*.3),c.y-ny*(18+pull*.3),c.x-nx*(30+pull*.3),c.y-ny*(30+pull*.3),'#e8e4d6',3);}for(const p of pocketFlash){p.life-=dt;ctx.globalAlpha=p.life/.35;circle(ctx,p.x,p.y,POCKET_OUTER_RADIUS+1-p.life*5,null,'#b9cda5');ctx.globalAlpha=1;}pocketFlash=pocketFlash.filter(p=>p.life>0);});

configure(()=>{if($('.guide'))$('.guide').textContent=String(setting('GUIDE',"Pull back from the cue ball \u00b7 release to shoot"));});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n\n.hud{font:700 28px/1.2 Georgia,serif;top:30px}\n.guide{top:150px;font:400 18px/1.4 UIBody,system-ui,sans-serif;color:#eee2c6}\n.bottom{top:30px;bottom:auto;justify-content:center;pointer-events:none}\n.bottom .reset{pointer-events:auto;width:44px;height:44px;min-height:44px;padding:0;font-size:24px;border-color:#d0bd8b99}\n.result h2{font-family:Georgia,serif}\n";
  document.head.append(uiStyle);
})();
