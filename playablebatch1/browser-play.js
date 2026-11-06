(() => {
  const script = document.currentScript;
  const scriptUrl = new URL(script.src);
  const base = scriptUrl.protocol === 'file:' && script.dataset.localBrowserBase
    ? script.dataset.localBrowserBase
    : scriptUrl;
  const pageUrl = new URL('./browser-play.html', base);

  function urlFor(game, language) {
    const url = new URL(pageUrl);
    url.searchParams.set('game', game.taskId);
    url.searchParams.set('lang', language === 'it' ? 'it' : 'en');
    return url.href;
  }
  window.PlayableBrowser = {urlFor};

  const player = document.getElementById('browser-player');
  if (!player) return;

  const params = new URLSearchParams(location.search);
  const games = window.PlayableBrowserGames || {};
  const task = params.get('game');
  const message = document.getElementById('browser-message');
  if (!Object.hasOwn(games, task)) {
    message.textContent = 'Choose a game from the Playable review page to open its browser preview.';
    return;
  }

  const game = games[task];
  const language = params.get('lang') === 'it' && game.it ? 'it' : 'en';
  const entry = game[language];
  const fit = document.getElementById('browser-fit');
  const frame = document.getElementById('browser-game');
  const logicalWidth = 390;
  const logicalHeight = 598;

  // Keep the game in its portrait layout and fit that layout into the available box.
  function resize() {
    const scale = Math.min(player.clientWidth / logicalWidth, player.clientHeight / logicalHeight);
    fit.style.width = logicalWidth * scale + 'px';
    fit.style.height = logicalHeight * scale + 'px';
    frame.style.transform = `scale(${scale})`;
  }

  document.documentElement.lang = language;
  document.title = entry.title + ' · Playable';
  player.setAttribute('aria-label', entry.title);
  frame.title = entry.title;
  frame.style.width = logicalWidth + 'px';
  frame.style.height = logicalHeight + 'px';
  message.hidden = true;
  fit.hidden = false;
  resize();

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(player);
  window.addEventListener('resize', resize);
  frame.src = new URL(entry.src, pageUrl).href;
})();
