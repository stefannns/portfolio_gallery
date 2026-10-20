window.createGame=function(R){
 const {ctx:c,spec:s}=R,a=s.assets,m=new HairCatch(s.settings);let feedback='';
 function reset(){m.reset();feedback='';R.guide(R.config.texts.find(t=>t.id==='GUIDE')?.value||'Tap to catch the hair');R.hud('','',true);R.setAction('Catch the falling hair');R.result('');}
 return{reset,previewUpdate(dt){m.tick(dt);},state:()=>({state:m.state,selected:m.selected,y:m.y,score:m.score,started:m.started}),isPlaying:()=>m.started,
 action(){const hit=m.tap();if(hit.score!==undefined){feedback=hit.score>=98?'Perfect fit!':hit.score>=70?'Almost!':'Try the next look';R.tone(hit.score>70?'good':'bad');R.announce(hit.score.toFixed(2)+' percent. '+feedback);}R.guide('',false);},
 update(dt){m.tick(dt);if(m.state==='stopped'){const p=R.reduced?1:R.ease(Math.min(1,m.scoreAge));R.hud((m.score*p).toFixed(2)+'%','',true);}else R.hud('','',true);},
 draw(t){c.fillStyle='#f8d14f';c.fillRect(0,0,R.w,R.h);R.photo(a.background);const k=Math.max(R.w/720,R.h/1280),g=m.geometry(),p=s.person;c.save();c.translate(R.w/2,R.h/2);c.scale(k,k);R.sprite(a.person,0,207,720,866);c.save();c.translate(g.x,-m.y);c.rotate(-g.angle);if(g.flip)c.scale(-1,1);R.sprite(a.hair[m.selected],0,0,g.width,g.height);c.restore();c.restore();if(m.state==='stopped'){c.save();c.fillStyle='#fff';c.shadowColor='#000';c.shadowBlur=5;c.textAlign='center';c.font=`700 ${18*Math.min(R.w/390,R.h/598)}px Poppins`;c.fillText(feedback,R.w/2,Math.min(R.h-115,R.h*.78));c.restore();}}
 };
};
