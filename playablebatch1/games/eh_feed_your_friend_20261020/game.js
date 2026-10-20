window.createGame=function(R){
 const{ctx:c,spec:s}=R,a=s.assets,m=new Feeding(s.settings);let current=a.normal,previous=current,blend=1,resultAge=0,burst=0;
 const guide=R.config.texts.find(t=>t.id==='GUIDE')?.value||'Tap the plate to feed';
 function reset(){m.reset();current=previous=a.normal;blend=1;resultAge=burst=0;R.guide(guide);R.result('');R.setAction('Feed the food on the plate');}
 function lane(){const scale=R.w/720;return{y:R.h*.70,k:scale,x:R.w/2,plate:270*scale,food:200*s.settings.itemScale*scale};}
 function change(id){if(id!==current){previous=current;current=id;blend=0;}}
 return{reset,state:()=>({state:m.state,remaining:m.remaining,weight:m.weight,hits:m.hits,reaction:m.reaction}),isPlaying:()=>m.state==='playing',
 action(p){if(m.state==='result')return;const l=lane();if(Math.abs(p.x-l.x)<=l.plate/2+10&&Math.abs(p.y-l.y)<=l.plate/2+10&&m.hitPlate()){R.guide('',false);R.announce('Feeding');}},
 update(dt){m.tick(dt);blend=Math.min(1,blend+dt/.18);burst=Math.max(0,burst-dt);if(m.state==='result')resultAge+=dt;for(const e of m.drain()){if(e.type==='eat'){R.tone(e.good?'good':'bad');burst=.5;R.announce(e.good?'Fed. '+m.weight+' pounds':'Bad food!');}if(e.type==='result'){R.announce('Finished. '+m.weight+' pounds');R.result(m.weight+' lb','You fed '+m.hits+' bites');}}
 change(m.state==='result'?a.full:m.reaction==='badFace'?a.badFace:m.reaction==='happy'?a.happy:a.normal);R.hud(m.state==='result'?'':m.weight+' lb',m.state==='result'?'':Math.ceil(m.remaining)+'s');},
 draw(t){R.photo(previous);R.photo(current,R.reduced?1:blend);if(m.state==='result')return;const l=lane(),mouth=R.point(a.normal,s.photoPoints.mouth);R.sprite(a.plate,l.x,l.y,l.plate);if(m.state==='waiting'&&!R.reduced){c.save();c.strokeStyle='#ffd35b';c.lineWidth=2;c.globalAlpha=.45+.3*Math.sin(t*3);c.beginPath();c.arc(l.x,l.y,l.plate*.43+3*Math.sin(t*3),0,Math.PI*2);c.stroke();c.restore();}
 for(const item of m.items){if(item.phase==='gone')continue;const image=(item.good?a.good:a.bad)[item.type];let x=l.x+item.x*l.k,y=l.y,w=l.food,rot=0;if(item.phase==='eating'){const p=R.ease(Math.min(1,item.age/s.settings.eatFlyDuration));x=R.mix(l.x+item.startX*l.k,mouth.x,p);y=R.mix(l.y,mouth.y,p)-Math.sin(p*Math.PI)*45*l.k;w*=1-p*.65;rot=p*.18;}R.sprite(image,x,y,w,null,rot);}
 if(burst>0){const p=1-burst/.5;c.save();c.globalAlpha=1-p;c.fillStyle=m.reaction==='badFace'?'#ffb55b':'#fff';c.font=`700 ${20*l.k*1.8}px Poppins`;c.textAlign='center';c.fillText(m.reaction==='badFace'?'Oops!':'+'+s.settings.lbPerHit+' lb',mouth.x,mouth.y-35-p*35);c.restore();}}
 };
};
