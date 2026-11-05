import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';


// This bridge belongs to the game; it does not reproduce host UI or gradients.
const feedSession = (() => {
  const embedded = window.parent !== window && new URLSearchParams(location.search).get('feedReview') === '1';
  let active = !embedded;
  const listeners = new Set();
  const update = () => {
    for (const callback of listeners) callback(active && !document.hidden);
  };
  window.addEventListener('message', event => {
    if (!embedded || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
    update();
  });
  document.addEventListener('visibilitychange', update);
  update();
  return {get active() { return active && !document.hidden; }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }};
})();

function useFeedActive() {
  const [active, setActive] = useState(feedSession.active);
  useEffect(() => feedSession.subscribe(setActive), []);
  return active;
}

const DEFAULT_CONFIG = {
  "VIDEO_STEP_MS": 1200,
  "TARGET_COUNT": 3,
  "GAME_NAME": "Did You Watch It?",
  "HINT_TEXT": "Watch, then choose",
  "WATCH_LABEL": "Memorize",
  "PICK_LABEL": "Select the images you saw",
  "VERIFY_LABEL": "Verify",
  "REPLAY_LABEL": "Replay",
  "SUCCESS_LABEL": "Verified",
  "SUCCESS_MESSAGE": "All images matched.",
  "FAIL_MESSAGE": "Some images don’t match. Try again.",
  "CAT": "./assets/cat.webp",
  "CAT_LOOKALIKE_1": "./assets/lookalikes/cat-1.webp",
  "CAT_LOOKALIKE_2": "./assets/lookalikes/cat-2.webp",
  "RAMEN": "./assets/ramen.webp",
  "RAMEN_LOOKALIKE_1": "./assets/lookalikes/ramen-1.webp",
  "RAMEN_LOOKALIKE_2": "./assets/lookalikes/ramen-2.webp",
  "SUNSET": "./assets/sunset.webp",
  "SUNSET_LOOKALIKE_1": "./assets/lookalikes/sunset-1.webp",
  "SUNSET_LOOKALIKE_2": "./assets/lookalikes/sunset-2.webp",
  "DAY_BICYCLE": "./assets/memory-sets/day_bicycle.webp",
  "DAY_BICYCLE_LOOKALIKE_1": "./assets/lookalikes/day_bicycle-1.webp",
  "DAY_BICYCLE_LOOKALIKE_2": "./assets/lookalikes/day_bicycle-2.webp",
  "DAY_TRAM": "./assets/memory-sets/day_tram.webp",
  "DAY_TRAM_LOOKALIKE_1": "./assets/lookalikes/day_tram-1.webp",
  "DAY_TRAM_LOOKALIKE_2": "./assets/lookalikes/day_tram-2.webp",
  "DAY_BALLOON": "./assets/memory-sets/day_balloon.webp",
  "DAY_BALLOON_LOOKALIKE_1": "./assets/lookalikes/day_balloon-1.webp",
  "DAY_BALLOON_LOOKALIKE_2": "./assets/lookalikes/day_balloon-2.webp",
  "HOME_RABBIT": "./assets/memory-sets/home_rabbit.webp",
  "HOME_RABBIT_LOOKALIKE_1": "./assets/lookalikes/home_rabbit-1.webp",
  "HOME_RABBIT_LOOKALIKE_2": "./assets/lookalikes/home_rabbit-2.webp",
  "HOME_PANCAKES": "./assets/memory-sets/home_pancakes.webp",
  "HOME_PANCAKES_LOOKALIKE_1": "./assets/lookalikes/home_pancakes-1.webp",
  "HOME_PANCAKES_LOOKALIKE_2": "./assets/lookalikes/home_pancakes-2.webp",
  "HOME_GUITAR": "./assets/memory-sets/home_guitar.webp",
  "HOME_GUITAR_LOOKALIKE_1": "./assets/lookalikes/home_guitar-1.webp",
  "HOME_GUITAR_LOOKALIKE_2": "./assets/lookalikes/home_guitar-2.webp"
};

const MEMORY_SETS = [
  { id: 'classic', groups: [
    [{"id": "CAT", "name": "Gray kitten, photo 1"}, {"id": "CAT_LOOKALIKE_1", "name": "Gray kitten, photo 2"}, {"id": "CAT_LOOKALIKE_2", "name": "Gray kitten, photo 3"}],
    [{"id": "RAMEN", "name": "Ramen bowl, photo 1"}, {"id": "RAMEN_LOOKALIKE_1", "name": "Ramen bowl, photo 2"}, {"id": "RAMEN_LOOKALIKE_2", "name": "Ramen bowl, photo 3"}],
    [{"id": "SUNSET", "name": "Beach sunset, photo 1"}, {"id": "SUNSET_LOOKALIKE_1", "name": "Beach sunset, photo 2"}, {"id": "SUNSET_LOOKALIKE_2", "name": "Beach sunset, photo 3"}],
  ] },
  { id: 'day-out', groups: [
    [{"id": "DAY_BICYCLE", "name": "Red bicycle, photo 1"}, {"id": "DAY_BICYCLE_LOOKALIKE_1", "name": "Red bicycle, photo 2"}, {"id": "DAY_BICYCLE_LOOKALIKE_2", "name": "Red bicycle, photo 3"}],
    [{"id": "DAY_TRAM", "name": "Yellow tram, photo 1"}, {"id": "DAY_TRAM_LOOKALIKE_1", "name": "Yellow tram, photo 2"}, {"id": "DAY_TRAM_LOOKALIKE_2", "name": "Yellow tram, photo 3"}],
    [{"id": "DAY_BALLOON", "name": "Rainbow balloon, photo 1"}, {"id": "DAY_BALLOON_LOOKALIKE_1", "name": "Rainbow balloon, photo 2"}, {"id": "DAY_BALLOON_LOOKALIKE_2", "name": "Rainbow balloon, photo 3"}],
  ] },
  { id: 'cozy-home', groups: [
    [{"id": "HOME_RABBIT", "name": "Lop rabbit, photo 1"}, {"id": "HOME_RABBIT_LOOKALIKE_1", "name": "Lop rabbit, photo 2"}, {"id": "HOME_RABBIT_LOOKALIKE_2", "name": "Lop rabbit, photo 3"}],
    [{"id": "HOME_PANCAKES", "name": "Blueberry pancakes, photo 1"}, {"id": "HOME_PANCAKES_LOOKALIKE_1", "name": "Blueberry pancakes, photo 2"}, {"id": "HOME_PANCAKES_LOOKALIKE_2", "name": "Blueberry pancakes, photo 3"}],
    [{"id": "HOME_GUITAR", "name": "Blue guitar, photo 1"}, {"id": "HOME_GUITAR_LOOKALIKE_1", "name": "Blue guitar, photo 2"}, {"id": "HOME_GUITAR_LOOKALIKE_2", "name": "Blue guitar, photo 3"}],
  ] },
];
const PREVIEW_ITEMS = MEMORY_SETS[0].groups.flat();
const PREVIEW_ORDER = [4, 0, 7, 2, 6, 3, 8, 5, 1];
const PREVIEW_CHECK_DELAYS = { 0: '0s', 5: '0.6s', 8: '1.2s' };

const SOUND_SELECT = './assets/sfx_select.mp3';
const SOUND_VERIFY = './assets/sfx_verify.mp3';
const SOUND_SUCCESS = './assets/sfx_success.mp3';
const SOUND_FAIL = './assets/sfx_fail.mp3';

function flattenConfig(raw) {
  const cfg = { ...DEFAULT_CONFIG };
  (raw?.tweaks || []).forEach((item) => { cfg[item.id] = item.value; });
  (raw?.texts || []).forEach((item) => { cfg[item.id] = item.value; });
  (raw?.images || []).forEach((item) => { cfg[item.id] = item.path; });
  return cfg;
}

function vibrate(style) {
  try {
    if (typeof tt !== 'undefined' && tt.vibrate) tt.vibrate({ style: style || 'light' });
  } catch (e) { /* optional haptics */ }
}

function connectedCorrectGroup(items,targets){
  const correct=new Set(items.map((item,i)=>targets.includes(item.id)?i:-1).filter(i=>i>=0));
  if(correct.size<3)return false;
  const seen=new Set(),queue=[correct.values().next().value];
  while(queue.length){const i=queue.pop();if(seen.has(i))continue;seen.add(i);for(const j of correct){if(!seen.has(j)&&Math.abs(Math.floor(i/3)-Math.floor(j/3))+Math.abs(i%3-j%3)===1)queue.push(j);}}
  return seen.size===correct.size;
}
function shuffledMemoryGrid(items,targets,seed){
  let state=seed>>>0;
  const random=()=>{let n=state=(state+0x6d2b79f5)>>>0;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};
  let shuffled;
  for(let attempt=0;attempt<60;attempt++){
    shuffled=items.slice();for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    if(!connectedCorrectGroup(shuffled,targets))return shuffled;
  }
  // A bounded fallback keeps a highly unlucky shuffle from producing one
  // contiguous answer cluster. It does not force one answer into every row.
  const answers=shuffled.filter(item=>targets.includes(item.id)),others=shuffled.filter(item=>!targets.includes(item.id));
  const slots=[0,2,7,4];if(answers.length>slots.length)return shuffled;
  const grid=Array(items.length);answers.forEach((item,i)=>{grid[slots[i]]=item;});let index=0;return Array.from(grid,item=>item||others[index++]);
}

function App() {
  const feedActive = useFeedActive();
  const [cfg, setCfg] = useState(DEFAULT_CONFIG);
  const [phase, setPhase] = useState('video');
  const [round, setRound] = useState(1);
  const [gridSeed] = useState(() => Math.floor(Math.random() * 4294967296));
  const [videoIndex, setVideoIndex] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [feedback, setFeedback] = useState('');
  const [ready, setReady] = useState(false);
  const audioRef = useRef({ ctx: null, gain: null, buffers: new Map(), loading: new Map(), sources: new Set() });

  useEffect(() => {
    let alive = true;
    fetch('./game.config.json').then((res) => res.ok ? res.json() : {}).then((raw) => {
      if (alive) setCfg(flattenConfig(raw));
    }).catch(() => { /* defaults keep the game playable */ }).finally(() => {
      if (alive) setReady(true);
    });
    return () => { alive = false; };
  }, []);

  const getAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      try {
        audio.ctx = new AudioContextClass();
        audio.gain = audio.ctx.createGain();
        audio.gain.gain.value = 0.2;
        audio.gain.connect(audio.ctx.destination);
      } catch (e) { return null; }
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
    return audio;
  }, []);

  const playSound = useCallback((url) => {
    const audio = getAudio();
    if (!audio) return;
    console.info('[sound]', url);
    const ctx = audio.ctx;
    let load = audio.loading.get(url);
    if (!load && !audio.buffers.has(url)) {
      load = fetch(url).then((res) => res.arrayBuffer()).then((data) => ctx.decodeAudioData(data)).then((buffer) => {
        audio.buffers.set(url, buffer);
        audio.loading.delete(url);
        return buffer;
      }).catch(() => { audio.loading.delete(url); return null; });
      audio.loading.set(url, load);
    }
    const finish = (buffer) => {
      if (!buffer || !audio.ctx || audio.ctx.state === 'closed') return;
      try {
        const source = audio.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(audio.gain);
        audio.sources.add(source);
        source.onended = () => audio.sources.delete(source);
        source.start(0);
      } catch (e) { /* audio is non-blocking */ }
    };
    if (audio.buffers.has(url)) finish(audio.buffers.get(url));
    else if (load) load.then(finish);
  }, [getAudio]);

  useEffect(() => () => {
    const audio = audioRef.current;
    audio.sources.forEach((source) => { try { source.stop(); } catch (e) {} });
    audio.sources.clear();
    if (audio.ctx) audio.ctx.close().catch(() => {});
  }, []);

  const imageSet = MEMORY_SETS[(round - 1) % MEMORY_SETS.length];
  const { targets, gridItems } = useMemo(() => {
    const cycle = Math.floor((round - 1) / MEMORY_SETS.length);
    const variants = imageSet.groups.map((group, index) =>
      (cycle + ((gridSeed >>> (index * 4)) % group.length)) % group.length
    );
    const targets = imageSet.groups.map((group, index) => group[variants[index]].id);
    if (Number(cfg.TARGET_COUNT) === 4) {
      const group = imageSet.groups[cycle % imageSet.groups.length];
      targets.push(group[(variants[cycle % imageSet.groups.length] + 1) % group.length].id);
    }
    const gridItems = shuffledMemoryGrid(
      imageSet.groups.flat(),
      targets,
      (gridSeed + Math.imul(round, 1664525)) >>> 0
    );
    return { targets, gridItems };
  }, [cfg.TARGET_COUNT, gridSeed, imageSet, round]);
  const currentMoment = gridItems.find(item => item.id === targets[videoIndex]);

  useEffect(() => {
    if (!ready || phase !== 'video' || !feedActive) return undefined;
    const timer = window.setTimeout(() => {
      if (videoIndex + 1 < targets.length) setVideoIndex(videoIndex + 1);
      else setPhase('grid');
    }, cfg.VIDEO_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [ready, phase, videoIndex, targets.length, cfg.VIDEO_STEP_MS, feedActive]);

  const showSequence = useCallback(() => {
    setFeedback('');
    setSelected(new Set());
    setVideoIndex(0);
    setPhase('video');
  }, []);

  const beginReplay = () => {
    showSequence();
    playSound(SOUND_VERIFY);
    vibrate('light');
  };

  const nextRound = () => {
    setRound(value => value + 1);
    showSequence();
  };

  const toggleTile = useCallback((id) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setFeedback('');
    playSound(SOUND_SELECT); // grid toggle: soft selection tap
    vibrate('light');
  }, [playSound]);

  const verify = useCallback(() => {
    playSound(SOUND_VERIFY); // Verify button: formal confirmation cue
    vibrate('medium');
    const isCorrect = selected.size === targets.length && targets.every((id) => selected.has(id));
    if (isCorrect) {
      console.info('[memory]', 'round complete', round, targets);
      playSound(SOUND_SUCCESS); // correct memory set: neon check chime
      vibrate('notification_success');
      setPhase('success');
    } else {
      console.info('[memory]', 'retry', { selected: selected.size, expected: targets.length });
      playSound(SOUND_FAIL); // incorrect memory set: gentle miss cue
      vibrate('notification_error');
      setFeedback(cfg.FAIL_MESSAGE);
    }
  }, [cfg.FAIL_MESSAGE, playSound, round, selected, targets]);

  if (!ready) return <div className="loading-screen">Loading images…</div>;

  return (
    <main className="game-shell" data-testid="game-shell" data-memory-set={imageSet.id}
      data-preview={!feedActive} aria-label={cfg.GAME_NAME}>
      {!feedActive ? (
        <section className="challenge-card preview-card">
          <h2 className="card-heading hint" data-testid="hint">{cfg.HINT_TEXT}</h2>
          <div className="photo-viewport">
            <div className="memory-grid" aria-hidden="true">
              {PREVIEW_ORDER.map(index => {
                const item = PREVIEW_ITEMS[index];
                const delay = PREVIEW_CHECK_DELAYS[index];
                return (
                  <div className="memory-tile preview-tile" key={item.id}>
                    <img src={cfg[item.id]} alt="" draggable="false" />
                    {delay && <span className="tile-check preview-check" style={{ '--check-delay': delay }}>✓</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : (
        <>
          <div className="round-hud" data-testid="round-hud" aria-label={'Round ' + round}>{String(round).padStart(2, '0')}</div>
          <div className="card-viewport">
            {phase === 'video' && (
              <section className="challenge-card watch-card" data-testid="video-stage">
                <h2 className="card-heading">{cfg.WATCH_LABEL}</h2>
                <div className="photo-viewport">
                  {currentMoment && <img className="square-photo" src={cfg[currentMoment.id]} alt={currentMoment.name} />}
                </div>
                <div className="watch-count">{videoIndex + 1} / {targets.length}</div>
              </section>
            )}

            {phase === 'grid' && (
              <section className="challenge-card grid-card" data-testid="grid-stage">
                <div className="card-heading grid-heading">
                  <h2>{cfg.PICK_LABEL}</h2>
                  <span className="selected-count" data-testid="selected-count" aria-label={selected.size + ' selected'}>{selected.size}</span>
                </div>
                <div className="photo-viewport">
                  <div className="memory-grid">
                    {gridItems.map(item => (
                      <button key={item.id} className="memory-tile" data-testid={'tile-' + item.id}
                        aria-label={item.name} aria-pressed={selected.has(item.id)}
                        onClick={() => toggleTile(item.id)} type="button">
                        <img src={cfg[item.id]} alt="" draggable="false" />
                        {selected.has(item.id) && <span className="tile-check" aria-hidden="true">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid-actions">
                  <button className="replay-button" type="button" onClick={beginReplay}>{cfg.REPLAY_LABEL}</button>
                  <button className="verify-button" type="button" data-testid="verify" disabled={!selected.size} onClick={verify}>{cfg.VERIFY_LABEL}</button>
                </div>
                <p className="failure-feedback" data-testid="failure-feedback" role="status">{feedback}</p>
              </section>
            )}

            {phase === 'success' && (
              <section className="challenge-card result-card" data-testid="success-stage">
                <span className="success-check" aria-hidden="true">✓</span>
                <h2>{cfg.SUCCESS_LABEL}</h2>
                <p>{cfg.SUCCESS_MESSAGE}</p>
                <button className="verify-button" type="button" onClick={nextRound}>Next round</button>
              </section>
            )}
          </div>
        </>
      )}
    </main>
  );
}

const styles = `@font-face {
  font-family: 'Poppins';
  src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Poppins';
  src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}


:root { font-family: Poppins, system-ui, sans-serif; color: #1e2b39; background: #101619; }
* { box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
button { font: inherit; touch-action: manipulation; }
button:focus-visible { outline: 3px solid #082a5b; outline-offset: 2px; z-index: 1; }
.loading-screen { display: grid; height: 100%; place-items: center; color: #fff; }
.game-shell {
  container-type: size; position: relative; width: 100%; height: 100%; overflow: hidden;
  display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 8px;
  padding: clamp(12px, 5vh, 30px) clamp(14px, 6vw, 30px) clamp(12px, 6vh, 40px);
  background: #101619; -webkit-tap-highlight-color: transparent;
}
.round-hud { text-align: center; color: #e7f1fa; font-weight: 700; font-size: 24px; line-height: 1; }
.card-viewport { min-height: 0; display: grid; place-items: center; }
.challenge-card {
  display: grid; width: min(100%, 350px); height: min(100%, 460px);
  padding: 8px; gap: 8px; min-height: 0;
  background: #fff; border: 1px solid #d8e0e6; border-radius: 7px;
}
.watch-card { grid-template-rows: auto minmax(0, 1fr) auto; }
.grid-card { grid-template-rows: auto minmax(0, 1fr) auto auto; }
.card-heading {
  margin: 0; padding: 10px 12px; min-height: 42px; border-radius: 3px;
  color: #fff; background: #1767c8; font-size: 16px; line-height: 1.35; font-weight: 700;
  overflow-wrap: anywhere;
}
.grid-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.grid-heading h2 { font: inherit; margin: 0; }
.selected-count { min-width: 24px; border-radius: 3px; background: #ffffff26; text-align: center; }
.photo-viewport { min-width: 0; min-height: 0; container-type: size; display: grid; place-items: center; }
.square-photo, .memory-grid { width: min(100cqw, 100cqh); aspect-ratio: 1; }
.square-photo { display: block; object-fit: cover; border-radius: 3px; }
.watch-count { text-align: center; font-size: 13px; color: #526171; }
.memory-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 4px; }
.memory-tile { position: relative; border: 0; padding: 0; border-radius: 3px; overflow: hidden; background: #e3e9ef; cursor: pointer; }
.memory-tile img { display: block; width: 100%; height: 100%; object-fit: cover; }
.memory-tile[aria-pressed="true"] img { opacity: .77; }
.memory-tile[aria-pressed="true"]::after { content: ''; position: absolute; inset: 0; border: 3px solid #1767c8; border-radius: 3px; pointer-events: none; }
.tile-check { position: absolute; z-index: 1; top: 4px; right: 4px; width: 22px; height: 22px; line-height: 22px; text-align: center; color: #fff; background: #1767c8; border-radius: 50%; }
.grid-actions { display: flex; justify-content: space-between; gap: 8px; }
.grid-actions button, .verify-button { min-height: 44px; border-radius: 4px; padding: 6px 14px; font-weight: 700; font-size: 14px; cursor: pointer; }
.replay-button { border: 1px solid #bfcbd8; color: #245685; background: #fff; }
.verify-button { border: 1px solid #1767c8; color: #fff; background: #1767c8; }
.verify-button:disabled { opacity: .55; cursor: default; }
.failure-feedback { min-height: 17px; margin: 0; color: #9c3025; font-size: 12px; line-height: 17px; }
.result-card { height: auto; padding: 25px 16px; justify-items: center; gap: 8px; text-align: center; }
.result-card h2, .result-card p { margin: 0; }
.result-card p { font-size: 14px; margin-bottom: 8px; }
.success-check { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 50%; background: #e1f2e8; color: #17683c; font-size: 26px; }
.preview-card {
  position: absolute; top: 23%; left: 50%; transform: translateX(-50%);
  width: min(76%, 300px); height: min(50%, 326px); grid-template-rows: auto minmax(0, 1fr);
}
.preview-card .hint { text-align: center; }
.preview-tile { cursor: inherit; }
.preview-check { opacity: 0; animation: preview-check 4s ease-in-out var(--check-delay) infinite; }
@keyframes preview-check {
  0%, 10%, 85%, 100% { opacity: 0; transform: scale(.8); }
  18%, 76% { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) { .preview-check { animation: none; opacity: 1; } }
`;

createRoot(document.getElementById('root')).render(<><style>{styles}</style><App /></>);
