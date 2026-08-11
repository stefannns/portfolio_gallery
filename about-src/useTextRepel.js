import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'

const SELECTOR = '.info .intro .line, .info .sec-title, .info .chip'
const MARGIN = 14      // clearance kept between the badge and any element
const GAP = 12         // clearance kept between two elements
const EASE = 0.18      // per-frame approach, keeps the dodge from snapping
const RELAX = 4        // separation passes per frame
const MAX_PUSH = 300   // cap, so a wide block can't be shoved off the page
const ROW_TOL = 2      // vertical overlap under this isn't a collision (see the relax pass)

// Rebuilds the paragraph as one shrink-wrapped block per visual line, so each line can dodge
// the badge on its own instead of the whole paragraph sliding sideways.
//
// The break points are the browser's own: every word goes in a probe span, the spans are
// grouped by their top edge, and the paragraph is then re-emitted with those groups as blocks.
// Since each block's text is exactly what fitted on that line, none of them re-wraps and the
// paragraph looks untouched until something pushes it.
function splitIntoLines (p, text) {
  p.textContent = ''
  const probes = text.split(' ').map((w) => {
    const s = document.createElement('span')
    s.textContent = w
    p.append(s, document.createTextNode(' '))
    return s
  })

  // read-only loop, so this costs one layout rather than one per word
  const lines = []
  let top = null
  for (const s of probes) {
    const t = s.getBoundingClientRect().top
    if (top === null || t - top > 2) { lines.push([]); top = t }
    lines[lines.length - 1].push(s.textContent)
  }

  p.textContent = ''
  return lines.map((words) => {
    const el = document.createElement('span')
    el.className = 'line'
    el.textContent = words.join(' ')
    p.appendChild(el)
    return el
  })
}

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
    const intro = document.querySelector('.info .intro')
    // kept so the paragraph can be re-flowed from scratch on resize, and put back on unmount
    const text = intro ? intro.textContent.replace(/\s+/g, ' ').trim() : ''

    const measure = () => {
      // re-flowed every time, so the lines follow the browser's breaks at the current width
      if (intro) splitIntoLines(intro, text)
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

    /* Re-split once the webfonts have settled. The line boxes are frozen at the browser's OWN
       break points, which means they are only correct for the metrics that were active when they
       were measured — and .intro is set in Mozilla Text with font-display:swap, so the first
       measure necessarily runs against the fallback. The moment the real font arrives the text
       reflows inside spans cut for a different width, and the breaks land mid-phrase.
       document.fonts.ready covers every pending face at once, and resolves immediately when they
       are already cached, so the reflow only happens on a cold load. */
    let alive = true
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { if (alive) measure() })
    }

    /* Chip hover, done by hit-test rather than by :hover. The badge canvas covers the copy so it
       can receive drags, which means the pointer never actually lands on a chip — see the note on
       .chip.is-hot in styles.css for why raising them out from under it is not an option.
       The rects are read at event time, so this follows the chips as they dodge; they carry a
       live transform and their laid-out position is not where they are. */
    const chips = () => items.current.filter((it) => it.el.classList.contains('chip'))
    const onMove = (e) => {
      for (const it of chips()) {
        const r = it.el.getBoundingClientRect()
        it.el.classList.toggle('is-hot',
          e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)
      }
    }
    const clearHot = () => { for (const it of chips()) it.el.classList.remove('is-hot') }
    addEventListener('pointermove', onMove, { passive: true })
    addEventListener('pointerleave', clearHot)
    addEventListener('blur', clearHot)

    return () => {
      alive = false
      removeEventListener('pointermove', onMove)
      removeEventListener('pointerleave', clearHot)
      removeEventListener('blur', clearHot)
      clearHot()
      removeEventListener('resize', measure)
      items.current.forEach((it) => { it.el.style.transform = '' })
      items.current = []
      if (intro) intro.textContent = text
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
    //    Stacked lines sit exactly edge to edge — their boxes are one line-height tall and one
    //    line-height apart — so without the tolerance subpixel rects can read as an overlap and
    //    two neighbouring lines shove each other apart sideways for no reason.
    for (let pass = 0; pass < RELAX; pass++) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j]
          if (Math.abs(a.cy - b.cy) >= a.hh + b.hh - ROW_TOL) continue
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
