/* Native TUX runtime. Only one iframe owns audio, camera and feed navigation. */
(() => {
  const api=window.PlayableReviewLibrary, trigger=document.getElementById('tiktok-view');
  const toggle=document.getElementById('fyp-mode'), script=document.currentScript;
  if(!api||!trigger||!toggle||!script?.src)return;
  const runtime=new URL(trigger.dataset.feedRuntime||'/app/home',script.src), origin=runtime.origin;
  const viewport=document.createElement('div');viewport.className='fyp-viewport';viewport.hidden=true;
  viewport.innerHTML='<iframe class="fyp-frame" title="FYP game review" allow="camera; microphone; autoplay; fullscreen"></iframe><div class="fyp-error" hidden><p>Couldn’t load FYP Mode.</p><button type="button">Try again</button></div>';
  document.getElementById('stage').append(viewport);
  const help=document.createElement('div');help.className='fyp-help';help.hidden=true;
  help.innerHTML='<span role="status">Swipe down for the next game, up for the previous.</span><nav aria-label="FYP navigation"><button type="button" data-step="previous">Previous</button> <button type="button" data-step="next">Next</button></nav>';
  document.querySelector('.actions').after(help);
  const dialog=document.createElement('dialog');dialog.className='batch-view-dialog';dialog.setAttribute('aria-labelledby','batch-view-heading');
  dialog.innerHTML='<header class="batch-view-toolbar"><div class="batch-view-summary"><h2 id="batch-view-heading">FYP review</h2><p class="batch-view-status" role="status"></p></div><label class="batch-view-picker">Choose game<select aria-label="Choose game"></select></label><nav class="batch-view-controls" aria-label="Feed review controls"><button type="button" data-step="previous">Previous</button><button type="button" data-step="next">Next</button><button type="button" class="batch-view-close">Back to review</button></nav></header><p class="batch-view-error" hidden>Couldn’t load the feed. <button type="button" class="batch-view-retry">Try again</button></p><iframe class="batch-view-frame" title="TikTok batch review" allow="camera; microphone; autoplay; fullscreen"></iframe>';
  document.body.append(dialog);
  const inline=viewport.querySelector('iframe'), full=dialog.querySelector('iframe'), picker=dialog.querySelector('select');
  const status=dialog.querySelector('[role="status"]'), error=dialog.querySelector('.batch-view-error'), inlineError=viewport.querySelector('.fyp-error');
  for(const game of api.games){const option=document.createElement('option');option.value=game.taskId;option.textContent=game.number+'. '+game.name;picker.append(option);}
  let mode='game', previousMode='game', selected=api.getCurrent(), timer=null, ready=false, pending=null;
  const activeFrame=()=>mode==='inline'?inline:mode==='modal'?full:null;
  const send=data=>activeFrame()?.contentWindow?.postMessage(data,origin);
  function controls(){
    picker.disabled=!ready;
    for(const button of [...dialog.querySelectorAll('[data-step]'),...help.querySelectorAll('[data-step]')]){
      const index=api.games.findIndex(game=>game.taskId===selected?.taskId);
      button.disabled=!ready||(button.dataset.step==='previous'?index===0:index===api.games.length-1);
    }
  }
  function stop(){clearTimeout(timer);inline.src='about:blank';full.src='about:blank';ready=false;pending=null;}
  function load(){
    ready=false;controls();error.hidden=true;inlineError.hidden=true;
    status.textContent='Loading FYP review…';help.querySelector('[role="status"]').textContent='Loading FYP Mode…';
    const url=new URL(runtime);url.searchParams.set('review','batch');url.searchParams.set('feed','playable-batch-'+selected.taskId);url.searchParams.set('reviewHost',location.origin);url.searchParams.set('v','native-fyp-20261013-5');
    activeFrame().src=url.href;clearTimeout(timer);
    timer=setTimeout(()=>{error.hidden=false;inlineError.hidden=false;status.textContent='Feed unavailable';},15000);
  }
  function show(next){
    stop();mode=next;selected=api.getCurrent();api.suspend();
    viewport.hidden=next!=='inline';help.hidden=next!=='inline';
    document.getElementById('preview-fit').hidden=true;
    document.getElementById('stage').classList.toggle('is-fyp',next==='inline');
    toggle.setAttribute('aria-pressed',String(next==='inline'));
    toggle.textContent=next==='inline'?'Game view':'FYP Mode';
    if(next==='modal'){dialog.showModal();document.body.classList.add('batch-view-open');dialog.querySelector('.batch-view-close').focus();}
    load();
  }
  function gameView(){stop();mode='game';viewport.hidden=true;help.hidden=true;document.getElementById('preview-fit').hidden=false;document.getElementById('stage').classList.remove('is-fyp');toggle.setAttribute('aria-pressed','false');toggle.textContent='FYP Mode';api.select(selected,{preview:false});api.resume();}
  toggle.addEventListener('click',()=>mode==='inline'?gameView():show('inline'));
  trigger.addEventListener('click',()=>{if(mode==='modal')return;previousMode=mode;show('modal');});
  dialog.querySelector('.batch-view-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{document.body.classList.remove('batch-view-open');previousMode==='inline'?show('inline'):gameView();trigger.focus();});
  for(const frame of [inline,full])frame.addEventListener('load',()=>{
    if(frame===activeFrame()&&frame.getAttribute('src')!=='about:blank')frame.contentWindow?.postMessage({type:'safe-area:set',safeArea:{top:'0px',bottom:'0px',left:'0px',right:'0px'},fullScreen:true,hostProvidesPhoneChrome:false},origin);
  });
  inlineError.querySelector('button').addEventListener('click',load);dialog.querySelector('.batch-view-retry').addEventListener('click',load);
  picker.addEventListener('change',()=>window.PlayableFypMode.select(api.games.find(game=>game.taskId===picker.value)));
  for(const button of [...dialog.querySelectorAll('[data-step]'),...help.querySelectorAll('[data-step]')])button.addEventListener('click',()=>send({type:'playable-batch-step',direction:button.dataset.step}));
  window.addEventListener('message',event=>{
    if(!activeFrame()||event.source!==activeFrame().contentWindow||event.origin!==origin||event.data?.type!=='playable-batch-selection')return;
    const game=api.games.find(game=>game.taskId===event.data.taskId);if(!game)return;
    ready=true;clearTimeout(timer);error.hidden=true;inlineError.hidden=true;
    if(pending&&pending.taskId!==game.taskId){send({type:'playable-batch-select',taskId:pending.taskId});return;}pending=null;
    selected=game;picker.value=game.taskId;controls();api.select(game,{preview:false,reveal:true});
    status.textContent=game.number+'. '+game.name+' · Swipe down for next';
    help.querySelector('[role="status"]').textContent='Swipe down for the next game, up for the previous.';
  });
  window.PlayableFypMode={get active(){return mode!=='game';},select(game){if(!game)return;selected=game;picker.value=game.taskId;controls();if(ready)send({type:'playable-batch-select',taskId:game.taskId});else pending=game;},restart(){selected=api.getCurrent();load();}};
})();
