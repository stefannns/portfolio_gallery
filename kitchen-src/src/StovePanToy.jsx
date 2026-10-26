import React, {useEffect, useMemo, useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {useGLTF} from '@react-three/drei';
import {PlaneGeometry, ShaderMaterial} from 'three';
import {useTaskOutline, useTaskOutlineIgnore} from './TaskOutline.jsx';
import {STOVE_DURATION, STOVE_LANDING_TIME, stoveMotion} from './kitchen-toy-state.js';

const PAN_URL = '/models/tripo/kitchen-frying-pan-v1.glb';
// Positioned over the front-left burner, leaving the other three clear.
const PAN_POSITION = Object.freeze([-3.65, 1.245, -.78]);
const noRaycast = () => {};
const flameVertex = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const flameFragment = `
  varying vec2 vUv;uniform float flameTime;uniform float flameOpacity;
  void main(){
    float y=vUv.y;float x=(vUv.x-.5)*2.0;
    float bend=(sin(y*10.0-flameTime*12.0)*.11+sin(y*19.0+flameTime*8.0)*.035)*y;
    float width=pow(max(0.0,1.0-y),.7)*.8+.025;
    float body=1.0-smoothstep(width*.64,width,abs(x-bend));
    body*=smoothstep(0.0,.06,y)*(1.0-smoothstep(.91,1.0,y));
    float core=1.0-smoothstep(width*.15,width*.54,abs(x-bend));
    vec3 color=mix(vec3(1.0,.20,.035),vec3(1.0,.82,.27),core*(1.0-y*.5));
    color=mix(vec3(.22,.51,1.0),color,smoothstep(.02,.17,y));
    gl_FragColor=vec4(color,body*flameOpacity*.93);
    #include <colorspace_fragment>
  }
`;

export default function StovePanToy({actionRef, paused = false, reducedMotion = false, highlighted = false, rootRef, onReady, onLand}) {
  const {scene} = useGLTF(PAN_URL, '/draco/');
  const pan = useRef(), flames = useRef(), lamp = useRef();
  const ignoreFlame = useTaskOutlineIgnore();
  const current = useRef({elapsed: STOVE_DURATION, landed: true, launches: 0, paused, reducedMotion, rootRef});
  Object.assign(current.current, {paused, reducedMotion, rootRef, onLand});
  const {object, materials} = useMemo(() => {
    const object = scene.clone(true), materials = [];
    object.position.set(.14, .12979126, 0);
    object.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;node.receiveShadow = true;node.raycast = noRaycast;
      const own = material => {const clone = material.clone();materials.push(clone);return clone;};
      node.material = Array.isArray(node.material) ? node.material.map(own) : own(node.material);
    });
    return {object, materials};
  }, [scene]);
  const effect = useMemo(() => ({geometry: new PlaneGeometry(1, 1), material: new ShaderMaterial({
    vertexShader: flameVertex, fragmentShader: flameFragment,
    uniforms: {flameTime: {value: 0}, flameOpacity: {value: 0}},
    transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
  })}), []);
  useTaskOutline(object, false, highlighted);

  const api = useMemo(() => ({
    burst() {
      const state = current.current;
      if (state.paused || state.elapsed < STOVE_DURATION || !pan.current) return false;
      state.elapsed = .0001;state.landed = false;state.launches++;return true;
    },
    reset() {current.current.elapsed = STOVE_DURATION;current.current.landed = true;},
  }), []);
  useEffect(() => {
    if (actionRef) actionRef.current = api;
    onReady?.();
    return () => {if (actionRef?.current === api) actionRef.current = null;};
  }, [actionRef, api, onReady]);
  useEffect(() => () => {materials.forEach(material => material.dispose());effect.geometry.dispose();effect.material.dispose();}, [materials, effect]);

  useFrame((_state, delta) => {
    const state = current.current;
    if (!state.paused) state.elapsed = Math.min(STOVE_DURATION, state.elapsed + Math.min(delta, .05));
    if (!state.paused && !state.landed && state.elapsed >= STOVE_LANDING_TIME) {
      state.landed = true;state.onLand?.();
    }
    const motion = stoveMotion(state.elapsed, state.reducedMotion);
    if (pan.current) {pan.current.position.y = PAN_POSITION[1] + motion.lift;pan.current.rotation.z = motion.tilt;}
    if (flames.current) {
      flames.current.visible = motion.flame > .001 && motion.flameHeight > .001;
      flames.current.position.y = PAN_POSITION[1] - .012 + motion.flameHeight / 2;
      flames.current.scale.set(.33 + motion.lift * .05, motion.flameHeight, 1);
    }
    effect.material.uniforms.flameTime.value = state.elapsed;
    effect.material.uniforms.flameOpacity.value = motion.flame;
    if (lamp.current) lamp.current.intensity = motion.flame * 1.3;
    const root = state.rootRef?.current || state.rootRef;
    if (root?.dataset) {
      root.dataset.stoveActive = String(state.elapsed < STOVE_DURATION);
      root.dataset.stoveLaunches = String(state.launches);
      root.dataset.panLift = motion.lift.toFixed(3);
    }
  }, -.25);

  return <>
    <group ref={pan} name="stove-frying-pan" position={PAN_POSITION} dispose={null}>
      <group scale={.53}><primitive object={object}/></group>
    </group>
    <group ref={ignoreFlame}>
      <mesh ref={flames} position={[PAN_POSITION[0] + .02, PAN_POSITION[1], PAN_POSITION[2]]}
        rotation={[0, Math.PI / 2, 0]} geometry={effect.geometry} material={effect.material} visible={false} raycast={noRaycast}/>
      <pointLight ref={lamp} position={[PAN_POSITION[0] + .05, PAN_POSITION[1] + .25, PAN_POSITION[2]]}
        color="#ffac50" intensity={0} distance={2} decay={2}/>
    </group>
  </>;
}
