/* Shared by the review page and local FYP build. Task IDs stay stable across renumbering. */
(function (root) {
  'use strict';
  // Only explicit, task-ID-specific removals belong here; never remove games by display position.
  const removedTaskIds = Object.freeze(['07b_lifesim_ss41g7','playable_20260909035048_1wdfrh']); // Explicit duplicate voxel and body-ranking removals.
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
