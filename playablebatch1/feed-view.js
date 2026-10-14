(() => {
  const origin=location.origin,target=origin==='null'?'*':origin,$=id=>document.getElementById(id),frame=$('game'),play=$('play');
  let games=[],index=0,active=false,gesture=null,suppressClick=false;
  const liked=new Set(),saved=new Set(); // Session-only mock controls; no external writes.
  const send=type=>parent.postMessage({type,taskId:games[index]?.taskId},target);
  function fit(){const scale=Math.min(1,innerWidth/390,innerHeight/798);$('fit').style.width=`${390*scale}px`;$('fit').style.height=`${798*scale}px`;$('phone').style.transform=`scale(${scale})`;}
  addEventListener('resize',fit);fit();
  function show(taskId){
    const next=games.findIndex(game=>game.taskId===taskId);if(next<0)return;
    frame.contentWindow?.postMessage({type:'playable-active',active:false},target);frame.src='about:blank';index=next;active=false;play.hidden=false;
    const game=games[index],url=new URL(game.src);url.searchParams.set('feedReview','1');frame.src=url.href;
    $('game-title').textContent=`${game.number}. ${game.name}`;frame.title=game.name;$('position').textContent=`${index+1} / ${games.length}`;
    $('like').setAttribute('aria-pressed',String(liked.has(game.taskId)));$('save').setAttribute('aria-pressed',String(saved.has(game.taskId)));send('playable-batch-selection');
  }
  const step=delta=>{if(games.length)show(games[(index+delta+games.length)%games.length].taskId);};
  addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==origin)return;
    const data=event.data;
    if(data?.type==='playable-feed-init'&&Array.isArray(data.games)&&data.games.length<=200){
      const seen=new Set(),valid=data.games.filter(game=>{
        if(!game||typeof game.taskId!=='string'||seen.has(game.taskId)||typeof game.name!=='string')return false;
        try{const url=new URL(game.src);if(url.origin!==origin||!['http:','https:','file:'].includes(url.protocol)||!/\/game\.html$/.test(url.pathname))return false;}catch{return false;}
        seen.add(game.taskId);return true;
      });
      if(valid.length!==data.games.length||!valid.some(game=>game.taskId===data.selected))return;
      games=valid;show(data.selected);
    }else if(data?.type==='playable-batch-select')show(data.taskId);
    else if(data?.type==='playable-batch-step'&&['next','previous'].includes(data.direction))step(data.direction==='next'?1:-1);
  });
  play.addEventListener('click',()=>{if(suppressClick){suppressClick=false;return;}if(!games.length)return;active=true;play.hidden=true;frame.contentWindow?.postMessage({type:'playable-active',active:true},target);});
  frame.addEventListener('load',()=>{if(active)frame.contentWindow?.postMessage({type:'playable-active',active:true},target);});
  $('next').addEventListener('click',()=>step(1));$('previous').addEventListener('click',()=>step(-1));$('comments').addEventListener('click',()=>send('playable-feed-comments'));
  for(const[id,set]of[['like',liked],['save',saved]])$(id).addEventListener('click',()=>{const key=games[index]?.taskId;if(!key)return;set.has(key)?set.delete(key):set.add(key);$(id).setAttribute('aria-pressed',String(set.has(key)));});
  // Keep game gestures intact: host navigation uses the footer or idle preview.
  for(const surface of[$('swipe-zone'),play]){
    surface.addEventListener('pointerdown',event=>{if(!event.isPrimary||event.button!==0||(surface!==play&&event.target.closest('button')))return;gesture={id:event.pointerId,x:event.clientX,y:event.clientY};suppressClick=false;surface.setPointerCapture(event.pointerId);});
    surface.addEventListener('pointerup',event=>{if(!gesture||gesture.id!==event.pointerId)return;const dy=event.clientY-gesture.y,dx=event.clientX-gesture.x;gesture=null;if(Math.abs(dy)>45&&Math.abs(dy)>Math.abs(dx)*1.2){suppressClick=surface===play;event.preventDefault();step(dy>0?1:-1);}});
    surface.addEventListener('pointercancel',()=>{gesture=null;});surface.addEventListener('lostpointercapture',()=>{gesture=null;});
  }
  addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();step(event.key==='ArrowDown'?1:-1);}});
  addEventListener('pagehide',()=>{frame.src='about:blank';},{once:true});
})();
