import { useCallback, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import Lanyard from './Lanyard.jsx'
import { useTextRepel } from './useTextRepel.js'
import { makeCardFrontURL, makeCardBackURL, makeStrapURL, CAM_FOV, CAM_Z, BAND_LINE_W } from './cardTexture.js'
import patternUrl from './pattern.png'

// The card's physical extent, from the component's own CuboidCollider args [0.8, 1.125, 0.01].
const CARD_HW = 0.8, CARD_HH = 1.125
const CORNER_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

const HOVER_YAW = 0.4   // how far the card turns toward the cursor, radians

export default function App () {
  const front = useMemo(makeCardFrontURL, [])
  const back = useMemo(makeCardBackURL, [])
  const [strap, setStrap] = useState(null)
  const [used, setUsed] = useState(false)
  const repel = useTextRepel()

  const scratch = useMemo(() => ({
    quat: new THREE.Quaternion(),
    vec: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    corners: CORNER_SIGNS.map(() => new THREE.Vector3()),
  }), [])

  useEffect(() => {
    let alive = true
    makeStrapURL(patternUrl).then(url => { if (alive) setStrap(url) })
    return () => { alive = false }
  }, [])

  // Runs once per frame, after the component has finished with the card.
  const onCardFrame = useCallback((body, state, delta, hovered, dragged) => {
    const { quat, vec, dir, corners } = scratch
    const t = body.translation(), q = body.rotation()
    quat.set(q.x, q.y, q.z, q.w)

    for (let i = 0; i < 4; i++) {
      corners[i].set(CORNER_SIGNS[i][0] * CARD_HW, CORNER_SIGNS[i][1] * CARD_HH, 0)
        .applyQuaternion(quat)
      corners[i].x += t.x; corners[i].y += t.y; corners[i].z += t.z
    }
    repel(corners, state.camera, state.gl.domElement)

    // Hover: turn the card toward the cursor by retargeting the rest angle that the
    // component's own self-righting term drives toward, rather than adding a force of our
    // own — so it can't fight the solver. Let go and it swings back to square.
    if (hovered && !dragged) {
      vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera)
      dir.copy(vec).sub(state.camera.position).normalize()
      vec.copy(state.camera.position).addScaledVector(dir, -state.camera.position.z / dir.z)
      const target = Math.max(-HOVER_YAW, Math.min(HOVER_YAW, (vec.x - t.x) * 0.55))
      const av = body.angvel()
      // Scaled by the frame's share of a 60Hz step: this runs per RENDER frame but the solver
      // only consumes velocity per STEP, so on a 120Hz display an unscaled term would land
      // twice per step and compound into an overshoot.
      const stepShare = Math.min(1, delta * 60)
      body.setAngvel({ x: av.x, y: av.y - (q.y - target) * 0.25 * stepShare, z: av.z }, true)
    }
  }, [repel, scratch])

  return (
    <div className="wrap">
      <div className="stage">
        <div className="canvas-layer">
          {/* held until the strap art is ready, so the component's own band texture never flashes */}
          {strap && (
            <Lanyard
              position={[0, 0, CAM_Z]}
              fov={CAM_FOV}
              transparent
              frontImage={front}
              backImage={back}
              lanyardImage={strap}
              lanyardWidth={BAND_LINE_W}
              onCardFrame={onCardFrame}
              onFirstDrag={() => setUsed(true)}
            />
          )}
        </div>
        <div className={used ? 'hint is-used' : 'hint'}>drag the badge</div>
      </div>
      <section className="info">
        <p className="intro">
          Hi, I'm Stefan — a game designer and AI-driven creator studying Game Design at USC with a
          minor in AI Applications. I love building interactive experiences with AI-powered
          development tools, from indie student projects to large-scale commercial titles like
          Golden Spatula with 30M+ MAUs. I'm excited for the future of AI-assisted design and
          development.
        </p>
        <p className="sec-title">Core Skills</p>
        <div className="skills">
          <span className="chip">Vibe Coding</span>
          <span className="chip">AI生图和视频</span>
          <span className="chip">游戏策划与开发</span>
          <span className="chip">Full-Stack Development</span>
          <span className="chip">ComfyUI</span>
          <span className="chip">Unity引擎</span>
        </div>
      </section>
    </div>
  )
}
