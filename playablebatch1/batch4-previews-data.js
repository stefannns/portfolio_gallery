/* Four games added to the review pool, October26. */
(()=>{
 const map=window.PLAYABLE_IMPLEMENTED_FIXES;if(!map)return;
 const rows=[
  [9,'playable2_20260927020828_86gl5z','Added a paint-tube and mixing preview; placed the breathing drag guide above the bowl. Removed the accidental red rectangle.'],
  [33,'playable2_20260928030932_n6urd6','Added a stretching-net preview and breathing drag guide on a rounded white capsule. Removed points; only centered seconds remain, with the countdown starting on the first real drag.'],
  [47,'playable2_20261001225842_2d0kul','Added a thermal-trail preview and breathing drag guide; preview trails clear on entry. Dragging now follows the full play area beyond the old circular limit.'],
  [77,'eh_catch_the_hair_20261020','Added endless falling hair in the preview, with no pause or fitted stop; the breathing guide stays above the portrait. Tap timing remains unchanged.']
 ];
 for(const[number,id,copy]of rows){const p=map[id]||{},prefix='Oct26 Batch1 addition: ';map[id]={...p,number,items:[...(p.items||[]).filter(s=>!s.startsWith(prefix)),prefix+'Moved from Other into Batch1. '+copy],status:'Updated locally; awaiting user review.'};}
})();
