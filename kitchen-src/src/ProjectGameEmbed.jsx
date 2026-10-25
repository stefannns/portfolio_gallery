import React, {useRef, useState} from 'react';

/** Load the actual game only after the visitor chooses to play. */
export default function ProjectGameEmbed({project}) {
  const [playing, setPlaying] = useState(false);
  const launch = useRef(null);

  function closeGame() {
    setPlaying(false);
    requestAnimationFrame(() => launch.current?.focus({preventScroll: true}));
  }

  return <div className="computer-projects__game" data-game-playing={playing}>
    <div className="computer-projects__game-toolbar">
      {playing ? <button type="button" onClick={closeGame}>Close game</button> : <span className="computer-projects__game-label">Game preview</span>}
      <a href={project.url} target="_blank" rel="noopener noreferrer">Open in a new tab ↗</a>
    </div>
    <div className="computer-projects__media computer-projects__media--game">
      {playing ? <iframe src={project.embedUrl} title={`Play ${project.title}`}
        allow="autoplay; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>
        : <>
          <img src={project.image} alt={`${project.title} project cover`} style={{objectPosition: project.imagePosition || 'center'}}/>
          <button ref={launch} type="button" className="computer-projects__game-launch" onClick={() => setPlaying(true)} aria-label={`Play ${project.title} here`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>
            <span>Play here</span>
          </button>
        </>}
    </div>
  </div>;
}
