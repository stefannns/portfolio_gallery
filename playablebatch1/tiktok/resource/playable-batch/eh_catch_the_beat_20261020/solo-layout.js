/* Solo presentation; original scene/config assets remain recoverable. */
(function(root){
  'use strict';
  function layout(width,height,result=false){
    const unit=Math.min(width/390,height/598);
    return {x:width/2,y:height*(result?.27:.385),scale:Math.min((width-60*unit)/460,height*.55/460)*(result?.64:1)};
  }
  function assetPaths(scene){
    return [...new Set([...Object.values(scene.frames).map(poses=>poses[0]),...Object.values(scene.textures)])];
  }
  const api={layout,assetPaths};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.CatchBeatSolo=api;
})(typeof window!=='undefined'?window:globalThis);
