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

document.documentElement.lang = 'it';
// Readable pre-compilation source. Game styles, markup and helpers are contained in this file.
(() => {
"use strict";
// Shared authoring helpers are inlined into each editable App.jsx at build time.
const root = document.getElementById('root');
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
let hostActive = true, disposed = false;
const listeners=[];
function listen(target,type,callback,options){target.addEventListener(type,callback,options);listeners.push(()=>target.removeEventListener(type,callback,options));}
function addStyle(css){const style=document.createElement('style');style.textContent=`*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;-webkit-tap-highlight-color:transparent}body{font-family:Arial,sans-serif}button{font:inherit;cursor:pointer;touch-action:manipulation}button:focus-visible{outline:3px solid #8ec5ff;outline-offset:4px}.guide{position:absolute;z-index:8;left:25px;right:25px;top:33%;text-align:center;font-size:18px;font-weight:700;line-height:1.35;pointer-events:none;animation:guide-breathe 2s ease-in-out infinite;transition:opacity .25s}.guide.gone{opacity:0;visibility:hidden}@keyframes guide-breathe{50%{opacity:.65;transform:scale(.975)}}.sensor{position:absolute;z-index:10;bottom:25px;left:50%;transform:translateX(-50%);border:1px solid currentColor;border-radius:24px;background:#ffffff10;color:inherit;padding:10px 19px;font-size:13px;white-space:nowrap;min-height:40px}.sensor[hidden]{display:none}@media(prefers-reduced-motion:reduce){.guide{animation:none!important}}`+css;document.head.append(style);}
function hideGuide(){root.querySelector('.guide')?.classList.add('gone');}
let audio;
function unlockAudio(){try{audio ||= new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume().catch(()=>{});}catch(_){}}
function tone(freq=400,seconds=.1,volume=.15,type='sine',end=0){if(!audio||!hostActive)return;try{const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);if(end)o.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+seconds);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(volume,t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+seconds);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+seconds+.02);o.onended=()=>{o.disconnect();g.disconnect();};}catch(_){}}
// Sensor APIs follow the supplied TikTok SDK. Browser emulation belongs to the
// review host, never to the exported game. No raw Web Sensor APIs in this pack.
function sensorInput({gyro=false,shake=false,onTilt=()=>{},onShake=()=>{}}={}){
 const tt=window.tt;let running=false,gyroOn=false,accelOn=false,baseline=null,gravity=null,samples=0,peaks=0,lastPeak=-2000,lastShake=-2000;
 const state={x:0,y:0,yaw:0,pitch:0,roll:0,received:false};
 const delta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
 function orientation(p){if(!hostActive||!p||p.result===-1)return;const pitch=Number(p.pitch??p.x)||0,yaw=Number(p.yaw??p.y)||0,roll=Number(p.roll??p.z)||0;if(!baseline)baseline={pitch,yaw,roll};state.pitch=pitch;state.yaw=yaw;state.roll=roll;state.x=clamp(delta(roll,baseline.roll)/.42,-1,1);state.y=clamp(delta(pitch,baseline.pitch)/.42,-1,1);if(Math.abs(state.x)<.025)state.x=0;if(Math.abs(state.y)<.025)state.y=0;state.received=true;onTilt(state);}
 function acceleration(p){if(!hostActive||!p)return;const q={x:Number(p.x)||0,y:Number(p.y)||0,z:Number(p.z)||0};if(!gravity)gravity={...q};const rest=Math.max(.1,Math.hypot(gravity.x,gravity.y,gravity.z));const motion=Math.hypot(q.x-gravity.x,q.y-gravity.y,q.z-gravity.z)/rest;for(const k of ['x','y','z'])gravity[k]=gravity[k]*.82+q[k]*.18;if(samples++<5)return;const now=performance.now();if(now-lastShake<1300)return;if(now-lastPeak>1400)peaks=0;if(motion>.55&&now-lastPeak>200){lastPeak=now;peaks++;if(peaks>=2){peaks=0;lastShake=now;onShake();}}}
 function setButton(text,hidden=false){const b=root.querySelector('.sensor');if(b){b.textContent=text;b.hidden=hidden;}}
 function start(){if(running||!hostActive)return;running=true;baseline=null;gravity=null;samples=0;
  if(gyro&&tt?.startGyroscope&&tt?.onGyroscopeChange){gyroOn=true;tt.onGyroscopeChange(orientation);tt.startGyroscope({interval:50,fail:()=>{gyroOn=false;running=false;setButton('Attiva inclinazione');}});}
  if(shake&&tt?.startAccelerometer&&tt?.onAccelerometerChange){tt.startAccelerometer({success:()=>{accelOn=true;tt.onAccelerometerChange(acceleration);},fail:()=>{running=false;setButton('Attiva movimento');}});}
  if((gyro&&!gyroOn)||(!gyro&&shake&&!tt?.startAccelerometer)){running=false;setButton('Movimento non disponibile');return;}
  setButton('Movimento attivo',true);
 }
 function stop(){running=false;if(gyroOn){tt?.offGyroscopeChange?.(orientation);tt?.stopGyroscope?.({});gyroOn=false;}if(accelOn){tt?.offAccelerometerChange?.(acceleration);tt?.stopAccelerometer?.();accelOn=false;}state.x=0;state.y=0;baseline=null;gravity=null;}
 const b=root.querySelector('.sensor');if(b)listen(b,'click',e=>{e.stopPropagation();unlockAudio();start();});
 listen(window,'pagehide',stop);listen(document,'visibilitychange',()=>{if(document.hidden)stop();});
 listen(window,'message',e=>{if(e.source!==parent||e.data?.type!=='playable-active')return;hostActive=e.data.active===true;if(!hostActive){stop();audio?.suspend().catch(()=>{});}});
 return{state,start,stop,recenter(){baseline=null;}};
}
function canvasSize(canvas){let W=390,H=598;const ctx=canvas.getContext('2d');function resize(){const rect=canvas.getBoundingClientRect();W=Math.max(1,rect.width);H=Math.max(1,rect.height);const d=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(W*d);canvas.height=Math.round(H*d);ctx.setTransform(d,0,0,d,0,0);}resize();listen(window,'resize',resize);return{ctx,get W(){return W;},get H(){return H;}};}
function runLoop(step){let previous=0;function frame(t){if(disposed)return;const dt=Math.min(.034,(t-(previous||t))/1000);previous=t;if(!document.hidden)step(hostActive?dt:0,t/1000);requestAnimationFrame(frame);}requestAnimationFrame(frame);}
listen(window,'pagehide',()=>{disposed=true;listeners.splice(0).forEach(off=>off());audio?.close().catch(()=>{});});
// Mount from packaged defaults immediately; editor configuration is optional
// at startup and is bounded so failed I/O cannot leave an empty scene.
const settings={};
function setting(id,fallback){return settings[id]??fallback;}
async function configure(onChange=()=>{}){
 let timeout;const controller=new AbortController();
 try{timeout=setTimeout(()=>controller.abort(),1800);const response=await fetch('./game.config.json',{signal:controller.signal});if(!response.ok)throw new Error('Configuration unavailable');const config=await response.json();for(const group of ['texts','tweaks','images']){for(const value of Array.isArray(config[group])?config[group]:[]){if(value&&typeof value.id==='string')settings[value.id]=group==='images'?value.path:value.value;}}onChange();root.dataset.config='loaded';}
 catch(_){root.dataset.config='defaults';}finally{clearTimeout(timeout);}
}

addStyle(`body{color:#c9cce2;background:#080d1d}.magic{width:100%;height:100%;position:relative;overflow:hidden;background:radial-gradient(ellipse at 50% 42%,#1a2144 0,#10142c 37%,#080c17 80%)}.stars{position:absolute;inset:0;background-image:radial-gradient(#a9b8e54d .8px,transparent .9px);background-size:91px 83px;opacity:.35}.orb{position:absolute;top:42%;left:50%;width:87%;max-width:440px;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;border:0;background:radial-gradient(ellipse at 48% 7%,#4e5653 0,transparent 27%),radial-gradient(ellipse at 50% 30%,#1e2527,#080e11 65%,#1a2225 85%,#05080a 100%);box-shadow:inset 3px 1px 4px #afbfbe5c,inset -2px -1px 4px #d1efff3b,0 12px 24px #0009}.orb:before{content:'';position:absolute;inset:2%;border-radius:50%;background:radial-gradient(ellipse at 50% -8%,#edf6e4d9 0,transparent 24%);clip-path:polygon(21% 0,80% 0,72% 11%,28% 11%);filter:blur(1px)}.orb:after{content:'';position:absolute;inset:0;border-radius:50%;box-shadow:inset 7px -1px 7px -5px #399aff,inset -7px -1px 7px -5px #6091ff;pointer-events:none}.seam{position:absolute;top:49%;left:0;right:0;height:2px;background:linear-gradient(90deg,#707c7766,transparent 25%,transparent 75%,#707c7766);box-shadow:0 2px 2px #000}.rim{position:absolute;width:64%;height:64%;left:18%;top:19%;border-radius:50%;padding:8px;background:conic-gradient(from 20deg,#5e696e,#b6c6d2,#596b74,#dce5e9,#4f626b,#d9e8ea,#697578);box-shadow:0 0 0 3px #373f43,0 4px 9px #0008}.window{display:block;height:100%;width:100%;position:relative;border-radius:50%;background:radial-gradient(ellipse at 50% 55%,#111e3d,#080e18 74%);box-shadow:inset 0 3px 10px #000;overflow:hidden}.triangle{position:absolute;left:14%;top:24%;width:72%;height:64%;clip-path:polygon(0 0,100% 0,50% 100%);background:linear-gradient(150deg,#86aaff,#557af5 35%,#263bba);filter:drop-shadow(0 0 3px #527aff);transition:opacity .4s,transform .7s}.triangle:before{content:'';position:absolute;inset:2px;clip-path:polygon(0 0,100% 0,50% 100%);background:linear-gradient(150deg,#7297ff,#4564e0 45%,#253091)}.answer{position:absolute;top:9%;left:13%;width:74%;color:#edf6ff;text-align:center;font:800 clamp(9px,2.8vw,14px)/1.35 Arial,sans-serif;letter-spacing:.5px;text-shadow:0 1px 4px #b3d7ff}.answer.initial{font-size:30px}.magic.thinking .triangle{opacity:.08;transform:translateY(15px) rotate(-20deg)}.magic.thinking .orb{animation:orb-shake .55s ease-in-out 2}.magic .guide{top:75%;font-weight:500;font-size:15px}.magic .sensor{bottom:35px;color:#b3b8d4}.status{position:absolute;top:76%;left:30px;right:30px;text-align:center;font-size:14px;color:#8994b5;pointer-events:none}@keyframes orb-shake{25%{transform:translate(-53%,-52%) rotate(-5deg)}75%{transform:translate(-47%,-48%) rotate(5deg)}}`);
mountPlayableMarkup(root, `<div class="magic"><div class="stars"></div><button class="orb" aria-label="Scuoti la sfera delle risposte"><span class="seam"></span><span class="rim"><span class="window"><span class="triangle"><span class="answer initial">?</span></span></span></span></button><div class="guide">Scuoti o tocca per una risposta</div><div class="status" aria-live="polite"></div><button class="sensor">Attiva scuotimento</button></div>`);
const answers=["È CERTO", "SENZA DUBBIO", "SÌ, ASSOLUTAMENTE", "PUOI CONTARCI", "DIREI DI SÌ", "MOLTO PROBABILE", "LE PROSPETTIVE SONO BUONE", "SÌ", "TUTTO FA PENSARE DI SÌ", "RIPROVA PIÙ TARDI", "MEGLIO NON DIRTELO ORA", "NON POSSO PREVEDERLO ORA", "CONCENTRATI E CHIEDI DI NUOVO", "NON CONTARCI", "LA MIA RISPOSTA È NO", "LE MIE FONTI DICONO DI NO", "LE PROSPETTIVE NON SONO BUONE", "NE DUBITO MOLTO", "RISPOSTA INCERTA, RIPROVA", "È DECISAMENTE COSÌ"];
const orb=root.querySelector('.orb'),game=root.querySelector('.magic'),answer=root.querySelector('.answer'),status=root.querySelector('.status');
// Typeset each response inside the triangle's actual taper, rather than a fixed tiny rectangle.
function chooseAnswerLayout(message,width,height,measure){
 const words=String(message).trim().split(/\s+/),margin=Math.max(4,width*.028),top=Math.max(3,height*.065);let compact=null;
 for(let size=Math.floor(Math.min(width*.66,height*.72));size>=8;size--){
  const metrics=measure('ÁÉÌÔÙgj',size),ascent=metrics.ascent,descent=metrics.descent;
  const step=size*1.12,cache=new Map();
  const lineWidth=(a,b)=>{const key=a+':'+b;if(!cache.has(key))cache.set(key,measure(words.slice(a,b).join(' '),size).width);return cache.get(key);};
  let best=null;
  for(let count=1;count<=Math.min(6,words.length);count++){
   if(top+ascent+descent+(count-1)*step>height*.88)continue;
   function arrange(start,row){
    const y=top+ascent+row*step,bottom=y+descent+1;
    // The visible triangle is widest at the top and converges to its bottom point.
    const available=width*(1-bottom/height)-margin*2;
    let winner=null;
    for(let end=start+1;end<=words.length-(count-row-1);end++){
     const used=lineWidth(start,end);if(used>available)break;
     const item={text:words.slice(start,end).join(' '),x:width/2,y,width:used,available};
     if(row===count-1){if(end!==words.length)continue;const candidate={lines:[item],score:used/Math.max(1,available)};if(!winner||candidate.score>winner.score)winner=candidate;}
     else{const rest=arrange(end,row+1);if(!rest)continue;const candidate={lines:[item,...rest.lines],score:used/Math.max(1,available)+rest.score};if(!winner||candidate.score>winner.score)winner=candidate;}
    }
    return winner;
   }
   const candidate=arrange(0,0);
   if(candidate&&(!best||candidate.score/candidate.lines.length>best.score/best.lines.length))best=candidate;
  }
  if(best){const value={size,ascent,descent,lines:best.lines};if(size>=12)return value;compact ||= value;}
 }
 // Long translated words may wrap between letters, as CSS overflow-wrap does.
 // Try larger legible type first, and accept a layout only if every character fits.
 for(let size=Math.floor(Math.min(width*.35,height*.5));size>=8;size--){
  const metrics=measure('ÁÉÌÔÙgj',size),lines=[];let rest=String(message).trim(),row=0;
  while(rest&&row<10){
   const y=top+metrics.ascent+row*size*1.12,bottom=y+metrics.descent+1;
   if(bottom>height*.88)break;
   const available=width*(1-bottom/height)-margin*2;
   let count=0;while(count<rest.length&&measure(rest.slice(0,count+1),size).width<=available)count++;
   if(!count)break;
   const space=rest.lastIndexOf(' ',count);if(count<rest.length&&space>=Math.floor(count*.65))count=space;
   const value=rest.slice(0,count).trimEnd();lines.push({text:value,x:width/2,y,width:measure(value,size).width,available});rest=rest.slice(count).trimStart();row++;
  }
  if(!rest)return{size,ascent:metrics.ascent,descent:metrics.descent,lines};
 }
 return compact||{size:8,ascent:8,descent:2,lines:[{text:String(message),x:width/2,y:top+8,width:measure(String(message),8).width}]};
}
let currentAnswer='?';
const answerMeasure=document.createElement('canvas').getContext('2d');
function fitAnswer(message=currentAnswer){
 currentAnswer=String(message);const triangle=answer.parentElement,width=triangle.clientWidth,height=triangle.clientHeight;
 if(!width||!height||!answerMeasure)return;
 const family=getComputedStyle(answer).fontFamily;
 function measure(value,size){
  answerMeasure.font=`700 ${size}px ${family}`;
  const metrics=answerMeasure.measureText(value);
  return{width:Math.max(metrics.width,(metrics.actualBoundingBoxLeft||0)+(metrics.actualBoundingBoxRight||0)),ascent:metrics.actualBoundingBoxAscent||size*.85,descent:Math.max(1,metrics.actualBoundingBoxDescent||size*.2)};
 }
 const layout=chooseAnswerLayout(currentAnswer,width,height,measure),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('aria-hidden','true');
 for(const item of layout.lines){const line=document.createElementNS(ns,'text');line.setAttribute('x',String(item.x));line.setAttribute('y',String(item.y));line.setAttribute('text-anchor','middle');line.setAttribute('font-size',String(layout.size));line.setAttribute('font-family',family);line.setAttribute('font-weight','700');line.textContent=item.text;svg.append(line);}
 answer.replaceChildren(svg);answer.setAttribute('aria-label',currentAnswer);answer.dataset.fontSize=String(layout.size);answer.dataset.lines=String(layout.lines.length);
}
addStyle(`#root .triangle .answer{inset:0;width:100%;height:100%;font-family:UIBody,Arial,sans-serif;font-weight:700;letter-spacing:0;line-height:1;text-wrap:initial;pointer-events:none}#root .triangle .answer svg{display:block;width:100%;height:100%;overflow:visible;fill:currentColor}`);
fitAnswer();listen(window,'resize',()=>fitAnswer());
const answerResize=typeof ResizeObserver==='function'?new ResizeObserver(()=>fitAnswer()):null;
answerResize?.observe(answer.parentElement);listen(window,'pagehide',()=>answerResize?.disconnect());
document.fonts?.ready.then(()=>{if(!disposed)fitAnswer();});

let phase='ready',elapsed=0,lastAnswer=-1;
const motion=sensorInput({shake:true,onShake:ask});
function ask(){if(phase==='thinking'||phase==='settling'||!hostActive)return;unlockAudio();motion.start();hideGuide();phase='thinking';elapsed=0;game.classList.add('thinking');status.textContent='';root.dataset.phase=phase;tone(140,.35,.09,'sine',70);}
listen(orb,'click',ask);listen(window,'keydown',e=>{if(e.code==='Space'){e.preventDefault();ask();}});
runLoop(dt=>{if(phase==='ready'||phase==='answered')return;elapsed+=dt;if(phase==='thinking'&&elapsed>1.15){let next=Math.floor(Math.random()*answers.length);if(next===lastAnswer)next=(next+1)%answers.length;lastAnswer=next;answer.classList.remove('initial');fitAnswer(answers[next]);game.classList.remove('thinking');phase='settling';root.dataset.phase=phase;tone(520,.4,.08,'sine',780);}if(phase==='settling'&&elapsed>2.1){phase='answered';root.dataset.phase=phase;status.textContent='Scuoti ancora';}});


configure(()=>{root.querySelector('.guide').textContent=String(setting('GUIDE',"Scuoti o tocca per una risposta"));});

})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.magic .guide{font:700 18px/1.4 UIBody,system-ui,sans-serif;top:75%;color:#d7e0ff}\n.magic .sensor{bottom:50px;min-height:44px;padding:10px 20px;font-size:14px;background:#ffffff0e;border-color:#9cafd566}\n.magic .status{top:80%;bottom:auto;font-size:14px;line-height:1.4;color:#aebadd}\n.answer{font-family:UIBody,system-ui,sans-serif;font-size:clamp(12px,3vw,14px);line-height:1.3;letter-spacing:0;left:8%;width:84%;text-wrap:balance}\n.answer.initial{font-size:28px}\n";
  document.head.append(uiStyle);
})();
