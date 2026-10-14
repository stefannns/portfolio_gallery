/* Generated from the October 13 confirmed UI fix report. Local only. */
(function () {
  const records = window.PLAYABLE_IMPLEMENTED_FIXES || (window.PLAYABLE_IMPLEMENTED_FIXES = {});
  const fixes = [
  {
    "number": 1,
    "taskId": "playable2_20260924214501_peqvrc",
    "summary": "18px action cues, including the short-screen layout.",
    "ids": [
      "UI-20261013-1-1"
    ]
  },
  {
    "number": 2,
    "taskId": "playable_20260924213804_34rslj",
    "summary": "Compact 1/7 progress, 28px status, 30px side/top margins and 50px bottom control clearance.",
    "ids": [
      "UI-20261013-2-1"
    ]
  },
  {
    "number": 3,
    "taskId": "playable2_20260927020828_5pmrhn",
    "summary": "Centered 28px 1/4 progress; Reset separated from it; stable header space.",
    "ids": [
      "UI-20261013-3-1"
    ]
  },
  {
    "number": 4,
    "taskId": "playable2_20260927020828_hix8pk",
    "summary": "No automatic earnings before input; first tap places the pad immediately; centered numeric money status; readable guide that hides after use.",
    "ids": [
      "UI-20261013-4-1"
    ]
  },
  {
    "number": 6,
    "taskId": "playable2_20260927020828_oumj12",
    "summary": "Compact round and numeric score in a 28px left/right row with 30px margins. Raw percentages above 100% retained.",
    "ids": [
      "UI-20261013-6-1"
    ]
  },
  {
    "number": 7,
    "taskId": "playable2_20260927020828_9vxaxo",
    "summary": "Compact left/right score and best-score row; one-line 18px cue. Pixel art, growth speed and difficulty retained.",
    "ids": [
      "UI-20261013-7-1"
    ]
  },
  {
    "number": 9,
    "taskId": "playable2_20260927020828_86gl5z",
    "summary": "Round and match percentage moved to consistent 28px left/right status slots. Target color, match meaning and mixing actions retained.",
    "ids": [
      "UI-20261013-9-1"
    ]
  },
  {
    "number": 10,
    "taskId": "playable2_20260927020828_y5a1vt",
    "summary": "Compact paired round/score row, 28px values and 30px side margins; target remains separate.",
    "ids": [
      "UI-20261013-10-1"
    ]
  },
  {
    "number": 12,
    "taskId": "playable2_20260927021659_jfkvov",
    "summary": "Compact 1/4 and score, 28px status and 30/50 margins; short-screen answer spacing prevents question clipping.",
    "ids": [
      "UI-20261013-12-1"
    ]
  },
  {
    "number": 13,
    "taskId": "playable2_20260927020825_z23fv4",
    "summary": "30px margins around mode tabs/activity; Reset leaves 50px bottom clearance; short-screen style overrides corrected.",
    "ids": [
      "UI-20261013-13-1"
    ]
  },
  {
    "number": 14,
    "taskId": "playable2_20260927020825_iyfbfj",
    "summary": "Centered 28px balance without redundant label/capsule; higher-contrast guide; separate named shop action and 50px Sell clearance.",
    "ids": [
      "UI-20261013-14-1"
    ]
  },
  {
    "number": 16,
    "taskId": "playable2_20260927020825_n4r34c",
    "summary": "Redundant title removed; one-line 18px drawing cue; consistent outer margins.",
    "ids": [
      "UI-20261013-16-1"
    ]
  },
  {
    "number": 17,
    "taskId": "playable2_20260927020825_lnwh1h",
    "summary": "Compact 1/3 and 0/100 paired status, 28px values and 30/50 margins. Levels, target and digging physics retained.",
    "ids": [
      "UI-20261013-17-1"
    ]
  },
  {
    "number": 19,
    "taskId": "playable2_20260927020825_kxh9p4",
    "summary": "Consistent numeric balance/ant count, legible 18px guide and control margins. Essential ant-count meaning retained.",
    "ids": [
      "UI-20261013-19-1"
    ]
  },
  {
    "number": 21,
    "taskId": "playable2_20260927021136_x3i163",
    "summary": "Redundant title removed; instruction hides after valid input and returns on Reset; named Reset and consistent header spacing.",
    "ids": [
      "UI-20261013-21-1"
    ]
  },
  {
    "number": 22,
    "taskId": "playable2_20260927021201_7etgko",
    "summary": "Active bug health uses the 28px status role. Post-style mechanic and content retained.",
    "ids": [
      "UI-20261013-22-1"
    ]
  },
  {
    "number": 23,
    "taskId": "playable2_20260928023148_i47u62",
    "summary": "28px enemy count with a small identifying label; concise one-line command cue. Neutral troop behavior unchanged.",
    "ids": [
      "UI-20261013-23-1"
    ]
  },
  {
    "number": 24,
    "taskId": "playable2_20260928023148_kiq9wu",
    "summary": "Route instruction reduced to the 18px role, within the caption limit.",
    "ids": [
      "UI-20261013-24-1"
    ]
  },
  {
    "number": 25,
    "taskId": "playable2_20260928024159_iasubp",
    "summary": "Round and collection count paired at the top; Reset/New Level separated into the lower control area.",
    "ids": [
      "UI-20261013-25-1"
    ]
  },
  {
    "number": 27,
    "taskId": "playable2_20260928024805_31g1lw",
    "summary": "Centered 28px money readout without repeated label; readable guide and 30/50 control spacing.",
    "ids": [
      "UI-20261013-27-1"
    ]
  },
  {
    "number": 28,
    "taskId": "playable2_20260928024950_5wf6st",
    "summary": "Repeated game heading/description removed; actual stopwatch and target retained.",
    "ids": [
      "UI-20261013-28-1"
    ]
  },
  {
    "number": 30,
    "taskId": "playable2_20260928025330_g1w5ss",
    "summary": "Sole progress value centered at the top.",
    "ids": [
      "UI-20261013-30-1"
    ]
  },
  {
    "number": 33,
    "taskId": "playable2_20260928030116_67pobm",
    "summary": "Five primary actions reflow inside 30px side margins with readable labels and touch targets.",
    "ids": [
      "UI-20261013-33-1"
    ]
  },
  {
    "number": 34,
    "taskId": "playable2_20260928030211_tdjer2",
    "summary": "Redundant configuration heading removed; actual creation controls retained.",
    "ids": [
      "UI-20261013-34-1"
    ]
  },
  {
    "number": 36,
    "taskId": "playable2_20260928030642_uthymy",
    "summary": "Paired 28px values above the essential fruit name; 18px drop cue hides on input; reset restores it; 50px bottom clearance.",
    "ids": [
      "UI-20261013-36-1"
    ]
  },
  {
    "number": 37,
    "taskId": "playable2_20260928030932_n6urd6",
    "summary": "Compact 28px score/time row and 30px side/top margins.",
    "ids": [
      "UI-20261013-37-1"
    ]
  },
  {
    "number": 38,
    "taskId": "playable2_20260928031234_805376",
    "summary": "Redundant title removed; guide contrast/size improved; named native directional buttons.",
    "ids": [
      "UI-20261013-38-1"
    ]
  },
  {
    "number": 39,
    "taskId": "playable2_20260928031559_rckaf4",
    "summary": "Centered score uses 28px and the 30px top margin.",
    "ids": [
      "UI-20261013-39-1"
    ]
  },
  {
    "number": 43,
    "taskId": "playable2_20261001225611_gjmtbw",
    "summary": "Redundant title replaced by centered 28px tap count; larger clue legend; 30/50 map margins. 8×8 board retained.",
    "ids": [
      "UI-20261013-43-1"
    ]
  },
  {
    "number": 44,
    "taskId": "playable2_20261001225611_zgfls0",
    "summary": "Named native material buttons with selected states, horizontally scrollable palette and 50px Clear clearance. Particle physics untouched.",
    "ids": [
      "UI-20261013-44-1"
    ]
  },
  {
    "number": 45,
    "taskId": "playable2_20261001225611_23t98b",
    "summary": "Readable 16px reply labels, three columns and 30px side margins. Intentional reply scrolling retained.",
    "ids": [
      "UI-20261013-45-1"
    ]
  },
  {
    "number": 46,
    "taskId": "playable2_20261001225611_bz1ptc",
    "summary": "First-action cue shortened to one line. Target BPM and live timing retained.",
    "ids": [
      "UI-20261013-46-1"
    ]
  },
  {
    "number": 47,
    "taskId": "playable2_20261001225611_0e3wo5",
    "summary": "Smaller control pane/joystick with bottom clearance; full-width play arena retained.",
    "ids": [
      "UI-20261013-47-1"
    ]
  },
  {
    "number": 49,
    "taskId": "playable2_20261001225821_af5uee",
    "summary": "Stress/time split left/right; one-line carving cue.",
    "ids": [
      "UI-20261013-49-1"
    ]
  },
  {
    "number": 50,
    "taskId": "playable2_20261001225836_jx30zt",
    "summary": "Redundant title removed from the active runtime; concise guide and 30/50 margins. Temperature drift and feeding effects retained.",
    "ids": [
      "UI-20261013-50-1"
    ]
  },
  {
    "number": 51,
    "taskId": "playable2_20261001225842_2d0kul",
    "summary": "Redundant thermal title removed; readable 18px guide hides after interaction instead of changing into a second explanation.",
    "ids": [
      "UI-20261013-51-1"
    ]
  },
  {
    "number": 52,
    "taskId": "playable2_20261001225856_15hv2j",
    "summary": "Canvas score is a centered 28px numeric value at the top, without the repeated SCORE label.",
    "ids": [
      "UI-20261013-52-1"
    ]
  },
  {
    "number": 53,
    "taskId": "playable2_20261001225926_ibkv62",
    "summary": "Redundant heading removed; readable controls, one-line drawing guide that hides after input; native action buttons and consistent margins.",
    "ids": [
      "UI-20261013-53-1"
    ]
  },
  {
    "number": 54,
    "taskId": "playable2_20261001225937_72e2ez",
    "summary": "Long marketing/duplicate text replaced by a concise first-action cue; Timelapse leaves 50px bottom clearance.",
    "ids": [
      "UI-20261013-54-1"
    ]
  },
  {
    "number": 57,
    "taskId": "playable2_20261001230052_xrken6",
    "summary": "Compact toolbar with single-line plant labels and horizontal palette scrolling. Only layout styles changed; plant-generation runtime untouched.",
    "ids": [
      "UI-20261013-57-1"
    ]
  },
  {
    "number": 61,
    "taskId": "playable2_20261001230147_id39lj",
    "summary": "Stable-contrast one-line 18px guide; removed the fading-opacity pulse that reduced readability.",
    "ids": [
      "UI-20261013-61-1"
    ]
  },
  {
    "number": 62,
    "taskId": "playable2_20261001230212_tajqhm",
    "summary": "One-line PLAY/STOP instruction; actual timer, target and controls retained.",
    "ids": [
      "UI-20261013-62-1"
    ]
  },
  {
    "number": 65,
    "taskId": "playable2_20261001230332_5af21q",
    "summary": "First-action cue shortened to one line. Car art, sound, steering, dial and scoring retained.",
    "ids": [
      "UI-20261013-65-1"
    ]
  },
  {
    "number": 67,
    "taskId": "playable2_20261001230412_o52e38",
    "summary": "Sole score displayed numerically without the SCORE prefix; instruction uses 18px.",
    "ids": [
      "UI-20261013-67-1"
    ]
  },
  {
    "number": 69,
    "taskId": "playable2_20261013020814_b973b1",
    "summary": "Compact 1/17 at 28px; 30/50 control margins; native named directional buttons with keyboard and pointer-release cleanup.",
    "ids": [
      "UI-20261013-69-1"
    ]
  },
  {
    "number": 70,
    "taskId": "playable2_20261013020814_woay2o",
    "summary": "Readable 18px photo cue; safe lower-control spacing; native Hide/Show buttons; restored the real photo-upload input and keyboard access.",
    "ids": [
      "UI-20261013-70-1"
    ]
  },
  {
    "number": 72,
    "taskId": "playable2_20261013020955_2hyyml",
    "summary": "Repeated Time Camera/Era Explorer headings removed; consistent setup margins; essential era/year and camera action retained.",
    "ids": [
      "UI-20261013-72-1"
    ]
  },
  {
    "number": 73,
    "taskId": "playable2_20261013021144_kzqdfu",
    "summary": "All eleven food props are visible in two centered rows instead of a horizontal scroller. Selected-state feedback and feeding effects retained; score remains removed.",
    "ids": [
      "UI-20261013-73-1", "Koi two-row props follow-up 20261013"
    ]
  }
];
  for (const fix of fixes) {
    const previous = records[fix.taskId] || { number:fix.number, items:[], evidence:[] };
    const note = 'UI audit — Oct 13: ' + fix.summary;
    records[fix.taskId] = { ...previous, items: [...previous.items.filter(item => !item.startsWith('UI audit — Oct 13: ')), note], evidence: [...new Set([...(previous.evidence || []), ...fix.ids])], status: (previous.status ? previous.status + ' ' : '') + 'October 13 UI repairs implemented locally; awaiting review.' };
  }
})();
