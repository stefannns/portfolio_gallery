/** One cancellable fade per player; stale frames can never finish an old fade. */
export function createMusicVolumeFade({
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = handle => cancelAnimationFrame(handle),
  now = () => performance.now(),
} = {}) {
  let frame = null, revision = 0;
  const cancel = () => {
    revision++;
    if (frame !== null) cancelFrame(frame);
    frame = null;
  };
  const fade = (audio, target, {duration = 300, onComplete} = {}) => {
    cancel();
    const active = revision, start = audio.volume, began = now();
    const finish = () => {
      if (active !== revision) return;
      frame = null;audio.volume = target;onComplete?.();
    };
    if (duration <= 0 || Math.abs(start - target) < .00001) {finish();return;}
    const step = () => {
      if (active !== revision) return;
      const progress = Math.min(1, Math.max(0, (now() - began) / duration));
      audio.volume = start + (target - start) * progress;
      if (progress === 1) finish();
      else frame = requestFrame(step);
    };
    frame = requestFrame(step);
  };
  return {cancel, fade};
}
