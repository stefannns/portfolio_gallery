import React, {Suspense, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Canvas, useThree} from '@react-three/fiber';
import {OrbitControls, useGLTF} from '@react-three/drei';
import * as THREE from 'three';
import RoomArrangement from './RoomArrangement.jsx';
import ComputerProjects from './ComputerProjects.jsx';
import RoomTasks from './RoomTasks.jsx';
import RoomWelcome from './RoomWelcome.jsx';
import KitchenMusicPlayer from './KitchenMusicPlayer.jsx';
import KitchenTitle from './KitchenTitle.jsx';
import RoomJoystick from './RoomJoystick.jsx';
import RoomInteract from './RoomInteract.jsx';
import RoomLoading from './RoomLoading.jsx';
import TaskOutline from './TaskOutline.jsx';
import {kitchenTracks} from './music-tracks.js';
import {projects, computerProjectIds} from './projects.js';
import './room-fonts.css';
import './room-review.css';

// Optional room manifest `review` values override these without changing the GLB.
export const ROOM_REVIEW_VIEW = {
  cameraDirection: [1, 1.15, 1.45],
  modelRotation: [0, -Math.PI / 2, 0],
  fieldOfView: 38,
  framePadding: 1.18,
};

const query = new URLSearchParams(window.location.search);
const TOUCH_PREVIEW = query.get('controls') === 'touch';
const isPortraitTouch = () => window.matchMedia('(orientation: portrait)').matches && (TOUCH_PREVIEW || window.matchMedia('(any-pointer: coarse)').matches);
const requestedVersion = query.get('version');
const ROOM_VERSION = ['4', '5', '7', '10'].includes(requestedVersion) ? Number(requestedVersion) : 10;
const INTERACTIVE_ROOM = ROOM_VERSION === 7 || ROOM_VERSION === 10;
const EDITOR_MODE = INTERACTIVE_ROOM && query.get('arrange') === '1';
const MANIFEST_URL = `/models/tripo/room-v${ROOM_VERSION}.json`;
const ROOM_ID = `sushi-room-v${ROOM_VERSION}`;
const TITLE_STYLE = ['counter', 'board', 'none'].includes(query.get('sign')) ? query.get('sign') : 'letters';

class RoomBoundary extends React.Component {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true};}
  componentDidCatch(error) {this.props.onError(error);}
  render() {return this.state.failed ? null : this.props.children;}
}

function FurnishedRoom({entry, rotation, onLoaded}) {
  const {scene} = useGLTF(entry.url, '/draco/');
  const [rx, ry, rz] = rotation;
  const {object, scalar, dimensions, framingPoints} = useMemo(() => {
    const rotated = new THREE.Group();
    rotated.rotation.set(rx, ry, rz);
    const clone = scene.clone(true);
    clone.traverse(node => {if (node.isMesh) {node.castShadow = true;node.receiveShadow = true;}});
    rotated.add(clone);
    rotated.updateMatrixWorld(true);
    const actualBounds = new THREE.Box3().setFromObject(rotated);
    if (actualBounds.isEmpty()) throw new Error('The room contains no visible geometry.');
    // Edited rooms can retain the original coordinate frame for saved props
    // while their outer trim changes shape.
    const reference = entry.normalizationBounds;
    const validReference = ['min', 'max'].every(key => Array.isArray(reference?.[key]) && reference[key].length === 3 && reference[key].every(Number.isFinite))
      && reference.max.every((value, axis) => value > reference.min[axis]);
    const bounds = validReference ? new THREE.Box3(new THREE.Vector3(...reference.min), new THREE.Vector3(...reference.max)) : actualBounds;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const largest = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(largest) || largest <= 0) throw new Error('The room contains no visible geometry.');
    const scalar = 12 / largest;
    let vertexCount = 0;
    rotated.traverse(node => {if (node.isMesh) vertexCount += node.geometry?.attributes.position?.count || 0;});
    const framingPoints = new Float32Array(vertexCount * 3);
    const point = new THREE.Vector3();
    const origin = new THREE.Vector3(center.x, bounds.min.y, center.z);
    let cursor = 0;
    rotated.traverse(node => {
      const position = node.isMesh && node.geometry?.attributes.position;
      if (!position) return;
      for (let index = 0; index < position.count; index++) {
        point.fromBufferAttribute(position, index).applyMatrix4(node.matrixWorld).sub(origin).multiplyScalar(scalar);
        point.toArray(framingPoints, cursor);cursor += 3;
      }
    });
    const centered = new THREE.Group();
    centered.add(rotated);
    rotated.position.set(-center.x, -bounds.min.y, -center.z);
    return {object: centered, scalar, dimensions: size.multiplyScalar(scalar).toArray(), framingPoints};
  }, [scene, rx, ry, rz, entry.normalizationBounds]);
  useEffect(() => {onLoaded({dimensions, scalar, framingPoints});}, [dimensions, scalar, framingPoints, onLoaded]);
  return <group name="furnished-room-review" scale={scalar}><primitive object={object} dispose={null}/></group>;
}

function FitRoomCamera({controls, info, view}) {
  const {camera, size, invalidate} = useThree();
  useEffect(() => {
    if (!info || size.width <= 0 || size.height <= 0) return;
    const dimensions = new THREE.Vector3(...info.dimensions);
    const half = dimensions.clone().multiplyScalar(.5);
    const target = new THREE.Vector3(0, half.y, 0);
    const direction = new THREE.Vector3(...view.cameraDirection).normalize();
    if (direction.lengthSq() < .001) direction.set(1, 1.15, 1.45).normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const aspect = size.width / Math.max(size.height, 1);
    if (camera.isPerspectiveCamera) camera.aspect = aspect;
    const placeCamera = distance => {
      // Flush orbit inertia before fitting so a resize cannot rotate the new view.
      const damping = controls.current?.enableDamping;
      if (controls.current) {
        controls.current.enableDamping = false;
        controls.current.update();
      }
      camera.position.copy(direction).multiplyScalar(distance).add(target);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      if (controls.current) {
        controls.current.target.copy(target);
        controls.current.minDistance = Math.max(2, distance * .22);
        controls.current.maxDistance = Math.max(45, distance * 2.8);
        if (camera.isOrthographicCamera) {
          controls.current.minZoom = camera.zoom * .3;
          controls.current.maxZoom = camera.zoom * 4;
        }
        controls.current.update();
        controls.current.enableDamping = damping;
        controls.current.saveState();
      }
      invalidate();
    };
    if (camera.isOrthographicCamera) {
      let left = Infinity, rightmost = -Infinity, bottom = Infinity, top = -Infinity;
      const includePoint = (x, y, z) => {
        y -= target.y;
        const horizontal = x * right.x + y * right.y + z * right.z;
        const vertical = x * up.x + y * up.y + z * up.z;
        left = Math.min(left, horizontal);rightmost = Math.max(rightmost, horizontal);
        bottom = Math.min(bottom, vertical);top = Math.max(top, vertical);
      };
      const points = info.framingPoints;
      if (points?.length) {
        for (let index = 0; index < points.length; index += 3) includePoint(points[index], points[index + 1], points[index + 2]);
      } else {
        for (const x of [-half.x, half.x]) for (const y of [0, dimensions.y]) for (const z of [-half.z, half.z]) includePoint(x, y, z);
      }
      target.addScaledVector(right, (left + rightmost) / 2).addScaledVector(up, (top + bottom) / 2);
      camera.left = -size.width / 2;camera.right = size.width / 2;
      camera.top = size.height / 2;camera.bottom = -size.height / 2;
      camera.zoom = Math.min(size.width / Math.max(.01, rightmost - left), size.height / Math.max(.01, top - bottom)) / view.framePadding;
      placeCamera(Math.max(...info.dimensions) * 3);
      return;
    }
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const verticalSlope = tangent / view.framePadding;
    const horizontalSlope = tangent * aspect / view.framePadding;
    let top = -Infinity, bottom = Infinity, left = Infinity, rightmost = -Infinity, nearestDepth = -Infinity;
    const constrainPoint = (x, y, z) => {
      y -= target.y;
      const depth = x * direction.x + y * direction.y + z * direction.z;
      const vertical = x * up.x + y * up.y + z * up.z;
      const horizontal = x * right.x + y * right.y + z * right.z;
      // Pair every real vertex's screen extent with its own depth. These
      // intervals solve both camera distance and the projected visual center.
      top = Math.max(top, vertical + verticalSlope * depth);
      bottom = Math.min(bottom, vertical - verticalSlope * depth);
      rightmost = Math.max(rightmost, horizontal + horizontalSlope * depth);
      left = Math.min(left, horizontal - horizontalSlope * depth);
      nearestDepth = Math.max(nearestDepth, depth);
    };
    const points = info.framingPoints;
    if (points?.length) {
      for (let index = 0; index < points.length; index += 3) constrainPoint(points[index], points[index + 1], points[index + 2]);
    } else {
      for (const x of [-half.x, half.x]) for (const y of [0, dimensions.y]) for (const z of [-half.z, half.z]) constrainPoint(x, y, z);
    }
    const distance = Math.max((top - bottom) / (2 * verticalSlope), (rightmost - left) / (2 * horizontalSlope), nearestDepth + camera.near * 2);
    target.addScaledVector(up, (top + bottom) / 2).addScaledVector(right, (rightmost + left) / 2);
    placeCamera(distance);
  }, [camera, size.width, size.height, controls, info, view, invalidate]);
  return null;
}

export default function RoomReview() {
  const [manifest, setManifest] = useState(null), [info, setInfo] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [resetLayoutToken, setResetLayoutToken] = useState(0), [arrangementStatus, setArrangementStatus] = useState('Loading items…');
  const [hoveredItem, setHoveredItem] = useState(''), [objectsReady, setObjectsReady] = useState(false);
  const [portraitPhone, setPortraitPhone] = useState(isPortraitTouch);
  const [touchMode, setTouchMode] = useState(() => TOUCH_PREVIEW || window.matchMedia('(any-pointer: coarse)').matches);
  const [compactViewport, setCompactViewport] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [computerOpen, setComputerOpen] = useState(false), [activeProject, setActiveProject] = useState(null), [selectedItem, setSelectedItem] = useState(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [arranging, setArranging] = useState(EDITOR_MODE);
  const [introduced, setIntroduced] = useState(!INTERACTIVE_ROOM || EDITOR_MODE);
  const [welcomeExiting, setWelcomeExiting] = useState(false);
  const [hasMoved, setHasMoved] = useState(false);
  const [welcomeAnchor, setWelcomeAnchor] = useState(null);
  const [inspectTarget, setInspectTarget] = useState(null);
  const [vegetablesViewed, setVegetablesViewed] = useState(false), [recorderViewed, setRecorderViewed] = useState(false), [computerViewed, setComputerViewed] = useState(false);
  const controls = useRef(null), rootRef = useRef(null), arrangementActions = useRef(null), titlePhysics = useRef(null);
  const welcomeShownAt = useRef(null);
  const welcomeDismissed = useRef(!INTERACTIVE_ROOM || EDITOR_MODE);
  const modalOpen = computerOpen || Boolean(activeProject);
  const introducing = INTERACTIVE_ROOM && !introduced;
  const landscapeBlocked = INTERACTIVE_ROOM && portraitPhone;
  const sceneReady = phase === 'ready' && (!INTERACTIVE_ROOM || objectsReady);
  const gameReady = sceneReady && !landscapeBlocked;
  const welcomeVisible = (introducing || welcomeExiting) && gameReady && Boolean(welcomeAnchor);
  const interactionPaused = modalOpen || !gameReady;
  const objectiveId = !arranging && !modalOpen
    ? !vegetablesViewed ? 'seed-squad' : !recorderViewed ? 'smarttester' : !computerViewed ? 'games-computer' : ''
    : '';
  const objectsLoaded = useCallback(() => setObjectsReady(true), []);
  const firstMove = useCallback(() => setHasMoved(true), []);
  const welcomePositioned = useCallback(anchor => setWelcomeAnchor(anchor), []);
  const welcomeExited = useCallback(() => setWelcomeExiting(false), []);
  const inspectionChanged = useCallback(target => setInspectTarget(target), []);
  const dismissWelcome = useCallback(({inspection = false} = {}) => {
    if (welcomeDismissed.current) return true;
    // Keep the greeting readable during movement, but never delay an explicit inspection.
    if (!inspection && (welcomeShownAt.current === null || performance.now() - welcomeShownAt.current < 5000)) return false;
    setWelcomeExiting(true);setIntroduced(true);
    welcomeDismissed.current = true;
    return true;
  }, []);
  const openComputer = useCallback(() => {dismissWelcome({inspection: true});setHoveredItem('');setVideoPlaying(false);setActiveProject(null);setComputerOpen(true);setComputerViewed(true);}, [dismissWelcome]);
  const openProject = useCallback(id => {if (projects.some(project => project.id === id)) {dismissWelcome({inspection: true});setHoveredItem('');setVideoPlaying(false);setComputerOpen(false);setActiveProject(id);if (id === 'seed-squad') setVegetablesViewed(true);if (id === 'smarttester') setRecorderViewed(true);}}, [dismissWelcome]);
  const closeProject = useCallback(() => {setVideoPlaying(false);setComputerOpen(false);setActiveProject(null);}, []);
  const entry = manifest?.assets?.[ROOM_ID] || manifest?.[ROOM_ID];
  const view = useMemo(() => {
    const requested = manifest?.review || {};
    const vector = (value, fallback) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? value : fallback;
    return {
      cameraDirection: vector(requested.cameraDirection, ROOM_REVIEW_VIEW.cameraDirection),
      modelRotation: vector(entry?.rotation || requested.modelRotation, ROOM_REVIEW_VIEW.modelRotation),
      projection: !INTERACTIVE_ROOM && requested.projection === 'orthographic' ? 'orthographic' : 'perspective',
      exposure: Number.isFinite(requested.exposure) ? THREE.MathUtils.clamp(requested.exposure, .5, 1.5) : (INTERACTIVE_ROOM ? .85 : 1),
      fieldOfView: Number.isFinite(requested.fieldOfView) ? THREE.MathUtils.clamp(requested.fieldOfView, 25, 65) : ROOM_REVIEW_VIEW.fieldOfView,
      framePadding: Number.isFinite(requested.framePadding) ? THREE.MathUtils.clamp(requested.framePadding, 1.02, 1.8) : ROOM_REVIEW_VIEW.framePadding,
    };
  }, [manifest, entry]);
  const loaded = useCallback(details => {setInfo(details);setPhase('ready');}, []);
  const failed = useCallback(error => {console.error('Kitchen scene loading failed.', error);setPhase('error');}, []);
  // Reload also clears rejected model/chunk promises, not just the room cache.
  const retry = () => window.location.reload();

  useEffect(() => {
    document.title = INTERACTIVE_ROOM ? 'Stefan’s Kitchen — Portfolio' : 'Sushi bar — room study';
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', changed);
    return () => preference.removeEventListener('change', changed);
  }, []);

  useEffect(() => {
    const orientation = window.matchMedia('(orientation: portrait)'), touch = window.matchMedia('(any-pointer: coarse)'), compact = window.matchMedia('(max-width: 900px)');
    const changed = () => {setPortraitPhone(isPortraitTouch());setTouchMode(TOUCH_PREVIEW || touch.matches);setCompactViewport(compact.matches);};
    orientation.addEventListener('change', changed);touch.addEventListener('change', changed);compact.addEventListener('change', changed);
    return () => {orientation.removeEventListener('change', changed);touch.removeEventListener('change', changed);compact.removeEventListener('change', changed);};
  }, []);

  useEffect(() => {
    if (welcomeVisible && welcomeShownAt.current === null) welcomeShownAt.current = performance.now();
  }, [welcomeVisible]);

  useEffect(() => {
    if (!introducing || !gameReady) return;
    const dismiss = event => {
      if (event.key === 'Escape') dismissWelcome();
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [introducing, gameReady, dismissWelcome]);

  useEffect(() => {
    const controller = new AbortController();
    setManifest(null);setInfo(null);setPhase('loading');setObjectsReady(false);
    fetch(MANIFEST_URL, {cache: 'no-store', signal: controller.signal})
      .then(response => {if (!response.ok) throw new Error('Room manifest unavailable.');return response.json();})
      .then(data => {
        const room = data.assets?.[ROOM_ID] || data[ROOM_ID];
        if (!room?.url) throw new Error('Room asset unavailable.');
        if (!controller.signal.aborted) setManifest(data);
      })
      .catch(error => {if (error.name !== 'AbortError') failed(error);});
    return () => controller.abort();
  }, [failed]);

  const orbitWithKeys = event => {
    if (interactionPaused || phase !== 'ready') return;
    if (INTERACTIVE_ROOM) {
      if (arranging && event.key.toLowerCase() === 'r' && arrangementActions.current?.rotateSelected()) {event.preventDefault();event.stopPropagation();}
      return;
    }
    const orbit = controls.current;
    if (!orbit || !orbit.enabled || phase !== 'ready') return;
    if (event.key.toLowerCase() === 'r' && arrangementActions.current?.rotateSelected()) {event.preventDefault();event.stopPropagation();return;}
    const turn = Math.PI / 18;
    if (event.key === 'ArrowLeft') orbit.setAzimuthalAngle(orbit.getAzimuthalAngle() - turn);
    else if (event.key === 'ArrowRight') orbit.setAzimuthalAngle(orbit.getAzimuthalAngle() + turn);
    else if (event.key === 'ArrowUp') orbit.setPolarAngle(THREE.MathUtils.clamp(orbit.getPolarAngle() - turn, .05, Math.PI / 2 - .02));
    else if (event.key === 'ArrowDown') orbit.setPolarAngle(THREE.MathUtils.clamp(orbit.getPolarAngle() + turn, .05, Math.PI / 2 - .02));
    else if (event.key === '+' || event.key === '=') orbit.dollyIn(.88);
    else if (event.key === '-' || event.key === '_') orbit.dollyOut(.88);
    else if (event.key === 'Home') orbit.reset();
    else return;
    event.preventDefault();orbit.update();
  };

  return <div className={`room-review-viewport${INTERACTIVE_ROOM ? ' room-review-viewport--game' : ''}`}>
  <main inert={landscapeBlocked ? true : undefined} ref={rootRef} onClickCapture={introducing ? dismissWelcome : undefined} className={`room-review ${INTERACTIVE_ROOM ? 'room-review--interactive room-review--game' : ''} ${arranging ? 'room-review--arrange' : ''} ${touchMode ? 'room-review--touch' : ''}`} data-room-version={ROOM_VERSION} data-room-status={phase} data-game-phase={introducing ? 'welcome' : 'explore'} data-has-moved={hasMoved} data-room-url={entry?.url || ''} data-room-scale={info?.scalar || ''} data-selected-item={selectedItem?.id || ''} data-selected-rotation-y={selectedItem?.rotationY ?? ''} data-active-project={activeProject || ''} data-computer-open={computerOpen} data-project-video-playing={videoPlaying} data-arranging={arranging} data-camera-locked={INTERACTIVE_ROOM} data-landscape-only={INTERACTIVE_ROOM}>
    {!INTERACTIVE_ROOM && <header className="room-review__header"><h1>Sushi bar — room study</h1><a href="/">Back to kitchen</a></header>}
    {INTERACTIVE_ROOM && <div className="room-hud-layer">
      {gameReady && !arranging && !touchMode && !compactViewport && <KitchenMusicPlayer tracks={kitchenTracks} ducked={videoPlaying}/>}
      {gameReady && !arranging && !modalOpen && <RoomTasks vegetablesViewed={vegetablesViewed} recorderViewed={recorderViewed} computerViewed={computerViewed}/>}
      {gameReady && <>
      {!hasMoved && !welcomeVisible && !arranging && !modalOpen && <p className="room-move-hint" role="status"><span className="room-controls--keyboard">WASD or click the floor to move</span><span className="room-controls--touch">Drag the joystick or tap the floor</span></p>}
      {hasMoved && !welcomeVisible && !arranging && !modalOpen && <p className={`room-inspect-hint${inspectTarget ? ' room-inspect-hint--ready' : ''}`} role="status" aria-live="polite">
        {inspectTarget ? <><span>Inspect {inspectTarget.label}</span><span className="room-inspect-hint__action room-controls--keyboard"><kbd>E</kbd><span>or click</span></span><span className="room-controls--touch">Tap Inspect</span></> : <><span className="room-controls--keyboard">Click an object to inspect</span><span className="room-controls--touch">Tap an object to inspect</span></>}
      </p>}
      </>}
    </div>}
    <div className="room-review__stage" inert={interactionPaused ? true : undefined} role="group" aria-label="Stefan's kitchen" aria-describedby={arranging || !INTERACTIVE_ROOM ? 'room-review-hint' : undefined} tabIndex={gameReady ? 0 : -1} onKeyDown={orbitWithKeys}>
      {entry?.url && <RoomBoundary key={entry.url} onError={failed}>
        <Canvas
          orthographic={view.projection === 'orthographic'}
          frameloop={INTERACTIVE_ROOM ? 'always' : 'demand'}
          shadows
          dpr={[1, touchMode || compactViewport ? 1.25 : 1.7]}
          camera={{position: [12, 14, 18], fov: view.fieldOfView, near: .1, far: 200}}
          gl={{antialias: true, powerPreference: 'high-performance'}}
          onCreated={({gl}) => {gl.toneMapping = THREE.ACESFilmicToneMapping;gl.toneMappingExposure = view.exposure;gl.shadowMap.type = THREE.PCFShadowMap;}}
          aria-hidden={INTERACTIVE_ROOM ? undefined : true}
        >
          <TaskOutline reducedMotion={reducedMotion}>
          <color attach="background" args={['#f2f3ed']}/>
          <ambientLight intensity={.7}/>
          <hemisphereLight args={['#fff5e4', '#aab6ac', 1.5]}/>
          <directionalLight castShadow position={[-7, 16, 10]} intensity={2.5} color="#fff3dc" shadow-mapSize={touchMode || compactViewport ? [1024, 1024] : [2048, 2048]} shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14} shadow-camera-far={60} shadow-normalBias={.025} shadow-bias={-.0001}/>
          <directionalLight position={[8, 8, -6]} intensity={1} color="#e8f1f3"/>
          <Suspense fallback={null}><FurnishedRoom entry={entry} rotation={view.modelRotation} onLoaded={loaded}/></Suspense>
          {ROOM_VERSION === 10 && TITLE_STYLE !== 'none' && <Suspense fallback={null}><KitchenTitle variant={TITLE_STYLE} physicsRef={titlePhysics} rootRef={rootRef}/></Suspense>}
          {INTERACTIVE_ROOM && info && <RoomArrangement key={ROOM_VERSION} roomVersion={ROOM_VERSION} controls={controls} rootRef={rootRef} titlePhysics={titlePhysics} resetToken={resetLayoutToken} onStatus={setArrangementStatus} onHover={setHoveredItem} onReady={objectsLoaded} onError={failed} onFirstMove={firstMove} onWelcomeMove={dismissWelcome} onWelcomeAnchor={welcomePositioned} welcomeActive={introducing || welcomeExiting} onInspectTarget={inspectionChanged} objectiveId={objectiveId} reducedMotion={reducedMotion} onOpenComputer={openComputer} onOpenProject={openProject} onSelection={setSelectedItem} actionsRef={arrangementActions} paused={interactionPaused} editable={arranging} fixedCamera/>}
          <OrbitControls ref={controls} enabled={!INTERACTIVE_ROOM && !modalOpen} makeDefault enableRotate={!INTERACTIVE_ROOM} enableZoom={!INTERACTIVE_ROOM} enableDamping={!INTERACTIVE_ROOM && !reducedMotion} dampingFactor={.08} enablePan={false} minPolarAngle={.05} maxPolarAngle={Math.PI / 2 - .02}/>
          <FitRoomCamera controls={controls} info={info} view={view}/>
          </TaskOutline>
        </Canvas>
      </RoomBoundary>}
    </div>
    {welcomeVisible && <RoomWelcome anchor={welcomeAnchor} reducedMotion={reducedMotion} closing={welcomeExiting} onExited={welcomeExited}/>}
    {INTERACTIVE_ROOM && gameReady && <>
      {EDITOR_MODE && <p className="room-arrangement-status" role="status" inert={modalOpen ? true : undefined}>{hoveredItem || (arranging && selectedItem ? `${selectedItem.label} selected${arrangementStatus ? `. ${arrangementStatus}` : ''}` : arrangementStatus)}</p>}
      {!arranging && !modalOpen && <RoomJoystick disabled={interactionPaused}/>}
      {(touchMode || compactViewport) && !arranging && !modalOpen && !welcomeVisible && inspectTarget && <RoomInteract target={inspectTarget} onInspect={() => arrangementActions.current?.inspectNearby()}/>}
    </>}
    {(!INTERACTIVE_ROOM || EDITOR_MODE) && <footer className="room-review__footer" inert={modalOpen ? true : undefined}><p id="room-review-hint">{INTERACTIVE_ROOM ? arranging ? 'Drag items to place · Select an item to rotate' : 'WASD to walk · Click items to explore' : 'Drag to orbit. Scroll or pinch to zoom.'}<span className="room-review__keyboard-hint">{INTERACTIVE_ROOM ? arranging ? 'Focus an item and use arrow keys to place it. R rotates the selected item.' : 'Tab to focus an item. Enter opens its project.' : 'Drag empty space or use arrow keys to orbit. + and − zoom. Home resets.'}</span></p>
      <div className="room-review__actions">
        {!INTERACTIVE_ROOM && <button type="button" disabled={phase !== 'ready'} onClick={() => controls.current?.reset()}>Reset view</button>}
        {INTERACTIVE_ROOM && arranging && <><button type="button" className="room-review__rotate" disabled={!objectsReady || !selectedItem} onClick={() => arrangementActions.current?.rotateSelected()}>Rotate item</button><button type="button" disabled={!objectsReady} onClick={() => {setResetLayoutToken(token => token + 1);setHoveredItem('');}}>Reset layout</button></>}
        {INTERACTIVE_ROOM && <button type="button" disabled={!objectsReady} aria-pressed={arranging} onClick={() => {setArranging(value => !value);setHoveredItem('');setArrangementStatus('');}}>{arranging ? 'Done arranging' : 'Arrange'}</button>}
      </div>
    </footer>}
    {modalOpen && <ComputerProjects key={activeProject || 'games-computer'} onClose={closeProject} onVideoPlaybackChange={setVideoPlaying} projectIds={activeProject ? [activeProject] : computerProjectIds} projectId={activeProject || undefined} title={activeProject ? projects.find(project => project.id === activeProject)?.title : undefined}/>}
  </main>
    {!sceneReady && <RoomLoading error={phase === 'error'} status={phase === 'ready' ? 'Setting out the projects…' : 'Getting everything ready for you.'} onRetry={retry}/>}
    {landscapeBlocked && <section className="room-rotate" role="status" aria-live="polite">
      <svg viewBox="0 0 80 80" aria-hidden="true"><rect x="22" y="10" width="36" height="59" rx="7"/><path d="M35 60h10M9 37a31 31 0 0 1 10-22m-10 9 1 13 12-3M71 43a31 31 0 0 1-10 22m10-9-1-13-12 3"/></svg>
      <h1>A little more room to play</h1>
      <p>Turn your phone sideways to explore the kitchen.</p>
    </section>}
  </div>;
}
