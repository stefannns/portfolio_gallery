(() => {
  const LOGICAL_SIZE = 1000;

  const repair = () => {
    const hobo = document.querySelector('img[alt="hobo"]');
    if (!hobo) return false;
    const world = hobo.parentElement;
    const stage = world && world.parentElement;
    if (!world || !stage) return false;

    const fitWorld = () => {
      const scale = Math.max(0.35, stage.clientHeight / LOGICAL_SIZE);
      world.style.width = `${LOGICAL_SIZE}px`;
      world.style.height = `${LOGICAL_SIZE}px`;
      world.style.top = '0';
      world.style.bottom = 'auto';
      world.style.right = 'auto';
      world.style.transformOrigin = 'left top';
      world.style.zoom = String(scale);
    };

    hobo.style.objectPosition = 'center bottom';
    const observer = new ResizeObserver(fitWorld);
    observer.observe(stage);
    fitWorld();
    return true;
  };

  if (!repair()) {
    const observer = new MutationObserver(() => {
      if (repair()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
