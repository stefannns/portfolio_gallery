import React, {useCallback,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Matter from 'matter-js';
import * as THREE from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';

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

const GAME_NUMBER=86;
const POLISH_CSS="";

const DEFAULTS={TRACE_CLOSE_GAP:28,TRACE_MIN_LENGTH:90,SOFT_BODY_COLUMNS:9,SOFT_BODY_ROWS:9,GRAVITY:.7,BODY_WIDTH_RATIO:.74,GUIDE_TEXT:'Trace around the cat',RESET_LABEL:'Reset',CONFIRM_LABEL:'Make squishy',RESET_SHAPE_LABEL:'Reset shape',CHOOSE_LABEL:'Choose image',PICKER_TITLE:'Choose an image',BACK_LABEL:'Back',HAMSTER_HONEY:'./assets/cat-phone-rug.webp',HAMSTER_CARAMEL:'./assets/cat-phone-sofa.webp',HAMSTER_SILVER:'./assets/cat-phone-window.webp'};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const polygonArea=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.u*q.v-q.u*p.v;},0))/2;

function imageFit(width,height,image){
  const scale=Math.min(width*.98/image.width,height*.98/image.height);
  const w=image.width*scale,h=image.height*scale;
  return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};
}

function cleanOutline(points){
  const clean=points.filter((p,i)=>!i||Math.hypot(p.u-points[i-1].u,p.v-points[i-1].v)>.0015).map(p=>({...p}));
  if(clean.length>2&&Math.hypot(clean[0].u-clean.at(-1).u,clean[0].v-clean.at(-1).v)<.003)clean.pop();
  if(clean.length>180)return Array.from({length:180},(_,i)=>clean[Math.floor(i*clean.length/180)]);
  return clean;
}

function outlineIntersection(a,b,c,d){
  const x=b.u-a.u,y=b.v-a.v,sx=d.u-c.u,sy=d.v-c.v,rx=c.u-a.u,ry=c.v-a.v;
  const denominator=x*sy-y*sx,epsilon=1e-10;
  if(Math.abs(denominator)<epsilon){
    if(Math.abs(rx*y-ry*x)>epsilon)return null;
    const length=x*x+y*y;if(length<epsilon)return null;
    const t0=(rx*x+ry*y)/length,t1=((d.u-a.u)*x+(d.v-a.v)*y)/length;
    const start=Math.max(0,Math.min(t0,t1)),end=Math.min(1,Math.max(t0,t1));
    if(start>end+epsilon)return null;
    return {u:a.u+x*start,v:a.v+y*start};
  }
  const t=(rx*sy-ry*sx)/denominator,s=(rx*y-ry*x)/denominator;
  if(t<-epsilon||t>1+epsilon||s<-epsilon||s>1+epsilon)return null;
  return {u:a.u+x*clamp(t,0,1),v:a.v+y*clamp(t,0,1)};
}

function firstOutlineCrossing(points){
  for(let i=0;i<points.length;i++)for(let j=i+2;j<points.length;j++){
    if(i===0&&j===points.length-1)continue;
    const point=outlineIntersection(points[i],points[(i+1)%points.length],points[j],points[(j+1)%points.length]);
    if(point)return {i,j,point};
  }
  return null;
}

function selfIntersects(points){return !!firstOutlineCrossing(points);}

function closeOutline(raw){
  let outline=cleanOutline(raw);
  // A release joins the endpoints. If that join or an overshooting end crosses
  // the outline, keep the larger enclosed loop and discard its extra tail.
  // This preserves concave contours rather than replacing them with a hull.
  for(let pass=0;pass<180&&outline.length>2;pass++){
    const crossing=firstOutlineCrossing(outline);if(!crossing)break;
    const {i,j,point}=crossing;
    const a=cleanOutline([point,...outline.slice(i+1,j+1)]);
    const b=cleanOutline([point,...outline.slice(j+1),...outline.slice(0,i+1)]);
    const next=polygonArea(a)>=polygonArea(b)?a:b;
    if(next.length>=outline.length)return [];
    outline=next;
  }
  return selfIntersects(outline)?[]:outline;
}

function cutPhoto(photo,outline){
  const minX=Math.max(0,Math.floor(Math.min(...outline.map(p=>p.u))*photo.width));
  const minY=Math.max(0,Math.floor(Math.min(...outline.map(p=>p.v))*photo.height));
  const maxX=Math.min(photo.width,Math.ceil(Math.max(...outline.map(p=>p.u))*photo.width));
  const maxY=Math.min(photo.height,Math.ceil(Math.max(...outline.map(p=>p.v))*photo.height));
  const w=maxX-minX,h=maxY-minY,scale=Math.min(1,1024/Math.max(w,h));
  if(w<8||h<8)throw Error('Trace a larger area of the photo.');
  const texture=document.createElement('canvas');texture.width=Math.max(1,Math.round(w*scale));texture.height=Math.max(1,Math.round(h*scale));
  const ctx=texture.getContext('2d');
  ctx.save();ctx.scale(scale,scale);ctx.translate(-minX,-minY);ctx.beginPath();outline.forEach((p,i)=>i?ctx.lineTo(p.u*photo.width,p.v*photo.height):ctx.moveTo(p.u*photo.width,p.v*photo.height));ctx.closePath();ctx.clip();ctx.drawImage(photo,0,0);ctx.restore();
  const pixels=ctx.getImageData(0,0,texture.width,texture.height).data;let opaque=0,r=0,g=0,b=0;
  for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>100){opaque++;r+=pixels[i];g+=pixels[i+1];b+=pixels[i+2];}
  if(opaque<100)throw Error('Keep the outline inside your photo.');
  const unit=3/Math.max(w,h);
  const contour=outline.map(p=>new THREE.Vector2((p.u*photo.width-minX-w/2)*unit,(h/2-(p.v*photo.height-minY))*unit));
  // Geometry supplies the silhouette. An opaque crop lets the same photograph
  // continue over the curved rim and back without an alpha fringe or side band.
  const wrapTexture=document.createElement('canvas');wrapTexture.width=texture.width;wrapTexture.height=texture.height;
  const wrap=wrapTexture.getContext('2d');wrap.fillStyle=`rgb(${Math.round(r/opaque)},${Math.round(g/opaque)},${Math.round(b/opaque)})`;wrap.fillRect(0,0,wrapTexture.width,wrapTexture.height);wrap.drawImage(photo,minX,minY,w,h,0,0,wrapTexture.width,wrapTexture.height);
  return {texture,wrapTexture,contour,width:w*unit,height:h*unit,opaque,sourceWidth:photo.width,sourceHeight:photo.height};
}

function edgeDistance(x,y,contour){
  let best=Infinity;
  for(let i=0;i<contour.length;i++){
    const a=contour[i],b=contour[(i+1)%contour.length],dx=b.x-a.x,dy=b.y-a.y;
    const t=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
    best=Math.min(best,Math.hypot(x-a.x-t*dx,y-a.y-t*dy));
  }
  return best;
}

function roundedContour(input){
  let contour=input.map(p=>p.clone());
  for(let pass=0;pass<3;pass++){
    const next=[];
    contour.forEach((a,i)=>{const b=contour[(i+1)%contour.length];next.push(a.clone().lerp(b,.2),a.clone().lerp(b,.8));});
    contour=next;
  }
  const lengths=contour.map((p,i)=>p.distanceTo(contour[(i+1)%contour.length]));
  const perimeter=lengths.reduce((a,b)=>a+b,0),result=[];let edge=0,offset=0;
  for(let i=0;i<128;i++){
    const target=i/128*perimeter;
    while(edge<contour.length-1&&offset+lengths[edge]<target){offset+=lengths[edge];edge++;}
    result.push(contour[edge].clone().lerp(contour[(edge+1)%contour.length],(target-offset)/(lengths[edge]||1)));
  }
  // Remove collinear boundary samples before triangulation. Otherwise tiny
  // floating-point slivers can collapse into overlapping faces at the rim.
  return result.filter((p,i)=>{const a=result[(i+result.length-1)%result.length],b=result[(i+1)%result.length];return Math.abs((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x))>1e-8;});
}

function triangulatedPlane(shape){
  const raw=new THREE.ShapeGeometry(shape),src=raw.toNonIndexed(),position=src.getAttribute('position');
  const plane=[];
  // Uniform subdivision keeps shared edges identical: the inflated shell has
  // no T-junctions and can join smoothly all the way around its equator.
  const subdivide=(a,b,c,level)=>{
    if(level){const ab=a.clone().add(b).multiplyScalar(.5),bc=b.clone().add(c).multiplyScalar(.5),ca=c.clone().add(a).multiplyScalar(.5);subdivide(a,ab,ca,level-1);subdivide(ab,b,bc,level-1);subdivide(ca,bc,c,level-1);subdivide(ab,bc,ca,level-1);}
    else plane.push(a,b,c);
  };
  for(let i=0;i<position.count;i+=3){
    const a=new THREE.Vector2(position.getX(i),position.getY(i)),b=new THREE.Vector2(position.getX(i+1),position.getY(i+1)),c=new THREE.Vector2(position.getX(i+2),position.getY(i+2));
    const ab=a.clone().add(b).multiplyScalar(.5),bc=b.clone().add(c).multiplyScalar(.5),ca=c.clone().add(a).multiplyScalar(.5),center=a.clone().add(b).add(c).multiplyScalar(1/3);
    // Give every original face an interior point and split every shared edge.
    // Boundary-only ear triangles would otherwise make front/back touch inside.
    subdivide(a,ab,center,2);subdivide(ab,b,center,2);subdivide(b,bc,center,2);subdivide(bc,c,center,2);subdivide(c,ca,center,2);subdivide(ca,a,center,2);
  }
  raw.dispose();src.dispose();return plane;
}

function pillowGeometry(cut){
  const contour=roundedContour(cut.contour).map(p=>new THREE.Vector2(Math.fround(p.x),Math.fround(p.y))),plane=triangulatedPlane(new THREE.Shape(contour));
  const distances=plane.map(p=>edgeDistance(p.x,p.y,contour)),maxDistance=Math.max(...distances,.001),roundness=Math.min(cut.width,cut.height)*.37;
  const out=[],uvs=[];
  const emit=(i,side)=>{
    const p=plane[i],d=distances[i]<1e-10?0:clamp(distances[i]/maxDistance,0,1);
    const z=side*roundness*Math.sqrt(d*(2-d));
    out.push(p.x,p.y,z);uvs.push(clamp(p.x/cut.width+.5,0,1),clamp(p.y/cut.height+.5,0,1));
  };
  for(let i=0;i<plane.length;i+=3){emit(i,1);emit(i+1,1);emit(i+2,1);emit(i+2,-1);emit(i+1,-1);emit(i,-1);}
  const base=new THREE.BufferGeometry();base.setAttribute('position',new THREE.Float32BufferAttribute(out,3));base.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  const geometry=mergeVertices(base,.00003);base.dispose();geometry.computeVertexNormals();geometry.addGroup(0,geometry.index.count,0);
  // Fill the space outside the silhouette for the safety calculation only.
  // Together these triangles cover a convex rectangle, so a bound on the
  // displacement gradient prevents distant parts from crossing as well.
  const w=cut.width/2+.1,h=cut.height/2+.1;
  const surround=new THREE.Shape([new THREE.Vector2(-w,-h),new THREE.Vector2(w,-h),new THREE.Vector2(w,h),new THREE.Vector2(-w,h)]);
  surround.holes.push(new THREE.Path(contour));
  const safety=plane.concat(triangulatedPlane(surround));
  geometry.userData.safetyPlane=new Float32Array(safety.flatMap(p=>[p.x,p.y]));
  return geometry;
}

function softDragOffset(x,y,limit=145){
  const length=Math.hypot(x,y);if(length<1e-8)return{x:0,y:0};
  const scale=limit*Math.tanh(length/limit)/length;return{x:x*scale,y:y*scale};
}
function advanceDrag(drag,dt){
  const alpha=1-Math.exp(-dt/12);
  drag.offset.x+=(drag.target.x-drag.offset.x)*alpha;drag.offset.y+=(drag.target.y-drag.offset.y)*alpha;
  drag.joints.forEach((joint,i)=>{joint.pointA.x=drag.starts[i].x+drag.offset.x;joint.pointA.y=drag.starts[i].y+drag.offset.y;});
}
function stepSoftCage(cage,drags){
  const step=1000/120;
  for(const drag of drags.values())advanceDrag(drag,step);
  cage.bodies.forEach((body,i)=>{const origin=cage.rest[i],dx=origin.x-body.position.x,dy=origin.y-body.position.y,length=Math.hypot(dx,dy),returnForce=.000035*(1+Math.max(0,length-160)**2/10000);Matter.Body.applyForce(body,body.position,{x:dx*body.mass*returnForce,y:dy*body.mass*returnForce});});
  Matter.Engine.update(cage.engine,step);
}

function makeCage(cut,cfg){
  const columns=clamp(Math.round(cfg.SOFT_BODY_COLUMNS),7,17),rows=clamp(Math.round(cfg.SOFT_BODY_ROWS),7,17),unit=90;
  const width=(cut.width+.2)*unit,height=(cut.height+.2)*unit,left=-width/2,top=-height/2;
  const engine=Matter.Engine.create({positionIterations:6,constraintIterations:4});engine.gravity.y=cfg.GRAVITY;engine.gravity.scale=.00001;
  const bodies=[],links=[];
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++)bodies.push(Matter.Bodies.circle(left+x*width/(columns-1),top+y*height/(rows-1),2,{frictionAir:.075,collisionFilter:{group:-1},inertia:Infinity}));
  const join=(i,j,stiffness)=>links.push(Matter.Constraint.create({bodyA:bodies[i],bodyB:bodies[j],stiffness,damping:.12}));
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const i=y*columns+x;if(x<columns-1)join(i,i+1,.32);if(y<rows-1)join(i,i+columns,.32);
    if(x<columns-1&&y<rows-1){join(i,i+columns+1,.16);join(i+1,i+columns,.16);}
  }
  Matter.Composite.add(engine.world,[...bodies,...links]);
  return {engine,bodies,rest:bodies.map(b=>({...b.position})),columns,rows,width,height,left,top,unit};
}

function sampleCage(cage,x,y){
  const gx=clamp((x*cage.unit-cage.left)/cage.width*(cage.columns-1),0,cage.columns-1-.00001);
  const gy=clamp((-y*cage.unit-cage.top)/cage.height*(cage.rows-1),0,cage.rows-1-.00001);
  const col=Math.floor(gx),row=Math.floor(gy),tx=gx-col,ty=gy-row;
  const ids=[row*cage.columns+col,row*cage.columns+col+1,(row+1)*cage.columns+col,(row+1)*cage.columns+col+1],weights=[(1-tx)*(1-ty),tx*(1-ty),(1-tx)*ty,tx*ty];
  let dx=0,dy=0;ids.forEach((id,i)=>{dx+=(cage.bodies[id].position.x-cage.rest[id].x)*weights[i];dy+=(cage.bodies[id].position.y-cage.rest[id].y)*weights[i];});
  return {x:dx/cage.unit,y:-dy/cage.unit};
}

function makeSafeDeformer(geometry,cage){
  const source=geometry.attributes.position,rest=new Float32Array(source.array),coords=[],lookup=new Map(),faces=[];
  const vertex=(x,y)=>{x=Math.fround(x);y=Math.fround(y);const key=x+':'+y;if(lookup.has(key))return lookup.get(key);const i=coords.length/2;coords.push(x,y);lookup.set(key,i);return i;};
  const plane=geometry.userData.safetyPlane;
  for(let i=0;i<plane.length;i+=6){
    const a=vertex(plane[i],plane[i+1]),b=vertex(plane[i+2],plane[i+3]),c=vertex(plane[i+4],plane[i+5]);
    const ax=coords[a*2],ay=coords[a*2+1],x1=coords[b*2]-ax,y1=coords[b*2+1]-ay,x2=coords[c*2]-ax,y2=coords[c*2+1]-ay,det=x1*y2-y1*x2;
    if(Math.abs(det)>1e-14)faces.push(a,b,c,y2/det,-x2/det,-y1/det,x1/det);
  }
  const visible=Array.from({length:source.count},(_,i)=>vertex(rest[i*3],rest[i*3+1]));
  const samples=coords.filter((_,i)=>i%2===0).map((x,i)=>{
    const y=coords[i*2+1],gx=clamp((x*cage.unit-cage.left)/cage.width*(cage.columns-1),0,cage.columns-1-.00001),gy=clamp((-y*cage.unit-cage.top)/cage.height*(cage.rows-1),0,cage.rows-1-.00001),col=Math.floor(gx),row=Math.floor(gy),tx=gx-col,ty=gy-row;
    return {ids:[row*cage.columns+col,row*cage.columns+col+1,(row+1)*cage.columns+col,(row+1)*cage.columns+col+1],weights:[(1-tx)*(1-ty),tx*(1-ty),(1-tx)*ty,tx*ty]};
  });
  const residual=new Float64Array(coords.length),base=new Float64Array(coords.length);
  const x2=cage.rest.reduce((sum,p)=>sum+p.x*p.x,0),y2=cage.rest.reduce((sum,p)=>sum+p.y*p.y,0);
  // Filter the small simulation cage, then reapply the full safety bound.
  // The rendered vertices are never blended after the non-folding safeguard.
  const poses=cage.bodies.map(body=>({...body.position}));
  const reset=()=>cage.bodies.forEach((body,i)=>{poses[i].x=body.position.x;poses[i].y=body.position.y;});
  return {rest,reset,apply(deltaMs=Infinity){
    const alpha=Number.isFinite(deltaMs)?1-Math.exp(-Math.max(0,deltaMs)/18):1;
    cage.bodies.forEach((body,i)=>{poses[i].x+=(body.position.x-poses[i].x)*alpha;poses[i].y+=(body.position.y-poses[i].y)*alpha;});
    let tx=0,ty=0;for(const p of poses){tx+=p.x;ty+=p.y;}tx/=cage.bodies.length;ty/=cage.bodies.length;
    let a=0,b=0,c=0,d=0;poses.forEach((position,i)=>{const p=cage.rest[i];a+=(position.x-tx)*p.x/x2;b+=(position.x-tx)*p.y/y2;c+=(position.y-ty)*p.x/x2;d+=(position.y-ty)*p.y/y2;});
    // A bounded affine stretch remains perceptibly soft when a violent local
    // pinch has to be reduced. Both principal stretches stay strictly positive.
    const angle=clamp(Math.atan2(c-b,a+d),-.28,.28),co=Math.cos(angle),si=Math.sin(angle);
    const s00=co*a+si*c,s11=-si*b+co*d,s01=(co*b+si*d-si*a+co*c)/2;
    const theta=.5*Math.atan2(2*s01,s00-s11),ct=Math.cos(theta),st=Math.sin(theta),disc=Math.hypot(s00-s11,2*s01);
    const l1=clamp((s00+s11+disc)/2,.68,1.35),l2=clamp((s00+s11-disc)/2,.68,1.35);
    const q00=ct*ct*l1+st*st*l2,q11=st*st*l1+ct*ct*l2,q01=ct*st*(l1-l2);
    a=co*q00-si*q01;b=co*q01-si*q11;c=si*q00+co*q01;d=si*q01+co*q11;
    const maxMove=Math.min(cage.width,cage.height)*.16,move=Math.hypot(tx,ty);if(move>maxMove){tx*=maxMove/move;ty*=maxMove/move;}
    samples.forEach((sample,i)=>{
      let px=0,py=0;sample.ids.forEach((id,j)=>{px+=poses[id].x*sample.weights[j];py+=poses[id].y*sample.weights[j];});
      const x=coords[i*2]*cage.unit,y=-coords[i*2+1]*cage.unit,bx=(a*x+b*y+tx)/cage.unit,by=-(c*x+d*y+ty)/cage.unit;
      base[i*2]=bx;base[i*2+1]=by;residual[i*2]=px/cage.unit-bx;residual[i*2+1]=-py/cage.unit-by;
    });
    let gradient=0;
    for(let i=0;i<faces.length;i+=7){
      const p=faces[i]*2,q=faces[i+1]*2,r=faces[i+2]*2,ux=residual[q]-residual[p],uy=residual[r]-residual[p],vx=residual[q+1]-residual[p+1],vy=residual[r+1]-residual[p+1];
      gradient=Math.max(gradient,Math.hypot(ux*faces[i+3]+uy*faces[i+5],ux*faces[i+4]+uy*faces[i+6],vx*faces[i+3]+vy*faces[i+5],vx*faces[i+4]+vy*faces[i+6]));
    }
    const minStretch=Math.min(l1,l2),limit=.48*minStretch,blend=Math.min(1,limit/Math.max(gradient,1e-12)),depthScale=clamp(1/(l1*l2),.85,1.45);
    let maximum=0;
    visible.forEach((id,i)=>{
      const x=base[id*2]+residual[id*2]*blend,y=base[id*2+1]+residual[id*2+1]*blend;
      maximum=Math.max(maximum,Math.hypot(x-rest[i*3],y-rest[i*3+1]));source.setXYZ(i,x,y,rest[i*3+2]*depthScale);
    });
    source.needsUpdate=true;
    return {maximum,blend,gradientBound:gradient*blend,minStretch,depthScale};
  }};
}

function App(){
  const feedActive=useFeedActive(),[cfg,setCfg]=useState(DEFAULTS),[phase,setPhase]=useState('trace'),[photoVersion,setPhotoVersion]=useState(0),[canMake,setCanMake]=useState(false),[guide,setGuide]=useState(true),[uploaded,setUploaded]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false),[cut,setCut]=useState(null);
  const fileRef=useRef(null),photoRef=useRef(null),traceRef=useRef(null),canvasRef=useRef(null),points=useRef([]),closed=useRef(false),traceDrag=useRef(null),world=useRef(null),loadJob=useRef(0),activeRef=useRef(feedActive),audioRef=useRef(null),buffers=useRef(new Map());
  activeRef.current=feedActive;
  useEffect(()=>{fetch('./game.config.json').then(r=>r.json()).then(raw=>setCfg({...DEFAULTS,...Object.fromEntries([...raw.tweaks,...raw.texts].map(x=>[x.id,x.value])),...Object.fromEntries(raw.images.map(x=>[x.id,x.path]))})).catch(()=>{});},[]);
  const sound=(kind)=>{
    if(!activeRef.current)return;
    try{if(!audioRef.current)audioRef.current=new(window.AudioContext||window.webkitAudioContext)();const ctx=audioRef.current;ctx.resume().catch(()=>{});const path=kind==='squish'?'./assets/sfx_squish.mp3':'./assets/sfx_click_soft.mp3';let sample=buffers.current.get(path);if(!sample){sample=fetch(path).then(r=>r.arrayBuffer()).then(b=>ctx.decodeAudioData(b)).catch(()=>null);buffers.current.set(path,sample);}sample.then(buffer=>{if(!buffer||!activeRef.current||ctx.state!=='running')return;const src=ctx.createBufferSource(),gain=ctx.createGain();gain.gain.value=kind==='squish'?.23:.3;src.buffer=buffer;src.connect(gain);gain.connect(ctx.destination);src.start();src.onended=()=>{src.disconnect();gain.disconnect();};});}catch{}
  };
  const clearTrace=()=>{points.current=[];closed.current=false;traceDrag.current=null;setCanMake(false);setGuide(true);setError('');};
  const loadPhoto=useCallback(async(url,isUpload)=>{
    const job=++loadJob.current;setLoading(true);setError('');
    try{
      const image=new Image();image.src=url;await image.decode();if(job!==loadJob.current)return;
      const factor=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
      const decoded=document.createElement('canvas');decoded.width=Math.max(1,Math.round(image.naturalWidth*factor));decoded.height=Math.max(1,Math.round(image.naturalHeight*factor));decoded.getContext('2d').drawImage(image,0,0,decoded.width,decoded.height);
      photoRef.current=decoded;points.current=[];closed.current=false;traceDrag.current=null;setCanMake(false);setGuide(true);setUploaded(isUpload);setCut(null);setPhase('trace');setPhotoVersion(v=>v+1);
    }catch{if(job===loadJob.current)setError('Try a JPG, PNG or WebP photo.');}
    finally{if(job===loadJob.current)setLoading(false);}
  },[]);
  useEffect(()=>{if(!photoRef.current)loadPhoto(cfg.HAMSTER_HONEY,false);},[cfg.HAMSTER_HONEY,loadPhoto]);
  useEffect(()=>()=>{loadJob.current++;try{audioRef.current?.close();}catch{}},[]);
  const chooseFile=()=>{if(loading)return;sound('tap');fileRef.current.value='';fileRef.current.click();};
  const receiveFile=async event=>{
    const file=event.target.files?.[0];if(!file)return;
    if(!file.type.startsWith('image/')){setError('Choose an image file.');return;}
    if(file.size>25*1024*1024){setError('Choose a photo smaller than 25 MB.');return;}
    const url=URL.createObjectURL(file);try{await loadPhoto(url,true);}finally{URL.revokeObjectURL(url);}
  };
  const redraw=useCallback(()=>{
    const canvas=traceRef.current,photo=photoRef.current;if(!canvas||!photo)return;
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),width=rect.width,height=rect.height;
    canvas.width=Math.max(1,Math.round(width*dpr));canvas.height=Math.max(1,Math.round(height*dpr));
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const fit=imageFit(width,height,photo);ctx.drawImage(photo,fit.x,fit.y,fit.width,fit.height);
    const list=points.current;canvas.dataset.traceClosed=String(closed.current);canvas.dataset.tracePoints=String(list.length);canvas.dataset.traceArea=polygonArea(list).toFixed(5);canvas.dataset.traceCrossings=String(selfIntersects(list));if(!list.length)return;
    const mapped=list.map(p=>({x:fit.x+p.u*fit.width,y:fit.y+p.v*fit.height}));
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=3;ctx.strokeStyle=closed.current?'#d5f8ba':'#f3d292';ctx.shadowColor='#0009';ctx.shadowBlur=5;ctx.beginPath();mapped.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));if(closed.current)ctx.closePath();ctx.stroke();
    if(mapped.length>2){ctx.closePath();ctx.fillStyle='#f3d29222';ctx.fill();}
    ctx.shadowBlur=0;ctx.fillStyle=closed.current?'#d5f8ba':'#f3d292';ctx.beginPath();ctx.arc(mapped[0].x,mapped[0].y,5,0,Math.PI*2);ctx.fill();ctx.restore();
  },[photoVersion]);
  useEffect(()=>{if(phase!=='trace'||!traceRef.current)return;const observer=new ResizeObserver(redraw);observer.observe(traceRef.current);redraw();return()=>observer.disconnect();},[phase,redraw]);
  const localPhotoPoint=event=>{
    const canvas=traceRef.current,photo=photoRef.current;if(!canvas||!photo)return null;
    const rect=canvas.getBoundingClientRect(),fit=imageFit(rect.width,rect.height,photo),x=event.clientX-rect.left,y=event.clientY-rect.top;
    return {u:clamp((x-fit.x)/fit.width,0,1),v:clamp((y-fit.y)/fit.height,0,1),inside:x>=fit.x&&x<=fit.x+fit.width&&y>=fit.y&&y<=fit.y+fit.height,fit};
  };
  const traceValid=(outline=points.current)=>{
    const list=cleanOutline(outline);if(list.length<3||polygonArea(list)<.004)return false;
    const rect=traceRef.current?.getBoundingClientRect(),photo=photoRef.current;if(!rect||!photo)return false;
    const fit=imageFit(rect.width,rect.height,photo),length=list.slice(1).reduce((sum,p,i)=>sum+Math.hypot((p.u-list[i].u)*fit.width,(p.v-list[i].v)*fit.height),0);
    return length>=cfg.TRACE_MIN_LENGTH;
  };
  const finishOutline=()=>{
    const outline=closeOutline(points.current);if(!traceValid(outline))return false;
    points.current=outline;closed.current=true;setCanMake(true);setError('');redraw();return true;
  };
  const traceDown=event=>{
    if(!activeRef.current||loading||event.isPrimary===false||(event.pointerType==='mouse'&&event.button!==0))return;
    const p=localPhotoPoint(event);if(!p?.inside)return;
    if(closed.current){points.current=[];closed.current=false;}
    if(points.current.length>2&&Math.hypot((p.u-points.current[0].u)*p.fit.width,(p.v-points.current[0].v)*p.fit.height)<=cfg.TRACE_CLOSE_GAP&&traceValid()){
      finishOutline();setGuide(false);return;
    }
    points.current.push({u:p.u,v:p.v});traceDrag.current={id:event.pointerId,start:{x:event.clientX,y:event.clientY},moved:false};setGuide(false);setError('');event.currentTarget.setPointerCapture(event.pointerId);redraw();setCanMake(traceValid());
  };
  const traceMove=event=>{
    const drag=traceDrag.current;if(!drag||drag.id!==event.pointerId)return;
    const p=localPhotoPoint(event);if(!p)return;
    const last=points.current.at(-1);if(Math.hypot((last.u-p.u)*p.fit.width,(last.v-p.v)*p.fit.height)<2)return;
    drag.moved=true;points.current.push({u:p.u,v:p.v});redraw();setCanMake(traceValid());
  };
  const traceEnd=event=>{
    const drag=traceDrag.current;if(!drag||drag.id!==event.pointerId)return;
    traceDrag.current=null;
    if(event.type==='pointerup'&&drag.moved){
      const p=localPhotoPoint(event),last=points.current.at(-1);
      if(p&&last&&Math.hypot((p.u-last.u)*p.fit.width,(p.v-last.v)*p.fit.height)>=2)points.current.push({u:p.u,v:p.v});
      finishOutline();
    }
    try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}catch{}
    setCanMake(traceValid());redraw();
  };
  const makeToy=()=>{
    if(!finishOutline())return;
    const contour=points.current;
    try{const result=cutPhoto(photoRef.current,contour);setCut(result);setError('');setGuide(true);setPhase('active');sound('tap');}catch(e){setError(e.message||'Try tracing the shape again.');}
  };

  useEffect(()=>{
    if(phase!=='active'||!cut||!canvasRef.current)return;
    const canvas=canvasRef.current;let renderer;
    try{renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});}catch{setError('This browser could not open the 3D view.');return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.setClearColor(0x000000,0);
    const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-2,2,2,-2,.1,40);camera.position.set(0,.15,8);camera.lookAt(0,0,0);
    const hemi=new THREE.HemisphereLight(0xffffff,0x6a6b72,2.2);scene.add(hemi);
    const key=new THREE.DirectionalLight(0xffffff,2.6);key.position.set(-3,5,7);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-5;key.shadow.camera.right=5;key.shadow.camera.top=5;key.shadow.camera.bottom=-5;key.shadow.normalBias=.03;scene.add(key);
    const rim=new THREE.DirectionalLight(0xc8d8ff,1.2);rim.position.set(4,1,-2);scene.add(rim);
    const texture=new THREE.CanvasTexture(cut.wrapTexture);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
    const surface=new THREE.MeshStandardMaterial({map:texture,roughness:.64,metalness:0});
    const geometry=pillowGeometry(cut);geometry.computeBoundingBox();const thickness=geometry.boundingBox.max.z-geometry.boundingBox.min.z;geometry.boundingBox=null;geometry.computeBoundingSphere();geometry.boundingSphere.radius*=3;const mesh=new THREE.Mesh(geometry,surface);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;
    const group=new THREE.Group();group.add(mesh);group.rotation.set(-.08,.22,-.015);scene.add(group);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.ShadowMaterial({opacity:.3}));floor.rotation.x=-Math.PI/2;floor.position.y=-cut.height/2-.22;floor.receiveShadow=true;scene.add(floor);
    const cage=makeCage(cut,cfg),deformer=makeSafeDeformer(geometry,cage),rest=deformer.rest,drags=new Map();
    const state={scene,camera,renderer,mesh,group,cage,rest,drags,cut,lastTime:performance.now(),accumulator:0,normalsElapsed:Infinity,rendered:false,maxDisplacement:0,peakDisplacement:0,dragCount:0,reset(){
      const held=[...drags.keys()];for(const drag of drags.values())drag.joints.forEach(j=>Matter.Composite.remove(cage.engine.world,j));drags.clear();for(const id of held){try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}catch{}}
      cage.bodies.forEach((body,i)=>{Matter.Body.setPosition(body,cage.rest[i]);Matter.Body.setVelocity(body,{x:0,y:0});body.force.x=0;body.force.y=0;});deformer.reset();this.peakDisplacement=0;this.dragCount=0;this.accumulator=0;this.lastTime=performance.now();this.normalsElapsed=Infinity;
    }};
    world.current=state;
    const resize=()=>{const rect=canvas.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);const aspect=rect.width/Math.max(1,rect.height);const h=Math.max(cut.height+1.0,(cut.width+.2)/(aspect*clamp(cfg.BODY_WIDTH_RATIO,.55,.86)));camera.left=-h*aspect/2;camera.right=h*aspect/2;camera.top=h/2;camera.bottom=-h/2;camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();let raf=0;
    const frame=time=>{
      raf=requestAnimationFrame(frame);const frameMs=clamp(time-state.lastTime,0,50);state.lastTime=time;
      if(!activeRef.current||document.hidden){
        if(drags.size){for(const drag of drags.values())drag.joints.forEach(j=>Matter.Composite.remove(cage.engine.world,j));drags.clear();}
        state.accumulator=0;if(state.rendered)return;
      }else{
        state.accumulator=Math.min(state.accumulator+frameMs,50);
        while(state.accumulator+1e-6>=1000/120){stepSoftCage(cage,drags);state.accumulator=Math.max(0,state.accumulator-1000/120);}
      }
      const safe=deformer.apply(frameMs),positions=geometry.attributes.position,max=safe.maximum;
      state.normalsElapsed+=frameMs;if(state.normalsElapsed>=1000/30){geometry.computeVertexNormals();state.normalsElapsed=0;}
      state.maxDisplacement=max;state.peakDisplacement=Math.max(state.peakDisplacement,max);renderer.render(scene,camera);state.rendered=true;
      canvas.dataset.deformation=max.toFixed(3);canvas.dataset.vertices=String(positions.count);canvas.dataset.depth=(thickness*safe.depthScale).toFixed(3);canvas.dataset.safeGradient=safe.gradientBound.toFixed(3);canvas.dataset.minStretch=safe.minStretch.toFixed(3);canvas.dataset.activeDrags=String(drags.size);canvas.dataset.peakDeformation=state.peakDisplacement.toFixed(3);canvas.dataset.completedDrags=String(state.dragCount);
    };
    raf=requestAnimationFrame(frame);
    const lost=event=>{event.preventDefault();setError('The 3D view was interrupted. Tap Trace again to rebuild.');};canvas.addEventListener('webglcontextlost',lost);
    return()=>{cancelAnimationFrame(raf);observer.disconnect();canvas.removeEventListener('webglcontextlost',lost);state.reset();Matter.Composite.clear(cage.engine.world,false);Matter.Engine.clear(cage.engine);geometry.dispose();surface.dispose();texture.dispose();floor.geometry.dispose();floor.material.dispose();renderer.dispose();if(world.current===state)world.current=null;};
  },[phase,cut,cfg]);

  const rayFor=event=>{
    const w=world.current;if(!w)return null;const rect=canvasRef.current.getBoundingClientRect(),pointer=new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),ray=new THREE.Raycaster();ray.setFromCamera(pointer,w.camera);return {w,ray};
  };
  const squishDown=event=>{
    if(!activeRef.current||(event.pointerType==='mouse'&&event.button!==0)||world.current?.drags.has(event.pointerId))return;
    const hit=rayFor(event);if(!hit)return;const intersections=hit.ray.intersectObject(hit.w.mesh);if(!intersections.length)return;
    event.preventDefault();event.stopPropagation();
    const {w}=hit;w.group.updateMatrixWorld(true);const inverse=w.group.matrixWorld.clone().invert(),worldPoint=intersections[0].point,local=w.group.worldToLocal(worldPoint.clone()),anchor={x:local.x*w.cage.unit,y:-local.y*w.cage.unit};
    const closest=w.cage.bodies.map(body=>({body,d:distance(body.position,anchor)})).sort((a,b)=>a.d-b.d).slice(0,4),joints=closest.map(({body})=>Matter.Constraint.create({bodyB:body,pointA:{...body.position},stiffness:.22,damping:.16}));
    Matter.Composite.add(w.cage.engine.world,joints);const normal=w.camera.getWorldDirection(new THREE.Vector3());
    w.drags.set(event.pointerId,{joints,anchor,starts:closest.map(({body})=>({...body.position})),plane:new THREE.Plane().setFromNormalAndCoplanarPoint(normal,worldPoint),inverse,target:{x:0,y:0},offset:{x:0,y:0},start:{x:event.clientX,y:event.clientY},moved:false,last:{x:local.x,y:local.y}});
    try{event.currentTarget.setPointerCapture(event.pointerId);}catch{}setGuide(false);setError('');
  };
  const squishMove=event=>{
    const hit=rayFor(event),drag=hit?.w.drags.get(event.pointerId);if(!drag)return;
    const point=new THREE.Vector3();if(!hit.ray.ray.intersectPlane(drag.plane,point))return;
    event.preventDefault();event.stopPropagation();point.applyMatrix4(drag.inverse);drag.last={x:point.x,y:point.y};
    drag.target=softDragOffset(point.x*hit.w.cage.unit-drag.anchor.x,-point.y*hit.w.cage.unit-drag.anchor.y);
    if(Math.hypot(event.clientX-drag.start.x,event.clientY-drag.start.y)>6)drag.moved=true;
  };
  const squishEnd=event=>{
    const w=world.current,drag=w?.drags.get(event.pointerId);if(!drag)return;drag.joints.forEach(j=>Matter.Composite.remove(w.cage.engine.world,j));w.drags.delete(event.pointerId);event.preventDefault();event.stopPropagation();try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}catch{}if(drag.moved&&event.type==='pointerup'){w.dragCount++;sound('squish');}
  };
  const reset=()=>{sound('tap');if(phase==='active')world.current?.reset();else{clearTrace();redraw();}};
  const traceAgain=()=>{sound('tap');setPhase('trace');clearTrace();};
  const resetIcon=<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8a7 7 0 1 1-1 7M5 4v4h4"/></svg>;
  const uploadIcon=<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15v5h14v-5M12 16V4m-4 4 4-4 4 4"/></svg>;
  return <main className={'photo-toy phase-'+phase} data-stage={phase} data-photo-source={uploaded?'uploaded':'sample'}>
    <input ref={fileRef} className="file-input" tabIndex={-1} aria-hidden="true" type="file" accept="image/*" aria-label="Upload an image" onChange={receiveFile}/>
    {guide&&<div className="toy-guide">{phase==='active'?'Press and drag to squish':uploaded?'Trace around your subject':cfg.GUIDE_TEXT}</div>}
    <div className="photo-zone">
      {phase==='trace'?<canvas key="trace" ref={traceRef} aria-label="Draw or tap an outline around your subject" onPointerDown={traceDown} onPointerMove={traceMove} onPointerUp={traceEnd} onPointerCancel={traceEnd} onLostPointerCapture={traceEnd}/>:<canvas key="3d" ref={canvasRef} aria-label="3D photo squishy. Press and drag to deform it." onPointerDown={squishDown} onPointerMove={squishMove} onPointerUp={squishEnd} onPointerCancel={squishEnd} onLostPointerCapture={squishEnd}/>}
      {loading&&<span className="load-state" role="status">Opening photo…</span>}
    </div>
    {error&&<div className="toy-error" role="alert">{error}</div>}
    <div className="toy-controls">
      <button className="utility" aria-label={phase==='active'?cfg.RESET_SHAPE_LABEL:cfg.RESET_LABEL} onClick={reset}>{resetIcon}<span>{phase==='active'?cfg.RESET_SHAPE_LABEL:cfg.RESET_LABEL}</span></button>
      <button className="utility" aria-label={cfg.CHOOSE_LABEL} onClick={chooseFile} disabled={loading}>{uploadIcon}<span>{cfg.CHOOSE_LABEL}</span></button>
      {phase==='trace'?<button className="make-button" disabled={!canMake||loading} onClick={makeToy}>{cfg.CONFIRM_LABEL}</button>:<button className="make-button" onClick={traceAgain}>Trace again</button>}
    </div>
    <style>{BASE_CSS+CSS}</style>
  </main>;
}

const CSS=`
@font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');font-weight:700;font-display:swap}
*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{background:#050607;color:#faf7ef;font-family:Poppins,system-ui,sans-serif;-webkit-tap-highlight-color:transparent}button{font:inherit;cursor:pointer;border:0;touch-action:manipulation}button:disabled{cursor:default}
.photo-toy{position:relative;width:100%;height:100%;overflow:hidden;background:#050607;container-type:size}.file-input{display:none}
.toy-guide{position:absolute;z-index:3;left:30px;right:30px;top:24%;transform:translateY(-50%);text-align:center;font-size:18px;line-height:1.3;font-weight:700;pointer-events:none;animation:batchBreathe 2.6s ease-in-out infinite}.photo-zone{position:absolute;left:30px;right:30px;top:31%;bottom:116px}.photo-zone canvas{display:block;width:100%;height:100%;touch-action:none;user-select:none}.phase-active .photo-zone{top:110px;background:radial-gradient(ellipse at 50% 70%,#1e2026 0%,#0d0f13 45%,#050607 76%)}.phase-active .toy-guide{top:62px}
.toy-controls{position:absolute;display:flex;align-items:center;justify-content:center;gap:8px;left:30px;right:30px;bottom:50px;min-height:46px}.utility{display:flex;align-items:center;justify-content:center;gap:5px;min-height:46px;padding:0 10px;border-radius:24px;background:#191b1f;color:#eeeae2;border:1px solid #37383c;font-size:12px;white-space:nowrap}.utility svg{width:18px;height:18px;stroke:#f4d292;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.make-button{min-height:46px;min-width:94px;padding:0 17px;border-radius:24px;background:#f3d292;color:#27231c;font-size:14px;font-weight:700;white-space:nowrap}.make-button:disabled{opacity:.35}.phase-active .utility{width:46px;min-width:46px;padding:0}.phase-active .utility span{display:none}.phase-active .make-button{flex:1;min-width:120px}.utility:active,.make-button:not(:disabled):active{transform:scale(.96)}.toy-error{position:absolute;z-index:4;left:30px;right:30px;bottom:106px;text-align:center;color:#ffd9b0;font-size:14px;line-height:1.35;background:#101216e8;padding:8px 10px;border-radius:10px}.load-state{position:absolute;inset:0;display:grid;place-items:center;background:#080a0de8;font-size:15px}
[data-feed-preview=true] .toy-controls{visibility:hidden}@media(max-width:440px){.utility{width:46px;min-width:46px;padding:0}.utility span{display:none}.toy-controls{gap:12px}.make-button{flex:1;min-width:90px}}@media(max-height:520px){.phase-active .photo-zone{top:90px}.phase-active .toy-guide{top:53px}.photo-zone{bottom:110px}}`;
createRoot(document.getElementById('root')).render(<App/>);
