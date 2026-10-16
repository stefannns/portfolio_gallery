/*
  [架构蓝图思考]
  1. 状态模型: 
     - `cfg`: 游戏配置，就绪后渲染。
     - `landscape`: 主图是否为横图（用于背景模糊兜底）。
     - `wrapperRect`: 主图实际渲染的像素尺寸（用于 C.6 多图层套准，确保物品相对位置不漂移）。
     - `collected`: 已收集的物品 ID 数组。
     - `flyingItems`: 正在飞行的物品状态数组（含起点、终点、ID）。
     - `showSuccess`: 是否展示成功弹窗。
  2. 流程衔接:
     - 初始态：3 个物品散布在主图 wrapper 内。
     - 交互：点击物品 -> 触发首次音频解锁 -> 物品从原位消失，加入 `flyingItems` -> 播放飞行 CSS/Framer 动画。
     - 收集：飞行结束 -> 移出 `flyingItems`，加入 `collected` -> 对应底部槽位点亮，播放收集音效。
     - 终止态：`collected.length === 3` -> 延迟 500ms 弹出成功提示，播放胜利音效。
  3. 关键路径与边界:
     - C.5 & C.6 结合：用户图比例未知。主视觉区用 flex:1，内部根据图片真实比例计算 wrapper 宽高（contain 逻辑），物品在 wrapper 内按 % 定位。
     - 跨坐标系飞行：起点用 e.clientX/Y，终点用槽位的 getBoundingClientRect()，飞行元素用 position:fixed 挂在顶层，避免被 overflow 裁切或受相对定位影响。
  4. 降级兜底: 图片加载失败不崩，音频加载失败 try/catch。
*/

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tone from 'tone';
import {uiCss, useUiStage, useToneGate, loadConfig} from './playable-ui.js';

// --- 常量与初始数据 ---
const ITEM_DEFS = [
  { id: 'item1', cfgKey: 'ITEM_1', initPos: { left: '15%', top: '25%' } },
  { id: 'item2', cfgKey: 'ITEM_2', initPos: { left: '75%', top: '35%' } },
  { id: 'item3', cfgKey: 'ITEM_3', initPos: { left: '20%', top: '70%' } },
];

// --- 辅助函数 ---
function flattenConfig(raw) {
  const c = {};
  (raw.tweaks || []).forEach(t => { c[t.id] = t.value; });
  (raw.texts || []).forEach(t => { c[t.id] = t.value; });
  (raw.images || []).forEach(im => { c[im.id] = im.path; });
  return c;
}

// --- 样式定义 (提前定义以修复 ESLint no-use-before-define) ---
const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    position: 'relative',
    containerType: 'inline-size'
  },
  mainArea: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#000'
  },
  blurBg: {
    position: 'absolute',
    inset: -20,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'blur(15px) brightness(0.6)',
    zIndex: 0
  },
  wrapper: {
    position: 'relative',
    zIndex: 1,
    transition: 'opacity 0.2s'
  },
  itemWrapper: {
    position: 'absolute',
    width: '15%',
    aspectRatio: '1/1',
    minWidth:44,minHeight:44,border:0,padding:0,background:'transparent',
    transform: 'translate(-50%, -50%)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  itemImg: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    position: 'relative',
    zIndex: 2
  },
  itemGlow: {
    position: 'absolute',
    width: '120%',
    height: '120%',
    background: 'radial-gradient(circle, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0) 70%)',
    zIndex: 1,
    animation: 'pulse 2s infinite'
  },
  hudArea: {
    flex: '0 0 auto',
    padding: '12px var(--ui-side) var(--ui-bottom)',
    backgroundColor: 'var(--color-hud)',
    borderTop: '4px solid #795548',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    zIndex: 10
  },
  hudTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(20px, 6cqi, 28px)',
    color: 'var(--color-text)',
    textShadow: '1px 1px 0px #fff'
  },
  slotsContainer: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'center'
  },
  slot: {
    width: 'clamp(48px, 12cqi, 64px)',
    height: 'clamp(48px, 12cqi, 64px)',
    border: '3px solid',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
  },
  slotImg: {
    width: '80%',
    height: '80%',
    objectFit: 'contain'
  },
  flyingImg: {
    position: 'fixed',
    left:0,top:0,
    width: '60px',
    height: '60px',
    objectFit: 'contain',
    zIndex: 50,
    pointerEvents: 'none'
  },
  modalOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    backdropFilter: 'blur(4px)'
  },
  modalContent: {
    backgroundColor: '#fff',
    padding: '24px',
    maxWidth:'calc(100% - 2 * var(--ui-side))',textAlign:'center',overflowWrap:'anywhere',
    borderRadius: '16px',
    border: '4px solid var(--color-accent)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
    boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
  },
  modalText: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 'calc(24px * var(--ui-scale))',
    color: 'var(--color-accent)',
    textShadow: '2px 2px 0px rgba(0,0,0,0.1)'
  },
  btn: {
    fontFamily: 'var(--font-display)',
    fontSize: '18px',
    padding: '12px 32px',
    backgroundColor: 'var(--color-accent)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    boxShadow: '0 4px 0 #388E3C'
  }
};

// --- 主组件 ---
const App = () => {
  const [cfg, setCfg] = useState(null);
  
  // 状态
  const [landscape, setLandscape] = useState(false);
  const [wrapperRect, setWrapperRect] = useState({ width: 0, height: 0 });
  const [collected, setCollected] = useState([]);
  const [flyingItems, setFlyingItems] = useState([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [hasInteracted,setHasInteracted]=useState(false);

  // Refs
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const slotRefs = useRef({});
  const audioBank = useRef({ready:false});
  const synthRef = useRef(null);
  const polySynthRef = useRef(null);
  const rootRef=useRef(null),pendingRef=useRef(new Set()),roundRef=useRef(0),successTimer=useRef(null);
  const reduced=useUiStage(rootRef,!!cfg);
  const unlock=useToneGate(Tone,audioBank);
  useEffect(()=>()=>{roundRef.current++;clearTimeout(successTimer.current);},[]);

  // 1. 加载配置
  useEffect(() => {
    let alive = true;
    (async () => {
      const raw = await loadConfig();
      if (alive) setCfg(flattenConfig(raw));
    })();
    return () => { alive = false; };
  }, []);

  // 2. 音频初始化与播放
  const ensureAudio = () => unlock(() => {
      synthRef.current = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.1, release: 1 }
      }).toDestination();
      synthRef.current.volume.value = -8;

      polySynthRef.current = new Tone.PolySynth(Tone.Synth).toDestination();
      polySynthRef.current.volume.value = -6;

      return {synth:synthRef.current,polySynth:polySynthRef.current};
  });

  const playSound = useCallback((type) => {
    if (!audioBank.current.ready) return;
    const now = Tone.now();
    try {
      if (type === 'click') {
        synthRef.current?.triggerAttackRelease('C5', '16n', now);
      } else if (type === 'collect') {
        synthRef.current?.triggerAttackRelease('E5', '8n', now);
      } else if (type === 'success') {
        polySynthRef.current?.triggerAttackRelease(['C5', 'E5', 'G5', 'C6'], '4n', now);
      }
    } catch (e) {}
  }, []);

  // 3. C.6 多图层套准计算
  const calcWrapper = useCallback(() => {
    if (!imgRef.current || !containerRef.current) return;
    const img = imgRef.current;
    const cont = containerRef.current;
    if (!img.complete || img.naturalWidth === 0) return;

    const isLand = img.naturalWidth > img.naturalHeight;
    setLandscape(isLand);

    const imgRatio = img.naturalWidth / img.naturalHeight;
    const contRatio = cont.clientWidth / cont.clientHeight;

    let w, h;
    if (imgRatio > contRatio) {
      w = cont.clientWidth;
      h = w / imgRatio;
    } else {
      h = cont.clientHeight;
      w = h * imgRatio;
    }
    setWrapperRect({ width: w, height: h });
  }, []);

  useEffect(() => {
    if(!containerRef.current)return;
    const observer=new ResizeObserver(calcWrapper);observer.observe(containerRef.current);calcWrapper();
    return () => observer.disconnect();
  }, [calcWrapper,cfg]);

  // 4. 交互逻辑
  const handleItemClick = (e, itemDef) => {
    e.preventDefault();
    e.stopPropagation();
    if(showSuccess||pendingRef.current.has(itemDef.id)||collected.includes(itemDef.id))return;
    pendingRef.current.add(itemDef.id);setHasInteracted(true);
    
    // 同步读取坐标，避免 await 后 e.currentTarget 丢失
    const rect = e.currentTarget.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;

    ensureAudio();
    playSound('click');

    // 获取目标槽位中心点
    const slotNode = slotRefs.current[itemDef.id];
    let endX = window.innerWidth / 2;
    let endY = window.innerHeight;
    if (slotNode) {
      const sRect = slotNode.getBoundingClientRect();
      endX = sRect.left + sRect.width / 2;
      endY = sRect.top + sRect.height / 2;
    }

    setFlyingItems(prev => [...prev, {
      id: itemDef.id,
      cfgKey: itemDef.cfgKey,
      round:roundRef.current,
      startX, startY, endX, endY,
      key: `${itemDef.id}_${Date.now()}`
    }]);
  };

  const handleFlyComplete = (flyItem) => {
    if(flyItem.round!==roundRef.current)return;
    setFlyingItems(prev => prev.filter(i => i.key !== flyItem.key));
    setCollected(prev => {
      if(prev.includes(flyItem.id))return prev;
      const next = [...prev, flyItem.id];
      playSound('collect');
      if (next.length === ITEM_DEFS.length) {
        successTimer.current=setTimeout(() => {
          if(flyItem.round!==roundRef.current)return;
          setShowSuccess(true);
          playSound('success');
        }, 300);
      }
      return next;
    });
  };

  // --- 渲染 ---
  if (!cfg) {
    return <div style={{ width: '100%', height: '100%', backgroundColor: '#8D6E63' }} />;
  }

  const heroSrc = cfg.BG_MAIN || '';

  return (
    <div ref={rootRef} className="ui-game" style={styles.root} aria-label={cfg.GAME_TITLE}>
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
          --font-body: -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
          --font-mono: ui-monospace, Menlo, monospace;
          --color-bg: #8D6E63;
          --color-hud: rgba(255, 255, 255, 0.85);
          --color-text: #3E2723;
          --color-accent: #2e7d32;
        }
        html, body, #root { width:100%; height:100%; margin:0; overflow:hidden; background: var(--color-bg); }
        * { box-sizing: border-box; touch-action: none; user-select: none; -webkit-user-drag: none; }
        
        @keyframes pulse {
          0% { transform: scale(0.9); opacity: 0.5; }
          50% { transform: scale(1.1); opacity: 0.8; }
          100% { transform: scale(0.9); opacity: 0.5; }
        }
        .ui-game[data-page-hidden="true"] .item-glow{animation-play-state:paused}
        .ui-game[data-reduced-motion="true"] .item-glow{animation:none}
      `}</style>

      {/* 主视觉区 (弹性) */}
      <div ref={containerRef} style={styles.mainArea}>
        {/* C.5 模糊背景兜底 */}
        {landscape && (
          <div style={{...styles.blurBg, backgroundImage: `url(${heroSrc})`}} />
        )}
        
        {/* C.6 套准 Wrapper */}
        <div style={{
          ...styles.wrapper,
          width: wrapperRect.width || '100%',
          height: wrapperRect.height || '100%',
          opacity: wrapperRect.width ? 1 : 0
        }}>
          <img 
            ref={imgRef}
            src={heroSrc} 
            alt="bg" 
            onLoad={calcWrapper}
            style={{ width: '100%', height: '100%', objectFit: landscape ? 'contain' : 'cover' }} 
          />
          
          {/* 可收集物品 */}
          {ITEM_DEFS.map(def => {
            const isCollected = collected.includes(def.id);
            const isFlying = flyingItems.some(f => f.id === def.id);
            if (isCollected || isFlying) return null;

            return (
              <motion.button type="button"
                key={def.id}
                aria-label={`Collect ${['starfish','shell','coconut'][ITEM_DEFS.indexOf(def)]}`}
                style={{ ...styles.itemWrapper, width:`${cfg.ITEM_SIZE ?? 15}%`, left: def.initPos.left, top: def.initPos.top }}
                whileHover={reduced ? undefined : { scale: 1.05 }}
                whileTap={reduced ? undefined : { scale: 0.95 }}
                onClick={(e) => handleItemClick(e, def)}
              >
                <img src={cfg[def.cfgKey]} alt="" style={styles.itemImg} />
                <div className="item-glow" style={styles.itemGlow} aria-hidden="true" />
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 底部 HUD 区 (固定) */}
      <div style={styles.hudArea}>
        <div style={styles.slotsContainer}>
          {ITEM_DEFS.map(def => {
            const isCollected = collected.includes(def.id);
            return (
              <div 
                key={`slot_${def.id}`} 
                ref={el => slotRefs.current[def.id] = el}
                style={{
                  ...styles.slot,
                  borderColor: isCollected ? 'var(--color-accent)' : '#ccc',
                  backgroundColor: isCollected ? '#fff' : 'rgba(255,255,255,0.3)'
                }}
              >
                {isCollected && (
                  <motion.img 
                    alt={`Collected ${['starfish','shell','coconut'][ITEM_DEFS.indexOf(def)]}`}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    src={cfg[def.cfgKey]} 
                    style={styles.slotImg} 
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {!hasInteracted&&<p className="ui-guide ui-float" style={{top:'max(var(--ui-top), 12%)',fontFamily:'var(--font-body)',color:'#fff',textShadow:'0 2px 6px #000'}}>Tap the hidden items</p>}

      {/* 飞行层 (Fixed 跨坐标系) */}
      {flyingItems.map(fly => (
        <motion.img
          alt="" aria-hidden="true"
          key={fly.key}
          src={cfg[fly.cfgKey]}
          initial={{ scale: 1, x: fly.startX - 30, y: fly.startY - 30 }}
          animate={{ x: fly.endX - 20, y: fly.endY - 20, scale: 0.5, rotate: 360 }}
          transition={{ duration: reduced ? .05 : 0.6, ease: "easeInOut" }}
          onAnimationComplete={() => handleFlyComplete(fly)}
          style={styles.flyingImg}
        />
      ))}

      {/* 成功弹窗 */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div 
            role="dialog" aria-modal="true" aria-label="Collection complete"
            style={styles.modalOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <motion.div 
              style={styles.modalContent}
              initial={reduced ? false : { scale: 0.9, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', bounce: 0.5 }}
            >
              <h2 style={styles.modalText}>{cfg.SUCCESS_MSG}</h2>
              <button 
                autoFocus
                style={styles.btn}
                onClick={() => {
                  unlock.stop();
                  roundRef.current++;clearTimeout(successTimer.current);pendingRef.current.clear();setFlyingItems([]);setCollected([]);setHasInteracted(false);
                  setShowSuccess(false);
                  playSound('click');
                }}
              >
                Again
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

createRoot(document.getElementById('root')).render(<App />);
