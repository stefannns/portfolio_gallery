import React, {useEffect, useMemo, useRef} from 'react';
import {useFrame, useThree} from '@react-three/fiber';
import {Color, DoubleSide, Mesh, MeshBasicMaterial, RingGeometry, ShaderMaterial, SphereGeometry} from 'three';
import {useTaskOutlineIgnore} from './TaskOutline.jsx';

const DEFAULT_POSITION = Object.freeze([-3.96, 1.18, 2.775]);
const BUBBLE_COUNT = 20;
const POP_COUNT = 10;
const POP_DURATION = .24;
const BURST_COOLDOWN = 1.05;
const noRaycast = () => {};

const vertexShader = `
  varying vec3 vBubbleNormal;
  varying vec3 vBubbleView;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vBubbleNormal = normalize(normalMatrix * normal);
    vBubbleView = -viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const fragmentShader = `
  uniform float bubbleOpacity;
  uniform vec3 mintColor;
  uniform vec3 roseColor;
  varying vec3 vBubbleNormal;
  varying vec3 vBubbleView;
  void main() {
    vec3 normal = normalize(vBubbleNormal);
    float facing = clamp(abs(dot(normal, normalize(vBubbleView))), 0.0, 1.0);
    float rim = pow(1.0 - facing, 2.25);
    float glint = exp(-dot(normal.xy - vec2(-.32, .46), normal.xy - vec2(-.32, .46)) * 95.0);
    float smallGlint = exp(-dot(normal.xy - vec2(.48, -.32), normal.xy - vec2(.48, -.32)) * 180.0) * .45;
    vec3 film = mix(mintColor, roseColor, smoothstep(-.7, .7, normal.x));
    film = mix(film, vec3(1.0), clamp(glint + smallGlint, 0.0, 1.0));
    float alpha = (.045 + rim * .82 + glint * .75 + smallGlint) * bubbleOpacity;
    gl_FragColor = vec4(film, clamp(alpha, 0.0, .9));
    #include <colorspace_fragment>
  }
`;

function createBubble() {
  return {
    node: null, born: -Infinity, life: 0, radius: 0, phase: 0,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    material: new ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {bubbleOpacity: {value: 0}, mintColor: {value: new Color('#62b5b8')}, roseColor: {value: new Color('#cf83b5')}},
      transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
    }),
  };
}

function createPop() {
  return {
    node: null, born: -Infinity, radius: 0,
    material: new MeshBasicMaterial({color: '#effff4', transparent: true, opacity: 0,
      depthTest: true, depthWrite: false, toneMapped: false, side: DoubleSide}),
  };
}

/** A capped, action-driven pool; no input listeners or per-frame React state. */
export default function SinkBubbles({actionRef, position = DEFAULT_POSITION, paused = false, reducedMotion = false, rootRef, onPop}) {
  const ignoreOutline = useTaskOutlineIgnore();
  const {gl} = useThree();
  const sphere = useMemo(() => new SphereGeometry(1, 20, 14), []);
  const ring = useMemo(() => new RingGeometry(.91, 1, 28), []);
  const bubbles = useMemo(() => Array.from({length: BUBBLE_COUNT}, createBubble), []);
  const pops = useMemo(() => Array.from({length: POP_COUNT}, createPop), []);
  const state = useRef({time: 0, lastBurst: -Infinity, bubbleCursor: 0, popCursor: 0, bursts: 0, popped: 0, paused, reducedMotion, rootRef});
  state.current.paused = paused;
  state.current.reducedMotion = reducedMotion;
  state.current.rootRef = rootRef;
  state.current.onPop = onPop;

  // Hidden pooled bubbles must never intercept floor or fixture clicks.
  const bubbleRaycast = useMemo(() => function (raycaster, hits) {
    if (this.visible && !state.current.paused) Mesh.prototype.raycast.call(this, raycaster, hits);
  }, []);

  const api = useMemo(() => {
    function publish() {
      const current = state.current;
      const root = current.rootRef?.current || current.rootRef;
      if (!root?.dataset) return;
      root.dataset.sinkBubblesActive = String(bubbles.filter(bubble => bubble.node?.visible).length);
      root.dataset.sinkBubblesPopped = String(current.popped);
      root.dataset.sinkBubbleBursts = String(current.bursts);
    }

    function reset() {
      const current = state.current;
      current.time = 0;current.lastBurst = -Infinity;current.bubbleCursor = 0;current.popCursor = 0;current.bursts = 0;current.popped = 0;
      for (const item of [...bubbles, ...pops]) {item.born = -Infinity;if (item.node) item.node.visible = false;}
      publish();
    }

    function burst() {
      const current = state.current;
      if (current.paused || current.time - current.lastBurst < BURST_COOLDOWN || !bubbles[0].node) return false;
      const count = current.reducedMotion ? 6 : 10;
      for (let index = 0; index < count; index++) {
        const bubble = bubbles[current.bubbleCursor++ % bubbles.length];
        bubble.born = current.time + index * .085;
        bubble.life = current.reducedMotion ? 2.6 : 3.1 + Math.random() * .8;
        bubble.radius = .11 + Math.random() * .09;
        bubble.phase = Math.random() * Math.PI * 2;
        bubble.x = (Math.random() - .5) * .22;
        bubble.y = (Math.random() - .5) * .04;
        bubble.z = (Math.random() - .5) * .3;
        bubble.vx = (current.reducedMotion ? .055 : .17) + Math.random() * .14;
        bubble.vy = (current.reducedMotion ? .2 : .4) + Math.random() * .22;
        bubble.vz = (Math.random() - .5) * (current.reducedMotion ? .05 : .42);
        bubble.node.visible = false;
      }
      current.lastBurst = current.time;current.bursts++;publish();
      return true;
    }

    function pop(index) {
      const current = state.current, bubble = bubbles[index];
      if (current.paused || !bubble?.node?.visible) return false;
      const ripple = pops[current.popCursor++ % pops.length];
      ripple.born = current.time;ripple.radius = bubble.radius;
      ripple.node?.position.copy(bubble.node.position);
      if (ripple.node) ripple.node.visible = true;
      bubble.born = -Infinity;bubble.node.visible = false;
      current.popped++;current.onPop?.();publish();
      return true;
    }

    return {burst, reset, pop, publish};
  }, [bubbles, pops]);

  useEffect(() => {
    if (actionRef) actionRef.current = api;
    api.publish();
    return () => {if (actionRef?.current === api) actionRef.current = null;};
  }, [actionRef, api]);
  useEffect(() => {if (paused) gl.domElement.style.cursor = '';}, [paused, gl]);
  useEffect(() => () => {
    sphere.dispose();ring.dispose();
    bubbles.forEach(bubble => bubble.material.dispose());
    pops.forEach(pop => pop.material.dispose());
    gl.domElement.style.cursor = '';
  }, [sphere, ring, bubbles, pops, gl]);

  useFrame(({camera}, delta) => {
    const current = state.current;
    if (!current.paused) current.time += Math.min(Math.max(delta, 0), .05);
    for (const bubble of bubbles) {
      if (!bubble.node) continue;
      const age = current.time - bubble.born;
      bubble.node.visible = age >= 0 && age < bubble.life;
      if (!bubble.node.visible) continue;
      const drift = current.reducedMotion ? .012 : .035;
      bubble.node.position.set(bubble.x + bubble.vx * age + Math.sin(age * 1.7 + bubble.phase) * drift,
        bubble.y + bubble.vy * age, bubble.z + bubble.vz * age + Math.cos(age * 1.35 + bubble.phase) * drift);
      const inflation = Math.min(1, .2 + age / .18);
      bubble.node.scale.setScalar(bubble.radius * inflation);
      bubble.material.uniforms.bubbleOpacity.value = Math.min(1, age / .15) * Math.min(1, (bubble.life - age) / .55);
    }
    for (const pop of pops) {
      if (!pop.node) continue;
      const progress = (current.time - pop.born) / POP_DURATION;
      pop.node.visible = progress >= 0 && progress < 1;
      if (!pop.node.visible) continue;
      pop.node.quaternion.copy(camera.quaternion);
      pop.node.scale.setScalar(pop.radius * (.8 + progress * 1.4));
      pop.material.opacity = .7 * (1 - progress) ** 1.5;
    }
    api.publish();
  }, -.25);

  return <group ref={ignoreOutline} position={position} name="sink-soap-bubbles" dispose={null}>
    {bubbles.map((bubble, index) => <mesh key={`bubble-${index}`} ref={node => {bubble.node = node;}}
      visible={false} raycast={bubbleRaycast} geometry={sphere} material={bubble.material} renderOrder={1}
      onPointerDown={event => {event.stopPropagation();event.nativeEvent?.preventDefault();}}
      onClick={event => {event.stopPropagation();if ((event.delta ?? 0) <= 6) api.pop(index);gl.domElement.style.cursor = '';}}
      onPointerOver={event => {event.stopPropagation();if (!state.current.paused) gl.domElement.style.cursor = 'pointer';}}
      onPointerOut={() => {gl.domElement.style.cursor = '';}}/>)}
    {pops.map((pop, index) => <mesh key={`pop-${index}`} ref={node => {pop.node = node;}}
      visible={false} geometry={ring} material={pop.material} renderOrder={2} raycast={noRaycast}/>)}
  </group>;
}
