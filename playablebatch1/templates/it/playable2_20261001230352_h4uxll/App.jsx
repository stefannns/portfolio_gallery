import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "CLOUD_SPEED",
    "kind": "number",
    "label": "Cloud Speed",
    "value": 0.34,
    "default": 0.34,
    "min": 0.1,
    "max": 1,
    "step": 0.02
  }, {
    "id": "CLOUD_DENSITY",
    "kind": "number",
    "label": "Cloud Density",
    "value": 18,
    "default": 18,
    "min": 8,
    "max": 30,
    "step": 1
  }, {
    "id": "LIGHTNING_GLOW",
    "kind": "number",
    "label": "Lightning Glow",
    "value": 30,
    "default": 30,
    "min": 10,
    "max": 60,
    "step": 2
  }, {
    "id": "THUNDER_VOLUME",
    "kind": "number",
    "label": "Thunder Volume",
    "value": 0.28,
    "default": 0.28,
    "min": 0,
    "max": 0.6,
    "step": 0.02
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "Temporale al crepuscolo",
    "default": "Temporale al crepuscolo",
    "max_length": 30
  }, {
    "id": "GUIDE_TEXT",
    "label": "Guide Text",
    "value": "Tocca le nuvole per scatenare i fulmini",
    "default": "Tocca le nuvole per scatenare i fulmini",
    "max_length": 44
  }],
  "images": [],
  "motions": [],
  "config_version": "2.0",
  "playable": {
    "post_id": "99280150965238575",
    "version_id": "99280150965135547",
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
    const request = fetch('./game.config.json', { cache: 'no-store' }).then(async response => ({
      ok: response.ok,
      status: response.status,
      config: response.ok ? await response.json() : null
    }));
    const fallback = new Promise(resolve => {
      deadline = setTimeout(() => resolve({ ok: false, status: 0, config: null }), 400);
    });
    const result = await Promise.race([request, fallback]);
    if (result.ok) runtimeConfig = result.config;
    return { ok: result.ok, status: result.status, json: async () => runtimeConfig };
  } finally {
    clearTimeout(deadline);
  }
}
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #11151d; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p#guide{position:fixed!important;top:26%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root #root .hud{filter:none!important}
html:root:root:root #root .counter{filter:drop-shadow(0 3px 12px rgba(0,0,0,.72))}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p#guide{color:#eef3ff;text-shadow:0 2px 8px #000a}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(p#guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(p#guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(p#guide){animation:none!important}}

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
function startGame() {
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

  // ./scene-audio.js
  /* Original procedural audio. No third-party recordings or runtime dependencies. */
  (() => {
    'use strict';

    const randomFor = seed => () => {
      seed = Math.imul(seed, 1664525) + 1013904223 >>> 0;
      return seed / 4294967296;
    };
    class PlayableSceneAudio {
      constructor({
        profile,
        context = null
      } = {}) {
        this.profile = profile;
        this.context = context;
        this.ownsContext = !context;
        this.buffers = new Map();
        this.voices = new Set();
        this.loopVoice = null;
        this.loopWanted = false;
        this.disposed = false;
        this.visibility = () => {
          if (document.hidden) {
            this.stopAll();
            if (this.profile === 'carve') this.loopWanted = false;
            if (this.ownsContext) this.context?.suspend?.().catch(() => {});
          } else if (this.profile === 'maze' && this.loopWanted) this.setLoop(true);
        };
        this.pageHide = () => {
          this.stopAll();
          if (this.profile === 'carve') this.loopWanted = false;
          if (this.ownsContext) this.context?.suspend?.().catch(() => {});
        };
        this.pageShow = () => {
          if (this.profile === 'maze' && this.loopWanted && !document.hidden) this.setLoop(true);
        };
        document.addEventListener('visibilitychange', this.visibility);
        window.addEventListener('pagehide', this.pageHide);
        window.addEventListener('pageshow', this.pageShow);
      }
      unlock() {
        if (this.disposed || document.hidden) return null;
        try {
          if (!this.context) {
            const Audio = window.AudioContext || window.webkitAudioContext;
            if (!Audio) return null;
            this.context = new Audio();
          }
          if (this.context.state === 'closed') return null;
          if (this.context.state === 'suspended') this.context.resume().catch(() => {});
          return this.context;
        } catch (value) {
          return null;
        }
      }
      buffer(kind, variant = 0) {
        const value2 = kind + variant;
        if (this.buffers.has(value2)) return this.buffers.get(value2);
        const context = this.context;
        const seconds = {
          maze: 8,
          carve: 1.7,
          thunder: 3.4,
          step: 0.09,
          scare: 0.3,
          win: 0.55
        }[kind];
        const stereo = kind === 'thunder';
        const buffer = context.createBuffer(stereo ? 2 : 1, Math.ceil(seconds * context.sampleRate), context.sampleRate);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const samples = buffer.getChannelData(channel);
          const random = randomFor(4027 + variant * 89 + channel * 193);
          let value3 = 0;
          let grain = 0;
          let peak = 0;
          const smoothing = Math.exp(-2 * Math.PI * (kind === 'maze' ? 140 : 85) / context.sampleRate);
          const highSmoothing = Math.exp(-2 * Math.PI * 420 / context.sampleRate);
          for (let value4 = 0; value4 < samples.length; value4++) {
            const value5 = value4 / context.sampleRate;
            const white = random() * 2 - 1;
            value3 = value3 * smoothing + white * (1 - smoothing);
            grain = grain * highSmoothing + white * (1 - highSmoothing);
            let value;
            if (kind === 'maze') {
              // Slow, non-pitched air, deliberately behind footsteps and encounters.
              value = value3 * (0.68 + 0.16 * Math.sin(value5 * Math.PI / 2) + 0.08 * Math.sin(value5 * Math.PI));
            } else if (kind === 'carve') {
              const stroke = 0.42 + 0.26 * Math.sin(value5 * 18) ** 2 + 0.16 * Math.sin(value5 * 31 + 0.7) ** 2;
              value = (white - grain) * stroke * 0.3 + (random() > 0.997 ? white * 0.34 : 0);
            } else if (kind === 'thunder') {
              const crack = Math.exp(-value5 * 26) * 0.65 + Math.exp(-Math.abs(value5 - 0.07) * 60) * 0.2;
              const rolling = Math.exp(-value5 * 1.15) * (1 - Math.exp(-value5 * 24)) * (0.65 + 0.3 * Math.sin(value5 * 12 + variant) ** 2);
              const echoes = Math.exp(-Math.abs(value5 - 0.28) * 15) * 0.28 + Math.exp(-Math.abs(value5 - 0.64) * 9) * 0.2 + Math.exp(-Math.abs(value5 - 1.12) * 7) * 0.12;
              value = white * crack + value3 * 9 * (rolling + echoes);
              value *= Math.min(1, value5 / 0.003, (seconds - value5) / 0.28);
            } else if (kind === 'win') {
              value = [261.63, 329.63, 392].reduce((total, item) => total + Math.sin(value5 * Math.PI * 2 * item), 0) * Math.min(1, value5 / 0.02) * Math.exp(-value5 / 0.12) * Math.min(1, (seconds - value5) / 0.05);
            } else {
              const length = kind === 'step' ? 0.03 : 0.09;
              value = (value3 * 3 + white * 0.08) * Math.exp(-value5 / length) * Math.min(1, value5 / 0.006);
            }
            samples[value4] = value;
            peak = Math.max(peak, Math.abs(value));
          }
          const scale = 0.8 / Math.max(0.001, peak);
          for (let value = 0; value < samples.length; value++) samples[value] *= scale;
          if (kind === 'maze' || kind === 'carve') {
            // Match loop endpoints to avoid clicks at the buffer boundary.
            const blend = Math.round(context.sampleRate * 0.02);
            for (let value = 0; value < blend; value++) {
              const value4 = value / blend;
              samples[samples.length - blend + value] = samples[samples.length - blend + value] * (1 - value4) + samples[value] * value4;
            }
          }
        }
        this.buffers.set(value2, buffer);
        return buffer;
      }
      play(kind, {
        loop = false,
        volume = 0.12,
        variant = 0
      } = {}) {
        const value = this.unlock();
        if (!value) return null;
        try {
          // Rapid touches cannot accumulate unbounded audio nodes or excessive level.
          const limit = kind === 'thunder' ? 3 : 4;
          const active = [...this.voices].filter(item => !item.stopping);
          while (active.length >= limit) this.stopVoice(active.shift(), 0.025);
          const source = value.createBufferSource();
          const filter = value.createBiquadFilter();
          const gain = value.createGain();
          source.buffer = this.buffer(kind, variant);
          source.loop = loop;
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(kind === 'maze' ? 500 : kind === 'carve' ? 4600 : kind === 'thunder' ? 3200 : 1700, value.currentTime);
          if (kind === 'thunder') filter.frequency.exponentialRampToValueAtTime(230, value.currentTime + 2.9);
          filter.Q.value = 0.45;
          const level = Math.min(0.4, Math.max(0, volume)) / Math.sqrt(active.length + 1);
          const attack = kind === 'maze' ? 1.2 : kind === 'carve' ? 0.035 : 0.004;
          gain.gain.setValueAtTime(0.0001, value.currentTime);
          gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), value.currentTime + attack);
          source.connect(filter).connect(gain).connect(value.destination);
          const voice = {
            source,
            filter,
            gain,
            stopping: false
          };
          this.voices.add(voice);
          source.onended = () => {
            source.disconnect();
            filter.disconnect();
            gain.disconnect();
            this.voices.delete(voice);
            if (this.loopVoice === voice) this.loopVoice = null;
          };
          source.start();
          if (!loop) source.stop(value.currentTime + source.buffer.duration + 0.02);
          return voice;
        } catch (value2) {
          return null;
        }
      }
      setLoop(wanted) {
        this.loopWanted = Boolean(wanted);
        if (!wanted || document.hidden) {
          if (this.loopVoice) this.stopVoice(this.loopVoice, 0.12);
          this.loopVoice = null;
          return;
        }
        if (!this.loopVoice) this.loopVoice = this.play(this.profile, {
          loop: true,
          volume: this.profile === 'maze' ? 0.035 : 0.14
        });
      }
      stopVoice(voice, fade = 0.08) {
        if (!voice || voice.stopping) return;
        voice.stopping = true;
        try {
          const currentTime = this.context.currentTime;
          const param = voice.gain.gain;
          if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(currentTime);else {
            param.cancelScheduledValues(currentTime);
            param.setValueAtTime(Math.max(0.0001, param.value), currentTime);
          }
          param.exponentialRampToValueAtTime(0.0001, currentTime + fade);
          // A finite source already has a stop scheduled; replace it with the fade's end.
          voice.source.stop(currentTime + fade + 0.01);
        } catch (value) {}
      }
      stopAll() {
        for (const voice of this.voices) this.stopVoice(voice);
        this.loopVoice = null;
      }
      dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.loopWanted = false;
        this.stopAll();
        document.removeEventListener('visibilitychange', this.visibility);
        window.removeEventListener('pagehide', this.pageHide);
        window.removeEventListener('pageshow', this.pageShow);
        if (this.ownsContext) this.context?.close?.().catch(() => {});
        this.buffers.clear();
      }
    }
    window.PlayableSceneAudio = PlayableSceneAudio;
  })();
  (() => {
    'use strict';

    const flattenConfig = value => {
      const options = {};
      for (const section of ['tweaks', 'texts', 'images', 'motions']) {
        for (const item of value[section] || []) {
          if (section === 'motions') {
            options[item.id + '_BASE'] = item.base_path;
            options[item.id + '_COUNT'] = item.frame_count;
          } else options[item.id] = item.value ?? item.path;
        }
      }
      return options;
    };
    const loadConfig = async () => {
      try {
        const response = await requestGameConfig();
        if (response.ok) return flattenConfig(await response.json());
      } catch (value) {}
      const inline = runtimeConfig;
      return inline ? flattenConfig(runtimeConfig) : {};
    };
    const start = async () => {
      const config = await loadConfig();
      const root = document.getElementById('game-surface');
      const style = document.createElement('style');
      style.textContent = `
      :root { --ui-unit: min(0.2564102564vw, 0.1672240803vh); color-scheme: dark; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { background: #11151d; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
      .storm { position: relative; width: 100%; height: 100%; overflow: hidden; background: #11151d; }
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: manipulation; cursor: crosshair; }
      .hud {
        position: absolute;
        z-index: 2;
        top: calc(30 * var(--ui-unit) + env(safe-area-inset-top));
        left: calc(30 * var(--ui-unit) + env(safe-area-inset-left));
        right: calc(30 * var(--ui-unit) + env(safe-area-inset-right));
        pointer-events: none;
        text-align: center;
        filter: drop-shadow(0 3px 12px rgba(0,0,0,.72));
      }
      .guide {
        max-width: 420px;
        margin: 0 auto;
        color: rgba(226,232,242,.72);
        font-size: calc(18 * var(--ui-unit));
        overflow-wrap: anywhere;
        font-weight: 600;
        line-height: 1.35;
        transition: opacity .35s ease, transform .35s ease;
      }
      .counter { display: flex; align-items: center; justify-content: center; gap: 8px; color: #eef3ff; font-size: calc(28 * var(--ui-unit)); line-height: 1.2; font-weight: 700; font-variant-numeric: tabular-nums; margin-bottom: 14px; }
      .counter svg { width: 19px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; }
      .storm-controls { position: absolute; z-index: 3; bottom: calc(50 * var(--ui-unit) + env(safe-area-inset-bottom)); left: calc(30 * var(--ui-unit) + env(safe-area-inset-left)); right: calc(30 * var(--ui-unit) + env(safe-area-inset-right)); display: flex; justify-content: center; gap: 12px; }
      .storm-control { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; min-width: 112px; padding: 10px 14px; border: 1px solid rgba(221,231,255,.38); border-radius: 24px; background: rgba(15,21,34,.88); color: #edf3ff; font: inherit; font-size: calc(18 * var(--ui-unit)); font-weight: 600; line-height: 1.25; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; transition: background .15s ease, border-color .15s ease; }
      .storm-control svg { flex: 0 0 auto; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .storm-control[aria-pressed="true"] { background: #334264; border-color: #bed0f7; }
      .storm-control:active { background: #455779; }
      .storm-control:focus-visible { outline: 3px solid #d6e6ff; outline-offset: 4px; }
      .storm-control[aria-busy="true"] svg { opacity: .5; }
      .guide.hidden { opacity: 0; transform: translateY(-5px); }
      .storm[data-feed-preview="true"] .storm-controls,.storm[data-feed-preview="true"] .counter{visibility:hidden;pointer-events:none}
      .storm[data-feed-preview="true"] .counter{display:none}
      .storm[data-feed-preview="true"] .hud{top:18%}
      .tap-ripple {
        position: absolute;
        z-index: 2;
        width: 28px;
        height: 28px;
        border: 2px solid rgba(216,231,255,.85);
        border-radius: 50%;
        pointer-events: none;
        transform: translate(-50%, -50%) scale(.25);
        animation: ripple .55s ease-out forwards;
      }
      @keyframes ripple { to { opacity: 0; transform: translate(-50%, -50%) scale(3.2); } }
      @media (prefers-reduced-motion: reduce) {
        .tap-ripple { animation-duration: .2s; }
        .guide { transition-duration: .01ms; }
        .storm-control { transition-duration: .01ms; }
      }
    `;
      document.head.appendChild(style);
      root.innerHTML = `
      <main class="storm">
        <canvas id="sky" aria-label="Moving storm clouds. Tap anywhere to create lightning."></canvas>
        <header class="hud">
          <div class="counter" aria-label="0 strikes" id="strike-counter"><svg viewBox="0 0 24 28" aria-hidden="true"><path d="M14 2 4 16h8l-2 10 10-15h-8z"/></svg><span id="strike-count">0</span></div>
          <p class="guide" id="guide"></p>
        </header>
        <nav class="storm-controls" aria-label="Storm options">
          <button type="button" class="storm-control" id="color-toggle" aria-pressed="false" aria-label="Fulmini colorati"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-13h-7z"/></svg><span>Colore</span></button>
          <button type="button" class="storm-control" id="music-toggle" aria-pressed="false" aria-busy="false" aria-label="Musica rock"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></svg><span id="music-label">Musica disattivata</span></button>
        </nav>
      </main>
    `;
      const canvas = document.getElementById('sky');
      const context = canvas.getContext('2d', {
        alpha: false
      });
      const guide = document.getElementById('guide');
      const strikeCount = document.getElementById('strike-count');
      const strikeCounter = document.getElementById('strike-counter');
      const colorToggle = document.getElementById('color-toggle');
      const musicToggle = document.getElementById('music-toggle');
      const musicLabel = document.getElementById('music-label');
      guide.textContent = config.GUIDE_TEXT || "Tocca le nuvole per scatenare i fulmini";
      const storm = root.querySelector('.storm');
      let feedPreview = new URLSearchParams(location.search).has('review') || new URLSearchParams(location.search).get('feedReview') === '1';
      storm.dataset.feedPreview = String(feedPreview);
      let previewElapsed = 0;
      let previewPlayed = false;
      let previewVisible = typeof IntersectionObserver !== 'function';
      const previewObserver = previewVisible ? null : new IntersectionObserver(entries => {
        previewVisible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0.1);
      }, {
        threshold: [0, 0.1]
      });
      previewObserver?.observe(storm);
      addEventListener('pagehide', () => previewObserver?.disconnect(), {
        once: true
      });
      addEventListener('message', value => {
        if (value.source !== parent || value.origin !== location.origin || value.data?.type !== 'playable-active') return;
        feedPreview = value.data.active !== true;
        storm.dataset.feedPreview = String(feedPreview);
        if (!feedPreview) {
          bolts = [];
          flash = 0;
        }
      });
      const cloudSpeed = Math.max(0.05, Number(config.CLOUD_SPEED) || 0.34);
      const cloudDensity = Math.max(8, Math.min(30, Math.round(Number(config.CLOUD_DENSITY) || 18)));
      const lightningGlow = Math.max(8, Number(config.LIGHTNING_GLOW) || 30);
      const configuredThunder = Number(config.THUNDER_VOLUME);
      const thunderVolume = Math.max(0, Math.min(0.6, Number.isFinite(configuredThunder) ? configuredThunder : 0.28));
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      let width = 1;
      let height = 1;
      let value2 = 1;
      let clouds = [];
      let bolts = [];
      let puffSprites = [];
      let lastFrame = performance.now();
      let flash = 0;
      let flashColor = [221, 234, 255];
      let strikes = 0;
      let colored = false;
      const lightningColors = [[161, 196, 255], [202, 149, 255], [255, 145, 217], [138, 232, 238], [255, 202, 125]];
      let lastColor = -1;
      const muted = false;
      let audio = null;
      let thunderSound = null;
      let thunderIndex = 0;
      let rainBuffer = null;
      let rainSource = null;
      let rainGain = null;
      let hasInteracted = false;
      let rockMusic = null;
      let musicWanted = false;
      let musicRevision = 0;
      let musicFrame = null;
      const seeded = seed => {
        let value = seed >>> 0;
        return () => {
          value = value * 1664525 + 1013904223 >>> 0;
          return value / 4294967296;
        };
      };
      const makePuffSprite = (depth, shadow = false) => {
        const sprite = document.createElement('canvas');
        sprite.width = 768;
        sprite.height = 768;
        const context2 = sprite.getContext('2d');
        const base = depth === 0 ? 155 : depth === 1 ? 125 : 92;
        const center = sprite.width / 2;
        const gradient = context2.createRadialGradient(center, center * 0.86, 5, center, center, center);
        if (shadow) {
          const value = Math.max(12, base - 72);
          gradient.addColorStop(0, 'rgba(' + value + ',' + (value + 6) + ',' + (value + 16) + ',.34)');
          gradient.addColorStop(0.48, 'rgba(' + value + ',' + (value + 6) + ',' + (value + 16) + ',.2)');
          gradient.addColorStop(0.78, 'rgba(' + value + ',' + (value + 6) + ',' + (value + 16) + ',.055)');
        } else {
          const lift = Math.min(228, base + 42);
          gradient.addColorStop(0, 'rgba(' + lift + ',' + (lift + 5) + ',' + Math.min(244, lift + 14) + ',.9)');
          gradient.addColorStop(0.46, 'rgba(' + base + ',' + (base + 5) + ',' + (base + 14) + ',.66)');
          gradient.addColorStop(0.78, 'rgba(' + Math.max(18, base - 55) + ',' + Math.max(22, base - 48) + ',' + Math.max(30, base - 35) + ',.12)');
        }
        gradient.addColorStop(1, 'rgba(15,19,28,0)');
        context2.fillStyle = gradient;
        context2.fillRect(0, 0, sprite.width, sprite.height);
        return sprite;
      };
      const buildSprites = () => {
        puffSprites = Array.from({
          length: 3
        }, (value, depth) => ({
          light: makePuffSprite(depth, false),
          shadow: makePuffSprite(depth, true)
        }));
      };
      const makeCloudPuffs = seed => {
        const random = seeded(seed);
        const puffs = [];
        for (let value = 0; value < 7; value++) {
          puffs.push({
            shadow: true,
            x: 0.1 + random() * 0.8,
            y: 0.56 + random() * 0.22,
            w: 0.25 + random() * 0.2,
            h: 0.48 + random() * 0.24
          });
        }
        for (let value = 0; value < 16; value++) {
          puffs.push({
            shadow: false,
            x: 0.06 + random() * 0.88,
            y: 0.19 + random() * 0.5,
            w: 0.2 + random() * 0.24,
            h: 0.48 + random() * 0.4
          });
        }
        return puffs;
      };
      const createCloud = (index, randomX = true) => {
        const depth = index % 3;
        const scale = (0.72 + Math.random() * 0.62) * (depth === 0 ? 0.8 : depth === 1 ? 1 : 1.2);
        return {
          depth,
          x: randomX ? Math.random() * (width + 500) - 250 : -650,
          y: height * (0.12 + Math.random() * 0.66),
          w: 420 * scale,
          h: 184 * scale,
          speed: (9 + depth * 7 + Math.random() * 8) * cloudSpeed * (reducedMotion ? 0.45 : 1),
          opacity: depth === 0 ? 0.36 : depth === 1 ? 0.5 : 0.66,
          drift: Math.random() * Math.PI * 2,
          puffs: makeCloudPuffs(Math.floor(Math.random() * 1000000000))
        };
      };
      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);
        value2 = Math.min(3, window.devicePixelRatio || 1);
        canvas.width = Math.round(width * value2);
        canvas.height = Math.round(height * value2);
        context.setTransform(value2, 0, 0, value2, 0, 0);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        if (!puffSprites.length) buildSprites();
        clouds = Array.from({
          length: cloudDensity
        }, (value, index) => createCloud(index, true));
        clouds.sort((leftItem, rightItem) => leftItem.depth - rightItem.depth);
      };
      const drawSky = time => {
        const linearGradient = context.createLinearGradient(0, 0, 0, height);
        linearGradient.addColorStop(0, '#111723');
        linearGradient.addColorStop(0.42, '#252a35');
        linearGradient.addColorStop(0.72, '#3a3a43');
        linearGradient.addColorStop(1, '#171a22');
        context.fillStyle = linearGradient;
        context.fillRect(0, 0, width, height);
        const twilight = context.createRadialGradient(width * 0.5, height * 0.64, 0, width * 0.5, height * 0.64, width * 0.78);
        twilight.addColorStop(0, 'rgba(198,202,213,.13)');
        twilight.addColorStop(0.48, 'rgba(119,125,140,.07)');
        twilight.addColorStop(1, 'rgba(20,23,31,0)');
        context.fillStyle = twilight;
        context.fillRect(0, 0, width, height);
        const mist = context.createLinearGradient(0, height * 0.68, 0, height);
        mist.addColorStop(0, 'rgba(18,22,31,0)');
        mist.addColorStop(0.56, 'rgba(13,17,24,.19)');
        mist.addColorStop(1, 'rgba(7,10,15,.58)');
        context.fillStyle = mist;
        context.fillRect(0, height * 0.68, width, height * 0.32);
      };
      const drawClouds = (value, time) => {
        for (const cloud of clouds) {
          cloud.x += cloud.speed * value;
          if (cloud.x > width + cloud.w * 0.55) {
            const fresh = createCloud(cloud.depth, false);
            Object.assign(cloud, fresh, {
              depth: cloud.depth,
              x: -fresh.w * 0.72
            });
          }
          const value3 = Math.sin(time * 0.00018 + cloud.drift) * (3 + cloud.depth * 2);
          context.save();
          context.globalAlpha = cloud.opacity;
          for (const puff of cloud.puffs) {
            const puffWidth = cloud.w * puff.w;
            const puffHeight = cloud.h * puff.h;
            const puffX = cloud.x - cloud.w / 2 + cloud.w * puff.x - puffWidth / 2;
            const puffY = cloud.y - cloud.h / 2 + value3 + cloud.h * puff.y - puffHeight / 2;
            const sprite = puff.shadow ? puffSprites[cloud.depth].shadow : puffSprites[cloud.depth].light;
            context.drawImage(sprite, puffX, puffY, puffWidth, puffHeight);
          }
          context.restore();
        }
      };
      const makePath = (startX, startY, endX, endY, segments, spread) => {
        const points = [{
          x: startX,
          y: startY
        }];
        for (let value = 1; value < segments; value++) {
          const progress = value / segments;
          const center = startX + (endX - startX) * progress;
          const taper = Math.sin(progress * Math.PI);
          points.push({
            x: center + (Math.random() - 0.5) * spread * taper,
            y: startY + (endY - startY) * progress
          });
        }
        points.push({
          x: endX,
          y: endY
        });
        return points;
      };
      const createBolt = (x, y) => {
        // Crop the bolt at the viewport, not at its visible rounded endpoints.
        const overflow = Math.max(100, height * 0.16, lightningGlow * 3);
        const endY = height + overflow;
        const startY = -overflow;
        const startX = Math.max(18, Math.min(width - 18, x + (Math.random() - 0.5) * 92));
        const main = makePath(startX, startY, x, endY, 15, Math.min(132, width * 0.32));
        const branches = [];
        for (let value = 2; value < main.length - 2; value += 2) {
          if (Math.random() < 0.88) {
            const point = main[value];
            const direction = Math.random() < 0.5 ? -1 : 1;
            branches.push(makePath(point.x, point.y, point.x + direction * (45 + Math.random() * 100), point.y + 75 + Math.random() * 115, 6, 44));
          }
        }
        let color = [177, 211, 255];
        if (colored) {
          // Vary new strikes without recoloring bolts that are already fading.
          lastColor = (lastColor + 1 + Math.floor(Math.random() * (lightningColors.length - 1))) % lightningColors.length;
          color = lightningColors[lastColor];
        }
        bolts.push({
          main,
          branches,
          color,
          colored,
          born: performance.now(),
          duration: 620
        });
        flashColor = color.map(channel => Math.round(channel * 0.45 + 255 * 0.55));
        flash = 1;
      };
      const strokePath = points => {
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let value = 1; value < points.length; value++) context.lineTo(points[value].x, points[value].y);
        context.stroke();
      };
      const drawBolts = value => {
        bolts = bolts.filter(bolt => value - bolt.born < bolt.duration);
        for (const bolt of bolts) {
          const value3 = value - bolt.born;
          const fade = Math.max(0, 1 - value3 / bolt.duration);
          const flicker = value3 < 110 ? 1 : 0.48 + Math.abs(Math.sin(value3 * 0.055)) * 0.45;
          const alpha = fade * flicker;
          context.save();
          context.lineCap = 'round';
          context.lineJoin = 'round';
          const tint = bolt.color.join(',');
          const core = bolt.color.map(channel => Math.round(channel * 0.3 + 255 * 0.7)).join(',');
          context.shadowColor = 'rgba(' + tint + ',' + alpha + ')';
          context.shadowBlur = lightningGlow * 1.45;
          context.strokeStyle = 'rgba(' + tint + ',' + alpha * 0.42 + ')';
          context.lineWidth = 15;
          strokePath(bolt.main);
          context.strokeStyle = 'rgba(' + (bolt.colored ? core : '236,246,255') + ',' + alpha + ')';
          context.lineWidth = 4.2;
          strokePath(bolt.main);
          for (const branch of bolt.branches) {
            context.strokeStyle = 'rgba(' + core + ',' + alpha * 0.72 + ')';
            context.lineWidth = 2.1;
            strokePath(branch);
          }
          context.restore();
        }
      };
      const drawFlash = value => {
        if (flash <= 0.002) return;
        context.fillStyle = 'rgba(' + flashColor.join(',') + ',' + flash * (reducedMotion ? 0.09 : 0.34) + ')';
        context.fillRect(0, 0, width, height);
        flash *= Math.pow(0.075, value);
      };
      const frame = value => {
        const value3 = Math.min(0.04, Math.max(0, (value - lastFrame) / 1000));
        lastFrame = value;
        if (!document.hidden && previewVisible && feedPreview && !previewPlayed && !reducedMotion) {
          previewElapsed += value3 * 1000;
          if (previewElapsed >= 900) {
            previewPlayed = true;
            createBolt(width * 0.48, height * 0.5);
            storm.dataset.previewStrikes = '1';
          }
        }
        context.setTransform(value2, 0, 0, value2, 0, 0);
        drawSky(value);
        drawClouds(value3, value);
        drawBolts(value);
        drawFlash(value3);
        requestAnimationFrame(frame);
      };
      const ensureAudio = () => {
        try {
          if (!audio) {
            const AudioCtor = window.AudioContext || window.webkitAudioContext;
            if (AudioCtor) audio = new AudioCtor();
          }
          if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
        } catch (value) {
          audio = null;
        }
      };
      const makeRainBuffer = () => {
        const seconds = 3;
        const length = Math.round(audio.sampleRate * seconds);
        const buffer = audio.createBuffer(1, length, audio.sampleRate);
        const samples = buffer.getChannelData(0);
        let value = 0;
        for (let value3 = 0; value3 < length; value3++) {
          const white = Math.random() * 2 - 1;
          value = value * 0.985 + white * 0.015;
          samples[value3] = (white - value) * 0.42 + value * 0.18;
        }
        for (let drop = 0; drop < 85; drop++) {
          const start = Math.floor(Math.random() * (length - audio.sampleRate * 0.04));
          const frequency = 650 + Math.random() * 850;
          const duration = Math.floor(audio.sampleRate * 0.035);
          for (let value3 = 0; value3 < duration; value3++) {
            samples[start + value3] += Math.sin(2 * Math.PI * frequency * value3 / audio.sampleRate) * Math.exp(-value3 / (audio.sampleRate * 0.007)) * 0.28;
          }
        }
        return buffer;
      };
      const stopRain = () => {
        if (!rainSource || !audio) return;
        const source = rainSource;
        const gain = rainGain;
        const currentTime = audio.currentTime;
        rainSource = null;
        rainGain = null;
        gain.gain.cancelScheduledValues(currentTime);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.2);
        source.stop(currentTime + 0.22);
      };
      const startRain = () => {
        if (muted || !hasInteracted || document.hidden || rainSource) return;
        ensureAudio();
        if (!audio) return;
        try {
          rainBuffer = rainBuffer || makeRainBuffer();
          const source = audio.createBufferSource();
          const highpass = audio.createBiquadFilter();
          const lowpass = audio.createBiquadFilter();
          const gain = audio.createGain();
          source.buffer = rainBuffer;
          source.loop = true;
          highpass.type = 'highpass';
          highpass.frequency.value = 280;
          lowpass.type = 'lowpass';
          lowpass.frequency.value = 6200;
          gain.gain.setValueAtTime(0.0001, audio.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.45);
          source.connect(highpass).connect(lowpass).connect(gain).connect(audio.destination);
          source.onended = () => {
            source.disconnect();
            highpass.disconnect();
            lowpass.disconnect();
            gain.disconnect();
          };
          source.start();
          rainSource = source;
          rainGain = gain;
        } catch (value) {}
      };
      const thunder = () => {
        if (muted || thunderVolume <= 0 || document.hidden) return;
        ensureAudio();
        if (!audio || !window.PlayableSceneAudio) return;
        if (!thunderSound) thunderSound = new window.PlayableSceneAudio({
          profile: 'thunder',
          context: audio
        });
        thunderSound.play('thunder', {
          volume: thunderVolume,
          variant: thunderIndex++ % 2
        });
      };
      const updateMusicControl = (busy = false) => {
        musicToggle.setAttribute('aria-pressed', String(musicWanted));
        musicToggle.setAttribute('aria-busy', String(busy));
        musicLabel.textContent = busy ? "Caricamento…" : musicWanted ? "Musica attiva" : "Musica disattivata";
      };
      const cancelMusicFade = () => {
        if (musicFrame !== null) cancelAnimationFrame(musicFrame);
        musicFrame = null;
      };
      const fadeMusic = (target, finished) => {
        cancelMusicFade();
        if (!rockMusic) return;
        const from = rockMusic.volume;
        const started = performance.now();
        const tick = value => {
          if (!rockMusic) return;
          const fraction = Math.max(0, Math.min(1, (value - started) / 350));
          rockMusic.volume = Math.max(0, Math.min(1, from + (target - from) * fraction));
          if (fraction < 1) musicFrame = requestAnimationFrame(tick);else {
            musicFrame = null;
            finished?.();
          }
        };
        musicFrame = requestAnimationFrame(tick);
      };
      const pauseMusic = () => {
        cancelMusicFade();
        if (rockMusic) {
          rockMusic.volume = 0;
          rockMusic.pause();
        }
      };
      const musicFailed = revision => {
        if (revision !== musicRevision || !musicWanted || document.hidden) return;
        musicWanted = false;
        musicRevision++;
        pauseMusic();
        updateMusicControl();
        musicToggle.setAttribute('aria-label', "Musica non disponibile. Tocca per riprovare");
      };
      const startMusic = () => {
        if (!musicWanted || document.hidden) return;
        const revision = musicRevision;
        try {
          if (!rockMusic) {
            if (!window.Audio) {
              musicFailed(revision);
              return;
            }
            rockMusic = new window.Audio('./assets/audio/rock-theme-song-loop.mp3');
            rockMusic.loop = true;
            rockMusic.preload = 'none';
            rockMusic.volume = 0;
            rockMusic.addEventListener('error', () => musicFailed(musicRevision));
          }
          if (rockMusic.error) rockMusic.load();
          updateMusicControl(true);
          const playing = rockMusic.play();
          Promise.resolve(playing).then(() => {
            if (!musicWanted || document.hidden) {
              pauseMusic();
              return;
            }
            if (revision !== musicRevision) return;
            musicToggle.setAttribute('aria-label', "Musica rock");
            updateMusicControl();
            fadeMusic(0.45);
          }).catch(() => musicFailed(revision));
        } catch (value) {
          musicFailed(revision);
        }
      };
      colorToggle.addEventListener('click', () => {
        colored = !colored;
        colorToggle.setAttribute('aria-pressed', String(colored));
      });
      musicToggle.addEventListener('click', () => {
        musicWanted = !musicWanted;
        musicRevision++;
        updateMusicControl();
        if (musicWanted) startMusic();else fadeMusic(0, () => {
          if (!musicWanted) {
            rockMusic.pause();
            rockMusic.currentTime = 0;
          }
        });
      });
      const ripple = (x, y) => {
        const element = document.createElement('div');
        element.className = 'tap-ripple';
        element.style.left = x + 'px';
        element.style.top = y + 'px';
        root.querySelector('.storm').appendChild(element);
        setTimeout(() => element.remove(), 620);
      };
      canvas.addEventListener('pointerdown', event => {
        if (feedPreview || event.isPrimary === false || event.button > 0) return;
        hasInteracted = true;
        startRain();
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        createBolt(x, y);
        strikes++;
        strikeCount.textContent = String(strikes);
        strikeCounter.setAttribute('aria-label', strikes + (strikes === 1 ? " fulmine" : " fulmini"));
        ripple(x, y);
        guide.classList.add('hidden');
        guide.setAttribute('aria-hidden', 'true');
        thunder();
        if (navigator.vibrate) navigator.vibrate(22);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          stopRain();
          pauseMusic();
        } else {
          startRain();
          startMusic();
        }
      });
      window.addEventListener('pagehide', stopRain);
      window.addEventListener('pagehide', pauseMusic);
      window.addEventListener('pageshow', startRain);
      window.addEventListener('pageshow', startMusic);
      window.addEventListener('resize', resize);
      resize();
      requestAnimationFrame(frame);
    };
    start();
  })();

  // ./feed-entry-motion.js
  /* Decorative entry motion only. No game state, audio, timers or synthetic input. */
  (function () {
    'use strict';

    const script = {
      getAttribute(name) {
        return {
          "data-subject": "#root canvas",
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
    const selectors = ["p#guide"];
    const copy = new Set(["Tocca le nuvole per scatenare i fulmini"].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
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
}
function App() {
  React.useEffect(() => {
    startGame();
  }, []);
  return <><div id="game-surface" style={{
      width: "100%",
      height: "100%"
    }} /></>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
