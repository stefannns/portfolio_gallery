(function(root){
  'use strict';
  class Makeover{
    constructor(settings){this.s=settings;this.reset();}
    reset(){this.state='waiting';this.stage=0;this.taps=0;this.contactDistance=0;this.busy=0;this.age=0;this.transition=0;this.events=[];this.actionAge=99;}
    // User-approved drag override. Each old tap unit now requires 40 logical px
    // of pressed movement inside the relevant facial region, never idle time.
    stroke(distance){if(!['waiting','playing'].includes(this.state)||this.busy>0||!Number.isFinite(distance)||distance<=0)return false;this.state='playing';this.contactDistance+=distance;while(this.contactDistance>=40&&this.taps<this.s.taps[this.stage]){this.contactDistance-=40;this.taps++;this.age=0;this.actionAge=0;this.events.push({type:'action',stage:this.stage,tap:this.taps});}if(this.taps>=this.s.taps[this.stage]){this.contactDistance=0;this.busy=this.s.moveSec+Math.max(0,this.s.vfxDuration[this.stage]+.05-this.s.flashSec);}return true;}
    static contactDistance(from,to,zones){const distance=Math.hypot(to.x-from.x,to.y-from.y);if(!Number.isFinite(distance)||distance===0)return 0;const steps=Math.max(1,Math.ceil(distance/4));let inside=0;for(let i=0;i<steps;i++){const t=(i+.5)/steps,x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t;if(zones.some(z=>((x-z.x)/z.rx)**2+((y-z.y)/z.ry)**2<=1))inside++;}return distance*inside/steps;}
    tick(dt){this.actionAge+=dt;if(this.state==='transition'){this.transition+=dt;if(this.transition>=this.s.flashSec){if(this.stage+1>=this.s.sequenceCount){this.state='result';this.events.push({type:'result'});}else{this.stage++;this.taps=0;this.contactDistance=0;this.state='waiting';this.busy=0;this.events.push({type:'stage',stage:this.stage});}}return;}if(this.state!=='playing'||this.busy<=0)return;this.busy=Math.max(0,this.busy-dt);this.age+=dt;if(this.busy===0&&this.taps>=this.s.taps[this.stage]){this.state='transition';this.transition=0;this.events.push({type:'transition',stage:this.stage});}}
    drain(){const e=this.events;this.events=[];return e;}
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={Makeover};else root.Makeover=Makeover;
})(typeof window!=='undefined'?window:globalThis);
