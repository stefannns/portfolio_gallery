const controls = 'button,a,input,textarea,select,video,iframe,[contenteditable]';
const scrollable = /^(auto|scroll|overlay)$/;

function ignoredTarget(element, target) {
  let node = target?.nodeType === 3 ? target.parentElement : target;
  const control = node?.closest?.(controls);
  // The next-project footer remains a scroll/swipe surface as well as a button.
  if (control && !(control.tagName === 'BUTTON' && control.matches?.('[data-project-next]'))) return true;
  for (; node && node !== element; node = node.parentElement) {
    const style = node.ownerDocument?.defaultView?.getComputedStyle(node);
    if ((scrollable.test(style?.overflowY) && node.scrollHeight > node.clientHeight + 1)
      || (scrollable.test(style?.overflowX) && node.scrollWidth > node.clientWidth + 1)) return true;
  }
  return false;
}

/** Require a new, deliberate overscroll after the reader has reached the bottom. */
export function attachProjectEndGesture({element, readState, onAdvance, onProgress = () => {},
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  idleMs = 180, wheelThreshold = 210, swipeThreshold = 110, cooldownMs = 900}) {
  let wheel = null, touch = null, timer = null, cooldownUntil = -Infinity, progress = -1, disposed = false;
  let projectKey = readState().projectKey;
  const report = value => {
    const next = Math.max(0, Math.min(1, value));
    if (progress !== next) {progress = next;onProgress(next);}
  };
  const atBottom = () => element.scrollTop + element.clientHeight >= element.scrollHeight - 3;
  const state = () => {
    const current = readState();
    if (current.projectKey !== projectKey) {
      projectKey = current.projectKey;
      if (wheel) wheel.eligible = false;
      if (touch) touch.eligible = false;
      report(0);
    }
    return current;
  };
  const prevent = event => {if (event.cancelable !== false) event.preventDefault();};
  const advance = time => {
    cooldownUntil = time + cooldownMs;
    report(0);onAdvance();
  };
  const scheduleIdle = () => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {timer = null;wheel = null;if (!touch) report(0);}, idleMs);
  };
  const onWheel = event => {
    const current = state(), time = now();
    const fresh = !wheel || time - wheel.last >= idleMs;
    if (fresh) {
      wheel = {last: time, amount: 0, consume: false,
        eligible: current.enabled && time >= cooldownUntil && atBottom() && !ignoredTarget(element, event.target)};
      report(0);
    }
    wheel.last = time;scheduleIdle();
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented || ignoredTarget(element, event.target)) {
      wheel.eligible = false;report(0);return;
    }
    // Consume only the remainder of a gesture that has already changed project.
    if (wheel.consume) {prevent(event);return;}
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
    const dy = Number.isFinite(event.deltaY) ? event.deltaY * unit : 0;
    const dx = Number.isFinite(event.deltaX) ? event.deltaX * unit : 0;
    if (!wheel.eligible || !current.enabled || time < cooldownUntil || !atBottom()
      || dy <= 0 || (Math.abs(dx) > 4 && Math.abs(dx) > dy * .75)) {
      wheel.eligible = false;report(0);return;
    }
    // Some browsers make only the first wheel in a burst cancelable. Claim
    // bottom-starting overscroll immediately so its momentum cannot move the next page.
    prevent(event);
    wheel.amount += dy;report(wheel.amount / wheelThreshold);
    if (wheel.amount >= wheelThreshold) {
      prevent(event);wheel.eligible = false;wheel.consume = true;advance(time);
    }
  };
  const onTouchStart = event => {
    const current = state(), point = event.touches?.[0];
    touch = null;report(0);
    if (!point || event.touches.length !== 1) return;
    touch = {id: point.identifier, x: point.clientX, y: point.clientY,
      eligible: current.enabled && now() >= cooldownUntil && atBottom() && !ignoredTarget(element, event.target)};
  };
  const touchDistance = (event, ending) => {
    const current = state();
    if (!touch || !touch.eligible) return null;
    const points = ending ? event.changedTouches : event.touches;
    if (!ending && points?.length !== 1) {touch.eligible = false;report(0);return null;}
    const point = Array.from(points || []).find(value => value.identifier === touch.id);
    if (!point || !current.enabled || now() < cooldownUntil || !atBottom()) {touch.eligible = false;report(0);return null;}
    const up = touch.y - point.clientY, across = Math.abs(point.clientX - touch.x);
    if (up < -12 || (across > 24 && across > Math.max(0, up) * .65)) {
      touch.eligible = false;report(0);return null;
    }
    return up;
  };
  const onTouchMove = event => {
    const up = touchDistance(event, false);
    if (up === null) return;
    // A bottom-starting upward drag past the slop is intentional overscroll.
    if (up >= 24) {prevent(event);report(up / swipeThreshold);}
  };
  const onTouchEnd = event => {
    const up = touchDistance(event, true);
    const intentional = up !== null && up >= swipeThreshold;
    touch = null;report(0);
    if (intentional) {prevent(event);advance(now());}
  };
  const cancelTouch = () => {touch = null;report(0);};
  report(0);
  element.addEventListener('wheel', onWheel, {passive: false});
  element.addEventListener('touchstart', onTouchStart, {passive: true});
  element.addEventListener('touchmove', onTouchMove, {passive: false});
  element.addEventListener('touchend', onTouchEnd, {passive: false});
  element.addEventListener('touchcancel', cancelTouch);
  return () => {
    if (disposed) return;
    disposed = true;
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('touchstart', onTouchStart);
    element.removeEventListener('touchmove', onTouchMove);
    element.removeEventListener('touchend', onTouchEnd);
    element.removeEventListener('touchcancel', cancelTouch);
    if (timer !== null) clearTimer(timer);
    wheel = touch = null;report(0);
  };
}
