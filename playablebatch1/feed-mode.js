(() => {
  const api = window.PlayableReviewLibrary, trigger = document.getElementById('tiktok-view');
  if (!api || !trigger) return;
  const origin = location.origin, target = origin === 'null' ? '*' : origin;
  const dialog = document.createElement('dialog');
  dialog.className = 'batch-view-dialog'; dialog.setAttribute('aria-labelledby','batch-view-heading');
  dialog.innerHTML = `<header class="batch-view-toolbar"><div class="batch-view-summary"><h2 id="batch-view-heading">TikTok view</h2><p class="batch-view-status" role="status"></p></div><label class="batch-view-picker">Choose game<select aria-label="Choose game"></select></label><nav class="batch-view-controls" aria-label="Feed review controls"><button type="button" data-step="previous">Previous</button><button type="button" data-step="next">Next</button><button type="button" class="batch-view-close">Back to review</button></nav></header><p class="batch-view-error" hidden>Couldn’t load the feed. <button type="button" class="batch-view-retry">Retry</button></p><iframe class="batch-view-frame" title="TikTok batch review" allow="camera; microphone; autoplay; fullscreen"></iframe>`;
  document.body.append(dialog);
  const frame=dialog.querySelector('iframe'), status=dialog.querySelector('[role="status"]'), error=dialog.querySelector('.batch-view-error'), picker=dialog.querySelector('select');
  for (const game of api.games) { const option=document.createElement('option'); option.value=game.taskId; option.textContent=`${game.number}. ${game.name}`; picker.append(option); }
  let selected=null,timer=null;
  const send=data=>frame.contentWindow?.postMessage(data,target);
  const enable=value=>{picker.disabled=!value;dialog.querySelectorAll('[data-step]').forEach(button=>{button.disabled=!value;});};
  function load(){enable(false);error.hidden=true;status.textContent=`Loading ${api.games.length} games…`;frame.src=new URL('./feed-view.html?v=20261013-3',location.href).href;clearTimeout(timer);timer=setTimeout(()=>{error.hidden=false;status.textContent='Feed unavailable';},12000);}
  trigger.addEventListener('click',()=>{if(dialog.open)return;selected=api.getCurrent();if(!selected)return;picker.value=selected.taskId;api.suspend();dialog.showModal();document.body.classList.add('batch-view-open');load();dialog.querySelector('.batch-view-close').focus();});
  frame.addEventListener('load',()=>{if(dialog.open&&frame.getAttribute('src')!=='about:blank')send({type:'playable-feed-init',selected:selected.taskId,games:api.games.map(game=>({taskId:game.taskId,number:game.number,name:game.name,src:new URL(api.previewSource(game),location.href).href}))});});
  dialog.querySelector('.batch-view-retry').addEventListener('click',load);
  dialog.querySelector('.batch-view-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{clearTimeout(timer);frame.src='about:blank';document.body.classList.remove('batch-view-open');if(selected)api.select(selected);trigger.focus();});
  picker.addEventListener('change',()=>{if(!picker.disabled)send({type:'playable-batch-select',taskId:picker.value});});
  dialog.querySelectorAll('[data-step]').forEach(button=>button.addEventListener('click',()=>send({type:'playable-batch-step',direction:button.dataset.step})));
  window.addEventListener('message',event=>{
    if(!dialog.open||event.source!==frame.contentWindow||event.origin!==origin)return;
    const game=api.games.find(item=>item.taskId===event.data?.taskId);
    if(!game||!['playable-batch-selection','playable-feed-comments'].includes(event.data.type))return;
    selected=game;picker.value=game.taskId;enable(true);clearTimeout(timer);error.hidden=true;status.textContent=`${game.number}. ${game.name} · Swipe down for next, up for previous`;
    if(event.data.type==='playable-feed-comments'){dialog.close();document.getElementById('feedback-heading')?.scrollIntoView({behavior:'auto',block:'start'});}
  });
})();
