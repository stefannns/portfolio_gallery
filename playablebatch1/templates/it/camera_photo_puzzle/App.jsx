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
function cover(ctx,im,x,y,w,h){if(!im)return false;const iw=im.videoWidth||im.naturalWidth||im.width,ih=im.videoHeight||im.naturalHeight||im.height;if(!iw||!ih)return false;const scale=Math.max(w/iw,h/ih);ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.drawImage(im,x+(w-iw*scale)/2,y+(h-ih*scale)/2,iw*scale,ih*scale);ctx.restore();return true;}
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

mount(`.fit{background:#fff}.blob{position:absolute;width:230px;height:230px;border-radius:50%;background:#f9de83;right:-85px;top:-85px}.lavender{position:absolute;width:230px;height:220px;border-radius:50%;background:#e5ddf5;left:-100px;bottom:-100px}.guide{top:85px;font-family:Playful,Arial;font-size:18px}.capability{padding:10px 12px;font-size:14px}.puzzle{position:absolute;left:55px;top:146px;width:280px;height:280px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:4px;touch-action:none}.puzzle.is-loading{pointer-events:none}.puzzle-placeholder{grid-area:1/1/4/4;display:grid;place-items:center;text-align:center;padding:24px;background:#f3f0f7;border-radius:12px;font-size:15px;line-height:1.5;color:#655d70}.tile{padding:0;position:relative;overflow:hidden;border-radius:9px;box-shadow:0 2px 2px #25252a18;background:#f0ece1;min-height:0}.tile canvas{display:block;width:100%;height:100%;pointer-events:none}.tile.selected{outline:3px solid #6464c8;z-index:2}.tile.dragging{opacity:.6;transform:scale(.96)}.hud{font-size:28px;color:#514b5b;top:30px}.photo-status{top:432px;bottom:auto;font-size:12px;color:#655d70;line-height:1.4}.bottom{bottom:50px;display:grid;grid-template-columns:1fr 1fr;gap:8px}.result{background:#f3f0fb}.result button{background:#4c497b}`,`<div class="hud"><span class="moves">0 mosse</span><span class="time">0s</span></div><div class="guide">Scambia i pezzi e ricomponi la foto</div><div class="puzzle" aria-label="Puzzle fotografico"></div><div class="status photo-status" role="status" aria-live="polite" hidden></div><input id="puzzle-photo-input" type="file" accept="image/*" hidden><div class="bottom"><button class="capability photo-upload" aria-controls="puzzle-photo-input">Carica foto</button><button class="capability shuffle" aria-label="Mescola i pezzi" disabled>↻ Mescola</button></div>${resultMarkup()}`,'#fff');
let puzzlePhoto=null,hasUploadedPhoto=false,uploading=false,uploadRequest=0;
let pieces=shuffle([...Array(9).keys()]),selected=-1,moves=0,seconds=0,started=false,done=false,pointerStart=null;
const photoInput=$('#puzzle-photo-input'),uploadButton=$('.photo-upload'),photoStatus=$('.photo-status'),photoUrls=new Set();
const puzzleItalian=true;
const photoText=(en,it)=>puzzleItalian?it:en;
function setPhotoStatus(message=''){photoStatus.textContent=message;photoStatus.hidden=!message;}
uploadButton.textContent=photoText("Carica foto",'Carica foto');$('.shuffle').textContent=photoText("↻ Mescola",'↻ Mescola');

function squarePhoto(source){
 const width=source.naturalWidth||source.width,height=source.naturalHeight||source.height;
 if(!width||!height)throw Error("L’immagine è vuota");
 const photo=document.createElement('canvas');photo.width=photo.height=600;
 const brush=photo.getContext('2d');brush.fillStyle='#fff';brush.fillRect(0,0,600,600);
 // A square center crop preserves the original proportions, never stretches it.
 if(!cover(brush,source,0,0,600,600))throw Error("Impossibile adattare l’immagine");
 return photo;
}
function drawTiles(){
 const board=$('.puzzle');board.replaceChildren();
 if(!puzzlePhoto){
  const placeholder=document.createElement('div');placeholder.className='puzzle-placeholder';
  placeholder.innerHTML='<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="7" width="34" height="30" rx="4"/><circle cx="15" cy="17" r="4"/><path d="m7 33 11-10 6 5 6-8 8 13"/></svg>';placeholder.setAttribute('aria-label',photoText("Anteprima foto",'Anteprima foto'));board.append(placeholder);return;
 }
 pieces.forEach((n,i)=>{
  const button=document.createElement('button');button.className='tile'+(i===selected?' selected':'');
  button.dataset.slot=i;button.setAttribute('aria-label',`Pezzo del puzzle ${n+1}`);
  const tile=document.createElement('canvas');tile.width=tile.height=200;
  const size=puzzlePhoto.width/3;tile.getContext('2d').drawImage(puzzlePhoto,(n%3)*size,Math.floor(n/3)*size,size,size,0,0,200,200);
  button.append(tile);board.append(button);
 });
 root.dataset.moves=moves;root.dataset.solved=String(done);
}
function newPuzzle(photo=puzzlePhoto){
 if(!photo)return;puzzlePhoto=photo;pieces=shuffle([...Array(9).keys()]);
 if(pieces.every((v,i)=>v===i))[pieces[0],pieces[1]]=[pieces[1],pieces[0]];
 selected=-1;moves=0;seconds=0;started=false;done=false;pointerStart=null;
 $('.moves').textContent="0 mosse";$('.time').textContent='0s';drawTiles();$('.shuffle').disabled=uploading;state('ready');
}
function swap(a,b){
 if(a===b||done||uploading)return;[pieces[a],pieces[b]]=[pieces[b],pieces[a]];moves++;started=true;gesture();selected=-1;
 $('.moves').textContent=`${moves} mosse`;sound(500,.05,.12);done=pieces.every((v,i)=>v===i);drawTiles();state('playing');
 if(done){success();result("Foto ricomposta!",Math.max(100,1000-moves*12-Math.round(seconds)*2),`${moves} mosse · ${Math.ceil(seconds)} secondi`,newPuzzle);}
}
on($('.puzzle'),'pointerdown',e=>{
 const tile=e.target.closest('.tile');if(!tile||done||uploading)return;
 pointerStart={x:e.clientX,y:e.clientY,slot:Number(tile.dataset.slot)};tile.setPointerCapture(e.pointerId);
});
on($('.puzzle'),'pointermove',e=>{if(!pointerStart)return;if(Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>8)$(`.tile[data-slot="${pointerStart.slot}"]`)?.classList.add('dragging');});
on($('.puzzle'),'pointerup',e=>{
 if(!pointerStart)return;const start=pointerStart;pointerStart=null;const board=$('.puzzle').getBoundingClientRect();
 const col=Math.floor((e.clientX-board.left)/(board.width/3)),row=Math.floor((e.clientY-board.top)/(board.height/3)),target=col+row*3;
 const moved=Math.hypot(e.clientX-start.x,e.clientY-start.y)>8;
 if(moved){if(col>=0&&col<3&&row>=0&&row<3)swap(start.slot,target);else drawTiles();}
 else if(selected>=0&&selected!==start.slot)swap(selected,start.slot);
 else{selected=start.slot;drawTiles();}
});
for(const type of ['pointercancel','lostpointercapture'])on($('.puzzle'),type,()=>{if(!pointerStart)return;pointerStart=null;drawTiles();});

async function loadUploadedPhoto(file){
 if(!file)return;
 const imageFile=file.type.startsWith('image/')||(!file.type&&/\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i.test(file.name));
 if(!imageFile||!file.size){setPhotoStatus(photoText("Scegli un file immagine. Il puzzle attuale non cambia.",'Scegli un file immagine. Il puzzle attuale non cambia.'));return;}
 if(file.size>30*1024*1024){setPhotoStatus(photoText("La foto è troppo grande. Scegli un’immagine più piccola.",'La foto è troppo grande. Scegli un’immagine più piccola.'));return;}
 const request=++uploadRequest;uploading=true;pointerStart=null;selected=-1;
 uploadButton.disabled=true;$('.shuffle').disabled=true;$('.puzzle').classList.add('is-loading');
 setPhotoStatus(photoText("Apertura della foto…",'Apertura della foto…'));
 const url=URL.createObjectURL(file);photoUrls.add(url);
 try{
  const image=new Image();image.decoding='async';
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error("Impossibile leggere l’immagine"));image.src=url;});
  if(disposed||request!==uploadRequest)return;
  const photo=squarePhoto(image);hasUploadedPhoto=true;uploading=false;
  $('.modal').hidden=true;newPuzzle(photo);root.dataset.photoSource='uploaded';
  setPhotoStatus();
 }catch(_){
  if(!disposed&&request===uploadRequest)setPhotoStatus(photoText("Impossibile aprire la foto. Prova un file JPG, PNG o WebP.",'Impossibile aprire la foto. Prova un file JPG, PNG o WebP.'));
 }finally{
  URL.revokeObjectURL(url);photoUrls.delete(url);
  if(!disposed&&request===uploadRequest){uploading=false;uploadButton.disabled=false;$('.shuffle').disabled=!puzzlePhoto;$('.puzzle').classList.remove('is-loading');drawTiles();}
 }
}
on(uploadButton,'click',()=>{unlockAudio();photoInput.click();});
on(photoInput,'change',()=>{const file=photoInput.files?.[0];photoInput.value='';if(file)loadUploadedPhoto(file);});
on($('.shuffle'),'click',()=>{if(!puzzlePhoto||uploading)return;gesture();newPuzzle();});
cleanups.push(()=>{uploadRequest++;for(const url of photoUrls)URL.revokeObjectURL(url);photoUrls.clear();});

const defaultPhoto=image('./assets/sample-photo.webp');
on(defaultPhoto,'load',()=>{
 if(disposed||hasUploadedPhoto||uploading)return;
 try{newPuzzle(squarePhoto(defaultPhoto));root.dataset.photoSource='default';setPhotoStatus();}
 catch(_){setPhotoStatus(photoText("Foto non disponibile",'Foto non disponibile'));}
});
on(defaultPhoto,'error',()=>{if(!puzzlePhoto)setPhotoStatus(photoText("Foto non disponibile",'Foto non disponibile'));});
drawTiles();state('loading');
loop(dt=>{if(started&&!done&&!uploading){seconds+=dt;$('.time').textContent=Math.floor(seconds)+'s';}});


// Printed backdrop is owned by the full host viewport, never the fitted board.
function updateGraphicPaper106(){
 const rect=root.getBoundingClientRect(),scale=Math.min(rect.width/390,rect.height/598);
 root.style.position='relative';root.style.backgroundColor='#f4d467';
 root.style.backgroundImage='url('+JSON.stringify(String(setting('PAPER_BACKDROP','./assets/paper-print-v1.svg')))+')';
 root.style.backgroundSize=(256*scale)+'px '+(256*scale)+'px';root.style.backgroundRepeat='repeat';
 root.style.setProperty('--paper-scale',String(scale));root.dataset.backgroundTheme='graphic-paper';
}
const paperStyle106=document.createElement('style');
paperStyle106.textContent=`html,body{background:#f4d467}#root>.fit{background:transparent!important}#root .hud,#root .guide{color:#282723}.photo-status{color:#4b442c!important}.tile{border:1.5px solid #282723;border-radius:6px;box-shadow:none}.tile.selected{outline:3px solid #282723;outline-offset:1px}.bottom .capability{border:2px solid #282723;border-radius:6px;background:#fffbea;color:#282723;box-shadow:0 3px 0 #28272326}.bottom .capability:active{box-shadow:none}.puzzle-placeholder{background:#fffbea;color:#282723;border:2px solid #282723}#root>.modal{position:absolute;inset:0;padding:0;z-index:30;background:#28272355;display:grid;place-items:center}#root>.modal>.result{width:320px;max-width:none;max-height:calc((100vh - 80px*var(--paper-scale))/var(--paper-scale));transform:scale(var(--paper-scale));transform-origin:center;border:2px solid #282723;border-radius:10px;background:#fffbea;color:#282723;box-shadow:3px 5px 0 #28272326}#root>.modal .result button{border:2px solid #282723;border-radius:6px;background:#f4d467;color:#282723;box-shadow:0 3px 0 #28272326}`;
document.head.append(paperStyle106);
const paperModal106=$('.modal');
if(paperModal106){
 root.append(paperModal106);
 const syncPaperModal=()=>{$('.fit').inert=!paperModal106.hidden;};
 const modalObserver=new MutationObserver(syncPaperModal);modalObserver.observe(paperModal106,{attributes:true,attributeFilter:['hidden']});syncPaperModal();cleanups.push(()=>modalObserver.disconnect());
}
const paperResize106=new ResizeObserver(updateGraphicPaper106);paperResize106.observe(root);cleanups.push(()=>paperResize106.disconnect());updateGraphicPaper106();

configure(()=>{updateGraphicPaper106();if($('.guide'))$('.guide').textContent=String(setting('GUIDE',"Scambia i pezzi e ricomponi la foto"));});
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n.fit{font-family:UIBody,system-ui,sans-serif}\n.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}\n.capability,.pill{font-family:UIBody,system-ui,sans-serif}\n\n.guide{top:85px;font-size:18px;line-height:1.4}\n.puzzle{left:55px;top:146px;width:280px;height:280px;gap:4px}\n.hud{font-size:28px;top:30px;color:#514b5b}\n.bottom{display:grid;grid-template-columns:1fr 1fr;gap:8px;bottom:50px}\n.bottom .capability{width:100%;font-size:14px;min-height:44px;padding:10px 12px}\n.photo-status{top:432px;bottom:auto;font-size:12px;color:#655d70;line-height:1.4}\n";
  document.head.append(uiStyle);
})();
