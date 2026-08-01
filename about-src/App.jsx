import { useEffect, useMemo, useState } from 'react'
import Lanyard from './Lanyard.jsx'
import { makeCardFrontURL, makeCardBackURL, makeStrapURL, CAM_FOV, CAM_Z } from './cardTexture.js'
import patternUrl from './pattern.png'

export default function App () {
  const front = useMemo(makeCardFrontURL, [])
  const back = useMemo(makeCardBackURL, [])
  const [strap, setStrap] = useState(null)

  useEffect(() => {
    let alive = true
    makeStrapURL(patternUrl).then(url => { if (alive) setStrap(url) })
    return () => { alive = false }
  }, [])

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
            />
          )}
        </div>
        <div className="hint">drag the badge</div>
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
