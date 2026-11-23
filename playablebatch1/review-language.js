/* Public library: Italian only. Local authoring keeps both languages. */
(() => {
 const versions=window.PlayableItalianGames||{};
 const supported=game=>!!game&&Object.hasOwn(versions,game.taskId);
 function source(game,value){const v=versions[game?.taskId];if(!v)return value;const u=new URL(v.entry,location.href);u.searchParams.set('lang','it');u.searchParams.set('localeVersion',v.revision);return u.href;}
 function reflect(){document.querySelectorAll('[data-game-language]').forEach(c=>{c.value='it';c.disabled=true;});document.querySelectorAll('[data-language-note]').forEach(c=>c.hidden=true);}
 const url=new URL(location.href);url.searchParams.set('lang','it');history.replaceState(history.state,'',url);
 document.addEventListener('DOMContentLoaded',reflect);
 window.PlayableReviewLocale={language:'it',source,supported,reflect,set:()=>{}};
})();
