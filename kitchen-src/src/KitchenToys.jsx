import React, {Suspense, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useThree} from '@react-three/fiber';
import {Html} from '@react-three/drei';
import {Group} from 'three';
import SinkBubbles from './SinkBubbles.jsx';
import FaucetWater from './FaucetWater.jsx';
import StovePanToy from './StovePanToy.jsx';
import TomatoToy from './TomatoToy.jsx';
import FishFlopToy from './FishFlopToy.jsx';
import {useTaskOutline, useTaskOutlineIgnore} from './TaskOutline.jsx';
import {KITCHEN_TOYS, isNearRoomTarget} from './kitchen-toy-state.js';
import {createKitchenToyAudio} from './kitchen-toy-audio.js';

function FixtureTarget({toy, available, hovered, highlighted, onHover, onUse, enabled}) {
  const ignoreHitbox = useTaskOutlineIgnore();
  const {scene} = useThree();
  const fixture = useMemo(() => {
    const room = scene.getObjectByName('furnished-room-review');
    const name = toy.id === 'sink-bubbles' ? 'Mesh_0_1' : toy.id === 'stove-pan' ? 'Mesh_0_4' : null;
    const mesh = name ? room?.getObjectByName(name) : null;
    if (mesh) return mesh;
    const empty = new Group();empty.visible = false;return empty;
  }, [scene, toy.id]);
  useTaskOutline(fixture, false, enabled && (highlighted || hovered));
  if (!enabled) return null;

  return <group position={toy.position}
    onPointerOver={event => {event.stopPropagation();if (event.pointerType !== 'touch') onHover(toy.id);}}
    onPointerOut={() => onHover(null, toy.id)}>
    <mesh ref={ignoreHitbox} position={toy.hitOffset || [0, 0, 0]}
      onPointerDown={event => {event.stopPropagation();event.nativeEvent?.preventDefault();}}
      onClick={event => {event.stopPropagation();if ((event.delta ?? 0) <= 6) onUse(toy.id);}}>
      <boxGeometry args={toy.hitSize}/>
      <meshBasicMaterial transparent opacity={0} colorWrite={false} depthWrite={false}/>
    </mesh>
    <Html center position={[0, .45, 0]} style={{pointerEvents: 'none'}} zIndexRange={[12, 1]}>
      <button type="button" className="room-item-keyboard" aria-label={toy.actionLabel} aria-disabled={!available}
        onFocus={() => onHover(toy.id)} onBlur={() => onHover(null, toy.id)} onClick={() => onUse(toy.id)}>
        {toy.label}<span>{available ? `${toy.actionLabel} · E or click` : 'Move closer to use'}</span>
      </button>
    </Html>
  </group>;
}

export default function KitchenToys({engine, actionsRef, onUse, onHover, hoveredId, nearbyId, paused, editable, reducedMotion, rootRef, onReady, resetToken, onTomatoSplat}) {
  const sink = useRef(null), stove = useRef(null), tomatoes = useRef(null), fish = useRef(null), sounds = useRef(null);
  const loaded = useRef({pan: false, tomatoes: false, fish: false});
  const [fishAvailable, setFishAvailable] = useState(() => !engine.fishToy?.used);
  const fishAvailabilityChanged = useCallback(available => {
    setFishAvailable(available);
    if (!available) onHover(null, 'fish-flop');
  }, [onHover]);
  const [tomatoesRemaining, setTomatoesRemaining] = useState(4);
  const tomatoStockChanged = useCallback(remaining => {
    setTomatoesRemaining(remaining);
    if (remaining === 0) onHover(null, 'tomato-throw');
  }, [onHover]);
  const soundState = useRef({paused, editable});soundState.current = {paused, editable};
  const bubblePopped = useCallback(() => sounds.current?.playBubblePop(), []);
  const panLanded = useCallback(() => sounds.current?.playPanLand(), []);
  useEffect(() => {
    const audio = createKitchenToyAudio({
      getRoot: () => rootRef?.current || engine.rootDOM?.current,
      isEnabled: () => engine.soundEnabled !== false && !engine.paused && !soundState.current.paused && !soundState.current.editable,
    });
    sounds.current = audio;
    return () => {audio.dispose();if (sounds.current === audio) sounds.current = null;};
  }, [engine, rootRef]);
  useEffect(() => {if (paused || editable) sounds.current?.stop();}, [paused, editable]);
  const markReady = useCallback(key => {loaded.current[key] = true;if (Object.values(loaded.current).every(Boolean)) onReady?.();}, [onReady]);
  const panReady = useCallback(() => markReady('pan'), [markReady]);
  const tomatoesReady = useCallback(() => markReady('tomatoes'), [markReady]);
  const fishReady = useCallback(() => markReady('fish'), [markReady]);
  const fishFlopped = useCallback(() => sounds.current?.playFishFlop(), []);
  const fishLanded = useCallback(() => sounds.current?.playFishLand(), []);
  const tomatoReleased = useCallback(() => sounds.current?.playTomatoThrow(), []);
  const tomatoSplat = useCallback(event => {sounds.current?.playTomatoSplat();onTomatoSplat?.(event);}, [onTomatoSplat]);
  useEffect(() => {
    const api = {trigger(id) {
      if (id === 'tomato-throw') return tomatoes.current?.burst() || false;
      if (id === 'fish-flop') return fish.current?.burst() || false;
      if (id === 'sink-bubbles') {
        const fired = sink.current?.burst() || false;
        if (fired) sounds.current?.playSink();
        return fired;
      }
      if (id === 'stove-pan') {
        const fired = stove.current?.burst() || false;
        if (fired) sounds.current?.playStove();
        return fired;
      }
      return false;
    }};
    actionsRef.current = api;
    return () => {if (actionsRef.current === api) actionsRef.current = null;};
  }, [actionsRef]);
  useEffect(() => {sink.current?.reset();stove.current?.reset();tomatoes.current?.reset();fish.current?.reset();sounds.current?.stop();}, [resetToken]);

  return <>
    {KITCHEN_TOYS.map(toy => <FixtureTarget key={toy.id} toy={toy} available={isNearRoomTarget(engine.player, toy)}
      enabled={!paused && !editable && (toy.id !== 'tomato-throw' || tomatoesRemaining > 0) && (toy.id !== 'fish-flop' || fishAvailable)} hovered={hoveredId === toy.id} highlighted={nearbyId === toy.id}
      onUse={onUse} onHover={onHover}/>)}
    <Suspense fallback={null}><TomatoToy engine={engine} actionRef={tomatoes} position={KITCHEN_TOYS.find(toy => toy.id === 'tomato-throw').position}
      paused={paused || editable} reducedMotion={reducedMotion} rootRef={rootRef} onReady={tomatoesReady}
      highlighted={tomatoesRemaining > 0 && !paused && !editable && (hoveredId === 'tomato-throw' || nearbyId === 'tomato-throw')}
      onRelease={tomatoReleased} onSplat={tomatoSplat} onRemainingChange={tomatoStockChanged}/></Suspense>
    <Suspense fallback={null}><FishFlopToy engine={engine} actionRef={fish} paused={paused || editable} reducedMotion={reducedMotion}
      highlighted={fishAvailable && !paused && !editable && (hoveredId === 'fish-flop' || nearbyId === 'fish-flop')}
      rootRef={rootRef} onReady={fishReady} onAvailableChange={fishAvailabilityChanged} onFlop={fishFlopped} onLand={fishLanded}/></Suspense>
    <FaucetWater paused={paused || editable} reducedMotion={reducedMotion}/>
    <SinkBubbles actionRef={sink} position={[-3.96, 1.3, 2.778]} paused={paused || editable}
      reducedMotion={reducedMotion} rootRef={rootRef} onPop={bubblePopped}/>
    <Suspense fallback={null}><StovePanToy actionRef={stove} paused={paused || editable}
      reducedMotion={reducedMotion} highlighted={!paused && !editable && (hoveredId === 'stove-pan' || nearbyId === 'stove-pan')}
      rootRef={rootRef} onReady={panReady} onLand={panLanded}/></Suspense>
  </>;
}
