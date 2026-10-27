import React, {useEffect, useMemo, useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {useGLTF} from '@react-three/drei';
import {createFishModel, updateFishModel} from './fish-model-animation.js';
import {useTaskOutline} from './TaskOutline.jsx';
import {FISH_DURATION, FISH_FLOP_CONTACTS, FISH_LAND_TIME, advanceFishFlop, createFishFlopState, fishFlopPose, startFishFlop} from './fish-flop-state.js';

const FISH_URL = '/models/tripo/kitchen-fish-v1.glb';

/** One generated fish, with a soft body bend and a bounded escape animation. */
export default function FishFlopToy({engine, actionRef, paused = false, reducedMotion = false, highlighted = false,
  rootRef, onReady, onAvailableChange, onFlop, onLand}) {
  const {scene} = useGLTF(FISH_URL, '/draco/');
  const state = useRef(null);
  if (!state.current) state.current = engine.fishToy || createFishFlopState();
  const latest = useRef({});
  latest.current = {paused, reducedMotion, engine, rootRef, onAvailableChange, onFlop, onLand};
  const previous = useRef({elapsed: -1, dirty: true, available: null});
  const models = useMemo(() => createFishModel(scene), [scene]);
  useTaskOutline(models.object, false, highlighted && !state.current.used);

  const api = useMemo(() => {
    function publish() {
      const current = state.current, props = latest.current;
      props.engine.fishToy = current;
      const available = !current.used;
      if (previous.current.available !== available) {
        previous.current.available = available;props.onAvailableChange?.(available);
      }
      const root = props.rootRef?.current || props.rootRef;
      if (!root?.dataset) return;
      root.dataset.fishPhase = fishFlopPose(current.elapsed, props.reducedMotion).phase;
      root.dataset.fishActive = String(current.used && current.elapsed < FISH_DURATION);
      root.dataset.fishAvailable = String(available);root.dataset.fishUses = String(current.uses);
      root.dataset.fishPosition = JSON.stringify(models.object.position.toArray().map(value => +value.toFixed(4)));
    }
    return {
      burst() {
        const props = latest.current;
        const blocked = props.paused || props.engine.paused || (typeof document !== 'undefined' && document.hidden);
        if (!startFishFlop(state.current, {blocked})) return false;
        previous.current.elapsed = -1;previous.current.dirty = true;publish();return true;
      },
      reset() {if (state.current.used) state.current.elapsed = FISH_DURATION;previous.current.dirty = true;publish();},
      publish,
    };
  }, [models]);
  useEffect(() => {
    engine.fishToy = state.current;
    if (actionRef) actionRef.current = api;
    api.publish();onReady?.();
    return () => {if (actionRef?.current === api) actionRef.current = null;};
  }, [actionRef, api, engine, onReady]);
  useEffect(() => () => {models.meshes.forEach(({geometry}) => geometry.dispose());models.materials.forEach(material => material.dispose());}, [models]);

  useFrame((_frame, delta) => {
    const props = latest.current, current = state.current;
    const blocked = props.paused || props.engine.paused || (typeof document !== 'undefined' && document.hidden);
    const before = current.elapsed;
    advanceFishFlop(current, delta, blocked);
    const motion = fishFlopPose(current.elapsed, props.reducedMotion);
    if (!blocked && current.used) {
      for (const contact of FISH_FLOP_CONTACTS) {
        if (before < contact && current.elapsed >= contact) props.onFlop?.();
      }
      if (before < FISH_LAND_TIME && current.elapsed >= FISH_LAND_TIME) props.onLand?.();
    }
    if (previous.current.dirty || previous.current.elapsed !== current.elapsed) {
      updateFishModel(models, motion, current.elapsed);
      previous.current.elapsed = current.elapsed;previous.current.dirty = false;api.publish();
    }
  }, -.15);

  return <primitive object={models.object} dispose={null}/>;
}
