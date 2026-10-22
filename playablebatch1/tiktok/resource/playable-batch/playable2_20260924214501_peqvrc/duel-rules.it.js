(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DuelRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TAP_FORCE = 4;
  const RED_WIN_EDGE = 92;
  const BLUE_WIN_EDGE = 8;

  function createDuel() {
    return { boundary: 50, winner: null };
  }

  function applyTap(state, player) {
    if (state.winner) return state;

    const direction = player === "p1" ? 1 : player === "p2" ? -1 : 0;
    const boundary = Math.max(
      BLUE_WIN_EDGE,
      Math.min(RED_WIN_EDGE, state.boundary + direction * TAP_FORCE)
    );
    const winner = boundary >= RED_WIN_EDGE ? "p1" : boundary <= BLUE_WIN_EDGE ? "p2" : null;
    return { boundary, winner };
  }

  return { applyTap, createDuel };
});
