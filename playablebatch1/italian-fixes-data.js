/* Local language additions, separate from differences versus the reference. */
(() => {
  const map=window.PLAYABLE_IMPLEMENTED_FIXES;if(!map)return;
  for(const [id,game]of Object.entries(window.PlayableItalianGames||{})){
    const previous=map[id]||{},item='Added an optional Italian game version. Choose English / Italiano beside Direct / FYP; language stays selected when changing games.';
    map[id]={...previous,number:game.number,items:[...(previous.items||[]).filter(text=>!text.startsWith('Added an optional Italian game version.')),item],status:'Updated locally; awaiting user review.',evidence:[...new Set([...(previous.evidence||[]),'Italian Batch 1 follow-up 20261021'])]};
  }
})();
