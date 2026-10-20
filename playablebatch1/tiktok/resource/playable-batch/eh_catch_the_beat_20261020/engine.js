/* Pure rhythm logic. No browser, APJS, media, storage or platform dependencies. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CatchBeatEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
  class Round {
    constructor(settings){this.settings=settings;this.reset();}
    reset(){
      this.state='waiting';this.time=0;this.playerFrame=0;this.perfect=0;this.close=0;
      this.extraMiss=0;this.events=[];this.targets=[];this.result=null;
    }
    start(duration){
      this.reset();this.state='playing';
      this.duration=Math.max(1,duration);
      this.beat=clamp(Number(this.settings.beat)||.428,.05,1);
      this.hold=this.beat*clamp(Math.round(this.settings.holdBeats??2),0,8);
      const difficulty=clamp(Math.round(this.settings.difficulty)||4,1,5);
      this.perfectWindow=this.beat*(.14+(5-difficulty)*.04);
      this.closeWindow=this.beat*(.34+(5-difficulty)*.08);
      for(let t=this.hold+this.beat;t<=this.duration+1e-8;t+=this.beat)
        this.targets.push({time:t,best:Infinity,taps:0,judged:false,grade:'miss'});
      // First gesture has immediate visual meaning, without counting an early miss.
      this.playerFrame=1;return this;
    }
    advancePlayer(){this.playerFrame=this.playerFrame%this.settings.danceStateCount+1;}
    tap(time){
      if(this.state!=='playing')return null;
      const t=clamp(time,0,this.duration);
      this.tick(t);
      if(this.state!=='playing')return null;
      this.advancePlayer();
      if(t<this.hold)return {grade:'count-in',time:t};
      const index=Math.round((t-this.hold)/this.beat)-1;
      const target=this.targets[index];
      if(!target||target.judged){this.extraMiss++;return this.emit('miss',t,true);}
      const error=Math.abs(t-target.time);
      target.taps++;
      target.best=Math.min(target.best,error);
      if(target.taps>1){this.extraMiss++;return this.emit('miss',t,true);}
      const grade=error<=this.perfectWindow?'perfect':error<=this.closeWindow?'close':'miss';
      return this.emit(grade,t,false);
    }
    emit(grade,time,extra){const e={grade,time,extra};this.events.push(e);return e;}
    tick(time){
      if(this.state!=='playing')return;
      this.time=clamp(time,0,this.duration);
      for(const target of this.targets){
        if(target.judged||this.time<Math.min(target.time+this.closeWindow,this.duration))continue;
        target.judged=true;
        target.grade=target.best<=this.perfectWindow?'perfect':target.best<=this.closeWindow?'close':'miss';
        if(target.grade==='perfect')this.perfect++;
        else if(target.grade==='close')this.close++;
        if(target.taps===0)this.emit('miss',this.time,false);
      }
      if(this.time>=this.duration){
        const denominator=Math.max(1,this.targets.length+this.extraMiss);
        const percent=clamp(Math.round(100*(this.perfect+.7*this.close)/denominator),0,100);
        this.result={percent,perfect:this.perfect,close:this.close,miss:this.targets.length-this.perfect-this.close,extraMiss:this.extraMiss,total:this.targets.length,
          tier:percent>=95?'top':percent>=80?'good':percent>=60?'mid':'low'};
        this.state='result';
      }
    }
    bandFrame(){
      if(this.state==='result')return -1;
      const index=Math.floor((this.time-this.hold+1e-8)/this.beat);
      return index<1?0:(index-1)%this.settings.danceStateCount+1;
    }
    drain(){const out=this.events;this.events=[];return out;}
  }
  return {Round};
});
