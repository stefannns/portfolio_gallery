(() => {
  'use strict';
  const root = document.getElementById('root');
  const style = document.createElement('style');
  style.textContent = `
    *{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#090b1b;color:#e8fdff;font-family:Arial,sans-serif;-webkit-tap-highlight-color:transparent}
    button{font:700 16px Arial,sans-serif;touch-action:manipulation;cursor:pointer}
    .dash{position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;user-select:none}
    canvas{display:block;width:100%;height:100%}
    .hud{position:absolute;left:30px;right:30px;top:28px;pointer-events:none}
    .stats{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;letter-spacing:1px;color:#9da7c5}.progress-label{font-size:20px;font-weight:800;color:#75f2ff;letter-spacing:0}
    .track{height:5px;border-radius:5px;background:#292e43;margin-top:8px;overflow:hidden}.fill{height:100%;width:0;background:#75f2ff;box-shadow:0 0 12px #39e1ff;border-radius:5px}
    .levels{position:absolute;top:93px;left:0;right:0;display:flex;justify-content:center;gap:14px}
    .levels button{position:relative;width:40px;height:40px;border:1px solid #394259;color:#bac6db;border-radius:50%;background:#15182b}
    .levels button.selected{background:#75f2ff;color:#071a23;border-color:#75f2ff;box-shadow:0 0 20px #34e9ff35}.levels button:disabled{cursor:default;opacity:.55}
    .lock{display:inline-block;width:10px;height:9px;border-radius:2px;background:#7b879e;position:relative}.lock:before{content:'';position:absolute;left:1px;top:-7px;width:8px;height:9px;border:2px solid #7b879e;border-radius:7px}
    .guide{position:absolute;top:34%;left:30px;right:30px;text-align:center;color:#e5fdff;font-size:20px;font-weight:800;line-height:1.3;text-shadow:0 2px 12px #142b42;pointer-events:none;animation:breathe 1.9s ease-in-out infinite}
    @keyframes breathe{50%{opacity:.65;transform:scale(.97)}}
    .result{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#06081796;backdrop-filter:blur(4px);z-index:5}
    .card{width:calc(100% - 60px);max-width:320px;text-align:center;border:1px solid #485b7b;background:#0e1426ee;border-radius:20px;padding:30px 24px;box-shadow:0 15px 50px #0006}
    .card h1{margin:0 0 18px;font-size:24px;letter-spacing:-.6px}.card p{margin:0 0 25px;color:#8df5ff;font-size:46px;font-weight:800;font-variant-numeric:tabular-nums}
    .card button{border:0;border-radius:30px;padding:13px 28px;background:#75f2ff;color:#08212d;box-shadow:0 5px 22px #2be4ff24}.hidden{display:none}
    @media(max-height:520px){.hud{top:20px}.levels{top:79px}.levels button{height:34px;width:34px}}
  `;
  document.head.append(style);
  root.innerHTML = `<div class="dash"><canvas aria-label="Neon Dash playfield"></canvas><div class="hud"><div class="stats"><span class="best">BEST 0%</span><span class="progress-label">0%</span></div><div class="track"><div class="fill"></div></div></div><div class="levels" aria-label="Choose level"></div><div class="guide">Tap to jump</div><div class="result hidden"><div class="card"><h1>Try again</h1><p>0%</p><button>Try again</button></div></div></div>`;
  const game = root.querySelector('.dash'), canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d');
  const progressEl = root.querySelector('.progress-label'), bestEl = root.querySelector('.best'), fill = root.querySelector('.fill');
  const guide = root.querySelector('.guide'), levelsEl = root.querySelector('.levels'), result = root.querySelector('.result');
  const key = 'neon-dash-progress-v1';
  let saved = {best:[0,0,0],unlocked:1};
  try { const data = JSON.parse(localStorage.getItem(key) || 'null'); if (data && Array.isArray(data.best)) saved = {best:data.best.slice(0,3),unlocked:Math.max(1,Math.min(3,Number(data.unlocked)||1))}; } catch (_) {}
  let W=390,H=598,ground=450,level=0,phase='ready',active=true,offset=0,vy=0,y=0,angle=0,grounded=true,held=false,jumpBuffer=0,freeze=0,last=0,particles=[],trail=[],lastHud=-1,shake=0,beat=0;
  const cube = {x:112,size:29};
  let obstacles=[],length=9000,speed=285,attempts=1;
  let audio=null,music=null,musicTimer=null,musicNext=0,musicStep=0;
  function getAudio(){
    if(!audio)audio=new (window.AudioContext||window.webkitAudioContext)();
    if(audio.state==='suspended')audio.resume().catch(()=>{});
    return audio;
  }
  function sound(type){
    try {
      getAudio();
      const at=audio.currentTime,o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);
      const start=type==='jump'?410:type==='crash'?160:660,end=type==='jump'?590:type==='crash'?48:990,duration=type==='crash'?.19:.1;
      o.type=type==='crash'?'triangle':'sine';o.frequency.setValueAtTime(start,at);o.frequency.exponentialRampToValueAtTime(end,at+duration);g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(type==='jump'?.09:.15,at+.008);g.gain.exponentialRampToValueAtTime(.0001,at+duration);o.start(at);o.stop(at+duration+.02);
      o.onended=()=>{o.disconnect();g.disconnect();};
    }catch(_){}
  }
  // Original 128 BPM synth loop: kick, backbeat, hats, syncopated bass and arpeggio.
  // Schedule a short window ahead so note timing stays independent of rendering.
  const beatLength=60/128,sixteenth=beatLength/4;
  const frequency=note=>440*Math.pow(2,(note-69)/12);
  function musicVoice(freq,at,duration,volume,type='triangle',cutoff=2200,endFrequency=0,attack=.006){
    const o=audio.createOscillator(),g=audio.createGain(),filter=audio.createBiquadFilter();
    o.type=type;o.frequency.setValueAtTime(freq,at);
    if(endFrequency)o.frequency.exponentialRampToValueAtTime(endFrequency,at+duration*.8);
    filter.type='lowpass';filter.frequency.value=cutoff;filter.Q.value=.6;
    g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(volume,at+attack);g.gain.exponentialRampToValueAtTime(.0001,at+duration);
    o.connect(filter);filter.connect(g);g.connect(music.bus);music.voices.add(o);
    o.onended=()=>{music.voices.delete(o);o.disconnect();filter.disconnect();g.disconnect();};
    o.start(at);o.stop(at+duration+.02);
  }
  function musicNoise(at,duration,volume,cutoff){
    const n=audio.createBufferSource(),g=audio.createGain(),filter=audio.createBiquadFilter();n.buffer=music.noise;
    filter.type='highpass';filter.frequency.value=cutoff;
    g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(volume,at+.002);g.gain.exponentialRampToValueAtTime(.0001,at+duration);
    n.connect(filter);filter.connect(g);g.connect(music.bus);music.voices.add(n);
    n.onended=()=>{music.voices.delete(n);n.disconnect();filter.disconnect();g.disconnect();};
    n.start(at);n.stop(at+duration+.01);
  }
  function scheduleMusic(){
    if(!active||document.hidden||phase!=='playing'){stopMusic();return;}
    while(musicNext<audio.currentTime+.13){
      const step=musicStep%16,bar=Math.floor(musicStep/16)%4;
      const base=[45,41,48,43][bar],chord=bar===0?[0,3,7,12]:[0,4,7,12];
      if(step%4===0)musicVoice(145,musicNext,.19,.36,'sine',1200,44);
      if(step===4||step===12){musicNoise(musicNext,.12,.12,1300);musicVoice(180,musicNext,.085,.075,'triangle',1600,105);}
      if(step%2===0)musicNoise(musicNext,step===14?.10:.037,step%4===2?.047:.029,6500);
      if(step%4===0||step===7||step===14)musicVoice(frequency(base),musicNext,.20,.13,'sawtooth',650);
      if(step%2===0){const note=[0,2,1,3,2,1,2,0][step/2];musicVoice(frequency(base+24+chord[note]),musicNext,.18,.09,'sawtooth',2100);}
      if(step===0)for(const interval of chord.slice(0,3))musicVoice(frequency(base+12+interval),musicNext,beatLength*3.8,.018,'triangle',1100,0,.06);
      musicStep++;musicNext+=sixteenth;
    }
  }
  function startMusic(){
    if(!active||document.hidden||phase!=='playing'||musicTimer)return;
    try{
      getAudio();
      if(!music){
        const bus=audio.createGain();bus.gain.value=0;bus.connect(audio.destination);
        const noise=audio.createBuffer(1,Math.ceil(audio.sampleRate*.25),audio.sampleRate),samples=noise.getChannelData(0);
        for(let i=0;i<samples.length;i++)samples[i]=Math.random()*2-1;
        music={bus,noise,voices:new Set()};
      }
      const now=audio.currentTime;music.bus.gain.cancelScheduledValues(now);music.bus.gain.setValueAtTime(0,now);music.bus.gain.linearRampToValueAtTime(.36,now+.16);
      musicStep=0;musicNext=now+.025;musicTimer=setInterval(scheduleMusic,25);scheduleMusic();game.dataset.music='playing';
    }catch(_){stopMusic();}
  }
  function stopMusic(){
    if(musicTimer){clearInterval(musicTimer);musicTimer=null;}
    if(music&&audio){
      const at=audio.currentTime;music.bus.gain.cancelScheduledValues(at);music.bus.gain.setValueAtTime(music.bus.gain.value,at);music.bus.gain.linearRampToValueAtTime(0,at+.045);
      for(const voice of music.voices){try{voice.stop(at+.05);}catch(_){}}
    }
    game.dataset.music='stopped';
  }
  function persist(){try{localStorage.setItem(key,JSON.stringify(saved))}catch(_){}}
  function progress(){return Math.min(100,Math.floor(offset/length*100))}
  function hud(){const p=progress();if(p!==lastHud){progressEl.textContent=p+'%';fill.style.width=p+'%';lastHud=p;}bestEl.textContent='BEST '+(saved.best[level]||0)+'%';game.dataset.progress=String(p);game.dataset.phase=phase;}
  function levels(){levelsEl.innerHTML=Array.from({length:3},(_,i)=>`<button aria-label="Level ${i+1}${i>=saved.unlocked?' locked':''}" ${i>=saved.unlocked?'disabled':''} class="${i===level?'selected':''}" data-level="${i}">${i<saved.unlocked?i+1:'<span class="lock" aria-hidden="true"></span>'}</button>`).join('')}
  function makeLevel(){
    obstacles=[];speed=[285,320,355][level];length=[8600,10300,12000][level];
    const patterns = level===0?[[1],[1],[2],[1],[2],[3],[1],[2],[1],[3],[2],[1],[2],[3],[1],[3],[2],[3],[1],[3],[2],[3]]:level===1?[[2],[1],[3],[2],[3],[2],[4],[1],[3],[2],[4],[3],[2],[4],[3],[3],[4],[2],[4],[3],[4],[3],[2],[4]]:[[3],[2],[4],[3],[4],[2],[4],[3],[4],[4],[2],[4],[3],[4],[4],[3],[4],[2],[4],[4],[3],[4],[4],[3],[4]];
    let x=600;
    for(let i=0;x<length-400;i++){
      const kind=patterns[i%patterns.length][0];
      if(kind===4){obstacles.push({x,w:50,h:43,kind:'block'});obstacles.push({x:x+120,w:28,h:40,kind:'spike'});x+=level===2?400:425;}
      else {for(let j=0;j<kind;j++)obstacles.push({x:x+j*29,w:28,h:40,kind:'spike'});x+=[310,355,390][kind-1]+(i%3)*22;}
    }
  }
  function reset(start=false){offset=0;y=0;vy=0;angle=0;grounded=true;held=false;jumpBuffer=0;particles=[];trail=[];freeze=0;lastHud=-1;phase=start?'playing':'ready';result.classList.add('hidden');guide.classList.toggle('hidden',start);makeLevel();hud();if(start)startMusic();else stopMusic();draw();}
  function burst(x,yy,color,n=18){for(let i=0;i<n;i++){const a=i/n*Math.PI*2,s=65+Math.random()*180;particles.push({x,y:yy,vx:Math.cos(a)*s,vy:Math.sin(a)*s,color,life:.55+Math.random()*.25,size:2+Math.random()*5})}}
  function jump(){if(!grounded)return;vy=-625;grounded=false;jumpBuffer=0;sound('jump');burst(cube.x,ground+y,'#64dce8',5)}
  function press(){if(!active||phase==='crashed'||phase==='complete')return;if(phase==='ready'){phase='playing';guide.classList.add('hidden');hud();startMusic();}jumpBuffer=.13;held=true;if(grounded)jump()}
  function release(){held=false}
  function end(won){
    if(phase!=='playing')return;phase=won?'complete':'crashed';held=false;freeze=won?.2:.45;stopMusic();
    saved.best[level]=Math.max(saved.best[level]||0,won?100:progress());if(won)saved.unlocked=Math.max(saved.unlocked,Math.min(3,level+2));persist();hud();levels();sound(won?'win':'crash');
    if(!won){shake=.2;burst(cube.x+cube.size/2,ground+y-cube.size/2,'#75f2ff',28)}
  }
  function showResult(){result.classList.remove('hidden');result.querySelector('h1').textContent=phase==='complete'?'Level complete':'Try again';result.querySelector('p').textContent=phase==='complete'?'100%':progress()+'%';result.querySelector('button').textContent=phase==='complete'&&level<2?'Next level':'Try again';}
  function resize(){const r=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(r.width*d));canvas.height=Math.max(1,Math.round(r.height*d));H=W*(r.height/Math.max(1,r.width));ground=H*.76;ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);draw()}
  // A slightly inset player box and triangular spike test make visible contact fair.
  function hitsSpike(ob){const left=cube.x+4,right=cube.x+cube.size-4,top=ground+y-cube.size+4,bottom=ground+y-3,x=ob.x-offset;if(right<=x||left>=x+ob.w||bottom<=ground-ob.h)return false;const sample=Math.max(x+2,Math.min(x+ob.w-2,(left+right)/2));const surface=ground-ob.h*(1-Math.abs((sample-(x+ob.w/2))/(ob.w/2)));return bottom>surface&&top<ground;}
  function update(dt){
    if(phase==='playing'){
      const beforeY=y;offset+=speed*dt;jumpBuffer=Math.max(0,jumpBuffer-dt);
      vy+=2000*dt;y+=vy*dt;grounded=false;
      if(y>=0){if(vy>0&&beforeY<0)burst(cube.x,ground,'#75f2ff',5);y=0;vy=0;grounded=true;angle=Math.round(angle/(Math.PI/2))*Math.PI/2;}
      for(const ob of obstacles){const x=ob.x-offset;if(x>W+100||x+ob.w<cube.x-100)continue;if(ob.kind==='spike'){if(hitsSpike(ob))end(false);}else{
        const left=cube.x+3,right=cube.x+cube.size-3,top=y-cube.size+3,bottom=y-2;
        if(right>x&&left<x+ob.w){if(beforeY<=-ob.h+2&&y>=-ob.h&&vy>=0){y=-ob.h;vy=0;grounded=true;angle=Math.round(angle/(Math.PI/2))*Math.PI/2;}else if(bottom>-ob.h&&top<0)end(false);}
      }}
      if(grounded&&(held||jumpBuffer>0)&&phase==='playing')jump();
      if(!grounded)angle+=dt*5.5;
      beat+=dt;if(beat>.025){beat=0;trail.push({x:cube.x+2,y:ground+y-cube.size/2,life:.25});}
      if(offset>=length)end(true);hud();
    }else if((phase==='crashed'||phase==='complete')&&result.classList.contains('hidden')){freeze-=dt;if(freeze<=0)showResult()}
    for(const p of particles){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=350*dt}particles=particles.filter(p=>p.life>0);
    for(const p of trail){p.life-=dt;p.x-=speed*dt}trail=trail.filter(p=>p.life>0);shake=Math.max(0,shake-dt);
  }
  function rounded(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
  function draw(){
    const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#0a1226');sky.addColorStop(1,'#17102a');
    ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);ctx.save();if(shake)ctx.translate((Math.random()-.5)*shake*22,(Math.random()-.5)*shake*22);
    // Even square cells replace the drifting decorative shapes.
    const grid=40,shift=offset*.12%grid;
    ctx.strokeStyle='#4d8aaf';ctx.lineWidth=1;ctx.globalAlpha=.27;ctx.beginPath();
    for(let x=-shift;x<W;x+=grid){ctx.moveTo(x,0);ctx.lineTo(x,ground);}
    for(let yy=0;yy<ground;yy+=grid){ctx.moveTo(0,yy);ctx.lineTo(W,yy);}ctx.stroke();
    ctx.strokeStyle='#78b2cf';ctx.globalAlpha=.10;ctx.beginPath();
    for(let x=-(offset*.12%(grid*4));x<W;x+=grid*4){ctx.moveTo(x,0);ctx.lineTo(x,ground);}
    for(let yy=0;yy<ground;yy+=grid*4){ctx.moveTo(0,yy);ctx.lineTo(W,yy);}ctx.stroke();
    ctx.globalAlpha=1;ctx.fillStyle='#0b1525';ctx.fillRect(0,ground,W,H-ground);
    ctx.strokeStyle='#346b83';ctx.globalAlpha=.35;ctx.lineWidth=1;ctx.beginPath();
    for(let x=-(offset%grid);x<W;x+=grid){ctx.moveTo(x,ground);ctx.lineTo(x,H);}
    for(let yy=ground+32;yy<H;yy+=32){ctx.moveTo(0,yy);ctx.lineTo(W,yy);}ctx.stroke();
    ctx.globalAlpha=1;ctx.strokeStyle='#75f2ff';ctx.lineWidth=2;ctx.shadowColor='#35d8eb';ctx.shadowBlur=7;ctx.beginPath();ctx.moveTo(0,ground);ctx.lineTo(W,ground);ctx.stroke();ctx.shadowBlur=0;
    for(const ob of obstacles){const x=ob.x-offset;if(x< -100||x>W+80)continue;ctx.strokeStyle=ob.kind==='spike'?'#f478ee':'#6addeb';ctx.fillStyle=ob.kind==='spike'?'#401b4b':'#163644';ctx.lineWidth=2.5;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=7;ctx.beginPath();if(ob.kind==='spike'){ctx.moveTo(x,ground);ctx.lineTo(x+ob.w/2,ground-ob.h);ctx.lineTo(x+ob.w,ground);ctx.closePath()}else ctx.rect(x,ground-ob.h,ob.w,ob.h);ctx.fill();ctx.stroke();ctx.shadowBlur=0;}
    if(length-offset<W){const xx=length-offset;ctx.strokeStyle='#80ffd0';ctx.setLineDash([7,5]);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(xx,ground-145);ctx.lineTo(xx,ground);ctx.stroke();ctx.setLineDash([])}
    for(const p of trail){ctx.globalAlpha=p.life*1.6;ctx.fillStyle='#75f2ff';ctx.fillRect(p.x,p.y,4,4)}ctx.globalAlpha=1;
    if(phase!=='crashed'){
      ctx.save();ctx.translate(cube.x+cube.size/2,ground+y-cube.size/2);ctx.rotate(angle);ctx.shadowColor='#50f3ff';ctx.shadowBlur=18;ctx.fillStyle='#32c6d8';rounded(-cube.size/2,-cube.size/2,cube.size,cube.size,5);ctx.fill();ctx.strokeStyle='#9cffff';ctx.lineWidth=2;ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle='#e5ffff';ctx.lineWidth=2;rounded(-8,-8,16,16,2);ctx.stroke();ctx.fillStyle='#b3ffff';ctx.fillRect(-3,-3,6,6);ctx.restore();
    }
    for(const p of particles){ctx.globalAlpha=Math.min(1,p.life*2);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size)}ctx.globalAlpha=1;ctx.restore();
  }
  game.addEventListener('pointerdown',e=>{if(e.target.closest('button,.result,.levels'))return;e.preventDefault();game.setPointerCapture(e.pointerId);press()});
  game.addEventListener('pointerup',release);game.addEventListener('pointercancel',release);game.addEventListener('lostpointercapture',release);
  window.addEventListener('keydown',e=>{if(e.code==='Space'||e.code==='ArrowUp'){e.preventDefault();if(!e.repeat)press()}});window.addEventListener('keyup',e=>{if(e.code==='Space'||e.code==='ArrowUp')release()});
  levelsEl.addEventListener('click',e=>{const b=e.target.closest('[data-level]');if(!b||b.disabled)return;level=Number(b.dataset.level);attempts=1;levels();reset()});
  result.querySelector('button').addEventListener('click',()=>{if(phase==='complete'&&level<2){level++;attempts=1;levels()}else attempts++;reset(true)});
  window.addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='playable-active'){active=!!e.data.active;if(!active){held=false;stopMusic();}else if(phase==='playing'&&audio)startMusic();last=0}});
  document.addEventListener('visibilitychange',()=>{last=0;held=false;if(document.hidden)stopMusic();else if(active&&phase==='playing'&&audio)startMusic();});window.addEventListener('pagehide',stopMusic);window.addEventListener('resize',resize);
  function frame(now){const dt=last?Math.min((now-last)/1000,.035):0;last=now;if(active&&!document.hidden){let remaining=dt;while(remaining>0){const step=Math.min(remaining,1/120);update(step);remaining-=step}draw()}requestAnimationFrame(frame)}
  levels();reset();resize();requestAnimationFrame(frame);
})();
