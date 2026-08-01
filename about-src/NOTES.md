# /about — 3D lanyard badge

Source for the `/about` page. Built output is committed to `../about/` and served statically;
Vercel does **not** run a build for this repo.

```bash
cd about-src
npm install
npm run build      # writes ../about/index.html + ../about/assets/
npm run dev
```

The Vite project lives here rather than at the repo root on purpose: a root `package.json`
would trip Vercel's zero-config detection and switch the whole portfolio from a static deploy
to a Vite build. `emptyOutDir` is off so the build won't wipe `about/index-2d.html`, which is
why the `build` script clears `../about/assets` itself.

## The lanyard

`Lanyard.jsx`, `Lanyard.css`, `card.glb` and `lanyard.png` are React Bits' Lanyard component,
**installed verbatim** — do not hand-edit them. Upstream:
`src/content/Components/Lanyard/` in github.com/DavidHDev/react-bits (MIT + Commons Clause:
using it inside this site is fine, reselling the component is not).

Everything specific to this site is passed in as props, so the component stays a clean
drop-in and can be re-pulled from upstream at any time:

- `frontImage` / `backImage` — the card faces. The component composites whatever we hand it
  into the model's UV atlas (front = left half, back = right half of a 1024 atlas, 0.755 tall),
  which is also what covers the artwork bundled inside `card.glb`.
- `lanyardImage` — the strap.
- `position` / `fov` — framing.

`cardTexture.js` draws those three images on a canvas and hands them over as data URLs. It
touches no three.js at all.

### Why the strap art is so plain

Flat colour plus the mark, nothing else. The strap renders roughly 30px wide, so its 256px
texture axis is minified about 9:1 and anything near a single texel lands inside a fraction of
a screen pixel, where it crawls as the strap moves. A woven weft drawn as a 1px line every
3px, and hard 2px edge highlights, both did exactly that. The reference's own band carries no
fine detail either — that is not an oversight.

The mark is drawn large (78% of the strap's width) for the same reason: big shapes survive
minification, small ones get averaged away. At anisotropy 2 with the mark at 55% it vanished
into the grey entirely.

The tile canvas is built to the strap's world aspect — `(ropeLength / repeat) / (lineWidth *
tan(fov/2))` — because meshline offsets vertices in clip space, so the strap's world width is
`lineWidth * tan(fov/2)`. Get that wrong and the mark is stretched lengthwise.

### Layout

`.canvas-layer` is 300% of the stage width and centred on it, so the badge can swing over the
copy instead of being clipped at the stage edge. Centring it means world x=0 lands on the
stage centre with no camera offset — worth knowing, because R3F only applies the `camera`
prop at creation, so feeding it a measured offset later silently does nothing.

## Not currently wired up

Dropped when the component was adopted wholesale, since they all need the card's transform
and the component doesn't expose it: the text repel, the hover tilt, and hiding the "drag the
badge" prompt after the first drag. Re-adding any of them means patching `Lanyard.jsx`, which
costs its drop-in status.
