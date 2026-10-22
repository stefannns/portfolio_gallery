import {useEffect, useRef, useState} from 'react';
export function useFeedVisibility(ref,ready){
  const[visible,setVisible]=useState(false);
  useEffect(()=>{if(!ready||!ref.current)return;const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting&&entry.intersectionRatio>.1)),{threshold:[0,.1]});observer.observe(ref.current);return()=>observer.disconnect();},[ref,ready]);
  return visible;
}
export function useFeedPreview(){
  const[preview,setPreview]=useState(()=>new URLSearchParams(location.search).has('review')||new URLSearchParams(location.search).get('feedReview')==='1');
  useEffect(()=>{const receive=e=>{if(e.source===parent&&e.origin===location.origin&&e.data?.type==='playable-active')setPreview(e.data.active!==true);};addEventListener('message',receive);return()=>removeEventListener('message',receive);},[]);
  return preview;
}

export async function loadConfig() {
  let fallback={tweaks:[],texts:[],images:[]};
  try {fallback=JSON.parse(document.getElementById('playable-inline-config')?.textContent || '{}');} catch {}
  if(location.protocol==='file:')return fallback;
  try {const response=await fetch("./game.config.it.json?l10n=fc73ad291134",{cache:'no-store'});if(response.ok)return await response.json();} catch {}
  return fallback;
}

export const uiCss = `
.ui-game{--ui-scale:1;--ui-top:calc(30px * var(--ui-scale) + env(safe-area-inset-top,0px));--ui-bottom:calc(50px * var(--ui-scale) + env(safe-area-inset-bottom,0px));--ui-side:calc(30px * var(--ui-scale))}
.ui-guide{position:absolute;left:var(--ui-side);right:var(--ui-side);margin:0;text-align:center;font-size:calc(18px * var(--ui-scale));line-height:1.4;font-weight:500;overflow-wrap:anywhere;pointer-events:none;z-index:20}
.ui-float{animation:ui-guide-float 2.4s ease-in-out infinite}
@keyframes ui-guide-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.ui-game[data-page-hidden="true"] .ui-float{animation-play-state:paused}
.ui-game button{font-family:inherit;min-height:44px;min-width:44px;touch-action:manipulation}
.ui-game button:focus-visible,.ui-game [tabindex]:focus-visible{outline:3px solid #78baff;outline-offset:3px}
.ui-game[data-reduced-motion="true"] .ui-float{animation:none}
.ui-game[data-reduced-motion="true"] *{transition-duration:.001ms!important;animation-duration:.001ms!important;animation-iteration-count:1!important}
@media(prefers-reduced-motion:reduce){.ui-float{animation:none}}
`;

export function useUiStage(ref, ready = true) {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const node = ref.current;
    if (!node || !ready) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fit = () => node.style.setProperty('--ui-scale', String(Math.min(node.clientWidth / 390, node.clientHeight / 598)));
    const visibility = () => {node.dataset.pageHidden = String(document.hidden);};
    const motion = () => {node.dataset.reducedMotion = String(media.matches);setReduced(media.matches);};
    const observer = new ResizeObserver(fit);
    observer.observe(node);fit();visibility();motion();
    media.addEventListener('change',motion);
    document.addEventListener('visibilitychange',visibility);
    return () => {observer.disconnect();media.removeEventListener('change',motion);document.removeEventListener('visibilitychange',visibility);};
  }, [ref,ready]);
  return reduced;
}

// The gesture proceeds synchronously. A failed, pending or late unlock can never block input.
export function useToneGate(Tone, bank) {
  const lifetime = useRef({alive:true, epoch:0, pending:null});
  useEffect(() => {
    const state = lifetime.current;state.alive = true;
    const dispose = () => {
      state.epoch++;state.pending = null;
      for (const value of Object.values(bank.current)) if (value && typeof value.dispose === 'function') {try {value.dispose();} catch {}}
      bank.current = {ready:false,lastTime:0,lastNoiseTime:0};
    };
    state.dispose=dispose;
    const visibility = () => {if (document.hidden) dispose();};
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('pagehide',dispose);
    return () => {state.alive=false;dispose();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',dispose);};
  }, [bank,Tone]);
  const open = initialize => {
    const state = lifetime.current;
    if (bank.current.ready || state.pending) return;
    const epoch = state.epoch;
    let unlocked;
    try {unlocked = Tone.start();} catch {return;}
    state.pending = Promise.resolve(unlocked).then(() => {
      if (!state.alive || state.epoch !== epoch || document.hidden) return;
      bank.current = {...bank.current,...initialize(),ready:true};
    }).catch(() => {}).finally(() => {if (state.epoch === epoch) state.pending = null;});
  };
  open.stop=()=>lifetime.current.dispose?.();
  return open;
}
