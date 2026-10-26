const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const formTags = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const axis = value => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;

/** Own releases even when a project dialog stops bubbling keyboard events. */
export function attachRoomMovementInput({windowTarget, documentTarget, engine, readState, cancelRoute, clear, focusStage}) {
  const down = event => {
    const state = readState();
    if (event.key === 'Escape' && state.dragging) {event.preventDefault();state.finishDrag(false);return;}
    const target = event.target;
    if (event.defaultPrevented || formTags.has(target?.tagName) || target?.isContentEditable
      || target?.closest?.('[role="dialog"]') || state.paused || engine.paused || documentTarget.hidden) return;
    if (event.code === 'KeyE') {
      if (state.editable || event.repeat) return;
      event.preventDefault();
      if (!state.inspectNearby()) state.onStatus('Move closer to inspect.');
      return;
    }
    if (!movementCodes.has(event.code)) return;
    // A held key from before a modal/blur must be released and pressed again.
    if (event.repeat && !engine.keys.has(event.code)) return;
    event.preventDefault();cancelRoute();focusStage?.(target);engine.keys.add(event.code);
  };
  const up = event => engine.keys.delete(event.code);
  const joystick = event => {
    const state = readState();
    const blocked = state.paused || engine.paused || state.dragging || documentTarget.hidden;
    engine.joystick.x = blocked ? 0 : axis(event.detail?.x);
    engine.joystick.z = blocked ? 0 : axis(event.detail?.z);
    if (Math.hypot(engine.joystick.x, engine.joystick.z) > .04) cancelRoute();
  };
  windowTarget.addEventListener('keydown', down);
  windowTarget.addEventListener('keyup', up, true);
  windowTarget.addEventListener('blur', clear);
  windowTarget.addEventListener('room-joystick', joystick);
  documentTarget.addEventListener('visibilitychange', clear);
  return () => {
    windowTarget.removeEventListener('keydown', down);
    windowTarget.removeEventListener('keyup', up, true);
    windowTarget.removeEventListener('blur', clear);
    windowTarget.removeEventListener('room-joystick', joystick);
    documentTarget.removeEventListener('visibilitychange', clear);
    clear();
  };
}
