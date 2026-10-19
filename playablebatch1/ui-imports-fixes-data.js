// Local iteration summaries; stable IDs keep notes attached after renumbering.
Object.assign(window.PLAYABLE_IMPLEMENTED_FIXES || (window.PLAYABLE_IMPLEMENTED_FIXES = {}), {
  "01_petme_9gw00a_game": {
    "number": 66,
    "items": ["Added rounded Nunito Sans with a warm guide, quieter comfort meter and result UI. Photo fades now take 180ms instead of 420ms, retaining fully covered blending without white flashes.", "Improved falling fur with multi-strand tufts, stroke-direction drift, gravity and softer fading; effects stop when idle/hidden or reduced motion is enabled. Kept comb visibility, Again focus and grooming rules.", "Restored the original brushing audio from the supplied package; kept the visual and gameplay improvements."],
    "status": "Implemented locally; user review pending.",
    "evidence": ["UI imports review — October 15, 2026"]
  },
  "02e_pickalook_p8xys3_game": {
    "number": 72,
    "items": ["Added DM Sans, a sentence-case default guide and simpler Again styling; guide disappears after scratching.", "Preserved scratch progress on resize and proportional images; Again receives keyboard focus.", "Added scratch sounds that follow pressed strokes and fade when movement stops, the pointer leaves, or the stroke ends."],
    "status": "Implemented locally; user review pending.",
    "evidence": ["UI imports review — October 15, 2026"]
  },
  "05c_timemachine_male_black_wall": {
    "number": 68,
    "items": ["Added DM Sans and centered age text without a redundant title. Portraits now sit in a white photo-print frame with a wider bottom mat, soft shadow and warm off-white background.", "Placed the short guide in the print margin; it disappears without moving the frame or timeline. Preserved all 15 ages, portrait proportions and drag/keyboard controls."],
    "status": "Implemented locally; user review pending.",
    "evidence": ["UI imports review — October 15, 2026"]
  },
  "mianbao": {
    "number": 69,
    "items": ["Generated a coordinated ivory/chrome toaster, dark lever and matching normal/burnt face-toast sprites with transparent backgrounds.", "The handle crosses in front of the black slot but passes behind the casing lip immediately to its left. Retained the 44px drag target, keyboard controls and toast timing.", "Toast changes to burnt while hidden inside, then pops out already burnt without a visible image swap.", "Removed the result card and dimming layer: Burnt! now appears directly over the scene with a separate Again control."],
    "status": "Implemented locally; user review pending.",
    "evidence": ["UI imports review — October 15, 2026"]
  },
  "playable_20260807211217_q9i9d6": {
    "number": 70,
    "items": ["Fixed hover jitter by keeping item hit areas stationary and animating only the inner artwork.", "Five color-matched hidden objects and transparent collection slots; added leaf and fish. Enlarged the coconut about 22% while keeping its hiding spot and stable touch target. Placements follow the background crop.", "Removed the finish card, background dimming and blur. Completion text overlays the unchanged scene after all five items are found, with a separate Again button below it."],
    "status": "Implemented locally; user review pending.",
    "evidence": ["UI imports review — October 15, 2026"]
  },
  "playable_20260727203355_w1cgvm": {
    "number": 67,
    "items": ["Restored the user-selected earlier street selfie: amber sunglasses, pink scarf and pale-yellow sleeveless top, including all four outfit photos and the two matching transparent floating pieces.", "Kept DM Sans, independent outfit toggles, stationary targets, keyboard focus continuity and the short first-action guide. Restored matching garment removal regions; newer portrait experiments remain stored locally.", "Added short, soft outfit-change clicks with distinct adding/removing feedback for pointer and keyboard actions."],
    "status": "Implemented locally; user review pending.",
    "evidence": ["Eight-game design pass — October 15, 2026"]
  },
  "06a_coloring_game_final": {
    "number": 71,
    "items": ["Restored one horizontally scrolling color row with 44px controls; added Nunito Sans to UI and canvas numbers.", "Expanded the complete artwork toward edge-to-edge width on tall screens, fitting height on shorter screens without stretching or cropping.", "Added a 12px tap tolerance for tiny regions, choosing the nearest unfilled region of the selected color.", "Completion shows only Beautiful over the finished artwork. No panel, comparison images, extra copy or replay button; palette/status controls disappear without shifting the artwork."],
    "status": "Implemented locally; touch tolerance and text-only completion ready for review.",
    "evidence": ["Eight-game design pass — October 15, 2026"]
  },
  "playable_20261015220925_0pn002": {
    "number": 73,
    "items": ["Ironing requires a press-and-drag; hover no longer irons.", "Generated matching duck artwork and a 3D top-down iron, now about 22% larger. Steam is soft, feathered vapor that expands, curls upward and gradually dissipates instead of shiny bubbles. Bead artwork and melting strength unchanged.", "Reduced ironing hiss by about 56% in gain (7 dB quieter). Retained soft fades and silence when idle or hovering."],
    "status": "Implemented; new matching artwork replaces the supplied mismatched pair.",
    "evidence": ["Eight-game design pass — October 15, 2026"]
  }
});

// October 17 compliance pass: retain per-game creative decisions and note only
// the new local changes, rather than rewriting the approved implementation history.
for (const id of ["01_petme_9gw00a_game","playable_20260727203355_w1cgvm","05c_timemachine_male_black_wall","mianbao","playable_20260807211217_q9i9d6","06a_coloring_game_final","02e_pickalook_p8xys3_game","playable_20261015220925_0pn002"]) {
  const record = window.PLAYABLE_IMPLEMENTED_FIXES[id];
  record.items.push("Removed the page-level browser-zoom restriction; kept the initial mobile layout unchanged.");
  record.evidence.push("UI compliance review — October 17, 2026");
}
window.PLAYABLE_IMPLEMENTED_FIXES["06a_coloring_game_final"].items.push("Matched loading/error typography to the local Nunito Sans UI and improved secondary-text contrast and wrapping.");
window.PLAYABLE_IMPLEMENTED_FIXES["playable_20261015220925_0pn002"].items.push("Reset returns keyboard focus to the ironing canvas without scrolling or starting another stroke.");
window.PLAYABLE_IMPLEMENTED_FIXES["01_petme_9gw00a_game"].items.push("Reduced-motion mode skips the decorative finish entrance and comb-shrink effect; normal grooming feedback is unchanged.");
window.PLAYABLE_IMPLEMENTED_FIXES["02e_pickalook_p8xys3_game"].items.push("Reduced-motion mode skips the guide's slide/scale effects; scratching, reveal timing and normal playback are unchanged.");
