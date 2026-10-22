/* Short, gesture-unlocked console cues. No music or idle oscillator. */
(function () {
  window.createSnakeConsoleFeedback = function () {
    let context = null, master = null, destroyed = false, generation = 0, lastClick = -Infinity;
    const voices = new Set();
    const stop = () => {
      generation++;
      for (const voice of [...voices]) {
        try { voice.oscillator.stop(); } catch (_) {}
        voice.oscillator.disconnect(); voice.gain.disconnect(); voices.delete(voice);
      }
    };
    const note = (frequency, start, duration, type, peak, endFrequency) => {
      if (voices.size >= 8) return;
      const oscillator = context.createOscillator(), gain = context.createGain();
      const voice = {oscillator, gain}; voices.add(voice);
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + .006);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      gain.gain.setValueAtTime(0, start + duration + .01);
      oscillator.connect(gain); gain.connect(master);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); voices.delete(voice); };
      oscillator.start(start); oscillator.stop(start + duration + .015);
    };
    const emit = kind => {
      if (destroyed || document.hidden || context.state !== 'running') return;
      const t = context.currentTime;
      if (kind === 'click') {
        if (t - lastClick < .055) return;
        lastClick = t; note(900, t, .055, 'triangle', .22, 330);
      } else if (kind === 'eat') {
        note(660, t, .09, 'triangle', .24); note(990, t + .065, .12, 'triangle', .22);
      } else if (kind === 'over') {
        [330, 220, 145].forEach((f, i) => note(f, t + i * .105, .16, 'sine', .22));
      } else if (kind === 'restart') {
        note(440, t, .08, 'triangle', .22); note(660, t + .06, .11, 'triangle', .22);
      } else {
        note(kind === 'pause' ? 280 : 520, t, .085, 'triangle', .22);
      }
    };
    const play = (kind, gesture = false) => {
      if (destroyed || document.hidden) return;
      try {
        if (!context) {
          if (!gesture) return;
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) return;
          context = new Audio(); master = context.createGain();
          master.gain.value = .32; master.connect(context.destination);
        }
        if (context.state === 'running') emit(kind);
        else if (gesture) {
          const token = generation;
          Promise.resolve(context.resume()).then(() => {
            if (token === generation) emit(kind);
          }).catch(() => {});
        }
      } catch (_) { /* Audio failure must never block game input. */ }
    };
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', stop);
    return {play, stop, destroy() {
      destroyed = true; stop();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', stop);
      if (master) master.disconnect();
      if (context) try { Promise.resolve(context.close()).catch(() => {}); } catch (_) {}
    }};
  };
}());
