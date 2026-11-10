import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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

const defaults = {WAIT_TIME:1.55,WINDUP_TIME:.65,LUNGE_TIME:.48,DRAG_SENSITIVITY:.011,GUIDE:'Drag to dodge!',CAUGHT:'Caught!',BEST:'BEST',AGAIN:'Play again'};
const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
const play = (key,once=false)=> { try { if(window.SFX) once ? window.SFX.playOnce(key) : window.SFX.play(key); } catch(e) {} };
if(window.SFX) window.SFX.register({swish:'buzzer',wood:'./assets/sfx_wood.mp3',catch:'buzzer',best:'./assets/sfx_best.mp3',click:'./assets/sfx_click.mp3'}); // wood: strong wood impact; best: record chime; click: replay

function App(){
 const [cfg,setCfg]=useState(defaults), [ready,setReady]=useState(false), [phase,setPhase]=useState('intro'), [time,setTime]=useState(0), [best,setBest]=useState(0), [submitting,setSubmitting]=useState(false);
 const mount=useRef(null), state=useRef({phase:'intro',elapsed:0,tx:0,ty:0,drag:null,broken:0}), cfgRef=useRef(defaults), replayRef=useRef(null), submitRef=useRef(false);
 useEffect(()=>{loadGameConfig().then(config=>{const j=config||{};const c={...defaults}; [...(j.tweaks||[]),...(j.texts||[])].forEach(v=>c[v.id]=v.value); cfgRef.current=c;setCfg(c);setReady(true)});},[]);
 useEffect(()=>{const restore=()=>{submitRef.current=false;setSubmitting(false)};const visible=()=>{if(document.visibilityState==='visible')restore()};document.addEventListener('visibilitychange',visible);window.addEventListener('pageshow',restore);return()=>{document.removeEventListener('visibilitychange',visible);window.removeEventListener('pageshow',restore)}},[]);
 useEffect(()=>{
  if(!ready || !mount.current)return;
  const host=mount.current, scene=new THREE.Scene(); scene.background=new THREE.Color('#f3e3cb');
  const camera=new THREE.OrthographicCamera(-3.2,3.2,4.8,-.3,.1,100);
  camera.position.set(6.32,4.51,10);camera.lookAt(-.18,2.31,.1);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=false;host.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xfff5db,0x9f866b,2.1)); const sun=new THREE.DirectionalLight(0xfff1d6,2.5);sun.position.set(-4,8,8);sun.castShadow=false;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-6;sun.shadow.camera.right=6;sun.shadow.camera.top=8;sun.shadow.camera.bottom=-5;scene.add(sun);
  const mat=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.85,...extra});
  const colors={wood:mat('#a95b2f'),woodLight:mat('#d48b4b'),woodDark:mat('#703b26'),cream:mat('#f8e6c8'),red:mat('#c43f36'),redLight:mat('#e5594b'),blue:mat('#528f9b'),navy:mat('#304e59'),skin:mat('#d49a72'),skin2:mat('#e6ae86'),white:mat('#fff5df'),pink:mat('#ed9eaa'),dark:mat('#372c2a'),gold:mat('#d4a054'),metal:mat('#9cabb1',{metalness:.65,roughness:.35})};
  const cartGreen=mat('#376b64'), cartTrim=mat('#5e8f7f'), rubber=mat('#413638');
  const hair=mat('#51312a'), blush=mat('#c68168'), clothEdge=mat('#ded3b8');
  function roundedBox(parent,w,h,d,x,y,z,material,radius) {
   const mesh=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,1,radius),material);
   mesh.position.set(x,y,z);
   parent.add(mesh);
   return mesh;
  }
  const box=(parent,w,h,d,x,y,z,m,rot=0)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.rotation.z=rot;o.castShadow=true;o.receiveShadow=true;parent.add(o);return o};
  const sphere=(parent,r,x,y,z,m,scale=[1,1,1],segments=12)=>{const o=new THREE.Mesh(new THREE.SphereGeometry(r,segments,8),m);o.position.set(x,y,z);o.scale.set(...scale);o.castShadow=true;parent.add(o);return o};
  const cyl=(parent,rt,rb,h,x,y,z,m,n=10)=>{const o=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,n),m);o.position.set(x,y,z);o.castShadow=true;parent.add(o);return o};
  const segment=(parent,a,b,r,m)=>{let v=new THREE.Vector3().subVectors(b,a);const o=cyl(parent,r,r,v.length(),(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2,m,8);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());return o};
  // Tiled wall, raised sidewalk, and the asphalt street in the foreground.
  box(scene,16,10,.2,0,3,-2.3,colors.cream);
  box(scene,30,.12,14,0,-.229,8.99,mat('#62646a',{roughness:1}));
  box(scene,16,.12,4,0,-.12,0,mat('#e4c19a'));
  box(scene,16,.13,.12,0,-.12,1.96,mat('#c8b69e'));
  box(scene,16,1.05,.03,0,.53,-2.16,colors.blue);
  for(let x=-7.5;x<8;x+=.48){for(let y=.18;y<1;y+=.43){box(scene,.37,.34,.025,x,y,-2.12,colors.white);box(scene,.14,.14,.03,x,y,-2.09,colors.blue,Math.PI/4);}}
  box(scene,16,.07,.05,0,1.07,-2.1,colors.navy);
  const shadowCanvas=document.createElement('canvas');
  shadowCanvas.width=shadowCanvas.height=32;
  const shadowContext=shadowCanvas.getContext('2d');
  const shadowGradient=shadowContext.createRadialGradient(16,16,1,16,16,16);
  shadowGradient.addColorStop(0,'#48302d80');
  shadowGradient.addColorStop(.55,'#48302d45');
  shadowGradient.addColorStop(1,'#48302d00');
  shadowContext.fillStyle=shadowGradient;
  shadowContext.fillRect(0,0,32,32);
  const shadowTexture=new THREE.CanvasTexture(shadowCanvas);
  shadowTexture.colorSpace=THREE.SRGBColorSpace;
  const shadowMaterial=new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false});
  function groundShadow(parent,x,z,w,d) {
   const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,d),shadowMaterial);
   mesh.rotation.x=-Math.PI/2;
   mesh.position.set(x,-.056,z);
   parent.add(mesh);
  }
  // A solid, deep wooden pushcart with a real counter and striped canopy.
  const stall=new THREE.Group();scene.add(stall);
  const base=new THREE.Group();stall.add(base);
  groundShadow(base,0,-.12,3.95,2.55);
  roundedBox(base,2.9,1.05,1.38,0,.94,-.15,cartGreen,.10);
  roundedBox(base,3.12,.18,1.60,0,1.52,-.15,colors.woodDark,.066);
  roundedBox(base,3.07,.09,1.55,0,1.61,-.15,colors.woodLight,.042);
  for(const x of [-.94,.94]) roundedBox(base,.76,.68,.065,x,.95,.55,cartTrim,.03);
  for(const x of [-1,1]) roundedBox(base,.065,.68,1.05,x*1.45,.95,-.15,cartTrim,.03);
  const badge=cyl(base,.32,.32,.045,0,.98,.564,colors.cream,16);
  badge.rotation.x=Math.PI/2;
  cyl(base,.095,.014,.215,0,.925,.601,colors.wood,10);
  sphere(base,.102,0,1.07,.61,colors.redLight,[1,.93,.47]);
  for(const x of [-1.15,1.15]) {
   const axle=cyl(base,.049,.049,1.64,x,.34,-.15,colors.metal,8);
   axle.rotation.x=Math.PI/2;
   for(const side of [-1,1]) {
    const wheel=cyl(base,.36,.36,.16,x,.34,-.15+side*.79,rubber,16);
    wheel.rotation.x=Math.PI/2;
    const rim=cyl(base,.25,.25,.03,x,.34,-.15+side*.88,colors.woodLight,14);
    rim.rotation.x=Math.PI/2;
    if(side<0)continue;
    for(let spoke=0;spoke<5;spoke++) {
     const angle=spoke*Math.PI*2/5;
     box(base,.042,.156,.025,x-Math.sin(angle)*.142,.34+Math.cos(angle)*.142,.746,colors.woodDark,angle);
    }
    const hub=cyl(base,.091,.091,.066,x,.34,.763,colors.woodDark,12);
    hub.rotation.x=Math.PI/2;
   }
  }
  const breakables=[base];
  for(const x of [-1.35,1.35]) {
   const supports=new THREE.Group();stall.add(supports);
   for(const z of [-.73,.43]) {
    roundedBox(supports,.135,2.42,.145,x,2.83,z,colors.woodDark,.021);
    roundedBox(supports,.18,.13,.19,x,1.715,z,colors.woodLight,.02);
   }
   breakables.push(supports);
  }
  const canopy=new THREE.Group();stall.add(canopy);breakables.push(canopy);
  for (const direction of [-1,1]) {
   for(let i=0;i<10;i++) {
    const panel=box(canopy,.32,.085,.92,-1.44+i*.32,4.16,-.15+direction*.43,i%2?colors.cream:colors.red);
    panel.rotation.x=direction*.35;
   }
  }
  for(let i=0;i<10;i++) roundedBox(canopy,.31,.22,.085,-1.44+i*.32,3.916,.727,i%2?colors.cream:colors.red,.035);
  // Three recessed-looking ice-cream tubs sit together on the broader counter.
  for(const [i,x] of [-.76,0,.76].entries()) {
   const flavor=[colors.pink,colors.white,colors.gold][i];
   cyl(base,.27,.25,.12,x,1.71,-.12,colors.metal,14);
   cyl(base,.28,.28,.024,x,1.77,-.12,colors.white,14);
   sphere(base,.246,x,1.77,-.12,flavor,[1,.21,1],14);
  }
  // Sculpted heads, layered clothing, and two arms per character.
  function person(x,skin,shirt,pants) {
   const g=new THREE.Group();g.position.set(x,0,1.02);scene.add(g);
   groundShadow(scene,x,1.02,.98,.76);
   for(const side of [-1,1]) {
    const leg=cyl(g,.14,.13,.69,side*.19,.43,0,pants,10);leg.rotation.z=side*.035;
    const shoeX=side*.19;
    roundedBox(g,.31,.062,.42,shoeX,.03,.082,rubber,.028);
    sphere(g,.17,shoeX,.105,.068,colors.dark,[.89,.56,1.28],12);
    sphere(g,.118,side*.315,1.53,.025,shirt,[1,1.12,1],10);
   }
   roundedBox(g,.73,.97,.48,0,1.235,0,shirt,.16);
   cyl(g,.14,.16,.11,0,1.718,.014,shirt,12);
   cyl(g,.128,.144,.17,0,1.777,.02,skin,12);
   sphere(g,.39,0,2.03,.02,skin,[1,1.1,.92],20);
   for(const side of [-1,1]) {
    sphere(g,.075,side*.373,2.015,.015,skin,[.76,1,.73],10);
    sphere(g,.042,side*.403,2.015,.042,blush,[.40,1,.61],10);
    sphere(g,.042,side*.137,2.087,.355,colors.dark,[.82,1.25,.46],10);
    sphere(g,.011,side*.137+.008,2.103,.372,colors.white,[1,1,.50],8);
    const brow=sphere(g,.058,side*.137,2.161,.337,hair,[1,.29,.33],10);
    brow.rotation.z=side*.13;
    sphere(g,.054,side*.237,1.991,.293,blush,[1,.58,.34],10);
   }
   sphere(g,.066,0,2.007,.371,skin,[.88,.89,.96],12);
   const smile=new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.069,1.925,.365),
    new THREE.Vector3(0,1.898,.366),
    new THREE.Vector3(.069,1.925,.365),
   ]);
   g.add(new THREE.Mesh(new THREE.TubeGeometry(smile,8,.011,5,false),hair));
   return g;
  }
  function makeHand(parent,skin) {
   const hand=new THREE.Group();parent.add(hand);
   sphere(hand,.105,0,0,0,skin,[.83,1,.85],12);
   sphere(hand,.051,-.056,.027,.052,skin,[1,1.2,.9],10);
   return hand;
  }
  function relaxedArm(character,side,shirt,skin) {
   const shoulder=new THREE.Vector3(side*.315,1.53,.035);
   const elbow=new THREE.Vector3(side*.47,1.23,.10);
   const wrist=new THREE.Vector3(side*.48,1.01,.16);
   segment(character,shoulder,elbow,.105,shirt);
   sphere(character,.103,elbow.x,elbow.y,elbow.z,shirt);
   segment(character,elbow,wrist,.073,skin);
   const hand=makeHand(character,skin);hand.position.copy(wrist);hand.rotation.y=side*.7;
  }
  const vendor=person(-1.75,colors.skin,colors.red,colors.navy);
  vendor.rotation.y=.48;relaxedArm(vendor,-1,colors.red,colors.skin);
  roundedBox(vendor,.58,.60,.074,0,1.116,.244,colors.white,.034);
  roundedBox(vendor,.275,.26,.075,0,1.415,.25,colors.white,.027);
  roundedBox(vendor,.66,.065,.075,0,1.26,.246,clothEdge,.022);
  roundedBox(vendor,.24,.17,.042,0,1.06,.285,clothEdge,.023);
  for(const side of [-1,1]) {
   box(vendor,.055,.245,.036,side*.14,1.56,.228,colors.white,side*.23);
   const curl=sphere(vendor,.084,side*.064,1.952,.366,hair,[1,.37,.49],12);
   curl.rotation.z=side*.21;
  }
  cyl(vendor,.365,.374,.061,0,2.385,.02,colors.woodDark,16);
  const hat=cyl(vendor,.318,.363,.21,0,2.495,.02,colors.red,16);
  hat.rotation.z=-.065;
  cyl(vendor,.352,.363,.055,0,2.434,.02,colors.redLight,16);
  const customer=person(1.83,colors.skin2,colors.blue,colors.woodDark);
  customer.rotation.y=-.31;relaxedArm(customer,1,colors.blue,colors.skin2);
  sphere(customer,.39,0,2.269,-.045,hair,[1.025,.49,1.06],16);
  for(const [x,y,z] of [[-.25,2.247,.21],[-.124,2.29,.268],[.008,2.301,.283],[.134,2.305,.254]]) {
   const lock=sphere(customer,.103,x,y,z,hair,[1.12,.58,.69],10);
   lock.rotation.z=.21;
  }
  roundedBox(customer,.18,.16,.038,.115,1.43,.244,cartTrim,.02);
  for(const side of [-1,1]) box(customer,.114,.051,.033,side*.07,1.63,.22,colors.cream,side*.37);

  // Articulated sleeves, forearms and hands share the rod and cone poses.
  const dynamic=new THREE.Group();scene.add(dynamic);
  function makeArm(shirt,skin) {
   return {
    upper:cyl(dynamic,.108,.115,1,0,0,0,shirt,10),
    cuff:sphere(dynamic,.105,0,0,0,shirt,[1,1,1],10),
    lower:cyl(dynamic,.082,.067,1,0,0,0,skin,10),
   };
  }
  const vendorArm=makeArm(colors.red,colors.skin);
  const customerArm=makeArm(colors.blue,colors.skin2);
  const hand=makeHand(dynamic,colors.skin);
  const rod=cyl(dynamic,.036,.044,1,0,0,0,colors.metal,10);
  const scoopDepth=1.16;
  const scoopCanvas=document.createElement('canvas');
  scoopCanvas.width=256;scoopCanvas.height=128;
  const scoopContext=scoopCanvas.getContext('2d');
  scoopContext.fillStyle='#efa2ae';
  scoopContext.fillRect(0,0,scoopCanvas.width,scoopCanvas.height);
  for(let i=0;i<440;i++) {
   scoopContext.fillStyle=i%2 ? '#b95f741e' : '#fff0dd38';
   const x=Math.random()*scoopCanvas.width, y=Math.random()*scoopCanvas.height;
   scoopContext.beginPath();
   scoopContext.arc(x,y,.6+Math.random()*2.1,0,Math.PI*2);
   scoopContext.fill();
  }
  const scoopTexture=new THREE.CanvasTexture(scoopCanvas);
  scoopTexture.colorSpace=THREE.SRGBColorSpace;
  const scoopMaterial=mat('#ffffff',{map:scoopTexture,roughness:.97});
  const scoop=new THREE.Group();dynamic.add(scoop);
  sphere(scoop,.249,0,.014,0,scoopMaterial,[1,.99,.96],18);
  for(let i=0;i<7;i++) {
   const angle=i*Math.PI*2/7;
   sphere(scoop,.102,.169*Math.cos(angle),-.082,.169*Math.sin(angle),scoopMaterial,[1,.64,1],10);
  }
  const coneGroup=new THREE.Group();dynamic.add(coneGroup);
  const coneProfile=[ [.018,-.51],[.183,-.019],[.183,.006],[.154,.006],[.151,-.037],[.03,-.442] ];
  const coneGeometry=new THREE.LatheGeometry(coneProfile.map(([x,y])=>new THREE.Vector2(x,y)),14);
  const waffleCanvas=document.createElement('canvas');waffleCanvas.width=waffleCanvas.height=128;
  const waffleContext=waffleCanvas.getContext('2d');
  waffleContext.fillStyle='#e5ae62';waffleContext.fillRect(0,0,128,128);
  waffleContext.strokeStyle='#b57d46';waffleContext.lineWidth=3;
  waffleContext.beginPath();
  for(let offset=-128;offset<=256;offset+=16) {
   waffleContext.moveTo(offset,0);waffleContext.lineTo(offset+64,128);
   waffleContext.moveTo(offset,0);waffleContext.lineTo(offset-64,128);
  }
  waffleContext.stroke();
  const waffleTexture=new THREE.CanvasTexture(waffleCanvas);waffleTexture.colorSpace=THREE.SRGBColorSpace;
  coneGroup.add(new THREE.Mesh(coneGeometry,mat('#ffffff',{map:waffleTexture})));
  const coneHand=makeHand(coneGroup,colors.skin2);
  coneHand.position.set(.09,-.2,.016);coneHand.rotation.y=.75;
  const upAxis=new THREE.Vector3(0,1,0), segmentDirection=new THREE.Vector3();
  function setSeg(mesh,a,b) {
   segmentDirection.subVectors(b,a);
   mesh.position.copy(a).add(b).multiplyScalar(.5);
   mesh.scale.y=segmentDirection.length();
   mesh.quaternion.setFromUnitVectors(upAxis,segmentDirection.normalize());
  }
  function poseArm(arm,shoulder,elbow,wrist) {
   setSeg(arm.upper,shoulder,elbow);
   arm.cuff.position.copy(elbow);
   setSeg(arm.lower,elbow,wrist);
  }
  let shake=0, debris=[];
  const shotHand=new THREE.Vector3(), shotTip=new THREE.Vector3();
  const catchScoop=new THREE.Vector3();
  const vendorShoulder=new THREE.Vector3(), customerShoulder=new THREE.Vector3(), vendorElbow=new THREE.Vector3(), customerElbow=new THREE.Vector3(), customerWrist=new THREE.Vector3();
  const lastCustomerWrist=new THREE.Vector3();
  const handRay=new THREE.Ray(new THREE.Vector3(),camera.getWorldDirection(new THREE.Vector3()));
  const handImpact=new THREE.Vector3(), nearestHandImpact=new THREE.Vector3();
  const targets=breakables.map(piece=>{
   const surfaceBounds=new THREE.Box3().setFromObject(piece);
   // The cart's wheels and tubs belong to the base visually. Only the
   // countertop and body can receive an impact.
   if (piece===base) surfaceBounds.set(new THREE.Vector3(-1.56,.41,-.85),new THREE.Vector3(1.56,1.65,.65));
   // Test each upright separately so a hand can pass through the gap.
   const handSurfaces=piece===base || piece===canopy
    ? [surfaceBounds]
    : piece.children.map(post=>new THREE.Box3().setFromObject(post));
   const handPadding=piece===base ? .055 : .085;
   const handBounds=handSurfaces.map(surface=>({surface,padded:surface.clone().expandByScalar(handPadding)}));
   return {piece,bounds:surfaceBounds,handBounds};
  });

  function shatter({piece,bounds}, contact) {
   piece.visible=false;
   state.current.broken++;
   shake=.21;
   for (let i=0; i<9; i++) {
    const chip=box(scene,.08+Math.random()*.19,.12+Math.random()*.24,.1,
      contact.x+(Math.random()-.5)*.4,clamp(contact.y,bounds.min.y,bounds.max.y),contact.z,
      piece===canopy&&i%3!==0?colors.red:colors.woodLight,Math.random());
    debris.push({mesh:chip,vx:(Math.random()-.5)*3,vy:Math.random()*2.6,life:2.1});
   }
   play('wood');
  }

  function checkCustomerImpact(wrist) {
   const travel=wrist.distanceTo(lastCustomerWrist);
   if (travel<.001) return;
   const samples=Math.min(12,Math.ceil(travel/.06));
   for (let step=1; step<=samples; step++) {
    // Follow the hand across the frame and look through it toward the cart.
    // The reaching pose is drawn in front of the stall.
    handRay.origin.lerpVectors(lastCustomerWrist,wrist,step/samples).addScaledVector(handRay.direction,-.12);
    // Keep the contact near the reaching hand so it cannot hit the far side of the cart.
    let nearestTarget=null, nearestDistance=.90*.90;
    for (const target of targets) {
     if (!target.piece.visible) continue;
     for (const {surface,padded} of target.handBounds) {
      if (!handRay.intersectBox(padded,handImpact)) continue;
      const distance=handRay.origin.distanceToSquared(handImpact);
      if (distance>=nearestDistance) continue;
      nearestTarget=target;
      nearestDistance=distance;
      surface.clampPoint(handImpact,nearestHandImpact);
     }
    }
    if (nearestTarget) {
     shatter(nearestTarget,nearestHandImpact);
     return;
    }
   }
  }

  function clearDebris() {
   for (const {mesh} of debris) { scene.remove(mesh); mesh.geometry.dispose(); }
   debris=[];
  }

  function reset(){
   const s=state.current;
   Object.assign(s,{phase:'intro',elapsed:0,tx:0,ty:0,drag:null,clock:0,attack:'wait',aim:null,
    broken:0,scoopX:0,scoopY:2.95,lastSwish:0,catchPose:null,catchTime:0});
   breakables.forEach(piece=>piece.visible=true);
   clearDebris();
   shake=0;
   customer.rotation.z=0;
   setTime(0);setPhase('intro');window.SFX?.reset();
   console.log('[game] replay');
  }
  replayRef.current=reset;
  let last=performance.now(), raf=0, prevHud=-1, previousCover=false, coverTime=0;
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const resize=()=>{
   const w=host.clientWidth,h=host.clientHeight;
   if(!w||!h)return;
   renderer.setSize(w,h,false);
   const aspect=w/h, height=Math.max(5.5,5.55/aspect);
   camera.top=height/2;camera.bottom=-height/2;
   camera.left=-height*aspect/2;camera.right=height*aspect/2;
   camera.updateProjectionMatrix();
  };
  const unwatchSize=watchGameSize(host,resize);
  function tick(now){raf=requestAnimationFrame(tick);let dt=Math.min((now-last)/1000,.05);last=now;if(document.hidden)return;const s=state.current,c=cfgRef.current;
   if(previousCover!==inFeedCover){
    camera.zoom=inFeedCover?.87:1;
    camera.updateProjectionMatrix();
    previousCover=inFeedCover;
    if(!inFeedCover){s.scoopX=0;s.scoopY=2.95;}
   }
   const demo=inFeedCover&&s.phase==='intro'&&!reducedMotion.matches;
   if(demo)coverTime+=dt;
   const beat=coverTime%4.4;
   const previousAttack=s.attack;
   if(s.phase==='playing'&&!inFeedCover){
    s.elapsed+=dt;s.clock=(s.clock||0)+dt;let secs=Math.floor(s.elapsed*10);if(secs!==prevHud){prevHud=secs;setTime(secs/10)}
    const wait=Math.max(.65,c.WAIT_TIME-s.elapsed*.012), wind=Math.max(.34,c.WINDUP_TIME-s.elapsed*.006);
    if(!s.attack)s.attack='wait';
    if(s.attack==='wait' && s.clock>=wait){s.attack='wind';s.clock=0;s.aim={x:s.scoopX||0,y:s.scoopY||2.95};}
    if(s.attack==='wind' && s.clock>=wind){s.attack='lunge';s.clock=0;}
    if(s.attack==='lunge' && s.clock>=c.LUNGE_TIME){s.attack='back';s.clock=0;}
    if(s.attack==='back' && s.clock>=.55){s.attack='wait';s.clock=0;}
   }
   let targetX=s.tx||0,targetY=2.95+(s.ty||0);
   if(demo){
    const dodge=Math.max(0,Math.sin((beat-.75)*Math.PI/2.5));
    targetX=.24-1.12*dodge;
    targetY+=.65*dodge;
   }
   if(s.scoopX===undefined){s.scoopX=0;s.scoopY=2.95;}s.scoopX+=(targetX-s.scoopX)*Math.min(1,dt*12);s.scoopY+=(targetY-s.scoopY)*Math.min(1,dt*12);
   const handX=-1.05+s.scoopX*.24,handY=2.05+(s.scoopY-2.95)*.23;
   const h=shotHand.set(handX,handY,1.06);
   const tip=shotTip.set(s.scoopX,s.scoopY,scoopDepth);
   vendorShoulder.set(.31,1.53,.04);vendor.localToWorld(vendorShoulder);
   vendorElbow.copy(vendorShoulder).lerp(h,.53);vendorElbow.y-=.12;vendorElbow.z+=.10;
   poseArm(vendorArm,vendorShoulder,vendorElbow,h);
   hand.position.copy(h);
   hand.rotation.z=Math.atan2(tip.y-h.y,tip.x-h.x)-Math.PI/4;
   setSeg(rod,h,tip);
   scoop.position.copy(tip);
   let cx=1.04,cy=2.18,cz=1.13,lean=0;
   if(s.phase==='playing'){
    if(s.attack==='wind'){let t=Math.min(1,s.clock/Math.max(.34,c.WINDUP_TIME-s.elapsed*.006));cx=1.04+t*.28;cy=2.18-t*.12;lean=-t*.12;}
    if(s.attack==='lunge'){let t=Math.min(1,s.clock/c.LUNGE_TIME),p=Math.sin(t*Math.PI/2);cx=1.32+(s.aim.x-1.32)*p;cy=2.06+(s.aim.y-2.06)*p;cz=1.13+(scoopDepth-1.13)*p;lean=.29*p;
      if(Math.hypot(cx-tip.x,cy-tip.y,cz-tip.z)<.29){
       s.phase='caught';s.drag=null;s.catchTime=0;
       s.catchPose={x:cx,y:cy,z:cz,lean,ice:tip.clone()};
       setPhase('caught');
       setTime(Math.floor(s.elapsed*10)/10);
       play('catch',true);
      }
    }
    if(s.attack==='back'){let p=1-Math.min(1,s.clock/.55);cx=1.04+(s.aim.x-1.04)*p;cy=2.18+(s.aim.y-2.18)*p;lean=.2*p;}
   } else if(demo){
    const reach=Math.max(0,1-Math.abs(beat-2.15)/.65);
    cx=1.04-.85*reach;cy=2.18+.54*reach;lean=.23*reach;
   }
   if (s.catchPose) {
    const pose=s.catchPose;
    if (s.phase==='caught') s.catchTime+=dt;
    const t=clamp(s.catchTime/.26,0,1);
    const lift=clamp((s.catchTime-.23)/.37,0,1);
    cx=pose.x+.24*lift; cy=pose.y+.18*lift; cz=pose.z+.08*lift;
    lean=pose.lean*(1-lift*.6);
    scoop.position.copy(pose.ice).lerp(catchScoop.set(cx,cy+.152,cz),t);
    shotTip.copy(pose.ice).y-=.27*t;
    shotTip.x-=.22*t;
    setSeg(rod,h,shotTip);
    if (s.phase==='caught' && s.catchTime>=.72) {
     s.phase='over';
     const final=Math.floor(s.elapsed*10)/10;
     let previous=0;
     try { previous=Number(localStorage.getItem('scoopBest')||0); } catch(e) {}
     const bestTime=Math.max(previous,final);
     try { localStorage.setItem('scoopBest',String(bestTime)); } catch(e) {}
     setBest(bestTime);setPhase('over');
     if (final>previous) play('best',true);
     console.log('[game] caught',final,'best',bestTime);
    }
   }
   customer.rotation.z=lean;
   coneGroup.position.set(cx,cy,cz);
   customerShoulder.set(-.31,1.53,.04);customer.localToWorld(customerShoulder);
   customerWrist.copy(coneHand.position).add(coneGroup.position);
   const striking=s.phase==='playing' && (s.attack==='lunge' || previousAttack==='lunge');
   if (!inFeedCover && (striking || s.phase==='caught')) checkCustomerImpact(customerWrist);
   lastCustomerWrist.copy(customerWrist);
   customerElbow.copy(customerShoulder).lerp(customerWrist,.52);customerElbow.y-=.13;customerElbow.z+=.10;
   poseArm(customerArm,customerShoulder,customerElbow,customerWrist);
   if(shake>0){shake-=dt;stall.rotation.z=Math.sin(now*.08)*shake*.04;}else stall.rotation.z=0;
   debris=debris.filter(d=>{d.life-=dt;d.vy-=6*dt;d.mesh.position.x+=d.vx*dt;d.mesh.position.y+=d.vy*dt;d.mesh.rotation.z+=dt*5;if(d.mesh.position.y<.06){d.mesh.position.y=.06;d.vy=0;d.vx*=.80;}if(d.life<=0){scene.remove(d.mesh);d.mesh.geometry.dispose();return false}return true});renderer.render(scene,camera);
  }raf=requestAnimationFrame(tick);
  // Expose only input-related diagnostics for automated checks.
  host.gameState=state.current;
  return()=>{
   cancelAnimationFrame(raf);unwatchSize();clearDebris();
   const materials=new Set();
   scene.traverse(object=>{
    object.geometry?.dispose();
    if(object.material)materials.add(object.material);
   });
   for(const material of materials)material.dispose();
   shadowTexture.dispose();waffleTexture.dispose();scoopTexture.dispose();
   renderer.dispose();host.removeChild(renderer.domElement);delete host.gameState;
  };
 },[ready]);
 const onDown=e=>{if(inFeedCover||e.isPrimary===false||e.button>0||(state.current.phase==='over'||state.current.phase==='caught'))return;e.currentTarget.setPointerCapture(e.pointerId);let s=state.current;s.drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,baseX:s.tx||0,baseY:s.ty||0,lastX:e.clientX,lastY:e.clientY,lastT:performance.now(),active:false};};
 const onMove=e=>{let s=state.current,d=s.drag;if(!d||d.id!==e.pointerId)return;const dx=e.clientX-d.startX,dy=e.clientY-d.startY;if(!d.active && Math.hypot(dx,dy)<5)return;let first=false;if(!d.active){first=true;d.active=true;if(s.phase==='intro'){s.phase='playing';s.elapsed=0;s.clock=0;s.attack='wait';setPhase('playing');console.log('[game] started');}}
  const now=performance.now(),dist=Math.hypot(e.clientX-d.lastX,e.clientY-d.lastY),elapsed=Math.max(16,now-d.lastT);s.tx=clamp(d.baseX+dx*cfgRef.current.DRAG_SENSITIVITY,-1.6,1.55);s.ty=clamp(d.baseY-dy*cfgRef.current.DRAG_SENSITIVITY,-1.45,1.05);
  if(first || (now-(s.lastSwish||0)>500 && dist/elapsed>.8 && dist>20)){play('swish');s.lastSwish=now;}d.lastX=e.clientX;d.lastY=e.clientY;d.lastT=now;};
 const onUp=e=>{const s=state.current;if(s.drag?.id===e.pointerId)s.drag=null;};
 const restart=()=>{play('click');replayRef.current?.();};
 const canSubmit=typeof tt!=='undefined'&&typeof tt.playableRecordingSubmission==='function';
 const submit=()=>{if(submitRef.current||!canSubmit)return;submitRef.current=true;setSubmitting(true);play('click');tt.playableRecordingSubmission({success(){},fail(err){console.error('[post_my_play] playableRecordingSubmission failed',err?.errMsg||err?.message);submitRef.current=false;setSubmitting(false)},complete(){}})};
 return <div className="app" data-phase={phase}><style>{`
@font-face {
  font-family: 'Bangers';
  src: url('./assets/fonts/bangers/Bangers-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

:root {
  --font-display: "Bangers", "PingFang SC", system-ui, sans-serif;
  --font-body:    -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
  --font-mono:    ui-monospace, Menlo, monospace;
}
*{box-sizing:border-box} .app{position:relative;width:100%;height:100%;overflow:clip;background:#f3e3cb;touch-action:none;color:#fff6df;font-family:var(--font-body)} .scene{position:absolute;inset:0;touch-action:none} .scene canvas{display:block;width:100%;height:100%} .guide{position:absolute;top:17%;left:30px;right:30px;text-align:center;pointer-events:none;animation:breathe 2.1s ease-in-out infinite} .guide span{display:inline-block;background:#fff6df;color:#8b3c2d;padding:8px 19px;border-radius:22px;box-shadow:0 4px 0 #b87452,0 7px 16px #7d523733;font-family:var(--font-display);font-size:18px;letter-spacing:.5px} @keyframes breathe{50%{transform:scale(1.05)}} @media(prefers-reduced-motion:reduce){.guide{animation:none}}
 .timer{position:absolute;top:30px;left:50%;transform:translateX(-50%);font:28px var(--font-display);color:#fff9e7;text-shadow:0 2px 0 #8f4d33,1px 3px 5px #69422f;pointer-events:none}.veil{position:absolute;inset:0;background:#3d281d77;display:flex;align-items:center;justify-content:center;padding:24px}.result{text-align:center;color:#5a3026;background:#fff3db;border:4px solid #a75234;border-radius:26px;padding:24px 26px 25px;box-shadow:0 8px 0 #854731,0 14px 40px #3d281d55;min-width:min(300px,100%)}.result h1{font:30px var(--font-display);margin:0;color:#bd4939;letter-spacing:1px}.score{font:38px var(--font-display);margin:8px 0 2px}.best{font:15px var(--font-display);letter-spacing:1px;color:#9e755c}.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:22px}.actions button{min-height:44px;border:0;border-radius:30px;background:#c84737;color:#fff9ec;padding:12px 22px;font:20px var(--font-display);box-shadow:0 4px 0 #8e352c;cursor:pointer;white-space:nowrap}.actions button:active{transform:translateY(3px);box-shadow:0 1px 0 #8e352c}
 `}</style><div className="scene" ref={mount} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp}/>{phase==='intro'&&<div className="guide"><span>{cfg.GUIDE}</span></div>}{(phase==='playing'||phase==='caught')&&<div className="timer" data-testid="timer">{time.toFixed(1)}s</div>}{phase==='over'&&<div className="veil"><div className="result"><h1>{cfg.CAUGHT}</h1><div className="score">{time.toFixed(1)}s</div><div className="best">{cfg.BEST} {best.toFixed(1)}s</div><div className="actions"><button onClick={restart}>{cfg.AGAIN}</button>{canSubmit&&<button onClick={submit} disabled={submitting} style={{opacity:submitting?.55:1,pointerEvents:submitting?'none':'auto'}}>Post my play</button>}</div></div></div>}</div>
}

createRoot(document.getElementById('root')).render(<App />);
