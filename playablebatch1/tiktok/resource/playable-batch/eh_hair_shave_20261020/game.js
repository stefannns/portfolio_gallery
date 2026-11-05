
/* BATCH2_IDLE_20261102 */
/* Game-owned, silent demonstration clock. Never dispatches gameplay input. */
(() => {
  'use strict';
  if (window.PlayableIdlePreview) return;
  const query = new URLSearchParams(location.search);
  const hosted = query.get('feedReview') === '1' || query.get('host') === 'fyp';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let preview = hosted, elapsed = 0, last = performance.now();
  const listeners = new Set();
  const sync = () => {
    const html = document.documentElement;
    html.dataset.batch2Idle = String(preview);
    html.dataset.batch2IdlePaused = String(document.hidden);
    html.dataset.batch2IdleReduced = String(reduced.matches);
    if (!preview) for (const node of document.querySelectorAll('[data-idle-preview]')) node.dataset.idlePreview='off';
    last = performance.now();
    for (const fn of listeners) fn(preview && !document.hidden);
  };
  const clock = () => {
    const now = performance.now();
    if (preview && !document.hidden && !reduced.matches) elapsed += Math.min(64, Math.max(0, now - last));
    last = now;
    return reduced.matches ? 1600 : elapsed;
  };
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const ease = t => (t = clamp(t), t * t * (3 - 2 * t));
  const trace = (ctx, points, progress = 1) => {
    if (!points.length) return;
    const distances = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    let left = distances.reduce((a, b) => a + b, 0) * clamp(progress);
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1], q = points[i], d = distances[i - 1];
      const t = Math.min(1, left / Math.max(.01, d));
      ctx.lineTo(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
      left -= d; if (left <= 0) break;
    }
    ctx.stroke();
  };
  const onPath = (points, progress) => {
    const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    let distance = lengths.reduce((a, b) => a + b, 0) * clamp(progress);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = lengths[i - 1];
      if (distance <= length || i === points.length - 1) {
        const t = clamp(distance / Math.max(.01, length));
        return {x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t};
      }
      distance -= length;
    }
    return points[0];
  };
  const stamp = (canvas, kind, phase = clock()) => {
    if (!canvas) return;
    canvas.dataset.idlePreview = preview ? kind : 'off';
    canvas.dataset.idlePhase = String(Math.round(phase));
  };
  function ant(ctx, w, h, image) {
    const t = clock() / 1000, p = (t % 5.4) / 5.4;
    const cx = w*.5, cy = h*.51, rx = Math.min(w*.29, 105), ry = Math.min(h*.16, 78);
    const path = Array.from({length:81}, (_, i) => ({x:cx+Math.cos(i/80*Math.PI*2)*rx,y:cy+Math.sin(i/80*Math.PI*2)*ry}));
    ctx.save(); ctx.lineWidth = 5; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#242322';
    ctx.globalAlpha = p>.88 ? (1-p)/.12 : 1;
    trace(ctx, path, ease(p/.48));
    const x=cx+Math.sin(t*2.1)*rx*.63, y=cy+Math.sin(t*2.8)*ry*.59;
    ctx.translate(x,y);ctx.rotate(Math.atan2(Math.cos(t*2.8)*ry,Math.cos(t*2.1)*rx)+Math.PI/2);
    if(image?.complete&&image.naturalWidth)ctx.drawImage(image,-17,-17,34,34);
    else {ctx.fillStyle='#242322';for(const [y,r]of [[-7,5],[0,4],[7,6]]){ctx.beginPath();ctx.ellipse(0,y,r,r*1.2,0,0,Math.PI*2);ctx.fill();}}
    ctx.restore();stamp(ctx.canvas,'ant-loop');
  }
  function army(state,w,h){
    const t=clock()/1000;
    const players=state.entities.filter(e=>e.team==='player'),cx=players.reduce((n,e)=>n+e.x,0)/Math.max(1,players.length),cy=players.reduce((n,e)=>n+e.y,0)/Math.max(1,players.length);
    return {...state,particles:[],playerTarget:{x:w*(.5+Math.sin(t*.8)*.18),y:h*(.43+Math.cos(t*.8)*.04)},entities:state.entities.map((entity,i)=>({...entity,x:entity.team==='player'?w*(.5+Math.sin(t*.8)*.14)+(entity.x-cx)*.7:entity.x+Math.sin(t*1.5+i*.7)*8,y:entity.team==='player'?h*(.57+Math.cos(t*.8)*.04)+(entity.y-cy)*.7:entity.y+Math.cos(t*1.5+i*.7)*8}))};
  }
  function blade(ctx,w,h,top,bottom){
    const t=clock()/1000,p=(t%5.8)/5.8,cx=w/2,cy=(top+bottom)/2;
    const points=[[-.22,.16],[-.11,.02],[.04,.04],[.17,-.17],[.24,-.11]].map(([x,y])=>({x:cx+x*w,y:cy+y*(bottom-top)}));
    ctx.save();ctx.strokeStyle='#303936';ctx.lineWidth=6;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.globalAlpha=p>.9?(1-p)/.1:1;
    if(p<.5)trace(ctx,points,ease(p/.45));
    else {ctx.translate(cx,cy);ctx.rotate((p-.5)*Math.PI*3.4);trace(ctx,points.map(v=>({x:v.x-cx,y:v.y-cy})));ctx.fillStyle='#303936';ctx.beginPath();ctx.arc(0,0,11,0,Math.PI*2);ctx.fill();}
    ctx.restore();stamp(ctx.canvas,'draw-and-spin-blade');
  }
  function roadPose(key){
    const t=clock()/1000,offset=key==='player'?0:key==='copL'?1.3:2.2;
    const q=t*.75-offset,x=375+Math.sin(q)*130,y=key==='player'?800:1040+(key==='copR'?60:0);
    return{x:x+(key==='copL'?-85:key==='copR'?85:0),y:y+Math.cos(q)*28,angle:-Math.PI/2+Math.cos(q)*.18};
  }
  function road(ctx){
    const p=roadPose('player');ctx.save();ctx.strokeStyle='#ffffff88';ctx.setLineDash([11,12]);ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.bezierCurveTo(p.x+100,p.y-100,340,p.y-220,420,p.y-340);ctx.stroke();ctx.restore();stamp(ctx.canvas,'escape-route');
  }
  function route(start,end,circles,w){
    const nodes=[start,end];
    for(const circle of circles)for(let i=0;i<12;i++){const a=i*Math.PI/6,r=circle.circleRadius+16;const p={x:circle.position.x+Math.cos(a)*r,y:circle.position.y+Math.sin(a)*r};if(p.x>15&&p.x<w-15)nodes.push(p);}
    const distance=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),visited=new Set();distance[0]=0;
    const clear=(a,b)=>circles.every(c=>{const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((c.position.x-a.x)*dx+(c.position.y-a.y)*dy)/Math.max(.01,dx*dx+dy*dy));return Math.hypot(a.x+dx*t-c.position.x,a.y+dy*t-c.position.y)>c.circleRadius+7;});
    for(let pass=0;pass<nodes.length;pass++){let k=-1;for(let j=0;j<nodes.length;j++)if(!visited.has(j)&&(k<0||distance[j]<distance[k]))k=j;if(k<0||!Number.isFinite(distance[k]))break;if(k===1)break;visited.add(k);for(let j=0;j<nodes.length;j++){if(visited.has(j)||!clear(nodes[k],nodes[j]))continue;const d=distance[k]+Math.hypot(nodes[k].x-nodes[j].x,nodes[k].y-nodes[j].y);if(d<distance[j]){distance[j]=d;previous[j]=k;}}}
    if(previous[1]<0)return[start,{x:20,y:start.y+24},{x:20,y:end.y-28},end];
    const path=[];for(let k=1;k>=0;k=previous[k]){path.unshift(nodes[k]);if(k===0)break;}return path;
  }
  let sodaCache=null;
  function soda(ctx,source,cup,cupW,cupH,bodies,w){
    if(!source||!cup)return;const t=clock()/1000,p=t%5.6;
    const circles=bodies.filter(b=>b.label==='obstacle'),key=JSON.stringify([source,cup,w,circles.map(c=>[c.position.x,c.position.y,c.circleRadius])]);
    if(sodaCache?.key!==key)sodaCache={key,points:route({x:source.x,y:source.y+21},{x:cup.x,y:cup.y-cupH*.42},circles,w)};
    const points=sodaCache.points;ctx.save();ctx.strokeStyle='#242322';ctx.lineWidth=5;ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=p>5?(5.6-p)/.6:1;trace(ctx,points,ease(p/1.7));
    if(p>1.4&&p<5){for(let i=0;i<15;i++){const q=((p-1.4)*.65-i*.067);if(q<0||q>1)continue;const at=onPath(points,q);ctx.fillStyle='#59c6b1';ctx.strokeStyle='#242322';ctx.lineWidth=1;ctx.beginPath();ctx.arc(at.x,at.y,4,0,Math.PI*2);ctx.fill();ctx.stroke();}}
    ctx.restore();stamp(ctx.canvas,'guided-soda-route');
  }
  const style=document.createElement('style');style.dataset.batch2IdleStyle='';style.textContent=`
    html[data-batch2-idle=true] .idle-memory-deck{display:block}
    .idle-memory-deck{position:absolute;inset:0;display:none;overflow:hidden;pointer-events:none}
    .idle-memory-deck img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;animation:idle-memory-photo 7.2s linear infinite}
    .idle-memory-deck img:nth-child(2){animation-delay:-4.8s}.idle-memory-deck img:nth-child(3){animation-delay:-2.4s}
    .idle-clean-tool{display:none;position:absolute;z-index:5;left:var(--idle-clean-x,25%);top:var(--idle-clean-y,54%);width:76px;height:95px;pointer-events:none;transform:translate(-50%,-35%)}
    .idle-clean-tool>span{display:none;width:100%;height:100%}.idle-clean-tool img{width:100%;height:100%;object-fit:contain}
    html[data-batch2-idle=true] .idle-clean-tool{display:block}
    [data-idle-clean-tool=spray] .idle-clean-spray,[data-idle-clean-tool=brush] .idle-clean-brush,[data-idle-clean-tool=rinse] .idle-clean-rinse{display:block}
    html[data-batch2-idle=true] .video-window>img{visibility:hidden}
    @keyframes idle-memory-photo{0%,29%{opacity:1;transform:scale(1)}33%,96%{opacity:0;transform:scale(1.035)}100%{opacity:1;transform:scale(1)}}
    html[data-batch2-idle=true] .tool-swing{animation:idle-tool-hit 2.6s ease-in-out infinite!important;transform-origin:70% 75%}
    html[data-batch2-idle=true] .target-art{animation:idle-stick-react 2.6s ease-in-out infinite!important;transform-origin:50% 75%}
    @keyframes idle-tool-hit{0%,32%,100%{transform:translate(10px,5px) rotate(-25deg)}46%{transform:translate(-30px,-8px) rotate(-64deg)}55%,70%{transform:translate(6px,7px) rotate(-20deg)}}
    @keyframes idle-stick-react{0%,45%,72%,100%{transform:rotate(0) scale(1)}50%{transform:translate(-4px,2px) rotate(-3deg) scale(1.025,.97)}60%{transform:rotate(1.5deg) scale(.99,1.01)}}
    html[data-batch2-idle-paused=true] :is(.idle-memory-deck img,.tool-swing,.target-art){animation-play-state:paused!important}
    html[data-batch2-idle-reduced=true] :is(.idle-memory-deck img,.tool-swing,.target-art){animation:none!important}
    html[data-batch2-idle-reduced=true] .idle-memory-deck img:first-child{opacity:1}
  `;document.head.append(style);
  window.PlayableIdlePreview=Object.freeze({get active(){return preview&&!document.hidden;},get preview(){return preview;},get reduced(){return reduced.matches;},get seconds(){return clock()/1000;},clock,ease,clamp,stamp,trace,onPath,ant,army,blade,road,roadPose,soda,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}});
  addEventListener('message',event=>{if(parent===window||event.source!==parent||event.origin!==location.origin||event.data?.type!=='playable-active')return;const next=event.data.active!==true;if(next!==preview){preview=next;elapsed=0;}sync();});
  document.addEventListener('visibilitychange',sync);reduced.addEventListener?.('change',sync);addEventListener('pagehide',()=>{preview=false;sync();listeners.clear();},{once:true});sync();
})();

window.createGame=function(R){
 const{ctx:c,spec:s}=R,a=s.assets,m=new Shaving(s.settings);let buzz=null,resultAge=0;
 const preset=Math.round(R.clamp(s.settings.preset,0,2)),result=a.results[preset];
 const regions=s.photoRegions;
 const shaverWidth=()=>Math.min(R.w*.34,R.h*.19);
 const icon=document.createElement('img');icon.src=R.images[a.switch].src;icon.alt='';icon.width=22;icon.height=22;document.querySelector('#direction svg').replaceWith(icon);
 function box(){const p=R.cover(a.original),b=regions[preset];return{x:p.x+b.x*p.w,y:p.y+b.y*p.h,w:b.w*p.w,h:b.h*p.h};}
 function portrait(){R.photo(a.original);const p=R.cover(a.original),b=box();c.save();c.beginPath();for(const strip of m.strokes){if(strip.orientation===0)c.rect(b.x+(strip.position-strip.width/2)*b.w,b.y,strip.width*b.w,b.h*strip.progress);else c.rect(b.x,b.y+(strip.position-strip.width/2)*b.h,b.w*strip.progress,strip.width*b.h);}c.clip();c.drawImage(R.images[result],p.x,p.y,p.w,p.h);c.restore();}
 function drawResultStar(){
  const unit=Math.min(R.w/390,R.h/598);
  c.save();c.translate(R.w*.17,R.h*.30);c.scale(unit,unit);c.rotate(-.12);
  c.globalAlpha=R.reduced?1:R.ease(Math.min(1,resultAge/.3));
  c.strokeStyle='#fff9e9';c.lineWidth=2.3;c.lineCap='round';c.lineJoin='round';c.shadowColor='#25282b70';c.shadowBlur=2;
  c.beginPath();c.moveTo(-2,-20);c.quadraticCurveTo(2,-13,6,-6);c.lineTo(21,-7);c.quadraticCurveTo(15,0,10,4);c.lineTo(14,20);c.quadraticCurveTo(6,16,-1,11);c.lineTo(-16,21);c.quadraticCurveTo(-13,10,-12,4);c.lineTo(-23,-6);c.quadraticCurveTo(-14,-5,-8,-6);c.lineTo(-2,-20);c.stroke();
  c.restore();
 }
 function reset(){R.stop(buzz);m.reset();resultAge=0;R.result('');R.guide(R.config.texts.find(t=>t.id==='GUIDE')?.value||'Tap to shave a strip');R.setDirection(s.settings.orientation===2,()=>{if(m.switch()){R.tone();R.announce(m.orientation?'Horizontal shave':'Vertical shave');icon.style.transform=`rotate(${m.orientation*90}deg)`;}});icon.style.transform=`rotate(${m.orientation*90}deg)`;R.setAction('Shave one strip');document.getElementById('play').disabled=false;}
 return{reset,state:()=>({state:m.state,mode:m.mode,left:m.left,orientation:m.orientation,strokes:m.strokes.map(x=>({...x}))}),isPlaying:()=>m.state==='playing'||m.state==='delay'||m.state==='flash',pause(){R.stop(buzz);buzz=null;},resume(){if(m.mode==='shave'&&m.state==='playing')buzz=R.sound('SHAVE',.22,true);},
 action(){if(m.tap()){R.guide('',false);R.announce(m.left+' shaves left');}},
 update(dt){m.tick(dt);for(const e of m.drain()){if(e.type==='cut'){R.stop(buzz);buzz=R.sound('SHAVE',.22,true);}if(e.type==='stop-cut')R.stop(buzz);if(e.type==='flash')R.sound('FLASH',.32);if(e.type==='result'){R.result('Fresh look');R.setDirection(false);R.announce('Your new look is ready');}}
 if(m.state==='result')resultAge+=dt;const busy=m.mode!=='pan'||!['waiting','playing'].includes(m.state);document.getElementById('play').disabled=busy;R.hud(['result','flash'].includes(m.state)?'':m.left+(m.left===1?' shave':' shaves'),'');document.getElementById('direction').disabled=busy;},
 draw(t){if(window.PlayableIdlePreview.active){
 R.photo(a.original);const time=window.PlayableIdlePreview.seconds,p=time%4.8,b=box(),cut=R.ease(R.clamp((p-.65)/2,0,1)),frame=R.cover(a.original),x=b.x+b.w*.5,y=b.y+b.h*cut;
 c.save();c.beginPath();c.rect(x-b.w*.19,b.y,b.w*.38,b.h*cut);c.clip();c.drawImage(R.images[result],frame.x,frame.y,frame.w,frame.h);c.restore();
 R.sprite(a.buzzer,x,y,shaverWidth(),null,0,p>3.8?R.clamp((4.7-p)/.9,0,1):1,{x:.5,y:.96});
 window.PlayableIdlePreview.stamp(R.canvas,'shaver-strip');return;}
 portrait();if(m.state==='result'){drawResultStar();return;}
 const b=box(),cut=m.mode==='shave'?m.progress:0,x=m.orientation===0?b.x+m.position*b.w:b.x+b.w*cut,y=m.orientation===0?b.y+b.h*cut:b.y+m.position*b.h;
 if(['waiting','playing'].includes(m.state)){c.save();c.strokeStyle='#fff';c.lineWidth=1.5;c.setLineDash([4,5]);c.globalAlpha=.7;c.beginPath();if(m.orientation===0){c.moveTo(x,b.y);c.lineTo(x,b.y+b.h);}else{c.moveTo(b.x,y);c.lineTo(b.x+b.w,y);}c.stroke();c.restore();const size=shaverWidth();R.sprite(a.buzzer,x,y,size,null,m.orientation?-Math.PI/2:0,1,{x:.5,y:.96});}
 if(m.state==='flash'){// Retain the supplied animation, with limited opacity rather than a full-screen white blast.
 c.save();c.globalAlpha=.32;R.frame(a.flash,m.age,s.settings.flashDuration,R.w/2,R.h/2,R.w,R.h);c.restore();}
 }
 };
};
