(function(root){
  'use strict';
  class HairCatch{
    constructor(settings,rng=Math.random){this.s=settings;this.rng=rng;this.selected=-1;this.reset();}
    reset(){this.state='falling';this.started=false;this.score=null;this.scoreAge=0;this.drop();}
    geometry(index=this.selected){
      const s=this.s,f=s.face,width=Math.max(280,Math.min(1600,f.width*s.wigFitFactor*s.sizes[index]));
      const height=width/s.wigAspects[index],angle=(f.rotation+s.rotations[index])*Math.PI/180;
      const cx=s.flips[index]?1-s.wigHoleCX[index]:s.wigHoleCX[index];
      const dx=(cx-.5)*width,dy=(.5-s.wigAnchors[index])*height;
      const shift=s.offsetY[index]*f.width/273;
      return{width,height,angle,flip:s.flips[index],x:f.x+s.offsetX[index]*f.width/273-(dx*Math.cos(angle)-dy*Math.sin(angle)),wearY:dx*Math.sin(angle)+dy*Math.cos(angle),targetY:f.targetY+shift};
    }
    drop(){let n=Math.floor(this.rng()*5);if(n===this.selected)n=(n+1)%5;this.selected=n;const g=this.geometry();this.y=640+g.height/2;this.state='falling';this.score=null;this.scoreAge=0;}
    tick(dt){if(this.state==='falling'){this.y-=this.s.fallSpeed*dt;if(this.y<-640-this.geometry().height/2)this.drop();}else{this.scoreAge+=dt;if(this.scoreAge>=2.8)this.drop();}}
    tap(){if(this.state==='stopped'){this.drop();return{next:true};}this.started=true;const g=this.geometry(),distance=Math.abs(this.y+g.wearY-g.targetY);this.score=distance<=5?100:Math.max(0,(1-distance/500)*100);this.scoreAge=0;this.state='stopped';return{score:this.score,distance};}
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={HairCatch};else root.HairCatch=HairCatch;
})(typeof window!=='undefined'?window:globalThis);
