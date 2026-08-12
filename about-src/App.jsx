import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import Lanyard from './Lanyard.jsx'
import { useTextRepel } from './useTextRepel.js'
import { mountWaves } from './waves.js'
import { makeCardFrontURL, makeCardBackURL, makeStrapURL, CAM_FOV, CAM_Z, CAM_Y, BAND_LINE_W, ANCHOR_Y, ROPE_SEG } from './cardTexture.js'
import patternUrl from './pattern.png'
import grabIconUrl from './grabicon.png'

// The card's physical extent, from the component's own CuboidCollider args [0.8, 1.125, 0.01].
const CARD_HW = 0.8, CARD_HH = 1.125
const CORNER_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

/* The canvas is 220vw wide so the card can be dragged anywhere on screen without being clipped by
   its own edge — at 300% of the stage it stopped 88px short of the viewport at 1280 and 408px
   short at 1920, because it is centred on the stage rather than on the window.
   That has a price: meshline's world width is lineWidth * tan(fov/2) * canvasAspect, so a wider
   canvas makes the strap proportionally fatter. Scaling the width by the inverse of the change
   holds it exactly where it was — the same correction dooropen2 makes via __BADGE_W.
   Measured rather than hardcoded, so it stays right through the breakpoints where the stage is a
   different size. */
const REFERENCE_LAYER_MULTIPLE = 3   // the layer's old width, as a multiple of the stage's

function effectiveBandWidth () {
  const layer = document.querySelector('.canvas-layer')?.getBoundingClientRect()
  const stage = document.querySelector('.stage')?.getBoundingClientRect()
  if (!layer?.width || !stage?.width) return BAND_LINE_W
  return BAND_LINE_W * ((stage.width * REFERENCE_LAYER_MULTIPLE) / layer.width)
}

const HOVER_YAW = 0.4    // how far the card turns toward the cursor
const HOVER_SNAP = 14    // rad/s per unit of yaw error — higher follows the cursor quicker
const HOVER_MAX_W = 6    // rad/s ceiling, so a big jump can't fling it

export default function App () {
  const front = useMemo(makeCardFrontURL, [])
  const back = useMemo(makeCardBackURL, [])
  const [strap, setStrap] = useState(null)
  const [bandW, setBandW] = useState(BAND_LINE_W)
  const [used, setUsed] = useState(false)
  const repel = useTextRepel()
  const wavesRef = useRef(null)

  // The background field. Its own WebGL context, independent of the R3F canvas the badge owns.
  useEffect(() => {
    if (!wavesRef.current) return
    return mountWaves(wavesRef.current)
  }, [])

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
    const w = effectiveBandWidth()
    setBandW(w)
    // The strap mark belongs to the standalone /about page only — on the combined root page
    // the strap is left as plain webbing. .about-solo is the same flag styles.css gates on.
    const solo = document.documentElement.classList.contains('about-solo')
    makeStrapURL(solo ? patternUrl : null, aspect, w).then(url => { if (alive) setStrap(url) })

    // The canvas is sized in vw, so its aspect — and with it the strap's world width — changes
    // whenever the window does. Only the width needs recomputing: the tile aspect is invariant
    // under this compensation (see strapTileAspect), so the texture stays valid and is never
    // regenerated.
    const onResize = () => { if (alive) setBandW(effectiveBandWidth()) }
    addEventListener('resize', onResize)
    return () => { alive = false; removeEventListener('resize', onResize) }
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
      {/* behind everything: the badge canvas is z 3, the copy z 1 */}
      <canvas className="waves" ref={wavesRef} aria-hidden="true" />
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
              lanyardWidth={bandW}
              anchorY={ANCHOR_Y}
              ropeSeg={ROPE_SEG}
              onCardFrame={onCardFrame}
              onFirstDrag={() => setUsed(true)}
            />
          )}
        </div>
        {/* The icon is a MASK, not an <img>: it is a flat shape, so masking it and filling with
            currentColor makes it exactly the hint's colour and keeps it that way if the accent
            ever changes again. The URL has to come through as a custom property because Vite
            hashes the asset filename at build time. */}
        <div className={used ? 'hint is-used' : 'hint'}
             style={{ '--grab': `url(${grabIconUrl})` }}>
          <i className="hint-icon" aria-hidden="true" />
          drag the badge
        </div>
      </div>
      <section className="info">
        {/* Source wrapping is cosmetic only — useTextRepel collapses this to a single string and
            re-splits it at whatever breaks the browser chooses at the current width. */}
        <p className="intro">
          Hi, I'm Stefan — a game designer and creator studying Game Design at USC with a minor
          in AI Applications. I love building interactive experiences with AI-powered development
          tools, with experience in projects from indie student projects to large-scale
          commercial titles like Golden Spatula with 30M+ MAUs. I'm excited for the future of
          AI-assisted design and development.
        </p>
        <p className="sec-title">Core Skills</p>
        <div className="skills">
          <span className="chip">Vibe Coding</span>
          <span className="chip">AI Image &amp; Video</span>
          <span className="chip">Game Design</span>
          <span className="chip">Full-Stack Development</span>
          <span className="chip">ComfyUI</span>
          <span className="chip">Unity</span>
        </div>
      </section>
    </div>
  )
}
