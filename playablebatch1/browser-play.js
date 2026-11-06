(() => {
  const script = document.currentScript;
  const scriptUrl = new URL(script.src);
  const base = scriptUrl.protocol === 'file:' && script.dataset.localBrowserBase
    ? script.dataset.localBrowserBase
    : scriptUrl;
  const pageUrl = new URL('./browser-play.html', base);

  function urlFor(game, feedUrl, restrictToPool) {
    const url = new URL(pageUrl);
    const feed = new URL(feedUrl);
    url.searchParams.set('game', game.taskId);
    url.searchParams.set('lang', feed.searchParams.get('lang') === 'it' ? 'it' : 'en');
    const pool = feed.searchParams.get('reviewPool');
    if (restrictToPool && pool) url.searchParams.set('reviewPool', pool);
    url.searchParams.set('v', 'fyp-1');
    return url.href;
  }
  window.PlayableBrowser = {urlFor};

  const player = document.getElementById('browser-player');
  if (!player) return;

  const params = new URLSearchParams(location.search);
  const task = params.get('game');
  const message = document.getElementById('browser-message');
  if (!task || !/^[a-z0-9_-]+$/i.test(task)) {
    message.textContent = 'Choose a game from the Playable review page to open its For You feed.';
    return;
  }

  const fit = document.getElementById('browser-fit');
  const frame = document.getElementById('browser-feed');
  const feed = new URL(frame.dataset.feedRuntime, pageUrl);
  const language = params.get('lang') === 'it' ? 'it' : 'en';
  const pool = params.get('reviewPool');
  feed.searchParams.set('review', 'batch');
  feed.searchParams.set('feed', 'playable-batch-' + task);
  feed.searchParams.set('lang', language);
  if (pool) feed.searchParams.set('reviewPool', pool);

  const logicalWidth = 390;
  const logicalHeight = 844;

  // Scale the full phone viewport, including the original feed chrome.
  function resize() {
    const scale = Math.min(player.clientWidth / logicalWidth, player.clientHeight / logicalHeight);
    fit.style.width = logicalWidth * scale + 'px';
    fit.style.height = logicalHeight * scale + 'px';
    frame.style.transform = `scale(${scale})`;
  }

  document.documentElement.lang = language;
  frame.style.width = logicalWidth + 'px';
  frame.style.height = logicalHeight + 'px';
  message.hidden = true;
  fit.hidden = false;
  resize();

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(player);
  window.addEventListener('resize', resize);
  frame.addEventListener('load', () => {
    frame.contentWindow?.postMessage({
      type: 'safe-area:set',
      safeArea: {top: '0px', bottom: '0px', left: '0px', right: '0px'},
      fullScreen: true,
      hostProvidesPhoneChrome: false,
    }, feed.origin);
  });
  frame.src = feed.href;
})();
