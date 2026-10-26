import React, {Suspense, useEffect, useMemo, useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {useGLTF} from '@react-three/drei';
import * as THREE from 'three';
import {useTaskOutline} from './TaskOutline.jsx';
import {addChalkCutlery, addComputerScreenGlow} from './KitchenPropDetails.js';

const objectiveGlow = new THREE.Color('#ffe066');

class ModelBoundary extends React.Component {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(error) { this.props.onError?.(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

function LoadedRestaurantModel({url, dimensions = [], position, rotationY, uniform, objective, highlighted, interacting, reducedMotion, required = false}) {
  const {scene} = useGLTF(url, '/draco/');
  const glowAmount = useRef(0);
  const screenAmount = useRef({value: 0}).current;
  const {object, size, materials, disposeDetails} = useMemo(() => {
    const object = new THREE.Group();
    const clone = scene.clone(true);
    const owned = new Map();
    const ownMaterial = (source, screen = false) => {
      if (!source) return source;
      const key = screen ? `${source.uuid}:screen` : source;
      if (!owned.has(key)) {
        const material = source.clone();
        if (screen) addComputerScreenGlow(material, screenAmount);
        owned.set(key, {material, emissive: material.emissive?.clone(), emissiveMap: material.emissiveMap, intensity: material.emissiveIntensity ?? 1});
      }
      return owned.get(key).material;
    };
    clone.traverse(node => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        const screen = url.endsWith('/discovery-computer-v2.glb') && /^Monitor[_ ]and[_ ]stand(?:_\d+)?$/.test(node.name);
        node.material = Array.isArray(node.material) ? node.material.map(material => ownMaterial(material, screen)) : ownMaterial(node.material, screen);
      }
    });
    const disposeDetails = url.endsWith('/discovery-bot-v3.glb') ? addChalkCutlery(clone) : () => {};
    object.add(clone);
    object.rotation.y = rotationY;
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (required && (box.isEmpty() || !Number.isFinite(size.x + size.y + size.z) || Math.max(size.x, size.y, size.z) <= 0)) {
      throw new Error(`The object model contains no visible geometry: ${url}`);
    }
    if (!box.isEmpty()) object.position.set(-center.x, -box.min.y, -center.z);
    return {object, size, materials: [...owned.values()], disposeDetails};
  }, [scene, rotationY, required, url, screenAmount]);

  useTaskOutline(object, objective, highlighted);
  useEffect(() => () => {materials.forEach(({material}) => material.dispose());disposeDetails();}, [materials, disposeDetails]);
  useEffect(() => {
    for (const {material, emissive, emissiveMap} of materials) {
      if (!emissive) continue;
      const map = highlighted || objective ? emissiveMap || material.map : emissiveMap;
      if (material.emissiveMap !== map) {
        material.emissiveMap = map;
        material.needsUpdate = true;
      }
    }
  }, [highlighted, objective, materials]);
  useFrame(({clock}, delta) => {
    screenAmount.value = THREE.MathUtils.damp(screenAmount.value, highlighted || interacting ? 1 : 0, 12, Math.min(delta, .05));
    if (screenAmount.value < .001) screenAmount.value = 0;
    const breath = reducedMotion ? .5 : .5 + Math.sin(clock.elapsedTime * 2.6) * .5;
    // Preserve the textured body shine; TaskOutline draws only the combined
    // visible silhouette, without per-mesh shells or internal normal seams.
    const target = highlighted ? .34 + breath * .14 : objective ? .22 + breath * .24 : 0;
    glowAmount.current = reducedMotion ? target : THREE.MathUtils.damp(glowAmount.current, target, 9, Math.min(delta, .05));
    if (glowAmount.current < .001) glowAmount.current = 0;
    for (const {material, emissive, intensity} of materials) {
      if (!emissive) continue;
      material.emissive.copy(emissive);
      material.emissive.r += objectiveGlow.r * glowAmount.current;
      material.emissive.g += objectiveGlow.g * glowAmount.current;
      material.emissive.b += objectiveGlow.b * glowAmount.current;
      material.emissiveIntensity = intensity + glowAmount.current * .25;
    }
  });

  const fit = (target, actual) => Number.isFinite(target) && target > 0 && actual > 1e-6 ? target / actual : null;
  const fits = [fit(dimensions[0], size.x), fit(dimensions[1], size.y), fit(dimensions[2], size.z)];
  // Fit within supplied bounds using one scalar, preserving native proportions.
  const scalar = Math.min(...fits.filter(value => value !== null), Infinity);
  const scale = uniform ? (Number.isFinite(scalar) ? scalar : 1) : fits.map(value => value ?? 1);

  return <group position={position} scale={scale}>
    <primitive object={object} dispose={null}/>
  </group>;
}

export function RestaurantModel({entry, dimensions, position = [0, 0, 0], rotationY = -Math.PI / 2, uniform = true, objective = false, highlighted = false, interacting = false, reducedMotion = false, onError}) {
  if (!entry?.url) return null;
  return <ModelBoundary key={entry.url} onError={onError}>
    <Suspense fallback={null}>
      <LoadedRestaurantModel url={entry.url} dimensions={dimensions} position={position} rotationY={rotationY} uniform={uniform} objective={objective} highlighted={highlighted} interacting={interacting} reducedMotion={reducedMotion} required={Boolean(onError)}/>
    </Suspense>
  </ModelBoundary>;
}

export default function RestaurantRoom({manifest}) {
  const assets = manifest?.assets || manifest || {};
  return <group name="tripo-restaurant-room">
    <RestaurantModel entry={assets['restaurant-floor']} dimensions={[19.6, .25, 15.6]} position={[0, -.25, 0]}/>
    <RestaurantModel entry={assets['restaurant-backdrop']} dimensions={[18.6, 3.9, 2.05]} position={[0, 0, -6.5]}/>
    {[-4.4, 0, 4.4].map(x => <RestaurantModel key={`front-stool-${x}`} entry={assets['restaurant-stool']} dimensions={[null, .95, null]} position={[x, 0, 5.7]} uniform/>)}
    {[-1, 1].map(side => <RestaurantModel key={`side-stool-${side}`} entry={assets['restaurant-stool']} dimensions={[null, .95, null]} position={[side * 7.52, 0, .78]} uniform/>)}
    {[
      [-8.45, 0, -4.3],
      [8.52, 0, 4.75],
      [-8.57, 0, 5.37],
    ].map((position, index) => <RestaurantModel key={`plant-${index}`} entry={assets['restaurant-plant']} dimensions={[null, 1.4, null]} position={position} uniform/>)}
  </group>;
}
