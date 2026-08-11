import { useCallback, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import Lanyard from './Lanyard.jsx'
import { useTextRepel } from './useTextRepel.js'
import { makeCardFrontURL, makeCardBackURL, makeStrapURL, CAM_FOV, CAM_Z, CAM_Y, BAND_LINE_W, ANCHOR_Y, ROPE_SEG } from './cardTexture.js'
import patternUrl from './pattern.png'

// The card's physical extent, from the component's own CuboidCollider args [0.8, 1.125, 0.01].
const CARD_HW = 0.8, CARD_HH = 1.125
const CORNER_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

const HOVER_YAW = 0.4    // how far the card turns toward the cursor
const HOVER_SNAP = 14    // rad/s per unit of yaw error — higher follows the cursor quicker
const HOVER_MAX_W = 6    // rad/s ceiling, so a big jump can't fling it

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
    // The strap's world width scales with the canvas aspect (see strapTileAspect), so the
    // tile can only be shaped correctly once the layer has been laid out.
    const r = document.querySelector('.canvas-layer')?.getBoundingClientRect()
    const aspect = r && r.width > 0 && r.height > 0 ? r.width / r.height : null
    window.__strapAspect = aspect
    // The strap mark belongs to the standalone /about page only — on the combined root page
    // the strap is left as plain webbing. .about-solo is the same flag styles.css gates on.
    const solo = document.documentElement.classList.contains('about-solo')
    makeStrapURL(solo ? patternUrl : null, aspect).then(url => { if (alive) setStrap(url) })
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

    // Hover: turn the card toward the cursor. This SETS the angular velocity needed to close
    // the remaining angle rather than shaving a fraction off the existing one each step —
    // the old version only ever removed 25% of the error per step, so it drifted toward the
    // target instead of tracking the cursor. Setting it outright also makes the term
    // frame-rate independent by construction: the value depends on the current error, not on
    // how many times it has been applied.
    if (hovered && !dragged) {
      vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera)
      dir.copy(vec).sub(state.camera.position).normalize()
      vec.copy(state.camera.position).addScaledVector(dir, -state.camera.position.z / dir.z)
      const target = Math.max(-HOVER_YAW, Math.min(HOVER_YAW, (vec.x - t.x) * 0.55))
      const av = body.angvel()
      const w = Math.max(-HOVER_MAX_W, Math.min(HOVER_MAX_W, (target - q.y) * HOVER_SNAP))
      body.setAngvel({ x: av.x, y: w, z: av.z }, true)
    }
  }, [repel, scratch])

  return (
    <div className="wrap">
      <div className="stage">
        <div className="canvas-layer">
          {/* held until the strap art is ready, so the component's own band texture never flashes */}
          {strap && (
            <Lanyard
              position={[0, CAM_Y, CAM_Z]}
              fov={CAM_FOV}
              transparent
              frontImage={front}
              backImage={back}
              lanyardImage={strap}
              lanyardWidth={BAND_LINE_W}
              anchorY={ANCHOR_Y}
              ropeSeg={ROPE_SEG}
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
          development tools, with experience in projects from indie student projects to
          large-scale commercial titles like
          Golden Spatula with 30M+ MAUs. I'm excited for the future of AI-assisted design and
          development.
        </p>
        <p className="sec-title">Core Skills</p>
        <div className="skills">
          <span className="chip">Vibe Coding</span>
          <span className="chip">AI Image &amp; Video</span>
          <span className="chip">Game Design &amp; Development</span>
          <span className="chip">Full-Stack Development</span>
          <span className="chip">ComfyUI</span>
          <span className="chip">Unity</span>
        </div>
      </section>
    </div>
  )
}
