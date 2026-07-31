import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'

const SELECTOR = '.info .intro, .info .sec-title, .info .chip'
const RADIUS = 210     // px at which a element starts getting pushed
const PUSH = 78        // px of travel at the very centre
const EASE = 0.14      // per-frame approach, keeps it from snapping

// Nudges the copy out of the badge's way. The canvas sits over the text now, so without this
// the card just slides on top of the paragraph. Returns a function to call once per frame with
// the card's world position.
export function useTextRepel() {
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
        return { el, cx: r.left + r.width / 2 + scrollX, cy: r.top + r.height / 2 + scrollY, ox: 0, oy: 0 }
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

  return (cardPos, camera, canvas) => {
    const list = items.current
    if (!list.length) return
    const cr = canvas.getBoundingClientRect()
    v.set(cardPos.x, cardPos.y, cardPos.z).project(camera)
    const sx = cr.left + scrollX + (v.x * 0.5 + 0.5) * cr.width
    const sy = cr.top + scrollY + (-v.y * 0.5 + 0.5) * cr.height

    for (const it of list) {
      const dx = it.cx - sx, dy = it.cy - sy
      const d = Math.hypot(dx, dy)
      let tx = 0, ty = 0
      if (d < RADIUS && d > 0.01) {
        const f = (1 - d / RADIUS) ** 2 * PUSH   // squared falloff: calm until it's close
        tx = (dx / d) * f
        ty = (dy / d) * f
      }
      it.ox += (tx - it.ox) * EASE
      it.oy += (ty - it.oy) * EASE
      it.el.style.transform = Math.abs(it.ox) < 0.05 && Math.abs(it.oy) < 0.05
        ? ''
        : `translate3d(${it.ox.toFixed(2)}px, ${it.oy.toFixed(2)}px, 0)`
    }
  }
}
