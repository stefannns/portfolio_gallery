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
 function preload(list){friends=list.slice(0,24).map(f=>({nickname:String(f.nickname||"Amico"),avatar:f.avatar,image:null}));for(const f of friends){let im;try{im=new Image();im.onload=()=>{f.image=im;friendsChanged();};im.onerror=()=>{f.image=null;};im.src=f.avatar;}catch(_){f.image=null;}}friendsChanged();}
 preload(friends);root.dataset.friends='sample';
 if(typeof window.tt?.getFriendsInfo!=='function')return;
 window.tt.getFriendsInfo({success(data){const list=Array.isArray(data?.friends)?data.friends.filter(f=>f&&typeof f.avatar==='string'):[];if(list.length){preload(list);root.dataset.friends='host';}},fail(){root.dataset.friends='sample';}});
}
function avatar(ctx,index,x,y,r,ring='#fff'){
 const f=friends[((index%friends.length)+friends.length)%friends.length];ctx.save();ctx.shadowColor='#25212d20';ctx.shadowBlur=6;circle(ctx,x,y,r,ring);ctx.shadowBlur=0;if(f?.image)cropCircle(ctx,f.image,x,y,Math.max(1,r-2));else{circle(ctx,x,y,Math.max(1,r-2),['#efb5a9','#b3d6ce','#e3cb8f','#c6b8df'][index%4]);text(ctx,Array.from(f?.nickname||'?')[0],x,y,r*.7,'#fff');}ctx.restore();
}
function friendName(index){return friends[((index%friends.length)+friends.length)%friends.length]?.nickname||"Amico";}
function drawName(ctx,index,x,y,size=13){text(ctx,Array.from(friendName(index)).slice(0,15).join(''),x,y,size);}
loadFriends();

mount(`.fit{background:#fff}canvas.stage{position:absolute;z-index:3;pointer-events:none}.vision-copy{position:absolute;left:30px;right:30px;top:90px;z-index:6;display:flex;flex-direction:column;align-items:center;gap:24px;text-align:center;pointer-events:none}.question{position:static;margin:0;font-size:20px;line-height:1.4;font-weight:700;color:#55465c}.guide{top:160px;font-size:15px;font-weight:500;color:#aaa0ac}.orb{position:absolute;left:65px;top:218px;width:260px;height:260px;object-fit:contain;pointer-events:none}.fog{position:absolute;left:65px;top:218px;width:260px;height:260px;touch-action:none;z-index:5;opacity:1;transition:opacity .5s ease-out}.fog.revealed{opacity:0;pointer-events:none}.prediction{position:static;margin:0;font-size:14px;line-height:1.4;color:#5d4969;overflow-wrap:anywhere}.prediction:empty{display:none}.next-vision{position:absolute;left:50%;transform:translateX(-50%);bottom:24px;white-space:nowrap;background:#4b4355}.count{position:absolute;right:30px;top:33px;color:#8e8696;font-size:14px}.result{background:#faf7ff}.result .value{font-size:28px}.result p{white-space:pre-line}`,`<canvas class="stage" aria-label="La sfera del futuro"></canvas><div class="count">1 / 3</div><div class="vision-copy"><div class="question">Chi avrà fortuna oggi?</div><div class="prediction" aria-live="polite"></div></div><div class="guide">Strofina e scopri chi c’è</div><img class="orb" src="./assets/crystal.webp" alt="Sfera di cristallo"><canvas class="fog" width="436" height="436" aria-label="Rimuovi la nebbia"></canvas><button class="pill next-vision" disabled>Prossima visione</button>${resultMarkup()}`,'#fff');
// The result backdrop covers the host viewport; only the card keeps stage scaling.
function installFullHostResult122(){
 const modal=$('.modal'),panel=$('.result'),frame=document.createElement('div');
 frame.className='fortune-result-fit';frame.append(panel);modal.append(frame);modal.classList.add('fortune-overlay');root.append(modal);
 root.style.position='relative';
 const style=document.createElement('style');
 style.textContent='#root>.modal.fortune-overlay{position:absolute;inset:0;width:100%;height:100%;padding:0;overflow:hidden}#root .fortune-result-fit{width:390px;height:598px;display:grid;place-items:center;padding:30px 30px 50px;transform:scale(var(--fortune-result-scale,1));transform-origin:center;pointer-events:auto}';
 document.head.append(style);
 function resize(){const r=root.getBoundingClientRect();root.style.setProperty('--fortune-result-scale',String(Math.min(r.width/390,r.height/598)));}
 resize();on(window,'resize',resize);
 if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(resize);observer.observe(root);cleanups.push(()=>observer.disconnect());}
}
installFullHostResult122();
const {ctx}=stageCanvas(),fog=$('.fog'),fg=fog.getContext('2d'),FOG_SIZE=fog.width;let roundNo=0,subject=0,prediction='',revealed=false,dragging=false,last=null,fortunes=[],glassCoverage=0,coverageDirty=false,lastCoverageCheck=-1;
// Circle fitted to the new round glass asset; inset slightly to preserve its clear rim.
// Artwork coordinates use640px; the image and fog remain260px at65,218.
const GLASS={cx:317.54,cy:254.28,radius:238,feather:4,artSize:640};
function traceGlass(target){
 const s=FOG_SIZE/GLASS.artSize;target.beginPath();
 target.arc(GLASS.cx*s,GLASS.cy*s,GLASS.radius*s,0,Math.PI*2);target.closePath();
}
const glassMask=document.createElement('canvas');glassMask.width=glassMask.height=FOG_SIZE;
const glassBrush=glassMask.getContext('2d');traceGlass(glassBrush);glassBrush.fillStyle='#fff';glassBrush.fill();
const glassMaskData=glassBrush.getImageData(0,0,FOG_SIZE,FOG_SIZE).data,glassPixels=[];
for(let i=3;i<glassMaskData.length;i+=4)if(glassMaskData[i]>=128)glassPixels.push(i);
const initialGlassAlpha=new Uint8Array(glassPixels.length);

function paintFog(){
 fg.globalCompositeOperation='source-over';fg.clearRect(0,0,FOG_SIZE,FOG_SIZE);
 fg.save();traceGlass(fg);fg.clip();
 const s=FOG_SIZE/GLASS.artSize,cx=GLASS.cx*s,cy=GLASS.cy*s,r=GLASS.radius*s;
 const gr=fg.createRadialGradient(cx-r*.35,cy-r*.4,r*.05,cx,cy,r*1.12);
 gr.addColorStop(0,'#eee8f0');gr.addColorStop(.6,'#d8d0e3');gr.addColorStop(1,'#b5a8c9');
 fg.fillStyle=gr;fg.fillRect(0,0,FOG_SIZE,FOG_SIZE);
 // One continuous fog surface with a soft edge fitted inside the glass rim.
 // Apply this only on reset; repeated masking while wiping would erode the edge.
 const edge=fg.createRadialGradient(cx,cy,r-GLASS.feather*s,cx,cy,r);
 edge.addColorStop(0,'#fff');edge.addColorStop(1,'#fff0');
 fg.globalCompositeOperation='destination-in';fg.fillStyle=edge;fg.fillRect(0,0,FOG_SIZE,FOG_SIZE);
 fg.restore();
 const data=fg.getImageData(0,0,FOG_SIZE,FOG_SIZE).data;
 glassPixels.forEach((offset,i)=>{initialGlassAlpha[i]=data[offset];});
 glassCoverage=0;coverageDirty=false;lastCoverageCheck=-1;root.dataset.mistCoverage='0.0000';
}
function glassPoint(event){
 const r=fog.getBoundingClientRect();
 return{x:(event.clientX-r.left)*FOG_SIZE/r.width,y:(event.clientY-r.top)*FOG_SIZE/r.height};
}
function insideGlass(p){
 const x=Math.floor(p.x),y=Math.floor(p.y);
 return x>=0&&x<FOG_SIZE&&y>=0&&y<FOG_SIZE&&glassMaskData[(y*FOG_SIZE+x)*4+3]>=128;
}
function revealVision(){
 if(revealed)return;
 revealed=true;dragging=false;last=null;
 // Retain the remaining mist pixels for the existing500ms opacity transition.
 fog.classList.add('revealed');fog.setAttribute('aria-hidden','true');
 $('.prediction').textContent=prediction;$('.next-vision').disabled=false;
 fortunes.push({friend:friends[subject],prediction,index:subject});sound(640,.3,.1,'sine',900);state('revealed');
}
function measureGlassCoverage(){
 if(!coverageDirty||revealed)return;
 coverageDirty=false;
 const data=fg.getImageData(0,0,FOG_SIZE,FOG_SIZE).data;
 let cleared=0;
 // Compare each glass pixel with its original alpha, so cloud opacity and
 // antialiasing do not distort the actual fraction of glass the player wiped.
 for(let i=0;i<glassPixels.length;i++){
  const original=initialGlassAlpha[i];
  if(original)cleared+=clamp(1-data[glassPixels[i]]/original,0,1);
 }
 glassCoverage=cleared/glassPixels.length;root.dataset.mistCoverage=glassCoverage.toFixed(4);
 if(glassCoverage>=.6)revealVision();
}
function wipe(event){
 const p=glassPoint(event);if(!insideGlass(p)){last=null;return;}
 fg.save();traceGlass(fg);fg.clip();fg.globalCompositeOperation='destination-out';
 fg.strokeStyle='#000';fg.fillStyle='#000';fg.lineCap='round';fg.lineWidth=58;
 if(last){fg.beginPath();fg.moveTo(last.x,last.y);fg.lineTo(p.x,p.y);fg.stroke();}
 else{fg.beginPath();fg.arc(p.x,p.y,29,0,Math.PI*2);fg.fill();}
 fg.restore();last=p;coverageDirty=true;
}

const questions=["Chi avrà fortuna oggi?","Chi riceverà una sorpresa?","Chi inizierà un’avventura?"],predictions=["È in arrivo una piccola coincidenza felice.","Un messaggio inatteso porterà un sorriso.","Un desiderio si avvicina alla realtà.","Una buona idea arriverà al momento giusto.","Un volto noto porterà una buona notizia."];
function prepare(){
 subject=Math.floor(Math.random()*friends.length);prediction=pick(predictions);revealed=false;dragging=false;last=null;
 fog.style.transition='none';fog.classList.remove('revealed');fog.removeAttribute('aria-hidden');
 $('.count').textContent=(roundNo+1)+' / 3';$('.question').textContent=questions[roundNo];$('.prediction').textContent='';
 $('.next-vision').disabled=true;$('.next-vision').textContent=roundNo===2?"Vedi le visioni":"Prossima visione";
 paintFog();void fog.offsetWidth;fog.style.removeProperty('transition');state('ready');
}
function reset(){roundNo=0;fortunes=[];prepare();}
on(fog,'pointerdown',e=>{if(revealed||!insideGlass(glassPoint(e)))return;gesture();state('wiping');dragging=true;last=null;fog.setPointerCapture(e.pointerId);wipe(e);});
on(fog,'pointermove',e=>{if(dragging&&!revealed)wipe(e);});
for(const ev of ['pointerup','pointercancel','lostpointercapture'])on(fog,ev,()=>{measureGlassCoverage();dragging=false;last=null;});
lifecycle.push(next=>{if(!next){dragging=false;last=null;}});
function showVisions(){
 result('Le tue visioni','','',reset);
 const panel=$('.result');panel.classList.add('fortune-summary');
 let list=panel.querySelector('.fortune-list');
 if(!list){list=document.createElement('ol');list.className='fortune-list';panel.querySelector('button').before(list);}
 list.replaceChildren();
 for(const fortune of fortunes){
  const row=document.createElement('li');row.className='fortune-row';
  const portrait=document.createElement('canvas');portrait.className='fortune-avatar';portrait.width=96;portrait.height=96;portrait.setAttribute('role','img');portrait.setAttribute('aria-label',fortune.friend.nickname);
  const c=portrait.getContext('2d');circle(c,48,48,47,'#e5daed');
  if(fortune.friend.image)cropCircle(c,fortune.friend.image,48,48,44);
  else{circle(c,48,48,44,['#efb5a9','#b3d6ce','#e3cb8f','#c6b8df'][fortune.index%4]);text(c,Array.from(fortune.friend.nickname||'?')[0],48,48,32,'#fff');}
  const copy=document.createElement('div');copy.className='fortune-copy';
  const name=document.createElement('strong');name.className='fortune-name';name.textContent=fortune.friend.nickname;
  const detail=document.createElement('p');detail.textContent=fortune.prediction;
  copy.append(name,detail);row.append(portrait,copy);list.append(row);
 }
}
on($('.next-vision'),'click',()=>{gesture();if(roundNo===2){showVisions();success();}else{roundNo++;prepare();}});
reset();loop((dt,t)=>{
 if(coverageDirty&&t-lastCoverageCheck>=.05){lastCoverageCheck=t;measureGlassCoverage();}
 ctx.clearRect(0,0,390,598);avatar(ctx,subject,195,304,30,'#fff');drawName(ctx,subject,195,351,14);
});

configure(()=>{if($('.guide'))$('.guide').textContent=String(setting('GUIDE',"Strofina e scopri chi c’è"));});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n\n.count{top:30px;left:30px;right:30px;text-align:center;font:600 28px/1.2 Playful,UIBody,sans-serif;color:#6e5c7c}\n.question{position:static;font:700 20px/1.4 UIBody,system-ui,sans-serif;color:#55465c}\n.guide{top:157px;font:400 18px/1.4 UIBody,system-ui,sans-serif;color:#746778}\n.orb{left:65px;top:218px;width:260px;height:260px}\n.fog{left:65px;top:218px;width:260px;height:260px}\n.prediction{position:static;font-size:14px;line-height:1.4;color:#5d4969}\n.next-vision{bottom:50px;min-height:44px;font-size:16px}\n";
  document.head.append(uiStyle);
})();

// Final vision summary layout.
(()=>{const style=document.createElement('style');style.textContent='\n/* A readable three-row keepsake instead of the generic numeric result. */\n.result.fortune-summary{display:flex;flex-direction:column;gap:18px;width:330px;max-width:100%;max-height:100%;padding:24px 20px;background:#faf7ff;border:2px solid #65566d;border-radius:18px;box-shadow:4px 5px 0 #65566d22;text-align:left;overflow-y:auto}\n.result.fortune-summary h2{margin:0;font:700 24px/1.25 Playful,UIBody,sans-serif;text-align:center;overflow-wrap:anywhere;text-wrap:balance}\n.result.fortune-summary>.value,.result.fortune-summary>p{display:none}\n.fortune-list{display:flex;flex-direction:column;gap:0;margin:0;padding:0;list-style:none}\n.fortune-row{display:grid;grid-template-columns:48px minmax(0,1fr);gap:12px;align-items:start;padding:14px 0;border-bottom:1px solid #65566d26}\n.fortune-row:first-child{padding-top:0}.fortune-row:last-child{padding-bottom:0;border-bottom:0}\n.fortune-avatar{display:block;width:48px;height:48px;margin-top:2px}\n.fortune-copy{min-width:0}.fortune-name{display:block;margin:0 0 4px;font:700 16px/1.3 UIBody,sans-serif;color:#45364e;overflow-wrap:anywhere}\n.result.fortune-summary .fortune-row p{margin:0;font:400 14px/1.5 UIBody,sans-serif;color:#65566d;white-space:normal;overflow-wrap:anywhere}\n.result.fortune-summary>.pill{align-self:center;margin:2px 0 0;min-height:44px;max-width:100%;padding:11px 28px;background:#4b4355;color:#fff;border-radius:10px;font:700 16px/1.3 Playful,UIBody,sans-serif;white-space:normal}\n#root[data-phase="result"] .count,#root[data-phase="result"] .vision-copy,#root[data-phase="result"] .guide,#root[data-phase="result"] .next-vision{visibility:hidden}\n';document.head.append(style);})();
