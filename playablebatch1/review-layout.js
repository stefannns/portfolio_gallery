/* Single-screen review: one shared details DOM keeps drafts and feedback state intact. */
(() => {
  const api = window.PlayableReviewLibrary;
  const picker = document.getElementById('game-picker');
  const trigger = document.getElementById('review-toggle');
  const dialog = document.getElementById('review-drawer');
  const content = document.getElementById('review-content');
  const home = content?.parentElement;
  if (!api || !picker || !trigger || !dialog || !content || !home) return;

  for (const game of api.games) {
    const option = document.createElement('option');
    option.value = game.taskId;
    option.textContent = game.number + '. ' + game.name;
    picker.append(option);
  }
  const reflect = game => { if (game) picker.value = game.taskId; };
  picker.addEventListener('change', () => {
    const game = api.games.find(item => item.taskId === picker.value);
    if (game) api.select(game, {reveal: true});
  });
  trigger.addEventListener('click', () => {
    dialog.querySelector('.review-drawer-body').append(content);
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    dialog.querySelector('.review-drawer-close').focus();
  });
  dialog.querySelector('.review-drawer-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    home.append(content);
    trigger.setAttribute('aria-expanded', 'false');
    if (getComputedStyle(trigger).display !== 'none') trigger.focus();
  });
  const wide = window.matchMedia('(min-width: 1201px)');
  wide.addEventListener('change', event => { if (event.matches && dialog.open) dialog.close(); });
  trigger.setAttribute('aria-expanded', 'false');
  window.PlayableReviewLayout = {reflect};
  reflect(api.getCurrent());
})();
