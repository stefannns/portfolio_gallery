(function () {
  "use strict";

  const rules = window.DuelRules;
  const originalRoot = document.getElementById("root");
  if (!rules || !originalRoot) return;

  originalRoot.style.display = "none";
  originalRoot.setAttribute("aria-hidden", "true");

  const style = document.createElement("style");
  style.textContent = `
    @font-face {
      font-family: "Bangers Local";
      src: url("./assets/fonts/bangers/Bangers-Regular.woff2") format("woff2");
      font-display: swap;
    }
    :root { color-scheme: dark; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { background: #071f25; }
    * { box-sizing: border-box; }
    .tap-duel {
      position: fixed;
      inset: 0;
      overflow: hidden;
      background: #071f25;
      font-family: "Bangers Local", Impact, sans-serif;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .tap-duel__territory {
      position: absolute;
      left: 0;
      right: 0;
      transition: top 140ms cubic-bezier(.2,.8,.2,1), height 140ms cubic-bezier(.2,.8,.2,1);
    }
    .tap-duel__territory--red {
      top: 0;
      background: radial-gradient(circle at 50% 12%, #5f002f 0%, #39001d 45%, #250012 100%);
    }
    .tap-duel__territory--blue {
      bottom: 0;
      background: radial-gradient(circle at 50% 88%, #045665 0%, #073b46 45%, #062a32 100%);
    }
    .tap-duel__divider {
      position: absolute;
      left: 0;
      width: 100%;
      height: 5px;
      transform: translateY(-50%);
      background: #fff;
      box-shadow: 0 0 8px #fff, 0 0 18px rgba(255,255,255,.72);
      z-index: 4;
      pointer-events: none;
      transition: top 140ms cubic-bezier(.2,.8,.2,1);
    }
    .tap-duel__hitbox {
      position: absolute;
      left: 0;
      width: 100%;
      height: 50%;
      padding: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: #fff;
      z-index: 5;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .tap-duel__hitbox--red { top: 0; }
    .tap-duel__hitbox--blue { bottom: 0; }
    .tap-duel__player {
      position: absolute;
      left: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: clamp(10px, 2.3vh, 18px);
      width: min(76vw, 460px);
      transform: translateX(-50%);
      pointer-events: none;
    }
    .tap-duel__hitbox--red .tap-duel__player {
      top: max(24px, calc(env(safe-area-inset-top) + 18px));
      transform: translateX(-50%) rotate(180deg);
    }
    .tap-duel__hitbox--blue .tap-duel__player {
      bottom: max(24px, calc(env(safe-area-inset-bottom) + 18px));
    }
    .tap-duel__copy {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      color: rgba(255,255,255,.72);
      text-shadow: 0 2px 12px rgba(0,0,0,.4);
    }
    .tap-duel__name {
      font-size: clamp(18px, 5vw, 32px);
      letter-spacing: .08em;
    }
    .tap-duel__instruction {
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: .16em;
    }
    .tap-duel__orb {
      width: clamp(104px, 29vw, 186px);
      aspect-ratio: 1;
      border-radius: 50%;
      transition: transform 70ms ease;
    }
    .tap-duel__orb--red {
      background: #ff1683;
      box-shadow: 0 0 28px rgba(255,22,131,.74), inset 0 0 22px rgba(255,255,255,.25);
    }
    .tap-duel__orb--blue {
      background: #21e5f2;
      box-shadow: 0 0 28px rgba(33,229,242,.72), inset 0 0 22px rgba(255,255,255,.3);
    }
    .tap-duel__hitbox.is-pressed .tap-duel__orb { animation: tap-duel-press 130ms ease; }
    @keyframes tap-duel-press {
      0% { transform: scale(1); }
      45% { transform: scale(.88); }
      100% { transform: scale(1); }
    }
    .tap-duel__shot {
      position: absolute;
      left: 50%;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 6;
      transition: top 180ms linear, opacity 180ms ease;
    }
    .tap-duel__shot--red {
      background: #ff1683;
      box-shadow: 0 0 12px #ff1683;
    }
    .tap-duel__shot--blue {
      background: #21e5f2;
      box-shadow: 0 0 12px #21e5f2;
    }
    .tap-duel__result {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: grid;
      place-items: center;
      padding: max(40px, env(safe-area-inset-top)) 25px max(40px, env(safe-area-inset-bottom));
      background: rgba(0, 5, 10, .82);
      backdrop-filter: blur(8px);
    }
    .tap-duel__result[hidden] { display: none; }
    .tap-duel__result-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      width: min(84vw, 420px);
      text-align: center;
    }
    .tap-duel__winner {
      margin: 0;
      font-size: clamp(54px, 16vw, 96px);
      line-height: .92;
      letter-spacing: .04em;
      text-shadow: 0 0 24px currentColor;
    }
    .tap-duel__replay {
      min-width: 190px;
      min-height: 58px;
      padding: 14px 28px;
      border: 2px solid #fff;
      border-radius: 999px;
      background: #fff;
      color: #07151a;
      font: 32px/1 "Bangers Local", Impact, sans-serif;
      letter-spacing: .05em;
      cursor: pointer;
    }
    .tap-duel__sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    @media (max-height: 620px) {
      .tap-duel__orb { width: clamp(84px, 23vh, 142px); }
      .tap-duel__player { gap: 8px; }
      .tap-duel__name { font-size: 20px; }
      .tap-duel__instruction { font-size: 18px; }
    }
  `;
  document.head.appendChild(style);

  const app = document.createElement("main");
  app.className = "tap-duel";
  app.setAttribute("aria-label", "Two player tap tug duel");
  app.innerHTML = `
    <div class="tap-duel__territory tap-duel__territory--red"></div>
    <div class="tap-duel__territory tap-duel__territory--blue"></div>
    <div class="tap-duel__divider" aria-hidden="true"></div>
    <button class="tap-duel__hitbox tap-duel__hitbox--red" type="button" aria-label="Red player tap area">
      <span class="tap-duel__player">
        <span class="tap-duel__copy">
          <span class="tap-duel__name">RED PLAYER</span>
          <span class="tap-duel__instruction">TAP FAST</span>
        </span>
        <span class="tap-duel__orb tap-duel__orb--red"></span>
      </span>
    </button>
    <button class="tap-duel__hitbox tap-duel__hitbox--blue" type="button" aria-label="Blue player tap area">
      <span class="tap-duel__player">
        <span class="tap-duel__copy">
          <span class="tap-duel__name">BLUE PLAYER</span>
          <span class="tap-duel__instruction">TAP FAST</span>
        </span>
        <span class="tap-duel__orb tap-duel__orb--blue"></span>
      </span>
    </button>
    <output class="tap-duel__sr-only" aria-live="polite"></output>
    <section class="tap-duel__result" hidden aria-live="assertive">
      <div class="tap-duel__result-card">
        <h1 class="tap-duel__winner"></h1>
        <button class="tap-duel__replay" type="button">PLAY AGAIN</button>
      </div>
    </section>
  `;
  document.body.appendChild(app);

  const redTerritory = app.querySelector(".tap-duel__territory--red");
  const blueTerritory = app.querySelector(".tap-duel__territory--blue");
  const divider = app.querySelector(".tap-duel__divider");
  const redHitbox = app.querySelector(".tap-duel__hitbox--red");
  const blueHitbox = app.querySelector(".tap-duel__hitbox--blue");
  const result = app.querySelector(".tap-duel__result");
  const winnerText = app.querySelector(".tap-duel__winner");
  const replay = app.querySelector(".tap-duel__replay");
  const liveStatus = app.querySelector(".tap-duel__sr-only");

  let state = rules.createDuel();
  let audioContext = null;

  function render() {
    redTerritory.style.height = `${state.boundary}%`;
    blueTerritory.style.top = `${state.boundary}%`;
    divider.style.top = `${state.boundary}%`;
    liveStatus.textContent = state.winner
      ? `${state.winner === "p1" ? "Red" : "Blue"} player wins`
      : `Divider at ${state.boundary} percent`;

    if (!state.winner) {
      result.hidden = true;
      return;
    }

    const redWon = state.winner === "p1";
    winnerText.textContent = redWon ? "RED WINS!" : "BLUE WINS!";
    winnerText.style.color = redWon ? "#ff1683" : "#21e5f2";
    result.hidden = false;
    playTone(redWon ? 560 : 720, 0.18, 0.08);
    setTimeout(() => playTone(redWon ? 720 : 880, 0.24, 0.08), 120);
    if (navigator.vibrate) navigator.vibrate([35, 40, 70]);
  }

  function playTone(frequency, duration, volume) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  }

  function createShot(player, targetBoundary) {
    const shot = document.createElement("span");
    shot.className = `tap-duel__shot tap-duel__shot--${player === "p1" ? "red" : "blue"}`;
    shot.style.top = player === "p1" ? "18%" : "82%";
    app.appendChild(shot);
    requestAnimationFrame(() => {
      shot.style.top = `${targetBoundary}%`;
      shot.style.opacity = "0";
    });
    setTimeout(() => shot.remove(), 220);
  }

  function press(player, hitbox, event) {
    event.preventDefault();
    if (state.winner) return;
    state = rules.applyTap(state, player);
    createShot(player, state.boundary);
    hitbox.classList.remove("is-pressed");
    void hitbox.offsetWidth;
    hitbox.classList.add("is-pressed");
    playTone(player === "p1" ? 300 : 420, 0.055, 0.025);
    if (navigator.vibrate) navigator.vibrate(10);
    render();
  }

  function bindHitbox(hitbox, player) {
    hitbox.addEventListener("click", event => press(player, hitbox, event));
  }

  bindHitbox(redHitbox, "p1");
  bindHitbox(blueHitbox, "p2");
  replay.addEventListener("click", () => {
    state = rules.createDuel();
    render();
  });

  render();
})();
