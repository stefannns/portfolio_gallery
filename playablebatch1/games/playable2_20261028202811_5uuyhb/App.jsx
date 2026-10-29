import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';

// This bridge belongs to the game; it does not reproduce host UI or gradients.
const feedSession = (() => {
  const embedded = window.parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !embedded;
  const listeners = new Set();
  const update = () => {
    document.documentElement.dataset.feedPreview = String(!active);
    for (const callback of listeners) callback(active && !document.hidden);
  };
  window.addEventListener('message', event => {
    if (!embedded || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
    update();
  });
  document.addEventListener('visibilitychange', update);
  update();
  return {get active() { return active && !document.hidden; }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }};
})();
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

function useFeedActive() {
  const [active, setActive] = React.useState(feedSession.active);
  React.useEffect(() => feedSession.subscribe(setActive), []);
  return active;
}

function BatchPolish() {
  const active = useFeedActive();
  return <>
    <style>{POLISH_CSS}</style>
    {!active && [80,81,84].includes(GAME_NUMBER) && <div className={'preview-example example-' + GAME_NUMBER} aria-hidden="true">
      {GAME_NUMBER === 80 && <svg viewBox="0 0 320 220"><defs><radialGradient id="soft-example" cx=".35" cy=".2" r=".9"><stop stopColor="#ffe4bd"/><stop offset="1" stopColor="#f3ad97"/></radialGradient></defs><path className="example-blob" d="M78 61C112 16 184 23 192 66C206 88 248 75 249 113C251 162 200 176 165 166C117 195 69 166 80 124C40 101 47 78 78 61Z" fill="url(#soft-example)" stroke="#d99485" strokeWidth="2"/><g className="example-eyes"><ellipse cx="136" cy="91" rx="11" ry="14" fill="white"/><ellipse cx="168" cy="91" rx="11" ry="14" fill="white"/><circle cx="139" cy="94" r="5" fill="#443c39"/><circle cx="171" cy="94" r="5" fill="#443c39"/></g></svg>}
      {GAME_NUMBER === 81 && <svg viewBox="0 0 320 220"><path className="example-noodle" d="M65 145C44 109 84 61 115 88S139 171 187 151S250 80 263 126" fill="none" stroke="#e4d3ed" strokeWidth="29" strokeLinecap="round"/><path className="example-noodle" d="M65 145C44 109 84 61 115 88S139 171 187 151S250 80 263 126" fill="none" stroke="#3e3b42" strokeWidth="13" strokeLinecap="round"/><circle cx="129" cy="103" r="6" fill="white"/><circle cx="144" cy="111" r="6" fill="white"/><circle cx="130" cy="104" r="2.4"/><circle cx="145" cy="112" r="2.4"/><path d="M115 151q-5 17-15 11M186 160q5 18 15 9" fill="none" stroke="#3e3b42" strokeWidth="3" strokeLinecap="round"/></svg>}
      {GAME_NUMBER === 84 && <div className="example-poem">a little line becomes a thought<br/>the words wander across the paper<br/><em>softly</em> a small world opens<br/>every mark is a moment<br/>and every moment can begin again</div>}
    </div>}
  </>;
}

const BASE_CSS = `
button { touch-action: manipulation; }
button:focus-visible { outline: 3px solid #3c8ddd; outline-offset: 3px; }
@keyframes batchBreathe { 0%,100% { opacity:.72; } 50% { opacity:1; } }
.preview-example { position:fixed; z-index:2; pointer-events:none; width:min(80%,340px); left:50%; top:35%; transform:translateX(-50%); }
.preview-example svg { width:100%; height:auto; overflow:visible; }
.example-blob { transform-origin:50% 60%; animation:exampleSquish 3.8s ease-in-out infinite; }
.example-noodle { transform-origin:50% 70%; animation:exampleWiggle 3.6s ease-in-out infinite; }
.example-poem { padding:20px; color:#44444c; font:15px/1.8 ui-monospace,monospace; clip-path:ellipse(49% 47% at 50% 50%); animation:exampleInk 5s ease-in-out infinite; }
.example-poem em { color:#ad7397; font-style:normal; }
@keyframes exampleSquish { 0%,100% {transform:scale(1,1) rotate(-3deg)} 40% {transform:scale(1.06,.94) rotate(2deg)} 70% {transform:scale(.96,1.04) rotate(-1deg)} }
@keyframes exampleWiggle { 0%,100% { transform:rotate(-3deg) translateY(0); } 50% { transform:rotate(3deg) translateY(-5px); } }
@keyframes exampleInk { 0%,100% {opacity:.25;clip-path:ellipse(23% 35% at 32% 50%)} 45%,70% {opacity:.9;clip-path:ellipse(49% 47% at 50% 50%)} }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; } }
`;

const GAME_NUMBER=84;
const POLISH_CSS="";

const DEFAULTS={BRUSH_1:7,BRUSH_2:10,BRUSH_3:14,BRUSH_4:20,BRUSH_5:27,INK_FADE_MS:3000,INK_STEP:15,ACCENT_RATE:6,GAME_TITLE:'Text Sketchpad',DRAW_HINT:'Brush to reveal the words',CLEAR_CANVAS:'Clear canvas',BRUSH_LABEL_1:'Fine reveal brush',BRUSH_LABEL_2:'Small reveal brush',BRUSH_LABEL_3:'Medium reveal brush',BRUSH_LABEL_4:'Large reveal brush',BRUSH_LABEL_5:'Wide reveal brush',POEM_1:'make room for the quiet',POEM_2:'a small light becomes a path',POEM_3:'hold this moment gently',POEM_4:'the hand remembers the sky',POEM_5:'begin again in soft motion',POEM_6:'what fades still leaves a trace'};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function letterLifetime(duration,random=Math.random){return duration*(.18+.82*random());}
function refreshGlyph(glyph,now,duration,random=Math.random){
  // Roll once per fresh reveal, so position never determines recovery order.
  // Holding/rebrushing an exposed letter extends that same deadline without
  // rerolling it on every frame and making the character flicker.
  if(glyph.until<=now||!glyph.lifetime)glyph.lifetime=letterLifetime(duration,random);
  glyph.until=now+glyph.lifetime;
}
function glyphHit(glyph,a,b,r,width,height){const ax=a.x*width,ay=a.y*height,dx=(b.x-a.x)*width,dy=(b.y-a.y)*height,cx=glyph.x+glyph.w/2,cy=glyph.y+glyph.h*.55,t=clamp(((cx-ax)*dx+(cy-ay)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(cx-ax-t*dx,cy-ay-t*dy)<=r*width+glyph.w*.35;}

function App(){
  const active=useFeedActive(),[cfg,setCfg]=useState(DEFAULTS),[brush,setBrush]=useState(2),[guide,setGuide]=useState(true);
  const canvasRef=useRef(null),layers=useRef(null),pointer=useRef(null),clock=useRef({value:0,last:0}),cfgRef=useRef(cfg),brushRef=useRef(2),activeRef=useRef(active),audio=useRef(null),samples=useRef(new Map());
  cfgRef.current=cfg;activeRef.current=active;brushRef.current=brush;
  useEffect(()=>{let alive=true;fetch('./game.config.json').then(r=>r.json()).then(raw=>{if(alive)setCfg({...DEFAULTS,...Object.fromEntries([...raw.texts,...raw.tweaks].map(x=>[x.id,x.value]))});}).catch(()=>{});return()=>{alive=false;};},[]);
  const sound=kind=>{
    if(!activeRef.current)return;
    try{if(!audio.current)audio.current=new(window.AudioContext||window.webkitAudioContext)();const ctx=audio.current;ctx.resume().catch(()=>{});const path=kind==='clear'?'./assets/sfx_paper_clear.mp3':'./assets/sfx_paper_tap.mp3';let sample=samples.current.get(path);if(!sample){sample=fetch(path).then(r=>r.arrayBuffer()).then(b=>ctx.decodeAudioData(b)).catch(()=>null);samples.current.set(path,sample);}sample.then(buffer=>{if(!buffer||ctx.state!=='running'||!activeRef.current)return;const src=ctx.createBufferSource(),gain=ctx.createGain();gain.gain.value=.14;src.buffer=buffer;src.connect(gain);gain.connect(ctx.destination);src.start();src.onended=()=>{src.disconnect();gain.disconnect();};});}catch{}
  };
  useEffect(()=>()=>{try{audio.current?.close();}catch{}},[]);
  useEffect(()=>{clock.current.last=performance.now();pointer.current=null;},[active]);
  useEffect(()=>{const pause=()=>{clock.current.last=performance.now();pointer.current=null;};document.addEventListener('visibilitychange',pause);return()=>document.removeEventListener('visibilitychange',pause);},[]);

  const paintSegment=(a,b,r,now)=>{
    const l=layers.current;if(!l)return;
    const duration=Math.max(500,Number(cfgRef.current.INK_FADE_MS)||3000);
    for(const glyph of l.glyphs)if(glyphHit(glyph,a,b,r,l.width,l.height))refreshGlyph(glyph,now,duration);
  };

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const build=()=>{
      const rect=canvas.getBoundingClientRect(),width=rect.width,height=rect.height,dpr=Math.min(devicePixelRatio||1,2),old=layers.current;
      canvas.width=Math.max(1,Math.round(width*dpr));canvas.height=Math.max(1,Math.round(height*dpr));
      const ctx=canvas.getContext('2d'),fontSize=clamp(width*.029,10,13),lineHeight=fontSize*1.4,margin=25;
      const font=`500 ${fontSize}px ui-monospace,Menlo,monospace`;ctx.font=font;
      const words=Array.from({length:6},(_,i)=>String(cfgRef.current['POEM_'+(i+1)]||'')).join('. ').split(/\s+/).filter(Boolean);
      const spacing=Math.max(3,Number(cfgRef.current.INK_STEP)*.3),accent=Math.max(3,Number(cfgRef.current.ACCENT_RATE)),layout=[],glyphs=[];
      let x=margin,y=30,index=0;
      while(y<height-112&&words.length){
        const word=words[index%words.length],wordWidth=ctx.measureText(word).width;
        if(x+wordWidth>width-margin){x=margin;y+=lineHeight;if(y>=height-112)break;}
        const color=index%accent===0?['#b98b9c','#9b92b7','#91a98d'][Math.floor(index/accent)%3]:'#3b3c41';
        layout.push(word+':'+Math.round(x)+':'+Math.round(y));
        let letterX=x;
        for(const char of word){const w=ctx.measureText(char).width,i=glyphs.length;glyphs.push({char,x:letterX,y,w,h:fontSize,color,index:i,until:old?.glyphs[i]?.until||0,lifetime:old?.glyphs[i]?.lifetime||0,demoBorn:-1,demoLifetime:0});letterX+=w;}
        x+=wordWidth+spacing;index++;
      }
      // The preview brushes open these same stationary letters. It has its own
      // illustrative timing and never changes the player's recovery deadlines.
      for(let i=0;i<36;i++){
        const p=t=>({x:.16+t*.68,y:.48+Math.sin(t*4)*.08});
        for(const glyph of glyphs)if(glyphHit(glyph,p(i/36),p((i+1)/36),.095,width,height))glyph.demoBorn=i/36*1800;
      }
      let hash=2166136261;for(const char of layout.join('|'))hash=Math.imul(hash^char.charCodeAt(0),16777619);
      canvas.dataset.textLayout=String(hash>>>0);canvas.dataset.recoveryMode='letter-by-letter';canvas.dataset.recoveryOrder='random';layers.current={glyphs,width,height,dpr,font,demoCycle:-1};
    };
    const observer=new ResizeObserver(build);observer.observe(canvas);build();document.fonts?.ready.then(()=>{if(canvasRef.current===canvas)build();});let raf=0;
    const frame=now=>{
      const time=clock.current,last=time.last||now;time.last=now;
      if(activeRef.current&&!document.hidden)time.value+=Math.max(0,now-last);else pointer.current=null;
      const l=layers.current;
      if(l){
        const duration=Math.max(500,Number(cfgRef.current.INK_FADE_MS)||3000),pen=pointer.current;
        if(activeRef.current&&pen&&time.value-pen.lastStamp>90){paintSegment(pen.last,pen.last,pen.r,time.value);pen.lastStamp=time.value;}
        const ctx=canvas.getContext('2d');ctx.setTransform(l.dpr,0,0,l.dpr,0,0);ctx.globalAlpha=1;ctx.fillStyle='#fff';ctx.fillRect(0,0,l.width,l.height);ctx.font=l.font;ctx.textBaseline='top';
        const previewTime=reducedMotionQuery.matches?1800:now%(duration+2000),previewCycle=reducedMotionQuery.matches?0:Math.floor(now/(duration+2000));let visible=0;
        if(!activeRef.current&&l.demoCycle!==previewCycle){l.demoCycle=previewCycle;for(const glyph of l.glyphs)glyph.demoLifetime=letterLifetime(duration);}
        for(const glyph of l.glyphs){
          const shown=activeRef.current?glyph.until>time.value:glyph.demoBorn>=0&&previewTime>=glyph.demoBorn&&previewTime<glyph.demoBorn+glyph.demoLifetime;
          if(!shown)continue;
          // Each character stays fully opaque until its own deadline, then
          // disappears in one frame. There is no opacity or mask interpolation.
          ctx.fillStyle=glyph.color;ctx.fillText(glyph.char,glyph.x,glyph.y);visible++;
        }
        canvas.dataset.visibleLetters=String(visible);canvas.dataset.revealOpacity=visible?'1':'0';
      }
      raf=requestAnimationFrame(frame);
    };
    raf=requestAnimationFrame(frame);return()=>{cancelAnimationFrame(raf);observer.disconnect();layers.current=null;};
  },[cfg]);

  const pointFor=event=>{const rect=canvasRef.current.getBoundingClientRect();return {x:clamp((event.clientX-rect.left)/rect.width,0,1),y:clamp((event.clientY-rect.top)/rect.height,0,1)};};
  const start=event=>{
    if(!activeRef.current||event.isPrimary===false||(event.pointerType==='mouse'&&event.button!==0))return;
    const p=pointFor(event),width=canvasRef.current.getBoundingClientRect().width,size=Number(cfgRef.current['BRUSH_'+(brushRef.current+1)])||14,r=size*1.7/width;
    pointer.current={id:event.pointerId,last:p,r,lastStamp:clock.current.value};paintSegment(p,p,r,clock.current.value);setGuide(false);sound('tap');event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move=event=>{const pen=pointer.current;if(!pen||pen.id!==event.pointerId)return;const p=pointFor(event),l=layers.current;if(!l||Math.hypot((p.x-pen.last.x)*l.width,(p.y-pen.last.y)*l.height)<1)return;paintSegment(pen.last,p,pen.r,clock.current.value);pen.last=p;pen.lastStamp=clock.current.value;};
  const end=event=>{if(pointer.current?.id===event.pointerId)pointer.current=null;};
  const clear=()=>{if(layers.current)layers.current.glyphs.forEach(g=>{g.until=0;});pointer.current=null;setGuide(true);sound('clear');};
  return <main className="word-reveal" aria-label={cfg.GAME_TITLE}>
    <canvas ref={canvasRef} aria-label="Prewritten letters hidden beneath a cover. Brush to reveal them; they disappear one by one." onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}/>
    {guide&&<p className="reveal-guide">{cfg.DRAW_HINT}</p>}
    <nav className="reveal-toolbar" aria-label="Brush controls">
      {Array.from({length:5},(_,i)=><button key={i} className={i===brush?'selected':''} aria-label={cfg['BRUSH_LABEL_'+(i+1)]} aria-pressed={i===brush} onClick={()=>{setBrush(i);sound('tap');}}><span style={{fontSize:Math.min(32,16+i*4)}}>✦</span></button>)}
      <button aria-label={cfg.CLEAR_CANVAS} onClick={clear}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M9 7V4h6v3M7 7l1 13h8l1-13M10 10v6m4-6v6"/></svg></button>
    </nav>
    <style>{BASE_CSS+CSS}</style>
  </main>;
}

const CSS=`
@font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');font-weight:400;font-display:swap}@font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');font-weight:700;font-display:swap}
*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{background:#fff;font-family:Poppins,system-ui,sans-serif;-webkit-tap-highlight-color:transparent}button{font:inherit;cursor:pointer;border:0;touch-action:manipulation}.word-reveal{position:relative;width:100%;height:100%;overflow:hidden;background:#fff}.word-reveal canvas{display:block;width:100%;height:100%;touch-action:none;user-select:none;cursor:crosshair}.reveal-guide{position:absolute;top:24%;left:30px;right:30px;transform:translateY(-50%);margin:0;text-align:center;font-size:18px;font-weight:700;line-height:1.3;color:#49454f;pointer-events:none;animation:batchBreathe 2.6s ease-in-out infinite}.reveal-toolbar{position:absolute;bottom:50px;left:30px;right:30px;display:flex;align-items:center;min-height:48px;padding:2px 3px;gap:1px;background:#ffffffed;border:1px solid #e9e7ec;border-radius:28px}.reveal-toolbar button{flex:1;min-width:0;height:46px;padding:0;background:transparent;color:#aaa6ad;border-radius:23px;display:grid;place-items:center}.reveal-toolbar button.selected{color:#cd8a79;background:#fff2ed}.reveal-toolbar button:active{transform:scale(.94)}.reveal-toolbar svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}[data-feed-preview=true] .reveal-toolbar{visibility:hidden}`;
createRoot(document.getElementById('root')).render(<App/>);
