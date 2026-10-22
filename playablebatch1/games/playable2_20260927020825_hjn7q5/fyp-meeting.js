/* Game-owned opening adaptation; never dispatches gameplay input or writes scores. */
(() => {
  'use strict';
  const game=Number(document.currentScript?.dataset.game);
  const html=document.documentElement;
  const hosted=!!document.querySelector('script[src*="playable-batch/review-host.js"]')||new URLSearchParams(location.search).get('feedReview')==='1';
  html.dataset.meetingGame=String(game);
  html.dataset.meetingFyp=hosted?'preview':'direct';
  let active=!hosted,guideUsed=false,guide=null,demo=null;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const resetIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></svg>';
  const mark=(el,name)=>{el?.classList.add(name);return el;};
  function addGuide(container,text){if(!guide){guide=document.createElement('p');guide.className='meeting-guide';guide.textContent=text;container.append(guide);}return guide;}
  function attach(){
    const app=document.querySelector('#root>div');if(!app)return;
    const canvas=app.querySelector('canvas');
    if(game===15&&canvas){mark(canvas.parentElement,'meeting-orbital-board');mark(app.querySelector('h1')?.parentElement,'meeting-orbital-heading');}
    if(game===16){
      const counter=app.querySelector('[aria-label^="Level "]');
      if(counter){mark(counter.parentElement,'meeting-sand-hud');
        const balls=counter.nextElementSibling;if(balls){mark(balls,'meeting-sand-ball-count');let label=balls.querySelector('small');if(!label){label=document.createElement('small');label.textContent='Balls';balls.prepend(label);}}}
      const reset=[...app.querySelectorAll('button')].find(b=>b.textContent.trim()==='RESET'||b.classList.contains('meeting-sand-reset'));
      if(reset&&!reset.classList.contains('meeting-sand-reset')){reset.setAttribute('aria-label','Reset level');reset.title='Reset level';mark(reset,'meeting-sand-reset');mark(reset.parentElement,'meeting-sand-reset-wrap');reset.innerHTML=resetIcon;}
    }
    if(game===19&&canvas){mark(app.children[1],'meeting-cube-heading');mark(canvas.parentElement,'meeting-cube-board');}
    if(game===17){const replay=app.querySelector('.btn-neon');if(replay)mark(replay.parentElement.parentElement,'meeting-synth-result');}
    if(game===32&&canvas){mark(canvas.parentElement.parentElement,'meeting-peeler-board');const hint=[...app.querySelectorAll('p')].find(p=>p.textContent==='Tap to drop the peeler');mark(hint?.parentElement,'meeting-peeler-guide');}
    if(game===35&&canvas){
      addGuide(app,'Tap the lowest dark tile');
      const hud=[...app.children].find(el=>el.tagName==='DIV'&&el.textContent.trim()==='0');if(hud)mark(hud,'meeting-piano-hud');
      guide.hidden=!!app.querySelector('button')||[...app.querySelectorAll('div')].some(el=>el.classList.contains('meeting-piano-hud')&&Number(el.textContent)>0);
    }
    if(game===40&&canvas){
      mark(app.querySelector('.hide-scrollbar'),'meeting-pixel-palette');
      const clear=[...app.querySelectorAll('button')].find(b=>b.textContent==='Clear');mark(clear?.parentElement,'meeting-pixel-clear');
      const label=[...app.children].find(el=>el.tagName==='DIV'&&!el.querySelector('canvas,button')&&el.textContent==='Sand');mark(label,'meeting-pixel-label');
      addGuide(app,'Drag to pour · choose a material');
    }
    if(game===41){const shell=app.querySelector('header')?.parentElement;mark(shell,'meeting-chat-shell');}
    // No.45's real knife renderer supplies its decorative, non-scoring preview.
    sync();
  }
  function sync(){
    if(demo)demo.hidden=!hosted||active;
    if(game===40&&guide)guide.hidden=active&&guideUsed;
    html.toggleAttribute('data-meeting-inactive',document.hidden);
  }
  const observer=new MutationObserver(attach);
  const root=document.getElementById('root');
  if(root)observer.observe(root,{subtree:true,childList:true,characterData:true});
  attach();
  // Real game input hides only the new Pixel Sandbox instruction; palette taps do not count.
  document.addEventListener('pointerdown',event=>{
    if(game===40&&active&&event.isPrimary!==false&&event.button<=0&&event.target.tagName==='CANVAS'&&guide){guideUsed=true;guide.hidden=true;}
  },{capture:true});
  addEventListener('message',event=>{
    if(!hosted||event.source!==parent||event.origin!==location.origin||event.data?.type!=='playable-active')return;
    active=event.data.active===true;html.dataset.meetingFyp=active?'playing':'preview';sync();
  });
  document.addEventListener('visibilitychange',sync);
  reduced.addEventListener?.('change',sync);
  addEventListener('pagehide',()=>{observer.disconnect();},{once:true});
})();
