import React, {useEffect, useId, useMemo, useRef, useState} from 'react';
import {projects, computerProjectIds} from './projects.js';
import ProjectGameEmbed from './ProjectGameEmbed.jsx';
import ProjectWorkflow from './ProjectWorkflow.jsx';
import ProjectGallery from './ProjectGallery.jsx';
import {attachProjectEndGesture} from './project-end-gesture.js';
import './computer-projects.css';

const computerIds = computerProjectIds;
const projectsById = new Map(projects.map(project => [project.id, project]));
const focusable = 'button:not(:disabled),a[href],video[controls],iframe[title],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

/** Keep background music tied to playback, rather than opening a project note. */
function ProjectVideo({src, poster, label, onPlaybackChange, aspectRatio = '16 / 9'}) {
  const media = useRef(null);
  const [ratio, setRatio] = useState(aspectRatio);
  useEffect(() => {
    const element = media.current;
    return () => {element?.pause();onPlaybackChange?.(false);};
  }, [onPlaybackChange]);
  return <div className="computer-projects__media computer-projects__media--video"><video ref={media} controls playsInline preload="metadata" src={src} poster={poster} aria-label={label}
    style={{aspectRatio: ratio}}
    onLoadedMetadata={event => {const {videoWidth, videoHeight} = event.currentTarget;if (videoWidth > 0 && videoHeight > 0) setRatio(`${videoWidth} / ${videoHeight}`);}}
    onPlay={() => onPlaybackChange?.(true)}
    onPause={event => {if (!event.currentTarget.seeking) onPlaybackChange?.(false);}}
    onSeeked={event => onPlaybackChange?.(!event.currentTarget.paused && !event.currentTarget.ended && !event.currentTarget.error)}
    onEnded={() => onPlaybackChange?.(false)}
    onError={() => onPlaybackChange?.(false)}/></div>;
}

export default function ComputerProjects({onClose, projectId, projectIds, title, onVideoPlaybackChange}) {
  const requestedIds = Array.isArray(projectIds) ? [...new Set(projectIds.filter(id => projectsById.has(id)))] : [];
  const libraryKey = (requestedIds.length ? requestedIds : computerIds).join('|');
  const library = useMemo(() => libraryKey.split('|').map(id => projectsById.get(id)), [libraryKey]);
  const [selectedId, setSelectedId] = useState(() => library.some(project => project.id === projectId) ? projectId : library[0].id);
  const [reel, setReel] = useState(null);
  const dialog = useRef(null), closeButton = useRef(null), detail = useRef(null);
  const nextNote = useRef(null), advanceFocus = useRef(false), endGesture = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId(), detailId = useId(), projectTitleId = useId();
  const selected = library.find(project => project.id === selectedId) || library[0];
  const nextProject = library[library.findIndex(project => project.id === selected.id) + 1];
  const single = library.length === 1;
  const heading = typeof title === 'string' && title.trim() ? title.trim() : single ? selected.title : 'Capybara’s computer';
  const video = selected.moreVideos?.some(clip => clip.url === reel) ? reel : selected.video || selected.moreVideos?.[0]?.url;
  const videoProject = Boolean(video && !selected.embedUrl && !selected.previewUrl);
  const advance = useRef(null);
  advance.current = () => {
    if (!nextProject) return;
    advanceFocus.current = true;
    select(nextProject.id);
  };
  endGesture.current = {enabled: Boolean(nextProject), projectKey: selected.id};

  useEffect(() => attachProjectEndGesture({
    element: detail.current,
    readState: () => endGesture.current,
    onAdvance: () => advance.current?.(),
    onProgress: progress => nextNote.current?.style.setProperty('--next-pull', String(progress)),
  }), []);

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
    nextNote.current?.style.setProperty('--next-pull', '0');
    dialog.current?.querySelector('.computer-projects__card[aria-pressed="true"]')
      ?.scrollIntoView({block: 'nearest', inline: 'nearest'});
    if (advanceFocus.current && detail.current) {
      advanceFocus.current = false;
      detail.current.focus({preventScroll: true});
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        detail.current.animate([{opacity: .55, transform: 'translateY(10px)'}, {opacity: 1, transform: 'translateY(0)'}], {duration: 220, easing: 'ease-out'});
      }
    }
  }, [selected.id]);

  function select(id) {
    setSelectedId(id);
    setReel(null);
  }

  useEffect(() => {
    const element = detail.current;
    const preview = element?.querySelector('.computer-projects__media-column--embed');
    if (!preview || !selected.gallery?.length) return;
    // Tall portrait previews scroll naturally until their bottom fits the
    // viewport, then stay beside the design notes instead of leaving a gap.
    const fitPreview = () => element.style.setProperty('--project-preview-top', `${Math.min(0, element.clientHeight - preview.offsetHeight - 16)}px`);
    const observer = new ResizeObserver(fitPreview);
    observer.observe(element);observer.observe(preview);fitPreview();
    return () => {observer.disconnect();element.style.removeProperty('--project-preview-top');};
  }, [selected.id, selected.gallery]);

  const projectCopy = (
    <div className="computer-projects__copy">
      <section className="computer-projects__story-note">
        {!videoProject && <><p className="computer-projects__type">{selected.type}</p>
        <h2 id={projectTitleId} className={selected.logo ? 'computer-projects__branded-title' : undefined}>{selected.logo && <img className="computer-projects__brand-mark" src={selected.logo} alt="" aria-hidden="true" width="40" height="40"/>}{selected.title}</h2></>}
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
  );

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

        <article className={`computer-projects__detail${videoProject ? ' computer-projects__detail--video' : ''}${selected.previewAspectRatio ? ' computer-projects__detail--capture' : ''}${selected.embedUrl ? ' computer-projects__detail--embed' : ''}${selected.gallery?.length ? ' computer-projects__detail--gallery' : ''}`} ref={detail} id={detailId} tabIndex={-1} aria-labelledby={videoProject && single ? titleId : projectTitleId}>
          {videoProject && !single && <div className="computer-projects__video-heading">
            <p className="computer-projects__type">{selected.type}</p>
            <h2 id={projectTitleId}>{selected.title}</h2>
          </div>}
          {selected.previewAspectRatio && projectCopy}
          <div className={`computer-projects__media-column${selected.embedUrl ? ' computer-projects__media-column--embed' : ''}`}>
            {selected.embedUrl ? <ProjectGameEmbed key={selected.id} project={selected}/>
              : videoProject ? <ProjectVideo key={`${selected.id}-${video}`} src={video} poster={selected.image} label={`${selected.title} gameplay`} aspectRatio={selected.videoAspectRatio} onPlaybackChange={onVideoPlaybackChange}/>
              : <div className={`computer-projects__media${selected.previewAspectRatio ? ' computer-projects__media--capture' : ''}`} style={selected.previewAspectRatio ? {'--project-image-ratio': selected.previewAspectRatio} : undefined}>
                <img src={selected.previewImage || selected.image} alt={selected.previewAlt || `${selected.title} project cover`} style={{objectPosition: selected.imagePosition || 'center'}}/>
              </div>}
            {selected.previewUrl && <a className="computer-projects__preview-link" href={selected.previewUrl} target="_blank" rel="noopener noreferrer">{selected.previewLabel || 'Explore'} ↗</a>}
            {selected.workflow && <p className="computer-projects__workflow-summary">{selected.workflow}</p>}
            {selected.moreVideos?.length > 1 && <nav className="computer-projects__reels" aria-label="Choose a gameplay clip">
              {selected.moreVideos.map(clip => <button key={clip.url} type="button" aria-pressed={video === clip.url} onClick={() => setReel(clip.url)}>{clip.label}</button>)}
            </nav>}
          </div>

          {!selected.previewAspectRatio && projectCopy}
          {selected.workflowEmbedUrl && <ProjectWorkflow key={selected.id} project={selected} onEscape={() => close.current?.()}/>}
          {selected.gallery?.length > 0 && <ProjectGallery key={selected.id} items={selected.gallery} intro={selected.galleryIntro}/>}
          {nextProject && <button ref={nextNote} className="computer-projects__next" data-project-next type="button" onClick={() => advance.current?.()} aria-label={`Open next project: ${nextProject.title}`}>
            <span className="computer-projects__next-copy"><small>Next up</small><strong>{nextProject.title}</strong><span>Scroll or swipe down again to continue</span></span>
            <span className="computer-projects__next-arrow" aria-hidden="true">↓</span>
          </button>}
        </article>
      </div>
      <span className="computer-projects__announcement" role="status" aria-live="polite">{selected.title} selected.</span>
    </section>
  </div>;
}
