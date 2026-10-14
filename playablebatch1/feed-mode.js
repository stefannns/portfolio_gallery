/* One player toolbar, two presentation modes, and only one live game host. */
(() => {
  const api=window.PlayableReviewLibrary, trigger=document.getElementById('tiktok-view'), script=document.currentScript;
  if(!api||!trigger||!script?.src)return;
  const runtime=new URL(trigger.dataset.feedRuntime||'/app/home',script.src), origin=runtime.origin;
  const inlineControls=document.querySelector('[data-inline-controls]'), announcement=document.getElementById('player-status');
  const viewport=document.createElement('div');viewport.className='fyp-viewport';viewport.hidden=true;
  viewport.innerHTML='<iframe class="fyp-frame" title="FYP game review" allow="camera; microphone; autoplay; fullscreen"></iframe><div class="fyp-error" hidden><p>Couldn’t load FYP Mode.</p><button type="button">Try again</button></div>';
  document.getElementById('stage').append(viewport);
  const withoutIds=html=>html.replace(/\s+id="[^"]*"/g,'');
  const navigation=withoutIds(inlineControls.querySelector('.player-navigation').innerHTML);
  const modes=withoutIds(inlineControls.querySelector('.player-mode-switch').innerHTML);
  const dialog=document.createElement('dialog');dialog.className='batch-view-dialog';dialog.setAttribute('aria-labelledby','batch-view-heading');
  dialog.innerHTML='<header class="batch-view-toolbar"><div class="batch-view-summary"><h2 id="batch-view-heading">Game review</h2><p class="batch-view-status" role="status"></p></div><label class="batch-view-picker">Choose game<select aria-label="Choose game"></select></label><nav class="batch-view-controls"><button type="button" class="batch-view-close">Back to review</button></nav></header><p class="batch-view-error" hidden>Couldn’t load the feed. <button type="button" class="batch-view-retry">Try again</button></p><div class="batch-player-body"><div class="player-controls batch-player-controls" role="group" aria-label="Full-screen player controls"><nav class="player-navigation" aria-label="Game navigation">'+navigation+'</nav><div class="player-mode-switch" role="group" aria-label="Preview mode">'+modes+'</div></div><div class="batch-player-content"><iframe class="batch-view-frame" title="Full-screen FYP review" allow="camera; microphone; autoplay; fullscreen"></iframe><div class="batch-direct-fit" hidden><div class="batch-direct-phone"><iframe class="batch-direct-frame" title="Full-screen direct game" sandbox="allow-scripts allow-same-origin allow-pointer-lock" allow="camera; microphone; autoplay; fullscreen"></iframe></div></div></div></div>';
  document.body.append(dialog);
  const inline=viewport.querySelector('iframe'), full=dialog.querySelector('.batch-view-frame'), direct=dialog.querySelector('.batch-direct-frame');
  const directFit=dialog.querySelector('.batch-direct-fit'), directPhone=dialog.querySelector('.batch-direct-phone'), content=dialog.querySelector('.batch-player-content');
  const picker=dialog.querySelector('select'), status=dialog.querySelector('[role="status"]'), heading=dialog.querySelector('h2');
  const error=dialog.querySelector('.batch-view-error'), inlineError=viewport.querySelector('.fyp-error');
  const controlSets=[inlineControls,dialog.querySelector('.batch-player-controls')];
  const buttons=selector=>controlSets.flatMap(controls=>[...controls.querySelectorAll(selector)]);
  for(const game of api.games){const option=document.createElement('option');option.value=game.taskId;option.textContent=game.number+'. '+game.name;picker.append(option);}
  let view='direct',expanded=false,selected=api.getCurrent(),ready=false,timer=null,pending=null;
  const nativeFrame=()=>view==='fyp'?(expanded?full:inline):null;
  const managed=()=>expanded||view==='fyp';
  const send=data=>nativeFrame()?.contentWindow?.postMessage(data,origin);
  function controls(){
    const index=api.games.findIndex(game=>game.taskId===selected?.taskId);
    for(const button of buttons('[data-step]'))button.disabled=(view==='fyp'&&!ready)||(button.dataset.step==='previous'?index<=0:index>=api.games.length-1);
    for(const button of buttons('[data-mode]'))button.setAttribute('aria-pressed',String(button.dataset.mode===view));
    picker.disabled=false;
    if(selected){picker.value=selected.taskId;status.textContent=selected.number+'. '+selected.name;}
    heading.textContent=view==='fyp'?'FYP review':'Game review';
  }
  function fitDirect(){
    if(!expanded||view!=='direct')return;
    const scale=Math.max(.1,Math.min(1,(content.clientWidth-24)/400,(content.clientHeight-24)/703));
    directFit.style.width=400*scale+'px';directFit.style.height=703*scale+'px';directPhone.style.transform='scale('+scale+')';
  }
  new ResizeObserver(fitDirect).observe(content);
  function paint(){
    viewport.hidden=expanded||view!=='fyp';
    document.getElementById('preview-fit').hidden=managed();
    document.getElementById('stage').classList.toggle('is-fyp',!expanded&&view==='fyp');
    full.hidden=view!=='fyp';directFit.hidden=view!=='direct';
    controls();fitDirect();
  }
  function stop(){
    clearTimeout(timer);pending=null;ready=false;
    inline.src='about:blank';full.src='about:blank';direct.src='about:blank';
    api.suspend();
  }
  function load(){
    error.hidden=true;inlineError.hidden=true;
    if(view==='direct'){
      ready=true;announcement.textContent='';
      if(expanded){direct.src=new URL(api.previewSource(selected),location.href).href;fitDirect();}
      else api.resume();
      controls();return;
    }
    ready=false;controls();announcement.textContent='Loading FYP view';
    const url=new URL(runtime);url.searchParams.set('review','batch');url.searchParams.set('feed','playable-batch-'+selected.taskId);url.searchParams.set('reviewHost',location.origin);url.searchParams.set('v','player-toolbar-20261013-7');
    nativeFrame().src=url.href;clearTimeout(timer);
    timer=setTimeout(()=>{error.hidden=false;inlineError.hidden=false;announcement.textContent='FYP view unavailable. Use Try again to reload.';},15000);
  }
  function setView(next){
    if(!['direct','fyp'].includes(next)||next===view)return;
    selected=api.getCurrent();stop();view=next;paint();load();
  }
  function reflect(game){selected=game;controls();}
  function select(game){
    if(!game)return;selected=game;controls();
    if(view==='direct'){if(expanded)direct.src=new URL(api.previewSource(game),location.href).href;return;}
    pending=game;
    if(ready)send({type:'playable-batch-select',taskId:game.taskId});
  }
  function step(direction){
    const index=api.games.findIndex(game=>game.taskId===api.getCurrent()?.taskId);
    const game=api.games[index+(direction==='next'?1:-1)];
    if(!game||(view==='fyp'&&!ready))return;
    if(view==='fyp')send({type:'playable-batch-step',direction});
    else api.select(game,{reveal:true});
  }
  function restart(){selected=api.getCurrent();stop();paint();load();}
  for(const button of buttons('[data-mode]'))button.addEventListener('click',()=>setView(button.dataset.mode));
  for(const button of buttons('[data-step]'))button.addEventListener('click',()=>step(button.dataset.step));
  for(const button of buttons('[data-action="restart"]'))button.addEventListener('click',restart);
  trigger.addEventListener('click',()=>{
    if(expanded)return;selected=api.getCurrent();stop();expanded=true;paint();
    dialog.showModal();document.body.classList.add('batch-view-open');fitDirect();load();dialog.querySelector('.batch-view-close').focus();
  });
  dialog.querySelector('.batch-view-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{stop();expanded=false;document.body.classList.remove('batch-view-open');paint();load();trigger.focus();});
  for(const frame of [inline,full])frame.addEventListener('load',()=>{
    if(frame===nativeFrame()&&frame.getAttribute('src')!=='about:blank')frame.contentWindow?.postMessage({type:'safe-area:set',safeArea:{top:'0px',bottom:'0px',left:'0px',right:'0px'},fullScreen:true,hostProvidesPhoneChrome:false},origin);
  });
  inlineError.querySelector('button').addEventListener('click',restart);dialog.querySelector('.batch-view-retry').addEventListener('click',restart);
  picker.addEventListener('change',()=>{const game=api.games.find(game=>game.taskId===picker.value);if(game)api.select(game,{reveal:true});});
  window.addEventListener('message',event=>{
    const frame=nativeFrame();
    if(!frame||event.source!==frame.contentWindow||event.origin!==origin||event.data?.type!=='playable-batch-selection')return;
    const game=api.games.find(game=>game.taskId===event.data.taskId);if(!game)return;
    clearTimeout(timer);error.hidden=true;inlineError.hidden=true;ready=true;announcement.textContent='';
    if(pending&&pending.taskId!==game.taskId){send({type:'playable-batch-select',taskId:pending.taskId});return;}pending=null;
    selected=game;controls();
    // Changing views/restarting the same game must not clear an unfinished review comment.
    if(api.getCurrent()?.taskId!==game.taskId)api.select(game,{preview:false,reveal:true});
  });
  window.PlayableFypMode={get active(){return managed();},get view(){return view;},select,reflect,restart,step};
  paint();
})();
