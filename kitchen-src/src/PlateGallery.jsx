import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import gsap from 'gsap';
import Character from './Character.jsx';

const modulo = (value, length) => ((value % length) + length) % length;
// Place the host beside the diorama's silhouette, behind the artwork itself.
const hostPositions = {
  'seed-squad': [.15,.66], 'h3-otome': [.18,.63], smarttester: [.16,.72],
  recurve: [.19,.73], assassin: [.19,.65], niflheim: [.16,.67],
  'toad-defense': [.16,.63], 'a-bot-can-do-better': [.18,.71],
};

export default function PlateGallery({list, navigation, onSelect, onNavigate, onOpen, reducedMotion, paused, gesture, tabletop}) {
  const root=useRef(null), items=useRef([]), engine=useRef(null);
  const callbacks=useRef({onSelect,onNavigate,onOpen});callbacks.current={onSelect,onNavigate,onOpen};
  const interaction=useRef({pointer:null,dragging:false,suppressClick:false,active:navigation.id});
  const [active,setActive]=useState(navigation.id),[dragging,setDragging]=useState(false);
  const [hostX,hostY]=hostPositions[active]||[.24,.66];

  useLayoutEffect(()=>{
    const el=root.current, portfolio=el.closest('.portfolio');
    const model={offset:0,step:1,size:1,cycle:1,ready:false};
    const wrap=value=>gsap.utils.wrap(-model.cycle/2,model.cycle/2,value);
    const draw=()=>{
      list.forEach((project,index)=>{
        const node=items.current[index];if(!node)return;
        const distance=wrap(index*model.step+model.offset);
        const progress=Math.min(1,Math.abs(distance)/model.step);
        const scale=1-progress*.28;
        node.style.transform=`translate3d(${distance}px,${-progress*model.size*.035}px,0) scale(${scale})`;
        node.style.zIndex=String(Math.round(100-progress*20));
        const visible=Math.abs(distance)<el.clientWidth/2+model.size*scale*.5;
        node.style.visibility=visible?'visible':'hidden';
        node.tabIndex=visible?0:-1;
        node.setAttribute('aria-hidden',String(!visible));
      });
    };
    const goTo=(id,immediate=false)=>{
      const index=list.findIndex(project=>project.id===id);if(index<0)return;
      gsap.killTweensOf(model);
      interaction.current.active=id;setActive(id);callbacks.current.onSelect(id);
      const destination=model.offset+wrap(-index*model.step-model.offset);
      gsap.to(model,{offset:destination,duration:reducedMotion||immediate?0:.7,ease:'power3.out',onUpdate:draw,onComplete:()=>{model.offset=gsap.utils.wrap(-model.cycle,0,model.offset);draw();}});
    };
    const measure=()=>{
      gsap.killTweensOf(model);
      const width=el.clientWidth,height=el.clientHeight,mobile=width<=700;
      const available=Math.max(220,(height-165)/.76);
      model.size=mobile?Math.min(width*1.02,available):Math.min(width*(width<=1000?.9:.76),available);
      model.step=width*.5+model.size*(mobile?.28:.25);
      model.cycle=model.step*list.length;
      const index=list.findIndex(project=>project.id===interaction.current.active);
      model.offset=-Math.max(0,index)*model.step;
      const baseline=Math.min(height-140,height*.5+model.size*.35);
      for(const element of [el,portfolio]){
        element.style.setProperty('--dish-size',`${model.size}px`);
        element.style.setProperty('--plate-base',`${baseline}px`);
        element.style.setProperty('--table-back',`${baseline-model.size*(width<=1000?.46:.17)}px`);
        element.style.setProperty('--chef-size',`${model.size*(width<=1000?.40:.31)}px`);
      }
      model.ready=true;draw();
    };
    measure();
    const observer=new ResizeObserver(measure);observer.observe(el);
    engine.current={model,draw,goTo};
    return()=>{observer.disconnect();gsap.killTweensOf(model);engine.current=null;};
  },[list,reducedMotion,tabletop]);

  useEffect(()=>{engine.current?.goTo(navigation.id);},[navigation]);

  function down(event){
    if(event.button!==0||paused||!engine.current)return;
    gsap.killTweensOf(engine.current.model);
    interaction.current.pointer={id:event.pointerId,x:event.clientX,y:event.clientY,offset:engine.current.model.offset,time:performance.now()};
    interaction.current.suppressClick=false;
  }
  function move(event){
    const pointer=interaction.current.pointer;if(!pointer||pointer.id!==event.pointerId||!engine.current)return;
    const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;
    if(!interaction.current.dragging&&Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)){
      interaction.current.dragging=true;interaction.current.suppressClick=true;
      event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);callbacks.current.onNavigate();
    }
    if(interaction.current.dragging){engine.current.model.offset=pointer.offset+dx;engine.current.draw();}
  }
  function up(event,cancelled=false){
    const pointer=interaction.current.pointer;if(!pointer||!engine.current)return;
    const didDrag=interaction.current.dragging,{model,goTo}=engine.current;
    interaction.current.pointer=null;interaction.current.dragging=false;setDragging(false);
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    if(didDrag){
      const dx=event.clientX-pointer.x,velocity=dx/Math.max(100,performance.now()-pointer.time);
      const start=Math.round(-pointer.offset/model.step);
      let index=Math.round(-(model.offset+(cancelled?0:velocity*100))/model.step);
      if(!cancelled&&index===start&&Math.abs(dx)>model.size*.12)index+=dx<0?1:-1;
      index=start+gsap.utils.clamp(-1,1,index-start);
      goTo(list[modulo(index,list.length)].id);
    }
  }
  function activate(event,project){
    if(interaction.current.suppressClick&&event.detail!==0)return;
    if(interaction.current.active===project.id)callbacks.current.onOpen(project.id);
    else{callbacks.current.onNavigate();engine.current?.goTo(project.id);}
  }

  return <div ref={root} className={`plate-gallery ${dragging?'is-dragging':''}`} style={{'--host-x':hostX,'--host-y':hostY}} onPointerDown={down} onPointerMove={move} onPointerUp={event=>up(event)} onPointerCancel={event=>up(event,true)}>
    <div className="gallery-host" aria-hidden="true"><Character gesture={gesture} reducedMotion={reducedMotion} manifestPath="/sushi/chef.json"/></div>
    {tabletop&&<div className="gallery-table" aria-hidden="true"><img src="/gallery/tabletop.webp" alt=""/></div>}
    <div className="plate-track" role="group" aria-label="Portfolio miniature worlds. Drag or use the arrow keys to browse.">
      {list.map((project,index)=><button type="button" ref={node=>{items.current[index]=node;}} key={project.id} className={`project-dish dish-${project.id} ${active===project.id?'is-active':''}`} data-project={project.id}
        aria-label={`${active===project.id?'Explore':'Focus'} ${project.title}`}
        onFocus={event=>{if(event.target.matches(':focus-visible'))engine.current?.goTo(project.id);}}
        onClick={event=>activate(event,project)}>
        <span className="dish-shadow" aria-hidden="true"/>
        <img className="world-sprite" src={`/sushi/worlds/${project.id}.webp`} alt="" width="1024" height="1024" draggable="false" decoding="async" fetchPriority={project.recent?'high':'auto'}/>
      </button>)}
    </div>
  </div>;
}
