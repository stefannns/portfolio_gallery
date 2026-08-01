import * as THREE from 'three'
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react'
import { Canvas, extend, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, useGLTF } from '@react-three/drei'
import { BallCollider, CuboidCollider, Physics, RigidBody, useRopeJoint, useSphericalJoint } from '@react-three/rapier'
import { MeshLineGeometry, MeshLineMaterial } from 'meshline'
import { makeCardTexture, makeBandTexture, BAND_REPEAT, BAND_LINE_W, CAM_FOV, CAM_Z, ROPE_LEN } from './cardTexture.js'
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

// The rope is longer than the reference's 3.0 so the strap leaves the top of the frame with
// no visible end. SEG is per joint; ANCHOR_Y is then derived to hold the card at the same
// height it sat at before — raising the anchor alone would just lift the whole badge.
const SEG = ROPE_LEN / 3
const CARD_REST_Y = 0.1                    // where the card centre should hang
const ANCHOR_Y = ROPE_LEN + 1.45 + CARD_REST_Y

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
  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], SEG])
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], SEG])
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], SEG])
  useSphericalJoint(j3, card, [[0, 0, 0], [0, 1.45, 0]])

  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = dragged ? 'grabbing' : 'grab'
      return () => { document.body.style.cursor = 'auto' }
    }
  }, [hovered, dragged])

  // This block is the reference implementation (React Bits' Lanyard) as-is. The only
  // additions are the exact z=0 plane intersection for the drag (the camera is offset
  // horizontally here, so their |camera.position| shortcut would skew it), the degenerate
  // curve guard, the hover rest angle, and the text repel. With restYaw at 0 the angular
  // line below is character-for-character theirs.
  useFrame((state, delta) => {
    if (dragged) {
      vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera)
      dir.copy(vec).sub(state.camera.position).normalize()
      vec.copy(state.camera.position).addScaledVector(dir, -state.camera.position.z / dir.z)
      ;[card, j1, j2, j3, fixed].forEach((r) => r.current?.wakeUp())
      card.current?.setNextKinematicTranslation({
        x: vec.x - dragged.x, y: vec.y - dragged.y, z: vec.z - dragged.z
      })
    }
    if (fixed.current) {
      ;[j1, j2].forEach((r) => {
        if (!r.current.lerped) r.current.lerped = new THREE.Vector3().copy(r.current.translation())
        const clampedDistance = Math.max(0.1, Math.min(1, r.current.lerped.distanceTo(r.current.translation())))
        r.current.lerped.lerp(r.current.translation(), delta * (minSpeed + clampedDistance * (maxSpeed - minSpeed)))
      })
      curve.points[0].copy(j3.current.translation())
      curve.points[1].copy(j2.current.lerped)
      curve.points[2].copy(j1.current.lerped)
      curve.points[3].copy(fixed.current.translation())
      // guard only: on the first frames every body reports the same position, and a chordal
      // Catmull-Rom divides by the gap between control points -> NaN vertices.
      let spread = true
      for (let i = 1; i < curve.points.length; i++) {
        if (curve.points[i].distanceTo(curve.points[i - 1]) < 1e-4) { spread = false; break }
      }
      if (spread) band.current.geometry.setPoints(curve.getPoints(32))

      const ct = card.current.translation()
      let restYaw = 0
      if (hovered && !dragged) {
        vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera)
        dir.copy(vec).sub(state.camera.position).normalize()
        vec.copy(state.camera.position).addScaledVector(dir, -state.camera.position.z / dir.z)
        restYaw = Math.max(-HOVER_YAW, Math.min(HOVER_YAW, (vec.x - ct.x) * 0.55))
      }
      // The ONE place the reference is frame-rate dependent, and the cause of the shimmer
      // while the badge falls freely.
      //
      // This runs per RENDER frame but the solver only consumes the velocity per STEP. At
      // 120Hz two frames land per step, and the second re-reads the angvel the first just
      // wrote — so the correction compounds to 0.5*rot instead of 0.25*rot. Double the
      // restoring torque makes the card overshoot and ring, and the strap vibrates with it.
      //
      // It matches what you see exactly: held, the card is kinematicPosition and ignores
      // setAngvel, so no shimmer; at rest nothing moves, so no shimmer; only while it is
      // dynamic AND moving does the controller run.
      //
      // Scaling by the frame's share of a 60Hz step makes the per-step total identical to
      // the reference at any refresh rate. Capped at 1 so a stalled frame can't over-correct.
      const stepShare = Math.min(1, delta * 60)
      ang.copy(card.current.angvel()); rot.copy(card.current.rotation())
      card.current.setAngvel({ x: ang.x, y: ang.y - (rot.y - restYaw) * 0.25 * stepShare, z: ang.z })

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

  curve.curveType = 'chordal'

  return (
    <>
      <group position={[0, ANCHOR_Y, 0]}>
        <RigidBody ref={fixed} {...segmentProps} type="fixed" />
        <RigidBody position={[SEG * 0.5, 0, 0]} ref={j1} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[SEG, 0, 0]} ref={j2} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[SEG * 1.5, 0, 0]} ref={j3} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>

        <RigidBody position={[SEG * 2, 0, 0]} ref={card} {...segmentProps}
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
