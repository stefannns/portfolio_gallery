/* Decorative, game-specific guidance. Never dispatches input or changes game state. */
(() => {
  'use strict';
  const mode = document.currentScript?.getAttribute('data-entry-demo');
  if (!['face', 'one-stroke', 'dumpling'].includes(mode)) return;
  const html = document.documentElement;
  const host = !!document.querySelector('script[src*="playable-batch/review-host.js"]') || new URLSearchParams(location.search).get('feedReview') === '1';
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let interacted = false, active = !host, layer = null, board = null, resize = null, compactGuide = null;
  const animations = [];
  html.toggleAttribute('data-entry-feed-preview', host);
  const style = document.createElement('style');
  style.textContent = `
    .entry-demo-layer{position:absolute;inset:0;pointer-events:none;overflow:visible;z-index:8}
    .entry-demo-layer svg{display:block;width:100%;height:100%;overflow:visible}
    .entry-demo-guide-path{fill:none;stroke:var(--primary,#6c5ce7);stroke-width:8;stroke-linecap:round;stroke-linejoin:round;opacity:.78}
    .entry-demo-bun{position:absolute;width:40px;height:40px;object-fit:contain;transform:translate(-50%,-50%);opacity:0;pointer-events:none}
    .entry-demo-cursor{position:absolute;width:18px;height:18px;border:2px solid #6f3218;border-radius:50%;background:#fff9;transform:translate(-50%,-50%);pointer-events:none;opacity:0}
    html[data-entry-feed-preview] .face-game__header{position:absolute;top:12%;left:30px;right:30px;padding:0}
    html[data-entry-feed-preview] .face-game__prompt{font-size:18px;line-height:1.4}
    html[data-entry-feed-preview] #draw-workspace{position:absolute;top:27%;bottom:27%;left:30px;right:30px;padding:0}
    html[data-entry-feed-preview] #draw-toolbar{visibility:hidden}
    html[data-entry-feed-preview] .one-stroke-hud{position:absolute!important;top:12%!important;left:30px!important;right:30px!important;width:auto!important;min-height:42px!important;padding:0!important}
    html[data-entry-feed-preview] .one-stroke-hud button{visibility:hidden}
    html[data-entry-feed-preview] .one-stroke-board{position:absolute!important;inset:28% 30px 32% 30px!important;width:auto!important}
    .entry-demo-copy{display:none;pointer-events:none}
    html[data-entry-feed-preview] .one-stroke-guide{visibility:hidden!important}
    html[data-entry-feed-preview] .entry-demo-copy{display:block;position:absolute;top:70%;left:30px;right:30px;margin:0;font-size:18px;line-height:1.5;font-weight:600;text-align:center;color:var(--text-sub)}
    html[data-entry-feed-preview] .dh-hud{top:12%!important;right:30px!important}
    html[data-entry-feed-preview] .dh-hud span[aria-hidden=true]{display:none}
    html[data-entry-feed-preview] .dh-guide{top:23%!important;right:30px!important}
    html[data-entry-feed-preview] .dh-board{inset:36% 30px 26% 30px!important}
    html[data-entry-feed-preview] .dh-dumpling{width:28px!important;height:28px!important}
    html[data-entry-feed-preview] .dh-guide span{font-size:18px;line-height:1.35}
    html[data-entry-demo-stopped] :is(.entry-demo-layer,.entry-demo-copy){display:none}
    @media(prefers-reduced-motion:reduce){.entry-demo-layer *{animation:none!important}}
  `;
  document.head.append(style);
  const cancel = () => { for (const animation of animations.splice(0)) animation.cancel(); };
  function stop() {
    interacted = true;
    html.setAttribute('data-entry-demo-stopped', '');
    cancel();
    if (layer) layer.hidden = true;
    observer.disconnect();
    resize?.disconnect();
  }
  window.PlayableEntryPreview = { stop };
  function drawLine(points, viewBox, width) {
    layer.innerHTML = `<svg class="entry-demo-svg" viewBox="${viewBox}" aria-hidden="true"><path class="entry-demo-guide-path" stroke-width="${width}"/></svg>`;
    const path = layer.querySelector('path');
    path.setAttribute('d', points);
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
    if (reduced?.matches || typeof path.animate !== 'function') {
      path.style.strokeDashoffset = String(length * .45);
      return;
    }
    animations.push(path.animate([
      { strokeDashoffset: String(length), opacity: .3, offset: 0 },
      { strokeDashoffset: '0', opacity: .85, offset: .65 },
      { strokeDashoffset: '0', opacity: .85, offset: .85 },
      { strokeDashoffset: '0', opacity: 0, offset: 1 },
    ], { duration: 3700, iterations: Infinity, easing: 'linear' }));
  }
  function render() {
    if (!layer || interacted || (host && active)) return;
    cancel();
    layer.hidden = false;
    if (mode === 'face') {
      drawLine('M210 360 C220 245 355 245 370 360 C355 445 220 445 210 360 M520 360 C535 245 670 245 680 360 C665 445 535 445 520 360', '0 0 900 900', 12);
    } else if (mode === 'one-stroke') {
      const lines = [...board.querySelector('svg')?.querySelectorAll('line') || []];
      if (!lines.length) return;
      const point = (line, suffix) => [Number(line.getAttribute('x' + suffix)), Number(line.getAttribute('y' + suffix))];
      const same = (a, b) => a[0] === b[0] && a[1] === b[1];
      const a = point(lines[0], '1'), b = point(lines[0], '2');
      const next = lines.slice(1).find(line => same(point(line, '1'), b) || same(point(line, '2'), b));
      const c = next ? point(next, same(point(next, '1'), b) ? '2' : '1') : b;
      drawLine(`M${a.join(' ')} L${b.join(' ')} L${c.join(' ')}`, `0 0 ${board.clientWidth} ${board.clientHeight}`, 10);
    } else {
      const target = board.querySelector('.dh-dumpling');
      if (!target) return;
      const config = JSON.parse(document.getElementById('playable-inline-config').textContent);
      const opened = config.images.find(image => image.id === 'IMG_MODIFIED')?.path;
      if (!opened) return;
      layer.replaceChildren();
      const image = document.createElement('img'), cursor = document.createElement('span');
      image.className = 'entry-demo-bun'; image.src = opened; image.alt = ''; image.draggable = false;
      cursor.className = 'entry-demo-cursor';
      for (const element of [image, cursor]) { element.style.left = target.style.left; element.style.top = target.style.top; layer.append(element); }
      if (reduced?.matches || typeof image.animate !== 'function') { image.style.opacity = '.65'; return; }
      animations.push(image.animate([{opacity:0,offset:0},{opacity:0,offset:.3},{opacity:1,offset:.4},{opacity:1,offset:.78},{opacity:0,offset:1}],{duration:3200,iterations:Infinity}));
      animations.push(cursor.animate([{opacity:0,offset:0},{opacity:.9,offset:.2},{opacity:.9,offset:.3},{opacity:0,offset:.45},{opacity:0,offset:1}],{duration:3200,iterations:Infinity}));
    }
    if (document.hidden) for (const animation of animations) animation.pause();
  }
  function attach() {
    if (layer || interacted || (host && active)) return;
    board = document.querySelector(mode === 'face' ? '.face-game__canvas-wrap' : mode === 'one-stroke' ? '.one-stroke-board' : '.dh-board');
    if (!board || (mode === 'one-stroke' && !board.querySelector('svg line'))) return;
    layer = document.createElement('div'); layer.className = 'entry-demo-layer'; layer.setAttribute('aria-hidden', 'true');
    board.append(layer);
    if (mode === 'one-stroke' && host && !compactGuide) {
      compactGuide = document.createElement('p'); compactGuide.className = 'entry-demo-copy';
      compactGuide.textContent = "Unisci con un solo tratto";
      board.parentElement.append(compactGuide);
    }
    observer.disconnect();
    resize = new ResizeObserver(render); resize.observe(board);
    render();
  }
  const observer = new MutationObserver(attach);
  observer.observe(document.getElementById('root'), { childList: true, subtree: true });
  attach();
  window.addEventListener('message', event => {
    if (!host || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
    html.toggleAttribute('data-entry-feed-preview', !active);
    if (active) { cancel(); if (layer) layer.hidden = true; }
    else if (!interacted) { attach(); render(); }
  });
  document.addEventListener('visibilitychange', () => {
    for (const animation of animations) document.hidden ? animation.pause() : animation.play();
  });
  reduced?.addEventListener?.('change', render);
  window.addEventListener('pagehide', () => { cancel(); observer.disconnect(); resize?.disconnect(); }, {once:true});
})();
