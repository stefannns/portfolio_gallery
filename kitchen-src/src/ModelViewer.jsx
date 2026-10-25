import React, {Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {Canvas, useFrame} from '@react-three/fiber';
import {Environment, Lightformer, OrbitControls, useGLTF} from '@react-three/drei';
import {clone as cloneSkeleton} from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import {correctCapybaraClip} from './retarget-capybara.js';
import CapybaraActor from './CapybaraActor.jsx';
import './model-viewer.css';

const versions = {
  original: {label: 'Original model', url: '/models/tripo/chef.glb'},
  rigged: {label: 'Rigged model', url: '/models/tripo/chef-rig.glb'},
  idle: {label: 'Tripo idle', url: '/models/tripo/chef-idle.glb'},
  walk: {label: 'Tripo walk', url: '/models/tripo/chef-walk.glb'},
  adjustedIdle: {label: 'Adjusted idle', url: '/models/tripo/chef-idle.glb', corrected: true, motion: 'idle'},
  adjustedWalk: {label: 'Adjusted walk', url: '/models/tripo/chef-walk.glb', corrected: true, motion: 'walk'},
  siteIdle: {label: 'Website idle', siteActor: true},
};

function Capybara({version, playing}) {
  const {scene, animations} = useGLTF(version.url, '/draco/');
  const {object, scale, mixer} = useMemo(() => {
    const object = cloneSkeleton(scene);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    object.position.set(-center.x, -box.min.y, -center.z);
    object.traverse(node => {if (node.isMesh) {node.castShadow = true;node.receiveShadow = true;}});
    const mixer = new THREE.AnimationMixer(object);
    if (animations[0]) {
      const clip = version.corrected ? correctCapybaraClip(animations[0], object, {motion: version.motion, strength: .65}) : animations[0];
      mixer.clipAction(clip).play();
    }
    return {object, scale: 3.5 / size.y, mixer};
  }, [scene, animations, version]);
  useEffect(() => () => {mixer.stopAllAction();mixer.uncacheRoot(object);}, [mixer, object]);
  useFrame((_state, delta) => {if (playing) mixer.update(Math.min(delta, .05));});
  return <group rotation={[0, -Math.PI / 2, 0]} scale={scale}><primitive object={object}/></group>;
}

export default function ModelViewer() {
  const [mode, setMode] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('pose');
    return Object.hasOwn(versions, requested) ? requested : 'original';
  }), [playing, setPlaying] = useState(true);
  const [siteIdleReady, setSiteIdleReady] = useState(false);
  const previewEngine = useRef({moving: false, paused: false}).current;
  previewEngine.paused = !playing;
  const controls = useRef();
  const version = versions[mode], animated = !['original', 'rigged'].includes(mode);
  const resetView = () => {
    if (!controls.current) return;
    controls.current.object.position.set(5.2, 3.6, 8);
    controls.current.target.set(0, 1.7, 0);
    controls.current.update();
  };
  useEffect(() => {document.title = 'Capybara — 3D model review';}, []);
  return <main className="capybara-review" data-model-version={mode} data-site-idle-ready={mode === 'siteIdle' && siteIdleReady}>
    <header><span>Capybara <small>3D model review</small></span><a href="/">Back to portfolio</a></header>
    <Canvas shadows dpr={[1, 1.7]} camera={{position: [5.2, 3.6, 8], fov: 37, near: .1, far: 100}} gl={{antialias: true, powerPreference: 'high-performance'}} onCreated={({gl}) => {gl.toneMapping = THREE.ACESFilmicToneMapping;gl.toneMappingExposure = 1;gl.shadowMap.type = THREE.PCFShadowMap;}}>
      <color attach="background" args={['#f2f4f0']}/>
      <ambientLight intensity={.7}/><hemisphereLight args={['#fffaf2', '#c0cbb6', 1.7]}/>
      <directionalLight castShadow position={[-4, 8, 6]} intensity={2.6} shadow-mapSize={[2048, 2048]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={7} shadow-camera-bottom={-6} shadow-normalBias={.025}/>
      <directionalLight position={[5, 4, -4]} intensity={1.1} color="#e5eef4"/>
      <Environment resolution={128} frames={1} environmentIntensity={.65}><Lightformer position={[-5, 7, 4]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 10, 1]} intensity={1.5}/></Environment>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.015, 0]} receiveShadow><planeGeometry args={[200, 200]}/><meshStandardMaterial color="#f2f4f0" roughness={1}/></mesh>
      <Suspense fallback={null}>{version.siteActor
        ? <CapybaraActor key={mode} engine={previewEngine} height={3.5} onReady={() => setSiteIdleReady(true)}/>
        : <Capybara key={mode} version={version} playing={playing}/>}</Suspense>
      <OrbitControls ref={controls} makeDefault target={[0, 1.7, 0]} enableDamping dampingFactor={.08} minDistance={4.3} maxDistance={16} minPolarAngle={.1} maxPolarAngle={Math.PI / 2 - .025}/>
    </Canvas>
    <footer>
      <nav aria-label="Capybara model versions">{Object.entries(versions).map(([id, value]) => <button key={id} type="button" aria-pressed={mode === id} onClick={() => {setMode(id);setSiteIdleReady(false);setPlaying(true);}}>{value.label}</button>)}</nav>
      <div className="review-actions">{animated && <button type="button" onClick={() => setPlaying(value => !value)}>{playing ? 'Pause animation' : 'Play animation'}</button>}<button type="button" onClick={resetView}>Reset view</button></div>
      <span>Drag to rotate · Scroll to zoom</span>
    </footer>
  </main>;
}
