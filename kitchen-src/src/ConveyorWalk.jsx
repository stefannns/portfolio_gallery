import React, {Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {Canvas, useFrame, useThree} from '@react-three/fiber';
import {Environment, Lightformer, useGLTF} from '@react-three/drei';
import {clone as cloneSkeleton} from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import {Asset, Artwork} from './Conveyor3D.jsx';
import {START_POSITION, stepPlayer} from './walk-physics.js';
import {correctCapybaraClip} from './retarget-capybara.js';
import {CONVEYOR, WALK_TIME_SCALE} from './conveyor-layout.js';
import RestaurantRoom, {RestaurantModel} from './TripoRestaurant.jsx';
import conveyorSurface from './conveyor-surface.json';

function trackPath() {
  const {halfWidth: w, halfDepth: d, cornerRadius: r} = CONVEYOR;
  const path = new THREE.Shape();
  path.moveTo(-w + r, d);path.lineTo(w - r, d);
  path.quadraticCurveTo(w, d, w, d - r);path.lineTo(w, -d + r);
  path.quadraticCurveTo(w, -d, w - r, -d);path.lineTo(-w + r, -d);
  path.quadraticCurveTo(-w, -d, -w, -d + r);path.lineTo(-w, d - r);
  path.quadraticCurveTo(-w, d, -w + r, d);
  return path;
}

function Belt({engine, entry}) {
  useFrame((_state, delta) => {
    if (!engine.paused && !engine.reducedMotion && !engine.near) engine.phase = (engine.phase + Math.min(delta, .05) * .0018) % 1;
  });
  return <RestaurantModel entry={entry} dimensions={[11.96, CONVEYOR.counterHeight, 8.06]} rotationY={0}/>;
}

function World({project, index, seedIndex, engine, path, entry, onOpen}) {
  const group = useRef(), ring = useRef();
  const initial = (CONVEYOR.halfWidth - CONVEYOR.cornerRadius) / path.getLength();
  useFrame(() => {
    const t = ((initial + (index - seedIndex) / engine.count + engine.phase) % 1 + 1) % 1;
    const point = path.getPointAt(t);
    const sample = t * conveyorSurface.sampleCount, sampleIndex = Math.floor(sample);
    const height = THREE.MathUtils.lerp(conveyorSurface.heightFractions[sampleIndex], conveyorSurface.heightFractions[(sampleIndex + 1) % conveyorSurface.sampleCount], sample - sampleIndex);
    group.current.position.set(point.x, height * CONVEYOR.counterHeight + conveyorSurface.plateOffset, point.y);
    engine.projectPositions[project.id] = {x: point.x, z: point.y};
    ring.current.visible = engine.near === project.id;
  });
  return <group ref={group} onClick={event => {event.stopPropagation();if (!engine.paused) onOpen(project.id);}}>
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, .012, 0]} visible={false}><torusGeometry args={[1.035, .035, 8, 64]}/><meshStandardMaterial color="#f3dba0" roughness={.6}/></mesh>
    <Asset entry={entry} width={CONVEYOR.worldWidth} fallback={<Artwork url={`/sushi/worlds/${project.id}.webp`} width={CONVEYOR.worldWidth}/>}/>
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

function Player({engine, manifest, list, onNear}) {
  const group = useRef(), previousNear = useRef(null);
  useFrame((_state, delta) => {
    const keys = engine.keys;
    const input = {x: (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + engine.joystick.x,
      z: (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) + engine.joystick.z};
    const next = engine.paused ? {...engine.player, moving: false} : stepPlayer(engine.player, input, delta);
    engine.player.x = next.x;engine.player.z = next.z;engine.moving = next.moving;
    group.current.position.set(next.x, CONVEYOR.groundY + .015, next.z);
    if (next.moving) {
      const angle = Math.atan2(input.x, input.z);
      const difference = Math.atan2(Math.sin(angle - group.current.rotation.y), Math.cos(angle - group.current.rotation.y));
      group.current.rotation.y += difference * (1 - Math.exp(-15 * delta));
    }
    let nearest = null, nearestDistance = CONVEYOR.interactionRadius;
    list.forEach(project => {
      const p = engine.projectPositions[project.id];if (!p) return;
      const distance = Math.hypot(next.x - p.x, next.z - p.z);
      if (distance < nearestDistance) {nearest = project.id;nearestDistance = distance;}
    });
    engine.near = nearest;
    if (nearest !== previousNear.current) {previousNear.current = nearest;onNear(nearest);}
    if (engine.root) {
      engine.root.dataset.playerX = next.x.toFixed(3);engine.root.dataset.playerZ = next.z.toFixed(3);
      engine.root.dataset.playerMoving = String(next.moving);engine.root.dataset.nearProject = nearest || '';
    }
  });
  const animated = manifest.animations?.idle && manifest.animations?.walk;
  return <group ref={group} position={[START_POSITION.x, CONVEYOR.groundY + .015, START_POSITION.z]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .008, 0]}><circleGeometry args={[.51, 32]}/><meshBasicMaterial color="#748d65" transparent opacity={.16} depthWrite={false}/></mesh>
    <Suspense fallback={<Asset entry={manifest.assets?.chef} height={1.8} fallback={null}/>}>
      {animated ? <AnimatedChef idleUrl={manifest.animations.idle} walkUrl={manifest.animations.walk} engine={engine}/> : <Asset entry={manifest.assets?.chef} height={1.8} fallback={<Artwork url="/sushi/chef-poster.webp" width={1.8}/>}/>}
    </Suspense>
  </group>;
}

function Camera({engine}) {
  const {camera, size} = useThree();
  const target = useRef(new THREE.Vector3(0, .6, -.2));
  useEffect(() => {
    const width = size.width <= 700 ? 12.8 : size.width <= 1000 ? 17.2 : 21;
    camera.zoom = Math.min(size.width / width, size.height / 16.4);
    camera.updateProjectionMatrix();
    engine.mobile = size.width <= 1000;
  }, [camera, size, engine]);
  useFrame((_state, delta) => {
    const x = engine.mobile ? engine.player.x * .35 : 0;
    const z = engine.mobile ? engine.player.z * .2 : -.2;
    target.current.x = THREE.MathUtils.damp(target.current.x, x, 4, delta);
    target.current.z = THREE.MathUtils.damp(target.current.z, z, 4, delta);
    camera.position.set(target.current.x, 18, target.current.z + 12);
    camera.lookAt(target.current);
  });
  return null;
}

function Scene({engine, list, manifest, restaurant, onNear, onOpen}) {
  const path = useMemo(trackPath, []);
  const seedIndex = list.findIndex(project => project.id === 'seed-squad');
  return <>
    <color attach="background" args={['#f7f9f3']}/>
    <ambientLight intensity={.8}/><hemisphereLight args={['#fff9ec', '#b6c7aa', 1.9]}/>
    <directionalLight castShadow position={[-7, 13, 8]} intensity={2.7} shadow-mapSize={[2048, 2048]} shadow-camera-left={-13} shadow-camera-right={13} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-normalBias={.025} shadow-bias={-.0001}/>
    <directionalLight position={[5, 8, -8]} intensity={1.2} color="#e2eff5"/>
    <Environment resolution={128} frames={1} environmentIntensity={.6}><Lightformer position={[-5, 10, 4]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} intensity={1.5}/></Environment>
    <Camera engine={engine}/><RestaurantRoom manifest={restaurant}/><Belt engine={engine} entry={restaurant.assets?.['restaurant-counter']}/>
    {list.map((project, index) => <Suspense key={project.id} fallback={null}><World project={project} index={index} seedIndex={seedIndex} engine={engine} path={path} entry={manifest.assets?.[project.id]} onOpen={onOpen}/></Suspense>)}
    <Suspense fallback={null}><Player engine={engine} manifest={manifest} list={list} onNear={onNear}/></Suspense>
  </>;
}

export default function ConveyorWalk({list, onSelect, onOpen, paused, reducedMotion}) {
  const [manifest, setManifest] = useState({assets: {}}), [restaurant, setRestaurant] = useState({assets: {}}), [near, setNear] = useState(null);
  const [stick, setStick] = useState({x: 0, y: 0});
  const engine = useRef({player: {...START_POSITION}, keys: new Set(), joystick: {x: 0, z: 0}, moving: false, near: null, phase: 0, projectPositions: {}, count: list.length, paused, reducedMotion}).current;
  const callbacks = useRef({onSelect, onOpen});callbacks.current = {onSelect, onOpen};engine.paused = paused;engine.reducedMotion = reducedMotion;
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      for (const [url, setter] of [['/models/tripo/manifest.json', setManifest], ['/models/tripo/restaurant.json', setRestaurant]]) {
        fetch(url, {cache: 'no-store'}).then(response => response.ok ? response.json() : {assets: {}}).then(data => {if (!cancelled) setter(data);}).catch(() => {});
      }
    };
    load();const interval = setInterval(load, 8000);return () => {cancelled = true;clearInterval(interval);};
  }, []);
  useEffect(() => {
    const movement = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    const down = event => {
      if (engine.paused || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable) return;
      if (movement.includes(event.code)) {event.preventDefault();engine.keys.add(event.code);}
      if (event.code === 'KeyE' && !event.repeat && engine.near) {event.preventDefault();callbacks.current.onOpen(engine.near);}
    };
    const up = event => {engine.keys.delete(event.code);};
    const clear = () => {engine.keys.clear();engine.joystick = {x: 0, z: 0};engine.moving = false;setStick({x: 0, y: 0});};
    window.addEventListener('keydown', down);window.addEventListener('keyup', up);window.addEventListener('blur', clear);document.addEventListener('visibilitychange', clear);
    return () => {clear();window.removeEventListener('keydown', down);window.removeEventListener('keyup', up);window.removeEventListener('blur', clear);document.removeEventListener('visibilitychange', clear);};
  }, [engine]);
  useEffect(() => {if (paused) {engine.keys.clear();engine.joystick = {x: 0, z: 0};}}, [paused, engine]);
  const onNear = id => {setNear(id);if (id) callbacks.current.onSelect(id);};
  const project = list.find(p => p.id === near);
  function joystick(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
    const radius = Math.min(rect.width, rect.height) * .34, distance = Math.hypot(dx, dy), factor = Math.min(1, radius / Math.max(1, distance));
    engine.joystick = {x: dx * factor / radius, z: dy * factor / radius};setStick({x: dx * factor, y: dy * factor});
  }
  function releaseStick() {engine.joystick = {x: 0, z: 0};setStick({x: 0, y: 0});}
  return <div className="conveyor-walk" ref={node => {engine.root = node;}} data-environment-provider="Tripo" role="group" aria-label="Walk inside the conveyor with WASD or arrow keys. Press E near a plate to view its project.">
    <Canvas orthographic shadows dpr={[1, 1.6]} camera={{position: [0, 18, 12], zoom: 60, near: .1, far: 100}} gl={{antialias: true, alpha: false, powerPreference: 'high-performance'}} onCreated={({gl}) => {gl.toneMapping = THREE.ACESFilmicToneMapping;gl.toneMappingExposure = 1;gl.shadowMap.type = THREE.PCFShadowMap;}}>
      <Scene engine={engine} list={list} manifest={manifest} restaurant={restaurant} onNear={onNear} onOpen={onOpen}/>
    </Canvas>
    <div className="walking-hud" aria-live="polite">{project ? <button onClick={() => onOpen(project.id)}><kbd>E</kbd><span>View {project.title}</span></button> : <span className="walking-invitation">Walk up to a plate</span>}<span className="walking-keys">WASD / arrows to walk</span></div>
    <button type="button" className="walking-joystick" aria-label="Drag to walk" onPointerDown={event => {if (paused) return;event.currentTarget.setPointerCapture(event.pointerId);joystick(event);}} onPointerMove={event => {if (event.currentTarget.hasPointerCapture(event.pointerId)) joystick(event);}} onPointerUp={releaseStick} onPointerCancel={releaseStick}><span style={{transform: `translate(${stick.x}px, ${stick.y}px)`}}/></button>
  </div>;
}
