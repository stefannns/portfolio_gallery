import React, {useEffect,useRef,useState} from 'react';

export default function Character({gesture,reducedMotion,manifestPath='/character/manifest.json'}) {
  const [manifest,setManifest]=useState({poster:'/character/options/A-mochi.webp'});
  const [active,setActive]=useState('idle');
  const [available,setAvailable]=useState({});
  const [animationFailed,setAnimationFailed]=useState(false);
  const refs=useRef({});
  useEffect(()=>{let ignore=false;fetch(manifestPath).then(r=>r.json()).then(m=>{if(!ignore)setManifest(m);}).catch(()=>{});return()=>{ignore=true;};},[manifestPath]);
  useEffect(()=>{
    const key=gesture?.type;
    if(key&&manifest[key]&&!reducedMotion){setActive(key);const v=refs.current[key];if(v){v.currentTime=0;v.play().catch(()=>{});}}
  },[gesture,manifest,reducedMotion]);
  useEffect(()=>{Object.entries(refs.current).forEach(([key,v])=>{
    if(key===active&&!reducedMotion)v.play().catch(()=>{});else v.pause();
  });},[active,reducedMotion]);
  const hasVideo=!!manifest[active]&&available[active]&&!reducedMotion;
  // Animated WebP keeps the same transparent silhouette in Safari and Chromium.
  // Keep the video slots for future gesture clips and alpha-video exports.
  const animatedIdle=manifest.idle?.animated;
  const poster=manifest.poster||'/character/options/A-mochi.webp';
  const characterImage=animatedIdle&&!animationFailed&&!reducedMotion?animatedIdle:poster;
  return <div className={`character-layer gesture-${gesture?.type||'idle'} ${hasVideo?'has-video':''}`} aria-hidden="true" key={reducedMotion?'still':'motion'}>
    <div className="character-glow"/>
    <img className="character-poster" src={characterImage} alt="" draggable="false" decoding="async"
      onError={()=>{if(characterImage!==poster)setAnimationFailed(true);}}/>
    <img className="character-reflection" src={poster} alt="" draggable="false"/>
    {['idle','left','right','enter'].filter(key=>manifest[key]&&!manifest[key].animated).map(key=>{
      const source=manifest[key];
      return <video key={key} ref={v=>{if(v)refs.current[key]=v;}} className={`character-video ${active===key&&hasVideo?'is-visible':''}`}
        loop={key==='idle'} autoPlay={key==='idle'&&!reducedMotion} muted playsInline preload="auto"
        onCanPlay={()=>setAvailable(a=>({...a,[key]:true}))}
        onError={()=>setAvailable(a=>({...a,[key]:false}))}
        onEnded={()=>setActive('idle')}>
        {typeof source==='string'?<source src={source}/>:<>{source.hevc&&<source src={source.hevc} type='video/mp4; codecs="hvc1"'/>}{source.webm&&<source src={source.webm} type="video/webm"/>}</>}
      </video>;
    })}
  </div>;
}
