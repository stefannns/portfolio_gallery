# /about — 3D lanyard badge

Source for the `/about` page. Built output is committed to `../about/` and served statically;
Vercel does **not** run a build for this repo.

## Build

```bash
cd about-src
npm install
npm run build      # writes ../about/index.html + ../about/assets/
npm run dev        # local dev server
```

The Vite project lives here rather than at the repo root on purpose. A root `package.json`
would trip Vercel's zero-config framework detection and switch the entire portfolio from a
plain static deploy to a Vite build, breaking every other page. Keeping it in a subdirectory
leaves the root a static site exactly as before.

`emptyOutDir` is off so the build won't wipe `about/index-2d.html` (the previous 2D page, kept
as a reference). Because of that the `build` script clears `../about/assets` itself, otherwise
old hashed bundles accumulate there forever.

## Architecture

Ported from the published React Three Fiber lanyard demos (reactbits.dev/components/lanyard,
Vercel's "Building an interactive 3D event badge with R3F", buouui.com/docs/animations/3d-badge).
React Bits is MIT + Commons Clause — using it inside this site is fine; reselling the component
itself is not.

`Band.jsx` is the whole simulation:

- One `fixed` rigid body at the top, three `dynamic` bodies chained to it by `useRopeJoint`
  (length 1 each), then the card attached with `useSphericalJoint` anchored at `[0, 1.45, 0]`
  — above the card's centre, which is what makes it hang and self-right.
- Only **4 physics points**. The earlier hand-rolled Verlet version used 26 and could never
  converge, which is what caused the permanent idle jitter. Combined with `angularDamping: 4`,
  `linearDamping: 4` and `canSleep: true`, the badge measures **0.000 drift/frame** at rest
  (verified over 199 rendered frames, and again over 150 frames after a drag and release).
- The visible strap is a `meshline` through a `CatmullRomCurve3` resampled to 32 points, so
  visual smoothness is decoupled from the 4-point physics resolution.
- `j1`/`j2` are lerped toward their physics positions each frame (speed scaled by distance,
  `minSpeed` 10 → `maxSpeed` 50). Without this the band visibly flickers.
- Dragging flips the card to `kinematicPosition` and drives it with
  `setNextKinematicTranslation`, offset by where the grab started so it doesn't snap.
- A small angular-velocity nudge (`ang.y - rot.y * 0.25`) eases the card back toward facing
  the viewer instead of letting it spin freely.

`clip.glb` is the metal hardware from the reference badge — the `clip` (the loop the strap runs
through) and the `clamp` (the jaw gripping the card's top edge). It was extracted from Vercel's
demo asset (`tag.glb`), with the card mesh and the embedded Vercel-branded card texture stripped
out, leaving geometry only: 261 KB → 113 KB. It's authored at a scale where the card is 1 unit
tall, so `HW_SCALE` 2.25 matches `CARD_H` and `HW_Y` -1.2 centres it on the rigid body, putting
the clip's eye at the `[0, 1.45, 0]` joint anchor.

`cardTexture.js` draws the card and strap textures on a canvas at runtime. The card face carries
the same content as the old 2D page: Stefan / AIGC/Game Designer / USC School of Cinematic Arts /
Class of 2027. The strap is charcoal webbing with `pattern.png` repeating along it.

The strap texture has one non-obvious constraint. meshline draws with `sizeAttenuation` on, which
offsets vertices by `0.5 * lineWidth` in *clip* space — so the strap's world width is
`lineWidth * tan(fov/2)`, not `lineWidth`. Texture u runs along the strap and v across it, so a
tile covers `ropeLength / BAND_REPEAT` by that width. Build the canvas at any other aspect and
the mark comes out stretched — a square tile at repeat 3 stretched it 4.5x lengthwise. Hence
`BAND_REPEAT` is chosen first (whole number, or a mark gets sliced where the texture wraps) and
the tile aspect is derived back from it. The mark sits at the *start* of each tile, not the
centre: only ~60% of the rope is on screen at rest, and centring put every mark above the frame.

## Canvas overlay and text repel

The canvas is **wider than the stage** (`.canvas-layer`, `width: 200%`) and painted above the
copy. Sized to the stage it clipped the badge at the stage's right edge the moment it was
dragged toward the text, which read as a black rectangle slicing the card in half. It stays
`pointer-events: none` so the text is still selectable — R3F listens on `.wrap` instead via
`eventSource` + `eventPrefix="client"`. Height still matches the stage, so vertical framing and
badge size are unchanged.

Because the canvas no longer lines up with the stage, `Band` slides `camera.position.x` on mount
and resize so world x=0 still lands on the middle of the stage. That also means the drag can no
longer use the reference's `|camera.position|` shortcut for the ray distance — it now
intersects the z=0 plane properly, which is correct wherever the camera sits.

`useTextRepel.js` pushes `.intro`, `.sec-title` and each `.chip` out of the badge's way, driven
per frame from the card's projected screen position. Base positions are measured once (and on
resize) with transforms cleared first — measuring with the offset still applied makes the
elements creep across the page.

## Notes

- The strap intentionally runs off the top of the frame; that's the reference look.
- Bundle is ~3.1 MB raw / ~1.06 MB gzipped — three.js + React + the Rapier WASM, in line with
  the reference demos.
- Below 720px the two-column layout stacks; the badge goes full width above the text.
