/* The selected game language determines which standalone template is downloaded. */
(() => {
  function reflect(game) {
    const link = document.getElementById('download');
    if (!link) return;
    const item = window.PlayableGameDownloads?.[game?.base];
    const requested = window.PlayableReviewLocale?.language || 'en';
    const archive = item?.languages?.[requested] || item;
    link.hidden = !archive;
    if (!archive) {
      link.removeAttribute('href');
      link.removeAttribute('download');
      return;
    }
    const language = archive.language === 'it' ? 'Italian' : 'English';
    link.href = archive.url + '?v=' + archive.sha256.slice(0, 16);
    link.download = archive.filename;
    link.setAttribute('aria-label', 'Download ' + language + ' version of ' + game.number + '. ' + game.name + ' as a ZIP');
    link.title = language + ' · ' + (archive.bytes / 1048576).toFixed(1) + ' MB';
  }
  window.PlayableGameDownloadsUI = {reflect};
  window.addEventListener('playable-review-language-change', () => reflect(window.PlayableReviewLibrary?.getCurrent()));
})();
