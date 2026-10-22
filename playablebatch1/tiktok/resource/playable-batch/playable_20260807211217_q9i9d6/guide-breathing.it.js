/* Decorative guide visibility only: no inputs, timers, sound or game state. */
(() => {
  const root=document.documentElement;
  let intersecting=true;
  const update=()=>root.toggleAttribute('data-guide-breathing-paused',document.hidden||!intersecting);
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    intersecting=entries.some(entry=>entry.isIntersecting);update();
  }):null;
  if(document.body)observer?.observe(document.body);
  document.addEventListener('visibilitychange',update);update();
  window.addEventListener('pagehide',()=>{observer?.disconnect();document.removeEventListener('visibilitychange',update);},{once:true});
})();
