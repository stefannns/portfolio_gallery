/* A batch archive always contains the whole selected pool, independent of search. */
(() => {
  const button = document.getElementById('batch-download');
  if (!button) return;
  const label = button.querySelector('[data-batch-download-label]');
  let selectedArchive = null;
  function reflect() {
    const batch = window.PlayableReviewLibrary?.getFilter?.().batch || document.getElementById('batch-filter')?.value;
    const requested = window.PlayableReviewLocale?.language || 'en';
    const item = window.PlayableBatchDownloads?.[batch];
    const archive = item?.languages?.[requested] || item?.languages?.en;
    selectedArchive = archive || null;
    button.disabled = !archive;
    label.textContent = item ? 'Download ' + item.label : 'Download batch';
    if (!archive) {
      button.title = 'Select Batch 1 or Batch 2 to download all its games';
      button.setAttribute('aria-label', button.title);
      return;
    }
    const language = archive.language === 'it' ? 'Italian' : 'English';
    button.title = archive.games + ' games · ' + language + ' · ' + (archive.bytes / 1000000).toFixed(1) + ' MB';
    button.setAttribute('aria-label', 'Download all ' + archive.games + ' games in ' + item.label + ' (' + language + ') as one ZIP');
  }
  button.addEventListener('click', () => {
    if (!selectedArchive || button.disabled) return;
    const link = document.createElement('a');
    const archiveUrl = button.dataset.downloadBase ? new URL(selectedArchive.filename, new URL(button.dataset.downloadBase, location.href)).href : selectedArchive.url;
    link.href = archiveUrl + '?v=' + selectedArchive.sha256.slice(0, 16);
    link.download = selectedArchive.filename;
    document.body.append(link);
    link.click();
    link.remove();
  });
  window.PlayableBatchDownloadsUI = {reflect};
  window.addEventListener('playable-review-filter-change', reflect);
  window.addEventListener('playable-review-language-change', reflect);
  reflect();
})();
