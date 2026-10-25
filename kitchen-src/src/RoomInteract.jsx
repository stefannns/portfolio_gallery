import React from 'react';
import './room-interact.css';

/** A nearby-only touch action; the room rechecks range when it is pressed. */
export default function RoomInteract({target, onInspect}) {
  if (!target?.id) return null;

  return <div key={target.id} className="room-interact" data-inspect-target={target.id}>
    <button type="button" className="room-interact__button"
      aria-label={`Inspect ${target.label || 'nearby object'}`}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {event.stopPropagation();onInspect?.();}}>
      <span className="room-interact__surface" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" focusable="false">
          <circle cx="10.5" cy="10.5" r="6.25"/>
          <path d="m15.2 15.2 5 5"/>
        </svg>
      </span>
      <span className="room-interact__label" aria-hidden="true">Inspect</span>
    </button>
  </div>;
}
