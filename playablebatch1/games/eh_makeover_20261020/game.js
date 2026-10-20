window.createGame=function(R){
 const{ctx:c,spec:s}=R,a=s.assets,m=new Makeover(s.settings),names=['Brush your teeth','Smile check','Wipe the tears','Makeup time'],verbs=['Tap to brush','Tap for a smile','Tap to wipe','Tap to blend'],sounds=['BRUSH','HAMMER','TISSUE','MAKEUP'];let played=false,resultAge=0,lastStage=0;
 function reset(){m.reset();played=false;resultAge=0;lastStage=0;R.guide(R.config.texts.find(t=>t.id==='GUIDE')?.value||verbs[0]);R.result('');R.setAction(verbs[0]);document.getElementById('play').disabled=false;}
 function target(){const p=m.stage===0?s.photoPoints.mouth:m.stage===2?s.photoPoints.eyes[(m.taps-1)%2]||s.photoPoints.eyes[0]:s.photoPoints.face;return R.point(a.looks[0],p);}
 return{reset,state:()=>({state:m.state,stage:m.stage,taps:m.taps,busy:m.busy,actionAge:m.actionAge}),isPlaying:()=>['playing','transition'].includes(m.state),
 action(){if(m.tap()){played=false;R.guide('',false);R.announce(names[m.stage]+', '+m.taps+' of '+s.settings.taps[m.stage]);}},
 update(dt){m.tick(dt);if(m.actionAge>=s.settings.moveSec&&!played&&m.state!=='waiting'){played=true;R.sound(sounds[m.stage],m.stage===1?.32:.4);}for(const e of m.drain()){if(e.type==='stage'){R.setAction(verbs[m.stage]);played=true;lastStage=m.stage;}if(e.type==='transition')R.sound('TRANSITION',.25);if(e.type==='result'){R.sound('FINAL',.38);R.result('Beautiful');R.announce('Makeover complete');}}
 if(m.state==='result')resultAge+=dt;document.getElementById('play').disabled=m.busy>0||['transition','result'].includes(m.state);R.hud(m.state==='result'?'':names[m.stage],m.state==='result'?'':m.taps+'/'+s.settings.taps[m.stage]);},
 draw(t){const stage=m.stage;R.photo(a.looks[stage]);if(m.state==='transition'){const p=R.clamp(m.transition/s.settings.flashSec,0,1);R.photo(a.looks[stage+1>=s.settings.sequenceCount?4:stage+1],p);}
 if(m.state==='result'){R.photo(a.looks[4]);R.frame(a.finalVfx,resultAge,2,R.w/2,R.h/2,R.w,R.h,true);return;}
 const dest=target(),rest={x:R.w*.72,y:R.h*.79},duration=s.settings.moveSec,age=m.actionAge;let x=rest.x,y=rest.y,rotation=-.22;
 if(age<duration){const p=R.ease(age/duration);x=R.mix(rest.x,dest.x,p);y=R.mix(rest.y,dest.y,p);}else if(age<duration*2){const p=R.ease((age-duration)/duration);x=R.mix(dest.x,rest.x,p);y=R.mix(dest.y,rest.y,p);}else if(m.state==='waiting'&&!R.reduced)y+=Math.sin(t*2.5)*5;
 const toolW=R.w*[.19,.30,.28,.27][stage];R.sprite(a.tools[stage],x,y,toolW,null,rotation);
 const fxAge=age-duration;if(fxAge>=0){if(stage===0)R.frame(a.vfx[stage],fxAge,s.settings.vfxDuration[stage],dest.x,dest.y,R.w*.27);else if(stage===1)R.frame(a.vfx[stage],fxAge,s.settings.vfxDuration[stage],dest.x,dest.y-30,R.w*.70);else if(stage===2)for(const eye of s.photoPoints.eyes){const p=R.point(a.looks[0],eye);R.frame(a.vfx[stage],fxAge,s.settings.vfxDuration[stage],p.x,p.y+R.h*.08,R.w*.16);}else R.frame(a.vfx[stage],fxAge,s.settings.vfxDuration[stage],dest.x,dest.y,R.w*.75);}
 }
 };
};
