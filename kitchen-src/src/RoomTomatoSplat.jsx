import React, {useEffect} from 'react';
import './room-tomato-splat.css';

export const TOMATO_SPLAT_IMAGE = '/images/scene/tomato-splat-cartoon-v3.png';

/** A brief, non-blocking tomato-on-the-lens gag. */
export default function RoomTomatoSplat({reducedMotion = false, onDone}) {
  useEffect(() => {const timer = setTimeout(onDone, reducedMotion ? 600 : 1000);return () => clearTimeout(timer);}, [onDone, reducedMotion]);
  return <div className={`room-tomato-splat${reducedMotion ? ' room-tomato-splat--still' : ''}`} aria-hidden="true" data-tomato-splat="true"
    onAnimationEnd={event => {if (event.target === event.currentTarget) onDone?.();}}>
    <img src={TOMATO_SPLAT_IMAGE} alt="" draggable="false"/>
  </div>;
}
