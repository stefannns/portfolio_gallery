import React, {useCallback,useEffect,useRef,useState} from 'react';
import gsap from 'gsap';
import RiftScene from './RiftScene.jsx';
import Character from './Character.jsx';
import {projects} from './projects.js';

function useMedia(query) {
  const [matches,setMatches]=useState(()=>window.matchMedia(query).matches);
  useEffect(()=>{const q=window.matchMedia(query),change=()=>setMatches(q.matches);q.addEventListener('change',change);return()=>q.removeEventListener('change',change);},[query]);
  return matches;
}

function initialProject(){return projects.find(p=>window.location.hash===`#project/${p.id}`)?.id||null;}

export default function App(){
  const [focused,setFocused]=useState(()=>initialProject()||projects[0].id);
  const [openId,setOpenId]=useState(initialProject);
  const [about,setAbout]=useState(false),[indexOpen,setIndexOpen]=useState(false);
  const [gesture,setGesture]=useState(null);
  const [hintVisible,setHintVisible]=useState(true);
  const [sceneFailed,setSceneFailed]=useState(false);
  const reducedMotion=useMedia('(prefers-reduced-motion: reduce)'),mobile=useMedia('(max-width: 700px)');
  const list=projects,selected=projects.find(p=>p.id===focused);
  const currentProject=projects.find(p=>p.id===openId);
  const dragged=useRef(false),pointer=useRef(null),wheel=useRef({amount:0,at:0}),panelRef=useRef(null),previousFocus=useRef(null),captionRef=useRef(null);
  const [reel,setReel]=useState(null);

  const moveCharacter=useCallback(type=>setGesture({type,at:Date.now()}),[]);
  const focus=useCallback(id=>{
    const previous=list.findIndex(p=>p.id===focused),next=list.findIndex(p=>p.id===id);
    setFocused(id);moveCharacter(next>=previous?'right':'left');setHintVisible(false);
  },[list,focused,moveCharacter]);
  const shift=useCallback(direction=>{
    if(openId||about||indexOpen||list.length<2)return;
    const i=list.findIndex(p=>p.id===focused);focus(list[(i+direction+list.length)%list.length].id);
  },[list,focused,focus,openId,about,indexOpen]);
  const open=useCallback(id=>{
    if(dragged.current)return;
    previousFocus.current=document.activeElement;
    setFocused(id);setOpenId(id);setReel(null);setIndexOpen(false);moveCharacter('enter');
    window.history.pushState(null,'',`#project/${id}`);
  },[moveCharacter]);
  const close=useCallback(()=>{
    setOpenId(null);setAbout(false);setIndexOpen(false);
    window.history.replaceState(null,'',window.location.pathname+window.location.search);
    requestAnimationFrame(()=>previousFocus.current?.focus?.());
  },[]);

  useEffect(()=>{
    const onPop=()=>{setOpenId(initialProject());setAbout(false);setIndexOpen(false);};
    window.addEventListener('popstate',onPop);return()=>window.removeEventListener('popstate',onPop);
  },[]);
  useEffect(()=>{
    const key=e=>{
      if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
      if(e.key==='Escape'){close();return;}
      if(openId||about||indexOpen)return;
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();shift(e.key==='ArrowRight'?1:-1);}
      if(e.key==='Enter'&&e.target===document.body){e.preventDefault();open(focused);}
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[shift,open,focused,openId,about,indexOpen,close]);
  useEffect(()=>{
    if(!captionRef.current||reducedMotion)return;
    gsap.fromTo(captionRef.current,{opacity:.15,y:7},{opacity:1,y:0,duration:.5,ease:'power2.out'});
  },[focused,reducedMotion]);
  useEffect(()=>{
    const panel=panelRef.current;if(!panel)return;
    const first=panel.querySelector('button,a');first?.focus();
    if(!reducedMotion)gsap.fromTo(panel,{opacity:0,y:20},{opacity:1,y:0,duration:.5,ease:'power2.out',clearProps:'transform'});
    const trap=e=>{
      if(e.key!=='Tab')return;
      const items=[...panel.querySelectorAll('button,a[href],video[controls],[tabindex="0"]')].filter(n=>!n.disabled&&n.offsetParent!==null);
      const first=items[0],last=items.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    };
    panel.addEventListener('keydown',trap);return()=>panel.removeEventListener('keydown',trap);
  },[openId,about,indexOpen,reducedMotion]);
  useEffect(()=>{
    const canvas=document.querySelector('canvas');if(!canvas)return;
    const lost=e=>{e.preventDefault();setSceneFailed(true);};
    canvas.addEventListener('webglcontextlost',lost);return()=>canvas.removeEventListener('webglcontextlost',lost);
  },[]);

  function pointerDown(e){
    if(openId||about||indexOpen||e.target.closest('button,a'))return;
    pointer.current={x:e.clientX,y:e.clientY};dragged.current=false;
  }
  function pointerMove(e){if(pointer.current&&Math.abs(e.clientX-pointer.current.x)>8)dragged.current=true;}
  function pointerUp(e){
    if(!pointer.current)return;
    const dx=e.clientX-pointer.current.x,dy=e.clientY-pointer.current.y;pointer.current=null;
    if(Math.abs(dx)>42&&Math.abs(dx)>Math.abs(dy)*1.2)shift(dx<0?1:-1);
    window.setTimeout(()=>{dragged.current=false;},60);
  }
  function onWheel(e){
    if(openId||about||indexOpen)return;
    const now=Date.now(),delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
    if(now-wheel.current.at<650)return;
    wheel.current.amount+=delta;
    if(Math.abs(wheel.current.amount)>55){shift(wheel.current.amount>0?1:-1);wheel.current={amount:0,at:now};}
  }
  const dialogVisible=!!currentProject||about||indexOpen;

  return <main className={`portfolio ${dialogVisible?'detail-open':''} ${reducedMotion?'reduced-motion':''}`} onWheel={onWheel}>
    <div className="world" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={()=>{pointer.current=null;}}>
      <div className="atmosphere"/>
      <div className="horizon"/>
      <div className="floor-light" style={{'--project-glow':selected.color}}/>
      <Character gesture={gesture} reducedMotion={reducedMotion}/>
      {!sceneFailed?<SceneBoundary onFail={()=>setSceneFailed(true)}><RiftScene list={list} focused={focused} onFocus={focus} onOpen={open} dragged={dragged} reducedMotion={reducedMotion} mobile={mobile} paused={dialogVisible}/></SceneBoundary>:
        <div className="fallback-rifts">{list.map(p=><button key={p.id} onClick={()=>p.id===focused?open(p.id):focus(p.id)} className={p.id===focused?'focused':''} aria-label={`Explore ${p.title}`}><img src={p.image} alt=""/></button>)}</div>}
      <div className="world-vignette"/>
    </div>

    <header className="site-header" inert={dialogVisible?true:undefined}>
      <button className="signature quiet-button" onClick={()=>{previousFocus.current=document.activeElement;setAbout(true);}} aria-label="About Stefan">Stefan</button>
      <div className="header-space" aria-hidden="true"/>
      <button className="index-link quiet-button" onClick={()=>{previousFocus.current=document.activeElement;setIndexOpen(true);}}>Index</button>
    </header>

    <footer className="site-footer" inert={dialogVisible?true:undefined}>
      <div className="intro-line" aria-hidden="true"/>
      <div className="project-caption" ref={captionRef}>
        <button className="project-title quiet-button" onClick={()=>open(focused)} aria-label={`Enter ${selected.title}`}>{selected.title}</button>
        <span className="project-type">{selected.type}</span>
      </div>
      <span className={`navigation-hint ${hintVisible?'':'is-settled'}`}>Swipe to explore</span>
    </footer>
    <div className="screen-reader-status" aria-live="polite">{selected.title}. Project {list.findIndex(p=>p.id===focused)+1} of {list.length}. All projects are in this scene. Use Left and Right to explore.</div>

    {dialogVisible&&<div className="detail-backdrop" onClick={e=>{if(e.target===e.currentTarget)close();}}>
      <section className={`detail-panel ${currentProject?'project-detail':''}`} ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="detail-heading">
        <div className="detail-top"><span>Stefan / {currentProject?'Selected work':about?'About':'Project index'}</span><button className="quiet-button back-link" onClick={close}>Back to the rifts <span aria-hidden="true">×</span></button></div>
        {currentProject?<>
          <div className="detail-media">
            {currentProject.video?<video key={reel||currentProject.video} controls playsInline autoPlay muted loop src={reel||currentProject.video} poster={currentProject.image}/>:<ProjectImage project={currentProject}/>}
            {!currentProject.video&&<span className="art-caption">Illustrated project cover</span>}
          </div>
          <div className="detail-copy"><span className="detail-type">{currentProject.type}</span><h1 id="detail-heading">{currentProject.title}</h1><p className="project-description">{currentProject.description}</p>
            <div className="project-links">{currentProject.url&&<a href={currentProject.url} target="_blank" rel="noreferrer">{currentProject.collection==='games'?'Play the game':'Open Smarttester'}</a>}{currentProject.github&&<a href={currentProject.github} target="_blank" rel="noreferrer">Source on GitHub</a>}</div>
            {currentProject.moreVideos&&<div className="reel-options">{currentProject.moreVideos.map(v=><button className="quiet-button" key={v.label} aria-pressed={(reel||currentProject.video)===v.url} onClick={()=>setReel(v.url)}>{v.label}</button>)}</div>}
            <div className="project-notes"><section><h2>Design</h2><p>{currentProject.design}</p></section><section><h2>Process</h2><p>{currentProject.process}</p></section></div>
          </div>
        </>:about?<div className="about-copy"><span className="detail-type">Game design, visual direction & AI</span><h1 id="detail-heading">Hi, I’m Stefan.</h1><p>I’m studying Game Design at USC, with a minor in AI Applications. I build games, interactive experiences, and tools for making them.</p><p>My work explores what becomes possible when game-design thinking, visual judgment, and thoughtful use of AI come together.</p><div className="experience-list"><div><span>2026</span><p>TikTok<br/><small>AI Creative Design Intern</small></p></div><div><span>2025</span><p>Tencent · LightSpeed Studios<br/><small>Combat Designer Intern — Golden Spatula</small></p></div><div><span>2024–25</span><p>X.D. Network<br/><small>AIGC Technical Art & Overseas Publishing</small></p></div></div><a href="https://github.com/stefannns" target="_blank" rel="noreferrer">Find me on GitHub</a></div>:
          <div className="index-copy"><h1 id="detail-heading">All the worlds.</h1><p className="index-intro">Games, experiments, and tools.</p><div className="project-index">{projects.map(p=><button className="quiet-button index-project" key={p.id} onClick={()=>open(p.id)}><span>{p.title}</span><small>{p.type}</small></button>)}</div></div>}
      </section>
    </div>}
  </main>;
}

function ProjectImage({project}){
  return <div className="detail-still" style={{backgroundImage:`url(${project.image})`,backgroundPosition:'center',backgroundSize:'cover'}} role="img" aria-label={`${project.title} illustrated cover`}/>;
}

class SceneBoundary extends React.Component {
  constructor(props){super(props);this.state={failed:false};}
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onFail();}
  render(){return this.state.failed?null:this.props.children;}
}
