// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
import * as Motion from 'framer-motion';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "SPINNER_FRICTION",
    "kind": "number",
    "label": "Spinner Friction",
    "value": 0.98,
    "default": 0.98,
    "min": 0.9,
    "max": 0.999,
    "step": 0.001
  }, {
    "id": "SAND_BRUSH_SIZE",
    "kind": "number",
    "label": "Sand Brush Size",
    "value": 15,
    "default": 15,
    "min": 5,
    "max": 40,
    "step": 1
  }],
  "texts": [{
    "id": "BOOK_TITLE",
    "label": "Book Title",
    "value": "Pink ASMR Book",
    "default": "Pink ASMR Book",
    "max_length": 30
  }, {
    "id": "COVER_INSTRUCTION",
    "label": "Cover Instruction",
    "value": "Tap to Open",
    "default": "Tap to Open",
    "max_length": 25
  }, {
    "id": "TAB_BUBBLE",
    "label": "Bubble Tab",
    "value": "Bubble Wrap",
    "default": "Bubble Wrap",
    "max_length": 15
  }, {
    "id": "TAB_SAND",
    "label": "Sand Tab",
    "value": "Sand Art",
    "default": "Sand Art",
    "max_length": 15
  }, {
    "id": "TAB_SPINNER",
    "label": "Spinner Tab",
    "value": "Spinner",
    "default": "Spinner",
    "max_length": 15
  }, {
    "id": "BTN_RESET",
    "label": "Reset Button",
    "value": "Reset",
    "default": "Reset",
    "max_length": 20
  }],
  "images": [{
    "id": "BG_COVER",
    "label": "Cover Background",
    "path": "./assets/book-cover-transparent-v2.png",
    "replaceable": true
  }, {
    "id": "IMG_SPINNER",
    "label": "Spinner Image",
    "path": "./assets/art-v2/pink-spinner-photo-v4.webp",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const GAME_STYLES = `
html,body,#root{width:100%;height:100%;margin:0;padding:0;overflow:hidden}
body{-webkit-tap-highlight-color:transparent}button{touch-action:manipulation;font-family:inherit;cursor:pointer}
.asmr-activities{display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:12px;width:100%;height:100%;min-height:0;padding:24px}
.asmr-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;min-height:44px}
.asmr-tabs button{min-width:0;min-height:44px;padding:9px 4px;border:0;border-radius:24px;font-size:12px;line-height:1.25;background:var(--c-pink-light);color:#755a61;font-weight:700;overflow-wrap:anywhere}
.asmr-tabs button.selected{background:var(--c-pink-accent);color:white}
.asmr-stage{display:flex;flex-direction:column;position:relative;min-height:0;background:transparent;border-radius:24px;overflow:hidden;box-shadow:none}
.asmr-footer{display:flex;align-items:center;justify-content:center;min-height:44px}
.asmr-footer button{min-height:44px;padding:10px 32px;border:2px solid #c43b66;border-radius:24px;background:transparent;color:#9f2149;font-weight:700}
.asmr-bubble-area{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:32px 12px 12px}
.asmr-bubble-sheet{position:relative;flex-shrink:0;max-width:100%;max-height:100%}
.asmr-bubble-sheet>img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;user-select:none}
.asmr-bubble-hits{position:absolute;inset:2% 3%;gap:0}
.asmr-bubble-hotspot{position:relative;width:100%;height:100%;min-width:0;min-height:0!important;border:0;padding:0;background:none;border-radius:50%;touch-action:none}
.asmr-bubble-hotspot:focus-visible{outline:2px solid #bb5272;outline-offset:-4px}
.asmr-bubble-popped{position:absolute;inset:5%;border-radius:50%;background-image:url('./assets/art-v2/bubble-wrap.webp');background-size:200% 100%;background-position:100% 0;background-repeat:no-repeat;box-shadow:inset 0 1px 5px #8d768522;animation:pop-in .15s ease-out}
@keyframes pop-in{from{opacity:.2;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
.asmr-sand-activity{flex:1;min-height:0;display:flex;flex-direction:column;padding:16px;gap:10px}
.asmr-sand-tray{flex:1;min-height:0;position:relative;border:1px solid #c5ac8c;border-radius:20px;overflow:hidden;background:#e5d2b4;box-shadow:0 3px 12px #896e4920}
.asmr-sand-tray::after{content:'';position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 2px 12px #77573724;pointer-events:none}
.asmr-sand-tools{display:flex;flex:0 0 40px;justify-content:center;gap:8px}
.asmr-sand-tools button{min-height:40px;padding:7px 20px;border:1px solid #dbc2b5;border-radius:22px;background:#fff7ef;color:#785342;font-family:inherit;font-weight:700;font-size:12px}
.asmr-sand-tools button.selected{border-color:#a06d5b;background:#f0d9c6}
@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}.feed-first-action[aria-hidden=true]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(max-height:520px){.asmr-activities{padding:16px 20px;gap:8px}.asmr-tabs{min-height:40px}.asmr-tabs button{min-height:40px}.asmr-sand-activity{padding:12px;gap:8px}}
@media(prefers-reduced-motion:reduce){.feed-first-action,.asmr-bubble-popped{animation:none}}
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
document.documentElement.lang = 'en';
function PF(config) {
  let options2 = {};
  (config.tweaks || []).forEach(item => {
    options2[item.id] = item.value;
  });
  (config.texts || []).forEach(item => {
    options2[item.id] = item.value;
  });
  (config.images || []).forEach(item => {
    options2[item.id] = item.path;
  });
  (config.mentions || []).forEach(item => {
    options2[item.id] = item.path != null && item.path !== "" ? item.path : item.value;
  });
  (config.motions || []).forEach(item => {
    if (!(!item || !item.id)) {
      if (item.base_path != null && item.base_path !== "") {
        options2[item.id] = item.base_path;
        options2[item.id + "_BASE"] = item.base_path;
      }
      if (item.frame_count != null) {
        options2[item.id + "_COUNT"] = item.frame_count;
      }
    }
  });
  return options2;
}
var options = {
  ready: !1,
  synths: {},
  audio: {},
  bubbleIndex: 0,
  playBubble: null
};
async function NF() {
  if (options.ready) return;
  if (options.starting) return options.starting;
  options.starting = (async () => {
    await Tone.start();
    options.synths.sand = new Tone.NoiseSynth({
      noise: {
        type: "pink"
      },
      envelope: {
        attack: 0.28,
        decay: 0.25,
        sustain: 0.35,
        release: 0.6
      }
    }).toDestination();
    options.synths.sand.volume.value = -22;
    options.synths.squishy = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 2,
      oscillator: {
        type: "sine"
      },
      envelope: {
        attack: 0.01,
        decay: 0.4,
        sustain: 0,
        release: 0.4
      }
    }).toDestination();
    options.synths.squishy.volume.value = -6;
    if (typeof Audio !== "undefined") {
      options.audio.bubbles = Array.from({
        length: 6
      }, () => {
        let audio = new Audio("./assets/audio/bubble-wrap-pop-399334.mp3");
        audio.preload = "auto";
        audio.volume = 0.62;
        return audio;
      });
      options.audio.spinner = new Audio("./assets/audio/fidget-spinner-400683.mp3");
      options.audio.spinner.preload = "auto";
      options.audio.spinner.loop = !0;
      options.audio.spinner.volume = 0;
      options.playBubble = value => {
        let item = options.audio.bubbles[options.bubbleIndex++ % options.audio.bubbles.length];
        item.pause();
        item.currentTime = 0;
        item.playbackRate = 0.92 + value % 5 * 0.035;
        item.volume = 0.62;
        item.play().catch(() => {});
      };
    }
    options.ready = !0;
  })();
  try {
    await options.starting;
  } finally {
    options.starting = null;
  }
}
function dy(style = "light") {
  if (typeof window !== "undefined" && window.tt && window.tt.vibrate) try {
    window.tt.vibrate({
      style: style
    });
  } catch {}
}
function useGameFeature1() {
  const [popped,setPopped]=React.useState(new Set()),area=React.useRef(null);
  const [ratio,setRatio]=React.useState(5/7),[size,setSize]=React.useState({width:220,height:308});
  React.useEffect(()=>{
    const element=area.current;if(!element)return;
    const fit=()=>{const width=Math.max(1,Math.min(element.clientWidth-24,(element.clientHeight-44)*ratio));setSize({width,height:width/ratio});};
    fit();const observer=new ResizeObserver(fit);observer.observe(element);return()=>observer.disconnect();
  },[ratio]);
  async function pop(index){
    if(popped.has(index))return;setPopped(value=>new Set(value).add(index));
    try{await NF();options.playBubble?.(index);dy('light');}catch(_){}
  }
  return <div ref={area} className="asmr-bubble-area">
    <div className="asmr-bubble-sheet" style={{width:size.width,height:size.height}}>
      <img src="./assets/art-v2/bubble-sheet-v3.webp" alt="A clear sheet of 35 inflated air bubbles" draggable={false} onLoad={event=>setRatio(event.currentTarget.naturalWidth/event.currentTarget.naturalHeight)}/>
      <div className="asmr-bubble-hits" style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gridTemplateRows:'repeat(7,1fr)'}}>
        {Array.from({length:35},(_,index)=><button key={index} type="button" className="asmr-bubble-hotspot" data-bubble-index={index} aria-label={popped.has(index)?`Bubble ${index+1} popped`:`Pop bubble ${index+1}`} aria-pressed={popped.has(index)} onClick={()=>pop(index)}>
          {popped.has(index)&&<span className="asmr-bubble-popped"/>}
        </button>)}
      </div>
    </div>
  </div>;
}
function useGameFeature2({config: t}) {
  const tray = React.useRef(null), canvas = React.useRef(null), simulation = React.useRef(null);
  const dragging = React.useRef(false), previous = React.useRef(null), pointerId = React.useRef(null);
  const [mode, setMode] = React.useState('rake'), currentMode = React.useRef('rake');
  const stop = () => {
    dragging.current=false; previous.current=null; pointerId.current=null;
    if(simulation.current) simulation.current.cursor=null;
    if(options.ready && options.synths.sand.state==='started') options.synths.sand.triggerRelease();
  };
  React.useEffect(() => {
    const view=canvas.current,holder=tray.current;
    if(!view || !holder) return;
    const context=view.getContext('2d',{alpha:false});
    let raf,running=true,lastFrame=0;
    function resize(){
      const bounds=holder.getBoundingClientRect();
      if(bounds.width<1 || bounds.height<1) return;
      const width=Math.max(96,Math.min(270,Math.round(bounds.width))),height=Math.max(96,Math.round(width*bounds.height/bounds.width));
      const old=simulation.current,field=new Float32Array(width*height),dpr=Math.min(2,window.devicePixelRatio||1);
      for(let y=0;y<height;y++) for(let x=0;x<width;x++){
        field[y*width+x]=old?old.field[Math.min(old.height-1,Math.floor(y/height*old.height))*old.width+Math.min(old.width-1,Math.floor(x/width*old.width))]:4+Math.sin(x*.06)*.025+Math.cos(y*.055)*.018;
      }
      view.width=Math.round(bounds.width*dpr);view.height=Math.round(bounds.height*dpr);
      const noise=new Float32Array(view.width*view.height);
      let seed=12097;
      for(let i=0;i<noise.length;i++){
        seed=(Math.imul(seed,1664525)+1013904223)|0;
        const n=(seed>>>0)/4294967296;
        noise[i]=(n-.5)*7+(n>.991?4:n<.009?-5:0);
      }
      simulation.current={width,height,field,noise,smooth:new Float32Array(field.length),temp:new Float32Array(field.length),normalX:new Float32Array(field.length),normalY:new Float32Array(field.length),dirty:true,settle:0,cursor:null,frame:0,rgba:context.createImageData(view.width,view.height)};
    }
    // Local grain transfers retain the displaced sand in soft banks beside the furrow.
    function settle(s){
      const a=s.field,w=s.width,h=s.height,reverse=(s.frame++%2)===1;
      for(let row=1;row<h-1;row++) for(let col=1;col<w-1;col++){
        const x=reverse?w-1-col:col,y=reverse?h-1-row:row,i=y*w+x;
        for(const j of [i+(reverse?-1:1),i+(reverse?-w:w)]){
          const diff=a[i]-a[j];
          if(Math.abs(diff)>.42){const transfer=(Math.abs(diff)-.42)*.15*Math.sign(diff);a[i]-=transfer;a[j]+=transfer;}
        }
      }
    }
    function smoothSurface(s){
      const {width:w,height:h,field:a,temp,smooth,normalX,normalY}=s;
      // A smooth height surface and interpolated normals remove the visible simulation-cell facets.
      for(let y=0;y<h;y++) for(let x=0;x<w;x++){
        const row=y*w;
        temp[row+x]=(a[row+Math.max(0,x-2)]+4*a[row+Math.max(0,x-1)]+6*a[row+x]+4*a[row+Math.min(w-1,x+1)]+a[row+Math.min(w-1,x+2)])/16;
      }
      for(let y=0;y<h;y++) for(let x=0;x<w;x++){
        const i=y*w+x;
        smooth[i]=(temp[Math.max(0,y-2)*w+x]+4*temp[Math.max(0,y-1)*w+x]+6*temp[i]+4*temp[Math.min(h-1,y+1)*w+x]+temp[Math.min(h-1,y+2)*w+x])/16;
      }
      for(let y=0;y<h;y++) for(let x=0;x<w;x++){
        const i=y*w+x;
        normalX[i]=(smooth[y*w+Math.min(w-1,x+1)]-smooth[y*w+Math.max(0,x-1)])*.5;
        normalY[i]=(smooth[Math.min(h-1,y+1)*w+x]-smooth[Math.max(0,y-1)*w+x])*.5;
      }
    }
    function render(s){
      smoothSurface(s);
      const w=s.width,h=s.height,pixels=s.rgba.data,rw=view.width,rh=view.height,a=s.smooth,nx=s.normalX,ny=s.normalY;
      for(let y=0;y<rh;y++){
        const gy=y/(rh-1)*(h-1),iy=Math.min(h-2,Math.floor(gy)),fy=gy-iy;
        for(let x=0;x<rw;x++){
          const gx=x/(rw-1)*(w-1),ix=Math.min(w-2,Math.floor(gx)),fx=gx-ix,i=iy*w+ix;
          const q0=(1-fx)*(1-fy),q1=fx*(1-fy),q2=(1-fx)*fy,q3=fx*fy;
          const dx=nx[i]*q0+nx[i+1]*q1+nx[i+w]*q2+nx[i+w+1]*q3;
          const dy=ny[i]*q0+ny[i+1]*q1+ny[i+w]*q2+ny[i+w+1]*q3;
          const z=a[i]*q0+a[i+1]*q1+a[i+w]*q2+a[i+w+1]*q3;
          const light=Math.max(.78,Math.min(1.12,1-dx*.3-dy*.38+(z-4)*.012));
          const grain=s.noise[y*rw+x],idx=(y*rw+x)*4;
          pixels[idx]=229*light+grain;pixels[idx+1]=210*light+grain*.93;pixels[idx+2]=180*light+grain*.8;pixels[idx+3]=255;
        }
      }
      context.putImageData(s.rgba,0,0);
      if(s.cursor && dragging.current){
        const p=s.cursor,brush=(t.SAND_BRUSH_SIZE||15)*s.width/holder.clientWidth;
        context.save();context.scale(rw/w,rh/h);context.translate(p.x,p.y);context.rotate(Math.atan2(p.dy,p.dx));
        context.strokeStyle='#8b6748';context.lineWidth=1.3;context.lineCap='round';
        if(currentMode.current==='rake'){
          context.beginPath();context.moveTo(-7,-brush*1.1);context.lineTo(-7,brush*1.1);context.moveTo(-27,0);context.lineTo(-7,0);
          for(let n=-2;n<=2;n++){context.moveTo(-7,n*brush*.55);context.lineTo(1,n*brush*.55);}context.stroke();
        }else{context.strokeStyle='#fff7e58a';context.beginPath();context.arc(0,0,brush*.95,0,Math.PI*2);context.stroke();}
        context.restore();
      }
      s.dirty=false;
    }
    function frame(now){
      if(!running) return;
      if(now-lastFrame>30 && !document.hidden){
        lastFrame=now;const s=simulation.current;
        if(s){if(s.settle>0){settle(s);s.settle--;s.dirty=true;}if(s.dirty) render(s);}
      }
      raf=requestAnimationFrame(frame);
    }
    resize();const observer=new ResizeObserver(resize);observer.observe(holder);raf=requestAnimationFrame(frame);
    return()=>{running=false;observer.disconnect();cancelAnimationFrame(raf);stop();simulation.current=null;};
  }, []);
  function point(event){
    const r=canvas.current.getBoundingClientRect(),s=simulation.current;
    return{x:Math.max(2,Math.min(s.width-3,(event.clientX-r.left)/r.width*s.width)),y:Math.max(2,Math.min(s.height-3,(event.clientY-r.top)/r.height*s.height))};
  }
  function deposit(s,x,y,amount){
    x=Math.max(1,Math.min(s.width-2,x));y=Math.max(1,Math.min(s.height-2,y));
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,i=iy*s.width+ix;
    s.field[i]+=amount*(1-fx)*(1-fy);s.field[i+1]+=amount*fx*(1-fy);s.field[i+s.width]+=amount*(1-fx)*fy;s.field[i+s.width+1]+=amount*fx*fy;
  }
  function displace(s,cx,cy,r,dx,dy,strength){
    const nx=-dy,ny=dx,w=s.width;
    for(let yy=Math.max(1,Math.floor(cy-r));yy<=Math.min(s.height-2,Math.ceil(cy+r));yy++) for(let xx=Math.max(1,Math.floor(cx-r));xx<=Math.min(w-2,Math.ceil(cx+r));xx++){
      const ox=xx-cx,oy=yy-cy,d=Math.hypot(ox,oy)/r;if(d>=1) continue;
      const i=yy*w+xx,weight=(1-d*d),floor=2.65+d*.55,amount=Math.min(Math.max(0,s.field[i]-floor),strength*weight);
      if(amount<=0) continue;s.field[i]-=amount;
      const side=ox*nx+oy*ny<0?-1:1,along=ox*dx+oy*dy;
      deposit(s,cx+nx*side*r*1.28+dx*(along+r*.2),cy+ny*side*r*1.28+dy*(along+r*.2),amount);
    }
  }
  function move(event){
    if(!dragging.current || event.pointerId!==pointerId.current || !simulation.current) return;
    const samples=event.nativeEvent?.getCoalescedEvents?.()||[event];
    for(const sample of samples.length?samples:[event]){
      const s=simulation.current,to=point(sample),from=previous.current||to,dist=Math.hypot(to.x-from.x,to.y-from.y);
      if(dist<.15) continue;
      const dx=(to.x-from.x)/dist,dy=(to.y-from.y)/dist,nx=-dy,ny=dx,steps=Math.max(1,Math.ceil(dist/.55));
      const brush=(t.SAND_BRUSH_SIZE||15)*s.width/tray.current.clientWidth;
      for(let j=1;j<=steps;j++){
        const x=from.x+(to.x-from.x)*j/steps,y=from.y+(to.y-from.y)*j/steps;
        if(currentMode.current==='rake') for(let tooth=-2;tooth<=2;tooth++) displace(s,x+nx*tooth*brush*.55,y+ny*tooth*brush*.55,Math.max(1.7,brush*.16),dx,dy,.36);
        else displace(s,x,y,Math.max(4,brush*.95),dx,dy,.18);
      }
      s.cursor={...to,dx,dy};s.settle=42;s.dirty=true;previous.current=to;
    }
  }
  async function down(event){
    if(event.isPrimary===false || event.button>0 || !simulation.current) return;
    dragging.current=true;pointerId.current=event.pointerId;previous.current=point(event);event.currentTarget.setPointerCapture(event.pointerId);
    try{await NF();if(dragging.current && options.ready){options.synths.sand.volume.value=-25;if(options.synths.sand.state!=='started') options.synths.sand.triggerAttack();}}catch(_){}
  }
  function up(){if(simulation.current) simulation.current.dirty=true;stop();}
  return <div className="asmr-sand-activity">
    <div ref={tray} className="asmr-sand-tray"><canvas ref={canvas} aria-label="Sand garden" style={{width:'100%',height:'100%',display:'block',touchAction:'none'}} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}/></div>
    <div className="asmr-sand-tools">{['rake','push'].map(tool=><button key={tool} type="button" className={mode===tool?'selected':''} onClick={()=>{up();currentMode.current=tool;setMode(tool);}}>{tool==='rake'?'Rake':'Push'}</button>)}</div>
  </div>;
}

function useGameFeature3({
  config: t
}) {
  let elementRef = React.useRef(null);
  let elementRef2 = React.useRef(null);
  const spinnerRef = React.useRef(null);
  let stateRef = React.useRef(0);
  let stateRef2 = React.useRef(0);
  let stateRef3 = React.useRef(null);
  let stateRef4 = React.useRef(performance.now());
  let stateRef5 = React.useRef(null);
  let handlePointerDown = event => {
    if (event.isPrimary === false || event.button > 0) return;
    const wheel = spinnerRef.current?.getBoundingClientRect();
    if (wheel && Math.hypot(event.clientX - wheel.left - wheel.width / 2, event.clientY - wheel.top - wheel.height / 2) < wheel.width * .122) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    stateRef5.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      time: performance.now()
    };
  };
  let handlePointerMove = event => {
    if (!stateRef5.current || !elementRef.current || event.pointerId !== stateRef5.current.pointerId) return;
    let dimensions = elementRef.current.getBoundingClientRect();
    let value = dimensions.left + dimensions.width / 2;
    let value2 = dimensions.top + dimensions.height / 2;
    let value3 = stateRef5.current.x - value;
    let value4 = stateRef5.current.y - value2;
    let x = event.clientX - value;
    let y = event.clientY - value2;
    const now = performance.now();
    if (Math.hypot(value3,value4) > 18 && Math.hypot(x,y) > 18) {
      let delta = Math.atan2(y,x) - Math.atan2(value4,value3);
      delta = Math.atan2(Math.sin(delta),Math.cos(delta)) * 180 / Math.PI;
      stateRef.current += delta;
      const velocity = delta * 16 / Math.max(8,now-stateRef5.current.time);
      stateRef2.current = Math.max(-60,Math.min(60,stateRef2.current*.55+velocity*.45));
    }
    stateRef5.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      time: now
    };
  };
  let handlePointerUp = () => {
    stateRef5.current = null;
  };
  React.useEffect(() => {
    let handleAction = value => {
      let value2 = Math.min(32, value - stateRef4.current);
      stateRef4.current = value;
      if (!stateRef5.current) {
        stateRef2.current *= Math.pow(t.SPINNER_FRICTION || .98,value2/16);
        stateRef.current += stateRef2.current * (value2 / 16);
      }
      if (elementRef2.current) elementRef2.current.style.transform = `rotate(${stateRef.current}deg)`;
      if (options.ready) {
        let value3 = Math.abs(stateRef2.current);
        if (options.audio.spinner) {
          let spinner = options.audio.spinner;
          let value4 = value3 > 0.65 ? Math.min(0.58, 0.08 + value3 * 0.026) : 0;
          let x = spinner.volume + (value4 - spinner.volume) * 0.22;
          spinner.volume = Math.max(0, Math.min(0.62, x));
          spinner.playbackRate = Math.max(0.78, Math.min(1.3, 0.78 + value3 * 0.018));
          if (value4 > 0 && spinner.paused) {
            spinner.play().catch(() => {});
          } else {
            if (value4 === 0 && spinner.volume < 0.012 && !spinner.paused) {
              spinner.pause();
              spinner.currentTime = 0;
            }
          }
        }
      }
      stateRef3.current = requestAnimationFrame(handleAction);
    };
    stateRef3.current = requestAnimationFrame(handleAction);
    return () => {
      cancelAnimationFrame(stateRef3.current);
      if (options.audio.spinner) {
        options.audio.spinner.pause();
        options.audio.spinner.currentTime = 0;
        options.audio.spinner.volume = 0;
      }
    };
  }, [t]);
  return <div ref={elementRef} style={{
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    touchAction: "none",
    containerType: "size"
  }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onLostPointerCapture={handlePointerUp}>{<div ref={spinnerRef} className="asmr-spinner" style={{
      width: "min(90cqw, calc(100cqh - 24px))",
      maxWidth: "360px",
      aspectRatio: "1/1",
      position: "relative",
      flexShrink: 0
    }}>
    <img ref={elementRef2} data-spinner-layer="rotor" src={t.IMG_SPINNER} alt="Spinner" draggable={false} style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "contain",
      transformOrigin: "50% 50%",
      maskImage: "radial-gradient(circle closest-side at 50% 50%, transparent 23.7%, #000 24%)",
      WebkitMaskImage: "radial-gradient(circle closest-side at 50% 50%, transparent 23.7%, #000 24%)",
      willChange: "transform",
      pointerEvents: "none"
    }} />
    <img data-spinner-layer="fixed-cap" src={t.IMG_SPINNER} alt="" aria-hidden="true" draggable={false} style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "contain",
      clipPath: "circle(12.2% at 50% 50%)",
      zIndex: 1,
      pointerEvents: "none"
    }} />
    </div>}</div>;
}
function IF({cfg:t}) {
  const [activity,setActivity]=React.useState(0),[reset,setReset]=React.useState(0);
  const items=[{id:'bubble',label:t.TAB_BUBBLE,Component:useGameFeature1},{id:'sand',label:t.TAB_SAND,Component:useGameFeature2},{id:'spinner',label:t.TAB_SPINNER,Component:useGameFeature3}];
  const Activity=items[activity].Component;
  return <Motion.motion.div className="asmr-activities" onPointerDownCapture={event=>{if(event.isPrimary!==false&&!(event.button>0))void NF().catch(()=>{});}} initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}>
    <div className="asmr-tabs" role="tablist" aria-label="Choose an activity">
      {items.map((item,index)=><button key={item.id} type="button" role="tab" aria-selected={activity===index} className={activity===index?'selected':''} onClick={()=>setActivity(index)}>{item.label}</button>)}
    </div>
    <div className="asmr-stage"><Activity config={t} key={`${activity}-${reset}`}/></div>
    <div className="asmr-footer"><Motion.motion.button type="button" whileTap={{scale:.96}} onClick={()=>{setReset(value=>value+1);dy('light');}}>{t.BTN_RESET}</Motion.motion.button></div>
  </Motion.motion.div>;
}
function App() {
  let [currentValue, setCurrentValue] = React.useState(null);
  let [selection, setSelection] = React.useState("book");
  React.useEffect(() => {
    let value = !0;
    (async () => {
      let options2 = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value2 = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (value2.ok) {
          options2 = await value2.json();
        }
      } catch {}
      if (value) {
        setCurrentValue(PF(options2));
      }
    })();
    return () => {
      value = !1;
    };
  }, []);
  let handleAction = async () => {
    await NF();
    setSelection("book");
  };
  return currentValue ? <React.Fragment>{<style>{`
        @font-face {
          font-family: 'DynaPuff';
          src: url('./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2') format('woff2');
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
        :root {
          --font-display: "DynaPuff", "PingFang SC", system-ui, sans-serif;
          --font-body:    "DynaPuff", "PingFang SC", system-ui, sans-serif;
          --font-mono:    ui-monospace, Menlo, monospace;
          
          --c-pink-bg: #FFF0F5;
          --c-pink-light: #FFE4E8;
          --c-pink-mid: #FEC8D8;
          --c-pink-dark: #FF9AA2;
          --c-pink-accent: #FF8BA7;
        }
        html, body, #root {
          width: 100%; height: 100%; margin: 0; padding: 0;
          overflow: hidden;
          background-color: var(--c-pink-bg);
          font-family: var(--font-body);
          -webkit-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
        }
        * { box-sizing: border-box; }
      `}</style>}{<div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      containerType: "inline-size"
    }}>{<Motion.AnimatePresence mode={"wait"}>{<IF cfg={currentValue} key={"book"} />}</Motion.AnimatePresence>}</div>}</React.Fragment> : <div style={{
    width: "100%",
    height: "100%",
    backgroundColor: "#FFF0F5"
  }} />;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root [style*=\"grid-template-columns\"]",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root [style*=\"grid-template-columns\"]",
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
  const selectors = [];
  const copy = new Set(["Tap to Open"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
        "data-batch3-game": "12"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "12"
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
      if (target.closest('#root div[tabindex="0"],#root canvas,[data-bubble-index]')) return true;
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
