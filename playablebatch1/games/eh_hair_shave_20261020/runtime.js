(function(){'use strict';
const el=id=>document.getElementById(id),canvas=el('canvas'),ctx=canvas.getContext('2d',{alpha:false}),spec=window.GAME_SPEC;
const images={},config={},hosted=new URLSearchParams(location.search).get('host')==='fyp'||new URLSearchParams(location.search).get('feedReview')==='1';let running=false,hidden=false,hostActive=!hosted,paused=false,last=0,age=0,app;
document.documentElement.dataset.feedPreview=String(hosted&&!hostActive);
const soundNodes=new Set(),voices=new Set();let ac;
const R=window.Playable={spec,images,ctx,canvas,w:390,h:598,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,config,
 clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),mix:(a,b,p)=>a+(b-a)*p,ease:p=>1-Math.pow(1-p,3),
 cover(id){const im=images[id],f=spec.photoFraming,s=Math.max(R.w/im.width,R.h/im.height)*(f?.zoom||1),w=im.width*s,h=im.height*s;let y=f?R.h*f.screenY-h*f.y:(R.h-h)/2;if(f?.topLandmark!==undefined)y=Math.max(y,R.h*f.minTop-h*f.topLandmark);return{x:f?R.clamp(R.w*.5-w*f.x,R.w-w,0):(R.w-w)/2,y:R.clamp(y,R.h-h,0),w,h};},
 photo(id,alpha=1){const p=R.cover(id);ctx.save();ctx.globalAlpha=alpha;ctx.drawImage(images[id],p.x,p.y,p.w,p.h);ctx.restore();return p;},
 point(id,p){const b=R.cover(id);return{x:b.x+b.w*p.x,y:b.y+b.h*p.y};},
 sprite(id,x,y,w,h,rotation=0,alpha=1,anchor={x:.5,y:.5}){const im=images[id];if(!im||!Number.isFinite(x+y+w))return;h=h??w*im.height/im.width;ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.globalAlpha=alpha;ctx.drawImage(im,-w*anchor.x,-h*anchor.y,w,h);ctx.restore();},
 frame(ids,t,duration,x,y,w,h,loop=false){
 if(t<0||(!loop&&t>=duration))return;if(loop&&R.reduced)t=duration*.5;
 const n=Math.min(ids.length-1,Math.floor((loop?t%duration:t)/duration*ids.length));
 for(let ahead=0;ahead<3;ahead++){const index=loop?(n+ahead)%ids.length:n+ahead;if(index<ids.length)loadAsset(ids[index]).catch(()=>{});}
 let index=n;while(index>=Math.max(0,n-3)&&!images[ids[index]])index--;
 if(index>=Math.max(0,n-3))R.sprite(ids[index],x,y,w,h);
},
 hud(left='',right='',center=false){el('left').textContent=left;el('right').textContent=right;el('hud').classList.toggle('center',center);},
 guide(text,show=true){el('guide').textContent=text;el('guide').hidden=!show;},
 result(title,sub=''){el('resultTitle').textContent=title;el('resultSub').textContent=sub;el('result').hidden=!title;el('retry').hidden=!title;},
 announce(text){el('status').textContent=text;},
 unlock(){try{ac??=new(window.AudioContext||window.webkitAudioContext)();if(ac.state==='suspended')ac.resume().catch(()=>{});}catch{}},
 tone(kind='good'){if(!ac||ac.state!=='running')return;const now=ac.currentTime,o=ac.createOscillator(),g=ac.createGain();o.type=kind==='bad'?'triangle':'sine';o.frequency.setValueAtTime(kind==='bad'?230:650,now);o.frequency.exponentialRampToValueAtTime(kind==='bad'?130:900,now+.12);g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(.09,now+.008);g.gain.exponentialRampToValueAtTime(.0001,now+.17);o.connect(g);g.connect(ac.destination);o.start();o.stop(now+.19);voices.add(o);o.onended=()=>{voices.delete(o);o.disconnect();g.disconnect();};},
 sound(key,volume=.5,loop=false){const path=spec.audio[key];if(!path)return null;const a=new Audio(path);a.volume=volume;a.loop=loop;soundNodes.add(a);a.addEventListener('ended',()=>soundNodes.delete(a),{once:true});a.play().catch(()=>{soundNodes.delete(a);});return a;},
 stop(a){if(a){a.pause();a.currentTime=0;soundNodes.delete(a);}},
 silence(){for(const a of soundNodes)R.stop(a);for(const o of voices){try{o.stop();}catch{}}voices.clear();},
 setAction(label){el('play').setAttribute('aria-label',label);},
 releaseInput(){endPointer();},
 setDirection(show,fn){el('direction').hidden=!show;el('direction').onclick=()=>{if(paused||!hostActive)return;R.unlock();fn();};},
 debug:()=>({state:app?.state?.(),paused,hostActive,hidden,loaded:Object.keys(images).length,sounds:soundNodes.size})};
// Keep startup independent of optional animation frames and bound decode work.
const assetSlots=new Map(),assetJobs=new Map(),assetQueue=[],frameCache=new Map(),frameFailures=new Map();
let assetLoads=0,assetAlive=true,frameStamp=0,booting=false;
const effectSlot=id=>/^FX_/.test(id),frameLimit=12;
function trimFrames(){
  while(frameCache.size>frameLimit){
    let oldest=null,stamp=Infinity;
    for(const [id,time]of frameCache)if(time<stamp){oldest=id;stamp=time;}
    frameCache.delete(oldest);const image=images[oldest];delete images[oldest];
    if(image)image.removeAttribute('src');
  }
}
function readImage(slot,attempt=0){
  return new Promise((resolve,reject)=>{
    const image=new Image();image.decoding='async';
    const done=error=>{
      clearTimeout(timer);image.onload=null;image.onerror=null;
      if(error){image.removeAttribute('src');reject(error);}else resolve(image);
    };
    const timer=setTimeout(()=>done(Error('Image timed out: '+slot.id)),12000);
    image.onload=()=>done(image.naturalWidth>0&&image.naturalHeight>0?null:Error('Image is empty: '+slot.id));
    image.onerror=()=>done(Error('Image could not be loaded: '+slot.id));
    // load/naturalWidth works even when the optional decode() promise is rejected
    // under memory pressure. Canvas decodes only the images it actually paints.
    image.src=slot.path+(attempt?(slot.path.includes('?')?'&':'?')+'retry='+attempt:'');
  });
}
function pumpAssets(){
  while(assetAlive&&assetLoads<3&&assetQueue.length){
    const job=assetQueue.shift();assetLoads++;
    (async()=>{
      let image;
      try{image=await readImage(job.slot);}catch(first){if(!assetAlive)throw first;image=await readImage(job.slot,1);}
      if(!assetAlive){image.removeAttribute('src');return null;}
      images[job.slot.id]=image;
      if(effectSlot(job.slot.id)){frameFailures.delete(job.slot.id);frameCache.set(job.slot.id,++frameStamp);trimFrames();}
      return image;
    })().then(job.resolve,error=>{
      if(effectSlot(job.slot.id)){frameFailures.set(job.slot.id,performance.now());job.resolve(null);}
      else job.reject(error);
    }).finally(()=>{assetLoads--;assetJobs.delete(job.slot.id);pumpAssets();});
  }
}
function loadAsset(id){
  if(images[id]){if(effectSlot(id))frameCache.set(id,++frameStamp);return Promise.resolve(images[id]);}
  if(assetJobs.has(id))return assetJobs.get(id);
  const slot=assetSlots.get(id);if(!slot)return Promise.reject(Error('Missing image slot: '+id));
  if(effectSlot(id)&&((frameFailures.has(id)&&performance.now()-frameFailures.get(id)<2500)||assetJobs.size>=6))return Promise.resolve(null);
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  assetJobs.set(id,promise);
  const job={slot,resolve,reject};effectSlot(id)?assetQueue.push(job):assetQueue.unshift(job);
  pumpAssets();return promise;
}
window.addEventListener('pagehide',()=>{
  assetAlive=false;
  for(const job of assetQueue.splice(0))job.resolve(null);
  for(const [id,image]of Object.entries(images)){image.removeAttribute('src');delete images[id];}
  frameCache.clear();assetJobs.clear();
},{once:true});

function size(){const b=canvas.getBoundingClientRect();R.w=b.width;R.h=b.height;const d=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(b.width*d);canvas.height=Math.round(b.height*d);ctx.setTransform(d,0,0,d,0,0);document.documentElement.style.setProperty('--ui',Math.min(b.width/390,b.height/598));app?.resize?.();}
function reset(){endPointer();R.silence();paused=false;el('pause').hidden=true;R.result('');el('direction').hidden=true;app.reset();R.announce('Ready');if(running)app.draw(0);last=0;}
function point(e){const b=canvas.getBoundingClientRect();return{x:e.clientX-b.left,y:e.clientY-b.top};}
function canInput(){return running&&!paused&&hostActive&&!hidden;}
function action(e){if(!canInput()||app.inputMode==='drag')return;R.unlock();const p=e?point(e):{x:R.w/2,y:R.h*.70};app.action(p);}
let down=null;
function endPointer(){const d=down;down=null;app?.pointerEnd?.();if(d&&el('play').hasPointerCapture?.(d.id))el('play').releasePointerCapture(d.id);}
el('play').addEventListener('pointerdown',e=>{if(e.isPrimary===false||e.button!==0||!canInput())return;if(app.inputMode==='drag'){R.unlock();if(!app.pointerStart(point(e)))return;e.preventDefault();down={id:e.pointerId};el('play').setPointerCapture(e.pointerId);return;}down={id:e.pointerId,x:e.clientX,y:e.clientY};});
el('play').addEventListener('pointermove',e=>{if(app?.inputMode!=='drag'||!down||e.pointerId!==down.id)return;if(!canInput()||e.buttons===0){endPointer();return;}e.preventDefault();app.pointerMove(point(e));});
el('play').addEventListener('pointercancel',e=>{if(down&&e.pointerId===down.id)endPointer();});
el('play').addEventListener('lostpointercapture',e=>{if(down&&e.pointerId===down.id)endPointer();});
el('play').addEventListener('pointerup',e=>{if(!down||e.pointerId!==down.id)return;const d=down;if(app.inputMode==='drag'){endPointer();return;}down=null;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>18)return;action(e);});
el('play').addEventListener('click',e=>{if(e.detail===0)action();});
el('play').addEventListener('keydown',e=>{if(!canInput()||!app.keyStroke||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();R.unlock();app.keyStroke(e.key);});
el('retry').onclick=()=>{R.unlock();reset();};el('resume').onclick=()=>{R.unlock();paused=false;el('pause').hidden=true;app.resume?.();last=0;};
function pause(){endPointer();R.silence();app?.pause?.();if(running&&app?.isPlaying?.()){paused=true;el('pause').hidden=false;}}
document.addEventListener('visibilitychange',()=>{hidden=document.hidden;if(hidden)pause();last=0;});
window.addEventListener('blur',pause);window.addEventListener('resize',size);
// Only the parent frame can control activity; never accept commands from sibling windows.
window.addEventListener('message',e=>{if(e.source!==parent||parent===window)return;const d=e.data;if(d?.type==='playable-active'&&typeof d.active==='boolean'){hostActive=d.active;document.documentElement.dataset.feedPreview=String(!hostActive);if(!hostActive&&running){pause();reset();}last=0;}});
function palette(){if(parent===window)return;const c=document.createElement('canvas');c.width=32;c.height=48;const x=c.getContext('2d');x.drawImage(canvas,0,0,32,48);try{parent.postMessage({type:'playable-palette',top:Array.from(x.getImageData(0,0,32,12).data),bottom:Array.from(x.getImageData(0,36,32,12).data)},location.origin);}catch{}}
function loop(t){requestAnimationFrame(loop);if(!running||hidden||paused){last=0;return;}const dt=last?Math.min(.05,(t-last)/1000):0;last=t;age+=dt;if(hostActive)app.update(dt);else app.previewUpdate?.(dt);app.draw(age);const state=app.state?.().state;if(el('stage').dataset.state!==state)el('stage').dataset.state=state;}
async function boot(){
  if(booting||running)return;booting=true;
  const loading=el('loading');loading.hidden=false;loading.classList.remove('error');loading.textContent='Loading…';
  frameFailures.clear();
  try{
    const c=await fetch('./game.config.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Configuration failed to load');return r.json();});
    Object.assign(config,c);
    for(const t of c.tweaks||[])if(typeof t.value==='number'&&Number.isFinite(t.value))spec.settings[t.id]=R.clamp(t.value,t.min??-Infinity,t.max??Infinity);
    for(const slot of c.images||[]){
      if(!slot.path||/^(https?:|data:)/.test(slot.path))throw Error('Image slot must use a local relative path: '+slot.id);
      assetSlots.set(slot.id,slot);
    }
    // Only portraits, tools and the result frame are required for the first view.
    // Effect frames load as they are used and never hold up the playable.
    await Promise.all([...assetSlots.keys()].filter(id=>!effectSlot(id)).map(loadAsset));
    if(!assetAlive)return;
    document.title=spec.title;el('stage').className=spec.id;app=window.createGame(R);size();reset();
    app.draw(0);running=true;loading.hidden=true;document.documentElement.dataset.playableLoading='false';palette();requestAnimationFrame(loop);
  }catch(error){
    running=false;loading.hidden=false;loading.classList.add('error');loading.textContent='Could not load this game. '+error.message+' ';
    const retry=document.createElement('button');retry.type='button';retry.textContent='Tap to retry';
    retry.style.cssText='display:block;margin:16px auto 0;padding:12px 20px;border:0;border-radius:24px;font:600 16px system-ui;cursor:pointer';
    retry.onclick=()=>{booting=false;boot();};loading.append(retry);console.error(error);
  }finally{booting=false;}
}

boot();
})();
