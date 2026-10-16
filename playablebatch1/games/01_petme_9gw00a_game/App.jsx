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
import {uiCss, useUiStage, useToneGate, loadConfig} from './playable-ui.js';

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
      --c-bg: #f5f5f5;
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
    .pet-layer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
      transition: opacity 0.3s ease;
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

// --- 粒子类 ---
class HairParticle {
  constructor(x, y, vx, vy) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = 1.0;
    this.decay = Math.random() * 0.03 + 0.02;
    this.angle = Math.random() * Math.PI * 2;
    this.spin = (Math.random() - 0.5) * 0.2;
    this.length = Math.random() * 12 + 8;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.15; // 重力
    this.angle += this.spin;
    this.life -= this.decay;
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.strokeStyle = '#8B5A2B'; // 棕色毛发
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-this.length / 2, 0);
    ctx.quadraticCurveTo(0, 4, this.length / 2, 0);
    ctx.stroke();
    ctx.restore();
  }
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
  const particlesRef = useRef([]);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const audioRef = useRef({ ready: false, noise: null, winSynth: null, lastNoiseTime: 0 });
  const rafRef = useRef(null);
  const stateTimeoutRef = useRef(null);
  const pointerRef = useRef(null);
  const comfortRef = useRef(0);
  const reduced = useUiStage(containerRef, !!cfg);
  const unlock = useToneGate(Tone, audioRef);
  useEffect(() => {
    const stop = () => {pointerRef.current=null;setIsDragging(false);};
    const hidden = () => {if (document.hidden) stop();};
    window.addEventListener('blur',stop);document.addEventListener('visibilitychange',hidden);
    return () => {window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',hidden);};
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
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    
    // 初始梳子位置
    setCombPos({
      x: containerRef.current.clientWidth * 0.72,
      y: containerRef.current.clientHeight * 0.7
    });

    return () => window.removeEventListener('resize', handleResize);
  }, [cfg]);

  // 3. 粒子动画循环
  useEffect(() => {
    if (!cfg) return;
    const loop = () => {
      if (canvasRef.current && !document.hidden) {
        const ctx = canvasRef.current.getContext('2d');
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        
        for (let i = particlesRef.current.length - 1; i >= 0; i--) {
          const p = particlesRef.current[i];
          p.update();
          p.draw(ctx);
          if (p.life <= 0) {
            particlesRef.current.splice(i, 1);
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [cfg]);

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
    
    // 只有产生有效位移才算梳理
    if (dist > 3) {
      // 1. 生成粒子
      const numParticles = Math.min(Math.floor(dist / 4), 6);
      for (let i = 0; i < numParticles; i++) {
        particlesRef.current.push(new HairParticle(
          x + (Math.random() - 0.5) * 40, 
          y + (Math.random() - 0.5) * 40, 
          (Math.random() - 0.5) * 3, 
          Math.random() * 2 - 1
        ));
      }
      
      // 2. 播放音效
      const now = Tone.now();
      if (audioRef.current.ready && now - audioRef.current.lastNoiseTime > 0.08) {
        audioRef.current.noise.triggerAttackRelease("16n", now);
        audioRef.current.lastNoiseTime = now;
      }
      
      // 3. 区域判定与进度更新
      const relY = y / rect.height;
      const relX = x / rect.width;
      
      // 假设宠物在画面中央，x: 20%-80%
      if (relX > 0.2 && relX < 0.8) {
        if (relY > 0.3 && relY < 0.8) setHasInteracted(true);
        if (relY > 0.3 && relY < 0.55) {
          // 舒服区 (头部/背部)
          setPetState('happy');
          const goal = cfg.COMFORT_MAX ?? 100;
          const next = Math.min(goal, comfortRef.current + (cfg.COMFORT_SPEED_HAPPY ?? 0.5));
          comfortRef.current=next;setComfort(next);
          if (next >= goal) triggerFinish();
        } else if (relY >= 0.55 && relY < 0.8) {
          // 敏感区 (肚子/尾巴)
          setPetState('resist');
          comfortRef.current=Math.max(0,comfortRef.current+(cfg.COMFORT_SPEED_RESIST ?? -0.2));setComfort(comfortRef.current);
        } else {
          setPetState('base');
        }
      } else {
        setPetState('base');
      }
    }
    
    setCombPos({ x, y });
    lastPosRef.current = { x, y };
  };

  const handlePointerUp = (e) => {
    if (e && pointerRef.current !== e.pointerId) return;
    pointerRef.current = null;
    setIsDragging(false);
  };

  if (!cfg) return <div style={{ width: '100%', height: '100%', background: '#f5f5f5' }} />;

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
      
      {/* 宠物图层 (固定场景，仅切换透明度) */}
      <img src={cfg.PET_BASE} className="pet-layer" aria-hidden={petState!=='base'} style={{ opacity: petState === 'base' ? 1 : 0 }} alt="Pet waiting to be groomed" draggable={false} />
      <img src={cfg.PET_HAPPY} className="pet-layer" aria-hidden={petState!=='happy'} style={{ opacity: petState === 'happy' ? 1 : 0 }} alt="Happy pet" draggable={false} />
      <img src={cfg.PET_RESIST} className="pet-layer" aria-hidden={petState!=='resist'} style={{ opacity: petState === 'resist' ? 1 : 0 }} alt="Pet resisting" draggable={false} />
      <img src={cfg.PET_FINISH} className="pet-layer" aria-hidden={petState!=='finish'} style={{ opacity: petState === 'finish' ? 1 : 0 }} alt="Comfortable pet" draggable={false} />

      {/* 粒子画布 */}
      <canvas 
        ref={canvasRef} 
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}
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
            exit={{ opacity: 0, scale: 0.5 }}
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
          width: '60%', height: '16px', 
          background: 'rgba(255,255,255,0.4)', 
          borderRadius: '8px', 
          border: '2px solid rgba(255,255,255,0.8)',
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <div style={{ 
            width: `${100*comfort/(cfg.COMFORT_MAX ?? 100)}%`,
            height: '100%', 
            background: 'linear-gradient(90deg, #FFB6C1, #FF69B4)', 
            transition: 'width 0.2s ease-out' 
          }} />
        </div>
        
        <AnimatePresence mode="wait">
          {petState === 'finish' ? (
            <motion.div
              key="finish"
              initial={{ opacity: 0, y: 10, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              style={{
                marginTop: '16px',
                fontFamily: 'var(--font-display)',
                fontSize: 'calc(24px * var(--ui-scale))',
                textAlign: 'center', overflowWrap: 'anywhere',
                color: '#fff',
                textShadow: '0 2px 8px rgba(0,0,0,0.3), 0 0 4px #FF69B4',
                fontWeight: 'bold'
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
                  marginTop: '12px',
                  fontFamily: 'var(--font-body)',
                fontSize: 'calc(18px * var(--ui-scale))',
                textAlign: 'center', lineHeight: 1.4,
                  color: 'rgba(255,255,255,0.9)',
                  textShadow: '0 1px 4px rgba(0,0,0,0.5)'
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
        pointerRef.current=null;comfortRef.current=0;particlesRef.current=[];setComfort(0);setPetState('base');setHasInteracted(false);
        setCombPos({x:containerRef.current.clientWidth*.72,y:containerRef.current.clientHeight*.7});
      }} style={{position:'absolute',bottom:'var(--ui-bottom)',left:'50%',transform:'translateX(-50%)',padding:'10px 24px',border:0,borderRadius:14,background:'#8B5A2B',color:'#fff',font:'18px var(--font-body)',zIndex:30}}>Again</button>}
    </div>
  );
};

createRoot(document.getElementById('root')).render(<App />);
