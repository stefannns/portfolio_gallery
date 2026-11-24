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
 const DEFAULT_FRIEND_AVATAR='./assets/img_user_avatar_default_3x.png';
 function preload(list){
  friends=list.slice(0,24).map((f,index)=>({nickname:typeof f.nickname==='string'&&f.nickname.trim()?f.nickname.trim():'nickname'+(index+1),avatar:typeof f.avatar==='string'&&f.avatar.trim()?f.avatar:DEFAULT_FRIEND_AVATAR,image:null}));
  for(const f of friends){
   function load(url,fallback=false){
    const im=new Image();
    im.onload=()=>{f.image=im;friendsChanged();};
    im.onerror=()=>{if(!fallback&&url!==DEFAULT_FRIEND_AVATAR)load(DEFAULT_FRIEND_AVATAR,true);else{f.image=null;friendsChanged();}};
    im.src=url;
   }
   load(f.avatar,f.avatar===DEFAULT_FRIEND_AVATAR);
  }
  friendsChanged();
 }
 preload(friends);root.dataset.friends='sample';
 if(typeof window.tt?.getFriendsInfo!=='function')return;
 window.tt.getFriendsInfo({
  success(data){const list=Array.isArray(data?.friends)?data.friends.filter(f=>f&&typeof f==='object'):[];if(list.length){preload(list);root.dataset.friends='host';friendsChanged();}},
  fail(error){root.dataset.friends='sample';console.warn("Profili amici non disponibili",error?.errMsg||error?.message||'');}
 });
}
function avatar(ctx,index,x,y,r,ring='#fff'){
 const f=friends[((index%friends.length)+friends.length)%friends.length];ctx.save();ctx.shadowColor='#25212d20';ctx.shadowBlur=6;circle(ctx,x,y,r,ring);ctx.shadowBlur=0;if(f?.image)cropCircle(ctx,f.image,x,y,Math.max(1,r-2));else{circle(ctx,x,y,Math.max(1,r-2),['#efb5a9','#b3d6ce','#e3cb8f','#c6b8df'][index%4]);text(ctx,Array.from(f?.nickname||'?')[0],x,y,r*.7,'#fff');}ctx.restore();
}
function friendName(index){return friends[((index%friends.length)+friends.length)%friends.length]?.nickname||"Amico";}
function drawName(ctx,index,x,y,size=13){text(ctx,Array.from(friendName(index)).slice(0,15).join(''),x,y,size);}
loadFriends();

mount(`.fit{background:#e987b6}.guide{top:90px;font:17px Playful,Arial}.pill{border-radius:0;background:#fff;color:#111;border:3px solid #111;box-shadow:4px 4px #111}.turn{position:absolute;left:30px;right:30px;top:456px;text-align:center;font-weight:700;font-size:14px}.result{border:3px solid #111;box-shadow:6px 6px #111;border-radius:0;background:#fff}.result .value{font-size:30px}`,`<canvas class="stage" aria-label="Tabellone del tris"></canvas><div class="guide">Scegli una casella e fai tris</div><div class="opponent-name" aria-label="Avversario"></div><div class="turn">Tocca a te</div><div class="bottom"><button class="pill reset">Nuova partita</button></div>${resultMarkup()}`,'#e987b6');

// Backgrounds and result shading cover the host; the board keeps its authored geometry.
function installHostSurface(kind){
 const fit=$('.fit'),modal=$('.modal');
 if(modal){modal.classList.add('host-modal');root.append(modal);}
 const surfaceStyle=document.createElement('style');
 surfaceStyle.textContent=`#root{position:relative;isolation:isolate}#root>.fit{z-index:1;background:transparent}#root .pill{border-color:#282723;color:#282723}#root .pill{box-shadow:3px 4px 0 #282723}#root>.host-modal{position:absolute;inset:0;z-index:30;display:block;padding:0;background:#22242c33}#root>.host-modal>.result{position:absolute;left:50%;top:calc(50% - var(--modal-shift,10px));width:320px;max-width:none;max-height:518px;overflow-y:auto;transform:translate(-50%,-50%) scale(var(--game-fit-scale,1));transform-origin:center}`;
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
const {canvas,ctx}=stageCanvas();let board=Array(9).fill(0),turn=1,phase='ready',aiWait=0;
// One board origin keeps the lifted visual grid and its tap targets aligned.
const BOARD_X=45,BOARD_Y=143,BOARD_SIZE=300,BOARD_CELL=100;
// The visible nickname and avatar always read the same friend slot.
function updateOpponentName(){
 const name=friendName(1),label=$('.opponent-name');
 if(label){label.textContent=name;label.title=name;label.setAttribute('aria-label',"Avversario: "+name);}
 canvas.setAttribute('aria-label',"Tris: tu contro "+name);
 if(turn===2&&phase!=='result')$('.turn').textContent=name+" sta pensando…";
}
friendsChanged=updateOpponentName;updateOpponentName();

const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function winner(b){for(const line of wins)if(b[line[0]]&&line.every(i=>b[i]===b[line[0]]))return b[line[0]];return b.every(Boolean)?3:0;}
function minimax(b,who){const w=winner(b);if(w)return w===2?10:w===1?-10:0;const values=[];for(let i=0;i<9;i++)if(!b[i]){b[i]=who;values.push(minimax(b,who===2?1:2));b[i]=0;}return who===2?Math.max(...values):Math.min(...values);}
function check(){const w=winner(board);if(!w)return false;phase='result';if(w===1)success();else if(w===2)fail();result(w===1?"Hai vinto!":w===2?"Hai perso":"Pareggio","","",reset);return true;}
function move(i,who){if(board[i]||phase==='result')return;gesture();board[i]=who;phase='playing';sound(500-who*70,.05,.13);root.dataset.moves=board.filter(Boolean).length;if(check())return;turn=who===1?2:1;$('.turn').textContent=turn===1?"Tocca a te":friendName(1)+" sta pensando…";if(turn===2)aiWait=.4;state('playing');}
function reset(){board=Array(9).fill(0);turn=1;phase='ready';aiWait=0;$('.turn').textContent="Tocca a te";state('ready');}
on(canvas,'pointerdown',e=>{const p=point(e);if(turn!==1||p.x<BOARD_X||p.x>=BOARD_X+BOARD_SIZE||p.y<BOARD_Y||p.y>=BOARD_Y+BOARD_SIZE)return;move(Math.floor((p.y-BOARD_Y)/BOARD_CELL)*3+Math.floor((p.x-BOARD_X)/BOARD_CELL),1);});on($('.reset'),'click',()=>{gesture();reset();});reset();loop(dt=>{if(aiWait>0){aiWait-=dt;if(aiWait<=0&&turn===2&&phase!=='result'){let best=-Infinity,choice=-1;for(const i of shuffle([...Array(9).keys()]))if(!board[i]){board[i]=2;const value=minimax(board,1);board[i]=0;if(value>best){best=value;choice=i;}}if(choice>=0)move(choice,2);}}ctx.clearRect(0,0,390,598);avatar(ctx,0,68,66,19,'#151515');avatar(ctx,1,322,66,19,'#151515');text(ctx,"TU",108,66,18,'#242424');text(ctx,'VS',195,66,18);ctx.fillStyle='#191919';ctx.fillRect(BOARD_X+5,BOARD_Y+6,BOARD_SIZE+3,BOARD_SIZE+3);ctx.fillStyle='#fff';ctx.fillRect(BOARD_X,BOARD_Y,BOARD_SIZE,BOARD_SIZE);ctx.strokeStyle='#191919';ctx.lineWidth=3;ctx.strokeRect(BOARD_X,BOARD_Y,BOARD_SIZE,BOARD_SIZE);for(let i=1;i<3;i++){line(ctx,BOARD_X+i*BOARD_CELL,BOARD_Y,BOARD_X+i*BOARD_CELL,BOARD_Y+BOARD_SIZE,'#191919',3);line(ctx,BOARD_X,BOARD_Y+i*BOARD_CELL,BOARD_X+BOARD_SIZE,BOARD_Y+i*BOARD_CELL,'#191919',3);}board.forEach((who,i)=>{if(!who)return;const x=BOARD_X+BOARD_CELL/2+(i%3)*BOARD_CELL,y=BOARD_Y+BOARD_CELL/2+Math.floor(i/3)*BOARD_CELL;avatar(ctx,who-1,x,y,29,'#161616');text(ctx,who===1?'×':'○',x+32,y+30,18);});});

configure(()=>{if($('.guide'))$('.guide').textContent=String(setting('GUIDE',"Scegli una casella e fai tris"));});
configure(refreshSurface);
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n\n.guide{font-size:20px;line-height:1.25}.opponent-name{position:absolute;top:55px;left:213px;width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;font:600 18px/1.25 UIBody,system-ui,sans-serif;color:#242424;pointer-events:none}.turn{top:456px;font-size:14px;line-height:1.4}\n.bottom{bottom:66px}.bottom .pill{min-height:44px;font-size:16px}\n";
  // Keep the result title, outcome, detail and replay action in the game's rounded typeface.
  uiStyle.textContent+='.result,.result h2,.result .value,.result p,.result button{font-family:Playful,UIBody,sans-serif}.result .value:empty,.result p:empty{display:none}';
  document.head.append(uiStyle);
})();
