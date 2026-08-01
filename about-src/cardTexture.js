// Artwork fed to the Lanyard component as plain images. The component composites whatever we
// pass into the card model's UV atlas and onto the band, so nothing here touches three.js.

const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'

// The card model's front face maps to a 0.5 x 0.755 rect of a 1024 atlas, so this is the
// aspect the artwork has to be or the component will crop it to fit.
const CARD_W = 512, CARD_H = 773

export const CAM_FOV = 25       // passed to the component
// Canvas is taller than the stage now (see .canvas-layer), and the badge's on-screen size is
// canvasHeight / visibleWorldHeight — so the camera pulls back by the same ratio to keep it
// the size it was.
export const CAM_Z = 17.1
export const CAM_Y = 0

// Where the rope hangs from and how long each of its three segments is. Longer than the
// component's default 4 / 1 so the strap leaves the top of the frame with no visible end.
//
// The card rests at ANCHOR_Y - ROPE_LEN - 1.45, so lengthening the rope without raising the
// anchor by as much drops the badge down the frame — which is what happened when the rope went
// to 5.4 against an anchor of 5.5. Raised here to bring it back up.
export const ANCHOR_Y = 6.1
export const ROPE_SEG = 1.8
const ROPE_LEN = ROPE_SEG * 3

const BAND_REPEAT = 4           // fixed inside the component's meshLineMaterial
// Strap width you approved, in on-screen terms. It has to be restated here because the true
// width is lineWidth * tan(fov/2) * canvasAspect — so making the canvas taller (which changed
// its aspect) would otherwise have quietly narrowed the strap by ~24%.
export const BAND_LINE_W = 0.58 // passed as lanyardWidth

// The strap's world width is NOT lineWidth * tan(fov/2). meshline takes its `aspect` from the
// resolution uniform, which the component pins to [1000, 1000] — so aspect is 1, the width
// offset is applied in raw clip-x, and the result scales with the CANVAS aspect ratio:
//
//   world width = lineWidth * tan(fov/2) * canvasAspect
//
// Miss that factor and the texture tile comes out the wrong shape, which stretches the mark
// along the strap. It was invisible while the canvas was roughly stage-shaped and became
// obvious once .canvas-layer went to 300% width.
export function strapTileAspect (canvasAspect) {
  // Guarded: a zero/NaN aspect would make the tile infinitely long, and a canvas with an
  // invalid width serialises to "data:," which the texture loader then rejects and takes the
  // whole tree down with it.
  const a = Number.isFinite(canvasAspect) && canvasAspect > 0 ? canvasAspect : 2
  const strapW = BAND_LINE_W * Math.tan((CAM_FOV / 2) * Math.PI / 180) * a
  return Math.max(1, Math.min(16, (ROPE_LEN / BAND_REPEAT) / strapW))
}

export const STRAP_COLOR = '#1b1e23'

// How many marks per texture tile. The component repeats the tile BAND_REPEAT times over the
// rope, so total marks = this * BAND_REPEAT, of which roughly half are in view.
const MARKS_PER_TILE = 2

function rr (g, x, y, w, h, r) {
  g.beginPath()
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r)
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r)
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath()
}

export function makeCardFrontURL () {
  const c = document.createElement('canvas'); c.width = CARD_W; c.height = CARD_H
  const g = c.getContext('2d')
  const s = CARD_W / 640                       // the layout was designed at 640 wide

  g.fillStyle = '#1f2229'; g.fillRect(0, 0, CARD_W, CARD_H)
  rr(g, 20 * s, 120 * s, CARD_W - 40 * s, CARD_H - 190 * s, 16 * s)
  g.fillStyle = '#262a32'; g.fill()
  g.lineWidth = 2 * s; g.strokeStyle = 'rgba(255,255,255,.10)'; g.stroke()

  const sheen = g.createLinearGradient(0, 0, CARD_W * 0.9, CARD_H * 0.55)
  sheen.addColorStop(0, 'rgba(255,255,255,.06)'); sheen.addColorStop(.45, 'rgba(255,255,255,0)')
  g.fillStyle = sheen; g.fillRect(0, 0, CARD_W, CARD_H)

  const padL = 52 * s
  const ls = v => { if ('letterSpacing' in g) g.letterSpacing = v }
  g.textBaseline = 'top'
  ls('0px');   g.fillStyle = '#f4f6fa'; g.font = `700 ${62 * s}px ${FONT}`; g.fillText('Stefan', padL, CARD_H * 0.478)
  ls('1.8px'); g.fillStyle = '#5fa8ff'; g.font = `600 ${29 * s}px ${FONT}`; g.fillText('AIGC/Game Designer', padL, CARD_H * 0.569)
  ls('1.1px'); g.fillStyle = '#cbd0d9'; g.font = `400 ${27 * s}px ${FONT}`; g.fillText('USC School of Cinematic Arts', padL, CARD_H * 0.644)
  ls('0px');   g.fillStyle = '#9aa1b0'; g.font = `400 ${25 * s}px ${FONT}`; g.fillText('Class of 2027', padL, CARD_H * 0.693)

  return c.toDataURL('image/png')
}

// The back exists only to cover the model's bundled artwork on that face.
export function makeCardBackURL () {
  const c = document.createElement('canvas'); c.width = CARD_W; c.height = CARD_H
  const g = c.getContext('2d')
  const s = CARD_W / 640

  g.fillStyle = '#1f2229'; g.fillRect(0, 0, CARD_W, CARD_H)
  rr(g, 20 * s, 120 * s, CARD_W - 40 * s, CARD_H - 190 * s, 16 * s)
  g.fillStyle = '#23272e'; g.fill()
  g.lineWidth = 2 * s; g.strokeStyle = 'rgba(255,255,255,.07)'; g.stroke()

  g.textAlign = 'center'; g.textBaseline = 'middle'
  if ('letterSpacing' in g) g.letterSpacing = '4px'
  g.fillStyle = '#6d7280'; g.font = `600 ${22 * s}px ${FONT}`
  g.fillText('USC GAMES', CARD_W / 2, CARD_H * 0.5)
  if ('letterSpacing' in g) g.letterSpacing = '2px'
  g.fillStyle = '#4b5058'; g.font = `400 ${18 * s}px ${FONT}`
  g.fillText('CLASS OF 2027', CARD_W / 2, CARD_H * 0.56)

  return c.toDataURL('image/png')
}

// Flat webbing plus the mark, and nothing else. Fine detail cannot survive here: the strap
// renders roughly 30px wide, so this 256px axis is minified about 9:1 and anything approaching
// a single texel lands inside a fraction of a screen pixel and crawls as the strap moves.
export function makeStrapURL (patternUrl, canvasAspect) {
  return new Promise((resolve) => {
    const H = 256, W = Math.round(H * strapTileAspect(canvasAspect))
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const g = c.getContext('2d')
    g.fillStyle = STRAP_COLOR; g.fillRect(0, 0, W, H)

    // Woven-webbing roughness. Both axes are minified about 9:1 here (a 1381x256 tile lands in
    // roughly 150x28 screen px), so a feature needs ~19 texels to hold two screen pixels.
    // Anything finer drops under Nyquist and crawls as the strap moves — that is exactly what
    // the old 1px-per-3px weft did. So: coarse twill on a ~48 texel pitch, soft mottling, and
    // a gradient across the width, all low contrast.

    // deterministic, so the strap looks identical on every load
    let seed = 20260731
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296

    // Twill ribs. The pitch is fitted to an exact divisor of W so the diagonal still lines up
    // across the seam where the tile repeats.
    const ribs = Math.max(1, Math.round(W / 48))
    const pitchX = W / ribs
    for (let i = 0; i < ribs; i++) {
      const x = i * pitchX
      for (const [off, col, wide] of [[0, 'rgba(255,255,255,.028)', 13], [pitchX * 0.5, 'rgba(0,0,0,.038)', 15]]) {
        g.strokeStyle = col; g.lineWidth = wide
        g.beginPath()
        // 45 degrees, drawn a second time a tile-width back so the part that runs off the
        // right edge reappears on the left
        g.moveTo(x + off - H, -2); g.lineTo(x + off + H, H + 2)
        g.moveTo(x + off - H - W, -2); g.lineTo(x + off + H - W, H + 2)
        g.stroke()
      }
    }

    // Soft mottling. Kept faint — at higher contrast it reads as wear and grime rather than
    // cloth. Radii stay well above the 19 texel floor, and each blob is repeated a tile-width
    // either side so none of them is cut off at the seam.
    for (let i = 0; i < 55; i++) {
      const bx = rnd() * W, by = rnd() * H
      const r = 34 + rnd() * 90
      const dark = rnd() < 0.5
      for (const dx of [0, -W, W]) {
        const grd = g.createRadialGradient(bx + dx, by, 0, bx + dx, by, r)
        grd.addColorStop(0, dark ? 'rgba(0,0,0,.026)' : 'rgba(255,255,255,.022)')
        grd.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = grd
        g.fillRect(bx + dx - r, by - r, r * 2, r * 2)
      }
    }

    // Across the width: dark selvage, a little sheen inboard. A gradient is inherently low
    // frequency, so unlike the hard edge lines this used to have, it cannot alias.
    const shade = g.createLinearGradient(0, 0, 0, H)
    shade.addColorStop(0, 'rgba(0,0,0,.42)')
    shade.addColorStop(.10, 'rgba(255,255,255,.10)')
    shade.addColorStop(.32, 'rgba(255,255,255,.02)')
    shade.addColorStop(.5, 'rgba(0,0,0,.05)')
    shade.addColorStop(.68, 'rgba(255,255,255,.02)')
    shade.addColorStop(.90, 'rgba(255,255,255,.10)')
    shade.addColorStop(1, 'rgba(0,0,0,.42)')
    g.fillStyle = shade; g.fillRect(0, 0, W, H)

    const img = new Image()
    img.onload = () => {
      // Drawn large — 78% of the strap's width — because a big shape is both more legible and
      // far safer under minification than a small one.
      const across = H * 0.78
      const k = across / img.width
      const along = img.height * k

      // MARKS_PER_TILE of them, evenly spaced. The component repeats this tile 4 times over
      // the rope, so this is the only lever on how many appear without patching it — and even
      // spacing keeps the seam between tiles invisible.
      const pitch = W / MARKS_PER_TILE
      for (let i = 0; i < MARKS_PER_TILE; i++) {
        g.save()
        // A quarter turn: canvas +x runs ALONG the strap, so without it the mark lies on its
        // side once the lanyard hangs. Uniform scale, so the artwork keeps its own aspect.
        g.translate(i * pitch + pitch / 2, H / 2)
        g.rotate(-Math.PI / 2)
        g.drawImage(img, -img.width * k / 2, -img.height * k / 2, img.width * k, img.height * k)
        g.restore()
      }
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => resolve(c.toDataURL('image/png'))   // plain strap rather than nothing
    img.src = patternUrl
  })
}
