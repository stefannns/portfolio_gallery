(function(root){
  'use strict';
  class Shaving{
    constructor(settings){this.s=settings;this.reset();}
    reset(){this.state='waiting';this.mode='pan';this.left=this.s.totalTaps;this.orientation=this.s.orientation===1?1:0;this.position=0;this.direction=1;this.progress=0;this.age=0;this.strokes=[];this.events=[];}
    switch(){if(this.s.orientation!==2||this.mode!=='pan'||!['waiting','playing'].includes(this.state))return false;this.orientation=1-this.orientation;this.position=0;return true;}
    tap(){if(this.mode!=='pan'||this.left<=0||!['waiting','playing'].includes(this.state))return false;this.state='playing';this.left--;this.mode='shave';this.progress=0;this.strokes.push({orientation:this.orientation,position:this.position,width:this.s.bladeWidth,progress:0});this.events.push({type:'cut'});return true;}
    tick(dt){if(this.state==='waiting'){this.pan(dt);return;}if(this.state==='delay'){this.age+=dt;if(this.age>=this.s.flashDelay){this.state='flash';this.age=0;this.events.push({type:'flash'});}return;}if(this.state==='flash'){this.age+=dt;if(this.age>=this.s.flashDuration){this.state='result';this.events.push({type:'result'});}return;}if(this.state!=='playing')return;
      if(this.mode==='pan')this.pan(dt);else if(this.mode==='shave'){this.progress=Math.min(1,this.progress+this.s.shaveSpeed*dt);this.strokes.at(-1).progress=this.progress;if(this.progress===1){this.events.push({type:'stop-cut'});if(!this.left){this.state='delay';this.age=0;}else{this.mode='return';this.age=0;}}}else{this.age+=dt;if(this.age>=this.s.returnSeconds){this.mode='pan';this.progress=0;}}
    }
    pan(dt){const p=((this.direction>0?this.position:2-this.position)+this.s.panSpeed*dt)%2;this.position=p<=1?p:2-p;this.direction=p<1?1:-1;}
    drain(){const e=this.events;this.events=[];return e;}
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={Shaving};else root.Shaving=Shaving;
})(typeof window!=='undefined'?window:globalThis);
