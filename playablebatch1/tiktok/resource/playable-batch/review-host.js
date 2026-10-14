// Review-only capability gate. The source game stays unchanged in the review library.
(() => {
  let active = false;
  let alive = true;
  const waiting = new Set();
  const contexts = new Set();
  const media = new Set();
  const streams = new Set();
  const onActive = () => new Promise((resolve, reject) => waiting.add({resolve, reject}));
  const release = () => { for (const job of waiting) job.resolve(); waiting.clear(); };
  if (navigator.mediaDevices?.getUserMedia) {
    const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!active) await onActive();
      const stream = await native(constraints);
      if (!alive || !active) { stream.getTracks().forEach(track=>track.stop()); throw new DOMException('Review frame inactive','AbortError'); }
      streams.add(stream); return stream;
    };
  }
  for (const key of ['AudioContext', 'webkitAudioContext']) {
    const Native = window[key];
    if (!Native) continue;
    window[key] = class ReviewAudioContext extends Native {
      constructor(...args) { super(...args); contexts.add(this); if (!active) super.suspend().catch(() => {}); }
      async resume() { if (!active) await onActive(); return super.resume(); }
    };
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = async function(...args) {
    media.add(this);
    if (!active) await onActive();
    return play.apply(this, args);
  };
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    active = event.data.active === true;
    if (active) {
      release();
      for (const context of contexts) if (context.state !== 'closed') context.resume().catch(() => {});
    } else {
      for (const context of contexts) if (context.state !== 'closed') context.suspend().catch(() => {});
      for (const item of media) item.pause();
    }
  });
  window.addEventListener('pagehide', () => {
    alive = false;
    for (const job of waiting) job.reject(new DOMException('Review frame closed', 'AbortError'));
    waiting.clear();
    for (const context of contexts) if (context.state !== 'closed') context.close().catch(() => {});
    for (const item of media) item.pause();
    for (const stream of streams) stream.getTracks().forEach(track=>track.stop());
  }, {once:true});
})();
