import React, {useEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';

export const RIFT_SIZE=new THREE.Vector2(6,3.6);

// The approved angular tear. Share its concave contour across the image,
// hit testing and particle emitters so the invisible plane never catches clicks.
const CUT=[
  [489,230],[542,195],[562,171],[608,164],[629,142],[685,147],
  [741,121],[862,107],[799,151],[780,177],[727,196],[705,218],
  [655,222],[614,245],[571,236],[534,249],
];

export function createRiftShape(index){
  const seed=index*1.73+.8,flip=index%3===1?-1:1;
  return CUT.map(([x,y],i)=>{
    const tip=i===0||i===7;
    return new THREE.Vector2(
      (x-675.5)/195+(tip?0:Math.sin(seed+i*2.1)*.021),
      ((180-y)/110+(tip?0:Math.cos(seed*.7+i*1.8)*.025))*flip,
    );
  });
}

export function distanceToRift(x,y,points){
  const aspect=RIFT_SIZE.x/RIFT_SIZE.y;
  x*=aspect;
  let distance2=Infinity,inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[j],b=points[i],ax=a.x*aspect,bx=b.x*aspect;
    const ex=bx-ax,ey=b.y-a.y,wx=x-ax,wy=y-a.y;
    const t=THREE.MathUtils.clamp((wx*ex+wy*ey)/(ex*ex+ey*ey),0,1);
    distance2=Math.min(distance2,(wx-ex*t)**2+(wy-ey*t)**2);
    if((a.y>y)!==(b.y>y)&&x<(bx-ax)*(y-a.y)/(b.y-a.y)+ax)inside=!inside;
  }
  return Math.sqrt(distance2)*(inside?-1:1);
}

export const RIFT_NOISE=`
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
  }
  float fbm(vec2 p){return noise(p)*.57+noise(p*2.07+7.)*.28+noise(p*4.13+17.)*.15;}
`;

// Outward normal, signed distance and edge position. Unrolled edge calls keep
// uniform indexing compatible with conservative mobile graphics drivers.
export const RIFT_FIELD=`
  uniform vec2 uPoints[16];
  void cutEdge(vec2 p,vec2 a,vec2 b,float phase,inout float best,inout vec2 nearest,inout float edgePhase,inout float inside){
    vec2 e=b-a,w=p-a;
    float t=clamp(dot(w,e)/dot(e,e),0.,1.);
    vec2 delta=w-e*t;
    float d=dot(delta,delta);
    if(d<best){best=d;nearest=delta;edgePhase=(phase+t)/16.;}
    if((a.y>p.y)!=(b.y>p.y)){
      if(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=1.-inside;
    }
  }
  vec4 riftField(vec2 p){
    vec2 metric=vec2(${RIFT_SIZE.x/RIFT_SIZE.y},1.);
    p*=metric;
    float best=100.,inside=0.,phase=0.;vec2 nearest=vec2(0.);
    ${CUT.map((_,i)=>`cutEdge(p,uPoints[${i}]*metric,uPoints[${(i+1)%CUT.length}]*metric,${i}.,best,nearest,phase,inside);`).join('\n')}
    float direction=1.-inside*2.;
    return vec4(normalize(nearest+vec2(.000001))*direction,sqrt(best)*direction,phase);
  }
`;

function random(seed){const r=Math.sin(seed*127.1+311.7)*43758.5453;return r-Math.floor(r);}

const VERTEX=`
  attribute vec2 aOrigin,aNormal;
  attribute float aSeed,aSize;
  uniform float uTime,uActive,uPulse,uDpr;
  varying float vAlpha,vStar;
  void main(){
    float life=fract(aSeed+uTime*(.045+aSeed*.025));
    vec2 tangent=vec2(-aNormal.y,aNormal.x);
    vec2 drift=aNormal*life*life*.2+tangent*sin(uTime*.22+aSeed*12.)*.035*life;
    vec3 p=vec3(aOrigin+drift,.025+sin(aSeed*8.+uTime*.2)*.055);
    vec4 mv=modelViewMatrix*vec4(p,1.);
    gl_Position=projectionMatrix*mv;
    gl_PointSize=clamp(aSize*(470./-mv.z)*uDpr*(.7+uActive*.7+uPulse*.2),1.,10.);
    vAlpha=sin(life*3.14159)*(.11+uActive*.34+uPulse*.12);
    vStar=step(.94,aSeed);
  }
`;
const FRAGMENT=`
  uniform vec3 uColor;
  varying float vAlpha,vStar;
  void main(){
    vec2 p=gl_PointCoord-.5;
    float glow=exp(-dot(p,p)*38.);
    float cross=(exp(-abs(p.x)*80.)*exp(-abs(p.y)*7.)+exp(-abs(p.y)*80.)*exp(-abs(p.x)*7.))*vStar;
    float a=(glow+cross*.4)*vAlpha;
    if(a<.006)discard;
    gl_FragColor=vec4(uColor,a);
    #include <colorspace_fragment>
  }
`;

export function RiftParticles({index,points,active,mobile,reducedMotion,paused,pulse,color}){
  const ref=useRef(),time=useRef(0);
  const geometry=useMemo(()=>{
    const count=mobile?48:92,positions=new Float32Array(count*3),origins=[],normals=[],seeds=[],sizes=[];
    const vertices=points.map(p=>new THREE.Vector2(p.x*RIFT_SIZE.x*.5,p.y*RIFT_SIZE.y*.5));
    const edges=vertices.map((a,i)=>{
      const b=vertices[(i+1)%vertices.length],direction=b.clone().sub(a);
      return {a,direction,length:direction.length()};
    });
    const perimeter=edges.reduce((sum,e)=>sum+e.length,0);
    const winding=Math.sign(vertices.reduce((sum,a,i)=>{
      const b=vertices[(i+1)%vertices.length];return sum+a.x*b.y-a.y*b.x;
    },0));
    for(let i=0;i<count;i++){
      let along=random(i*3+index*7)*perimeter,edge=edges.at(-1);
      for(const candidate of edges){edge=candidate;if(along<=edge.length)break;along-=edge.length;}
      const origin=edge.a.clone().addScaledVector(edge.direction,along/edge.length);
      const normal=new THREE.Vector2(edge.direction.y,-edge.direction.x).normalize().multiplyScalar(winding);
      origins.push(origin.x,origin.y);normals.push(normal.x,normal.y);
      seeds.push(random(i*31+index*53));sizes.push(.022+random(i*11+index)*.05);
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geo.setAttribute('aOrigin',new THREE.Float32BufferAttribute(origins,2));
    geo.setAttribute('aNormal',new THREE.Float32BufferAttribute(normals,2));
    geo.setAttribute('aSeed',new THREE.Float32BufferAttribute(seeds,1));
    geo.setAttribute('aSize',new THREE.Float32BufferAttribute(sizes,1));
    return geo;
  },[index,mobile,points]);
  const uniforms=useMemo(()=>({uTime:{value:0},uActive:{value:active?1:0},uPulse:{value:0},uDpr:{value:1},uColor:{value:new THREE.Color(color).lerp(new THREE.Color('#bbd5ed'),.8)}}),[index,color]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  useFrame(({gl},delta)=>{
    if(!ref.current)return;
    if(!paused&&!reducedMotion)time.current+=Math.min(delta,.05);
    const u=ref.current.uniforms;
    u.uTime.value=time.current;u.uDpr.value=gl.getPixelRatio();u.uPulse.value=pulse.current;
    u.uActive.value=THREE.MathUtils.damp(u.uActive.value,active?1:0,4,delta);
  });
  if(reducedMotion)return null;
  return <points geometry={geometry} raycast={()=>null} frustumCulled={false}>
    <shaderMaterial ref={ref} uniforms={uniforms} vertexShader={VERTEX} fragmentShader={FRAGMENT}
      transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false}/>
  </points>;
}
