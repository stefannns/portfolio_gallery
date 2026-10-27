const MASTER_VOLUME = .18;
const MAX_VOICES = 24;
const EFFECT_COOLDOWN = {sink: .9, stove: .5, pop: .045, land: .15, tomatoThrow: .1, tomatoSplat: .1, fishFlop: .12, fishLand: .2};

/** Small, gesture-unlocked kitchen sounds. No downloads or delayed unlock replay. */
export function createKitchenToyAudio({getRoot, isEnabled = () => true} = {}) {
  const browser = typeof window === 'undefined' ? null : window;
  const page = typeof document === 'undefined' ? null : document;
  let context, master, noiseBuffer, disposed = false, unavailable = false;
  const voices = new Set();
  const counts = {sink: 0, stove: 0, pop: 0, land: 0, tomatoThrow: 0, tomatoSplat: 0, fishFlop: 0, fishLand: 0};
  const lastPlayed = {sink: -Infinity, stove: -Infinity, pop: -Infinity, land: -Infinity, tomatoThrow: -Infinity, tomatoSplat: -Infinity, fishFlop: -Infinity, fishLand: -Infinity};

  function publish() {
    const root = getRoot?.();
    if (!root?.dataset) return;
    root.dataset.kitchenSoundStatus = disposed ? 'closed' : unavailable ? 'unavailable' : !context ? 'locked' : context.state === 'running' ? 'ready' : context.state;
    root.dataset.kitchenSoundSinkCount = String(counts.sink);
    root.dataset.kitchenSoundStoveCount = String(counts.stove);
    root.dataset.kitchenSoundPopCount = String(counts.pop);
    root.dataset.kitchenSoundLandCount = String(counts.land);
    root.dataset.kitchenSoundVoices = String(voices.size);
    root.dataset.kitchenSoundTomatoThrowCount = String(counts.tomatoThrow);
    root.dataset.kitchenSoundTomatoSplatCount = String(counts.tomatoSplat);
    root.dataset.kitchenSoundFishFlopCount = String(counts.fishFlop);
    root.dataset.kitchenSoundFishLandCount = String(counts.fishLand);
  }

  function release(voice, shouldStop = false) {
    if (!voices.delete(voice)) return;
    voice.source.onended = null;
    if (shouldStop) {try {voice.source.stop();} catch { /* Already ended. */ }}
    for (const node of voice.nodes) {try {node.disconnect();} catch { /* Device closed. */ }}
  }

  function stop() {
    for (const voice of voices) release(voice, true);
    publish();
  }

  function stateChanged() {
    // Never leave future bloops queued through a suspended/interrupted tab.
    if (context?.state !== 'running') stop();
    else publish();
  }

  function unlock(event) {
    if (disposed || unavailable || !event.isTrusted || !isEnabled() || page?.hidden) return;
    if (!context) {
      const AudioContext = browser?.AudioContext || browser?.webkitAudioContext;
      if (!AudioContext) {unavailable = true;publish();return;}
      try {
        context = new AudioContext({latencyHint: 'interactive'});
        master = context.createGain();master.gain.value = MASTER_VOLUME;
        master.connect(context.destination);
        // Reuse one quiet noise bed for filtered water, air, and tiny impacts.
        noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 1.4), context.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        let previous = 0;
        for (let index = 0; index < data.length; index++) {
          const white = Math.random() * 2 - 1;
          previous = previous * .45 + white * .55;
          data[index] = previous;
        }
        context.addEventListener('statechange', stateChanged);
      } catch {unavailable = true;publish();return;}
    }
    // Resume happens in a genuine gesture, never from an animation or timer.
    if (context.state === 'suspended' || context.state === 'interrupted') context.resume().then(publish).catch(() => {});
    publish();
  }

  function envelope(gain, start, duration, peak, attack = .008) {
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + Math.min(attack, duration / 3));
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    gain.gain.linearRampToValueAtTime(0, start + duration + .008);
  }

  function track(source, nodes, start, duration) {
    while (voices.size >= MAX_VOICES) release(voices.values().next().value, true);
    const voice = {source, nodes};voices.add(voice);
    source.onended = () => {release(voice);publish();};
    try {source.start(start);source.stop(start + duration + .012);}
    catch {release(voice, true);}
  }

  function tone(start, duration, frequency, endFrequency, peak, attack = .005, type = 'sine') {
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    envelope(gain, start, duration, peak, attack);
    oscillator.connect(gain);gain.connect(master);
    track(oscillator, [oscillator, gain], start, duration);
  }

  function noise(start, duration, frequency, endFrequency, peak, attack, type = 'bandpass', q = .65) {
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = type;filter.Q.value = q;
    filter.frequency.setValueAtTime(frequency, start);
    filter.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    envelope(gain, start, duration, peak, attack);
    source.connect(filter);filter.connect(gain);gain.connect(master);
    track(source, [source, filter, gain], start, duration);
  }

  function play(kind, makeSound) {
    if (disposed || !isEnabled() || page?.hidden || context?.state !== 'running') return false;
    const now = context.currentTime;
    if (now - lastPlayed[kind] < EFFECT_COOLDOWN[kind]) return false;
    try {
      makeSound(now + .003);
      lastPlayed[kind] = now;counts[kind]++;publish();return true;
    } catch {stop();return false; /* Sound failure must not affect a toy. */ }
  }

  const playSink = () => play('sink', now => {
    noise(now, .86, 1800, 900, .24, .025, 'bandpass', .7);
    // Rounded, descending resonances read as wet bubbles rather than notes.
    [510, 680, 440, 790, 560, 890].forEach((frequency, index) => {
      tone(now + .04 + index * .127, .14, frequency, frequency * .48, .22, .006);
    });
  });
  const playBubblePop = () => play('pop', now => {
    tone(now, .085, 950 + Math.random() * 180, 310, .22, .002);
    noise(now, .025, 3200, 1700, .07, .002, 'highpass');
  });
  const playStove = () => play('stove', now => {
    noise(now, .63, 650, 1900, .56, .035, 'bandpass', .6);
    tone(now, .28, 155, 245, .12, .02, 'triangle');
  });
  const playPanLand = () => play('land', now => {
    // Uneven partials give a small warm metal clink without a piercing bell.
    [[540, .19, .23], [893, .14, .10], [1464, .095, .045], [2200, .055, .02]].forEach(([frequency, duration, peak]) => {
      tone(now, duration, frequency, frequency * .98, peak, .002);
    });
    noise(now, .026, 2500, 1500, .055, .002, 'highpass');
  });

  const playTomatoThrow = () => play('tomatoThrow', now => {
    noise(now, .24, 800, 2300, .3, .018, 'bandpass', .6);
  });
  const playTomatoSplat = () => play('tomatoSplat', now => {
    noise(now, .16, 1300, 400, .48, .003, 'lowpass', .7);
    tone(now, .12, 370, 110, .18, .003);
  });

  const playFishFlop = () => play('fishFlop', now => {
    noise(now, .085, 1300, 450, .22, .003, 'lowpass');
    tone(now, .08, 260, 115, .09, .003);
  });
  const playFishLand = () => play('fishLand', now => {
    noise(now, .12, 1100, 330, .28, .004, 'lowpass');
    tone(now, .11, 210, 90, .12, .003);
  });

  const hidden = () => {if (page?.hidden) stop();};
  browser?.addEventListener('keydown', unlock, {capture: true});
  browser?.addEventListener('pointerdown', unlock, {capture: true});
  browser?.addEventListener('blur', stop);
  page?.addEventListener('visibilitychange', hidden);
  publish();

  return {
    playSink, playBubblePop, playStove, playPanLand, playTomatoThrow, playTomatoSplat, playFishFlop, playFishLand, stop,
    dispose() {
      if (disposed) return;
      disposed = true;stop();
      browser?.removeEventListener('keydown', unlock, {capture: true});
      browser?.removeEventListener('pointerdown', unlock, {capture: true});
      browser?.removeEventListener('blur', stop);
      page?.removeEventListener('visibilitychange', hidden);
      context?.removeEventListener('statechange', stateChanged);
      master?.disconnect();
      if (context && context.state !== 'closed') context.close().catch(() => {});
      noiseBuffer = null;publish();
    },
  };
}
