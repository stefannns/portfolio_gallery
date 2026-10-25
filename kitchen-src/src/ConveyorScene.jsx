import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import gsap from 'gsap';

const modulo = (value, length) => ((value % length) + length) % length;

export default function ConveyorScene({list, navigation, onSelect, onOpen, reducedMotion, paused}) {
  const root = useRef(null), items = useRef([]), engine = useRef(null);
  const callbacks = useRef({onSelect, onOpen});
  const state = useRef({hovered:false, keyboard:false, pointer:null, dragging:false, suppressClick:false, paused, hidden:document.hidden});
  const [dragging, setDragging] = useState(false);
  callbacks.current = {onSelect, onOpen};
  state.current.paused = paused;

  useLayoutEffect(() => {
    const el = root.current;
    const model = {offset:0, step:1, size:1, cycle:1, nearest:-1, ready:false};
    const wrap = value => gsap.utils.wrap(-model.cycle / 2, model.cycle / 2, value);
    const normalize = () => { model.offset = gsap.utils.wrap(-model.cycle, 0, model.offset); };
    const draw = () => {
      list.forEach((project, index) => {
        const distance = wrap(index * model.step + model.offset);
        const item = items.current[index];
        if(item) {
          item.style.transform = `translate3d(${distance}px,0,0)`;
          item.style.visibility = Math.abs(distance) > el.clientWidth / 2 + model.size ? 'hidden' : 'visible';
        }
      });
      const nearest = modulo(Math.round(-model.offset / model.step), list.length);
      if(!state.current.hovered && !state.current.keyboard && !state.current.dragging && !gsap.isTweening(model) && nearest !== model.nearest) {
        model.nearest = nearest;
        callbacks.current.onSelect(list[nearest].id);
      }
    };
    const goTo = (id, immediate=false) => {
      const index = list.findIndex(project => project.id === id);
      if(index < 0) return;
      gsap.killTweensOf(model);
      const destination = model.offset + wrap(-index * model.step - model.offset);
      callbacks.current.onSelect(id);
      gsap.to(model, {offset:destination, duration:reducedMotion || immediate ? 0 : .65, ease:'power3.out', onUpdate:draw, onComplete:() => {normalize();draw();}});
    };
    const measure = () => {
      const width = el.clientWidth, height = el.clientHeight;
      const previousIndex = model.ready ? -model.offset / model.step : list.findIndex(project => project.id === navigation.id);
      gsap.killTweensOf(model);
      model.size = width <= 700 ? Math.min(width * .84, 370) : Math.min(420, Math.max(280, Math.min(width * .25, height * .49)));
      model.step = model.size * 1.025;
      model.cycle = model.step * list.length;
      model.offset = -previousIndex * model.step;
      model.ready = true;
      el.style.setProperty('--dish-size', `${model.size}px`);
      draw();
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(el);
    const tick = (_time, delta) => {
      if(!state.current.paused && !state.current.hidden && !state.current.hovered && !state.current.keyboard && !state.current.pointer && !reducedMotion && !gsap.isTweening(model)) {
        model.offset -= Math.min(delta, 40) / 1000 * 10;
        normalize();
      }
      draw();
    };
    const visibility = () => {state.current.hidden = document.hidden;};
    document.addEventListener('visibilitychange', visibility);
    gsap.ticker.add(tick);
    engine.current = {model, draw, goTo};
    return () => {observer.disconnect();gsap.ticker.remove(tick);gsap.killTweensOf(model);document.removeEventListener('visibilitychange', visibility);engine.current=null;};
  }, [list, reducedMotion]);

  useEffect(() => {engine.current?.goTo(navigation.id);}, [navigation]);

  function down(event) {
    if(event.button !== 0 || paused || !engine.current) return;
    const {model} = engine.current;
    gsap.killTweensOf(model);
    state.current.pointer = {id:event.pointerId, x:event.clientX, y:event.clientY, offset:model.offset, time:performance.now()};
    state.current.suppressClick = false;
  }
  function move(event) {
    const pointer = state.current.pointer;
    if(!pointer || pointer.id !== event.pointerId || !engine.current) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if(!state.current.dragging && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      state.current.dragging = true; state.current.suppressClick = true;
      event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);
    }
    if(state.current.dragging) {
      engine.current.model.offset = pointer.offset + dx;
      engine.current.draw();
    }
  }
  function up(event, cancelled=false) {
    const pointer = state.current.pointer;
    if(!pointer || !engine.current) return;
    const didDrag = state.current.dragging, {model, goTo} = engine.current;
    state.current.pointer=null;state.current.dragging=false;setDragging(false);
    if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if(didDrag) {
      const dx = event.clientX-pointer.x, velocity=dx/Math.max(100,performance.now()-pointer.time);
      let index = Math.round(-(model.offset + (cancelled ? 0 : velocity*160))/model.step);
      const startIndex=Math.round(-pointer.offset/model.step);
      if(!cancelled && index===startIndex && Math.abs(dx)>model.size*.18) index+=dx<0?1:-1;
      goTo(list[modulo(index,list.length)].id);
      // The browser dispatches click after pointerup. Leave suppression active
      // until the next pointerdown so a drag cannot open a project accidentally.
    }
  }

  return <div ref={root} className={`sushi-conveyor ${dragging?'is-dragging':''} ${paused?'is-paused':''}`} onPointerDown={down} onPointerMove={move} onPointerUp={event=>up(event)} onPointerCancel={event=>up(event,true)}>
    <div className="conveyor-deck" aria-hidden="true"><img src="/sushi/conveyor-deck.webp" alt=""/><div className="conveyor-seams"/></div>
    <div className="dish-viewport" role="group" aria-label="Portfolio miniature worlds. Drag or use the arrow keys to browse.">
      {list.map((project,index)=><button type="button" key={project.id} ref={node=>{items.current[index]=node;}} className={`project-dish dish-${project.id}`} aria-label={`Explore ${project.title}`} data-project={project.id}
        onPointerEnter={event=>{if(event.pointerType==='mouse'&&!state.current.dragging){state.current.hovered=true;callbacks.current.onSelect(project.id);}}}
        onPointerLeave={()=>{state.current.hovered=false;if(engine.current)engine.current.model.nearest=-1;}}
        onFocus={event=>{if(event.target.matches(':focus-visible')){state.current.keyboard=true;engine.current?.goTo(project.id);}}}
        onBlur={()=>{state.current.keyboard=false;if(engine.current)engine.current.model.nearest=-1;}}
        onClick={event=>{if(!state.current.suppressClick||event.detail===0){callbacks.current.onOpen(project.id);}}}>
        <span className="dish-shadow" aria-hidden="true"/>
        <img className="world-sprite" src={`/sushi/worlds/${project.id}.webp`} alt="" width="1024" height="1024" draggable="false" decoding="async" fetchPriority={project.recent?'high':'auto'}/>
      </button>)}
    </div>
    <div className="conveyor-front" aria-hidden="true"><img src="/sushi/conveyor-front.webp" alt=""/></div>
  </div>;
}
