// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "GRAVITY",
    "kind": "number",
    "label": "Growth Speed",
    "value": 1.2,
    "default": 1.2,
    "min": 0.1,
    "max": 2,
    "step": 0.1
  }, {
    "id": "CREATURE_FORCE",
    "kind": "number",
    "label": "Bug Wander Speed",
    "value": 0.05,
    "default": 0.05,
    "min": 0.01,
    "max": 0.2,
    "step": 0.01
  }],
  "texts": [{
    "id": "TITLE",
    "label": "Title",
    "value": "Giardino delle creature",
    "default": "Giardino delle creature",
    "max_length": 25
  }, {
    "id": "BTN_ADD_CREATURE",
    "label": "Invite Bugs Button",
    "value": "Invita insetti",
    "default": "Invita insetti",
    "max_length": 15
  }, {
    "id": "BTN_ADD_BLOCK",
    "label": "Grow Patch Button",
    "value": "Pianta erba",
    "default": "Pianta erba",
    "max_length": 15
  }, {
    "id": "BTN_CLEAR",
    "label": "Clear Button",
    "value": "Ricomincia",
    "default": "Ricomincia",
    "max_length": 15
  }],
  "images": [{
    "id": "BG_MAIN",
    "label": "Background",
    "path": "./assets/meadow_topdown.svg",
    "replaceable": true
  }, {
    "id": "IMG_CREATURE",
    "label": "Ladybug Image",
    "path": "./assets/ladybug.svg",
    "replaceable": true
  }, {
    "id": "IMG_FOOD",
    "label": "Bee Image",
    "path": "./assets/bee_topdown.svg",
    "replaceable": true
  }, {
    "id": "IMG_BLOCK",
    "label": "Flower Image",
    "path": "./assets/flower_topdown.svg",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "99279393805132897",
    "version_id": "99279393805126700",
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "it",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
let runtimeConfig = DEFAULT_CONFIG;
async function requestGameConfig() {
  let deadline;
  try {
    const request = fetch('./game.config.json', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .catch(() => null);
    const timeout = new Promise(resolve => {
      deadline = setTimeout(() => resolve(null), 1200);
    });
    const config = await Promise.race([request, timeout]);
    if (config && typeof config === 'object' && !Array.isArray(config)) runtimeConfig = config;
    return { ok: true, json: async () => runtimeConfig };
  } finally {
    clearTimeout(deadline);
  }
}
const GAME_STYLES = `
/* Keep the guide and scene in place; these tools return upon entering play. */
html[data-creature-preview="true"] .plant-controls > :is(.plant-picker,button){visibility:hidden;pointer-events:none}


    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #d6d6d3; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .sandbox-guide{position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.sandbox-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.sandbox-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.sandbox-guide){animation:none!important}}

/* Italian copy keeps the approved role sizes and may wrap instead of clipping. */
html[lang="it"] :is(.meeting-guide,.feed-first-action,.melody-guide,.particle-guide,.dive-guide,.sandbox-guide,.koi-guide,.ui-guide,.bead-guide,.coloring-guide,.look-guide,.time-print-guide){white-space:normal;overflow-wrap:normal;word-break:normal;line-height:1.4}
html[lang="it"] :is(button,.btn,.btn-neon){overflow-wrap:normal;word-break:normal}
html[lang="it"] .melody-controls button{font-size:18px;padding-inline:12px}
html[lang="it"] .meeting-sand-ball-count{gap:6px!important}
html[lang="it"] #people-dialog fieldset label{min-width:0}
html[lang="it"] #people-dialog input{max-width:100%;min-width:0}
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
document.documentElement.lang = 'it';
function readConfigValues(config) {
  let values = {};
  for (let value of config.tweaks || []) values[value.id] = value.value;
  for (let value of config.texts || []) values[value.id] = value.value;
  for (let value of config.images || []) values[value.id] = value.path;
  for (let value of config.mentions || []) values[value.id] = value.path || value.value;
  return values;
}
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}
function CreatureMeadow({
  cfg: config
}) {
  const createElement = React.createElement;
  const canvas = React.useRef(null);
  const plants = React.useRef([]);
  const grass = React.useRef([]);
  const grassCache = React.useRef({
    canvas: null,
    seen: new Set()
  });
  const bugs = React.useRef([]);
  const drag = React.useRef(null);
  const images = React.useRef({});
  const audio = React.useRef(null);
  const stateRef = React.useRef(0);
  const lastFrame = React.useRef(0);
  const lastSpawn = React.useRef(0);
  const [stats, setStats] = React.useState({
    plants: 0,
    grass: false,
    bugs: 0
  });
  const [hasGrowth, setHasGrowth] = React.useState(false);
  const [selected, setSelected] = React.useState("grass");
  const serial = React.useRef(0);
  const reduced = React.useRef(false);
  const keyboard = React.useRef({
    x: 0.5,
    y: 0.6,
    visible: false
  });
  const voices = React.useRef(0);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const picker = React.useRef(null);
  const pickerButton = React.useRef(null);
  const optionButtons = React.useRef({});
  const menuStart = React.useRef(null);
  const sound = React.useRef({
    active: new Set(),
    buffers: new Map(),
    variant: 0,
    epoch: 0,
    disposed: false,
    music: null,
    musicBuffer: null
  });
  const intro = React.useRef({
    active: true,
    elapsed: 0,
    scene: null
  });
  const growth = clamp(Number(config.GRAVITY) || 1.2, 0.1, 2);
  const wander = clamp(Number(config.CREATURE_FORCE) || 0.05, 0.01, 0.2);
  const choices = [{
    id: "grass",
    label: "Erba"
  }, {
    id: "daisy",
    label: "Margherite"
  }, {
    id: "tulip",
    label: "Tulipani"
  }, {
    id: "sunflower",
    label: "Girasoli"
  }];
  React.useEffect(() => {
    const sources = {
      ladybug: config.IMG_CREATURE,
      bee: config.IMG_FOOD,
      flower: config.IMG_BLOCK
    };
    let live = true;
    for (const [key, src] of Object.entries(sources)) {
      const image = new Image();
      image.onload = () => {
        if (live) images.current[key] = image;
      };
      image.onerror = () => {
        if (live) images.current[key] = null;
      };
      image.src = src || "";
    }
    return () => {
      live = false;
    };
  }, [config.IMG_CREATURE, config.IMG_FOOD, config.IMG_BLOCK]);
  React.useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (reduced.current && !media?.matches) for (const plant of [...grass.current, ...plants.current]) plant.born = Math.min(plant.born, performance.now() - plant.duration / growth);
      reduced.current = !!media?.matches;
    };
    update();
    media?.addEventListener?.("change", update);
    return () => media?.removeEventListener?.("change", update);
  }, [growth]);
  const stopSound = React.useCallback((keepMusic = false) => {
    const state = sound.current;
    state.epoch++;
    for (const voice of state.active) {
      voice.source.onended = null;
      try {
        voice.source.stop();
        voice.source.disconnect();
        voice.gain.disconnect();
      } catch {}
    }
    state.active.clear();
    voices.current = 0;
    if (!keepMusic && state.music) {
      const music = state.music;
      state.music = null;
      try {
        music.source.stop();
        music.source.disconnect();
        music.gain.disconnect();
      } catch {}
    }
  }, []);
  const startMusic = React.useCallback(value2 => {
    const state = sound.current;
    if (state.music || state.disposed || document.hidden || value2.state !== "running") return;
    if (!state.musicBuffer) {
      const rate = 22050;
      const duration = 16;
      const buffer = value2.createBuffer(1, rate * duration, rate);
      const data = buffer.getChannelData(0);
      const chords = [[48, 55, 59], [45, 52, 60], [41, 48, 57], [43, 50, 59]];
      const melody = [72, 76, 79, 76, 69, 72, 76, 72, 69, 72, 77, 72, 71, 74, 79, 74];
      const handleAction = note => 440 * 2 ** ((note - 69) / 12);
      for (let value3 = 0; value3 < data.length; value3++) {
        const value4 = value3 / rate;
        const section = Math.floor(value4 / 4);
        const value5 = value4 % 4;
        const beat = Math.floor(value4);
        const noteAge = value4 % 1;
        const chordEnvelope = Math.sin(Math.PI * value5 / 4) ** 0.7;
        let value = 0;
        for (const note of chords[section]) {
          const phase = 2 * Math.PI * handleAction(note) * value4;
          value += (Math.sin(phase) + 0.12 * Math.sin(phase * 2)) * chordEnvelope * 0.12;
        }
        const phase = 2 * Math.PI * handleAction(melody[beat]) * noteAge;
        const attack = Math.min(1, noteAge / 0.035);
        value += (Math.sin(phase) + 0.15 * Math.sin(phase * 2)) * attack * Math.exp(-noteAge * 4.5) * 0.15;
        data[value3] = value * Math.min(1, value4 / 0.18, (duration - value4) / 0.18);
      }
      state.musicBuffer = buffer;
    }
    const source = value2.createBufferSource();
    const gain = value2.createGain();
    const currentTime = value2.currentTime;
    source.buffer = state.musicBuffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = 16;
    gain.gain.setValueAtTime(0.0001, currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, currentTime + 0.9);
    source.connect(gain).connect(value2.destination);
    state.music = {
      source,
      gain
    };
    source.start(currentTime);
  }, []);
  const tone = React.useCallback((kind, type) => {
    try {
      const state = sound.current;
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor || state.disposed || document.hidden) return;
      const value2 = audio.current || (audio.current = new AudioCtor());
      const epoch = state.epoch;
      const requested = performance.now();
      const play = () => {
        try {
          if (audio.current !== value2 || value2.state !== "running" || state.disposed || state.epoch !== epoch || document.hidden || performance.now() - requested > 300) return;
          if (kind !== "clear" && kind !== "select") startMusic(value2);
          if (kind === "grass" || voices.current >= 4) return;
          const variation = state.variant++ % 3;
          const value3 = kind + ":" + (type || "") + ":" + variation;
          let buffer = state.buffers.get(value3);
          if (!buffer) {
            const flower = ["daisy", "tulip", "sunflower"].includes(kind);
            const duration = kind === "clear" ? 0.4 : kind === "select" ? 0.1 : 0.18;
            const rate = value2.sampleRate;
            buffer = value2.createBuffer(1, Math.ceil(rate * duration), rate);
            const data = buffer.getChannelData(0);
            let seed = 5708 + variation * 7919;
            let value4 = 0;
            let high = 0;
            let phase = 0;
            const frequency = {
              daisy: 240,
              tulip: 210,
              sunflower: 180
            }[kind] || 520;
            for (let value5 = 0; value5 < data.length; value5++) {
              const value6 = value5 / rate;
              seed = 1664525 * seed + 1013904223 >>> 0;
              const noise = seed / 2147483648 - 1;
              value4 += (noise - value4) * (1 - Math.exp(-2 * Math.PI * 650 / rate));
              high += (noise - high) * (1 - Math.exp(-2 * Math.PI * 3600 / rate));
              phase += 2 * Math.PI * (flower ? 55 + (frequency - 55) * Math.exp(-value6 * 36) : frequency) * (1 + (variation - 1) * 0.055) / rate;
              const envelope = Math.min(1, value6 / (flower ? 0.003 : 0.008), (duration - value6) / 0.035);
              const value = kind === "clear" ? (high - value4) * 0.65 * Math.sin(Math.PI * value6 / duration) * Math.exp(-value6 * 3) : kind === "select" ? (high - value4) * 0.2 * Math.exp(-value6 * 45) : Math.sin(phase) * 0.3 * Math.exp(-value6 * 28) + value4 * 0.18 * Math.exp(-value6 * 65);
              data[value5] = value * envelope;
            }
            state.buffers.set(value3, buffer);
          }
          const source = value2.createBufferSource();
          const gain = value2.createGain();
          const currentTime = value2.currentTime;
          const duration = buffer.duration;
          source.buffer = buffer;
          source.loop = false;
          gain.gain.setValueAtTime(0.7, currentTime);
          source.connect(gain).connect(value2.destination);
          const voice = {
            source,
            gain
          };
          state.active.add(voice);
          voices.current = state.active.size;
          source.onended = () => {
            state.active.delete(voice);
            voices.current = state.active.size;
            try {
              source.disconnect();
              gain.disconnect();
            } catch {}
          };
          source.start(currentTime);
          source.stop(currentTime + duration + 0.01);
        } catch {}
      };
      if (value2.state === "suspended") Promise.resolve(value2.resume()).then(play).catch(() => {});else play();
    } catch {}
  }, [startMusic]);
  const isFlower = type => type === "daisy" || type === "tulip" || type === "sunflower";
  const syncStats = React.useCallback(() => setStats({
    plants: plants.current.length,
    grass: grass.current.length > 0,
    bugs: bugs.current.length
  }), []);
  const randomFor = seed => () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const makePlant = (x, y, type, previewSeed) => {
    const value = previewSeed === undefined ? ++serial.current : -previewSeed;
    const seed = previewSeed === undefined ? Math.random() * 4294967296 >>> 0 ^ value || 1 : previewSeed;
    const rand = randomFor(seed);
    const range = (value2, otherValue) => value2 + rand() * (otherValue - value2);
    const radius = range(type === "grass" ? 23 : 5.2, type === "grass" ? 39 : 9.5);
    const plant = {
      id: value,
      seed,
      x,
      y,
      type,
      radius,
      phase: range(0, Math.PI * 2),
      duration: range(type === "grass" ? 200 : 320, type === "grass" ? 420 : 600),
      born: performance.now(),
      tint: Math.floor(range(0, 3)),
      petals: Math.floor(range(5, 8))
    };
    if (type === "grass") {
      const count = Math.floor(range(44, 63));
      plant.blades = Array.from({
        length: count
      }, (value2, otherValue) => ({
        angle: otherValue / count * Math.PI * 2 + range(-0.075, 0.075),
        root: range(0, 0.33),
        length: range(0.88, 1.2),
        halfWidth: range(0.045, 0.15),
        bend: range(-0.15, 0.15),
        delay: range(0, 0.18),
        tint: Math.floor(range(0, 4))
      }));
      plant.core = Array.from({
        length: 24
      }, (value2, otherValue) => ({
        angle: otherValue / 24 * Math.PI * 2,
        radius: range(0.76, 0.84)
      }));
    }
    return plant;
  };
  const plantScale = () => Math.min(1.4, Math.max(0.6, Math.min(window.innerWidth / 390, window.innerHeight / 598)));
  const addGrass = (x, y, argument3, argument4) => {
    const scale = plantScale();
    x = clamp(x, 0, 1);
    y = clamp(y, 0, 1);
    if (grass.current.some(point => Math.hypot((point.x - x) * argument3, (point.y - y) * argument4) < 9 * scale)) return false;
    if (grass.current.length >= 1400) {
      grass.current.splice(0, 200);
      grassCache.current.canvas = null;
      grassCache.current.seen.clear();
    }
    grass.current.push(makePlant(x, y, "grass"));
    return true;
  };
  const addFlower = (x, y, type, argument4, argument5, natural = false) => {
    const scale = plantScale();
    const plant = makePlant(x, y, type);
    const inset = (plant.radius + 2) * scale;
    x = clamp(x, inset / argument4, 1 - inset / argument4);
    y = clamp(y, inset / argument5, 1 - inset / argument5);
    plant.x = x;
    plant.y = y;
    if (natural && (plants.current.length >= 500 || plants.current.some(point => isFlower(point.type) && Math.hypot((point.x - x) * argument4, (point.y - y) * argument5) < 40 * scale))) return false;
    plant.natural = natural;
    for (let value = plants.current.length - 1; value >= 0; value--) if (isFlower(plants.current[value].type) && Math.hypot((plants.current[value].x - x) * argument4, (plants.current[value].y - y) * argument5) < (plants.current[value].radius + plant.radius + 3) * scale) plants.current.splice(value, 1);
    if (plants.current.length >= 500) plants.current.splice(0, 1);
    plants.current.push(plant);
    return true;
  };
  const addPlant = React.useCallback((value, otherValue, type = selected, scatter = false) => {
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0 || !Number.isFinite(value) || !Number.isFinite(otherValue) || value < 0 || value > 1 || otherValue < 0 || otherValue > 1 || !choices.some(choice => choice.id === type)) return false;
    const width = rect.width;
    const height = rect.height;
    const scale = plantScale();
    const inset = type === "grass" ? 0 : 12;
    const x = clamp(value, inset * scale / width, 1 - inset * scale / width);
    const y = clamp(otherValue, inset * scale / height, 1 - inset * scale / height);
    let changed = false;
    if (type === "grass") {
      changed = addGrass(x, y, width, height);
      if (changed) {
        const tuft = grass.current.at(-1);
        const rand = randomFor(tuft.seed ^ 22449);
        if (rand() < 0.2) {
          const angle = rand() * Math.PI * 2;
          const radius = Math.sqrt(rand()) * tuft.radius * 0.45 * scale;
          const type = ["daisy", "tulip", "sunflower"][Math.floor(rand() * 3)];
          addFlower(x + Math.cos(angle) * radius / width, y + Math.sin(angle) * radius / height, type, width, height, true);
        }
      }
    } else {
      if (isFlower(type)) {
        const angle = scatter ? Math.random() * Math.PI * 2 : 0;
        const radius = scatter ? (8 + Math.sqrt(Math.random()) * 16) * scale : 0;
        addFlower(x + Math.cos(angle) * radius / width, y + Math.sin(angle) * radius / height, type, width, height);
      } else {
        if (plants.current.length >= 500) plants.current.splice(0, 1);
        plants.current.push(makePlant(x, y, type));
      }
      changed = true;
    }
    if (changed) {
      intro.current.active = false;
      setHasGrowth(true);
    }
    return changed;
  }, [selected]);
  const releasePointer = () => {
    const active = drag.current;
    drag.current = null;
    if (active && canvas.current?.hasPointerCapture?.(active.id)) try {
      canvas.current.releasePointerCapture(active.id);
    } catch {}
  };
  const pointerDown = event => {
    if (menuOpen) {
      event.preventDefault();
      setMenuOpen(false);
      return;
    }
    if (event.isPrimary === false || event.button > 0 || drag.current) return;
    const element = canvas.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1 || rect.width <= 0 || rect.height <= 0) return;
    event.preventDefault();
    try {
      element.setPointerCapture(event.pointerId);
    } catch {}
    drag.current = {
      id: event.pointerId,
      type: selected,
      anchor: {
        x,
        y
      },
      carry: 0,
      lastTone: performance.now()
    };
    keyboard.current = {
      x,
      y,
      visible: false
    };
    if (addPlant(x, y, selected)) {
      syncStats();
      tone(selected);
    }
  };
  const pointerMove = event => {
    const active = drag.current;
    const rect = canvas.current?.getBoundingClientRect();
    if (!active || active.id !== event.pointerId || event.isPrimary === false || !rect || rect.width <= 0 || rect.height <= 0) return;
    event.preventDefault();
    const native = event.nativeEvent || event;
    const coalesced = native.getCoalescedEvents?.() || [];
    const points = [...coalesced.slice(-64), event];
    let changed = false;
    for (const point of points) {
      const x = (point.clientX - rect.left) / rect.width;
      const y = (point.clientY - rect.top) / rect.height;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        active.anchor = null;
        active.carry = 0;
        continue;
      }
      if (!active.anchor) {
        changed = addPlant(x, y, active.type, true) || changed;
        active.anchor = {
          x,
          y
        };
        continue;
      }
      const value = (x - active.anchor.x) * rect.width;
      const value2 = (y - active.anchor.y) * rect.height;
      const distance = Math.hypot(value, value2);
      const spacing = (active.type === "grass" ? 10 : 28) * plantScale();
      if (distance < 0.001) continue;
      let steps = 0;
      let lastSample = 0;
      for (let value3 = (active.spacing || spacing) - active.carry; value3 <= distance && steps < 128; value3 += active.spacing || spacing, steps++) {
        const value4 = value3 / distance;
        changed = addPlant(active.anchor.x + (x - active.anchor.x) * value4, active.anchor.y + (y - active.anchor.y) * value4, active.type, true) || changed;
        lastSample = value3;
        if (isFlower(active.type)) active.spacing = randomBetween(20, 40) * plantScale();
      }
      active.carry = steps >= 128 ? 0 : steps ? distance - lastSample : active.carry + distance;
      active.anchor = {
        x,
        y
      };
      keyboard.current = {
        x,
        y,
        visible: false
      };
    }
    if (changed) {
      syncStats();
      if (performance.now() - active.lastTone >= 260) {
        tone(active.type);
        active.lastTone = performance.now();
      }
    }
  };
  const pointerUp = event => {
    if (drag.current?.id === event.pointerId) {
      pointerMove(event);
      releasePointer();
    }
  };
  const pointerCancel = event => {
    if (drag.current?.id === event.pointerId) releasePointer();
  };
  const keyDown = event => {
    if (menuOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        pickerButton.current?.focus();
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const cursor = keyboard.current;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      cursor.visible = true;
      cursor.x = clamp(cursor.x + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0) * 12 / rect.width, 0.05, 0.95);
      cursor.y = clamp(cursor.y + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0) * 12 / rect.height, 0.05, 0.95);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (event.repeat) return;
      cursor.visible = true;
      if (addPlant(cursor.x, cursor.y)) {
        syncStats();
        tone(selected);
      }
    } else if (event.key === "Escape") {
      cursor.visible = false;
      releasePointer();
    }
  };
  const spawnBug = React.useCallback((type, targets) => {
    if (!targets.length || bugs.current.length >= 14) return;
    const target = targets[Math.floor(Math.random() * targets.length)];
    bugs.current.push({
      type,
      x: clamp(target.x + randomBetween(-0.06, 0.06), 0.04, 0.96),
      y: clamp(target.y + randomBetween(-0.06, 0.06), 0.04, 0.96),
      target,
      born: performance.now(),
      phase: randomBetween(0, Math.PI * 2),
      heading: randomBetween(0, Math.PI * 2),
      nextTarget: performance.now() + randomBetween(1400, 2800)
    });
  }, []);
  const clear = () => {
    releasePointer();
    stopSound(true);
    setMenuOpen(false);
    plants.current = [];
    grass.current = [];
    grassCache.current.canvas = null;
    grassCache.current.seen.clear();
    bugs.current = [];
    keyboard.current.visible = false;
    lastSpawn.current = performance.now();
    intro.current.active = true;
    intro.current.elapsed = 0;
    setHasGrowth(false);
    syncStats();
    tone("clear");
  };
  const closePicker = () => {
    setMenuOpen(false);
    pickerButton.current?.focus();
  };
  const selectType = type => {
    if (choices.some(choice => choice.id === type)) {
      setSelected(type);
      closePicker();
      tone("select", type);
    }
  };
  const openPicker = index => {
    releasePointer();
    menuStart.current = index;
    setMenuOpen(true);
  };
  const pickerKeys = event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openPicker(event.key === "ArrowDown" ? 0 : choices.length - 1);
    } else if (event.key === "Escape" && menuOpen) {
      event.preventDefault();
      closePicker();
    }
  };
  const optionKeys = (event, index) => {
    let next;
    if (event.key === "ArrowDown") next = (index + 1) % choices.length;else if (event.key === "ArrowUp") next = (index + choices.length - 1) % choices.length;else if (event.key === "Home") next = 0;else if (event.key === "End") next = choices.length - 1;else if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
      return;
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectType(choices[index].id);
      return;
    }
    if (next !== undefined) {
      event.preventDefault();
      optionButtons.current[choices[next].id]?.focus();
    }
  };
  React.useEffect(() => {
    if (menuOpen) {
      const index = menuStart.current ?? choices.findIndex(choice => choice.id === selected);
      menuStart.current = null;
      optionButtons.current[choices[index]?.id]?.focus();
    }
  }, [menuOpen]);
  React.useEffect(() => {
    let live = true;
    sound.current.disposed = false;
    const ageOf = (plant, otherValue) => reduced.current ? 1 : clamp((otherValue - plant.born) * growth / plant.duration, 0, 1);
    const drawGrass = (context, plant, argument3, scale, argument5, argument6) => {
      const value = ageOf(plant, argument3);
      if (value <= 0) return;
      const ease = 1 - Math.pow(1 - value, 3);
      const radius = plant.radius * scale;
      context.save();
      context.translate(plant.x * argument5, plant.y * argument6);
      const points = plant.core.map(item => ({
        x: Math.cos(item.angle) * item.radius * radius * 0.3 * ease,
        y: Math.sin(item.angle) * item.radius * radius * 0.3 * ease
      }));
      const last = points.at(-1);
      context.fillStyle = "#91c346";
      context.beginPath();
      context.moveTo((last.x + points[0].x) / 2, (last.y + points[0].y) / 2);
      for (let value2 = 0; value2 < points.length; value2++) {
        const point = points[value2];
        const next = points[(value2 + 1) % points.length];
        context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
      }
      context.closePath();
      context.fill();
      const palette = ["#8dbc43", "#97c74a", "#9dcc4d", "#89b941"];
      const center = [149, 196, 71];
      const blend = (color, amount) => "#" + center.map((target, index) => Math.round(parseInt(color.slice(1 + index * 2, 3 + index * 2), 16) * (1 - amount) + target * amount).toString(16).padStart(2, "0")).join("");
      const tones = palette.map(color => {
        const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius * ease);
        gradient.addColorStop(0, blend(color, 0.45));
        gradient.addColorStop(0.18, blend(color, 0.45));
        gradient.addColorStop(0.5, blend(color, 0.2));
        gradient.addColorStop(0.8, color);
        gradient.addColorStop(1, color);
        return gradient;
      });
      for (const blade of plant.blades) {
        const progress = clamp((value - blade.delay) / (1 - blade.delay), 0, 1);
        const value2 = 1 - Math.pow(1 - progress, 3);
        const angle = blade.angle;
        const value3 = Math.cos(angle);
        const value4 = Math.sin(angle);
        const root = blade.root * radius * value2;
        const length = blade.length * radius * value2;
        const width = blade.halfWidth * radius * value2;
        const bend = blade.bend * radius * value2;
        if (length < 0.1) continue;
        context.fillStyle = tones[blade.tint];
        context.beginPath();
        context.moveTo(value3 * root - value4 * width, value4 * root + value3 * width);
        context.lineTo(value3 * length - value4 * bend, value4 * length + value3 * bend);
        context.lineTo(value3 * root + value4 * width, value4 * root - value3 * width);
        context.closePath();
        context.fill();
      }
      context.restore();
    };
    const drawPlant = (context, plant, argument3, scale, argument5, argument6) => {
      const value = ageOf(plant, argument3);
      if (value <= 0) return;
      const radius = plant.radius * scale * (1 - Math.pow(1 - value, 3));
      context.save();
      context.translate(plant.x * argument5, plant.y * argument6);
      context.rotate(plant.phase);
      if (plant.type === "daisy" && images.current.flower?.complete && images.current.flower.naturalWidth) {
        context.drawImage(images.current.flower, -radius, -radius, radius * 2, radius * 2);
      } else {
        context.fillStyle = plant.type === "sunflower" ? "#ffd75a" : plant.type === "tulip" ? ["#e824a7", "#ee524f", "#b541d4"][plant.tint] : ["#54bbee", "#f45867", "#fff7df"][plant.tint];
        const petals = plant.type === "sunflower" ? 5 : plant.type === "tulip" ? 4 : 5;
        for (let value2 = 0; value2 < petals; value2++) {
          const value3 = value2 / petals * Math.PI * 2;
          context.beginPath();
          context.ellipse(Math.cos(value3) * radius * 0.5, Math.sin(value3) * radius * 0.5, radius * 0.54, radius * 0.35, value3, 0, Math.PI * 2);
          context.fill();
        }
        context.fillStyle = plant.type === "sunflower" ? "#e9a83d" : "#ffe17a";
        context.beginPath();
        context.arc(0, 0, radius * 0.26, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    };
    const drawBug = (context, point, argument3, scale, argument5, argument6) => {
      const size = (point.type === "ladybug" ? 16 : point.type === "bee" ? 20 : 19) * scale;
      const image = images.current[point.type];
      const flutter = reduced.current ? 1 : 0.55 + Math.abs(Math.sin(argument3 / 140 + point.phase)) * 0.45;
      context.save();
      context.translate(point.x * argument5, point.y * argument6);
      context.rotate(point.heading);
      if (image?.complete && image.naturalWidth) context.drawImage(image, -size / 2, -size / 2, size, size);else if (point.type === "butterfly") {
        for (const side of [-1, 1]) {
          context.fillStyle = point.phase < Math.PI ? "#c826bb" : "#45b9ed";
          context.beginPath();
          context.ellipse(side * size * 0.23 * flutter, -size * 0.1, size * 0.27 * flutter, size * 0.4, side * 0.35, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = point.phase < Math.PI ? "#e255d4" : "#98dbf5";
          context.beginPath();
          context.ellipse(side * size * 0.18 * flutter, size * 0.22, size * 0.2 * flutter, size * 0.23, -side * 0.3, 0, Math.PI * 2);
          context.fill();
        }
        context.strokeStyle = "#48463b";
        context.lineWidth = 1.5 * scale;
        context.beginPath();
        context.moveTo(0, -size * 0.4);
        context.lineTo(0, size * 0.35);
        context.stroke();
      } else {
        context.fillStyle = point.type === "bee" ? "#ffd65c" : "#ec574b";
        context.beginPath();
        context.ellipse(0, 0, size * 0.28, size * 0.42, 0, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#424533";
        context.lineWidth = 1.2 * scale;
        context.beginPath();
        if (point.type === "bee") {
          context.moveTo(-size * 0.25, 0);
          context.lineTo(size * 0.25, 0);
          context.moveTo(-size * 0.23, size * 0.2);
          context.lineTo(size * 0.23, size * 0.2);
        } else {
          context.moveTo(0, -size * 0.4);
          context.lineTo(0, size * 0.4);
        }
        context.stroke();
        context.fillStyle = "#424533";
        context.beginPath();
        context.arc(0, -size * 0.35, size * 0.16, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    };
    const drawIntro = (value, otherValue, argument3, scale, argument5, argument6) => {
      const state = intro.current;
      if (!state.active) return;
      if (!state.scene) {
        const curves = [[[0.28, 0.56], [0.25, 0.44], [0.64, 0.6], [0.6, 0.46]], [[0.6, 0.46], [0.55, 0.35], [0.31, 0.48], [0.37, 0.36]]];
        const path = Array.from({
          length: 129
        }, (value2, otherValue2) => {
          const progress = otherValue2 / 128 * 2;
          const segment = Math.min(1, Math.floor(progress));
          const value3 = progress - segment;
          const value4 = 1 - value3;
          const item = curves[segment];
          return [0, 1].map(axis => value4 * value4 * value4 * item[0][axis] + 3 * value4 * value4 * value3 * item[1][axis] + 3 * value4 * value3 * value3 * item[2][axis] + value3 * value3 * value3 * item[3][axis]);
        });
        path[0][2] = 0;
        for (let value2 = 1; value2 < path.length; value2++) path[value2][2] = path[value2 - 1][2] + Math.hypot((path[value2][0] - path[value2 - 1][0]) * 390, (path[value2][1] - path[value2 - 1][1]) * 598);
        const tufts = Array.from({
          length: 44
        }, (value2, otherValue2) => {
          const distance = otherValue2 / 43 * path.at(-1)[2];
          const index = Math.max(1, path.findIndex(item3 => item3[2] >= distance));
          const item = path[index - 1];
          const item2 = path[index];
          const value3 = (distance - item[2]) / (item2[2] - item[2]);
          return [item[0] + (item2[0] - item[0]) * value3, item[1] + (item2[1] - item[1]) * value3];
        });
        const flowers = [[0.32, 0.51, "daisy"], [0.52, 0.51, "tulip"], [0.55, 0.44, "sunflower"], [0.4, 0.4, "daisy"]];
        state.scene = [...tufts.map(([x, y], index) => ({
          ...makePlant(x, y, "grass", 5101 + index),
          radius: 29,
          delay: index * 45,
          duration: 440
        })), ...flowers.map(([x, y, type], index) => ({
          ...makePlant(x, y, type, 5201 + index),
          radius: 10,
          delay: 900 + index * 350,
          duration: 760
        }))];
      }
      if (!reduced.current) state.elapsed += argument3;
      const cycle = reduced.current ? 2400 : state.elapsed % 8000;
      const fade = reduced.current ? 1 : Math.min(1, cycle / 220, (8000 - cycle) / 900);
      value.save();
      value.globalAlpha = fade;
      for (const plant of state.scene) {
        plant.born = otherValue - cycle + plant.delay;
        (plant.type === "grass" ? drawGrass : drawPlant)(value, plant, otherValue, scale, argument5, argument6);
      }
      if (cycle > 1700) {
        const value2 = cycle / 1000;
        for (const [i, type] of ["bee", "butterfly", "ladybug"].entries()) {
          const angle = value2 * (i === 2 ? 0.35 : 0.7) + i * 2.1;
          const value3 = i === 2 ? 0.1 : 0.19;
          const value4 = i === 2 ? 0.07 : 0.135;
          drawBug(value, {
            type,
            x: 0.45 + Math.cos(angle) * value3,
            y: 0.49 + Math.sin(angle) * value4,
            phase: i * 1.8,
            heading: Math.atan2(Math.cos(angle) * value4, -Math.sin(angle) * value3) + Math.PI / 2
          }, otherValue, scale * 1.15, argument5, argument6);
        }
      }
      value.restore();
    };
    const frame = value => {
      stateRef.current = 0;
      if (!live || !canvas.current || document.hidden) return;
      const element = canvas.current;
      const rect = element.getBoundingClientRect();
      const width2 = rect.width;
      const height2 = rect.height;
      const value2 = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(width2 * value2);
      const height = Math.round(height2 * value2);
      if (width2 <= 0 || height2 <= 0) {
        stateRef.current = requestAnimationFrame(frame);
        return;
      }
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }
      const context = element.getContext("2d");
      if (!context) {
        stateRef.current = requestAnimationFrame(frame);
        return;
      }
      context.setTransform(value2, 0, 0, value2, 0, 0);
      context.clearRect(0, 0, width2, height2);
      const value3 = Math.min(50, Math.max(0, value - (lastFrame.current || value)));
      const scale = plantScale();
      lastFrame.current = value;
      drawIntro(context, value, value3, scale, width2, height2);
      const cache = grassCache.current;
      if (!cache.canvas || cache.canvas.width !== width || cache.canvas.height !== height || cache.scale !== scale) {
        cache.canvas = document.createElement("canvas");
        cache.canvas.width = width;
        cache.canvas.height = height;
        cache.scale = scale;
        cache.seen.clear();
      }
      const ground = cache.canvas.getContext("2d");
      ground.setTransform(value2, 0, 0, value2, 0, 0);
      for (const plant of grass.current) if (ageOf(plant, value) >= 1 && !cache.seen.has(plant.id)) {
        drawGrass(ground, plant, value, scale, width2, height2);
        cache.seen.add(plant.id);
      }
      context.drawImage(cache.canvas, 0, 0, width2, height2);
      for (const plant of grass.current) if (!cache.seen.has(plant.id)) drawGrass(context, plant, value, scale, width2, height2);
      for (const plant of plants.current) drawPlant(context, plant, value, scale, width2, height2);
      const targets = [...plants.current, ...grass.current].filter(item => ageOf(item, value) > 0.7);
      const desired = Math.min(10, targets.length ? Math.floor(grass.current.length / 16 + plants.current.length / 4) + 1 : 0);
      if (bugs.current.length < desired && value - lastSpawn.current > 750) {
        spawnBug(["butterfly", "ladybug", "bee"][bugs.current.length % 3], targets);
        lastSpawn.current = value;
        syncStats();
      }
      for (const point of bugs.current) {
        if (targets.length && (!targets.includes(point.target) || value > point.nextTarget)) {
          point.target = targets[Math.floor(Math.random() * targets.length)];
          point.nextTarget = value + randomBetween(1400, 3000);
        }
        const target = point.target || point;
        const value4 = (target.x - point.x) * width2;
        const value5 = (target.y - point.y) * height2;
        const distance = Math.hypot(value4, value5);
        const speed = (point.type === "ladybug" ? 5 : 13) + wander * 110;
        if (!reduced.current && distance > 0.5) {
          const travel = Math.min(distance, speed * value3 / 1000);
          point.x += value4 / distance * travel / width2;
          point.y += value5 / distance * travel / height2;
          point.heading = Math.atan2(value5, value4) + Math.PI / 2;
        }
        drawBug(context, point, value, scale, width2, height2);
      }
      if (keyboard.current.visible) {
        context.save();
        context.strokeStyle = "#424533";
        context.lineWidth = 1.5;
        context.setLineDash([3, 4]);
        context.beginPath();
        context.arc(keyboard.current.x * width2, keyboard.current.y * height2, 9 * scale, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
      stateRef.current = requestAnimationFrame(frame);
    };
    const visibility = () => {
      lastFrame.current = 0;
      if (document.hidden) {
        cancelAnimationFrame(stateRef.current);
        stateRef.current = 0;
      } else if (live && !stateRef.current) stateRef.current = requestAnimationFrame(frame);
    };
    intro.current.visibility = visibility;
    if (!document.hidden) stateRef.current = requestAnimationFrame(frame);
    return () => {
      live = false;
      if (intro.current.visibility === visibility) intro.current.visibility = null;
      cancelAnimationFrame(stateRef.current);
      releasePointer();
      stopSound();
      sound.current.disposed = true;
      sound.current.buffers.clear();
      sound.current.musicBuffer = null;
      if (audio.current) {
        Promise.resolve(audio.current.close()).catch(() => {});
        audio.current = null;
      }
    };
  }, [growth, wander, spawnBug, syncStats, stopSound]);
  React.useEffect(() => {
    sound.current.disposed = false;
    const hide = () => {
      intro.current.visibility?.();
      if (document.hidden) {
        releasePointer();
        stopSound();
      }
    };
    const leave = () => {
      releasePointer();
      stopSound();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    window.addEventListener("blur", leave);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("blur", leave);
    };
  }, [stopSound]);
  return <React.Fragment>{<style>{`
@font-face{font-family:DynaPuff;src:url('./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2') format('woff2');font-display:swap}
html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#d6d6d3}
*{box-sizing:border-box}
.sandbox{--u:min(.2564102564vw,.1672240803vh);--field:#d6d6d3;--ink:#343a31;--control:#595e54;position:relative;width:100%;height:100%;padding:0;border:0;overflow:hidden;background:var(--field);background-size:cover;background-position:center;font-family:DynaPuff,system-ui,sans-serif;color:var(--ink);user-select:none}
.plant-controls{position:absolute;z-index:2;top:calc(30 * var(--u) + env(safe-area-inset-top,0px));left:calc(30 * var(--u) + env(safe-area-inset-left,0px));right:calc(30 * var(--u) + env(safe-area-inset-right,0px));display:grid;grid-template-columns:minmax(0,152px) minmax(0,96px);justify-content:space-between;align-items:start;gap:12px;pointer-events:none}
.sandbox button{min-width:0;min-height:44px;padding:8px 12px;border:0;border-radius:24px;font:600 15px/1.3 DynaPuff,system-ui,sans-serif;background:var(--control);color:#fff;touch-action:manipulation;cursor:pointer;overflow-wrap:anywhere;white-space:normal;pointer-events:auto;-webkit-tap-highlight-color:transparent}
.plant-picker{position:relative;min-width:0;pointer-events:auto}.plant-select{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left}.plant-select span{min-width:0}.plant-select svg{width:12px;height:12px;flex:none;transition:transform .12s}.plant-select[aria-expanded=true] svg{transform:rotate(180deg)}
.plant-menu{position:absolute;z-index:3;top:calc(100% + 8px);left:0;width:max(164px,100%);max-width:calc(100vw - 60 * var(--u) - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px));margin:0;padding:4px;background:#f4f5f1;border-radius:14px;box-shadow:0 3px 12px #343a3126}
.sandbox .plant-option{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:44px;border-radius:10px;background:transparent;color:var(--ink);text-align:left}.plant-option[aria-checked=true]{background:#dce9cb}.plant-option[aria-checked=true]::after{content:"";width:7px;height:7px;border-radius:50%;background:var(--ink);flex:none;margin-left:8px}.sandbox button:active{filter:brightness(.88)}.sandbox button:focus-visible{outline:3px solid var(--ink);outline-offset:3px}.sandbox .plant-option:focus-visible{outline-offset:-3px}
.garden-stage{position:absolute;inset:0;z-index:0;border:0;border-radius:0;overflow:visible}
.garden-stage canvas{width:100%;height:100%;display:block;border:0;touch-action:none;cursor:crosshair}
.garden-stage canvas:focus-visible{outline:3px solid var(--ink);outline-offset:-3px}
.sandbox-guide{
  grid-column:1/-1;
  box-sizing:border-box;
  margin:0;
  padding:8px 14px;
  border-radius:999px;
  background:#f4f5f1;
  text-align:center;
  line-height:1.4;
  font-size:calc(18 * var(--u));
  text-wrap:balance;
  overflow-wrap:anywhere;
  pointer-events:none;
}
.sandbox-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media(max-width:340px){.plant-controls{gap:8px}.sandbox button{padding-left:9px;padding-right:9px}}
@media(prefers-reduced-motion:reduce){.plant-select svg{transition:none}}
`}</style>}{<main className={"sandbox"} onPointerDownCapture={event => {
      if (menuOpen && !picker.current?.contains(event.target)) setMenuOpen(false);
    }} style={{
      backgroundImage: config.BG_MAIN ? 'url("' + config.BG_MAIN + '")' : undefined
    }}>{<section className={"plant-controls"} aria-label={"Strumenti del prato"}>{<div className={"plant-picker"} ref={picker} onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
        }}>{<button type={"button"} className={"plant-select"} ref={pickerButton} aria-label={"Choose plant type: " + choices.find(choice => choice.id === selected).label} aria-haspopup={"menu"} aria-expanded={menuOpen} aria-controls={"plant-menu"} onClick={() => menuOpen ? closePicker() : openPicker(choices.findIndex(choice => choice.id === selected))} onKeyDown={pickerKeys}>{<span>{choices.find(choice => choice.id === selected).label}</span>}{<svg viewBox={"0 0 12 12"} aria-hidden={"true"}>{<path d={"m2 4 4 4 4-4"} fill={"none"} stroke={"currentColor"} strokeWidth={2} strokeLinecap={"round"} strokeLinejoin={"round"} />}</svg>}</button>}{menuOpen ? <div id={"plant-menu"} className={"plant-menu"} role={"menu"} aria-label={"Tipo di pianta"}>{choices.map((choice, index) => <button key={choice.id} type={"button"} className={"plant-option"} role={"menuitemradio"} aria-checked={selected === choice.id} tabIndex={-1} ref={node => {
              optionButtons.current[choice.id] = node;
            }} onClick={() => selectType(choice.id)} onKeyDown={event => optionKeys(event, index)}>{choice.label}</button>)}</div> : null}</div>}{<button type={"button"} onClick={clear}>{config.BTN_CLEAR || "Ricomincia"}</button>}{<p className={"sandbox-guide"} style={{
          visibility: hasGrowth || menuOpen ? "hidden" : "visible"
        }}>{"Tocca o trascina per piantare"}</p>}</section>}{<div className={"garden-stage"}>{<canvas ref={canvas} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel} onLostPointerCapture={pointerCancel} onKeyDown={keyDown} onBlur={() => {
          keyboard.current.visible = false;
        }} tabIndex={0} role={"button"} aria-label={"Tap or drag to place " + selected} aria-description={"Use arrow keys to move the planting cursor, then Enter or Space to place the selected plant."} />}</div>}{<div className={"sandbox-status"} role={"status"} aria-live={"polite"} aria-atomic={"true"}>{stats.plants + " fiori, " + (stats.grass ? "erba piantata" : "senza erba") + ", " + stats.bugs + " visitatori"}</div>}</main>}</React.Fragment>;
}
function App() {
  let [config, setConfig] = React.useState(null);
  React.useEffect(() => {
    let enabled = true;
    requestGameConfig().then(response => response.json()).catch(() => ({})).then(response => {
      if (enabled) {
        setConfig(readConfigValues(response));
      }
    });
    return () => {
      enabled = false;
    };
  }, []);
  return config ? <CreatureMeadow cfg={config} /> : <div style={{
    width: "100%",
    height: "100%",
    background: "#dff3dc"
  }} />;
}

// creature-preview-controls

(() => {
  const query = new URLSearchParams(location.search);
  if (window.parent === window || !/^batch(?:-[a-z0-9-]+)?$/i.test(query.get('review') || '') && query.get('feedReview') !== '1') return;
  const root = document.documentElement;
  root.dataset.creaturePreview = 'true';
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    root.dataset.creaturePreview = event.data.active === true ? 'false' : 'true';
  });
})();

// ./guide-breathing.js
/* Decorative guide visibility only: no inputs, timers, sound or game state. */
(() => {
  const root = document.documentElement;
  let intersecting = true;
  const update = () => root.toggleAttribute('data-guide-breathing-paused', document.hidden || !intersecting);
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    intersecting = entries.some(entry => entry.isIntersecting);
    update();
  }) : null;
  if (document.body) observer?.observe(document.body);
  document.addEventListener('visibilitychange', update);
  update();
  window.addEventListener('pagehide', () => {
    observer?.disconnect();
    document.removeEventListener('visibilitychange', update);
  }, {
    once: true
  });
})();
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": ".plant-picker, .sandbox-guide",
        "data-game": ""
      }[name] ?? null;
    },
    dataset: {
      game: ""
    }
  };
  const selector = script?.getAttribute('data-subject') || '#root canvas';
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let observer;
  let animation;
  let entered = false;
  function stop() {
    animation?.cancel();
    animation = null;
  }
  function enter() {
    if (entered || document.hidden) return;
    const subject = document.querySelector(selector);
    if (!subject || subject.closest('[hidden], [aria-hidden="true"]')) return;
    const computed = window.getComputedStyle(subject);
    if (computed.display === 'none' || computed.visibility === 'hidden') return;
    if (subject.tagName === 'IMG' && !subject.complete) {
      subject.addEventListener('load', enter, {
        once: true
      });
      return;
    }
    entered = true;
    observer?.disconnect();
    if (media?.matches) return;
    const opacity = Number(window.getComputedStyle(subject).opacity) || 1;
    if (typeof subject.animate === 'function') {
      animation = subject.animate([{
        opacity: opacity * 0.76
      }, {
        opacity
      }], {
        duration: 650,
        easing: 'ease-out'
      });
      animation.onfinish = () => {
        animation = null;
      };
    }
  }
  observer = new MutationObserver(enter);
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  enter();
  document.addEventListener('visibilitychange', () => {
    document.documentElement.toggleAttribute('data-feed-background', document.hidden);
    if (document.hidden) stop();else enter();
  });
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    stop();
  });
  window.addEventListener('pageshow', () => {
    if (!entered) observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    enter();
  });
  document.addEventListener('pointerdown', stop, {
    capture: true,
    passive: true
  });
  media?.addEventListener?.('change', () => {
    if (media.matches) stop();
  });
})();

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = [".sandbox-guide"];
  const copy = new Set([].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map();
  let queued = false;
  let visible = true;
  const action = /^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;
  function scan() {
    queued = false;
    for (const [el, a] of running) if (!el.isConnected) {
      a.cancel();
      running.delete(el);
    }
    if (motion.matches) {
      for (const value of running.values()) value.cancel();
      running.clear();
      return;
    }
    const targets = new Set();
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(item => targets.add(item));
      } catch {}
    }
    for (const value of document.querySelectorAll('p,span,div,label,text')) {
      if (value.children.length || value.closest('button,a,input,select,textarea,[role="button"]')) continue;
      const text = (value.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 5 && text.length <= 140 && (copy.has(text.toLowerCase()) || !selectors.length && action.test(text))) targets.add(value);
    }
    for (const value of targets) {
      if (running.has(value) || typeof value.animate !== 'function') continue;
      if ([...targets].some(child => child !== value && value.contains(child))) continue;
      const style = getComputedStyle(value);
      if (/breath/i.test(style.animationName)) continue;
      const base = style.filter.replace(/opacity\([^)]*\)/g, '').replace(/^none$/, '').trim();
      const filter = value3 => (base ? base + ' ' : '') + 'opacity(' + value3 + ')';
      const value2 = value.animate([{
        filter: filter(1)
      }, {
        filter: filter(0.65)
      }, {
        filter: filter(1)
      }], {
        duration: 2400,
        iterations: Infinity,
        easing: 'ease-in-out'
      });
      running.set(value, value2);
      if (document.hidden || !visible) value2.pause();
    }
  }
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  };
  const pause = () => {
    for (const value of running.values()) {
      if (document.hidden || !visible) {
        value.pause();
      } else {
        value.play();
      }
    }
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    visible = entries.some(item => item.isIntersecting);
    pause();
  }) : null;
  if (document.body) intersection?.observe(document.body);else document.addEventListener('DOMContentLoaded', () => intersection?.observe(document.body), {
    once: true
  });
  document.addEventListener('visibilitychange', pause);
  motion.addEventListener?.('change', schedule);
  schedule();
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    intersection?.disconnect();
    for (const value of running.values()) value.cancel();
    running.clear();
  }, {
    once: true
  });
})();
