import React, {useEffect, useMemo, useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {useGLTF} from '@react-three/drei';
import {clone as cloneSkeleton} from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import {correctCapybaraClip} from './retarget-capybara.js';
import {createRelaxedCapybaraIdle} from './relaxed-capybara-idle.js';
import {CAPYBARA_BODY_WALK_RATE, CAPYBARA_LEG_WALK_RATE, splitCapybaraWalk} from './capybara-walk-cadence.js';
import {createCapybaraFootsteps} from './capybara-footsteps.js';
import {createCapybaraTomatoPose, tomatoBodyLift} from './capybara-tomato-pose.js';

export default function CapybaraActor({engine, height = 1.35, idleUrl = '/models/tripo/chef-idle.glb', walkUrl = '/models/tripo/chef-walk.glb', onReady}) {
  const idle = useGLTF(idleUrl, '/draco/'), walking = useGLTF(walkUrl, '/draco/');
  const readyCallback = useRef(onReady);readyCallback.current = onReady;
  const footsteps = useRef(null), body = useRef(null);
  const actor = useMemo(() => {
    const scene = cloneSkeleton(idle.scene);scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene), dimensions = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const idleSource = idle.animations[0], walkSource = walking.animations[0];
    if (!idleSource || !walkSource) throw new Error('Capybara idle and walking animations are required.');
    const correctedIdle = correctCapybaraClip(idleSource, scene, {motion: 'idle', strength: .65});
    const walkClip = correctCapybaraClip(walkSource, scene, {motion: 'walk', strength: .65});
    const walk = splitCapybaraWalk(walkClip);
    const relaxed = createRelaxedCapybaraIdle(correctedIdle, scene);
    scene.position.set(-center.x, -bounds.min.y, -center.z);
    scene.traverse(node => {if (node.isMesh) {node.castShadow = true;node.receiveShadow = true;}});
    const mixer = new THREE.AnimationMixer(scene);
    const idleAction = mixer.clipAction(relaxed.clip).setEffectiveWeight(1).play();
    const walkAction = mixer.clipAction(walk.body).setEffectiveWeight(0).setEffectiveTimeScale(CAPYBARA_BODY_WALK_RATE).play();
    const legAction = mixer.clipAction(walk.legs).setEffectiveWeight(0).setEffectiveTimeScale(CAPYBARA_LEG_WALK_RATE).play();
    const tomatoPose = createCapybaraTomatoPose(scene);
    return {scene, mixer, tomatoPose, idleAction, walkAction, legAction, relaxed, scale: height / dimensions.y, wasMoving: false, walkWeight: 0};
  }, [idle, walking, height]);

  useEffect(() => {
    readyCallback.current?.({scale: actor.scale, idle: actor.relaxed.report, scene: actor.scene});
    return () => {actor.mixer.stopAllAction();actor.mixer.uncacheRoot(actor.scene);actor.relaxed.dispose();};
  }, [actor]);

  useEffect(() => {
    if (!engine) return;
    const player = createCapybaraFootsteps({
      getRoot: () => engine.rootDOM?.current || engine.rootDOM || engine.root,
      isEnabled: () => engine.soundEnabled !== false,
    });
    footsteps.current = player;
    return () => {player.dispose();if (footsteps.current === player) footsteps.current = null;};
  }, [engine]);

  useFrame((_state, delta) => {
    actor.tomatoPose.restore();
    const moving = Boolean(engine?.moving && !engine?.paused);
    if (moving && !actor.wasMoving) {actor.walkAction.reset().play();actor.legAction.reset().play();}
    actor.wasMoving = moving;
    const dt = Math.min(delta, .05);
    actor.walkWeight = THREE.MathUtils.damp(actor.walkWeight, moving ? 1 : 0, 20, dt);
    if (Math.abs(actor.walkWeight - (moving ? 1 : 0)) < .001) actor.walkWeight = moving ? 1 : 0;
    actor.idleAction.setEffectiveWeight(1 - actor.walkWeight);
    actor.walkAction.setEffectiveWeight(actor.walkWeight).setEffectiveTimeScale(CAPYBARA_BODY_WALK_RATE);
    actor.legAction.setEffectiveWeight(actor.walkWeight).setEffectiveTimeScale(CAPYBARA_LEG_WALK_RATE);
    actor.mixer.update(engine?.paused ? 0 : dt);
    footsteps.current?.update({moving, paused: engine?.paused, soundEnabled: engine?.soundEnabled !== false, time: actor.legAction.time, duration: actor.legAction.getClip().duration});
    for (const {mesh, index} of actor.relaxed.morphs) mesh.morphTargetInfluences[index] = 1 - actor.walkWeight;
    if (body.current) body.current.position.y = tomatoBodyLift(engine?.tomatoAction);
    actor.tomatoPose.apply(engine?.tomatoAction);
    if (engine) {
      if (!engine.throwHand?.isVector3) engine.throwHand = new THREE.Vector3();
      actor.tomatoPose.handPosition(engine.throwHand);
    }
    const root = engine?.rootDOM?.current || engine?.rootDOM || engine?.root;
    if (root?.dataset) {
      root.dataset.playerClip = engine?.tomatoAction?.active && engine.tomatoAction.elapsed < 1.45 ? 'tomato-throw' : moving ? 'adjusted-walk' : 'relaxed-idle';
      root.dataset.tomatoHand = engine?.throwHand?.toArray().map(value => Number(value.toFixed(3))).join(',') || '';
      root.dataset.tomatoPoseBones = actor.tomatoPose.bones.join(',');
      root.dataset.walkWeight = actor.walkWeight.toFixed(3);
      root.dataset.walkTime = actor.walkAction.time.toFixed(3);
      root.dataset.legTime = actor.legAction.time.toFixed(3);
      root.dataset.legTimeScale = String(CAPYBARA_LEG_WALK_RATE);
    }
  });
  return <group ref={body} rotation={[0, -Math.PI / 2, 0]} scale={actor.scale}><primitive object={actor.scene} dispose={null}/></group>;
}
