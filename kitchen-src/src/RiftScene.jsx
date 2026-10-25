import React,{Suspense,useEffect,useMemo,useRef,useState} from 'react';
import {Canvas,useFrame,useThree} from '@react-three/fiber';
import {useTexture} from '@react-three/drei';
import * as THREE from 'three';
import {projects,homeSlots} from './projects.js';
import {RiftParticles,RIFT_SIZE,RIFT_NOISE,RIFT_FIELD,createRiftShape,distanceToRift} from './RiftEffects.jsx';

const VERTEX=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const FRAGMENT=`
  uniform sampler2D uMap;
  uniform float uTime,uActive,uHover,uImageAspect,uImageZoom,uSeed,uPulse;
  uniform vec2 uPointer,uImageFocus;
  uniform vec3 uTint;
  varying vec2 vUv;
  ${RIFT_NOISE}
  ${RIFT_FIELD}
  vec2 imageUv(vec2 uv){
    float aspect=${RIFT_SIZE.x/RIFT_SIZE.y};
    uv=(uv-.5)/uImageZoom;
    if(uImageAspect>aspect)uv.x*=aspect/uImageAspect;
    else uv.y*=uImageAspect/aspect;
    return clamp(uv+uImageFocus,.002,.998);
  }
  void main(){
    vec2 p=(vUv-.5)*2.;
    vec4 field=riftField(p);
    if(field.z>.13)discard;
    float n=fbm(p*5.+vec2(uTime*.065,-uTime*.045)+uSeed);
    float d=field.z+(n-.5)*.006;
    float aa=max(fwidth(d),.001);
    float energy=fbm(p*9.+vec2(uTime*.12,uTime*-.09)+uSeed*2.);
    float feather=max(aa*1.15,.007+energy*.006);
    float coverage=1.-smoothstep(-feather,feather*.4,d);
    float haze=exp(-abs(d)*39.)*(.15+energy*.85);
    float thread=exp(-abs(d+(energy-.5)*.004)*245.);
    float breaks=smoothstep(.3,.68,noise(vec2(field.w*36.+uTime*.08,uSeed*2.)));
    float filament=exp(-abs(d-.023-(energy-.5)*.012)*175.)*pow(max(0.,sin(field.w*47.-uTime*.24+uSeed)),12.);
    float innerShadow=smoothstep(-.12,-.005,d);
    vec2 normal=vec2(field.x/${RIFT_SIZE.x/RIFT_SIZE.y},field.y);
    vec2 bend=normal*haze*(.008+energy*.008);
    vec2 uv=vUv+uPointer*.006*uActive;
    float fringe=exp(-abs(d)*65.)*.0025;
    vec3 col;
    col.r=texture2D(uMap,imageUv(uv+bend+normal*fringe)).r;
    col.g=texture2D(uMap,imageUv(uv+bend)).g;
    col.b=texture2D(uMap,imageUv(uv+bend-normal*fringe)).b;
    float luma=dot(col,vec3(.2126,.7152,.0722));
    col=mix(vec3(luma),col,.72+.28*uActive);
    col*=.52+.48*uActive+uHover*.04;
    col*=1.-innerShadow*.27;
    vec3 light=mix(vec3(.44,.64,.89),uTint,.18);
    light=mix(light,vec3(.69,.55,.9),.2+.15*sin(field.w*12.+uSeed));
    float glow=haze*(.1+uActive*.09)+thread*breaks*.09+filament*.08;
    float alpha=coverage+glow*(1.-coverage);
    if(alpha<.008)discard;
    col=mix(light*(.7+energy*.4),col,coverage);
    col+=light*(thread*breaks*(.15+uHover*.1+uPulse*.12)+filament*.1);
    gl_FragColor=vec4(col,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function targetFor(slot,mobile){
  const slots=mobile?{
    0:[0,2.05,.6,-.08,-.08,-.06,.58],
    '-1':[-2.15,.4,-1.7,.08,.15,.1,.63],
    1:[2.3,-.9,-2,.1,-.2,-.14,.56],
    '-2':[-1.8,3.5,-5,.05,.2,-.12,.36],
    2:[1.8,3.7,-5,-.05,-.2,.15,.34],
    '-3':[-2.6,-2.5,-6,.1,.3,-.1,.35],
    3:[2.6,-2.5,-6,-.1,-.3,.12,.35],
    4:[.1,4.5,-8,.1,-.1,-.07,.27],
  }:{
    0:[2.55,1.1,.75,.02,-.15,-.055,.84],
    '-1':[-3.1,.55,-.8,-.06,.18,.1,.76],
    1:[4.15,-1.4,-2.4,.1,-.25,-.14,.65],
    '-2':[-4.6,2.55,-4,.06,.22,-.14,.55],
    2:[.5,2.9,-4.8,-.1,-.18,.11,.5],
    '-3':[-5.1,-1.9,-4.7,.1,.3,-.1,.51],
    3:[5.8,2.65,-5,.1,-.3,.16,.46],
    4:[-1.6,2.55,-7,.1,.1,-.1,.42],
  };
  return slots[slot];
}

function Rift({project,index,focused,onFocus,onOpen,dragged,reducedMotion,mobile,paused}){
  const group=useRef(),material=useRef(),hover=useRef(false),initialized=useRef(false),pulse=useRef(0),time=useRef(0);
  const cover=useTexture(project.image);
  const active=project.id===focused;
  const slot=active?0:homeSlots[project.id]===0?homeSlots[focused]:homeSlots[project.id];
  const target=targetFor(slot,mobile);
  const geometry=useMemo(()=>new THREE.PlaneGeometry(RIFT_SIZE.x,RIFT_SIZE.y),[]);
  const points=useMemo(()=>createRiftShape(index),[index]);
  const position=useMemo(()=>new THREE.Vector3(),[]),scale=useMemo(()=>new THREE.Vector3(),[]);
  const rotation=useMemo(()=>new THREE.Euler(),[]),quaternion=useMemo(()=>new THREE.Quaternion(),[]);
  const pointerTarget=useMemo(()=>new THREE.Vector2(),[]);
  const uniforms=useMemo(()=>({uMap:{value:cover},uTime:{value:0},uActive:{value:active?1:0},uHover:{value:0},
    uImageAspect:{value:1.5},uImageZoom:{value:project.riftZoom||1},uImageFocus:{value:new THREE.Vector2(...(project.riftFocus||[.5,.5]))},
    uPointer:{value:new THREE.Vector2()},uSeed:{value:index*1.73+.8},uPulse:{value:0},
    uTint:{value:new THREE.Color(project.color)},uPoints:{value:points}}),[cover,index,project,points]);

  useEffect(()=>{cover.colorSpace=THREE.SRGBColorSpace;uniforms.uImageAspect.value=cover.image.width/cover.image.height;},[cover,uniforms]);
  useEffect(()=>{if(active&&!reducedMotion)pulse.current=1;},[active,reducedMotion]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);

  const interact=e=>{
    const p=e.point.clone();group.current.worldToLocal(p);
    const x=p.x/(RIFT_SIZE.x*.5),y=p.y/(RIFT_SIZE.y*.5);
    return distanceToRift(x,y,points)<.012;
  };

  useFrame((state,delta)=>{
    if(!group.current)return;
    if(!paused&&!reducedMotion)time.current+=Math.min(delta,.05);
    const t=time.current,parallax=reducedMotion||mobile||paused?0:1;
    const drift=reducedMotion?0:Math.sin(t*.24+index)*.025;
    position.set(target[0]+state.pointer.x*.045*parallax,target[1]+drift+state.pointer.y*.035*parallax,target[2]);
    rotation.set(target[3]-state.pointer.y*.013*parallax,target[4]+state.pointer.x*.02*parallax,target[5]);quaternion.setFromEuler(rotation);
    scale.setScalar(target[6]);
    const amount=initialized.current&&!reducedMotion?1-Math.exp(-delta*4.8):1;
    group.current.position.lerp(position,amount);group.current.quaternion.slerp(quaternion,amount);group.current.scale.lerp(scale,amount);
    initialized.current=true;pulse.current=THREE.MathUtils.damp(pulse.current,0,1.4,delta);
    if(material.current){const u=material.current.uniforms;
      u.uTime.value=t;u.uPulse.value=pulse.current;
      pointerTarget.copy(state.pointer).multiplyScalar(parallax);u.uPointer.value.lerp(pointerTarget,.06);
      u.uActive.value=THREE.MathUtils.damp(u.uActive.value,active?1:0,5,delta);
      u.uHover.value=THREE.MathUtils.damp(u.uHover.value,hover.current?1:0,7,delta);
    }
  });

  return <group ref={group}>
    <mesh geometry={geometry}
      onPointerMove={e=>{if(interact(e)){e.stopPropagation();hover.current=true;document.body.style.cursor='pointer';}else{hover.current=false;document.body.style.cursor='';}}}
      onPointerOut={()=>{hover.current=false;document.body.style.cursor='';}}
      onClick={e=>{if(!interact(e))return;e.stopPropagation();if(dragged.current)return;active?onOpen(project.id):onFocus(project.id);}}>
      <shaderMaterial ref={material} uniforms={uniforms} vertexShader={VERTEX} fragmentShader={FRAGMENT}
        transparent depthWrite={false} side={THREE.DoubleSide}/>
    </mesh>
    <RiftParticles index={index} points={points} active={active} mobile={mobile} reducedMotion={reducedMotion} paused={paused} pulse={pulse} color={project.color}/>
  </group>;
}

function Camera({mobile}){
  const {camera}=useThree();
  useEffect(()=>{camera.position.set(0,.15,mobile?9.8:9.4);camera.fov=mobile?48:38;camera.lookAt(0,.1,0);camera.updateProjectionMatrix();},[camera,mobile]);
  return null;
}

export default function RiftScene(props){
  const [ready,setReady]=useState(false);
  return <div className={`canvas-container ${ready?'is-ready':''}`} aria-hidden="true">
    <Canvas dpr={[1,1.65]} camera={{position:[0,.15,9.4],fov:38}} gl={{alpha:true,antialias:true,powerPreference:'high-performance'}}
      onCreated={({gl})=>{gl.setClearColor(0x000000,0);setReady(true);}}>
      <Camera mobile={props.mobile}/>
      <Suspense fallback={null}>{projects.map((project,index)=><Rift key={project.id} {...props} project={project} index={index}/>)}</Suspense>
    </Canvas>
  </div>;
}
