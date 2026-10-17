import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {uiCss, useUiStage, loadConfig} from './playable-ui.js';
import {themeCss} from './playable-theme.js';

// Invalidate only bundled replacements; leave editor/custom image URLs exact.
const outfitSrc = url=>/^\.\/assets\/(?:bg_base|bg_a|bg_b|bg_ab|item_a|item_b)\.webp$/.test(url)?url+'?art=street-restored-67-20261016-7':url;

function flattenConfig(raw) {
  const values={};
  for(const item of [...(raw.tweaks||[]),...(raw.texts||[])])values[item.id]=item.value;
  for(const image of raw.images||[])values[image.id]=image.path;
  return values;
}

function App(){
  const [cfg,setCfg]=useState(null),[wearA,setWearA]=useState(false),[wearB,setWearB]=useState(false);
  const [started,setStarted]=useState(false),[plane,setPlane]=useState({width:0,height:0});
  const root=useRef(null),removeA=useRef(null),removeB=useRef(null),itemA=useRef(null),itemB=useRef(null);
  const actionAudioRef=useRef(null);
  const actionAudio=()=>{
    if(!actionAudioRef.current||actionAudioRef.current.disposed)actionAudioRef.current=globalThis.PlayableActionAudio?.create('outfit');
    return actionAudioRef.current;
  };
  useUiStage(root,!!cfg);
  useEffect(()=>{let alive=true;loadConfig().then(raw=>{if(alive)setCfg(flattenConfig(raw));});return()=>{alive=false;};},[]);
  useEffect(()=>{
    const node=root.current;if(!cfg||!node)return;
    const fit=()=>{const scale=Math.max(node.clientWidth/3,node.clientHeight/4);setPlane({width:3*scale,height:4*scale});};
    const observer=new ResizeObserver(fit);observer.observe(node);fit();return()=>observer.disconnect();
  },[cfg]);
  useEffect(()=>()=>actionAudioRef.current?.dispose(),[]);
  function toggle(kind,on,keyboard){
    actionAudio()?.tap(on);
    setStarted(true);kind==='A'?setWearA(on):setWearB(on);
    if(keyboard)requestAnimationFrame(()=>{
      const ref=kind==='A'?(on?removeA:itemA):(on?removeB:itemB);
      ref.current?.focus({preventScroll:true});
    });
  }
  if(!cfg)return <div style={{width:'100%',height:'100%',background:'#111'}}/>;
  const active=wearA?(wearB?'BG_AB':'BG_A'):(wearB?'BG_B':'BG_BASE');
  return <main ref={root} className="ui-game pick-look" aria-label={cfg.GAME_TITLE}>
    <style>{`${uiCss}
      html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#111}
      *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
      .pick-look{width:100%;height:100%;position:relative;overflow:hidden;container-type:size;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;touch-action:none}
      .look-plane{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none}
      .look-plane>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .25s ease;pointer-events:none}
      .look-remove{position:absolute;border:0;background:transparent;padding:0;pointer-events:auto;cursor:pointer}
      .look-remove:focus-visible{background:#ffffff24;border-radius:18px}
      .outfit-item{position:absolute;width:35%;aspect-ratio:1;border:0;padding:0;background:transparent;cursor:pointer;z-index:10}
      .outfit-item img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none;filter:drop-shadow(0 6px 7px #0004)}
      .outfit-item:active img{filter:drop-shadow(0 3px 4px #0006) brightness(.94)}
      .look-guide{top:auto;bottom:var(--ui-bottom);left:50%;right:auto;transform:translateX(-50%);width:max-content;max-width:calc(100% - 2 * var(--ui-side));padding:8px 16px;color:#202322;background:#fffffff0;border:1px solid #ffffff90;border-radius:999px;text-shadow:none;box-shadow:0 3px 14px #10181218}
    `}</style>
    <style>{themeCss}</style>
    <div className="look-plane" style={{...plane,zIndex:1}}>
      {['BG_BASE','BG_A','BG_B','BG_AB'].map(key=><img key={key} src={outfitSrc(cfg[key])} alt={key===active?'Current outfit':''} aria-hidden={key!==active} draggable={false} style={{opacity:key===active?1:0}}/>)}
      {wearA&&<button ref={removeA} className="look-remove" type="button" aria-label="Remove scarf" onClick={e=>toggle('A',false,e.detail===0)} style={{top:'48%',left:'44%',width:'28%',height:'14%',zIndex:12}}/>}
      {wearB&&<button ref={removeB} className="look-remove" type="button" aria-label="Remove top" onClick={e=>toggle('B',false,e.detail===0)} style={{top:'60%',left:'20%',width:'60%',height:'9%',zIndex:11}}/>}
    </div>
    {!wearA&&<button ref={itemA} type="button" className="outfit-item" aria-label="Try on scarf" onClick={e=>toggle('A',true,e.detail===0)} style={{left:'var(--ui-side)',top:'24%'}}>
      <img className="ui-float" style={{animationDuration:`${cfg.FLOAT_SPEED||2.5}s`}} src={outfitSrc(cfg.ITEM_A)} alt="" draggable={false}/>
    </button>}
    {!wearB&&<button ref={itemB} type="button" className="outfit-item" aria-label="Try on top" onClick={e=>toggle('B',true,e.detail===0)} style={{right:'max(var(--ui-side), 16%)',bottom:'22%',width:'38%'}}>
      <img className="ui-float" style={{animationDuration:`${(cfg.FLOAT_SPEED||2.5)*1.1}s`}} src={outfitSrc(cfg.ITEM_B)} alt="" draggable={false}/>
    </button>}
    {!started&&<p className="ui-guide look-guide">Tap a piece to try it on</p>}
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
