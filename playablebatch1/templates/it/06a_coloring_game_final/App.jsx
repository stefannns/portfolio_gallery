// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
// Older hosts can still size the scene on mount and window resize.
function observeGameSize(callback) {
  if (typeof ResizeObserver === 'function') return new ResizeObserver(callback);

  const targets = new Set();
  let frame;
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const entries = Array.from(targets, target => ({
        target,
        contentRect: { width: target.clientWidth, height: target.clientHeight }
      }));
      if (entries.length) callback(entries);
    });
  }
  return {
    observe(target) {
      targets.add(target);
      window.addEventListener('resize', schedule);
      schedule();
    },
    disconnect() {
      targets.clear();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
    }
  };
}

const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "ENABLE_SOUND",
    "kind": "boolean",
    "label": "Enable Sound",
    "value": true,
    "default": true
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "Colora con i numeri",
    "default": "Colora con i numeri",
    "max_length": 20
  }, {
    "id": "TXT_WIN",
    "label": "Win Message",
    "value": "Bellissimo!",
    "default": "Bellissimo!",
    "max_length": 20
  }, {
    "id": "BTN_PLAY_AGAIN",
    "label": "Play Again Button",
    "value": "Rigioca",
    "default": "Rigioca",
    "max_length": 15
  }],
  "images": [{
    "id": "SOURCE_ORIGINAL",
    "label": "Original Input Image",
    "path": "./assets/source_original.webp",
    "replaceable": true
  }, {
    "id": "BG_CARTOON",
    "label": "Generated Color-by-Number Artwork",
    "path": "./assets/bg_cartoon_canonical_v5.webp",
    "replaceable": false
  }],
  "image_pipeline": {
    "source_slot": "SOURCE_ORIGINAL",
    "output_slot": "BG_CARTOON",
    "execution_stage": "authoring_preprocess",
    "accepted_source": "person_animal_or_scene_image",
    "preprocess": ["preserve_main_subject_and_scene", "redraw_as_flat_color_by_number_illustration", "simplify_into_large_closed_regions", "limit_to_10_to_12_distinct_colors", "validate_mobile_tappable_regions"],
    "output_contract": "One fully colored 4:5 portrait illustration with a large centered subject, 10-12 flat colors, and clean closed organic regions suitable for color-by-number segmentation.",
    "runtime_behavior": "The browser converts the preprocessed colored illustration into a numbered grayscale board and restores each region color when correctly tapped.",
    "region_contract": "The generated color artwork is the canonical source for both the preview/result and the playable segmentation. Every visible semantic shape in that artwork must survive as one or more spatially connected regions, and every visible pixel must belong to a region. Disconnected areas that share a palette color remain separate completion steps. Merge gradients, shadows, decorative shading, narrow contour ribbons and outline-like slivers into a directly touching semantic region; never expose those effects as standalone color numbers. Preserve compact enclosed identity-bearing accents such as eyes, irises, pupils, noses, lips, buttons, signs, windows, petals and flower centers as playable regions. Preserve extremely small enclosed highlights as always-visible decorative details rather than assigning unreadable numbers to them. The numbered board must assign contrasting gray values to adjacent palette regions so separate shapes remain visibly distinct without drawing outlines.",
    "preserve_source_asset": true,
    "completion_before_source": "SOURCE_ORIGINAL",
    "transform_prompt": "Redraw any supplied person, pet, animal, object, street, interior, landscape, or building photo as a highly simplified premium children's color-by-number illustration. Preserve the recognizable main subject, pose, composition, and identity-defining structures. Simplification is semantic, not destructive: remove photographic texture and secondary clutter, while retaining logical facial features and object parts. For faces and animals keep eyes as readable nested closed shapes including sclera or eye base when visible, iris, pupil and one simple highlight; also keep nose, mouth and inner ears. For plants and scenes keep meaningful separations such as petals versus flower centers, trunk versus canopy, doors versus walls, windows versus buildings, road versus ground, and signs versus their supports. Normalize every source to a fixed 4:5 portrait composition, intelligently recomposing or extending a simplified background without stretching. Make the subject large, centered, and fully visible. Use approximately 28-38 broad, smooth, rounded, organic closed regions and only 9-12 harmonious solid colors. Every visible shape must be a flat, closed, contiguous color area large enough for mobile tapping and one clear uniform-sized number. Neighboring semantic parts must never be fused merely because their colors are similar. Use perfectly smooth silhouettes with no fur spikes, sawtooth edges, individual grass blades, leaf clusters, bark texture, layered foliage detail, thin slivers, narrow gaps, gradients, shading, texture, blur, shadows, glow, line art, borders, outlines, or decorative highlights. Output only the fully colored canonical illustration with no numbers, UI, palette, text, watermark, transparency, or unfilled gaps."
  },
  "config_version": "2.0",
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "it",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
let runtimeConfig = DEFAULT_CONFIG;
async function requestGameConfig() {
  let deadline;
  try {
    const request = fetch('./game.config.json', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .catch(() => null);
    const timeout = new Promise(resolve => {
      deadline = setTimeout(() => resolve(null), 1200);
    });
    const config = await Promise.race([request, timeout]);
    if (config && typeof config === 'object' && !Array.isArray(config)) runtimeConfig = config;
    return { ok: true, json: async () => runtimeConfig };
  } finally {
    clearTimeout(deadline);
  }
}
const GAME_STYLES = `
    /* 容器中立硬规：html / body / #root 三层撑满 + overflow:hidden + 无 vh/vw */
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  
@font-face{font-family:"Nunito Sans";src:url("./assets/fonts/ui/NunitoSans.woff") format("woff");font-style:normal;font-weight:100 1000;font-display:swap}
:root{--font-display:"Nunito Sans","PingFang SC",system-ui,sans-serif;--font-body:"Nunito Sans","PingFang SC",system-ui,sans-serif;--ui-ink:#303a43;--ui-surface:#f7f8f8}
.ui-game{font-family:var(--font-body);font-optical-sizing:auto;font-synthesis:none;-webkit-font-smoothing:antialiased}
.ui-game button{font-family:var(--font-body);font-weight:700;letter-spacing:0;line-height:1.25}
.ui-game .ui-guide{font-family:var(--font-body);font-weight:600;letter-spacing:0;line-height:1.35}

/* Art-first layout: the artwork can bleed wider, while controls keep safe gutters. */
html body .stage{background:#f7f8f8}
html body .game{--ui-scale:var(--design-scale,1);--ui-side:calc(30px * var(--ui-scale));container-type:size;width:100%;max-width:none;padding:calc(30px * var(--ui-scale)) 0 calc(50px * var(--ui-scale));box-shadow:none;gap:4px;background:#f7f8f8;font-family:"Nunito Sans","PingFang SC",system-ui,sans-serif;font-synthesis:none;font-optical-sizing:auto}
html body .stage{container-type:size}
html body .topbar{flex:0 0 44px;height:44px;margin:0 var(--ui-side);align-items:center}
html body .left-tools{width:44px}
html body .round-btn,html body .hint-btn{height:44px;min-height:44px;border-radius:999px;box-shadow:none;border:1px solid #dce3e4;background:#fff}
html body .round-btn{width:44px;min-width:44px}
html body .round-btn svg{width:23px;height:23px}
html body .hint-btn{width:62px;min-width:62px;font:700 18px "Nunito Sans",sans-serif;padding:0 8px;gap:5px}
html body .bulb{width:24px;height:24px;flex-basis:24px;border:0;background:#fff2b9}
html body .bulb svg{width:18px;height:18px}
html body .progress-card{width:auto;max-width:calc(100% - 140px);height:44px;border:0;border-radius:0;background:transparent;box-shadow:none;padding:4px 0;overflow:visible}
html body .progress-copy,html body .progress-copy b{font-family:inherit;font-size:calc(28px * var(--ui-scale));line-height:1.2;font-weight:800;letter-spacing:-.7px;color:#303a43;font-variant-numeric:tabular-nums}
html body .track{display:none}
html body .canvas-zone{container-type:size;margin-top:22px;overflow:hidden;min-height:0}
html body .canvas-wrap{width:min(calc(100cqw - 8px),80cqh);max-height:100%;border:0;border-radius:10px;box-shadow:0 2px 9px #303a4310;aspect-ratio:4/5}
html body .loading{width:100%;max-width:100%;padding:16px;gap:12px;text-align:center;color:#4c5964}
html body .load-title{max-width:100%;font-family:inherit;font-size:calc(24px * var(--ui-scale));font-weight:800;line-height:1.25;letter-spacing:0;overflow-wrap:anywhere}
html body .load-sub{max-width:100%;font-family:inherit;font-size:calc(18px * var(--ui-scale));font-weight:600;line-height:1.4;color:#4c5964;overflow-wrap:anywhere}
html body .palette-shell{flex:0 0 auto;align-self:center;width:calc(100% - 2 * var(--ui-side));max-width:100%;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;overflow:visible}
html body .palette-shell:before,html body .palette-shell:after{display:block;width:18px;pointer-events:none}
html body .palette-shell:before{background:linear-gradient(90deg,#f7f8f8,transparent)}
html body .palette-shell:after{background:linear-gradient(270deg,#f7f8f8,transparent)}
html body .palette{display:flex;flex-wrap:nowrap;gap:8px;padding:4px;overflow-x:auto;overflow-y:hidden;max-width:100%;scroll-padding-inline:4px;touch-action:pan-x;scrollbar-width:none;overscroll-behavior-x:contain}
html body .palette::-webkit-scrollbar{display:none}
html body .swatch{flex:0 0 44px;width:44px;height:44px;min-width:44px;min-height:44px;font-family:inherit;box-shadow:inset 0 0 0 2px #ffffffd9;scroll-margin-inline:4px}
html body .swatch span{width:29px;height:29px;font-size:17px;font-weight:800;text-shadow:none}
html body .swatch.active{box-shadow:inset 0 0 0 2px #354e61,inset 0 0 0 5px #fff}
html body .toast{bottom:calc(50px * var(--ui-scale) + 64px);max-width:calc(100% - 60px * var(--ui-scale));white-space:normal;overflow-wrap:anywhere;font:600 calc(18px * var(--ui-scale))/1.35 "Nunito Sans",sans-serif;text-align:center;border-radius:12px}
html body .coloring-guide{position:absolute;left:var(--ui-side);right:var(--ui-side);top:calc(30px * var(--ui-scale) + 47px);margin:0;text-align:center;font-size:calc(18px * var(--ui-scale));font-weight:600;line-height:1.3;color:#4c5964;pointer-events:none}
html body .game[data-complete="true"] .topbar,html body .game[data-complete="true"] .palette-shell{visibility:hidden;pointer-events:none}
html body .game[data-complete="true"] .toast{display:none}
html body .win{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:calc(30px * var(--ui-scale)) calc(30px * var(--ui-scale)) calc(50px * var(--ui-scale));background:transparent;border:0;border-radius:0;box-shadow:none;backdrop-filter:none;overflow:visible;pointer-events:none}
html body .win h2{font-family:inherit;font-size:max(20px,calc(24px * var(--ui-scale)));font-weight:800;line-height:1.25;max-width:100%;overflow-wrap:anywhere;letter-spacing:0;margin:0;padding:0;background:transparent;border:0;box-shadow:none;color:#fff;text-shadow:0 2px 8px #182a3a90,0 0 2px #182a3a;animation:coloring-beautiful .25s ease-out both}
@keyframes coloring-beautiful{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
html body button:focus-visible{outline:3px solid #354e61;outline-offset:2px}
@keyframes coloring-guide-float{50%{transform:translateY(-2px)}}
html body .coloring-guide{animation:coloring-guide-float 2.6s ease-in-out infinite}
html[data-design-hidden="true"] .coloring-guide{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){html body .game *{animation:none!important;transition-duration:.001ms!important}}
@media(max-height:440px){html body .canvas-zone{margin-top:18px}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.coloring-guide{position:fixed!important;top:50%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.coloring-guide{background:rgba(255,253,248,.94);color:#293c34;padding:6px 12px;border-radius:999px}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(p.coloring-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(p.coloring-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(p.coloring-guide){animation:none!important}}

/* Italian copy keeps the approved role sizes and may wrap instead of clipping. */
html[lang="it"] :is(.meeting-guide,.feed-first-action,.melody-guide,.particle-guide,.dive-guide,.sandbox-guide,.koi-guide,.ui-guide,.bead-guide,.coloring-guide,.look-guide,.time-print-guide){white-space:normal;overflow-wrap:normal;word-break:normal;line-height:1.4}
html[lang="it"] :is(button,.btn,.btn-neon){overflow-wrap:normal;word-break:normal}
html[lang="it"] .melody-controls button{font-size:18px;padding-inline:12px}
html[lang="it"] .meeting-sand-ball-count{gap:6px!important}
html[lang="it"] #people-dialog fieldset label{min-width:0}
html[lang="it"] #people-dialog input{max-width:100%;min-width:0}
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
document.documentElement.lang = 'it';
var COLORING_DEFAULTS = {
  ENABLE_SOUND: true,
  GAME_TITLE: "Colora con i numeri",
  TXT_WIN: "Bellissimo!",
  BTN_PLAY_AGAIN: "Rigioca",
  SOURCE_ORIGINAL: "./assets/source_original.webp",
  BG_CARTOON: "./assets/bg_cartoon_canonical_v5.webp"
};
function readConfigValues(config) {
  let options = {
    ...COLORING_DEFAULTS
  };
  (config.tweaks || []).forEach(item => {
    options[item.id] = item.value;
  });
  (config.texts || []).forEach(item => {
    options[item.id] = item.value;
  });
  (config.images || []).forEach(item => {
    options[item.id] = item.path;
  });
  return options;
}
function perceptualColorDistance(firstColor, secondColor) {
  let redDifference = firstColor[0] - secondColor[0];
  let greenDifference = firstColor[1] - secondColor[1];
  let blueDifference = firstColor[2] - secondColor[2];
  let meanRed = (firstColor[0] + secondColor[0]) / 2;
  return (2 + meanRed / 256) * redDifference * redDifference + 4 * greenDifference * greenDifference + (2 + (255 - meanRed) / 256) * blueDifference * blueDifference;
}
function extractPalette(pixels, paletteSize) {
  let samples = [];
  let pixelCount = pixels.length / 4;
  let sampleStride = Math.max(1, Math.floor(pixelCount / 6500));
  for (let value = 0; value < pixelCount; value += sampleStride) {
    let value2 = value * 4;
    samples.push([pixels[value2], pixels[value2 + 1], pixels[value2 + 2]]);
  }
  let centroids = [];
  let darkestColor = samples[0];
  for (let value of samples) {
    if (value[0] + value[1] + value[2] < darkestColor[0] + darkestColor[1] + darkestColor[2]) {
      darkestColor = value;
    }
  }
  for (centroids.push([...darkestColor]); centroids.length < paletteSize;) {
    let item = samples[0];
    let value = -1;
    for (let value2 of samples) {
      let y = 1 / 0;
      for (let value3 of centroids) y = Math.min(y, perceptualColorDistance(value2, value3));
      if (y > value) {
        value = y;
        item = value2;
      }
    }
    centroids.push([...item]);
  }
  for (let value = 0; value < 9; value++) {
    let value2 = centroids.map(() => [0, 0, 0, 0]);
    for (let value3 of samples) {
      let y = 0;
      let value4 = 1 / 0;
      centroids.forEach((item, index) => {
        let z = perceptualColorDistance(value3, item);
        if (z < value4) {
          value4 = z;
          y = index;
        }
      });
      value2[y][0] += value3[0];
      value2[y][1] += value3[1];
      value2[y][2] += value3[2];
      value2[y][3]++;
    }
    value2.forEach((item, y) => {
      if (item[3]) {
        centroids[y] = [item[0] / item[3], item[1] / item[3], item[2] / item[3]];
      }
    });
  }
  return centroids.map(item => item.map(Math.round)).sort((leftItem, rightItem) => leftItem[0] * 0.299 + leftItem[1] * 0.587 + leftItem[2] * 0.114 - (rightItem[0] * 0.299 + rightItem[1] * 0.587 + rightItem[2] * 0.114));
}
function nearestPaletteIndex(value, green, blue, palette) {
  let nearestIndex = 0;
  let nearestDistance = 1 / 0;
  for (let value2 = 0; value2 < palette.length; value2++) {
    let value3 = perceptualColorDistance([value, green, blue], palette[value2]);
    if (value3 < nearestDistance) {
      nearestDistance = value3;
      nearestIndex = value2;
    }
  }
  return nearestIndex;
}
function smoothLabels(labels, width, height) {
  let smoothedLabels = labels;
  for (let value = 0; value < 1; value++) {
    let uint8Array = new Uint8Array(smoothedLabels);
    for (let value2 = 1; value2 < height - 1; value2++) for (let value3 = 1; value3 < width - 1; value3++) {
      let value4 = value2 * width + value3;
      let uint8Array2 = new Uint8Array(16);
      for (let value5 = -1; value5 <= 1; value5++) for (let value6 = -1; value6 <= 1; value6++) uint8Array2[smoothedLabels[value4 + value5 * width + value6]]++;
      let y = smoothedLabels[value4];
      let item = uint8Array2[y];
      for (let value5 = 0; value5 < uint8Array2.length; value5++) {
        if (uint8Array2[value5] > item) {
          item = uint8Array2[value5];
          y = value5;
        }
      }
      if (item >= 5) {
        uint8Array[value4] = y;
      }
    }
    smoothedLabels = uint8Array;
  }
  return smoothedLabels;
}
function labelConnectedRegions(labels, width, height) {
  let visited = new Uint8Array(labels.length);
  let regionIds = new Int32Array(labels.length);
  regionIds.fill(-1);
  let int32Array = new Int32Array(labels.length);
  let components = [];
  for (let value = 0; value < labels.length; value++) {
    if (visited[value]) continue;
    let colorIndex = labels[value];
    let length = components.length;
    let y = 0;
    let value2 = 0;
    int32Array[value2++] = value;
    visited[value] = 1;
    let pixels = [];
    let sumX = 0;
    let z = 0;
    let x = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    for (; y < value2;) {
      let item = int32Array[y++];
      let value3 = item % width;
      let value4 = Math.floor(item / width);
      if (regionIds[item] = length, pixels.push(item), sumX += value3, z += value4, x = Math.min(x, value3), maxX = Math.max(maxX, value3), minY = Math.min(minY, value4), maxY = Math.max(maxY, value4), value3 > 0) {
        let value5 = item - 1;
        if (!visited[value5] && labels[value5] === colorIndex) {
          visited[value5] = 1;
          int32Array[value2++] = value5;
        }
      }
      if (value3 + 1 < width) {
        let value5 = item + 1;
        if (!visited[value5] && labels[value5] === colorIndex) {
          visited[value5] = 1;
          int32Array[value2++] = value5;
        }
      }
      if (value4 > 0) {
        let value5 = item - width;
        if (!visited[value5] && labels[value5] === colorIndex) {
          visited[value5] = 1;
          int32Array[value2++] = value5;
        }
      }
      if (value4 + 1 < height) {
        let value5 = item + width;
        if (!visited[value5] && labels[value5] === colorIndex) {
          visited[value5] = 1;
          int32Array[value2++] = value5;
        }
      }
    }
    let perimeter = 0;
    for (let value3 of pixels) {
      let value4 = value3 % width;
      let value5 = Math.floor(value3 / width);
      if (value4 === 0 || labels[value3 - 1] !== colorIndex) {
        perimeter++;
      }
      if (value4 === width - 1 || labels[value3 + 1] !== colorIndex) {
        perimeter++;
      }
      if (value5 === 0 || labels[value3 - width] !== colorIndex) {
        perimeter++;
      }
      if (value5 === height - 1 || labels[value3 + width] !== colorIndex) {
        perimeter++;
      }
    }
    components.push({
      id: length,
      colorIndex: colorIndex,
      pixels: pixels,
      sumX: sumX,
      sumY: z,
      minX: x,
      maxX: maxX,
      minY: minY,
      maxY: maxY,
      perimeter: perimeter
    });
  }
  components.sort((leftItem, rightItem) => rightItem.pixels.length - leftItem.pixels.length);
  return {
    components: components,
    componentAt: regionIds
  };
}
function mergeSmallRegions(labels, width, height, palette) {
  let minimumRegionArea = Math.max(120, Math.round(width * height * 0.0006));
  let minimumRegionSize = 56;
  for (let value = 0; value < 8; value++) {
    let value2 = labelConnectedRegions(labels, width, height);
    let {
      components: value3,
      componentAt: value4
    } = value2;
    let y = new Map(value3.map(item => [item.id, new Map()]));
    for (let value7 = 0; value7 < height; value7++) for (let value8 = 0; value8 < width; value8++) {
      let value9 = value7 * width + value8;
      let item = value4[value9];
      if (value8 + 1 < width) {
        let item2 = value4[value9 + 1];
        if (item2 !== item) {
          y.get(item).set(item2, (y.get(item).get(item2) || 0) + 1);
          y.get(item2).set(item, (y.get(item2).get(item) || 0) + 1);
        }
      }
      if (value7 + 1 < height) {
        let item2 = value4[value9 + width];
        if (item2 !== item) {
          y.get(item).set(item2, (y.get(item).get(item2) || 0) + 1);
          y.get(item2).set(item, (y.get(item2).get(item) || 0) + 1);
        }
      }
    }
    let seenItems = new Set(value3.filter(item => {
      let value7 = item.maxX - item.minX + 1;
      let value8 = item.maxY - item.minY + 1;
      let value9 = item.pixels.length / (value7 * value8);
      let value10 = item.pixels.length / Math.max(1, item.perimeter);
      let value11 = Math.max(value7 / value8, value8 / value7);
      if (!(item.pixels.length >= 6 && value7 >= 2 && value8 >= 2 && value7 <= 18 && value8 <= 18 && value9 >= 0.35 && value10 >= 0.7 && value11 <= 2.5) && (item.pixels.length < 8 || value7 < 3 || value8 < 3 || value9 < 0.28 || value10 < 1.1 || value11 > 3.2) || item.minX === 0 || item.minY === 0 || item.maxX === width - 1 || item.maxY === height - 1) return false;
      let value12 = [...y.get(item.id).entries()].sort((leftItem, rightItem) => rightItem[1] - leftItem[1]);
      if (!value12.length) return false;
      let value13 = value12.reduce((total, item2) => total + item2[1], 0);
      return value12.some(([value14]) => {
        let value15 = value3.find(item2 => item2.id === value14);
        return value15 && perceptualColorDistance(palette[item.colorIndex], palette[value15.colorIndex]) > 2500;
      }) && (value12[0][1] / value13 >= 0.45 || value12.length <= 3);
    }).map(item => item.id));
    let value5 = value3.filter(item => !seenItems.has(item.id) && (item.pixels.length < minimumRegionArea || item.maxX - item.minX < 4 || item.maxY - item.minY < 4 || item.pixels.length / Math.max(1, item.perimeter) < 1.35));
    let value6 = value3.filter(item => !seenItems.has(item.id) && [...y.get(item.id).keys()].some(item2 => {
      let value7 = value3.find(item3 => item3.id === item2);
      return value7 && (value7.pixels.length > item.pixels.length || value7.pixels.length === item.pixels.length && value7.id < item.id) && perceptualColorDistance(palette[item.colorIndex], palette[value7.colorIndex]) < 12000;
    }));
    let z = Math.max(0, value3.length - minimumRegionSize);
    let x = value3.filter(item => !seenItems.has(item.id)).sort((leftItem, rightItem) => leftItem.pixels.length - rightItem.pixels.length).slice(0, z);
    let items = [...new Set([...value5, ...value6, ...x])];
    if (!items.length) return value2;
    let seenItems2 = new Set(items.map(item => item.id));
    let enabled = false;
    for (let value7 of items) {
      let value8 = y.get(value7.id);
      let value9 = [...value8.entries()].filter(([value11]) => !seenItems2.has(value11));
      if (value9.length || (value9 = [...value8.entries()]), !value9.length) continue;
      value9.sort((leftItem, rightItem) => {
        let value11 = value3.find(item => item.id === leftItem[0]);
        let value12 = value3.find(item => item.id === rightItem[0]);
        let value13 = leftItem[1] * 500 - perceptualColorDistance(palette[value7.colorIndex], palette[value11.colorIndex]) + Math.log(value11.pixels.length + 1) * 8;
        return rightItem[1] * 500 - perceptualColorDistance(palette[value7.colorIndex], palette[value12.colorIndex]) + Math.log(value12.pixels.length + 1) * 8 - value13;
      });
      let value10 = value3.find(item => item.id === value9[0][0]);
      if (value10) {
        value7.pixels.forEach(item => {
          labels[item] = value10.colorIndex;
        });
        enabled = true;
      }
    }
    if (!enabled) return value2;
  }
  return labelConnectedRegions(labels, width, height);
}
function assignRegionColors(regions, labels, width, height, paletteSize) {
  let value = Array.from({
    length: paletteSize
  }, () => new Set());
  let handleAction = (y, otherValue) => {
    if (y < 0 || otherValue < 0 || y === otherValue) return;
    let value3 = regions[y].paletteId - 1;
    let value4 = regions[otherValue].paletteId - 1;
    if (!(value3 < 0 || value4 < 0)) {
      if (value3 !== value4) {
        value[value3].add(value4);
        value[value4].add(value3);
      }
    }
  };
  for (let y = 0; y < height; y++) for (let value3 = 0; value3 < width; value3++) {
    let value4 = y * width + value3;
    if (value3 + 1 < width) {
      handleAction(labels[value4], labels[value4 + 1]);
    }
    if (y + 1 < height) {
      handleAction(labels[value4], labels[value4 + width]);
    }
  }
  let items = [136, 232, 164, 210, 148, 224, 180, 200, 156, 218, 172, 240];
  let value2 = new Array(paletteSize).fill(null);
  let seenItems = new Set(Array.from({
    length: paletteSize
  }, (y, otherValue) => otherValue));
  for (; seenItems.size;) {
    let y = [...seenItems].sort((leftItem, rightItem) => {
      let z = [...value[leftItem]].filter(item => value2[item] !== null).length;
      return [...value[rightItem]].filter(item => value2[item] !== null).length - z || value[rightItem].size - value[leftItem].size || leftItem - rightItem;
    })[0];
    let value3 = [...value[y]].map(item => value2[item]).filter(item => item !== null);
    value2[y] = items.reduce((total, item) => {
      let z = value3.length ? Math.min(...value3.map(item2 => Math.abs(item2 - item))) : Math.abs(item - 190);
      let x = value3.length ? Math.min(...value3.map(item2 => Math.abs(item2 - total))) : Math.abs(total - 190);
      return z > x ? item : total;
    }, items[0]);
    seenItems.delete(y);
  }
  return value2;
}
function createColoringBoard(imageUrl) {
  let canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 600;
  let context = canvas.getContext("2d", {
    willReadFrequently: true
  });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = "saturate(.96) contrast(1.03)";
  let value = Math.max(480 / imageUrl.naturalWidth, 600 / imageUrl.naturalHeight);
  let value2 = imageUrl.naturalWidth * value;
  let value3 = imageUrl.naturalHeight * value;
  context.drawImage(imageUrl, (480 - value2) / 2, (600 - value3) / 2, value2, value3);
  context.filter = "none";
  let imageData = context.getImageData(0, 0, 480, 600);
  let palette = extractPalette(imageData.data, 12);
  let y = new Uint8Array(480 * 600);
  for (let value5 = 0; value5 < y.length; value5++) {
    let value6 = value5 * 4;
    y[value5] = nearestPaletteIndex(imageData.data[value6], imageData.data[value6 + 1], imageData.data[value6 + 2], palette);
  }
  y = smoothLabels(y, 480, 600);
  let regionMap = new Int16Array(480 * 600);
  regionMap.fill(-1);
  let {
    components: value4
  } = mergeSmallRegions(y, 480, 600, palette);
  let handleAction = value5 => {
    let value6 = value5.maxX - value5.minX + 1;
    let value7 = value5.maxY - value5.minY + 1;
    let value8 = value5.pixels.length / (value6 * value7);
    let value9 = value5.pixels.length / Math.max(1, value5.perimeter);
    return value5.pixels.length <= 85 && value6 <= 18 && value7 <= 18 && value8 >= 0.35 && value9 >= 0.7 && value5.minX > 0 && value5.minY > 0 && value5.maxX < 479 && value5.maxY < 599;
  };
  let z = [...new Set(value4.filter(item => !handleAction(item)).map(item => item.colorIndex))].sort((leftItem, rightItem) => leftItem - rightItem);
  let x = new Map(z.map((item, index) => [item, index + 1]));
  let paletteItems = z.map((sourceIndex, index) => ({
    id: index + 1,
    sourceIndex: sourceIndex,
    rgb: palette[sourceIndex],
    remaining: 0
  }));
  let regions = value4.map((item, index) => {
    item.pixels.forEach(item2 => {
      regionMap[item2] = index;
    });
    let decorative = handleAction(item);
    let paletteId = x.get(item.colorIndex) || 0;
    if (!decorative) {
      paletteItems[paletteId - 1].remaining++;
    }
    return {
      ...item,
      id: index,
      paletteId: paletteId,
      rgb: palette[item.colorIndex],
      decorative: decorative,
      labelX: 0,
      labelY: 0,
      filled: decorative
    };
  });
  let items = [];
  [...regions].sort((leftItem, rightItem) => leftItem.pixels.length - rightItem.pixels.length).forEach(item => {
    let value5 = item.sumX / item.pixels.length;
    let value6 = item.sumY / item.pixels.length;
    let item2 = item.pixels[0];
    let value7 = -1 / 0;
    let value8 = Math.max(1, Math.floor(item.pixels.length / 1000));
    for (let value9 = 0; value9 < item.pixels.length; value9 += value8) {
      let item3 = item.pixels[value9];
      let value10 = item3 % 480;
      let value11 = Math.floor(item3 / 480);
      let value12 = Math.hypot(value10 - value5, value11 - value6);
      let value13 = items.length ? Math.min(...items.map(point => Math.hypot(value10 - point.x, value11 - point.y))) : 60;
      let value14 = 0;
      for (let value16 of [3, 6, 9, 12]) if ([[value10 - value16, value11], [value10 + value16, value11], [value10, value11 - value16], [value10, value11 + value16], [value10 - value16, value11 - value16], [value10 + value16, value11 - value16], [value10 - value16, value11 + value16], [value10 + value16, value11 + value16]].every(([value17, value18]) => value17 >= 0 && value18 >= 0 && value17 < 480 && value18 < 600 && regionMap[value18 * 480 + value17] === item.id)) value14 = value16;else break;
      let value15 = value14 * 26 + Math.min(60, value13) * 3 - value12 * 0.18;
      if (value15 > value7) {
        value7 = value15;
        item2 = item3;
      }
    }
    item.labelX = item2 % 480;
    item.labelY = Math.floor(item2 / 480);
    items.push({
      x: item.labelX,
      y: item.labelY
    });
  });
  let flat = new Uint8ClampedArray(480 * 600 * 4);
  for (let value5 = 0; value5 < y.length; value5++) {
    let item = palette[y[value5]];
    let value6 = value5 * 4;
    flat[value6] = item[0];
    flat[value6 + 1] = item[1];
    flat[value6 + 2] = item[2];
    flat[value6 + 3] = 255;
  }
  let dimensions = document.createElement("canvas");
  dimensions.width = 480;
  dimensions.height = 600;
  dimensions.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(flat), 480, 600), 0, 0);
  let resultUrl = dimensions.toDataURL("image/png");
  let grayValues = assignRegionColors(regions, regionMap, 480, 600, paletteItems.length);
  return {
    width: 480,
    height: 600,
    labels: y,
    palette: palette,
    paletteItems: paletteItems,
    regions: regions,
    regionMap: regionMap,
    flat: flat,
    grayValues: grayValues,
    resultUrl: resultUrl,
    total: regions.filter(item => !item.decorative).length
  };
}
function coloringHitRegion(board, clientX, clientY, rect, selectedColor, radius = 12) {
  if (!board || !rect || !Number.isFinite(clientX) || !Number.isFinite(clientY) || !(rect.width > 0) || !(rect.height > 0)) return -1;
  const scaleX = board.width / rect.width;
  const scaleY = board.height / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  if (x < 0 || y < 0 || x >= board.width || y >= board.height) return -1;
  const exact = board.regionMap[Math.floor(y) * board.width + Math.floor(x)] ?? -1;
  const matches = value => {
    const region = board.regions[value];
    return region && !region.filled && !region.decorative && region.paletteId === selectedColor;
  };
  if (matches(exact)) return exact;
  const reach = Math.max(0, Math.min(16, Number(radius) || 0));
  let best = -1;
  let bestDistance = reach * reach;
  const minX = Math.max(0, Math.floor(x - reach * scaleX));
  const maxX = Math.min(board.width - 1, Math.ceil(x + reach * scaleX));
  const minY = Math.max(0, Math.floor(y - reach * scaleY));
  const maxY = Math.min(board.height - 1, Math.ceil(y + reach * scaleY));
  for (let value = minY; value <= maxY; value++) {
    const value2 = (value + 0.5 - y) / scaleY;
    const value3 = value2 * value2;
    if (value3 > bestDistance) continue;
    for (let value4 = minX; value4 <= maxX; value4++) {
      const item = board.regionMap[value * board.width + value4];
      if (!matches(item)) continue;
      const value5 = (value4 + 0.5 - x) / scaleX;
      const distance = value5 * value5 + value3;
      if (distance < bestDistance || distance === bestDistance && (best < 0 || item < best)) {
        bestDistance = distance;
        best = item;
      }
    }
  }
  return best >= 0 ? best : exact;
}
var COLORING_STYLES = `
@font-face{font-family:Bangers;src:url('./assets/fonts/bangers/Bangers-Regular.woff2') format('woff2');font-display:swap}
:root{--ink:#3d3d47;--muted:#8d8d99;--paper:#fff;--page:#f3f4f6;--accent:#7167db;--gutter:clamp(18px,5vw,28px)}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;user-select:none}
html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#dde0e6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}
button{font:inherit}
.stage{width:100%;height:100%;display:grid;place-items:center;background:radial-gradient(circle at 50% 14%,#fff 0,#e9ebf0 48%,#d2d6de 100%)}
.game{position:relative;width:min(100%,520px);height:100%;overflow:hidden;background:linear-gradient(180deg,#f8f9fa 0%,#f1f2f4 100%);display:flex;flex-direction:column;padding:clamp(24px,4.5vh,40px) var(--gutter) max(clamp(22px,4vh,40px),env(safe-area-inset-bottom));box-shadow:0 18px 70px rgba(41,45,58,.18)}
.topbar{position:relative;z-index:4;flex:0 0 60px;min-width:0;display:flex;align-items:flex-start;justify-content:space-between}
.left-tools{width:60px;display:flex;justify-content:flex-start}.round-btn,.hint-btn,.progress-card{border:1px solid rgba(58,58,69,.045);background:rgba(255,255,255,.94);box-shadow:0 9px 22px rgba(50,54,66,.13),inset 0 1px 0 #fff}
.round-btn{width:60px;height:60px;border-radius:22px;display:grid;place-items:center;color:#313139;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease}
.round-btn:active,.hint-btn:active{transform:scale(.93)}
.round-btn svg{width:29px;height:29px;fill:none;stroke:currentColor;stroke-width:2.25;stroke-linecap:round;stroke-linejoin:round}
.progress-card{position:absolute;left:50%;transform:translateX(-50%);width:200px;min-width:0;height:60px;padding:10px 12px 8px;border-radius:23px;text-align:center;overflow:hidden}
.progress-copy{font-size:18px;font-weight:850;letter-spacing:-.45px;white-space:nowrap;line-height:23px;color:#53535e;font-variant-numeric:tabular-nums}
.progress-copy b{font-size:21px;color:#272730}.track{height:4px;margin-top:7px;background:#e1e1e5;border-radius:5px;overflow:hidden}.track>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7569de,#9c72e7);border-radius:inherit;transition:width .3s ease}
.hint-btn{width:96px;min-width:96px;height:60px;flex:none;border-radius:23px;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 11px;font-size:22px;font-weight:850;color:#282830;cursor:pointer}.bulb{flex:0 0 40px;width:40px;height:40px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:#ffdf61;border:2px solid #e0bd42;color:#66500d}.bulb svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:2.25;stroke-linecap:round;stroke-linejoin:round}
.canvas-zone{position:relative;flex:1;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;overflow:visible}
.canvas-wrap{position:relative;flex:0 0 auto;width:min(100%,calc((100dvh - 230px)*.8));aspect-ratio:4/5;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#e5e5e7;border:4px solid rgba(255,255,255,.94);border-radius:20px;box-shadow:0 12px 20px -14px rgba(48,51,61,.42),0 3px 8px -6px rgba(48,51,61,.2),inset 0 0 0 1px rgba(88,88,98,.04)}
.art{display:block;width:100%;height:100%;touch-action:none;cursor:pointer}
.loading{display:flex;flex-direction:column;align-items:center;gap:16px;color:#777783;font-weight:700}.spinner{width:52px;height:52px;border:6px solid #e2e2e8;border-top-color:#7769df;border-radius:50%;animation:spin .8s linear infinite}.load-title{font-family:Bangers,sans-serif;font-size:27px;letter-spacing:1px}.load-sub{font-size:13px;font-weight:600;color:#aaaab2}
.palette-shell{position:relative;z-index:5;flex:0 0 auto;min-width:0;overflow:hidden;padding:13px 12px;background:rgba(255,255,255,.88);border:1px solid rgba(71,73,83,.04);border-radius:24px;box-shadow:0 10px 28px rgba(50,53,63,.14),inset 0 1px 0 #fff}.palette-shell:before,.palette-shell:after{content:"";position:absolute;z-index:3;top:0;bottom:0;width:28px;pointer-events:none;opacity:0;transition:opacity .2s ease}.palette-shell:before{left:0;background:linear-gradient(90deg,rgba(250,250,251,.98) 18%,rgba(250,250,251,.72) 48%,rgba(250,250,251,0))}.palette-shell:after{right:0;background:linear-gradient(270deg,rgba(250,250,251,.98) 18%,rgba(250,250,251,.72) 48%,rgba(250,250,251,0))}.palette-shell.fade-left:before,.palette-shell.fade-right:after{opacity:1}
.palette{display:flex;gap:7px;overflow-x:auto;overscroll-behavior-x:contain;padding:5px 4px 7px;scrollbar-width:none}.palette::-webkit-scrollbar{display:none}
.swatch{position:relative;flex:0 0 40px;width:40px;height:40px;border:0;border-radius:50%;padding:0;display:grid;place-items:center;cursor:pointer;background:var(--c);box-shadow:0 3px 8px rgba(40,42,51,.15),inset 0 0 0 3px rgba(255,255,255,.72);transition:filter .2s ease,box-shadow .2s ease}.swatch span{width:25px;height:25px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.86);color:#262631;font-size:15px;font-weight:900;line-height:1;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}
.swatch.active{box-shadow:0 3px 9px rgba(35,38,51,.2),inset 0 0 0 3px #6867dc,inset 0 0 0 6px #fff}.swatch.done{filter:saturate(.35);opacity:.5}.swatch.wrong{animation:wobble .3s ease}.swatch:focus-visible,.round-btn:focus-visible,.hint-btn:focus-visible{outline:3px solid #6258d0;outline-offset:2px}
.toast{position:absolute;z-index:8;left:50%;bottom:122px;transform:translate(-50%,12px);padding:9px 15px;border-radius:20px;background:rgba(44,44,53,.88);color:#fff;font-size:13px;font-weight:750;opacity:0;pointer-events:none;transition:.2s ease;white-space:nowrap}.toast.show{opacity:1;transform:translate(-50%,0)}
.win{position:absolute;inset:0;z-index:20;background:rgba(245,246,248,.78);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:20px;animation:fade .3s ease}.win-card{text-align:center;width:min(460px,100%);padding:18px 18px 20px;border-radius:30px;background:#fff;box-shadow:0 24px 70px rgba(45,45,62,.22);transform:translateY(-14px)}.win h2{font-family:Bangers,sans-serif;font-size:38px;letter-spacing:1.2px;margin:0 0 2px;color:#665bd1}.win p{margin:0 0 14px;color:#858590;font-size:13px;font-weight:650}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 16px}.compare-item{min-width:0}.compare-label{display:block;margin:0 0 6px;color:#666672;font-size:11px;font-weight:850;letter-spacing:.8px}.compare-frame{width:100%;aspect-ratio:4/5;display:block;object-fit:cover;border-radius:14px;border:2px solid #f0f0f3;background:#ececef}.again{border:0;border-radius:24px;background:#665bd1;color:#fff;padding:11px 28px;font-family:Bangers,sans-serif;font-size:21px;letter-spacing:.7px;box-shadow:0 7px 18px rgba(102,91,209,.28);cursor:pointer}
@keyframes spin{to{transform:rotate(360deg)}}@keyframes wobble{25%{transform:translateX(-4px)}50%{transform:translateX(4px)}75%{transform:translateX(-2px)}}@keyframes fade{from{opacity:0}}
@media(max-width:430px){:root{--gutter:18px}.topbar{flex-basis:54px}.left-tools{width:54px}.round-btn{width:54px;height:54px}.progress-card{width:160px;height:54px;padding:8px 7px}.progress-copy{font-size:15px}.progress-copy b{font-size:18px}.hint-btn{width:70px;min-width:70px;height:54px;padding:0 6px;gap:4px;font-size:20px}.bulb{flex-basis:34px;width:34px;height:34px}.palette-shell{padding:12px 10px}}
@media(max-height:700px){.game{padding-top:18px;padding-bottom:16px}.topbar{flex-basis:50px}.round-btn,.hint-btn{height:50px}.round-btn{width:50px}.progress-card{height:50px;padding-top:7px}.bulb{flex-basis:34px;width:34px;height:34px}.palette-shell{padding-top:8px;padding-bottom:8px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;
function EyeIcon() {
  return <svg viewBox={"0 0 24 24"}>{<path d={"M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"} />}{<circle cx={"12"} cy={"12"} r={"2.8"} />}</svg>;
}
function HintIcon() {
  return <svg viewBox={"0 0 24 24"}>{<path d={"M9 18h6M10 21h4M8.2 14.8A7 7 0 1 1 15.8 14.8c-.7.6-.8 1.2-.8 2.2H9c0-1-.1-1.6-.8-2.2Z"} />}</svg>;
}
function App() {
  let [uiStarted, uiSetStarted] = React.useState(false);
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("loading");
  let [board, setBoard] = React.useState(null);
  let [selectedColor, setSelectedColor] = React.useState(1);
  let [filledCount, setFilledCount] = React.useState(0);
  let [showCompleted, setShowCompleted] = React.useState(false);
  let [hintsRemaining, setHintsRemaining] = React.useState(5);
  let [toast, setToast] = React.useState("");
  let [flashedColor, setFlashedColor] = React.useState(null);
  let canvasRef = React.useRef(null);
  let fillAnimationRef = React.useRef(null);
  let toastTimerRef = React.useRef(null);
  let audioRef = React.useRef(null);
  let paletteElementsRef = React.useRef(new Map());
  let paletteRef = React.useRef(null);
  let [paletteOverflow, setPaletteOverflow] = React.useState({
    left: false,
    right: false
  });
  React.useEffect(() => {
    const stop = () => {
      setShowCompleted(false);
      if (audioRef.current) {
        try {
          audioRef.current.close()?.catch(() => {});
        } catch {}
        audioRef.current = null;
      }
    };
    const hidden = () => {
      if (document.hidden) stop();
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      stop();
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  React.useEffect(() => {
    let enabled = true;
    (location.protocol === "file:" ? Promise.resolve(runtimeConfig) : requestGameConfig().then(response => response.ok ? response.json() : runtimeConfig).catch(() => runtimeConfig)).then(response => enabled && setConfig(readConfigValues(response)));
    return () => {
      enabled = false;
      cancelAnimationFrame(fillAnimationRef.current);
      clearTimeout(toastTimerRef.current);
    };
  }, []);
  React.useEffect(() => {
    if (!config) return;
    setPhase("loading");
    let image = new Image();
    image.crossOrigin = "anonymous";
    image.src = config.BG_CARTOON;
    image.onload = () => setTimeout(() => {
      try {
        let coloringBoard = createColoringBoard(image);
        setBoard(coloringBoard);
        setSelectedColor(coloringBoard.paletteItems[0]?.id || 1);
        setFilledCount(0);
        setPhase("playing");
      } catch (value) {
        console.error(value);
        setPhase("error");
      }
    }, 30);
    image.onerror = () => setPhase("error");
  }, [config]);
  let playSound = React.useCallback(value => {
    if (config?.ENABLE_SOUND) try {
      let value2 = window.AudioContext || window.webkitAudioContext;
      if (!audioRef.current) {
        audioRef.current = new value2();
      }
      let current = audioRef.current;
      let oscillator = current.createOscillator();
      let gain = current.createGain();
      oscillator.type = value === "wrong" ? "square" : "sine";
      oscillator.frequency.value = value === "wrong" ? 145 : value === "win" ? 660 : 480;
      gain.gain.setValueAtTime(0.05, current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, current.currentTime + (value === "win" ? 0.45 : 0.16));
      oscillator.connect(gain).connect(current.destination);
      oscillator.start();
      oscillator.stop(current.currentTime + (value === "win" ? 0.45 : 0.17));
    } catch {}
  }, [config]);
  let showToast = React.useCallback(value => {
    setToast(value);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 1100);
  }, []);
  let drawBoard = React.useCallback((value = null) => {
    let dimensions = canvasRef.current;
    if (!dimensions || !board) return;
    if (dimensions.width !== board.width || dimensions.height !== board.height) {
      dimensions.width = board.width;
      dimensions.height = board.height;
    }
    let context = dimensions.getContext("2d");
    let imageData = new ImageData(new Uint8ClampedArray(board.flat), board.width, board.height);
    let {
      width: value2,
      height: value3,
      regions: value4,
      paletteItems: value5
    } = board;
    for (let value6 of value4) {
      let value7 = value && value.region.id === value6.id;
      if (!value6.filled && !showCompleted && !value7) continue;
      let value8 = value6.rgb;
      let value9 = value7 ? value6.minY + (value6.maxY - value6.minY + 1) * value.progress : 1 / 0;
      for (let value10 of value6.pixels) {
        let value11 = Math.floor(value10 / value2);
        if (value11 > value9) continue;
        let value12 = value10 * 4;
        if (value7 && Math.abs(value11 - value9) < 7) {
          imageData.data[value12] = Math.min(255, value8[0] + 52);
          imageData.data[value12 + 1] = Math.min(255, value8[1] + 52);
          imageData.data[value12 + 2] = Math.min(255, value8[2] + 52);
        } else {
          imageData.data[value12] = value8[0];
          imageData.data[value12 + 1] = value8[1];
          imageData.data[value12 + 2] = value8[2];
        }
      }
    }
    if (!showCompleted) for (let value6 = 0; value6 < imageData.data.length; value6 += 4) {
      let item = board.regionMap[value6 / 4];
      if (item >= 0 && (value4[item].filled || value && value.region.id === item)) continue;
      let value7 = item >= 0 ? value4[item].paletteId : 1;
      let value8 = board.grayValues[value7 - 1] ?? 206;
      imageData.data[value6] = value8;
      imageData.data[value6 + 1] = value8;
      imageData.data[value6 + 2] = value8;
    }
    if (context.putImageData(imageData, 0, 0), !showCompleted) {
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (let value6 of value4) {
        if (value6.filled || value && value.region.id === value6.id && value.progress > 0.72) continue;
        let value7 = 15;
        context.font = `800 ${value7}px "Nunito Sans",sans-serif`;
        let value8 = String(value6.paletteId);
        context.lineJoin = "round";
        context.lineWidth = 4;
        context.strokeStyle = "#fff";
        context.strokeText(value8, value6.labelX, value6.labelY);
        context.fillStyle = "#45454d";
        context.fillText(value8, value6.labelX, value6.labelY);
      }
    }
  }, [showCompleted, board]);
  React.useEffect(() => {
    if (phase === "playing" || phase === "won") {
      drawBoard();
    }
  }, [drawBoard, phase, filledCount, showCompleted]);
  React.useEffect(() => {
    let alive = true;
    const ready = document.fonts?.load('800 18px "Nunito Sans"');
    ready?.then(() => {
      if (alive) drawBoard();
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [drawBoard]);
  React.useEffect(() => {
    paletteElementsRef.current.get(selectedColor)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest"
    });
  }, [selectedColor]);
  let updatePaletteOverflow = React.useCallback(() => {
    let current = paletteRef.current;
    if (!current) return;
    let options = {
      left: current.scrollLeft > 2,
      right: current.scrollLeft + current.clientWidth < current.scrollWidth - 2
    };
    setPaletteOverflow(value => value.left === options.left && value.right === options.right ? value : options);
  }, []);
  React.useEffect(() => {
    let value = requestAnimationFrame(updatePaletteOverflow);
    window.addEventListener("resize", updatePaletteOverflow);
    return () => {
      cancelAnimationFrame(value);
      window.removeEventListener("resize", updatePaletteOverflow);
    };
  }, [board, updatePaletteOverflow]);
  let scrollPalette = React.useCallback(region => {
    let timestamp = performance.now();
    let value = 330;
    let handleAction = value2 => {
      let value3 = Math.min(1, (value2 - timestamp) / value);
      let progress = 1 - Math.pow(1 - value3, 3);
      if (drawBoard({
        region: region,
        progress: progress
      }), value3 < 1) fillAnimationRef.current = requestAnimationFrame(handleAction);else {
        fillAnimationRef.current = null;
        region.filled = true;
        let item = board.paletteItems[region.paletteId - 1];
        if (item.remaining = Math.max(0, item.remaining - 1), item.remaining === 0) {
          let index = board.paletteItems.findIndex(item2 => item2.id === item.id);
          let value4 = [...board.paletteItems.slice(index + 1), ...board.paletteItems.slice(0, index + 1)].find(item2 => item2.remaining > 0);
          if (value4) {
            setSelectedColor(value4.id);
          }
        }
        setFilledCount(value4 => {
          let value5 = value4 + 1;
          if (value5 >= board.total) {
            setPhase("won");
            playSound("win");
          }
          return value5;
        });
      }
    };
    cancelAnimationFrame(fillAnimationRef.current);
    fillAnimationRef.current = requestAnimationFrame(handleAction);
  }, [drawBoard, board, playSound]);
  let handlePaint = event => {
    if (phase !== "playing" || !board || fillAnimationRef.current || event.isPrimary === false || event.button !== 0) return;
    let dimensions = canvasRef.current.getBoundingClientRect();
    let value = Math.floor((event.clientX - dimensions.left) * board.width / dimensions.width);
    let value2 = Math.floor((event.clientY - dimensions.top) * board.height / dimensions.height);
    if (value < 0 || value2 < 0 || value >= board.width || value2 >= board.height) return;
    let value3 = coloringHitRegion(board, event.clientX, event.clientY, dimensions, selectedColor);
    if (value3 < 0) {
      showToast("Tap a numbered area");
      return;
    }
    let item = board.regions[value3];
    if (!item.filled) {
      uiSetStarted(true);
      if (item.paletteId !== selectedColor) {
        setFlashedColor(selectedColor);
        setTimeout(() => setFlashedColor(null), 320);
        showToast("Prova un altro colore");
        playSound("wrong");
        return;
      }
      playSound("fill");
      scrollPalette(item);
    }
  };
  let useHint = () => {
    if (!board || !hintsRemaining || phase !== "playing") return;
    let value = board.regions.find(item => !item.filled && item.paletteId === selectedColor);
    if (value || (value = board.regions.find(item => !item.filled)), !value) return;
    setSelectedColor(value.paletteId);
    setHintsRemaining(value2 => value2 - 1);
    showToast(`Colore ${value.paletteId} evidenziato`);
    let context = canvasRef.current.getContext("2d");
    drawBoard();
    context.beginPath();
    context.arc(value.labelX, value.labelY, 18, 0, Math.PI * 2);
    context.strokeStyle = "#7467df";
    context.lineWidth = 5;
    context.stroke();
    setTimeout(() => drawBoard(), 650);
  };
  let resetBoard = () => {
    uiSetStarted(false);
    board.regions.forEach(item => {
      item.filled = item.decorative;
    });
    board.paletteItems.forEach(item => {
      item.remaining = board.regions.filter(item2 => !item2.decorative && item2.paletteId === item.id).length;
    });
    setFilledCount(0);
    setHintsRemaining(5);
    setPhase("playing");
    setSelectedColor(board.paletteItems[0]?.id || 1);
  };
  if (!config) return <div className={"stage"} />;
  let completionPercent = board?.total ? filledCount / board.total * 100 : 0;
  return <div className={"stage"}>{<style>{COLORING_STYLES}</style>}{<main className={"game"} aria-label={config.GAME_TITLE} data-complete={phase === "won"}>{!uiStarted && phase === "playing" && <p className={"coloring-guide"}>{"Scegli un colore e tocca il numero"}</p>}{<header className={"topbar"} inert={phase === "won" ? true : undefined}>{<div className={"left-tools"}>{<button className={"round-btn"} onPointerDown={event => {
            if (event.isPrimary === false || event.button !== 0) return;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setShowCompleted(true);
          }} onPointerUp={() => setShowCompleted(false)} onPointerLeave={() => setShowCompleted(false)} onPointerCancel={() => setShowCompleted(false)} onLostPointerCapture={() => setShowCompleted(false)} onBlur={() => setShowCompleted(false)} onKeyDown={event => {
            if ([" ", "Enter"].includes(event.key)) {
              event.preventDefault();
              setShowCompleted(true);
            }
          }} onKeyUp={() => setShowCompleted(false)} aria-pressed={showCompleted} aria-label={"Tieni premuto per vedere i colori"}>{<EyeIcon />}</button>}</div>}{<div className={"progress-card"} aria-label={`${filledCount} di ${board?.total || 0} aree colorate`} aria-live={"polite"}>{<div className={"progress-copy"}>{""}{<b>{filledCount}</b>}{" / "}{board?.total || 0}</div>}{<div className={"track"}>{<i style={{
              width: `${completionPercent}%`
            }} />}</div>}</div>}{<button className={"hint-btn"} disabled={!hintsRemaining || phase !== "playing"} onClick={useHint} aria-label={`Suggerimenti rimasti: ${hintsRemaining}`}>{<span className={"bulb"}>{<HintIcon />}</span>}{hintsRemaining}</button>}</header>}{<section className={"canvas-zone"} inert={phase === "won" ? true : undefined}>{<div className={"canvas-wrap"}>{phase === "loading" && <div className={"loading"}>{<span className={"spinner"} />}{<span className={"load-title"}>{"Preparazione del disegno"}</span>}{<span className={"load-sub"}>{"Analisi dei colori e delle aree…"}</span>}</div>}{phase === "error" && <div className={"loading"}>{<span className={"load-title"}>{"Impossibile elaborare l’immagine"}</span>}{<span className={"load-sub"}>{"Sostituisci l’immagine e ricarica."}</span>}</div>}{<canvas ref={canvasRef} onPointerDown={handlePaint} className={"art"} style={{
            display: board ? "block" : "none"
          }} aria-label={"Disegno numerato da colorare"} />}</div>}</section>}{<footer className={`palette-shell ${paletteOverflow.left ? "fade-left" : ""} ${paletteOverflow.right ? "fade-right" : ""}`} inert={phase === "won" ? true : undefined}>{<div ref={paletteRef} className={"palette"} role={"toolbar"} aria-label={"Tavolozza dei colori"} onScroll={updatePaletteOverflow}>{board?.paletteItems.map(value => {
            let [H, _, w] = value.rgb;
            return <button ref={value2 => value2 ? paletteElementsRef.current.set(value.id, value2) : paletteElementsRef.current.delete(value.id)} className={`swatch ${selectedColor === value.id ? "active" : ""} ${value.remaining === 0 ? "done" : ""} ${flashedColor === value.id ? "wrong" : ""}`} style={{
              "--c": `rgb(${H},${_},${w})`
            }} onClick={() => setSelectedColor(value.id)} aria-label={`Seleziona il colore ${value.id}`} aria-pressed={selectedColor === value.id} key={value.id}>{<span>{value.id}</span>}</button>;
          })}</div>}</footer>}{<div className={`toast ${toast ? "show" : ""}`} role={"status"}>{toast}</div>}{phase === "won" && <div className={"win"} role={"status"} aria-live={"polite"} aria-atomic={true}>{<h2>{config.TXT_WIN === "Bellissimo!" ? "Bellissimo" : config.TXT_WIN || "Bellissimo"}</h2>}</div>}</main>}</div>;
}

// ./playable-design.js
// Container sizing and idle-animation lifecycle only; game state remains in the original runtime.
(() => {
  const html = document.documentElement;
  const handleAction = () => {
    const root = document.getElementById('root');
    if (root) html.style.setProperty('--design-scale', String(Math.min(root.clientWidth / 390, root.clientHeight / 598)));
  };
  const visibility = () => {
    html.dataset.designHidden = String(document.hidden);
  };
  const start = () => {
    handleAction();
    visibility();
    const root = document.getElementById('root');
    if (root) observeGameSize(handleAction).observe(root);
  };
  document.addEventListener('visibilitychange', visibility);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {
    once: true
  });else start();
})();

// ./guide-breathing.js
/* Decorative guide visibility only: no inputs, timers, sound or game state. */
(() => {
  const root = document.documentElement;
  let intersecting = true;
  const update = () => root.toggleAttribute('data-guide-breathing-paused', document.hidden || !intersecting);
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    intersecting = entries.some(entry => entry.isIntersecting);
    update();
  }) : null;
  if (document.body) observer?.observe(document.body);
  document.addEventListener('visibilitychange', update);
  update();
  window.addEventListener('pagehide', () => {
    observer?.disconnect();
    document.removeEventListener('visibilitychange', update);
  }, {
    once: true
  });
})();
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = ["p.coloring-guide"];
  const copy = new Set([].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map();
  let queued = false;
  let visible = true;
  const action = /^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;
  function scan() {
    queued = false;
    for (const [el, a] of running) if (!el.isConnected) {
      a.cancel();
      running.delete(el);
    }
    if (motion.matches) {
      for (const value of running.values()) value.cancel();
      running.clear();
      return;
    }
    const targets = new Set();
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(item => targets.add(item));
      } catch {}
    }
    for (const value of document.querySelectorAll('p,span,div,label,text')) {
      if (value.children.length || value.closest('button,a,input,select,textarea,[role="button"]')) continue;
      const text = (value.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 5 && text.length <= 140 && (copy.has(text.toLowerCase()) || !selectors.length && action.test(text))) targets.add(value);
    }
    for (const value of targets) {
      if (running.has(value) || typeof value.animate !== 'function') continue;
      if ([...targets].some(child => child !== value && value.contains(child))) continue;
      const style = getComputedStyle(value);
      if (/breath/i.test(style.animationName)) continue;
      const base = style.filter.replace(/opacity\([^)]*\)/g, '').replace(/^none$/, '').trim();
      const filter = value3 => (base ? base + ' ' : '') + 'opacity(' + value3 + ')';
      const value2 = value.animate([{
        filter: filter(1)
      }, {
        filter: filter(0.65)
      }, {
        filter: filter(1)
      }], {
        duration: 2400,
        iterations: Infinity,
        easing: 'ease-in-out'
      });
      running.set(value, value2);
      if (document.hidden || !visible) value2.pause();
    }
  }
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  };
  const pause = () => {
    for (const value of running.values()) {
      if (document.hidden || !visible) {
        value.pause();
      } else {
        value.play();
      }
    }
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    visible = entries.some(item => item.isIntersecting);
    pause();
  }) : null;
  if (document.body) intersection?.observe(document.body);else document.addEventListener('DOMContentLoaded', () => intersection?.observe(document.body), {
    once: true
  });
  document.addEventListener('visibilitychange', pause);
  motion.addEventListener?.('change', schedule);
  schedule();
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    intersection?.disconnect();
    for (const value of running.values()) value.cancel();
    running.clear();
  }, {
    once: true
  });
})();
