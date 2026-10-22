// Weighted photo compositing keeps the lowest contributing layer opaque.
// Unlike fading every photo together, this cannot reveal a pale backing layer.
export const PET_STATES=['base','happy','resist','finish'];
export class PetBlend {
  constructor(){this.weights=[1,0,0,0];this.from=this.weights.slice();this.ready=new Set();this.wanted='base';this.target='base';this.elapsed=0;this.duration=.18;this.active=false;}
  request(state,reduced=false){
    if(!PET_STATES.includes(state))return;
    this.wanted=state;
    if(!this.ready.has(state))return;
    const index=PET_STATES.indexOf(state);
    if(reduced){this.weights=PET_STATES.map((_,i)=>Number(i===index));this.from=this.weights.slice();this.target=state;this.active=false;return;}
    if(state===this.target)return;
    this.from=this.weights.slice();this.target=state;this.elapsed=0;this.active=true;
  }
  loaded(state,reduced=false){this.ready.add(state);this.request(this.wanted,reduced);}
  failed(state){this.ready.delete(state);}
  step(dt,reduced=false){
    if(reduced){this.request(this.wanted,true);return this.view();}
    if(this.active){
      this.elapsed=Math.min(this.duration,this.elapsed+Math.max(0,dt));
      const t=this.elapsed/this.duration,ease=t*t*(3-2*t),index=PET_STATES.indexOf(this.target);
      this.weights=this.from.map((w,i)=>w*(1-ease)+Number(i===index)*ease);
      if(t===1)this.active=false;
    }
    return this.view();
  }
  view(){
    let weights=this.weights.map((w,i)=>this.ready.has(PET_STATES[i])?w:0);
    if(!weights.some(w=>w>0)){const first=PET_STATES.findIndex(key=>this.ready.has(key));weights=weights.map((_,i)=>Number(i===first));}
    let total=0;
    return PET_STATES.map((state,i)=>{total+=weights[i];return{state,opacity:weights[i]>0?weights[i]/total:0,weight:weights[i]};});
  }
}

export class HairParticle {
  constructor(x,y,vx,vy,scale=1,random=Math.random){
    this.x=x;this.y=y;this.vx=vx;this.vy=vy;this.scale=scale;this.age=0;
    this.lifetime=2.15+random()*.7;this.phase=random()*Math.PI*2;
    this.startAngle=random()*Math.PI;this.angle=this.startAngle;this.spin=(random()-.5)*1.15;
    this.length=(10+random()*9)*scale;
    this.strands=Array.from({length:3},(_,i)=>({offset:(i-1)*.6*scale,bend:(1+random()*2.5)*scale,width:(.55+random()*.3)*scale,color:['#634b3c','#917055','#b4916e'][i%3]}));
  }
  update(dt){
    const previous=this.age;this.age+=dt;
    const drag=1.45,decay=Math.exp(-drag*dt);
    this.x+=this.vx*(1-decay)/drag+3*this.scale*(Math.cos(this.phase+previous*3)-Math.cos(this.phase+this.age*3));
    this.vx*=decay;
    const gravity=94*this.scale;
    this.y+=this.vy*dt+.5*gravity*dt*dt;this.vy+=gravity*dt;
    this.angle=this.startAngle+this.spin*this.age+.22*Math.sin(this.phase+this.age*3);
    return this.age<this.lifetime;
  }
  draw(ctx){
    const fadeIn=Math.min(1,this.age/.07),fadeOut=Math.min(1,(this.lifetime-this.age)/.8);
    ctx.save();ctx.translate(this.x,this.y);ctx.rotate(this.angle);ctx.globalAlpha=.85*Math.max(0,fadeIn*fadeOut);ctx.lineCap='round';
    for(const strand of this.strands){
      ctx.strokeStyle=strand.color;ctx.lineWidth=strand.width;ctx.beginPath();
      ctx.moveTo(-this.length*.5,strand.offset);
      ctx.bezierCurveTo(-this.length*.2,strand.offset-strand.bend,this.length*.18,strand.offset+strand.bend,this.length*.5,strand.offset*.3);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export class HairField {
  constructor(){this.particles=[];this.remainder=0;this.limit=90;}
  clear(){this.particles.length=0;this.remainder=0;}
  emit(from,to,scale=1,random=Math.random){
    const dx=to.x-from.x,dy=to.y-from.y,distance=Math.hypot(dx,dy);
    if(distance<3)return;
    const spacing=12*scale,travel=Math.min(distance,90*scale)+this.remainder;
    const count=Math.min(10,Math.floor(travel/spacing));this.remainder=travel%spacing;
    for(let i=0;i<count;i++){
      const t=(i+.5)/count;
      this.particles.push(new HairParticle(from.x+dx*t+(random()-.5)*9*scale,from.y+dy*t-34*scale+(random()-.5)*8*scale,
        dx/distance*36*scale+(random()-.5)*34*scale,dy/distance*16*scale-(28+random()*22)*scale,scale,random));
    }
    if(this.particles.length>this.limit)this.particles.splice(0,this.particles.length-this.limit);
  }
  step(dt,ctx){
    this.particles=this.particles.filter(p=>p.update(dt));
    for(const particle of this.particles)particle.draw(ctx);
    return this.particles.length>0;
  }
}
