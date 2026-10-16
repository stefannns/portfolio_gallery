/*
  [架构蓝图思考]
  1. 状态模型: 
     - `cfg`: 游戏配置 (图片路径, 笔刷大小, 揭开阈值等)。
     - `assetsReady`: 顶层原图和底层漫画图是否加载完毕。
     - `isRevealed`: 是否已达到擦除阈值，触发完全揭开。
     - `layout`: 根据屏幕尺寸和图片真实比例计算出的渲染尺寸 (w, h) 及是否为横图。
  2. 流程衔接: 
     - 初始化 -> 加载配置 -> 加载图片并读取 natural 尺寸 -> 计算布局 -> 挂载 Canvas 并绘制顶层图 -> 等待用户交互。
     - 交互中 -> 监听 pointer 事件，在 Canvas 上使用 `destination-out` 混合模式连线擦除。
     - 判定 -> 每次 pointerup 时，抽样读取 Canvas 像素，计算透明比例。超过阈值则设置 `isRevealed = true`。
     - 揭开 -> Canvas 播放淡出动画，完全露出底层漫画图，并播放胜利音效。
  3. 关键路径与边界:
     - 图片跨域导致 `getImageData` 失败: 使用 try/catch 兜底，若失败则降级为按滑动距离估算揭开进度。
     - 横竖图兼容 (C.5): 竖图按 cover 铺满屏幕并裁剪；横图按 contain 完整显示，并在底层垫一个模糊放大的原图背景。
     - 高 DPI 屏幕: Canvas 内部像素尺寸需乘以 `devicePixelRatio`，绘制坐标也需相应缩放。
  4. UI Style:
     - 漫画风格: 使用 Bangers 字体，高饱和度提示文字，带黑色描边和投影，增强二次元感。
*/

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tone from 'tone';
import {uiCss, useUiStage, useToneGate, loadConfig} from './playable-ui.js';
import {themeCss} from './playable-theme.js';

// --- 字体与全局样式 ---
const GlobalStyle = () => (
  <style>{`
    ${uiCss}
    @font-face {
      font-family: 'Bangers';
      src: url('./assets/fonts/bangers/Bangers-Regular.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    :root {
      --font-display: "Bangers", "PingFang SC", system-ui, sans-serif;
      --font-body:    -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
      --font-mono:    ui-monospace, Menlo, monospace;
      --color-primary: #ffeb3b;
      --color-stroke: #000000;
    }
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: #111;
      touch-action: none; /* 阻止默认手势 */
    }
    * {
      box-sizing: border-box;
      user-select: none;
      -webkit-user-drag: none;
    }
    .comic-text {
      font-family: var(--font-display);
      color: var(--color-primary);
      text-transform: uppercase;
      -webkit-text-stroke: .3px var(--color-stroke);
      text-shadow: 0 2px 6px var(--color-stroke);
      letter-spacing: 1px;
    }
  `}</style>
);

// --- 配置解析 ---
function flattenConfig(raw) {
  const c = {};
  (raw.tweaks || []).forEach(t => { c[t.id] = t.value; });
  (raw.texts  || []).forEach(t => { c[t.id] = t.value; });
  (raw.images || []).forEach(im => { c[im.id] = im.path; });
  return c;
}

// --- 核心组件 ---
const App = () => {
  const [cfg, setCfg] = useState(null);
  const [assets, setAssets] = useState(null);
  const [layout, setLayout] = useState(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [showHint, setShowHint] = useState(true);
  
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef(null);
  const scratchDistanceRef = useRef(0); // 兜底用
  const audioBank = useRef({ready:false});
  const synthRef = useRef(null);
  const pointerRef = useRef(null);
  const hasDrawnRef = useRef(false);
  const reduced = useUiStage(containerRef, !!cfg);
  const unlock = useToneGate(Tone, audioBank);
  useEffect(() => {
    const stop=()=>{pointerRef.current=null;isDrawingRef.current=false;lastPosRef.current=null;};
    const hidden=()=>{if(document.hidden)stop();};
    window.addEventListener('blur',stop);document.addEventListener('visibilitychange',hidden);
    return()=>{window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',hidden);};
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

  // 2. 加载图片并计算布局
  useEffect(() => {
    if (!cfg) return;
    let alive = true;

    const loadImg = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // 尝试允许跨域以支持 getImageData
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load ${src}`));
      img.src = src;
    });

    (async () => {
      try {
        const [topImg, bottomImg] = await Promise.all([
          loadImg(cfg.ORIGINAL_IMG || ''),
          loadImg(cfg.COMIC_IMG || '')
        ]);
        if (!alive) return;
        setAssets({ top: topImg, bottom: bottomImg });
      } catch (e) {
        console.warn("Images load failed, using fallback", e);
        // 即使失败也给个空对象兜底，避免崩溃
        if (alive) setAssets({ top: new Image(), bottom: new Image() });
      }
    })();

    return () => { alive = false; };
  }, [cfg]);

  // 3. 监听容器尺寸，计算渲染布局 (C.5 横竖图自适应)
  useEffect(() => {
    if (!assets || !assets.top.naturalWidth || !containerRef.current) return;

    const updateLayout = () => {
      const containerW = containerRef.current.clientWidth;
      const containerH = containerRef.current.clientHeight;
      if (containerW === 0 || containerH === 0) return;

      const imgW = assets.top.naturalWidth;
      const imgH = assets.top.naturalHeight;
      const isLandscape = imgW > imgH;
      
      const containerRatio = containerW / containerH;
      const imgRatio = imgW / imgH;
      let w, h;

      if (isLandscape) {
        // 横图: contain
        if (containerRatio > imgRatio) {
          h = containerH; w = h * imgRatio;
        } else {
          w = containerW; h = w / imgRatio;
        }
      } else {
        // 竖图: cover
        if (containerRatio > imgRatio) {
          w = containerW; h = w / imgRatio;
        } else {
          h = containerH; w = h * imgRatio;
        }
      }
      setLayout({ w, h, isLandscape });
    };

    const ro = new ResizeObserver(updateLayout);
    ro.observe(containerRef.current);
    updateLayout(); // 初始调用

    return () => ro.disconnect();
  }, [assets]);

  // 4. 初始化 Canvas 绘制顶层图
  useEffect(() => {
    if (!layout || !assets || !canvasRef.current || isRevealed) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    pointerRef.current=null;isDrawingRef.current=false;lastPosRef.current=null;
    let previous;
    if (hasDrawnRef.current) {previous=document.createElement('canvas');previous.width=canvas.width;previous.height=canvas.height;previous.getContext('2d').drawImage(canvas,0,0);}
    canvas.width = layout.w * dpr;
    canvas.height = layout.h * dpr;
    
    // 绘制原图铺满 canvas
    ctx.drawImage(previous || assets.top, 0, 0, canvas.width, canvas.height);
    
    // 设置混合模式为擦除
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = (cfg.BRUSH_SIZE || 40) * dpr;

  }, [layout, assets, cfg, isRevealed]);

  // --- 音频初始化 ---
  const ensureAudio = () => unlock(() => {
      synthRef.current = new Tone.PolySynth(Tone.Synth).toDestination();
      synthRef.current.volume.value = -8;
      return {synth:synthRef.current};
  });

  const playRevealSound = useCallback(() => {
    if (!audioBank.current.ready || !synthRef.current) return;
    const now = Tone.now();
    synthRef.current.triggerAttackRelease(["C4", "E4", "G4", "C5"], "8n", now);
  }, []);

  const triggerReveal = useCallback(() => {
    setIsRevealed(true);
    playRevealSound();
  }, [playRevealSound]);

  // --- 交互逻辑 ---
  const getPointerPos = useCallback((e) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * canvasRef.current.width / rect.width,
      y: (e.clientY - rect.top) * canvasRef.current.height / rect.height
    };
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (isRevealed) return;
    if (e.isPrimary === false || e.button !== 0 || pointerRef.current !== null) return;
    pointerRef.current=e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    ensureAudio();
    setShowHint(false);
    isDrawingRef.current = true;
    lastPosRef.current = getPointerPos(e);
    hasDrawnRef.current=true;
    const point=lastPosRef.current,ctx=canvasRef.current.getContext('2d');
    ctx.beginPath();ctx.arc(point.x,point.y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();
  }, [isRevealed, getPointerPos]);

  const handlePointerMove = useCallback((e) => {
    if (!isDrawingRef.current || isRevealed || !canvasRef.current) return;
    if (e.isPrimary === false || pointerRef.current !== e.pointerId) return;

    const pos = getPointerPos(e);
    if (!pos || !lastPosRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    // 累加滑动距离 (用于兜底)
    const dx = pos.x - lastPosRef.current.x;
    const dy = pos.y - lastPosRef.current.y;
    scratchDistanceRef.current += Math.sqrt(dx * dx + dy * dy);

    lastPosRef.current = pos;
  }, [isRevealed, getPointerPos]);

  const checkReveal = useCallback(() => {
    if (!canvasRef.current || isRevealed) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      let transparentCount = 0;
      const step = 4 * 10; // 每 10 个像素抽样一次，提升性能
      
      for (let i = 3; i < data.length; i += step) {
        if (data[i] < 128) transparentCount++;
      }
      
      const totalSampled = data.length / step;
      const ratio = transparentCount / totalSampled;
      const threshold = (cfg.REVEAL_THRESHOLD || 60) / 100;

      if (ratio > threshold) {
        triggerReveal();
      }
    } catch (e) {
      // 跨域导致 getImageData 失败的兜底：按滑动距离估算
      const dpr = window.devicePixelRatio || 1;
      const estimatedRequiredDist = canvas.width * canvas.height * 0.05 * dpr; // 魔数估算
      if (scratchDistanceRef.current > estimatedRequiredDist) {
        triggerReveal();
      }
    }
  }, [cfg, isRevealed, triggerReveal]);

  const handlePointerUp = useCallback((e) => {
    if (pointerRef.current !== e.pointerId) return;
    handlePointerMove(e);
    pointerRef.current=null;
    isDrawingRef.current = false;
    lastPosRef.current = null;
    checkReveal();
  }, [checkReveal,handlePointerMove]);
  const cancelPointer = e => {
    if (pointerRef.current !== e.pointerId) return;
    pointerRef.current=null;isDrawingRef.current=false;lastPosRef.current=null;
  };

  // --- 渲染 ---
  if (!cfg) {
    return <div style={{ width: '100%', height: '100%', backgroundColor: '#111' }} />;
  }

  return (
    <div 
      ref={containerRef}
      className="ui-game"
      style={{ 
        width: '100%', 
        height: '100%', 
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        containerType: 'size'
      }}
    >
      <GlobalStyle />
      <style>{themeCss+`.scratch-guide{display:inline-block;max-width:100%;padding:7px 14px;border-radius:999px;background:rgba(20,29,24,.83);color:#fff;font-family:var(--font-body);font-weight:600;line-height:1.35;letter-spacing:0;text-transform:none;text-shadow:none;-webkit-text-stroke:0}`}</style>

      {/* 模糊背景层 (仅横图显示，C.5 规范) */}
      {layout?.isLandscape && (
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${cfg.ORIGINAL_IMG})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(20px) brightness(0.6)',
          transform: 'scale(1.1)', // 防止边缘漏边
          zIndex: 0
        }} />
      )}

      {/* 核心渲染区 */}
      {layout && assets && (
        <div style={{
          position: 'absolute',
          width: `${layout.w}px`,
          height: `${layout.h}px`,
          zIndex: 1,
          overflow: 'hidden',
          boxShadow: layout.isLandscape ? '0 20px 50px rgba(0,0,0,0.5)' : 'none'
        }}>
          {/* 底层：漫画图 */}
          <img 
            src={cfg.COMIC_IMG} 
            alt="Comic Reveal"
            draggable={false}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              pointerEvents: 'none'
            }}
          />

          {/* 顶层：刮刮乐 Canvas */}
          <AnimatePresence>
            {!isRevealed && (
              <motion.canvas
                ref={canvasRef}
                initial={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? .01 : 0.8, ease: "easeInOut" }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={cancelPointer}
                onLostPointerCapture={cancelPointer}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  cursor: 'pointer',
                  touchAction: 'none'
                }}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {/* UI 提示层 */}
      <AnimatePresence>
        {showHint && layout && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            style={{
              position: 'absolute',
              top: 'max(12%, var(--ui-top))',
              left: 'var(--ui-side)', right: 'var(--ui-side)',
              zIndex: 10,
              pointerEvents: 'none',
              textAlign: 'center',
              lineHeight: 1.4
            }}
          >
            <div
              className="scratch-guide ui-float"
              style={{ fontSize: 'calc(18px * var(--ui-scale))', overflowWrap:'anywhere' }}
            >
              {cfg.HINT_TEXT === 'SCRATCH TO REVEAL!' ? 'Scratch to reveal' : cfg.HINT_TEXT}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {isRevealed && <button autoFocus type="button" onClick={()=>{unlock.stop();hasDrawnRef.current=false;scratchDistanceRef.current=0;setShowHint(true);setIsRevealed(false);}}
        style={{position:'absolute',bottom:'var(--ui-bottom)',left:'50%',transform:'translateX(-50%)',padding:'12px 28px',font:'700 18px var(--font-body)',color:'#202722',background:'#fffef9',border:'1px solid #d8dfd9',borderRadius:999,boxShadow:'0 4px 14px #0002',zIndex:20}}>Again</button>}
    </div>
  );
};

createRoot(document.getElementById('root')).render(<App />);
