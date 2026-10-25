# Mochi chef — Seedance 2.0 animation

A first idle clip was generated in the user-opened Crate project on 2026-10-22.

- Model: **Seedance 2.0**.
- Selected character: **A — Mochi chef**.
- Frame mode: **First & Last Frame (Same)**, with A-mochi.png as the reference.
- Requested settings: 6 seconds, 1080p, 1:1.
- Actual downloaded original: **1440 × 1440, 24 fps, 6.05 seconds**, H.264 MP4 with an AAC audio stream.
- Crate project: https://crate.tiktok-row.net/project/7699379825295065362
- Portfolio file: `seedance/mochi-chef-idle-seedance2-original.mp4`.
- Machine-readable settings and exact submitted prompt: `seedance/generation.json`.

## Review and integration status

The character identity and costume are consistent. Breathing and paw movement are gentle. The first and last poses match closely in the endpoint comparison. In the unedited original, the eyes remain closed for much of the clip. The website version removes that long hold and keeps a brief closure and reopening, surrounded by a resting pose and subtle CSS breathing.

The result has an **opaque white background**, despite a black-background prompt. Pixel format is yuv420p; it has **no alpha channel**. The white hat shares the background color, so a simple white color key risks deleting parts of the character. The derived website version uses local subject segmentation rather than a white color key, preserving the hat and jacket. Three-frame mask filtering, a small silhouette contraction and edge color correction reduce flicker and white fringing. The original is preserved. Derived animation exports contain no audio.

The website manifest now uses `seedance/mochi-idle.webp`: a six-second, 576 × 576 transparent animated WebP with 51 encoded frames, about 1.6 MB. The `seedance/mochi-idle-poster.webp` still image is used for reduced motion and animation-load failures. A VP9 alpha-video export is retained as `seedance/mochi-idle-alpha.webm`; the webpage uses animated WebP for consistent transparent playback across browser families.

## Exact submitted prompt

> Create a six-second seamless idle animation using the supplied Mochi capybara chef as BOTH the first and last frame. Locked near-orthographic camera. Preserve the exact cute Q-version collectible-vinyl identity: huge rounded caramel head, broad capybara muzzle, tiny dark bead eyes, rosy circular cheeks, round belly, tiny paws and stubby planted feet, low plump white chef toque, cream jacket with four cocoa buttons, terracotta scarf and beige apron. Keep the full silhouette and its scale and screen position unchanged. Very gentle breathing, one slow natural blink, and a tiny relaxed welcoming movement of the raised paws, as if quietly holding floating worlds in place. Return precisely to the starting pose by the end, with no pause or jump at the loop boundary. Smooth restrained animation, calm charming expression, stable warm key and cool rim light. The character alone against a perfectly uniform solid black background; no floor, cast shadow, scenery, objects, sparkles, portals, steam, text, or camera movement. No walking, turning, hopping, body stretching, costume changes, extra fingers, or talking. Silent clip.

## Processing record

The exact source-frame edit sequence is in `seedance/processing.json`. The long closed-eye section is compressed to a brief transition, and the source endpoints are held to retain the six-second loop. Subtle CSS breathing continues during the resting pose. All derived frames retain the source’s square framing.

Masks were generated locally with [Apple Vision subject lifting](https://developer.apple.com/documentation/vision/vngenerateforegroundinstancemaskrequest). No second generation was needed. The original video remains unchanged for future edits.
