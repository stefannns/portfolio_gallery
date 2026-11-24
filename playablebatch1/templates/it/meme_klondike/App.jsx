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

mount(`.fit{background:#205143;color:#ece9d7}.hud{font:16px Georgia,serif;color:#e8e2c4}.guide{top:162px;color:#d4e1d1;font-size:13px;font-weight:500}.tools{position:absolute;bottom:28px;left:30px;right:30px;display:flex;justify-content:center;gap:18px}.tools button{background:transparent;border:1px solid #b4cdb059;color:#e8e5cd;border-radius:20px;font-size:13px;padding:8px 18px}.result{background:#f6efd9;color:#2b493d}.pill{background:#2e6754}`,`<canvas class="stage" aria-label="Solitario Klondike"></canvas><div class="hud"><span class="moves">0 mosse</span><span class="foundation-count">0 / 52</span></div><div class="guide">Alterna i colori · ordina gli assi</div><div class="tools"><button class="undo">Annulla</button><button class="new-game">Nuova mano</button></div>${resultMarkup("Ridistribuisci")}`,'#205143');

// Backgrounds and result shading cover the host; the board keeps its authored geometry.
function installHostSurface(kind){
 const fit=$('.fit'),modal=$('.modal');
 if(modal){modal.classList.add('host-modal');root.append(modal);}
 const surfaceStyle=document.createElement('style');
 surfaceStyle.textContent=`#root{position:relative;isolation:isolate}#root>.fit{z-index:1;background:transparent}#root>.host-modal{position:absolute;inset:0;z-index:30;display:block;padding:0;background:#22242c33}#root>.host-modal>.result{position:absolute;left:50%;top:calc(50% - var(--modal-shift,10px));width:320px;max-width:none;max-height:518px;overflow-y:auto;transform:translate(-50%,-50%) scale(var(--game-fit-scale,1));transform-origin:center}`;
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
const refreshSurface=installHostSurface('felt');
const {canvas,ctx}=stageCanvas(),backs=[image('./assets/meme-1.webp'),image('./assets/meme-2.webp'),image('./assets/meme-3.webp')];const suits=['♠','♥','♣','♦'];let stock=[],waste=[],tableau=[],foundations=[],selected=null,drag=null,moves=0,history=[];
const cardW=43,cardH=62;
function isRed(c){return c.s===1||c.s===3;}
function reset(){const deck=shuffle(Array.from({length:52},(_,i)=>({r:i%13+1,s:Math.floor(i/13),up:false})));tableau=Array.from({length:7},()=>[]);for(let c=0;c<7;c++)for(let n=0;n<=c;n++){const card=deck.pop();card.up=n===c;tableau[c].push(card);}stock=deck;waste=[];foundations=[[],[],[],[]];selected=null;drag=null;moves=0;history=[];update();state('ready');}
function save(){history.push(JSON.stringify({stock,waste,tableau,foundations,moves}));if(history.length>80)history.shift();}
function update(){const count=foundations.reduce((s,p)=>s+p.length,0);$('.moves').textContent=moves+" mosse";$('.foundation-count').textContent=count+' / 52';$('.undo').disabled=!history.length;root.dataset.moves=moves;root.dataset.cards=count;if(count===52){success();result("Che soddisfazione!",'52 / 52',"Tutte le carte sono al loro posto.",reset);}}
function pile(ref){return ref.kind==='waste'?waste:ref.kind==='foundation'?foundations[ref.col]:tableau[ref.col];}
function cardsFrom(ref){return pile(ref).slice(ref.index);}
function layout(col){const cards=tableau[col],down=cards.filter(c=>!c.up).length,up=cards.length-down,step=Math.min(23,Math.max(9,(330-down*12-cardH)/Math.max(1,up-1)));let y=204;return cards.map(c=>{const at=y;y+=c.up?step:12;return at;});}
function hit(p){if(p.y>=96&&p.y<=158){if(p.x>=28&&p.x<=71)return{kind:'stock'};if(p.x>=77&&p.x<=120&&waste.length)return{kind:'waste',col:0,index:waste.length-1};for(let i=0;i<4;i++)if(p.x>=172+i*47&&p.x<=215+i*47)return{kind:'foundation',col:i,index:Math.max(0,foundations[i].length-1)};}for(let c=0;c<7;c++){const x=28+c*48;if(p.x<x||p.x>x+cardW)continue;const ys=layout(c);for(let i=ys.length-1;i>=0;i--)if(p.y>=ys[i]&&p.y<=ys[i]+cardH)return{kind:'tableau',col:c,index:i};if(!ys.length&&p.y>=204&&p.y<=266)return{kind:'tableau',col:c,index:0};}return null;}
function validRun(cards){return cards.length&&cards.every((c,i)=>c.up&&(i===0||(cards[i-1].r===c.r+1&&isRed(cards[i-1])!==isRed(c))));}
function move(from,to){if(!from||!to||to.kind==='stock'||to.kind==='waste'||(from.kind===to.kind&&from.col===to.col))return false;const cards=cardsFrom(from);if(!validRun(cards))return false;const target=pile(to),bottom=target[target.length-1],first=cards[0];if(to.kind==='foundation'){if(cards.length!==1||first.s!==to.col||first.r!==(bottom?bottom.r+1:1))return false;}else if(bottom?(!bottom.up||bottom.r!==first.r+1||isRed(bottom)===isRed(first)):first.r!==13)return false;save();pile(from).splice(from.index,cards.length);target.push(...cards);const previous=lastItem(pile(from));if(previous&&!previous.up)previous.up=true;selected=null;moves++;gesture();sound(430,.05,.1);update();state('playing');return true;}
function autoFoundation(from){if(!from||from.kind==='stock')return false;const cards=cardsFrom(from);return cards.length===1&&move(from,{kind:'foundation',col:cards[0].s,index:0});}
function drawStock(){save();if(stock.length){const c=stock.pop();c.up=true;waste.push(c);}else if(waste.length){stock=waste.reverse().map(c=>({...c,up:false}));waste=[];}moves++;selected=null;gesture();sound(360,.05,.09);update();state('playing');}
on(canvas,'pointerdown',e=>{const p=point(e),ref=hit(p);if(!ref)return;if(ref.kind==='stock'){drawStock();return;}drag={ref,start:p,last:p,moved:false};canvas.setPointerCapture(e.pointerId);});on(canvas,'pointermove',e=>{if(!drag)return;drag.last=point(e);if(Math.hypot(drag.last.x-drag.start.x,drag.last.y-drag.start.y)>7)drag.moved=true;});on(canvas,'pointerup',e=>{if(!drag)return;const action=drag;drag=null;const target=hit(point(e));if(action.moved){if(target)move(action.ref,target);selected=null;}else if(selected){if(!move(selected,target)){if(selected.kind===action.ref.kind&&selected.col===action.ref.col&&selected.index===action.ref.index)autoFoundation(action.ref);selected=validRun(cardsFrom(action.ref))?action.ref:null;}}else if(validRun(cardsFrom(action.ref)))selected=action.ref;});on(canvas,'pointercancel',()=>drag=null);on(canvas,'dblclick',e=>autoFoundation(hit(point(e))));on($('.undo'),'click',()=>{if(!history.length)return;const previous=JSON.parse(history.pop());({stock,waste,tableau,foundations,moves}=previous);selected=null;drag=null;gesture();update();});on($('.new-game'),'click',()=>{gesture();reset();});reset();
function drawCard(card,x,y,chosen=false){ctx.save();ctx.shadowColor='#071b143b';ctx.shadowBlur=2;ctx.shadowOffsetY=2;round(ctx,x,y,cardW,cardH,4,card.up?'#f5f0dd':'#d2c3ab','#123e31');ctx.shadowBlur=0;ctx.shadowOffsetY=0;if(card.up){const color=isRed(card)?'#b04b3e':'#25352d',rank={1:'A',11:'J',12:'Q',13:'K'}[card.r]||card.r;text(ctx,rank,x+7,y+10,11,color,'Georgia','left');text(ctx,suits[card.s],x+11,y+24,10,color,'UIBody');text(ctx,suits[card.s],x+25,y+40,22,color,'UIBody');}else{ctx.save();ctx.beginPath();roundPath(ctx,x+2,y+2,cardW-4,cardH-4,3);ctx.clip();cover(ctx,backs[(card.r+card.s)%3],x+2,y+2,cardW-4,cardH-4);ctx.restore();}if(chosen){ctx.lineWidth=2;round(ctx,x-1,y-1,cardW+2,cardH+2,4,null,'#f1cd74');}ctx.restore();}
loop(()=>{ctx.clearRect(0,0,390,598);round(ctx,28,96,43,62,4,'#164433','#72957866');text(ctx,'↻',49,127,24,'#92ad91','UIBody');if(stock.length)drawCard(lastItem(stock),28,96);if(waste.length)drawCard(lastItem(waste),77,96,selected?.kind==='waste');for(let i=0;i<4;i++){round(ctx,172+i*47,96,43,62,4,'#174735','#72957855');text(ctx,suits[i],193+i*47,128,20,'#6a9078','UIBody');if(foundations[i].length)drawCard(lastItem(foundations[i]),172+i*47,96,selected?.kind==='foundation'&&selected.col===i);}for(let c=0;c<7;c++){const ys=layout(c);if(!tableau[c].length)round(ctx,28+c*48,204,43,62,4,'#194836','#72957844');tableau[c].forEach((card,i)=>drawCard(card,28+c*48,ys[i],selected?.kind==='tableau'&&selected.col===c&&i>=selected.index));}if(drag?.moved&&validRun(cardsFrom(drag.ref))){const cards=cardsFrom(drag.ref);ctx.globalAlpha=.85;cards.forEach((c,i)=>drawCard(c,drag.last.x-cardW/2,drag.last.y-15+i*17));ctx.globalAlpha=1;}});

configure(()=>{if($('.guide'))$('.guide').textContent=String(setting('GUIDE',"Alterna i colori · ordina gli assi"));});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n\n.hud{font:700 28px/1.2 Georgia,serif;color:#f2ead1}\n.guide{top:164px;font:400 18px/1.4 UIBody,system-ui,sans-serif;color:#e7efdf}\n.tools{bottom:50px;gap:14px}.tools button{font:700 16px/1.3 UIBody,system-ui,sans-serif;min-height:44px;padding:10px 20px;border-color:#b4cdb099}\n.result h2{font-family:Georgia,serif}\n";
  document.head.append(uiStyle);
})();
