(() => {
  'use strict';
  const config = window.PLAYABLE_FEEDBACK_CONFIG;
  const host = document.querySelector('.preview');
  if (!host || !config) return;
  const categories = {visual: 'Visual issue', gameplay: 'Gameplay issue', other: 'Other feedback'};
  const statuses = {needs_review: 'Needs review', fixed: 'Fixed', approved: 'Approved'};
  const PAGE_SIZE = 20, MAX_COMMENT = 2000;
  const drafts = new Map(), pending = new Set(), outcomes = new Map();
  const counts = new Map(), countRequests = new Map();
  let countListener = () => {}, countGames = [];
  let current = null, generation = 0, loaded = [], hasMore = false, available = true, reading = false, reviewerName = '';

  function el(tag, options = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(options)) {
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  }
  const heading = el('h3', {className: 'feedback-heading', id: 'feedback-heading', text: 'Game feedback'});
  const help = el('p', {className: 'feedback-help', text: 'Shared with everyone reviewing this link. No sign-in needed.'});
  const name = el('input', {id: 'feedback-name', type: 'text', maxlength: '60', autocomplete: 'nickname'});
  const category = el('select', {id: 'feedback-category'});
  for (const [value, label] of Object.entries(categories)) category.append(el('option', {value, text: label}));
  const comment = el('textarea', {id: 'feedback-comment', rows: '3', maxlength: String(MAX_COMMENT), required: '', 'aria-describedby': 'feedback-counter feedback-submit-message'});
  const counter = el('p', {id: 'feedback-counter', className: 'feedback-counter', text: '0 / 2,000'});
  const submit = el('button', {type: 'submit', className: 'feedback-submit', text: 'Post feedback'});
  const submitMessage = el('p', {id: 'feedback-submit-message', className: 'feedback-message', role: 'status', 'aria-live': 'polite'});
  const form = el('form', {className: 'feedback-form'},
    el('div', {className: 'feedback-fields'},
      el('div', {}, el('label', {for: 'feedback-name', text: 'Your name (optional)'}), name),
      el('div', {}, el('label', {for: 'feedback-category', text: 'Feedback type'}), category)),
    el('div', {className: 'feedback-comment'}, el('label', {for: 'feedback-comment', text: 'Your feedback'}), comment),
    el('div', {className: 'feedback-controls'}, counter, submit), submitMessage);
  const refresh = el('button', {type: 'button', text: 'Refresh', 'aria-label': 'Refresh shared feedback'});
  const listHeading = el('h4', {className: 'feedback-list-heading', text: 'Shared feedback'});
  const loadMessage = el('p', {className: 'feedback-message', role: 'status', 'aria-live': 'polite'});
  const list = el('div', {className: 'feedback-list'});
  const more = el('button', {type: 'button', className: 'feedback-more', text: 'Load older feedback', hidden: ''});
  const panel = el('section', {className: 'feedback', 'aria-labelledby': 'feedback-heading'}, heading, help, form,
    el('div', {className: 'feedback-list-head'}, listHeading, refresh), loadMessage, list, more);
  host.append(panel);

  function message(node, text = '', tone = '') {
    node.textContent = text;
    node.setAttribute('data-tone', tone);
  }
  function draftFor(taskId) {
    if (!drafts.has(taskId)) drafts.set(taskId, {name: reviewerName, category: 'visual', comment: '', request: null});
    return drafts.get(taskId);
  }
  function captureDraft() {
    if (!current) return;
    const draft = draftFor(current.taskId);
    if (draft.name !== name.value || draft.category !== category.value || draft.comment !== comment.value) draft.request = null;
    Object.assign(draft, {name: name.value, category: category.value, comment: comment.value});
    reviewerName = name.value;
    counter.textContent = comment.value.length.toLocaleString() + ' / 2,000';
  }
  function updateForm() {
    const busy = !!current && pending.has(current.taskId);
    for (const input of [name, category, comment]) input.disabled = !current || busy;
    submit.disabled = !current || busy || !available;
    submit.textContent = busy ? 'Posting…' : 'Post feedback';
    const outcome = current && outcomes.get(current.taskId);
    message(submitMessage, busy ? 'Saving shared feedback…' : outcome?.text || '', outcome?.tone || '');
  }
  function errorText(error) {
    if (['PGRST205', '42P01', 'PGRST204', '42703'].includes(error.code)) return 'Shared feedback needs its database setup. Ask the site owner to run setup-feedback.sql, then press Refresh.';
    if (error.status === 401) return 'The feedback connection was rejected. Ask the site owner to check the project URL and publishable key.';
    if (error.status === 403 || error.code === '42501') return 'Feedback permissions are not ready. Ask the site owner to run setup-feedback.sql, then press Refresh.';
    if (error.name === 'AbortError') return 'The connection timed out. Your draft is kept here; try again.';
    return 'Could not reach shared feedback. Your draft is kept here; check your connection and try again.';
  }
  async function request(params, options = {}) {
    const endpoint = new URL(config.url.replace(/\/$/, '') + '/rest/v1/' + config.table);
    endpoint.search = new URLSearchParams(params).toString();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint.href, {
        ...options, signal: controller.signal, cache: 'no-store', credentials: 'omit',
        headers: {apikey: config.publishableKey, ...options.headers},
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok) throw Object.assign(new Error('Feedback request failed'), {status: response.status, code: data?.code});
      if (options.method === 'HEAD') {
        const total = response.headers.get('content-range')?.split('/')[1];
        if (!/^\d+$/.test(total || '')) throw new Error('Missing feedback total');
        return Number(total);
      }
      return data;
    } finally { clearTimeout(timer); }
  }
  async function refreshCount(taskId, afterPending = false) {
    if (countRequests.has(taskId)) {
      await countRequests.get(taskId);
      if (!afterPending) return;
    }
    const readingCount = (async () => {
      try {
        const total = await request({task_id: 'eq.' + taskId, select: 'id'}, {method: 'HEAD', headers: {Prefer: 'count=exact', Range: '0-0'}});
        counts.set(taskId, total);
      } catch { counts.set(taskId, 'error'); }
      countListener(taskId);
    })();
    countRequests.set(taskId, readingCount);
    try { await readingCount; } finally { if (countRequests.get(taskId) === readingCount) countRequests.delete(taskId); }
  }
  async function refreshCounts() {
    const queue = [...countGames];
    await Promise.all(Array.from({length: Math.min(4, queue.length)}, async () => {
      while (queue.length) await refreshCount(queue.shift().taskId);
    }));
  }
  function renderList() {
    list.replaceChildren();
    for (const item of loaded) {
      const timestamp = new Date(item.created_at), validTime = Number.isFinite(timestamp.getTime());
      const meta = el('div', {className: 'feedback-entry-meta'},
        el('strong', {text: item.author || 'Anonymous'}),
        el('span', {className: 'feedback-category', text: categories[item.category] || 'Other feedback'}),
        el('span', {className: 'feedback-entry-status', text: statuses[item.status] || 'Needs review'}));
      const time = el('time', {text: validTime ? timestamp.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : 'Date unavailable'});
      if (validTime) time.setAttribute('datetime', timestamp.toISOString());
      list.append(el('article', {className: 'feedback-entry'}, meta, el('p', {className: 'feedback-entry-comment', text: item.comment}), time));
    }
    more.hidden = !hasMore;
    listHeading.textContent = 'Shared feedback' + (loaded.length ? ' · ' + loaded.length + (hasMore ? '+' : '') : '');
  }
  async function load(append = false) {
    if (!current || reading) return;
    const game = current, token = generation;
    reading = true; refresh.disabled = true; more.disabled = true;
    message(loadMessage, append ? 'Loading older feedback…' : 'Loading shared feedback…');
    try {
      const rows = await request({task_id: 'eq.' + game.taskId, select: 'id,task_id,author,category,comment,status,created_at', order: 'created_at.desc,id.desc', limit: String(PAGE_SIZE + 1), offset: String(append ? loaded.length : 0)});
      if (token !== generation) return;
      if (!Array.isArray(rows)) throw new Error('Invalid feedback response');
      available = true; hasMore = rows.length > PAGE_SIZE;
      const incoming = rows.slice(0, PAGE_SIZE);
      loaded = append ? [...loaded, ...incoming.filter(row => !loaded.some(old => old.id === row.id))] : incoming;
      renderList(); message(loadMessage, loaded.length ? '' : 'No feedback yet. Be the first to leave a note.');
      if (!append) refreshCount(game.taskId);
    } catch (error) {
      if (token !== generation) return;
      if ([401,403].includes(error.status) || ['PGRST205','42P01','PGRST204','42703'].includes(error.code)) available = false;
      message(loadMessage, errorText(error), 'error');
    } finally {
      if (token === generation) { reading = false; refresh.disabled = false; more.disabled = false; updateForm(); }
    }
  }
  function uuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);});
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!current || pending.has(current.taskId) || !available) return;
    captureDraft();
    const game = {...current}, draft = draftFor(game.taskId), body = draft.comment.trim();
    if (!body || body.length > MAX_COMMENT || draft.name.trim().length > 60 || !categories[draft.category]) {
      message(submitMessage, 'Write feedback between 1 and 2,000 characters.', 'error'); comment.focus(); return;
    }
    // Reuse the same ID after a network timeout: a retry cannot create duplicate notes.
    // Variants keep their own task ID and label (e.g. 57b); the database row number stays numeric.
    draft.request ||= {id: uuid(), task_id: game.taskId, game_number: Number.parseInt(game.number, 10), game_name: game.name,
      author: draft.name.trim(), category: draft.category, comment: body};
    pending.add(game.taskId); outcomes.delete(game.taskId); updateForm();
    try {
      await request({on_conflict: 'id'}, {method: 'POST', headers: {'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal'}, body: JSON.stringify(draft.request)});
      draft.comment = ''; draft.request = null;
      outcomes.set(game.taskId, {text: 'Feedback posted. Everyone reviewing this link can see it.', tone: 'success'});
      refreshCount(game.taskId, true);
      if (current?.taskId === game.taskId) { comment.value = ''; counter.textContent = '0 / 2,000'; generation++; reading = false; await load(); }
    } catch (error) {
      outcomes.set(game.taskId, {text: errorText(error), tone: 'error'});
    } finally { pending.delete(game.taskId); updateForm(); }
  });
  for (const input of [name, category, comment]) input.addEventListener('input', captureDraft);
  refresh.addEventListener('click', () => { available = true; updateForm(); load(); });
  more.addEventListener('click', () => load(true));
  window.PlayableFeedback = Object.freeze({
    getCommentCount(taskId) { return counts.get(taskId) ?? null; },
    initializeCounts(games, listener) {
      countGames = [...games]; countListener = listener; refreshCounts();
    },
    selectGame(game) {
    captureDraft(); current = {taskId: game.taskId, number: game.number, name: game.name}; generation++;
    loaded = []; hasMore = false; available = true; reading = false; renderList();
    const draft = draftFor(game.taskId); name.value = draft.name; category.value = draft.category; comment.value = draft.comment;
    counter.textContent = comment.value.length.toLocaleString() + ' / 2,000';
    heading.textContent = 'Feedback · ' + game.number + '. ' + game.name;
    updateForm(); load();
  }});
  setInterval(() => { if (document.visibilityState === 'visible') refreshCounts(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshCounts(); });
})();
