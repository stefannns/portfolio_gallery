/* Concise projection of feedback-tracking/feedback-tracker.md, October 8, 2026.
 * Lists current implementations, not pending suggestions or superseded versions.
 * Task IDs isolate games and variants. Local status is not database status.
 * Update this snapshot alongside the tracker when work changes.
 */
window.PLAYABLE_IMPLEMENTED_FIXES = {
  "playable2_20260927020828_5pmrhn": {
    "number": 3,
    "items": [
      "Simplified progress to n/4; removed Hint and duplicate instructions.",
      "Kept four puzzles in order old 4 → 6 → 1 → 2.",
      "Added a circular success check badge."
    ],
    "status": "Original HUD cleanup accepted; newer changes await review.",
    "evidence": [
      "FB-003-3e1fcc45",
      "FB-003-ceef90d6"
    ]
  },
  "playable2_20260927020828_iuyca5": {
    "number": 5,
    "items": [
      "Changed the round to 50 dumplings in 15 seconds.",
      "Separated targets and expanded tap areas; fixed duplicate counting.",
      "Each target now opens its own bamboo steamer to reveal a cartoon bun."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-005-8e7edd06",
      "Individual steamer correction",
      "Cartoon bun follow-up"
    ]
  },
  "playable2_20260927020828_oumj12": {
    "number": 6,
    "items": [
      "Centered results on the target circle at different preview sizes.",
      "Removed the emoji after “Missed!”.",
      "Shows actual string-length percentage, including values above 100%."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-006-6eb08583",
      "String Drawing percentage follow-up"
    ]
  },
  "playable2_20260927020828_9vxaxo": {
    "number": 7,
    "items": [
      "Replaced sky, platforms and ladder with matching pixel art.",
      "Fixed right-corner rotation and left-to-right shrink/raise/slide return.",
      "Added closer ladder rungs; faster growth, wider gaps and smaller landing islands."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-007-6e10074e"
    ]
  },
  "playable2_20260927020828_bnkh36": {
    "number": 8,
    "items": [
      "Added six food families with matching realistic fresh/spoiled images.",
      "Replaced the cover with a front-facing open fridge and simplified realistic UI.",
      "Fixed food/plate clipping, timeout scoring, duplicate answers and replay cleanup."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-008-3decf4b5",
      "FB-008-1c4dbe4e"
    ]
  },
  "playable2_20260927020828_86gl5z": {
    "number": 9,
    "items": [
      "Changed to a neutral light background with readable text and controls.",
      "Removed color-source names; prompt now says “Drag colors here”.",
      "Kept target recipes free of black."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-009-480ecd5a"
    ]
  },
  "playable2_20260927020828_y5a1vt": {
    "number": 10,
    "items": [
      "Removed duplicate instructions.",
      "Corrected the needle direction, center pivot and scoring alignment.",
      "Retained random direction reversals after taps."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-010-8f8e3166"
    ]
  },
  "playable2_20260927020825_z23fv4": {
    "number": 13,
    "items": [
      "Larger standalone book with a separate button below and a zoom-in transition.",
      "Replaced bubble-wrap and spinner sounds with recordings; spinner is silent at rest.",
      "Made sand audio quieter with gradual fade-in/out."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-013-f88170a0",
      "FB-013-347bfdcd"
    ]
  },
  "playable2_20260927020825_hjn7q5": {
    "number": 15,
    "items": [
      "Added realistic strings and a wood soundboard with responsive plucking.",
      "Swipes record persistent lines; Replay plays all lines together, Reset clears them.",
      "Added stronger metallic shine without shadow; replay is 20% slower."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-015-c8cb9ca1"
    ]
  },
  "playable2_20260927020825_lnwh1h": {
    "number": 17,
    "items": [
      "Added three obstacle layouts with a 100-ball target; shortened Level 2 blocks and Level 3 curves.",
      "Smoothed excavation edges and aligned visible holes with collision boundaries.",
      "Separated initial balls; fixed reset, progression and pointer cleanup."
    ],
    "status": "User accepted the current game.",
    "evidence": [
      "FB-017-7dd1f6be",
      "Sand Digging target follow-up"
    ]
  },
  "playable2_20260927020825_kxh9p4": {
    "number": 19,
    "items": [
      "Kept ants inside the drawable board, away from controls.",
      "Added recognizable six-legged ant artwork.",
      "Fixed scaled drawing coordinates, resize bounds and Add/Clear input handling."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-019-4731a74d"
    ]
  },
  "playable2_20260927021136_x3i163": {
    "number": 21,
    "items": [
      "Starts empty; only taps on blank space spawn cubes.",
      "Added varied cube sizes and half-size splitting.",
      "Improved click pop/movement and fixed scaled input and edge spawning."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "Cube Physics manual-spawn follow-up"
    ]
  },
  "playable2_20260927021201_7etgko": {
    "number": 22,
    "items": [
      "Replaced the opening and moving target with a generated transparent cartoon bug.",
      "Kept 100 HP, movement, target size and gameplay unchanged."
    ],
    "status": "Implemented locally; visual acceptance pending.",
    "evidence": [
      "FB-022-6b00ac94",
      "Cartoon bug follow-up"
    ]
  },
  "playable2_20260928023148_i47u62": {
    "number": 23,
    "items": [
      "Changed the field to warm sand and kept neutral troops gray.",
      "Slowed neutral replenishment with cooldown, active and lifetime limits.",
      "Simplified the HUD; removed rocks and shells again as requested."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-023-45750e0a"
    ]
  },
  "playable2_20260928024159_iasubp": {
    "number": 25,
    "items": [
      "Made soda cyan and obstacles orange with clearer outlines.",
      "Prevented obstacle overlap and kept emitter/cup clearance.",
      "Cup fills gradually with blue; Reset preserves the level, New Level changes it."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-025-faebc6a4"
    ]
  },
  "playable2_20260928024549_3bsc4d": {
    "number": 26,
    "items": [
      "Removed duplicate plug instructions and raised the phone.",
      "Raised/enlarged the connector while preserving its rotation pivot.",
      "Centered and wrapped “CONNECTION TIMEOUT” feedback."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-026-d23724cb"
    ]
  },
  "playable2_20260928025305_2wpf3o": {
    "number": 29,
    "items": [
      "Replaced cartoons with five consistent realistic transparent waist-up portraits.",
      "Centered the result overlay and smoothed portrait transitions.",
      "Fixed duplicate guessing/advancing and aligned the score HUD."
    ],
    "status": "User accepted the current game.",
    "evidence": [
      "FB-029-14611f68",
      "FB-029-68370fe1"
    ]
  },
  "playable2_20260928025330_g1w5ss": {
    "number": 30,
    "items": [
      "Reduced the run to 12 rounds with an earlier grid/difficulty ramp.",
      "Removed redundant title/Level text; instruction hides after valid play.",
      "Fixed portrait board sizing, text wrapping and rapid-tap skipping."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-030-03c5a3e5",
      "FB-030-c1051cac"
    ]
  },
  "playable2_20260928025635_idnu2k": {
    "number": 31,
    "items": ["Title hides after camera or photo start and returns on Back; editing controls stay available."],
    "status": "Title cleanup implemented; Sticker/Text feature decision remains open.",
    "evidence": ["Liquify title follow-up"]
  },
  "playable2_20260928030116_67pobm": {
    "number": 33,
    "items": [
      "Added sustained car-hit knockback, damage numbers and a red flash.",
      "Fixed grounded jumping and verified jumping can dodge cars.",
      "Added game-over/replay reset and clearer cash/HP controls."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-033-021a3787"
    ]
  },
  "playable2_20260928031234_805376": {
    "number": 38,
    "items": [
      "Replaced the low pitched background hum with quiet non-pitched ambience.",
      "Kept brief footsteps/encounter cues and softened the win sound.",
      "Fixed gesture unlock, duplicate ambience and hidden-page cleanup."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-038-1a41d065"
    ]
  },
  "playable2_20260928031734_t68did": {
    "number": 40,
    "items": [
      "Added mask bubbles only while holding.",
      "Scene darkens gradually with oxygen use and resets on replay.",
      "Split timer/oxygen HUD and removed the guide after starting."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-040-9c987b04"
    ]
  },
  "playable2_20261001225611_hg6unh": {
    "number": 42,
    "items": [
      "Separated instructions, pendulum canvas and bottom controls.",
      "Preserved joint/pivot dragging, trail and Start Motion/Pause.",
      "Made speed/color/glow panels dismissible and fixed stage coordinates."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-042-3ed6a6c4"
    ]
  },
  "playable2_20261001225611_bz1ptc": {
    "number": 46,
    "items": [
      "Added a licensed music loop corrected to the 100-BPM target.",
      "Synchronized the ring/TAP cue to playback and shows current tapping BPM.",
      "Fixed first-tap start, stale BPM, round duration and replay/audio cleanup."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-046-1f31c5e6"
    ]
  },
  "playable2_20261001225611_0e3wo5": {
    "number": 47,
    "items": [
      "Simplified text and added DynaPuff/Poppins fonts.",
      "Waits for first steering input; improved joystick response and pointer cleanup.",
      "Expanded the arena to full width and reduced cat size by 10%."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-047-4962fb12",
      "FB-047-7ca9b5cf"
    ]
  },
  "playable2_20261001225611_9its9h": {
    "number": 48,
    "items": [
      "Simplified drawing/movement guides and split KOs/HP HUD.",
      "Kept draw → equip → fight with five-hit enemies and unlimited KOs.",
      "Tuned continuous spin to 9.5 rad/s and hit cooldown to 0.22s."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-048-6dc0acb5"
    ]
  },
  "playable2_20261001225821_af5uee": {
    "number": 49,
    "items": [
      "Removed redundant titles/STAR progress; stress sits left and an elapsed timer sits right.",
      "Added a fine golden-sand background, hold-only granular scraping and softer result sounds.",
      "Final time appears beside the result percentage; timer resets on retry, freezes on results and pauses while hidden."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-049-1ed3b930",
      "FB-049-4f995802",
      "Star timer follow-up",
      "Star result time follow-up"
    ]
  },
  "playable2_20261001225836_jx30zt": {
    "number": 50,
    "items": [
      "Tap ice cream/chili to feed; temperature keeps drifting randomly with faster reversals.",
      "Completed the stick-person body and strengthened hand-drawn fire/snow/shake effects.",
      "Extreme temperatures show one recovery bubble action; removed its Start Over button."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-050-ff18b7ca",
      "No.50 stronger-effects follow-up"
    ]
  },
  "playable2_20261001225941_zi6jj7": {
    "number": 55,
    "items": [
      "Restored eight digits and eleven tries.",
      "Uncramped guess rows and clarified green/orange/gray explanations.",
      "Added clear results/replay and protected rapid input and scoring from audio failure."
    ],
    "status": "User accepted the current game.",
    "evidence": [
      "FB-055-f4df10aa",
      "FB-055-638a4a6e"
    ]
  },
  "playable2_20261001230001_ag49cj": {
    "number": 56,
    "items": [
      "Replaced the double moon with one shaded disk and simplified launch instructions.",
      "Kept trajectory aiming, four burst styles and three sizes.",
      "Added recorded whistle on ascent and explosion on the burst frame."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-056-6cacd439"
    ]
  },
  "playable2_20261001230052_xrken6": {
    "number": 57,
    "items": [
      "Added shorter seeded plants with lighter grass tufts and tap/drag patch growth.",
      "Flowers replace nearby flowers without removing the grass underneath.",
      "Added short real grass rustles when planting, with no idle loop."
    ],
    "status": "Partially addressed; broader fidelity and visual/audio acceptance remain open.",
    "evidence": [
      "FB-057-52f056c4",
      "Grass audio follow-up"
    ]
  },
  "playable2_20261001230052_xrken6b": {
    "number": "57b",
    "items": [
      "Added a separate top-down variant with visible radial grass blades and natural flowers.",
      "Refined scattered flowers/bugs and kept flower tools independent of grass.",
      "Simplified to an anchored four-item picker plus Reset; removed Ferns."
    ],
    "status": "Custom variant; visual/audio acceptance pending.",
    "evidence": [
      "User-requested alternative 57b",
      "57b Ferns removal"
    ]
  },
  "playable2_20261001230112_0ivocb": {
    "number": 58,
    "items": [
      "Simplified play to the question and one large wheel; tap the wheel to spin.",
      "Removed title, progress, hints, separate answer/Back panels and result-card clutter.",
      "Kept random answers, Not yet born retries and restart; added readable labels and mobile fit."
    ],
    "status": "UI simplified locally; visual acceptance and broader reference-fidelity feedback remain open.",
    "evidence": ["FB-058-2ae4781e", "Fate simple UI follow-up"]
  },
  "playable2_20261001230122_0sowkn": {
    "number": 60,
    "items": [
      "Replaced the code-drawn case with a generated realistic handheld-console image.",
      "Removed the backdrop; enlarged the device while keeping its LCD and six controls aligned.",
      "Added short button, pickup and game-over sounds plus press highlights; silent when idle."
    ],
    "status": "Implemented locally; visual acceptance pending.",
    "evidence": ["FB-060-640413cf", "Snake console art follow-up", "Snake fullscreen follow-up", "Snake button feedback follow-up"]
  },
  "playable2_20261001230147_id39lj": {
    "number": 61,
    "items": [
      "Gentle aurora drags now trigger reliable, louder tones instead of rare random notes.",
      "Added softer envelopes and vertical pitch response; kept idle silence and shortened echoes.",
      "Fixed audio retry, release/cancel behavior and full audio-node cleanup."
    ],
    "status": "Audio improved locally; listening acceptance and visual feedback remain open.",
    "evidence": [
      "FB-061-50ca8fed",
      "Aurora audio follow-up"
    ]
  },
  "playable2_20261001230212_tajqhm": {
    "number": 62,
    "items": [
      "Kept round/score, target time, timer and one main action.",
      "Removed title, mute, BEST tile and decorative precision ruler.",
      "Instruction hides when timing starts; audio failure no longer blocks play."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-062-a751ff4f"
    ]
  },
  "playable2_20261001230222_8qptsc": {
    "number": 64,
    "items": [
      "Removed Strings/mute; centered the opening guide and added four wave colors.",
      "Simplified to four thin strands plus two translucent filled layers.",
      "Replaced continuous hum with softer independent interval tones and proper silence/cleanup."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-064-9bace1ed"
    ]
  },
  "playable2_20261001230332_5af21q": {
    "number": 65,
    "items": [
      "Generated four rear-view cars and alpine scenery; cars are 25% smaller with matching hitboxes, grassy ground and no poles.",
      "Points top-left, time top-right, fixed-center speed dial; steering 20% gentler, unified Arial font. Faster driving earns more points.",
      "Removed speed streaks, enlarged pines and added speed-responsive engine/road/brake audio with pause, crash and replay cleanup."
    ],
    "status": "Implemented; visual/play acceptance pending.",
    "evidence": [
      "FB-065-f2a901e6",
      "Pocket Racer art/debug follow-up"
    ]
  },
  "playable2_20261001230352_h4uxll": {
    "number": 66,
    "items": [
      "Removed title/mute and simplified instructions; lightning endpoints now stay beyond the top/bottom edges.",
      "Added rolling thunder, colored lightning, a strikes counter and optional rock music.",
      "Retained requested rain and fixed fades, rapid toggles and hidden-page audio cleanup."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-066-0c245a9c",
      "Lightning framing follow-up"
    ]
  },
  "playable2_20261001230412_o52e38": {
    "number": 67,
    "items": [
      "Changed to a clean navy background with seven bright layer colors.",
      "Centered score text and removed its capsule.",
      "Faded the perspective grid toward the horizon instead of a hard cutoff."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-067-9f929deb",
      "FB-067-6a7ef598"
    ]
  }
};
