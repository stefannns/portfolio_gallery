(function(root){
  'use strict';
  class Makeover{
    constructor(settings){this.s=settings;this.reset();}
    reset(){this.state='waiting';this.stage=0;this.taps=0;this.busy=0;this.age=0;this.transition=0;this.events=[];this.actionAge=99;}
    tap(){if(!['waiting','playing'].includes(this.state)||this.busy>0)return false;this.state='playing';this.taps++;this.age=0;this.actionAge=0;this.busy=this.s.moveSec*2;this.events.push({type:'action',stage:this.stage,tap:this.taps});if(this.taps>=this.s.taps[this.stage])this.busy=this.s.moveSec+Math.max(0,this.s.vfxDuration[this.stage]+.05-this.s.flashSec);return true;}
    tick(dt){this.actionAge+=dt;if(this.state==='transition'){this.transition+=dt;if(this.transition>=this.s.flashSec){if(this.stage+1>=this.s.sequenceCount){this.state='result';this.events.push({type:'result'});}else{this.stage++;this.taps=0;this.state='playing';this.busy=0;this.events.push({type:'stage',stage:this.stage});}}return;}if(this.state!=='playing'||this.busy<=0)return;this.busy=Math.max(0,this.busy-dt);this.age+=dt;if(this.busy===0&&this.taps>=this.s.taps[this.stage]){this.state='transition';this.transition=0;this.events.push({type:'transition',stage:this.stage});}}
    drain(){const e=this.events;this.events=[];return e;}
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={Makeover};else root.Makeover=Makeover;
})(typeof window!=='undefined'?window:globalThis);
