// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
// Older hosts can still size the scene on mount and window resize.
function observeGameSize(callback) {
  if (typeof ResizeObserver === 'function') return new ResizeObserver(callback);

  const targets = new Set();
  let frame;
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const entries = Array.from(targets, target => ({
        target,
        contentRect: { width: target.clientWidth, height: target.clientHeight }
      }));
      if (entries.length) callback(entries);
    });
  }
  return {
    observe(target) {
      targets.add(target);
      window.addEventListener('resize', schedule);
      schedule();
    },
    disconnect() {
      targets.clear();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
    }
  };
}

const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "KOI_COUNT",
    "kind": "number",
    "label": "Koi Count",
    "value": 4,
    "default": 4,
    "min": 1,
    "max": 10,
    "step": 1
  }, {
    "id": "KOI_BASE_SPEED",
    "kind": "number",
    "label": "Koi Base Speed",
    "value": 0.08,
    "default": 0.08,
    "min": 0.02,
    "max": 0.2,
    "step": 0.01
  }],
  "texts": [{
    "id": "TXT_SCORE_LABEL",
    "label": "Score Label",
    "value": "Punti",
    "default": "Punti",
    "max_length": 10
  }, {
    "id": "TXT_FOOD_PELLETS",
    "label": "Food Name Pellets",
    "value": "Mangime",
    "default": "Mangime",
    "max_length": 15
  }, {
    "id": "TXT_FOOD_CHILI",
    "label": "Food Name Chili",
    "value": "Peperoncino",
    "default": "Peperoncino",
    "max_length": 15
  }, {
    "id": "TXT_FOOD_ICE",
    "label": "Food Name Ice",
    "value": "Ghiaccio",
    "default": "Ghiaccio",
    "max_length": 15
  }, {
    "id": "TXT_FOOD_GHOST",
    "label": "Food Name Ghost",
    "value": "Fantasma",
    "default": "Fantasma",
    "max_length": 15
  }, {
    "id": "TXT_FOOD_DISCO",
    "label": "Food Name Disco",
    "value": "Disco",
    "default": "Disco",
    "max_length": 15
  }, {
    "id": "TXT_FOOD_DONUT",
    "label": "Food Name Donut",
    "value": "Ciambella",
    "default": "Ciambella",
    "max_length": 15
  }, {
    "id": "TXT_FOOD_STAR",
    "label": "Food Name Star",
    "value": "Stella",
    "default": "Stella",
    "max_length": 15
  }, {
    "id": "TXT_FOOD_SODA",
    "label": "Food Name Soda",
    "value": "Bibita",
    "default": "Bibita",
    "max_length": 15
  }, {
    "id": "TXT_FOOD_SOAP",
    "label": "Food Name Soap",
    "value": "Sapone",
    "default": "Sapone",
    "max_length": 15
  }, {
    "id": "TXT_FOOD_MAGNET",
    "label": "Food Name Magnet",
    "value": "Magnete",
    "default": "Magnete",
    "max_length": 15
  }, {
    "id": "TXT_FOOD_MIX",
    "label": "Food Name Mix",
    "value": "Mix",
    "default": "Mix",
    "max_length": 15
  }],
  "images": [{
    "id": "BG_WATER",
    "label": "Water Background",
    "path": "./assets/cartoon-pond-v1.webp",
    "replaceable": true
  }, {
    "id": "KOI_FISH",
    "label": "Koi Sprite",
    "path": "./assets/cartoon-koi-v1.webp",
    "replaceable": true
  }, {
    "id": "LILY_PAD",
    "label": "Lily Pad",
    "path": "./assets/cartoon-lily-pad-v1.webp",
    "replaceable": true
  }, {
    "id": "FX_STAR_HALO",
    "label": "Star Halo FX",
    "path": "./assets/cartoon-star-halo-v1.webp",
    "replaceable": true
  }, {
    "id": "FX_ICE",
    "label": "Ice Block FX",
    "path": "./assets/cartoon-ice-effect-v1.webp",
    "replaceable": true
  }, {
    "id": "ICON_PELLET",
    "label": "Icon Pellets",
    "path": "./assets/cartoon-pellets-v1.webp",
    "replaceable": true
  }, {
    "id": "ICON_CHILI",
    "label": "Icon Chili",
    "path": "./assets/cartoon-chili-v1.webp",
    "replaceable": true
  }, {
    "id": "ICON_ICE",
    "label": "Icon Ice",
    "path": "./assets/cartoon-ice-v1.webp",
    "replaceable": true
  }, {
    "id": "ICON_GHOST",
    "label": "Icon Ghost",
    "path": "./assets/cartoon-ghost-v1.webp",
    "replaceable": true
  }, {
    "id": "ICON_DISCO",
    "label": "Icon Disco",
    "path": "./assets/cartoon-disco-v1.webp",
    "replaceable": true
  }, {
    "id": "ICON_DONUT",
    "label": "Icon Donut",
    "path": "./assets/cartoon-donut-v1.webp",
    "replaceable": true
  }, {
    "id": "ICON_STAR",
    "label": "Icon Star",
    "path": "./assets/cartoon-star-v1.webp",
    "replaceable": true
  }, {
    "id": "ICON_SODA",
    "label": "Icon Soda",
    "path": "./assets/cartoon-soda-v1.webp",
    "replaceable": true
  }, {
    "id": "ICON_SOAP",
    "label": "Icon Soap",
    "path": "./assets/cartoon-soap-v1.webp",
    "replaceable": true
  }, {
    "id": "ICON_MAGNET",
    "label": "Icon Magnet",
    "path": "./assets/cartoon-magnet-v1.webp",
    "replaceable": true
  }, {
    "id": "ICON_MIX",
    "label": "Icon Mix",
    "path": "./assets/cartoon-mix-v1.webp",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "post_id": "103313693563206036",
    "version_id": "103313693563295272",
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
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #438e96; -webkit-tap-highlight-color: transparent; }
  
/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.koi-guide{position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.koi-guide{box-sizing:border-box!important;background:#fff!important;color:#293c34!important;padding:6px 14px!important;border:0!important;border-radius:999px!important;box-shadow:0 2px 10px rgba(0,0,0,.08)!important;text-shadow:none!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(p.koi-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(p.koi-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(p.koi-guide){animation:none!important}}

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
  (config.tweaks || []).forEach(item => {
    values[item.id] = item.value;
  });
  (config.texts || []).forEach(item => {
    values[item.id] = item.value;
  });
  (config.images || []).forEach(item => {
    values[item.id] = item.path;
  });
  (config.mentions || []).forEach(item => {
    values[item.id] = item.path != null && item.path !== "" ? item.path : item.value;
  });
  (config.motions || []).forEach(item => {
    if (!(!item || !item.id)) {
      if (item.base_path != null && item.base_path !== "") {
        values[item.id] = item.base_path;
        values[item.id + "_BASE"] = item.base_path;
      }
      if (item.frame_count != null) {
        values[item.id + "_COUNT"] = item.frame_count;
      }
    }
  });
  return values;
}
var FOOD_ITEMS = [{
  id: "pellets",
  textId: "TXT_FOOD_PELLETS",
  imgId: "ICON_PELLET"
}, {
  id: "chili",
  textId: "TXT_FOOD_CHILI",
  imgId: "ICON_CHILI"
}, {
  id: "ice",
  textId: "TXT_FOOD_ICE",
  imgId: "ICON_ICE"
}, {
  id: "ghost",
  textId: "TXT_FOOD_GHOST",
  imgId: "ICON_GHOST"
}, {
  id: "disco",
  textId: "TXT_FOOD_DISCO",
  imgId: "ICON_DISCO"
}, {
  id: "donut",
  textId: "TXT_FOOD_DONUT",
  imgId: "ICON_DONUT"
}, {
  id: "star",
  textId: "TXT_FOOD_STAR",
  imgId: "ICON_STAR"
}, {
  id: "soda",
  textId: "TXT_FOOD_SODA",
  imgId: "ICON_SODA"
}, {
  id: "magnet",
  textId: "TXT_FOOD_MAGNET",
  imgId: "ICON_MAGNET"
}, {
  id: "mix",
  textId: "TXT_FOOD_MIX",
  imgId: "ICON_MIX"
}];
function imageReady(value) {
  return !!(value && value.complete && value.naturalWidth > 0 && value.naturalHeight > 0);
}
function drawContainedImage(value, otherValue, argument3, argument4, argument5, argument6) {
  let value2 = Math.min(argument5 / otherValue.naturalWidth, argument6 / otherValue.naturalHeight);
  let value3 = otherValue.naturalWidth * value2;
  let value4 = otherValue.naturalHeight * value2;
  value.drawImage(otherValue, argument3 - value3 / 2, argument4 - value4 / 2, value3, value4);
}
var KoiPondWorld = class {
  constructor(canvas, otherValue) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", {
      alpha: false
    });
    this.cfg = otherValue;
    this.dpr = window.devicePixelRatio || 1;
    this.width = canvas.clientWidth;
    this.height = canvas.clientHeight;
    this.assets = {};
    this.kois = [];
    this.foods = [];
    this.ripples = [];
    this.particles = [];
    this.lilyPads = [];
    this.elapsed = 0;
    this.lastTime = performance.now();
    this.rafId = null;
    this.destroyed = false;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.audioReady = false;
    this.audioPromise = null;
    this.synths = {};
    this.onVisibility = () => {
      if (this.rafId != null) {
        cancelAnimationFrame(this.rafId);
      }
      this.rafId = null;
      if (!document.hidden && !this.destroyed) {
        this.lastTime = performance.now();
        this.rafId = requestAnimationFrame(value => this.loop(value));
      }
    };
    document.addEventListener("visibilitychange", this.onVisibility);
    this.init();
  }
  init() {
    this.resize();
    this.preloadAssets();
    this.spawnKois();
    this.spawnLilyPads();
    if (!document.hidden) {
      this.rafId = requestAnimationFrame(value => this.loop(value));
    }
  }
  resize() {
    let dimensions = this.canvas.getBoundingClientRect();
    let width = this.width;
    let height = this.height;
    if (this.width = Math.max(1, this.canvas.clientWidth || dimensions.width), this.height = Math.max(1, this.canvas.clientHeight || dimensions.height), this.dpr = Math.min(window.devicePixelRatio || 1, 3), width > 0 && height > 0) {
      for (let point of [...this.kois, ...this.foods, ...this.lilyPads, ...this.particles, ...this.ripples]) {
        point.x *= this.width / width;
        point.y *= this.height / height;
      }
      for (let value of this.kois) {
        for (let point of value.trail) {
          point.x *= this.width / width;
          point.y *= this.height / height;
        }
        if (value.dashTarget) {
          value.dashTarget.x *= this.width / width;
          value.dashTarget.y *= this.height / height;
        }
      }
    }
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  preloadAssets() {
    let items = ["BG_WATER", "KOI_FISH", "LILY_PAD", "FX_STAR_HALO", "FX_ICE"];
    FOOD_ITEMS.forEach(item => items.push(item.imgId));
    items.forEach(item => {
      let item2 = this.cfg[item];
      if (item2) {
        let image = new Image();
        image.src = item2;
        this.assets[item] = image;
      }
    });
  }
  spawnKois() {
    let value = this.cfg.KOI_COUNT || 3;
    for (let value2 = 0; value2 < value; value2++) this.kois.push({
      x: 38 + Math.random() * Math.max(1, this.width - 76),
      y: 38 + Math.random() * Math.max(1, this.height - 76),
      vx: (Math.random() - 0.5) * 0.1,
      vy: (Math.random() - 0.5) * 0.1,
      angle: 0,
      target: null,
      effect: null,
      effectTimer: 0,
      hueOffset: Math.random() * 360,
      scale: 1,
      trail: [],
      dashTarget: null,
      dashTimer: 0,
      emitTimer: 0,
      baseSpeed: this.cfg.KOI_BASE_SPEED || 0.08
    });
  }
  spawnLilyPads() {
    for (let value = 0; value < 5; value++) this.lilyPads.push({
      x: Math.random() * this.width,
      y: 130 + Math.random() * Math.max(1, this.height - 170),
      angle: Math.random() * Math.PI * 2,
      scale: 0.5 + Math.random() * 0.8
    });
  }
  ensureAudio() {
    return this.audioReady ? Promise.resolve(true) : this.audioPromise ? this.audioPromise : (this.audioPromise = (async () => {
      try {
        await Tone.start();
        return this.destroyed ? false : (this.synths.drop = new Tone.MembraneSynth().toDestination(), this.synths.eat = new Tone.Synth({
          oscillator: {
            type: "sine"
          },
          envelope: {
            attack: 0.01,
            decay: 0.1,
            sustain: 0,
            release: 0.1
          }
        }).toDestination(), this.synths.magic = new Tone.PolySynth(Tone.Synth).toDestination(), this.synths.drop.volume.value = -10, this.synths.eat.volume.value = -12, this.synths.magic.volume.value = -15, this.audioReady = true, true);
      } catch {
        Object.values(this.synths).forEach(item => item.dispose());
        this.synths = {};
        return false;
      } finally {
        this.audioPromise = null;
      }
    })(), this.audioPromise);
  }
  playAudio(value) {
    if (this.audioReady) try {
      let timestamp = Tone.now();
      if (value === "drop") {
        this.synths.drop.triggerAttackRelease("C2", "8n", timestamp);
      }
      if (value === "eat") {
        this.synths.eat.triggerAttackRelease("C5", "16n", timestamp);
      }
      if (value === "magic") {
        this.synths.magic.triggerAttackRelease(["E4", "G4", "C5"], "8n", timestamp);
      }
    } catch {}
  }
  addFood(value, otherValue, argument3) {
    let type = argument3;
    if (type === "mix") {
      let value2 = FOOD_ITEMS.filter(item => item.id !== "mix");
      type = value2[Math.floor(Math.random() * value2.length)].id;
    }
    this.foods.push({
      x: value,
      y: otherValue,
      type: type,
      radius: 12,
      life: 1,
      id: Math.random()
    });
    this.ripples.push({
      x: value,
      y: otherValue,
      radius: 0,
      maxRadius: 50,
      alpha: 0.6
    });
    this.playAudio("drop");
  }
  spawnParticles(value, otherValue, argument3, value2 = false) {
    let value3 = 0;
    let items = [];
    if (argument3 === "chili") {
      value3 = 22;
      items = ["#ff542b", "#ff972f", "#ffe58a"];
    } else {
      if (argument3 === "ice") {
        value3 = 22;
        items = ["#c9f9ff", "#ffffff", "#86dcf5"];
      } else {
        if (argument3 === "ghost") {
          value3 = 14;
          items = ["#dacaff", "#ffffff"];
        } else {
          if (argument3 === "donut") {
            value3 = 20;
            items = ["#f472b6", "#fff4d6"];
          } else {
            if (argument3 === "soda" || argument3 === "soap") {
              value3 = 24;
              items = ["#c3f6ff", "#ffffff"];
            } else {
              if (argument3 === "disco") {
                value3 = 24;
                items = ["#ff6286", "#bc8aff", "#78ddff", "#91ffb1"];
              } else {
                if (argument3 === "star") {
                  value3 = 24;
                  items = ["#ffdc63", "#fff7b3", "#ffffff"];
                } else {
                  if (argument3 === "magnet") {
                    value3 = 16;
                    items = ["#ff7979", "#b7eaff"];
                  }
                }
              }
            }
          }
        }
      }
    }
    if (value2) {
      value3 = this.reducedMotion ? 1 : 3;
    } else {
      if (this.reducedMotion) {
        value3 = Math.ceil(value3 / 3);
      }
    }
    for (let value4 = 0; value4 < value3; value4++) {
      let angle = Math.random() * Math.PI * 2;
      let value5 = value2 ? 0.06 + Math.random() * 0.08 : 0.08 + Math.random() * 0.22;
      this.particles.push({
        x: value,
        y: otherValue,
        vx: Math.cos(angle) * value5,
        vy: Math.sin(angle) * value5 - (argument3 === "chili" ? 0.1 : 0),
        life: 1,
        duration: value2 ? 550 : 1000,
        color: items[Math.floor(Math.random() * items.length)] || "#fff",
        size: 3 + Math.random() * (value2 ? 4 : 6),
        angle: angle,
        type: argument3 === "soda" || argument3 === "soap" ? "bubble" : argument3 === "chili" ? "flame" : argument3 === "ice" ? "snowflake" : "sparkle"
      });
    }
    if (this.particles.length > 360) {
      this.particles.splice(0, this.particles.length - 360);
    }
  }
  applyFoodEffect(particle, otherValue) {
    particle.effect = otherValue;
    particle.effectTimer = 5000;
    particle.scale = otherValue === "donut" ? 1.9 : 1;
    particle.dashTarget = null;
    particle.dashTimer = 0;
    particle.emitTimer = 0;
    this.playAudio("eat");
    this.ripples.push({
      x: particle.x,
      y: particle.y,
      radius: 10,
      alpha: 0.9
    });
    if (otherValue !== "pellets") {
      this.playAudio("magic");
      this.spawnParticles(particle.x, particle.y, otherValue);
      this.ripples.push({
        x: particle.x,
        y: particle.y,
        radius: 26,
        alpha: 0.7
      });
    }
    if (otherValue === "ice") {
      particle.vx = 0;
      particle.vy = 0;
    }
  }
  chooseDashTarget(value) {
    value.dashTarget = {
      x: this.width * (value.x < this.width / 2 ? 0.7 + Math.random() * 0.18 : 0.12 + Math.random() * 0.18),
      y: this.height * (0.15 + Math.random() * 0.7)
    };
    value.dashTimer = 280 + Math.random() * 340;
  }
  loop(value) {
    if (this.destroyed || document.hidden) return;
    let value2 = Math.min(value - this.lastTime, 32);
    this.lastTime = value;
    this.update(value2);
    this.draw();
    this.rafId = requestAnimationFrame(value3 => this.loop(value3));
  }
  update(value) {
    this.elapsed += value;
    for (let value2 = this.ripples.length - 1; value2 >= 0; value2--) {
      let item = this.ripples[value2];
      item.radius += value * 0.11;
      item.alpha -= value * 0.001;
      if (item.alpha <= 0) {
        this.ripples.splice(value2, 1);
      }
    }
    for (let value2 = this.particles.length - 1; value2 >= 0; value2--) {
      let particle = this.particles[value2];
      particle.x += particle.vx * value;
      particle.y += particle.vy * value;
      if (particle.type === "bubble") {
        particle.vy -= value * 0.0005;
      }
      particle.life -= value / particle.duration;
      if (particle.life <= 0) {
        this.particles.splice(value2, 1);
      }
    }
    for (let value2 = this.foods.length - 1; value2 >= 0; value2--) {
      let item = this.foods[value2];
      item.life -= value * 0.00005;
      if (item.life <= 0) {
        this.foods.splice(value2, 1);
      }
    }
    this.kois.forEach(particle => {
      for (let value9 of particle.trail) value9.life -= value / 800;
      particle.trail = particle.trail.filter(item => item.life > 0);
      if (particle.effectTimer > 0) {
        particle.effectTimer -= value;
        if (particle.effectTimer <= 0) {
          particle.effect = null;
          particle.scale = 1;
          particle.dashTarget = null;
        }
      }
      let value2 = 1;
      if (particle.effect === "ice" && (value2 = 0), particle.effect === "soap" && (value2 = 2), particle.effect === "soda" && (value2 = 3), particle.effect === "chili" && (value2 = this.reducedMotion ? 2 : 10), value2 > 1 && (value2 = 1 + (value2 - 1) * Math.min(1, particle.effectTimer / 650)), !particle.target || !this.foods.find(item => item.id === particle.target.id)) {
        particle.target = null;
        let value9 = 1 / 0;
        let value10 = null;
        let value11 = particle.effect === "magnet" ? 800 : 300;
        this.foods.forEach(point => {
          let value12 = Math.hypot(point.x - particle.x, point.y - particle.y);
          if (value12 < value11 && value12 < value9) {
            value9 = value12;
            value10 = point;
          }
        });
        if (value10) {
          particle.target = value10;
        }
      }
      let value3 = 0;
      let value4 = 0;
      if (particle.target) {
        let value9 = particle.target.x - particle.x;
        let value10 = particle.target.y - particle.y;
        let value11 = Math.hypot(value9, value10);
        if (value11 < 20 && value2 > 0) {
          this.applyFoodEffect(particle, particle.target.type);
          value2 = particle.effect === "chili" ? this.reducedMotion ? 2 : 10 : particle.effect === "ice" ? 0 : 1;
          this.foods = this.foods.filter(item => item.id !== particle.target.id);
          particle.target = null;
        } else {
          if (value11 > 0.001 && value2 > 0) {
            value3 = value9 / value11 * 0.005 * value2;
            value4 = value10 / value11 * 0.005 * value2;
          }
        }
      } else {
        value3 = (Math.random() - 0.5) * 0.001;
        value4 = (Math.random() - 0.5) * 0.001;
      }
      if (particle.effect === "chili") {
        particle.dashTimer -= value;
        if (!particle.dashTarget || particle.dashTimer <= 0 || Math.hypot(particle.dashTarget.x - particle.x, particle.dashTarget.y - particle.y) < 45) {
          this.chooseDashTarget(particle);
        }
        let value9 = Math.atan2(particle.dashTarget.y - particle.y, particle.dashTarget.x - particle.x) + Math.sin(this.elapsed * 0.013 + particle.hueOffset) * 0.35;
        let value10 = particle.baseSpeed * value2;
        let value11 = 1 - Math.exp(-value / 65);
        particle.vx += (Math.cos(value9) * value10 - particle.vx) * value11;
        particle.vy += (Math.sin(value9) * value10 - particle.vy) * value11;
        value3 = 0;
        value4 = 0;
      }
      particle.vx += value3 * value;
      particle.vy += value4 * value;
      let value5 = particle.baseSpeed * value2;
      let value6 = Math.hypot(particle.vx, particle.vy);
      if (value6 > value5) {
        particle.vx = particle.vx / value6 * value5;
        particle.vy = particle.vy / value6 * value5;
      }
      let value7 = Math.pow(0.98, value / 16);
      particle.vx *= value7;
      particle.vy *= value7;
      particle.x += particle.vx * value;
      particle.y += particle.vy * value;
      let value8 = Math.min(32 * particle.scale, this.width / 3, this.height / 3);
      if (particle.x < value8 && (particle.x = value8, particle.vx = Math.abs(particle.vx), particle.dashTarget = null), particle.x > this.width - value8 && (particle.x = this.width - value8, particle.vx = -Math.abs(particle.vx), particle.dashTarget = null), particle.y < value8 && (particle.y = value8, particle.vy = Math.abs(particle.vy), particle.dashTarget = null), particle.y > this.height - value8 && (particle.y = this.height - value8, particle.vy = -Math.abs(particle.vy), particle.dashTarget = null), value6 > 0.01) {
        let value9 = Math.atan2(particle.vy, particle.vx) - particle.angle;
        for (; value9 > Math.PI;) value9 -= Math.PI * 2;
        for (; value9 < -Math.PI;) value9 += Math.PI * 2;
        particle.angle += value9 * (1 - Math.exp(-value / (particle.effect === "chili" ? 45 : 150)));
      }
      if (particle.effectTimer > 0 && particle.effect !== "pellets") {
        if (!this.reducedMotion && ["chili", "disco", "soap", "soda", "ghost"].includes(particle.effect)) {
          particle.trail.push({
            x: particle.x,
            y: particle.y,
            life: 1,
            type: particle.effect
          });
          if (particle.trail.length > 55) {
            particle.trail.shift();
          }
        }
        particle.emitTimer -= value;
        if (particle.emitTimer <= 0) {
          particle.emitTimer = this.reducedMotion ? 350 : particle.effect === "chili" ? 55 : 140;
          this.spawnParticles(particle.x - Math.cos(particle.angle) * 20, particle.y - Math.sin(particle.angle) * 20, particle.effect, true);
        }
      }
    });
  }
  draw() {
    let context = this.ctx;
    let width = this.width;
    let height = this.height;
    context.fillStyle = "#438e96";
    context.fillRect(0, 0, width, height);
    let BG_WATER = this.assets.BG_WATER;
    if (BG_WATER && BG_WATER.complete && BG_WATER.naturalWidth > 0) {
      let value = BG_WATER.naturalWidth / BG_WATER.naturalHeight;
      let value2 = width / height;
      let value3;
      let value4;
      let value5;
      let value6;
      if (value2 > value) {
        value3 = width;
        value4 = width / value;
        value5 = 0;
        value6 = (height - value4) / 2;
      } else {
        value3 = height * value;
        value4 = height;
        value5 = (width - value3) / 2;
        value6 = 0;
      }
      context.drawImage(BG_WATER, value5, value6, value3, value4);
    }
    let LILY_PAD = this.assets.LILY_PAD;
    if (imageReady(LILY_PAD)) {
      this.lilyPads.forEach(point => {
        context.save();
        context.translate(point.x, point.y);
        context.rotate(point.angle);
        drawContainedImage(context, LILY_PAD, 0, 0, 80 * point.scale, 80 * point.scale);
        context.restore();
      });
    }
    context.lineWidth = 2;
    this.ripples.forEach(point => {
      context.beginPath();
      context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      context.strokeStyle = `rgba(255, 255, 255, ${point.alpha})`;
      context.stroke();
    });
    this.foods.forEach(point => {
      context.save();
      context.globalAlpha = Math.min(1, point.life * 2);
      let value = FOOD_ITEMS.find(item => item.id === point.type);
      let value2 = value ? this.assets[value.imgId] : null;
      if (imageReady(value2)) {
        drawContainedImage(context, value2, point.x, point.y, 24, 24);
      } else {
        context.beginPath();
        context.arc(point.x, point.y, 6, 0, Math.PI * 2);
        context.fillStyle = "#f59e0b";
        context.fill();
      }
      context.restore();
    });
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    this.kois.forEach(item => {
      for (let value = 1; value < item.trail.length; value++) {
        let point = item.trail[value - 1];
        let point2 = item.trail[value];
        if (point2.type !== point.type) continue;
        let value2 = Math.min(point.life, point2.life);
        let value3 = point2.type === "chili" ? ["#ff5b2e", "#ffb044", "#fff0b0"] : point2.type === "disco" ? [`hsl(${value * 13 + this.elapsed * 0.08}, 85%, 66%)`, "#edc8ff", "#ffffff"] : ["#75d7ef", "#c4f8ff", "#ffffff"];
        let value4 = point2.type === "chili" ? [16, 8, 2.5] : [9, 4, 1.5];
        for (let value5 = 0; value5 < 3; value5++) {
          context.beginPath();
          context.moveTo(point.x, point.y);
          context.lineTo(point2.x, point2.y);
          context.globalAlpha = value2 * value2 * (value5 === 0 ? 0.35 : 0.8);
          context.strokeStyle = value3[value5];
          context.lineWidth = Math.max(0.5, value4[value5] * value2);
          context.stroke();
        }
      }
    });
    context.restore();
    let KOI_FISH = this.assets.KOI_FISH;
    this.kois.forEach(particle => {
      if (context.save(), context.translate(particle.x, particle.y), context.rotate(particle.angle), particle.effectTimer > 0 && particle.effect !== "pellets") {
        let options = {
          chili: "#ff862e",
          ice: "#cefbff",
          ghost: "#e8dcff",
          disco: `hsl(${this.elapsed * 0.12 % 360}, 90%, 70%)`,
          donut: "#ffd0e0",
          star: "#ffe08b",
          soda: "#b6f4ff",
          soap: "#d6fbff",
          magnet: "#ff8282"
        };
        let value2 = this.reducedMotion ? 1 : 1 + Math.sin(this.elapsed * 0.008) * 0.12;
        let value3 = (particle.effect === "donut" ? 43 : 32) * value2;
        context.save();
        context.globalAlpha = Math.min(1, particle.effectTimer / 650) * 0.75;
        context.strokeStyle = options[particle.effect] || "#ffffff";
        context.lineWidth = particle.effect === "ice" ? 4 : 2;
        context.beginPath();
        context.ellipse(0, 0, value3, value3 * 0.68, 0, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
      if (particle.effect === "ghost") {
        context.globalAlpha = 0.25;
      }
      if (particle.effect === "disco") {
        context.filter = `hue-rotate(${Date.now() % 360}deg) saturate(200%)`;
      }
      let value = this.reducedMotion || particle.effect === "ice" ? 0 : Math.sin(this.elapsed * (particle.effect === "chili" ? 0.035 : 0.005) + particle.hueOffset) * (particle.effect === "chili" ? 0.18 : 0.1) * (Math.hypot(particle.vx, particle.vy) > 0.01 ? 1 : 0.2);
      if (context.rotate(value), context.scale(particle.scale, particle.scale), imageReady(KOI_FISH) ? drawContainedImage(context, KOI_FISH, 0, 0, 60, 30) : (context.fillStyle = "#fff", context.beginPath(), context.ellipse(0, 0, 30, 15, 0, 0, Math.PI * 2), context.fill(), context.fillStyle = "#ef4444", context.beginPath(), context.arc(15, 0, 8, 0, Math.PI * 2), context.fill()), particle.effect === "ice") {
        let FX_ICE = this.assets.FX_ICE;
        if (imageReady(FX_ICE)) {
          drawContainedImage(context, FX_ICE, 0, 0, 96, 62);
        } else {
          context.fillStyle = "rgba(186, 230, 253, 0.7)";
          context.fillRect(-35, -20, 70, 40);
        }
      } else if (particle.effect === "star") {
        let FX_STAR_HALO = this.assets.FX_STAR_HALO;
        if (!this.reducedMotion) {
          context.rotate(Date.now() * 0.002);
        }
        if (imageReady(FX_STAR_HALO)) {
          drawContainedImage(context, FX_STAR_HALO, 0, 0, 136, 136);
        } else {
          context.strokeStyle = "#fde047";
          context.lineWidth = 4;
          context.strokeRect(-40, -40, 80, 80);
        }
      }
      context.restore();
    });
    this.particles.forEach(point => {
      if (context.save(), context.globalAlpha = point.life, context.fillStyle = point.color, context.strokeStyle = point.color, context.lineWidth = 1.7, context.translate(point.x, point.y), context.rotate(point.angle), context.beginPath(), point.type === "bubble") {
        context.arc(0, 0, point.size * (1.5 - point.life * 0.5), 0, Math.PI * 2);
        context.stroke();
      } else if (point.type === "snowflake") {
        for (let value = 0; value < 3; value++) {
          let value2 = value * Math.PI / 3;
          context.moveTo(-Math.cos(value2) * point.size, -Math.sin(value2) * point.size);
          context.lineTo(Math.cos(value2) * point.size, Math.sin(value2) * point.size);
        }
        context.stroke();
      } else {
        if (point.type === "flame") {
          context.moveTo(0, -point.size * 1.7);
          context.quadraticCurveTo(point.size * 1.3, point.size * 0.5, 0, point.size);
          context.quadraticCurveTo(-point.size * 1.2, point.size * 0.2, 0, -point.size * 1.7);
          context.fill();
        } else {
          context.moveTo(0, -point.size);
          context.lineTo(point.size * 0.3, -point.size * 0.3);
          context.lineTo(point.size, 0);
          context.lineTo(point.size * 0.3, point.size * 0.3);
          context.lineTo(0, point.size);
          context.lineTo(-point.size * 0.3, point.size * 0.3);
          context.lineTo(-point.size, 0);
          context.lineTo(-point.size * 0.3, -point.size * 0.3);
          context.closePath();
          context.fill();
        }
      }
      context.restore();
    });
  }
  destroy() {
    this.destroyed = true;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
    }
    document.removeEventListener("visibilitychange", this.onVisibility);
    Object.values(this.synths).forEach(item => item.dispose());
    this.synths = {};
    this.audioReady = false;
  }
};
function GameStyles() {
  return <style>{`
    @font-face {
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
    :root {
      --font-display: "Poppins", "PingFang SC", system-ui, sans-serif;
      --font-body:    "Poppins", "PingFang SC", system-ui, sans-serif;
      --font-mono:    ui-monospace, Menlo, monospace;
      
      --color-primary: #b34a21;
      --color-panel: #e5f2e9;
      --color-text: #163c42;
      --color-text-light: #ffffff;
    }
    html, body, #root {
      width: 100%; height: 100%; margin: 0; padding: 0;
      overflow: hidden;
      background-color: #438e96;
      box-sizing: border-box;
      touch-action: none; /* \u9632\u6B62 Safari \u9875\u9762\u6ED1\u52A8 */
    }
    * { box-sizing: inherit; }
    
    .glass-panel {
      background: var(--color-panel);
      border-top: 1px solid #c2d9ca;
    }
    .food-grid { display:flex;align-items:stretch;width:100%;margin:0;gap:12px;padding:5px 30px;overflow-x:auto;overscroll-behavior-x:contain;touch-action:pan-x;scrollbar-width:none;scroll-snap-type:x proximity }
    .food-button {
      flex:0 0 64px;min-width:64px;
      min-height: 80px;scroll-snap-align:center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      gap: 4px;
      background: none;
      border: none;
      padding: 2px 0;
      margin: 0;
      cursor: pointer;
      color: var(--color-text);
      touch-action: manipulation;
    }
    .food-button:focus-visible { outline: 2px solid var(--color-text); outline-offset: 3px; }
    .food-button[aria-pressed="true"] .food-icon { border-color: var(--color-primary); background: #fff2db; }
    .food-button:active .food-icon { background: #ffe6c8; }
    .food-icon { border: 2px solid #b4cebe; transition: border-color 160ms ease, background-color 160ms ease; }
    @media (prefers-reduced-motion: reduce) { .food-icon { transition: none; } }
    
  `}</style>;
}
function App() {
  let [config, setConfig] = React.useState(null);
  let [foodType, setFoodType] = React.useState("pellets");
  let [previewActive, setPreviewActive] = React.useState(() => new URLSearchParams(location.search).has("review") || new URLSearchParams(location.search).get("feedReview") === "1");
  let [guideUsed, setGuideUsed] = React.useState(false);
  React.useEffect(() => {
    let handleAction = value => {
      if (value.source === parent && value.origin === location.origin && value.data?.type === "playable-active") {
        setPreviewActive(!value.data.active);
      }
    };
    addEventListener("message", handleAction);
    return () => removeEventListener("message", handleAction);
  }, []);
  let canvasRef = React.useRef(null);
  let pondRef = React.useRef(null);
  React.useEffect(() => {
    let enabled = true;
    (async () => {
      let options = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let value = await requestGameConfig();
        if (value.ok) {
          options = await value.json();
        }
      } catch {
        console.warn("Config fetch failed, using defaults");
      }
      if (enabled) {
        setConfig(readConfigValues(options));
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  React.useEffect(() => {
    if (!config || !canvasRef.current) return;
    pondRef.current = new KoiPondWorld(canvasRef.current, config);
    let resizeObserver = observeGameSize(() => {
      if (pondRef.current) {
        pondRef.current.resize();
      }
    });
    resizeObserver.observe(canvasRef.current);
    return () => {
      resizeObserver.disconnect();
      if (pondRef.current) {
        pondRef.current.destroy();
      }
    };
  }, [config]);
  let feedFish = React.useCallback(event => {
    if (!pondRef.current || previewActive || event.isPrimary === false || event.button > 0) return;
    let dimensions = pondRef.current;
    let dimensions2 = canvasRef.current.getBoundingClientRect();
    if (dimensions2.width <= 0 || dimensions2.height <= 0) return;
    let value = (event.clientX - dimensions2.left) * dimensions.width / dimensions2.width;
    let value2 = (event.clientY - dimensions2.top) * dimensions.height / dimensions2.height;
    dimensions.addFood(value, value2, foodType);
    setGuideUsed(true);
    let audioReady = dimensions.audioReady;
    dimensions.ensureAudio().then(response => {
      if (response && !audioReady && !dimensions.destroyed) {
        dimensions.playAudio("drop");
      }
    });
  }, [foodType, previewActive]);
  return config ? <div data-feed-preview={previewActive} style={{
    width: "100%",
    height: "100%",
    position: "relative",
    display: "flex",
    flexDirection: "column"
  }}>{<GameStyles />}{!guideUsed && <p className={"koi-guide"} style={{
      position: "absolute",
      top: "18%",
      left: 30,
      right: 30,
      zIndex: 2,
      margin: 0,
      textAlign: "center",
      fontFamily: "var(--font-body)",
      fontSize: 18,
      lineHeight: 1.4,
      color: "#123e42",
      fontWeight: 700,
      pointerEvents: "none",
      textShadow: "0 1px 5px #e0ffff"
    }}>{"Tocca lo stagno per nutrire le carpe"}</p>}{<div style={{
      flex: 1,
      minHeight: 0,
      position: "relative"
    }}>{<canvas ref={canvasRef} onPointerDown={feedFish} aria-label={"Tocca lo stagno per nutrire le carpe con l’oggetto scelto."} style={{
        width: "100%",
        height: "100%",
        display: "block",
        cursor: "pointer"
      }} />}</div>}{<div className={"glass-panel"} style={{
      flex: "0 0 auto",
      boxSizing: "border-box",
      padding: "6px 0 max(22px, env(safe-area-inset-bottom))",
      width: "100%",
      display: previewActive ? "none" : "block"
    }}>{<div className={"food-grid"} role={"group"} aria-label={"Cibo e oggetti"}>{FOOD_ITEMS.map(item => {
          let value = foodType === item.id;
          return <button key={item.id} className={"food-button"} type={"button"} aria-pressed={value} aria-label={config[item.textId] || item.id} onClick={() => setFoodType(item.id)}>{<div className={"food-icon"} style={{
              width: "50px",
              height: "50px",
              flex: "none",
              borderRadius: "50%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              overflow: "hidden"
            }}>{config[item.imgId] ? <img src={config[item.imgId]} alt={""} style={{
                width: "80%",
                height: "80%",
                objectFit: "contain"
              }} draggable={false} /> : <span style={{
                fontSize: "24px"
              }}>{"?"}</span>}</div>}{<span style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              lineHeight: 1.3,
              fontWeight: value ? 700 : 400,
              color: value ? "var(--color-primary)" : "var(--color-text)",
              width: "100%",
              overflowWrap: "anywhere",
              textAlign: "center"
            }}>{config[item.textId]}</span>}</button>;
        })}</div>}</div>}</div> : <div style={{
    width: "100%",
    height: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center"
  }}>{<GameStyles />}{<span style={{
      color: "#fff",
      fontFamily: "var(--font-display)"
    }}>{"Caricamento…"}</span>}</div>;
}

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

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = ["p.koi-guide"];
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
