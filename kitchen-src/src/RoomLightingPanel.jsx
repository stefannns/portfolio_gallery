import React, {useEffect, useId, useRef, useState} from 'react';
import {ROOM_LIGHTING_DEFAULTS, sanitizeRoomLightingSettings} from './room-lighting-settings.js';
import './room-lighting-panel.css';

const sliders = [
  {key: 'exposure', label: 'Brightness', min: .5, max: 1.35},
  {key: 'warmth', label: 'Warmth', min: 0, max: 1},
  {key: 'fill', label: 'Fill light', min: .3, max: 1.7},
  {key: 'shadowStrength', label: 'Shadows', min: 0, max: 1},
  {key: 'saturation', label: 'Saturation', min: .6, max: 1.4},
];

/** Mounted only by the local lighting preview; the scene owns the settings. */
export default function RoomLightingPanel({settings, onChange, onReset, onCopy}) {
  const values = sanitizeRoomLightingSettings(settings);
  const [expanded, setExpanded] = useState(true);
  const [message, setMessage] = useState('');
  const [copying, setCopying] = useState(false);
  const prefix = useId(), bodyId = `${prefix}-controls`;
  const heading = useRef(null), noticeTimer = useRef(null), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;clearTimeout(noticeTimer.current);};
  }, []);
  const notice = text => {
    if (!mounted.current) return;
    clearTimeout(noticeTimer.current);setMessage(text);
    noticeTimer.current = setTimeout(() => {if (mounted.current) setMessage('');}, 2600);
  };
  const change = (key, value) => onChange?.(sanitizeRoomLightingSettings({...values, [key]: value}));
  const copy = async () => {
    if (copying) return;
    setCopying(true);
    try {
      if (onCopy) await onCopy(values);
      else await navigator.clipboard.writeText(JSON.stringify(values, null, 2));
      notice('Settings copied.');
    } catch {notice('Copy unavailable. Please try again.');}
    finally {if (mounted.current) setCopying(false);}
  };
  const stop = event => event.stopPropagation();

  return <aside className={`room-lighting-panel${expanded ? '' : ' room-lighting-panel--collapsed'}`} aria-label="Scene lighting controls"
    onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onClick={stop} onWheel={stop}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' && expanded) {setExpanded(false);heading.current?.focus({preventScroll: true});}
    }} onKeyUp={stop}>
    <button ref={heading} type="button" className="room-lighting-panel__toggle" aria-expanded={expanded} aria-controls={bodyId}
      aria-label={`${expanded ? 'Hide' : 'Show'} lighting controls`} onClick={() => setExpanded(current => !current)}>
      <span>{expanded ? 'Lighting & color' : 'Lighting'}</span>{expanded && <small>preview</small>}
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>
    </button>
    {expanded && <div id={bodyId} className="room-lighting-panel__body">
      <p className="room-lighting-panel__hint">Preview settings stay on this device.</p>
      <div className="room-lighting-panel__fields">
        {sliders.map(({key, label, min, max}) => <div className="room-lighting-panel__field" key={key}>
          <div className="room-lighting-panel__label"><label htmlFor={`${prefix}-${key}`}>{label}</label><output htmlFor={`${prefix}-${key}`}>{Math.round(values[key] * 100)}%</output></div>
          <input id={`${prefix}-${key}`} type="range" min={min} max={max} step="0.01" value={values[key]}
            onChange={event => change(key, Number(event.target.value))}/>
        </div>)}
        <div className="room-lighting-panel__field">
          <div className="room-lighting-panel__label"><label htmlFor={`${prefix}-background`}>Backdrop</label><output htmlFor={`${prefix}-background`}>{values.background}</output></div>
          <input id={`${prefix}-background`} type="color" value={values.background} onChange={event => change('background', event.target.value)}/>
        </div>
      </div>
      <div className="room-lighting-panel__actions">
        <button type="button" onClick={() => {if (onReset) onReset();else onChange?.({...ROOM_LIGHTING_DEFAULTS});notice('Lighting reset.');}}>Reset</button>
        <button type="button" disabled={copying} onClick={copy}>{copying ? 'Copying…' : 'Copy settings'}</button>
      </div>
      <p className="room-lighting-panel__notice" role="status" aria-live="polite">{message}</p>
    </div>}
  </aside>;
}
