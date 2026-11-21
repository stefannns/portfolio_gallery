document.documentElement.lang = 'it';
// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [
    {
      "id": "GRAVITY",
      "kind": "number",
      "label": "Gravità",
      "value": 0.0015,
      "default": 0.0015,
      "min": 0.0005,
      "max": 0.005,
      "step": 0.0001
    },
    {
      "id": "PARTICLE_COUNT",
      "kind": "number",
      "label": "Particelle dell’esplosione",
      "value": 90,
      "default": 90,
      "min": 40,
      "max": 180,
      "step": 5
    },
    {
      "id": "LAUNCH_SPEED",
      "kind": "number",
      "label": "Velocità di lancio",
      "value": 1.2,
      "default": 1.2,
      "min": 0.5,
      "max": 2.5,
      "step": 0.1
    },
    {
      "id": "EXPLOSION_FORCE",
      "kind": "number",
      "label": "Forza dell’esplosione",
      "value": 0.4,
      "default": 0.4,
      "min": 0.1,
      "max": 1,
      "step": 0.05
    }
  ],
  "texts": [
    {
      "id": "TITLE",
      "label": "Collina stellata",
      "value": "Collina stellata",
      "default": "Collina stellata",
      "max_length": 30
    },
    {
      "id": "DESC",
      "label": "Scorri verso l’alto e rilascia per lanciare un fuoco d’artificio nel cielo notturno.",
      "value": "Scorri verso l’alto e rilascia per lanciare un fuoco d’artificio nel cielo notturno.",
      "default": "Scorri verso l’alto e rilascia per lanciare un fuoco d’artificio nel cielo notturno.",
      "max_length": 150
    }
  ],
  "images": [
    {
      "id": "BG_IMAGE",
      "label": "Cielo notturno stellato fotografico",
      "path": "./assets/art-v4/starry-night-sky-v2.webp",
      "replaceable": true
    }
  ],
  "config_version": "2.0",
  "playable": {
    "post_id": "99279183230167264",
    "version_id": "99279183230149284",
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "it",
    "min_capability_level": 1,
    "full_capability_level": 1,
    "title": "Collina stellata"
  }
};
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .firework-guide{position:fixed!important;top:30%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
// Preserve the original fallback when the configuration cannot be fetched.
for (const value of ['playable-inline-config', 'playable-config-inline']) {
  const node = document.createElement('script');
  node.id = value;
  node.type = 'application/json';
  node.textContent = JSON.stringify(DEFAULT_CONFIG);
  document.body.append(node);
}
document.documentElement.lang = 'it';
// Launches rise from the lower open sky; no landscape layers cover the canvas.
const FIREWORK_LAUNCH_Y=.92;
const fireworkGlowCache=new Map();
function fireworkGlow(color){
  let sprite=fireworkGlowCache.get(color);if(sprite)return sprite;
  sprite=document.createElement('canvas');sprite.width=sprite.height=48;
  const ctx=sprite.getContext('2d'),glow=ctx.createRadialGradient(24,24,0,24,24,24);
  glow.addColorStop(0,'#fff9e7');glow.addColorStop(.1,color);glow.addColorStop(.28,color+'b0');glow.addColorStop(.62,color+'38');glow.addColorStop(1,color+'00');
  ctx.fillStyle=glow;ctx.fillRect(0,0,48,48);fireworkGlowCache.set(color,sprite);return sprite;
}
const fireworkIgnitionCache=new Map(),fireworkStreakCache=new Map(),fireworkCoreCache=new Map();
function fireworkIgnition(color){
 let sprite=fireworkIgnitionCache.get(color);if(sprite)return sprite;
 sprite=document.createElement('canvas');sprite.width=sprite.height=96;
 const ctx=sprite.getContext('2d'),glow=ctx.createRadialGradient(48,48,0,48,48,48);
 glow.addColorStop(0,'#fff8df');glow.addColorStop(.22,color);glow.addColorStop(1,color+'00');
 ctx.fillStyle=glow;ctx.fillRect(0,0,96,96);fireworkIgnitionCache.set(color,sprite);return sprite;
}
function fireworkCore(color){
 let sprite=fireworkCoreCache.get(color);if(sprite)return sprite;
 sprite=document.createElement('canvas');sprite.width=sprite.height=32;
 const ctx=sprite.getContext('2d');ctx.fillStyle=color;ctx.beginPath();ctx.arc(16,16,15,0,Math.PI*2);ctx.fill();
 fireworkCoreCache.set(color,sprite);return sprite;
}
function fireworkStreak(color){
 let sprite=fireworkStreakCache.get(color);if(sprite)return sprite;
 sprite=document.createElement('canvas');sprite.width=256;sprite.height=64;
 const ctx=sprite.getContext('2d');ctx.strokeStyle=color;ctx.lineWidth=3.5;ctx.shadowColor=color;ctx.shadowBlur=20;
 ctx.beginPath();ctx.moveTo(32,32);ctx.lineTo(224,32);ctx.stroke();
 fireworkStreakCache.set(color,sprite);return sprite;
}
// Fixed ring storage avoids array shifts/objects. Particle motion is unchanged.
function appendFireworkTrail(particle){
 const offset=particle.trailHead*3;
 particle.trail[offset]=particle.x;particle.trail[offset+1]=particle.y;particle.trail[offset+2]=particle.age;
 particle.trailHead=(particle.trailHead+1)%particle.trailLength;
 particle.trailCount=Math.min(particle.trailCount+1,particle.trailLength);
}
function traceFireworkTrail(context,particle,width,height){
 const count=particle.trailCount;if(!count)return;
 const first=(particle.trailHead-count+particle.trailLength)%particle.trailLength*3;
 const fx=particle.trail[first],fy=particle.trail[first+1];
 context.beginPath();context.moveTo(fx*width,fy*height);
 if(count<2){context.lineTo(particle.x*width,particle.y*height);return;}
 const middle=((first/3+Math.floor(count/2))%particle.trailLength)*3;
 const elapsed=particle.age-particle.trail[first+2];
 const t=elapsed>0?(particle.trail[middle+2]-particle.trail[first+2])/elapsed:0;
 const one=1-t,denominator=2*one*t;
 if(denominator<.001){context.lineTo(particle.x*width,particle.y*height);return;}
 const cx=(particle.trail[middle]-one*one*fx-t*t*particle.x)/denominator;
 const cy=(particle.trail[middle+1]-one*one*fy-t*t*particle.y)/denominator;
 context.quadraticCurveTo(cx*width,cy*height,particle.x*width,particle.y*height);
}

function App() {
  const createElement = React.createElement;
  const [config, setConfig] = React.useState({});
  const [count, setCount] = React.useState(0);
  const [hint, setHint] = React.useState(true);
  const [aiming, setAiming] = React.useState(false);
  const canvas = React.useRef(null);
  const wakeDraw=React.useRef(()=>{});
  const drawActive=React.useRef(!(new URLSearchParams(location.search).get('feedReview')==='1'&&window.parent!==window));
  const start = React.useRef(null);
  const stateRef = React.useRef(null);
  const rockets = React.useRef([]);
  const bursts = React.useRef([]);
  const frame = React.useRef(0);
  const lastTick = React.useRef(0);
  const audio = React.useRef(null);
  const risingVoices = React.useRef(0);
  const lastBurst = React.useRef(-1);
  const sampleAudio = React.useRef({
    buffers: null,
    promise: null,
    voices: new Set(),
    master: null,
    limiter: null,
    closed: false
  });
  const makeParticles = (x, y, color, style, size, rect) => {
    const baseCount = Math.max(48, Math.min(180, Number(config.PARTICLE_COUNT) || 90));
    const value = Math.min(200, Math.round(baseCount * Math.sqrt(size) * 1.25));
    const force = Math.max(1, Math.min(1.35, 1 + (Number(config.EXPLOSION_FORCE) || 0.4) * 0.35));
    const speed = Math.min(rect.width, rect.height) / 120 * size * force * 1.25;
    const particles = [];
    for (let value2 = 0; value2 < value; value2++) {
      const theta = value2 / value * Math.PI * 2 - Math.PI / 2;
      let value3 = Math.cos(theta);
      let value4 = Math.sin(theta);
      // A full outer crown with an inner ring keeps every style substantial.
      let spread = style === "ring" ? (value2 % 4 === 0 ? 0.78 : 1) : Math.sqrt(0.24 + Math.random() * 0.76);
      if (style === "star") {
        const edge = value2 / value * 10;
        const value5 = Math.floor(edge);
        const value6 = edge - value5;
        const angle = value5 * Math.PI / 5 - Math.PI / 2;
        const next = angle + Math.PI / 5;
        const value7 = value5 % 2 ? 0.43 : 1;
        const rNext = value5 % 2 ? 1 : 0.43;
        value3 = Math.cos(angle) * value7 * (1 - value6) + Math.cos(next) * rNext * value6;
        value4 = Math.sin(angle) * value7 * (1 - value6) + Math.sin(next) * rNext * value6;
        spread = value2 % 5 === 0 ? 0.64 : 1;
      }
      const willow = style === "willow";
      const life = 1 + Math.random() * 0.18;
      const particleColor=willow?["#ffc95e","#ffe6a0","#ffdc79"][value2%3]:value2%5===0?"#fff5da":color;
      const trailLength=willow?20:style==="star"?11:14;
      particles.push({
        x,
        y,
        vx: value3 * speed * spread / rect.width,
        vy: value4 * speed * spread / rect.height,
        life,
        color:particleColor,
        sprite:fireworkGlow(particleColor),
        drag: willow ? 0.982 : 0.985,
        gravity: (willow ? 0.065 : 0.025) / rect.height,
        lifeScale: willow ? 2.35 : 1.2,
        trail:new Float64Array(trailLength*3),trailLength,trailHead:0,trailCount:0,age:0,
        size
      });
    }
    // All rendering is additive: color grouping preserves the image while
    // avoiding redundant strokeStyle changes for every sparkle.
    particles.sort((a,b)=>a.color<b.color?-1:a.color>b.color?1:0);
    return particles;
  };
  const getAudio = (unlock = false) => {
    try {
      if (sampleAudio.current.closed) return null;
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return null;
      const value = audio.current || (audio.current = new Audio());
      if (value.state === "closed") return null;
      if (unlock && value.state === "suspended") Promise.resolve(value.resume()).catch(() => {});
      return value;
    } catch {
      return null;
    }
  };
  const prepareAudio = (unlock = false) => {
    const audio2 = getAudio(unlock);
    const state = sampleAudio.current;
    const data = {
      rise: "./assets/firework-rise.mp3",
      burst: "./assets/firework-burst.mp3"
    };
    if (!audio2 || state.closed || !data?.rise || !data?.burst || typeof audio2.decodeAudioData !== "function") return Promise.resolve(null);
    if (state.buffers) return Promise.resolve(state.buffers);
    if (state.promise) return state.promise;
    const decode = async path => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Could not load firework sound');
      return audio2.decodeAudioData(await response.arrayBuffer());
    };
    state.promise = Promise.all([decode(data.rise), decode(data.burst)]).then(([rise, burst]) => {
      if (state.closed || audio.current !== audio2) return null;
      state.buffers = {
        rise,
        burst
      };
      state.promise = null;
      return state.buffers;
    }).catch(() => {
      if (!state.closed && audio.current === audio2) state.promise = null;
      return null;
    });
    return state.promise;
  };
  const playSample = (kind, duration) => {
    const audio2 = getAudio();
    const state = sampleAudio.current;
    const buffer = state.buffers?.[kind];
    if (!audio2 || audio2.state !== "running" || !buffer || state.closed) return false;
    if (state.voices.size >= 10 || [...state.voices].filter(item => item.kind === kind).length >= (kind === "rise" ? 4 : 6)) return true;
    let source;
    let gain;
    let voice;
    try {
      if (!state.master) {
        const master = audio2.createGain();
        master.gain.value = 0.9;
        state.master = master;
        if (typeof audio2.createDynamicsCompressor === "function") {
          const limiter = audio2.createDynamicsCompressor();
          limiter.threshold.value = -6;
          limiter.knee.value = 6;
          limiter.ratio.value = 6;
          limiter.attack.value = 0.002;
          limiter.release.value = 0.13;
          master.connect(limiter).connect(audio2.destination);
          state.limiter = limiter;
        } else master.connect(audio2.destination);
      }
      const currentTime = audio2.currentTime;
      const length = kind === "rise" ? Math.min(buffer.duration, duration / 1000) : buffer.duration;
      const offset = kind === "rise" ? Math.max(0, buffer.duration - length) : 0;
      source = audio2.createBufferSource();
      gain = audio2.createGain();
      source.buffer = buffer;
      gain.gain.setValueAtTime(kind === "rise" ? 0 : 0.85, currentTime);
      if (kind === "rise") {
        gain.gain.linearRampToValueAtTime(0.65, currentTime + Math.min(0.012, length / 4));
        gain.gain.setValueAtTime(0.65, currentTime + Math.max(0.012, length - 0.025));
        gain.gain.linearRampToValueAtTime(0, currentTime + length);
      }
      source.connect(gain).connect(state.master);
      voice = {
        kind,
        source,
        gain
      };
      state.voices.add(voice);
      source.onended = () => {
        state.voices.delete(voice);
        try {
          source.disconnect();
          gain.disconnect();
        } catch {}
      };
      source.start(currentTime, offset, length);
      source.stop(currentTime + length + 0.01);
      return true;
    } catch {
      if (voice) state.voices.delete(voice);
      try {
        source?.disconnect();
        gain?.disconnect();
      } catch {}
      return false;
    }
  };
  const playSyntheticRise = duration => {
    const audio2 = getAudio();
    if (!audio2 || audio2.state !== "running" || risingVoices.current >= 4) return;
    try {
      const currentTime = audio2.currentTime;
      const length = duration / 1000;
      const oscillator = audio2.createOscillator();
      const gain = audio2.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(340, currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1100, currentTime + length);
      gain.gain.setValueAtTime(0.0001, currentTime);
      gain.gain.linearRampToValueAtTime(0.2, currentTime + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + length);
      oscillator.connect(gain).connect(audio2.destination);
      risingVoices.current++;
      oscillator.onended = () => {
        risingVoices.current = Math.max(0, risingVoices.current - 1);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(currentTime);
      oscillator.stop(currentTime + length + 0.02);
    } catch {}
  };
  const playSyntheticBurst = () => {
    const current = audio.current;
    if (!current || current.state !== "running") return;
    try {
      const currentTime = current.currentTime;
      const length = Math.floor(current.sampleRate * 0.3);
      const buffer = current.createBuffer(1, length, current.sampleRate);
      const data = buffer.getChannelData(0);
      for (let value = 0; value < length; value++) data[value] = (Math.random() * 2 - 1) * Math.pow(1 - value / length, 2);
      const noise = current.createBufferSource();
      const filter = current.createBiquadFilter();
      const gain = current.createGain();
      noise.buffer = buffer;
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2400, currentTime);
      filter.frequency.exponentialRampToValueAtTime(300, currentTime + 0.28);
      gain.gain.setValueAtTime(0.0001, currentTime);
      gain.gain.linearRampToValueAtTime(0.2, currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.29);
      noise.connect(filter).connect(gain).connect(current.destination);
      noise.onended = () => {
        noise.disconnect();
        filter.disconnect();
        gain.disconnect();
      };
      noise.start(currentTime);
      noise.stop(currentTime + 0.3);
      const thump = current.createOscillator();
      const thumpGain = current.createGain();
      thump.type = "sine";
      thump.frequency.setValueAtTime(170, currentTime);
      thump.frequency.exponentialRampToValueAtTime(65, currentTime + 0.18);
      thumpGain.gain.setValueAtTime(0.08, currentTime);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.18);
      thump.connect(thumpGain).connect(current.destination);
      thump.onended = () => {
        thump.disconnect();
        thumpGain.disconnect();
      };
      thump.start(currentTime);
      thump.stop(currentTime + 0.19);
    } catch {}
  };
  const playRise = duration => {
    if (!playSample("rise", duration)) playSyntheticRise(duration);
  };
  const playBurst = () => {
    const current = audio.current;
    if (!current || current.state !== "running" || current.currentTime - lastBurst.current < 0.07) return;
    lastBurst.current = current.currentTime;
    if (!playSample("burst")) playSyntheticBurst();
  };
  React.useEffect(() => {
    fetch("./game.config.json", {
      cache: "no-store"
    }).then(response => response.json()).then(data => {
      const options = {};
      for (const value of ["texts", "images", "tweaks"]) for (const item of data[value] || []) options[item.id] = item.value ?? item.path;
      setConfig(options);
    }).catch(() => {});
  }, []);
  React.useEffect(() => {
    let alive = true;
    drawActive.current=!document.documentElement.hasAttribute('data-batch3-preview');
    sampleAudio.current.closed = false;
    prepareAudio();
    const element=canvas.current;if(!element)return;
    const context=element.getContext('2d');if(!context)return;
    let width=0,height=0,pixelRatio=1,nextDraw=0;
    const draw = value => {
      frame.current=0;if(!alive||!drawActive.current||document.hidden||!width||!height)return;
      // ProMotion/high-refresh displays do not need twice as many blur passes.
      if(lastTick.current&&value+.5<nextDraw){requestDraw();return;}
      nextDraw=nextDraw&&value-nextDraw<50?nextDraw+1000/60:value+1000/60;
      context.setTransform(pixelRatio,0,0,pixelRatio,0,0);
      context.clearRect(0,0,width,height);
      const value3 = Math.min(50, value - (lastTick.current || value));
      lastTick.current = value;
      const guide = stateRef.current;
      if (guide && guide.a.y - guide.b.y > 0.015) {
        const value4 = guide.a.x * width;
        const value5 = FIREWORK_LAUNCH_Y * height;
        const value6 = Math.max(0.1, Math.min(0.9, guide.b.x)) * width;
        const value7 = Math.max(0.13, Math.min(0.68, guide.b.y)) * height;
        const valid = guide.a.y - guide.b.y >= 0.07;
        context.save();
        context.strokeStyle = valid ? "#fff6bb" : "#ffffff99";
        context.fillStyle = valid ? "#fff6bb" : "#ffffff99";
        context.lineWidth = 2.5;
        context.setLineDash([6, 9]);
        context.shadowColor = "#ffe88d";
        context.shadowBlur = 12;
        context.beginPath();
        context.moveTo(value4, value5);
        context.lineTo(value6, value7);
        context.stroke();
        context.setLineDash([]);
        context.beginPath();
        context.arc(value4, value5, 5, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.arc(value6, value7, 13, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.arc(value6, value7, 3.5, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
      context.save();
      context.globalCompositeOperation = "lighter";context.shadowBlur=0;
      const particleCore=fireworkCore('#fff9e7'),rocketCore=fireworkCore('#fff');
      for (let value4 = rockets.current.length - 1; value4 >= 0; value4--) {
        const item = rockets.current[value4];
        item.t = Math.min(1, item.t + value3 / item.duration);
        const trailTime = Math.max(0, item.t - 0.12);
        const value6 = (item.x0 + (item.x1 - item.x0) * trailTime) * width;
        const value7 = (item.y0 + (item.y1 - item.y0) * trailTime) * height;
        const x = (item.x0 + (item.x1 - item.x0) * item.t) * width;
        const y = (item.y0 + (item.y1 - item.y0) * item.t) * height;
        const dx=x-value6,dy=y-value7,length=Math.hypot(dx,dy),streak=fireworkStreak(item.color);
        if(length>.01){
          context.save();context.translate(value6,value7);context.rotate(Math.atan2(dy,dx));
          context.drawImage(streak,0,0,32,64,-32,-32,32,64);
          context.drawImage(streak,96,0,64,64,0,-32,length,64);
          context.drawImage(streak,224,0,32,64,length,-32,32,64);context.restore();
        }
        context.drawImage(rocketCore,x-3.7333,y-3.7333,7.4666,7.4666);
        if (item.t >= 1) {
          // Bound density during rapid swipes rather than accumulating effects.
          while (bursts.current.length >= 5 || bursts.current.reduce((total, burst) => total + burst.particles.length, 0) + item.particles.length > 900) bursts.current.shift();
          bursts.current.push({
            particles: item.particles,
            style: item.style,
            size: item.size,
            x: item.x1,
            y: item.y1,
            color: item.color,
            age: 0
          });
          rockets.current.splice(value4, 1);
          playBurst();
        }
      }
      const step = value3 / (1000 / 60);
      const current = bursts.current;
      for (let value4 = current.length - 1; value4 >= 0; value4--) {
        const item = current[value4];
        item.age += value3 / 1000;
        const flash = Math.max(0, 1 - item.age / 0.24);
        if(flash>0){
          const radius=(12+18*item.size)*(1+item.age*2);
          context.globalAlpha=flash*.6;context.drawImage(fireworkIgnition(item.color),item.x*width-radius,item.y*height-radius,radius*2,radius*2);
        }
        const first=item.particles[0],drag=Math.pow(first.drag,step),decay=.012*step/first.lifeScale;
        const rootSize=Math.sqrt(item.size),trailOpacity=item.style==='willow'?.58:.66,glowScale=23*rootSize,coreSize=1.92*rootSize;
        context.lineWidth=1.7*rootSize;let previousColor='',live=0;
        for(let index=0;index<item.particles.length;index++){
          const particle=item.particles[index];if(step>0)appendFireworkTrail(particle);
          particle.x+=particle.vx*step;particle.y+=particle.vy*step;particle.age+=step;
          particle.vx*=drag;particle.vy=particle.vy*drag+particle.gravity*step;particle.life-=decay;
          if(particle.life<=0)continue;
          item.particles[live++]=particle;
          const alpha=Math.min(1,particle.life);
          if(particle.trailCount){
            if(previousColor!==particle.color){context.strokeStyle=particle.color;previousColor=particle.color;}
            context.globalAlpha=alpha*trailOpacity;traceFireworkTrail(context,particle,width,height);context.stroke();
          }
          const glowSize=Math.max(10,particle.life*glowScale),x=particle.x*width,y=particle.y*height;
          context.globalAlpha=alpha;context.drawImage(particle.sprite,x-glowSize/2,y-glowSize/2,glowSize,glowSize);
          if(particle.life>.55){context.globalAlpha=alpha*.85;context.drawImage(particleCore,x-coreSize/2,y-coreSize/2,coreSize,coreSize);}
        }
        item.particles.length=live;
        if (!item.particles.length) current.splice(value4, 1);
      }
      context.restore();
      if(rockets.current.length||bursts.current.length)requestDraw();else{lastTick.current=0;nextDraw=0;}
    };
    function requestDraw(){if(alive&&drawActive.current&&!document.hidden&&!frame.current)frame.current=requestAnimationFrame(draw);}
    function syncDrawState(){
      cancelAnimationFrame(frame.current);frame.current=0;lastTick.current=0;nextDraw=0;
      if(drawActive.current&&!document.hidden){audio.current?.resume().catch(()=>{});requestDraw();}
      else{start.current=null;stateRef.current=null;setAiming(false);audio.current?.suspend().catch(()=>{});}
    }
    function hostMessage(event){if(event.source===parent&&event.data?.type==='playable-active'){drawActive.current=event.data.active===true;syncDrawState();}}
    window.addEventListener('message',hostMessage);document.addEventListener('visibilitychange',syncDrawState);
    function resize(){
      const rect=element.getBoundingClientRect();width=rect.width;height=rect.height;
      pixelRatio=Math.min(window.devicePixelRatio||1,1.5);
      const w=Math.max(1,Math.round(width*pixelRatio)),h=Math.max(1,Math.round(height*pixelRatio));
      if(element.width!==w||element.height!==h){element.width=w;element.height=h;}
      lastTick.current=0;nextDraw=0;requestDraw();
    }
    wakeDraw.current=requestDraw;
    const resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;
    resizeObserver?.observe(element);window.addEventListener('resize',resize);resize();
    return () => {
      alive = false;wakeDraw.current=()=>{};resizeObserver?.disconnect();window.removeEventListener('resize',resize);
      window.removeEventListener('message',hostMessage);document.removeEventListener('visibilitychange',syncDrawState);
      cancelAnimationFrame(frame.current);frame.current=0;
      const state = sampleAudio.current;
      state.closed = true;
      for (const voice of [...state.voices]) {
        try {
          voice.source.stop();
          voice.source.disconnect();
          voice.gain.disconnect();
        } catch {}
      }
      state.voices.clear();
      try {
        state.master?.disconnect();
        state.limiter?.disconnect();
      } catch {}
      state.master = null;
      state.limiter = null;
      state.buffers = null;
      state.promise = null;
      risingVoices.current = 0;
      if (audio.current) {
        Promise.resolve(audio.current.close()).catch(() => {});
        audio.current = null;
      }
    };
  }, []);
  const point = event => {
    const dimensions = canvas.current.getBoundingClientRect();
    return {
      x: (event.clientX - dimensions.left) / dimensions.width,
      y: (event.clientY - dimensions.top) / dimensions.height
    };
  };
  const down = event => {
    if(!drawActive.current||document.hidden||event.isPrimary===false||event.button>0)return;
    prepareAudio(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    const value = point(event);
    start.current = {
      ...value,
      id: event.pointerId
    };
    stateRef.current = {
      a: value,
      b: value
    };
    setAiming(true);wakeDraw.current();
  };
  const move = event => {
    if(start.current?.id!==event.pointerId)return;
    stateRef.current={a:start.current,b:point(event)};wakeDraw.current();
  };
  const cancel = event => {
    if (start.current?.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    start.current = null;
    stateRef.current = null;
    setAiming(false);wakeDraw.current();
  };
  const onPointerUp = event => {
    if (start.current?.id !== event.pointerId) return;
    const point2 = start.current;
    const point3 = point(event);
    cancel(event);
    const rise = point2.y - point3.y;
    if (rise < 0.07) return;
    const x = Math.max(0.1, Math.min(0.9, point3.x));
    const y = Math.max(0.13, Math.min(0.68, point3.y));
    const colors = ["#fc70d2", "#fff392", "#8feeff", "#d2a2ff", "#90ffbb"];
    const color = colors[count % colors.length];
    const style = ["peony", "ring", "willow", "star"][count % 4];
    const size = [0.9, 1.1, 1.3][count % 3];
    const rect = canvas.current.getBoundingClientRect();
    const particles = makeParticles(x, y, color, style, size, rect);
    const distance = Math.hypot((x - point2.x) * rect.width, (y - FIREWORK_LAUNCH_Y) * rect.height);
    const duration = Math.max(350, Math.min(1100, distance / (Number(config.LAUNCH_SPEED) || 1.2)));
    if (rockets.current.length >= 6) rockets.current.shift();
    rockets.current.push({
      x0: point2.x,
      y0: FIREWORK_LAUNCH_Y,
      x1: x,
      y1: y,
      t: 0,
      duration,
      color,
      particles,
      style,
      size
    });
    playRise(duration);wakeDraw.current();
    setCount(value => value + 1);
    setHint(false);
    if (navigator.vibrate) navigator.vibrate(12);
  };
  return <div style={{
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    boxSizing: "border-box",
    background: `#080d2c url(${config.BG_IMAGE || "./assets/art-v4/starry-night-sky-v2.webp"}) center/cover`,
    color: "white",
    touchAction: "none",
    userSelect: "none",
    fontFamily: "system-ui,sans-serif"
  }}>{<canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={onPointerUp} onPointerCancel={cancel} style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      zIndex: 1,
      touchAction: "none"
    }} aria-label={"Trascina verso l’alto per vedere la traiettoria, poi rilascia per lanciare i fuochi"} />}{<div className={"firework-guide"} style={{
      position: "absolute",
      bottom: "calc(50 * min(.2564102564vw,.1672240803vh) + env(safe-area-inset-bottom, 0px))",
      left: "calc(30 * min(.2564102564vw,.1672240803vh) + env(safe-area-inset-left, 0px))",
      right: "calc(30 * min(.2564102564vw,.1672240803vh) + env(safe-area-inset-right, 0px))",
      padding: "12px",
      boxSizing: "border-box",
      borderRadius: 24,
      background: "#0a1319eb",
      border: "1px solid #eee4",
      textAlign: "center",
      lineHeight: 1.4,
      fontSize: "calc(18 * min(.2564102564vw,.1672240803vh))",
      pointerEvents: "none",
      visibility: hint || aiming ? "visible" : "hidden"
    }}>{aiming ? "Rilascia per lanciare" : "Trascina in su per vedere la traiettoria"}</div>}</div>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": ""
    }
  };
  const selector = script?.getAttribute('data-subject') || '#root canvas';
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let observer;
  let animation;
  let entered = false;
  function stop() {
    animation?.cancel();
    animation = null;
  }
  function enter() {
    if (entered || document.hidden) return;
    const subject = document.querySelector(selector);
    if (!subject || subject.closest('[hidden], [aria-hidden="true"]')) return;
    const computed = window.getComputedStyle(subject);
    if (computed.display === 'none' || computed.visibility === 'hidden') return;
    if (subject.tagName === 'IMG' && !subject.complete) {
      subject.addEventListener('load', enter, {
        once: true
      });
      return;
    }
    entered = true;
    observer?.disconnect();
    if (media?.matches) return;
    const opacity = Number(window.getComputedStyle(subject).opacity) || 1;
    if (typeof subject.animate === 'function') {
      animation = subject.animate([{
        opacity: opacity * 0.76
      }, {
        opacity
      }], {
        duration: 650,
        easing: 'ease-out'
      });
      animation.onfinish = () => {
        animation = null;
      };
    }
  }
  observer = new MutationObserver(enter);
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  enter();
  document.addEventListener('visibilitychange', () => {
    document.documentElement.toggleAttribute('data-feed-background', document.hidden);
    if (document.hidden) stop();else enter();
  });
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    stop();
  });
  window.addEventListener('pageshow', () => {
    if (!entered) observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    enter();
  });
  document.addEventListener('pointerdown', stop, {
    capture: true,
    passive: true
  });
  media?.addEventListener?.('change', () => {
    if (media.matches) stop();
  });
})();

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [".firework-guide"];
  const copy = new Set([].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map();
  let queued = false;
  let visible = true;
  const action = /^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;
  function scan() {
    queued = false;
    for (const [el, a] of running) if (!el.isConnected) {
      a.cancel();
      running.delete(el);
    }
    if (motion.matches) {
      for (const value of running.values()) value.cancel();
      running.clear();
      return;
    }
    const targets = new Set();
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(item => targets.add(item));
      } catch {}
    }
    for (const value of document.querySelectorAll('p,span,div,label,text')) {
      if (value.children.length || value.closest('button,a,input,select,textarea,[role="button"]')) continue;
      const text = (value.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 5 && text.length <= 140 && (copy.has(text.toLowerCase()) || !selectors.length && action.test(text))) targets.add(value);
    }
    for (const value of targets) {
      if (running.has(value) || typeof value.animate !== 'function') continue;
      if ([...targets].some(child => child !== value && value.contains(child))) continue;
      const style = getComputedStyle(value);
      if (/breath/i.test(style.animationName)) continue;
      const base = style.filter.replace(/opacity\([^)]*\)/g, '').replace(/^none$/, '').trim();
      const filter = value3 => (base ? base + ' ' : '') + 'opacity(' + value3 + ')';
      const value2 = value.animate([{
        filter: filter(1)
      }, {
        filter: filter(0.65)
      }, {
        filter: filter(1)
      }], {
        duration: 2400,
        iterations: Infinity,
        easing: 'ease-in-out'
      });
      running.set(value, value2);
      if (document.hidden || !visible) value2.pause();
    }
  }
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  };
  const pause = () => {
    for (const value of running.values()) {
      if (document.hidden || !visible) {
        value.pause();
      } else {
        value.play();
      }
    }
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    visible = entries.some(item => item.isIntersecting);
    pause();
  }) : null;
  if (document.body) intersection?.observe(document.body);else document.addEventListener('DOMContentLoaded', () => intersection?.observe(document.body), {
    once: true
  });
  document.addEventListener('visibilitychange', pause);
  motion.addEventListener?.('change', schedule);
  schedule();
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    intersection?.disconnect();
    for (const value of running.values()) value.cancel();
    running.clear();
  }, {
    once: true
  });
})();

// Game helper

/* Batch 3 entry polish. Preview covers are still images in the feed. */
(() => {
  'use strict';

  const number = Number({
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "",
        "data-batch3-game": "50"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "50"
    }
  }?.dataset.batch3Game);
  const isFeed = new URLSearchParams(location.search).get('feedReview') === '1' && window.parent !== window;
  const root = document.documentElement;
  root.toggleAttribute('data-batch3-preview', isFeed);
  const configurations = {
    12: {
      text: 'Tap to pop the bubbles',
      top: '80px',
      color: '#a2355a',
      action: 'bubble'
    },
    20: {
      text: 'Tap the bug',
      top: '32%',
      color: '#fff',
      action: 'bug'
    },
    27: {
      text: 'Guess their age',
      top: '10.5%',
      color: '#fff',
      action: 'age'
    },
    37: {
      text: 'Tap to add balls',
      top: '24%',
      color: '#fff',
      action: 'add-ball'
    },
    39: {
      text: 'Tap squares to find the animal',
      top: '22%',
      color: '#29202e',
      action: 'cell'
    },
    49: {
      text: 'Guess the hidden code',
      top: '40%',
      color: '#fff',
      action: 'digit'
    },
    60: {
      text: 'Steer into the parking spot',
      top: '34%',
      color: '#fff',
      action: 'drive'
    }
  };
  const previewCSS = {
    8: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    11: 'html[data-batch3-preview] .screen-container div:has(>button.btn-option){transform:translateY(-8vh) scale(.84);transform-origin:center center}',
    13: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    25: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    27: 'html[data-batch3-preview] .age-controls {transform:translateY(-16vh) scale(.9);transform-origin:bottom center}',
    30: 'html[data-batch3-preview] .btn-control {visibility:hidden!important}',
    34: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    37: 'html[data-batch3-preview] #root button {bottom:34%!important}',
    38: 'html[data-batch3-preview] .pendulum-actions {visibility:hidden!important}',
    39: 'html[data-batch3-preview] [aria-label="8 by 8 animal search map"] {transform:scale(.84);transform-origin:center top}',
    43: 'html[data-batch3-preview] .meme-controls {visibility:hidden!important}',
    48: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    49: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    52: 'html[data-batch3-preview] .fate-wheel-wrap {transform:scale(.84)}',
    54: 'html[data-batch3-preview] .control {visibility:hidden!important}',
    56: 'html[data-batch3-preview] .drive-controls {visibility:hidden!important}',
    60: 'html[data-batch3-preview] #root div:has(>div>button[aria-label="Steer left"]) {visibility:hidden!important}',
    73: 'html[data-batch3-preview] #opening .opening-heading p {animation:b3-breathe 2.4s ease-in-out infinite}',
    74: 'html[data-batch3-preview] #photo-controls {visibility:hidden!important}'
  };
  const sharedCSS = `
    .b3-guide{position:fixed;left:30px;right:30px;z-index:120;margin:0;text-align:center;
      font:700 18px/1.3 var(--font-display,system-ui,sans-serif);pointer-events:none;
      text-shadow:0 1px 3px rgba(0,0,0,.25);animation:b3-breathe 2.4s ease-in-out infinite}
    @keyframes b3-breathe{0%,100%{opacity:1}50%{opacity:.68}}
    html[data-b3-hidden] .b3-guide,html[data-b3-hidden] #opening .opening-heading p{animation-play-state:paused!important}
    @media(prefers-reduced-motion:reduce){.b3-guide,html[data-batch3-preview] #opening .opening-heading p{animation:none!important}}
    ${previewCSS[number] || ''}
  `;
  const style = document.createElement('style');
  style.setAttribute('data-batch3-polish', '');
  style.textContent = sharedCSS;
  document.head.append(style);
  let guide;
  let dismissed = false;
  const config = configurations[number];
  function mountGuide() {
    if (!config || guide || dismissed) return;
    guide = document.createElement('p');
    guide.className = 'b3-guide';
    guide.textContent = config.text;
    guide.style.top = config.top;
    guide.style.color = config.color;
    document.body.append(guide);
  }
  function meaningful(event) {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (config?.action === 'bug') return !!target.closest('#root div[tabindex="0"]');
    if (config?.action === 'bubble') {
      if (target.closest('#root div[tabindex="0"],#root canvas')) return true;
      const value = target.closest('button');
      return !!value && /^(Sand Art|Spinner)$/.test(value.textContent.trim());
    }
    if (config?.action === 'age') return !!target.closest('input[type="range"],button.guess');
    const button = target.closest('button');
    if (!button || button.disabled) return false;
    if (config?.action === 'add-ball') return button.textContent.trim() === 'Add Ball';
    if (config?.action === 'cell') return /^Check cell \d+$/.test(button.getAttribute('aria-label') || '');
    if (config?.action === 'digit') return /^\d$/.test(button.textContent.trim());
    if (config?.action === 'drive') return /^(Steer left|Steer right|Drive forward|Reverse)$/.test(button.getAttribute('aria-label') || '');
    return false;
  }
  function dismissOnAction(event) {
    if (root.hasAttribute('data-batch3-preview')) return;
    if (meaningful(event)) {
      dismissed = true;
      guide?.remove();
      guide = null;
    }
  }
  document.addEventListener('pointerdown', dismissOnAction, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') dismissOnAction(event);
  }, true);
  window.addEventListener('message', event => {
    if (!isFeed || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    root.toggleAttribute('data-batch3-preview', event.data.active !== true);
  });
  document.addEventListener('visibilitychange', () => {
    root.toggleAttribute('data-b3-hidden', document.hidden);
  });
  const observer = new MutationObserver(mountGuide);
  const start = () => {
    mountGuide();
    observer.observe(document.getElementById('root') || document.body, {
      childList: true,
      subtree: true
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {
    once: true
  });else start();
  window.addEventListener('pagehide', () => {
    observer.disconnect();
  }, {
    once: true
  });
})();

// Batch 3 UI refinement — 2026-11-16
// Local fonts and explicit per-game layout rules; no gameplay or host mutations.
(() => {
  const uiStyle=document.createElement('style');
  uiStyle.dataset.batch3Ui='20261116';
  uiStyle.textContent="\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}\nhtml,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}\nbutton{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}\nbutton:focus-visible{outline:3px solid currentColor;outline-offset:4px}\nbutton:disabled{opacity:.55}\n[hidden]{display:none!important}\n.guide{font-size:18px;line-height:1.4;text-wrap:balance}\n.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}\n.bottom{bottom:50px;left:30px;right:30px;gap:10px}\n.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}\n.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}\n.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}\n.modal{padding:30px 30px 50px}\n.result{max-height:100%;overflow-y:auto;padding:28px 22px}\n.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}\n.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}\n.result .value{line-height:1.2;overflow-wrap:anywhere}\n.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}\n\n@font-face{font-family:PaperType;src:url('./assets/ui/SpecialElite-Regular.ttf') format('truetype');font-display:swap}\nhtml,body,#root{font-family:PaperType,Georgia,serif}\n.firework-guide{font-family:PaperType,Georgia,serif!important;font-size:18px!important;font-weight:400;line-height:1.4!important;background:#10162bc9!important;border:1px solid #f2eddf42!important;padding:10px 16px!important;text-wrap:balance}\n";
  document.head.append(uiStyle);
})();


/*
Bundled font/asset license notices (source-only; runtime TXT files omitted).

Files: firework-audio.LICENSE.txt
Whistle and Explosion Single_Firework
Creator: Rudmer_Rotteveel
Source: https://freesound.org/people/Rudmer_Rotteveel/sounds/336008/
License: Creative Commons Zero (CC0 1.0)
License URL: https://creativecommons.org/publicdomain/zero/1.0/

Derived from the author's publicly accessible HQ MP3 preview:
https://cdn.freesound.org/previews/336/336008_4921277-hq.mp3
The original login-gated WAV was not used.

The whistle excerpt (0.000-1.135 s) is filtered, amplified, faded and encoded
as 44.1 kHz mono 64 kbps MP3. The blast excerpt (1.160-2.240 s) is attenuated,
faded and encoded as 44.1 kHz mono 96 kbps MP3. Both excerpts are embedded in
firework-audio.js for offline/direct-file loading without audio fetch requests.
Playback uses a shortened whistle excerpt for short launches and starts the
blast independently when the visual firework bursts. Attribution is retained
for provenance although CC0 does not require it.



*/
