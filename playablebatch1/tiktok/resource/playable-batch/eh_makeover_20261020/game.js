window.createGame=function(R){
 const{ctx:c,spec:s}=R,a=s.assets,m=new Makeover(s.settings),names=['Brush your teeth','Smile check','Wipe the tears','Makeup time'],verbs=['Drag to brush','Drag across the face','Drag to wipe','Drag to blend'],sounds=['BRUSH','HAMMER','TISSUE','MAKEUP'];
 let dragging=false,lastPoint=null,toolPoint=null,buzz=null,contactGrace=0,resultAge=0;
 const scale=()=>Math.min(R.w/390,R.h/598),rest=()=>({x:R.w*.72,y:R.h*.71-(document.documentElement?.dataset.feedPreview==='true'?28*scale():0)});
 function zones(){const p=s.photoPoints,points=m.stage===0?[p.mouth]:m.stage===2?p.eyes:[p.face];return points.map(point=>({...R.point(a.looks[0],point),rx:R.w*[.15,.21,.10,.21][m.stage],ry:R.h*[.065,.18,.065,.18][m.stage]}));}
 function inZone(p){return zones().some(z=>((p.x-z.x)/z.rx)**2+((p.y-z.y)/z.ry)**2<=1);}
 function stopContact(){R.stop(buzz);buzz=null;contactGrace=0;}
 function end(){dragging=false;lastPoint=null;toolPoint=null;stopContact();}
 function reset(){end();m.reset();resultAge=0;R.guide(R.config.texts.find(t=>t.id==='GUIDE')?.value||verbs[0]);R.result('');R.setAction('Drag over the mouth to brush. Arrow keys make short strokes.');document.getElementById('play').disabled=false;}
 function move(p){if(!dragging||!lastPoint||!['waiting','playing'].includes(m.state)||m.busy>0)return;const d=Makeover.contactDistance(lastPoint,p,zones())/scale();lastPoint=p;toolPoint=p;if(m.stroke(d)){R.guide('',false);contactGrace=.12;if(!buzz)buzz=R.sound(sounds[m.stage],m.stage===1?.24:.32,true);R.announce(names[m.stage]+', '+Math.min(100,Math.round((m.taps+m.contactDistance/40)/s.settings.taps[m.stage]*100))+' percent');}else stopContact();}
 return{
 inputMode:'drag',reset,state:()=>({state:m.state,stage:m.stage,progress:m.taps+m.contactDistance/40,dragging,busy:m.busy}),isPlaying:()=>['playing','transition'].includes(m.state),pause:end,
 pointerStart(p){if(!['waiting','playing'].includes(m.state)||m.busy>0)return false;const r=rest();if(!inZone(p)&&Math.hypot(p.x-r.x,p.y-r.y)>R.w*.16)return false;dragging=true;lastPoint=p;toolPoint=p;return true;},
 pointerMove:move,pointerEnd:end,
 keyStroke(key){if(!['waiting','playing'].includes(m.state)||m.busy>0)return;const z=zones()[0],step=16*scale(),v={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[key];dragging=true;lastPoint={x:z.x-step*v[0]/2,y:z.y-step*v[1]/2};move({x:z.x+step*v[0]/2,y:z.y+step*v[1]/2});end();},
 update(dt){m.tick(dt);contactGrace=Math.max(0,contactGrace-dt);if(!contactGrace)stopContact();for(const e of m.drain()){
 if(e.type==='stage'){R.releaseInput();R.setAction(verbs[m.stage]+'. Arrow keys make short strokes.');R.guide(verbs[m.stage]);}
 if(e.type==='transition'){R.releaseInput();R.sound('TRANSITION',.25);}
 if(e.type==='result'){R.releaseInput();R.sound('FINAL',.38);R.result('Beautiful');R.announce('Makeover complete');}}
 if(m.state==='result')resultAge+=dt;const progress=Math.min(100,Math.round((m.taps+m.contactDistance/40)/s.settings.taps[m.stage]*100)),stageEl=document.getElementById('stage');stageEl.dataset.stage=String(m.stage);stageEl.dataset.progress=String(progress);stageEl.dataset.dragging=String(dragging);document.getElementById('play').disabled=m.state==='result';R.hud(m.state==='result'?'':names[m.stage],m.state==='result'?'':progress+'%');},
 draw(t){const stage=m.stage;R.photo(a.looks[stage]);if(m.state==='transition'){const p=R.clamp(m.transition/s.settings.flashSec,0,1);R.photo(a.looks[stage+1>=s.settings.sequenceCount?4:stage+1],p);}
 if(m.state==='result'){R.photo(a.looks[4]);R.frame(a.finalVfx,resultAge,2,R.w/2,R.h/2,R.w,R.h,true);return;}
 if(m.state==='waiting'){c.save();c.strokeStyle='#fff';c.globalAlpha=.65;c.lineWidth=1.5*scale();c.setLineDash([4*scale(),5*scale()]);for(const z of zones()){c.beginPath();c.ellipse(z.x,z.y,z.rx*.8,z.ry*.8,0,0,Math.PI*2);c.stroke();}c.restore();}
 const p=toolPoint||rest(),toolW=R.w*[.24,.30,.28,.30][stage],anchor=[{x:.71,y:.19},{x:.70,y:.24},{x:.50,y:.45},{x:.70,y:.18}][stage];R.sprite(a.tools[stage],p.x,p.y,toolW,null,0,1,anchor);
 if(m.actionAge<s.settings.vfxDuration[stage]){const dest=zones()[0];if(stage===2){for(const eye of zones())R.frame(a.vfx[stage],m.actionAge,s.settings.vfxDuration[stage],eye.x,eye.y+R.h*.08,R.w*.16);}else R.frame(a.vfx[stage],m.actionAge,s.settings.vfxDuration[stage],dest.x,dest.y,R.w*[.27,.70,.16,.75][stage]);}
 }
 };
};
