/* Requested game-only layout follow-up, October 26. */
(()=>{
 const map=window.PLAYABLE_IMPLEMENTED_FIXES;if(!map)return;
 const rows=[
  [10,'playable2_20260927020828_y5a1vt','Raised the Color Wheel, target and guide together; kept the raised layout after entering from FYP.'],
  [14,'playable2_20260927020825_hjn7q5','Opening CTA aligned with the selected games at24% of canvas height.'],
  [15,'playable2_20260927020825_n4r34c','Opening CTA aligned with the selected games at24% of canvas height.'],
  [16,'playable2_20260927020825_lnwh1h','Opening CTA at24%; reserved a clear lane above the sand and balls. The lower playfield shares its visual and touch coordinates.'],
  [19,'playable2_20260927021136_x3i163','Opening CTA at24%, above the cube.'],
  [40,'playable2_20261001225611_zgfls0','Opening CTA at24%, above the pouring demo.'],
  [45,'playable2_20261001225821_af5uee','Added a compact white background to the CTA, preserving clearance above the knife.'],
  [51,'playable2_20261001230052_xrken6b','Opening CTA at24%, above the grass-swipe demo.'],
  [53,'playable2_20261001230122_0sowkn','Enlarged the console again; kept all six controls visible and the guide below the score.'],
  [58,'playable2_20261001230412_o52e38','Opening CTA at24%; kept its existing short dismissal after play begins.'],
  [61,'playable2_20261013020955_2hyyml','Replaced all five era devices with realistic, straight-on lens-facing cutouts.'],
  [62,'playable2_20261013021144_kzqdfu','Opening CTA at24% on a compact white background.'],
  [63,'01_petme_9gw00a_game','Opening CTA at24% on a compact white background, above the dog.'],
  [71,'bead_loop_20261019','Raised the cover bead loop by5% of canvas height; kept its size and entered gameplay layout.']
 ];
 for(const[number,id,copy]of rows){const p=map[id]||{},prefix='Oct26 batch layout: ';map[id]={...p,number,items:[...(p.items||[]).filter(s=>!s.startsWith(prefix)),prefix+copy],status:'Updated locally; awaiting user review.'};}
})();
