// Local preview adapter. The supplied game's bundle remains unchanged.
// Options (data-* on this script tag): data-seed-random="off" keeps the game's own Math.random.
(() => {
  const hostOptions = document.currentScript?.dataset ?? {};
  // The feed sandboxes games without allow-same-origin, so Web Storage throws and games that save
  // (e.g. the pumpkin collection) refuse to load. Back localStorage with window.name instead: it
  // survives the feed's iframe reload, so saves persist across leaving and re-entering a playable.
  try { void window.localStorage.length; } catch {
    const prefix = '__pocketStorage:';
    let data = {};
    try { if (window.name.startsWith(prefix)) data = JSON.parse(window.name.slice(prefix.length)); } catch { data = {}; }
    const write = () => { window.name = prefix + JSON.stringify(data); };
    const storage = {
      get length() { return Object.keys(data).length; },
      key: (index) => Object.keys(data)[index] ?? null,
      getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
      setItem: (key, value) => { data[key] = String(value); write(); },
      removeItem: (key) => { delete data[key]; write(); },
      clear: () => { data = {}; write(); },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  }
  // sessionStorage throws in the sandbox too; an in-memory stand-in is enough for one visit.
  try { void window.sessionStorage.length; } catch {
    let session = {};
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: {
      get length() { return Object.keys(session).length; },
      key: (index) => Object.keys(session)[index] ?? null,
      getItem: (key) => (Object.hasOwn(session, key) ? session[key] : null),
      setItem: (key, value) => { session[key] = String(value); },
      removeItem: (key) => { delete session[key]; },
      clear: () => { session = {}; },
    } });
  }
  // The game procedurally generates its scene. Replay the same random sequence
  // on every document load so returning to the feed restores the same scenery.
  // Games whose randomness is gameplay (shuffles, quizzes) opt out with data-seed-random="off".
  if (hostOptions.seedRandom !== 'off') {
    let sceneSeed = 20260924;
    Math.random = () => {
      sceneSeed = (sceneSeed + 0x6D2B79F5) | 0;
      let value = Math.imul(sceneSeed ^ (sceneSeed >>> 15), 1 | sceneSeed);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }
  let mouseTarget = null;
  function touch(type, event, target) {
    const point = new Touch({ identifier: 1, target, clientX: event.clientX, clientY: event.clientY, pageX: event.pageX, pageY: event.pageY });
    target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [point], targetTouches: type === 'touchend' ? [] : [point], changedTouches: [point] }));
  }
  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') return;
    // A game that handles pointers itself has already captured this one (e.g. the pumpkin canvas):
    // leave it alone — stealing the capture fires lostpointercapture and cancels its stroke.
    if (event.target instanceof Element && event.target.hasPointerCapture(event.pointerId)) return;
    const target = event.target.closest('div[style*="touch-action: none"]');
    if (!target) return;
    mouseTarget = target;
    target.setPointerCapture(event.pointerId);
    touch('touchstart', event, target);
  });
  document.addEventListener('pointermove', (event) => { if (mouseTarget) touch('touchmove', event, mouseTarget); });
  const release = (event) => { if (mouseTarget) { touch('touchend', event, mouseTarget); mouseTarget = null; } };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.type !== 'playable-active') return;
    if (!event.data.active && mouseTarget) {
      mouseTarget.dispatchEvent(new TouchEvent('touchend', { bubbles:true, touches:[], changedTouches:[] }));
      mouseTarget = null;
    }
  });
  // Autoplay (Clip's edit preview): a scripted player cycling through the common inputs — joystick
  // drags at either bottom corner, a swipe across the middle, held keys — so the frame reads like a
  // recording of someone playing. Each game reacts to whichever inputs it understands.
  // Scripted pointers have no real pointer behind them, so a game calling setPointerCapture on one
  // would throw mid-handler and leave its own input state stuck; treat those calls as no-ops instead.
  for (const method of ['setPointerCapture', 'releasePointerCapture']) {
    const native = Element.prototype[method];
    Element.prototype[method] = function (pointerId) {
      try { native.call(this, pointerId); } catch { /* not an active pointer (autoplay) */ }
    };
  }
  let autoplayTimers = [];
  const later = (fn, ms) => {
    const id = setTimeout(() => { autoplayTimers = autoplayTimers.filter(t => t !== id); fn(); }, ms);
    autoplayTimers.push(id);
  };
  function pointer(type, x, y, target) {
    const live = type !== 'up';
    target.dispatchEvent(new PointerEvent('pointer' + type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true, buttons: live ? 1 : 0 }));
    const point = new Touch({ identifier: 7, target, clientX: x, clientY: y, pageX: x, pageY: y });
    const touchType = { down: 'touchstart', move: 'touchmove', up: 'touchend' }[type];
    target.dispatchEvent(new TouchEvent(touchType, { bubbles: true, cancelable: true, touches: live ? [point] : [], targetTouches: live ? [point] : [], changedTouches: [point] }));
    target.dispatchEvent(new MouseEvent('mouse' + type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: live ? 1 : 0 }));
  }
  /** Press at (x0, y0) and trace `path(t)` (t: 0 → 1) for `ms`, then release. */
  function gesture(x0, y0, ms, path) {
    const target = document.elementFromPoint(x0, y0) || document.body;
    pointer('down', x0, y0, target);
    const steps = Math.max(2, Math.round(ms / 40));
    for (let i = 1; i <= steps; i++) {
      later(() => {
        const [dx, dy] = path(i / steps);
        pointer(i === steps ? 'up' : 'move', x0 + dx, y0 + dy, target);
      }, (ms * i) / steps);
    }
  }
  function key(code, holdMs) {
    const init = { code, key: code === 'Space' ? ' ' : code.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true };
    document.dispatchEvent(new KeyboardEvent('keydown', init));
    later(() => document.dispatchEvent(new KeyboardEvent('keyup', init)), holdMs);
  }
  const ACTIONS = [
    // Joystick bottom-left: push forward, then sweep around.
    () => gesture(innerWidth * 0.22, innerHeight * 0.82, 2200, t => [Math.sin(t * Math.PI * 2) * 34, -30 - Math.cos(t * Math.PI * 2) * 8]),
    // Swipe across the middle (carving / drawing / steering games).
    () => gesture(innerWidth * 0.25, innerHeight * 0.48, 900, t => [innerWidth * 0.5 * t, Math.sin(t * Math.PI) * 60]),
    // Joystick bottom-right.
    () => gesture(innerWidth * 0.76, innerHeight * 0.82, 2200, t => [Math.cos(t * Math.PI * 2) * 30, -28 + Math.sin(t * Math.PI * 4) * 10]),
    // Keyboard players: run forward, swing, jump.
    () => { key('KeyW', 1600); later(() => key('Space', 900), 300); later(() => key('KeyE', 120), 1300); },
  ];
  function startAutoplay() {
    stopAutoplay();
    let step = 0;
    const loop = () => { ACTIONS[step++ % ACTIONS.length](); later(loop, 2500); };
    later(loop, 600);
  }
  function stopAutoplay() {
    autoplayTimers.forEach(clearTimeout);
    autoplayTimers = [];
  }
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.type !== 'playable-autoplay') return;
    if (event.data.on) startAutoplay(); else stopAutoplay();
  });
  // Feed palette: post a 32×12 RGBA band from the top and the bottom of the first screen. The feed
  // keeps the first valid post, so sample fast until one lands, then settle to once a second.
  const BAND = { w: 32, h: 12 };
  const post = (top, bottom) => parent.postMessage({ type: 'playable-palette', top, bottom }, '*');
  /** The game's main canvas: the largest one, if it covers a good part of the screen. */
  function mainCanvas() {
    const canvases = [...document.querySelectorAll('canvas')].filter(c => c.width && c.height);
    const source = canvases.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    return source && source.clientWidth * source.clientHeight >= innerWidth * innerHeight * 0.3 ? source : null;
  }
  function sampleCanvas(source) {
    try {
      const canvas = document.createElement('canvas'); canvas.width = BAND.w; canvas.height = 48;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      // Transparent canvas games paint their scene over a CSS background. Include that visible surface
      // rather than rejecting empty bands and leaving the generic blue/green fallback over dark games.
      for (let node = source; node && node.nodeType === 1; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        const channels = color.match(/[\d.]+/g);
        if (channels && (channels[3] === undefined || Number(channels[3]) > .5)) {
          ctx.fillStyle = color; ctx.fillRect(0,0,BAND.w,48); break;
        }
      }
      ctx.drawImage(source, 0, 0, BAND.w, 48);
      const top = Array.from(ctx.getImageData(0, 0, BAND.w, BAND.h).data);
      const bottom = Array.from(ctx.getImageData(0, 48 - BAND.h, BAND.w, BAND.h).data);
      return top.some((v, i) => i % 4 === 3 && v > 0) ? [top, bottom] : null;
    } catch { return null; }
  }
  /** DOM games: the painted background under a grid of points (images can't be read cross-origin). */
  function sampleDom() {
    const rgba = (el) => {
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const match = getComputedStyle(node).backgroundColor.match(/[\d.]+/g);
        if (match && (match[3] === undefined || Number(match[3]) > 0.5)) return [+match[0], +match[1], +match[2], 255];
      }
      return null;
    };
    const band = (y0) => {
      const out = [];
      for (let row = 0; row < BAND.h; row++) for (let col = 0; col < BAND.w; col++) {
        const x = (col + 0.5) / BAND.w * innerWidth, y = y0 + (row + 0.5) / BAND.h * innerHeight * 0.25;
        out.push(...(rgba(document.elementFromPoint(x, y)) ?? rgba(document.body) ?? rgba(document.documentElement) ?? [0, 0, 0, 0]));
      }
      return out;
    };
    const top = band(0), bottom = band(innerHeight * 0.75);
    return top.some((v, i) => i % 4 === 3 && v > 0) ? [top, bottom] : null;
  }
  let sampledOnce = false;
  function sample() {
    const land = (found) => { if (found) { sampledOnce = true; post(...found); } return !!found; };
    const source = mainCanvas();
    if (!source) { if (document.body?.childElementCount) land(sampleDom()); return; }
    // WebGL may clear after compositing; if the direct read is empty, read inside the next frame.
    if (!land(sampleCanvas(source))) requestAnimationFrame(() => land(sampleCanvas(source)));
  }
  const schedule = () => { sample(); setTimeout(schedule, sampledOnce ? 1000 : 250); };
  // Let the app paint its first screen before reading it.
  if (document.readyState === 'complete') setTimeout(schedule, 300);
  else window.addEventListener('load', () => setTimeout(schedule, 300), { once: true });
})();
