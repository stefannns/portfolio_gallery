(() => {
  const colors = {
    'var(--bg-color)': '#fdfbf7',
    'var(--color-obstacle)': '#f2a84b',
    'var(--color-soda)': '#25b8d2',
    'var(--color-primary)': '#243447'
  };
  for (const property of ['fillStyle', 'strokeStyle', 'shadowColor']) {
    const descriptor = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, property);
    if (!descriptor || !descriptor.set || !descriptor.get) continue;
    Object.defineProperty(CanvasRenderingContext2D.prototype, property, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        return descriptor.set.call(this, colors[value] || value);
      }
    });
  }

  const prepareCanvas = canvas => {
    if (!canvas || canvas.dataset.dragRepaired) return false;
    canvas.dataset.dragRepaired = 'true';
    canvas.style.touchAction = 'none';
    canvas.style.pointerEvents = 'auto';
    canvas.addEventListener('pointerdown', event => {
      if (event.isPrimary === false) return;
      event.preventDefault();
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
    }, { capture: true, passive: false });
    const release = event => {
      try {
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      } catch (_) {}
    };
    canvas.addEventListener('pointerup', release, true);
    canvas.addEventListener('pointercancel', release, true);
    return true;
  };
  if (!prepareCanvas(document.querySelector('canvas'))) {
    const observer = new MutationObserver(() => {
      if (prepareCanvas(document.querySelector('canvas'))) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
