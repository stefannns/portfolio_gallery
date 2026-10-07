/* Read-only tracker summaries, separate from dev decisions and shared comments. */
(function () {
  'use strict';
  const records = window.PLAYABLE_IMPLEMENTED_FIXES || {};
  const host = document.querySelector('.preview');
  if (!host) return;
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  let notesHost = document.querySelector('.game-notes');
  if (!notesHost) {
    notesHost = make('div', 'game-notes');
    host.append(notesHost);
  }
  const panel = make('section', 'implemented-fixes');
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'implemented-fixes-heading');
  const heading = make('h3', 'implemented-fixes-heading', 'Implemented fixes');
  heading.id = 'implemented-fixes-heading';
  const status = make('p', 'implemented-fixes-status');
  const list = make('ul', 'implemented-fixes-list');
  const empty = make('p', 'implemented-fixes-empty', 'No implemented fixes recorded in the feedback tracker yet.');
  panel.append(heading, status, list, empty);
  notesHost.append(panel);
  window.PlayableImplementedFixes = {
    selectGame(game) {
      const record = Object.prototype.hasOwnProperty.call(records, game?.taskId) ? records[game.taskId] : null;
      list.replaceChildren();
      panel.hidden = !game;
      notesHost.hidden = !game;
      panel.dataset.taskId = game?.taskId || '';
      status.textContent = record?.status || '';
      status.hidden = !record;
      empty.hidden = !!record;
      list.hidden = !record;
      if (record) for (const item of record.items) list.append(make('li', '', item));
    }
  };
})();
