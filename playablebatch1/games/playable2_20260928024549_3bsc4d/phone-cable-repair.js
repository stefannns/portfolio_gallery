(() => {
  const style = document.createElement('style');
  style.textContent = `
    @font-face {
      font-family: 'Bangers';
      src: url('./assets/fonts/bangers/Bangers-Regular.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    :root {
      --font-display: "Bangers", "PingFang SC", system-ui, sans-serif;
      --font-body: -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
      --font-mono: ui-monospace, Menlo, monospace;
      --bg-color: #121212;
      --phone-border: #333;
      --color-green: #4ade80;
      --color-red: #f87171;
      --color-yellow: #facc15;
      --color-gray: #9ca3af;
    }
    html, body, #root {
      width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden;
      background: var(--bg-color); user-select: none; -webkit-user-select: none; touch-action: none;
    }
    * { box-sizing: border-box; }
  `;
  document.head.appendChild(style);

  const sizeCable = () => {
    const head = document.querySelector('img[alt="cable"]');
    if (!head) return false;
    const moving = head.parentElement;
    const anchor = moving?.parentElement;
    if (!moving || !anchor) return false;
    anchor.style.bottom = '0';
    anchor.style.transformOrigin = 'bottom center';
    const originalLine = head.previousElementSibling;
    if (originalLine) originalLine.style.display = 'none';
    head.style.display = 'block';
    head.style.top = 'auto';
    head.style.bottom = 'calc(72px + env(safe-area-inset-bottom, 0px))';
    head.style.left = '50%';
    head.style.width = '32px';
    head.style.height = '46px';
    head.style.objectFit = 'contain';
    head.style.zIndex = '2';
    moving.style.zIndex = '2';
    const wire = document.createElement('div');
    wire.style.cssText = 'position:absolute;bottom:0;left:0;width:16px;height:calc(var(--cable-rise, 0px) + 72px + env(safe-area-inset-bottom, 0px));background:linear-gradient(90deg,#475569 0%,#f8fafc 42%,#cbd5e1 62%,#64748b 100%);border:1px solid #334155;border-radius:8px;box-shadow:0 0 8px rgba(255,255,255,.28);z-index:1;pointer-events:none';
    anchor.insertBefore(wire, moving);
    const syncWire = () => {
      if (!anchor.isConnected) return;
      const rise = Math.max(0, Number.parseFloat(moving.style.transform.match(/translateY\(-([\d.]+)px\)/)?.[1] || '0'));
      wire.style.setProperty('--cable-rise', `${Math.ceil(rise)}px`);
      requestAnimationFrame(syncWire);
    };
    syncWire();
    return true;
  };
  if (!sizeCable()) {
    const observer = new MutationObserver(() => {
      if (sizeCable()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
