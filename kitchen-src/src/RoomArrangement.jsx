import React, {Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useFrame, useThree} from '@react-three/fiber';
import {Html} from '@react-three/drei';
import * as THREE from 'three';
import CapybaraActor from './CapybaraActor.jsx';
import FootprintTrail from './FootprintTrail.jsx';
import KitchenToys from './KitchenToys.jsx';
import SushiPlates from './SushiPlates.jsx';
import {KITCHEN_TOYS, isNearRoomTarget, chooseRoomTarget, isKitchenToyAvailable} from './kitchen-toy-state.js';
import {RestaurantModel} from './TripoRestaurant.jsx';
import {getRoomPlacement} from './room-placement.js';
import {getSceneUiScale} from './scene-ui-scale.js';
import {createRoomNavigator, canTraverseRoomSegment} from './room-navigation.js';
import {getLandedFishCollider, recoverFishOverlap} from './fish-ground-collision.js';
import {resolveFishPush} from './fish-ground-pushing.js';
import {resolveCabinetArmClearance} from './cabinet-arm-clearance.js';
import {attachRoomMovementInput} from './room-movement-input.js';
import {useTaskOutlineIgnore} from './TaskOutline.jsx';

const up = new THREE.Vector3(0, 1, 0);
const NO_TOYS = Object.freeze([]);
const canInspectItem = isNearRoomTarget;

function loadLayout(storageKey, sanitizeRoomPlacements) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    const items = saved?.version >= 2 ? saved.items : saved?.items?.filter(item => item.id !== 'h3-otome');
    return sanitizeRoomPlacements(items);
  }
  catch {return sanitizeRoomPlacements(null);}
}

function persistLayout(storageKey, items) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({version: 2, items: items.map(({id, position, rotationY}) => ({id, position, rotationY}))}));
    return true;
  } catch {return false;}
}

function MovableItem({item, entry, register, onStart, onHover, onNudge, onFocus, onActivate, onError, editable, objective, highlighted, hovered, reducedMotion}) {
  const ignorePointerTarget = useTaskOutlineIgnore();
  const markerBounds = useRef(new THREE.Box3()), markerPoint = useRef(new THREE.Vector3());
  const markerPosition = useCallback((anchor, camera, size) => {
    const rightInset = item.id === 'seed-squad' ? 20 : 2;
    const model = anchor.parent?.getObjectByName(`room-item-model-${item.id}`);
    if (model) {
      model.updateWorldMatrix(true, true);
      markerBounds.current.setFromObject(model);
      if (!markerBounds.current.isEmpty()) {
        const {min, max} = markerBounds.current;
        let right = -Infinity, top = Infinity;
        for (let corner = 0; corner < 8; corner++) {
          markerPoint.current.set(corner & 1 ? max.x : min.x, corner & 2 ? max.y : min.y, corner & 4 ? max.z : min.z).project(camera);
          right = Math.max(right, (markerPoint.current.x + 1) * size.width / 2);
          const y = (1 - markerPoint.current.y) * size.height / 2;
          top = Math.min(top, y);
        }
        // Tuck the badge against the upper-right corner, clear of the object's center.
        const scale = getSceneUiScale(camera, size);
        return [right - rightInset * scale, top + 6 * scale];
      }
    }
    markerPoint.current.setFromMatrixPosition(anchor.matrixWorld).project(camera);
    return [(markerPoint.current.x + 1) * size.width / 2 - rightInset * getSceneUiScale(camera, size), (1 - markerPoint.current.y) * size.height / 2];
  }, [item.id]);

  return <group ref={node => register(item.id, node)} position={item.position} rotation={[0, item.rotationY, 0]}
    onPointerDown={event => onStart(event, item.id)}
    onPointerOver={event => {event.stopPropagation();if (event.pointerType !== 'touch') onHover(item.id);}}
    onPointerOut={() => onHover(null, item.id)}>
    <group name={`room-item-model-${item.id}`} position={item.modelOffset || [0, 0, 0]}><RestaurantModel entry={entry} dimensions={[item.width, item.width, item.width]} rotationY={0} uniform objective={objective} highlighted={highlighted || hovered} reducedMotion={reducedMotion} onError={onError}/></group>
    {/* Invisible pointer targets make small items easy to grab without changing their art. */}
    <mesh ref={ignorePointerTarget} position={[0, item.width * .3, 0]}>
      <boxGeometry args={[Math.max(.62, item.width), Math.max(.45, item.width * .65), Math.max(.62, item.width)]}/>
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false}/>
    </mesh>
    {objective && <Html center calculatePosition={markerPosition} style={{pointerEvents: 'none'}} zIndexRange={[8, 1]}>
      <span className="room-objective-marker-scale"><span className="room-objective-marker" data-marker-for={item.id} data-marker-placement="top-right" aria-hidden="true">!</span></span>
    </Html>}
    <Html center position={[0, item.width * .6 + .12, 0]} style={{pointerEvents: 'none'}} zIndexRange={[12, 1]}>
      <button type="button" className="room-item-keyboard" aria-label={editable ? `Select ${item.label}` : item.id === 'games-computer' ? 'Open computer' : `Open ${item.label} project`}
        onFocus={() => onFocus(item.id)} onBlur={() => onHover(null, item.id)}
        onKeyDown={event => onNudge(event, item.id)} onClick={() => onActivate(item.id, {direct: true})}>{item.label}<span>{editable ? 'Enter to select · Arrows to place · R to rotate' : highlighted ? 'E or click to inspect' : 'Click to inspect · move closer for E'}</span></button>
    </Html>
  </group>;
}

export default function RoomArrangement({roomVersion = 10, controls, rootRef, titlePhysics, resetToken, onStatus, onHover, onReady, onError, onOpenComputer, onOpenProject, onSelection, actionsRef, objectiveId = '', onToyUse, onTomatoSplat, onFirstMove, onWelcomeMove, onInspectTarget, onWelcomeAnchor, welcomeActive = false, reducedMotion = false, paused = false, editable = false, fixedCamera = true}) {
  const ignoreWalkFloor = useTaskOutlineIgnore();
  const {
    CAPYBARA_HEIGHT, PLAYER_START, PLAYER_SPEED, PLAYER_RADIUS, ROOM_FLOOR_Y, ROOM_BOUNDS, ROOM_ITEMS,
    pickRoomSurface, sanitizeRoomPlacements, snapPropPosition, stepRoomPlayer, canWalk,
  } = getRoomPlacement(roomVersion);
  const toyItems = roomVersion === 10 ? KITCHEN_TOYS : NO_TOYS;
  const toyActions = useRef(null);
  const [toysReady, setToysReady] = useState(roomVersion !== 10);
  const toysLoaded = useCallback(() => setToysReady(true), []);
  const [sushiReady, setSushiReady] = useState(roomVersion !== 10);
  const sushiLoaded = useCallback(() => setSushiReady(true), []);
  const navigator = useMemo(() => createRoomNavigator({bounds: ROOM_BOUNDS, canWalk}), [ROOM_BOUNDS, canWalk]);
  const storageKey = `stefan-sushi-room-v${roomVersion}-layout`;
  const saveLayout = useCallback(items => persistLayout(storageKey, items), [storageKey]);
  const {camera, gl, invalidate} = useThree();
  const [placements, setPlacements] = useState(() => loadLayout(storageKey, sanitizeRoomPlacements));
  const [assets, setAssets] = useState(null);
  const [characterReady, setCharacterReady] = useState(false);
  const [highlightId, setHighlightId] = useState('');
  const [hoverId, setHoverId] = useState('');
  const readySent = useRef(false);
  const firstMoveSent = useRef(false);
  const characterLoaded = useCallback(() => setCharacterReady(true), []);
  const latest = useRef(placements), groups = useRef(new Map()), player = useRef();
  const walkPress = useRef(null), walkRoute = useRef([]), walkStalled = useRef(0);
  const drag = useRef(null), lastReset = useRef(resetToken), hover = useRef(null), selected = useRef(null);
  const raycaster = useRef(new THREE.Raycaster()), pointer = useRef(new THREE.Vector2());
  const direction = useRef(new THREE.Vector3()), right = useRef(new THREE.Vector3());
  const inspectTarget = useRef(null), welcomePoint = useRef(new THREE.Vector3()), lastWelcomeAnchor = useRef(null);
  const engine = useRef({player: {...PLAYER_START}, keys: new Set(), moving: false, paused: false, joystick: {x: 0, z: 0}}).current;
  const inputState = useRef(null);
  const fishCollisionActive = useRef(false), fishCollisionRecoveries = useRef(0);
  const walkingObstacles = useCallback(({recover = true} = {}) => {
    const fish = roomVersion === 10 ? getLandedFishCollider(engine.fishToy) : null;
    const active = Boolean(fish);
    if (active !== fishCollisionActive.current) {
      fishCollisionActive.current = active;
      // A route planned while the fish was airborne must not run through it.
      walkRoute.current = [];walkPress.current = null;walkStalled.current = 0;
    }
    const items = fish ? [...latest.current, fish] : latest.current;
    let startValid = true;
    if (fish && canWalk(engine.player.x, engine.player.z, latest.current) && !canWalk(engine.player.x, engine.player.z, items)) {
      startValid = false;
      if (recover) {
        const safe = recoverFishOverlap(engine.player, fish, {
          playerRadius: PLAYER_RADIUS,
          canWalk: (x, z) => canWalk(x, z, items),
          canTraverse: (from, to) => canTraverseRoomSegment(from, to, canWalk, latest.current),
        });
        if (safe && canWalk(safe.x, safe.z, items)) {
          if (Math.hypot(safe.x - engine.player.x, safe.z - engine.player.z) > .00001) {
            engine.player.x = safe.x;engine.player.z = safe.z;fishCollisionRecoveries.current++;
            walkRoute.current = [];walkPress.current = null;walkStalled.current = 0;
          }
          startValid = true;
        }
      }
    }
    return {items, startValid, active};
  }, [canWalk, engine, PLAYER_RADIUS, roomVersion]);
  const resetMovement = useCallback(() => {
    walkRoute.current = [];walkPress.current = null;walkStalled.current = 0;
    engine.keys.clear();engine.moving = false;engine.joystick.x = 0;engine.joystick.z = 0;
  }, [engine]);

  const selectItem = useCallback(id => {
    const item = latest.current.find(value => value.id === id);
    if (!item) return;
    selected.current = id;
    onSelection?.({id, label: item.label, rotationY: item.rotationY});
  }, [onSelection]);

  const activateItem = useCallback((id, {direct = false} = {}) => {
    if (paused) return false;
    walkRoute.current = [];walkPress.current = null;
    const toy = toyItems.find(value => value.id === id);
    if (toy) {
      // Fixture toys always require proximity, including mouse/keyboard clicks.
      if (editable || !isNearRoomTarget(engine.player, toy)) {onStatus(`Move closer to use the ${toy.label.toLowerCase()}.`);return false;}
      if (toyActions.current?.trigger(id)) {if (id === 'tomato-throw') resetMovement();onStatus('');onToyUse?.();}
      return true;
    }
    const item = latest.current.find(value => value.id === id);
    if (!item) return;
    if (!editable && !direct && !canInspectItem(engine.player, item)) {onStatus('Move closer to inspect.');return;}
    selectItem(id);
    if (editable) {onStatus('');return;}
    // Stop immediately, before React mounts the project dialog and swallows input.
    resetMovement();engine.paused = true;
    if (id === 'games-computer') onOpenComputer?.();
    else onOpenProject?.(id);
    return true;
  }, [editable, engine, onOpenComputer, onOpenProject, onStatus, onToyUse, paused, resetMovement, selectItem, toyItems]);

  const currentInspectTarget = useCallback(() => {
    if (paused || editable || engine.tomatoAction?.active) return null;
    const availableToys = toyItems.filter(item => isKitchenToyAvailable(item, engine));
    return chooseRoomTarget(engine.player, [...latest.current, ...availableToys]);
  }, [editable, engine, paused, toyItems]);

  const inspectNearby = useCallback(() => {
    if (paused || editable || engine.paused || drag.current) return false;
    // Consume repeated E/Use presses until the current toss has finished.
    if (engine.tomatoAction?.active) return true;
    const target = currentInspectTarget();
    if (!target) return false;
    return activateItem(target.id) !== false;
  }, [activateItem, currentInspectTarget, editable, engine, paused]);

  const rotateSelected = useCallback(() => {
    if (!editable || paused || drag.current || !selected.current) return false;
    const item = latest.current.find(value => value.id === selected.current);
    if (!item) return false;
    const rotationY = ((item.rotationY + Math.PI / 4) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const next = latest.current.map(value => value.id === item.id ? {...value, rotationY} : value);
    latest.current = next;setPlacements(next);
    groups.current.get(item.id)?.rotation.set(0, rotationY, 0);
    onSelection?.({id: item.id, label: item.label, rotationY});
    onStatus(saveLayout(next) ? 'Rotation saved on this device.' : 'Rotation kept for this visit.');
    invalidate();
    return true;
  }, [editable, invalidate, onSelection, onStatus, paused, saveLayout]);

  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {rotateSelected, inspectNearby};
    return () => {actionsRef.current = null;};
  }, [actionsRef, rotateSelected, inspectNearby]);

  const commit = useCallback((id, position) => {
    const next = latest.current.map(item => item.id === id ? {...item, position: [...position]} : item);
    latest.current = next;setPlacements(next);
    onStatus(saveLayout(next) ? 'Layout saved on this device.' : 'Layout kept for this visit.');
  }, [onStatus, saveLayout]);

  const pointAt = useCallback(event => {
    const rect = gl.domElement.getBoundingClientRect();
    pointer.current.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.current.setFromCamera(pointer.current, camera);
    return pickRoomSurface(raycaster.current.ray, {radius: .04});
  }, [camera, gl, pickRoomSurface]);

  const safePosition = useCallback((id, point) => {
    const position = snapPropPosition(id, point);
    if (!position) return null;
    const item = ROOM_ITEMS.find(value => value.id === id);
    if (position[1] < ROOM_FLOOR_Y + .12 && Math.hypot(position[0] - engine.player.x, position[2] - engine.player.z) < item.width * .3 + .4) return null;
    return position;
  }, [engine, ROOM_FLOOR_Y, ROOM_ITEMS, snapPropPosition]);

  const finishDrag = useCallback((shouldSave, pointerId) => {
    const current = drag.current;
    if (!current || (pointerId !== undefined && pointerId !== current.pointerId)) return;
    drag.current = null;engine.paused = false;engine.keys.clear();
    if (controls.current) controls.current.enabled = !fixedCamera && !paused;
    if (gl.domElement.hasPointerCapture(current.pointerId)) gl.domElement.releasePointerCapture(current.pointerId);
    const position = shouldSave ? current.latest : current.original;
    groups.current.get(current.id)?.position.fromArray(position);
    if (shouldSave && !current.moved) {onStatus('');activateItem(current.id, {direct: true});}
    else if (shouldSave && current.moved && current.editable) commit(current.id, position);
    else onStatus(!shouldSave && current.editable ? 'Move cancelled.' : '');
    document.body.style.cursor = '';
    if (rootRef.current) rootRef.current.dataset.draggingItem = '';
    invalidate();
  }, [activateItem, commit, controls, engine, fixedCamera, gl, invalidate, onStatus, paused, rootRef]);

  const startFloorWalk = useCallback(event => {
    if (editable || paused || drag.current || event.button !== 0 || event.nativeEvent?.isPrimary === false) return;
    const hit = pointAt(event);
    if (!hit || Math.abs(hit[1] - ROOM_FLOOR_Y) > .08) return;
    event.stopPropagation();
    walkPress.current = {pointerId: event.pointerId, startX: event.clientX, startY: event.clientY};
  }, [editable, paused, pointAt, ROOM_FLOOR_Y]);

  const startDrag = useCallback((event, id) => {
    if (event.button !== 0 || event.nativeEvent?.isPrimary === false || drag.current || paused) return;
    event.stopPropagation();event.nativeEvent?.preventDefault();
    const item = latest.current.find(value => value.id === id), point = editable ? pointAt(event) : null;
    if (!item) return;
    walkPress.current = null;walkRoute.current = [];
    selectItem(id);
    const anchor = editable ? raycaster.current.ray.intersectPlane(new THREE.Plane(up, -item.position[1]), new THREE.Vector3()) : null;
    drag.current = {
      id, pointerId: event.pointerId, original: [...item.position], latest: [...item.position], start: [event.clientX, event.clientY], moved: false, editable,
      offset: anchor ? [item.position[0] - anchor.x, item.position[2] - anchor.z] : point ? [item.position[0] - point[0], item.position[2] - point[2]] : [0, 0],
    };
    engine.paused = true;engine.moving = false;engine.keys.clear();
    if (controls.current) controls.current.enabled = false;
    gl.domElement.setPointerCapture(event.pointerId);
    document.body.style.cursor = editable ? 'grabbing' : 'pointer';onHover(item.label);onStatus(editable ? `Placing ${item.label.toLowerCase()}. Escape cancels.` : '');
    if (rootRef.current) rootRef.current.dataset.draggingItem = editable ? id : '';
  }, [controls, editable, engine, gl, onHover, onStatus, paused, pointAt, rootRef, selectItem]);

  useEffect(() => {
    const move = event => {
      const press = walkPress.current;
      if (press && event.pointerId === press.pointerId && Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > 6) walkPress.current = null;
      const current = drag.current;
      if (!current || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      if (Math.hypot(event.clientX - current.start[0], event.clientY - current.start[1]) > 5) current.moved = true;
      if (!current.moved || !current.editable) return;
      const hit = pointAt(event);
      if (!hit) return;
      const position = safePosition(current.id, [hit[0] + current.offset[0], hit[1], hit[2] + current.offset[1]]);
      if (!position) return;
      current.latest = position;groups.current.get(current.id)?.position.fromArray(position);invalidate();
    };
    const release = event => {
      const press = walkPress.current;
      if (press?.pointerId === event.pointerId) {
        walkPress.current = null;
        if (!paused && !editable && !drag.current && Math.hypot(event.clientX - press.startX, event.clientY - press.startY) <= 6) {
          const hit = pointAt(event);
          if (hit && Math.abs(hit[1] - ROOM_FLOOR_Y) <= .08) {
            const walking = walkingObstacles();
            walkRoute.current = walking.startValid ? navigator.findPath(engine.player, {x: hit[0], z: hit[2]}, walking.items) : [];
            walkStalled.current = 0;
          }
        }
      }
      finishDrag(true, event.pointerId);
    };
    const cancel = () => {walkPress.current = null;walkRoute.current = [];finishDrag(false);};
    const lost = event => {if (drag.current?.pointerId === event.pointerId) finishDrag(false, event.pointerId);};
    window.addEventListener('pointermove', move, {passive: false});
    window.addEventListener('pointerup', release);window.addEventListener('pointercancel', cancel);
    gl.domElement.addEventListener('lostpointercapture', lost);
    return () => {
      window.removeEventListener('pointermove', move);window.removeEventListener('pointerup', release);window.removeEventListener('pointercancel', cancel);
      gl.domElement.removeEventListener('lostpointercapture', lost);cancel();document.body.style.cursor = '';
    };
  }, [editable, engine, finishDrag, gl, invalidate, navigator, paused, pointAt, ROOM_FLOOR_Y, safePosition, walkingObstacles]);

  // Keep one input subscription across project/task changes. Its callbacks read
  // the current phase rather than retaining a closed dialog's paused state.
  inputState.current = {paused, editable, dragging: Boolean(drag.current), finishDrag, inspectNearby, onStatus};
  useEffect(() => attachRoomMovementInput({
    windowTarget: window, documentTarget: document, engine,
    readState: () => ({...inputState.current, dragging: Boolean(drag.current)}),
    cancelRoute: () => {walkRoute.current = [];walkPress.current = null;walkStalled.current = 0;},
    clear: () => {resetMovement();inputState.current.finishDrag(false);},
    focusStage: target => {
      if (target?.closest?.('.room-item-keyboard')) {
        gl.domElement.closest('.room-review__stage')?.focus({preventScroll: true});
      }
    },
  }), [engine, gl, resetMovement]);

  useEffect(() => {
    const controller = new AbortController();
    const load = url => fetch(url, {signal: controller.signal}).then(response => {if (!response.ok) throw new Error(`Room objects unavailable (${response.status}): ${url}`);return response.json();});
    Promise.all([load('/models/tripo/manifest.json'), load('/models/tripo/discovery-v2.json'), load('/models/tripo/room-items-v1.json')])
      .then(([character, props, computer]) => {
        if (controller.signal.aborted) return;
        const hasUrl = value => typeof value === 'string' && value.trim().length > 0;
        for (const animation of ['idle', 'walk']) {
          if (!hasUrl(character?.animations?.[animation])) throw new Error(`The capybara ${animation} animation is missing from its manifest.`);
        }
        const propAssets = {...props?.assets, ...computer?.assets};
        for (const item of ROOM_ITEMS) {
          if (!hasUrl(propAssets[item.asset]?.url)) throw new Error(`The model for ${item.label} (${item.asset}) is missing from the room objects manifest.`);
        }
        setAssets({character, props: {...props, assets: propAssets}});onStatus('');
      })
      .catch(error => {if (!controller.signal.aborted && error.name !== 'AbortError') {onStatus('Some objects could not load. Refresh to retry.');onError?.(error);}});
    return () => controller.abort();
  }, [onStatus, onError, ROOM_ITEMS]);

  useEffect(() => {
    if (!rootRef.current) return;
    rootRef.current.dataset.layoutPositions = JSON.stringify(placements.map(({id, position, rotationY}) => ({id, position, rotationY})));
    rootRef.current.dataset.propCount = String(placements.length);
  }, [placements, rootRef]);

  useLayoutEffect(() => {
    // Synchronize both opening and closing before the next paint/key event.
    // No old key, joystick deflection or click destination may survive a dialog.
    resetMovement();
    if (paused) {
      finishDrag(false);hover.current = null;setHoverId('');onHover('');
    }
    engine.paused = paused || Boolean(drag.current) || document.hidden;
    if (controls.current) controls.current.enabled = !fixedCamera && !engine.paused;
  }, [controls, engine, finishDrag, fixedCamera, onHover, paused, resetMovement]);

  useEffect(() => {
    if (resetToken === lastReset.current) return;
    lastReset.current = resetToken;walkRoute.current = [];walkPress.current = null;finishDrag(false);
    const next = sanitizeRoomPlacements(null);latest.current = next;setPlacements(next);saveLayout(next);
    selected.current = null;onSelection?.(null);
    engine.player = {...PLAYER_START};engine.keys.clear();engine.moving = false;
    for (const item of next) {const group = groups.current.get(item.id);group?.position.fromArray(item.position);group?.rotation.set(0, item.rotationY, 0);}
    onStatus('Starting layout restored.');
  }, [engine, finishDrag, onSelection, onStatus, resetToken, PLAYER_START, sanitizeRoomPlacements, saveLayout]);

  useFrame(({camera, size}, delta) => {
    const sceneScale = getSceneUiScale(camera, size);
    if (rootRef.current && Math.abs(Number(rootRef.current.dataset.sceneUiScale || 0) - sceneScale) > .0001) {
      rootRef.current.style.setProperty('--scene-ui-scale', String(sceneScale));
      rootRef.current.dataset.sceneUiScale = sceneScale.toFixed(5);
    }
    // Each prop loads inside its own Suspense boundary. Wait for the actual
    // rendered meshes, rather than just their manifest, before opening play.
    if (!readySent.current && assets && characterReady && toysReady && sushiReady && placements.every(item => {
      let loaded = false;
      groups.current.get(item.id)?.getObjectByName(`room-item-model-${item.id}`)?.traverse(node => {if (node.isMesh) loaded = true;});
      return loaded;
    })) {
      readySent.current = true;
      onReady?.();
    }
    engine.rootDOM = rootRef;engine.paused = paused || Boolean(drag.current) || document.hidden;
    const walking = walkingObstacles({recover: !engine.paused && !editable});
    camera.getWorldDirection(direction.current);direction.current.y = 0;direction.current.normalize();
    right.current.crossVectors(direction.current, up).normalize();
    const horizontal = Number(engine.keys.has('KeyD')) - Number(engine.keys.has('KeyA')) + engine.joystick.x;
    const vertical = Number(engine.keys.has('KeyS')) - Number(engine.keys.has('KeyW')) + engine.joystick.z;
    let input = {x: right.current.x * horizontal - direction.current.x * vertical, z: right.current.z * horizontal - direction.current.z * vertical};
    if (engine.paused) walkRoute.current = [];
    if (Math.hypot(horizontal, vertical) > .04) walkRoute.current = [];
    if (!engine.paused && walkRoute.current.length) {
      while (walkRoute.current.length && Math.hypot(walkRoute.current[0].x - engine.player.x, walkRoute.current[0].z - engine.player.z) < .035) walkRoute.current.shift();
      const waypoint = walkRoute.current[0];
      if (waypoint) {
        const dx = waypoint.x - engine.player.x, dz = waypoint.z - engine.player.z, distance = Math.hypot(dx, dz);
        const amount = Math.min(1, distance / Math.max(.001, PLAYER_SPEED * Math.min(delta, .05)));
        input = {x: dx / distance * amount, z: dz / distance * amount};
      }
    }
    const tomatoBusy = Boolean(engine.tomatoAction?.active);
    if (tomatoBusy) walkRoute.current = [];
    const proposed = engine.paused || tomatoBusy || !walking.startValid ? {...engine.player, moving: false} : stepRoomPlayer(engine.player, input, delta, latest.current);
    let next = titlePhysics?.current?.step(engine.player, proposed, delta, {paused: engine.paused || tomatoBusy || !walking.startValid}) || proposed;
    if (walking.active && canWalk(engine.player.x, engine.player.z, latest.current)) {
      next = resolveFishPush(engine.fishToy, engine.player, next, {
        playerRadius: PLAYER_RADIUS,
        paused: engine.paused || tomatoBusy || !walking.startValid,
        canWalk: (x, z) => canWalk(x, z, latest.current),
      });
    }
    let nextHeading = player.current?.rotation.y ?? Math.PI / 2;
    const turning = !engine.paused && !tomatoBusy && walking.startValid && Math.hypot(input.x, input.z) > .04;
    if (turning) {
      const target = Math.atan2(input.x, input.z);
      const difference = Math.atan2(Math.sin(target - nextHeading), Math.cos(target - nextHeading));
      nextHeading += difference * (1 - Math.exp(-17 * Math.min(delta, .05)));
    }
    if (roomVersion === 10 && !engine.paused && !editable && !tomatoBusy && walking.startValid) {
      const safe = resolveCabinetArmClearance(next, nextHeading, (x, z) => canWalk(x, z, walking.items));
      if (safe) next = safe;
      else {
        // Hold a blocked turn instead of snapping to spawn or pushing through furniture.
        nextHeading = player.current?.rotation.y ?? nextHeading;
        next = resolveCabinetArmClearance(next, nextHeading, (x, z) => canWalk(x, z, walking.items)) || {...engine.player, moving: false};
      }
    }
    if (!canWalk(next.x, next.z, walking.items)) {
      const x = canWalk(next.x, engine.player.z, walking.items) ? next.x : engine.player.x;
      const z = canWalk(x, next.z, walking.items) ? next.z : engine.player.z;
      next = {x, z, moving: Math.hypot(x - engine.player.x, z - engine.player.z) > .00001};
    }
    next.moving = Boolean(next.moving) && !engine.paused && !tomatoBusy && walking.startValid && Math.hypot(next.x - engine.player.x, next.z - engine.player.z) > .00001;
    if (walkRoute.current.length) {
      walkStalled.current = Math.hypot(next.x - engine.player.x, next.z - engine.player.z) > .001 ? 0 : walkStalled.current + Math.min(delta, .05);
      if (walkStalled.current > .8) {walkRoute.current = [];walkStalled.current = 0;}
    }
    if (next.moving && !firstMoveSent.current) {firstMoveSent.current = true;onFirstMove?.();}
    if (next.moving && welcomeActive) onWelcomeMove?.();
    engine.player.x = next.x;engine.player.z = next.z;engine.moving = next.moving;
    if (player.current) {
      player.current.position.set(next.x, PLAYER_START.y, next.z);
      if (tomatoBusy) {
        const target = engine.tomatoAction.phase === 'grab' ? engine.tomatoAction.target : camera.position.toArray();
        const angle = Math.atan2(target[0] - next.x, target[2] - next.z);
        const difference = Math.atan2(Math.sin(angle - player.current.rotation.y), Math.cos(angle - player.current.rotation.y));
        player.current.rotation.y += difference * (1 - Math.exp(-16 * delta));
      } else {
        player.current.rotation.y = nextHeading;
      }
    }
    const target = currentInspectTarget();
    if ((target?.id || '') !== (inspectTarget.current?.id || '')) {
      inspectTarget.current = target ? {id: target.id, label: target.label, kind: target.kind, actionLabel: target.actionLabel} : null;
      setHighlightId(target?.id || '');
      onInspectTarget?.(inspectTarget.current);
    }
    if (!drag.current) {
      const hovered = [...latest.current, ...toyItems].find(item => item.id === hover.current);
      document.body.style.cursor = paused ? '' : hovered ? editable ? 'grab' : 'pointer' : '';
    }
    if (welcomeActive && player.current && rootRef.current && onWelcomeAnchor) {
      player.current.getWorldPosition(welcomePoint.current);
      welcomePoint.current.y += CAPYBARA_HEIGHT * .9;
      welcomePoint.current.project(camera);
      const canvasRect = gl.domElement.getBoundingClientRect(), rootRect = rootRef.current.getBoundingClientRect();
      const anchor = {
        x: canvasRect.left - rootRect.left + (welcomePoint.current.x + 1) * canvasRect.width / 2,
        y: canvasRect.top - rootRect.top + (1 - welcomePoint.current.y) * canvasRect.height / 2,
        width: rootRect.width, height: rootRect.height, sceneScale,
      };
      const previous = lastWelcomeAnchor.current;
      if (!previous || Math.abs(anchor.sceneScale - previous.sceneScale) > .0001 || ['x', 'y', 'width', 'height'].some(key => Math.abs(anchor[key] - previous[key]) > .5)) {
        lastWelcomeAnchor.current = anchor;onWelcomeAnchor(anchor);
      }
    } else lastWelcomeAnchor.current = null;
    if (rootRef.current) {
      rootRef.current.dataset.playerX = next.x.toFixed(3);rootRef.current.dataset.playerZ = next.z.toFixed(3);
      rootRef.current.dataset.playerMoving = String(next.moving);
      rootRef.current.dataset.fishCollisionActive = String(walking.active);
      rootRef.current.dataset.fishCollisionRecoveries = String(fishCollisionRecoveries.current);
      rootRef.current.dataset.walkDestination = walkRoute.current.length ? JSON.stringify(walkRoute.current[walkRoute.current.length - 1]) : '';
      rootRef.current.dataset.walkWaypoints = String(walkRoute.current.length);
      rootRef.current.dataset.nearbyItem = target?.id || '';
      rootRef.current.dataset.inspectable = String(Boolean(target));
      rootRef.current.dataset.objectiveGlow = !editable && !paused ? objectiveId : '';
      rootRef.current.dataset.nearbyGlow = target?.id || '';
      rootRef.current.dataset.hoverGlow = !editable && !paused ? hoverId : '';
    }
  }, -1);

  const nudge = (event, id) => {
    if (paused || !editable) return;
    if (event.key.toLowerCase() === 'r') {event.preventDefault();event.stopPropagation();selectItem(id);rotateSelected();return;}
    const moves = {ArrowLeft: [0, .12], ArrowRight: [0, -.12], ArrowUp: [-.12, 0], ArrowDown: [.12, 0]};
    if (!moves[event.key]) return;
    event.preventDefault();event.stopPropagation();
    camera.getWorldDirection(direction.current);direction.current.y = 0;direction.current.normalize();right.current.crossVectors(direction.current, up).normalize();
    const item = latest.current.find(value => value.id === id), amount = event.shiftKey ? .3 : .12;
    const sign = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1;
    const vector = event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? right.current : direction.current;
    const position = safePosition(id, [item.position[0] + vector.x * amount * sign, item.position[1], item.position[2] + vector.z * amount * sign]);
    if (position) commit(id, position);
  };
  const hoverItem = (id, leavingId) => {
    if (drag.current?.editable || (paused && id) || (!id && leavingId && hover.current !== leavingId)) return;
    hover.current = id;
    setHoverId(id || '');
    const item = [...latest.current, ...toyItems].find(value => value.id === id);
    document.body.style.cursor = !paused && item ? editable ? 'grab' : 'pointer' : '';
    onHover([...ROOM_ITEMS, ...toyItems].find(item => item.id === id)?.label || '');
  };

  if (!assets) return null;
  return <>
    <mesh ref={ignoreWalkFloor} name="room-walk-floor" position={[(ROOM_BOUNDS.minX + ROOM_BOUNDS.maxX) / 2, ROOM_FLOOR_Y + .003, (ROOM_BOUNDS.minZ + ROOM_BOUNDS.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={startFloorWalk}>
      <planeGeometry args={[ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX, ROOM_BOUNDS.maxZ - ROOM_BOUNDS.minZ]}/>
      <meshBasicMaterial transparent opacity={0} colorWrite={false} depthWrite={false}/>
    </mesh>
    {placements.map(item => <MovableItem key={item.id} item={item} entry={assets.props.assets?.[item.asset]} editable={editable} objective={item.id === objectiveId && !editable && !paused} highlighted={item.id === highlightId && !editable && !paused} hovered={item.id === hoverId && !editable && !paused} reducedMotion={reducedMotion}
      register={(id, node) => {if (node) groups.current.set(id, node);else groups.current.delete(id);}}
      onStart={startDrag} onHover={hoverItem} onNudge={nudge} onFocus={id => {selectItem(id);hoverItem(id);}} onActivate={activateItem} onError={onError}/>)}
    {roomVersion === 10 && <Suspense fallback={null}><SushiPlates onReady={sushiLoaded} rootRef={rootRef}/></Suspense>}
    {roomVersion === 10 && <KitchenToys engine={engine} actionsRef={toyActions} onUse={activateItem} onHover={hoverItem}
      hoveredId={hoverId} nearbyId={highlightId} paused={paused} editable={editable} reducedMotion={reducedMotion}
      rootRef={rootRef} onReady={toysLoaded} resetToken={resetToken} onTomatoSplat={onTomatoSplat}/>}
    {/* The cleaned V10 tiles sit at .220, above the original collision floor. */}
    <FootprintTrail engine={engine} floorY={roomVersion === 10 ? .224 : ROOM_FLOOR_Y + .008} enabled={!editable} resetToken={resetToken}/>
    <group ref={player} position={[PLAYER_START.x, PLAYER_START.y, PLAYER_START.z]} rotation={[0, Math.PI / 2, 0]}>
      <Suspense fallback={null}><CapybaraActor engine={engine} height={CAPYBARA_HEIGHT}
        idleUrl={assets.character.animations?.idle} walkUrl={assets.character.animations?.walk} onReady={characterLoaded}/></Suspense>
    </group>
  </>;
}
