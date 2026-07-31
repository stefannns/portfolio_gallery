import * as THREE from 'three'

const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'

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

// Woven-webbing strip for the band. Repeats along the strap's length.
export function makeBandTexture(){
  const W=64, H=256
  const c=document.createElement('canvas'); c.width=W; c.height=H
  const g=c.getContext('2d')
  g.fillStyle='#1e3a8a'; g.fillRect(0,0,W,H)
  g.strokeStyle='rgba(255,255,255,.05)'; g.lineWidth=1
  for(let y=0;y<H;y+=4){ g.beginPath(); g.moveTo(0,y+.5); g.lineTo(W,y+.5); g.stroke() }
  g.fillStyle='rgba(0,0,0,.20)'; g.fillRect(0,0,3,H); g.fillRect(W-3,0,3,H)
  const tex=new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}
