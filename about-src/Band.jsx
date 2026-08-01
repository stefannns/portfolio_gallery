import * as THREE from 'three'
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react'
import { Canvas, extend, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, useGLTF } from '@react-three/drei'
import { BallCollider, CuboidCollider, Physics, RigidBody, useRopeJoint, useSphericalJoint } from '@react-three/rapier'
import { MeshLineGeometry, MeshLineMaterial } from 'meshline'
import { makeCardTexture, makeBandTexture, BAND_REPEAT, BAND_LINE_W, CAM_FOV, CAM_Z } from './cardTexture.js'
import clipUrl from './clip.glb'
import { useTextRepel } from './useTextRepel.js'

extend({ MeshLineGeometry, MeshLineMaterial })

// Card is 1.6 x 2.25, matching the reference's CuboidCollider [0.8, 1.125, 0.01].
const CARD_W = 1.6, CARD_H = 2.25, CARD_T = 0.02

// clip.glb is the reference badge's metal hardware — the 'clip' (the loop the strap runs
// through) and the 'clamp' (the jaw that grips the card's top edge). Authored at a scale
// where the card is 1 unit tall, so 2.25 matches CARD_H; -1.2 then centres the assembly on
// the rigid body, putting the clip's eye right at the [0, 1.45, 0] spherical-joint anchor.
const HW_SCALE = 2.25, HW_Y = -1.2

// Where the strap is pinned. Raising this lifts the whole badge in frame.
const ANCHOR_Y = 4.55

// how far the card turns toward the cursor on hover, radians
const HOVER_YAW = 0.4

// minSpeed 0 is what the reference uses, and it matters: the lerp factor is
// delta * (minSpeed + dist * (maxSpeed - minSpeed)), so at low velocity minSpeed IS the
// smoothing. At 10 the factor was ~3x higher than the reference exactly while the card was
// settling, which let the raw physics stair-step through as jitter.
function Band({ maxSpeed = 50, minSpeed = 0, onFirstDrag }) {
  const band = useRef(), fixed = useRef(), j1 = useRef(), j2 = useRef(), j3 = useRef(), card = useRef()
  const vec = useMemo(() => new THREE.Vector3(), [])
  const ang = useMemo(() => new THREE.Vector3(), [])
  const rot = useMemo(() => new THREE.Vector3(), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  const quat = useMemo(() => new THREE.Quaternion(), [])
  // the card's four corners in world space, fed to the text repel each frame
  const corners = useMemo(() => [[-1,-1],[1,-1],[1,1],[-1,1]].map(() => new THREE.Vector3()), [])
  const CORNER_SIGNS = useMemo(() => [[-1,-1],[1,-1],[1,1],[-1,1]], [])

  // Heavy damping and sleeping, exactly as the reference configures its segments.
  const segmentProps = {
    type: 'dynamic', canSleep: true, colliders: false,
    angularDamping: 4, linearDamping: 4
  }

  const cardTex = useMemo(() => makeCardTexture(), [])
  const bandTex = useMemo(() => makeBandTexture(), [])
  const { nodes, materials } = useGLTF(clipUrl)

  const { width, height } = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const repel = useTextRepel()

  // The canvas is wider than the stage so the badge can travel over the text. Slide the camera
  // so world x=0 still lands on the middle of the stage, whatever the canvas ends up being.
  useLayoutEffect(() => {
    const canvas = gl.domElement
    const stage = canvas.closest('.stage')
    const cr = canvas.getBoundingClientRect()
    if (!stage || !cr.width) return
    const sr = stage.getBoundingClientRect()
    const worldH = 2 * CAM_Z * Math.tan((CAM_FOV / 2) * Math.PI / 180)
    const worldW = worldH * (cr.width / cr.height)
    camera.position.x = worldW * (0.5 - ((sr.left + sr.width / 2) - cr.left) / cr.width)
  }, [width, height, camera, gl])
  const [curve] = useState(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
  ]))
  const [dragged, drag] = useState(false)
  const [hovered, hover] = useState(false)

  // Three rope segments hanging off a fixed point, then the card on a spherical joint whose
  // anchor sits ABOVE the card's centre — that offset is what makes it hang and self-right.
  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], 1])
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], 1])
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], 1])
  useSphericalJoint(j3, card, [[0, 0, 0], [0, 1.45, 0]])

  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = dragged ? 'grabbing' : 'grab'
      return () => { document.body.style.cursor = 'auto' }
    }
  }, [hovered, dragged])

  useFrame((state, delta) => {
    // Rapier steps at a fixed 1/60 but the page may render at 120Hz+, so anything applied per
    // RENDER frame lands twice as often on a high-refresh display. dt60 normalises those to
    // one 60Hz step; the cap also stops a stalled frame from delivering one huge correction.
    const dt = Math.min(delta, 1 / 30)
    const dt60 = dt * 60
    if (dragged) {
      // Intersect the pointer ray with the z=0 plane. The reference used
      // |camera.position| as the distance, which only works while the camera sits on the axis
      // — the badge is now offset horizontally, so that shortcut would skew the drag.
      vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera)
      dir.copy(vec).sub(state.camera.position).normalize()
      vec.copy(state.camera.position).addScaledVector(dir, -state.camera.position.z / dir.z)
      ;[card, j1, j2, j3, fixed].forEach((r) => r.current?.wakeUp())
      card.current?.setNextKinematicTranslation({
        x: vec.x - dragged.x, y: vec.y - dragged.y, z: vec.z - dragged.z
      })
    }
    if (fixed.current) {
      // Smoothing from the reference: lerp each point toward its physics position, faster the
      // further it has to travel. j3 is included even though the reference leaves it raw —
      // it's the bottom of the strap, and having it snap while its neighbour lagged was what
      // made the bottom glitch during movement. The speed scales with distance, so it still
      // tracks the clip tightly when the badge is thrown around.
      ;[j1, j2, j3].forEach((r) => {
        if (!r.current.lerped) r.current.lerped = new THREE.Vector3().copy(r.current.translation())
        const dist = Math.max(0.1, Math.min(1, r.current.lerped.distanceTo(r.current.translation())))
        // Clamp to 1: Vector3.lerp EXTRAPOLATES past the target when alpha > 1, and
        // delta * 50 exceeds 1 on any frame slower than 20ms. That overshoot is what threw
        // the bottom of the strap out past the card on a stutter.
        const alpha = Math.min(1, dt * (minSpeed + dist * (maxSpeed - minSpeed)))
        r.current.lerped.lerp(r.current.translation(), alpha)
      })
      curve.points[0].copy(j3.current.lerped)
      curve.points[1].copy(j2.current.lerped)
      curve.points[2].copy(j1.current.lerped)
      curve.points[3].copy(fixed.current.translation())
      // On the first frames every body still reports the same position. A chordal
      // Catmull-Rom divides by the distance between control points, so a degenerate curve
      // yields NaN vertices and a NaN bounding sphere. Skip until the rope has some length.
      let spread = true
      for (let i = 1; i < curve.points.length; i++) {
        if (curve.points[i].distanceTo(curve.points[i - 1]) < 1e-4) { spread = false; break }
      }
      if (spread) band.current.geometry.setPoints(curve.getPoints(32))
      // Hover: turn the card toward the cursor. This retargets the self-righting controller
      // below rather than applying its own force, so it can't fight the solver or reintroduce
      // jitter — the rest angle simply moves, and releasing the hover lets it swing back.
      const ct = card.current.translation()
      let restYaw = 0
      if (hovered && !dragged) {
        vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera)
        dir.copy(vec).sub(state.camera.position).normalize()
        vec.copy(state.camera.position).addScaledVector(dir, -state.camera.position.z / dir.z)
        restYaw = Math.max(-HOVER_YAW, Math.min(HOVER_YAW, (vec.x - ct.x) * 0.55))
      }
      // ease the card back toward its rest angle instead of spinning freely
      ang.copy(card.current.angvel()); rot.copy(card.current.rotation())
      card.current.setAngvel({ x: ang.x, y: ang.y - (rot.y - restYaw) * 0.25 * dt60, z: ang.z })
      const cq = card.current.rotation()
      quat.set(cq.x, cq.y, cq.z, cq.w)
      for (let i = 0; i < 4; i++) {
        corners[i].set(CORNER_SIGNS[i][0] * CARD_W / 2, CORNER_SIGNS[i][1] * CARD_H / 2, 0)
          .applyQuaternion(quat)
        corners[i].x += ct.x; corners[i].y += ct.y; corners[i].z += ct.z
      }
      repel(corners, state.camera, state.gl.domElement)
    }
  })

  // Centripetal, not chordal. Chordal parameterisation overshoots badly when one segment gets
  // much shorter than its neighbours, which is exactly what happens at the bottom of the strap
  // while the badge is moving. Centripetal is provably free of cusps and self-intersections.
  curve.curveType = 'centripetal'

  return (
    <>
      <group position={[0, ANCHOR_Y, 0]}>
        <RigidBody ref={fixed} {...segmentProps} type="fixed" />
        <RigidBody position={[0.5, 0, 0]} ref={j1} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[1, 0, 0]} ref={j2} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[1.5, 0, 0]} ref={j3} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>

        <RigidBody position={[2, 0, 0]} ref={card} {...segmentProps}
          type={dragged ? 'kinematicPosition' : 'dynamic'}>
          <CuboidCollider args={[CARD_W / 2, CARD_H / 2, 0.01]} />
          <group
            scale={1}
            onPointerOver={() => hover(true)}
            onPointerOut={() => hover(false)}
            onPointerUp={(e) => { try { e.target.releasePointerCapture(e.pointerId) } catch (err) {}; drag(false) }}
            onPointerDown={(e) => {
              try { e.target.setPointerCapture(e.pointerId) } catch (err) { /* pointer capture is best-effort */ }
              onFirstDrag?.()
              drag(new THREE.Vector3().copy(e.point).sub(vec.copy(card.current.translation())))
            }}>
            {/* holder + printed card */}
            <mesh>
              <boxGeometry args={[CARD_W, CARD_H, CARD_T]} />
              {/* metalness would grey a white card down — this is laminated card, not metal */}
              <meshPhysicalMaterial map={cardTex} clearcoat={1} clearcoatRoughness={0.15}
                roughness={0.35} metalness={0} />
            </mesh>
            {/* the reference badge's actual clip + clamp geometry */}
            <group scale={HW_SCALE} position={[0, HW_Y, 0]}>
              <mesh geometry={nodes.clip.geometry} material={materials.metal} material-roughness={0.3} />
              <mesh geometry={nodes.clamp.geometry} material={materials.metal} />
            </group>
          </group>
        </RigidBody>
      </group>

      <mesh ref={band}>
        <meshLineGeometry />
        <meshLineMaterial
          color="white"
          depthTest={false}
          resolution={[width, height]}
          useMap
          map={bandTex}
          repeat={[-BAND_REPEAT, 1]}
          lineWidth={BAND_LINE_W}
        />
      </mesh>
    </>
  )
}

// The canvas listens for its own events (R3F's default). Routing them from the wrap via
// eventSource silently never wired up — drags fell through to the page and selected text — so
// the canvas keeps pointer-events. It overhangs the copy, which costs text selection there;
// the badge pushes the copy aside anyway, so it rarely covers anything.
export default function Lanyard({ onFirstDrag }) {
  return (
    <Canvas camera={{ position: [0, 0, CAM_Z], fov: CAM_FOV }}>
      <ambientLight intensity={Math.PI} />
      <Physics gravity={[0, -40, 0]} timeStep={1 / 60}>
        <Band onFirstDrag={onFirstDrag} />
      </Physics>
      <Environment blur={0.75}>
        <Lightformer intensity={2} color="white" position={[0, -1, 5]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={3} color="white" position={[-1, -1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={3} color="white" position={[1, 1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={10} color="white" position={[-10, 0, 14]} rotation={[0, Math.PI / 2, Math.PI / 3]} scale={[100, 10, 1]} />
      </Environment>
    </Canvas>
  )
}

useGLTF.preload(clipUrl)
