import React, {useEffect, useMemo, useRef} from 'react';
import {useFrame, useLoader} from '@react-three/fiber';
import {useGLTF} from '@react-three/drei';
import {FontLoader} from 'three/examples/jsm/loaders/FontLoader.js';
import {TextGeometry} from 'three/examples/jsm/geometries/TextGeometry.js';
import * as THREE from 'three';
import {createKitchenLetterPhysics, KITCHEN_LETTER_FLOOR} from './kitchen-letter-physics.js';

const titleFont = '/fonts/kitchen/fredoka-title.typeface.json';

function TitleBoard() {
  const {scene} = useGLTF('/models/tripo/kitchen-title-board.glb');
  const object = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse(node => {if (node.isMesh) {node.castShadow = true;node.receiveShadow = true;}});
    return clone;
  }, [scene]);
  return <primitive object={object} position={[-3.5, 2.55, 0]} scale={2.6} dispose={null}/>;
}

export default function KitchenTitle({variant = 'letters', physicsRef, rootRef}) {
  const font = useLoader(FontLoader, titleFont);
  const internalPhysics = useRef(null), meshes = useRef(new Map());
  const simulation = physicsRef || internalPhysics;
  const mounted = variant === 'counter';
  const board = variant === 'board';
  const {geometry, materials, letters} = useMemo(() => {
    const options = {
      font, size: 1, depth: board ? .02 : mounted ? .085 : .19,
      bevelEnabled: true, bevelThickness: board ? .004 : .016, bevelSize: board ? .003 : .014,
      bevelSegments: 2, curveSegments: 6,
    };
    const geometry = new TextGeometry("Stefan's Kitchen", options);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox.clone(), size = bounds.getSize(new THREE.Vector3());
    const scalar = (board ? 3.35 : mounted ? 4.3 : 6.3) / size.x;
    const letters = [];
    if (!board && !mounted) {
      let cursor = 0;
      // Keep the small apostrophe attached to its preceding letter, like a
      // single toy piece, rather than letting it drop from its initial height.
      for (const character of ['S', 't', 'e', 'f', 'a', "n'", 's', ' ', 'K', 'i', 't', 'c', 'h', 'e', 'n']) {
        if (character !== ' ') {
          const glyph = new TextGeometry(character, options);
          glyph.computeBoundingBox();
          const center = glyph.boundingBox.getCenter(new THREE.Vector3());
          const half = glyph.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(scalar / 2);
          glyph.translate(-center.x, -center.y, -center.z);
          glyph.scale(scalar, scalar, scalar);glyph.computeBoundingBox();
          const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
          letters.push({
            character, geometry: glyph,
            position: [4.34 + (center.z - bounds.min.z) * scalar, KITCHEN_LETTER_FLOOR.y + .008 + (center.y - bounds.min.y) * scalar, -(cursor + center.x - (bounds.min.x + bounds.max.x) / 2) * scalar],
            halfExtents: [Math.max(.012, half.x), Math.max(.012, half.y), Math.max(.012, half.z)],
            rotation: {x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w},
          });
        }
        for (const glyph of character) cursor += (font.data.glyphs[glyph] || font.data.glyphs['?']).ha / font.data.resolution;
      }
    }
    geometry.translate(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -bounds.min.z);
    geometry.scale(scalar, scalar, scalar);
    geometry.computeBoundingBox();
    const materials = [
      new THREE.MeshStandardMaterial({color: '#fff1c0', roughness: .6}),
      new THREE.MeshStandardMaterial({color: board ? '#e8dbb4' : '#b2814a', roughness: .8}),
    ];
    return {geometry, materials, letters};
  }, [font, mounted, board]);
  useEffect(() => () => {geometry.dispose();letters.forEach(letter => letter.geometry.dispose());materials.forEach(material => material.dispose());}, [geometry, materials, letters]);

  useEffect(() => {
    if (variant !== 'letters') return;
    let cancelled = false, current = null;
    const root = rootRef?.current || rootRef;
    if (root?.dataset) root.dataset.letterPhysics = 'loading';
    createKitchenLetterPhysics(letters, {rootRef}).then(physics => {
      if (cancelled) {physics.dispose();return;}
      current = physics;simulation.current = physics;
    }).catch(error => {
      if (root?.dataset) root.dataset.letterPhysics = 'error';
      console.error('The kitchen letters could not start their physics.', error);
    });
    return () => {cancelled = true;if (simulation.current === current) simulation.current = null;current?.dispose();};
  }, [letters, rootRef, simulation, variant]);

  useFrame(() => {
    simulation.current?.letters.forEach(({body}, index) => {
      const mesh = meshes.current.get(index);
      if (!mesh) return;
      mesh.position.copy(body.translation());mesh.quaternion.copy(body.rotation());
    });
  }, -.5);

  return <>
    {board && <TitleBoard/>}
    {variant === 'letters' ? <group name="kitchen-title-letters">{letters.map((letter, index) => <mesh key={index}
      ref={mesh => {if (mesh) meshes.current.set(index, mesh);else meshes.current.delete(index);}}
      name={`kitchen-letter-${index}`} geometry={letter.geometry} material={materials}
      position={letter.position} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow dispose={null}/>)}</group> : <mesh name={`kitchen-title-${variant}`} geometry={geometry} material={materials}
      position={board ? [-3.5156, 2.43, 0] : mounted ? [.95, .72, -.25] : [4.78, .237, 0]}
      rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow dispose={null}/>}
  </>;
}
