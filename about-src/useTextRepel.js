import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'

const SELECTOR = '.info .intro, .info .sec-title, .info .chip'
const MARGIN = 14      // clearance kept between the badge and any element
const GAP = 12         // clearance kept between two elements
const EASE = 0.18      // per-frame approach, keeps the dodge from snapping
const RELAX = 4        // separation passes per frame
const MAX_PUSH = 300   // cap, so a wide block can't be shoved off the page

// Moves the copy clear of the badge. The canvas sits over the text, so without this the card
// just slides on top of the paragraph.
//
// Two things happen per frame:
//   1. each element is pushed sideways until its box no longer touches the badge's box, and
//   2. the elements are then relaxed against EACH OTHER, so a chip that dodges the badge
//      doesn't end up sitting on the chip next to it.
// Movement is horizontal only — vertical dodging shuffled the whole column around and read as
// the layout breaking rather than as things getting out of the way.
//
// Returns a function to call once per frame with the card's four world-space corners.
export function useTextRepel () {
  const items = useRef([])
  const v = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    const measure = () => {
      const els = Array.from(document.querySelectorAll(SELECTOR))
      // Clear transforms before measuring, otherwise each pass reads the previous offset back
      // in and the elements creep across the page.
      els.forEach((el) => { el.style.transform = '' })
      items.current = els.map((el) => {
        const r = el.getBoundingClientRect()
        return {
          el,
          cx: r.left + r.width / 2 + scrollX, cy: r.top + r.height / 2 + scrollY,
          hw: r.width / 2, hh: r.height / 2,
          tx: 0, ox: 0,
        }
      })
    }
    measure()
    addEventListener('resize', measure)
    return () => {
      removeEventListener('resize', measure)
      items.current.forEach((it) => { it.el.style.transform = '' })
      items.current = []
    }
  }, [])

  return (corners, camera, canvas) => {
    const list = items.current
    if (!list.length) return
    const cr = canvas.getBoundingClientRect()

    // screen-space box of the badge, from its projected corners
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const c of corners) {
      v.copy(c).project(camera)
      const x = cr.left + scrollX + (v.x * 0.5 + 0.5) * cr.width
      const y = cr.top + scrollY + (-v.y * 0.5 + 0.5) * cr.height
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const bcx = (minX + maxX) / 2, bcy = (minY + maxY) / 2
    const bhw = (maxX - minX) / 2, bhh = (maxY - minY) / 2

    // 1. clear the badge, horizontally
    for (const it of list) {
      const dx = it.cx - bcx, dy = it.cy - bcy
      const penX = bhw + it.hw + MARGIN - Math.abs(dx)
      const penY = bhh + it.hh + MARGIN - Math.abs(dy)
      it.tx = (penX > 0 && penY > 0)
        ? Math.max(-MAX_PUSH, Math.min(MAX_PUSH, (dx < 0 ? -1 : 1) * penX))
        : 0
    }

    // 2. relax the elements against each other. Only pairs that share vertical space can
    //    collide, so rows are handled independently without needing to group them.
    for (let pass = 0; pass < RELAX; pass++) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j]
          if (Math.abs(a.cy - b.cy) >= a.hh + b.hh) continue
          const d = (b.cx + b.tx) - (a.cx + a.tx)
          const pen = a.hw + b.hw + GAP - Math.abs(d)
          if (pen <= 0) continue
          const shift = (d < 0 ? -1 : 1) * pen / 2
          a.tx -= shift
          b.tx += shift
        }
      }
    }

    // 3. ease toward the resolved position and write it out
    for (const it of list) {
      it.ox += (it.tx - it.ox) * EASE
      it.el.style.transform = Math.abs(it.ox) < 0.05
        ? ''
        : `translate3d(${it.ox.toFixed(2)}px, 0, 0)`
    }
  }
}
