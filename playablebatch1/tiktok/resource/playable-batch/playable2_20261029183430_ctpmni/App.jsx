import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const SOUND_FILES = {
  ui: './assets/sfx_ui.mp3',
  light: './assets/sfx_light_hit.mp3',
  heavy: './assets/sfx_heavy_hit.mp3',
  tech: './assets/sfx_tech_hit.mp3',
  boom: './assets/sfx_boom_hit.mp3',
  clear: './assets/sfx_clear.mp3'
};

const FALLBACK_CFG = {
  BASE_HEALTH: 1000000, HEALTH_MULTIPLIER: 4, LEVEL_REWARD: 1000,
  AUTO_COST: 10000, ADMIN_DAMAGE: 15000000, AUTO_INTERVAL: 760,
  GAME_TITLE: 'STICKMAN CLICKER PRO', GUIDE: 'Tap to hit and upgrade', HEALTH_LABEL: 'HP',
  LEVEL_LABEL: 'LEVEL', COINS_LABEL: 'COINS', STORE_LABEL: 'ARSENAL', EQUIPPED: 'EQUIPPED',
  OWNED: 'OWNED', UNAFFORDABLE: 'LOCKED', FREE: 'FREE', AUTO_NAME: 'AUTO', AUTO_ON: 'ON',
  AUTO_OFF: 'OFF', ADMIN_NAME: 'ADMIN HAMMER', CLEARED: 'CLEARED', REWARD: 'BONUS', NEED_MORE: 'Need more coins',
  tools: [
    { id: 'fist', name: 'FIST', damage: 1, price: 0, sound: 'light', accent: '#334155' },
    { id: 'bat', name: 'WOODEN BAT', damage: 3, price: 50, sound: 'light', accent: '#b87537' },
    { id: 'katana', name: 'KATANA', damage: 8, price: 200, sound: 'tech', accent: '#56b4d3' },
    { id: 'sledge', name: 'SLEDGEHAMMER', damage: 20, price: 600, sound: 'heavy', accent: '#e26d5a' },
    { id: 'laser', name: 'LASER SWORD', damage: 50, price: 1500, sound: 'tech', accent: '#ef476f' },
    { id: 'chainsaw', name: 'CHAINSAW', damage: 150, price: 5000, sound: 'heavy', accent: '#f59e0b' },
    { id: 'rocket', name: 'ROCKET', damage: 400, price: 15000, sound: 'boom', accent: '#fb7185' },
    { id: 'axe', name: 'FIRE AXE', damage: 1200, price: 50000, sound: 'heavy', accent: '#ef4444' },
    { id: 'bomb', name: 'BOMB', damage: 3500, price: 150000, sound: 'boom', accent: '#7c3aed' },
    { id: 'ufo', name: 'UFO BLASTER', damage: 10000, price: 500000, sound: 'tech', accent: '#22c55e' },
    { id: 'comet', name: 'COMET', damage: 30000, price: 2000000, sound: 'boom', accent: '#06b6d4' },
    { id: 'atomic', name: 'ATOMIC BOMB', damage: 100000, price: 10000000, sound: 'boom', accent: '#f97316' },
    { id: 'plasma', name: 'PLASMA CANNON', damage: 300000, price: 50000000, sound: 'tech', accent: '#a855f7' },
    { id: 'blackhole', name: 'BLACK HOLE', damage: 1000000, price: 250000000, sound: 'boom', accent: '#111827' },
    { id: 'galaxy', name: 'GALAXY', damage: 3000000, price: 1000000000, sound: 'boom', accent: '#2563eb' }
  ]
};

const feedSession = (() => {
  const embedded = window.parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !embedded;
  const listeners = new Set();
  const update = () => {
    document.documentElement.dataset.feedPreview = String(!active);
    for (const listener of listeners) listener(active && !document.hidden);
  };
  window.addEventListener('message', event => {
    if (!embedded || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
    update();
  });
  document.addEventListener('visibilitychange', update);
  update();
  return { get active() { return active && !document.hidden; }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
})();


function flattenConfig(raw) {
  const next = { ...FALLBACK_CFG };
  (raw?.tweaks || []).forEach(item => { next[item.id] = item.value; });
  (raw?.texts || []).forEach(item => { next[item.id] = item.value; });
  (raw?.images || []).forEach(item => { if (typeof item.path === 'string') next[item.id] = item.path; });
  if (Array.isArray(raw?.tools) && raw.tools.length) next.tools = raw.tools;
  return next;
}

function formatNumber(value) {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

function formatShort(value) {
  if (value >= 1000000000) return `${(value / 1000000000).toFixed(value % 1000000000 ? 1 : 0)}B`;
  if (value >= 1000000) return `${(value / 1000000).toFixed(value % 1000000 ? 1 : 0)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 ? 1 : 0)}K`;
  return String(value);
}

function makeInitialGame(cfg) {
  return {
    level: 1,
    health: cfg.BASE_HEALTH,
    coins: 0,
    equipped: 'fist',
    owned: ['fist', 'admin'],
    autoPurchased: false,
    autoActive: false,
    hits: 0,
    defeated: false,
    reward: 0
  };
}

function vibrate(style = 'light') {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style });
  } catch (e) { /* optional host haptics */ }
}

function Icon({ type }) {
  if (type === 'coin') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5c.8-1.5 4.2-1.5 5 0 .8 1.6-1.1 2.1-2.5 2.5s-3.3.9-2.5 2.5c.8 1.5 4.2 1.5 5 0"/></svg>;
  if (type === 'bolt') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 5 13h6l-1 9 8.5-12h-6z"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="8"/></svg>;
}

function StickFigure({ hit, defeated }) {
  return (
    <svg className={`stick-figure ${hit ? 'is-hit' : ''} ${defeated ? 'is-defeated' : ''}`} viewBox="0 0 220 330" role="img" aria-label="Stickman target">
      <g className="figure-shadow"><ellipse cx="110" cy="305" rx="54" ry="10" /></g>
      <g className="figure-ink">
        <circle className="head" cx="110" cy="66" r="39" />
        <path className="face-eye" d="M94 62h2M124 62h2" />
        <path className="face-mouth" d={hit ? 'M99 84q11-12 22 0' : 'M99 84q11 8 22 0'} />
        <path className="body" d="M110 105v105" />
        <path className="limb arm-left" d="M108 125 61 170" />
        <path className="limb arm-right" d="M112 125 160 170" />
        <path className="limb leg-left" d="M110 210 67 286" />
        <path className="limb leg-right" d="M110 210 153 286" />
        <path className="foot" d="M67 286h-23M153 286h23" />
      </g>
      {defeated && <g className="dizzy"><path d="M77 35l8 8m0-8-8 8M135 35l8 8m0-8-8 8" /></g>}
    </svg>
  );
}

function ToolGlyph({ id, color }) {
  const common = { stroke: color, strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };
  if (id === 'fist') return <svg viewBox="0 0 60 60"><path {...common} d="M19 35V21c0-4 5-4 5 0v8-13c0-4 5-4 5 0v12-15c0-4 5-4 5 0v15-11c0-4 5-4 5 0v15l5-5c3-3 7 1 4 4l-9 11c-3 4-7 6-13 4l-7-3c-4-2-5-5-5-8Z"/></svg>;
  if (id === 'bat') return <svg viewBox="0 0 60 60"><path {...common} d="m17 47 17-17M27 37 18 28c-3-3-1-7 3-6l16 4c6 2 8 8 3 12l-6 5"/><path {...common} d="m38 13 9 9"/></svg>;
  if (id === 'katana' || id === 'laser') return <svg viewBox="0 0 60 60"><path {...common} d="m13 45 31-31 5 5-31 31zM11 48h13M15 42l6 6"/><path {...common} d="M39 18 47 26"/></svg>;
  if (id === 'sledge' || id === 'axe') return <svg viewBox="0 0 60 60"><path {...common} d="M17 47 40 24M34 10h17v12H34zM39 10v12"/></svg>;
  if (id === 'rocket' || id === 'comet') return <svg viewBox="0 0 60 60"><path {...common} d="M42 10c-12 1-22 11-22 23l7 7c12 0 22-10 23-22zM21 33l-8 8M27 40l-2 9M19 31l-8 1"/><circle {...common} cx="37" cy="22" r="4"/></svg>;
  if (id === 'ufo') return <svg viewBox="0 0 60 60"><path {...common} d="M8 35c2-9 42-9 44 0-4 11-40 11-44 0Z"/><path {...common} d="M22 28c1-13 15-13 16 0M15 43l-4 7M30 44v8M45 43l4 7"/></svg>;
  if (id === 'blackhole' || id === 'galaxy') return <svg viewBox="0 0 60 60"><circle {...common} cx="30" cy="30" r="17"/><circle cx="30" cy="30" r="8" fill={color}/><path {...common} d="M8 25c9-14 30-20 44-9M12 43c12 8 28 7 39-3"/></svg>;
  return <svg viewBox="0 0 60 60"><circle {...common} cx="30" cy="30" r="16"/><path {...common} d="M30 14v32M14 30h32M19 19l22 22M41 19 19 41"/></svg>;
}

function ArsenalGlyph({ id, color, config }) {
  const src = config['TOOL_' + id.toUpperCase()];
  const [failedSrc, setFailedSrc] = useState(null);
  if (src && failedSrc !== src) {
    return <img src={src} alt="" draggable={false} onError={() => setFailedSrc(src)} />;
  }
  return id === 'auto' ? <Icon type="bolt" /> : <ToolGlyph id={id === 'admin' ? 'sledge' : id} color={color} />;
}

function aimStrike(arena, event) {
  const figure = arena.querySelector('.stick-figure');
  const matrix = figure?.getScreenCTM();
  if (!matrix) return null;
  const bounds = arena.getBoundingClientRect();
  const project = (x, y) => ({
    x: matrix.a * x + matrix.c * y + matrix.e - bounds.left,
    y: matrix.b * x + matrix.d * y + matrix.f - bounds.top
  });
  const torso = project(110, 146);
  if (!event || (event.detail === 0 && !event.nativeEvent?.pointerType)) {
    return { origin: { x: Math.min(torso.x + 74, bounds.width - 20), y: torso.y - 15 }, target: torso };
  }

  const origin = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  const center = project(110, 66);
  const headRadius = 32 * Math.min(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
  const dx = origin.x - center.x;
  const dy = origin.y - center.y;
  const headFraction = Math.min(1, headRadius / (Math.hypot(dx, dy) || 1));
  let target = { x: center.x + dx * headFraction, y: center.y + dy * headFraction };
  let bestDistance = Math.hypot(origin.x - target.x, origin.y - target.y);

  // Use the SVG viewport and the resting paths. Each new hit restarts the
  // squash from that pose, even when the previous hit is still animating.
  for (const path of figure.querySelectorAll('.body, .limb')) {
    const start = path.getPointAtLength(0);
    const end = path.getPointAtLength(path.getTotalLength());
    const a = project(start.x, start.y);
    const b = project(end.x, end.y);
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const lengthSquared = vx * vx + vy * vy;
    if (lengthSquared === 0) continue;
    const along = ((origin.x - a.x) * vx + (origin.y - a.y) * vy) / lengthSquared;
    const fraction = Math.max(0, Math.min(1, along));
    const point = { x: a.x + vx * fraction, y: a.y + vy * fraction };
    const distance = Math.hypot(origin.x - point.x, origin.y - point.y);
    if (distance < bestDistance) {
      target = point;
      bestDistance = distance;
    }
  }
  return { origin, target };
}

function App() {
  const [cfg, setCfg] = useState(FALLBACK_CFG);
  const [ready, setReady] = useState(false);
  const [game, setGame] = useState(() => makeInitialGame(FALLBACK_CFG));
  const [guideVisible, setGuideVisible] = useState(true);
  const [effects, setEffects] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [hitPulse, setHitPulse] = useState(0);
  const [clearPulse, setClearPulse] = useState(0);
  const arenaRef = useRef(null);
  const gameRef = useRef(game);
  const sessionStarted = useRef(false);
  const reactionTimer = useRef(null);
  const [reacting, setReacting] = useState(false);
  const cfgRef = useRef(cfg);
  const levelTimer = useRef(null);
  const feedbackTimer = useRef(null);
  const audioRef = useRef({ ctx: null, gain: null, buffers: {}, loading: {}, sources: new Set() });

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);

  useEffect(() => {
    let alive = true;
    fetch('./game.config.json')
      .then(response => response.json())
      .then(raw => {
        if (!alive) return;
        const loaded = flattenConfig(raw);
        setCfg(loaded);
        cfgRef.current = loaded;
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem('stickman-clicker-save') || 'null'); } catch (e) { saved = null; }
        const initial = makeInitialGame(loaded);
        if (saved && typeof saved === 'object') {
          const owned = Array.isArray(saved.owned) ? Array.from(new Set(['fist', 'admin', ...saved.owned])) : initial.owned;
          const equipped = loaded.tools.some(tool => tool.id === saved.equipped) || saved.equipped === 'admin' ? saved.equipped : 'fist';
          initial.level = Math.max(1, Number(saved.level) || 1);
          initial.health = Math.max(0, Number(saved.health) || loaded.BASE_HEALTH * Math.pow(loaded.HEALTH_MULTIPLIER, initial.level - 1));
          initial.coins = Math.max(0, Number(saved.coins) || 0);
          initial.owned = owned;
          initial.equipped = equipped;
          initial.autoPurchased = Boolean(saved.autoPurchased);
          initial.autoActive = Boolean(saved.autoPurchased && saved.autoActive);
          initial.hits = Math.max(0, Number(saved.hits) || 0);
        }
        gameRef.current = initial;
        setGame(initial);
        setReady(true);
      })
      .catch(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem('stickman-clicker-save', JSON.stringify({
        level: game.level, health: game.health, coins: game.coins, equipped: game.equipped,
        owned: game.owned, autoPurchased: game.autoPurchased, autoActive: game.autoActive, hits: game.hits
      }));
    } catch (e) { /* storage is optional */ }
  }, [game, ready]);

  const unlockAudio = useCallback(() => {
    if (!feedSession.active) return audioRef.current;
    try {
      const holder = audioRef.current;
      if (!holder.ctx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return holder;
        holder.ctx = new AudioContextClass();
        holder.gain = holder.ctx.createGain();
        holder.gain.gain.value = 0.18;
        holder.gain.connect(holder.ctx.destination);
      }
      if (holder.ctx.state === 'suspended') holder.ctx.resume();
    } catch (e) { /* audio enhancement is optional */ }
    return audioRef.current;
  }, []);

  const playSound = useCallback((name) => {
    if (!feedSession.active) return;
    const holder = unlockAudio();
    if (!holder.ctx) return;
    if (!holder.loading[name] && !holder.buffers[name]) {
      holder.loading[name] = fetch(SOUND_FILES[name])
        .then(response => response.arrayBuffer())
        .then(data => holder.ctx.decodeAudioData(data))
        .then(buffer => { holder.buffers[name] = buffer; return buffer; })
        .catch(() => null);
    }
    const pending = holder.loading[name] || Promise.resolve(holder.buffers[name]);
    pending.then(buffer => {
      if (!buffer || !holder.ctx || holder.ctx.state !== 'running' || !feedSession.active) return;
      try {
        const source = holder.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(holder.gain);
        holder.sources.add(source);
        source.onended = () => holder.sources.delete(source);
        source.start(0);
      } catch (e) { /* skip a failed cue */ }
    });
  }, [unlockAudio]);

  const showFeedback = useCallback((message) => {
    setFeedback(message);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(''), 1100);
  }, []);

  const createImpact = useCallback((tool, damage, strike) => {
    const token = Date.now() + Math.random();
    const sparks = Array.from({ length: tool.id === 'admin' ? 16 : 9 }, (_, index) => ({
      id: `${token}-${index}`,
      angle: Math.round((360 / (tool.id === 'admin' ? 16 : 9)) * index + Math.random() * 18),
      distance: 40 + Math.random() * 70,
      size: 4 + Math.random() * 6
    }));
    setEffects(prev => [...prev.slice(-3), { id: token, damage, tool, sparks, ...strike }]);
    setHitPulse(token);
    setReacting(true);
    clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => setReacting(false), 330);
    setTimeout(() => setEffects(prev => prev.filter(item => item.id !== token)), 780);
  }, []);

  const attack = useCallback((event) => {
    if (!feedSession.active) return;
    const current = gameRef.current;
    const currentCfg = cfgRef.current;
    if (current.defeated || !arenaRef.current) return;
    const strike = aimStrike(arenaRef.current, event);
    if (!strike) return;
    sessionStarted.current = true;
    unlockAudio();
    const tool = current.equipped === 'admin'
      ? { id: 'admin', name: currentCfg.ADMIN_NAME, damage: currentCfg.ADMIN_DAMAGE, sound: 'boom', accent: '#f43f5e' }
      : currentCfg.tools.find(item => item.id === current.equipped) || currentCfg.tools[0];
    const damage = Number(tool.damage) || 1;
    const nextHealth = Math.max(0, current.health - damage);
    const didDefeat = nextHealth === 0;
    const reward = didDefeat ? currentCfg.LEVEL_REWARD * current.level : 0;
    const next = {
      ...current,
      health: nextHealth,
      coins: current.coins + damage + reward,
      hits: current.hits + 1,
      defeated: didDefeat,
      reward
    };
    gameRef.current = next;
    setGame(next);
    setGuideVisible(false);
    createImpact(tool, damage, strike);
    playSound(didDefeat ? 'clear' : (tool.sound || 'light'));
    vibrate(didDefeat ? 'notification_success' : 'light');
    if (didDefeat) {
      setClearPulse(Date.now());
      if (levelTimer.current) clearTimeout(levelTimer.current);
      levelTimer.current = setTimeout(() => {
        const after = gameRef.current;
        const advanced = {
          ...after,
          level: after.level + 1,
          health: currentCfg.BASE_HEALTH * Math.pow(currentCfg.HEALTH_MULTIPLIER, after.level),
          defeated: false,
          reward: 0
        };
        gameRef.current = advanced;
        setGame(advanced);
      }, 620);
    }
  }, [createImpact, playSound, unlockAudio]);

  useEffect(() => {
    if (!game.autoActive || !game.autoPurchased) return undefined;
    const id = setInterval(() => {
      if (sessionStarted.current && feedSession.active) attack();
    }, Math.max(300, Number(cfg.AUTO_INTERVAL) || 760));
    return () => clearInterval(id);
  }, [attack, cfg.AUTO_INTERVAL, game.autoActive, game.autoPurchased]);

  useEffect(() => feedSession.subscribe(active => {
    if (active) return;
    for (const source of audioRef.current.sources) {
      try { source.stop(); } catch { /* The cue may already have ended. */ }
    }
  }), []);

  useEffect(() => () => {
    clearTimeout(reactionTimer.current);
    if (levelTimer.current) clearTimeout(levelTimer.current);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    audioRef.current.sources.forEach(source => { try { source.stop(); } catch (e) {} });
    if (audioRef.current.ctx) { try { audioRef.current.ctx.close(); } catch (e) {} }
  }, []);

  const toolMap = useMemo(() => Object.fromEntries(cfg.tools.map(tool => [tool.id, tool])), [cfg.tools]);
  const currentTool = game.equipped === 'admin'
    ? { id: 'admin', name: cfg.ADMIN_NAME, damage: cfg.ADMIN_DAMAGE, price: 0, accent: '#f43f5e', sound: 'boom' }
    : (toolMap[game.equipped] || cfg.tools[0]);
  const maxHealth = cfg.BASE_HEALTH * Math.pow(cfg.HEALTH_MULTIPLIER, game.level - 1);
  const healthRatio = maxHealth ? Math.max(0, Math.min(1, game.health / maxHealth)) : 0;
  const hasInteracted = game.hits > 0;
  const latestStrike = effects[effects.length - 1];

  function handleTool(tool) {
    unlockAudio();
    if (game.owned.includes(tool.id)) {
      if (game.equipped === tool.id) return;
      const next = { ...game, equipped: tool.id };
      gameRef.current = next;
      setGame(next);
      playSound('ui');
      vibrate('light');
      showFeedback(tool.name);
      return;
    }
    if (game.coins >= tool.price) {
      const next = { ...game, coins: game.coins - tool.price, equipped: tool.id, owned: [...game.owned, tool.id] };
      gameRef.current = next;
      setGame(next);
      playSound('ui');
      vibrate('medium');
      showFeedback(tool.name);
    } else {
      vibrate('notification_error');
      showFeedback(cfg.NEED_MORE);
    }
  }

  function handleAuto() {
    unlockAudio();
    if (!game.autoPurchased) {
      if (game.coins < cfg.AUTO_COST) {
        vibrate('notification_error');
        showFeedback(cfg.NEED_MORE);
        return;
      }
      const next = { ...game, coins: game.coins - cfg.AUTO_COST, autoPurchased: true, autoActive: true };
      gameRef.current = next;
      setGame(next);
      playSound('ui');
      vibrate('medium');
      showFeedback(cfg.AUTO_NAME);
      return;
    }
    const next = { ...game, autoActive: !game.autoActive };
    gameRef.current = next;
    setGame(next);
    playSound('ui');
    vibrate('light');
  }

  function handleAdmin() {
    unlockAudio();
    if (game.equipped === 'admin') return;
    const next = { ...game, equipped: 'admin' };
    gameRef.current = next;
    setGame(next);
    playSound('ui');
    vibrate('heavy');
    showFeedback(cfg.ADMIN_NAME);
  }

  return (
    <div className="app-shell">
      <style>{`
        @font-face {
          font-family: 'Bangers';
          src: url('./assets/fonts/bangers/Bangers-Regular.woff2') format('woff2');
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }

        :root {
          --font-display: "Bangers", "PingFang SC", system-ui, sans-serif;
          --font-body:    -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
          --font-mono:    ui-monospace, Menlo, monospace;
        }

        * { box-sizing: border-box; }
        button { font: inherit; }
        .app-shell { width: 100%; height: 100%; min-height: 0; overflow: clip; position: relative; color: #18202b; background: #e7eaee; font-family: var(--font-body); user-select: none; -webkit-user-select: none; }
        .room { position: absolute; inset: 0; overflow: hidden; background: radial-gradient(ellipse at 50% 38%, #fff 0%, #f1f3f5 38%, #d8dde3 100%); }
        .room::before { content: ''; position: absolute; inset: 0; opacity: .38; background: linear-gradient(90deg, transparent 0 49.7%, rgba(99,110,123,.16) 50%, transparent 50.3%), linear-gradient(0deg, transparent 0 62%, rgba(255,255,255,.8) 62.2%, transparent 62.5%); pointer-events: none; }
        .room::after { content: ''; position: absolute; left: -20%; right: -20%; bottom: -15%; height: 57%; transform: perspective(420px) rotateX(57deg); transform-origin: bottom; opacity: .45; background: repeating-linear-gradient(90deg, rgba(110,120,132,.13) 0 1px, transparent 1px 54px), repeating-linear-gradient(0deg, rgba(110,120,132,.14) 0 1px, transparent 1px 34px); pointer-events: none; }
        .shell-content { position: relative; z-index: 2; height: 100%; min-height: 0; display: flex; flex-direction: column; }
        .topbar { flex: 0 0 auto; min-height: 76px; display: grid; place-items: end center; padding: 12px 18px 4px; }
        .stat { visibility: hidden; text-align: center; pointer-events: none; }
        .stat.visible { visibility: visible; }
        .stat-label, .stat-value { display: block; font-family: var(--font-display); }
        .stat-label { font-size: 11px; line-height: 1.3; letter-spacing: .02em; color: #697586; }
        .stat-value { font-size: 28px; line-height: 1.15; color: #252627; font-variant-numeric: tabular-nums; }
        .main-zone { flex: 1 1 auto; min-height: 0; position: relative; display: flex; flex-direction: column; }
        .hint { flex: 0 0 auto; min-height: 26px; padding: 0 18px; text-align: center; font-family: var(--font-display); letter-spacing: .7px; font-size: clamp(16px, 4.7vw, 20px); line-height: 1.25; color: #526171; opacity: 0; pointer-events: none; }
        .hint.visible { opacity: .92; transform: translateY(0); animation: breathe 1.8s ease-in-out infinite; }
        @keyframes breathe { 50% { opacity: .46; } }
        .arena { flex: 1 1 auto; min-height: 0; position: relative; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); place-items: center; overflow: hidden; cursor: pointer; touch-action: manipulation; }
        .arena::before { content: ''; position: absolute; width: min(340px, 76%); height: min(280px, 62%); border-radius: 50%; background: radial-gradient(ellipse, rgba(63,73,86,.19) 0%, rgba(63,73,86,.07) 42%, transparent 71%); transform: translateY(34%); filter: blur(5px); }
        .character-slot { position: relative; z-index: 2; display: grid; grid-template-rows: auto minmax(0, 1fr); width: min(260px, 76%); height: min(350px, 100%); }
        .figure-button { width: 100%; height: 100%; min-height: 0; border: 0; background: transparent; padding: 0; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); place-items: center; cursor: pointer; touch-action: manipulation; transition: transform .14s ease; }
        .figure-button:active { transform: scale(.97); }
        .stick-figure { display: block; width: 100%; height: 100%; min-height: 0; overflow: visible; }
        .figure-ink { transform-origin: 110px 180px; transition: transform .12s ease; }
        .stick-figure.is-hit .figure-ink { animation: squash .235s ease-out .095s; }
        .stick-figure.is-defeated .figure-ink { animation: flop .525s ease-in .095s forwards; }
        .figure-shadow { fill: rgba(49,58,68,.2); }
        .figure-ink { fill: none; stroke: #101820; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }
        .figure-ink .head { fill: rgba(255,255,255,.72); stroke: #101820; }
        .face-eye, .face-mouth { stroke-width: 5; }
        .face-mouth { transition: d .1s; }
        .dizzy { fill: none; stroke: #ef476f; stroke-width: 5; stroke-linecap: round; animation: floatDizzy .525s ease-out .095s both; }
        @keyframes squash { 0% { transform: scale(1,1); } 32% { transform: scale(1.12,.84) translateY(9px); } 100% { transform: scale(1,1); } }
        @keyframes flop { 0% { transform: rotate(0deg) translateY(0); } 80% { transform: rotate(17deg) translateY(12px); } 100% { transform: rotate(22deg) translateY(20px); opacity: .4; } }
        @keyframes floatDizzy { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(-6px); } }
        .tool-swing, .strike-weapon { position: absolute; z-index: 3; width: 68px; height: 68px; pointer-events: none; filter: drop-shadow(2px 3px 0 rgba(42,50,60,.12)); }
        :is(.tool-swing,.strike-weapon) :is(img,svg) { display: block; width: 100%; height: 100%; object-fit: contain; }
        .tool-swing { --preview-reach: min(74px, 24vw); left: calc(50% + var(--preview-reach)); top: 48%; visibility: hidden; }
        .strike-weapon { transform: translate(-50%, -50%); animation: strikeWeapon .285s ease-out forwards; }
        @keyframes strikeWeapon {
          0% { opacity: 1; transform: translate(-50%, -50%) rotate(-19deg); }
          33.333% { opacity: 1; transform: translate(calc(-50% + var(--strike-dx)), calc(-50% + var(--strike-dy))) rotate(15deg); }
          100% { opacity: 0; transform: translate(calc(-50% + var(--strike-dx)), calc(-50% + var(--strike-dy))) rotate(24deg); }
        }
        html[data-feed-preview="true"] .topbar { flex-basis: 18vh; }
        html[data-feed-preview="true"] :is(.character-level,.health-dock) { display: none; }
        html[data-feed-preview="true"] .character-slot { grid-template-rows: minmax(0, 1fr); height: min(350px, 88%); }
        html[data-feed-preview="true"] :is(.coin-stat,.store,.impact,.strike-weapon) { visibility: hidden; }
        html[data-feed-preview="true"] .hint { opacity: .92; transform: none; animation: breathe 1.8s ease-in-out infinite; }
        html[data-feed-preview="true"] .tool-swing { animation: previewStrike 2.6s ease-out infinite; }
        html[data-feed-preview="true"] .figure-ink { animation: previewHit 2.6s ease-out infinite; }
        @keyframes previewStrike {
          0%, 30%, 65%, 100% { opacity: 0; transform: translate(-50%, -50%) rotate(-19deg); }
          34% { opacity: 1; visibility: visible; transform: translate(-50%, -50%) rotate(-19deg); }
          48%, 56% { opacity: 1; visibility: visible; transform: translate(calc(-50% - var(--preview-reach)), -50%) rotate(15deg); }
        }
        @keyframes previewHit {
          0%, 43%, 65%, 100% { transform: none; }
          49% { transform: scale(1.1, .87) translateY(8px); }
        }
        @media (prefers-reduced-motion: reduce) {
          html[data-feed-preview="true"] :is(.hint,.figure-ink,.tool-swing) { animation: none; }
          .strike-weapon { animation-name: strikeFade; }
          .stick-figure.is-hit .figure-ink { animation: none; }
        }
        @keyframes strikeFade { 0%, 33% { opacity: 1; } 100% { opacity: 0; } }
        .impact { position: absolute; z-index: 4; pointer-events: none; }
        .impact::before { content: ''; position: absolute; inset: -10px; border: 2px solid var(--impact-color); border-radius: 50%; opacity: 0; animation: impactRing .25s ease-out .095s forwards; }
        .damage { position: absolute; left: var(--damage-offset); top: -10px; opacity: 0; white-space: nowrap; font-family: var(--font-display); font-size: clamp(18px, 6vw, 25px); color: var(--impact-color); text-shadow: 2px 2px 0 #fff; animation: damageFloat .68s ease-out .095s forwards; }
        .spark { position: absolute; width: var(--spark-size); height: var(--spark-size); margin: calc(var(--spark-size) / -2); opacity: 0; border-radius: 50%; background: var(--impact-color); box-shadow: 0 0 0 2px rgba(255,255,255,.5); animation: sparkFly .55s cubic-bezier(.2,.8,.2,1) .095s forwards; }
        @keyframes damageFloat { 0% { opacity: 0; transform: translate(-50%, -20% ) scale(.7); } 16% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -170%) scale(1.1); } }
        @keyframes sparkFly { from { opacity: 1; transform: rotate(var(--angle)) translateX(0); } to { opacity: 0; transform: rotate(var(--angle)) translateX(var(--distance)); } }
        @keyframes impactRing { from { opacity: 1; transform: scale(.55); } to { opacity: 0; transform: scale(2); } }
        .health-dock { flex: 0 0 auto; width: min(300px, calc(100% - 48px)); margin: 0 auto; padding: 3px 0 8px; }
        .health-strip.prestart { visibility: hidden; }
        .health-numbers { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 4px; font-family: var(--font-display); color: #556273; font-size: 14px; letter-spacing: .3px; }
        .health-number { color: #202b38; font-size: 17px; overflow-wrap: anywhere; text-align: right; }
        .health-track { height: 11px; padding: 2px; border: 2px solid #202b38; border-radius: 10px; background: rgba(255,255,255,.62); box-shadow: 0 2px 0 rgba(27,38,49,.1); }
        .health-fill { height: 100%; border-radius: 5px; background: linear-gradient(90deg, #ef476f, #ff8a5b); transition: width .2s ease; }
        .feedback-slot { min-height: 22px; text-align: center; font: 16px/22px var(--font-display); color: #334155; overflow-wrap: anywhere; }
        .clear-burst strong { margin-right: 8px; color: #b52e50; }
        .store { flex: 0 0 auto; min-height: 0; padding: 5px 0 max(12px, env(safe-area-inset-bottom, 0px)); background: linear-gradient(180deg, rgba(247,249,250,.16), rgba(222,227,233,.78)); }
        .store-top { height: 21px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; }
        .store-title { font-family: var(--font-display); font-size: 18px; letter-spacing: 1.2px; color: #465363; }
        .store-rule { height: 2px; flex: 1; margin-left: 10px; background: rgba(70,83,99,.22); }
        .cards { display: flex; gap: 9px; overflow-x: auto; overflow-y: hidden; padding: 5px 20px 4px; scrollbar-width: none; -webkit-overflow-scrolling: touch; scroll-snap-type: x proximity; scroll-padding-inline: 20px; }
        .cards::-webkit-scrollbar { display: none; }
        .tool-card { flex: 0 0 112px; display: grid; grid-template-rows: 13px 40px minmax(24px, auto) 15px; gap: 3px; border: 2px solid rgba(33,45,58,.14); border-radius: 14px; background: rgba(255,255,255,.79); box-shadow: 0 3px 0 rgba(46,57,69,.08); padding: 5px 7px 6px; text-align: left; color: #263444; cursor: pointer; transition: transform .12s, border-color .12s, background .12s; scroll-snap-align: start; }
        .tool-card:active { transform: translateY(2px); }
        .tool-card.equipped { border-color: var(--accent); background: rgba(255,255,255,.98); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 24%, transparent), 0 3px 0 rgba(46,57,69,.08); }
        .tool-card.locked { opacity: .72; }
        .tool-card.special { background: linear-gradient(145deg, #fff1f2, #fff); border-color: #f43f5e; }
        .tool-glyph { grid-row: 2; display: grid; place-items: center; }
        .tool-glyph :is(img,svg) { display: block; width: 40px; height: 40px; object-fit: contain; pointer-events: none; }
        .tool-name { grid-row: 3; align-self: center; font: 14px/12px var(--font-display); letter-spacing: .2px; overflow-wrap: anywhere; }
        .tool-detail { grid-row: 4; display: flex; align-items: center; justify-content: space-between; gap: 3px; font: 11px/15px var(--font-mono); color: #687587; }
        .tool-damage { color: var(--accent); font-weight: 800; }
        .tool-price { white-space: nowrap; }
        .status-pill { grid-row: 1; justify-self: end; padding: 0 4px; border-radius: 4px; color: #fff; background: var(--accent); font: 10px/13px var(--font-display); letter-spacing: .2px; }
        .auto-card .tool-glyph svg { stroke: #b77e14; fill: none; stroke-width: 2.5; }
        .auto-switch { grid-row: 3; align-self: center; display: flex; justify-content: space-between; align-items: center; gap: 6px; font: 14px/16px var(--font-display); }
        .switch-dot { width: 30px; height: 17px; border-radius: 10px; background: #c8ced5; position: relative; }
        .switch-dot::after { content: ''; width: 13px; height: 13px; position: absolute; top: 2px; left: 2px; border-radius: 50%; background: #fff; transition: transform .2s; }
        .auto-card.active .switch-dot { background: #55b98a; }
        .auto-card.active .switch-dot::after { transform: translateX(13px); }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
        @media (max-height: 530px) {
          .topbar { min-height: 62px; padding-top: 8px; }
          .stat-value { font-size: 24px; }
          .tool-card { grid-template-rows: 13px 34px minmax(24px, auto) 15px; }
          .tool-glyph :is(img,svg) { width: 34px; height: 34px; }
        }
      `}</style>
      <div className="room" aria-hidden="true" />
      <div className="shell-content">
        <header className="topbar">
          <div className={'stat coin-stat' + (hasInteracted ? ' visible' : '')} aria-live="polite" aria-hidden={!hasInteracted}>
            <span className="stat-label">{cfg.COINS_LABEL}</span>
            <span className="stat-value">{formatShort(game.coins)}</span>
          </div>
        </header>
        <main className="main-zone">
          <div className={`hint ${guideVisible ? 'visible' : ''}`}>{cfg.GUIDE}</div>
          <section ref={arenaRef} className="arena" aria-label="Attack arena" onClick={attack}>
            <div className="character-slot">
              <div className={'stat character-level' + (hasInteracted ? ' visible' : '')} aria-live="polite" aria-hidden={!hasInteracted}>
                <span className="stat-label">{cfg.LEVEL_LABEL}</span>
                <span className="stat-value">{game.level}</span>
              </div>
              <button className="figure-button" aria-label="Tap to hit the stickman">
                <StickFigure key={hitPulse} hit={reacting} defeated={game.defeated} />
              </button>
            </div>
            <div className="tool-swing" aria-hidden="true"><ArsenalGlyph id={currentTool.id} color={currentTool.accent} config={cfg} /></div>
            {latestStrike && <div key={latestStrike.id} className="strike-weapon" aria-hidden="true" style={{
              left: latestStrike.origin.x,
              top: latestStrike.origin.y,
              '--strike-dx': `${latestStrike.target.x - latestStrike.origin.x}px`,
              '--strike-dy': `${latestStrike.target.y - latestStrike.origin.y}px`
            }}>
              <ArsenalGlyph id={latestStrike.tool.id} color={latestStrike.tool.accent} config={cfg} />
            </div>}
            {effects.map((effect, index) => (
              <div className="impact" key={effect.id} aria-hidden="true" style={{
                left: effect.target.x,
                top: effect.target.y,
                '--impact-color': effect.tool.accent || '#ff4d6d',
                '--damage-offset': effect.origin.x < effect.target.x ? '25px' : '-25px'
              }}>
                {index === effects.length - 1 && <div className="damage">-{formatShort(effect.damage)}</div>}
                {effect.sparks.map(spark => <i className="spark" key={spark.id} style={{ '--angle': `${spark.angle}deg`, '--distance': `${spark.distance}px`, '--spark-size': `${spark.size}px` }} />)}
              </div>
            ))}
          </section>
          <div className="health-dock">
            <div className="feedback-slot" role="status">
              {game.defeated && game.reward > 0
                ? <span className="clear-burst" key={clearPulse}><strong>{cfg.CLEARED}</strong>+{formatNumber(game.reward)} {cfg.REWARD}</span>
                : feedback}
            </div>
            <div className={`health-strip ${hasInteracted ? '' : 'prestart'}`}>
              <div className="health-numbers"><span>{cfg.HEALTH_LABEL}</span><span className="health-number">{formatNumber(game.health)} / {formatNumber(maxHealth)}</span></div>
              <div className="health-track"><div className="health-fill" style={{ width: `${healthRatio * 100}%` }} /></div>
            </div>
          </div>
        </main>
        <section className="store" aria-label={cfg.STORE_LABEL}>
          <div className="store-top"><span className="store-title">{cfg.STORE_LABEL}</span><span className="store-rule" /></div>
          <div className="cards">
            {cfg.tools.map(tool => {
              const owned = game.owned.includes(tool.id);
              const equipped = game.equipped === tool.id;
              const affordable = game.coins >= tool.price;
              return <button key={tool.id} className={`tool-card ${equipped ? 'equipped' : ''} ${!owned && !affordable ? 'locked' : ''}`} style={{ '--accent': tool.accent }} onClick={() => handleTool(tool)} aria-label={`${tool.name}, damage ${tool.damage}, price ${tool.price}`}>
                {equipped && <span className="status-pill">{cfg.EQUIPPED}</span>}
                {!equipped && owned && <span className="status-pill">{cfg.OWNED}</span>}
                <span className="tool-glyph"><ArsenalGlyph id={tool.id} color={tool.accent} config={cfg} /></span>
                <span className="tool-name">{tool.name}</span>
                <span className="tool-detail"><b className="tool-damage">{formatShort(tool.damage)}</b><span className="tool-price">{tool.price === 0 ? cfg.FREE : formatShort(tool.price)}</span></span>
              </button>;
            })}
            <button className={`tool-card special ${game.equipped === 'admin' ? 'equipped' : ''}`} style={{ '--accent': '#f43f5e' }} onClick={handleAdmin} aria-label={`${cfg.ADMIN_NAME}, damage ${cfg.ADMIN_DAMAGE}`}>
              {game.equipped === 'admin' && <span className="status-pill">{cfg.EQUIPPED}</span>}
              <span className="tool-glyph"><ArsenalGlyph id="admin" color="#f43f5e" config={cfg} /></span>
              <span className="tool-name">{cfg.ADMIN_NAME}</span>
              <span className="tool-detail"><b className="tool-damage">{formatShort(cfg.ADMIN_DAMAGE)}</b><span className="tool-price">{cfg.FREE}</span></span>
            </button>
            <button className={`tool-card auto-card ${game.autoActive ? 'active' : ''} ${!game.autoPurchased && game.coins < cfg.AUTO_COST ? 'locked' : ''}`} style={{ '--accent': '#d79a14' }} onClick={handleAuto} aria-label={`${cfg.AUTO_NAME}, ${game.autoPurchased ? cfg.AUTO_OFF : formatNumber(cfg.AUTO_COST)}`}>
              <span className="tool-glyph"><ArsenalGlyph id="auto" config={cfg} /></span>
              <span className="auto-switch"><b>{cfg.AUTO_NAME}</b><i className="switch-dot" /></span>
              <span className="tool-detail"><span>{game.autoPurchased ? (game.autoActive ? cfg.AUTO_ON : cfg.AUTO_OFF) : 'UPGRADE'}</span><span className="tool-price">{game.autoPurchased ? '' : formatShort(cfg.AUTO_COST)}</span></span>
            </button>
          </div>
        </section>
      </div>
      {!ready && <div className="sr-only" aria-live="polite">Loading</div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
