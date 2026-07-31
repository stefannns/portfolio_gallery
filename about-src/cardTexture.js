import * as THREE from 'three'
import patternUrl from './pattern.png'

const FONT ='-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'

function rr(g,x,y,w,h,r){
  g.beginPath()
  g.moveTo(x+r,y); g.lineTo(x+w-r,y); g.quadraticCurveTo(x+w,y,x+w,y+r)
  g.lineTo(x+w,y+h-r); g.quadraticCurveTo(x+w,y+h,x+w-r,y+h)
  g.lineTo(x+r,y+h); g.quadraticCurveTo(x,y+h,x,y+h-r)
  g.lineTo(x,y+r); g.quadraticCurveTo(x,y,x+r,y); g.closePath()
}

// Card face drawn to a canvas: same content and palette as the page.
// Card is 1.6 x 2.25 world units (the reference's collider), so the canvas matches that aspect.
export function makeCardTexture(){
  const W=640, H=900
  const c=document.createElement('canvas'); c.width=W; c.height=H
  const g=c.getContext('2d')

  rr(g,0,0,W,H,34); g.fillStyle='#14161c'; g.fill()          // holder body
  rr(g,26,150,W-52,H-210,20); g.fillStyle='#0f1118'; g.fill() // printed card, recessed
  g.lineWidth=2; g.strokeStyle='rgba(255,255,255,.06)'; g.stroke()

  const sheen=g.createLinearGradient(0,0,W*0.9,H*0.55)
  sheen.addColorStop(0,'rgba(255,255,255,.06)'); sheen.addColorStop(.45,'rgba(255,255,255,0)')
  rr(g,0,0,W,H,34); g.fillStyle=sheen; g.fill()

  const padL=64
  g.textBaseline='top'
  const ls=v=>{ if('letterSpacing' in g) g.letterSpacing=v }
  ls('0px');   g.fillStyle='#f4f6fa'; g.font='700 62px '+FONT; g.fillText('Stefan',padL,430)
  ls('1.8px'); g.fillStyle='#b98cff'; g.font='600 29px '+FONT; g.fillText('AIGC/Game Designer',padL,512)
  ls('1.1px'); g.fillStyle='#9297a3'; g.font='400 27px '+FONT; g.fillText('USC School of Cinematic Arts',padL,580)
  ls('0px');   g.fillStyle='#5b5f6b'; g.font='400 25px '+FONT; g.fillText('Class of 2027',padL,624)

  const tex=new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

// The lanyard webbing: black strap carrying the repeating mark from pattern.png.
//
// Getting the mark UNSTRETCHED needs the texture tile to be the same shape in world space as
// it is in the canvas. meshline draws with sizeAttenuation on, which offsets vertices by
// 0.5*lineWidth in clip space — so the strap's world width works out to
// lineWidth * tan(fov/2), independent of depth. Texture u runs ALONG the strap and v across
// it, so one tile covers (ropeLength / repeat) along by STRAP_W across. Setting the canvas
// to the same aspect makes the mark come out true.
export const BAND_LINE_W = 1                           // meshLineMaterial lineWidth
export const CAM_FOV = 25                              // camera fov, degrees
export const CAM_Z = 13                                // camera distance
const FOV = CAM_FOV
const ROPE_LEN = 3                                     // 3 rope joints, length 1 each
const STRAP_W = BAND_LINE_W * Math.tan((FOV / 2) * Math.PI / 180)

// Roughly three marks in view. Only about 60% of the rope is on screen once the badge settles
// — the rest runs off the top — so the repeat is set over the whole rope to land ~3 visible.
// A whole number matters: a fractional repeat would slice a mark in half where the texture
// wraps. The tile's true aspect then falls out of that choice and the canvas is built to match,
// so the spare length shows up as spacing between marks rather than as stretch across them.
export const BAND_REPEAT = 5
const TILE_ASPECT = (ROPE_LEN / BAND_REPEAT) / STRAP_W

export function makeBandTexture(){
  const H = 256, W = Math.round(H * TILE_ASPECT)       // W = along strap, H = across
  const c=document.createElement('canvas'); c.width=W; c.height=H
  const g=c.getContext('2d')

  // A true black strap is indistinguishable from the page (--bg is #0b0b0d), which left the
  // webbing invisible between marks. This charcoal still reads as a black lanyard but
  // separates from the background.
  g.fillStyle='#191a20'; g.fillRect(0,0,W,H)

  // woven weft, running across the strap
  g.strokeStyle='rgba(255,255,255,.035)'; g.lineWidth=1
  for(let x=0;x<W;x+=3){ g.beginPath(); g.moveTo(x+.5,0); g.lineTo(x+.5,H); g.stroke() }
  // darker selvage down both edges
  const edge=g.createLinearGradient(0,0,0,H)
  edge.addColorStop(0,'rgba(0,0,0,.55)'); edge.addColorStop(.14,'rgba(0,0,0,0)')
  edge.addColorStop(.86,'rgba(0,0,0,0)'); edge.addColorStop(1,'rgba(0,0,0,.55)')
  g.fillStyle=edge; g.fillRect(0,0,W,H)

  const tex=new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 16

  // The mark loads async; draw it in when it arrives and flag the texture dirty. Rotated a
  // quarter turn because canvas +x runs ALONG the strap — without it the mark would lie on
  // its side once the lanyard hangs. Scale is uniform, so the artwork keeps its own aspect.
  const img = new Image()
  img.onload = () => {
    const across = H * 0.60          // fraction of the strap's width the mark covers
    const s = across / img.width     // uniform: img width ends up across, height along
    const along = img.height * s
    // Sit the mark at the START of the tile rather than its centre. u=0 is the card end of the
    // strap, so this puts one mark just above the clip and the rest stepping up from there —
    // centring them instead left every mark above the top of the frame once the badge settled.
    g.save()
    g.translate(along / 2 + H * 0.08, H / 2)
    g.rotate(-Math.PI / 2)
    g.drawImage(img, -img.width * s / 2, -img.height * s / 2, img.width * s, img.height * s)
    g.restore()
    tex.needsUpdate = true
  }
  img.src = patternUrl

  return tex
}
