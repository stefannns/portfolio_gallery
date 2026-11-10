import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';

// Keep startup usable when the host stalls the local config request.
async function loadGameConfig() {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let deadline;
  try {
    const request = fetch('./game.config.json', { signal: controller?.signal }).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    const timeout = new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('timed out')), 1200);
    });
    const config = await Promise.race([request, timeout]);
    if (!config || typeof config !== 'object' || Array.isArray(config) ||
        ['tweaks', 'texts', 'images'].some(key => config[key] != null && !Array.isArray(config[key]))) {
      throw new Error('invalid config');
    }
    return config;
  } catch (error) {
    console.warn('[playable] Using packaged defaults:', error.message);
    return null;
  } finally {
    clearTimeout(deadline);
    controller?.abort();
  }
}

// Some hosts only notify the game through the window resize event.
function watchGameSize(container, resize) {
  resize();
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }
  window.addEventListener('resize', resize);
  return () => window.removeEventListener('resize', resize);
}

// The feed cover can animate without touching the real game state.
let inFeedCover = window.parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
if (inFeedCover) {
  document.documentElement.dataset.feedCover = 'true';
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    inFeedCover = event.data.active !== true;
    document.documentElement.dataset.feedCover = String(inFeedCover);
  });
}

const FONT_CSS = `
@font-face {
  font-family: 'Poppins';
  src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Poppins';
  src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

:root {
  --font-display: "Poppins", "PingFang SC", system-ui, sans-serif;
  --font-body:    "Poppins", "PingFang SC", system-ui, sans-serif;
  --font-mono:    ui-monospace, Menlo, monospace;
}
`;
const DEFAULT = { RUN_LENGTH:435, CRUISE_SPEED:22, BRAKE_SPEED:9, GATE_POINTS:100, MISS_PENALTY:30, GUIDE:'Drag to carve', BRAKE:'Brake', FINISH:'Run complete', TIME:'Time', POINTS:'Points', BEST:'Personal best', REPLAY:'Run again', BLUE:'Blue Run', BLACK:'Black Run', CLEAN:'Clean!', MISSED:'Missed' };
const sound = (key, once=false) => { try { if(window.SFX) once ? window.SFX.playOnce(key) : window.SFX.play(key); } catch(e) {} };
const readBest = () => { try { return JSON.parse(localStorage.getItem('alpine-best-v3') || '{}'); } catch(e) { return {}; } };
const fresh = (route='blue') => ({ phase:'ready', route, z:0, x:0, speed:0, elapsed:0, score:0, steering:0, drag:0, keys:{}, braking:false, gateIndex:0, feedback:'', feedbackUntil:0, lastCarve:0, lastBump:0, pointer:null, completed:false, spray:0 });
// Use the same profile for the piste, scenery and skier.
const slopeHeight = z => z * .14 + 1.2 * Math.sin(z / 13) + .65 * Math.sin(z / 7);
const slopeGrade = z => (slopeHeight(z + 1) - slopeHeight(z - 1)) / 2;
const gateData = (route, length) => {
  const advanced = route === 'black';
  const turns = advanced ? [4.6, -4.6, 5, -5, 4, -4] : [3.5, -3.3, 3.6, -3.4, 2.8, -3.1];
  const count = Math.max(2, Math.round((length - 31) / 19) + 1);
  return Array.from({length:count}, (_, i) => ({
    x: i === 0 || i === count - 1 ? 0 : turns[(i - 1) % turns.length],
    z: -(16 + i * ((length - 31) / (count - 1))),
    width: advanced ? 4.6 : 5.8,
  }));
};
function usePost() {
  const [submitting,setSubmitting] = useState(false); const lock = useRef(false);
  const can = typeof tt !== 'undefined' && typeof tt.playableRecordingSubmission === 'function';
  useEffect(()=>{ const restore=()=>{lock.current=false;setSubmitting(false)}; const visible=()=>{if(document.visibilityState==='visible')restore()}; document.addEventListener('visibilitychange',visible);window.addEventListener('pageshow',restore);return()=>{document.removeEventListener('visibilitychange',visible);window.removeEventListener('pageshow',restore)} },[]);
  const submit=()=>{if(lock.current || !can)return; lock.current=true;setSubmitting(true);sound('click'); try { tt.playableRecordingSubmission({success(){},fail(err){console.error('[post_my_play] submission failed',err && (err.errMsg || err.message));lock.current=false;setSubmitting(false)},complete(){}}); } catch(err){console.error('[post_my_play] submission failed',err); lock.current=false;setSubmitting(false)} };
  return {can,submitting,submit};
}
function App(){
  const [cfg,setCfg]=useState(null); const [ui,setUi]=useState({phase:'ready',route:'blue',speed:0,time:0,score:0,feedback:'',x:0,z:0}); const [intro,setIntro]=useState(true); const [best,setBest]=useState(readBest); const [braking,setBraking]=useState(false);
  const host=useRef(null), world=useRef(null), game=useRef(fresh()), cfgRef=useRef(DEFAULT), bestRef=useRef(best); const post=usePost();
  useEffect(()=>{ if(window.SFX) window.SFX.register({carve:'buzzer',brake:'buzzer',gate:'buzzer',miss:'buzzer',bump:'./assets/sfx_bump.mp3',click:'./assets/sfx_click.mp3',finish:'./assets/sfx_finish.mp3'}); loadGameConfig().then(config=>{const d=config||{};const c={...DEFAULT}; for(const v of [...(d.tweaks||[]),...(d.texts||[])])c[v.id]=v.value;for(const v of (d.images||[]))c[v.id]=v.path;cfgRef.current=c;setCfg(c)}) },[]);
  useEffect(()=>{bestRef.current=best},[best]);
  useEffect(()=>{
    if(!cfg || !host.current)return;
    const container=host.current; let renderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch(e){console.error('WebGL unavailable',e);return}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2)); renderer.outputColorSpace=THREE.SRGBColorSpace; container.appendChild(renderer.domElement);
    const scene=new THREE.Scene(); scene.fog=new THREE.Fog(0xc9e4ef,65,205);
    const camera=new THREE.PerspectiveCamera(58,1,.1,500); const hemi=new THREE.HemisphereLight(0xffffff,0x91b8cc,1.15);scene.add(hemi);
    const light=new THREE.DirectionalLight(0xffffff,1.15);light.position.set(-30,80,30);scene.add(light);
    const mat=(c)=>new THREE.MeshLambertMaterial({color:c}); const snow=mat(0xeaf6f8), blueSnow=mat(0xc5dfea), treeDark=mat(0x285e65), treeLight=mat(0x3c7778), white=mat(0xf4fbfc), wood=mat(0x5d777b);
    function mesh(geo, material, x,y,z, parent=scene){const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);parent.add(m);return m}
    function pisteStrip(width, x, heightOffset, material) {
      const pisteLength = cfg.RUN_LENGTH + 120;
      const geometry = new THREE.PlaneGeometry(width, pisteLength, 1, Math.ceil(pisteLength / 2));
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(x, 0, 30 - pisteLength / 2);
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        positions.setY(i, slopeHeight(positions.getZ(i)) + heightOffset);
      }
      geometry.computeVertexNormals();
      mesh(geometry, material, 0, 0, 0);
    }
    pisteStrip(110, 0, 0, blueSnow);
    pisteStrip(22, 0, .015, snow);
    const corduroy = mat(0xd4e9f1);
    for (let i = -5; i <= 5; i++) pisteStrip(.12, i * 2, .03, corduroy);
    for(let i=0;i<Math.ceil((cfg.RUN_LENGTH+60)/9);i++){
      const side=i%2?1:-1, z=-8-i*9, x=side*(15+(i%4)*3);
      const tree=new THREE.Group(); tree.position.set(x,slopeHeight(z),z);scene.add(tree);
      mesh(new THREE.CylinderGeometry(.16,.22,1.4,6),wood,0,.7,0,tree);
      for(let j=0;j<3;j++){ const cone=mesh(new THREE.ConeGeometry(1.65-j*.28,2.6,6),j%2?treeLight:treeDark,0,1.8+j*.95,0,tree); cone.rotation.y=.4; const cap=mesh(new THREE.ConeGeometry(1.05-j*.18,1.15,6),white,0,2.65+j*.95,0,tree);cap.rotation.y=.4; }
      tree.scale.setScalar(.8+(i%3)*.22);
    }
    // Polygonal distant mountains sit on the horizon.
    const mountainMats=[mat(0x9ebdce),mat(0xb8d4e1),mat(0xd7ebf0)];
    const mountains = new THREE.Group();
    scene.add(mountains);
    const mountainDistance = 228;
    for (let i = 0; i < 9; i++) {
      const x = (i - 4) * 37;
      const height = 42 + (i % 3) * 10;
      const peak = mesh(new THREE.ConeGeometry(33, height, 4), mountainMats[i % 3],
        x, height / 2, 0, mountains);
      peak.rotation.y = Math.PI / 4;
      const cap = mesh(new THREE.ConeGeometry(16.5, height / 2, 4), white,
        x, height * .75, -.08, mountains);
      cap.scale.set(1.005, 1.005, 1.005);
      cap.rotation.y = Math.PI / 4;
    }
    // A thin cable and small gondolas, far off the slope.
    const cable=mesh(new THREE.CylinderGeometry(.035,.035,95,5),mat(0x65818a),-32,slopeHeight(-85)+18,-85);cable.rotation.z=Math.PI/2; cable.rotation.x=.14;
    for(let i=0;i<4;i++){let g=new THREE.Group();g.position.set(-61+i*20,slopeHeight(-85)+16,-85);scene.add(g);mesh(new THREE.BoxGeometry(1.6,1.3,.8),mat(0x536e78),0,0,0,g);mesh(new THREE.BoxGeometry(1.25,.55,.85),mat(0xa6ccd9),0,.15,0,g);mesh(new THREE.CylinderGeometry(.04,.04,1.4,5),mat(0x536e78),0,1.3,0,g)}
    const routeGroup=new THREE.Group();scene.add(routeGroup); const tracks=new THREE.Group();scene.add(tracks);
    const gateRed=mat(0xf15b54), gateBlue=mat(0x2d95ca), poleMat=mat(0xf9ffff), finishMat=mat(0x193f55);
    const trackGeometry=new THREE.PlaneGeometry(.09,1.4), trackMaterial=mat(0xa4c9d7);
    let gates=[];
    function makeRoute(route){
      while(routeGroup.children.length)routeGroup.remove(routeGroup.children[0]); while(tracks.children.length)tracks.remove(tracks.children[0]);
      gates=gateData(route, cfgRef.current.RUN_LENGTH);
      gates.forEach((gate, index) => {
        const color = index % 2 ? gateRed : gateBlue;
        const height = slopeHeight(gate.z);
        for (const side of [-1, 1]) {
          const x = gate.x + side * gate.width / 2;
          mesh(new THREE.CylinderGeometry(.055, .055, 2.9, 6), poleMat, x, height + 1.45, gate.z, routeGroup);
          const flag = mesh(new THREE.PlaneGeometry(1.05, .8), color, x + side * .53, height + 2.2, gate.z, routeGroup);
          flag.material.side = THREE.DoubleSide;
        }
      });
      const fz=-cfgRef.current.RUN_LENGTH, finishHeight=slopeHeight(fz); for(let side of [-1,1]){let x=side*7;mesh(new THREE.CylinderGeometry(.1,.1,4,7),finishMat,x,finishHeight+2,fz,routeGroup)}
      for(let i=0;i<14;i++){const c=mesh(new THREE.BoxGeometry(1,0.65,.1),i%2?white:finishMat,-6.5+i,finishHeight+3.8,fz,routeGroup)}
      for(let i=0;i<14;i++){const c=mesh(new THREE.PlaneGeometry(1,.9),i%2?white:finishMat,-6.5+i,finishHeight+.04,fz,routeGroup);c.rotation.x=-Math.PI/2-Math.atan(slopeGrade(fz))}
      // Soft powder mounds just outside the groomed line.
      for(let i=0;i<Math.ceil((cfgRef.current.RUN_LENGTH+30)/11);i++){let side=i%2?1:-1;const z=-12-i*11;let b=mesh(new THREE.SphereGeometry(1.25,7,4),blueSnow,side*(11+(i%3)*1.2),slopeHeight(z)+.1,z,routeGroup);b.scale.set(1.5,.42,1)}
    }
    makeRoute(game.current.route); let lastTrackZ=0,last=0,lastUi=0,raf=0,coverTime=0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const resize=()=>{const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}; const unwatchSize=watchGameSize(container,resize);
    function finish(g){if(g.completed)return;g.completed=true;g.phase='result';g.braking=false;setBraking(false);sound('finish',true);const n={...bestRef.current};if(!n[g.route]||g.elapsed<n[g.route])n[g.route]=g.elapsed;bestRef.current=n;setBest(n);try{localStorage.setItem('alpine-best-v3',JSON.stringify(n))}catch(e){} console.log('[ski] finish',g.route,g.elapsed.toFixed(2),g.score);}
    function update(t){raf=requestAnimationFrame(update);const dt=last?Math.min((t-last)/1000,.032):.016;last=t;const g=game.current,c=cfgRef.current;
      if (document.hidden) return;
      if (g.phase==='playing' && !inFeedCover){
        g.elapsed+=dt;const key=(g.keys.ArrowRight?1:0)-(g.keys.ArrowLeft?1:0);const target=key||g.drag;g.steering+=(target-g.steering)*Math.min(1,dt*7.5);
        const desired=g.braking?c.BRAKE_SPEED:c.CRUISE_SPEED*(g.route==='black'?1.12:1)*(.83+Math.max(0,slopeGrade(g.z))*1.15);g.speed+=(desired-g.speed)*Math.min(1,dt*(g.braking?2.5:.6));
        // Higher speed has a wider turn radius, while braking restores agility.
        const agility=12.2/(.55+g.speed/18);g.x+=g.steering*agility*dt;g.x=Math.max(-13,Math.min(13,g.x));g.z-=g.speed*dt;
        if(Math.abs(g.x)>9.8 && t-g.lastBump>1300){g.speed*=.72;g.x=Math.sign(g.x)*9.5;g.lastBump=t;g.spray=1;sound('bump');}
        while(g.gateIndex<gates.length && -g.z>=-gates[g.gateIndex].z){const gate=gates[g.gateIndex++];const clean=Math.abs(g.x-gate.x)<gate.width/2;if(clean){g.score+=c.GATE_POINTS+(g.speed<19?20:0);g.feedback=c.CLEAN;sound('gate')}else{g.score-=c.MISS_PENALTY;g.feedback=c.MISSED;sound('miss')}g.feedbackUntil=t+900;console.log('[ski] gate',g.gateIndex,clean,g.score);}
        if(t>g.feedbackUntil)g.feedback='';if(-g.z>=c.RUN_LENGTH)finish(g);
        if(Math.abs(g.z-lastTrackZ)>1.2){lastTrackZ=g.z;for(const dx of [-.28,.28]){const track=mesh(trackGeometry,trackMaterial,g.x+dx,slopeHeight(g.z+1)+.05,g.z+1,tracks);track.rotation.x=-Math.PI/2-Math.atan(slopeGrade(g.z+1));}while(tracks.children.length>100)tracks.remove(tracks.children[0]);}
        g.spray=Math.max(0,g.spray-dt*2);
      }
      const showDemo = inFeedCover && g.phase === 'ready' && !reducedMotion.matches;
      if (showDemo) coverTime += dt;
      const drift = showDemo ? Math.sin(coverTime * 1.9) : 0;
      const viewX = g.x + drift * .7;
      const viewZ = g.z - (showDemo ? (1 - Math.cos(coverTime * 1.9)) * 1.4 : 0);
      const mountainZ = viewZ - mountainDistance;
      mountains.position.set(0, slopeHeight(mountainZ) - 6, mountainZ);
      camera.position.set(viewX, slopeHeight(viewZ + 4) + 2.3, viewZ + 4);
      camera.lookAt(viewX + g.steering * 1.2 + drift * .9, slopeHeight(viewZ - 24) + 1.25, viewZ - 24);
      camera.rotateZ(-g.steering * .065 - drift * .035);
      container.parentElement.style.setProperty('--cover-lean', `${drift * 5}deg`);
      renderer.render(scene,camera);
      if(t-lastUi>120){lastUi=t;setUi({phase:g.phase,route:g.route,speed:Math.round(g.speed*2.2),time:g.elapsed,score:g.score,feedback:g.feedback,x:g.x,z:g.z,spray:g.spray,steering:g.steering,gateIndex:g.gateIndex});}
    }
    raf=requestAnimationFrame(update);world.current={makeRoute,resetTracks:()=>{lastTrackZ=0}};
    return()=>{cancelAnimationFrame(raf);unwatchSize();world.current=null;trackGeometry.dispose();trackMaterial.dispose();renderer.dispose();container.removeChild(renderer.domElement);scene.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose()}})};
  },[cfg]);
  function start(){const g=game.current;if(g.phase==='ready'){g.phase='playing';g.speed=8;setIntro(false);console.log('[ski] started',g.route)}}
  function down(e){if(inFeedCover || e.isPrimary===false || e.button>0 || e.target.closest('button') || game.current.phase==='result')return;const g=game.current;g.pointer={id:e.pointerId,x:e.clientX};try{e.currentTarget.setPointerCapture(e.pointerId)}catch(_){} }
  function move(e){const g=game.current;if(!g.pointer||g.pointer.id!==e.pointerId)return;const delta=e.clientX-g.pointer.x;if(Math.abs(delta)>4){start();g.drag=Math.max(-1,Math.min(1,delta/85));if(Math.abs(g.drag)>.55 && performance.now()-g.lastCarve>850){g.lastCarve=performance.now();g.spray=1;sound('carve')}}}
  function up(e){const g=game.current;if(g.pointer&&g.pointer.id===e.pointerId){g.pointer=null;g.drag=0}}
  useEffect(()=>{const kd=e=>{if(['ArrowLeft','ArrowRight','Space'].includes(e.code)){e.preventDefault();const g=game.current;if(g.phase==='result')return;if(e.code==='Space'){if(g.phase==='playing'&&!g.braking){g.braking=true;g.spray=1;setBraking(true);sound('brake')} }else{if(!g.keys[e.code]){start();sound('carve')}g.keys[e.code]=true}}};const ku=e=>{const g=game.current;if(e.code==='Space'){g.braking=false;setBraking(false)}else g.keys[e.code]=false};window.addEventListener('keydown',kd);window.addEventListener('keyup',ku);const vis=()=>{if(document.visibilityState!=='visible'){game.current.braking=false;game.current.keys={};game.current.drag=0;setBraking(false)}};document.addEventListener('visibilitychange',vis);return()=>{window.removeEventListener('keydown',kd);window.removeEventListener('keyup',ku);document.removeEventListener('visibilitychange',vis)}},[]);
  function brakeDown(e){e.stopPropagation();const g=game.current;if(g.phase!=='playing'||g.braking)return;g.braking=true;g.spray=1;setBraking(true);sound('brake');try{e.currentTarget.setPointerCapture(e.pointerId)}catch(_){}}
  function brakeUp(e){e.stopPropagation();game.current.braking=false;setBraking(false)}
  function restart(route){sound('click');if(window.SFX)window.SFX.reset();game.current=fresh(route);setIntro(true);setBraking(false);world.current?.makeRoute(route);world.current?.resetTracks();setUi({phase:'ready',route,speed:0,time:0,score:0,feedback:'',x:0,z:0});console.log('[ski] reset',route)}
  const fmt=t=>typeof t==='number'?t.toFixed(1)+'s':'—';
  return <div className="app" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} data-phase={ui.phase} data-route={ui.route} data-x={ui.x.toFixed(2)} data-z={ui.z.toFixed(2)} data-gates={ui.gateIndex||0} data-score={ui.score}>
    <style>{FONT_CSS+`
      *{box-sizing:border-box} .app{position:relative;width:100%;height:100%;overflow:clip;touch-action:none;background:linear-gradient(180deg,#77b9db 0%,#c6e6f1 47%,#edf8fa 70%);font-family:var(--font-body);color:#163f53;user-select:none} .scene{position:absolute;inset:0}.scene canvas{display:block;width:100%;height:100%}
      .guide{position:absolute;top:24%;left:30px;right:30px;text-align:center;pointer-events:none;color:#173f56;font-family:var(--font-display);font-size:18px;font-weight:700;text-shadow:0 2px 9px #fff,0 1px 2px #fff;animation:breathe 2.4s ease-in-out infinite}
      [data-feed-cover="true"] .skis{bottom:18%;height:25%;width:min(53%,220px);transform:translateX(-50%) rotate(var(--cover-lean,0deg))}
      @keyframes breathe{0%,100%{opacity:.78}50%{opacity:1}} @media(prefers-reduced-motion:reduce){.guide{animation:none}}
      .hud{position:absolute;top:30px;left:30px;right:30px;display:flex;justify-content:space-between;align-items:flex-start;color:#173f56;font-family:var(--font-display);font-size:22px;font-weight:700;line-height:1;text-shadow:0 1px 6px #fff}.hud small{font-size:12px;font-weight:700;margin-left:3px}.feedback{position:absolute;top:24%;left:50%;transform:translateX(-50%);font-family:var(--font-display);font-size:20px;font-weight:700;white-space:nowrap;color:#174961;text-shadow:0 2px 6px #fff}
      .skis{position:absolute;bottom:-3%;left:50%;transform:translateX(-50%) rotate(var(--lean));width:min(66%,280px);height:28%;pointer-events:none;transition:transform .15s ease-out;filter:drop-shadow(0 4px 4px #477d8b55)}.skis svg{width:100%;height:100%;overflow:visible}.spray{position:absolute;bottom:7%;left:50%;transform:translateX(-50%);width:80%;height:25%;pointer-events:none;opacity:var(--spray);transition:opacity .2s}
      .brake{position:absolute;bottom:50px;right:30px;border:1px solid #ffffffb8;background:#f4fbfbd9;color:#1a5068;border-radius:50%;width:72px;height:72px;box-shadow:0 5px 18px #164c6640;font-family:var(--font-display);font-size:14px;font-weight:700;touch-action:none}.brake.active{background:#2d87a8;color:white;transform:scale(.96)}
      .result-shade{position:absolute;inset:0;background:linear-gradient(180deg,#163b4bb8,#174859c9);display:flex;align-items:center;justify-content:center;padding:24px}.result{width:min(100%,330px);text-align:center;color:white}.result h1{font-family:var(--font-display);font-size:24px;line-height:1.2;margin:0 0 5px}.route-name{font-size:14px;color:#b7e6f4;margin-bottom:22px}.stats{display:flex;justify-content:center;gap:40px;margin-bottom:20px}.stat span{display:block;font-size:12px;color:#c4e7ef}.stat strong{font-family:var(--font-display);font-size:28px}.best{border-top:1px solid #ffffff55;padding-top:14px;margin-bottom:20px;font-size:12px}.best-head{font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#a9d6e2;margin-bottom:8px}.best-row{display:flex;justify-content:space-between;padding:3px 15px}.actions{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}.action{min-height:46px;border:0;border-radius:24px;padding:0 18px;font-family:var(--font-display);font-weight:700;font-size:13px;color:#174b60;background:#fff}.action.secondary{background:#82cbe2}.action:disabled{opacity:.55;pointer-events:none}
    `}</style>
    <div className="scene" ref={host}/>
    {intro&&ui.phase==='ready'&&cfg&&<div className="guide">{cfg.GUIDE}</div>}
    {ui.phase!=='result'&&<><div className="skis" style={{'--lean':`${(ui.steering||0)*-5}deg`}}><svg viewBox="0 0 220 180" preserveAspectRatio="none"><path d="M45 190 L64 50 Q68 17 80 18 Q92 19 91 49 L88 190Z" fill="#173e54" stroke="#d5f1f6" strokeWidth="3"/><path d="M63 150 L73 42 Q76 27 80 28 Q84 29 83 43 L78 150Z" fill="#f66c4f"/><path d="M132 190 L129 49 Q128 19 140 18 Q152 17 156 50 L175 190Z" fill="#173e54" stroke="#d5f1f6" strokeWidth="3"/><path d="M142 150 L137 43 Q136 29 140 28 Q144 27 147 42 L157 150Z" fill="#f66c4f"/></svg></div><svg className="spray" style={{'--spray':ui.spray||0}} viewBox="0 0 300 150"><g fill="#fff" opacity=".9"><circle cx="27" cy="110" r="4"/><circle cx="55" cy="76" r="3"/><circle cx="86" cy="115" r="6"/><circle cx="250" cy="90" r="5"/><circle cx="275" cy="120" r="3"/><circle cx="220" cy="68" r="3"/><circle cx="190" cy="120" r="5"/></g></svg></>}
    {ui.phase==='playing'&&<><div className="hud"><div>{ui.speed}<small>km/h</small></div><div>{fmt(ui.time)}</div></div>{ui.feedback&&<div className="feedback">{ui.feedback}</div>}<button className={'brake '+(braking?'active':'')} onPointerDown={brakeDown} onPointerUp={brakeUp} onPointerCancel={brakeUp} onLostPointerCapture={brakeUp}>{cfg.BRAKE}</button></>}
    {ui.phase==='result'&&<div className="result-shade"><div className="result"><h1>{cfg.FINISH}</h1><div className="route-name">{ui.route==='blue'?cfg.BLUE:cfg.BLACK}</div><div className="stats"><div className="stat"><span>{cfg.TIME}</span><strong>{fmt(ui.time)}</strong></div><div className="stat"><span>{cfg.POINTS}</span><strong>{ui.score}</strong></div></div><div className="best"><div className="best-head">{cfg.BEST}</div><div className="best-row"><span>{cfg.BLUE}</span><b>{fmt(best.blue)}</b></div><div className="best-row"><span>{cfg.BLACK}</span><b>{fmt(best.black)}</b></div></div><div className="actions"><button className="action" onClick={()=>restart(ui.route)}>{cfg.REPLAY}</button><button className="action secondary" onClick={()=>restart(ui.route==='blue'?'black':'blue')}>{ui.route==='blue'?cfg.BLACK:cfg.BLUE}</button>{post.can&&<button className="action" disabled={post.submitting} style={{opacity:post.submitting?.55:1,pointerEvents:post.submitting?'none':'auto'}} onClick={post.submit}>Post my play</button>}</div></div></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);