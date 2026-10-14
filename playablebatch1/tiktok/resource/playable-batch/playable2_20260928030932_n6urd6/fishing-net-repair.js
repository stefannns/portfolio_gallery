(() => {
  const attachInputGuard = () => {
    const canvas = document.querySelector("canvas");
    if (!canvas || canvas.dataset.netInputRepair === "1") return false;

    canvas.dataset.netInputRepair = "1";
    canvas.style.touchAction = "none";

    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (_) {
        // Pointer capture is an enhancement; the original handlers still work.
      }
    }, { passive: false });

    const releasePointer = (event) => {
      try {
        if (canvas.hasPointerCapture(event.pointerId)) {
          canvas.releasePointerCapture(event.pointerId);
        }
      } catch (_) {
        // Ignore browsers without full pointer-capture support.
      }
    };

    canvas.addEventListener("pointerup", releasePointer);
    canvas.addEventListener("pointercancel", releasePointer);
    return true;
  };

  if (!attachInputGuard()) {
    const observer = new MutationObserver(() => {
      if (attachInputGuard()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
