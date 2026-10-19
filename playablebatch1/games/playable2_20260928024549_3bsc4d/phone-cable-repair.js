(() => {
  const style = document.createElement('style');
  style.textContent = `
    @font-face {
      font-family: 'Poppins';
      src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Poppins';
      src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    :root {
      --font-display: "Poppins", "Helvetica Neue", "PingFang SC", sans-serif;
      --font-body: var(--font-display);
      --font-mono: var(--font-display);
      --bg-color: #e5f1ed;
      --phone-border: #333;
      --color-green: #4ade80;
      --color-red: #f87171;
      --color-yellow: #facc15;
      --color-gray: #c7ddd5;
    }
    html, body, #root {
      width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden;
      background: var(--bg-color); user-select: none; -webkit-user-select: none; touch-action: none;
      font-family: var(--font-body);
      font-weight: 400;
      -webkit-font-smoothing: antialiased;
    }
    button { font-family: var(--font-body); font-weight: 700; }
    * { box-sizing: border-box; }
    .phone-speaker { position:absolute;top:10px;width:34%;height:10px;background:#041114;border-radius:8px; }
    .charge-ring { width:66%;max-width:140px;flex-shrink:0;overflow:visible; }
    .charge-bolt { opacity:.55; }
    [data-charging="true"] .charge-ring { filter:drop-shadow(0 0 6px #70e9a366); }
    [data-charging="true"] .charge-bolt { opacity:1;animation:charge-pulse .8s ease-in-out infinite alternate; }
    @keyframes charge-pulse { to { opacity:.6; } }
    .charging-game:focus-visible { outline:3px solid #287966;outline-offset:-4px; }
    @media (prefers-reduced-motion:reduce) { .charge-bolt { animation:none!important; } }
    @media (max-height:450px) { .charging-phone { width:min(30cqw,37cqh)!important;top:18px!important; } .charge-ring {width:48%;} .charging-phone > div {font-size:16px!important;margin-top:4px!important;} .charging-game .feed-first-action {left:62%!important;right:12px!important;top:35%!important;} }
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
