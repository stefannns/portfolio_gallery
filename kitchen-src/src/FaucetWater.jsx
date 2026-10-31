import React, {useMemo, useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {DoubleSide} from 'three';
import {useTaskOutlineIgnore} from './TaskOutline.jsx';

// Anchored to the repaired faucet's outlet and the actual sink-basin floor.
const OUTLET = [-3.976, 1.324, 2.778];
const BASIN_Y = .714;
const LENGTH = OUTLET[1] - BASIN_Y;
const noRaycast = () => {};

export default function FaucetWater({paused = false, reducedMotion = false}) {
  const ignoreOutline = useTaskOutlineIgnore();
  const time = useRef(0), ripples = useRef([]), drops = useRef([]);
  const uniforms = useMemo(() => ({flowTime: {value: 0}}), []);
  useFrame((_, delta) => {
    if (!paused && !reducedMotion) time.current += Math.min(delta, .05);
    uniforms.flowTime.value = time.current;
    ripples.current.forEach((node, i) => {
      if (!node) return;
      const phase = (time.current * 1.4 + i / 3) % 1;
      node.scale.setScalar(.035 + phase * .115);
      node.material.opacity = .48 * (1 - phase);
    });
    drops.current.forEach((node, i) => {
      if (!node) return;
      const phase = (time.current * 1.8 + i / 6) % 1;
      const angle = i * 2.39996;
      const radius = .02 + phase * .09;
      node.position.set(Math.cos(angle) * radius, Math.sin(phase * Math.PI) * .075, Math.sin(angle) * radius);
      node.scale.setScalar(.009 * (1 - phase * .55));
    });
  });
  return <group ref={ignoreOutline} name="faucet-running-water" position={[OUTLET[0], BASIN_Y, OUTLET[2]]}>
    <mesh position={[0, LENGTH / 2, 0]} raycast={noRaycast}>
      <cylinderGeometry args={[.021, .016, LENGTH, 12, 12, true]}/>
      <shaderMaterial transparent depthWrite={false} toneMapped={false} uniforms={uniforms}
        vertexShader={`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`}
        fragmentShader={`varying vec2 vUv; uniform float flowTime; void main(){
          float streak = pow(.5+.5*cos(vUv.x*6.28318),6.0);
          float flow = .5+.5*sin(vUv.y*72.0+flowTime*17.0);
          vec3 color = mix(vec3(.43,.79,.88),vec3(.94,.99,1.0),.45+streak*.5);
          gl_FragColor=vec4(color,.52+streak*.26+flow*.08);
          #include <colorspace_fragment>
        }`}/>
    </mesh>
    {[0, 1, 2].map(i => <mesh key={`ripple-${i}`} ref={node => {ripples.current[i] = node;}}
      rotation={[-Math.PI / 2, 0, 0]} position={[0, .002 + i * .001, 0]} raycast={noRaycast}>
      <ringGeometry args={[.8, 1, 32]}/>
      <meshBasicMaterial color="#bce9ed" transparent opacity={.3} depthWrite={false} side={DoubleSide} toneMapped={false}/>
    </mesh>)}
    {[0, 1, 2, 3, 4, 5].map(i => <mesh key={`drop-${i}`} ref={node => {drops.current[i] = node;}} raycast={noRaycast}>
      <sphereGeometry args={[1, 8, 6]}/>
      <meshBasicMaterial color="#d9f5f7" transparent opacity={.7} depthWrite={false} toneMapped={false}/>
    </mesh>)}
  </group>;
}
