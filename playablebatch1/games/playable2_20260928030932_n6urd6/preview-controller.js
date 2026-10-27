/* Game-specific FYP presentation. Never sends or simulates gameplay input. */
(()=>{
 'use strict';
 const game=Number(document.currentScript?.dataset.game),html=document.documentElement;
 const hosted=!!document.querySelector('script[src*="playable-batch/review-host.js"]')||new URLSearchParams(location.search).get('host')==='fyp'||new URLSearchParams(location.search).get('feedReview')==='1';
 const media=matchMedia('(prefers-reduced-motion: reduce)');
 let preview=hosted,origin=performance.now(),used=false,guide=null,paintApp=null;
 html.dataset.batch4Game=String(game);
 function sync(){html.dataset.batch4Preview=String(preview);html.toggleAttribute('data-batch4-paused',document.hidden);html.toggleAttribute('data-batch4-reduced',media.matches);}
 function message(event){
  if(event.source!==parent||parent===window||event.origin!==location.origin||event.data?.type!=='playable-active')return;
  preview=event.data.active!==true;origin=performance.now();
  if(preview){used=false;if(guide)guide.hidden=false;}
  sync();attachNet();
 }
 function mark(element,name){if(element&&!element.classList.contains(name))element.classList.add(name);return element;}
 function geometry(){
  if(!paintApp)return;
  const bowl=paintApp.querySelector('.color-mix-bowl'),tube=paintApp.querySelector('.color-tubes img[alt="red"]');
  if(!bowl||!tube)return;
  const a=paintApp.getBoundingClientRect(),b=bowl.getBoundingClientRect(),t=tube.getBoundingClientRect();
  for(const [key,value]of Object.entries({sx:t.left-a.left+t.width/2,sy:t.top-a.top+t.height/2,ex:b.left-a.left+b.width*.56,ey:b.top-a.top+b.height*.38,tw:t.width,th:t.height}))paintApp.style.setProperty('--paint-'+key,value+'px');
 }
 function attachPaint(){
  if(game!==9)return;
  const app=document.querySelector('#root>div'),round=app?.querySelector('.color-round');if(!app||!round)return;
  paintApp=mark(app,'color-game');
  const panel=mark(round.parentElement?.parentElement?.parentElement,'color-panel');
  if(!panel)return;
  mark(panel.parentElement,'color-header');mark(round.parentElement,'color-round-group');
  const reset=mark(panel.querySelector('button'),'color-reset');
  mark(reset?.previousElementSibling,'color-target-swatch');mark(reset?.parentElement,'color-target-group');
  if(reset)reset.setAttribute('aria-label','Clear mixed paint');
  mark(panel.lastElementChild,'color-progress-row');
  const bowl=mark([...app.querySelectorAll('div')].find(e=>e.style.aspectRatio==='1 / 1'||e.style.aspectRatio==='1/1'),'color-mix-bowl');
  if(!bowl)return;
  mark(bowl.parentElement,'color-bowl-wrap');
  const red=app.querySelector('img[alt="red"]');mark(red?.parentElement?.parentElement?.parentElement,'color-tubes');
  if(!guide||!guide.isConnected){guide=document.createElement('p');guide.className='color-guide';guide.textContent='Drag paint into the bowl';app.append(guide);}
  guide.hidden=used;
  if(!bowl.querySelector('.color-preview-paint')){const paint=document.createElement('div');paint.className='color-preview-paint';paint.setAttribute('aria-hidden','true');bowl.append(paint);}
  // A direct tube image would match the legacy div:has(>img[src*=tube_])
  // repair and paint a full-width red pseudo-element on the entire game.
  if(red&&!app.querySelector('.color-preview-tube')){const ghost=document.createElement('div');ghost.className='color-preview-tube';ghost.setAttribute('aria-hidden','true');red.addEventListener('load',geometry,{once:true});app.append(ghost);}
  geometry();
 }
 function input(event){
  if(game!==9||preview||event.isPrimary===false||event.button>0)return;
  if(event.target.closest('.color-tubes img')){used=true;if(guide)guide.hidden=true;}
  if(event.target.closest('.color-reset')){used=false;if(guide)guide.hidden=false;}
 }
 function attachNet(){
  if(game!==33)return;
  const root=document.getElementById('root');if(!root)return;
  let copy=root.querySelector('[data-net-preview-guide]');
  if(!copy){copy=document.createElement('p');copy.className='feed-first-action';copy.dataset.netPreviewGuide='';copy.textContent='Drag the net to tear it';root.append(copy);}
  const hidden=!!root.querySelector('p.feed-first-action:not([data-net-preview-guide])');
  if(copy.hidden!==hidden)copy.hidden=hidden;
 }
 const observer=new MutationObserver(()=>{attachPaint();attachNet();});
 if([9,33].includes(game)&&document.getElementById('root'))observer.observe(document.getElementById('root'),{subtree:true,childList:true});
 const resize=new ResizeObserver(geometry);resize.observe(document.documentElement);
 window.PlayableBatch4Preview=Object.freeze({
  get active(){return preview&&!document.hidden;},get reduced(){return media.matches;},
  elapsed(now=performance.now()){return Math.max(0,now-origin);},
  netDrag(width,height,columns,rows,now){return preview&&!document.hidden&&!media.matches?window.PlayablePreviewModels.netPose(Math.max(0,now-origin),width,height,columns,rows):null;}
 });
 addEventListener('message',message);addEventListener('resize',geometry);
 document.addEventListener('pointerdown',input,{capture:true,passive:true});
 document.addEventListener('visibilitychange',sync);media.addEventListener?.('change',sync);
 addEventListener('pagehide',()=>{observer.disconnect();resize.disconnect();removeEventListener('message',message);removeEventListener('resize',geometry);document.removeEventListener('pointerdown',input,true);document.removeEventListener('visibilitychange',sync);media.removeEventListener?.('change',sync);},{once:true});
 sync();attachPaint();attachNet();
})();
