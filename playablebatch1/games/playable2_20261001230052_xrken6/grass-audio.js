/* Short, gesture-triggered rustles. No background loop or delayed retry. */
(function () {
  "use strict";
  const base = new URL("./assets/audio/", document.currentScript?.src || document.baseURI);
  window.createGrassAudio = function () {
    let disposed = false, lastPlay = -Infinity, previous = -1;
    const pool = [];
    const stop = () => {
      for (const item of pool) {
        item.ticket++;
        item.busy = false;
        try { item.element.pause(); item.element.currentTime = 0; } catch (_) {}
      }
      lastPlay = -Infinity;
    };
    const onVisibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stop);
    return {
      play() {
        const now = performance.now();
        if (disposed || document.hidden || now - lastPlay < 240 || typeof window.Audio !== "function") return;
        let item = pool.find(candidate => !candidate.busy);
        if (!item && pool.length >= 2) return;
        try {
          if (!item) {
            item = { element: new window.Audio(), busy: false, ticket: 0, variant: -1 };
            item.element.preload = "auto";
            item.element.loop = false;
            item.element.onended = item.element.onerror = () => { item.busy = false; };
            pool.push(item);
          }
          const variant = (previous + 1 + Math.floor(Math.random() * 2)) % 3;
          previous = variant;
          if (item.variant !== variant || item.element.error) {
            item.element.src = new URL("grass-rustle-" + (variant + 1) + ".mp3", base).href;
            item.variant = variant;
          }
          item.element.currentTime = 0;
          item.element.volume = .58 + Math.random() * .12;
          item.element.playbackRate = .94 + Math.random() * .12;
          item.element.preservesPitch = true;
          item.busy = true;
          const ticket = ++item.ticket;
          lastPlay = now;
          Promise.resolve(item.element.play()).then(() => {
            if (disposed || document.hidden || (ticket !== item.ticket && !item.busy)) {
              // A pending mobile play promise must not resurrect sound after leaving.
              try { item.element.pause(); } catch (_) {}
            }
          }).catch(() => { if (ticket === item.ticket) item.busy = false; });
        } catch (_) { if (item) item.busy = false; }
      },
      stop,
      dispose() {
        if (disposed) return;
        disposed = true;
        stop();
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", stop);
        for (const item of pool) {
          item.element.onended = item.element.onerror = null;
          try { item.element.removeAttribute("src"); item.element.load(); } catch (_) {}
        }
        pool.length = 0;
      }
    };
  };
})();
