/* Review categories are keyed by stable task IDs, never by mutable list numbers. */
(function (root) {
  'use strict';
  const batch1TaskIds = Object.freeze([
    'playable2_20260924214501_peqvrc',
    'playable_20260924213804_34rslj',
    'playable2_20260927020828_5pmrhn',
    'playable2_20260927020828_oumj12',
    'playable2_20260927020828_y5a1vt',
    'playable2_20260927020825_hjn7q5',
    'playable2_20260927020825_n4r34c',
    'playable2_20260927020825_lnwh1h',
    'playable2_20260927020825_ufhwuj',
    'playable2_20260927021136_x3i163',
    'playable2_20260928024549_3bsc4d',
    'playable2_20260928030211_tdjer2',
    'playable2_20260928030642_uthymy',
    'playable2_20260928031559_rckaf4',
    'playable2_20260928031734_t68did',
    'playable2_20261001225611_zgfls0',
    'playable2_20261001225611_23t98b',
    'playable2_20261001225821_af5uee',
    'playable2_20261001230052_xrken6b',
    'playable2_20261001230122_0sowkn',
    'playable2_20261001230352_h4uxll',
    'playable2_20261001230412_o52e38',
    'playable2_20261013020955_2hyyml',
    'playable2_20261013021144_kzqdfu',
    '01_petme_9gw00a_game',
    'playable_20260727203355_w1cgvm',
    '05c_timemachine_male_black_wall',
    'mianbao',
    'playable_20260807211217_q9i9d6',
    '06a_coloring_game_final',
    '02e_pickalook_p8xys3_game',
    'playable_20261015220925_0pn002',
    'bead_loop_20261019',
    'height_together_20261019'
  ]);
  const membership = new Set(batch1TaskIds);
  const storageKey = 'playable-review-batch-v1';
  const normalizeBatch = value => ['all', 'batch1', 'other'].includes(value) ? value : 'all';
  const categoryOf = game => membership.has(game?.taskId) ? 'batch1' : 'other';
  const matchesBatch = (game, value) => normalizeBatch(value) === 'all' || categoryOf(game) === value;
  const matchesQuery = (game, query) => {
    const q = String(query || '').trim().toLowerCase();
    return !q || [game.name, game.spreadsheetName, game.base, game.taskId, game.spreadsheetTaskId, game.number].filter(value => value != null).join(' ').toLowerCase().includes(q);
  };
  const filterGames = (games, state = {}) => games.filter(game => matchesBatch(game, state.batch) && matchesQuery(game, state.query));
  // Only an explicit deep link may widen a saved category. Search is list-only.
  const reveal = (game, state = {}) => ({
    batch: matchesBatch(game, state.batch) ? normalizeBatch(state.batch) : 'all',
    query: String(state.query || '')
  });
  const neighbor = (games, currentTaskId, direction) => {
    const index = games.findIndex(game => game.taskId === currentTaskId);
    if (index < 0) return null;
    return games[index + (direction === 'next' ? 1 : -1)] || null;
  };
  const model = Object.freeze({batch1TaskIds, storageKey, normalizeBatch, categoryOf, matchesBatch, matchesQuery, filterGames, reveal, neighbor});
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.PlayableBatchFilter = model;
})(typeof window === 'object' ? window : globalThis);
