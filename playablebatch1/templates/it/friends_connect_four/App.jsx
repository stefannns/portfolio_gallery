
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

mount(`.fit{background:#94bedb}.instruction-stack{position:absolute;top:94px;left:30px;right:30px;display:flex;flex-direction:column;gap:8px;text-align:center;pointer-events:none;z-index:9}.instruction-stack .guide{position:static;margin:0;font-size:18px;line-height:1.25;font-family:Playful,Arial}.instruction-stack .turn{position:static;margin:0;font-size:14px;line-height:1.3;min-height:1.3em;font-weight:700;color:#20252a}.pill{border-radius:6px;border:2.5px solid #20252a;box-shadow:3px 4px #36556b66;background:transparent;color:#20252a}.result{border:2.5px solid #20252a;border-radius:8px;background:#fffdf7;box-shadow:5px 6px #36556b66}.result .value{font-size:28px}.result .pill{background:#94bedb}`,`<canvas class="stage" aria-label="Tabellone di Forza quattro"></canvas><div class="instruction-stack"><div class="guide">Fai cadere la foto e allineane quattro</div><div class="turn">Tocca a te</div></div><div class="bottom"><button class="pill reset">Nuova partita</button></div>${resultMarkup()}`,'#94bedb');

// Backgrounds and result shading cover the host; the board keeps its authored geometry.
function installHostSurface(kind){
 const fit=$('.fit'),modal=$('.modal');
 if(modal){modal.classList.add('host-modal');root.append(modal);}
 const surfaceStyle=document.createElement('style');
 surfaceStyle.textContent=`#root{position:relative;isolation:isolate;color:#20252a}#root>.fit{z-index:1;background:transparent}#root .pill,#root .palette{border-color:#20252a;color:#20252a}#root .pill{box-shadow:3px 4px 0 #36556b66;font-family:Playful,UIBody,sans-serif;font-size:18px}#root>.host-modal{position:absolute;inset:0;z-index:30;display:block;padding:0;background:#20252a38}#root>.host-modal>.result{position:absolute;left:50%;top:calc(50% - var(--modal-shift,10px));width:320px;max-width:none;max-height:518px;overflow-y:auto;transform:translate(-50%,-50%) scale(var(--game-fit-scale,1));transform-origin:center}`;
 document.head.append(surfaceStyle);
 function refreshSurface(){
  const r=root.getBoundingClientRect(),s=Math.min(r.width/390,r.height/598),ox=(r.width-390*s)/2,oy=(r.height-598*s)/2;
  fit.style.transform=`translate(${ox}px,${oy}px) scale(${s})`;
  root.style.setProperty('--game-fit-scale',String(s));
  root.style.setProperty('--modal-shift',`${10*s}px`);
  if(kind==='felt'){
   // Exactly the old canvas gradient: base fill plus translucent stops at50 and380.
   root.style.backgroundImage=`radial-gradient(circle ${380*s}px at ${ox+195*s}px ${oy+280*s}px, #36674f88 ${50*s}px, #102e2244 ${380*s}px)`;
   root.style.backgroundRepeat='no-repeat';root.style.backgroundSize='auto';root.style.backgroundPosition='0 0';
  }else{
   root.style.backgroundImage=`url("${String(setting('PAPER_BACKDROP','./assets/paper-print-v1.svg'))}")`;
   root.style.backgroundRepeat='repeat';root.style.backgroundSize=`${256*s}px ${256*s}px`;root.style.backgroundPosition=`${ox}px ${oy}px`;
  }
 }
 refreshSurface();on(window,'resize',refreshSurface);
 if(typeof ResizeObserver==='function'){
  const observer=new ResizeObserver(refreshSurface);observer.observe(root);cleanups.push(()=>observer.disconnect());
 }
 return refreshSurface;
}
const refreshSurface=installHostSurface('paper');
const {canvas,ctx}=stageCanvas();let board=Array.from({length:6},()=>Array(7).fill(0)),turn=1,phase='ready',falling=null,winnerCells=[],aiWait=0;
const cell=45,left=37.5,top=181;
function winIn(grid,who){for(let r=0;r<6;r++)for(let c=0;c<7;c++)for(const [dr,dc] of [[1,0],[0,1],[1,1],[1,-1]]){const points=[];for(let i=0;i<4;i++){const rr=r+dr*i,cc=c+dc*i;if(rr<0||rr>=6||cc<0||cc>=7||grid[rr][cc]!==who)break;points.push([rr,cc]);}if(points.length===4)return points;}return null;}
function rowFor(grid,col){for(let r=5;r>=0;r--)if(!grid[r][col])return r;return -1;}
function chooseColumn(){const valid=[3,2,4,1,5,0,6].filter(c=>rowFor(board,c)>=0);for(const who of [2,1])for(const col of valid){const r=rowFor(board,col);board[r][col]=who;const wins=winIn(board,who);board[r][col]=0;if(wins)return col;}let best=-Infinity,choice=valid[0];for(const col of valid){const r=rowFor(board,col);board[r][col]=2;let value=4-Math.abs(3-col);for(const reply of valid){const rr=rowFor(board,reply);if(rr<0)continue;board[rr][reply]=1;if(winIn(board,1))value-=100;board[rr][reply]=0;}board[r][col]=0;if(value>best){best=value;choice=col;}}return choice;}
function reset(){board=Array.from({length:6},()=>Array(7).fill(0));turn=1;phase='ready';falling=null;aiWait=0;winnerCells=[];$('.turn').textContent="Tocca a te";state('ready');}
function drop(col,who){const row=rowFor(board,col);if(row<0||phase==='result'||falling)return;falling={col,row,who,y:top-35,vy:0};gesture();phase='playing';state('playing');}
function landed(){const f=falling;board[f.row][f.col]=f.who;falling=null;sound(330,.07,.16,'triangle');const won=winIn(board,f.who);if(won){winnerCells=won;phase='result';if(f.who===1)success();else fail();result(f.who===1?"Hai fatto quattro in fila!":friendName(1)+" vince","4 in fila","Un’altra partita?",reset);return;}if(board.every(row=>row.every(Boolean))){phase='result';result("Pareggio perfetto","Pareggio","Ancora una?",reset);return;}turn=f.who===1?2:1;$('.turn').textContent=turn===1?"Tocca a te":friendName(1)+" sta pensando…";if(turn===2)aiWait=.45;root.dataset.turn=turn;}
on(canvas,'pointerdown',e=>{const p=point(e);if(turn!==1||falling||p.y<top||p.y>top+270)return;const col=Math.floor((p.x-left)/cell);if(col>=0&&col<7)drop(col,1);});on($('.reset'),'click',()=>{gesture();reset();});reset();
function drawCounter(who,x,y){
 avatar(ctx,who-1,x,y,18,who===1?'#fffdf7':'#20252a');
 ctx.save();ctx.lineWidth=1.4;circle(ctx,x,y,18,null,'#20252a');ctx.restore();
}
loop(dt=>{if(aiWait>0){aiWait-=dt;if(aiWait<=0&&turn===2&&phase!=='result')drop(chooseColumn(),2);}if(falling){falling.vy+=1500*dt;falling.y+=falling.vy*dt;const target=top+falling.row*cell+cell/2;if(falling.y>=target){falling.y=target;landed();}}
 ctx.clearRect(0,0,390,598);avatar(ctx,0,65,67,20,'#20252a');avatar(ctx,1,325,67,20,'#20252a');text(ctx,"TU",99,67,13,'#20252a','Playful','left');text(ctx,'VS',195,67,15,'#20252a','Playful');
 ctx.save();ctx.lineWidth=2.5;ctx.shadowColor='#36556b66';ctx.shadowOffsetX=5;ctx.shadowOffsetY=6;round(ctx,30,174,330,284,6,'#fffdf7','#20252a');ctx.restore();
 for(let r=0;r<6;r++)for(let c=0;c<7;c++){
  const x=left+c*cell+cell/2,y=top+r*cell+cell/2;
  ctx.save();ctx.globalCompositeOperation='destination-out';circle(ctx,x,y,18,'#000');ctx.restore();
  ctx.save();ctx.lineWidth=1.6;circle(ctx,x,y,18,null,'#20252a');ctx.restore();
  if(board[r][c])drawCounter(board[r][c],x,y);
  if(winnerCells.some(([rr,cc])=>rr===r&&cc===c)){ctx.save();ctx.lineWidth=2.8;circle(ctx,x,y,21,null,'#20252a');ctx.restore();}
 }
 if(falling)drawCounter(falling.who,left+falling.col*cell+cell/2,falling.y);
});

configure(()=>{refreshSurface();if($('.guide'))$('.guide').textContent=String(setting('GUIDE',"Fai cadere la foto e allineane quattro"));});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n.guide{font-size:18px}.turn{font-size:14px;line-height:1.4;top:143px}.pill{min-height:44px;font-size:16px}.bottom{bottom:54px}";
  document.head.append(uiStyle);
})();
