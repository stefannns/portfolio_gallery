/*
  [架构蓝图思考]
  1. 状态模型: 
     - `activeIndex` (0-14): 当前选中的年龄节点索引。
     - `progress` (0-1): 拖动进度，用于滑块的平滑跟随。
     - `isDragging`: 是否正在拖动，用于区分拖动中和松手后的吸附动画。
  2. 流程衔接: 
     - 用户在底部时间轴触发 pointerdown/move，更新 progress 和 activeIndex。
     - activeIndex 变化时，触发轻微的 tick 音效，并切换中间显示的图片（通过 opacity 切换实现无缝过渡）。
     - 松手 (pointerup/cancel) 时，progress 吸附到 activeIndex 对应的标准比例。
  3. 关键路径与边界: 
     - 拖动超出边界时，progress 限制在 0-1 之间。
     - 确保所有 15 张图片在配置加载后预渲染并叠加在一起，避免切换时出现网络加载闪烁。
  4. 降级兜底: 
     - config 加载失败时使用默认空配置，图片路径为空时显示占位背景。
     - iOS 音频需在首次 pointerdown 时解锁。
  5. UI Style: 
     - 写实摄影风格，深暖灰背景 (#121110)，突出照片的视觉核心地位。
     - 干净克制的排版，无多余装饰。
*/

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import * as Tone from 'tone';
import {uiCss, useUiStage, useToneGate, useFeedPreview, useFeedVisibility, loadConfig} from './playable-ui.js';
import {themeCss} from './playable-theme.js';

// --- 常量与数据 ---
const AGE_DATA = [
  { age: 1, stage: 'Toddler', imgId: 'AGE_01' },
  { age: 3, stage: 'Toddler', imgId: 'AGE_03' },
  { age: 5, stage: 'Toddler', imgId: 'AGE_05' },
  { age: 7, stage: 'Childhood', imgId: 'AGE_07' },
  { age: 10, stage: 'Childhood', imgId: 'AGE_10' },
  { age: 12, stage: 'Childhood', imgId: 'AGE_12' },
  { age: 16, stage: 'Youth', imgId: 'AGE_16' },
  { age: 22, stage: 'Youth', imgId: 'AGE_22' },
  { age: 28, stage: 'Youth', imgId: 'AGE_28' },
  { age: 38, stage: 'Middle Age', imgId: 'AGE_38' },
  { age: 47, stage: 'Middle Age', imgId: 'AGE_47' },
  { age: 55, stage: 'Middle Age', imgId: 'AGE_55' },
  { age: 65, stage: 'Elderly', imgId: 'AGE_65' },
  { age: 75, stage: 'Elderly', imgId: 'AGE_75' },
  { age: 85, stage: 'Elderly', imgId: 'AGE_85' },
];

const STAGES = ['Toddler', 'Childhood', 'Youth', 'Middle Age', 'Elderly'];

// --- Config 解析 ---
function flattenConfig(raw) {
  const c = {};
  (raw.tweaks || []).forEach(t => { c[t.id] = t.value; });
  (raw.texts || []).forEach(t => { c[t.id] = t.value; });
  (raw.images || []).forEach(im => { c[im.id] = im.path; });
  return c;
}

const App = () => {
  const [cfg, setCfg] = useState(null);
  const [activeIndex, setActiveIndex] = useState(7); // 默认 22 岁
  const [progress, setProgress] = useState(7 / 14);
  const [isDragging, setIsDragging] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  
  const trackRef = useRef(null);
  const activeIndexRef = useRef(7);
  const audioRef = useRef({ ready: false, lastTime: 0, synth: null });
  const rootRef = useRef(null), pointerRef = useRef(null);
  const reduced=useUiStage(rootRef, !!cfg),feedPreview=useFeedPreview(),previewVisible=useFeedVisibility(rootRef,!!cfg);
  useEffect(()=>{
    if(!cfg||!feedPreview||!previewVisible||reduced)return;
    // Decorative demonstration only: snapshots, no sound or gameplay input.
    let elapsed=0,last=performance.now(),frame;
    const draw=now=>{const dt=Math.min(80,now-last);last=now;if(!document.hidden)elapsed+=dt;
      const index=elapsed<900?7:elapsed<1750?9:elapsed<2600?12:7;
      setActiveIndex(index);setProgress(index/14);
      if(elapsed<3350)frame=requestAnimationFrame(draw);
    };
    frame=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(frame);setActiveIndex(activeIndexRef.current);setProgress(activeIndexRef.current/14);};
  },[cfg,feedPreview,previewVisible,reduced]);
  const unlock = useToneGate(Tone, audioRef);
  useEffect(()=>{
    const stop=()=>{pointerRef.current=null;setIsDragging(false);setProgress(activeIndexRef.current/14);};
    const hidden=()=>{if(document.hidden)stop();};
    const host=e=>{if(e.source===parent&&e.origin===location.origin&&e.data?.type==='playable-active'&&e.data.active!==true)stop();};
    window.addEventListener('blur',stop);document.addEventListener('visibilitychange',hidden);
    window.addEventListener('message',host);
    return()=>{window.removeEventListener('message',host);window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',hidden);};
  },[]);

  // --- 初始化 Config ---
  useEffect(() => {
    let alive = true;
    (async () => {
      const raw = await loadConfig();
      if (alive) {
        const parsed = flattenConfig(raw);
        setCfg(parsed);
        const defaultIdx = Math.max(0,Math.min(14,Math.round(parsed.DEFAULT_INDEX ?? 7)));
        activeIndexRef.current = defaultIdx;
        setActiveIndex(defaultIdx);
        setProgress(defaultIdx / 14);
      }
    })();
    return () => { alive = false; };
  }, []);

  // --- 音频系统 ---
  const initAudio = () => unlock(() => {
    const synth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.1 }
    }).toDestination();
    synth.volume.value = -15;
    return {synth,lastTime:0};
  });

  const playTick = useCallback(() => {
    const a = audioRef.current;
    if (!a.ready || !a.synth) return;
    const now = Tone.now();
    const t = now > a.lastTime ? now : a.lastTime + 0.01;
    a.lastTime = t;
    a.synth.triggerAttackRelease('C6', '32n', t);
  }, []);

  // --- 交互逻辑 ---
  const updateProgress = useCallback((clientX) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    // 增加一点 padding 容差
    const padding = 0;
    let p = (clientX - rect.left - padding) / (rect.width - padding * 2);
    p = Math.max(0, Math.min(1, p));
    setProgress(p);
    
    const idx = Math.round(p * 14);
    if (activeIndexRef.current !== idx) playTick();
    activeIndexRef.current = idx;
    setActiveIndex(idx);
  }, [playTick]);

  const handlePointerDown = (e) => {
    if (e.isPrimary === false || e.button !== 0 || pointerRef.current !== null) return;
    pointerRef.current=e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const clientX = e.clientX;
    initAudio();setHasInteracted(true);
    setIsDragging(true);
    updateProgress(clientX);
  };

  const handlePointerMove = (e) => {
    if (pointerRef.current !== e.pointerId) return;
    updateProgress(e.clientX);
  };

  const handlePointerUp = (e) => {
    if (pointerRef.current !== e.pointerId) return;
    updateProgress(e.clientX);
    pointerRef.current=null;
    setIsDragging(false);
    setProgress(activeIndexRef.current / 14); // Snap
  };

  if (!cfg) return null;

  const currentData = AGE_DATA[activeIndex];

  // --- 样式 ---
  const containerStyle = {
    width: '100%',
    height: '100%',
    backgroundColor: '#efeee8',
    backgroundImage: 'radial-gradient(ellipse at 50% 30%, #faf9f5 0%, transparent 75%)',
    color: '#30352f',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'var(--font-body)',
    overflow: 'hidden',
    userSelect: 'none',
    WebkitUserSelect: 'none'
  };

  const headerStyle = {
    flex: '0 0 auto',
    padding: 'var(--ui-top) var(--ui-side) 8px',
    textAlign: 'center'
  };

  const titleStyle = {
    fontSize: '14px',
    letterSpacing: '5px',
    color: 'rgba(255,255,255,0.58)',
    margin: '0 0 9px 0',
    fontWeight: 600
  };

  const subtitleStyle = {
    fontSize: 'calc(28px * var(--ui-scale))',
    fontWeight: 700,
    margin: 0,
    letterSpacing: '-.6px',fontVariantNumeric:'tabular-nums'
  };

  const mainAreaStyle = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '8px var(--ui-side) 8px',
    containerType: 'size'
  };

  const portraitWrapperStyle = {
    width: '100%',
    height: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center'
  };

  const printStyle = {
    '--print-width': 'min(100cqw, calc(100cqh * 30 / 43))',
    width: 'var(--print-width)',
    height: 'calc(var(--print-width) * 43 / 30)',
    padding: 'calc(var(--print-width) * .06) calc(var(--print-width) * .06) calc(var(--print-width) * .20)',
    margin: 0,
    flexShrink: 0,
    position: 'relative',
    borderRadius: '1px',
    background: 'linear-gradient(115deg, #fffefa, #f8f7f2)',
    boxShadow: '0 14px 24px -10px #36332a35, 0 2px 5px #36332a12, inset 0 0 0 1px #ffffffc0'
  };

  const portraitStyle = {
    width: '100%',
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
    boxShadow: '0 0 0 1px #24292420',
    backgroundColor: '#222'
  };

  const footerStyle = {
    flex: '0 0 auto',
    padding: '0 var(--ui-side) var(--ui-bottom)',
  };

  const trackContainerStyle = {
    position: 'relative',
    height: '44px',
    display: 'flex',
    alignItems: 'center',
    touchAction: 'none',
    cursor: 'pointer',
    margin: '0 12px' // 留出滑块一半的宽度
  };

  return (
    <div ref={rootRef} data-feed-preview={feedPreview} className="app-shell ui-game" style={containerStyle} aria-label={cfg.TITLE}>
      <style>{`
        ${uiCss}
        * { box-sizing: border-box; }
        html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
        .app-shell { position: relative; isolation: isolate; }
        .app-shell::before {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          opacity: .14;
          mix-blend-mode: soft-light;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.42'/%3E%3C/svg%3E");
        }
        .app-shell > *:not(.ui-guide) { position: relative; z-index: 1; }
        .time-print-guide{left:6%;right:6%;bottom:calc(var(--print-width) * .055);font-size:max(14px,calc(18px * var(--ui-scale)));color:#666b61;line-height:1.4}
        .app-shell[data-feed-preview="true"] .time-footer{visibility:hidden;pointer-events:none}
      `}</style>
      <style>{themeCss}</style>

      {/* 顶部区域 */}
      <div style={headerStyle}>
        <h2 style={subtitleStyle}>Age {currentData.age}</h2>
      </div>

      {/* 中间肖像区域 */}
      <div style={mainAreaStyle}>
        <div style={portraitWrapperStyle}>
          <figure className="time-print" style={printStyle}>
          <div className="time-print-window" style={portraitStyle}>
            {AGE_DATA.map((d, i) => (
              <img
                key={d.imgId}
                src={cfg[d.imgId]}
                alt={`Age ${d.age}`}
                aria-hidden={i!==activeIndex}
                draggable={false}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity: i === activeIndex ? 1 : 0,
                  transition: 'opacity 0.15s ease-out',
                  pointerEvents: 'none'
                }}
              />
            ))}
          </div>
          </figure>
        </div>
      </div>

      {!hasInteracted && <p className="ui-guide ui-float time-print-guide">Drag to change age</p>}

      {/* 底部时间轴区域 */}
      <div className="time-footer" style={footerStyle}>
        <div 
          ref={trackRef}
          style={trackContainerStyle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={e=>{if(pointerRef.current===e.pointerId){pointerRef.current=null;setIsDragging(false);setProgress(activeIndexRef.current/14);}}}
          onLostPointerCapture={e=>{if(pointerRef.current===e.pointerId){pointerRef.current=null;setIsDragging(false);setProgress(activeIndexRef.current/14);}}}
          role="slider" tabIndex={0} aria-label="Age timeline" aria-valuemin={0} aria-valuemax={14} aria-valuenow={activeIndex} aria-valuetext={`Age ${currentData.age}, ${currentData.stage}`}
          onKeyDown={e=>{const delta={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1}[e.key];if(delta===undefined&&!['Home','End'].includes(e.key))return;e.preventDefault();initAudio();setHasInteracted(true);const index=e.key==='Home'?0:e.key==='End'?14:Math.max(0,Math.min(14,activeIndexRef.current+delta));if(index!==activeIndexRef.current)playTick();activeIndexRef.current=index;setActiveIndex(index);setProgress(index/14);}}
        >
          {/* 背景线 */}
          <div style={{ position: 'absolute', left: 0, right: 0, height: '2px', background: '#cccfc5', borderRadius: '1px' }} />
          
          {/* 激活线 */}
          <div style={{ position: 'absolute', left: 0, width: `${progress * 100}%`, height: '2px', background: '#8c75bd', borderRadius: '1px' }} />

          {/* 刻度点 */}
          {AGE_DATA.map((item, i) => {
            const isMajor = i % 3 === 1;
            const isActive = i === activeIndex;
            return (
              <div key={i} style={{
                position: 'absolute',
                left: `${(i / 14) * 100}%`,
                width: isMajor ? '8px' : '4px',
                height: isMajor ? '8px' : '4px',
                background: i <= activeIndex ? '#8c75bd' : '#b7bbb1',
                transform: 'translate(-50%, -50%)',
                top: '50%',
                borderRadius: '50%',
                boxShadow: isMajor ? '0 0 0 3px #efeee8, 0 0 0 4px #b7bbb1' : 'none',
                transition: 'background 0.2s, transform .2s'
              }}>
                {i===0||i===14 ? <span aria-hidden="true" style={{
                  position: 'absolute', left: '50%', top: '24px', transform: 'translateX(-50%)',
                  fontSize: '14px', fontWeight: 500,
                  color: '#646b60',
                  background: 'transparent', padding: 0,
                  whiteSpace: 'nowrap', pointerEvents: 'none'
                }}>{item.age}</span> : null}
              </div>
            );
          })}

          {/* 滑块 */}
          <div style={{
            position: 'absolute',
            left: `${progress * 100}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            background: '#8c75bd',
            boxShadow: '0 2px 7px #40324d2c',
            transition: isDragging ? 'none' : 'left 0.2s cubic-bezier(0.2, 0, 0, 1)',
            pointerEvents: 'none'
          }}>
            {/* 滑块内的小圆点装饰 */}
            <div style={{
              position: 'absolute',
              inset: '7px',
              borderRadius: '50%',
              background: '#fffefa'
            }} />
          </div>
        </div>

        {/* 阶段标签 */}
        <div aria-hidden="true" style={{height:20}} />
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')).render(<App />);
