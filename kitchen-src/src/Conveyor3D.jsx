import React, {Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {Canvas, useFrame, useThree} from '@react-three/fiber';
import {Billboard, Environment, Lightformer, RoundedBox, useGLTF, useTexture} from '@react-three/drei';
import * as THREE from 'three';
import gsap from 'gsap';

const STEP = 3.8;
const mod = (value, count) => ((value % count) + count) % count;

class ModelBoundary extends React.Component {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function Asset({entry, fallback, width, height}) {
  if (!entry?.url) return fallback;
  return <ModelBoundary key={entry.url} fallback={fallback}><Suspense fallback={fallback}><Model url={entry.url} rotation={entry.rotation} width={width} height={height}/></Suspense></ModelBoundary>;
}

function Model({url, rotation = [0, 0, 0], width, height}) {
  const {scene} = useGLTF(url, '/draco/');
  const {object, scale} = useMemo(() => {
    const object = scene.clone(true);
    object.rotation.set(...rotation);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = height ? height / size.y : width / Math.max(size.x, size.z);
    object.position.set(-center.x, -box.min.y, -center.z);
    object.traverse(node => {
      if (node.isMesh) {node.castShadow = true; node.receiveShadow = true;}
    });
    return {object, scale};
  }, [scene, width, height, rotation[0], rotation[1], rotation[2]]);
  return <group scale={scale}><primitive object={object}/></group>;
}

export function Artwork({url, width = 3.35}) {
  const texture = useTexture(url);
  useEffect(() => {texture.colorSpace = THREE.SRGBColorSpace;}, [texture]);
  return <Billboard position={[0, width * .4375, 0]}><mesh><planeGeometry args={[width, width]}/><meshBasicMaterial map={texture} transparent alphaTest={.025} toneMapped={false} depthWrite={true}/></mesh></Billboard>;
}

function ProjectWorld({project, index, engine, active, entry, onChoose, reducedMotion}) {
  const group = useRef(), hover = useRef(false);
  const cycle = engine.count * STEP;
  useFrame((_state, delta) => {
    if (!group.current) return;
    const x = gsap.utils.wrap(-cycle / 2, cycle / 2, index * STEP + engine.offset);
    group.current.visible = Math.abs(x) < 10;
    group.current.position.x = x;
    group.current.position.y = THREE.MathUtils.damp(group.current.position.y, .96 + (hover.current && active ? .09 : 0), 12, delta);
    const turn = reducedMotion ? 0 : THREE.MathUtils.clamp(x * -.012, -.08, .08);
    group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, turn, 10, delta);
  });
  return <group ref={group} position={[0, .96, .22]} onPointerOver={event => {event.stopPropagation(); hover.current = true;}} onPointerOut={() => {hover.current = false;}} onClick={event => {event.stopPropagation(); onChoose(project.id, event);}}>
    <Asset entry={entry} width={3.35} fallback={<Artwork url={`/sushi/worlds/${project.id}.webp`}/>}/>
  </group>;
}

function Chef({entry, reducedMotion, paused}) {
  const group = useRef();
  useFrame(({clock}) => {
    if (!group.current) return;
    const time = clock.elapsedTime;
    const breathing = reducedMotion || paused ? 1 : 1 + Math.sin(time * 1.65) * .004;
    group.current.scale.y = breathing;
    group.current.rotation.y = reducedMotion || paused ? 0 : Math.sin(time * .43) * .022;
  });
  return <group ref={group} position={[.15, .05, -2.25]}><Asset entry={entry} height={4.1} fallback={<Artwork url="/sushi/chef-poster.webp" width={4.1}/>}/></group>;
}

function Conveyor({engine}) {
  const slats = useRef();
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const surface = useMemo(() => new THREE.BoxGeometry(.115, .025, 2.65), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({color: '#a5a38e', roughness: .82}), []);
  useEffect(() => () => {surface.dispose(); material.dispose();}, [surface, material]);
  useFrame(() => {
    if (!slats.current) return;
    const shift = mod(engine.offset, .18);
    for (let i = 0; i < 172; i++) {
      matrix.makeTranslation(-15.4 + i * .18 + shift, .875, .18);
      slats.current.setMatrixAt(i, matrix);
    }
    slats.current.instanceMatrix.needsUpdate = true;
  });
  return <group>
    <RoundedBox args={[32, .82, 3.3]} radius={.17} smoothness={4} position={[0, .37, .1]} receiveShadow castShadow><meshStandardMaterial color="#e4dbc9" roughness={.7}/></RoundedBox>
    <RoundedBox args={[32, .14, 2.92]} radius={.055} smoothness={3} position={[0, .8, .16]} receiveShadow><meshStandardMaterial color="#8e927c" roughness={.83}/></RoundedBox>
    <instancedMesh ref={slats} args={[surface, material, 172]} receiveShadow/>
    <RoundedBox args={[32, .13, .14]} radius={.045} smoothness={3} position={[0, .89, 1.67]} receiveShadow castShadow><meshStandardMaterial color="#e5d6b4" roughness={.45} metalness={.08}/></RoundedBox>
    <RoundedBox args={[32, .13, .14]} radius={.045} smoothness={3} position={[0, .89, -1.31]} receiveShadow castShadow><meshStandardMaterial color="#e5d6b4" roughness={.45} metalness={.08}/></RoundedBox>
    <mesh position={[0, .35, 1.76]}><boxGeometry args={[32, .45, .07]}/><meshStandardMaterial color="#d7c6a5" roughness={.7}/></mesh>
    <mesh position={[0, .12, 1.8]}><boxGeometry args={[32, .035, .065]}/><meshStandardMaterial color="#f5eee0" roughness={.7}/></mesh>
    <RoundedBox args={[32, .18, 2.6]} radius={.06} smoothness={3} position={[0, .57, -2.65]} receiveShadow castShadow><meshStandardMaterial color="#f5f0e5" roughness={.75}/></RoundedBox>
  </group>;
}

function CameraRig({engine, reducedMotion}) {
  const {camera, size} = useThree();
  useEffect(() => {
    const viewWidth = size.width <= 700 ? 5.2 : size.width <= 1000 ? 10.4 : 14.5;
    camera.zoom = Math.min(size.width / viewWidth, size.height / 7.7);
    camera.position.set(0, 6, 11);
    camera.lookAt(0, 1.45, 0);
    camera.updateProjectionMatrix();
    engine.unitsPerPixel = 1 / camera.zoom;
    const edge = new THREE.Vector3(0, .35, 1.8).project(camera);
    const captionY = Math.min(size.height - 125, (1 - edge.y) * size.height / 2 + 55);
    engine.root?.closest('.portfolio')?.style.setProperty('--conveyor-caption-y', `${captionY}px`);
  }, [camera, size, engine]);
  useFrame(({pointer}, delta) => {
    const x = reducedMotion ? 0 : pointer.x * .13;
    camera.position.x = THREE.MathUtils.damp(camera.position.x, x, 3, delta);
    camera.lookAt(0, 1.45, 0);
  });
  return null;
}

function Scene({list, engine, active, manifest, onChoose, reducedMotion, paused}) {
  return <>
    <color attach="background" args={['#fafbf8']}/>
    <ambientLight intensity={.8}/>
    <hemisphereLight args={['#fffaf0', '#b7c0a7', 1.8]}/>
    <directionalLight castShadow position={[-5, 9, 6]} intensity={3.2} shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={10} shadow-camera-bottom={-9} shadow-normalBias={.035} shadow-bias={-.0002}/>
    <directionalLight position={[6, 5, -3]} intensity={1.3} color="#e7f0f4"/>
    <Environment resolution={128} frames={1} environmentIntensity={.7}>
      <Lightformer position={[-4, 7, 4]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 7, 1]} intensity={2} color="#fff9ed"/>
      <Lightformer position={[4, 3, 1]} rotation={[0, -Math.PI / 2, 0]} scale={[5, 6, 1]} intensity={1} color="#f1f7f5"/>
    </Environment>
    <CameraRig engine={engine} reducedMotion={reducedMotion}/>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.12, 0]} receiveShadow><planeGeometry args={[200, 200]}/><meshStandardMaterial color="#fafbf8" roughness={1}/></mesh>
    <Conveyor engine={engine}/>
    <Suspense fallback={null}><Chef entry={manifest.assets?.chef} reducedMotion={reducedMotion} paused={paused}/></Suspense>
    {list.map((project, index) => <Suspense key={project.id} fallback={null}><ProjectWorld project={project} index={index} engine={engine} active={project.id === active} entry={manifest.assets?.[project.id]} onChoose={onChoose} reducedMotion={reducedMotion}/></Suspense>)}
  </>;
}

export default function Conveyor3D({list, navigation, onSelect, onNavigate, onOpen, reducedMotion, paused}) {
  const [manifest, setManifest] = useState({assets: {}});
  const [active, setActive] = useState(navigation.id);
  const root = useRef();
  const engine = useRef({offset: -Math.max(0, list.findIndex(project => project.id === navigation.id)) * STEP, count: list.length, unitsPerPixel: .02}).current;
  const state = useRef({pointer: null, dragging: false, suppressClick: false, active: navigation.id});
  const callbacks = useRef({onSelect, onNavigate, onOpen});callbacks.current = {onSelect, onNavigate, onOpen};

  useEffect(() => {
    let cancelled = false;
    const load = () => fetch('/models/tripo/manifest.json', {cache: 'no-store'}).then(response => response.ok ? response.json() : {assets: {}}).then(data => {if (!cancelled) setManifest(data);}).catch(() => {});
    load();const interval = setInterval(load, 8000);
    return () => {cancelled = true; clearInterval(interval);};
  }, []);

  const goTo = useRef();
  goTo.current = (id, immediate = false) => {
    const index = list.findIndex(project => project.id === id);if (index < 0) return;
    const cycle = list.length * STEP;
    const destination = engine.offset + gsap.utils.wrap(-cycle / 2, cycle / 2, -index * STEP - engine.offset);
    gsap.killTweensOf(engine);state.current.active = id;setActive(id);callbacks.current.onSelect(id);
    gsap.to(engine, {offset: destination, duration: reducedMotion || immediate ? 0 : .85, ease: 'power3.out', onComplete: () => {engine.offset = gsap.utils.wrap(-cycle, 0, engine.offset);}});
  };
  useEffect(() => {goTo.current(navigation.id);}, [navigation]);
  useEffect(() => () => gsap.killTweensOf(engine), [engine]);

  function down(event) {
    if (event.button !== 0 || paused) return;
    gsap.killTweensOf(engine);
    state.current.pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, offset: engine.offset, time: performance.now()};
    state.current.suppressClick = false;
  }
  function move(event) {
    const pointer = state.current.pointer;if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (!state.current.dragging && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      state.current.dragging = true;state.current.suppressClick = true;
      event.currentTarget.setPointerCapture(event.pointerId);callbacks.current.onNavigate();
      root.current.classList.add('is-dragging');
    }
    if (state.current.dragging) engine.offset = pointer.offset + dx * engine.unitsPerPixel;
  }
  function up(event, cancelled = false) {
    const pointer = state.current.pointer;if (!pointer || pointer.id !== event.pointerId) return;
    const didDrag = state.current.dragging;state.current.pointer = null;state.current.dragging = false;
    root.current.classList.remove('is-dragging');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (didDrag) {
      const dx = event.clientX - pointer.x;
      const start = Math.round(-pointer.offset / STEP);
      const velocity = dx / Math.max(100, performance.now() - pointer.time) * engine.unitsPerPixel;
      let index = Math.round(-(engine.offset + (cancelled ? 0 : velocity * 100)) / STEP);
      if (!cancelled && index === start && Math.abs(dx) > 45) index += dx < 0 ? 1 : -1;
      index = start + gsap.utils.clamp(-1, 1, index - start);
      goTo.current(list[mod(index, list.length)].id);
    }
  }
  function choose(id) {
    if (paused || state.current.suppressClick) return;
    if (state.current.active === id) callbacks.current.onOpen(id);
    else {callbacks.current.onNavigate();goTo.current(id);}
  }
  return <div className="conveyor-3d" ref={node => {root.current = node;engine.root = node;}} role="group" aria-label="3D conveyor gallery. Drag or use Left and Right to choose a project." onPointerDown={down} onPointerMove={move} onPointerUp={event => up(event)} onPointerCancel={event => up(event, true)}>
    <Canvas orthographic shadows dpr={[1, 1.7]} camera={{position: [0, 6, 11], zoom: 80, near: .1, far: 200}} gl={{antialias: true, alpha: false, powerPreference: 'high-performance'}} onCreated={({gl}) => {gl.toneMapping = THREE.ACESFilmicToneMapping;gl.toneMappingExposure = 1.05;gl.shadowMap.type = THREE.PCFShadowMap;}}>
      <Scene list={list} engine={engine} active={active} manifest={manifest} onChoose={choose} reducedMotion={reducedMotion} paused={paused}/>
    </Canvas>
  </div>;
}
