window.createGame=function(R){
 const {ctx:c,spec:s}=R,a=s.assets,m=new HairCatch(s.settings);let feedback='',previewAge=0;
 function reset(){m.reset();feedback='';previewAge=0;R.guide(R.config.texts.find(t=>t.id==='GUIDE')?.value||"Tocca per fermare la parrucca");R.hud('','',true);R.setAction("Ferma la parrucca che cade");R.result('');}
 return{reset,previewUpdate(dt){previewAge+=dt;},state:()=>({state:m.state,selected:m.selected,y:m.y,score:m.score,started:m.started}),isPlaying:()=>m.started,
 action(){const hit=m.tap();if(hit.score!==undefined){feedback=hit.score>=98?"Perfetta!":hit.score>=70?"Quasi!":"Prova il prossimo look";R.tone(hit.score>70?'good':'bad');R.announce((hit.score).toLocaleString("it-IT",{minimumFractionDigits:2,maximumFractionDigits:2})+" per cento. "+feedback);}R.guide('',false);},
 update(dt){m.tick(dt);if(m.state==='stopped'){const p=R.reduced?1:R.ease(Math.min(1,m.scoreAge));R.hud((m.score*p).toLocaleString("it-IT",{minimumFractionDigits:2,maximumFractionDigits:2})+'%','',true);}else R.hud('','',true);},
 draw(t){
  c.fillStyle='#f8d14f';c.fillRect(0,0,R.w,R.h);R.photo(a.background);
  const demo=window.PlayableBatch4Preview?.active;
  // Preview-only poses: the live drop, timing and score stay untouched.
  const index=demo?(window.PlayableBatch4Preview.reduced?0:Math.floor(previewAge*1000/window.PlayablePreviewModels.hairCycleMs)%2):m.selected;
  const g=m.geometry(index),pose=demo?window.PlayablePreviewModels.hairPose(previewAge*1000,g,window.PlayableBatch4Preview.reduced):{y:m.y,alpha:1};
  const k=Math.max(R.w/720,R.h/1280);
  c.save();if(demo){c.beginPath();c.rect(0,R.h*.14+28,R.w,R.h);c.clip();}c.translate(R.w/2,R.h/2);c.scale(k,k);R.sprite(a.person,0,207,720,866);
  c.save();c.translate(g.x,-pose.y);c.rotate(-g.angle);if(g.flip)c.scale(-1,1);
  R.sprite(a.hair[index],0,0,g.width,g.height,0,pose.alpha);c.restore();c.restore();
  if(!demo&&m.state==='stopped'){c.save();c.fillStyle='#fff';c.shadowColor='#000';c.shadowBlur=5;c.textAlign='center';c.font=`700 ${18*Math.min(R.w/390,R.h/598)}px Poppins`;c.fillText(feedback,R.w/2,Math.min(R.h-115,R.h*.78));c.restore();}
 }
 };
};
