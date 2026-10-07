/* Original procedural audio. No third-party recordings or runtime dependencies. */
(() => {
  'use strict';
  const randomFor = seed => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  class PlayableSceneAudio {
    constructor({ profile, context = null } = {}) {
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
      } catch (_) { return null; }
    }

    buffer(kind, variant = 0) {
      const key = kind + variant;
      if (this.buffers.has(key)) return this.buffers.get(key);
      const ctx = this.context;
      const seconds = { maze: 8, carve: 1.7, thunder: 3.4, step: .09, scare: .3, win: .55 }[kind];
      const stereo = kind === 'thunder';
      const buffer = ctx.createBuffer(stereo ? 2 : 1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        const random = randomFor(4027 + variant * 89 + channel * 193);
        let low = 0, grain = 0, peak = 0;
        const smoothing = Math.exp(-2 * Math.PI * (kind === 'maze' ? 140 : 85) / ctx.sampleRate);
        const highSmoothing = Math.exp(-2 * Math.PI * 420 / ctx.sampleRate);
        for (let i = 0; i < samples.length; i++) {
          const t = i / ctx.sampleRate;
          const white = random() * 2 - 1;
          low = low * smoothing + white * (1 - smoothing);
          grain = grain * highSmoothing + white * (1 - highSmoothing);
          let value;
          if (kind === 'maze') {
            // Slow, non-pitched air, deliberately behind footsteps and encounters.
            value = low * (.68 + .16 * Math.sin(t * Math.PI / 2) + .08 * Math.sin(t * Math.PI));
          } else if (kind === 'carve') {
            const stroke = .42 + .26 * Math.sin(t * 18) ** 2 + .16 * Math.sin(t * 31 + .7) ** 2;
            value = (white - grain) * stroke * .3 + (random() > .997 ? white * .34 : 0);
          } else if (kind === 'thunder') {
            const crack = Math.exp(-t * 26) * .65 + Math.exp(-Math.abs(t - .07) * 60) * .2;
            const rolling = Math.exp(-t * 1.15) * (1 - Math.exp(-t * 24)) *
              (.65 + .3 * Math.sin(t * 12 + variant) ** 2);
            const echoes = Math.exp(-Math.abs(t - .28) * 15) * .28 +
              Math.exp(-Math.abs(t - .64) * 9) * .2 + Math.exp(-Math.abs(t - 1.12) * 7) * .12;
            value = white * crack + low * 9 * (rolling + echoes);
            value *= Math.min(1, t / .003, (seconds - t) / .28);
          } else if (kind === 'win') {
            value = [261.63, 329.63, 392].reduce((sum, hz) => sum + Math.sin(t * Math.PI * 2 * hz), 0) *
              Math.min(1, t / .02) * Math.exp(-t / .12) * Math.min(1, (seconds - t) / .05);
          } else {
            const length = kind === 'step' ? .03 : .09;
            value = (low * 3 + white * .08) * Math.exp(-t / length) * Math.min(1, t / .006);
          }
          samples[i] = value;
          peak = Math.max(peak, Math.abs(value));
        }
        const scale = .8 / Math.max(.001, peak);
        for (let i = 0; i < samples.length; i++) samples[i] *= scale;
        if (kind === 'maze' || kind === 'carve') {
          // Match loop endpoints to avoid clicks at the buffer boundary.
          const blend = Math.round(ctx.sampleRate * .02);
          for (let i = 0; i < blend; i++) {
            const mix = i / blend;
            samples[samples.length - blend + i] = samples[samples.length - blend + i] * (1 - mix) + samples[i] * mix;
          }
        }
      }
      this.buffers.set(key, buffer);
      return buffer;
    }

    play(kind, { loop = false, volume = .12, variant = 0 } = {}) {
      const ctx = this.unlock();
      if (!ctx) return null;
      try {
        // Rapid touches cannot accumulate unbounded audio nodes or excessive level.
        const limit = kind === 'thunder' ? 3 : 4;
        const active = [...this.voices].filter(v => !v.stopping);
        while (active.length >= limit) this.stopVoice(active.shift(), .025);
        const source = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        source.buffer = this.buffer(kind, variant);
        source.loop = loop;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(kind === 'maze' ? 500 : kind === 'carve' ? 4600 : kind === 'thunder' ? 3200 : 1700, ctx.currentTime);
        if (kind === 'thunder') filter.frequency.exponentialRampToValueAtTime(230, ctx.currentTime + 2.9);
        filter.Q.value = .45;
        const level = Math.min(.4, Math.max(0, volume)) / Math.sqrt(active.length + 1);
        const attack = kind === 'maze' ? 1.2 : kind === 'carve' ? .035 : .004;
        gain.gain.setValueAtTime(.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(Math.max(.0001, level), ctx.currentTime + attack);
        source.connect(filter).connect(gain).connect(ctx.destination);
        const voice = { source, filter, gain, stopping: false };
        this.voices.add(voice);
        source.onended = () => {
          source.disconnect(); filter.disconnect(); gain.disconnect();
          this.voices.delete(voice);
          if (this.loopVoice === voice) this.loopVoice = null;
        };
        source.start();
        if (!loop) source.stop(ctx.currentTime + source.buffer.duration + .02);
        return voice;
      } catch (_) { return null; }
    }

    setLoop(wanted) {
      this.loopWanted = Boolean(wanted);
      if (!wanted || document.hidden) {
        if (this.loopVoice) this.stopVoice(this.loopVoice, .12);
        this.loopVoice = null;
        return;
      }
      if (!this.loopVoice) this.loopVoice = this.play(this.profile, {
        loop: true, volume: this.profile === 'maze' ? .035 : .14
      });
    }

    stopVoice(voice, fade = .08) {
      if (!voice || voice.stopping) return;
      voice.stopping = true;
      try {
        const at = this.context.currentTime;
        const param = voice.gain.gain;
        if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(at);
        else { param.cancelScheduledValues(at); param.setValueAtTime(Math.max(.0001, param.value), at); }
        param.exponentialRampToValueAtTime(.0001, at + fade);
        // A finite source already has a stop scheduled; replace it with the fade's end.
        voice.source.stop(at + fade + .01);
      } catch (_) {}
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
