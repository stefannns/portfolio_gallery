import React, {useEffect, useId, useState} from 'react';
import './project-gallery.css';

const emptyItems = Object.freeze([]);

function WorkbenchImage({item}) {
  return <a className={`project-gallery__image-link${item.presentation === 'model' ? ' project-gallery__image-link--model' : ''}`} href={item.src} target="_blank" rel="noopener noreferrer"
    aria-label={`Open full image: ${item.title} (opens in a new tab)`}>
    <img key={item.src} src={item.src} alt={item.alt || item.title}
      width={item.width} height={item.height} loading="lazy" decoding="async"/>
    <span className="project-gallery__open">Open full image <span aria-hidden="true">↗</span></span>
  </a>;
}

function WorkbenchCaption({item}) {
  return <figcaption className="project-gallery__caption">
    <h4>{item.title}</h4>
    {item.caption && <p>{item.caption}</p>}
  </figcaption>;
}

export default function ProjectGallery({
  items = emptyItems,
  title = 'From the workbench',
  intro = 'The tools and design work behind the game.',
}) {
  const [selectedId, setSelectedId] = useState(() => items?.[0]?.id);
  const headingId = useId(), imageId = useId();
  const screenshots = Array.isArray(items) ? items.filter(item => item?.src || item?.images?.some(image => image?.src)) : emptyItems;
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

    <p className="computer-projects__announcement" role="status">{selected.title}</p>
    {selected.images?.length ? <section className="project-gallery__group" id={imageId} aria-label={selected.title}>
      {selected.caption && <p className="project-gallery__group-intro">{selected.caption}</p>}
      <div className={`project-gallery__model-grid${selected.layout === 'stacked' ? ' project-gallery__model-grid--stacked' : ''}`}>
        {selected.images.filter(item => item?.src).map(item => <figure className="project-gallery__figure" key={item.id || item.src}>
          <WorkbenchImage item={item}/>
          <WorkbenchCaption item={item}/>
        </figure>)}
      </div>
    </section> : <figure className="project-gallery__figure" id={imageId}>
      <WorkbenchImage item={selected}/>
      <WorkbenchCaption item={selected}/>
    </figure>}

  </section>;
}
