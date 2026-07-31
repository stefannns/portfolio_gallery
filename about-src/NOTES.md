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

`cardTexture.js` draws both textures on a canvas at runtime — no image assets to ship. The card
face carries the same content as the old 2D page: Stefan / AIGC/Game Designer / USC School of
Cinematic Arts / Class of 2027.

## Notes

- The strap intentionally runs off the top of the frame; that's the reference look.
- Bundle is ~3.1 MB raw / ~1.06 MB gzipped — three.js + React + the Rapier WASM, in line with
  the reference demos.
- Below 720px the two-column layout stacks; the badge goes full width above the text.
