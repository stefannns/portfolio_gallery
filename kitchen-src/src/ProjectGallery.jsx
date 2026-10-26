import React, {useEffect, useId, useState} from 'react';
import './project-gallery.css';

const emptyItems = Object.freeze([]);

export default function ProjectGallery({
  items = emptyItems,
  title = 'From the workbench',
  intro = 'The tools and design work behind the game.',
}) {
  const [selectedId, setSelectedId] = useState(() => items?.[0]?.id);
  const headingId = useId(), imageId = useId();
  const screenshots = Array.isArray(items) ? items.filter(item => item?.src) : emptyItems;
  const selected = screenshots.find(item => item.id === selectedId) || screenshots[0];

  useEffect(() => {setSelectedId(items?.[0]?.id);}, [items]);

  if (!selected) return null;

  return <section className="project-gallery" aria-labelledby={headingId}>
    <header className="project-gallery__header">
      <h3 id={headingId}>{title}</h3>
      {intro && <p>{intro}</p>}
    </header>

    <div className="project-gallery__choices" role="group" aria-label="Choose a workbench screenshot">
      {screenshots.map(item => <button
        key={item.id}
        type="button"
        aria-pressed={item.id === selected.id}
        aria-controls={imageId}
        onClick={() => setSelectedId(item.id)}
      >{item.title}</button>)}
    </div>

    <figure className="project-gallery__figure" id={imageId}>
      <a className="project-gallery__image-link" href={selected.src} target="_blank" rel="noopener noreferrer"
        aria-label={`Open full image: ${selected.title} (opens in a new tab)`}>
        <img key={selected.src} src={selected.src} alt={selected.alt || selected.title}
          width={selected.width} height={selected.height} loading="lazy" decoding="async"/>
        <span className="project-gallery__open">Open full image <span aria-hidden="true">↗</span></span>
      </a>
      <figcaption className="project-gallery__caption" aria-live="polite" aria-atomic="true">
        <h4>{selected.title}</h4>
        {selected.caption && <p>{selected.caption}</p>}
      </figcaption>
    </figure>
  </section>;
}
