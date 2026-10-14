/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';
  const script = document.currentScript;
  const selector = script?.getAttribute('data-subject') || '#root canvas';
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let observer, animation, entered = false;
  function stop() { animation?.cancel(); animation = null; }
  function enter() {
    if (entered || document.hidden) return;
    const subject = document.querySelector(selector);
    if (!subject || subject.closest('[hidden], [aria-hidden="true"]')) return;
    const computed = window.getComputedStyle(subject);
    if (computed.display === 'none' || computed.visibility === 'hidden') return;
    if (subject.tagName === 'IMG' && !subject.complete) {
      subject.addEventListener('load', enter, { once: true });
      return;
    }
    entered = true;
    observer?.disconnect();
    if (media?.matches) return;
    const opacity = Number(window.getComputedStyle(subject).opacity) || 1;
    if (typeof subject.animate === 'function') {
      animation = subject.animate([{ opacity: opacity * .76 }, { opacity }], { duration: 650, easing: 'ease-out' });
      animation.onfinish = () => { animation = null; };
    }
  }
  observer = new MutationObserver(enter);
  observer.observe(document.body, { childList: true, subtree: true });
  enter();
  document.addEventListener('visibilitychange', () => {
    document.documentElement.toggleAttribute('data-feed-background', document.hidden);
    if (document.hidden) stop(); else enter();
  });
  window.addEventListener('pagehide', () => { observer.disconnect(); stop(); });
  window.addEventListener('pageshow', () => {
    if (!entered) observer.observe(document.body, { childList: true, subtree: true });
    enter();
  });
  document.addEventListener('pointerdown', stop, { capture: true, passive: true });
  media?.addEventListener?.('change', () => { if (media.matches) stop(); });
})();
