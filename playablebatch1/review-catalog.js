/* Shared by the review page and local FYP build. Task IDs stay stable across renumbering. */
(function (root) {
  'use strict';
  // Only explicit, task-ID-specific removals belong here; never remove games by display position.
  const removedTaskIds = Object.freeze([
    'playable2_20261028202811_071b88', // Former81: Doodle Zoo, removed October 28.
    '07b_lifesim_ss41g7', // Duplicate voxel.
    'playable_20260909035048_1wdfrh', // Body ranking.
    'playable2_20261001225856_15hv2j', // Former48:2048 Ball Merge.
    'playable2_20261001225937_72e2ez', // Former50:Sky Cycle.
    'playable2_20261001230147_id39lj', // Former56:Northern Lights.
  ]);
  function normalize(games) {
    const active = games.filter(game => !removedTaskIds.includes(game.taskId));
    const activeIds = new Set(active.map(game => game.taskId));
    const isLettered = game => !!(game.variantSuffix && game.variantOf && activeIds.has(game.variantOf));
    let nextNumber = 0;
    const primaryNumbers = new Map(active.filter(game => !isLettered(game)).map(game => [game.taskId, ++nextNumber]));
    return active.map(game => ({
      ...game,
      sourceNumber: game.sourceNumber ?? game.number,
      // Lettered alternatives sit beside their parent without renumbering later games.
      number: isLettered(game) ? String(primaryNumbers.get(game.variantOf)) + game.variantSuffix : primaryNumbers.get(game.taskId)
    }));
  }
  const catalog = Object.freeze({normalize, removedTaskIds});
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.PlayableReviewCatalog = catalog;
})(typeof window === 'object' ? window : globalThis);
