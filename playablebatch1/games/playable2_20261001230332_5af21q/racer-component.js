/* Uses the imported React runtime and the original config / host submission adapters. */
window.createPocketRacerComponent = function (React, JSX, flatten, useSubmission, vibrate) {
  const { useState, useRef, useEffect, useCallback } = React, { jsx, jsxs } = JSX;
  const Racer = window.PocketRacer;
  return function PocketRacerGame() {
    const [config, setConfig] = useState(null), [phase, setPhase] = useState('idle'), [hud, setHud] = useState({ score: 0, speed: 0, elapsed: 0, distance: 0 });
    const [pressed, setPressed] = useState({});
    const canvas = useRef(null), game = useRef(null), images = useRef({}), speedDisplay = useRef(null);
    const inputs = useRef(null), sound = useRef(null), currentConfig = useRef({}), live = useRef(true), actionButton = useRef(null);
    if (!inputs.current) inputs.current = Racer.controls();
    if (!sound.current) sound.current = Racer.audio();
    currentConfig.current = config || {};
    const { canSubmit, submitting, submitRecording } = useSubmission();
    const draw = useCallback(() => {
      const cv = canvas.current; if (!cv) return;
      const W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
      const ctx = cv.getContext('2d', { alpha: false }); if (!ctx) return;
      ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
      Racer.render(ctx, W, H, game.current, images.current, !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      if (speedDisplay.current?.style && game.current) {
        const position = Racer.speedPosition(Racer.view(W, H));
        const meter = speedDisplay.current, half = position.width / 2;
        meter.style.left = 'clamp(calc(var(--race-left) + ' + half + 'px), ' + position.x + 'px, calc(100% - var(--race-right) - ' + half + 'px))';
        // CSS safe-area budget can shorten the dial without touching the driving buttons.
        meter.style.top = position.y + 'px'; meter.style.width = position.width + 'px';
        meter.style.height = 'max(0px, calc(' + position.height + 'px - env(safe-area-inset-bottom)))';
        const ratio = Math.min(2, window.devicePixelRatio || 1), mw = meter.clientWidth || position.width, mh = meter.clientHeight || position.height;
        if (meter.width !== Math.round(mw * ratio) || meter.height !== Math.round(mh * ratio)) { meter.width = Math.round(mw * ratio); meter.height = Math.round(mh * ratio); }
        const mc = meter.getContext?.('2d');
        if (mc) { mc.setTransform(ratio, 0, 0, ratio, 0, 0); Racer.renderMeter(mc, mw, mh, game.current.speed); }
      }
    }, []);
    const clear = useCallback(() => { inputs.current.clear(); if (live.current) setPressed({}); }, []);
    const tick = useCallback(now => {
      const k = game.current, cv = canvas.current;
      if (!live.current || !k || k.ended || k.waiting || !cv) return;
      k.raf = null;
      if (document.hidden) { k.lastTime = null; return; }
      if (!cv.clientWidth || !cv.clientHeight) { k.lastTime = null; k.raf = requestAnimationFrame(tick); return; }
      const dt = k.lastTime === null ? 0 : now - k.lastTime; k.lastTime = now;
      const previousScore = k.score;
      Racer.step(k, dt, inputs.current.held, currentConfig.current, Racer.view(cv.clientWidth, cv.clientHeight), images.current);
      if (k.ended || k.elapsed - k.lastHud >= 100) { setHud(Racer.stats(k)); k.lastHud = k.elapsed; }
      if (!k.ended && Math.floor(k.score / 250) > Math.floor(previousScore / 250)) sound.current.play('score');
      draw();
      if (k.ended) { clear(); setPhase('over'); vibrate('heavy'); sound.current.stopEngine(); sound.current.play('crash'); return; }
      sound.current.drive(k.speed, inputs.current.held);
      k.raf = requestAnimationFrame(tick);
    }, [draw, clear]);
    const start = useCallback(() => {
      // Duplicate start events must not create a second animation loop.
      if (game.current && !game.current.ended && !game.current.waiting) return;
      clear(); sound.current.stop();
      vibrate('light'); game.current = Racer.create(currentConfig.current, performance.now());
      const race = game.current;
      sound.current.unlock().then(() => { if (live.current && !document.hidden && game.current === race && !race.ended && race.raf !== null) sound.current.play('click'); });
      setHud(Racer.stats(race)); setPhase('playing'); draw();
      if (!document.hidden) game.current.raf = requestAnimationFrame(tick);
    }, [clear, draw, tick]);
    const prepare = useCallback(() => {
      const old = game.current;
      if (old?.raf !== null && old?.raf !== undefined) cancelAnimationFrame(old.raf);
      clear(); sound.current.stop();
      game.current = Racer.create(currentConfig.current, performance.now());
      game.current.speed = 0;
      game.current.waiting = true;
      game.current.raf = null;
      setHud(Racer.stats(game.current)); setPhase('idle'); draw();
    }, [clear, draw]);
    useEffect(() => {
      let active = true;
      (async () => {
        let data;
        try { const response = await fetch('./game.config.json', { cache: 'no-store' }); if (response.ok) data = await response.json(); } catch (_) {}
        if (!data) { try { data = JSON.parse(document.getElementById('playable-config-inline').textContent); } catch (_) {} }
        if (active) setConfig(flatten(data || { tweaks: [], texts: [], images: [] }));
      })();
      return () => { active = false; };
    }, []);
    useEffect(() => {
      if (!config) return;
      prepare();
      let active = true;
      const loaded = {};
      for (const key of ['CHAR_PLAYER', 'IMG_TRAFFIC_RED', 'IMG_TRAFFIC_BLUE', 'IMG_TRAFFIC_PURPLE', 'IMG_BACKGROUND', 'IMG_ROADSIDE']) {
        if (!config[key]) continue;
        const image = new Image(); loaded[key] = image;
        image.onload = () => { if (active) draw(); };
        image.onerror = () => { if (active) draw(); };
        image.src = config[key];
      }
      images.current = loaded; draw();
      return () => { active = false; Object.values(loaded).forEach(image => { image.onload = null; image.onerror = null; }); };
    }, [config, draw, prepare]);
    useEffect(() => {
      const resize = () => {
        const cv = canvas.current; if (!cv) return;
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        cv.width = Math.max(1, Math.round(cv.clientWidth * ratio)); cv.height = Math.max(1, Math.round(cv.clientHeight * ratio)); draw();
      };
      resize(); window.addEventListener('resize', resize);
      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
      if (canvas.current) observer?.observe(canvas.current);
      return () => { observer?.disconnect(); window.removeEventListener('resize', resize); };
    }, [config, draw]);
    useEffect(() => { if (phase === 'over') actionButton.current?.focus({ preventScroll: true }); }, [phase]);
    useEffect(() => {
      live.current = true;
      const keyActions = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'accelerate', w: 'accelerate', arrowdown: 'brake', s: 'brake' };
      const down = event => {
        if (!game.current || game.current.ended || event.altKey || event.metaKey || event.ctrlKey) return;
        const key = event.key.toLowerCase(), action = keyActions[key];
        if (action) { event.preventDefault(); if(game.current.waiting)start(); sound.current.unlock(); setPressed({ ...inputs.current.key(key, action, true) }); }
      };
      const up = event => {
        const key = event.key.toLowerCase(), action = keyActions[key];
        if (action) setPressed({ ...inputs.current.key(key, action, false) });
      };
      const pause = () => {
        clear(); sound.current.stop();
        const k = game.current; if (k) { if (k.raf !== null) cancelAnimationFrame(k.raf); k.raf = null; k.lastTime = null; }
      };
      const resume = () => {
        const k = game.current;
        if (k && !k.ended && !k.waiting && k.raf === null && !document.hidden && live.current) { k.lastTime = null; k.raf = requestAnimationFrame(tick); }
      };
      const visibility = () => { if (document.hidden) pause(); else resume(); };
      window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', clear);
      window.addEventListener('pagehide', pause); window.addEventListener('pageshow', resume); document.addEventListener('visibilitychange', visibility);
      return () => {
        live.current = false; pause(); sound.current.dispose();
        window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear);
        window.removeEventListener('pagehide', pause); window.removeEventListener('pageshow', resume); document.removeEventListener('visibilitychange', visibility);
      };
    }, [tick, clear, start]);
    function pointer(action, down, event) {
      if (!game.current || game.current.ended) return;
      if(down && game.current.waiting)start();
      // Every pointer owns its action, including non-primary touches (steer + gas).
      const id = event.pointerId ?? 'mouse';
      if (down) { event.preventDefault(); sound.current.unlock(); try { event.currentTarget.setPointerCapture(id); } catch (_) {} }
      setPressed({ ...inputs.current.pointer(id, action, down) });
      if (!down) { try { if (event.currentTarget.hasPointerCapture?.(id)) event.currentTarget.releasePointerCapture(id); } catch (_) {} }
    }
    function control(action, label, icon) {
      return jsx('button', { type: 'button', className: 'drive-button ' + action + (pressed[action] ? ' active' : ''),
        'aria-label': label, 'aria-pressed': !!pressed[action],
        onPointerDown: e => pointer(action, true, e), onPointerUp: e => pointer(action, false, e),
        onPointerCancel: e => pointer(action, false, e), onLostPointerCapture: e => pointer(action, false, e),
        // Native keyboard activation gives a short hold, while arrows/WASD support continuous driving.
        onKeyDown: e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if(game.current?.waiting)start(); sound.current.unlock(); setPressed({ ...inputs.current.key('button:' + action, action, true) }); } },
        onKeyUp: e => { if (e.key === ' ' || e.key === 'Enter') setPressed({ ...inputs.current.key('button:' + action, action, false) }); },
        onBlur: () => setPressed({ ...inputs.current.key('button:' + action, action, false) }),
        children: icon ? jsx('svg', { width: 24, height: 24, viewBox: '0 0 24 24', 'aria-hidden': true,
          children: jsx('path', { d: action === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7', fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }) }) : label });
    }
    if (!config) return jsx('div', { className: 'racer-loading', role: 'status', children: 'Loading…' });
    return jsxs('div', { className: 'racer', children: [
      jsx('canvas', { ref: canvas, className: 'race-canvas', 'aria-label': 'Road with a rear-view car and approaching traffic' }),
      phase !== 'over' && jsxs('div', { className: 'race-hud', children: [
        jsxs('div', { className: 'race-hud-top', children: [
          jsxs('div', { className: 'race-points', 'aria-label': hud.score + ' points', children: [
            jsx('span', { className: 'race-number', children: hud.score.toLocaleString('en') }), jsx('span', { className: 'race-unit', children: 'pts' })
          ] }),
          jsx('div', { className: 'race-time race-number', 'aria-label': 'Elapsed time ' + Racer.formatTime(hud.elapsed), children: Racer.formatTime(hud.elapsed) })
        ] })
      ] }),
      phase !== 'over' && jsx('canvas', { ref: speedDisplay, className: 'race-speed', role: 'img', 'aria-label': 'Speedometer: ' + hud.speed + ' kilometres per hour; scale 0 to 240' }),
      phase !== 'over' && jsxs('div', { className: 'drive-controls', role: 'group', 'aria-label': 'Driving controls', children: [
        control('left', 'Steer left', true), control('right', 'Steer right', true), control('accelerate', 'Accel'), control('brake', 'Brake')
      ] }),
      phase === 'idle' && jsx('p', { className: 'race-instruction feed-first-action', style:{position:'absolute',top:'18%',left:30,right:30,margin:0,textAlign:'center',pointerEvents:'none'}, children: 'Hold Accel to start · steer to dodge traffic.' }),
      phase === 'over' && jsxs('div', { className: 'race-overlay', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'crash-heading', children: [
        jsx('h2', { id: 'crash-heading', className: 'race-result', children: 'Crash' }),
        jsxs('p', { className: 'race-distance', children: [hud.score.toLocaleString('en'), jsx('span', { className: 'race-unit', children: ' pts' })] }),
        jsxs('div', { className: 'race-summary', children: [
          jsx('span', { 'aria-label': 'Final time ' + Racer.formatTime(hud.elapsed), children: Racer.formatTime(hud.elapsed) }),
          jsx('span', { 'aria-label': 'Distance ' + Math.round(hud.distance) + ' metres', children: Math.round(hud.distance).toLocaleString('en') + ' m' })
        ] }),
        jsxs('div', { className: 'race-actions', children: [
          jsx('button', { ref: actionButton, type: 'button', className: 'race-action', onClick: prepare, children: config.BTN_RESTART || 'Play Again' }),
          canSubmit && jsx('button', { type: 'button', className: 'race-action secondary', disabled: submitting, onClick: submitRecording, children: config.TXT_POST || 'Post My Play' })
        ] })
      ] })
    ] });
  };
};
