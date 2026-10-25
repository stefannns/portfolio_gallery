import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import './room-welcome.css';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const pointString = point => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
const offsetPoint = (point, axis, amount) => ({x: point.x + axis.x * amount, y: point.y + axis.y * amount});

function outlinePath({left, top, width, height}, tail) {
  const right = left + width, bottom = top + height;
  const radius = Math.min(23, width / 2, height / 2);
  const tailSegment = edge => {
    if (tail?.edge !== edge) return '';
    const {base, tip, direction, halfWidth} = tail;
    const tangent = edge === 'top' ? {x: 1, y: 0} : edge === 'right' ? {x: 0, y: 1}
      : edge === 'bottom' ? {x: -1, y: 0} : {x: 0, y: -1};
    const first = offsetPoint(base, tangent, -halfWidth), last = offsetPoint(base, tangent, halfWidth);
    const beforeTip = offsetPoint(tip, tangent, -.8), afterTip = offsetPoint(tip, tangent, .8);
    const firstControl = offsetPoint(first, tangent, 6), lastControl = offsetPoint(last, tangent, -6);
    const tipControlIn = offsetPoint(beforeTip, direction, -6), tipControlOut = offsetPoint(afterTip, direction, -6);
    const roundedPoint = offsetPoint(tip, direction, .8);
    return `L ${pointString(first)} C ${pointString(firstControl)} ${pointString(tipControlIn)} ${pointString(beforeTip)} Q ${pointString(roundedPoint)} ${pointString(afterTip)} C ${pointString(tipControlOut)} ${pointString(lastControl)} ${pointString(last)}`;
  };
  return `M ${left + radius} ${top} ${tailSegment('top')} L ${right - radius} ${top}
    Q ${right} ${top} ${right} ${top + radius} ${tailSegment('right')} L ${right} ${bottom - radius}
    Q ${right} ${bottom} ${right - radius} ${bottom} ${tailSegment('bottom')} L ${left + radius} ${bottom}
    Q ${left} ${bottom} ${left} ${bottom - radius} ${tailSegment('left')} L ${left} ${top + radius}
    Q ${left} ${top} ${left + radius} ${top} Z`;
}

/** The centered body and its short direction cue share one continuous contour. */
export function getCenteredWelcomeLayout(anchor, measured = {}) {
  const sceneScale = Math.max(.01, finite(anchor?.sceneScale, 1));
  const viewportWidth = Math.max(1, finite(anchor?.width, measured.width || 640)) / sceneScale;
  const viewportHeight = Math.max(1, finite(anchor?.height, measured.height || 640)) / sceneScale;
  const width = Math.max(1, Math.min(560, viewportWidth - 32 / sceneScale));
  const height = Math.min(measured.bubbleHeight || 160, Math.max(1, viewportHeight - 32 / sceneScale));
  const left = (viewportWidth - width) / 2, top = (viewportHeight - height) / 2;
  const right = left + width, bottom = top + height;
  const center = {x: viewportWidth / 2, y: viewportHeight / 2};
  const speaker = {x: finite(anchor?.x, center.x * sceneScale) / sceneScale, y: finite(anchor?.y, center.y * sceneScale) / sceneScale};
  const layout = {viewportWidth, viewportHeight, sceneScale, width, height, left, top, speaker, tail: null};

  if (!(speaker.x >= left && speaker.x <= right && speaker.y >= top && speaker.y <= bottom)) {
    const dx = speaker.x - center.x, dy = speaker.y - center.y;
    const horizontal = Math.abs(dx) / (width / 2) > Math.abs(dy) / (height / 2);
    const edge = horizontal ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'top' : 'bottom';
    const scale = horizontal ? (width / 2) / Math.abs(dx) : (height / 2) / Math.abs(dy);
    const intersection = {x: center.x + dx * scale, y: center.y + dy * scale};
    const radius = Math.min(23, width / 2, height / 2);
    const straightLength = (horizontal ? height : width) - radius * 2;
    const halfWidth = Math.min(14, Math.max(0, straightLength / 2 - 2));
    const padding = radius + halfWidth;
    const base = horizontal
      ? {x: edge === 'left' ? left : right, y: clamp(intersection.y, top + padding, bottom - padding)}
      : {x: clamp(intersection.x, left + padding, right - padding), y: edge === 'top' ? top : bottom};
    const distance = Math.hypot(speaker.x - base.x, speaker.y - base.y);
    if (distance >= 28 && halfWidth >= 5) {
      const direction = {x: (speaker.x - base.x) / distance, y: (speaker.y - base.y) / distance};
      layout.tail = {edge, base, direction, halfWidth, length: 20, tip: offsetPoint(base, direction, 20)};
    }
  }
  layout.path = outlinePath(layout, layout.tail);
  return layout;
}

export default function RoomWelcome({reducedMotion = false, anchor, closing = false, onExited}) {
  const overlay = useRef(null), bubble = useRef(null);
  const [measured, setMeasured] = useState({width: 0, height: 0, bubbleHeight: 160});
  const position = getCenteredWelcomeLayout(anchor, measured);
  const fadeDuration = reducedMotion ? 160 : 1000;

  useEffect(() => {
    if (!closing) return;
    const timeout = window.setTimeout(() => onExited?.(), fadeDuration);
    return () => window.clearTimeout(timeout);
  }, [closing, fadeDuration, onExited]);

  useLayoutEffect(() => {
    const measure = () => {
      if (!overlay.current || !bubble.current) return;
      const next = {width: overlay.current.clientWidth, height: overlay.current.clientHeight, bubbleHeight: bubble.current.offsetHeight};
      setMeasured(previous => previous.width === next.width && previous.height === next.height && previous.bubbleHeight === next.bubbleHeight ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(overlay.current);observer.observe(bubble.current);
    return () => observer.disconnect();
  }, []);

  return <div ref={overlay} className={`room-welcome${reducedMotion ? ' room-welcome--still' : ''}${closing ? ' room-welcome--leaving' : ''}`}
    style={{'--welcome-fade-duration': `${fadeDuration}ms`}} data-scene-scale={position.sceneScale} data-welcome-state={closing ? 'leaving' : 'visible'}>
    <div className="room-welcome__plane" style={{width: position.viewportWidth, height: position.viewportHeight, transform: `scale(${position.sceneScale})`, '--welcome-viewport-height': `${position.viewportHeight}px`}}>
    <svg className="room-welcome__shape" aria-hidden="true"
      viewBox={`0 0 ${position.viewportWidth} ${position.viewportHeight}`} preserveAspectRatio="none"
      data-tail-tip-x={position.tail?.tip.x} data-tail-tip-y={position.tail?.tip.y} data-tail-length={position.tail?.length || 0}>
      <path className="room-welcome__outline" d={position.path}/>
    </svg>
    <section ref={bubble} className="room-welcome__bubble" role="status" aria-live="polite" aria-atomic="true"
      data-placement="center" data-compact={position.width < 340}
      data-anchor-x={position.speaker.x} data-anchor-y={position.speaker.y} data-tail-edge={position.tail?.edge || 'hidden'}
      style={{left: position.left, top: position.top, width: position.width}}>
      <div className="room-welcome__content">
        <h1 id="kitchen-welcome-title">Welcome to my kitchen!</h1>
        <p id="kitchen-welcome-copy">look around to see what I've been making</p>
      </div>
    </section>
    <div className="room-welcome__controls" id="kitchen-welcome-controls" role="note" aria-label="Controls"
      data-controls-gap={position.tail?.edge === 'bottom' ? 32 : 15}
      style={{top: position.top + position.height + (position.tail?.edge === 'bottom' ? 32 : 15)}}>
      <span className="room-controls--keyboard"><kbd>WASD</kbd><span>or click the floor to move</span></span>
      <span className="room-controls--touch">Joystick or tap the floor to move</span>
      <span className="room-controls--keyboard"><kbd>E</kbd><span>or click to inspect</span></span>
      <span className="room-controls--touch">Tap an object to inspect</span>
    </div>
    </div>
  </div>;
}
