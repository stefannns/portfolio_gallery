// Container sizing and idle-animation lifecycle only; game state remains in the original runtime.
(()=>{
  const html=document.documentElement;
  const fit=()=>{const root=document.getElementById('root');if(root)html.style.setProperty('--design-scale',String(Math.min(root.clientWidth/390,root.clientHeight/598)));};
  const visibility=()=>{html.dataset.designHidden=String(document.hidden);};
  const start=()=>{fit();visibility();const root=document.getElementById('root');if(root)new ResizeObserver(fit).observe(root);};
  document.addEventListener('visibilitychange',visibility);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
