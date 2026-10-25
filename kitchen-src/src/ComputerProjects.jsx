import React, {useEffect, useId, useMemo, useRef, useState} from 'react';
import {projects, computerProjectIds} from './projects.js';
import ProjectGameEmbed from './ProjectGameEmbed.jsx';
import './computer-projects.css';

const computerIds = computerProjectIds;
const projectsById = new Map(projects.map(project => [project.id, project]));
const focusable = 'button:not(:disabled),a[href],video[controls],iframe[title],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

export default function ComputerProjects({onClose, projectId, projectIds, title}) {
  const requestedIds = Array.isArray(projectIds) ? [...new Set(projectIds.filter(id => projectsById.has(id)))] : [];
  const libraryKey = (requestedIds.length ? requestedIds : computerIds).join('|');
  const library = useMemo(() => libraryKey.split('|').map(id => projectsById.get(id)), [libraryKey]);
  const [selectedId, setSelectedId] = useState(() => library.some(project => project.id === projectId) ? projectId : library[0].id);
  const [reel, setReel] = useState(null);
  const dialog = useRef(null), closeButton = useRef(null), detail = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId(), detailId = useId(), projectTitleId = useId();
  const selected = library.find(project => project.id === selectedId) || library[0];
  const single = library.length === 1;
  const heading = typeof title === 'string' && title.trim() ? title.trim() : single ? selected.title : 'Capybara’s computer';
  const video = selected.moreVideos?.some(clip => clip.url === reel) ? reel : selected.video || selected.moreVideos?.[0]?.url;

  useEffect(() => {
    setSelectedId(current => library.some(project => project.id === projectId) ? projectId
      : library.some(project => project.id === current) ? current : library[0].id);
    setReel(null);
  }, [projectId, library]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const containKeys = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll(focusable)]
        .filter(node => node.getClientRects().length && !node.closest('[hidden],[inert]'));
      const first = items[0], last = items.at(-1);
      if (!first) {event.preventDefault();dialog.current.focus();return;}
      const outside = !dialog.current.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault();last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault();first.focus();
      }
    };
    document.addEventListener('keydown', containKeys, true);
    return () => {
      document.removeEventListener('keydown', containKeys, true);
      document.body.style.overflow = oldOverflow;
      requestAnimationFrame(() => {
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected && !previousFocus.closest('[inert]')) {
          previousFocus.focus({preventScroll: true});
        }
      });
    };
  }, []);

  useEffect(() => {
    if (detail.current) detail.current.scrollTop = 0;
    dialog.current?.querySelector('.computer-projects__card[aria-pressed="true"]')
      ?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }, [selected.id]);

  function select(id) {
    setSelectedId(id);
    setReel(null);
  }

  const stop = event => event.stopPropagation();
  return <div
    className={`computer-projects${single ? ' computer-projects--single' : ''}`}
    onPointerDown={event => {
      event.stopPropagation();
      if (event.target === event.currentTarget) {event.preventDefault();close.current?.();}
    }}
    onPointerMove={stop}
    onPointerUp={stop}
    onClick={stop}
    onKeyDown={stop}
    onKeyUp={stop}
    onWheel={stop}
  >
    <section className="computer-projects__window" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="computer-projects__header">
        <div className="computer-projects__identity">
          <h1 id={titleId}>{heading}</h1>
        </div>
        <button className="computer-projects__close" type="button" ref={closeButton} onClick={() => close.current?.()} aria-label={single ? 'Close project' : 'Close computer'}>Close</button>
      </header>

      <div className="computer-projects__browser">
        {!single && <nav className="computer-projects__library" aria-label="Projects on the computer">
          <p className="computer-projects__library-label">Projects <span>{library.length}</span></p>
          {library.map(project => <button
            className={`computer-projects__card${project.id === selected.id ? ' computer-projects__card--selected' : ''}`}
            key={project.id}
            type="button"
            aria-label={`View ${project.title}`}
            aria-pressed={project.id === selected.id}
            aria-controls={detailId}
            onClick={() => select(project.id)}
          >
            <img src={project.image} alt="" style={{objectPosition: project.imagePosition || 'center'}}/>
            <span className="computer-projects__card-copy"><span>{project.title}</span><small>{project.type}</small></span>
          </button>)}
        </nav>}

        <article className="computer-projects__detail" ref={detail} id={detailId} aria-labelledby={projectTitleId}>
          <div className={`computer-projects__media-column${selected.embedUrl ? ' computer-projects__media-column--embed' : ''}`}>
            {selected.embedUrl ? <ProjectGameEmbed key={selected.id} project={selected}/> : <div className="computer-projects__media">
              {selected.previewUrl ? <a className="computer-projects__linked-preview" href={selected.previewUrl} target="_blank" rel="noopener noreferrer" aria-label={`${selected.previewLabel || 'Explore'} — ${selected.title}`}>
                <img src={selected.previewImage || selected.image} alt={selected.previewAlt || `${selected.title} preview`}/>
                <span>{selected.previewLabel || 'Explore'} ↗</span>
              </a> : video ? <video key={`${selected.id}-${video}`} controls playsInline preload="metadata" src={video} poster={selected.image} aria-label={`${selected.title} gameplay`}/>
                : <img src={selected.image} alt={`${selected.title} project cover`} style={{objectPosition: selected.imagePosition || 'center'}}/>}
            </div>}
            {selected.workflow && <p className="computer-projects__workflow-summary">{selected.workflow}</p>}
            {selected.moreVideos?.length > 1 && <nav className="computer-projects__reels" aria-label="Choose a gameplay clip">
              {selected.moreVideos.map(clip => <button key={clip.url} type="button" aria-pressed={video === clip.url} onClick={() => setReel(clip.url)}>{clip.label}</button>)}
            </nav>}
          </div>

          <div className="computer-projects__copy">
            <section className="computer-projects__story-note">
              <p className="computer-projects__type">{selected.type}</p>
              <h2 id={projectTitleId}>{selected.title}</h2>
              <p className="computer-projects__description">{selected.description}</p>
              {(selected.url || selected.github) && <div className="computer-projects__links">
                {selected.url && <a href={selected.url} target="_blank" rel="noopener noreferrer">{selected.embedUrl ? 'Open game in a new tab ↗' : selected.collection === 'games' ? 'Play the game' : selected.id === 'smarttester' ? 'Open Smarttester' : 'Open project'}</a>}
                {selected.github && <a href={selected.github} target="_blank" rel="noopener noreferrer">Source on GitHub</a>}
              </div>}
            </section>
            <div className="computer-projects__notes">
              {selected.design && <section><h3>Design</h3><p>{selected.design}</p></section>}
              {selected.process && <section><h3>{selected.processTitle || 'Process'}</h3><p>{selected.process}</p></section>}
            </div>
          </div>
        </article>
      </div>
      <span className="computer-projects__announcement" role="status" aria-live="polite">{selected.title} selected.</span>
    </section>
  </div>;
}
