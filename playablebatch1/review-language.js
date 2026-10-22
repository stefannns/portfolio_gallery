/* Explicit, reversible game-language choice. Review comments and Batch IDs are untouched. */
(() => {
  const versions=window.PlayableItalianGames||{},key='playable-review-language-v1';
  let language='en';
  try{const query=new URLSearchParams(location.search).get('lang');language=['en','it'].includes(query)?query:localStorage.getItem(key)==='it'?'it':'en';}catch{}
  const supported=game=>!!game&&Object.hasOwn(versions,game.taskId);
  function source(game,value){
    if(language!=='it'||!supported(game))return value;
    const url=new URL(value,location.href);url.pathname=url.pathname.replace(/\.html$/,'.it.html');
    url.searchParams.set('lang','it');url.searchParams.set('localeVersion',versions[game.taskId].revision);return url.href;
  }
  function reflect(game=window.PlayableReviewLibrary?.getCurrent()){
    for(const control of document.querySelectorAll('[data-game-language]'))control.value=language;
    for(const note of document.querySelectorAll('[data-language-note]')){note.hidden=language!=='it'||supported(game);note.textContent='English only · outside Batch 1';}
  }
  function set(next){
    if(!['en','it'].includes(next)||next===language)return;
    language=next;try{localStorage.setItem(key,next);}catch{}
    const url=new URL(location.href);url.searchParams.set('lang',next);history.replaceState(history.state,'',url.href);
    reflect();window.dispatchEvent(new CustomEvent('playable-review-language-change',{detail:{language}}));
  }
  document.addEventListener('change',event=>{if(event.target.matches?.('[data-game-language]'))set(event.target.value);});
  document.addEventListener('DOMContentLoaded',()=>reflect());
  window.PlayableReviewLocale={get language(){return language;},source,supported,reflect,set};
})();
