import React, {useEffect, useId, useRef} from 'react';

/** The workflow is an interactive document; it does not affect video playback. */
export default function ProjectWorkflow({project, onEscape}) {
  const frame = useRef(null);
  const escape = useRef(onEscape);
  const headingId = useId();
  const [workflowUrl, fragment] = project.workflowEmbedUrl.split('#', 2);
  const iframeSrc = `${workflowUrl}${workflowUrl.includes('?') ? '&' : '?'}present=1&theme=light${fragment ? `#${fragment}` : ''}`;
  escape.current = onEscape;

  useEffect(() => {
    const receive = event => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'portfolio-workflow:escape') return;
      escape.current?.();
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  return <section className="computer-projects__workflow" aria-labelledby={headingId}>
    <header className="computer-projects__workflow-header">
      <h3 id={headingId}>AI workflow</h3>
      <a href={project.workflowEmbedUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${project.title} AI workflow in a new tab`}>Open workflow ↗</a>
    </header>
    <iframe ref={frame} src={iframeSrc} title={`${project.title} — AI workflow`}
      loading="lazy" sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer"/>
  </section>;
}
