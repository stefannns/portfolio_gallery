import React, {Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {Canvas, useFrame, useThree} from '@react-three/fiber';
import {Environment, Lightformer, useGLTF} from '@react-three/drei';
import {clone as cloneSkeleton} from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import {Asset} from './Conveyor3D.jsx';
import {RestaurantModel} from './TripoRestaurant.jsx';
import {correctCapybaraClip} from './retarget-capybara.js';
import {BAR_LAYOUT, WALK_TIME_SCALE, START_POSITION} from './discovery-layout.js';
import {stepPlayer} from './discovery-physics.js';
import DiscoveryRoom from './DiscoveryRoom.jsx';
import DiscoveryInspect from './DiscoveryInspect.jsx';
import './sushi-bar.css';

function DiscoveryObject({station, entry, engine, onInspect}) {
  return <group position={station.position}
    onPointerOver={event => {event.stopPropagation();if (!engine.paused) document.body.style.cursor = 'pointer';}}
    onPointerOut={() => {document.body.style.cursor = '';}}
    onClick={event => {event.stopPropagation();document.body.style.cursor = '';if (!engine.paused) onInspect(station.id);}}>
    <RestaurantModel entry={entry} dimensions={[station.width, station.width, station.width]} rotationY={station.rotationY} uniform/>
  </group>;
}

function AnimatedChef({idleUrl, walkUrl, engine}) {
  const idle = useGLTF(idleUrl, '/draco/');
  const walking = useGLTF(walkUrl, '/draco/');
  const {scene, mixer, idleAction, walkAction, scale} = useMemo(() => {
    const scene = cloneSkeleton(idle.scene);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    scene.position.set(-center.x, -box.min.y, -center.z);
    scene.traverse(node => {if (node.isMesh) {node.castShadow = true;node.receiveShadow = true;}});
    const mixer = new THREE.AnimationMixer(scene);
    const idleClip = idle.animations[0] ? correctCapybaraClip(idle.animations[0], scene, {motion: 'idle', strength: .65}) : null;
    const walkClip = walking.animations[0] ? correctCapybaraClip(walking.animations[0], scene, {motion: 'walk', strength: .65}) : null;
    const idleAction = idleClip ? mixer.clipAction(idleClip) : null;
    const walkAction = walkClip ? mixer.clipAction(walkClip) : null;
    idleAction?.setEffectiveWeight(1).play();walkAction?.setEffectiveWeight(0).play();
    return {scene, mixer, idleAction, walkAction, scale: 1.8 / size.y};
  }, [idle, walking]);
  const lastMoving = useRef(false);
  useEffect(() => () => {mixer.stopAllAction();mixer.uncacheRoot(scene);}, [mixer, scene]);
  useFrame((_state, delta) => {
    const moving = engine.moving && !engine.paused;
    if (moving !== lastMoving.current) {
      const next = moving ? walkAction : idleAction, previous = moving ? idleAction : walkAction;
      next?.reset().setEffectiveTimeScale(moving ? WALK_TIME_SCALE : 1).setEffectiveWeight(1).fadeIn(.17).play();
      previous?.fadeOut(.17);lastMoving.current = moving;
    }
    mixer.update(Math.min(delta, .05));
    if (engine.root) {
      engine.root.dataset.playerClip = moving ? 'adjusted-walk' : 'adjusted-idle';
      engine.root.dataset.walkTime = String(walkAction?.time.toFixed(3) || 0);
      engine.root.dataset.walkWeight = String(walkAction?.getEffectiveWeight().toFixed(3) || 0);
    }
  });
  return <group rotation={[0, -Math.PI / 2, 0]} scale={scale}><primitive object={scene}/></group>;
}


function Player({engine, manifest, onNear}) {
  const group = useRef(), previousNear = useRef(null);
  useFrame((_state, delta) => {
    const keys = engine.keys;
    const rawInput = {
      x: (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + engine.joystick.x,
      z: (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) + engine.joystick.z,
    };
    const yaw = Math.atan2(BAR_LAYOUT.cameraOffset[0], BAR_LAYOUT.cameraOffset[2]);
    const input = {x: rawInput.x * Math.cos(yaw) + rawInput.z * Math.sin(yaw), z: -rawInput.x * Math.sin(yaw) + rawInput.z * Math.cos(yaw)};
    const next = engine.paused ? {...engine.player, moving: false} : stepPlayer(engine.player, input, delta);
    engine.player.x = next.x;engine.player.z = next.z;engine.moving = next.moving;
    group.current.position.set(next.x, BAR_LAYOUT.groundY + .02, next.z);
    if (next.moving) {
      const angle = Math.atan2(input.x, input.z);
      const difference = Math.atan2(Math.sin(angle - group.current.rotation.y), Math.cos(angle - group.current.rotation.y));
      group.current.rotation.y += difference * (1 - Math.exp(-17 * delta));
    }
    let nearest = null, distance = BAR_LAYOUT.interactionRadius;
    for (const station of BAR_LAYOUT.stations) {
      const d = Math.hypot(next.x - station.position[0], next.z - station.position[2]);
      if (d < distance) {nearest = station.id;distance = d;}
    }
    engine.near = nearest;
    if (nearest !== previousNear.current) {previousNear.current = nearest;onNear(nearest);}
    if (engine.root) {
      engine.root.dataset.playerX = next.x.toFixed(3);engine.root.dataset.playerZ = next.z.toFixed(3);
      engine.root.dataset.playerMoving = String(next.moving);engine.root.dataset.nearProject = nearest || '';
    }
  });
  return <group ref={group} position={[START_POSITION.x, BAR_LAYOUT.groundY + .02, START_POSITION.z]}>
    <Suspense fallback={null}>
      {manifest.animations?.idle && manifest.animations?.walk
        ? <AnimatedChef idleUrl={manifest.animations.idle} walkUrl={manifest.animations.walk} engine={engine}/>
        : <Asset entry={manifest.assets?.chef} height={1.8} fallback={null}/>}
    </Suspense>
  </group>;
}

function Camera({engine}) {
  const {camera, size} = useThree();
  const target = useRef(new THREE.Vector3(0, 1.3, .6));
  useEffect(() => {
    const width = size.width <= 700 ? 10.5 : BAR_LAYOUT.roomWidth * 1.45 + 1.5;
    camera.zoom = Math.min(size.width / width, size.height / BAR_LAYOUT.viewHeight);
    camera.updateProjectionMatrix();engine.mobile = size.width <= 700;
  }, [camera, size, engine]);
  useFrame((_state, delta) => {
    target.current.x = THREE.MathUtils.damp(target.current.x, engine.mobile ? engine.player.x * .55 : 0, 4, delta);
    target.current.z = THREE.MathUtils.damp(target.current.z, engine.mobile ? engine.player.z * .3 : .6, 4, delta);
    camera.position.set(target.current.x + BAR_LAYOUT.cameraOffset[0], BAR_LAYOUT.cameraOffset[1], target.current.z + BAR_LAYOUT.cameraOffset[2]);
    camera.lookAt(target.current);
  });
  return null;
}

function Scene({engine, manifest, discovery, onNear, onInspect}) {
  return <>
    <color attach="background" args={['#f7f9f3']}/>
    <ambientLight intensity={.7}/><hemisphereLight args={['#fff9ec', '#bdc9ac', 1.6]}/>
    <directionalLight castShadow position={[-7, 13, 8]} intensity={2.4} shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={13} shadow-camera-bottom={-12} shadow-normalBias={.025}/>
    <directionalLight position={[6, 7, -5]} intensity={.9} color="#e5eef1"/>
    <Environment resolution={128} frames={1} environmentIntensity={.6}><Lightformer position={[-5, 10, 4]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} intensity={1.5}/></Environment>
    <Camera engine={engine}/><DiscoveryRoom assets={discovery.assets} layout={BAR_LAYOUT}/>
    {BAR_LAYOUT.stations.map(station => <DiscoveryObject key={station.id} station={station} entry={discovery.assets?.[station.asset]} engine={engine} onInspect={onInspect}/>)}
    <Suspense fallback={null}><Player engine={engine} manifest={manifest} onNear={onNear}/></Suspense>
  </>;
}

export default function SushiBar({list, onSelect, onOpen, onInspectChange, paused, reducedMotion}) {
  const [manifest, setManifest] = useState({assets: {}}), [discovery, setDiscovery] = useState({assets: {}});
  const [near, setNear] = useState(null), [inspecting, setInspecting] = useState(() => {
    const id = new URLSearchParams(window.location.search).get('inspect');
    return BAR_LAYOUT.stations.some(station => station.id === id) ? id : null;
  }), [stick, setStick] = useState({x: 0, y: 0});
  const engine = useRef({player: {...START_POSITION}, keys: new Set(), joystick: {x: 0, z: 0}, moving: false, near: null}).current;
  const callbacks = useRef({onSelect});callbacks.current = {onSelect};
  engine.paused = paused || !!inspecting;engine.reducedMotion = reducedMotion;
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      for (const [url, setter] of [['/models/tripo/manifest.json', setManifest], ['/models/tripo/discovery-v2.json', setDiscovery]]) {
        fetch(url, {cache: 'no-store'}).then(response => response.ok ? response.json() : {assets: {}}).then(data => {if (!cancelled) setter(data);}).catch(() => {});
      }
    };
    load();const interval = setInterval(load, 8000);return () => {cancelled = true;clearInterval(interval);};
  }, []);
  useEffect(() => {onInspectChange?.(!!inspecting);return () => onInspectChange?.(false);}, [inspecting, onInspectChange]);
  useEffect(() => {
    const movement = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    const down = event => {
      if (engine.paused || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable) return;
      if (movement.includes(event.code)) {event.preventDefault();engine.keys.add(event.code);}
      if (event.code === 'KeyE' && !event.repeat && engine.near) {event.preventDefault();setInspecting(engine.near);}
    };
    const up = event => engine.keys.delete(event.code);
    const clear = () => {engine.keys.clear();engine.joystick = {x: 0, z: 0};engine.moving = false;setStick({x: 0, y: 0});};
    window.addEventListener('keydown', down);window.addEventListener('keyup', up);window.addEventListener('blur', clear);document.addEventListener('visibilitychange', clear);
    return () => {clear();document.body.style.cursor = '';window.removeEventListener('keydown', down);window.removeEventListener('keyup', up);window.removeEventListener('blur', clear);document.removeEventListener('visibilitychange', clear);};
  }, [engine]);
  useEffect(() => {if (paused || inspecting) {engine.keys.clear();engine.joystick = {x: 0, z: 0};engine.moving = false;setStick({x: 0, y: 0});}}, [paused, inspecting, engine]);
  const onNear = id => {setNear(id);if (id) callbacks.current.onSelect(id);};
  const station = BAR_LAYOUT.stations.find(value => value.id === near);
  const inspectStation = BAR_LAYOUT.stations.find(value => value.id === inspecting);
  const inspectProject = list.find(value => value.id === inspecting);
  function joystick(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
    const radius = Math.min(rect.width, rect.height) * .34, distance = Math.hypot(dx, dy), factor = Math.min(1, radius / Math.max(1, distance));
    engine.joystick = {x: dx * factor / radius, z: dy * factor / radius};setStick({x: dx * factor, y: dy * factor});
  }
  function releaseStick() {engine.joystick = {x: 0, z: 0};setStick({x: 0, y: 0});}
  return <>
    <div className="sushi-bar-scene" inert={inspecting ? true : undefined} ref={node => {engine.root = node;}} data-environment-provider="Tripo" data-scene="sushi-bar" role="group" aria-label="Explore the sushi bar with WASD or arrow keys. Press E near an object to inspect it.">
      <Canvas orthographic shadows dpr={[1, 1.6]} camera={{position: [0, 17, 12], zoom: 60, near: .1, far: 100}} gl={{antialias: true, alpha: false, powerPreference: 'high-performance'}} onCreated={({gl}) => {gl.toneMapping = THREE.ACESFilmicToneMapping;gl.toneMappingExposure = 1;gl.shadowMap.type = THREE.PCFShadowMap;}}>
        <Scene engine={engine} manifest={manifest} discovery={discovery} onNear={onNear} onInspect={setInspecting}/>
      </Canvas>
      <div className="walking-hud" aria-live="polite">{station ? <button onClick={() => setInspecting(station.id)}><kbd>E</kbd><span>Inspect {station.label.toLowerCase()}</span></button> : <span className="walking-invitation">There’s something waiting to be unpacked.</span>}<span className="walking-keys">WASD / arrows to walk</span></div>
      <button type="button" className="walking-joystick" aria-label="Drag to walk" onPointerDown={event => {if (engine.paused) return;event.currentTarget.setPointerCapture(event.pointerId);joystick(event);}} onPointerMove={event => {if (event.currentTarget.hasPointerCapture(event.pointerId)) joystick(event);}} onPointerUp={releaseStick} onPointerCancel={releaseStick}><span style={{transform: `translate(${stick.x}px, ${stick.y}px)`}}/></button>
    </div>
    {inspectProject && inspectStation && <DiscoveryInspect project={inspectProject} entry={discovery.assets?.[inspectStation.asset]} onClose={() => setInspecting(null)} onOpen={id => {setInspecting(null);onOpen(id);}} reducedMotion={reducedMotion}/>}
  </>;
}
