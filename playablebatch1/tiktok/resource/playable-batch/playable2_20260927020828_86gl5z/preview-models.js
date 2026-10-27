/* Read-only demonstration poses. No scoring, timers, input or game-state writes. */
(function(root){
 'use strict';
 const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
 function netPose(ms,width,height,columns,rows){
  const phase=(Math.max(0,ms)%3600)/3600;
  const pull=Math.sin(Math.PI*clamp((phase-.12)/.7))**2;
  return{row:Math.round(rows*.57),col:Math.round(columns*.45),dx:Math.min(48,width*.12)*pull,dy:Math.min(32,height*.055)*pull,ratio:pull*.8};
 }
 function heatPose(ms,width,height,radius){
  const t=Math.max(0,ms)/1350,reach=Math.min(radius*.45,width*.2,height*.17);
  return{x:width/2+Math.cos(t)*reach,y:height/2+Math.sin(t*1.37)*reach*.72};
 }
 const hairCycleMs=2400;
 function hairPose(ms,geometry,reduced=false){
  const phase=(Math.max(0,ms)%hairCycleMs)/hairCycleMs;
  const target=geometry.targetY-geometry.wearY;
  if(reduced)return{y:target,alpha:1};
  return{y:640+geometry.height/2-(1280+geometry.height)*phase,alpha:1};
 }
 const api=Object.freeze({netPose,heatPose,hairPose,hairCycleMs});
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PlayablePreviewModels=api;
})(typeof window==='object'?window:globalThis);
