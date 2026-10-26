import React, {useEffect, useMemo, useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {useGLTF} from '@react-three/drei';
import {Box3, Group, Vector3} from 'three';
import {useTaskOutline, useTaskOutlineIgnore} from './TaskOutline.jsx';
import {TOMATO_TIMING, tomatoThrowPose, smoothTomatoStep, createTomatoInventory} from './tomato-throw-state.js';

const TOMATO_URL = '/models/tripo/kitchen-tomato-v1.glb';
const DEFAULT_POSITION = Object.freeze([.1, 1.13, -1.1]);
const TOMATO_WIDTH = .28;
const noRaycast = () => {};
const allFinite = value => value && [value.x, value.y, value.z].every(Number.isFinite);

function cloneTomato(source, bounds, width, fading = false) {
  const object = new Group(), clone = source.clone(true), materials = [];
  const center = bounds.getCenter(new Vector3()), size = bounds.getSize(new Vector3());
  clone.position.sub(center);
  object.scale.setScalar(width / Math.max(.0001, size.x));
  clone.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true;node.receiveShadow = true;node.raycast = noRaycast;
    const own = material => {
      const result = material.clone();
      if (fading) result.transparent = true;
      materials.push(result);return result;
    };
    node.material = Array.isArray(node.material) ? node.material.map(own) : own(node.material);
  });
  object.add(clone);
  return {object, materials, height: size.y * width / Math.max(.0001, size.x)};
}

/** Four real model instances and one hand-following/camera-bound projectile. */
export default function TomatoToy({engine, actionRef, position = DEFAULT_POSITION, width = TOMATO_WIDTH,
  paused = false, reducedMotion = false, highlighted = false, rootRef, onReady, onRelease, onSplat, onRemainingChange}) {
  const {scene} = useGLTF(TOMATO_URL, '/draco/');
  const projectile = useRef();
  const inventory = useRef(null);
  if (!inventory.current) inventory.current = createTomatoInventory(engine?.tomatoRemaining ?? 4);
  const ignoreProjectile = useTaskOutlineIgnore();
  const state = useRef({elapsed: TOMATO_TIMING.end, throws: 0, released: true, impacted: true,
    inventory: inventory.current, lastRemaining: null,
    action: {...tomatoThrowPose(TOMATO_TIMING.end), target: [...position]},
    pickupStart: new Vector3(), releaseStart: new Vector3(), hand: new Vector3(),
    end: new Vector3(), direction: new Vector3(), right: new Vector3(), point: new Vector3(),
    paused, reducedMotion, rootRef, engine, onReady, onRelease, onSplat, onRemainingChange, position});
  Object.assign(state.current, {paused, reducedMotion, rootRef, engine, onReady, onRelease, onSplat, onRemainingChange, position});

  const models = useMemo(() => {
    scene.updateWorldMatrix(true, true);
    const bounds = new Box3().setFromObject(scene);
    const pile = new Group();pile.name = 'tomato-pile-model';
    const tomatoes = Array.from({length: 4}, () => cloneTomato(scene, bounds, width));
    const height = tomatoes[0].height;
    const locations = [[-width * .52, height / 2, -width * .3], [width * .52, height / 2, -width * .3],
      [0, height / 2, width * .57], [0, height * 1.24, 0]];
    tomatoes.forEach((tomato, index) => {
      tomato.object.position.fromArray(locations[index]);
      tomato.object.rotation.y = [-.35, .4, 1.1, .75][index];
      if (index === 3) {tomato.object.rotation.x = .08;tomato.object.rotation.z = .05;}
      tomato.object.visible = inventory.current.has(index);
      pile.add(tomato.object);
    });
    const flying = cloneTomato(scene, bounds, width, true);
    flying.object.name = 'tomato-projectile-model';
    return {pile, tomatoes, flying,
      materials: [...tomatoes.flatMap(tomato => tomato.materials), ...flying.materials]};
  }, [scene, width]);
  useTaskOutline(models.pile, false, highlighted);

  const api = useMemo(() => {
    function publish() {
      const current = state.current, root = current.rootRef?.current || current.rootRef;
      const remaining = current.inventory.remaining;
      if (current.engine) current.engine.tomatoRemaining = remaining;
      if (current.lastRemaining !== remaining) {
        current.lastRemaining = remaining;current.onRemainingChange?.(remaining);
      }
      if (!root?.dataset) return;
      root.dataset.tomatoThrows = String(current.throws);
      root.dataset.tomatoRemaining = String(remaining);
      root.dataset.tomatoPhase = current.action.phase;
      root.dataset.tomatoActive = String(current.action.active);
    }
    function reset() {
      const current = state.current;
      current.elapsed = TOMATO_TIMING.end;current.released = true;current.impacted = true;
      current.inventory.finish();
      Object.assign(current.action, tomatoThrowPose(TOMATO_TIMING.end));
      if (projectile.current) projectile.current.visible = false;
      models.tomatoes.forEach((tomato, index) => {tomato.object.visible = current.inventory.has(index);});
      models.flying.materials.forEach(material => {material.opacity = 1;});
      publish();
    }
    return {
      burst() {
        const current = state.current;
        const blocked = current.paused || current.engine?.paused || (typeof document !== 'undefined' && document.hidden)
          || current.action.active || !projectile.current;
        const index = current.inventory.start({blocked});
        if (index === null) return false;
        const picked = models.tomatoes[index];
        current.elapsed = 0;current.throws++;current.released = false;current.impacted = false;
        Object.assign(current.action, tomatoThrowPose(0), {target: [...current.position]});
        if (current.engine) current.engine.tomatoAction = current.action;
        models.pile.updateWorldMatrix(true, true);
        picked.object.getWorldPosition(current.pickupStart);
        projectile.current.position.copy(current.pickupStart);projectile.current.visible = true;
        picked.object.visible = false;
        models.flying.materials.forEach(material => {material.opacity = 1;});
        publish();return true;
      }, reset, publish,
    };
  }, [models]);

  useEffect(() => {
    if (engine) engine.tomatoAction = state.current.action;
    if (actionRef) actionRef.current = api;
    api.publish();state.current.onReady?.();
    return () => {
      api.reset();
      if (actionRef?.current === api) actionRef.current = null;
      if (engine?.tomatoAction === state.current.action) engine.tomatoAction = undefined;
    };
  }, [actionRef, api, engine]);
  useEffect(() => () => {models.materials.forEach(material => material.dispose());}, [models]);

  useFrame(({camera}, delta) => {
    const current = state.current;
    const blocked = current.paused || current.engine?.paused || (typeof document !== 'undefined' && document.hidden);
    if (!blocked && current.action.active) current.elapsed = Math.min(TOMATO_TIMING.end, current.elapsed + Math.min(Math.max(delta, 0), .05));
    Object.assign(current.action, tomatoThrowPose(current.elapsed));
    const motion = current.action;
    if (!motion.active) current.inventory.finish();
    const actor = current.engine?.player || {x: 0, z: 0};
    const hand = current.engine?.throwHand;
    if (Array.isArray(hand) && hand.length >= 3) current.hand.fromArray(hand);
    else if (allFinite(hand)) current.hand.copy(hand);
    else current.hand.set(NaN, NaN, NaN);
    if (!allFinite(current.hand) || current.hand.y < .3 || Math.hypot(current.hand.x - actor.x, current.hand.z - actor.z) > 2.5) {
      current.right.set(1, 0, 0).applyQuaternion(camera.quaternion);current.right.y = 0;current.right.normalize();
      current.hand.set(actor.x + current.right.x * .27, (actor.y || .22) + .88, actor.z + current.right.z * .27);
    }

    if (motion.active && !current.released && current.elapsed >= TOMATO_TIMING.release) {
      current.released = true;current.releaseStart.copy(current.hand);current.onRelease?.();
    }
    if (motion.active && !current.impacted && current.elapsed >= TOMATO_TIMING.impact) {
      current.impacted = true;current.onSplat?.({reducedMotion: current.reducedMotion, throwIndex: current.throws});
    }

    if (projectile.current) {
      projectile.current.visible = motion.active && current.elapsed < TOMATO_TIMING.impact;
      if (projectile.current.visible) {
        if (motion.phase === 'grab') {
          const t = smoothTomatoStep(motion.grabProgress);
          current.point.lerpVectors(current.pickupStart, current.hand, t);
          current.point.y += Math.sin(Math.PI * t) * (current.reducedMotion ? .08 : .18);
          projectile.current.position.copy(current.point);
        } else if (motion.phase === 'windup') projectile.current.position.copy(current.hand);
        else {
          const t = 1 - (1 - motion.throwProgress) ** 2;
          camera.getWorldDirection(current.direction);
          current.end.copy(camera.position).addScaledVector(current.direction, .48);
          if (current.reducedMotion) {
            current.direction.subVectors(current.end, current.releaseStart).normalize();
            current.end.copy(current.releaseStart).addScaledVector(current.direction, .75);
          }
          current.point.lerpVectors(current.releaseStart, current.end, t);
          current.point.y += Math.sin(Math.PI * t) * (current.reducedMotion ? .08 : .65);
          projectile.current.position.copy(current.point);
          const opacity = current.reducedMotion ? Math.max(0, 1 - motion.throwProgress * 1.7) : 1;
          models.flying.materials.forEach(material => {material.opacity = opacity;});
        }
        const spin = motion.phase === 'throw' && !current.reducedMotion ? motion.throwProgress : 0;
        projectile.current.rotation.set(spin * Math.PI * 1.8, .75 + spin * Math.PI * 2.4, spin * .7);
      }
    }

    // Every consumed model stays hidden, even after a pause or animation reset.
    models.tomatoes.forEach((tomato, index) => {tomato.object.visible = current.inventory.has(index);});
    api.publish();
  }, -.1);

  return <>
    <primitive object={models.pile} position={position} dispose={null}/>
    <group ref={ignoreProjectile}>
      <group ref={projectile} name="thrown-tomato" visible={false}>
        <primitive object={models.flying.object} dispose={null}/>
      </group>
    </group>
  </>;
}
