import React, {useCallback, useEffect, useRef, useState} from 'react';

const sendInput = (x, z) => window.dispatchEvent(new CustomEvent('room-joystick', {detail: {x, z}}));

export default function RoomJoystick({disabled = false}) {
  const [stick, setStick] = useState({x: 0, y: 0});
  const pointer = useRef(null);
  const release = useCallback(() => {
    pointer.current = null;
    setStick({x: 0, y: 0});
    sendInput(0, 0);
  }, []);

  useEffect(() => {if (disabled) release();}, [disabled, release]);
  useEffect(() => {
    const hidden = () => {if (document.hidden) release();};
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', hidden);
      sendInput(0, 0);
    };
  }, [release]);

  const move = event => {
    const rect = event.currentTarget.getBoundingClientRect(), radius = rect.width * .29;
    const dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
    const distance = Math.hypot(dx, dy), factor = Math.min(1, radius / Math.max(1, distance));
    setStick({x: dx * factor, y: dy * factor});
    const magnitude = Math.max(0, Math.min(1, (distance / radius - .12) / .88));
    sendInput(distance ? dx / distance * magnitude : 0, distance ? dy / distance * magnitude : 0);
  };

  return <div className="room-joystick-wrap">
    <button type="button" className="room-review__joystick" disabled={disabled}
      aria-label="Drag the joystick to walk" data-joystick-active={pointer.current !== null}
      onPointerDown={event => {
        if (disabled || pointer.current !== null || event.button !== 0) return;
        event.preventDefault();event.stopPropagation();pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);move(event);
      }}
      onPointerMove={event => {if (!disabled && pointer.current === event.pointerId) {event.preventDefault();move(event);}}}
      onPointerUp={event => {
        if (pointer.current !== event.pointerId) return;
        event.preventDefault();release();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={event => {if (pointer.current === event.pointerId) release();}}
      onLostPointerCapture={event => {if (pointer.current === event.pointerId) release();}}>
      <span className="room-joystick__track" aria-hidden="true"/>
      <span className="room-joystick__thumb" aria-hidden="true" style={{transform: `translate(${stick.x}px, ${stick.y}px)`}}/>
    </button>
    <span className="room-joystick__label" aria-hidden="true">walk</span>
  </div>;
}
