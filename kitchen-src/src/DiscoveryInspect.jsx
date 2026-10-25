import React, {Suspense, useCallback, useEffect, useId, useMemo, useRef, useState} from 'react';
import {Canvas, useThree} from '@react-three/fiber';
import {OrbitControls, useGLTF} from '@react-three/drei';
import * as THREE from 'three';
import './discovery-inspect.css';

const phrases = {
  groceries: 'Unpack a little world',
  'seed-squad': 'Unpack a little world',
  recurve: 'Follow the returning arrow',
  assassin: 'Find the rhythm',
  niflheim: 'Take a closer look',
  toad: 'Two little defenders',
  'toad-defense': 'Two little defenders',
  h3: 'A story waiting to unfold',
  'h3-otome': 'A story waiting to unfold',
  smarttester: 'Look at the evidence',
  'a-bot-can-do-better': 'Draw today’s special',
};

const focusableSelector = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

class PreviewBoundary extends React.Component {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true};}
  componentDidCatch() {this.props.onError?.();}
  render() {return this.state.failed ? this.props.fallback : this.props.children;}
}

function ObjectModel({entry, onLoaded}) {
  const {scene} = useGLTF(entry.url, '/draco/');
  const [rx, ry, rz] = entry.rotation || [0, -Math.PI / 2, 0];
  const {object, scale, dimensions} = useMemo(() => {
    // Keep cached geometry, materials, and textures intact; only the clone's
    // parent transform changes for the inspection camera.
    const rotated = new THREE.Group();
    rotated.rotation.set(rx, ry, rz);
    rotated.add(scene.clone(true));
    rotated.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(rotated);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const largest = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(largest) || largest <= 0) throw new Error('The object has no visible geometry.');
    const centered = new THREE.Group();
    centered.add(rotated);
    rotated.position.sub(center);
    const scale = 3.7 / largest;
    return {object: centered, scale, dimensions: size.multiplyScalar(scale).toArray()};
  }, [scene, rx, ry, rz]);
  useEffect(() => {onLoaded(dimensions);}, [dimensions, onLoaded]);
  return <group scale={scale}><primitive object={object} dispose={null}/></group>;
}

function FrameCamera({controls, dimensions}) {
  const {camera, size, invalidate} = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const direction = new THREE.Vector3(.37, .25, .895).normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const half = new THREE.Vector3(...(dimensions || [3.7, 3.7, 3.7])).multiplyScalar(.5);
    const projectedHalf = axis => Math.abs(axis.x) * half.x + Math.abs(axis.y) * half.y + Math.abs(axis.z) * half.z;
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const distance = Math.max(4.8, (Math.max(projectedHalf(up) / tangent, projectedHalf(right) / (tangent * aspect)) + projectedHalf(direction)) * 1.13);
    camera.position.copy(direction.multiplyScalar(distance));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    if (controls.current) {
      controls.current.target.set(0, 0, 0);
      controls.current.update();
      controls.current.saveState();
    }
    invalidate();
  }, [camera, size.width, size.height, controls, dimensions, invalidate]);
  return null;
}

function PreviewFallback({project, failed = false, onUnavailable}) {
  useEffect(() => {onUnavailable?.();}, [onUnavailable]);
  return <div className="discovery-inspect__fallback">
    {project.image && <img src={project.image} alt={`${project.title} project cover`}/>}
    <p>{failed ? 'The object preview couldn’t load.' : 'The object preview is preparing.'}</p>
  </div>;
}

export default function DiscoveryInspect({project, entry, onClose, onOpen, reducedMotion = false}) {
  const dialog = useRef(null), closeButton = useRef(null), controls = useRef(null);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  const [assetState, setAssetState] = useState({url: null, status: 'loading', dimensions: null});
  const titleId = useId(), phraseId = useId(), hintId = useId();
  const loaded = useCallback(dimensions => setAssetState({url: entry?.url, status: 'ready', dimensions}), [entry?.url]);
  const failed = useCallback(() => setAssetState({url: entry?.url, status: 'error', dimensions: null}), [entry?.url]);
  const status = assetState.url === entry?.url ? assetState.status : 'loading';
  const dimensions = assetState.url === entry?.url ? assetState.dimensions : null;
  const phrase = phrases[project.id] || 'Take a closer look';

  useEffect(() => {
    const previousFocus = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const containKeys = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeCallback.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll(focusableSelector)].filter(node => node.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (!first) {event.preventDefault();dialog.current.focus();return;}
      const outside = !dialog.current.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault();last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault();first.focus();
      }
    };
    document.addEventListener('keydown', containKeys, true);
    return () => {
      document.removeEventListener('keydown', containKeys, true);
      document.body.style.overflow = oldOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({preventScroll: true});
    };
  }, []);

  const keyboardOrbit = event => {
    const orbit = controls.current;
    if (!orbit) return;
    const step = Math.PI / 18;
    if (event.key === 'ArrowLeft') orbit.setAzimuthalAngle(orbit.getAzimuthalAngle() - step);
    else if (event.key === 'ArrowRight') orbit.setAzimuthalAngle(orbit.getAzimuthalAngle() + step);
    else if (event.key === 'ArrowUp') orbit.setPolarAngle(THREE.MathUtils.clamp(orbit.getPolarAngle() - step, .05, Math.PI - .05));
    else if (event.key === 'ArrowDown') orbit.setPolarAngle(THREE.MathUtils.clamp(orbit.getPolarAngle() + step, .05, Math.PI - .05));
    else if (event.key === '+' || event.key === '=') orbit.dollyIn(.88);
    else if (event.key === '-' || event.key === '_') orbit.dollyOut(.88);
    else if (event.key === 'Home') orbit.reset();
    else return;
    event.preventDefault();
    event.stopPropagation();
    orbit.update();
  };

  return <section
    ref={dialog}
    className={`discovery-inspect${reducedMotion ? ' discovery-inspect--still' : ''}`}
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    aria-describedby={phraseId}
    tabIndex={-1}
    onKeyDown={event => event.stopPropagation()}
    onKeyUp={event => event.stopPropagation()}
  >
    <header className="discovery-inspect__header">
      <div><h2 id={titleId}>{project.title}</h2><p id={phraseId}>{phrase}</p></div>
      <button ref={closeButton} className="discovery-inspect__close" type="button" onClick={onClose}>Close</button>
    </header>

    <div
      className="discovery-inspect__stage"
      role="group"
      aria-label={`${project.title} 3D object viewer`}
      aria-describedby={hintId}
      tabIndex={entry?.url && status !== 'error' ? 0 : -1}
      onKeyDown={keyboardOrbit}
    >
      {entry?.url ? <PreviewBoundary key={entry.url} onError={failed} fallback={<PreviewFallback project={project} failed/>}>
        <Canvas
          key={entry.url}
          frameloop="demand"
          dpr={[1, 1.7]}
          camera={{position: [3, 2, 7], fov: 36, near: .05, far: 120}}
          gl={{antialias: true, alpha: true, powerPreference: 'high-performance'}}
          onCreated={({gl}) => {gl.toneMapping = THREE.ACESFilmicToneMapping;gl.toneMappingExposure = 1;}}
          fallback={<PreviewFallback project={project} failed onUnavailable={failed}/>}
          aria-hidden="true"
        >
          <ambientLight intensity={1}/>
          <hemisphereLight args={['#fffaf0', '#d4dcd6', 2]}/>
          <directionalLight position={[-4, 7, 6]} intensity={2.5} color="#fff8e9"/>
          <directionalLight position={[5, 2, -4]} intensity={1.2} color="#edf4f7"/>
          <Suspense fallback={null}><ObjectModel entry={entry} onLoaded={loaded}/></Suspense>
          <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping={!reducedMotion} dampingFactor={.1} minDistance={3.4} maxDistance={30} minPolarAngle={.05} maxPolarAngle={Math.PI - .05}/>
          <FrameCamera controls={controls} dimensions={dimensions}/>
        </Canvas>
      </PreviewBoundary> : <PreviewFallback project={project}/>}
      {entry?.url && status === 'loading' && <p className="discovery-inspect__loading" role="status">Opening the object…</p>}
    </div>

    <footer className="discovery-inspect__footer">
      <p id={hintId} className="discovery-inspect__hint">
        <span>Drag to turn. Scroll or pinch to zoom.</span>
        <span className="discovery-inspect__keyboard-hint">Arrow keys turn. + and − zoom. Home resets.</span>
      </p>
      <button className="discovery-inspect__explore" type="button" onClick={() => onOpen(project.id)}>Explore project</button>
    </footer>
  </section>;
}
