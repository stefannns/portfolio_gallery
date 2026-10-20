/* Effect House APJS adapters rebuilt with Canvas 2D, Web Audio and local WASM. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id),scene=window.CATCH_BEAT_SCENE;
  const root=$('game'),canvas=$('stage'),ctx=canvas.getContext('2d');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const hosted=new URLSearchParams(location.search).get('host')==='fyp';
  document.documentElement.dataset.feedPreview=String(hosted);
  let hostActive=!hosted;
  const settings={...scene.settings},images=new Map(),imageOverrides=new Map();
  const round=new CatchBeatEngine.Round(settings);
  const audio=new (window.AudioContext||window.webkitAudioContext)();
  let musicBuffer=null,introBuffer=null,introSource=null,musicSource=null,audioStart=0,clockStart=0,pausedTime=0,paused=false;
  let ready=false,launching=false,finishedAt=0,lastFeedback=null,feedbackAt=-10,now=0,lastTime=0;
  let width=390,height=598,scale=1,localHead=null,headAnchor={x:.5,y:1},headScale=1;
  let pendingHead=null,pendingAnchor=null,photoJob=0,worker=null,previewUrl=null,focusBeforeEditor=null,noticeTimer,photoTimeout;
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  function announce(message){$('notice').textContent=message;$('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,3500);}
  function resize(){
    width=root.clientWidth;height=root.clientHeight;scale=Math.min(width/390,height/598);
    const dpr=Math.min(devicePixelRatio||1,2.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);root.style.setProperty('--u',scale+'px');
    drawScene();
  }
  new ResizeObserver(resize).observe(root);resize();
  function image(path){return images.get(path);}
  async function loadImage(path){
    if(images.has(path))return images.get(path);
    const img=new Image();img.src=imageOverrides.get(path)||path;await img.decode();images.set(path,img);return img;
  }
  async function boot(){
    try{
      let config;try{const response=await fetch('game.config.json');if(response.ok)config=await response.json();}catch{}
      for(const tweak of config?.tweaks||[]){if(tweak.id==='BEAT')settings.beat=tweak.value;if(tweak.id==='DIFFICULTY')settings.difficulty=tweak.value;if(tweak.id==='HOLD_BEATS')settings.holdBeats=tweak.value;}
      for(const item of config?.images||[]){const original=scene.imageSlots[item.id];if(original&&item.path)imageOverrides.set(original,item.path);}
      const guide=config?.texts?.find(t=>t.id==='GUIDE')?.value||'Tap to catch the beat';
      const paths=CatchBeatSolo.assetPaths(scene);
      await Promise.all(paths.map(loadImage));
      try{const data=await fetch(scene.audio.play).then(r=>{if(!r.ok)throw Error();return r.arrayBuffer();});musicBuffer=await audio.decodeAudioData(data);}catch{announce('Music is unavailable. You can still play.');}
      fetch(scene.audio.intro).then(r=>r.arrayBuffer()).then(b=>audio.decodeAudioData(b)).then(b=>introBuffer=b).catch(()=>{});
      ready=true;root.dataset.state='waiting';$('guide').textContent=guide;
      drawScene();document.documentElement.dataset.playableLoading='false';sendPalette();
    }catch(error){$('guide').textContent='Your dancer could not load.';announce('Reload to try again.');root.dataset.state='load-error';console.error(error);}
  }
  function stopMusic(){if(musicSource){try{musicSource.stop();}catch{}musicSource.disconnect();musicSource=null;}}
  function stopIntro(){if(introSource){try{introSource.stop();}catch{}introSource.disconnect();introSource=null;}}
  // The original FYP host owns its gradients; provide only pixels from the initial scene.
  function sendPalette(){
    if(!hosted||window.parent===window||!ready)return;
    const sample=document.createElement('canvas');sample.width=32;sample.height=48;
    const context=sample.getContext('2d',{willReadFrequently:true});
    try{context.drawImage(canvas,0,0,32,48);window.parent.postMessage({type:'playable-palette',top:Array.from(context.getImageData(0,0,32,12).data),bottom:Array.from(context.getImageData(0,36,32,12).data)},location.origin);}catch{}
  }
  window.addEventListener('message',event=>{
    if(!hosted||event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='playable-active'||typeof event.data.active!=='boolean')return;
    hostActive=event.data.active;
    document.documentElement.dataset.feedPreview=String(!hostActive);
    if(!hostActive){
      // Same-URL iframe navigation may not reload. Restore an idle cover explicitly.
      pause();stopMusic();stopIntro();round.reset();paused=false;launching=false;finishedAt=0;lastFeedback=null;feedbackAt=-10;
      if(!$('editor').hidden)closeEditor();
      $('guide').hidden=false;$('result').hidden=true;$('pause').hidden=true;$('photo-controls').hidden=false;
      if(ready){root.dataset.state='waiting';drawScene();}
      audio.suspend().catch(()=>{});
    }
    if(ready&&round.state==='waiting')sendPalette();
  });
  async function playIntro(){
    if(round.state!=='waiting'||introSource||!introBuffer)return;
    try{await audio.resume();if(round.state!=='waiting'||audio.state!=='running')return;introSource=audio.createBufferSource();introSource.buffer=introBuffer;const gain=audio.createGain();gain.gain.value=.5;introSource.connect(gain).connect(audio.destination);introSource.start();introSource.onended=()=>introSource=null;}catch{}
  }
  function startMusic(offset=0){
    stopMusic();
    if(musicBuffer&&audio.state==='running'){
      musicSource=audio.createBufferSource();musicSource.buffer=musicBuffer;
      const gain=audio.createGain();gain.gain.value=.84;musicSource.connect(gain).connect(audio.destination);
      audioStart=audio.currentTime+.035-offset;musicSource.start(audio.currentTime+.035,offset);
      console.info('[BeatAudio] local decoded music started; duration='+musicBuffer.duration.toFixed(3)+'s; offset='+offset.toFixed(3));
    }
    clockStart=performance.now()/1000-offset;
  }
  function clock(){return musicSource?Math.max(0,audio.currentTime-audioStart):Math.max(0,performance.now()/1000-clockStart);}
  async function start(){
    if(!hostActive||!ready||launching||!$('editor').hidden)return;
    launching=true;stopIntro();
    try{await audio.resume();}catch{}
    if(!hostActive){launching=false;return;}
    round.start(settings.autoDuration&&musicBuffer?musicBuffer.duration:settings.gameDuration);
    lastFeedback=null;feedbackAt=-10;paused=false;pausedTime=0;finishedAt=0;
    $('guide').hidden=true;$('result').hidden=true;$('pause').hidden=true;$('photo-controls').hidden=true;
    root.dataset.state='playing';startMusic();launching=false;
  }
  function playAction(){
    if(!hostActive||!ready||launching||!$('editor').hidden||round.state==='result')return;
    if(paused){resume();return;}
    if(round.state==='waiting'){start();return;}
    const result=round.tap(clock());
    if(result?.grade==='count-in')feedbackAt=now;
  }
  $('dance').addEventListener('pointerdown',event=>{if(!event.isPrimary||event.button!==0)return;event.preventDefault();playAction();});
  $('dance').addEventListener('click',event=>{if(event.detail===0)playAction();});
  document.addEventListener('keydown',event=>{
    if(!['Space','Enter'].includes(event.code)||event.repeat||!$('editor').hidden||event.target.closest('button,input')&&event.target!==$('dance'))return;
    event.preventDefault();playAction();
  });
  $('retry').addEventListener('click',()=>{round.reset();start();});
  function pause(){
    if(round.state!=='playing'||paused)return;
    pausedTime=clock();round.tick(pausedTime);paused=true;stopMusic();$('pause').hidden=false;root.dataset.state='paused';
  }
  async function resume(){
    if(!hostActive||!paused)return;
    try{await audio.resume();}catch{}
    if(!hostActive)return;
    startMusic(pausedTime);paused=false;$('pause').hidden=true;root.dataset.state='playing';
  }
  $('resume').addEventListener('click',resume);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();stopIntro();}});
  window.addEventListener('pagehide',()=>{pause();stopMusic();stopIntro();worker?.terminate();});
  function showResult(){
    if(finishedAt)return;
    finishedAt=now;stopMusic();root.dataset.state='result';
    const result=round.result;$('result-score').textContent=result.percent+'%';
    $('result-label').src=scene.textures[{top:'resultTopTex',good:'resultGoodTex',mid:'resultMidTex',low:'resultLowTex'}[result.tier]];
    $('result-label').alt={top:"You're in!",good:'Callback!',mid:'Keep practicing!',low:'Next!'}[result.tier];
    $('result').hidden=false;$('photo-controls').hidden=false;
    $('result').animate(reduced.matches?[]:[{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:260,fill:'both'});
  }
  // Scene coordinates are Y-up. Canvas is Y-down. Keep every sprite aspect ratio.
  function sprite(path,x,y,w,h,alpha=1){const img=image(path);if(!img)return;ctx.save();ctx.globalAlpha=alpha;ctx.drawImage(img,x-w/2,y-h/2,w,h);ctx.restore();}
  function fitSprite(path,x,y,maxW,maxH,alpha=1){const img=image(path);if(!img)return;const s=Math.min(maxW/img.width,maxH/img.height);sprite(path,x,y,img.width*s,img.height*s,alpha);}
  function drawSolo(){
    const layout=CatchBeatSolo.layout(width,height,round.state==='result'),s=layout.scale;
    const t=scene.characters[0],frame=round.state==='playing'?round.playerFrame:round.state==='result'?-1:0;
    const key=f=>f<0?'end':f===0?'intro':'s'+f;
    const idle=round.state==='waiting'&&!reduced.matches?Math.sin(now*1.7)*2.4*scale:0;
    const x=layout.x,y=layout.y+idle;
    // Only char0 is rendered, including on the result screen. Its head is the local upload.
    sprite(scene.frames[key(frame)][0],x,y,t.size.x*s,t.size.y*s);
    const hx=[settings.idleHeadX,settings.s2HeadX,settings.s3HeadX,settings.s4HeadX];
    const hr=[settings.idleHeadRotation,settings.s2HeadRotation,settings.s3HeadRotation,settings.s4HeadRotation];
    const shift=frame<0?settings.endHeadX:hx[frame]||0,rotation=frame<0?settings.endHeadRotation:hr[frame]||0;
    const ax=x+(scene.head.position.x+shift+settings.headSegXOffset)*s;
    const ay=y-(scene.head.position.y+settings.headSegYOffset)*s;
    const img=localHead||image(scene.textures.head);if(!img)return;
    const naturalWidth=localHead?Math.min(155,115*img.width/img.height):scene.head.size.x;
    const hw=naturalWidth*settings.headSize*s*(localHead?headScale:1),hh=hw*img.height/img.width;
    const anchor=localHead?headAnchor:{x:scene.head.pivot.x,y:1-scene.head.pivot.y};
    ctx.save();ctx.translate(ax,ay);ctx.rotate(-rotation*Math.PI/180);ctx.drawImage(img,-hw*anchor.x,-hh*anchor.y,hw,hh);ctx.restore();
  }
  function drawBeatLane(){
    if(round.state==='result')return;
    const cy=height*.67,cx=width/2,span=Math.min(width-60*scale,300*scale),r=15*scale;
    ctx.save();ctx.strokeStyle='#222430';ctx.lineWidth=2*scale;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(cx-span/2,cy);ctx.lineTo(cx+span/2,cy);ctx.stroke();
    if(round.state==='playing'){
      for(const target of round.targets){const delta=(target.time-round.time)/round.beat;if(delta < -1.1||delta>1.1)continue;
        const x=cx-delta*span/2;
        fitSprite(delta>=0?scene.textures.circle1Tex:scene.textures.circle2Tex,x,cy,r*2,r*2,.9);
      }
    }else if(!reduced.matches){const pulse=(Math.sin(now*2)+1)/2;ctx.globalAlpha=.18+pulse*.18;ctx.fillStyle='#fffaf5';ctx.beginPath();ctx.arc(cx,cy,r*1.8,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
    fitSprite(scene.textures.circleCenterTex,cx,cy,43*scale,43*scale);
    const age=now-feedbackAt;
    if(age>=0&&age<settings.beat*.4&&lastFeedback){
      const p=age/(settings.beat*.4),rr=(14+(1-Math.pow(1-p,3))*25)*scale;
      ctx.strokeStyle={perfect:'#ffa095',close:'#e9d3a1',miss:'#94c4e5'}[lastFeedback];ctx.lineWidth=4*scale;ctx.globalAlpha=1-p;ctx.beginPath();ctx.arc(cx,cy,rr,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;
    }
    ctx.restore();
    if(age>=0&&age<settings.beat*1.5&&lastFeedback){
      const p=age/(settings.beat*1.5),fade=p<.45?1:Math.max(0,(1-p)/.55),pop=reduced.matches?1:Math.min(1.14,p*12);
      fitSprite(scene.textures[lastFeedback+'Tex'],cx,cy+54*scale-(reduced.matches?0:p*12*scale),185*scale*pop,48*scale*pop,fade);
    }
  }
  function drawScene(){
    ctx.clearRect(0,0,width,height);
    const bg=image(scene.textures.background);if(bg)ctx.drawImage(bg,0,0,width,height);else{ctx.fillStyle='#f5b3af';ctx.fillRect(0,0,width,height);}
    const stage=image(scene.textures.stage);if(stage){const layout=CatchBeatSolo.layout(width,height,round.state==='result'),feet=layout.y+scene.characters[0].size.y*layout.scale/2,ss=(round.state==='result'?160:200)*scale/stage.width;ctx.globalAlpha=.54;ctx.drawImage(stage,width/2-stage.width*ss/2,feet-28*scale-stage.height*ss/2,stage.width*ss,stage.height*ss);ctx.globalAlpha=1;}
    if(ready){drawSolo();drawBeatLane();}
  }
  function frame(ms){
    now=ms/1000;
    if(!document.hidden){
      if(round.state==='playing'&&!paused){round.tick(clock());for(const e of round.drain()){lastFeedback=e.grade;feedbackAt=now;}if(round.state==='result')showResult();}
      drawScene();
    }
    lastTime=now;requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);boot();

  // Local photo personalization. No remote endpoint receives a selected photo.
  function closeEditor(){photoJob++;clearTimeout(photoTimeout);if($('apply-photo').disabled){worker?.terminate();worker=null;}$('editor').hidden=true;pendingHead?.close?.();pendingHead=null;if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}focusBeforeEditor?.focus();}
  $('photo-button').addEventListener('click',()=>{if(!hostActive)return;playIntro();$('photo-input').click();});
  $('editor-close').addEventListener('click',closeEditor);
  $('editor').addEventListener('click',e=>{if(e.target===$('editor'))closeEditor();});
  document.addEventListener('keydown',event=>{
    if($('editor').hidden)return;
    if(event.key==='Escape')closeEditor();
    if(event.key==='Tab'){
      const controls=[...$('editor').querySelectorAll('button:not(:disabled),input')].filter(e=>!e.closest('[hidden]'));
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){last.focus();event.preventDefault();}
      else if(!event.shiftKey&&document.activeElement===last){first.focus();event.preventDefault();}
    }
  });
  $('photo-input').addEventListener('change',async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(file.size>20*1024*1024){announce('Choose a photo smaller than 20 MB.');return;}
    focusBeforeEditor=document.activeElement;$('editor').hidden=false;$('editor-close').focus();
    $('apply-photo').disabled=true;$('photo-options').hidden=true;$('photo-status').textContent='Opening your photo…';$('cutout-preview').removeAttribute('src');$('cutout-preview').style.transform='';
    const id=++photoJob;
    try{
      const original=await createImageBitmap(file,{imageOrientation:'from-image'});
      if(id!==photoJob){original.close();return;}
      const f=Math.min(1,768/Math.max(original.width,original.height));
      const c=document.createElement('canvas');c.width=Math.round(original.width*f);c.height=Math.round(original.height*f);c.getContext('2d').drawImage(original,0,0,c.width,c.height);original.close();
      const bitmap=await createImageBitmap(c);
      if(!worker){worker=new Worker('photo-worker.js');worker.onmessage=onPhotoResult;worker.onerror=()=>{worker?.terminate();worker=null;$('photo-status').textContent='Head cutout could not load. Please try again.';};}
      clearTimeout(photoTimeout);photoTimeout=setTimeout(()=>{if(id===photoJob){worker?.terminate();worker=null;photoJob++;$('photo-status').textContent='Cutout took too long. Try a smaller portrait.';}},30000);
      worker.postMessage({id,bitmap},[bitmap]);
    }catch{$('photo-status').textContent='This photo could not open. Try a JPEG, PNG or WebP.';}
  });
  async function onPhotoResult({data}){
    if(data.id!==photoJob){data.bitmap?.close();return;}
    if(data.error){clearTimeout(photoTimeout);$('photo-status').textContent=data.error;return;}
    if(data.status){$('photo-status').textContent=data.status;return;}
    if(!data.done)return;clearTimeout(photoTimeout);
    pendingHead?.close?.();pendingHead=data.bitmap;pendingAnchor=data.anchor;
    const c=document.createElement('canvas');c.width=data.bitmap.width;c.height=data.bitmap.height;c.getContext('2d').drawImage(data.bitmap,0,0);
    const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
    if(data.id!==photoJob)return;
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);$('cutout-preview').src=previewUrl;
    $('photo-status').textContent='Ready to dance.';$('photo-options').hidden=false;$('photo-size').value='1';$('apply-photo').disabled=false;
  }
  $('photo-size').addEventListener('input',()=>{$('cutout-preview').style.transform=`scale(${$('photo-size').value})`;});
  $('apply-photo').addEventListener('click',()=>{
    if(!pendingHead)return;localHead?.close?.();localHead=pendingHead;pendingHead=null;headAnchor=pendingAnchor;headScale=Number($('photo-size').value);
    $('default-button').hidden=false;$('photo-button').querySelector('span').textContent='Change photo';closeEditor();
  });
  $('default-button').addEventListener('click',()=>{localHead?.close?.();localHead=null;$('default-button').hidden=true;$('photo-button').querySelector('span').textContent='Use your photo';});
})();
