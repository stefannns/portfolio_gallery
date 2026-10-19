/* Shared by the review page and local FYP build. Task IDs stay stable across renumbering. */
(function (root) {
  'use strict';
  // Only explicit, task-ID-specific removals belong here; never remove games by display position.
  const removedTaskIds = Object.freeze([
    '07b_lifesim_ss41g7', // Duplicate voxel.
    'playable_20260909035048_1wdfrh', // Body ranking.
    'playable2_20261001225856_15hv2j', // Former48:2048 Ball Merge.
    'playable2_20261001225937_72e2ez', // Former50:Sky Cycle.
    'playable2_20261001230147_id39lj', // Former56:Northern Lights.
  ]);
  function normalize(games) {
    return games.filter(game => !removedTaskIds.includes(game.taskId)).map((game, index) => ({
      ...game,
      sourceNumber: game.sourceNumber ?? game.number,
      number: index + 1
    }));
  }
  const catalog = Object.freeze({normalize, removedTaskIds});
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.PlayableReviewCatalog = catalog;
})(typeof window === 'object' ? window : globalThis);
