/* Read-only implementation summaries. */
window.PLAYABLE_IMPLEMENTED_FIXES = {
  "one_life_20261020": {
    "number": 73,
    "items": [
      "Four distinct choices per stage from age 4 to 82. Choices affect stats, studies, work and relationships.",
      "More detailed short stories and outcomes; compact labels in a two-by-two grid. Centered text-only layout, progress below the actions.",
      "Soft fades and rolling ages. Fixed controls, reduced motion, pause/resume and duplicate-tap protection.",
      "Weighted birth odds for 172 places, a bar chart and country-name roll.",
      "Journal, life summary and replay. Local assets; synced Direct/FYP versions."
    ],
    "status": "Prototype implemented; awaiting review.",
    "evidence": [
      "One Life 20261020",
      "Four choices and richer stories 20261021"
    ]
  },
  "height_together_20261019": {
    "number": 72,
    "items": [
      "New 3D height simulator with editable names/heights and proportional geometric people.",
      "Shared red scarf wraps around both necks, with a cloth bridge, hanging ends and matching red fringe. Umbrella canopy matches the scarf red, with darker red ribs and an unchanged pole/handle. Hug, piggyback, cradle, umbrella grip, seating/table contact and shelf reach use actual body/prop anchors with fixed limb lengths. Coffee Date has wider chair spacing and tucked elbows to prevent neighbouring arms intersecting, while preserving tabletop hand contact.",
      "Eight scenes, drag/pinch and both eye views; no floating zoom/reset buttons. Shared opening motion keeps contacts connected, and unrelated taps no longer trigger the camera-view handler.",
      "Local photo export, portrait layout and licensed typography. Names/heights stay on-device. Extremely mismatched heights retain real proportions rather than stretching limbs to force unreachable embrace contacts."
    ],
    "status": "Prototype implemented; awaiting review.",
    "evidence": [
      "Height Together 20261019",
      "Height poses 20261020"
    ]
  },
  "bead_loop_20261019": {
    "number": 71,
    "items": [
      "New 3D loop with swipe-driven rolling, release inertia and a bead counter. The silent idle motion never adds counts.",
      "Ten textures: jade, wood, stone, cat, pearl, amber, blue-and-white porcelain, amethyst, gold and obsidian. Different procedural patterns/finishes; switching preserves spin and counts. Cat faces remain upright and camera-facing.",
      "All ten choices visible in a compact two-row picker with a selected-material name and accessible touch buttons. Portrait layout, dismissing swipe guide, local typography/libraries, keyboard spinning and restrained bead sounds."
    ],
    "status": "Prototype implemented; awaiting review.",
    "evidence": [
      "Bead Loop 20261019",
      "Bead textures 20261020"
    ]
  },
  "playable2_20260927020825_iyfbfj": {
    "number": 14,
    "items": [
      "Drawing starts immediately, even without audio. Captured strokes continue across the canvas edge and back.",
      "Resize preserves artwork and its value; selling is immediate and late audio cannot restart an ended stroke.",
      "Existing patterns, upgrades, colors and layout retained; broader art-quality feedback remains open."
    ],
    "status": "Gameplay repairs implemented locally; awaiting review. Visual redesign/removal not decided.",
    "evidence": [
      "Gameplay round 2 — October 14, 2026",
      "52649991-cb83-40ea-8a7a-5b604131d822"
    ]
  },
  "playable2_20260928030211_tdjer2": {
    "number": 34,
    "items": [
      "Particle springs now run at a fixed simulation rate, keeping the same motion on 30/60/120 Hz displays.",
      "One pointer owns each drag; secondary fingers, capture loss and hidden pages no longer leave interaction stuck.",
      "Opening now shows only an animated LOOP demo and a short drag guide; the first action takes effect immediately and hides the guide.",
      "Enlarged particle artwork; replaced the permanent panel with a compact color/text strip, upload/save icons and optional settings. Font, shape, theme, filter and density controls remain available."
    ],
    "status": "October 19 opening/control-layout fixes implemented locally; awaiting review. Host gradient unchanged.",
    "evidence": [
      "Gameplay round 2 — October 14, 2026",
      "b6202dc3-729f-427f-9f78-6f89e6001246",
      "ui24-31-20261019"
    ]
  },
  "playable2_20261001225611_gjmtbw": {
    "number": 43,
    "items": [
      "Hot/warm clue ranges now scale to the 8×8 map, so large distant regions no longer all show the same cold clue.",
      "Verified an animal at every target location; duplicate taps and previous-round input cannot corrupt the round.",
      "Kept the 64-cell map, tap count, clue legend and replay. No animal-generation failure was reproduced."
    ],
    "status": "Clue/input repairs implemented locally; awaiting gameplay review.",
    "evidence": [
      "Gameplay round 2 — October 14, 2026",
      "6da4aa14-17c9-4bf1-95f5-7bfa32da7622"
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
  "playable2_20260928023148_kiq9wu": {
    "number": 24,
    "items": [
      "Try Again and Play Again work through the framework wrapper; result taps no longer get captured as drawing gestures.",
      "The car keeps its configured speed regardless of how densely a route is drawn; police turning is consistent across refresh rates. Repeatable escape routes are verified.",
      "Replay restores the same starting positions and headings. Cancelled and unrelated pointers cannot corrupt a route."
    ],
    "status": "October 14 gameplay fixes implemented locally; awaiting review. Layout and overlay work held.",
    "evidence": [
      "cbc5e006-c262-4f2b-88ce-a2b2886a4c4c"
    ]
  },
  "playable2_20260928024805_31g1lw": {
    "number": 27,
    "items": [
      "Balls resume bouncing when they settle on the floor or inside a ring, so play does not get stuck.",
      "Physics uses consistent elapsed time across refresh rates. Circle drawing safely handles cancellation and unrelated pointers.",
      "Kept one starting ball, paid additional balls and collision-only earnings. Recovery does not spawn balls or award free cash."
    ],
    "status": "October 14 gameplay fixes implemented locally; awaiting review. Layout and overlay work held.",
    "evidence": [
      "d83bc8d4-e547-4937-a9b4-e0a248a5ffc1"
    ]
  },
  "playable_20260924213804_34rslj": {
    "number": 2,
    "items": [
      "Centered FYP drawing area and eye-drawing guide; retained vertical feed clearance without a leftward offset.",
      "Clear and Next appear only after drawing; reserved toolbar space prevents the canvas from jumping. No extra Start screen.",
      "All seven steps, Clear, result and Draw Again remain available. Restored the decorative eye-drawing preview; it never changes saved drawings."
    ],
    "status": "October 14 entry fixes implemented locally; awaiting review.",
    "evidence": [
      "b1441e66-a61f-4901-93b9-80c1c52b1fc0"
    ]
  },
  "playable2_20260927020828_hix8pk": {
    "number": 4,
    "items": [
      "Cobalt backdrop and coral ring retained; the gold ball now has rounded 3D shading and a highlight.",
      "Player-placed pads are flat blue circles with a soft cyan glow, no 3D shading. Their upper edge keeps the existing bounce point.",
      "Kept the 64px ball, bounce physics, rewards, relaunch and centered layout. Preview demonstration remains deferred."
    ],
    "status": "October 14 visual fixes implemented locally; awaiting review. Demo request deferred.",
    "evidence": [
      "32779fe9-b644-4704-b71f-2ba97c6ee50c",
      "Gameplay round 2 — October 14, 2026"
    ]
  },
  "playable2_20261013020814_b973b1": {
    "number": 69,
    "items": [
      "Accepts simultaneous drive and steer touches. Each finger holds its own control; releasing, cancelling or shifting button focus does not clear the other finger.",
      "Input resets when changing levels, hiding the page or losing window focus."
    ],
    "status": "Two-thumb controls implemented; awaiting mobile retest.",
    "evidence": [
      "Precision Parking multi-touch follow-up 20261013"
    ]
  },
  "playable2_20261013020814_twgfzt": {
    "number": 68,
    "items": [
      "A one-direction pull launches an automatic elliptical swing on release, curling into an inward swirl as it slows.",
      "Added spring-following pull resistance, stretch/squash feedback and a stronger inward recoil before the ellipse.",
      "Sped up the released swing about 40%, while keeping the held-drag spring, resistance, damping and rainbow trail settings unchanged.",
      "The long, fading rainbow path records the released motion only. Pulling again clears it; no trail appears while held.",
      "Kept the visible first-frame orb and compact action guide. Added tap/keyboard alternatives and guarded cancellation, resizing and hidden-page behavior."
    ],
    "status": "Release-only elliptical rainbow motion implemented locally; awaiting review.",
    "evidence": [
      "Neon Swing release follow-up 20261013"
    ]
  },
  "playable2_20261013020814_woay2o": {
    "number": 70,
    "items": [
      "Replaced the car example with a newly generated woodland fox-and-mushroom illustration, visible immediately inside the stamp frame.",
      "Replaced the dotted mask with a solid white postage frame, scalloped edge perforations, a light paper shadow and slight tilt. Captured and uploaded photos share the same frame.",
      "Capture, photo upload, remove and camera hide/show remain available; frame sizing leaves room for rotation and shadow at short portrait sizes.",
      "Fixed the jumping lower panel: a compact, reserved camera dock stays stable, without blur flicker or spring overshoot. Hidden controls are inactive and old camera callbacks cannot blank a new preview."
    ],
    "status": "New fox artwork and stable camera controls implemented; awaiting review.",
    "evidence": [
      "Pocket Stamp frame follow-up 20261013",
      "Pocket Stamp fox/dock follow-up 20261013"
    ]
  },
  "playable2_20261013020955_2hyyml": {
    "number": 61,
    "items": [
      "Six camera treatments: worn silver-plate, black-and-white film, soft color film, analog video, early digital and clean modern.",
      "Older eras add grain, dust, scratches, soft detail, dark edges and subtle film weave; color film adds edge light leaks, while analog video adds scanlines and tracking.",
      "Live preview and saved photos share the same effects and crop. Camera controls remain clear; reduced motion stops decorative film movement.",
      "Timeline drags move five years per eight pixels, so short swipes reach different eras. Exact year entry remains available.",
      "Circular camera button and local DM Sans typography, with the style label and dial years retained. Guidance starts with ‘drag to change year’, then switches to ‘tap to enter camera’ after interacting with the year selector. Matching swipe/tap gestures demonstrate each step without moving controls. No large build button or assembly wait."
    ],
    "status": "Era effects, sensitive timeline and simplified guided opening implemented; awaiting review.",
    "evidence": [
      "Time Camera era effects follow-up 20261013",
      "Time Camera timeline sensitivity follow-up 20261013"
    ]
  },
  "playable2_20260927020828_5pmrhn": {
    "number": 3,
    "items": [
      "Orchid Paper colors; n/4 with no Hint, puzzles old 4 → 6 → 1 → 2, and a circular success check badge.",
      "Puzzle higher, opening guide below; valid first node hides guidance without shifting the board. Centered decorative FYP demo retained.",
      "Impossible paths turn red with failure feedback. Drawing from a node retries the same level immediately, without Reset."
    ],
    "status": "Original HUD cleanup accepted; October 14 entry/failure fixes implemented locally, awaiting review.",
    "evidence": [
      "FB-003-3e1fcc45",
      "FB-003-ceef90d6",
      "One Stroke layout follow-up 20261009",
      "Simple color themes follow-up 20261009",
      "21e5e10f-0c95-44ea-9fab-f84e3b51f543",
      "Gameplay round 2 — October 14, 2026",
      "a3b52305-bbcf-4b01-a3e2-1a1177ccfd25"
    ]
  },
  "playable2_20260927020828_iuyca5": {
    "number": 5,
    "items": [
      "50 dumplings in 15 seconds; countdown starts with the first steamer tap.",
      "Separated targets and expanded tap areas; fixed duplicate counting.",
      "Each target now opens its own bamboo steamer to reveal a cartoon bun.",
      "Opening guidance states the 50-bun goal and first-tap start; centered FYP board retains vertical clearance.",
      "Restored the decorative steamer-reveal preview; it never collects a bun or starts time. The first real steamer tap still starts the 15-second round."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-005-8e7edd06",
      "Individual steamer correction",
      "Cartoon bun follow-up",
      "Feed-first entry request 20261008",
      "209bd1dd-bd45-4552-8a47-98a839ae8909"
    ]
  },
  "playable2_20260927020828_oumj12": {
    "number": 6,
    "items": [
      "Centered results on the target circle at different preview sizes.",
      "Mint Draft colors; removed the emoji after “Missed!”.",
      "Shows actual string-length percentage, including values above 100%.",
      "Larger, centered circle and raised FYP play area, with clear static guidance. Short screens reserve room below the target.",
      "Displayed string and circle share the same visual scale; drawing speed, length percentages and scoring are unchanged. Input works while audio is pending or denied."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-006-6eb08583",
      "String Drawing percentage follow-up",
      "Simple color themes follow-up 20261009",
      "cbcf80cc-fcd1-4dd7-a932-bd81b08b79cf"
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
      "Direct food scene without a cover; Eat/Pass starts the food timer on the first answer.",
      "Fixed food/plate clipping, timeout scoring, duplicate answers and replay cleanup."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-008-3decf4b5",
      "FB-008-1c4dbe4e",
      "Feed-first entry request 20261008"
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
      "Retained random direction reversals after taps.",
      "Raised and centered the wheel, preserving circular proportions at short sizes; removed obsolete mobile sizing that stretched it.",
      "Added a static action guide that hides after a real tap and returns on replay. Kept the target visible, without redundant TARGET text. Audio no longer delays scoring."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-010-8f8e3166",
      "c2f80a6d-63d5-4c92-95d7-f77da5e5a3b2"
    ]
  },
  "playable2_20260927020825_z23fv4": {
    "number": 13,
    "items": [
      "Opens directly on ASMR interactions; removed the book-cover start screen.",
      "Replaced bubble-wrap and spinner sounds with recordings; spinner is silent at rest.",
      "Made sand audio quieter with gradual fade-in/out."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-013-f88170a0",
      "FB-013-347bfdcd",
      "Feed-first entry request 20261008"
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
  "playable2_20260927020825_n4r34c": {
    "number": 16,
    "items": [
      "Midnight Tangerine colors: deep-blue canvas, warm-orange dot and drawn path.",
      "Matched results and Retry colors; retained readable light text and a clear target ring.",
      "Circle geometry, input, scoring, retry and audio are unchanged."
    ],
    "status": "Color theme implemented locally; visual review pending.",
    "evidence": [
      "Simple color themes follow-up 20261009"
    ]
  },
  "playable2_20260927020825_lnwh1h": {
    "number": 17,
    "items": [
      "Added three obstacle layouts with a 100-ball target; shortened Level 2 blocks and Level 3 curves.",
      "Smoothed excavation edges and aligned visible holes with collision boundaries.",
      "Apricot Quarry colors; separated initial balls and fixed reset, progression and pointer cleanup."
    ],
    "status": "User accepted the gameplay; new color theme awaits visual review.",
    "evidence": [
      "FB-017-7dd1f6be",
      "Sand Digging target follow-up",
      "Simple color themes follow-up 20261009"
    ]
  },
  "playable2_20260927020825_ufhwuj": {
    "number": 18,
    "items": [
      "Removed the countdown and time limit; the round ends only after a missed placement.",
      "Centered the score at the top, with fixed-width digit slots in the bundled Audiowide font.",
      "Preloaded the font, removed synthetic bold and old shrinking HUD overrides; fixed result spacing."
    ],
    "status": "Implemented locally; visual review pending.",
    "evidence": [
      "Synthwave Stack untimed/font follow-up 20261009"
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
      "Starts and resets with one cube; blank-space taps add fixed, larger 120px cubes.",
      "Half-size splitting: 120 → 60 → 30 → 15px, with the same color for every cube of the same size.",
      "Stronger click pop/movement; removed periodic background chords, keeping tap-only sounds."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "Cube Physics manual-spawn follow-up",
      "Cube Physics single-cube/colors/audio follow-up 20261008",
      "Cube Physics fixed-size/color-by-size follow-up 20261008"
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
      "Light mint background distinguishes the game from the dark feed. Lowered the phone and guide24px after review, retaining the phone size and cable alignment.",
      "Rebuilt the phone display with a charging ring, lightning indicator, live battery percentage and centered charging/timeout feedback.",
      "Raised/enlarged the connector while preserving its rotation pivot.",
      "Unified local Poppins typography, bold tabular battery digits and centered, wrapping “CONNECTION TIMEOUT” feedback."
    ],
    "status": "October 19 charging-display fixes and lower-phone follow-up implemented locally; verified in portrait Direct/FYP, review acceptance pending.",
    "evidence": [
      "FB-026-d23724cb",
      "No.26 font request 20261008",
      "fe7f3730-3fcb-4d6c-85d5-565249d3f74f",
      "ui24-31-20261019"
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
  "playable2_20260928025635_idnu2k": {
    "number": 31,
    "items": [
      "Title hides after camera or photo start and returns on Back; editing controls stay available."
    ],
    "status": "Title cleanup implemented; Sticker/Text feature decision remains open.",
    "evidence": [
      "Liquify title follow-up"
    ]
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
      "Increased continuous spin from 9.5 to 11 rad/s, about 16% faster; kept the 0.22s hit cooldown and other combat rules."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-048-6dc0acb5",
      "Gameplay round 2 — October 14, 2026",
      "17473cc8-9291-411b-9a20-2ecf9486112a"
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
      "Added a top-down variant with radial grass, natural flowers and refined visitors; flower tools stay independent of grass.",
      "Added a silent looping opening: grass grows along a continuous swipe path, flowers bloom, and a bee, butterfly and ladybug move around it. First planting replaces the demo; Reset restores it.",
      "Simplified to an anchored four-item picker plus Reset; removed Ferns.",
      "Added quieter, softer grass rustles and short flower pops, select/reset feedback and gentle music; leaving stops all audio."
    ],
    "status": "Custom variant; October19 opening animation implemented locally and checked in portrait Direct/FYP. User acceptance pending.",
    "evidence": [
      "User-requested alternative 57b",
      "57b Ferns removal",
      "No.57b audio follow-up",
      "No.57b gentle music follow-up",
      "No.57b soft grass and flower pops follow-up",
      "creature51-intro-20261019"
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
    "evidence": [
      "FB-058-2ae4781e",
      "Fate simple UI follow-up"
    ]
  },
  "playable2_20261001230122_0sowkn": {
    "number": 60,
    "items": [
      "Replaced the code-drawn case with a generated realistic handheld-console image.",
      "Centered the handheld horizontally and vertically in Feed preview and portrait play, per review feedback. Kept its size and placed the guide between the LCD and controls.",
      "Added a silent looping snake/food demo and one readable start guide. First valid direction starts the real round and hides the guide; idle animation never scores or plays sound.",
      "Kept short button, pickup and game-over sounds plus press highlights; reduced-motion/hidden-page handling and host preview/play gating are supported."
    ],
    "status": "October 19 Feed adaptation, opening demo and centering follow-up implemented locally; user review pending.",
    "evidence": [
      "FB-060-640413cf",
      "Snake console art follow-up",
      "Snake fullscreen follow-up",
      "Snake button feedback follow-up",
      "snake53-feed-20261019"
    ]
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
      "Centered opening guide and four colors; retained four thin strands with two translucent layers and no Strings/mute controls.",
      "Supports drag-release or two-point taps; fast releases and lost capture no longer drop unfinished lines. Clear/cancel stay reliable.",
      "Replaced continuous hum with softer independent interval tones and proper silence/cleanup."
    ],
    "status": "Implemented locally; review acceptance pending.",
    "evidence": [
      "FB-064-9bace1ed",
      "Gameplay round 2 — October 14, 2026",
      "4319497c-94bb-463f-981e-3b5300357f94"
    ]
  },
  "playable2_20261001230332_5af21q": {
    "number": 65,
    "items": [
      "Generated four rear-view cars and alpine scenery; cars are 25% smaller with matching hitboxes, grassy ground and no poles.",
      "Points top-left, time top-right, fixed-center speed dial; steering 20% gentler, unified Arial font. Faster driving earns more points.",
      "Removed speed streaks, enlarged pines; added engine/road/brake audio and a louder, bass-heavy crash without rattle, with pause/replay cleanup."
    ],
    "status": "Implemented; visual/play/listening acceptance pending.",
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
  },
  "playable2_20261028202811_hz9v37": {
    "number": 79,
    "items": [
      "Redrawn illustrated town: warm staggered paving, civic-square stonework, roof tiles, shop windows, striped market awning, produce crates, planted borders and a fuller fountain.",
      "Colored cartoon residents now have solid clothing, shoes, hair, hats and readable facial expressions. Each event keeps its live poses and props.",
      "The 3200 × 1900 world, six districts, 28 residents and nine event types remain. Panning and event-specific newspaper photographs use the refreshed art.",
      "Simulation still pauses while reading the newspaper; article and return button fit portrait FYP.",
      "Required App.jsx/check.js/asset_manifest.json/dist structure; matching Direct/FYP files.",
      "Removed the top photo count and placed shutter, zoom and reset below the camera frame.",
      "Extended the grass beyond the camera limits so no yellow outer rim appears."
    ],
    "status": "Latest reviewed changes · 29 October 2026",
    "evidence": [
      "Batch79–86 polish20261028"
    ]
  },
  "playable2_20261028202811_rf6gbi": {
    "number": 80,
    "items": [
      "Drawing release closes the outline into a filled body. Straight strokes with no enclosed area are rejected instead of being expanded into a ribbon.",
      "Four imagegen eye styles are assigned in shuffled random order: classic, sleepy, googly and happy. All four image slots are replaceable.",
      "Body fills and eyes use matte flat colors, with no body gradients, gloss or cast shadows. The feed demonstration uses the same flat appearance.",
      "A cancelled drawing adds no body; clear restores the guide and palette/gravity controls remain available.",
      "Required App.jsx/check.js/asset_manifest.json/dist structure; matching Direct/FYP files.",
      "New squishies use random flat colors; only the black pupils move.",
      "Sustained overlap no longer repeats contact sounds; a new impact rearms one restrained sound."
    ],
    "status": "Latest reviewed changes · 29 October 2026",
    "evidence": [
      "Batch79–86 polish20261028"
    ]
  },
  "playable2_20261028202811_dsl58j": {
    "number": 81,
    "items": [
      "Steady falling cream follows the cone path into real coils. Circular movement lays a longer strand; stillness builds a compact mound with the same amount of cream.",
      "Finger movement is relative, without jumping on press. Release drains the remaining stream before results.",
      "Independent approximation: the reference’s complete tower bending and balance-failure system is not reproduced.",
      "A large circular pad moves the cone beneath a fixed dispenser. Flavors, measured height, results, replay and action sounds remain."
    ],
    "status": "Latest reviewed changes · 29 October 2026",
    "evidence": [
      "Batch79–86 polish20261028"
    ]
  },
  "playable2_20261028202811_gia8r5": {
    "number": 82,
    "items": [
      "The roll shrinks as paper unwinds; completed rolls fall away and a replacement enters from above. Score increases once per replacement.",
      "Light pulls retain a longer, smoother coast. Regrabbing or reversing stops it."
    ],
    "status": "Latest reviewed changes · 29 October 2026",
    "evidence": [
      "Batch79–86 polish20261028"
    ]
  },
  "playable2_20261028202811_5uuyhb": {
    "number": 83,
    "items": [
      "The words are laid out before play. Brushing reveals this fixed text instead of placing new words along the stroke.",
      "Each revealed character remains fully opaque, then disappears in one step at its own staggered deadline. Recovery is letter by letter with no alpha fade; the maximum lifetime is shortened from 6.5 seconds to 3 seconds.",
      "Five brush widths, clear/reset and the upper breathing guide remain. The FYP demonstration uses the same prewritten letters and recovery behavior.",
      "Required App.jsx/check.js/asset_manifest.json/dist structure; matching Direct/FYP files.",
      "Brushing reveals prewritten text. Each exposed letter disappears at an independent random deadline."
    ],
    "status": "Latest reviewed changes · 29 October 2026",
    "evidence": [
      "Batch79–86 polish20261028"
    ]
  },
  "playable2_20261028202811_q0f68t": {
    "number": 84,
    "items": [
      "New original photographic tiles in a blue-and-white selection card closer to the supplied concept.",
      "The real sequence waits for FYP entry and stops/reset-to-watch when inactive; preview cannot consume a round.",
      "All nine tiles are shuffled per round. Layouts where all three correct answers form one connected cluster are rejected; the order stays stable during selection, wrong attempts and replay. Success still waits for an explicit Next round.",
      "Image assets reduced from roughly 14.8 MB to 0.66 MB while retaining independently replaceable image slots.",
      "Required App.jsx/check.js/asset_manifest.json/dist structure; matching Direct/FYP files.",
      "Removed the Alex profile and centered the level number.",
      "Correct answer tiles are shuffled into varied, non-clustered layouts."
    ],
    "status": "Latest reviewed changes · 29 October 2026",
    "evidence": [
      "Batch79–86 polish20261028"
    ]
  },
  "playable2_20261028202811_ke0xpl": {
    "number": 85,
    "items": [
      "The primary button now says Make squishy. Compact labeled icon controls leave enough room for the full action text on phone screens.",
      "A grip keeps the coordinate frame from press time, so movement does not chase a rotating model. Pointer targets ease into a radial movement limit and spring steps run at a fixed 120Hz.",
      "The simulation cage is smoothed before the existing non-folding safety calculation. Positive stretch, surface separation and compression depth are preserved; smoothing is not applied after those safeguards.",
      "Mesh normals update at 30Hz and a conservative grab bound replaces repeated sphere calculations; the stale undeformed bounding box no longer rejects grabs on stretched parts.",
      "Local photo upload, rounded cutout, continuous wrapped texture, reset/retrace and exact source/runtime package synchronization are retained.",
      "Required App.jsx/check.js/asset_manifest.json/dist structure; matching Direct/FYP files.",
      "A valid outline automatically closes on release; overlapping ends are trimmed while preserving the main silhouette.",
      "Local photo upload and a wrapped, rounded 3D cutout remain, with smooth deformation and extreme-squish safeguards."
    ],
    "status": "Latest reviewed changes · 29 October 2026",
    "evidence": [
      "Batch79–86 polish20261028"
    ]
  },
  "playable2_20261029183430_hxuf8g": {
    "number": 86,
    "items": [
      "Faster initial ball and stronger speed increase on each bounce.",
      "Best removed from play/results; centered score only.",
      "Safe FYP layout, breathing guide and replay positions restored."
    ],
    "status": "Latest reviewed changes · 29 October 2026",
    "evidence": [
      "No.86 faster and score only · 29 October 2026"
    ]
  },
  "playable2_20261029183430_v5avg1": {
    "number": 87,
    "items": [
      "Fine spray mist, realistic suds and flowing rinse water with dirty runoff.",
      "Each area cleans only after Spray → Scrub → Rinse; wrong-order actions give a short hint.",
      "Drying is optional; spray/rinse audio is softer and water-like."
    ],
    "status": "Latest reviewed changes · 29 October 2026",
    "evidence": [
      "No.87 ordered spray, scrub and rinse · 29 October 2026"
    ]
  },
  "playable2_20261029183430_9mlt5d": {
    "number": 88,
    "items": [
      "Removed the redundant game heading, strengthened the 18px breathing CTA and lowered the orbital scene to avoid it.",
      "Aligned HUD margins/type and placed Pause 30px from the right and 50px from the bottom.",
      "Enlarged palette hit areas. Existing Score/Perfect/Best roles and timing-transfer gameplay remain."
    ],
    "status": "Latest reviewed changes · 29 October 2026",
    "evidence": [
      "New five UI round · 29 October 2026"
    ]
  },
  "playable2_20261029183430_9mlt5d_88b": {
    "number": "88b",
    "items": [
      "Two gradient strips mark valid launch windows for both sides of the next orbit.",
      "Strips update after each transfer and fade toward the unsafe boundaries.",
      "Tangent flight, gradual acceleration and centered score-only layout retained."
    ],
    "status": "Latest reviewed changes · 29 October 2026",
    "evidence": [
      "No.88b two valid launch strips · 29 October 2026"
    ]
  },
  "playable2_20261029183430_ctpmni": {
    "number": 89,
    "items": [
      "New cartoon character, workshop background and 17 weapon/auto illustrations.",
      "Level text centered above the character and coins centered at the top, both without panels.",
      "Repeat-hit feedback, safe FYP layout and current source/dist structure."
    ],
    "status": "Latest reviewed changes · 29 October 2026",
    "evidence": [
      "No.89 overhead level and centered coins · 29 October 2026"
    ]
  },
  "playable2_20261029183430_cvsxhd": {
    "number": 90,
    "items": [
      "Rotated the score 90 degrees and placed it on the left at the vertical center.",
      "Rotated the win panel and its replay action 90 degrees; retained independent two-player touch controls and first-to-five rules.",
      "Kept the preview/start instruction normally oriented, following the latest clarification."
    ],
    "status": "Latest reviewed changes · 29 October 2026",
    "evidence": [
      "New five UI round · 29 October 2026"
    ]
  }
};
