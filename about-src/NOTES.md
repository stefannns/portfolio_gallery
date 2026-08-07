# /about — 3D lanyard badge

Source for the badge. Built output is committed to `../about/` and served statically;
Vercel does **not** run a build for this repo.

```bash
cd about-src
npm install
npm run build      # writes ../about/index.html + ../about/assets/
npm run dev
```

The Vite project lives here rather than at the repo root on purpose: a root `package.json`
would trip Vercel's zero-config detection and switch the whole portfolio from a static deploy
to a Vite build.

## This bundle is mounted in two places

1. **`/about`** — the standalone page, built here as `../about/index.html`.
2. **`/`** — the combined site. The root `index.html` is hand-written and no build step ever
   rewrites it, so it references `/about/assets/about.js` and `about.css` literally.

That second consumer is why `rollupOptions.output` pins the filenames instead of taking Vite's
content hashes: a hashed name would go stale on the next build and the root page would silently
404 its own hero.

Two consequences worth knowing before editing anything global here:

- **Nothing may style `html`/`body` unconditionally.** On the root page the gallery owns those.
  Every global rule in `styles.css` is gated behind `html.about-solo`, a class set only by this
  project's own `index.html`. Drop the class and the standalone page loses its layout; add such
  a rule ungated and it leaks into the gallery.
- **The palette lives on `.wrap`, not `:root`.** The gallery declares `--bg`, `--muted`,
  `--line` and `--accent` too, so a `:root` block here would repaint it. `.wrap` is the element
  `App` renders, and the variables inherit from there.

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

### The standalone page does not scroll

It is embedded in a Lark doc, where an inner scroller swallows the wheel from the document
behind it — you go to scroll the doc, the cursor is over the badge, and the embed creeps
instead. So `overflow:hidden` on **both** `html` and `body`. Body alone is not enough: the
body-to-viewport overflow propagation does not hold here, and the viewport still drifted
(measured 88px at a 600px height).

All of that is gated behind `.about-solo` and applies to `/about` only — the combined root page
scrolls vertically by design, and there the badge is just a block in the flow. What the root
page does need is `overflow-x:clip` on the section wrapping it, because `.canvas-layer` is 300%
wide (below); `clip` rather than `hidden`, since `hidden` would make the section a scroll
container and eat the wheel, and cannot leave the other axis visible.

The content is 688px tall, so a shorter frame loses the bottom of the stage — empty canvas
below the card. The copy ends at 487px and the prompt at ~490px, both well clear.

The stacked breakpoint (≤720px) puts scrolling back, since there the content genuinely is
taller than a phone. That needs `height:auto` on `html,body,#root` too — left at `100%` with a
scroller on body, body became its own scroll container that the viewport could not drive and
the page still would not move.

### Layout

`.canvas-layer` is 300% of the stage width and centred on it, so the badge can swing over the
copy instead of being clipped at the stage edge. Centring it means world x=0 lands on the
stage centre with no camera offset — worth knowing, because R3F only applies the `camera`
prop at creation, so feeding it a measured offset later silently does nothing.

## The local patch to Lanyard.jsx

The component is upstream's apart from a 21-line additive patch, marked `// local patch`, with
the pristine copy kept beside it as `Lanyard.upstream.jsx` — diff the two before pulling a
newer version. It adds two optional callbacks and changes nothing else; omit both and the
component behaves exactly as shipped:

- `onCardFrame(cardBody, state, delta, hovered, dragged)` — once per frame, after the
  component has finished with the card.
- `onFirstDrag()` — on the first grab.

### The band is a real ribbon, not meshline

Upstream draws the strap with `meshline`, which offsets its vertices in **clip** space — so the
band is a camera-facing billboard that cannot roll. The strap's lower joint is also attached at
the card's local `(0, 1.5, 0)`, which sits exactly on the hover yaw axis. Between the two,
turning the card moved the strap not at all.

`makeRibbon` / `buildRibbon` replace it with a generated ribbon, rewritten from the curve each
frame, whose width direction is rolled onto the card's own plane at the clip and eased back to
camera-facing by `TWIST_SPAN` (measured: 11.4° of roll at the clip falling to 0 by t≈0.56).
Under a pure hover yaw the roll at the clip equals the yaw angle.

### The clip is squared up

The clip is modelled with a **20° yaw about Y**, so its right end sits back and its left end
forward, while the card itself is planar and every node in `card.glb` is identity — the yaw is
baked into the geometry. That left the strap, whose end rolls onto the card's plane, cutting
across a clip that was turned away from it. `CLIP_YAW_FIX` cancels it on the mesh; measured on
the rendered scene, the clip now sits at −0.07° against the card's 0.00°.

Getting the number right needs care. `-atan(slope)` of a least-squares fit of z against x is
**wrong** — the fit is attenuated by the clip's own depth, reads only −16.3°, and leaves ~3° of
lean. The right value is the rotation that drives that fit to zero, found by scanning: −0.35 rad.

The `clamp` below the clip is yawed ~55° and is deliberately left alone — it is a narrow part
where the lean barely reads, and the fit is poorly conditioned across its ~0.05 of x.

Two things there are deliberate and worth not "cleaning up":

- The half-width reproduces meshline's exactly — `0.5 * lineWidth * tan(fov/2) * canvasAspect`,
  measured identical to 4 decimals — including its dependence on the canvas aspect, which is an
  artefact of the clip-space offset. The strap width was tuned by eye against that.
- The material is `meshBasicMaterial` with `toneMapped={false}`, which is how meshline's raw
  shader drew: unlit, no tone mapping.

Depth testing, though, is **on**, unlike upstream. With it off the strap painted over the clip
whatever the depths were, so its cut end showed on top of the ring instead of the ring closing
over it. The clip's front lip reaches z = 0.022, ahead of the strap, so depth testing is what
lets it occlude. `STRAP_END_Z` sets how deep the strap sits: forward of the ring's centre, so the back of the
ring passes behind it and only the front lip crosses in front. At the ring's centre (-0.05) it
disappeared inside; at the joint (0) it stood proud.
That offset is **z only** — moving x or y as well pulls the strap off the clip, which was tried
and looked worse. A side effect of depth testing is that the strap is hidden where it swings
behind the card, which is what should happen anyway.

The `meshline` import and `extend` call are now unused by the band. They are left in place to
keep the diff against `Lanyard.upstream.jsx` small.

Everything the page layers on hangs off those two, in `App.jsx`:

- **Text repel** (`useTextRepel.js`) — the copy dodges horizontally out of the badge's way and
  the elements also separate from each other, so a chip that moves doesn't land on its
  neighbour. Vertical dodging was tried and looked like the layout breaking.
  The intro dodges **per line**: the hook re-emits the paragraph as one `span.line` per visual
  line, split at the breaks the browser had already chosen, so each line clears the badge on
  its own. `.line` must stay `width:fit-content` — as a full-width block its box would span the
  whole column and the badge would push the entire paragraph again. The split is redone on
  resize, and the plain paragraph is restored on unmount.
- **Hover tilt** — the card turns toward the cursor. It retargets the rest angle the
  component's own self-righting term drives toward rather than adding a force, so it can't
  fight the solver.
- **The prompt** hides after the first drag.

One thing worth knowing if you touch the hover code: that term runs per RENDER frame but the
solver only consumes velocity per STEP, so on a 120Hz display an unscaled correction lands
twice per step and compounds into an overshoot. Hence the `stepShare` factor.
