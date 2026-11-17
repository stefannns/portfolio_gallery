import * as THREE from 'three';
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

mount(`.spin-control{position:absolute;left:30px;bottom:132px;width:64px;z-index:10;text-align:center;user-select:none}.spin-ball{position:relative;width:64px;height:64px;border:2px solid #d4dfef;border-radius:50%;background:radial-gradient(circle at 30% 25%,#7587aa,#303f65 55%,#18233e);box-shadow:0 3px 8px #0005;touch-action:none;cursor:ew-resize}.spin-ball:focus-visible{outline:3px solid #f6deb1;outline-offset:4px}.spin-ball[aria-disabled="true"]{opacity:.45;cursor:default}.spin-ball:before,.spin-ball:after{content:"";position:absolute;width:5px;height:7px;border-radius:50%;background:#17223d;top:11px;left:22px}.spin-ball:after{left:33px;top:13px}.spin-line{position:absolute;left:9px;right:9px;top:29px;height:1px;background:#d9e7fa80}.spin-dot{position:absolute;width:14px;height:14px;left:calc(50% - 7px);top:calc(50% - 7px);border-radius:50%;background:#f9edcc;box-shadow:0 1px 4px #0007;border:1px solid #fff}.spin-label{margin-top:5px;color:#f0dfbd;font:600 12px/1.3 UIBody,Arial,sans-serif;text-shadow:0 1px 3px #000}.fit{background:#28231f;color:#eee5d2}.scene{position:absolute;inset:0}.scene canvas{display:block;width:390px;height:598px;touch-action:none}.hud{font-size:23px;font-family:Georgia,serif;text-shadow:0 2px 5px #000}.guide{top:106px;font-size:16px;font-weight:500;color:#f0dfbd;text-shadow:0 1px 5px #000}.roll-note{position:absolute;left:30px;right:30px;bottom:35px;text-align:center;font-size:12px;color:#f2e4ca;text-shadow:0 1px 3px #241a10;pointer-events:none}.result{background:#efe3c9;color:#4b3e2c;border-radius:12px;border:4px solid #7f6846}.result .pill{background:#886a3c}`,`<div class="scene"></div><div class="spin-control"><div class="spin-ball" role="slider" tabindex="0" aria-label="Side spin" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0" aria-valuetext="Straight"><span class="spin-line"></span><span class="spin-dot"></span></div><div class="spin-label">Spin</div></div><div class="hud"><span class="frame">1 / 10</span><span class="score">0</span></div><div class="guide">Swipe up to bowl</div><div class="roll-note">First roll</div>${resultMarkup()}`,'#28231f');
const PHYSICS_STEP=1/120,HOOK_STRENGTH=.013,PIT_START=-15.25,PIT_END=-19.7;
let physicsAccumulator=0,sideSpin=0,rollSpin=0,spinPointer=null,aimEnd=null,aimForward=null,ballDrop=0,ballDropVelocity=0;
// One action-specific cue stays until the first forward roll, not a stray tap.
let hasRolled=false;
const rollGuide=$('.guide');rollGuide.classList.add('bowl-roll-guide');
rollGuide.innerHTML=`<span class="bowl-guide-copy">Swipe forward to roll</span><svg class="bowl-swipe" viewBox="0 0 90 180" aria-hidden="true"><path d="M45 146V27m-12 14 12-14 12 14" fill="none" stroke="#fff9ec" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="5 7" opacity=".65"/><g transform="translate(23 129)"><g class="bowl-swipe-hand"><path d="M15 38 5 25c-4-6 3-10 7-5l4 5V4c0-6 8-6 8 0v14-5c0-5 7-5 7 0v5-2c0-5 7-5 7 0v4-1c0-5 7-4 7 1v11c0 7-4 11-5 17H21c0-4-3-7-6-10Z" fill="#fffdf3" stroke="#25323d" stroke-width="1.8" stroke-linejoin="round"/><path d="M24 19v10m7-11v12m7-9v10" fill="none" stroke="#25323d" stroke-width="1.1" stroke-linecap="round"/></g></g></svg>`;
const rollGuideStyle=document.createElement('style');
rollGuideStyle.textContent=`#root .bowl-roll-guide{top:280px;left:30px;right:30px;height:216px;display:flex;flex-direction:column;align-items:center;color:#fff9ec;font:700 18px/1.4 UIBody,system-ui,sans-serif;text-shadow:0 2px 4px #13202c,0 0 2px #13202c}#root .bowl-guide-copy{display:block;flex:none;width:100%;text-wrap:balance}#root .bowl-swipe{display:block;flex:1;width:90px;height:auto;min-height:70px;max-height:180px;margin:6px auto 0;overflow:visible;pointer-events:none}[data-bowling-active="false"] .bowl-roll-guide{animation-play-state:paused}.bowl-swipe-hand{animation:bowl-swipe-forward 1.9s ease-in-out infinite;transform-origin:center}#root .guide.gone .bowl-swipe-hand,#root[data-bowling-active="false"] .bowl-swipe-hand{animation-play-state:paused}@keyframes bowl-swipe-forward{0%,10%{opacity:0;transform:translateY(7px) scale(.94)}20%{opacity:1;transform:translateY(0) scale(1)}70%{opacity:1;transform:translateY(-89px) scale(1)}86%,100%{opacity:0;transform:translateY(-89px) scale(1)}}@media(prefers-reduced-motion:reduce){.bowl-swipe-hand{animation:none;opacity:1;transform:none}}`;
document.head.append(rollGuideStyle);root.dataset.bowlingActive=String(active);
lifecycle.push(next=>{root.dataset.bowlingActive=String(next);});
function remindRoll(){if(!hasRolled&&phase!=='result')rollGuide.classList.remove('gone');}
const scene=new THREE.Scene();scene.background=new THREE.Color('#28231f');scene.fog=new THREE.Fog('#28231f',30,55);const cam=new THREE.PerspectiveCamera(45,390/598,.1,70);cam.position.set(0,6.5,10);cam.lookAt(0,0,-6.5);const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});renderer.setSize(390,598);renderer.setPixelRatio(Math.min(2,devicePixelRatio||1));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;$('.scene').append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffe8bf,0x252426,2.1));for(const z of [4,-5,-12]){const l=new THREE.PointLight(0xffe8b8,25,18,2);l.position.set(0,5,z);scene.add(l);}const key=new THREE.DirectionalLight(0xffffff,2);key.position.set(2,7,-8);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-5;key.shadow.camera.right=5;key.shadow.camera.top=8;key.shadow.camera.bottom=-8;scene.add(key);
const grain=document.createElement('canvas');grain.width=512;grain.height=1024;const gx=grain.getContext('2d');gx.fillStyle='#b68d54';gx.fillRect(0,0,512,1024);for(let x=0;x<512;x+=32){gx.fillStyle=['#caa16a','#b18b56','#bc965f','#d0aa76'][Math.floor(x/32)%4];gx.fillRect(x,0,31,1024);gx.strokeStyle='#83643b38';gx.lineWidth=1;for(let j=0;j<18;j++){const xx=x+rand(0,31);gx.beginPath();gx.moveTo(xx,0);gx.bezierCurveTo(xx+rand(-3,3),300,xx+rand(-3,3),700,xx,1024);gx.stroke();}for(let y=rand(0,150);y<1024;y+=rand(150,300)){gx.fillStyle='#84623e55';gx.fillRect(x,y,31,1);}}const map=new THREE.CanvasTexture(grain);map.colorSpace=THREE.SRGBColorSpace;map.wrapT=THREE.RepeatWrapping;map.repeat.set(1,3);
function box(w,h,d,x,y,z,mat){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);o.position.set(x,y,z);o.receiveShadow=true;scene.add(o);return o;}
// The deck ends at a recessed pit with one wall at its rear boundary.
box(3.15,.18,24.25,0,-.12,-3.125,new THREE.MeshStandardMaterial({map,roughness:.48,metalness:.02}));
const side=new THREE.MeshStandardMaterial({color:'#29251f',roughness:.5});
for(const x of [-1.8,1.8]){
 box(.42,.1,29,x,-.14,-5.5,side);
 box(.08,.22,29,x+Math.sign(x)*.23,-.04,-5.5,new THREE.MeshStandardMaterial({color:'#624e36',roughness:.35}));
}
const floorMat=new THREE.MeshStandardMaterial({color:'#39352d',roughness:.9});
box(18,.3,35.25,0,-.4,2.375,floorMat);
for(const x of [-5.4,5.4])box(7.2,.3,15,x,-.4,-22.75,floorMat);
box(18,.3,10,0,-.4,-25.25,floorMat);
const pitMat=new THREE.MeshStandardMaterial({color:'#101317',roughness:.95});
box(3.55,.12,4.9,0,-.85,-17.7,pitMat);
// A single modest wall meets the rear edge of the pit; no side enclosure.
box(4.3,2.5,.2,0,.4,-20.15,new THREE.MeshStandardMaterial({color:'#25282d',roughness:.9}));
for(const x of [-1.4,-.9,-.45,0,.45,.9,1.4]){const mark=new THREE.Mesh(new THREE.ConeGeometry(.055,.2,3),new THREE.MeshBasicMaterial({color:'#665338'}));mark.rotation.x=-Math.PI/2;mark.position.set(x,.01,-2);scene.add(mark);}
const pinTexture=document.createElement('canvas');pinTexture.width=32;pinTexture.height=256;const px=pinTexture.getContext('2d');px.fillStyle='#fffdf5';px.fillRect(0,0,32,256);px.fillStyle='#b7423b';px.fillRect(0,175,32,11);px.fillRect(0,193,32,11);const pm=new THREE.CanvasTexture(pinTexture);pm.colorSpace=THREE.SRGBColorSpace;const pinMat=new THREE.MeshStandardMaterial({map:pm,roughness:.25});const pinPoints=[[.07,0],[.12,.04],[.16,.2],[.145,.35],[.09,.5],[.055,.64],[.055,.73],[.1,.79],[.105,.87],[.07,.94],[0,.98]].map(([x,y])=>new THREE.Vector2(x,y)),pinGeo=new THREE.LatheGeometry(pinPoints,24);
const engine=Matter.Engine.create({gravity:{x:0,y:0}});let pins=[],ballBody=null,ballAvatarTexture=null,aimStart=null,aimPointer=null,rollTimer=0,rolling=false,phase='ready',frames=[],currentFrame=[],frameIndex=0,settleDelay=0,rack=true,pinSound=0;
const BALL_RADIUS=.29;
const ball=new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS,40,28),new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.22,metalness:.1}));
ball.castShadow=true;scene.add(ball);
// The avatar is painted on the sphere itself, so it rolls around the ball's surface.
function updateBallAvatar(){
 const c=document.createElement('canvas');c.width=1024;c.height=512;const x=c.getContext('2d');
 x.fillStyle='#303f65';x.fillRect(0,0,1024,512);
 x.fillStyle='#a7bedc';x.fillRect(0,78,1024,10);x.fillRect(0,424,1024,10);
 avatar(x,0,256,256,112,'#eee5d2');avatar(x,0,768,256,112,'#eee5d2');
 const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
 ball.material.map=texture;ball.material.needsUpdate=true;
 ballAvatarTexture?.dispose();ballAvatarTexture=texture;
}
friendsChanged=updateBallAvatar;updateBallAvatar();
const rollingAxis=new THREE.Vector3(),rollingTurn=new THREE.Quaternion(),sideSpinAxis=new THREE.Vector3(0,1,0);
const trajectoryGroup=new THREE.Group();trajectoryGroup.visible=false;scene.add(trajectoryGroup);
const trajectoryGeometry=new THREE.BufferGeometry();
// Round, screen-sized dots remain readable all the way to the far pins.
const trajectoryDotCanvas=document.createElement('canvas');trajectoryDotCanvas.width=trajectoryDotCanvas.height=32;
const trajectoryDotBrush=trajectoryDotCanvas.getContext('2d');trajectoryDotBrush.fillStyle='#fff';trajectoryDotBrush.beginPath();trajectoryDotBrush.arc(16,16,14,0,Math.PI*2);trajectoryDotBrush.fill();
const trajectoryDotTexture=new THREE.CanvasTexture(trajectoryDotCanvas);trajectoryDotTexture.minFilter=THREE.LinearFilter;
const trajectoryPositions=new Float32Array(128*3);
trajectoryGeometry.setAttribute('position',new THREE.BufferAttribute(trajectoryPositions,3).setUsage(THREE.DynamicDrawUsage));trajectoryGeometry.setDrawRange(0,0);
const trajectoryMaterial=new THREE.PointsMaterial({color:'#ffffff',map:trajectoryDotTexture,size:6,sizeAttenuation:false,transparent:true,opacity:1,alphaTest:.08,depthWrite:false,toneMapped:false});
const trajectoryLine=new THREE.Points(trajectoryGeometry,trajectoryMaterial);trajectoryLine.frustumCulled=false;trajectoryGroup.add(trajectoryLine);
const projectedDotA=new THREE.Vector3(),projectedDotB=new THREE.Vector3();
function paintTrajectoryDots(points){
 cam.updateMatrixWorld();let count=0,nextDot=0;
 for(let i=1;i<points.length&&count<128;i++){
  const a=points[i-1],b=points[i];projectedDotA.copy(a).project(cam);projectedDotB.copy(b).project(cam);
  const length=Math.hypot((projectedDotB.x-projectedDotA.x)*195,(projectedDotB.y-projectedDotA.y)*299);
  if(length<.0001)continue;
  while(nextDot<=length&&count<128){
   const t=nextDot/length,index=count++*3;
   trajectoryPositions[index]=a.x+(b.x-a.x)*t;trajectoryPositions[index+1]=a.y+(b.y-a.y)*t;trajectoryPositions[index+2]=a.z+(b.z-a.z)*t;
   nextDot+=13;
  }
  nextDot-=length;
 }
 trajectoryGeometry.setDrawRange(0,count);trajectoryGeometry.attributes.position.needsUpdate=true;
}
const contactMarker=new THREE.Mesh(new THREE.RingGeometry(.075,.095,24),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:1,side:THREE.DoubleSide,depthWrite:false}));
contactMarker.rotation.x=-Math.PI/2;trajectoryGroup.add(contactMarker);
function launchVelocity(start,end){
 return{x:clamp((end.x-start.x)/1800,-.09,.09),y:-clamp((start.y-end.y)/500,.19,.4)};
}
// Side spin develops into a gentle hook farther down the lane.
// This pure step is shared by live Matter motion and the trajectory prediction.
function hookVelocity(velocity,x,z,spin,dt){
 if(z<PIT_START||Math.abs(x)>1.75)return{x:velocity.x,y:velocity.y};
 const grip=clamp((2-z-1.5)/8,0,1);
 return{x:velocity.x+spin*HOOK_STRENGTH*velocity.y*velocity.y*60*dt*grip,y:velocity.y};
}
function updateTrajectory(end){
 if(!aimStart||!ballBody||rolling||phase==='result'){trajectoryGroup.visible=false;return;}
 const velocity=launchVelocity(aimStart,end),points=[new THREE.Vector3(ballBody.position.x,.025,ballBody.position.y)];
 let x=ballBody.position.x,z=ballBody.position.y,vx=velocity.x,vz=velocity.y;
 // Matter velocities use 60Hz units; prediction and live motion step at120Hz.
 const timeScale=PHYSICS_STEP*60,drag=1-ballBody.frictionAir*timeScale;
 for(let step=0;step<Math.ceil(4.5/PHYSICS_STEP);step++){
  const hooked=hookVelocity({x:vx,y:vz},x,z,sideSpin,PHYSICS_STEP);
  vx=hooked.x*drag;vz=hooked.y*drag;
  const nx=x+vx*timeScale,nz=z+vz*timeScale,dx=nx-x,dz=nz-z;
  let fraction=1,contact=false;
  for(const pin of pins){
   const px=x-pin.body.position.x,pz=z-pin.body.position.y,r=BALL_RADIUS+(pin.body.circleRadius||.145);
   const a=dx*dx+dz*dz,b=2*(px*dx+pz*dz),c=px*px+pz*pz-r*r,discriminant=b*b-4*a*c;
   if(a>0&&discriminant>=0){const hit=(-b-Math.sqrt(discriminant))/(2*a);if(hit>=0&&hit<=fraction){fraction=hit;contact=true;}}
  }
  if(Math.abs(nx)>2){fraction=Math.min(fraction,(Math.sign(nx)*2-x)/dx);contact=true;}
  if(nz<PIT_END){fraction=Math.min(fraction,(PIT_END-z)/dz);contact=true;}
  x+=dx*fraction;z+=dz*fraction;points.push(new THREE.Vector3(x,.025,z));
  if(contact)break;
 }
 paintTrajectoryDots(points);
 contactMarker.position.set(x,.028,z);trajectoryGroup.visible=true;
}
function clearPins(){for(const p of pins){scene.remove(p.mesh);Matter.World.remove(engine.world,p.body);}pins=[];}
function freshPins(){clearPins();let i=0;for(let row=0;row<4;row++)for(let c=0;c<=row;c++){const x=(c-row/2)*.43,z=-13-row*.47,mesh=new THREE.Mesh(pinGeo,pinMat);mesh.position.set(x,0,z);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);const body=Matter.Bodies.circle(x,z,.145,{frictionAir:.03,restitution:.45,density:.001});body.pinId=i;Matter.World.add(engine.world,body);pins.push({id:i++,mesh,body,fallen:false,tilt:0,angle:0,pitDrop:0,fallVelocity:0});}}
function freshBall(){
 cancelAim();if(ballBody)Matter.World.remove(engine.world,ballBody);
 ballBody=Matter.Bodies.circle(0,2.0,BALL_RADIUS,{frictionAir:.002,restitution:.55,density:.007});
 ballBody.isBall=true;Matter.World.add(engine.world,ballBody);ball.visible=true;rolling=false;rollTimer=0;physicsAccumulator=0;ballDrop=0;ballDropVelocity=0;
 ball.position.set(0,BALL_RADIUS,2);
 ball.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3().subVectors(cam.position,ball.position).normalize());
}
Matter.Events.on(engine,'collisionStart',e=>{for(const pair of e.pairs){const a=pair.bodyA,b=pair.bodyB,force=Math.hypot(a.velocity.x-b.velocity.x,a.velocity.y-b.velocity.y);if(force<.035)continue;for(const body of [a,b])if(body.pinId!==undefined){const p=pins.find(p=>p.id===body.pinId);if(p&&!p.fallen){p.fallen=true;p.angle=Math.atan2(body.velocity.x,-body.velocity.y);if(pinSound<=0){sound(850,.045,.13,'triangle');pinSound=.09;}}}}});
function scoreGame(){const all=[...frames,currentFrame].filter(f=>f.length);const rolls=all.flat();let index=0,score=0;for(let f=0;f<Math.min(all.length,10);f++){const a=rolls[index]||0,b=rolls[index+1]||0;if(a===10){score+=10+b+(rolls[index+2]||0);index++;}else if(a+b===10){score+=10+(rolls[index+2]||0);index+=2;}else{score+=a+b;index+=2;}}return score;}
function finishRoll(){rolling=false;trajectoryGroup.visible=false;const knocked=pins.filter(p=>p.fallen).length;currentFrame.push(knocked);let frameDone=false;if(frameIndex<9)frameDone=knocked===10||currentFrame.length===2;else if(currentFrame.length===3)frameDone=true;else if(currentFrame.length===2&&currentFrame[0]+currentFrame[1]<10)frameDone=true;
 $('.score').textContent=scoreGame();const allDown=pins.every(p=>p.fallen);if(frameDone){frames.push(currentFrame);currentFrame=[];frameIndex++;if(frameIndex===10){phase='result';success();result('A full ten frames',scoreGame(),'Every pin counts.',reset);return;}rack=true;}else rack=allDown;
 settleDelay=.65;state('between-rolls');$('.roll-note').textContent=knocked===10?'Strike!':allDown?'Spare!':knocked+' pins';}
function reset(){sideSpin=0;rollSpin=0;updateSpinUI();clearPins();frames=[];currentFrame=[];frameIndex=0;phase='ready';rack=true;settleDelay=0;hasRolled=false;rollGuide.classList.remove('gone');freshPins();freshBall();$('.frame').textContent='1 / 10';$('.score').textContent='0';$('.roll-note').textContent='First roll';state('ready');}
const surface=renderer.domElement;
function cancelAim(){
 const pointer=aimPointer;aimStart=null;aimEnd=null;aimForward=null;aimPointer=null;trajectoryGroup.visible=false;
 try{if(pointer!==null&&surface.hasPointerCapture(pointer))surface.releasePointerCapture(pointer);}catch(_){}
}
function positionAim(p){aimEnd=p;Matter.Body.setPosition(ballBody,{x:clamp((p.x-195)/110,-1.15,1.15),y:2.0});}
const spinBall=$('.spin-ball'),spinDot=$('.spin-dot');
function spinAvailable(){return active&&!rolling&&settleDelay<=0&&phase!=='result';}
function updateSpinUI(){
 spinDot.style.transform=`translate(${(sideSpin*21).toFixed(1)}px,0)`;
 spinBall.setAttribute('aria-valuenow',String(Math.round(sideSpin*100)));
 spinBall.setAttribute('aria-valuetext',Math.abs(sideSpin)<.01?'Straight':(sideSpin<0?'Left ':'Right ')+Math.round(Math.abs(sideSpin)*100)+'%');
 if(aimStart)updateTrajectory(aimEnd||aimStart);
}
function chooseSpin(e){const r=spinBall.getBoundingClientRect();sideSpin=clamp((e.clientX-r.left-r.width/2)/(r.width*.34),-1,1);updateSpinUI();}
function cancelSpinPointer(){
 const pointer=spinPointer;spinPointer=null;
 if(pointer!==null&&spinBall.hasPointerCapture(pointer))spinBall.releasePointerCapture(pointer);
}
on(spinBall,'pointerdown',e=>{
 if(!spinAvailable()||spinPointer!==null||e.button!==0)return;
 e.preventDefault();spinPointer=e.pointerId;spinBall.setPointerCapture(e.pointerId);chooseSpin(e);
});
on(spinBall,'pointermove',e=>{if(e.pointerId===spinPointer){e.preventDefault();chooseSpin(e);}});
on(spinBall,'pointerup',e=>{if(e.pointerId===spinPointer){chooseSpin(e);cancelSpinPointer();}});
on(spinBall,'pointercancel',e=>{if(e.pointerId===spinPointer)cancelSpinPointer();});
on(spinBall,'lostpointercapture',e=>{if(e.pointerId===spinPointer)cancelSpinPointer();});
on(spinBall,'keydown',e=>{
 if(!spinAvailable()||!['ArrowLeft','ArrowRight','Home'].includes(e.key))return;
 e.preventDefault();sideSpin=e.key==='Home'?0:clamp(sideSpin+(e.key==='ArrowLeft'?-.1:.1),-1,1);updateSpinUI();
});
const MIN_FORWARD_SWIPE=6;
function bowlingPoint(e){
 if(!Number.isFinite(e.clientX)||!Number.isFinite(e.clientY))return null;
 const p=point(e,surface);return Number.isFinite(p.x)&&Number.isFinite(p.y)?p:null;
}
function trackForward(p){if(p&&(!aimForward||p.y<aimForward.y))aimForward=p;}
function finishBowlingSwipe(e,interrupted=false){
 if(e.pointerId!==aimPointer||!aimStart)return;
 if(!active||disposed||document.hidden||rolling||settleDelay>0||phase==='result'){cancelAim();return;}
 const last=interrupted?aimEnd:(bowlingPoint(e)||aimEnd);trackForward(last);
 // Keep the deliberate forward stroke if a finger drifts back just before lift.
 const p=last&&aimStart.y-last.y>=MIN_FORWARD_SWIPE?last:aimForward;
 if(!p||aimStart.y-p.y<MIN_FORWARD_SWIPE){cancelAim();remindRoll();return;}
 const velocity=launchVelocity(aimStart,p);positionAim(p);
 // Clear pointer ownership before releasing capture so late releases cannot fire twice.
 cancelAim();e.preventDefault();hasRolled=true;
 Matter.Body.setVelocity(ballBody,velocity);rollSpin=sideSpin;rolling=true;rollTimer=0;phase='playing';
 $('.roll-note').textContent='';state('rolling');sound(80,.3,.12,'triangle',50);
}
function moveBowlingSwipe(e){
 if(e.pointerId!==aimPointer||!aimStart)return;
 if(!active||disposed||document.hidden||rolling||phase==='result'){cancelAim();return;}
 if(e.pointerType==='mouse'&&e.buttons===0){finishBowlingSwipe(e,true);return;}
 const p=bowlingPoint(e);if(!p)return;e.preventDefault();trackForward(p);positionAim(p);updateTrajectory(p);
}
on(surface,'pointerdown',e=>{
 if(!active||disposed||document.hidden||rolling||settleDelay>0||phase==='result'||aimPointer!==null||e.button!==0)return;
 const p=bowlingPoint(e);if(!p||p.y<140||p.y>598)return;
 e.preventDefault();gesture();aimStart=p;aimForward=p;aimPointer=e.pointerId;positionAim(p);
 try{surface.setPointerCapture(e.pointerId);}catch(_){}
 updateTrajectory(p);
});
on(window,'pointermove',moveBowlingSwipe,{capture:true,passive:false});
on(window,'pointerup',e=>finishBowlingSwipe(e),{capture:true,passive:false});
on(window,'pointercancel',e=>finishBowlingSwipe(e,true),{capture:true,passive:false});
on(surface,'lostpointercapture',e=>{
 if(e.pointerId!==aimPointer||!aimStart)return;
 if(!active||disposed||document.hidden||rolling||phase==='result'){cancelAim();return;}
 try{surface.setPointerCapture(e.pointerId);if(surface.hasPointerCapture(e.pointerId))return;}catch(_){}
 finishBowlingSwipe(e,true);
});
lifecycle.push(next=>{if(!next){cancelAim();cancelSpinPointer();remindRoll();}});reset();
loop(dt=>{
 pinSound=Math.max(0,pinSound-dt);const wasRolling=rolling;
 if(phase!=='result'){
  if(dt>0){
   physicsAccumulator+=dt;
   while(physicsAccumulator>=PHYSICS_STEP){
    if(rolling)Matter.Body.setVelocity(ballBody,hookVelocity(ballBody.velocity,ballBody.position.x,ballBody.position.y,rollSpin,PHYSICS_STEP));
    Matter.Engine.update(engine,PHYSICS_STEP*1000);physicsAccumulator-=PHYSICS_STEP;
   }
  }
  if(rolling){rollTimer+=dt;if(rollTimer>4.5||ballBody.position.y<PIT_END)finishRoll();}
  if(settleDelay>0){
   settleDelay-=dt;
   if(settleDelay<=0){
    if(rack)freshPins();
    else for(const p of [...pins])if(p.fallen){scene.remove(p.mesh);Matter.World.remove(engine.world,p.body);pins=pins.filter(q=>q!==p);}
    freshBall();$('.frame').textContent=(frameIndex+1)+' / 10';$('.roll-note').textContent=currentFrame.length?'Second roll':'First roll';state('ready');
   }
  }
 }
 if(ballBody){
  const dx=ballBody.position.x-ball.position.x,dz=ballBody.position.y-ball.position.z,distance=Math.hypot(dx,dz);
  if(wasRolling&&dt>0&&distance>0){
   rollingAxis.set(dz,0,-dx).normalize();rollingTurn.setFromAxisAngle(rollingAxis,distance/BALL_RADIUS);ball.quaternion.premultiply(rollingTurn);
   ball.rotateOnWorldAxis(sideSpinAxis,rollSpin*dt*8);
  }
  if(ballBody.position.y<PIT_START){ballDropVelocity+=9.8*dt;ballDrop=Math.min(.79,ballDrop+ballDropVelocity*dt);}
  ball.position.set(ballBody.position.x,BALL_RADIUS-ballDrop,ballBody.position.y);
  if(ballBody.position.y<PIT_END||Math.abs(ballBody.position.x)>2)ball.visible=false;
 }
 for(const p of pins){
  p.mesh.position.x=p.body.position.x;p.mesh.position.z=p.body.position.y;
  if(p.body.position.y<PIT_START){p.fallen=true;p.fallVelocity+=9.8*dt;p.pitDrop=Math.min(.65,p.pitDrop+p.fallVelocity*dt);}
  if(p.fallen){p.tilt=Math.min(Math.PI/2,p.tilt+dt*3.7);p.mesh.position.y=.08-p.pitDrop;p.mesh.rotation.x=-Math.cos(p.angle)*p.tilt;p.mesh.rotation.z=-Math.sin(p.angle)*p.tilt;}
  if(p.body.position.y<PIT_END+.7)p.mesh.visible=false;
 }
 const disabled=String(!spinAvailable());if(spinBall.getAttribute('aria-disabled')!==disabled)spinBall.setAttribute('aria-disabled',disabled);
 renderer.render(scene,cam);root.dataset.frame=frameIndex+1;
});
cleanups.push(()=>{
 Matter.Events.off(engine);Matter.World.clear(engine.world,false);Matter.Engine.clear(engine);
 renderer.dispose();map.dispose();pm.dispose();pinGeo.dispose();pinMat.dispose();ballAvatarTexture?.dispose();ball.geometry.dispose();ball.material.dispose();
 trajectoryGeometry.dispose();trajectoryMaterial.dispose();trajectoryDotTexture.dispose();contactMarker.geometry.dispose();contactMarker.material.dispose();
});

configure(()=>{if($('.bowl-guide-copy'))$('.bowl-guide-copy').textContent=String(setting('GUIDE',"Swipe forward to roll"));});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n.hud{font:700 28px/1.2 Georgia,serif}.guide{font:400 18px/1.4 UIBody,system-ui,sans-serif;color:#fff0d5}.roll-note{bottom:50px;font-size:14px;line-height:1.4}.result h2{font-family:Georgia,serif}";
  document.head.append(uiStyle);
})();
