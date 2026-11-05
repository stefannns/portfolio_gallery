
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

(()=>{
  'use strict';

  const flattenConfig = raw => {
    const out = {};
    for (const section of ['tweaks', 'texts', 'images']) {
      for (const item of raw[section] || []) out[item.id] = item.value ?? item.path;
    }
    return out;
  };

  const loadConfig = async () => {
    try {
      const response = await fetch('./game.config.json', { cache: 'no-store' });
      if (response.ok) return flattenConfig(await response.json());
    } catch (_) {}
    const inline = document.getElementById('playable-config-inline');
    return inline ? flattenConfig(JSON.parse(inline.textContent)) : {};
  };

  const start = async () => {
    const cfg = await loadConfig();
    const root = document.getElementById('root');
    const style = document.createElement('style');
    style.textContent = `
      :root { --ui-unit: min(0.2564102564vw, 0.1672240803vh); color-scheme: dark; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { background: #020306; user-select: none; -webkit-user-select: none; touch-action: none; }
      .instrument { position: relative; width: 100%; height: 100%; overflow: hidden; background: #020306; }
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: crosshair; }
      .prompt {
        position: absolute;
        z-index: 2;
        top: 26%;
        left: calc(30 * var(--ui-unit) + env(safe-area-inset-left));
        right: calc(30 * var(--ui-unit) + env(safe-area-inset-right));
        margin: 0;
        transform: translateY(-50%);
        color: rgba(222,232,248,.72);
        font-size: calc(18 * var(--ui-unit));
        font-weight: 750;
        line-height: 1.35;
        letter-spacing: .04em;
        overflow-wrap: anywhere;
        text-align: center;
        text-wrap: balance;
        pointer-events: none;
        text-shadow: 0 2px 16px #000;
        transition: opacity .25s ease;
      }
      .prompt.hidden { opacity: 0; }
      .palette {
        position: absolute; z-index: 3; left: 50%; transform: translateX(-50%);
        bottom: calc(50 * var(--ui-unit) + env(safe-area-inset-bottom));
        display: flex; gap: 8px;
      }
      .swatch {
        position: relative; width: 44px; height: 44px; padding: 6px;
        border: 2px solid transparent; border-radius: 50%; background: transparent;
        cursor: pointer; touch-action: manipulation;
        transition: border-color .15s ease, background-color .15s ease;
      }
      .swatch::before { content: ''; display: block; width: 100%; height: 100%; border-radius: 50%; background: var(--swatch); }
      .swatch[aria-pressed="true"] { border-color: #eff7ff; }
      .swatch:active, .clear:active { background-color: rgba(255,255,255,.12); }
      .swatch:focus-visible, canvas:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
      .clear {
        position: absolute;
        z-index: 3;
        top: calc(30 * var(--ui-unit) + env(safe-area-inset-top) + 6px);
        right: calc(30 * var(--ui-unit) + env(safe-area-inset-right) + 6px);
        width: 48px;
        height: 48px;
        border: 0;
        background: transparent;
        color: rgba(235,239,247,.76);
        cursor: pointer;
      }
      .clear::before, .clear::after {
        content: '';
        position: absolute;
        left: 8px;
        right: 8px;
        top: 23px;
        height: 3px;
        border-radius: 99px;
        background: currentColor;
      }
      .clear::before { transform: rotate(45deg); }
      .clear::after { transform: rotate(-45deg); }
      .clear::before,.clear::after{display:none}.clear{display:grid;place-items:center}html[data-batch2-idle="true"] .palette{bottom:29%}
      .clear:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
      @media (prefers-reduced-motion: reduce) { .prompt, .swatch { transition-duration: .01ms; } }
    `;
    document.head.appendChild(style);

    const palettes = [
      { id: 'blue', label: 'Blue', main: [64,174,255], deep: [38,153,235], light: [148,218,255], accent: [255,195,207] },
      { id: 'pink', label: 'Pink', main: [244,121,194], deep: [211,74,170], light: [255,186,225], accent: [210,182,255] },
      { id: 'mint', label: 'Mint', main: [91,218,166], deep: [40,180,133], light: [179,255,216], accent: [156,222,255] },
      { id: 'gold', label: 'Gold', main: [246,189,89], deep: [221,144,47], light: [255,224,154], accent: [255,180,153] }
    ];
    let palette = palettes[0];
    const rgba = (rgb, alpha) => 'rgba(' + rgb.join(',') + ',' + alpha + ')';
    root.innerHTML = `
      <main class="instrument">
        <canvas id="strings" tabindex="0" aria-label="Drag, or tap two points, to create a gently pulsing string. Or press Enter, use arrow keys to set the endpoint, then Enter to finish. Escape cancels."></canvas>
        <p class="prompt" id="prompt"></p>
        <button class="clear" id="clear" type="button" aria-label="Restart instrument"><svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1.6 7.2M4 4v6h6"/></svg></button>
        <div class="palette" role="group" aria-label="Wave color">
          ${palettes.map((item, index) => `<button class="swatch" id="wave-${item.id}" type="button" aria-label="${item.label} waves" aria-pressed="${index === 0}" style="--swatch: rgb(${item.main.join(',')})"></button>`).join('')}
        </div>
      </main>
    `;

    const canvas = document.getElementById('strings');
    const ctx = canvas.getContext('2d');
    const prompt = document.getElementById('prompt');
    const clearButton = document.getElementById('clear');
    prompt.textContent = cfg.TEXT_PROMPT || 'DRAG BETWEEN TWO POINTS';

    const minFrequency = Math.max(40, Number(cfg.MIN_FREQUENCY) || 110);
    const maxFrequency = Math.max(minFrequency + 50, Number(cfg.MAX_FREQUENCY) || 760);
    const waveHeight = Math.max(6, Number(cfg.WAVE_HEIGHT) || 22);
    const maxStrings = Math.max(2, Math.round(Number(cfg.MAX_STRINGS) || 8));
    const masterDb = Number.isFinite(Number(cfg.VOLUME)) ? Number(cfg.VOLUME) : -20;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let strings = [];
    let draft = null;
    let audio = null;
    let master = null;
    let compressor = null;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
    let lastFrame = performance.now();
    let pulseSerial = 0;
    const pulseDuration = 1.05;
    // A Hann-shaped amplitude envelope starts/ends at exact silence with zero
    // slope. Audio-clock automation keeps the notes smooth even at low FPS.
    const pulseEnvelope = Float32Array.from({ length: 129 }, (_, i) => .16 * Math.pow(Math.sin(Math.PI * i / 128), 2));
    pulseEnvelope[0] = pulseEnvelope[128] = 0;

    const dbToGain = db => Math.pow(10, db / 20);
    const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

    const frequencyForLength = length => {
      const maxLength = Math.max(180, Math.hypot(width, height) * .82);
      const normalized = Math.max(0, Math.min(1, (length - 28) / (maxLength - 28)));
      return minFrequency + (maxFrequency - minFrequency) * Math.pow(normalized, .82);
    };

    const ensureAudio = () => {
      try {
      if (!audio) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return false;
        audio = new AudioCtor();
        master = audio.createGain();
        compressor = audio.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 18;
        compressor.ratio.value = 4;
        compressor.attack.value = .01;
        compressor.release.value = .3;
        master.gain.value = dbToGain(masterDb);
        master.connect(compressor).connect(audio.destination);
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      return true;
      } catch (_) {
        audio = null;
        master = null;
        compressor = null;
        return false;
      }
    };

    const makeVoice = length => {
      if (!ensureAudio()) return null;
      const now = audio.currentTime;
      const frequency = frequencyForLength(length);
      const gain = audio.createGain();
      const overtoneGain = audio.createGain();
      const filter = audio.createBiquadFilter();
      const tone = audio.createOscillator();
      const shimmer = audio.createOscillator();
      tone.type = 'sine';
      // A near-pure sine hum: a very faint, exact octave, without beating.
      shimmer.type = 'sine';
      overtoneGain.gain.value = .025;
      filter.type = 'lowpass';
      filter.frequency.value = Math.min(1200, frequency * 1.7);
      filter.Q.value = .35;
      tone.frequency.value = frequency;
      shimmer.frequency.value = frequency * 2;
      gain.gain.setValueAtTime(0, now);
      tone.connect(gain);
      shimmer.connect(overtoneGain).connect(gain);
      gain.connect(filter).connect(master);
      tone.start();
      shimmer.start();
      return { tone, shimmer, gain, overtoneGain, filter, frequency, stopped: false,
        enabled: false, nextPulse: Infinity, interval: 2.2 + (pulseSerial++ % 4) * .14 };
    };

    const updateVoice = (voice, length) => {
      if (!voice || voice.stopped || !audio) return;
      const frequency = frequencyForLength(length);
      const now = audio.currentTime;
      voice.frequency = frequency;
      voice.tone.frequency.cancelScheduledValues(now);
      voice.shimmer.frequency.cancelScheduledValues(now);
      voice.tone.frequency.setValueAtTime(voice.tone.frequency.value, now);
      voice.shimmer.frequency.setValueAtTime(voice.shimmer.frequency.value, now);
      voice.tone.frequency.linearRampToValueAtTime(frequency, now + .12);
      voice.shimmer.frequency.linearRampToValueAtTime(frequency * 2, now + .12);
      voice.filter.frequency.setTargetAtTime(Math.min(1200, frequency * 1.7), now, .06);
    };

    const schedulePulses = () => {
      if (!audio || audio.state !== 'running' || document.hidden) return;
      const now = audio.currentTime;
      for (const string of strings) {
        const voice = string.voice;
        if (!voice || voice.stopped || !voice.enabled) continue;
        // Skip missed notes after a stall, never bunch them into a catch-up burst.
        if (voice.nextPulse < now) voice.nextPulse = now + .03;
        if (voice.nextPulse <= now + .12) {
          voice.gain.gain.setValueCurveAtTime(pulseEnvelope, voice.nextPulse, pulseDuration);
          voice.nextPulse += voice.interval;
        }
      }
    };

    const balanceVoices = () => {
      if (!audio || !master) return;
      const count = strings.filter(string => string.voice?.enabled && !string.voice.stopped).length;
      const level = count ? dbToGain(masterDb) / Math.sqrt(count) : 0;
      master.gain.setTargetAtTime(level, audio.currentTime, .06);
    };

    const stopVoice = voice => {
      if (!voice || voice.stopped || !audio) return;
      voice.stopped = true;
      const now = audio.currentTime;
      if (voice.gain.gain.cancelAndHoldAtTime) voice.gain.gain.cancelAndHoldAtTime(now);
      else {
        const level = voice.gain.gain.value;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(level, now);
      }
      voice.gain.gain.linearRampToValueAtTime(0, now + .12);
      voice.tone.stop(now + .4);
      voice.shimmer.stop(now + .4);
      setTimeout(() => {
        for (const node of [voice.tone, voice.shimmer, voice.overtoneGain, voice.gain, voice.filter]) {
          try { node.disconnect(); } catch (_) {}
        }
      }, 480);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawBackground = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    };

    const stringPoint = (string, progress, time, phaseOffset = 0) => {
      const dx = string.end.x - string.start.x;
      const dy = string.end.y - string.start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const normalX = -dy / length;
      const normalY = dx / length;
      const envelope = Math.sin(progress * Math.PI);
      const cycles = 1.05 + Math.min(.65, length / 650) + phaseOffset * .12;
      const amplitude = Math.min(waveHeight * 1.15, waveHeight * (.5 + length / Math.max(width, height) * .5));
      const wave = Math.sin(progress * Math.PI * 2 * cycles - time * (.75 + string.speed * .35) + string.phase + phaseOffset) * amplitude * envelope;
      return {
        x: string.start.x + dx * progress + normalX * wave,
        y: string.start.y + dy * progress + normalY * wave
      };
    };

    const strokeWave = (string, time, phaseOffset, color, widthValue, glow = 0) => {
      ctx.beginPath();
      const first = stringPoint(string, 0, time, phaseOffset);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i <= 72; i++) {
        const point = stringPoint(string, i / 72, time, phaseOffset);
        ctx.lineTo(point.x, point.y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = widthValue;
      ctx.shadowBlur = glow;
      ctx.shadowColor = color;
      ctx.stroke();
    };

    const drawString = (string, time, active = false) => {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const alpha = active ? 1 : .95;
      // Four fine, separate curves, all converging exactly at both endpoints.
      // No thick glowing backing ribbons or stacked near-identical strands.
      const strands = [
        { phase: -.7, color: palette.accent, opacity: .98 },
        { phase: -.15, color: palette.light, opacity: .82 },
        { phase: .55, color: palette.main, opacity: .9 },
        { phase: 1.3, color: palette.accent, opacity: .92 }
      ];
      // A pair of translucent membranes follows the actual strand boundaries.
      // Crossings naturally form small filled lenses, with open gaps elsewhere.
      for (const [first, second] of [[0, 1], [2, 3]]) {
        ctx.beginPath();
        for (let i = 0; i <= 72; i++) {
          const point = stringPoint(string, i / 72, time, strands[first].phase);
          if (i === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        }
        for (let i = 72; i >= 0; i--) {
          const point = stringPoint(string, i / 72, time, strands[second].phase);
          ctx.lineTo(point.x, point.y);
        }
        ctx.closePath();
        ctx.shadowBlur = 0;
        ctx.fillStyle = rgba(palette.main, .22 * alpha);
        ctx.fill();
      }
      strands.forEach(strand => {
        strokeWave(string, time, strand.phase, rgba(strand.color, strand.opacity * alpha), .8, 0);
      });
      ctx.restore();
    };

    const frame = now => {
      const time = reducedMotion ? 0 : now / 1000;
      const dt = Math.min(.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBackground();
      if (!window.PlayableIdlePreview.preview) schedulePulses();
      if (window.PlayableIdlePreview.active) {
        const t=window.PlayableIdlePreview.seconds;
        const demos=[{start:{x:width*.18,y:height*.39},end:{x:width*.80,y:height*.53},speed:1.1,phase:0,drift:.1},{start:{x:width*.22,y:height*.59},end:{x:width*.76,y:height*.42},speed:.9,phase:1.4,drift:.1}];
        demos.forEach((line,index)=>{ctx.save();ctx.globalAlpha=Math.min(1,Math.max(.2,(t-index*.4)*1.5));drawString(line,t,false);ctx.restore();});
        window.PlayableIdlePreview.stamp(canvas,'silent-wave-strings');
      }
      for (const string of strings) {
        if (!reducedMotion) string.phase += dt * string.drift;
        drawString(string, time, false);
      }
      if (draft) drawString(draft, time, true);
      requestAnimationFrame(frame);
    };

    const pointFromEvent = event => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(18, Math.min(width - 18, event.clientX - rect.left)),
        y: Math.max(95, Math.min(height - 130, event.clientY - rect.top))
      };
    };

    canvas.addEventListener('pointerdown', event => {
      if (event.isPrimary === false || (event.button !== undefined && event.button !== 0) || draft && draft.pointerId !== null) return;
      event.preventDefault();
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      const point = pointFromEvent(event);
      if (draft) {
        draft.pointerId = event.pointerId;
        draft.end = point;
        return;
      }
      draft = {
        pointerId: event.pointerId,
        start: point,
        end: { ...point },
        phase: Math.random() * Math.PI * 2,
        speed: .35 + Math.random() * .45,
        drift: .14 + Math.random() * .18,
        voice: makeVoice(1)
      };
      balanceVoices();
      prompt.classList.add('hidden');
      prompt.setAttribute('aria-hidden', 'true');
    });

    canvas.addEventListener('pointermove', event => {
      if (!draft || event.isPrimary === false || draft.pointerId !== null && event.pointerId !== draft.pointerId) return;
      event.preventDefault();
      draft.end = pointFromEvent(event);
      const length = distance(draft.start, draft.end);
      updateVoice(draft.voice, length);
    });

    const finishDraft = (event, cancelled = false) => {
      if (!draft || event.pointerId !== draft.pointerId) return;
      if (!cancelled && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) draft.end = pointFromEvent(event);
      const finished = draft;
      const length = distance(finished.start, finished.end);
      if (!cancelled && length < 34 && event.pointerId !== 'keyboard') {
        finished.pointerId = null;
        try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch (_) {}
        return;
      }
      draft = null;
      try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch (_) {}
      if (cancelled || length < 34) {
        stopVoice(finished.voice);
        balanceVoices();
        if (!strings.length) { prompt.classList.remove('hidden'); prompt.removeAttribute('aria-hidden'); }
        return;
      }
      strings.push(finished);
      while (strings.length > maxStrings) {
        const removed = strings.shift();
        stopVoice(removed.voice);
      }
      updateVoice(finished.voice, length);
      if (finished.voice && audio) {
        finished.voice.enabled = true;
        finished.voice.nextPulse = audio.currentTime + .03;
      }
      balanceVoices();
      schedulePulses();
      if (navigator.vibrate) navigator.vibrate(14);
    };

    canvas.addEventListener('pointerup', event => finishDraft(event, false));
    canvas.addEventListener('pointercancel', event => finishDraft(event, true));
    canvas.addEventListener('lostpointercapture', event => {
      if (draft && event.pointerId === draft.pointerId) draft.pointerId = null;
    });

    const clearStrings = () => {
      if (draft) {
        const pointer = draft.pointerId;
        stopVoice(draft.voice); draft = null;
        try { if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer); } catch (_) {}
      }
      strings.forEach(string => stopVoice(string.voice));
      strings = [];
      balanceVoices();
      prompt.classList.remove('hidden');
      prompt.removeAttribute('aria-hidden');
      if (navigator.vibrate) navigator.vibrate(10);
    };

    clearButton.addEventListener('click', event => {
      event.stopPropagation();
      clearStrings();
    });

    palettes.forEach(item => {
      document.getElementById('wave-' + item.id).addEventListener('click', event => {
        event.stopPropagation();
        palette = item;
        palettes.forEach(option => document.getElementById('wave-' + option.id).setAttribute('aria-pressed', String(option === item)));
      });
    });

    // Keyboard alternative uses the same drawing, pitch, clear and cancel path.
    canvas.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (draft?.pointerId === 'keyboard') finishDraft({ pointerId: 'keyboard' });
        else if (!draft) {
          const point = { x: width * .35, y: height * .5 };
          draft = { pointerId: 'keyboard', start: point, end: { x: point.x + 80, y: point.y }, phase: 0, speed: .5, drift: .2, voice: makeVoice(80) };
          balanceVoices();
          prompt.classList.add('hidden'); prompt.setAttribute('aria-hidden', 'true');
        }
      } else if (event.key === 'Escape' && draft) {
        event.preventDefault(); finishDraft({ pointerId: draft.pointerId }, true);
      } else if (draft?.pointerId === 'keyboard' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 40 : 12;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        draft.end.x = Math.max(18, Math.min(width - 18, draft.end.x + dx));
        draft.end.y = Math.max(95, Math.min(height - 130, draft.end.y + dy));
        updateVoice(draft.voice, distance(draft.start, draft.end));
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && draft) finishDraft({ pointerId: draft.pointerId }, true);
      if (!audio) return;
      if (document.hidden) {
        audio.suspend().catch(() => {});
      } else if (strings.length || draft) audio.resume().catch(() => {});
    });

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  };

  start();
})();
