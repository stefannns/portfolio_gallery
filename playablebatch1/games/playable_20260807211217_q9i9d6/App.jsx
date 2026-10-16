/*
  [架构蓝图思考]
  1. 状态模型:
     - `cfg`: 游戏配置，就绪后渲染。
     - 主图等比例 cover 全屏，物品使用稳定的游戏画布坐标，不随 hover 改变点击区域。
     - `collected`: 已收集的物品 ID 数组。
     - `flyingItems`: 正在飞行的物品状态数组（含起点、终点、ID）。
     - `showSuccess`: 是否展示成功弹窗。
  2. 流程衔接:
     - 初始态：3 个物品散布在主图 wrapper 内。
     - 交互：点击物品 -> 触发首次音频解锁 -> 物品从原位消失，加入 `flyingItems` -> 播放飞行 CSS/Framer 动画。
     - 收集：飞行结束 -> 移出 `flyingItems`，加入 `collected` -> 对应底部槽位点亮，播放收集音效。
     - 终止态：`collected.length === 3` -> 延迟 500ms 弹出成功提示，播放胜利音效。
  3. 关键路径与边界:
     - 背景始终全屏；三个独立透明收集格叠在图上，不占用图片高度。
     - 跨坐标系飞行：起点用 e.clientX/Y，终点用槽位的 getBoundingClientRect()，飞行元素用 position:fixed 挂在顶层，避免被 overflow 裁切或受相对定位影响。
  4. 降级兜底: 图片加载失败不崩，音频加载失败 try/catch。
*/

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tone from 'tone';
import {uiCss, useUiStage, useToneGate, loadConfig} from './playable-ui.js';
import {themeCss} from './playable-theme.js';

// --- 常量与初始数据 ---
const ITEM_DEFS = [
  { id: 'item1', cfgKey: 'ITEM_1', initPos: { left: '30%', top: '59%' } },
  { id: 'item2', cfgKey: 'ITEM_2', initPos: { left: '28%', top: '76%' } },
  { id: 'item3', cfgKey: 'ITEM_3', initPos: { left: '82%', top: '73%' } },
];

// Revision only bundled collectible sprites; replacement/custom URLs stay unchanged.
const itemSrc = src => /^\.\/assets\/item_(starfish|shell|coconut)\.webp$/.test(src)
  ? `${src}?art=grounded-voxel70-20261015-1` : src;

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
    display: 'block',
    width: '100%',
    height: '100%',
    position: 'relative',
    containerType: 'size'
  },
  mainArea: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    backgroundColor: '#000'
  },
  wrapper: {
    position: 'absolute',
    inset: 0,
    zIndex: 1,
  },
  itemWrapper: {
    position: 'absolute',
    width: 'var(--voxel-item-size)',
    aspectRatio: '1/1',
    minWidth:44,minHeight:44,border:0,padding:0,background:'transparent',
    transform: 'translate(-50%, -50%)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  itemVisual: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    pointerEvents: 'none'
  },
  itemImg: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    position: 'relative',
    zIndex: 2
  },
  slotsContainer: {
    position: 'absolute',
    left: '50%',
    bottom: 'var(--ui-bottom)',
    transform: 'translateX(-50%)',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, var(--voxel-slot-size))',
    gap: '12px',
    background: 'transparent',
    pointerEvents: 'none',
    zIndex: 10
  },
  slot: {
    width: 'var(--voxel-slot-size)',
    height: 'var(--voxel-slot-size)',
    border: '2px solid',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 0 1px rgba(12,34,26,.55), 0 2px 8px rgba(12,34,26,.2)'
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
  resultOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: '20px',
    padding: 'var(--ui-top) var(--ui-side) var(--ui-bottom)',
    zIndex: 100,
  },
  resultText: {
    margin: 0,
    maxWidth: '100%',
    textAlign: 'center',
    overflowWrap: 'anywhere',
    fontFamily: 'var(--font-display)',
    fontSize: 'max(20px, calc(24px * var(--ui-scale)))',
    color: '#fff',
    textShadow: '0 2px 6px rgba(0,0,0,.75)',fontWeight:700,lineHeight:1.25
  },
  btn: {
    fontFamily: 'var(--font-display)',
    fontSize: '18px',
    minWidth: 112,
    minHeight: 44,
    padding: '12px 32px',
    backgroundColor: 'var(--color-accent)',
    color: '#fff',
    border: 'none',
    borderRadius: '999px',
    cursor: 'pointer'
  }
};

// --- 主组件 ---
const App = () => {
  const [cfg, setCfg] = useState(null);
  
  // 状态
  const [collected, setCollected] = useState([]);
  const [flyingItems, setFlyingItems] = useState([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [hasInteracted,setHasInteracted]=useState(false);

  // Refs
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
    let endSize = 38;
    if (slotNode) {
      const sRect = slotNode.getBoundingClientRect();
      endX = sRect.left + sRect.width / 2;
      endY = sRect.top + sRect.height / 2;
      endSize = sRect.width * .8;
    }

    setFlyingItems(prev => [...prev, {
      id: itemDef.id,
      cfgKey: itemDef.cfgKey,
      round:roundRef.current,
      startX, startY, endX, endY, startSize:rect.width, endSize,
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
    <div ref={rootRef} className="ui-game voxel-game" style={{...styles.root,'--voxel-item-size':`max(44px, ${cfg.ITEM_SIZE ?? 15}cqmin)`}} aria-label={cfg.GAME_TITLE}>
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
        
        .voxel-game{--voxel-slot-size:clamp(48px,12cqmin,64px);--voxel-item-inset:calc(var(--voxel-item-size) * .55 + 4px);--voxel-guide-top:max(var(--ui-top),12cqh);--voxel-guide-height:calc(18px * var(--ui-scale) * 1.35 + 14px)}
        .voxel-item{border-radius:50%}
        .voxel-item-visual{transition:transform .14s ease-out}
        @media(hover:hover) and (pointer:fine){.voxel-item:hover .voxel-item-visual{transform:scale(1.05)}}
        @media(orientation:landscape){
          .voxel-item[data-item="item1"]{--voxel-item-left:35%;--voxel-item-top:64%}
          .voxel-item[data-item="item2"]{--voxel-item-left:25%;--voxel-item-top:85%;--voxel-item-floor:calc(100% - var(--ui-bottom) - var(--voxel-item-inset))}
          .voxel-item[data-item="item3"]{--voxel-item-left:76%;--voxel-item-top:85%;--voxel-item-floor:calc(100% - var(--ui-bottom) - var(--voxel-item-inset))}
        }
        .voxel-item:active .voxel-item-visual{transform:scale(.95)}
        .ui-game .voxel-item:focus-visible{outline:3px solid #fff;outline-offset:4px;box-shadow:0 0 0 6px #244237}
        .ui-game[data-reduced-motion="true"] .voxel-item-visual{transform:none!important;transition:none!important}
        .voxel-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      `}</style>
      <style>{themeCss}</style>

      {/* 全屏场景；背景等比例 cover，物品独立定位在可见画布内。 */}
      <div className="voxel-scene" style={styles.mainArea}>
        <div style={styles.wrapper}>
          <img 
            src={heroSrc} 
            alt="Voxel beach scene"
            draggable={false}
            style={{ display:'block',width: '100%', height: '100%', objectFit:'cover' }}
          />
          
          {/* 可收集物品 */}
          {ITEM_DEFS.map(def => {
            const isCollected = collected.includes(def.id);
            const isFlying = flyingItems.some(f => f.id === def.id);
            if (isCollected || isFlying) return null;

            return (
              <button type="button" className="voxel-item"
                key={def.id}
                data-item={def.id}
                aria-label={`Collect ${['starfish','shell','coconut'][ITEM_DEFS.indexOf(def)]}`}
                style={{ ...styles.itemWrapper,
                  left:`clamp(calc(var(--ui-side) + var(--voxel-item-inset)), var(--voxel-item-left, ${def.initPos.left}), calc(100% - var(--ui-side) - var(--voxel-item-inset)))`,
                  top:`clamp(calc(var(--voxel-guide-top) + var(--voxel-guide-height) + 8px + var(--voxel-item-inset)), var(--voxel-item-top, ${def.initPos.top}), var(--voxel-item-floor, calc(100% - var(--ui-bottom) - var(--voxel-slot-size) - 12px - var(--voxel-item-inset))))`
                }}
                onClick={(e) => handleItemClick(e, def)}
              >
                <span className="voxel-item-visual" style={styles.itemVisual}>
                  <img src={itemSrc(cfg[def.cfgKey])} alt="" draggable={false} style={styles.itemImg} />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 独立透明收集格：不占据场景高度，不拦截游戏操作。 */}
        <div className="voxel-collection" role="list" aria-label="Collection slots" style={styles.slotsContainer}>
          {ITEM_DEFS.map(def => {
            const isCollected = collected.includes(def.id);
            return (
              <div 
                key={`slot_${def.id}`} 
                role="listitem" aria-label={`${['Starfish','Shell','Coconut'][ITEM_DEFS.indexOf(def)]}: ${isCollected?'collected':'not collected'}`}
                ref={el => slotRefs.current[def.id] = el}
                style={{
                  ...styles.slot,
                  borderColor: isCollected ? '#b6edc7' : 'rgba(255,255,255,.8)',
                  backgroundColor: isCollected ? 'rgba(255,255,255,.12)' : 'transparent'
                }}
              >
                {isCollected && (
                  <motion.img 
                    alt="" aria-hidden="true"
                    initial={reduced?false:{scale:0}}
                    animate={{ scale: 1 }}
                    src={itemSrc(cfg[def.cfgKey])}
                    style={styles.slotImg} 
                  />
                )}
              </div>
            );
          })}
        </div>
      <span className="voxel-status" role="status" aria-live="polite" aria-atomic="true">{collected.length} of 3 items collected</span>
      {!hasInteracted&&<p className="ui-guide ui-float" style={{top:'var(--voxel-guide-top)',fontFamily:'var(--font-body)',fontWeight:400,color:'#fff',textShadow:'none',background:'rgba(32,51,47,.8)',borderRadius:12,padding:'7px 12px'}}>Tap the hidden items</p>}

      {/* 飞行层 (Fixed 跨坐标系) */}
      {flyingItems.map(fly => (
        <motion.img
          alt="" aria-hidden="true"
          key={fly.key}
          src={itemSrc(cfg[fly.cfgKey])}
          initial={{ scale:fly.startSize/60, x:fly.startX-30, y:fly.startY-30 }}
          animate={{ x:fly.endX-30,y:fly.endY-30,scale:fly.endSize/60,rotate:360 }}
          transition={{ duration: reduced ? .05 : 0.6, ease: "easeInOut" }}
          onAnimationComplete={() => handleFlyComplete(fly)}
          style={styles.flyingImg}
        />
      ))}

      {/* 透明完成层：文字直接覆盖场景，保留独立重玩按钮。 */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div 
            className="voxel-result" role="dialog" aria-modal="true" aria-label="Collection complete" aria-describedby="voxel-result-text"
            style={styles.resultOverlay}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{duration:reduced?0:.18}}
          >
              <h2 id="voxel-result-text" className="voxel-result-text" style={styles.resultText}>{cfg.SUCCESS_MSG}</h2>
              <button 
                type="button" className="voxel-again"
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
        )}
      </AnimatePresence>
    </div>
  );
};

createRoot(document.getElementById('root')).render(<App />);
