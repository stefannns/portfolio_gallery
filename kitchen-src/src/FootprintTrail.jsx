import React, {useEffect, useMemo, useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {MeshBasicMaterial, Shape, ShapeGeometry} from 'three';
import {useTaskOutlineIgnore} from './TaskOutline.jsx';

const LIFETIME = 1;
const SPACING = .5;
const OPACITY = .34;
const POOL_SIZE = 12;
const noRaycast = () => {};

function footprintGeometry() {
  const oval = (x, y, rx, ry) => {
    const shape = new Shape();
    shape.absellipse(x, y, rx, ry, 0, Math.PI * 2, false, 0);
    return shape;
  };
  // One soft sole and three little toes, rather than a heavy outline.
  return new ShapeGeometry([
    oval(0, -.02, .039, .06),
    oval(-.037, .045, .015, .019),
    oval(0, .061, .016, .02),
    oval(.037, .045, .015, .019),
  ], 8).scale(1.25, 1.25, 1);
}

/** Short-lived, non-interactive marks; independent of walking physics/audio. */
export default function FootprintTrail({engine, floorY, enabled = true, resetToken}) {
  const ignoreOutline = useTaskOutlineIgnore();
  const geometry = useMemo(footprintGeometry, []);
  const prints = useMemo(() => Array.from({length: POOL_SIZE}, () => ({
    node: null, born: -Infinity,
    material: new MeshBasicMaterial({color: '#876b50', transparent: true, opacity: 0,
      depthTest: true, depthWrite: false, toneMapped: false, polygonOffset: true,
      polygonOffsetFactor: -1, polygonOffsetUnits: -1}),
  })), []);
  const track = useRef({ready: false, x: 0, z: 0, carry: SPACING, side: -1, cursor: 0, emitted: 0});

  useEffect(() => {
    track.current.ready = false;track.current.carry = SPACING;
    for (const print of prints) {print.born = -Infinity;if (print.node) print.node.visible = false;}
  }, [prints, resetToken]);
  useEffect(() => () => {geometry.dispose();prints.forEach(print => print.material.dispose());}, [geometry, prints]);

  useFrame(({clock}) => {
    const now = clock.elapsedTime;
    let active = 0;
    for (const print of prints) {
      if (!print.node) continue;
      const age = now - print.born;
      print.node.visible = age >= 0 && age < LIFETIME;
      if (print.node.visible) {
        const fade = Math.max(0, (age - .08) / (LIFETIME - .08));
        print.material.opacity = OPACITY * (1 - fade) ** 1.4;
        active++;
      }
    }

    const sample = track.current, position = engine?.player;
    const walking = enabled && !engine?.paused && engine?.moving && Number.isFinite(position?.x) && Number.isFinite(position?.z);
    if (!walking) {
      sample.ready = false;sample.carry = SPACING;
    } else if (!sample.ready) {
      sample.x = position.x;sample.z = position.z;sample.ready = true;
    } else {
      const dx = position.x - sample.x, dz = position.z - sample.z;
      const distance = Math.hypot(dx, dz);
      if (distance > .8) sample.carry = SPACING; // Never draw a trail across a reset/teleport.
      else if (distance > .0001) {
        const ux = dx / distance, uz = dz / distance;
        for (let along = SPACING - sample.carry; along <= distance; along += SPACING) {
          const print = prints[sample.cursor++ % prints.length];
          if (!print.node) continue;
          const side = sample.side * .12;
          print.node.position.set(sample.x + ux * (along - .08) + uz * side,
            floorY, sample.z + uz * (along - .08) - ux * side);
          // The XY sole's toes point toward -Z after the floor rotation.
          print.node.rotation.y = Math.atan2(ux, uz) + Math.PI;
          print.born = now;print.material.opacity = OPACITY;print.node.visible = true;
          sample.side *= -1;sample.emitted++;active++;
        }
        sample.carry = (sample.carry + distance) % SPACING;
      }
      sample.x = position.x;sample.z = position.z;
    }

    const root = engine?.rootDOM?.current || engine?.rootDOM;
    if (root?.dataset) {
      root.dataset.footprintsActive = String(active);
      root.dataset.footprintsEmitted = String(sample.emitted);
    }
  }, -.5);

  return <group ref={ignoreOutline} name="capybara-footprint-trail" dispose={null}>
    {prints.map((print, index) => <group key={index} visible={false} ref={node => {print.node = node;}}>
      <mesh geometry={geometry} material={print.material} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}/>
    </group>)}
  </group>;
}
