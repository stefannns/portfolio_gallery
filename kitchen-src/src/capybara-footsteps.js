const STEP_URLS = [1, 2, 3, 4].map(index => `/audio/footsteps/capy-step-${index}.wav`);
const CONTACTS_PER_LOOP = 3;
const MIN_STEP_INTERVAL = .21;

/** A sample player owned by one walking actor. Creating it does not unlock audio. */
export function createCapybaraFootsteps({getRoot, isEnabled = () => true} = {}) {
  let context, master, filter, loading, disposed = false, status = 'locked';
  let buffers = [], previousTime = null, previousDuration = 0, wasMoving = false;
  let count = 0, sampleIndex = 0, lastStepAt = -Infinity;
  const voices = new Set(), bufferCache = new Map(), abort = new AbortController();
  const browser = typeof window === 'undefined' ? null : window;
  const page = typeof document === 'undefined' ? null : document;

  function publish() {
    const root = getRoot?.();
    if (!root?.dataset) return;
    root.dataset.footstepCount = String(count);
    root.dataset.footstepsReady = String(Boolean(buffers.length && context?.state === 'running'));
    root.dataset.footstepsPlaying = String(voices.size > 0);
    root.dataset.footstepsStatus = status;
  }

  function releaseVoice(voice, stop = false) {
    if (!voices.delete(voice)) return;
    voice.source.onended = null;
    if (stop) {try {voice.source.stop();} catch { /* Already ended. */ }}
    voice.source.disconnect();voice.gain.disconnect();
  }

  function stop() {
    for (const voice of voices) releaseVoice(voice, true);
    previousTime = null;wasMoving = false;
    publish();
  }

  function loadBuffer(url) {
    if (!bufferCache.has(url)) bufferCache.set(url, fetch(url, {signal: abort.signal})
      .then(response => {if (!response.ok) throw new Error('Footstep sample unavailable.');return response.arrayBuffer();})
      .then(data => context.decodeAudioData(data)));
    return bufferCache.get(url);
  }

  function unlock(event) {
    if (disposed || !event.isTrusted || !isEnabled() || page?.hidden) return;
    if (!context) {
      const AudioContext = browser?.AudioContext || browser?.webkitAudioContext;
      if (!AudioContext || status === 'unavailable') {status = 'unavailable';publish();return;}
      try {
        context = new AudioContext({latencyHint: 'interactive'});
        master = context.createGain();master.gain.value = .22;
        filter = context.createBiquadFilter();filter.type = 'lowpass';filter.frequency.value = 3500;filter.Q.value = .4;
        filter.connect(master);master.connect(context.destination);
        context.addEventListener('statechange', publish);
        status = 'loading';
        loading = Promise.allSettled(STEP_URLS.map(loadBuffer)).then(results => {
          if (disposed) return;
          buffers = results.filter(result => result.status === 'fulfilled').map(result => result.value);
          status = buffers.length ? 'ready' : 'unavailable';publish();
        });
      } catch {status = 'unavailable';publish();return;}
    }
    // Resume is called only from a trusted pointer/key gesture, including after a tab suspension.
    if (context.state === 'suspended') context.resume().then(publish).catch(() => {});
    publish();
  }

  function play(contact) {
    if (!buffers.length || context?.state !== 'running') return;
    const now = context.currentTime;
    if (now - lastStepAt < MIN_STEP_INTERVAL) return;
    try {
      const buffer = buffers[sampleIndex++ % buffers.length];
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = (contact % 2 ? 1.475 : 1.425) + (Math.random() - .5) * .035;
      const duration = Math.min(buffer.duration / source.playbackRate.value, .34);
      const level = .88 + Math.random() * .12;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + Math.min(.004, duration / 4));
      gain.gain.setValueAtTime(level, now + Math.max(.004, duration - .025));
      gain.gain.linearRampToValueAtTime(0, now + duration);
      source.connect(gain);gain.connect(filter);
      const voice = {source, gain};voices.add(voice);
      source.onended = () => {releaseVoice(voice);publish();};
      source.start(now);source.stop(now + duration);
      lastStepAt = now;count++;publish();
    } catch { /* A suspended/closed audio device must never interrupt movement. */ }
  }

  function update({moving, paused, soundEnabled = true, time, duration}) {
    if (disposed) return;
    const active = moving && !paused && soundEnabled && isEnabled() && !page?.hidden;
    if (!active || !Number.isFinite(time) || !(duration > 0)) {stop();return;}
    const phase = (time % duration + duration) % duration;
    if (!wasMoving || previousTime === null || duration !== previousDuration) {
      // The leg action resets on movement start, placing its first contact at the beginning.
      if (phase < duration / CONTACTS_PER_LOOP * .5) play(0);
    } else {
      const elapsed = phase >= previousTime ? phase - previousTime : duration - previousTime + phase;
      const previousContact = Math.floor(previousTime / duration * CONTACTS_PER_LOOP);
      const currentContact = Math.floor((previousTime + elapsed) / duration * CONTACTS_PER_LOOP);
      if (currentContact > previousContact) play(currentContact);
    }
    previousTime = phase;previousDuration = duration;wasMoving = true;publish();
  }

  const hidden = () => {if (page.hidden) stop();};
  browser?.addEventListener('keydown', unlock, {capture: true});
  browser?.addEventListener('pointerdown', unlock, {capture: true});
  browser?.addEventListener('blur', stop);
  page?.addEventListener('visibilitychange', hidden);
  publish();

  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;stop();abort.abort();
      browser?.removeEventListener('keydown', unlock, {capture: true});
      browser?.removeEventListener('pointerdown', unlock, {capture: true});
      browser?.removeEventListener('blur', stop);
      page?.removeEventListener('visibilitychange', hidden);
      context?.removeEventListener('statechange', publish);
      filter?.disconnect();master?.disconnect();
      if (context && context.state !== 'closed') context.close().catch(() => {});
      buffers = [];bufferCache.clear();loading = null;status = 'closed';publish();
    },
  };
}
