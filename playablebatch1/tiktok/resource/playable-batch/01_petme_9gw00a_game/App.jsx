/*
  [架构蓝图思考]
  1. 状态模型: 
     - `comfort`: 0-100，梳毛进度。
     - `petState`: 'base' | 'happy' | 'resist' | 'finish'，控制宠物表情图层切换。
     - `combPos`: {x, y}，梳子当前位置。
     - `isDragging`: boolean，是否正在拖拽梳子。
  2. 流程衔接: 
     - 初始态：显示引导，梳子在右下角。
     - 交互态：用户拖拽梳子，根据梳子在屏幕上的相对位置判定区域（上半身舒服，下半身敏感）。
     - 反馈：拖拽时生成毛发粒子（Canvas绘制），播放沙沙声，更新 comfort 值和 petState。停止拖拽后短暂延迟恢复 base 态。
     - 终止态：comfort 达到 100，进入 finish 态，播放胜利音效，显示庆祝文案，隐藏梳子。
  3. 关键路径与边界: 
     - 拖拽速度计算：通过记录上一帧位置计算位移，位移大于阈值才算有效梳理，防止停留在某处狂刷进度。
     - 区域判定：基于容器尺寸的百分比划分，适配不同屏幕比例。
     - 音频解锁：在首次 pointerdown 时初始化 Tone.js。
  4. 降级兜底: 
     - 配置加载失败时提供默认空对象，图片加载失败有 alt 占位。
  5. 布局与尺寸: 
     - 绝对定位叠加多张宠物图片，通过 opacity 平滑过渡，确保场景完全固定不闪烁。
     - 梳子作为独立图层跟随手指，使用 translate 调整抓握点。
*/

import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as Tone from 'tone';
import { motion, AnimatePresence } from 'framer-motion';
import {GROOMING_DURATION_MS,movingContactMs} from './grooming-time.mjs';
import {uiCss, useUiStage, useToneGate, loadConfig} from './playable-ui.js';
import {themeCss} from './playable-theme.js';
import {PetBlend, HairField} from './pet-effects.mjs';

// All photo slots stay preloaded; the mix can retarget immediately from its
// current weights, without empty frames, brightness dips or animation-end gates.
function PetScene({cfg,petState,reduced}){
  const blend=useRef(null),frame=useRef(null),last=useRef(null),wake=useRef(()=>{});
  if(!blend.current)blend.current=new PetBlend();
  const[layers,setLayers]=useState(()=>blend.current.view());
  useEffect(()=>{
    const draw=time=>{
      frame.current=null;
      const dt=last.current===null?0:Math.min(.05,(time-last.current)/1000);last.current=time;
      setLayers(blend.current.step(dt,reduced));
      if(blend.current.active&&!document.hidden)frame.current=requestAnimationFrame(draw);else last.current=null;
    };
    const run=()=>{
      if(document.hidden||reduced){setLayers(blend.current.step(0,true));return;}
      if(frame.current===null)frame.current=requestAnimationFrame(draw);
    };
    wake.current=run;
    const visibility=()=>{if(document.hidden){cancelAnimationFrame(frame.current);frame.current=null;last.current=null;}run();};
    document.addEventListener('visibilitychange',visibility);run();
    return()=>{cancelAnimationFrame(frame.current);frame.current=null;last.current=null;wake.current=()=>{};document.removeEventListener('visibilitychange',visibility);};
  },[reduced]);
  useEffect(()=>{blend.current.request(petState,reduced);wake.current();},[petState,reduced]);
  const ids={base:'PET_BASE',happy:'PET_HAPPY',resist:'PET_RESIST',finish:'PET_FINISH'};
  const labels={base:'Pet waiting to be groomed',happy:'Happy pet',resist:'Pet resisting',finish:'Comfortable pet'};
  const visible=layers.reduce((best,layer)=>layer.weight>best.weight?layer:best,layers[0]).state;
  return <div className="pet-scene" data-pet-state={visible}>
    {layers.map(({state,opacity},index)=><img key={state} src={cfg[ids[state]]} className="pet-layer" data-pet-layer={state}
      alt={labels[state]} aria-hidden={state!==visible} draggable={false} style={{opacity,zIndex:index}}
      onLoad={()=>{blend.current.loaded(state,reduced);wake.current();}}
      onError={()=>{blend.current.failed(state);wake.current();}}/>)}
  </div>;
}

// --- 字体与全局基线样式 ---
const GlobalStyle = () => (
  <style>{`
    ${uiCss}
    @font-face {
      font-family: 'DynaPuff';
      src: url('./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    :root {
      --font-display: "DynaPuff", "PingFang SC", system-ui, sans-serif;
      --font-body:    "DynaPuff", "PingFang SC", system-ui, sans-serif;
      --font-mono:    ui-monospace, Menlo, monospace;
      --c-primary: #8B5A2B;
      --c-bg: #514942;
    }
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: var(--c-bg);
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    * {
      box-sizing: border-box;
    }
    .pet-scene{position:absolute;inset:0;overflow:hidden;pointer-events:none;isolation:isolate}
    .pet-layer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
      pointer-events: none;
    }
  `}</style>
);

// --- 配置摊平工具 ---
function flattenConfig(raw) {
  const c = {};
  (raw.tweaks || []).forEach(t => { c[t.id] = t.value; });
  (raw.texts  || []).forEach(t => { c[t.id] = t.value; });
  (raw.images || []).forEach(im => { c[im.id] = im.path; });
  return c;
}

const App = () => {
  const [cfg, setCfg] = useState(null);
  const [comfort, setComfort] = useState(0);
  const [petState, setPetState] = useState('base'); // base, happy, resist, finish
  const [combPos, setCombPos] = useState({ x: -1000, y: -1000 });
  const [isDragging, setIsDragging] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const particlesRef = useRef(null);
  if(!particlesRef.current)particlesRef.current=new HairField();
  const hairLoopRef=useRef({start:()=>{},clear:()=>{}});
  const lastPosRef = useRef({ x: 0, y: 0 });
  const audioRef = useRef({ ready: false, noise: null, winSynth: null, lastNoiseTime: 0 });
  const rafRef = useRef(null);
  const stateTimeoutRef = useRef(null);
  const pointerRef = useRef(null);
  const comfortRef = useRef(0);
  const groomingTimeRef = useRef({total:0,last:0});
  const reduced = useUiStage(containerRef, !!cfg);
  const unlock = useToneGate(Tone, audioRef);
  useEffect(() => {
    const stop = () => {const id=pointerRef.current;pointerRef.current=null;setIsDragging(false);if(id!==null&&containerRef.current?.hasPointerCapture?.(id))containerRef.current.releasePointerCapture(id);};
    const hidden = () => {if (document.hidden) stop();};
    const host=e=>{if(e.source===parent&&e.origin===location.origin&&e.data?.type==='playable-active'&&e.data.active!==true)stop();};
    window.addEventListener('blur',stop);document.addEventListener('visibilitychange',hidden);
    window.addEventListener('message',host);
    return () => {window.removeEventListener('message',host);window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',hidden);};
  }, []);

  // 1. 加载配置
  useEffect(() => {
    let alive = true;
    (async () => {
      const raw = await loadConfig();
      if (alive) setCfg(flattenConfig(raw));
    })();
    return () => { alive = false; };
  }, []);

  // 2. 初始化画布与梳子位置
  useEffect(() => {
    if (!cfg || !containerRef.current) return;
    const handleResize = () => {
      if (canvasRef.current && containerRef.current) {
        const dpr=Math.min(window.devicePixelRatio||1,2);
        canvasRef.current.width = Math.round(containerRef.current.clientWidth*dpr);
        canvasRef.current.height = Math.round(containerRef.current.clientHeight*dpr);
        canvasRef.current.getContext('2d')?.setTransform(dpr,0,0,dpr,0,0);
        particlesRef.current.clear();
      }
    };
    handleResize();
    const observer=new ResizeObserver(handleResize);observer.observe(containerRef.current);
    window.addEventListener('resize', handleResize);
    
    // 初始梳子位置
    setCombPos({
      x: containerRef.current.clientWidth * 0.72,
      y: containerRef.current.clientHeight * 0.7
    });

    return () => {observer.disconnect();window.removeEventListener('resize', handleResize);};
  }, [cfg]);

  // 3. Demand-driven fur loop: no idle RAF, no hidden/reduced-motion particles.
  useEffect(() => {
    if (!cfg) return;
    let last=null;
    const clear=()=>{
      cancelAnimationFrame(rafRef.current);rafRef.current=null;last=null;particlesRef.current.clear();
      const canvas=canvasRef.current;canvas?.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);
    };
    const loop=time=>{
      rafRef.current=null;
      const canvas=canvasRef.current,ctx=canvas?.getContext('2d');
      if(!ctx||document.hidden||reduced){clear();return;}
      const dt=last===null?1/60:Math.min(.05,Math.max(0,(time-last)/1000));last=time;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      if(particlesRef.current.step(dt,ctx))rafRef.current=requestAnimationFrame(loop);else last=null;
    };
    const start=()=>{if(!reduced&&!document.hidden&&particlesRef.current.particles.length&&rafRef.current===null)rafRef.current=requestAnimationFrame(loop);};
    hairLoopRef.current={start,clear};
    const hidden=()=>{if(document.hidden)clear();};document.addEventListener('visibilitychange',hidden);
    if(reduced)clear();
    return()=>{clear();hairLoopRef.current={start:()=>{},clear:()=>{}};document.removeEventListener('visibilitychange',hidden);};
  }, [cfg,reduced]);

  // 4. 状态恢复定时器
  useEffect(() => {
    if (petState === 'finish' || isDragging) return;
    clearTimeout(stateTimeoutRef.current);
    stateTimeoutRef.current = setTimeout(() => {
      setPetState('base');
    }, 400);
    return () => clearTimeout(stateTimeoutRef.current);
  }, [combPos, isDragging, petState]);

  // --- 交互处理 ---
  const ensureAudio = () => unlock(() => {
    const noise = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.05, decay: 0.1, sustain: 0 }
    }).toDestination();
    noise.volume.value = -15;
    
    const winSynth = new Tone.PolySynth(Tone.Synth).toDestination();
    winSynth.volume.value = -6;
    
    return {noise, winSynth, lastNoiseTime: 0};
  });

  const triggerFinish = () => {
    setPetState('finish');
    pointerRef.current = null;
    setIsDragging(false);
    if (audioRef.current.ready) {
      const now = Tone.now();
      audioRef.current.winSynth.triggerAttackRelease(["C4", "E4", "G4"], "8n", now);
      audioRef.current.winSynth.triggerAttackRelease(["E4", "G4", "C5"], "4n", now + 0.2);
    }
  };

  const handlePointerDown = (e) => {
    if (petState === 'finish' || pointerRef.current !== null || e.isPrimary === false || e.button !== 0) return;
    pointerRef.current = e.pointerId;
    groomingTimeRef.current.last=e.timeStamp;
    particlesRef.current.remainder=0;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    ensureAudio();
    setIsDragging(true);
    const rect=e.currentTarget.getBoundingClientRect();
    lastPosRef.current = { x: e.clientX-rect.left, y: e.clientY-rect.top };
    setCombPos(lastPosRef.current);
  };

  const handlePointerMove = (e) => {
    if (pointerRef.current !== e.pointerId || petState === 'finish' || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX-rect.left;
    const y = e.clientY-rect.top;
    
    const dx = x - lastPosRef.current.x;
    const dy = y - lastPosRef.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const elapsedMs=e.timeStamp-groomingTimeRef.current.last;
    groomingTimeRef.current.last=e.timeStamp;
    
    // 只有产生有效位移才算梳理
    if (dist > .5 * Math.min(rect.width/390,rect.height/598)) {
      // 2. 播放音效
      const now = Tone.now();
      if (audioRef.current.ready && now - audioRef.current.lastNoiseTime > 0.08) {
        audioRef.current.noise.triggerAttackRelease("16n", now);
        audioRef.current.lastNoiseTime = now;
      }
      
      // 3. 区域判定与进度更新
      const relY = y / rect.height;
      const relX = x / rect.width;

      // Small, multi-strand tufts lift off the brush head only over the pet.
      if(!reduced&&!document.hidden&&relX>.2&&relX<.8&&relY>.3&&relY<.8){
        const scale=Math.max(.65,Math.min(1.2,rect.width/390,rect.height/598));
        const from={x:Math.max(rect.width*.2,Math.min(rect.width*.8,lastPosRef.current.x)),y:Math.max(rect.height*.3,Math.min(rect.height*.8,lastPosRef.current.y))};
        particlesRef.current.emit(from,{x,y},scale);
        hairLoopRef.current.start();
      }else particlesRef.current.remainder=0;
      
      // All visible fur has the same positive response. Contact outside the pet
      // is ignored, never penalized; holding still cannot advance the meter.
      const onPet=relX>.2&&relX<.8&&relY>.3&&relY<.8;
      const credit=movingContactMs({distance:dist,elapsedMs,scale:Math.min(rect.width/390,rect.height/598),onPet});
      if(credit>0){
        setHasInteracted(true);setPetState('happy');
        groomingTimeRef.current.total=Math.min(GROOMING_DURATION_MS,groomingTimeRef.current.total+credit);
        const goal=cfg.COMFORT_MAX??100,next=goal*groomingTimeRef.current.total/GROOMING_DURATION_MS;
        comfortRef.current=next;setComfort(next);
        if(next>=goal)triggerFinish();
      }else setPetState('base');
    }
    
    setCombPos({ x, y });
    lastPosRef.current = { x, y };
  };

  const handlePointerUp = (e) => {
    if (e && pointerRef.current !== e.pointerId) return;
    pointerRef.current = null;
    setIsDragging(false);
  };

  if (!cfg) return <div style={{ width: '100%', height: '100%', background: '#514942' }} />;

  return (
    <div 
      ref={containerRef}
      className="ui-game"
      style={{ width: '100%', height: '100%', position: 'relative', containerType: 'size' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
    >
      <GlobalStyle />
      <style>{themeCss}</style>
      
      {/* 宠物图层 (固定场景，仅切换透明度) */}
      <PetScene cfg={cfg} petState={petState} reduced={reduced}/>

      {/* 粒子画布 */}
      <canvas 
        ref={canvasRef} 
        aria-hidden="true" style={{ position: 'absolute', inset: 0, width:'100%',height:'100%',pointerEvents: 'none', zIndex: 5 }}
      />

      {/* 梳子 */}
      <AnimatePresence>
        {petState !== 'finish' && (
          <motion.img
            src={cfg.COMB}
            alt="comb"
            draggable={false}
            initial={reduced ? false : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
            transformTemplate={(_,transform)=>`translate(-50%, -70%) ${transform}`}
            style={{
              position: 'absolute',
              left: combPos.x,
              top: combPos.y,
              width: 'clamp(80px, 25cqi, 150px)',
              height: 'calc(120px * var(--ui-scale))',
              objectFit: 'contain',
              transform: 'translate(-50%, -80%)', // 让手指落在把手处
              pointerEvents: 'none',
              zIndex: 10,
              filter: 'drop-shadow(2px 4px 6px rgba(0,0,0,0.3))'
            }}
          />
        )}
      </AnimatePresence>

      {/* HUD: 进度条与提示 */}
      <div style={{ position: 'absolute', top: 'var(--ui-top)', left: 'var(--ui-side)', right: 'var(--ui-side)', zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
        <div role="progressbar" aria-label="Comfort" aria-valuemin={0} aria-valuemax={cfg.COMFORT_MAX ?? 100} aria-valuenow={Math.round(comfort)} style={{
          width: 'min(160px, 60%)', height: '10px',
          background: 'rgba(255,255,255,0.28)',
          borderRadius: '999px',
          border: '1px solid rgba(255,255,255,0.72)',
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <div style={{ 
            width: `${100*comfort/(cfg.COMFORT_MAX ?? 100)}%`,
            height: '100%', 
            background: '#edbb88',
            transition: 'width 0.2s ease-out' 
          }} />
        </div>
        
        <AnimatePresence mode="wait">
          {petState === 'finish' ? (
            <motion.div
              key="finish"
              initial={reduced ? false : { opacity: 0, y: 10, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              style={{
                marginTop: '16px',
                fontFamily: 'var(--font-display)',
                fontSize: 'calc(24px * var(--ui-scale))',
                textAlign: 'center', overflowWrap: 'anywhere',
                color: '#4b3426', background: 'rgba(255,253,248,.94)', padding:'8px 16px',borderRadius:16,
                textShadow: 'none',
                fontWeight: 800
              }}
            >
              {cfg.TXT_FINISH}
            </motion.div>
          ) : (
            !hasInteracted && (
              <motion.div
                key="guide"
                className="ui-float"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                  marginTop: '12px', padding:'6px 14px',borderRadius:999,background:'rgba(255,253,248,.94)',
                  fontFamily: 'var(--font-body)',
                fontSize: 'calc(18px * var(--ui-scale))',
                textAlign: 'center', lineHeight: 1.4,
                  color: '#4b3426', fontWeight:650,
                  textShadow: 'none'
                }}
              >
                {cfg.TXT_GUIDE}
              </motion.div>
            )
          )}
        </AnimatePresence>
      </div>
      {petState === 'finish' && <button autoFocus type="button" onPointerDown={e=>e.stopPropagation()} onClick={()=>{
        unlock.stop();
        pointerRef.current=null;comfortRef.current=0;groomingTimeRef.current={total:0,last:0};hairLoopRef.current.clear();setComfort(0);setPetState('base');setHasInteracted(false);
        setCombPos({x:containerRef.current.clientWidth*.72,y:containerRef.current.clientHeight*.7});
      }} style={{position:'absolute',bottom:'var(--ui-bottom)',left:'50%',transform:'translateX(-50%)',padding:'12px 28px',border:'1px solid #ffffff50',borderRadius:999,background:'#4b3426',color:'#fff',font:'700 18px var(--font-body)',zIndex:30}}>Again</button>}
    </div>
  );
};

createRoot(document.getElementById('root')).render(<App />);
