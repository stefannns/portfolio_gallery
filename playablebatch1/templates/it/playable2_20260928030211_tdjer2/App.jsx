// Editable game logic recovered from the current application; third-party library code is imported, not embedded.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
// Italian Batch 1. Editable game source; dependency implementations are npm imports.
// Rebuild with the supplied platform app/h5_build/build.js. No private launcher is needed.
// Older hosts can still size the scene on mount and window resize.
function observeGameSize(callback) {
  if (typeof ResizeObserver === 'function') return new ResizeObserver(callback);

  const targets = new Set();
  let frame;
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const entries = Array.from(targets, target => ({
        target,
        contentRect: { width: target.clientWidth, height: target.clientHeight }
      }));
      if (entries.length) callback(entries);
    });
  }
  return {
    observe(target) {
      targets.add(target);
      window.addEventListener('resize', schedule);
      schedule();
    },
    disconnect() {
      targets.clear();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
    }
  };
}

const DEFAULT_CONFIG = {
  "tweaks": [{
    "id": "PARTICLE_DENSITY",
    "kind": "number",
    "label": "Sampling Step (Smaller=More)",
    "value": 4,
    "default": 4,
    "min": 2,
    "max": 10,
    "step": 1
  }, {
    "id": "SPRING_FORCE",
    "kind": "number",
    "label": "Spring Force",
    "value": 0.05,
    "default": 0.05,
    "min": 0.01,
    "max": 0.2,
    "step": 0.01
  }, {
    "id": "FRICTION",
    "kind": "number",
    "label": "Friction",
    "value": 0.85,
    "default": 0.85,
    "min": 0.7,
    "max": 0.98,
    "step": 0.01
  }, {
    "id": "POINTER_RADIUS",
    "kind": "number",
    "label": "Interaction Radius",
    "value": 150,
    "default": 150,
    "min": 50,
    "max": 300,
    "step": 10
  }, {
    "id": "REPULSE_STRENGTH",
    "kind": "number",
    "label": "Repulse Strength",
    "value": 5,
    "default": 5,
    "min": 1,
    "max": 20,
    "step": 1
  }, {
    "id": "SPIRAL_STRENGTH",
    "kind": "number",
    "label": "Spiral Strength",
    "value": 8,
    "default": 8,
    "min": 0,
    "max": 20,
    "step": 1
  }, {
    "id": "MAX_PARTICLES",
    "kind": "number",
    "label": "Max Particles Limit",
    "value": 6000,
    "default": 6000,
    "min": 1000,
    "max": 10000,
    "step": 500
  }],
  "texts": [{
    "id": "TXT_TITLE",
    "label": "App Title",
    "value": "Studio di particelle",
    "default": "Studio di particelle",
    "max_length": 20
  }, {
    "id": "TXT_SHOW_CTRL",
    "label": "Show Controls Btn",
    "value": "Controlli",
    "default": "Controlli",
    "max_length": 15
  }, {
    "id": "TXT_HIDE_CTRL",
    "label": "Hide Controls Btn",
    "value": "Nascondi",
    "default": "Nascondi",
    "max_length": 15
  }, {
    "id": "TXT_TAB_TEXT",
    "label": "Tab Text",
    "value": "Testo",
    "default": "Testo",
    "max_length": 10
  }, {
    "id": "TXT_TAB_MEDIA",
    "label": "Tab Media",
    "value": "Media",
    "default": "Media",
    "max_length": 10
  }, {
    "id": "TXT_INPUT_PLACEHOLDER",
    "label": "Input Placeholder",
    "value": "Scrivi qualcosa…",
    "default": "Scrivi qualcosa…",
    "max_length": 30
  }, {
    "id": "TXT_UPLOAD_BTN",
    "label": "Upload Button Text",
    "value": "Carica foto o video",
    "default": "Carica foto o video",
    "max_length": 30
  }, {
    "id": "TXT_DEFAULT_INPUT",
    "label": "Default Text Value",
    "value": "CIAO",
    "default": "CIAO",
    "max_length": 20
  }, {
    "id": "TXT_LBL_COLOR",
    "label": "Color Theme Label",
    "value": "Tema colori",
    "default": "Tema colori",
    "max_length": 20
  }, {
    "id": "TXT_LBL_SHAPE",
    "label": "Shape Label",
    "value": "Forma",
    "default": "Forma",
    "max_length": 20
  }, {
    "id": "TXT_LBL_FONT",
    "label": "Font Label",
    "value": "Carattere",
    "default": "Carattere",
    "max_length": 20
  }, {
    "id": "TXT_LBL_FILTER",
    "label": "Filter Label",
    "value": "Filtro",
    "default": "Filtro",
    "max_length": 20
  }],
  "images": [],
  "config_version": "2.0",
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "it",
    "min_capability_level": 1,
    "full_capability_level": 1
  }
};
let runtimeConfig = DEFAULT_CONFIG;
async function requestGameConfig() {
  let deadline;
  try {
    const request = fetch('./game.config.json', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .catch(() => null);
    const timeout = new Promise(resolve => {
      deadline = setTimeout(() => resolve(null), 1200);
    });
    const config = await Promise.race([request, timeout]);
    if (config && typeof config === 'object' && !Array.isArray(config)) runtimeConfig = config;
    return { ok: true, json: async () => runtimeConfig };
  } finally {
    clearTimeout(deadline);
  }
}
const GAME_STYLES = `
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; overscroll-behavior: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
    #root { isolation: isolate; }
    canvas { touch-action: none; }
    button, input, select, textarea { touch-action: manipulation; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .particle-guide{position:fixed!important;top:50%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(.particle-guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(.particle-guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(.particle-guide){animation:none!important}}

/* Italian copy keeps the approved role sizes and may wrap instead of clipping. */
html[lang="it"] :is(.meeting-guide,.feed-first-action,.melody-guide,.particle-guide,.dive-guide,.sandbox-guide,.koi-guide,.ui-guide,.bead-guide,.coloring-guide,.look-guide,.time-print-guide){white-space:normal;overflow-wrap:normal;word-break:normal;line-height:1.4}
html[lang="it"] :is(button,.btn,.btn-neon){overflow-wrap:normal;word-break:normal}
html[lang="it"] .melody-controls button{font-size:18px;padding-inline:12px}
html[lang="it"] .meeting-sand-ball-count{gap:6px!important}
html[lang="it"] #people-dialog fieldset label{min-width:0}
html[lang="it"] #people-dialog input{max-width:100%;min-width:0}
`;
const gameStyle = document.createElement('style');
gameStyle.textContent = GAME_STYLES;
document.head.append(gameStyle);
document.documentElement.lang = 'it';
var PARTICLE_DEFAULTS = {
  PARTICLE_DENSITY: 4,
  SPRING_FORCE: 0.05,
  FRICTION: 0.85,
  POINTER_RADIUS: 150,
  REPULSE_STRENGTH: 5,
  SPIRAL_STRENGTH: 8,
  MAX_PARTICLES: 6000,
  TXT_TITLE: "Studio di particelle",
  TXT_SHOW_CTRL: "Controlli",
  TXT_HIDE_CTRL: "Nascondi",
  TXT_TAB_TEXT: "Testo",
  TXT_TAB_MEDIA: "Media",
  TXT_INPUT_PLACEHOLDER: "Scrivi qualcosa…",
  TXT_UPLOAD_BTN: "Carica foto o video",
  TXT_LBL_COLOR: "Tema colori",
  TXT_LBL_SHAPE: "Forma",
  TXT_LBL_FONT: "Carattere",
  TXT_LBL_FILTER: "Filtro",
  OPT_THEME_ORIGINAL: "Original",
  OPT_THEME_RAINBOW: "Rainbow",
  OPT_THEME_COOL: "Cool Blue",
  OPT_THEME_WARM: "Warm Sun",
  OPT_THEME_GRAY: "Scala di grigi",
  OPT_THEME_VIBRANT: "Vibrant",
  OPT_THEME_CUSTOM: "Custom",
  OPT_SHAPE_CIRCLE: "Cerchio",
  OPT_SHAPE_SQUARE: "Quadrato",
  OPT_SHAPE_TRIANGLE: "Triangolo",
  OPT_FILTER_NONE: "Nessuno",
  OPT_FILTER_INVERT: "Negativo"
};
var FONT_OPTIONS = [{
  label: "Sans-Serif",
  value: "var(--font-body)"
}, {
  label: "Decorativo (Audiowide)",
  value: "var(--font-display)"
}, {
  label: "Monospaziato",
  value: "var(--font-mono)"
}, {
  label: "Con grazie",
  value: "Georgia, serif"
}, {
  label: "Calligrafico",
  value: "cursive"
}];
function readConfigValues(config) {
  let options = {
    ...PARTICLE_DEFAULTS
  };
  if (config) {
    (config.tweaks || []).forEach(item => {
      options[item.id] = item.value;
    });
    (config.texts || []).forEach(item => {
      options[item.id] = item.value;
    });
    (config.images || []).forEach(item => {
      options[item.id] = item.path;
    });
    (config.mentions || []).forEach(item => {
      options[item.id] = item.path != null && item.path !== "" ? item.path : item.value;
    });
    (config.motions || []).forEach(item => {
      if (!(!item || !item.id)) {
        if (item.base_path != null && item.base_path !== "") {
          options[item.id] = item.base_path;
          options[item.id + "_BASE"] = item.base_path;
        }
        if (item.frame_count != null) {
          options[item.id + "_COUNT"] = item.frame_count;
        }
      }
    });
  }
  return options;
}
function particleColor(theme, x, y, width, height, argument6, green, blue, customColor) {
  switch (theme) {
    case PARTICLE_DEFAULTS.OPT_THEME_ORIGINAL:
      return `rgb(${argument6}, ${green}, ${blue})`;
    case PARTICLE_DEFAULTS.OPT_THEME_RAINBOW:
      return `hsl(${(x / width * 360 + y / height * 180) % 360}, 80%, 60%)`;
    case PARTICLE_DEFAULTS.OPT_THEME_COOL:
      return `hsl(${200 + x / width * 40}, 90%, 65%)`;
    case PARTICLE_DEFAULTS.OPT_THEME_WARM:
      return `hsl(${30 + y / height * 40}, 100%, 55%)`;
    case PARTICLE_DEFAULTS.OPT_THEME_GRAY:
      let value = argument6 * 0.299 + green * 0.587 + blue * 0.114;
      return `rgb(${value}, ${value}, ${value})`;
    case PARTICLE_DEFAULTS.OPT_THEME_VIBRANT:
      return `hsl(${(argument6 + green + blue) % 360}, 100%, 50%)`;
    case PARTICLE_DEFAULTS.OPT_THEME_CUSTOM:
      return customColor || "#ffffff";
    default:
      return "#ffffff";
  }
}
var PARTICLE_SHAPES = [PARTICLE_DEFAULTS.OPT_SHAPE_CIRCLE, PARTICLE_DEFAULTS.OPT_SHAPE_SQUARE, PARTICLE_DEFAULTS.OPT_SHAPE_TRIANGLE];
var MEDIA_FILTERS = [PARTICLE_DEFAULTS.OPT_FILTER_NONE, PARTICLE_DEFAULTS.OPT_FILTER_INVERT];
function ParticleWorkbench({
  config: config,
  surfaceRef: surfaceRef,
  canvasRef: canvasRef,
  videoRef: videoRef,
  mediaType: mediaType,
  mediaUrl: mediaUrl,
  refreshMedia: refreshMedia,
  onPointerDown: onPointerDown,
  onPointerMove: onPointerMove,
  onPointerUp: onPointerUp,
  started: started,
  setStarted: setStarted,
  live: liveRef,
  panel: panel,
  setPanel: setPanel,
  contentMode: contentMode,
  setContentMode: setContentMode,
  text: text,
  setText: setText,
  theme: theme,
  setTheme: setTheme,
  customColor: customColor,
  setCustomColor: setCustomColor,
  particleShape: particleShape,
  setParticleShape: setParticleShape,
  fontFamily: fontFamily,
  setFontFamily: setFontFamily,
  textColor: textColor,
  setTextColor: setTextColor,
  filter: filter,
  setFilter: setFilter,
  density: density,
  setDensity: setDensity,
  upload: uploadInputRef,
  onFileChange: onFileChange,
  notice: notice,
  setNotice: setNotice,
  dimensionsRef: dimensionsRef,
  particlesRef: particlesRef,
  pointerRef: pointerRef
}) {
  const createElement = React.createElement;
  const paletteRef = React.useRef(null);
  const paletteDragRef = React.useRef(null);
  const suppressColorClickRef = React.useRef(false);
  React.useEffect(() => {
    const current = paletteRef.current;
    if (!current) return;
    const handleAction = event => {
      if (!(current.scrollWidth <= current.clientWidth)) {
        event.stopPropagation();
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.preventDefault();
          current.scrollLeft += event.deltaY;
        }
      }
    };
    current.addEventListener("wheel", handleAction, {
      passive: false
    });
    return () => current.removeEventListener("wheel", handleAction);
  }, [started]);
  const icons = {
    media: "M12 3v12m-4-8 4-4 4 4M5 13v7h14v-7",
    settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
    save: "M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5",
    close: "m6 6 12 12M6 18 18 6",
    text: "M5 4h14M12 4v16M8 20h8"
  };
  const renderIcon = value => <svg viewBox={"0 0 24 24"} width={22} height={22} fill={"none"} stroke={"currentColor"} strokeWidth={1.8} strokeLinecap={"round"} strokeLinejoin={"round"} aria-hidden={true}>{<path d={icons[value]} />}</svg>;
  const renderButton = (e, otherValue, onClick, value = {}) => <button type={"button"} aria-label={e} title={e} onClick={onClick} {...value}>{renderIcon(otherValue)}</button>;
  const renderField = (value, otherValue) => <label className={"particle-field"}>{<span>{value}</span>}{otherValue}</label>;
  const renderSelect = (e, value, argument3, argument4) => <select aria-label={e} value={value} onChange={y => argument3(y.target.value)}>{argument4.map(y => <option key={y.value ?? y} value={y.value ?? y}>{y.label ?? y}</option>)}</select>;
  const saveImage = async () => {
    try {
      const saved = await saveGameImage(canvasRef.current.toDataURL('image/png'), 'particle-art');
      setNotice(saved ? 'Immagine salvata.' : 'Anteprima immagine.');
    } catch {
      setNotice('Impossibile salvare l’immagine.');
    }
  };
  const handleKeyboard = event => {
    if (event.target !== event.currentTarget || ![" ", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    liveRef.current = true;
    setStarted(true);
    const item = {
      ArrowLeft: [-28, 0],
      ArrowRight: [28, 0],
      ArrowUp: [0, -28],
      ArrowDown: [0, 28]
    }[event.key];
    pointerRef.current.x = pointerRef.current.x < 0 ? dimensionsRef.current.width / 2 : pointerRef.current.x;
    pointerRef.current.y = pointerRef.current.y < 0 ? dimensionsRef.current.height / 2 : pointerRef.current.y;
    if (item) {
      pointerRef.current.x += item[0];
      pointerRef.current.y += item[1];
    }
    for (const particle of particlesRef.current) {
      const value = particle.x - pointerRef.current.x;
      const y = particle.y - pointerRef.current.y;
      const value2 = Math.hypot(value, y);
      if (value2 > 0 && value2 < config.POINTER_RADIUS) {
        particle.vx += value / value2 * 12;
        particle.vy += y / value2 * 12;
      }
    }
  };
  const renderSwatch = (value, c, p, O, y) => <button key={value} type={"button"} className={"particle-color"} aria-label={c} title={c} aria-pressed={O} style={{
    "--swatch": p
  }} onClick={event => {
    y();
    event.currentTarget.scrollIntoView({
      block: "nearest",
      inline: "nearest"
    });
  }}>{<span />}</button>;
  const themeOptions = [[PARTICLE_DEFAULTS.OPT_THEME_ORIGINAL, "Colori originali", "conic-gradient(#ff6978,#ffcf70,#7be4c0,#80bdff,#ff6978)"], [PARTICLE_DEFAULTS.OPT_THEME_RAINBOW, "Arcobaleno", "linear-gradient(135deg,#ff6978,#ffd36e,#7be4c0,#80bdff,#c5a2ff)"], [PARTICLE_DEFAULTS.OPT_THEME_COOL, "Toni freddi", "linear-gradient(135deg,#54daff,#7384ff)"], [PARTICLE_DEFAULTS.OPT_THEME_WARM, "Toni caldi", "linear-gradient(135deg,#ffe66b,#ff8e32)"], [PARTICLE_DEFAULTS.OPT_THEME_GRAY, "Scala di grigi", "linear-gradient(135deg,#fafafa,#555d73)"], [PARTICLE_DEFAULTS.OPT_THEME_VIBRANT, "Colori vivaci", "linear-gradient(135deg,#f95aff,#79f3ac)"]];
  const endPaletteDrag = event => {
    if (paletteDragRef.current?.id === event.pointerId) {
      paletteDragRef.current = null;
      event.currentTarget.dataset.dragging = "false";
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };
  return <div className={"particle-studio"} data-started={started} data-panel-open={!!panel}>{<style>{`
      @font-face{font-family:Audiowide;src:url('./assets/fonts/audiowide/Audiowide-Regular.woff2') format('woff2');font-display:swap}
      .particle-studio{box-sizing:border-box;position:relative;display:flex;flex-direction:column;gap:12px;width:100%;height:100%;padding:30px 30px 50px;overflow:hidden;background:#080c17;color:#f3f6ff;font:16px/1.4 system-ui,sans-serif;container-type:size}
      .particle-studio *{box-sizing:border-box}
      .particle-stage{position:relative;flex:1 1 0;min-height:0;min-width:0}
      .particle-stage canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;outline-offset:-4px}
      .particle-studio button,.particle-studio select,.particle-studio input{font:inherit;color:inherit}
      .particle-studio button{display:flex;align-items:center;justify-content:center;width:44px;height:44px;flex-shrink:0;border:1px solid #ffffff24;border-radius:14px;background:#202a42;cursor:pointer;touch-action:manipulation}
      .particle-studio button:active{background:#3d4f70}
      .particle-studio :focus-visible{outline:2px solid #b1c4ff;outline-offset:3px}
      .particle-guide{position:absolute;top:65%;left:0;right:0;margin:0;text-align:center;font-size:18px;color:#d3def2;pointer-events:none;animation:particle-guide-breathe 2.6s ease-in-out infinite}
      @keyframes particle-guide-breathe{50%{opacity:.7}}
      .particle-dock{position:relative;display:grid;gap:8px;flex:0 1 auto;min-height:104px;max-height:calc(100% - 76px);width:100%;max-width:500px;margin:0 auto;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#52617d transparent}
      .particle-row{display:flex;gap:8px;min-width:0;align-items:center}
      .particle-palette{display:flex;gap:8px;width:100%;min-width:0;overflow-x:auto;overflow-y:hidden;padding:4px 2px 7px;touch-action:pan-x;overscroll-behavior-x:contain;scrollbar-width:thin;scrollbar-color:#52617d transparent;cursor:grab}
      .particle-palette[data-dragging=true]{cursor:grabbing}
      .particle-text{min-width:0;width:100%;height:44px;padding:0 12px;border:1px solid #ffffff38;border-radius:14px;background:#141d30;outline:none}
      .particle-studio .particle-color{width:44px;height:44px;background:transparent;border:0;position:relative;touch-action:pan-x}
      .particle-color span{display:block;width:25px;height:25px;border-radius:50%;background:var(--swatch);pointer-events:none}
      .particle-color[aria-pressed=true] span,.particle-color[data-selected=true] span{outline:2px solid white;outline-offset:4px}
      .particle-custom{display:flex;align-items:center;justify-content:center;flex:0 0 44px;position:relative;cursor:pointer}
      .particle-custom:after{content:'+';position:absolute;font-size:20px;font-weight:700;color:white;text-shadow:0 1px 3px #000;pointer-events:none}
      .particle-custom input{position:absolute;inset:0;width:44px;height:44px;opacity:0;cursor:pointer}
      .particle-tools{position:relative;min-width:0;width:100%;background:#121b2d;border:1px solid #52617d80;border-radius:18px;padding:12px}
      .particle-tools header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;min-height:44px}
      .particle-tools header h2{font-size:16px;line-height:1.3;margin:0}
      .particle-tools header button{border:0;background:transparent}
      .particle-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 12px}
      .particle-field{display:grid;align-content:start;gap:5px;min-width:0;font-size:14px;color:#d3def2}
      .particle-field select{min-width:0;width:100%;height:44px;border:1px solid #52617d;border-radius:10px;background:#1e2941;padding:0 8px;font-size:15px}
      .particle-field input[type=range]{width:100%;height:44px;margin:0;accent-color:#b1c4ff;touch-action:pan-x}
      .particle-notice{position:absolute;top:0;left:0;right:0;margin:0;text-align:center;pointer-events:none;color:#fff}
      @media(max-height:480px){.particle-studio{padding:16px 24px 20px;gap:8px}.particle-tools{padding:8px 10px}.particle-fields{gap:6px 10px}}
      @media(prefers-reduced-motion:reduce){.particle-guide{animation:none}}
    `}</style>}{<video ref={videoRef} src={mediaType === "video" ? mediaUrl : null} loop={true} muted={true} autoPlay={true} playsInline={true} onLoadedData={refreshMedia} onError={() => setNotice("Impossibile aprire questa immagine.")} style={{
      display: "none"
    }} />}{<div ref={surfaceRef} className={"particle-stage"}>{<canvas ref={canvasRef} tabIndex={0} aria-label={"Trascina per disperdere le particelle. Puoi usare anche Spazio o le frecce."} onKeyDown={handleKeyboard} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onLostPointerCapture={onPointerUp} />}{!started && <p className={"particle-guide"}>{"Trascina sulle lettere"}</p>}{notice && <p role={"status"} className={"particle-notice"}>{notice}</p>}</div>}{<div className={"particle-dock"} aria-hidden={!started}>{started && <React.Fragment>{<div ref={paletteRef} className={"particle-palette"} aria-label={"Colori delle particelle"} tabIndex={0} onPointerDown={event => {
          suppressColorClickRef.current = false;
          if (event.pointerType === "mouse" && event.button === 0 && !event.target.closest("input")) {
            paletteDragRef.current = {
              id: event.pointerId,
              x: event.clientX,
              left: event.currentTarget.scrollLeft
            };
          }
        }} onPointerMove={event => {
          const current = paletteDragRef.current;
          if (!current || current.id !== event.pointerId) return;
          const value = event.clientX - current.x;
          if (Math.abs(value) > 5) {
            suppressColorClickRef.current = true;
            event.currentTarget.dataset.dragging = "true";
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }
          if (suppressColorClickRef.current) {
            event.currentTarget.scrollLeft = current.left - value;
          }
        }} onPointerUp={endPaletteDrag} onPointerCancel={endPaletteDrag} onLostPointerCapture={endPaletteDrag} onClickCapture={event => {
          if (suppressColorClickRef.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }} onKeyDown={event => {
          if (event.target === event.currentTarget && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            event.currentTarget.scrollLeft += event.key === "ArrowRight" ? 104 : -104;
          }
        }}>{["#ffffff", "#ff6978", "#ffcf70", "#7be4c0", "#80bdff"].map(item => renderSwatch(item, `Colore ${item}`, item, textColor === item && theme === PARTICLE_DEFAULTS.OPT_THEME_ORIGINAL, () => {
            setTextColor(item);
            setTheme(PARTICLE_DEFAULTS.OPT_THEME_ORIGINAL);
          }))}{themeOptions.map(([value, value2, value3]) => renderSwatch(value, value2, value3, theme === value && value !== PARTICLE_DEFAULTS.OPT_THEME_ORIGINAL, () => setTheme(value)))}{<label className={"particle-color particle-custom"} title={"Colore personalizzato"} data-selected={theme === PARTICLE_DEFAULTS.OPT_THEME_CUSTOM} style={{
            "--swatch": customColor
          }}>{<span />}{<input type={"color"} aria-label={"Colore personalizzato"} value={customColor} onChange={value => {
              setCustomColor(value.target.value);
              setTheme(PARTICLE_DEFAULTS.OPT_THEME_CUSTOM);
            }} />}</label>}</div>}{<div className={"particle-row"}>{contentMode === "text" ? <input className={"particle-text"} aria-label={"Testo delle particelle"} maxLength={20} value={text} placeholder={config.TXT_INPUT_PLACEHOLDER} onChange={value => setText(value.target.value)} /> : renderButton("Use text", "text", () => setContentMode("text"))}{null}{renderButton(panel ? "Chiudi le impostazioni" : "Impostazioni delle particelle", "settings", () => setPanel(panel ? null : "settings"), {
            "aria-expanded": !!panel,
            "aria-controls": "particle-settings"
          })}{renderButton("Salva PNG", "save", saveImage)}</div>}{null}{panel && <section id={"particle-settings"} className={"particle-tools"} aria-label={"Impostazioni delle particelle"} onKeyDown={event => {
          if (event.key === "Escape") {
            setPanel(null);
            canvasRef.current?.focus();
          }
        }}>{<header>{<h2>{"Make it yours"}</h2>}{renderButton("Chiudi le impostazioni", "close", () => {
              setPanel(null);
              canvasRef.current?.focus();
            })}</header>}{<div className={"particle-fields"}>{renderField("Particle shape", renderSelect("Particle shape", particleShape, setParticleShape, PARTICLE_SHAPES))}{renderField("Font", renderSelect("Font", fontFamily, setFontFamily, FONT_OPTIONS.map((item, index) => ({
              ...item,
              label: ["Senza grazie", "Decorativo", "Monospaziato", "Con grazie", "Calligrafico"][index] ?? item.label
            }))))}{renderField("Media filter", renderSelect("Media filter", filter, setFilter, MEDIA_FILTERS))}{renderField("Density", <input type={"range"} min={2} max={10} step={1} aria-label={"Densità delle particelle"} value={12 - (density ?? config.PARTICLE_DENSITY)} onChange={value => setDensity(12 - Number(value.target.value))} />)}</div>}</section>}</React.Fragment>}</div>}</div>;
}
function App() {
  let [config, setConfig] = React.useState(() => ({
    ...PARTICLE_DEFAULTS
  }));
  let [simulationEnabled, setSimulationEnabled] = React.useState(true);
  let [contentMode, setContentMode] = React.useState("text");
  let [text, setText] = React.useState("CIAO");
  let [mediaUrl, setMediaUrl] = React.useState(null);
  let [mediaType, setMediaType] = React.useState(null);
  let [theme, setTheme] = React.useState(PARTICLE_DEFAULTS.OPT_THEME_ORIGINAL);
  let [customColor, setCustomColor] = React.useState("#00ffcc");
  let [particleShape, setParticleShape] = React.useState(PARTICLE_DEFAULTS.OPT_SHAPE_CIRCLE);
  let [fontFamily, setFontFamily] = React.useState(FONT_OPTIONS[1].value);
  let [textColor, setTextColor] = React.useState("#ffffff");
  let [filter, setFilter] = React.useState(PARTICLE_DEFAULTS.OPT_FILTER_NONE);
  let canvasHostRef = React.useRef(null);
  let canvasRef = React.useRef(null);
  let samplingCanvasRef = React.useRef(document.createElement("canvas"));
  let imageRef = React.useRef(null);
  let videoRef = React.useRef(null);
  let particlesRef = React.useRef([]);
  let pointerRef = React.useRef({
    x: -1000,
    y: -1000,
    isDown: false,
    pointerId: null
  });
  let dimensionsRef = React.useRef({
    width: 0,
    height: 0,
    dpr: 1
  });
  let animationRef = React.useRef([]);
  const [started, setStarted] = React.useState(false);
  const [panel, setPanel] = React.useState(null);
  const [density, setDensity] = React.useState(null);
  const [notice, setNotice] = React.useState("");
  const liveRef = React.useRef(false);
  const uploadInputRef = React.useRef(null);
  const reducedMotionRef = React.useRef(matchMedia("(prefers-reduced-motion: reduce)").matches);
  React.useEffect(() => {
    const value = matchMedia("(prefers-reduced-motion: reduce)");
    const handleAction = () => {
      reducedMotionRef.current = value.matches;
    };
    value.addEventListener("change", handleAction);
    return () => value.removeEventListener("change", handleAction);
  }, []);
  React.useEffect(() => {
    if (!notice) return;
    const value = setTimeout(() => setNotice(""), 2500);
    return () => clearTimeout(value);
  }, [notice]);
  React.useEffect(() => () => {
    if (mediaUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(mediaUrl);
    }
  }, [mediaUrl]);
  React.useEffect(() => {
    let enabled = true;
    (async () => {
      let config2 = null;
      try {
        let value = await requestGameConfig();
        if (value.ok) {
          config2 = await value.json();
        }
      } catch {
        console.warn("Config load failed, using defaults");
      }
      if (enabled) {
        let configValues = readConfigValues(config2);
        if (setConfig(configValues), config2 && config2.texts) {
          let value = config2.texts.find(item => item.id === "TXT_DEFAULT_INPUT");
          if (value) {
            setText(value.value);
          }
        }
      }
    })();
    return () => {
      enabled = false;
    };
  }, []);
  let rebuildParticles = React.useCallback(() => {
    if (!config) return;
    let {
      width: current,
      height: current2
    } = dimensionsRef.current;
    if (current === 0 || current2 === 0) return;
    const dimensions = {
      left: 12,
      top: 10,
      width: Math.max(1, current - 24),
      height: Math.max(1, current2 - 20)
    };
    let dimensions2 = samplingCanvasRef.current;
    let context = dimensions2.getContext("2d", {
      willReadFrequently: true
    });
    let x = 1;
    dimensions2.width = current * x;
    dimensions2.height = current2 * x;
    context.clearRect(0, 0, dimensions2.width, dimensions2.height);
    context.textBaseline = "middle";
    context.textAlign = "center";
    let enabled = false;
    if (contentMode === "text" && text) {
      context.fillStyle = textColor;
      let value2 = Math.min(current, current2) * 0.27;
      let value3 = fontFamily === "var(--font-display)" ? "Audiowide, sans-serif" : fontFamily === "var(--font-body)" ? "system-ui, sans-serif" : fontFamily === "var(--font-mono)" ? "ui-monospace, monospace" : fontFamily;
      context.font = `bold ${value2}px ${value3}`;
      let value4 = context.measureText(text);
      if (value4.width > dimensions.width * 0.95) {
        value2 = value2 * (dimensions.width * 0.95 / value4.width);
        context.font = `bold ${value2}px ${value3}`;
      }
      context.fillText(text, dimensions.left + dimensions.width / 2, dimensions.top + dimensions.height / 2);
      enabled = true;
    } else if (contentMode === "media" && mediaUrl) {
      let dimensions3 = null;
      if (mediaType === "image") {
        let __particleLoadedImage = window.__particleLoadedImage;
        if (!__particleLoadedImage || __particleLoadedImage.src !== mediaUrl) {
          __particleLoadedImage = new Image();
          __particleLoadedImage.onload = () => rebuildParticles();
          __particleLoadedImage.src = mediaUrl;
          window.__particleLoadedImage = __particleLoadedImage;
        }
        if (__particleLoadedImage.complete && __particleLoadedImage.naturalWidth > 0) {
          dimensions3 = __particleLoadedImage;
        }
      } else {
        if (mediaType === "video" && imageRef.current && imageRef.current.readyState >= 2) {
          dimensions3 = imageRef.current;
        }
      }
      if (dimensions3) {
        let value2 = dimensions3.videoWidth ? dimensions3.videoWidth / dimensions3.videoHeight : dimensions3.width / dimensions3.height;
        let width = dimensions.width;
        let height = dimensions.height;
        let value3 = width / height;
        let value4 = width;
        let value5 = height;
        let left = dimensions.left;
        let value6 = dimensions.top;
        if (value2 > value3) {
          value5 = width / value2;
          value6 = dimensions.top + (height - value5) / 2;
        } else {
          value4 = height * value2;
          left = dimensions.left + (width - value4) / 2;
        }
        if (filter === PARTICLE_DEFAULTS.OPT_FILTER_INVERT) {
          context.filter = "invert(1)";
        } else {
          context.filter = "none";
        }
        context.drawImage(dimensions3, left, value6, value4, value5);
        context.filter = "none";
        enabled = true;
      }
    }
    let items = [];
    if (enabled) try {
      let data = context.getImageData(0, 0, dimensions2.width, dimensions2.height).data;
      let value2 = density ?? config.PARTICLE_DENSITY;
      for (let value3 = 0; value3 < dimensions2.height; value3 += value2) for (let value4 = 0; value4 < dimensions2.width; value4 += value2) {
        let value5 = (value3 * dimensions2.width + value4) * 4;
        if (data[value5 + 3] > 50) {
          items.push({
            tx: value4 / x,
            ty: value3 / x,
            r: data[value5],
            g: data[value5 + 1],
            b: data[value5 + 2]
          });
        }
      }
    } catch {
      console.warn("Canvas cross-origin tainted or read error");
    }
    if (items.length > 0) {
      for (let value2 = items.length - 1; value2 > 0; value2--) {
        let value3 = Math.floor(Math.random() * (value2 + 1));
        [items[value2], items[value3]] = [items[value3], items[value2]];
      }
      animationRef.current = items;
    } else animationRef.current = [];
    let current3 = particlesRef.current;
    let value = Math.min(config.MAX_PARTICLES, animationRef.current.length);
    for (let value2 = 0; value2 < value; value2++) {
      let color = animationRef.current[value2];
      let color2 = particleColor(theme, color.tx, color.ty, current, current2, color.r, color.g, color.b, customColor);
      if (value2 < current3.length) {
        current3[value2].tx = color.tx;
        current3[value2].ty = color.ty;
        current3[value2].color = color2;
        current3[value2].active = true;
      } else {
        let value3 = Math.random() * Math.PI * 2;
        let value4 = Math.max(current, current2) * (0.5 + Math.random() * 0.5);
        current3.push({
          x: color.tx + (reducedMotionRef.current ? 0 : Math.cos(value3) * 8),
          y: color.ty + (reducedMotionRef.current ? 0 : Math.sin(value3) * 8),
          vx: 0,
          vy: 0,
          tx: color.tx,
          ty: color.ty,
          color: color2,
          size: Math.random() * 1.5 + 1,
          active: true
        });
      }
    }
    for (let value2 = value; value2 < current3.length; value2++) current3[value2].active = false;
  }, [config, contentMode, text, mediaUrl, mediaType, theme, customColor, particleShape, fontFamily, textColor, filter, simulationEnabled, density]);
  React.useEffect(() => {
    let enabled = false;
    document.fonts.ready.then(() => {
      if (!enabled) {
        rebuildParticles();
      }
    });
    return () => {
      enabled = true;
    };
  }, [rebuildParticles]);
  React.useEffect(() => {
    if (!config || !canvasHostRef.current) return;
    let resizeObserver = observeGameSize(value => {
      for (let value2 of value) {
        let {
          clientWidth: width,
          clientHeight: height
        } = value2.target;
        if (width > 0 && height > 0) {
          let x = window.devicePixelRatio || 1;
          dimensionsRef.current = {
            width: width,
            height: height,
            dpr: x
          };
          if (canvasRef.current) {
            canvasRef.current.width = width * x;
            canvasRef.current.height = height * x;
            canvasRef.current.getContext("2d").scale(x, x);
          }
          rebuildParticles();
        }
      }
    });
    resizeObserver.observe(canvasHostRef.current);
    return () => resizeObserver.disconnect();
  }, [config, rebuildParticles]);
  React.useEffect(() => {
    if (contentMode !== "media" || mediaType !== "video") {
      rebuildParticles();
    }
  }, [rebuildParticles, contentMode, mediaType]);
  let refreshMedia = React.useCallback(() => {
    rebuildParticles();
  }, [rebuildParticles]);
  React.useEffect(() => {
    if (!config) return;
    let canvas = canvasRef.current;
    if (!canvas) return;
    let context = canvas.getContext("2d", {
      alpha: false
    });
    let timestamp = performance.now();
    let value = 0;
    let value2 = 0;
    let x = value3 => {
      videoRef.current = requestAnimationFrame(x);
      let value4 = Math.max(0, Math.min(value3 - timestamp, 64));
      if (timestamp = value3, document.hidden) {
        value2 = 0;
        return;
      }
      value2 += value4;
      const value5 = Math.min(4, Math.floor((value2 + 1e-7) / (1000 / 60)));
      value2 = Math.max(0, value2 - value5 * (1000 / 60));
      let {
        width: current,
        height: current2
      } = dimensionsRef.current;
      if (current === 0) return;
      if (contentMode === "media" && mediaType === "video" && imageRef.current && !imageRef.current.paused) {
        value += value4;
        if (value > 1000 / 15) {
          rebuildParticles();
          value = 0;
        }
      }
      context.fillStyle = "#080c17";
      context.fillRect(0, 0, current, current2);
      context.globalCompositeOperation = "lighter";
      let current3 = particlesRef.current;
      let value6 = !liveRef.current && !reducedMotionRef.current;
      let value7 = value3 % 5600 / 5600;
      let point = value6 ? {
        isDown: value7 > 0.25 && value7 < 0.7,
        x: current * (0.15 + 0.7 * value7),
        y: current2 / 2 + Math.sin(value7 * Math.PI * 2) * 20
      } : pointerRef.current;
      let SPRING_FORCE = config.SPRING_FORCE;
      let FRICTION = config.FRICTION;
      let value8 = value6 ? Math.min(80, config.POINTER_RADIUS) : config.POINTER_RADIUS;
      let REPULSE_STRENGTH = config.REPULSE_STRENGTH;
      let z = config.SPIRAL_STRENGTH;
      for (let value9 = 0; value9 < current3.length; value9++) {
        let particle = current3[value9];
        if (!particle.active) continue;
        for (let value10 = 0; value10 < value5; value10++) {
          let value11 = (particle.tx - particle.x) * SPRING_FORCE;
          let value12 = (particle.ty - particle.y) * SPRING_FORCE;
          if (point.isDown) {
            let value13 = particle.x - point.x;
            let value14 = particle.y - point.y;
            let value15 = value13 * value13 + value14 * value14;
            let value16 = value8 * value8;
            if (value15 < value16 && value15 > 0.1) {
              let value17 = Math.sqrt(value15);
              let value18 = (value8 - value17) / value8;
              let value19 = Math.atan2(value14, value13);
              value11 += Math.cos(value19) * value18 * REPULSE_STRENGTH;
              value12 += Math.sin(value19) * value18 * REPULSE_STRENGTH;
              value11 += Math.cos(value19 + Math.PI / 2) * value18 * z;
              value12 += Math.sin(value19 + Math.PI / 2) * value18 * z;
            }
          }
          particle.vx += value11;
          particle.vy += value12;
          particle.vx *= FRICTION;
          particle.vy *= FRICTION;
          particle.x += particle.vx;
          particle.y += particle.vy;
        }
        context.fillStyle = particle.color;
        let size = particle.size;
        if (particleShape === PARTICLE_DEFAULTS.OPT_SHAPE_CIRCLE) {
          context.beginPath();
          context.arc(particle.x, particle.y, size, 0, Math.PI * 2);
          context.fill();
        } else {
          if (particleShape === PARTICLE_DEFAULTS.OPT_SHAPE_SQUARE) {
            context.fillRect(particle.x - size, particle.y - size, size * 2, size * 2);
          } else {
            if (particleShape === PARTICLE_DEFAULTS.OPT_SHAPE_TRIANGLE) {
              context.beginPath();
              context.moveTo(particle.x, particle.y - size * 1.5);
              context.lineTo(particle.x + size * 1.2, particle.y + size);
              context.lineTo(particle.x - size * 1.2, particle.y + size);
              context.fill();
            }
          }
        }
      }
      context.globalCompositeOperation = "source-over";
    };
    videoRef.current = requestAnimationFrame(x);
    return () => cancelAnimationFrame(videoRef.current);
  }, [config, particleShape, rebuildParticles, contentMode, mediaType]);
  React.useEffect(() => {
    const handleAction = () => {
      const pointerId = pointerRef.current.pointerId;
      pointerRef.current.isDown = false;
      pointerRef.current.pointerId = null;
      if (pointerId !== null && canvasRef.current?.hasPointerCapture?.(pointerId)) {
        canvasRef.current.releasePointerCapture(pointerId);
      }
    };
    const handleAction2 = () => {
      if (document.hidden) {
        handleAction();
      }
    };
    window.addEventListener("blur", handleAction);
    document.addEventListener("visibilitychange", handleAction2);
    return () => {
      handleAction();
      window.removeEventListener("blur", handleAction);
      document.removeEventListener("visibilitychange", handleAction2);
    };
  }, []);
  let updatePointer = event => {
    if (!canvasRef.current) return;
    let dimensions = canvasRef.current.getBoundingClientRect();
    pointerRef.current.x = (event.clientX - dimensions.left) * dimensionsRef.current.width / dimensions.width;
    pointerRef.current.y = (event.clientY - dimensions.top) * dimensionsRef.current.height / dimensions.height;
  };
  return <ParticleWorkbench config={config} surfaceRef={canvasHostRef} canvasRef={canvasRef} videoRef={imageRef} mediaType={mediaType} mediaUrl={mediaUrl} refreshMedia={refreshMedia} onPointerDown={event => {
    if (event.isPrimary !== false && !(event.button > 0) && pointerRef.current.pointerId === null) {
      liveRef.current = true;
      setStarted(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      pointerRef.current.pointerId = event.pointerId;
      pointerRef.current.isDown = true;
      updatePointer(event);
    }
  }} onPointerMove={event => {
    if (pointerRef.current.isDown && pointerRef.current.pointerId === event.pointerId) {
      updatePointer(event);
    }
  }} onPointerUp={event => {
    if (pointerRef.current.pointerId === event.pointerId) {
      pointerRef.current.isDown = false;
      pointerRef.current.pointerId = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }} started={started} setStarted={setStarted} live={liveRef} panel={panel} setPanel={setPanel} contentMode={contentMode} setContentMode={setContentMode} text={text} setText={setText} theme={theme} setTheme={setTheme} customColor={customColor} setCustomColor={setCustomColor} particleShape={particleShape} setParticleShape={setParticleShape} fontFamily={fontFamily} setFontFamily={setFontFamily} textColor={textColor} setTextColor={setTextColor} filter={filter} setFilter={setFilter} density={density} setDensity={setDensity} upload={uploadInputRef} onFileChange={() => {}} notice={notice} setNotice={setNotice} dimensionsRef={dimensionsRef} particlesRef={particlesRef} pointerRef={pointerRef} />;
}

// ./guide-breathing.js
/* Decorative guide visibility only: no inputs, timers, sound or game state. */
(() => {
  const root = document.documentElement;
  let intersecting = true;
  const update = () => root.toggleAttribute('data-guide-breathing-paused', document.hidden || !intersecting);
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    intersecting = entries.some(entry => entry.isIntersecting);
    update();
  }) : null;
  if (document.body) observer?.observe(document.body);
  document.addEventListener('visibilitychange', update);
  update();
  window.addEventListener('pagehide', () => {
    observer?.disconnect();
    document.removeEventListener('visibilitychange', update);
  }, {
    once: true
  });
})();
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// ./feed-entry-motion.js
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';

  const script = {
    getAttribute(name) {
      return {
        "data-subject": "#root canvas",
        "data-game": ""
      }[name] ?? null;
    },
    dataset: {
      game: ""
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
  const selectors = [".particle-guide"];
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
      for (const value of running.values()) value.cancel();
      running.clear();
      return;
    }
    const targets = new Set();
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(item => targets.add(item));
      } catch {}
    }
    for (const value of document.querySelectorAll('p,span,div,label,text')) {
      if (value.children.length || value.closest('button,a,input,select,textarea,[role="button"]')) continue;
      const text = (value.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 5 && text.length <= 140 && (copy.has(text.toLowerCase()) || !selectors.length && action.test(text))) targets.add(value);
    }
    for (const value of targets) {
      if (running.has(value) || typeof value.animate !== 'function') continue;
      if ([...targets].some(child => child !== value && value.contains(child))) continue;
      const style = getComputedStyle(value);
      if (/breath/i.test(style.animationName)) continue;
      const base = style.filter.replace(/opacity\([^)]*\)/g, '').replace(/^none$/, '').trim();
      const filter = value3 => (base ? base + ' ' : '') + 'opacity(' + value3 + ')';
      const value2 = value.animate([{
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
      running.set(value, value2);
      if (document.hidden || !visible) value2.pause();
    }
  }
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  };
  const pause = () => {
    for (const value of running.values()) {
      if (document.hidden || !visible) {
        value.pause();
      } else {
        value.play();
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
    for (const value of running.values()) value.cancel();
    running.clear();
  }, {
    once: true
  });
})();
function saveGameImage(dataURL, filename, extension = 'png') {
  return new Promise(resolve => {
    if (window.tt && typeof window.tt.saveDataURL === 'function') {
      window.tt.saveDataURL({
        dataURL,
        filename,
        extension,
        saveToAlbum: 'image',
        success() {
          resolve(true);
        },
        fail(error) {
          console.warn('Image save failed', error);
          resolve(false);
        },
        complete() {}
      });
      return;
    }
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'padding:16px;border:0;border-radius:18px;background:#fff;color:#222;max-width:90vw;max-height:90vh';
    const image = document.createElement('img');
    image.src = dataURL;
    image.alt = 'Immagine creata';
    image.style.cssText = 'display:block;max-width:76vw;max-height:65vh;object-fit:contain';
    const label = document.createElement('p');
    label.textContent = 'Tieni premuta l’immagine per salvarla.';
    const close = document.createElement('button');
    close.textContent = 'Chiudi';
    close.style.cssText = 'min-height:44px;padding:8px 20px';
    close.onclick = () => {
      dialog.close();
      dialog.remove();
      resolve(false);
    };
    dialog.append(image, label, close);
    document.body.append(dialog);
    dialog.showModal();
  });
}
