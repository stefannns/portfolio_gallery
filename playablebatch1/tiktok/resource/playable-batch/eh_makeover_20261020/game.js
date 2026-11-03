
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
 const{ctx:c,spec:s}=R,a=s.assets,m=new Makeover(s.settings),names=['Brush your teeth','Smile check','Wipe the tears','Makeup time'],verbs=['Drag to brush','Drag across the face','Drag to wipe','Drag to blend'],sounds=['BRUSH','HAMMER','TISSUE','MAKEUP'];
 let dragging=false,lastPoint=null,toolPoint=null,buzz=null,contactGrace=0,resultAge=0;
 const scale=()=>Math.min(R.w/390,R.h/598),rest=()=>({x:R.w*.72,y:R.h*.71-(document.documentElement?.dataset.feedPreview==='true'?28*scale():0)});
 function zones(){const p=s.photoPoints,points=m.stage===0?[p.mouth]:m.stage===2?p.eyes:[p.face];return points.map(point=>({...R.point(a.looks[0],point),rx:R.w*[.15,.21,.10,.21][m.stage],ry:R.h*[.065,.18,.065,.18][m.stage]}));}
 function inZone(p){return zones().some(z=>((p.x-z.x)/z.rx)**2+((p.y-z.y)/z.ry)**2<=1);}
 function stopContact(){R.stop(buzz);buzz=null;contactGrace=0;}
 function end(){dragging=false;lastPoint=null;toolPoint=null;stopContact();}
 function reset(){end();m.reset();resultAge=0;R.guide(R.config.texts.find(t=>t.id==='GUIDE')?.value||verbs[0]);R.result('');R.setAction('Drag over the mouth to brush. Arrow keys make short strokes.');document.getElementById('play').disabled=false;}
 function move(p){if(!dragging||!lastPoint||!['waiting','playing'].includes(m.state)||m.busy>0)return;const d=Makeover.contactDistance(lastPoint,p,zones())/scale();lastPoint=p;toolPoint=p;if(m.stroke(d)){R.guide('',false);contactGrace=.12;if(!buzz)buzz=R.sound(sounds[m.stage],m.stage===1?.24:.32,true);R.announce(names[m.stage]+', '+Math.min(100,Math.round((m.taps+m.contactDistance/40)/s.settings.taps[m.stage]*100))+' percent');}else stopContact();}
 return{
 inputMode:'drag',reset,state:()=>({state:m.state,stage:m.stage,progress:m.taps+m.contactDistance/40,dragging,busy:m.busy}),isPlaying:()=>['playing','transition'].includes(m.state),pause:end,
 pointerStart(p){if(!['waiting','playing'].includes(m.state)||m.busy>0)return false;const r=rest();if(!inZone(p)&&Math.hypot(p.x-r.x,p.y-r.y)>R.w*.16)return false;dragging=true;lastPoint=p;toolPoint=p;return true;},
 pointerMove:move,pointerEnd:end,
 keyStroke(key){if(!['waiting','playing'].includes(m.state)||m.busy>0)return;const z=zones()[0],step=16*scale(),v={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[key];dragging=true;lastPoint={x:z.x-step*v[0]/2,y:z.y-step*v[1]/2};move({x:z.x+step*v[0]/2,y:z.y+step*v[1]/2});end();},
 update(dt){m.tick(dt);contactGrace=Math.max(0,contactGrace-dt);if(!contactGrace)stopContact();for(const e of m.drain()){
 if(e.type==='stage'){R.releaseInput();R.setAction(verbs[m.stage]+'. Arrow keys make short strokes.');R.guide(verbs[m.stage]);}
 if(e.type==='transition'){R.releaseInput();R.sound('TRANSITION',.25);}
 if(e.type==='result'){R.releaseInput();R.sound('FINAL',.38);R.result('Beautiful');R.announce('Makeover complete');}}
 if(m.state==='result')resultAge+=dt;const progress=Math.min(100,Math.round((m.taps+m.contactDistance/40)/s.settings.taps[m.stage]*100)),stageEl=document.getElementById('stage');stageEl.dataset.stage=String(m.stage);stageEl.dataset.progress=String(progress);stageEl.dataset.dragging=String(dragging);document.getElementById('play').disabled=m.state==='result';R.hud(m.state==='result'?'':names[m.stage],m.state==='result'?'':progress+'%');},
 draw(t){if(window.PlayableIdlePreview.active){
 const time=window.PlayableIdlePreview.seconds,p=time%4.6,z=zones()[0],brush=Math.sin(time*9),travel=R.clamp((p-.5)/.65,0,1),resting=rest();
 R.photo(a.looks[0]);if(p>1.1&&p<3.9)R.photo(a.looks[1],Math.sin((p-1.1)/2.8*Math.PI)*.82);
 const x=R.mix(resting.x,z.x+brush*R.w*.065,travel),y=R.mix(resting.y,z.y+Math.sin(time*4)*R.h*.009,travel);
 R.sprite(a.tools[0],x,y,R.w*.24,null,brush*.035,1,{x:.71,y:.19});
 window.PlayableIdlePreview.stamp(R.canvas,'brush-teeth');return;}
 const stage=m.stage;R.photo(a.looks[stage]);if(m.state==='transition'){const p=R.clamp(m.transition/s.settings.flashSec,0,1);R.photo(a.looks[stage+1>=s.settings.sequenceCount?4:stage+1],p);}
 if(m.state==='result'){R.photo(a.looks[4]);R.frame(a.finalVfx,resultAge,2,R.w/2,R.h/2,R.w,R.h,true);return;}
 if(m.state==='waiting'){c.save();c.strokeStyle='#fff';c.globalAlpha=.65;c.lineWidth=1.5*scale();c.setLineDash([4*scale(),5*scale()]);for(const z of zones()){c.beginPath();c.ellipse(z.x,z.y,z.rx*.8,z.ry*.8,0,0,Math.PI*2);c.stroke();}c.restore();}
 const p=toolPoint||rest(),toolW=R.w*[.24,.30,.28,.30][stage],anchor=[{x:.71,y:.19},{x:.70,y:.24},{x:.50,y:.45},{x:.70,y:.18}][stage];R.sprite(a.tools[stage],p.x,p.y,toolW,null,0,1,anchor);
 if(m.actionAge<s.settings.vfxDuration[stage]){const dest=zones()[0];if(stage===2){for(const eye of zones())R.frame(a.vfx[stage],m.actionAge,s.settings.vfxDuration[stage],eye.x,eye.y+R.h*.08,R.w*.16);}else R.frame(a.vfx[stage],m.actionAge,s.settings.vfxDuration[stage],dest.x,dest.y,R.w*[.27,.70,.16,.75][stage]);}
 }
 };
};
