import React, {Suspense, useEffect, useMemo, useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {useGLTF} from '@react-three/drei';
import * as THREE from 'three';

const objectiveGlow = new THREE.Color('#ffe066');

class ModelBoundary extends React.Component {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(error) { this.props.onError?.(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

function LoadedRestaurantModel({url, dimensions = [], position, rotationY, uniform, objective, highlighted, reducedMotion, required = false}) {
  const {scene} = useGLTF(url, '/draco/');
  const glowAmount = useRef(0);
  const {object, size, materials, outlines, outlineMaterial} = useMemo(() => {
    const object = new THREE.Group();
    const clone = scene.clone(true);
    const owned = new Map(), staticMeshes = [];
    const ownMaterial = source => {
      if (!source) return source;
      if (!owned.has(source)) {
        const material = source.clone();
        owned.set(source, {material, emissive: material.emissive?.clone(), emissiveMap: material.emissiveMap, intensity: material.emissiveIntensity ?? 1});
      }
      return owned.get(source).material;
    };
    clone.traverse(node => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        node.material = Array.isArray(node.material) ? node.material.map(ownMaterial) : ownMaterial(node.material);
        if (!node.isSkinnedMesh && node.geometry.attributes.normal) staticMeshes.push(node);
      }
    });
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
    const outlineMaterial = new THREE.ShaderMaterial({
      uniforms: {outlineWidth: {value: .016}, outlineColor: {value: new THREE.Color('#ffd54a')}, outlineOpacity: {value: 1}},
      vertexShader: `
        uniform float outlineWidth;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          viewPosition.xyz += normalize(normalMatrix * normal) * outlineWidth;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 outlineColor;
        uniform float outlineOpacity;
        void main() {
          gl_FragColor = vec4(outlineColor, outlineOpacity);
          #include <colorspace_fragment>
        }
      `,
      side: THREE.BackSide, depthTest: true, depthWrite: false, toneMapped: false, transparent: true,
    });
    // Collect original meshes before adding shells so traversal cannot recurse
    // into newly created outlines. Geometry remains shared with the source.
    const outlines = staticMeshes.map(mesh => {
      const shell = new THREE.Mesh(mesh.geometry, outlineMaterial);
      shell.name = 'inspection-outline';shell.visible = false;
      shell.castShadow = false;shell.receiveShadow = false;shell.frustumCulled = false;
      shell.renderOrder = 1;
      mesh.add(shell);
      return shell;
    });
    return {object, size, materials: [...owned.values()], outlines, outlineMaterial};
  }, [scene, rotationY, required, url]);

  useEffect(() => () => {materials.forEach(({material}) => material.dispose());outlineMaterial.dispose();}, [materials, outlineMaterial]);
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
    const breath = reducedMotion ? .5 : .5 + Math.sin(clock.elapsedTime * 2.6) * .5;
    // A marked task softly breathes from across the room; a nearby E target
    // keeps its stronger, crisp outline so readiness remains easy to see.
    for (const outline of outlines) outline.visible = highlighted || objective;
    outlineMaterial.uniforms.outlineWidth.value = highlighted ? .016 : .026 + breath * .012;
    outlineMaterial.uniforms.outlineOpacity.value = highlighted ? 1 : .12 + breath * .16;
    const target = highlighted ? .24 + breath * .12 : objective ? .11 + breath * .14 : 0;
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

export function RestaurantModel({entry, dimensions, position = [0, 0, 0], rotationY = -Math.PI / 2, uniform = true, objective = false, highlighted = false, reducedMotion = false, onError}) {
  if (!entry?.url) return null;
  return <ModelBoundary key={entry.url} onError={onError}>
    <Suspense fallback={null}>
      <LoadedRestaurantModel url={entry.url} dimensions={dimensions} position={position} rotationY={rotationY} uniform={uniform} objective={objective} highlighted={highlighted} reducedMotion={reducedMotion} required={Boolean(onError)}/>
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
