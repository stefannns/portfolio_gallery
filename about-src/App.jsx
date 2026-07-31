import { useRef } from 'react'
import Lanyard from './Band.jsx'

export default function App() {
  // R3F listens on the wrap rather than the canvas: the canvas sits ON TOP of the text so the
  // badge can be dragged across it, but it's pointer-events:none so the text stays selectable.
  const wrap = useRef(null)

  return (
    <div className="wrap" ref={wrap}>
      <div className="stage">
        <div className="canvas-layer"><Lanyard eventSource={wrap} /></div>
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
