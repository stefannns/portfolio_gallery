// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Tone from 'tone';
// Editable Batch 3 game source. Third-party libraries are imported, not copied.
const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "GRAVITY",
    "kind": "number",
    "label": "Gravity",
    "value": 1.2,
    "default": 1.2,
    "min": 0.5,
    "max": 2,
    "step": 0.1
  }, {
    "id": "BASE_SPEED",
    "kind": "number",
    "label": "Base Speed",
    "value": 300,
    "default": 300,
    "min": 100,
    "max": 500,
    "step": 10
  }, {
    "id": "JUMP_FORCE",
    "kind": "number",
    "label": "Jump Force",
    "value": 600,
    "default": 600,
    "min": 300,
    "max": 1000,
    "step": 50
  }, {
    "id": "PED_SPEED",
    "kind": "number",
    "label": "Pedestrian Speed",
    "value": 100,
    "default": 100,
    "min": 50,
    "max": 200,
    "step": 10
  }, {
    "id": "CAR_SPEED",
    "kind": "number",
    "label": "Skateboard Speed",
    "value": 400,
    "default": 400,
    "min": 200,
    "max": 800,
    "step": 50
  }, {
    "id": "COST_BEG",
    "kind": "number",
    "label": "Base Cost - Tin Cup",
    "value": 10,
    "default": 10,
    "min": 5,
    "max": 50,
    "step": 5
  }, {
    "id": "COST_SPEED",
    "kind": "number",
    "label": "Base Cost - Sneakers",
    "value": 20,
    "default": 20,
    "min": 5,
    "max": 50,
    "step": 5
  }, {
    "id": "COST_PUNCH",
    "kind": "number",
    "label": "Base Cost - Fists",
    "value": 30,
    "default": 30,
    "min": 5,
    "max": 100,
    "step": 5
  }, {
    "id": "COST_ARMOR",
    "kind": "number",
    "label": "Base Cost - Armor",
    "value": 40,
    "default": 40,
    "min": 10,
    "max": 150,
    "step": 10
  }],
  "texts": [{
    "id": "GAME_TITLE",
    "label": "Game Title",
    "value": "STREET HOBO",
    "default": "STREET HOBO",
    "max_length": 20
  }, {
    "id": "TXT_DESC",
    "label": "Description",
    "value": "Survive the streets. Beg or brawl for cash. Upgrade to rule the block!",
    "default": "Survive the streets. Beg or brawl for cash.",
    "max_length": 100
  }, {
    "id": "TXT_START",
    "label": "Start Button",
    "value": "PLAY",
    "default": "PLAY",
    "max_length": 10
  }, {
    "id": "TXT_NO_MONEY",
    "label": "No Money Toast",
    "value": "Resume begging or brawling to collect more cash!",
    "default": "Resume begging or brawling to collect more cash!",
    "max_length": 60
  }, {
    "id": "UPG_BEG_NAME",
    "label": "Upgrade 1 Name",
    "value": "Stinky Tin Cup",
    "default": "Stinky Tin Cup",
    "max_length": 20
  }, {
    "id": "UPG_SPEED_NAME",
    "label": "Upgrade 2 Name",
    "value": "Stinky Sneakers",
    "default": "Stinky Sneakers",
    "max_length": 20
  }, {
    "id": "UPG_PUNCH_NAME",
    "label": "Upgrade 3 Name",
    "value": "Super Fists",
    "default": "Super Fists",
    "max_length": 20
  }, {
    "id": "UPG_ARMOR_NAME",
    "label": "Upgrade 4 Name",
    "value": "Cardboard Plate",
    "default": "Cardboard Plate",
    "max_length": 20
  }],
  "images": [{
    "id": "BG_STREET",
    "label": "Street Background",
    "path": "./assets/pixel/street.png",
    "replaceable": true
  }, {
    "id": "CHAR_HOBO_IDLE",
    "label": "Hobo Idle",
    "path": "./assets/pixel/idle.svg",
    "replaceable": true
  }, {
    "id": "CHAR_HOBO_BEG",
    "label": "Hobo Begging",
    "path": "./assets/pixel/beg.svg",
    "replaceable": true
  }, {
    "id": "CHAR_HOBO_JUMP",
    "label": "Hobo Jumping",
    "path": "./assets/pixel/jump.svg",
    "replaceable": true
  }, {
    "id": "CHAR_HOBO_PUNCH",
    "label": "Hobo Punching",
    "path": "./assets/pixel/punch.svg",
    "replaceable": true
  }, {
    "id": "CHAR_PED",
    "label": "Pedestrian",
    "path": "./assets/pixel/pedestrian.svg",
    "replaceable": true
  }, {
    "id": "OBJ_CAR",
    "label": "Skateboard",
    "path": "./assets/pixel/skateboard-v2.webp",
    "replaceable": true
  }, {
    "id": "ICON_COIN",
    "label": "Coin Icon",
    "path": "./assets/pixel/coin.svg",
    "replaceable": true
  }],
  "config_version": "2.0",
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "en",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; overscroll-behavior: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
    #root { isolation: isolate; }
    canvas { touch-action: none; }
    button, input, select, textarea { touch-action: manipulation; }
    .btn-control { border: 0; cursor: pointer; min-height: 44px; }
    button:focus-visible { outline: 3px solid #ffd700; outline-offset: 3px; }
    @media (prefers-reduced-motion: reduce) {
      .hobo-hit-flash { box-shadow: none !important; }
      .btn-control { transition: none !important; }
    }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}


.btn-control{min-width:0!important;width:auto!important;flex:1!important;font-size:16px!important;padding:10px 4px!important;min-height:48px}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.feed-first-action{position:fixed!important;top:42%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p.feed-first-action{background:transparent!important;color:#fff!important;padding:0!important;border-radius:0!important;font-family:Silkscreen,monospace!important;font-size:clamp(13px,3.8cqi,16px)!important;font-weight:400!important;line-height:1.4!important;-webkit-text-stroke:2px #30282a;paint-order:stroke fill;text-shadow:2px 2px 0 #30282a,-2px -2px 0 #30282a,2px -2px 0 #30282a,-2px 2px 0 #30282a}

@font-face{font-family:'Silkscreen';src:url('./assets/fonts/silkscreen/Silkscreen-Regular.ttf') format('truetype');font-style:normal;font-weight:400;font-display:swap}
:root:root{--font-display:'Silkscreen',monospace;--font-body:'Silkscreen',monospace}
#root img,#root div[style*='background-image']{image-rendering:pixelated}
@keyframes street-walk-frames{0%{background-position:0% 50%}25%{background-position:33.333% 50%}50%{background-position:66.667% 50%}75%,100%{background-position:100% 50%}}
@keyframes street-ped-steps{0%,100%{translate:0 0}50%{translate:0 -5px}}
.street-walk{background-image:url('./assets/pixel/walk-cycle.png');background-repeat:no-repeat;background-size:400% 100%;image-rendering:pixelated;animation:street-walk-frames .55s steps(1,end) infinite}
.street-ped-walking{animation:street-ped-steps .4s steps(2,end) infinite}
@media(prefers-reduced-motion:reduce){.street-walk,.street-ped-walking{animation:none}}
.btn-control{border:2px solid #342b2c!important;border-radius:4px!important;font-size:clamp(10px,3cqi,14px)!important;box-shadow:2px 3px 0 #342b2c!important}
.shop-panel,.upgrade-item,.btn-upgrade{border-radius:3px!important}
.shop-modal{justify-content:center!important;padding:16px 24px!important}
.shop-panel{max-height:100%!important;padding:12px!important;gap:8px!important;color:#25201d;overscroll-behavior:contain;touch-action:pan-y}
.shop-panel h2{font-size:clamp(19px,5.5cqi,24px)!important;line-height:1.25}
.upgrade-item{padding:8px!important;gap:8px;min-height:58px}
.upgrade-name{font-size:clamp(13px,3.6cqi,16px)!important;line-height:1.3;white-space:normal!important;overflow:visible!important;overflow-wrap:anywhere}
.btn-upgrade{flex:0 0 100px;min-height:44px;font-size:12px!important;line-height:1.2;padding:5px 6px!important;color:#30250d;overflow-wrap:anywhere}
.btn-upgrade:disabled{opacity:1!important;background:#e2d2a1!important;border-color:#a28d58!important;color:#51431e!important}
.shop-close{margin-top:2px!important;min-height:44px;font-size:16px!important;color:#211e1a}

`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
// Preserve the original fallback when the configuration cannot be fetched.
for (const value3 of ['playable-inline-config', 'playable-config-inline']) {
  const node = document.createElement('script');
  node.id = value3;
  node.type = 'application/json';
  node.textContent = JSON.stringify(DEFAULT_CONFIG);
  document.body.append(node);
}
document.documentElement.lang = 'en';
var value = 850;
function JT(config) {
  let options2 = {};
  (config.tweaks || []).forEach(item => {
    options2[item.id] = item.value;
  });
  (config.texts || []).forEach(item => {
    options2[item.id] = item.value;
  });
  (config.images || []).forEach(item => {
    options2[item.id] = item.path;
  });
  (config.mentions || []).forEach(item => {
    options2[item.id] = item.path != null && item.path !== "" ? item.path : item.value;
  });
  (config.motions || []).forEach(item => {
    if (!(!item || !item.id)) {
      if (item.base_path != null && item.base_path !== "") {
        options2[item.id] = item.base_path;
        options2[item.id + "_BASE"] = item.base_path;
      }
      if (item.frame_count != null) {
        options2[item.id + "_COUNT"] = item.frame_count;
      }
    }
  });
  return options2;
}
var value2 = 1000;
var destination = Tone.getContext().destination;
var options = {
  ctx: null,
  synths: {},
  async init() {
    if (!this.ctx) try {
      await Tone.start();
      this.ctx = !0;
      this.synths.jump = new Tone.MembraneSynth().toDestination();
      this.synths.punch = new Tone.NoiseSynth({
        noise: {
          type: "white"
        },
        envelope: {
          attack: 0.01,
          decay: 0.1,
          sustain: 0
        }
      }).toDestination();
      this.synths.coin = new Tone.Synth({
        oscillator: {
          type: "sine"
        },
        envelope: {
          attack: 0.01,
          decay: 0.2,
          sustain: 0
        }
      }).toDestination();
      this.synths.beg = new Tone.PolySynth(Tone.Synth).toDestination();
      destination.volume.value = -10;
    } catch (value3) {
      console.warn("Audio init failed", value3);
    }
  },
  play(value3) {
    if (!this.ctx) return;
    let timestamp = Tone.now();
    try {
      if (value3 === "jump") {
        this.synths.jump.triggerAttackRelease("C2", "8n", timestamp);
      }
      if (value3 === "punch" || value3 === "hit") {
        this.synths.punch.triggerAttackRelease("16n", timestamp);
      }
      if (value3 === "coin") {
        this.synths.coin.triggerAttackRelease("E5", "16n", timestamp);
      }
      if (value3 === "beg") {
        this.synths.beg.triggerAttackRelease(["C4", "E4", "G4"], "8n", timestamp);
      }
    } catch {}
  }
};
function KT() {
  return <style>{`
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
      --col-bg: #87CEEB;
      --col-btn-shop: #a3c9a8;
      --col-btn-left: rgba(255,255,255,0.4);
      --col-btn-right: rgba(255,255,255,0.4);
      --col-btn-beg: rgba(100,149,237,0.8);
      --col-btn-punch: rgba(205,92,92,0.8);
      --col-btn-jump: rgba(60,179,113,0.8);
    }
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: #000; touch-action: none; }
    * { box-sizing: border-box; user-select: none; -webkit-user-select: none; }
    
    .btn-control {
      flex: 1; min-width: 0; max-width: 80px; max-height: 80px; aspect-ratio: 1; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-family: var(--font-display); font-size: clamp(16px, 5cqi, 24px); color: #fff; text-shadow: 1px 1px 0 #000;
      box-shadow: 0 4px 0 rgba(0,0,0,0.2); transition: transform 0.1s;
    }
    .btn-control:active { transform: translateY(4px); box-shadow: 0 0 0 rgba(0,0,0,0); }
    
    .shop-modal {
      position: absolute; inset: 0; background: rgba(0,0,0,0.8); z-index: 50; display: flex; flex-direction: column; align-items: center; padding: 20px;
    }
    .shop-panel {
      width: 100%; max-width: 400px; background: #fff; border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 12px;
      overflow-y: auto; max-height: 80%; border: 4px solid #333;
    }
    .upgrade-item {
      display: flex; justify-content: space-between; align-items: center; background: #f0f0f0; padding: 12px; border-radius: 8px; border: 2px solid #ccc;
    }
    .btn-upgrade {
      background: #ffd700; border: 2px solid #b8860b; border-radius: 8px; padding: 8px 12px; font-family: var(--font-display);
      cursor: pointer; font-size: 16px;
    }
    .btn-upgrade:disabled { background: #ccc; border-color: #999; color: #666; }
  `}</style>;
}
const STREET_ACTOR_FILTER = 'brightness(1.12) saturate(1.12) drop-shadow(2px 0 0 #ffe9c2) drop-shadow(-2px 0 0 #ffe9c2) drop-shadow(0 -2px 0 #ffe9c2) drop-shadow(0 3px 0 #32292a)';
function App() {
  let [config, setConfig] = React.useState(null);
  let [phase, setPhase] = React.useState("loading");
  let [count, setCount] = React.useState(0);
  let [currentValue, setCurrentValue] = React.useState(!1);
  let [model, setModel] = React.useState({
    beg: 0,
    speed: 0,
    punch: 0,
    armor: 0
  });
  let [selection, setSelection] = React.useState("");
  let [health, setHealth] = React.useState(100);
  let [, h] = React.useState(0);
  let stateRef = React.useRef({
    hobo: {
      x: 200,
      y: value,
      vx: 0,
      vy: 0,
      state: "idle",
      facingRight: !0,
      actionTimer: 0
    },
    peds: [],
    cars: [],
    coins: [],
    cameraX: 0,
    health: 100,
    hitTimer: 0,
    lastCarHit: -10000,
    lastCarSpawn: -10000,
    inputs: {
      left: !1,
      right: !1
    },
    lastFrame: 0
  });
  let stateRef2 = React.useRef();
  React.useEffect(() => {
    let value3 = !0;
    (async () => {
      let options2 = {
        tweaks: [],
        texts: [],
        images: []
      };
      try {
        let y = await fetch("./game.config.json", {
          cache: "no-store"
        });
        if (y.ok) {
          options2 = await y.json();
        }
      } catch {}
      if (value3) {
        setConfig(JT(options2));
        setPhase("start");
      }
    })();
    return () => {
      value3 = !1;
      cancelAnimationFrame(stateRef2.current);
    };
  }, []);
  let callback = React.useCallback(value3 => {
    if (phase !== "playing" || currentValue) {
      stateRef.current.lastFrame = value3;
      stateRef2.current = requestAnimationFrame(callback);
      return;
    }
    let value4 = Math.min((value3 - stateRef.current.lastFrame) / 1000, 0.05);
    stateRef.current.lastFrame = value3;
    let y = stateRef.current;
    let {
      hobo: particle
    } = y;
    let value5 = 1 + model.speed * 0.2;
    let value6 = Math.max(0.2, 0.5 - model.punch * 0.05);
    let value7 = config.BASE_SPEED * value5;
    if (particle.actionTimer > 0) {
      particle.actionTimer -= value4;
      if (particle.actionTimer <= 0) {
        particle.state = "idle";
      }
    }
    if (particle.state !== "hit") {
      if (particle.state !== "punch" && particle.state !== "beg") {
        if (y.inputs.left) {
          particle.vx = -value7;
          particle.facingRight = !1;
          if (particle.state === "idle") {
            particle.state = "walk";
          }
        } else {
          if (y.inputs.right) {
            particle.vx = value7;
            particle.facingRight = !0;
            if (particle.state === "idle") {
              particle.state = "walk";
            }
          } else {
            particle.vx = 0;
            if (particle.state === "walk") {
              particle.state = "idle";
            }
          }
        }
      } else {
        particle.vx = 0;
      }
    }
    particle.vy += config.GRAVITY * 1000 * value4;
    particle.x += particle.vx * value4;
    particle.y += particle.vy * value4;
    let value8 = !1;
    if (particle.y >= value) {
      particle.y = value;
      particle.vy = 0;
      value8 = !0;
      if (particle.state === "jump") particle.state = (y.inputs.left || y.inputs.right) ? "walk" : "idle";
    }
    if (!value8 && particle.state !== "hit" && particle.state !== "punch" && particle.state !== "beg") {
      particle.state = "jump";
    }
    y.hitTimer = Math.max(0, y.hitTimer - value4);
    let z = value2 * 0.38;
    let targetCamera = Math.max(0, particle.x - z);
    y.cameraX += (targetCamera - y.cameraX) * Math.min(1, value4 * 7);
    particle.x = Math.max(60, particle.x);
    if (Math.random() < 1 - Math.exp(-0.6 * value4)) {
      y.peds.push({
        id: Math.random(),
        x: y.cameraX + value2 + 200,
        y: value,
        vx: -config.PED_SPEED,
        active: !0
      });
    }
    if (value3 - y.lastCarSpawn > 4500 && Math.random() < 1 - Math.exp(-0.8 * value4)) {
      y.lastCarSpawn = value3;
      y.cars.push({
        id: Math.random(),
        x: y.cameraX + value2 + 300,
        y: value,
        vx: -config.CAR_SPEED
      });
    }
    y.peds.forEach(particle2 => {
      particle2.x += particle2.vx * value4;
      if (!particle2.active) {
        particle2.y += particle2.vy * value4;
        particle2.vy += config.GRAVITY * 1000 * value4;
        particle2.knockedTimer -= value4;
      }
    });
    y.peds = y.peds.filter(item => item.x > y.cameraX - 300 && (item.active || item.knockedTimer > 0));
    y.cars.forEach(item => item.x += item.vx * value4);
    y.cars = y.cars.filter(item => item.x > y.cameraX - 500);
    (() => {
      const value9 = y.cars.find(item => Math.abs(item.x - particle.x) < 86 && particle.y > value - 32);
      if (!value9 || value3 - y.lastCarHit <= 1200) return;
      y.lastCarHit = value3;
      const damage = Math.max(8, 22 - model.armor * 3);
      y.health = Math.max(0, y.health - damage);
      setHealth(y.health);
      y.hitTimer = 0.6;
      particle.hitDamage = damage;
      particle.state = "hit";
      particle.actionTimer = 0.42;
      particle.vx = Math.sign(value9.vx || -1) * 180;
      particle.vy = -180;
      try {
        options.play("hit");
      } catch {}
      if (y.health === 0) {
        y.inputs.left = y.inputs.right = !1;
        setPhase("over");
      }
    })();
    y.coins.forEach(particle2 => {
      particle2.vy += config.GRAVITY * 1000 * value4;
      particle2.x += particle2.vx * value4;
      particle2.y += particle2.vy * value4;
      if (particle2.y >= value) {
        particle2.y = value;
        particle2.vy = -particle2.vy * 0.5;
        particle2.vx *= 0.8;
      }
      if (Math.abs(particle2.x - particle.x) < 80 && Math.abs(particle2.y - particle.y) < 100 && !particle2.picked) {
        particle2.picked = !0;
        setCount(value9 => value9 + (1 + model.beg * 0.5));
        options.play("coin");
      }
    });
    y.coins = y.coins.filter(item => !item.picked && item.x > y.cameraX - 300);
    h(value9 => value9 + 1);
    stateRef2.current = requestAnimationFrame(callback);
  }, [phase, currentValue, config, model]);
  React.useEffect(() => {
    stateRef2.current = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(stateRef2.current);
  }, [callback]);
  React.useEffect(() => {
    const clear = () => {
      stateRef.current.inputs.left = stateRef.current.inputs.right = !1;
      stateRef.current.lastFrame = performance.now();
    };
    const hidden = () => {
      if (document.hidden) clear();
    };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  let handleClick = () => {
    if (phase !== "start" && phase !== "over") return;
    options.init().catch(() => {});
    stateRef.current = {
      hobo: {
        x: 200,
        y: value,
        vx: 0,
        vy: 0,
        state: "idle",
        facingRight: !0,
        actionTimer: 0
      },
      peds: [],
      cars: [],
      coins: [],
      cameraX: 0,
      health: 100,
      hitTimer: 0,
      lastCarHit: -10000,
      lastCarSpawn: performance.now(),
      inputs: {
        left: !1,
        right: !1
      },
      lastFrame: performance.now()
    };
    setHealth(100);
    setCount(0);
    setModel({
      beg: 0,
      speed: 0,
      punch: 0,
      armor: 0
    });
    setCurrentValue(!1);
    setSelection("");
    setPhase("playing");
  };
  let handleAction = value3 => {
    if (phase !== "playing" && phase !== "start" || currentValue) return;
    if (phase === "start") handleClick();
    let current2 = stateRef.current;
    let {
      hobo: y
    } = current2;
    if (y.state === "hit") return;
    if (value3 === "jump") {
      if (y.y >= value - 1) {
        y.vy = -config.JUMP_FORCE;
        options.play("jump");
      }
    } else if (value3 === "punch") {
      if (y.actionTimer > 0) return;
      y.state = "punch";
      y.actionTimer = 0.3;
      options.play("punch");
      let value4 = 120 + model.punch * 20;
      current2.peds.forEach(particle => {
        if (particle.active && Math.abs(particle.x - y.x) < value4 && Math.abs(particle.y - y.y) < 100) {
          let value5 = y.facingRight ? 1 : -1;
          if (value5 === 1 && particle.x > y.x || value5 === -1 && particle.x < y.x) {
            particle.vx = value5 * 300;
            particle.vy = -250;
            particle.knockedTimer = 0.5;
            particle.active = !1;
            current2.coins.push({
              id: Math.random(),
              x: particle.x,
              y: particle.y - 50,
              vx: (Math.random() - 0.5) * 200,
              vy: -300,
              picked: !1
            });
          }
        }
      });
    } else if (value3 === "beg") {
      if (y.actionTimer > 0) return;
      y.state = "beg";
      y.actionTimer = 0.5;
      let value4 = 0.3 + model.beg * 0.1;
      if (Math.random() < value4) {
        options.play("beg");
        current2.coins.push({
          id: Math.random(),
          x: y.x + (y.facingRight ? 50 : -50),
          y: y.y - 100,
          vx: 0,
          vy: -200,
          picked: !1
        });
      }
    }
  };
  let handleAction2 = (value3, otherValue) => {
    if (otherValue && (phase !== "playing" && phase !== "start" || currentValue)) return;
    if (otherValue && phase === "start") handleClick();
    if (value3 === "left") {
      stateRef.current.inputs.left = otherValue;
    }
    if (value3 === "right") {
      stateRef.current.inputs.right = otherValue;
    }
  };
  let x = (value3, otherValue) => {
    if (count >= otherValue) {
      setCount(y => y - otherValue);
      setModel(y => ({
        ...y,
        [value3]: y[value3] + 1
      }));
      options.play("coin");
    } else {
      setSelection(config.TXT_NO_MONEY);
      setTimeout(() => setSelection(""), 2000);
    }
  };
  if (!config) return <div style={{
    width: "100%",
    height: "100%",
    background: "#000"
  }} />;
  let current = stateRef.current;
  let items = [{
    id: "beg",
    name: config.UPG_BEG_NAME,
    lvl: model.beg,
    cost: Math.floor(config.COST_BEG * Math.pow(1.5, model.beg))
  }, {
    id: "speed",
    name: config.UPG_SPEED_NAME,
    lvl: model.speed,
    cost: Math.floor(config.COST_SPEED * Math.pow(1.5, model.speed))
  }, {
    id: "punch",
    name: config.UPG_PUNCH_NAME,
    lvl: model.punch,
    cost: Math.floor(config.COST_PUNCH * Math.pow(1.6, model.punch))
  }, {
    id: "armor",
    name: config.UPG_ARMOR_NAME,
    lvl: model.armor,
    cost: Math.floor(config.COST_ARMOR * Math.pow(1.8, model.armor))
  }];
  return <div style={{
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    containerType: "size"
  }}>{<KT />}{<div style={{
      flex: 1,
      minHeight: 0,
      position: "relative",
      overflow: "hidden",
      backgroundColor: "var(--col-bg)"
    }}>{<div style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `url(${config.BG_STREET})`,
        backgroundSize: "cover",
        backgroundPosition: "bottom",
        filter: "brightness(.86) saturate(.82)",
        transform: `translateX(${-current.cameraX * 0.2 % 1000}px)`,
        width: "200%"
      }} />}{<div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: "100%",
        transform: `translateX(${-current.cameraX}px) scale(1)`
      }}>{current.peds.map(point => <img className={point.active ? "street-ped-walking" : ""} src={config.CHAR_PED} style={{
          position: "absolute",
          left: point.x,
          top: point.y,
          width: "160px",
          height: "220px",
          transform: `translate(-50%, -100%) scaleX(${point.vx < 0 ? -1 : 1})`,
          objectFit: "contain",
          filter: STREET_ACTOR_FILTER,
          opacity: point.active ? 1 : 0.7
        }} alt={"ped"} key={point.id} />)}{current.cars.map(point => <img src={config.OBJ_CAR} style={{
          position: "absolute",
          left: point.x,
          top: point.y,
          width: "144px",
          height: "48px",
          transform: `translate(-50%, -100%) scaleX(${point.vx < 0 ? -1 : 1})`,
          filter: STREET_ACTOR_FILTER,
          objectFit: "contain",
          objectPosition: "center bottom"
        }} alt={"skateboard"} key={point.id} />)}{current.coins.map(point => <img src={config.ICON_COIN} style={{
          position: "absolute",
          left: point.x,
          top: point.y,
          width: "40px",
          height: "40px",
          transform: "translate(-50%, -50%)",
          objectFit: "contain"
        }} alt={"coin"} key={point.id} />)}{<img src={current.hobo.state === "beg" ? config.CHAR_HOBO_BEG : current.hobo.state === "punch" ? config.CHAR_HOBO_PUNCH : current.hobo.state === "jump" ? config.CHAR_HOBO_JUMP : config.CHAR_HOBO_IDLE} style={{
          position: "absolute",
          left: current.hobo.x,
          top: current.hobo.y,
          width: "190px",
          height: "250px",
          transform: `translate(-50%, -100%) scaleX(${current.hobo.facingRight ? 1 : -1})`,
          objectFit: "contain",
          visibility: current.hobo.state === "walk" ? "hidden" : "visible",
          filter: current.hitTimer > 0 ? "drop-shadow(0 0 18px #ff4747) sepia(.65) saturate(2)" : STREET_ACTOR_FILTER
        }} alt={"hobo"} />}{current.hobo.state === "walk" && <div className="street-walk" aria-hidden="true" style={{
          position: "absolute", left: current.hobo.x, top: current.hobo.y,
          width: "190px", height: "250px",
          transform: `translate(-50%, -100%) scaleX(${current.hobo.facingRight ? 1 : -1})`,
          filter: STREET_ACTOR_FILTER, pointerEvents: "none"
        }} />}{current.hitTimer > 0 && <div className={"hobo-damage"} role={"status"} aria-label={current.hobo.hitDamage + " damage"} style={{
          position: "absolute",
          left: current.hobo.x,
          top: current.hobo.y - 250 - (1 - current.hitTimer / 0.6) * 45,
          transform: "translateX(-50%)",
          color: "#ff4747",
          fontFamily: "var(--font-display)",
          fontSize: 36,
          textShadow: "2px 2px 0 #fff,0 0 12px #400",
          opacity: Math.min(1, current.hitTimer * 5),
          pointerEvents: "none"
        }}>{"−" + current.hobo.hitDamage}</div>}</div>}{<div style={{
        position: "absolute",
        top: "calc(30px + env(safe-area-inset-top, 0px))",
        left: "calc(30px + env(safe-area-inset-left, 0px))",
        right: "calc(30px + env(safe-area-inset-right, 0px))",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
        alignItems: "flex-start"
      }}>{<div aria-label={"Cash " + count} style={{
          gridColumn: 2,
          gridRow: 1,
          fontFamily: "var(--font-display)",
          fontSize: 28,
          lineHeight: 1.2,
          color: "#fff",
          WebkitTextStroke: "1px #231d1c",
          paintOrder: "stroke fill",
          textShadow: "2px 2px 0 #231d1c, -2px -2px 0 #231d1c, 2px -2px 0 #231d1c, -2px 2px 0 #231d1c",
          display: "flex",
          alignItems: "center",
          gap: 6
        }}>{<img src={config.ICON_COIN} style={{
            width: 24,
            height: 24,
            objectFit: "contain"
          }} alt={""} />}{"$"}{count.toLocaleString("en")}</div>}{<div style={{
          gridColumn: 1,
          gridRow: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 12
        }}>{<div aria-label={"Health " + health} style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            lineHeight: 1.2,
            color: health > 30 ? "#fff" : "#ff6b6b",
            WebkitTextStroke: "1px #231d1c",
            paintOrder: "stroke fill",
            textShadow: "2px 2px 0 #231d1c, -2px -2px 0 #231d1c, 2px -2px 0 #231d1c, -2px 2px 0 #231d1c"
          }}>{<span style={{
              fontSize: 14,
              marginRight: 6
            }}>{"HP"}</span>}{health}</div>}{<button onClick={() => {
            stateRef.current.inputs.left = stateRef.current.inputs.right = !1;
            setCurrentValue(!0);
          }} disabled={phase !== "playing"} style={{
            minHeight: 48,
            background: "var(--col-btn-shop)",
            border: "2px solid #476119",
            borderRadius: 8,
            padding: "8px 16px",
            fontFamily: "var(--font-display)",
            fontSize: 18,
            color: "#17200b",
            boxShadow: "0 4px 0 rgba(0,0,0,.2)",
            cursor: "pointer"
          }}>{"SHOP"}</button>}</div>}</div>}{selection && <div style={{
        position: "absolute",
        top: "30%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        background: "rgba(0,0,0,0.8)",
        color: "#fff",
        padding: "12px 24px",
        borderRadius: "8px",
        fontFamily: "var(--font-body)",
        textAlign: "center",
        pointerEvents: "none",
        zIndex: 60,
        whiteSpace: "nowrap"
      }}>{selection}</div>}</div>}{<div style={{
      flex: "0 0 auto",
      padding: "12px 30px",
      paddingBottom: "calc(50px + env(safe-area-inset-bottom, 0px))",
      background: "#333",
      display: "flex",
      justifyContent: "space-between",
      gap: "8px"
    }}>{<div style={{
        display: "flex",
        gap: "8px",
        flex: 1,
        justifyContent: "center"
      }}>{<button type={"button"} className={"btn-control"} style={{
          background: "var(--col-btn-left)"
        }} onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId);
          handleAction2("left", !0);
        }} onPointerUp={() => handleAction2("left", !1)} onPointerCancel={() => handleAction2("left", !1)} onLostPointerCapture={() => handleAction2("left", !1)} onKeyDown={event => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            handleAction2("left", !0);
          }
        }} onKeyUp={() => handleAction2("left", !1)} onBlur={() => handleAction2("left", !1)} aria-label={"Move left"}>{"<"}</button>}{<button type={"button"} className={"btn-control"} style={{
          background: "var(--col-btn-right)"
        }} onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId);
          handleAction2("right", !0);
        }} onPointerUp={() => handleAction2("right", !1)} onPointerCancel={() => handleAction2("right", !1)} onLostPointerCapture={() => handleAction2("right", !1)} onKeyDown={event => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            handleAction2("right", !0);
          }
        }} onKeyUp={() => handleAction2("right", !1)} onBlur={() => handleAction2("right", !1)} aria-label={"Move right"}>{">"}</button>}</div>}{<div style={{
        display: "flex",
        gap: "8px",
        flex: 1.5,
        justifyContent: "center"
      }}>{<button type={"button"} className={"btn-control"} style={{
          background: "var(--col-btn-beg)"
        }} onClick={() => handleAction("beg")}>{"BEG"}</button>}{<button type={"button"} className={"btn-control"} style={{
          background: "var(--col-btn-punch)"
        }} onClick={() => handleAction("punch")}>{"PUNCH"}</button>}{<button type={"button"} className={"btn-control"} style={{
          background: "var(--col-btn-jump)"
        }} onClick={() => handleAction("jump")}>{"JUMP"}</button>}</div>}</div>}{current.hitTimer > 0 && <div className={"hobo-hit-flash"} style={{
      position: "absolute",
      inset: 0,
      border: "8px solid rgba(255,70,70,.65)",
      boxShadow: "inset 0 0 60px rgba(255,70,70,.32)",
      opacity: current.hitTimer / 0.6,
      pointerEvents: "none",
      zIndex: 9
    }} />}{phase === "start" && <p className={"feed-first-action"} style={{
      position: "absolute",
      top: "90px",
      left: 30,
      right: 30,
      zIndex: 12,
      margin: 0,
      fontSize: 18,
      lineHeight: 1.35,
      textAlign: "center",
      pointerEvents: "none",
      color: "#fff"
    }}>{"Use the controls to start"}</p>}{phase === "over" && <div role={"dialog"} aria-modal={!0} aria-label={"Game over"} style={{
      position: "absolute",
      inset: 0,
      zIndex: 100,
      background: "rgba(12,19,28,.9)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 18,
      padding: "30px 30px 50px",
      color: "#fff",
      textAlign: "center"
    }}>{<h2 style={{
        fontFamily: "var(--font-display)",
        fontSize: 24,
        margin: 0
      }}>{"GAME OVER"}</h2>}{<p style={{
        fontFamily: "var(--font-body)",
        fontSize: 18,
        margin: 0
      }}>{"Jump over skateboards to avoid damage."}</p>}{<button onClick={handleClick} autoFocus={!0} style={{
        minHeight: 48,
        padding: "12px 28px",
        border: 0,
        borderRadius: 12,
        background: "#ffd700",
        color: "#282000",
        fontFamily: "var(--font-display)",
        fontSize: 20,
        cursor: "pointer"
      }}>{"PLAY AGAIN"}</button>}</div>}{null}{currentValue && <div className={"shop-modal"} onClick={() => setCurrentValue(!1)}>{<div className={"shop-panel"} onClick={value3 => value3.stopPropagation()}>{<h2 style={{
          fontFamily: "var(--font-display)",
          margin: 0,
          textAlign: "center",
          fontSize: "32px"
        }}>{"UPGRADES SHOP"}</h2>}{<div style={{
          textAlign: "center",
          fontFamily: "var(--font-display)",
          fontSize: "20px",
          color: "#228b22"
        }}>{"Cash: $"}{count.toLocaleString("en")}</div>}{items.map(item => <div className={"upgrade-item"} key={item.id}>{<div style={{
            flex: 1,
            minWidth: 0,
            marginRight: "12px"
          }}>{<div className="upgrade-name" style={{
              fontFamily: "var(--font-display)",
              fontSize: "16px"
            }}>{item.name}</div>}{<div style={{
              fontFamily: "var(--font-body)",
              fontSize: "14px",
              color: "#666"
            }}>{"Lvl: "}{item.lvl}</div>}</div>}{<button className={"btn-upgrade"} onClick={() => x(item.id, item.cost)} disabled={count < item.cost}>{"UPGRADE"}<br />{"$"}{item.cost}</button>}</div>)}{<button className="shop-close" onClick={() => setCurrentValue(!1)} style={{
          marginTop: "16px",
          padding: "12px",
          background: "#ccc",
          border: "none",
          borderRadius: "8px",
          fontFamily: "var(--font-display)",
          fontSize: "20px",
          cursor: "pointer"
        }}>{"CLOSE"}</button>}</div>}</div>}</div>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./hobo-layout-repair.js
(() => {
  const LOGICAL_SIZE = 1000;
  const repair = () => {
    const hobo = document.querySelector('img[alt="hobo"]');
    if (!hobo) return false;
    const world = hobo.parentElement;
    const stage = world && world.parentElement;
    if (!world || !stage) return false;
    const fitWorld = () => {
      const scale = Math.max(0.35, stage.clientHeight / LOGICAL_SIZE);
      world.style.width = `${LOGICAL_SIZE}px`;
      world.style.height = `${LOGICAL_SIZE}px`;
      world.style.top = '0';
      world.style.bottom = 'auto';
      world.style.right = 'auto';
      world.style.transformOrigin = 'left top';
      world.style.zoom = String(scale);
    };
    hobo.style.objectPosition = 'center bottom';
    const observer = new ResizeObserver(fitWorld);
    observer.observe(stage);
    fitWorld();
    return true;
  };
  if (!repair()) {
    const observer = new MutationObserver(() => {
      if (repair()) observer.disconnect();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})();

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root img",
        "data-game": "",
        "defer": null,
        "src": "./feed-entry-motion.js?v=feed-first-20261008-1"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root img",
      "game": ""
    }
  };
  const selector = script?.getAttribute('data-subject') || '#root canvas';
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let observer;
  let animation;
  let entered = false;
  function stop() {
    animation?.cancel();
    animation = null;
  }
  function enter() {
    if (entered || document.hidden) return;
    const subject = document.querySelector(selector);
    if (!subject || subject.closest('[hidden], [aria-hidden="true"]')) return;
    const computed = window.getComputedStyle(subject);
    if (computed.display === 'none' || computed.visibility === 'hidden') return;
    if (subject.tagName === 'IMG' && !subject.complete) {
      subject.addEventListener('load', enter, {
        once: true
      });
      return;
    }
    entered = true;
    observer?.disconnect();
    if (media?.matches) return;
    const opacity = Number(window.getComputedStyle(subject).opacity) || 1;
    if (typeof subject.animate === 'function') {
      animation = subject.animate([{
        opacity: opacity * 0.76
      }, {
        opacity
      }], {
        duration: 650,
        easing: 'ease-out'
      });
      animation.onfinish = () => {
        animation = null;
      };
    }
  }
  observer = new MutationObserver(enter);
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  enter();
  document.addEventListener('visibilitychange', () => {
    document.documentElement.toggleAttribute('data-feed-background', document.hidden);
    if (document.hidden) stop();else enter();
  });
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    stop();
  });
  window.addEventListener('pageshow', () => {
    if (!entered) observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    enter();
  });
  document.addEventListener('pointerdown', stop, {
    capture: true,
    passive: true
  });
  media?.addEventListener?.('change', () => {
    if (media.matches) stop();
  });
})();

// playable-cta-breathing-20261030

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(() => {
  const selectors = ["p.feed-first-action"];
  const copy = new Set([].map(item => item.replace(/\s+/g, ' ').trim().toLowerCase()));
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map();
  let queued = false;
  let visible = true;
  const action = /^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;
  function scan() {
    queued = false;
    for (const [el, a] of running) if (!el.isConnected) {
      a.cancel();
      running.delete(el);
    }
    if (motion.matches) {
      for (const value3 of running.values()) value3.cancel();
      running.clear();
      return;
    }
    const targets = new Set();
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(item => targets.add(item));
      } catch {}
    }
    for (const value3 of document.querySelectorAll('p,span,div,label,text')) {
      if (value3.children.length || value3.closest('button,a,input,select,textarea,[role="button"]')) continue;
      const text = (value3.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 5 && text.length <= 140 && (copy.has(text.toLowerCase()) || !selectors.length && action.test(text))) targets.add(value3);
    }
    for (const value3 of targets) {
      if (running.has(value3) || typeof value3.animate !== 'function') continue;
      if ([...targets].some(child => child !== value3 && value3.contains(child))) continue;
      const style = getComputedStyle(value3);
      if (/breath/i.test(style.animationName)) continue;
      const base = style.filter.replace(/opacity\([^)]*\)/g, '').replace(/^none$/, '').trim();
      const filter = value5 => (base ? base + ' ' : '') + 'opacity(' + value5 + ')';
      const value4 = value3.animate([{
        filter: filter(1)
      }, {
        filter: filter(0.65)
      }, {
        filter: filter(1)
      }], {
        duration: 2400,
        iterations: Infinity,
        easing: 'ease-in-out'
      });
      running.set(value3, value4);
      if (document.hidden || !visible) value4.pause();
    }
  }
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  };
  const pause = () => {
    for (const value3 of running.values()) {
      if (document.hidden || !visible) {
        value3.pause();
      } else {
        value3.play();
      }
    }
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    visible = entries.some(item => item.isIntersecting);
    pause();
  }) : null;
  if (document.body) intersection?.observe(document.body);else document.addEventListener('DOMContentLoaded', () => intersection?.observe(document.body), {
    once: true
  });
  document.addEventListener('visibilitychange', pause);
  motion.addEventListener?.('change', schedule);
  schedule();
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    intersection?.disconnect();
    for (const value3 of running.values()) value3.cancel();
    running.clear();
  }, {
    once: true
  });
})();

// Game helper

/* Batch 3 entry polish. Preview covers are still images in the feed. */
(() => {
  'use strict';

  const number = Number({
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": "",
        "data-batch3-game": "30"
      }[name] ?? null;
    },
    dataset: {
      "subject": "#root canvas",
      "game": "",
      "batch3Game": "30"
    }
  }?.dataset.batch3Game);
  const isFeed = new URLSearchParams(location.search).get('feedReview') === '1' && window.parent !== window;
  const root = document.documentElement;
  root.toggleAttribute('data-batch3-preview', isFeed);
  const configurations = {
    12: {
      text: 'Tap to pop the bubbles',
      top: '80px',
      color: '#a2355a',
      action: 'bubble'
    },
    20: {
      text: 'Tap the bug',
      top: '32%',
      color: '#fff',
      action: 'bug'
    },
    27: {
      text: 'Guess their age',
      top: '10.5%',
      color: '#fff',
      action: 'age'
    },
    37: {
      text: 'Tap to add balls',
      top: '24%',
      color: '#fff',
      action: 'add-ball'
    },
    39: {
      text: 'Tap squares to find the animal',
      top: '22%',
      color: '#29202e',
      action: 'cell'
    },
    49: {
      text: 'Guess the hidden code',
      top: '40%',
      color: '#fff',
      action: 'digit'
    },
    60: {
      text: 'Steer into the parking spot',
      top: '34%',
      color: '#fff',
      action: 'drive'
    }
  };
  const previewCSS = {
    8: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    11: 'html[data-batch3-preview] .screen-container div:has(>button.btn-option){transform:translateY(-8vh) scale(.84);transform-origin:center center}',
    13: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    25: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    27: 'html[data-batch3-preview] .age-controls {transform:translateY(-16vh) scale(.9);transform-origin:bottom center}',
    30: 'html[data-batch3-preview] .btn-control {visibility:hidden!important}',
    34: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    37: 'html[data-batch3-preview] #root button {bottom:34%!important}',
    38: 'html[data-batch3-preview] .pendulum-actions {visibility:hidden!important}',
    39: 'html[data-batch3-preview] [aria-label="8 by 8 animal search map"] {transform:scale(.84);transform-origin:center top}',
    43: 'html[data-batch3-preview] .meme-controls {visibility:hidden!important}',
    48: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    49: 'html[data-batch3-preview] #root button {visibility:hidden!important}',
    52: 'html[data-batch3-preview] .fate-wheel-wrap {transform:scale(.84)}',
    54: 'html[data-batch3-preview] .control {visibility:hidden!important}',
    56: 'html[data-batch3-preview] .drive-controls {visibility:hidden!important}',
    60: 'html[data-batch3-preview] #root div:has(>div>button[aria-label="Steer left"]) {visibility:hidden!important}',
    73: 'html[data-batch3-preview] #opening .opening-heading p {animation:b3-breathe 2.4s ease-in-out infinite}',
    74: 'html[data-batch3-preview] #photo-controls {visibility:hidden!important}'
  };
  const sharedCSS = `
    .b3-guide{position:fixed;left:30px;right:30px;z-index:120;margin:0;text-align:center;
      font:700 18px/1.3 var(--font-display,system-ui,sans-serif);pointer-events:none;
      text-shadow:0 1px 3px rgba(0,0,0,.25);animation:b3-breathe 2.4s ease-in-out infinite}
    @keyframes b3-breathe{0%,100%{opacity:1}50%{opacity:.68}}
    html[data-b3-hidden] .b3-guide,html[data-b3-hidden] #opening .opening-heading p{animation-play-state:paused!important}
    @media(prefers-reduced-motion:reduce){.b3-guide,html[data-batch3-preview] #opening .opening-heading p{animation:none!important}}
    ${previewCSS[number] || ''}
  `;
  const style = document.createElement('style');
  style.setAttribute('data-batch3-polish', '');
  style.textContent = sharedCSS;
  document.head.append(style);
  let guide;
  let dismissed = false;
  const config = configurations[number];
  function mountGuide() {
    if (!config || guide || dismissed) return;
    guide = document.createElement('p');
    guide.className = 'b3-guide';
    guide.textContent = config.text;
    guide.style.top = config.top;
    guide.style.color = config.color;
    document.body.append(guide);
  }
  function meaningful(event) {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (config?.action === 'bug') return !!target.closest('#root div[tabindex="0"]');
    if (config?.action === 'bubble') {
      if (target.closest('#root div[tabindex="0"],#root canvas')) return true;
      const value3 = target.closest('button');
      return !!value3 && /^(Sand Art|Spinner)$/.test(value3.textContent.trim());
    }
    if (config?.action === 'age') return !!target.closest('input[type="range"],button.guess');
    const button = target.closest('button');
    if (!button || button.disabled) return false;
    if (config?.action === 'add-ball') return button.textContent.trim() === 'Add Ball';
    if (config?.action === 'cell') return /^Check cell \d+$/.test(button.getAttribute('aria-label') || '');
    if (config?.action === 'digit') return /^\d$/.test(button.textContent.trim());
    if (config?.action === 'drive') return /^(Steer left|Steer right|Drive forward|Reverse)$/.test(button.getAttribute('aria-label') || '');
    return false;
  }
  function dismissOnAction(event) {
    if (root.hasAttribute('data-batch3-preview')) return;
    if (meaningful(event)) {
      dismissed = true;
      guide?.remove();
      guide = null;
    }
  }
  document.addEventListener('pointerdown', dismissOnAction, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') dismissOnAction(event);
  }, true);
  window.addEventListener('message', event => {
    if (!isFeed || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
    root.toggleAttribute('data-batch3-preview', event.data.active !== true);
  });
  document.addEventListener('visibilitychange', () => {
    root.toggleAttribute('data-b3-hidden', document.hidden);
  });
  const observer = new MutationObserver(mountGuide);
  const start = () => {
    mountGuide();
    observer.observe(document.getElementById('root') || document.body, {
      childList: true,
      subtree: true
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {
    once: true
  });else start();
  window.addEventListener('pagehide', () => {
    observer.disconnect();
  }, {
    once: true
  });
})();
