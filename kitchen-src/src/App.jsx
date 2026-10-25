import React, {useCallback,useEffect,useRef,useState} from 'react';
import gsap from 'gsap';
import PlateGallery from './PlateGallery.jsx';
const Conveyor3D = React.lazy(()=>import('./Conveyor3D.jsx'));
const SushiBar = React.lazy(()=>import('./SushiBar.jsx'));
const RoomReview = React.lazy(()=>import('./RoomReview.jsx'));
import {projects} from './projects.js';

function useMedia(query) {
  const [matches,setMatches]=useState(()=>window.matchMedia(query).matches);
  useEffect(()=>{const q=window.matchMedia(query),change=()=>setMatches(q.matches);q.addEventListener('change',change);return()=>q.removeEventListener('change',change);},[query]);
  return matches;
}

const galleryProjects = [...projects.slice(3), projects[1], projects[0], projects[2]];

const galleryCaptions = {
  'seed-squad':'Plant a squad. Defend your garden.',
  'h3-otome':'A romance shaped by your choices and AI.',
  smarttester:'Playtest recordings, turned into useful evidence.',
  recurve:'Solve puzzles with arrows that reverse time.',
  assassin:'An assassin distracted by love, on the beat.',
  niflheim:'Race between a city highway and an undead realm.',
  'toad-defense':'Deploy, merge, and evolve a pond full of defenders.',
  'a-bot-can-do-better':'Draw something. Let the AI roast it.',
};

function initialProject(){return projects.find(p=>window.location.hash===`#project/${p.id}`)?.id||null;}

export default function App(){
  const query=new URLSearchParams(window.location.search),scene=query.get('scene');
  if(scene==='roomreview'||(!scene&&!query.has('surface')))return <React.Suspense fallback={<div role="status">Opening the room…</div>}><RoomReview/></React.Suspense>;
  return <PortfolioApp/>;
}

function PortfolioApp(){
  const [focused,setFocused]=useState(()=>initialProject()||projects[0].id);
  const [openId,setOpenId]=useState(initialProject);
  const [about,setAbout]=useState(false),[indexOpen,setIndexOpen]=useState(false);
  const [inspecting,setInspecting]=useState(false);
  const [gesture,setGesture]=useState(null);
  const [hintVisible,setHintVisible]=useState(true);
  const [navigation,setNavigation]=useState(()=>({id:initialProject()||projects[0].id,tick:0}));
  const reducedMotion=useMedia('(prefers-reduced-motion: reduce)')||new URLSearchParams(window.location.search).get('motion')==='off';
  const sceneName=new URLSearchParams(window.location.search).get('scene');
  const isConveyor=sceneName==='conveyor3d'||sceneName==='sushibar';
  const isWalking=sceneName==='sushibar'||(isConveyor&&new URLSearchParams(window.location.search).get('walk')!=='off');
  const tabletop=!isConveyor&&new URLSearchParams(window.location.search).get('surface')!=='none';
  const list=galleryProjects,selected=projects.find(p=>p.id===focused);
  const currentProject=projects.find(p=>p.id===openId);
  const wheel=useRef({amount:0,at:0}),panelRef=useRef(null),previousFocus=useRef(null),captionRef=useRef(null);
  const [reel,setReel]=useState(null);

  const moveCharacter=useCallback(type=>setGesture({type,at:Date.now()}),[]);
  const focus=useCallback(id=>{
    const previous=list.findIndex(p=>p.id===focused),next=list.findIndex(p=>p.id===id);
    setFocused(id);setNavigation(n=>({id,tick:n.tick+1}));moveCharacter(next>=previous?'right':'left');setHintVisible(false);
  },[list,focused,moveCharacter]);
  const shift=useCallback(direction=>{
    if(openId||about||indexOpen||list.length<2)return;
    const i=list.findIndex(p=>p.id===focused);focus(list[(i+direction+list.length)%list.length].id);
  },[list,focused,focus,openId,about,indexOpen]);
  const open=useCallback(id=>{
    previousFocus.current=document.activeElement;
    setFocused(id);setNavigation(n=>({id,tick:n.tick+1}));setOpenId(id);setReel(null);setIndexOpen(false);moveCharacter('enter');
    window.history.pushState(null,'',`#project/${id}`);
  },[moveCharacter]);
  const close=useCallback(()=>{
    setOpenId(null);setAbout(false);setIndexOpen(false);
    window.history.replaceState(null,'',window.location.pathname+window.location.search);
    requestAnimationFrame(()=>{
      const target=previousFocus.current;
      if(target?.isConnected)target.focus?.();
      else (document.querySelector('.walking-hud button')||document.querySelector('.signature'))?.focus();
    });
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
      if(isWalking)return;
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();shift(e.key==='ArrowRight'?1:-1);}
      if(e.key==='Enter'&&e.target===document.body){e.preventDefault();open(focused);}
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[shift,open,focused,openId,about,indexOpen,close,isWalking]);
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


  function onWheel(e){
    if(isWalking)return;
    if(openId||about||indexOpen)return;
    const now=Date.now(),delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
    if(now-wheel.current.at<650)return;
    wheel.current.amount+=delta;
    if(Math.abs(wheel.current.amount)>55){shift(wheel.current.amount>0?1:-1);wheel.current={amount:0,at:now};}
  }
  const dialogVisible=!!currentProject||about||indexOpen;

  return <main className={`portfolio ${isConveyor?'is-conveyor-3d':''} ${isWalking?'is-walkable is-sushi-bar':''} ${tabletop?'with-tabletop':''} ${dialogVisible?'detail-open':''} ${reducedMotion?'reduced-motion':''}`} onWheel={onWheel}>
    <div className="world" inert={dialogVisible?true:undefined}>
      <React.Suspense fallback={null}>{isWalking?<SushiBar list={list} onSelect={setFocused} onOpen={open} onInspectChange={setInspecting} reducedMotion={reducedMotion} paused={dialogVisible}/>:isConveyor?<Conveyor3D list={list} navigation={navigation} onSelect={setFocused} onNavigate={()=>setHintVisible(false)} onOpen={open} reducedMotion={reducedMotion} paused={dialogVisible}/>:<PlateGallery list={list} navigation={navigation} onSelect={setFocused} onNavigate={()=>setHintVisible(false)} onOpen={open} reducedMotion={reducedMotion} paused={dialogVisible} gesture={gesture} tabletop={tabletop}/>}</React.Suspense>
    </div>

    <header className="site-header" inert={dialogVisible||inspecting?true:undefined}>
      <button className="signature quiet-button" onClick={()=>{previousFocus.current=document.activeElement;setAbout(true);}} aria-label="About Stefan">Stefan</button>
      <div className="header-space" aria-hidden="true"/>
      <button className="index-link quiet-button" onClick={()=>{previousFocus.current=document.activeElement;setIndexOpen(true);}}>Index</button>
    </header>

    <footer className="site-footer" inert={dialogVisible||inspecting?true:undefined}>
      <span aria-hidden="true"/>
      <div className="project-caption" ref={captionRef}>
        <button className="project-title quiet-button" onClick={()=>open(focused)} aria-label={`Enter ${selected.title}`}>{selected.title}</button>
        <span className="project-type">{galleryCaptions[selected.id]}</span>
      </div>
      <span className={`navigation-hint ${hintVisible?'':'is-settled'}`}>Drag to explore</span>
    </footer>
    <div className="screen-reader-status" aria-live="polite">{selected.title}. {projects.length} projects are in this gallery. {isWalking?'Use WASD or arrow keys to walk. Press E near an object to inspect it.':'Use Left and Right to explore.'}</div>

    {dialogVisible&&<div className="detail-backdrop" onClick={e=>{if(e.target===e.currentTarget)close();}}>
      <section className={`detail-panel ${currentProject?'project-detail':''}`} ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="detail-heading">
        <div className="detail-top"><span>Stefan / {currentProject?'Selected work':about?'About':'Project index'}</span><button className="quiet-button back-link" onClick={close}>Back to the gallery <span aria-hidden="true">×</span></button></div>
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
          <div className="index-copy"><h1 id="detail-heading">Selected work.</h1><p className="index-intro">Games, experiments, and tools.</p><div className="project-index">{projects.map(p=><button className="quiet-button index-project" key={p.id} onClick={()=>open(p.id)}><span>{p.title}</span><small>{p.type}</small></button>)}</div></div>}
      </section>
    </div>}
  </main>;
}

function ProjectImage({project}){
  return <div className="detail-still" style={{backgroundImage:`url(${project.image})`,backgroundPosition:'center',backgroundSize:'cover'}} role="img" aria-label={`${project.title} illustrated cover`}/>;
}

