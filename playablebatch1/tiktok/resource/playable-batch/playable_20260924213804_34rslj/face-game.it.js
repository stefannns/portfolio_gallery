function computeGroupPlacements({ bounds, slots }) {
  const validBounds = bounds.filter(Boolean);
  if (validBounds.length === 0) return bounds.map(() => null);

  const maxWidth = Math.max(...validBounds.map((item) => item.width));
  const maxHeight = Math.max(...validBounds.map((item) => item.height));

  return bounds.map((item, index) => {
    if (!item) return null;
    const slot = slots[index] || slots[0];
    const scale = Math.min(slot.width / maxWidth, slot.height / maxHeight);
    const width = item.width * scale;
    const height = item.height * scale;
    const centerX = slot.x + slot.width / 2;
    const centerY = slot.y + slot.height / 2;
    const left = centerX - width / 2;
    const top = centerY - height / 2;

    return {
      sourceX: item.x,
      sourceY: item.y,
      sourceWidth: item.width,
      sourceHeight: item.height,
      left,
      top,
      width,
      height,
      centerX,
      centerY,
      right: left + width,
      bottom: top + height
    };
  });
}

(() => {
  "use strict";

  const SIZE = 900;
  const STEP_COUNT = 7;
  const FEATURE_SLOTS = {
    eyes: { x: 170, y: 230, width: 560, height: 170 },
    nose: { x: 330, y: 420, width: 240, height: 140 },
    mouth: { x: 260, y: 590, width: 380, height: 160 }
  };
  const FALLBACK = {
    BRUSH_SIZE: 4,
    BTN_CLEAR: "CANCELLA",
    BTN_NEXT: "AVANTI",
    BTN_FINISH: "FATTO",
    BTN_BLINK: "AMMICCA",
    BTN_SNIFF: "ANNUSA",
    BTN_TALK: "PARLA",
    BTN_AGAIN: "RIDISEGNA",
    TXT_STEP: "FASE",
    TXT_OF: "DI",
    MSG_DONE: "IL TUO VISO!",
    PROMPT_1: "Disegna gli occhi aperti",
    PROMPT_2: "Disegna gli occhi chiusi",
    PROMPT_3: "Disegna un naso",
    PROMPT_4: "Disegna un naso piccolo",
    PROMPT_5: "Disegna la bocca aperta",
    PROMPT_6: "Disegna la bocca socchiusa",
    PROMPT_7: "Disegna la bocca chiusa"
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function readConfig(config) {
    const values = { ...FALLBACK };
    ["tweaks", "texts"].forEach((section) => {
      (config[section] || []).forEach((item) => {
        if (item && item.id) values[item.id] = item.value;
      });
    });
    return values;
  }

  function makeLayer() {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    return canvas;
  }

  async function boot() {
    let config = {};
    const inlineConfig = document.getElementById("playable-inline-config");
    if (window.location.protocol === "file:" && inlineConfig) {
      try {
        config = JSON.parse(inlineConfig.textContent);
      } catch (_) {}
    } else {
      try {
        const response = await fetch("./game.config.it.json?l10n=dd5a1011047b", { cache: "no-store" });
        if (response.ok) config = await response.json();
      } catch (_) {
        if (inlineConfig) {
          try {
            config = JSON.parse(inlineConfig.textContent);
          } catch (_) {}
        }
      }
    }
    mount(readConfig(config));
  }

  function mount(copy) {
    const root = document.getElementById("root");
    root.innerHTML = `
      <style>
        @font-face { font-family: Poppins; src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2'); font-weight: 400; font-display: swap; }
        @font-face { font-family: Poppins; src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2'); font-weight: 700; font-display: swap; }
        :root { --paper: #fdf8ea; --ink: #303035; --purple: #6c5ce7; --green: #08b894; --red: #dc3035; --guide: #d7cfbc; }
        * { box-sizing: border-box; }
        button { font: 700 clamp(14px, 3.8vw, 18px)/1.2 Poppins, sans-serif; border: 0; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
        .face-game { width: 100%; height: 100%; min-height: 0; overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: var(--paper); color: var(--ink); font-family: Poppins, sans-serif; }
        .face-game__header { padding: calc(30px + env(safe-area-inset-top)) 30px 12px; text-align: center; }
        .face-game__step { margin: 0 0 5px; font-size: 28px; letter-spacing: 0; line-height: 1.2; color: #736e64; }
        .face-game__prompt { margin: 0; max-width: 100%; font-size: clamp(19px, 5.4vw, 30px); line-height: 1.15; overflow-wrap: anywhere; }
        .face-game__workspace { min-height: 0; display: grid; place-items: center; padding: 4px 30px 12px; overflow: hidden; container-type: size; }
        .face-game__canvas-wrap { position: relative; width: min(100%, calc(100vh - 280px), 560px); max-width: 100%; max-height: 100%; aspect-ratio: 1; border: 2px dashed var(--guide); border-radius: 22px; overflow: hidden; background: rgba(255,255,255,.08); touch-action: none; }
        .face-game canvas { display: block; width: 100%; height: 100%; }
        #draw-canvas { cursor: crosshair; touch-action: none; }
        .face-game__toolbar { width: min(calc(100% - 60px), 560px); min-height: calc(112px + env(safe-area-inset-bottom)); margin: 0 auto; padding: 8px 0 calc(50px + env(safe-area-inset-bottom)); display: grid; grid-template-columns: minmax(105px,.72fr) 1.28fr; gap: 14px; }
        .face-game__button { min-height: 54px; border-radius: 14px; padding: 11px 18px; box-shadow: 0 7px 17px rgba(54,46,36,.12); transition: transform .12s ease, filter .12s ease; white-space: normal; overflow-wrap: anywhere; }
        .face-game__button:active { transform: translateY(2px) scale(.985); filter: brightness(.96); }
        .face-game__button:disabled { cursor: default; opacity: .42; transform: none; filter: none; }
        .face-game__button--clear { color: var(--ink); background: #fff; border: 2px solid var(--ink); box-shadow: none; }
        .face-game__button--next { color: #fff; background: var(--purple); }
        .face-game__result-title { margin: 0; max-width: 100%; font-size: clamp(24px, 6vw, 34px); line-height: 1.1; overflow-wrap: anywhere; }
        .face-game__result-wrap { position: relative; width: min(100%, calc(100vh - 270px), 620px); max-width: 100%; max-height: 100%; aspect-ratio: 1; }
        .face-game__actions { width: min(calc(100% - 60px), 700px); margin: 0 auto; padding: 10px 0 calc(50px + env(safe-area-inset-bottom)); }
        .face-game__action-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .face-game__action { min-height: clamp(56px, 12vw, 76px); color: #fff; border-radius: 14px; box-shadow: 0 9px 20px rgba(55,45,35,.15); }
        .face-game__action--blink { background: var(--purple); }
        .face-game__action--sniff { background: var(--green); }
        .face-game__action--talk { background: var(--red); }
        .face-game__again { display: block; margin: 13px auto 0; padding: 4px 12px; color: #817c70; background: transparent; text-decoration: underline; box-shadow: none; font-weight: 400; }
        [hidden] { display: none !important; }
        @supports (width: 1cqh) {
          .face-game__canvas-wrap, .face-game__result-wrap { width: min(100%, 100cqh, 620px); }
          .face-game__canvas-wrap { max-width: 560px; }
        }
        @media (max-height: 600px) {
          .face-game__header { padding-bottom: 8px; }
          .face-game__button { min-height: 50px; }
          .face-game__action-row { gap: 8px; }
        }
      </style>
      <main class="face-game">
        <header class="face-game__header" id="draw-header">
          <p class="face-game__step" id="step-label"></p>
          <h1 class="face-game__prompt" id="prompt-label"></h1>
        </header>
        <header class="face-game__header" id="result-header" hidden>
          <h1 class="face-game__result-title" id="result-title"></h1>
        </header>
        <section class="face-game__workspace" id="draw-workspace">
          <div class="face-game__canvas-wrap"><canvas id="draw-canvas" width="${SIZE}" height="${SIZE}" aria-label="Drawing canvas"></canvas></div>
        </section>
        <section class="face-game__workspace" id="result-workspace" hidden>
          <div class="face-game__result-wrap"><canvas id="result-canvas" width="${SIZE}" height="${SIZE}" aria-label="Your animated face"></canvas></div>
        </section>
        <footer class="face-game__toolbar" id="draw-toolbar">
          <button class="face-game__button face-game__button--clear" id="clear-button"></button>
          <button class="face-game__button face-game__button--next" id="next-button"></button>
        </footer>
        <footer class="face-game__actions" id="result-actions" hidden>
          <div class="face-game__action-row">
            <button class="face-game__button face-game__action face-game__action--blink" data-action="blink"></button>
            <button class="face-game__button face-game__action face-game__action--sniff" data-action="sniff"></button>
            <button class="face-game__button face-game__action face-game__action--talk" data-action="talk"></button>
          </div>
          <button class="face-game__again" id="again-button"></button>
        </footer>
      </main>`;

    const layers = Array.from({ length: STEP_COUNT }, makeLayer);
    const drawCanvas = root.querySelector("#draw-canvas");
    const drawContext = drawCanvas.getContext("2d");
    const resultCanvas = root.querySelector("#result-canvas");
    const resultContext = resultCanvas.getContext("2d");
    const stepLabel = root.querySelector("#step-label");
    const promptLabel = root.querySelector("#prompt-label");
    const nextButton = root.querySelector("#next-button");
    const clearButton = root.querySelector("#clear-button");
    const resultTitle = root.querySelector("#result-title");
    const againButton = root.querySelector("#again-button");
    const actionButtons = Array.from(root.querySelectorAll("[data-action]"));
    const hasInk = Array(STEP_COUNT).fill(false);
    let step = 0;
    let drawing = false;
    let lastPoint = null;
    let animationToken = 0;
    let audioContext = null;
    let resultParts = { eyes: 0, nose: 2, mouth: 6 };
    let placementCache = null;

    const actionCopy = {
      blink: copy.BTN_BLINK,
      sniff: copy.BTN_SNIFF,
      talk: copy.BTN_TALK
    };
    actionButtons.forEach((button) => {
      button.textContent = actionCopy[button.dataset.action] || button.dataset.action.toUpperCase();
    });
    againButton.textContent = copy.BTN_AGAIN;

    function ensureAudio() {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return null;
        if (!audioContext) audioContext = new AudioContext();
        if (audioContext.state === "suspended") audioContext.resume();
        return audioContext;
      } catch (_) {
        return null;
      }
    }

    function playTone(frequency, duration, delay = 0, type = "sine") {
      const context = ensureAudio();
      if (!context) return;
      const start = context.currentTime + delay;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.055, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.015);
    }

    function feedback(kind) {
      const patterns = {
        draw: [[420, 0.035]],
        clear: [[180, 0.08]],
        next: [[520, 0.06], [660, 0.08, 0.055]],
        success: [[523, 0.12], [659, 0.12, 0.08], [784, 0.16, 0.16]],
        blink: [[700, 0.06]],
        sniff: [[300, 0.06], [380, 0.08, 0.07]],
        talk: [[220, 0.06], [280, 0.06, 0.06], [340, 0.08, 0.12]],
        again: [[440, 0.08]]
      };
      (patterns[kind] || []).forEach(([frequency, duration, delay = 0]) => {
        playTone(frequency, duration, delay, kind === "clear" ? "triangle" : "sine");
      });
      try {
        if (window.tt && typeof window.tt.vibrate === "function") window.tt.vibrate({ style: "light" });
        else if (navigator.vibrate) navigator.vibrate(kind === "success" ? [12, 30, 16] : 8);
      } catch (_) {}
    }

    function renderDrawing() {
      drawContext.clearRect(0, 0, SIZE, SIZE);
      drawContext.globalAlpha = 1;
      drawContext.drawImage(layers[step], 0, 0);
    }

    function getInkBounds(layer) {
      const pixels = layer.getContext("2d").getImageData(0, 0, SIZE, SIZE).data;
      let minX = SIZE;
      let minY = SIZE;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          if (pixels[(y * SIZE + x) * 4 + 3] < 8) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }

      if (maxX < minX || maxY < minY) return null;
      const padding = 8;
      const x = Math.max(0, minX - padding);
      const y = Math.max(0, minY - padding);
      const right = Math.min(SIZE, maxX + padding + 1);
      const bottom = Math.min(SIZE, maxY + padding + 1);
      return { x, y, width: right - x, height: bottom - y };
    }

    function buildPlacementCache() {
      const groups = {
        eyes: [0, 1],
        nose: [2, 3],
        mouth: [4, 5, 6]
      };
      const cache = {};

      Object.entries(groups).forEach(([groupName, indexes]) => {
        const slot = FEATURE_SLOTS[groupName];
        const bounds = indexes.map((index) => getInkBounds(layers[index]));
        const placements = computeGroupPlacements({
          bounds,
          slots: indexes.map(() => slot)
        });
        indexes.forEach((layerIndex, placementIndex) => {
          cache[layerIndex] = placements[placementIndex];
        });
      });

      return cache;
    }

    function drawPlacedLayer(layerIndex) {
      const placement = placementCache && placementCache[layerIndex];
      if (!placement) return;
      resultContext.drawImage(
        layers[layerIndex],
        placement.sourceX,
        placement.sourceY,
        placement.sourceWidth,
        placement.sourceHeight,
        placement.left,
        placement.top,
        placement.width,
        placement.height
      );
    }

    function renderResult() {
      resultContext.clearRect(0, 0, SIZE, SIZE);
      resultContext.globalAlpha = 1;
      drawPlacedLayer(resultParts.eyes);
      drawPlacedLayer(resultParts.nose);
      drawPlacedLayer(resultParts.mouth);
    }

    function updateNextAvailability() {
      nextButton.disabled = !hasInk[step];
      nextButton.setAttribute("aria-disabled", String(nextButton.disabled));
      clearButton.hidden = !hasInk[step];
      nextButton.hidden = !hasInk[step];
    }

    function updateStep() {
      stepLabel.textContent = `${step + 1}/${STEP_COUNT}`;
      promptLabel.textContent = copy[`PROMPT_${step + 1}`] || FALLBACK[`PROMPT_${step + 1}`];
      nextButton.textContent = step === STEP_COUNT - 1 ? copy.BTN_FINISH : copy.BTN_NEXT;
      updateNextAvailability();
      renderDrawing();
    }

    function pointFromEvent(event) {
      const rect = drawCanvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * SIZE / rect.width,
        y: (event.clientY - rect.top) * SIZE / rect.height
      };
    }

    drawCanvas.addEventListener("pointerdown", (event) => {
      if (event.isPrimary === false || event.button > 0) return;
      window.PlayableEntryPreview?.stop();
      event.preventDefault();
      drawCanvas.setPointerCapture(event.pointerId);
      drawing = true;
      lastPoint = pointFromEvent(event);
      const context = layers[step].getContext("2d");
      const brushWidth = Math.max(2, Number(copy.BRUSH_SIZE) || 4) * 2.1;
      context.beginPath();
      context.arc(lastPoint.x, lastPoint.y, brushWidth / 2, 0, Math.PI * 2);
      context.fillStyle = "#303035";
      context.fill();
      hasInk[step] = true;
      updateNextAvailability();
      renderDrawing();
      feedback("draw");
    });

    drawCanvas.addEventListener("pointermove", (event) => {
      if (!drawing || !event.isPrimary) return;
      event.preventDefault();
      const current = pointFromEvent(event);
      const context = layers[step].getContext("2d");
      context.beginPath();
      context.moveTo(lastPoint.x, lastPoint.y);
      context.lineTo(current.x, current.y);
      context.strokeStyle = "#303035";
      context.lineWidth = Math.max(2, Number(copy.BRUSH_SIZE) || 4) * 2.1;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();
      hasInk[step] = true;
      lastPoint = current;
      renderDrawing();
    });

    function endStroke(event) {
      if (!drawing || !event.isPrimary) return;
      drawing = false;
      lastPoint = null;
      if (drawCanvas.hasPointerCapture(event.pointerId)) drawCanvas.releasePointerCapture(event.pointerId);
    }
    drawCanvas.addEventListener("pointerup", endStroke);
    drawCanvas.addEventListener("pointercancel", endStroke);

    clearButton.textContent = copy.BTN_CLEAR;
    clearButton.addEventListener("click", () => {
      layers[step].getContext("2d").clearRect(0, 0, SIZE, SIZE);
      hasInk[step] = false;
      updateNextAvailability();
      renderDrawing();
      feedback("clear");
    });

    nextButton.addEventListener("click", () => {
      if (!hasInk[step]) return;
      if (step < STEP_COUNT - 1) {
        feedback("next");
        step += 1;
        updateStep();
      } else {
        showResult();
      }
    });

    function showResult() {
      animationToken += 1;
      resultParts = { eyes: 0, nose: 2, mouth: 6 };
      placementCache = buildPlacementCache();
      root.querySelector("#draw-header").hidden = true;
      root.querySelector("#draw-workspace").hidden = true;
      root.querySelector("#draw-toolbar").hidden = true;
      root.querySelector("#result-header").hidden = false;
      root.querySelector("#result-workspace").hidden = false;
      root.querySelector("#result-actions").hidden = false;
      resultTitle.textContent = copy.MSG_DONE || FALLBACK.MSG_DONE;
      renderResult();
      feedback("success");
    }

    async function blink() {
      const token = ++animationToken;
      resultParts.eyes = 1;
      renderResult();
      await sleep(230);
      if (token !== animationToken) return;
      resultParts.eyes = 0;
      renderResult();
    }

    async function sniff() {
      const token = ++animationToken;
      for (const frame of [3, 2, 3, 2]) {
        if (token !== animationToken) return;
        resultParts.nose = frame;
        renderResult();
        await sleep(145);
      }
    }

    async function talk() {
      const token = ++animationToken;
      for (const frame of [4, 5, 6, 5, 4, 5, 6]) {
        if (token !== animationToken) return;
        resultParts.mouth = frame;
        renderResult();
        await sleep(135);
      }
    }

    actionButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.action;
        feedback(action);
        if (action === "blink") blink();
        if (action === "sniff") sniff();
        if (action === "talk") talk();
      });
    });

    againButton.addEventListener("click", () => {
      animationToken += 1;
      layers.forEach((layer) => layer.getContext("2d").clearRect(0, 0, SIZE, SIZE));
      hasInk.fill(false);
      step = 0;
      placementCache = null;
      root.querySelector("#draw-header").hidden = false;
      root.querySelector("#draw-workspace").hidden = false;
      root.querySelector("#draw-toolbar").hidden = false;
      root.querySelector("#result-header").hidden = true;
      root.querySelector("#result-workspace").hidden = true;
      root.querySelector("#result-actions").hidden = true;
      updateStep();
      feedback("again");
    });

    updateStep();
  }

  boot();
})();
