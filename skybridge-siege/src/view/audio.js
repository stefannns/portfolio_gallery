// Small synthesised sound set, so the game has no audio assets to load, and the background
// music (assets/music/magical-showdown.mp3), looped seamlessly through Web Audio.

// The track's music runs from just after its lead-in silence to just after its last hit; looping
// between these skips the silence at either end, so it goes round without a gap.
const MUSIC = { url: './assets/music/magical-showdown.mp3', loopStart: 0.17, loopEnd: 118.5 };

export class Sfx {
  constructor() {
    this.context = null;
    this.muted = false;
  }

  /** Browsers only allow audio after a user gesture, so call this from a click. */
  unlock() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    this.context ??= new Context();
    this.master ??= (() => {
      const gain = this.context.createGain();
      gain.gain.value = 0.5;
      gain.connect(this.context.destination);
      return gain;
    })();
    this.context.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setMusicLevel(this.musicLevel ?? 0.4);
    return this.muted;
  }

  /** Starts the background music, once audio is unlocked. Safe to call again: it plays once. */
  async startMusic() {
    if (!this.context || this.musicStarted) return;
    this.musicStarted = true;
    try {
      const data = await (await fetch(MUSIC.url)).arrayBuffer();
      const buffer = await this.context.decodeAudioData(data);
      this.musicGain = this.context.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.context.destination);
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = MUSIC.loopStart;
      source.loopEnd = Math.min(MUSIC.loopEnd, buffer.duration);
      source.connect(this.musicGain);
      source.start(0, MUSIC.loopStart);
      this.music = source;
      this.setMusicLevel(this.musicLevel ?? 0.4, 1.5); // fade in
    } catch (error) {
      this.musicStarted = false;
      console.warn('[music] could not play', MUSIC.url, error);
    }
  }

  /** Music volume, 0 to 1, eased over `seconds`. Muting silences it too. */
  setMusicLevel(level, seconds = 0.6) {
    this.musicLevel = level;
    if (!this.musicGain || !this.context) return;
    const gain = this.musicGain.gain, now = this.context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(this.muted ? 0 : level, now + seconds);
  }

  tone({ from, to = from, duration = 0.25, type = 'sine', volume = 0.4, delay = 0 }) {
    const { context } = this;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  noise({ from, to = from, duration = 0.3, volume = 0.5, q = 1 }) {
    const { context } = this;
    const samples = Math.ceil(context.sampleRate * duration);
    const buffer = context.createBuffer(1, samples, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i += 1) data[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, context.currentTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), context.currentTime + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
  }

  play(event) {
    if (!this.context || this.muted) return;
    switch (event.type) {
      case 'fireball-cast':
        this.noise({ from: 500, to: 2600, duration: 0.32, volume: 0.6 });
        this.tone({ from: 150, to: 70, duration: 0.25, type: 'triangle', volume: 0.3 });
        break;
      case 'waterball-cast':
        // A rushing whoosh with a bubbly wobble under it.
        this.noise({ from: 1800, to: 400, duration: 0.38, volume: 0.5, q: 2.2 });
        this.tone({ from: 420, to: 260, duration: 0.18, type: 'sine', volume: 0.22 });
        this.tone({ from: 520, to: 300, duration: 0.16, type: 'sine', volume: 0.18, delay: 0.09 });
        break;
      case 'enemy-doused':
        // The charge hissing out.
        this.noise({ from: 5200, to: 2400, duration: 0.6, volume: 0.45, q: 0.7 });
        break;
      case 'shield-up':
        this.tone({ from: 300, to: 740, duration: 0.24, type: 'triangle', volume: 0.3 });
        this.tone({ from: 600, to: 1480, duration: 0.3, volume: 0.14 });
        break;
      case 'player-blocked':
        this.tone({ from: 1300, to: 900, duration: 0.42, type: 'triangle', volume: 0.4 });
        this.tone({ from: 1950, to: 1500, duration: 0.3, volume: 0.2 });
        this.noise({ from: 3200, to: 1400, duration: 0.14, volume: 0.35 });
        break;
      case 'player-hit':
        this.tone({ from: 120, to: 36, duration: 0.42, type: 'sawtooth', volume: 0.55 });
        this.noise({ from: 700, to: 120, duration: 0.3, volume: 0.7 });
        break;
      case 'enemy-hit':
        this.noise({ from: 1100, to: 140, duration: 0.42, volume: 0.8 });
        this.tone({ from: 200, to: 60, duration: 0.3, type: 'triangle', volume: 0.42 });
        break;
      case 'enemy-warded':
        this.tone({ from: 880, to: 620, duration: 0.2, type: 'square', volume: 0.12 });
        break;
      case 'enemy-telegraph':
        this.tone({ from: 150, to: 620, duration: event.durationMs / 1000, type: 'sawtooth', volume: 0.1 });
        break;
      case 'enemy-release':
        this.tone({ from: 720, to: 180, duration: 0.3, type: 'square', volume: 0.14 });
        break;
      case 'player-move':
        this.noise({ from: 2200, to: 500, duration: 0.2, volume: 0.34, q: 1.4 });
        break;
      case 'skyfall':
        this.noise({ from: 6000, to: 80, duration: 0.7, volume: 0.95, q: 0.5 });
        this.tone({ from: 90, to: 28, duration: 0.8, type: 'sawtooth', volume: 0.6 });
        break;
      case 'fizzle':
        this.noise({ from: 400, to: 200, duration: 0.12, volume: 0.2 });
        break;
      case 'victory':
        [392, 494, 587, 784].forEach((from, i) => this.tone({ from, duration: 0.7, type: 'triangle', volume: 0.3, delay: i * 0.13 }));
        break;
      case 'defeat':
        [330, 262, 196, 131].forEach((from, i) => this.tone({ from, duration: 0.8, type: 'triangle', volume: 0.3, delay: i * 0.2 }));
        break;
      default:
        break;
    }
  }
}
