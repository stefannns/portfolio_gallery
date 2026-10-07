(function () {
  "use strict";

  var root = document.getElementById("root");
  var heat = 50;
  var fed = 0;
  var extreme = null;
  var lastFood = "chili";
  var reactionTimer = 0;
  var audio = null;
  var voices = [];
  var driftFrame = 0;
  var previousFrame = null;
  var driftVelocity = 0;
  var driftTarget = 0;
  var driftRemaining = 0;
  var pageActive = true;

  // Random external heat/cold, not an automatic return to the midpoint.
  // Velocity blends smoothly when a new gust changes direction or strength.
  function chooseDrift() {
    var direction = driftTarget === 0 ? (Math.random() < .5 ? -1 : 1) :
      Math.sign(driftTarget) * (Math.random() < .7 ? -1 : 1);
    driftTarget = direction * (7.5 + Math.random() * 7.5);
    driftRemaining = 1.2 + Math.random() * 1.2;
  }

  function stopDrift() {
    if (driftFrame) window.cancelAnimationFrame(driftFrame);
    driftFrame = 0;
    previousFrame = null;
  }

  function startDrift() {
    if (driftFrame || extreme || document.hidden || !pageActive) return;
    previousFrame = null;
    driftFrame = window.requestAnimationFrame(driftStep);
  }

  function driftStep(timestamp) {
    driftFrame = 0;
    if (extreme || document.hidden || !pageActive) { previousFrame = null; return; }
    if (previousFrame !== null) {
      // Do not apply a backlog after a stalled frame or hidden/background tab.
      var dt = Math.min(.05, Math.max(0, (timestamp - previousFrame) / 1000));
      driftRemaining -= dt;
      if (driftRemaining <= 0) chooseDrift();
      driftVelocity += (driftTarget - driftVelocity) * (1 - Math.exp(-dt * 2.6));
      heat = Math.max(0, Math.min(100, heat + driftVelocity * dt));
      updateTemperature();
      if (heat === 100 || heat === 0) {
        shakeScene(heat === 100 ? 'chili' : 'ice');
        showRecovery(heat === 100 ? 'hot' : 'cold');
        return;
      }
    }
    previousFrame = timestamp;
    startNextFrame();
  }

  function startNextFrame() {
    driftFrame = window.requestAnimationFrame(driftStep);
  }

  function foodSvg(kind, size) {
    var width = Math.round(size * 0.78);
    if (kind === "ice") {
      return '<svg viewBox="0 0 90 116" width="' + width + '" height="' + size + '" aria-hidden="true">' +
        '<path d="M24 65 45 111 67 65Z" fill="#d99c61" stroke="#8f5b3c" stroke-width="2"/>' +
        '<path d="M27 73 61 73M32 83 58 83M37 94 53 94" stroke="#ad7449" stroke-width="2"/>' +
        '<path d="M19 63c0-10 8-14 10-21-2-10 7-17 14-15-2-8 6-13 12-9 6 3 6 10 3 14 10 2 14 12 7 19 9 8 2 17-7 17H28c-6 0-9-2-9-5Z" fill="#e9f9ff" stroke="#a9ccd8" stroke-width="2"/>' +
        '<path d="M29 48c15-4 20 8 34 3M28 60c12-5 24 2 35-3" fill="none" stroke="#b0d8e4" stroke-width="3"/>' +
        '</svg>';
    }
    return '<svg viewBox="0 0 90 116" width="' + width + '" height="' + size + '" aria-hidden="true">' +
      '<path d="M46 24c0-12 9-19 19-17" fill="none" stroke="#456333" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M45 26c17-10 31 0 27 25-4 27-22 48-51 59 16-15 18-31 17-48-1-14-4-26 7-36Z" fill="#e45563" stroke="#9a3347" stroke-width="3"/>' +
      '<path d="M53 31c14 2 15 15 11 27" fill="none" stroke="#ff9ba4" stroke-width="4" stroke-linecap="round"/>' +
      '</svg>';
  }

  function stickmanSvg() {
    return '<svg viewBox="0 0 180 270" class="stickman" aria-label="Smiling stickman">' +
      '<g fill="none" stroke="#222" stroke-width="3.3" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M90 7c39-1 40 58 1 58-38 1-40-57-1-58Z" fill="#fbfaf4"/>' +
      '<path class="neck" d="M90 65 90 78"/>' +
      '<path class="torso" d="M90 78C82 78 77 86 75 96L70 152Q70 172 82 172L98 172Q110 172 110 152L105 96C103 86 98 78 90 78Z" fill="#fbfaf4"/>' +
      '<path class="arms" d="M75 96Q60 117 48 151M105 96Q120 117 132 151"/>' +
      '<ellipse cx="48" cy="160" rx="5" ry="9"/><ellipse cx="132" cy="160" rx="5" ry="9"/>' +
      '<path class="legs" d="M82 172C81 202 79 230 74 249M98 172C99 202 103 230 108 249"/>' +
      '<path class="feet" d="M74 249Q60 249 48 257Q64 262 74 253ZM108 249Q124 249 134 257Q118 262 108 253Z" fill="#fbfaf4"/>' +
      '<path class="mouth" d="M80 48q10 12 20 0"/>' +
      '</g><circle cx="80" cy="31" r="3.4"/><circle cx="100" cy="31" r="3.4"/>' +
      '<g class="cheeks" fill="#e7897c" opacity="0"><ellipse cx="72" cy="43" rx="7" ry="4"/><ellipse cx="108" cy="43" rx="7" ry="4"/></g></svg>';
  }

  function weatherSvg() {
    var flakes = [[46,58],[235,84],[53,145],[251,161],[37,230],[245,267],[75,314],[224,346],[110,42],[192,51],[31,302],[262,322],[104,370],[187,375]];
    var flames = [[40,235,-12],[225,223,13],[69,139,-8],[208,128,11],[62,317,-10],[216,312,10]];
    return '<svg class="weather" viewBox="0 0 300 400" aria-hidden="true">' +
      '<g class="cold-weather" fill="none" stroke="#367fa6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      flakes.map(function (flake, index) {
        return '<g transform="translate(' + flake[0] + ' ' + flake[1] + ')"><g class="snowflake" style="--delay:' + (-index * .37) + 's">' +
          '<path d="M-1-13 1 13M-12-7 12 7M-11 8 11-8M-5-10 0-6 5-10M-5 10 0 6 5 10M-11-1-6-3-7-9M11 1 6 3 7 9M-10 3-5 4-5 10M10-3 5-4 5-10"/>' +
          '</g></g>';
      }).join("") + '</g><g class="hot-weather" stroke-linecap="round" stroke-linejoin="round">' +
      flames.map(function (flame, index) {
        return '<g transform="translate(' + flame[0] + ' ' + flame[1] + ') rotate(' + flame[2] + ')"><g class="flame" style="--delay:' + (-index * .31) + 's">' +
          '<path d="M2 35C-20 26-19 9-7-7-4 1 2 0 1-8 0-21 11-32 15-37 12-13 35-2 26 20 22 32 13 38 2 35Z" fill="#f6a153" stroke="#9c4935" stroke-width="2.4"/>' +
          '<path d="M7 29C-5 20 1 8 7 2 8 13 17 11 17 21 16 27 13 31 7 29Z" fill="#ffe5a1" stroke="#cf7643" stroke-width="1.7"/>' +
          '<path d="M-17 32-23 27M28-13 33-20" fill="none" stroke="#bb6740" stroke-width="2"/>' +
          '</g></g>';
      }).join("") +
      '<path class="fire-breath" d="M178 82c12-8 20-3 29-12l-4 12 23-2-14 10 21 10-27-2 5 10c-15-7-26-5-34-14" fill="#ffd17c" stroke="#ad5934" stroke-width="2.4"/>' +
      '<g class="embers" fill="#e58b45" stroke="#ac5035" stroke-width="1.5">' +
      [[57,260],[229,244],[86,157],[210,151],[99,310],[204,308]].map(function (point,index) {
        return '<g transform="translate(' + point[0] + ' ' + point[1] + ')"><path class="ember" style="--delay:' + (-index*.28) + 's" d="M0-5 4 0 0 6-3 0Z"/></g>';
      }).join("") + '</g></g>' +
      '<g class="cold-weather frost-streaks" fill="none" stroke="#508bad" stroke-width="2.2" stroke-linecap="round"><path d="M86 73 78 63M95 66 93 51M207 68 213 54M218 79 234 74M49 195 35 183M246 202 262 190M106 292 91 305M199 295 211 306"/></g></svg>';
  }

  function impactSvg() {
    return '<svg class="tap-impact" viewBox="0 0 300 400" aria-hidden="true">' +
      '<g class="impact-lines" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">' +
      '<path d="M73 72 91 85M62 98 82 102M221 71 204 84M237 98 216 103M71 137 88 126M228 136 211 126M123 54 128 72M177 53 172 71"/></g>' +
      '<g class="impact-dots" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
      '<path d="M64 161 73 166M230 163 238 157M88 45 92 53M211 43 207 51M108 157 113 149M191 160 186 151"/>' +
      '</g></svg>';
  }

  function render() {
    root.innerHTML = [
      '<main class="temperature-game">',
      '<header>',
      '<div class="temperature-track" role="meter" aria-label="Stickman temperature" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">',
      '<span class="cold-label">COLD</span><span class="hot-label">HOT</span><div class="temperature-marker"></div>',
      '</div>',
      '<h1>Spicy Stickman</h1>',
      '</header>',
      '<div class="speech-region">',
      '<div class="reaction" role="status" aria-live="polite">Tap treats to balance his temperature!</div>',
      '<section class="recovery-bubble" hidden aria-label="Help the stickman">',
      '<p class="bubble-message" aria-live="polite"></p>',
      '<div class="bubble-options"><button type="button" class="help-button"></button></div>',
      '</section></div>',
      '<div class="character-stage"><div class="scene-motion"><div class="stage-wash" aria-hidden="true"></div><div class="person">' + weatherSvg() + stickmanSvg() + impactSvg() + '</div></div></div>',
      '<div class="food-controls">',
      '<button class="food-button ice-button" type="button" data-food="ice" aria-label="Tap to feed ice cream">' + foodSvg("ice", 82) + '<span>ICE CREAM</span></button>',
      '<div class="reset-slot"><button class="reset-button" type="button" hidden>Reset</button></div>',
      '<button class="food-button chili-button" type="button" data-food="chili" aria-label="Tap to feed chili">' + foodSvg("chili", 82) + '<span>CHILI</span></button>',
      '</div>',
      '</main>'
    ].join("");

    root.querySelectorAll(".food-button").forEach(function (button) {
      button.addEventListener("click", function () { feed(button.dataset.food); });
    });
    root.querySelector(".reset-button").addEventListener("click", reset);
    root.querySelector(".help-button").addEventListener("click", reset);
    root.querySelector(".scene-motion").addEventListener("animationend", function (event) {
      if (event.target !== event.currentTarget) return;
      event.currentTarget.classList.remove("tap-chili", "tap-ice");
      event.currentTarget.style.animation = "";
    });
    updateTemperature();
  }

  function shakeScene(kind) {
    var scene = root.querySelector(".scene-motion");
    scene.classList.remove("tap-chili", "tap-ice");
    scene.style.animation = "none";
    scene.style.setProperty("--shake", (heat === 100 || heat === 0 ? 10 : 5 + Math.abs(heat - 50) * .06) + "px");
    void scene.offsetWidth;
    scene.classList.add("tap-" + kind);
    scene.style.animation = "";
  }

  function sound(kind) {
    try {
      var Constructor = window.AudioContext || window.webkitAudioContext;
      if (!Constructor) return;
      if (!audio) audio = new Constructor();
      if (audio.state === "suspended") audio.resume().catch(function () {});
      while (voices.length >= 4) voices.shift().stop();
      var oscillator = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
      var frequency = kind === "hot" ? 210 : kind === "cold" ? 540 : kind === "reset" ? 440 : kind === "chili" ? 330 : 620;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(kind === "hot" ? 110 : kind === "cold" ? 260 : frequency * 1.3, now + .2);
      gain.gain.setValueAtTime(.001, now);
      gain.gain.linearRampToValueAtTime(.055, now + .012);
      gain.gain.exponentialRampToValueAtTime(.001, now + .25);
      oscillator.connect(gain); gain.connect(audio.destination);
      voices.push(oscillator);
      oscillator.onended = function () { oscillator.disconnect(); gain.disconnect(); voices = voices.filter(function (voice) { return voice !== oscillator; }); };
      oscillator.start(now); oscillator.stop(now + .27);
    } catch (_) { /* Feeding remains immediate when browser audio is unavailable. */ }
  }

  function feed(kind) {
    if (extreme || (kind !== "chili" && kind !== "ice")) return;
    lastFood = kind;
    heat = Math.max(0, Math.min(100, heat + (kind === "chili" ? 17 : -17)));
    fed += 1;
    updateTemperature();
    shakeScene(kind);
    if (heat === 100 || heat === 0) {
      showRecovery(heat === 100 ? "hot" : "cold");
    } else {
      showReaction(kind === "chili" ? "Spicy!" : "Brrr... so cold!", kind);
      sound(kind);
    }
    root.querySelector(".reset-button").hidden = false;
  }

  function showRecovery(kind) {
    extreme = kind;
    stopDrift();
    clearTimeout(reactionTimer);
    reactionTimer = 0;
    var game = root.querySelector(".temperature-game"), bubble = root.querySelector(".recovery-bubble");
    game.classList.add("is-" + kind);
    root.querySelector(".reaction").hidden = true;
    root.querySelector(".bubble-message").textContent = kind === "hot" ? "Too spicy! Can I have some milk?" : "I'm freezing! Can you warm me up?";
    root.querySelector(".help-button").textContent = kind === "hot" ? "Milk, please!" : "Warm me up!";
    bubble.hidden = false;
    root.querySelectorAll(".food-button").forEach(function (button) { button.disabled = true; });
    sound(kind);
    try { if (navigator.vibrate) navigator.vibrate([30, 40, 30]); } catch (_) {}
    root.querySelector(".help-button").focus({ preventScroll: true });
  }

  function updateTemperature() {
    var meter = root.querySelector(".temperature-track");
    meter.setAttribute("aria-valuenow", String(Math.round(heat * 10) / 10));
    root.querySelector(".temperature-marker").style.left = "calc(" + heat + "% - " + (heat * .08) + "px)";
    root.querySelector(".stickman").style.filter = heat < 34 ? "drop-shadow(0 0 10px #83cdf0)" : heat > 66 ? "drop-shadow(0 0 10px #e76e75)" : "none";
    root.querySelector(".mouth").setAttribute("d", heat === 100 ? "M79 48q11-10 22 0" : heat === 0 ? "M80 49l5-3 5 3 5-3 5 3" : "M80 48q10 12 20 0");
  }

  function showReaction(message, kind) {
    var reaction = root.querySelector(".reaction");
    reaction.textContent = message;
    reaction.className = "reaction reaction-pop " + kind;
    // Restart the same feedback animation on consecutive taps.
    reaction.style.animation = "none";
    void reaction.offsetWidth;
    reaction.style.animation = "";
    clearTimeout(reactionTimer);
    reactionTimer = window.setTimeout(function () {
      reaction.textContent = "Tap treats to balance his temperature!";
      reaction.className = "reaction";
    }, 1100);
  }

  function reset() {
    stopDrift();
    clearTimeout(reactionTimer);
    reactionTimer = 0;
    heat = 50;
    fed = 0;
    extreme = null;
    driftTarget = 0;
    chooseDrift();
    driftVelocity = 0;
    root.querySelector(".temperature-game").classList.remove("is-hot", "is-cold");
    root.querySelector(".scene-motion").classList.remove("tap-chili", "tap-ice");
    root.querySelector(".scene-motion").style.animation = "none";
    root.querySelector(".recovery-bubble").hidden = true;
    root.querySelectorAll(".food-button").forEach(function (button) { button.disabled = false; });
    updateTemperature();
    root.querySelector(".reaction").hidden = false;
    root.querySelector(".reaction").textContent = "Tap treats to balance his temperature!";
    root.querySelector(".reaction").className = "reaction";
    root.querySelector(".reset-button").hidden = true;
    sound("reset");
    root.querySelector('[data-food="' + lastFood + '"]').focus({ preventScroll: true });
    startDrift();
  }

  function installStyles() {
    var style = document.createElement("style");
    style.textContent = [
      "*{box-sizing:border-box}",
      "html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}",
      "body{background:#f9f6ec;color:#1d2731;font-family:'Chalkboard SE','Comic Sans MS',system-ui,sans-serif;overscroll-behavior:none}",
      "button{font:inherit}button:focus-visible{outline:3px solid #1d2731;outline-offset:3px}[hidden]{display:none!important}",
      ".temperature-game{position:relative;width:100%;max-width:520px;height:100%;margin:0 auto;padding:calc(40px + env(safe-area-inset-top)) calc(25px + env(safe-area-inset-right)) calc(40px + env(safe-area-inset-bottom)) calc(25px + env(safe-area-inset-left));display:flex;flex-direction:column;gap:10px;overflow:hidden;background:#f9f6ec;touch-action:manipulation;user-select:none}",
      "header{flex:none}.temperature-track{position:relative;height:18px;margin-bottom:24px;border:2px solid #1d2731;border-radius:10px;background:linear-gradient(90deg,#9bd4fa,#f3eee8,#e8899c);box-shadow:0 3px 8px #0002}",
      ".temperature-marker{position:absolute;top:0;bottom:0;width:8px;border-radius:3px;background:#202020}",
      ".cold-label,.hot-label{position:absolute;top:21px;font-size:12px;font-weight:700;line-height:1.2;letter-spacing:1px}.cold-label{left:2px;color:#22688b}.hot-label{right:2px;color:#a42e43}",
      ".temperature-game h1{margin:0;text-align:center;font-size:clamp(23px,6vw,29px);line-height:1.15}",
      ".speech-region{flex:none;min-height:112px;display:grid;place-items:center;padding-bottom:9px}.reaction{min-height:27px;text-align:center;font-size:18px;font-weight:700;line-height:1.35}",
      ".reaction.ice{color:#22688b}.reaction.chili{color:#a42e43}.reaction-pop{animation:reaction-pop .25s ease}",
      ".recovery-bubble{position:relative;width:100%;padding:10px 12px;background:#fffdf6;border:2px solid #34342e;border-radius:22px 18px 23px 16px;box-shadow:3px 3px 0 #34342e16}.recovery-bubble:after{content:'';position:absolute;width:14px;height:14px;bottom:-9px;left:50%;background:#fffdf6;border-right:2px solid #34342e;border-bottom:2px solid #34342e;transform:rotate(45deg)}",
      ".bubble-message{margin:0 0 8px;text-align:center;font-size:16px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}.bubble-options{display:flex;gap:10px}.bubble-options button{flex:1;min-width:0;min-height:48px;padding:7px 8px;border:2px solid #34342e;border-radius:12px 15px 11px 14px;background:#fff4de;color:#34342e;font-weight:700;font-size:15px;line-height:1.2;cursor:pointer}.bubble-options button:active{background:#e9dfc8}.is-hot .help-button{background:#fce2c6}.is-cold .help-button{background:#d8edf6}",
      "@keyframes reaction-pop{0%{transform:scale(.75);opacity:.2}100%{transform:scale(1);opacity:1}}",
      ".character-stage{flex:1;min-height:0;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center}.scene-motion{position:relative;width:100%;height:100%;padding:12px;display:flex;align-items:center;justify-content:center;--shake:6px}.scene-motion.tap-chili,.scene-motion.tap-ice{animation:stage-shake .55s ease-out}.person{position:relative;width:min(100%,260px);height:min(100%,340px);display:flex;justify-content:center;align-items:center}.stickman{position:relative;width:auto;max-width:100%;height:100%;overflow:visible;transition:filter .25s ease}.weather,.tap-impact{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.hot-weather,.cold-weather{opacity:0}.is-hot .hot-weather,.is-cold .cold-weather{opacity:1}.is-hot .stickman{color:#a84433;animation:hot-wobble .65s ease-in-out infinite alternate}.is-hot .stickman>g:first-child{stroke:currentColor}.is-hot .cheeks{opacity:.65}.is-cold .stickman>g:first-child{stroke:#386f92}.is-cold .stickman{animation:shiver .19s ease-in-out infinite alternate}.snowflake{animation:snow-drift 2.3s ease-in-out infinite alternate;animation-delay:var(--delay)}.flame{animation:flame-dance .8s ease-in-out infinite alternate;animation-delay:var(--delay);transform-origin:center bottom}.ember{animation:ember-rise 1.65s ease-out infinite;animation-delay:var(--delay)}.fire-breath{transform-origin:177px 90px;animation:fire-puff 1.1s ease-in-out infinite alternate}",
      ".stage-wash{position:absolute;inset:12px;border-radius:44% 48% 40% 45%;pointer-events:none;opacity:0;transition:opacity .35s ease;background:radial-gradient(ellipse,#efb37d55,transparent 72%)}.is-hot .stage-wash{opacity:1}.is-cold .stage-wash{opacity:1;background:radial-gradient(ellipse,#91c9e25c,transparent 72%)}.tap-impact{opacity:0;color:#b55b35}.tap-ice .tap-impact{color:#387d9f}.tap-chili .tap-impact,.tap-ice .tap-impact{animation:impact-burst .55s ease-out}.impact-dots{transform-origin:150px 105px;animation:impact-scatter .55s ease-out}",
      "@keyframes stage-shake{0%,100%{transform:translate(0,0) rotate(0)}12%{transform:translate(calc(var(--shake)*-1),-3px) rotate(-.6deg)}26%{transform:translate(var(--shake),2px) rotate(.6deg)}40%{transform:translate(calc(var(--shake)*-.75),-2px) rotate(-.4deg)}55%{transform:translate(calc(var(--shake)*.65),1px) rotate(.3deg)}70%{transform:translate(calc(var(--shake)*-.4),0)}85%{transform:translate(calc(var(--shake)*.2),0)}}",
      "@keyframes impact-burst{0%{opacity:0;transform:scale(.86)}15%{opacity:.9}100%{opacity:0;transform:scale(1.18)}}@keyframes impact-scatter{from{transform:scale(.8)}to{transform:scale(1.25)}}@keyframes snow-drift{from{transform:translateY(-9px) rotate(-14deg)}to{transform:translateY(15px) rotate(18deg)}}@keyframes flame-dance{from{transform:scale(.95,1.17) rotate(-5deg)}to{transform:scale(1.18,.94) rotate(5deg)}}@keyframes shiver{from{transform:translateX(-3px) rotate(-.7deg)}to{transform:translateX(3px) rotate(.7deg)}}@keyframes hot-wobble{from{transform:rotate(-2deg) translateY(0)}to{transform:rotate(2deg) translateY(-2px)}}@keyframes ember-rise{0%{opacity:0;transform:translateY(4px)}20%{opacity:.8}100%{opacity:0;transform:translate(8px,-44px)}}@keyframes fire-puff{from{transform:scale(.9,1)}to{transform:scale(1.2,1.08)}}",
      ".food-controls{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px}.food-button{flex:1;max-width:114px;min-width:0;min-height:106px;padding:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:0;border-radius:18px;background:transparent;color:#34424b;font-weight:700;font-size:12px;line-height:1.25;cursor:pointer;touch-action:manipulation;transition:background .12s ease}.food-button svg{max-width:100%;flex:none;pointer-events:none}.food-button:active{background:#fff8}.food-button:disabled{opacity:.4;cursor:default}",
      ".reset-slot{flex:0 0 66px}.reset-button{width:100%;min-height:48px;padding:8px 4px;border:1.5px solid #737977;border-radius:12px 10px 13px 11px;background:#fffdf6;color:#34342e;font-weight:700;font-size:14px;box-shadow:0 3px 0 #0001;cursor:pointer;touch-action:manipulation}.reset-button:active{background:#ece5d7}",
      "@media(max-height:620px){.temperature-game{gap:6px}.temperature-game h1{font-size:23px}.temperature-track{margin-bottom:21px}.speech-region{min-height:102px}.recovery-bubble{padding:8px 10px}.bubble-message{font-size:15px}.food-button{min-height:88px}.food-button svg{height:68px;width:auto}}",
      "@media(prefers-reduced-motion:reduce){.reaction-pop,.scene-motion.tap-chili,.scene-motion.tap-ice,.is-cold .stickman,.is-hot .stickman,.snowflake,.flame,.ember,.fire-breath,.tap-impact,.impact-dots{animation:none}.stickman,.stage-wash{transition:none}.tap-chili .tap-impact,.tap-ice .tap-impact{opacity:.6}}"
    ].join("");
    document.head.appendChild(style);
  }

  installStyles();
  render();
  chooseDrift();
  startDrift();
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopDrift();
    else startDrift();
  });
  window.addEventListener('pageshow', function () {
    pageActive = true;
    startDrift();
  });
  window.addEventListener("pagehide", function () {
    pageActive = false;
    stopDrift();
    clearTimeout(reactionTimer);
    voices.forEach(function (voice) { try { voice.stop(); } catch (_) {} });
    if (audio) audio.close().catch(function () {});
    audio = null;
    voices = [];
  });
})();
