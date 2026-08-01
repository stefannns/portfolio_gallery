/* eslint-disable react/no-unknown-property */
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, extend, useFrame } from '@react-three/fiber';
import { useGLTF, useTexture, Environment, Lightformer } from '@react-three/drei';
import { BallCollider, CuboidCollider, Physics, RigidBody, useRopeJoint, useSphericalJoint } from '@react-three/rapier';
import { MeshLineGeometry, MeshLineMaterial } from 'meshline';

// replace with your own imports, see the usage snippet for details
import cardGLB from './card.glb';
import lanyard from './lanyard.png';

import * as THREE from 'three';
import './Lanyard.css';

extend({ MeshLineGeometry, MeshLineMaterial });

/* ---------------------------------------------------------------------------------------
   LOCAL PATCH (only edit in this file). Upstream copy kept alongside as Lanyard.upstream.jsx
   -- diff against it before pulling a newer version.

   Adds two optional callbacks so the page can react to the badge without forking the
   simulation: onCardFrame(cardBody, state, delta, hovered, dragged) fires once per frame,
   and onFirstDrag() fires on the first grab.

   The band is also drawn as a real ribbon instead of upstream's meshline. meshline offsets
   its vertices in CLIP space, so the strap is a camera-facing billboard that cannot roll --
   and the strap's lower joint is attached at the card's local (0, 1.5, 0), which lies exactly
   on the hover yaw axis. Between the two, turning the card moved the strap not at all. The
   ribbon here carries a twist that matches the card's own facing at the clip and eases back
   to camera-facing further up. Its width reproduces meshline's exactly (see makeRibbon), so
   nothing about the resting look changes.
   --------------------------------------------------------------------------------------- */


// 1x1 transparent pixel — lets useTexture be called unconditionally when a
// front/back image isn't supplied.
const BLANK_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// The card model's front face is UV-mapped to the LEFT half of the texture
// atlas and the back face to the RIGHT half (measured from card.glb). Each
// custom image is composited into its own half so the two faces render
// independently, aspect-preserving (no stretching).
const FRONT_UV_RECT = { x: 0, y: 0, w: 0.5, h: 0.755 };
const BACK_UV_RECT = { x: 0.5, y: 0, w: 0.5, h: 0.757 };

/* ---- local patch: the band ribbon ---------------------------------------------------- */

// How far up the strap the card's twist reaches, and how sharply it lets go. The whole twist
// lives in the lower part of the band: a lanyard is stiff enough to carry the clip's angle a
// little way but the top hangs however it hangs.
const TWIST_SPAN = 0.55;
const TWIST_FALLOFF = 2;

// Two vertices per sample, a quad per segment. Allocated once and rewritten in place.
function makeRibbon(seg) {
  const count = seg + 1;
  const geometry = new THREE.BufferGeometry();
  const position = new Float32Array(count * 2 * 3);
  const uv = new Float32Array(count * 2 * 2);
  const index = [];
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  for (let i = 0; i < count; i++) {
    // u runs -4 over the length and v across the width, which is what upstream's
    // repeat={[-4, 1]} did to meshline's own UVs -- baked in here instead of a uniform.
    const u = (i / seg) * -4;
    uv[i * 4] = u;
    uv[i * 4 + 1] = 0;
    uv[i * 4 + 2] = u;
    uv[i * 4 + 3] = 1;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return { geometry, position, seg };
}

// meshline's world width, reproduced. With sizeAttenuation on it adds 0.5 * lineWidth to the
// vertex in CLIP space, and clip x of 1 is d * tan(fov/2) * canvasAspect of world at any
// depth d -- the distance cancels, leaving a width that depends on the canvas aspect. Keeping
// the quirk is deliberate: the strap width was tuned by eye against it.
function ribbonHalfWidth(lineWidth, camera, size) {
  return 0.5 * lineWidth * Math.tan(((camera.fov * Math.PI) / 180) / 2) * (size.width / size.height);
}

export default function Lanyard({
  position = [0, 0, 30],
  gravity = [0, -40, 0],
  fov = 20,
  transparent = true,
  frontImage = null,
  backImage = null,
  imageFit = 'cover',
  lanyardImage = null,
  lanyardWidth = 1,
  onCardFrame = null,   // local patch
  onFirstDrag = null,   // local patch
  anchorY = 4,          // local patch
  ropeSeg = 1           // local patch
}) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="lanyard-wrapper">
      <Canvas
        camera={{ position: position, fov: fov }}
        dpr={[1, isMobile ? 1.5 : 2]}
        gl={{ alpha: transparent }}
        onCreated={({ gl }) => gl.setClearColor(new THREE.Color(0x000000), transparent ? 0 : 1)}
      >
        <ambientLight intensity={Math.PI} />
        <Physics gravity={gravity} timeStep={isMobile ? 1 / 30 : 1 / 60}>
          <Band
            isMobile={isMobile}
            frontImage={frontImage}
            backImage={backImage}
            imageFit={imageFit}
            lanyardImage={lanyardImage}
            lanyardWidth={lanyardWidth}
            onCardFrame={onCardFrame}
            onFirstDrag={onFirstDrag}
            anchorY={anchorY}
            ropeSeg={ropeSeg}
          />
        </Physics>
        <Environment blur={0.75}>
          <Lightformer
            intensity={2}
            color="white"
            position={[0, -1, 5]}
            rotation={[0, 0, Math.PI / 3]}
            scale={[100, 0.1, 1]}
          />
          <Lightformer
            intensity={3}
            color="white"
            position={[-1, -1, 1]}
            rotation={[0, 0, Math.PI / 3]}
            scale={[100, 0.1, 1]}
          />
          <Lightformer
            intensity={3}
            color="white"
            position={[1, 1, 1]}
            rotation={[0, 0, Math.PI / 3]}
            scale={[100, 0.1, 1]}
          />
          <Lightformer
            intensity={10}
            color="white"
            position={[-10, 0, 14]}
            rotation={[0, Math.PI / 2, Math.PI / 3]}
            scale={[100, 10, 1]}
          />
        </Environment>
      </Canvas>
    </div>
  );
}
function Band({
  maxSpeed = 50,
  minSpeed = 0,
  isMobile = false,
  frontImage = null,
  backImage = null,
  imageFit = 'cover',
  lanyardImage = null,
  lanyardWidth = 1,
  onCardFrame = null,   // local patch
  onFirstDrag = null,   // local patch
  anchorY = 4,          // local patch
  ropeSeg = 1           // local patch
}) {
  const band = useRef(),
    fixed = useRef(),
    j1 = useRef(),
    j2 = useRef(),
    j3 = useRef(),
    card = useRef();
  const vec = new THREE.Vector3(),
    ang = new THREE.Vector3(),
    rot = new THREE.Vector3(),
    dir = new THREE.Vector3();
  const segmentProps = { type: 'dynamic', canSleep: true, colliders: false, angularDamping: 4, linearDamping: 4 };
  const { nodes, materials } = useGLTF(cardGLB);
  const texture = useTexture(lanyardImage || lanyard);
  // useTexture must be called unconditionally; use a blank pixel when an image
  // isn't supplied for a given face, then skip compositing it below.
  const frontTex = useTexture(frontImage || BLANK_PIXEL);
  const backTex = useTexture(backImage || BLANK_PIXEL);

  // Composite the front/back images into the card's texture atlas (front = left
  // half, back = right half). Each image is drawn aspect-preserving (no stretch).
  const cardMap = useMemo(() => {
    const baseMap = materials.base.map;
    if (!frontImage && !backImage) return baseMap;

    const baseImg = baseMap.image;
    const W = baseImg.width;
    const H = baseImg.height;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return baseMap;
    // Keep the original baked atlas for the card edges and any untouched face.
    ctx.drawImage(baseImg, 0, 0, W, H);

    const drawFitted = (img, rect) => {
      const rx = rect.x * W;
      const ry = rect.y * H;
      const rw = rect.w * W;
      const rh = rect.h * H;
      const pick = imageFit === 'contain' ? Math.min : Math.max;
      const scale = pick(rw / img.width, rh / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = rx + (rw - dw) / 2;
      const dy = ry + (rh - dh) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    };

    if (frontImage && frontTex.image) drawFitted(frontTex.image, FRONT_UV_RECT);
    if (backImage && backTex.image) drawFitted(backTex.image, BACK_UV_RECT);

    const composite = new THREE.CanvasTexture(canvas);
    composite.colorSpace = THREE.SRGBColorSpace;
    composite.flipY = baseMap.flipY;
    composite.anisotropy = 16;
    composite.needsUpdate = true;
    return composite;
  }, [frontImage, backImage, imageFit, frontTex, backTex, materials.base.map]);
  const [curve] = useState(
    () =>
      new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()])
  );
  const [dragged, drag] = useState(false);
  const [hovered, hover] = useState(false);

  // local patch: ribbon buffers, and scratch vectors so the per-frame rebuild allocates nothing
  const ribbon = useMemo(() => makeRibbon(isMobile ? 16 : 32), [isMobile]);
  const rib = useMemo(
    () => ({
      quat: new THREE.Quaternion(),
      tan: new THREE.Vector3(),
      view: new THREE.Vector3(),
      face: new THREE.Vector3(),
      cardSide: new THREE.Vector3(),
      side: new THREE.Vector3()
    }),
    []
  );

  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], ropeSeg]);   // local patch
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], ropeSeg]);      // local patch
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], ropeSeg]);      // local patch
  useSphericalJoint(j3, card, [
    [0, 0, 0],
    [0, 1.5, 0]
  ]);

  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = dragged ? 'grabbing' : 'grab';
      return () => void (document.body.style.cursor = 'auto');
    }
  }, [hovered, dragged]);

  // local patch: rewrite the ribbon from the curve, rolling its lower part onto the card's
  // own plane. curve.points[0] is j3, the clip end, so t runs 0 -> 1 up the strap.
  const buildRibbon = state => {
    const { seg, position } = ribbon;
    const { quat, tan, view, face, cardSide, side } = rib;
    const pts = curve.getPoints(seg);
    const half = ribbonHalfWidth(lanyardWidth, state.camera, state.size);

    const r = card.current.rotation();
    quat.set(r.x, r.y, r.z, r.w);
    cardSide.set(1, 0, 0).applyQuaternion(quat);   // the card's own width direction

    for (let i = 0; i <= seg; i++) {
      const p = pts[i];
      tan.copy(pts[Math.min(i + 1, seg)]).sub(pts[Math.max(i - 1, 0)]);
      if (tan.lengthSq() < 1e-10) tan.set(0, 1, 0);
      tan.normalize();

      // camera-facing, which is what meshline gave us at every point
      view.copy(p).sub(state.camera.position).normalize();
      face.crossVectors(tan, view);
      if (face.lengthSq() < 1e-10) face.set(1, 0, 0);
      face.normalize();

      const t = i / seg;
      const blend = t < TWIST_SPAN ? Math.pow(1 - t / TWIST_SPAN, TWIST_FALLOFF) : 0;
      if (blend > 0) {
        // whichever way round the card's edge points, or the ribbon turns itself inside out
        if (cardSide.dot(face) < 0) side.copy(cardSide).negate();
        else side.copy(cardSide);
        side.sub(face).multiplyScalar(blend).add(face);   // = face + blend * (cardSide - face)
        side.addScaledVector(tan, -side.dot(tan));        // keep it square to the strap
        if (side.lengthSq() < 1e-10) side.copy(face);
        else side.normalize();
      } else {
        side.copy(face);
      }

      const a = i * 6;
      position[a] = p.x - side.x * half;
      position[a + 1] = p.y - side.y * half;
      position[a + 2] = p.z - side.z * half;
      position[a + 3] = p.x + side.x * half;
      position[a + 4] = p.y + side.y * half;
      position[a + 5] = p.z + side.z * half;
    }
    ribbon.geometry.attributes.position.needsUpdate = true;
  };

  useFrame((state, delta) => {
    if (dragged) {
      vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera);
      dir.copy(vec).sub(state.camera.position).normalize();
      vec.add(dir.multiplyScalar(state.camera.position.length()));
      [card, j1, j2, j3, fixed].forEach(ref => ref.current?.wakeUp());
      card.current?.setNextKinematicTranslation({ x: vec.x - dragged.x, y: vec.y - dragged.y, z: vec.z - dragged.z });
    }
    if (fixed.current) {
      [j1, j2].forEach(ref => {
        if (!ref.current.lerped) ref.current.lerped = new THREE.Vector3().copy(ref.current.translation());
        const clampedDistance = Math.max(0.1, Math.min(1, ref.current.lerped.distanceTo(ref.current.translation())));
        ref.current.lerped.lerp(
          ref.current.translation(),
          delta * (minSpeed + clampedDistance * (maxSpeed - minSpeed))
        );
      });
      curve.points[0].copy(j3.current.translation());
      curve.points[1].copy(j2.current.lerped);
      curve.points[2].copy(j1.current.lerped);
      curve.points[3].copy(fixed.current.translation());
      buildRibbon(state);   // local patch, replaces band.current.geometry.setPoints(...)
      ang.copy(card.current.angvel());
      rot.copy(card.current.rotation());
      card.current.setAngvel({ x: ang.x, y: ang.y - rot.y * 0.25, z: ang.z });
      if (onCardFrame) onCardFrame(card.current, state, delta, hovered, dragged);   // local patch
    }
  });

  curve.curveType = 'chordal';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;

  return (
    <>
      <group position={[0, anchorY, 0]}>   {/* local patch */}
        <RigidBody ref={fixed} {...segmentProps} type="fixed" />
        <RigidBody position={[ropeSeg * 0.5, 0, 0]} ref={j1} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[ropeSeg, 0, 0]} ref={j2} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[ropeSeg * 1.5, 0, 0]} ref={j3} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[ropeSeg * 2, 0, 0]} ref={card} {...segmentProps} type={dragged ? 'kinematicPosition' : 'dynamic'}>
          <CuboidCollider args={[0.8, 1.125, 0.01]} />
          <group
            scale={2.25}
            position={[0, -1.2, -0.05]}
            onPointerOver={() => hover(true)}
            onPointerOut={() => hover(false)}
            onPointerUp={e => (e.target.releasePointerCapture(e.pointerId), drag(false))}
            onPointerDown={e => (
              onFirstDrag && onFirstDrag(),   // local patch
              e.target.setPointerCapture(e.pointerId),
              drag(new THREE.Vector3().copy(e.point).sub(vec.copy(card.current.translation())))
            )}
          >
            <mesh geometry={nodes.card.geometry}>
              <meshPhysicalMaterial
                map={cardMap}
                map-anisotropy={16}
                clearcoat={isMobile ? 0 : 1}
                clearcoatRoughness={0.15}
                roughness={0.9}
                metalness={0.8}
              />
            </mesh>
            <mesh geometry={nodes.clip.geometry} material={materials.metal} material-roughness={0.3} />
            <mesh geometry={nodes.clamp.geometry} material={materials.metal} />
          </group>
        </RigidBody>
      </group>
      {/* local patch: a real ribbon in place of <meshLineGeometry/>, so it can twist. Unlit
          and depth-tested off to match how meshline drew, and never culled since the geometry
          is rewritten every frame and its bounds are not maintained. */}
      <mesh ref={band} geometry={ribbon.geometry} frustumCulled={false}>
        <meshBasicMaterial map={texture} side={THREE.DoubleSide} depthTest={false} toneMapped={false} />
      </mesh>
    </>
  );
}
