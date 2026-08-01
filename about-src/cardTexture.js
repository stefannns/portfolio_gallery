// Artwork fed to the Lanyard component as plain images. The component composites whatever we
// pass into the card model's UV atlas and onto the band, so nothing here touches three.js.

const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'

// The card model's front face maps to a 0.5 x 0.755 rect of a 1024 atlas, so this is the
// aspect the artwork has to be or the component will crop it to fit.
const CARD_W = 512, CARD_H = 773

export const CAM_FOV = 25       // passed to the component
export const CAM_Z = 13
const BAND_REPEAT = 4           // fixed inside the component's meshLineMaterial
const ROPE_LEN = 3              // 3 rope joints of length 1, also fixed in the component
const BAND_LINE_W = 1           // the component's lanyardWidth default

// meshline offsets vertices by 0.5*lineWidth in CLIP space, so the strap's world width works
// out to lineWidth * tan(fov/2). One texture tile covers ropeLength/repeat along the strap by
// that much across it — matching the canvas to the same shape is what keeps the mark from
// being stretched lengthwise.
const STRAP_W = BAND_LINE_W * Math.tan((CAM_FOV / 2) * Math.PI / 180)
const TILE_ASPECT = (ROPE_LEN / BAND_REPEAT) / STRAP_W

export const STRAP_COLOR = '#4c515a'

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
  ls('1.8px'); g.fillStyle = '#c9a9ff'; g.font = `600 ${29 * s}px ${FONT}`; g.fillText('AIGC/Game Designer', padL, CARD_H * 0.569)
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
export function makeStrapURL (patternUrl) {
  return new Promise((resolve) => {
    const H = 256, W = Math.round(H * TILE_ASPECT)
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const g = c.getContext('2d')
    g.fillStyle = STRAP_COLOR; g.fillRect(0, 0, W, H)

    const img = new Image()
    img.onload = () => {
      // Drawn large — 78% of the strap's width — because a big shape is both more legible and
      // far safer under minification than a small one.
      const across = H * 0.78
      const k = across / img.width
      const along = img.height * k
      g.save()
      // A quarter turn: canvas +x runs ALONG the strap, so without it the mark lies on its side
      // once the lanyard hangs. Uniform scale, so the artwork keeps its own aspect.
      g.translate(along / 2 + H * 0.10, H / 2)
      g.rotate(-Math.PI / 2)
      g.drawImage(img, -img.width * k / 2, -img.height * k / 2, img.width * k, img.height * k)
      g.restore()
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => resolve(c.toDataURL('image/png'))   // plain strap rather than nothing
    img.src = patternUrl
  })
}
