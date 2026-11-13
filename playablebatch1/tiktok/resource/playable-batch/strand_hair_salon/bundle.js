(() => {
  'use strict';
  const root=document.getElementById('root');
  const style=document.createElement('style');
  style.textContent=`*{box-sizing:border-box}html,body,#root{height:100%;width:100%;margin:0;overflow:hidden;background:#09090b;color:white;font-family:system-ui,sans-serif}button{font:700 13px system-ui;color:white;background:#111;border:2px solid #eee;border-radius:30px;padding:8px 11px;touch-action:manipulation}.scene{height:100%;position:relative;overflow:hidden}canvas{position:absolute;width:100%;height:100%;touch-action:none}.guide{position:absolute;top:15%;width:100%;text-align:center;font-weight:800;font-size:19px;pointer-events:none}.top{position:absolute;top:3%;left:4%;right:4%;display:flex;justify-content:space-between;gap:5px}.reset{border-color:#ff5559;color:#ff6a6c}.tools{position:absolute;bottom:4%;left:3%;right:3%;display:flex;justify-content:center;flex-wrap:wrap;gap:5px}.tools button.active{background:#fff;color:#111}.hold-tool{position:relative;display:flex}.drop{position:absolute;bottom:calc(100% + 7px);left:50%;transform:translateX(-50%);z-index:3;min-height:36px;white-space:nowrap}.palette{position:absolute;z-index:5;top:11%;left:5%;width:min(245px,65%);background:#101010;border:2px solid #eee;border-radius:10px;padding:12px;box-shadow:0 4px 20px #0008}.palette-head{display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:700}.palette .done{font-size:12px;padding:4px 9px}.color-wheel{width:145px;height:145px;max-width:90%;aspect-ratio:1;border-radius:50%;margin:14px auto;touch-action:none;background:radial-gradient(circle,white,transparent 70%),conic-gradient(red,#ff0,lime,cyan,blue,magenta,red);border:2px solid white}.brightness-label{display:flex;justify-content:space-between;font-size:11px;color:#ddd}.brightness{width:100%;accent-color:white;margin:7px 0}.color-preview{height:25px;border:2px solid white;border-radius:5px}.hidden{display:none}`;
  document.head.append(style);
  root.innerHTML=`<div class="scene"><canvas aria-label="Hair styling area"></canvas><div class="guide">Choose a tool to style</div><div class="top"><button class="reset">Reset</button><button class="brush">Brush: S</button><button class="pause">Pause</button></div><div class="palette hidden"></div><div class="tools"></div></div>`;
  const canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d'),guide=root.querySelector('.guide'),palette=root.querySelector('.palette');
  const tools=['Hand','Hold','Scissors','Regrow','Colors'];let tool='Hand',color='#fafafa',brush=0,paused=false,drag=false,last=null,active=new URLSearchParams(location.search).get('feedReview')!=='1',strands=[],held=[],fragments=[],activePointer=null;
  palette.innerHTML='<div class="palette-head"><span>Color Picker</span><button class="done">Done</button></div><div class="color-wheel" role="slider" aria-label="Choose hair color" tabindex="0"></div><div class="brightness-label"><span>Dark</span><span>Light</span></div><input class="brightness" aria-label="Color brightness" type="range" min="0" max="100" value="100"><div class="color-preview"></div>';
  let hue=50,saturation=1,brightness=1;const wheel=palette.querySelector('.color-wheel'),brightnessSlider=palette.querySelector('.brightness'),colorPreview=palette.querySelector('.color-preview');
  function updateColor(){const c=brightness*saturation,x=c*(1-Math.abs((hue/60)%2-1)),m=brightness-c;const rgb=hue<60?[c,x,0]:hue<120?[x,c,0]:hue<180?[0,c,x]:hue<240?[0,x,c]:hue<300?[x,0,c]:[c,0,x];color=`rgb(${rgb.map(v=>Math.round((v+m)*255)).join(',')})`;colorPreview.style.background=color;}
  function chooseColor(e){const r=wheel.getBoundingClientRect(),x=(e.clientX-r.left-r.width/2)/(r.width/2),y=(e.clientY-r.top-r.height/2)/(r.height/2);hue=(Math.atan2(x,-y)*180/Math.PI+360)%360;saturation=Math.min(1,Math.hypot(x,y));updateColor();}
  wheel.addEventListener('pointerdown',e=>{wheel.setPointerCapture(e.pointerId);chooseColor(e)});wheel.addEventListener('pointermove',e=>{if(wheel.hasPointerCapture(e.pointerId))chooseColor(e)});brightnessSlider.addEventListener('input',()=>{brightness=Number(brightnessSlider.value)/100;updateColor()});palette.querySelector('.done').onclick=()=>palette.classList.add('hidden');updateColor();
  root.querySelector('.tools').innerHTML=tools.map(t=>{
    const button=`<button data-tool="${t}" class="${t===tool?'active':''}">${t}</button>`;
    return t==='Hold'?`<span class="hold-tool">${button}<button class="drop hidden" data-action="drop">Drop</button></span>`:button;
  }).join('');
  const dropButton=root.querySelector('.drop');
  function anchor(s,w,h){const r=Math.min(w*.22,h*.16);s.x=.5+s.u*r/w;s.top=.48-Math.sqrt(Math.max(0,1-s.u*s.u))*r/h;}
  function init(){
    const w=canvas.clientWidth||390,h=canvas.clientHeight||598;
    fragments=[];dropButton.classList.add('hidden');
    strands=Array.from({length:170},(_,i)=>{
      const s={u:2*i/169-1,dx:0,dy:0,v:0,vy:0,held:false,curveSpan:1,dye:[],growRemaining:0};
      anchor(s,w,h);s.len=.73-s.top+Math.random()*.015;return s;
    });
  }
  function size(){let d=Math.min(devicePixelRatio||1,2),w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==w*d||canvas.height!==h*d){canvas.width=w*d;canvas.height=h*d;}ctx.setTransform(d,0,0,d,0,0);return [w,h];}
  const bend=t=>3*(1-t)*(1-t)*t*.1+3*(1-t)*t*t*.65+t*t*t;
  function strandBend(s,t){const span=s.curveSpan||1;return bend(t*span)/bend(span);}
  function strandPoint(s,t,w,h){const k=strandBend(s,t);return [(s.x+s.dx*k)*w,(s.top+s.len*t+s.dy*k)*h];}
  function traceStrand(s,from,to,w,h){
    const steps=Math.max(2,Math.ceil((to-from)*48));
    ctx.beginPath();
    for(let i=0;i<=steps;i++){const q=strandPoint(s,from+(to-from)*i/steps,w,h);if(i)ctx.lineTo(...q);else ctx.moveTo(...q);}
    ctx.stroke();
  }
  function shadeAt(s,distance){const band=s.dye.find(b=>distance>=b.from&&distance<=b.to);return band?band.color:'#fafafa';}
  // Color belongs to a material interval, not a fixed percentage of the hair.
  // Growth inserts white material before every interval without resampling it.
  function paintBand(s,from,to,shade){
    from=Math.max(0,from);to=Math.min(s.len,to);if(to<=from)return;
    const bands=[];
    for(const band of s.dye){
      if(band.to<=from||band.from>=to)bands.push(band);
      else{
        if(band.from<from)bands.push({...band,to:from});
        if(band.to>to)bands.push({...band,from:to});
      }
    }
    bands.push({from,to,color:shade});bands.sort((a,b)=>a.from-b.from);
    s.dye=[];
    for(const band of bands){const previous=s.dye[s.dye.length-1];if(previous&&previous.color===band.color&&band.from<=previous.to+.00001)previous.to=Math.max(previous.to,band.to);else s.dye.push(band);}
  }
  function growStrand(s,amount){
    if(amount<=0)return;
    s.len+=amount;
    for(const band of s.dye){band.from+=amount;band.to+=amount;}
  }
  function growAll(amount=.14){for(const s of strands)s.growRemaining+=amount;}
  function draw(){
    const [w,h]=size();ctx.clearRect(0,0,w,h);ctx.strokeStyle='#f8f8f8';ctx.lineWidth=Math.max(2,w*.006);ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.arc(w*.5,h*.48,Math.min(w*.22,h*.16),0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(w*.16,h*.79);ctx.lineTo(w*.5,h*.70);ctx.lineTo(w*.84,h*.79);ctx.stroke();
    for(const f of fragments){
      ctx.save();ctx.translate((f.cx+f.x)*w,(f.cy+f.y)*h);ctx.rotate(f.angle);ctx.globalAlpha=Math.min(1,Math.max(0,(2.5-f.age)*2));ctx.lineWidth=Math.max(2.7,w*.0061);
      for(let i=1;i<f.points.length;i++){const a=f.points[i-1],b=f.points[i];ctx.strokeStyle=b.color;ctx.beginPath();ctx.moveTo((a.x-f.cx)*w,(a.y-f.cy)*h);ctx.lineTo((b.x-f.cx)*w,(b.y-f.cy)*h);ctx.stroke();}ctx.restore();
    }
    for(const s of strands){
      anchor(s,w,h);ctx.lineWidth=Math.max(2.9,w*.0065);ctx.strokeStyle='#fafafa';traceStrand(s,0,1,w,h);
      for(const band of s.dye){ctx.strokeStyle=band.color;traceStrand(s,band.from/s.len,Math.min(1,band.to/s.len),w,h);}
    }
  }
  let lastTick=0;
  function tick(now){
    const dt=Math.min(.034,Math.max(0,(now-(lastTick||now))/1000));lastTick=now;
    if(active&&!paused&&!document.hidden){
      const step=dt*60;
      for(const s of strands){
        // A click regrows every strand; holding the selected tool continues growth.
        if(drag&&tool==='Regrow')s.growRemaining=Math.max(s.growRemaining,.02);
        if(s.growRemaining>0){const added=Math.min(s.growRemaining,.14*dt);growStrand(s,added);s.growRemaining-=added;}
        if(s.held)continue;
        s.v+=-s.dx*.018*step;s.v*=Math.pow(.91,step);s.dx+=s.v*step;
        s.vy+=-s.dy*.018*step;s.vy*=Math.pow(.91,step);s.dy+=s.vy*step;
      }
      for(const f of fragments){f.age+=dt;f.vy+=.9*dt;f.x+=f.vx*dt;f.y+=f.vy*dt;f.angle+=f.spin*dt;}
      fragments=fragments.filter(f=>f.age<2.5&&f.cy+f.y<1.7);
      draw();
    }
    requestAnimationFrame(tick);
  }
  function point(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};}
  function nearestPoint(s,p,w,h){
    let closest=Infinity,hitT=0,a=strandPoint(s,0,w,h);
    for(let i=1;i<=48;i++){
      const b=strandPoint(s,i/48,w,h),dx=b[0]-a[0],dy=b[1]-a[1];
      const fraction=Math.max(0,Math.min(1,((p.x*w-a[0])*dx+(p.y*h-a[1])*dy)/(dx*dx+dy*dy||1)));
      const distance=Math.hypot(a[0]+dx*fraction-p.x*w,a[1]+dy*fraction-p.y*h);
      if(distance<closest){closest=distance;hitT=(i-1+fraction)/48;}a=b;
    }
    return {closest,t:hitT};
  }
  function cutStrand(s,t,w,h){
    const oldLength=s.len,newLength=Math.max(.012,oldLength*t);
    if(oldLength-newLength<.003)return;
    const cutT=newLength/oldLength,points=[];
    for(let i=0;i<=20;i++){const sample=cutT+(1-cutT)*i/20,q=strandPoint(s,sample,w,h);points.push({x:q[0]/w,y:q[1]/h,color:shadeAt(s,oldLength*sample)});}
    const cx=points.reduce((n,p)=>n+p.x,0)/points.length,cy=points.reduce((n,p)=>n+p.y,0)/points.length;
    fragments.push({points,cx,cy,x:0,y:0,vx:(Math.random()-.5)*.055,vy:.025,angle:0,spin:(Math.random()-.5)*.8,age:0});
    if(fragments.length>420)fragments.splice(0,fragments.length-420);
    // Keep the entire attached curve in its exact pose, including held strands.
    const k=strandBend(s,cutT);s.dx*=k;s.dy*=k;s.curveSpan=(s.curveSpan||1)*cutT;s.len=newLength;
    s.dye=s.dye.filter(b=>b.from<newLength).map(b=>({...b,to:Math.min(b.to,newLength)}));
    s.v=0;s.vy=0;s.growRemaining=0;
  }
  function apply(p,prev){
    if(tool==='Regrow')return;
    const w=canvas.clientWidth||390,h=canvas.clientHeight||598,radius=[.045,.075,.115][brush]*w;
    for(const s of strands){
      anchor(s,w,h);const hit=nearestPoint(s,p,w,h);if(hit.closest>radius)continue;
      if(tool==='Scissors')cutStrand(s,hit.t,w,h);
      else if(tool==='Colors'){
        let from=null;
        for(let i=0;i<=96;i++){
          const q=strandPoint(s,i/96,w,h),inside=Math.hypot(q[0]-p.x*w,q[1]-p.y*h)<=radius;
          if(inside&&from===null)from=Math.max(0,(i-.5)/96*s.len);
          if(from!==null&&(!inside||i===96)){paintBand(s,from,Math.min(s.len,(i+.5)/96*s.len),color);from=null;}
        }
      }else if(tool==='Hand'){
        s.held=false;const delta=(p.x-(prev?.x??p.x))*1.4;s.v+=Math.max(-.025,Math.min(.025,delta))*(1-hit.closest/radius);
      }
    }
  }
  // Hold a point of the visible curve. Releasing the pointer keeps this pose pinned.
  function beginHold(p){
    held=[];const w=canvas.clientWidth||390,h=canvas.clientHeight||598,radius=[.045,.075,.115][brush]*w;
    for(const s of strands){
      anchor(s,w,h);const hit=nearestPoint(s,p,w,h);
      if(hit.closest<=radius){const k=Math.max(.08,strandBend(s,hit.t));s.held=true;s.v=0;s.vy=0;held.push({strand:s,dx:s.dx,dy:s.dy,k});}
    }
    if(held.length)dropButton.classList.remove('hidden');
  }
  function moveHold(p){if(!holdStart)return;for(const item of held){item.strand.dx=item.dx+(p.x-holdStart.x)/item.k;item.strand.dy=item.dy+(p.y-holdStart.y)/item.k;}}
  let holdStart=null;
  function endDrag(){drag=false;activePointer=null;holdStart=null;for(const item of held){item.strand.v=0;item.strand.vy=0;}held=[];}
  canvas.addEventListener('pointerdown',e=>{
    if(!active||paused||drag||e.isPrimary===false)return;
    drag=true;activePointer=e.pointerId;canvas.setPointerCapture(e.pointerId);last=point(e);guide.classList.add('hidden');
    if(tool==='Hold'){holdStart=last;beginHold(last);}else apply(last,last);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==activePointer)return;const p=point(e);
    if(tool==='Hold')moveHold(p);
    else{const steps=Math.max(1,Math.ceil(Math.hypot(p.x-last.x,p.y-last.y)/.012));for(let i=1;i<=steps;i++)apply({x:last.x+(p.x-last.x)*i/steps,y:last.y+(p.y-last.y)*i/steps},last);}last=p;
  });
  canvas.addEventListener('pointerup',e=>{if(e.pointerId===activePointer)endDrag()});
  canvas.addEventListener('pointercancel',e=>{if(e.pointerId===activePointer)endDrag()});
  canvas.addEventListener('lostpointercapture',e=>{if(e.pointerId===activePointer)endDrag()});
  root.querySelector('.tools').addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;endDrag();
    if(b.dataset.action==='drop'){
      for(const s of strands){s.held=false;s.v=0;s.vy=0;}
      dropButton.classList.add('hidden');draw();return;
    }
    tool=b.dataset.tool;
    dropButton.classList.toggle('hidden',tool!=='Hold'&&!strands.some(s=>s.held));
    root.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('active',x===b));palette.classList.toggle('hidden',tool!=='Colors');guide.classList.add('hidden');
    if(tool==='Regrow')growAll();
  });
  root.querySelector('.reset').onclick=()=>{endDrag();init();palette.classList.add('hidden');draw()};root.querySelector('.brush').onclick=e=>{brush=(brush+1)%3;e.currentTarget.textContent='Brush: '+['S','M','L'][brush]};root.querySelector('.pause').onclick=e=>{paused=!paused;if(paused)endDrag();e.currentTarget.textContent=paused?'Resume':'Pause'};
  window.addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='playable-active'){active=!!e.data.active;draw()}});init();draw();requestAnimationFrame(tick);
})();
