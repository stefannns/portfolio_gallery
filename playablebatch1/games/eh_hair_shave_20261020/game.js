window.createGame=function(R){
 const{ctx:c,spec:s}=R,a=s.assets,m=new Shaving(s.settings);let buzz=null,resultAge=0;
 const preset=Math.round(R.clamp(s.settings.preset,0,2)),result=a.results[preset];
 const regions=s.photoRegions;
 const icon=document.createElement('img');icon.src=R.images[a.switch].src;icon.alt='';icon.width=22;icon.height=22;document.querySelector('#direction svg').replaceWith(icon);
 function box(){const p=R.cover(a.original),b=regions[preset];return{x:p.x+b.x*p.w,y:p.y+b.y*p.h,w:b.w*p.w,h:b.h*p.h};}
 function portrait(){R.photo(a.original);const p=R.cover(a.original),b=box();c.save();c.beginPath();for(const strip of m.strokes){if(strip.orientation===0)c.rect(b.x+(strip.position-strip.width/2)*b.w,b.y,strip.width*b.w,b.h*strip.progress);else c.rect(b.x,b.y+(strip.position-strip.width/2)*b.h,b.w*strip.progress,strip.width*b.h);}c.clip();c.drawImage(R.images[result],p.x,p.y,p.w,p.h);c.restore();}
 function reset(){R.stop(buzz);m.reset();resultAge=0;R.result('');R.guide(R.config.texts.find(t=>t.id==='GUIDE')?.value||'Tap to shave a strip');R.setDirection(s.settings.orientation===2,()=>{if(m.switch()){R.tone();R.announce(m.orientation?'Horizontal shave':'Vertical shave');icon.style.transform=`rotate(${m.orientation*90}deg)`;}});icon.style.transform=`rotate(${m.orientation*90}deg)`;R.setAction('Shave one strip');document.getElementById('play').disabled=false;}
 return{reset,state:()=>({state:m.state,mode:m.mode,left:m.left,orientation:m.orientation,strokes:m.strokes.map(x=>({...x}))}),isPlaying:()=>m.state==='playing'||m.state==='delay'||m.state==='flash',pause(){R.stop(buzz);buzz=null;},resume(){if(m.mode==='shave'&&m.state==='playing')buzz=R.sound('SHAVE',.22,true);},
 action(){if(m.tap()){R.guide('',false);R.announce(m.left+' shaves left');}},
 update(dt){m.tick(dt);for(const e of m.drain()){if(e.type==='cut'){R.stop(buzz);buzz=R.sound('SHAVE',.22,true);}if(e.type==='stop-cut')R.stop(buzz);if(e.type==='flash')R.sound('FLASH',.32);if(e.type==='result'){R.result('Fresh look');R.setDirection(false);R.announce('Your new look is ready');}}
 if(m.state==='result')resultAge+=dt;const busy=m.mode!=='pan'||!['waiting','playing'].includes(m.state);document.getElementById('play').disabled=busy;R.hud(['result','flash'].includes(m.state)?'':m.left+(m.left===1?' shave':' shaves'),'');document.getElementById('direction').disabled=busy;},
 draw(t){portrait();if(m.state==='result'){const p=R.ease(Math.min(1,resultAge/.3));c.save();c.fillStyle='#16191b';c.globalAlpha=.3*p;c.fillRect(0,0,R.w,R.h);c.restore();const frame=R.images[a.frame],w=R.w*.98,h=w*frame.height/frame.width,x=R.w/2,y=Math.min(R.h*.43,h*.52+10),left=x-w/2,top=y-h/2;const hole={x:left+w*.135,y:top+h*.108,w:w*.73,h:h*.655};c.save();c.beginPath();c.rect(hole.x,hole.y,hole.w,hole.h);c.clip();const scale=Math.max(hole.w/R.w,hole.h/(R.h*.67));c.translate(hole.x+hole.w/2-(R.w*.40)*scale,hole.y+hole.h/2-(R.h*.38)*scale);c.scale(scale,scale);portrait();c.restore();R.sprite(a.frame,x,y,w,h,0,p);return;}
 const b=box(),cut=m.mode==='shave'?m.progress:0,x=m.orientation===0?b.x+m.position*b.w:b.x+b.w*cut,y=m.orientation===0?b.y+b.h*cut:b.y+m.position*b.h;
 if(['waiting','playing'].includes(m.state)){c.save();c.strokeStyle='#fff';c.lineWidth=1.5;c.setLineDash([4,5]);c.globalAlpha=.7;c.beginPath();if(m.orientation===0){c.moveTo(x,b.y);c.lineTo(x,b.y+b.h);}else{c.moveTo(b.x,y);c.lineTo(b.x+b.w,y);}c.stroke();c.restore();const size=R.w*.24;R.sprite(a.buzzer,x,y+size*.28,size,null,m.orientation?Math.PI/2:0);}
 if(m.state==='flash'){// Retain the supplied animation, with limited opacity rather than a full-screen white blast.
 c.save();c.globalAlpha=.32;R.frame(a.flash,m.age,s.settings.flashDuration,R.w/2,R.h/2,R.w,R.h);c.restore();}
 }
 };
};
