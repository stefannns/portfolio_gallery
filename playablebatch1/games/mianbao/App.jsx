/*
  [架构蓝图思考]
  1. 状态模型: 
     - gameState: 'idle' (初始) -> 'toasting' (烤制中) -> 'popping' (弹出中) -> 'done' (完成)
     - 核心交互对象是手柄，只能在 idle 状态下沿 Y 轴拖动。
  2. 流程衔接:
     - 拖动手柄超过阈值 -> 触发 toasting，手柄固定在底部，面包下降，烤面包机震动，播放音效。
     - 经过 TOAST_DURATION -> 触发 popping，手柄回弹，面包瞬间切换为焦面包并弹出，播放音效。
     - 弹出动画结束 -> 触发 done，显示 "Burnt!" 弹窗。
     - 点击弹窗可重置回 idle 状态。
  3. 关键路径与边界:
     - 拖动未达阈值释放：手柄平滑回弹。
     - 面包裁剪：使用一个 overflow:hidden 的 Mask 容器，底部对齐烤面包机插槽，面包在其中上下移动实现自然进出。
  4. 降级兜底:
     - 音频加载失败不阻塞主流程。
     - 配置文件加载失败使用默认值。
  5. 布局与尺寸:
     - 烤面包机占屏幕宽度 75%，居中偏下。
     - 面包宽度占烤面包机 55%，高度按比例自适应，确保完全可见。
*/

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import * as Tone from 'tone';
import {uiCss, useUiStage, useToneGate, loadConfig} from './playable-ui.js';

const GlobalStyle = () => (
  <style>{`
    ${uiCss}
    html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #ffffff; }
    * { box-sizing: border-box; }
    @font-face {
      font-family: 'Poppins';
      src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Poppins';
      src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    :root {
      --font-display: "Poppins", "PingFang SC", system-ui, sans-serif;
      --font-body:    "Poppins", "PingFang SC", system-ui, sans-serif;
      --font-mono:    ui-monospace, Menlo, monospace;
    }
  `}</style>
);

function flattenConfig(raw) {
  const c = {};
  (raw.tweaks || []).forEach(t => { c[t.id] = t.value; });
  (raw.texts || []).forEach(t => { c[t.id] = t.value; });
  (raw.images || []).forEach(im => { c[im.id] = im.path; });
  return c;
}

const App = () => {
  const [cfg, setCfg] = useState(null);
  const [gameState, setGameState] = useState('idle'); // idle, toasting, popping, done
  
  const audioBank = useRef({ready:false});
  const synth = useRef(null);
  const noise = useRef(null);
  const bell = useRef(null);
  
  const trackRef = useRef(null);
  const handleControls = useAnimation();
  const breadControls = useAnimation();
  const toasterControls = useAnimation();
  const rootRef=useRef(null),timerRef=useRef(null),roundRef=useRef(0),stateRef=useRef('idle');
  const [hasInteracted,setHasInteracted]=useState(false);
  const reduced=useUiStage(rootRef,!!cfg);
  const unlock=useToneGate(Tone,audioBank);

  useEffect(() => {
    let alive = true;
    (async () => {
      const raw = await loadConfig();
      if (alive) setCfg(flattenConfig(raw));
    })();
    return () => { alive = false; };
  }, []);

  const ensureAudio = () => unlock(() => {
      synth.current = new Tone.Synth().toDestination();
      synth.current.volume.value = -10;
      
      noise.current = new Tone.NoiseSynth({
        noise: { type: 'brown' },
        envelope: { attack: 0.5, decay: 0.1, sustain: 1, release: 0.5 }
      }).toDestination();
      noise.current.volume.value = -15;
      
      bell.current = new Tone.MetalSynth({
        frequency: 800,
        envelope: { attack: 0.001, decay: 1, release: 1 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5
      }).toDestination();
      bell.current.volume.value = -5;
      
      return {synth:synth.current,noise:noise.current,bell:bell.current};
  });

  const popToast = useCallback(() => {
    if(stateRef.current!=='toasting')return;
    const round=roundRef.current;stateRef.current='popping';
    setGameState('popping');
    toasterControls.stop();
    toasterControls.set({ x: 0 });
    
    if (audioBank.current.ready && bell.current) {
      bell.current.triggerAttackRelease('8n');
    }
    
    handleControls.start({ y: 0, transition: { type: 'spring', stiffness: 400, damping: 15 } });
    
    breadControls.start({ y: 0, transition: reduced ? {duration:.08} : { type: 'spring', stiffness: 300, damping: 20 } }).then(() => {
      if(round!==roundRef.current)return;
      stateRef.current='done';setGameState('done');
    });
  }, [handleControls, breadControls, toasterControls,reduced]);

  const startToasting = useCallback(() => {
    if(stateRef.current!=='idle')return;
    stateRef.current='toasting';setHasInteracted(true);
    setGameState('toasting');
    
    const trackHeight = trackRef.current?.clientHeight || 100;
    const handleHeight = trackRef.current?.firstChild?.clientHeight || 30;
    const maxY = Math.max(0, trackHeight - handleHeight);
    
    handleControls.start({ y: maxY, transition: { duration: 0.2 } });
    
    if (audioBank.current.ready) {
      synth.current?.triggerAttackRelease('C2', '8n');
      noise.current?.triggerAttackRelease(cfg.TOAST_DURATION / 1000);
    }
    
    breadControls.start({ y: '100%', transition: { duration: 0.5, ease: 'easeInOut' } });
    
    if(!reduced)toasterControls.start({
      x: [-2, 2, -2, 2, 0],
      transition: { repeat: Infinity, duration: 0.1 }
    });
    
    timerRef.current=setTimeout(() => {
      popToast();
    }, cfg.TOAST_DURATION || 2500);
  }, [cfg, handleControls, breadControls, toasterControls, popToast,reduced]);

  const handleDragEnd = useCallback((e, info) => {
    if (gameState !== 'idle') return;
    if(e.type==='pointercancel'||document.hidden){handleControls.set({y:0});return;}
    
    const trackHeight = trackRef.current?.clientHeight || 100;
    const threshold = trackHeight * 0.4;
    
    if (info.offset.y > threshold) {
      startToasting();
    } else {
      handleControls.start({ y: 0, transition: { type: 'spring', stiffness: 300, damping: 20 } });
    }
  }, [gameState, startToasting, handleControls]);

  const resetGame = useCallback(() => {
    unlock.stop();
    clearTimeout(timerRef.current);roundRef.current++;stateRef.current='idle';setHasInteracted(false);
    toasterControls.stop();toasterControls.set({x:0});
    setGameState('idle');
    handleControls.set({ y: 0 });
    breadControls.set({ y: 0 });
  }, [handleControls, breadControls,toasterControls]);
  useEffect(()=>{
    const hidden=()=>{if(document.hidden)resetGame();};
    document.addEventListener('visibilitychange',hidden);
    return()=>{clearTimeout(timerRef.current);roundRef.current++;handleControls.stop();breadControls.stop();toasterControls.stop();document.removeEventListener('visibilitychange',hidden);};
  },[resetGame,handleControls,breadControls,toasterControls]);

  if (!cfg) return <div style={{ width: '100%', height: '100%', background: '#fff' }} />;

  const currentBread = (gameState === 'popping' || gameState === 'done') ? cfg.BURNT_BREAD_IMG : cfg.NORMAL_BREAD_IMG;

  return (
    <div ref={rootRef} className="ui-game" style={{
      width: '100%', height: '100%', 
      display: 'flex', flexDirection: 'column', 
      justifyContent: 'center', alignItems: 'center',
      padding: 'var(--ui-top) var(--ui-side) var(--ui-bottom)',
      containerType: 'size',
      position: 'relative'
    }}>
      <GlobalStyle />
      
      <motion.div 
        animate={toasterControls} 
        style={{ 
          position: 'relative', 
          width: 'min(72cqi, calc(280px * var(--ui-scale)))',
          top: 'calc(36px * var(--ui-scale))',
          aspectRatio: '451 / 358' 
        }}
      >
        {/* 手柄轨道与手柄 (z-index: 1) */}
        <div 
          ref={trackRef} 
          style={{ 
            position: 'absolute', 
            right: '-8%', 
            top: '25%', 
            width: '15%', minWidth:44,
            height: '45%', 
            zIndex: 1 
          }}
        >
          <motion.div
            drag={gameState === 'idle' ? "y" : false}
            dragConstraints={trackRef}
            dragElastic={0}
            dragMomentum={false}
            onPointerDown={ensureAudio}
            onDragStart={()=>setHasInteracted(true)}
            onDragEnd={handleDragEnd}
            role="button" tabIndex={gameState==='idle'?0:-1} aria-label="Pull toaster lever" aria-disabled={gameState!=='idle'}
            onKeyDown={e=>{if(['Enter',' '].includes(e.key)&&gameState==='idle'){e.preventDefault();ensureAudio();startToasting();}}}
            animate={handleControls}
            style={{ width: '100%', minHeight:44, cursor: gameState === 'idle' ? 'grab' : 'default', touchAction: 'none' }}
          >
            <img 
              src={cfg.HANDLE_IMG} 
              draggable={false} 
              alt="handle"
              style={{ width: '100%', display: 'block', pointerEvents: 'none', objectFit: 'contain', aspectRatio: '67 / 56' }} 
            />
          </motion.div>
        </div>

        {/* 面包遮罩层 (z-index: 2) */}
        <div style={{
          position: 'absolute',
          left: '22.5%',
          bottom: '90%', // 底部对齐烤面包机插槽口 (距离底部90%)
          width: '55%',
          height: '150%', // 足够高以容纳面包
          overflow: 'hidden',
          zIndex: 2,
          pointerEvents: 'none'
        }}>
          <motion.div
            animate={breadControls}
            style={{
              position: 'absolute',
              bottom: 0,
              width: '100%',
              aspectRatio: '149 / 189'
            }}
          >
            <img 
              src={currentBread} 
              alt="bread"
              style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }} 
            />
          </motion.div>
        </div>

        {/* 烤面包机机身 (z-index: 3) */}
        <img 
          src={cfg.TOASTER_IMG} 
          alt="toaster"
          style={{ 
            position: 'absolute', 
            inset: 0, 
            width: '100%', 
            height: '100%', 
            display: 'block', 
            objectFit: 'contain',
            zIndex: 3,
            pointerEvents: 'none'
          }} 
        />

        {/* 蒸汽与光效 (z-index: 4) */}
        <AnimatePresence>
          {gameState === 'toasting' && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.8 }}
                exit={{ opacity: 0 }}
                style={{
                  position: 'absolute',
                  top: '5%',
                  left: '20%',
                  width: '60%',
                  height: '15%',
                  background: 'radial-gradient(ellipse at center, rgba(255,150,0,0.6) 0%, transparent 70%)',
                  zIndex: 4,
                  pointerEvents: 'none',
                  filter: 'blur(8px)'
                }}
              />
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={reduced ? {opacity:.2,y:0} : { opacity: [0, 0.6, 0], y: -30 }}
                transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
                style={{
                  position: 'absolute',
                  top: '-10%',
                  left: '30%',
                  width: '40%',
                  height: '30%',
                  background: 'radial-gradient(circle, rgba(200,200,200,0.8) 0%, transparent 70%)',
                  zIndex: 4,
                  pointerEvents: 'none',
                  filter: 'blur(12px)'
                }}
              />
            </>
          )}
        </AnimatePresence>

      </motion.div>
      {!hasInteracted && <p className="ui-guide ui-float" style={{bottom:'max(var(--ui-bottom), 20%)',fontFamily:'var(--font-body)',color:'#42352c'}}>Pull the lever down</p>}
      {gameState==='done'&&<div role="dialog" aria-modal="true" aria-label="Toast result" style={{position:'absolute',inset:0,zIndex:30,display:'flex',alignItems:'center',justifyContent:'center',background:'#ffffff99',padding:'var(--ui-top) var(--ui-side) var(--ui-bottom)'}}>
        <div style={{maxWidth:'100%',padding:24,borderRadius:18,border:'2px solid #42352c',background:'#fff',fontFamily:'var(--font-body)',textAlign:'center'}}>
          <p style={{margin:'0 0 18px',fontSize:'calc(24px * var(--ui-scale))',lineHeight:1.4,overflowWrap:'anywhere',fontWeight:700}}>{cfg.RESULT_TEXT}</p>
          <button autoFocus type="button" onClick={resetGame} style={{border:0,borderRadius:12,padding:'10px 24px',background:'#42352c',color:'#fff',fontSize:18}}>Again</button>
        </div>
      </div>}
    </div>
  );
};

createRoot(document.getElementById('root')).render(<App />);
