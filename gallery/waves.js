/* Cursor-reactive contour field, drawn behind the gallery.
 *
 * Raw WebGL rather than three.js even though three is already in this bundle: this is one
 * full-screen quad with one shader, and a scene graph, camera and renderer around it would be
 * more moving parts than the effect itself. It also keeps it independent of the R3F canvas that
 * the badge owns — two renderers, no shared state.
 *
 * The waves are CONTOUR LINES of an animated noise field, not stacked sines. Sines give regular
 * corduroy that reads as a pattern; contours of fbm split, merge and pinch, which reads as flow.
 *
 * Returns a teardown function. Call it on unmount or the rAF loop outlives the component.
 */

const VS = `attribute vec2 p; varying vec2 uv;
void main(){ uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`

/* The #extension line is not optional and gl.getExtension() is not a substitute: that call
   enables the extension on the CONTEXT, while the shader still has to declare it or fwidth is an
   unknown function and the program fails to compile — silently, into a blank canvas. It also has
   to come before any non-preprocessor line, `precision` included. */
const FS = `#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec2 uv;
uniform vec2  uRes;
uniform float uTime;
uniform vec2  uMouse;
uniform vec2  uMouseVel;
uniform float uPace;
uniform float uScale, uSpeed, uWarp, uLines, uCursor, uReach, uFade, uRough;
uniform vec3  uAccent, uBg;

/* Hash-based value noise. Deliberately not simplex: no permutation table, a handful of
   instructions, and under a domain warp at four octaves the difference does not show — the warp
   does the shaping, the noise only supplies the randomness. */
float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  /* QUINTIC fade, not the usual smoothstep. Cubic is continuous in value and slope but NOT in
     curvature, and the contours here are drawn from fwidth — a screen-space derivative — so that
     discontinuity is exactly what the renderer is looking at. It shows up as faint creases on
     every cell boundary and as lines that kink where they cross one. Perlin's 6t^5-15t^4+10t^3
     has a zero second derivative at both ends, which removes the creases entirely. It is the
     single biggest smoothness win here and costs two multiplies. */
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
/* uRough is the amplitude falloff per octave. At the textbook 0.5 the fine octaves carry enough
   weight to break the contours into wobble; dropping it weights the broad shapes instead, which
   is what "smoother" means for a field like this — fewer, longer, cleaner curves rather than the
   same curves blurred. */
float fbm(vec2 p){
  float v = 0.0, a = 0.5, norm = 0.0;
  for (int i = 0; i < 4; i++){
    v += a * vnoise(p); norm += a;
    p *= 2.02; a *= uRough;
  }
  return v / norm;   // normalised, so changing uRough does not also change the contour spacing
}

void main(){
  vec2 st = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);   // aspect-corrected, so cells stay square

  /* The pointer DRAGS the field along its direction of travel. It does not pull toward itself:
     displacing along normalize(st - uMouse) is a radial sink and every contour within reach
     collapses into the cursor like a drain. Along the velocity instead, it smears sideways the
     way a finger drawn through liquid does. A stationary cursor therefore leaves the field
     completely undisturbed — the effect is about movement, not position. */
  float d = length(st - uMouse);
  float pull = exp(-d * d / max(uReach * uReach, 1e-4));
  st -= uMouseVel * pull * uCursor;

  float t = uTime * uSpeed;

  /* Domain warp: the field is sampled at a position itself displaced by another fbm. This is the
     single biggest reason it looks fluid rather than like drifting wallpaper. */
  vec2 q = vec2(fbm(st * uScale + t), fbm(st * uScale + vec2(5.2, 1.3) - t));
  float field = fbm(st * uScale + q * uWarp + vec2(-t, t * 0.6));

  /* abs(fract(x) - 0.5) is a triangle wave; the fold makes both sides of a line symmetrical, so
     no line ends up with a bright edge and a dark one. Thresholding against fwidth keeps every
     line the same visual weight whether it runs flat or steep — with a fixed threshold the
     near-vertical ones thin out and sparkle. */
  float bands = field * uLines;
  float tri = abs(fract(bands) - 0.5);
  float w = fwidth(bands);
  float line = 1.0 - smoothstep(0.0, w * 1.6, tri);

  float shade = 0.35 + 0.65 * smoothstep(0.2, 0.9, field);
  vec3 col = uBg + uAccent * line * shade * uFade;
  col += uAccent * pull * 0.10 * uPace * uFade;        // faint wake, only while moving
  gl_FragColor = vec4(col, 1.0);
}`

function compile (gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s))
  }
  return s
}

/* The tuning panel.
 *
 * HIDDEN BY DEFAULT, and deliberately so: this ships inside /about, and a public portfolio with a
 * row of developer sliders on it looks unfinished. Press T to toggle, or load the page with
 * ?tune to have it open from the start.
 *
 * Built in plain DOM rather than as a React component, and styled inline, so it lives next to the
 * values it drives and adds nothing to styles.css that would have to be maintained alongside a
 * feature that is only ever used while tuning.
 */
const PANEL_FIELDS = [
  ['scale',  'Scale',       0.5,  6,    0.05],
  ['speed',  'Speed',       0,    0.6,  0.005],
  ['warp',   'Warp',        0,    2,    0.02],
  ['rough',  'Roughness',   0.06, 0.6,  0.01],
  ['lines',  'Lines',       2,    40,   1],
  ['cursor', 'Cursor drag', 0,    1.2,  0.02],
  ['reach',  'Reach',       0.05, 1,    0.01],
  ['fade',   'Opacity',     0.1,  1.4,  0.02],
]

function mountPanel (cfg) {
  const box = document.createElement('div')
  const open = new URLSearchParams(location.search).has('tune')
  box.style.cssText = `position:fixed;right:14px;bottom:14px;z-index:40;width:214px;padding:13px;
    border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(5,7,10,.78);
    backdrop-filter:blur(12px);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#7d8b86;
    display:${open ? 'block' : 'none'}`

  box.innerHTML = '<div style="margin:0 0 11px;letter-spacing:.24em;color:#eef4f1">Field ' +
    '<span style="float:right;opacity:.5">T</span></div>' +
    PANEL_FIELDS.map(([k, label, min, max, step]) => `
      <label style="display:block;margin:0 0 9px">
        <span style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span>${label}</span><output data-o="${k}" style="color:#83f2cd"></output></span>
        <input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}"
          style="width:100%;height:2px;appearance:none;-webkit-appearance:none;
                 background:rgba(255,255,255,.16);border-radius:2px;outline:none">
      </label>`).join('')

  // range thumbs cannot be styled inline; this is the only rule the panel needs in the document
  const css = document.createElement('style')
  css.textContent = `.waves-tune input[type=range]::-webkit-slider-thumb{appearance:none;
    -webkit-appearance:none;width:11px;height:11px;border-radius:50%;background:#83f2cd;
    cursor:pointer}`
  box.className = 'waves-tune'

  const sync = () => box.querySelectorAll('input[data-k]').forEach((i) => {
    const k = i.dataset.k
    i.value = cfg[k]
    box.querySelector(`output[data-o="${k}"]`).value = (+cfg[k]).toFixed(k === 'lines' ? 0 : 2)
  })
  box.addEventListener('input', (e) => {
    const k = e.target.dataset.k
    if (k) { cfg[k] = +e.target.value; sync() }
  })

  const onKey = (e) => {
    if (e.key === 't' || e.key === 'T') {
      box.style.display = box.style.display === 'none' ? 'block' : 'none'
    }
  }
  addEventListener('keydown', onKey)

  document.body.append(css, box)
  sync()

  return () => { removeEventListener('keydown', onKey); box.remove(); css.remove() }
}

export function mountWaves (canvas, opts = {}) {
  /* Tuned on the page, not guessed at. Worth reading as a set: the field is zoomed further in
     (scale 4) and moving nearly three times faster than the first pass, but with roughness right
     down at 0.20 and only 9 contours — so it is fewer, broader, cleaner curves travelling
     quickly, rather than many fine ones drifting. Cursor drag is deliberately light at 0.12 with
     a tight 0.22 reach: a small local disturbance, not a wake across the whole page. */
  const cfg = {
    scale: 4.0, speed: 0.24, warp: 0.7, lines: 9,
    cursor: 0.12, reach: 0.22,
    rough: 0.13,                  // lower = smoother; weights the broad shapes over the
                                 // fine wobble, so the contours run longer and cleaner
    fade: 0.42,                    // lower than /about: the cards are the subject here
    accent: [0x6b / 255, 0xe3 / 255, 0xc9 / 255],   // the gallery's own default --accent
    bg: [0.02, 0.023, 0.031],      // matches the page's #05060a end stop, so the edges blend
    ...opts,
  }

  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false })
  if (!gl) return () => {}

  // Before compiling, not after: asked for afterwards it cannot rescue a shader already rejected.
  gl.getExtension('OES_standard_derivatives')

  let prog
  try {
    prog = gl.createProgram()
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
  } catch (err) {
    // A background is not worth taking the page down for. Leave the canvas blank and move on.
    console.warn('waves: shader unavailable —', err.message)
    return () => {}
  }
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const U = (n) => gl.getUniformLocation(prog, n)

  /* The gallery sets --accent on each .slide, and marks the centred one .is-center. Reading it
     from the DOM rather than being told about it means nothing in the gallery's own script has to
     change — it already does this work for its cards, and the background just listens.
     Eased rather than switched: paging between pieces should wash from one colour to the next,
     and an instant swap under a card that is still sliding looks like a glitch. */
  const accent = [...cfg.accent]
  const hex = (str) => {
    const h = String(str).trim().replace('#', '')
    if (h.length !== 6) return null
    const n = parseInt(h, 16)
    return Number.isNaN(n) ? null : [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
  }
  const readAccent = () => {
    const el = document.querySelector('.slide.is-center') || document.querySelector('.slide')
    if (!el) return null
    return hex(getComputedStyle(el).getPropertyValue('--accent'))
  }

  const m = { tx: 0, ty: 0, x: 0, y: 0, vx: 0, vy: 0, pace: 0 }
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect()
    if (!r.width || !r.height) return
    m.tx = ((e.clientX - r.left) / r.width - 0.5) * (r.width / r.height)
    m.ty = -((e.clientY - r.top) / r.height - 0.5)
  }
  addEventListener('pointermove', onMove, { passive: true })

  /* Checked every frame rather than only on window resize. Measuring once at mount is not safe:
     the effect runs before the browser has necessarily settled the layout, and a rect of 0x0 then
     sticks forever because nothing else asks again — a 1x1 backing store rendering to nothing,
     with no error anywhere to explain it. Comparing against the current backing store makes this
     free in the normal case and self-healing in every other, including the badge's own layout
     landing late and the standalone-vs-embedded difference in how this canvas is sized. */
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const r = canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(r.width * dpr))
    const h = Math.max(1, Math.round(r.height * dpr))
    if (w === canvas.width && h === canvas.height) return
    canvas.width = w
    canvas.height = h
    gl.viewport(0, 0, w, h)
  }
  addEventListener('resize', resize)
  resize()

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  let raf = 0
  let last = performance.now()

  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05)   // clamped: a backgrounded tab must not lurch
    last = now
    resize()

    /* 1 - exp(-k*dt) is the continuous form of a per-frame lerp, so the easing is the same on a
       60Hz and a 120Hz display instead of running twice as fast on one of them. */
    const kPos = 1 - Math.exp(-6.0 * dt)
    const px = m.x, py = m.y
    m.x += (m.tx - m.x) * kPos
    m.y += (m.ty - m.y) * kPos

    /* Velocity as a vector, eased more slowly than the position — that lag is what gives the wake
       its trail rather than snapping still the instant the pointer stops. Clamped, or a fast flick
       displaces the field further than its own reach and tears a hole in it. */
    const kVel = 1 - Math.exp(-3.0 * dt)
    const ivx = (m.x - px) / Math.max(dt, 1e-4)
    const ivy = (m.y - py) / Math.max(dt, 1e-4)
    const mag = Math.hypot(ivx, ivy), cap = 3.0
    const sc = mag > cap ? cap / mag : 1
    m.vx += (ivx * sc - m.vx) * kVel
    m.vy += (ivy * sc - m.vy) * kVel
    m.pace = Math.hypot(m.vx, m.vy)

    gl.uniform2f(U('uRes'), canvas.width, canvas.height)
    gl.uniform1f(U('uTime'), reduced ? 0 : now / 1000)
    gl.uniform2f(U('uMouse'), m.x, m.y)
    gl.uniform2f(U('uMouseVel'), reduced ? 0 : m.vx, reduced ? 0 : m.vy)
    gl.uniform1f(U('uPace'), reduced ? 0 : m.pace)
    gl.uniform1f(U('uScale'), cfg.scale)
    gl.uniform1f(U('uSpeed'), cfg.speed)
    gl.uniform1f(U('uWarp'), cfg.warp)
    gl.uniform1f(U('uLines'), cfg.lines)
    gl.uniform1f(U('uCursor'), cfg.cursor)
    gl.uniform1f(U('uReach'), cfg.reach)
    gl.uniform1f(U('uFade'), cfg.fade)
    gl.uniform1f(U('uRough'), cfg.rough)
    const want = readAccent()
    if (want) { const k = 1 - Math.exp(-2.5 * dt)
      for (let i = 0; i < 3; i++) accent[i] += (want[i] - accent[i]) * k }
    gl.uniform3f(U('uAccent'), accent[0], accent[1], accent[2])
    gl.uniform3f(U('uBg'), cfg.bg[0], cfg.bg[1], cfg.bg[2])
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  /* DISABLED now the values above are settled. mountPanel and PANEL_FIELDS are left in place —
     they are the tool for the next round of tuning, not dead weight. Flip this to true (or pass
     panel: true) to get the sliders and the T toggle back. */
  const closePanel = cfg.panel ? mountPanel(cfg) : () => {}

  return () => {
    closePanel()
    cancelAnimationFrame(raf)
    removeEventListener('pointermove', onMove)
    removeEventListener('resize', resize)
    /* Contexts are a limited resource and this bundle mounts a second one for the badge; without
       this, a remount leaks one each time until the browser starts dropping the oldest. */
    const lose = gl.getExtension('WEBGL_lose_context')
    if (lose) lose.loseContext()
  }
}
