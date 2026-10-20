(function(root){
  'use strict';
  class Feeding{
    constructor(settings,rng=Math.random){this.s=settings;this.rng=rng;this.reset();}
    reset(){this.state='waiting';this.remaining=this.s.gameDuration;this.initialWeight=90+Math.floor(this.rng()*111);this.weight=this.initialWeight;this.hits=0;this.reaction='normal';this.reactionLeft=0;this.items=[];this.events=[];let last='';const count=Math.max(2,Math.ceil(this.s.scrollSpeed*this.s.gameDuration/this.s.itemSpacing)+1);for(let i=0;i<count;i++){const good=i===0||this.rng()>=this.s.negativePercent/100;let type=Math.floor(this.rng()*(good?6:2));if(last===(good?'g':'b')+type)type=(type+1)%(good?6:2);last=(good?'g':'b')+type;this.items.push({id:i,good,type,x:-i*this.s.itemSpacing,phase:'scroll',age:0});}}
    hit(id){if(this.state==='result')return false;const item=this.items.find(i=>i.id===id&&i.phase==='scroll'&&Math.abs(i.x)<=135);if(!item)return false;if(this.state==='waiting')this.state='playing';item.phase='eating';item.age=0;item.startX=item.x;return true;}
    hitPlate(){const item=this.items.filter(i=>i.phase==='scroll'&&Math.abs(i.x)<=135).sort((a,b)=>Math.abs(a.x)-Math.abs(b.x))[0];return item?this.hit(item.id):false;}
    tick(dt){if(this.state!=='playing')return;const step=Math.min(dt,this.remaining);this.remaining=Math.max(0,this.remaining-dt);this.reactionLeft=Math.max(0,this.reactionLeft-step);if(!this.reactionLeft)this.reaction='normal';for(const item of this.items){if(item.phase==='scroll'){item.x+=this.s.scrollSpeed*step;if(item.x>540)item.phase='gone';}else if(item.phase==='eating'){item.age+=step;if(item.age>=this.s.eatFlyDuration){item.phase='gone';if(item.good){this.hits++;this.weight+=this.s.lbPerHit;this.reaction='happy';this.reactionLeft=this.s.headSegmentationDuration;}else{this.reaction='badFace';this.reactionLeft=this.s.badFaceDuration;}this.events.push({type:'eat',good:item.good});}}}if(!this.remaining){this.state='result';this.items=[];this.events.push({type:'result'});}}
    drain(){const e=this.events;this.events=[];return e;}
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={Feeding};else root.Feeding=Feeding;
})(typeof window!=='undefined'?window:globalThis);
