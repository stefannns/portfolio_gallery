/* Game-owned copy dismissal only: no synthetic input, progress or physics writes. */
(() => {
  'use strict';
  const script = document.currentScript;
  const actionRoot = script?.dataset.actionRoot;
  if (!actionRoot) return;
  const arrowButtons = script.dataset.arrowButtons || '';
  const ignored = script.dataset.ignore || '';
  const arrowKeys = script.dataset.arrowKeys === 'true';
  const html = document.documentElement;
  const hosted = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !hosted, used = false;
  const element = target => target && typeof target.closest === 'function' ? target : null;
  const unrelated = target => !!target.closest('input,select,textarea,a,[contenteditable="true"],[role="button"],[data-settings]');
  function dismiss() {
    if (used) return;
    used = true;
    html.setAttribute('data-guide-action-used', 'true');
  }
  function pointer(event) {
    if (!active || used || event.isTrusted === false || event.isPrimary === false || (event.button != null && event.button !== 0)) return;
    const target = element(event.target);
    if (!target || unrelated(target) || (ignored && target.closest(ignored))) return;
    const arrow = arrowButtons && target.closest(arrowButtons);
    if (target.closest('button') && !arrow) return;
    if (arrow || target.closest(actionRoot)) dismiss();
  }
  function key(event) {
    if (!arrowKeys || !active || used || event.isTrusted === false || !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;
    const target = element(event.target);
    if (target && (unrelated(target) || target.closest('input,select,textarea,button'))) return;
    dismiss();
  }
  function message(event) {
    if (!hosted || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
  }
  document.addEventListener('pointerdown', pointer, {capture:true, passive:true});
  if (arrowKeys) document.addEventListener('keydown', key, {capture:true, passive:true});
  addEventListener('message', message);
  addEventListener('pagehide', () => {
    document.removeEventListener('pointerdown', pointer, true);
    document.removeEventListener('keydown', key, true);
    removeEventListener('message', message);
  }, {once:true});
})();
