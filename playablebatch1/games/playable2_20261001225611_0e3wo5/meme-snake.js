(function () {
  "use strict";

  var MEMES = [
    { name: "Apple", src: "./assets/meme_apple.webp" },
    { name: "Pear", src: "./assets/meme_pear.webp" },
    { name: "Mango", src: "./assets/meme_mango.webp" },
    { name: "Pineapple", src: "./assets/meme_pineapple.webp" },
    { name: "Peach", src: "./assets/meme_peach.webp" },
    { name: "Watermelon", src: "./assets/meme_watermelon.webp" },
    { name: "Tomato", src: "./assets/meme_tomato.webp" },
    { name: "Coconut", src: "./assets/meme_coconut.webp" }
  ];

  var root = document.getElementById("root");
  var config = {};
  var images = [];
  var canvas;
  var context;
  var arena;
  var width = 0;
  var height = 0;
  var dpr = 1;
  var state = "loading";
  var score = 0;
  var best = 0;
  var segments = [];
  var direction = { x: 1, y: 0 };
  var food = null;
  var lastFrame = 0;
  var animationFrame = 0;
  var audioContext = null;
  var joystickActive = false;
  var joystickPointer = null;
  var movementStarted = false;
  var resizeObserver;
  var catScale = 0.9;

  try {
    best = Number(localStorage.getItem("meme-snake-best") || 0);
  } catch (_) {}

  function flatten(raw) {
    var output = {};
    ["tweaks", "texts", "images", "mentions", "motions"].forEach(function (group) {
      (raw[group] || []).forEach(function (item) {
        output[item.id] = item.path != null ? item.path : item.value;
      });
    });
    return output;
  }

  function loadConfig() {
    return fetch("./game.config.json", { cache: "no-store" })
      .then(function (response) { return response.json(); })
      .catch(function () { return {}; })
      .then(flatten);
  }

  function loadImage(source) {
    return new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { resolve(null); };
      image.src = source;
    });
  }

  function randomInt(max) {
    if (window.crypto && window.crypto.getRandomValues) {
      var value = new Uint32Array(1);
      window.crypto.getRandomValues(value);
      return value[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function distance(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function buildInterface() {
    root.innerHTML = [
      '<main class="meme-game">',
      '<header class="meme-hud">',
      '<div class="meme-scores">',
      '<div><strong id="score-value" aria-label="Score 0">0</strong></div>',
      '<div><span class="best-label"></span><strong id="best-value">0</strong></div>',
      '</div>',
      '</header>',
      '<section class="meme-arena" aria-label="Cats Snake play area">',
      '<canvas></canvas>',
      '<div class="meme-hint">Drag to steer</div>',
      '<div class="meme-pickup" aria-live="polite"></div>',
      '</section>',
      '<section class="meme-controls">',
      '<div class="joystick" role="application" tabindex="0" aria-label="Analog movement joystick. Drag in any direction; left and right keys rotate.">',
      '<div class="joystick-cross" aria-hidden="true"></div>',
      '<div class="joystick-knob" aria-hidden="true"><span></span></div>',
      '</div>',
      '</section>',
      '<div class="meme-overlay" id="game-overlay">',
      '<div class="meme-card">',
      '<img class="head-preview" alt="Random cat head preview">',
      '<p class="overlay-kicker" hidden></p>',
      '<h1 hidden></h1>',
      '<p class="overlay-copy">Steer with the joystick. Eat squares to grow.</p>',
      '<button class="primary-button" type="button"></button>',
      '<button class="post-button" type="button" hidden></button>',
      '</div>',
      '</div>',
      '</main>'
    ].join("");

    canvas = root.querySelector("canvas");
    context = canvas.getContext("2d");
    arena = root.querySelector(".meme-arena");
    root.querySelector(".best-label").textContent = (config.TEXT_BEST || "BEST") + " ";
    root.querySelector(".primary-button").textContent = config.BTN_START || "START GAME";
    root.querySelector(".post-button").textContent = config.TEXT_POST_PLAY || "POST MY PLAY";
    updateScore();
    installControls();

    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(arena);
    } else {
      window.addEventListener("resize", resizeCanvas);
    }
    resizeCanvas();
  }

  function resizeCanvas() {
    if (!canvas || !arena) return;
    var rectangle = arena.getBoundingClientRect();
    var oldWidth = width || rectangle.width;
    var oldHeight = height || rectangle.height;
    width = Math.max(1, rectangle.width);
    height = Math.max(1, rectangle.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (segments.length && oldWidth && oldHeight) {
      segments.forEach(function (segment) {
        segment.x = clamp(segment.x / oldWidth * width, 30, width - 30);
        segment.y = clamp(segment.y / oldHeight * height, 30, height - 30);
      });
      if (food) {
        food.x = clamp(food.x / oldWidth * width, 34, width - 34);
        food.y = clamp(food.y / oldHeight * height, 34, height - 34);
      }
    }
    draw();
  }

  function updateScore() {
    var scoreNode = document.getElementById("score-value");
    var bestNode = document.getElementById("best-value");
    if (scoreNode) { scoreNode.textContent = score; scoreNode.setAttribute("aria-label", "Score " + score); }
    if (bestNode) bestNode.textContent = best;
  }

  function baseSpeed() {
    var interval = Number(config.INITIAL_SPEED) || 300;
    return clamp(55000 / interval, 120, 250);
  }

  function maxSpeed() {
    var interval = Number(config.MIN_SPEED) || 80;
    return clamp(24000 / interval, 220, 380);
  }

  function prepareRound() {
    score = 0;
    movementStarted = false;
    joystickActive = false;
    joystickPointer = null;
    direction = { x: 1, y: 0 };
    var headIndex = randomInt(MEMES.length);
    segments = [{ x: width * 0.42, y: height * 0.5, meme: headIndex }];
    spawnFood();
    updateScore();
    var preview = root.querySelector(".head-preview");
    preview.src = MEMES[headIndex].src;
    preview.alt = MEMES[headIndex].name + " cat head";
    root.querySelector(".meme-hint").hidden = false;
    resetJoystick();
    draw();
  }

  function spawnFood() {
    var candidate = { x: width * 0.72, y: height * 0.45, meme: randomInt(MEMES.length) };
    for (var attempt = 0; attempt < 60; attempt += 1) {
      candidate.x = 42 + Math.random() * Math.max(1, width - 84);
      candidate.y = 42 + Math.random() * Math.max(1, height - 84);
      var clear = segments.every(function (segment) { return distance(candidate, segment) > 92; });
      if (clear) break;
    }
    food = candidate;
  }

  function unlockAudio() {
    try {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioContext = audioContext || new AudioContext();
      if (audioContext.state === "suspended") {
        var resume = audioContext.resume();
        if (resume && resume.catch) resume.catch(function () {});
      }
    } catch (_) {}
  }

  function tone(kind) {
    try {
      if (!audioContext) return;
      var now = audioContext.currentTime;
      var oscillator = audioContext.createOscillator();
      var gain = audioContext.createGain();
      oscillator.type = kind === "eat" ? "triangle" : "square";
      oscillator.frequency.setValueAtTime(kind === "eat" ? 480 : 170, now);
      oscillator.frequency.exponentialRampToValueAtTime(kind === "eat" ? 780 : 95, now + 0.17);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.24);
    } catch (_) {}
  }

  function startGame() {
    if (state !== "idle" && state !== "over") return;
    unlockAudio();
    if (state === "over") prepareRound();
    state = "playing";
    root.querySelector("#game-overlay").classList.add("overlay-hidden");
    lastFrame = performance.now();
  }

  function endGame() {
    state = "over";
    var joystick = root.querySelector(".joystick");
    var releasedPointer = joystickPointer;
    joystickActive = false;
    joystickPointer = null;
    if (releasedPointer !== null && joystick.hasPointerCapture(releasedPointer)) joystick.releasePointerCapture(releasedPointer);
    resetJoystick();
    tone("over");
    try { if (navigator.vibrate) navigator.vibrate([35, 35, 55]); } catch (_) {}
    best = Math.max(best, score);
    try {
      localStorage.setItem("meme-snake-best", String(best));
    } catch (_) {}
    updateScore();

    var overlay = root.querySelector("#game-overlay");
    var card = root.querySelector(".meme-card");
    card.querySelector(".overlay-kicker").textContent = "GAME OVER";
    card.querySelector(".overlay-kicker").hidden = false;
    card.querySelector("h1").hidden = false;
    card.querySelector("h1").textContent = "SCORE " + score;
    card.querySelector(".overlay-copy").textContent = "You collected " + score + " cat" + (score === 1 ? "" : "s") + ". Try another random head and beat your best.";
    card.querySelector(".head-preview").src = MEMES[segments[0].meme].src;
    var playAgain = card.querySelector(".primary-button");
    playAgain.textContent = config.BTN_RESTART || "PLAY AGAIN";
    var post = card.querySelector(".post-button");
    post.hidden = !(window.tt && typeof window.tt.playableRecordingSubmission === "function");
    overlay.classList.remove("overlay-hidden");
  }

  function showPickup(memeIndex) {
    var pickup = root.querySelector(".meme-pickup");
    pickup.innerHTML = '<img src="' + MEMES[memeIndex].src + '" alt=""><span>' + MEMES[memeIndex].name.toUpperCase() + " CAT +1</span>";
    pickup.classList.remove("pickup-pop");
    void pickup.offsetWidth;
    pickup.classList.add("pickup-pop");
  }

  function update(deltaSeconds) {
    if (state !== "playing" || !movementStarted || !segments.length) return;

    var head = segments[0];
    var speed = Math.min(maxSpeed(), baseSpeed() + score * 6);
    head.x += direction.x * speed * deltaSeconds;
    head.y += direction.y * speed * deltaSeconds;

    var headRadius = 24 * catScale;
    if (head.x < headRadius || head.x > width - headRadius || head.y < headRadius || head.y > height - headRadius) {
      endGame();
      return;
    }

    var gap = 42 * catScale;
    for (var index = 1; index < segments.length; index += 1) {
      var leader = segments[index - 1];
      var follower = segments[index];
      var dx = leader.x - follower.x;
      var dy = leader.y - follower.y;
      var currentDistance = Math.sqrt(dx * dx + dy * dy) || 1;
      if (currentDistance > gap) {
        follower.x = leader.x - dx / currentDistance * gap;
        follower.y = leader.y - dy / currentDistance * gap;
      }
    }

    if (food && distance(head, food) < headRadius + 22) {
      var tail = segments[segments.length - 1];
      segments.push({ x: tail.x, y: tail.y, meme: food.meme });
      score += 1;
      best = Math.max(best, score);
      updateScore();
      showPickup(food.meme);
      tone("eat");
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (_) {}
      spawnFood();
    }

    if (segments.length > 6) {
      for (var collisionIndex = 5; collisionIndex < segments.length; collisionIndex += 1) {
        if (distance(head, segments[collisionIndex]) < 25 * catScale) {
          endGame();
          return;
        }
      }
    }
  }

  function drawRoundedSquare(x, y, size, radius) {
    var left = x - size / 2;
    var top = y - size / 2;
    context.beginPath();
    context.moveTo(left + radius, top);
    context.arcTo(left + size, top, left + size, top + size, radius);
    context.arcTo(left + size, top + size, left, top + size, radius);
    context.arcTo(left, top + size, left, top, radius);
    context.arcTo(left, top, left + size, top, radius);
    context.closePath();
  }

  function drawMeme(segment, size, isHead) {
    var image = images[segment.meme];
    context.save();
    context.translate(segment.x, segment.y);
    context.shadowColor = isHead ? "rgba(255,221,110,.8)" : "rgba(0,0,0,.45)";
    context.shadowBlur = isHead ? 16 : 8;
    context.shadowOffsetY = 3;
    if (image) context.drawImage(image, -size / 2, -size / 2, size, size);
    else {
      context.fillStyle = isHead ? "#f2d16f" : "#59c7a0";
      context.beginPath();
      context.arc(0, 0, size * 0.38, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function draw() {
    if (!context || !width || !height) return;
    context.clearRect(0, 0, width, height);

    var gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#183941");
    gradient.addColorStop(1, "#0a2128");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    var cells = Number(config.GRID_SIZE) || 15;
    var grid = Math.max(30, width / cells * 2);
    context.strokeStyle = "rgba(137,220,196,.08)";
    context.lineWidth = 1;
    for (var x = 0; x < width; x += grid) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (var y = 0; y < height; y += grid) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    if (food) {
      context.save();
      context.shadowColor = "rgba(246,205,101,.65)";
      context.shadowBlur = 17;
      drawRoundedSquare(food.x, food.y, 38, 6);
      context.fillStyle = "#f2d16f";
      context.fill();
      context.lineWidth = 3;
      context.strokeStyle = "#fff0bb";
      context.stroke();
      context.shadowBlur = 0;
      context.fillStyle = "#18343b";
      context.font = "600 23px DynaPuff, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("?", food.x, food.y + 1);
      context.restore();
    }

    for (var index = segments.length - 1; index >= 1; index -= 1) {
      drawMeme(segments[index], 52 * catScale, false);
    }
    if (segments.length) drawMeme(segments[0], 62 * catScale, true);
  }

  function frame(time) {
    var elapsed = Math.min(0.034, Math.max(0, (time - lastFrame) / 1000));
    lastFrame = time;
    update(elapsed);
    draw();
    animationFrame = requestAnimationFrame(frame);
  }

  function installControls() {
    var joystick = root.querySelector(".joystick");
    var knob = root.querySelector(".joystick-knob");

    function updateJoystick(clientX, clientY) {
      var rectangle = joystick.getBoundingClientRect();
      var centerX = rectangle.left + rectangle.width / 2;
      var centerY = rectangle.top + rectangle.height / 2;
      var dx = clientX - centerX;
      var dy = clientY - centerY;
      var length = Math.sqrt(dx * dx + dy * dy) || 1;
      var radius = rectangle.width * 0.31;
      var visualLength = Math.min(radius, length);
      knob.style.transform = "translate(calc(-50% + " + (dx / length * visualLength) + "px),calc(-50% + " + (dy / length * visualLength) + "px))";
      if (length > Math.max(3, rectangle.width * 0.025)) {
        direction = { x: dx / length, y: dy / length };
        movementStarted = true;
        root.querySelector(".meme-hint").hidden = true;
      }
    }

    joystick.addEventListener("pointerdown", function (event) {
      if (state !== "playing" || joystickPointer !== null || event.isPrimary === false || (event.button != null && event.button !== 0)) return;
      event.preventDefault();
      unlockAudio();
      joystickPointer = event.pointerId;
      joystickActive = true;
      joystick.setPointerCapture(event.pointerId);
      joystick.classList.add("joystick-active");
      updateJoystick(event.clientX, event.clientY);
    });
    joystick.addEventListener("pointermove", function (event) {
      if (!joystickActive || event.pointerId !== joystickPointer || state !== "playing") return;
      event.preventDefault();
      updateJoystick(event.clientX, event.clientY);
    });

    function releaseJoystick(event) {
      if (event && event.pointerId != null && event.pointerId !== joystickPointer) return;
      var releasedPointer = joystickPointer;
      joystickPointer = null;
      joystickActive = false;
      joystick.classList.remove("joystick-active");
      if (releasedPointer !== null && joystick.hasPointerCapture(releasedPointer)) joystick.releasePointerCapture(releasedPointer);
      resetJoystick();
    }
    joystick.addEventListener("pointerup", releaseJoystick);
    joystick.addEventListener("pointercancel", releaseJoystick);
    joystick.addEventListener("lostpointercapture", releaseJoystick);
    joystick.addEventListener("keydown", function (event) {
      if (state !== "playing" || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      event.preventDefault();
      movementStarted = true;
      root.querySelector(".meme-hint").hidden = true;
      var turn = event.key === "ArrowLeft" ? -Math.PI / 12 : Math.PI / 12;
      var cosine = Math.cos(turn);
      var sine = Math.sin(turn);
      direction = {
        x: direction.x * cosine - direction.y * sine,
        y: direction.x * sine + direction.y * cosine
      };
    });
    function pauseSteering() {
      releaseJoystick();
      if (state === "playing") {
        movementStarted = false;
        root.querySelector(".meme-hint").hidden = false;
      }
      lastFrame = performance.now();
    }
    window.addEventListener("blur", pauseSteering);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) pauseSteering();
    });

    root.querySelector(".primary-button").addEventListener("click", startGame);
    root.querySelector(".post-button").addEventListener("click", function () {
      if (window.tt && typeof window.tt.playableRecordingSubmission === "function") {
        window.tt.playableRecordingSubmission({ success: function () {}, fail: function () {} });
      }
    });
  }

  function resetJoystick() {
    var joystick = root.querySelector(".joystick");
    if (joystick) joystick.classList.remove("joystick-active");
    var knob = root.querySelector(".joystick-knob");
    if (knob) knob.style.transform = "translate(-50%,-50%)";
  }

  function installStyles() {
    var style = document.createElement("style");
    style.textContent = [
      "@font-face{font-family:DynaPuff;src:url('./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2') format('woff2');font-style:normal;font-weight:600;font-display:swap}",
      "@font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');font-style:normal;font-weight:400;font-display:swap}",
      ":root{--ui-unit:min(0.2564102564vw,0.1672240803vh);--font-playful:DynaPuff,system-ui,sans-serif;--font-readable:Poppins,system-ui,sans-serif}",
      "*{box-sizing:border-box}",
      "html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}",
      "body{background:#06161b;color:#f6fff9;font-family:var(--font-readable);font-weight:400;font-synthesis:none;overscroll-behavior:none}",
      "button{font:inherit}[hidden]{display:none!important}",
      ".meme-game{position:relative;width:100%;height:100%;margin:0 auto;display:flex;flex-direction:column;overflow:hidden;background:#0a2228;box-shadow:0 0 50px #0008}",
      ".meme-hud{position:relative;z-index:2;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(30 * var(--ui-unit) + env(safe-area-inset-top)) calc(30 * var(--ui-unit) + env(safe-area-inset-right)) 12px calc(30 * var(--ui-unit) + env(safe-area-inset-left));background:#102c33;border-bottom:1px solid #79c9b344}",
      ".meme-scores{display:flex;width:100%;justify-content:space-between;align-items:center;gap:14px;text-align:right}",
      ".meme-scores div{display:flex;align-items:baseline;gap:8px}",
      ".meme-scores span{font-family:var(--font-playful);font-size:calc(14 * var(--ui-unit));font-weight:600;letter-spacing:.5px;color:#c6e8df}",
      ".meme-scores strong{font-family:var(--font-playful);font-weight:600;font-size:calc(28 * var(--ui-unit));line-height:1.2;color:#fff;font-variant-numeric:tabular-nums}",
      ".meme-arena{position:relative;flex:1;min-height:0;margin:0;border:2px solid #72c6b0;border-left:0;border-right:0;border-radius:0;overflow:hidden;background:#102d34;box-shadow:inset 0 0 28px #0007,0 10px 24px #0005}",
      ".meme-arena canvas{display:block;width:100%;height:100%;touch-action:none}",
      ".meme-hint{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);width:calc(100% - 32px);padding:7px 12px;border-radius:16px;background:#06171de6;color:#e9fff8;font-size:calc(18 * var(--ui-unit));line-height:1.35;font-weight:800;letter-spacing:.3px;text-align:center;pointer-events:none}",
      ".meme-pickup{position:absolute;left:50%;top:20px;display:flex;align-items:center;gap:8px;min-height:42px;padding:5px 12px 5px 6px;border:1px solid #f4d77f;border-radius:999px;background:#142d32ed;color:#fff0b8;font-size:12px;font-weight:900;opacity:0;transform:translate(-50%,-12px);pointer-events:none}",
      ".meme-pickup img{width:34px;height:34px;object-fit:contain}",
      ".pickup-pop{animation:pickup-pop 1.15s ease both}",
      "@keyframes pickup-pop{0%{opacity:0;transform:translate(-50%,-12px) scale(.85)}15%,75%{opacity:1;transform:translate(-50%,0) scale(1)}100%{opacity:0;transform:translate(-50%,-8px) scale(.95)}}",
      ".meme-controls{position:relative;z-index:2;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;padding:12px calc(30 * var(--ui-unit)) calc(50 * var(--ui-unit) + env(safe-area-inset-bottom) + 22px);background:#102c33}",
      ".meme-controls p{margin:7px 0 0;color:#9bd6c6;font-size:10px;font-weight:900;letter-spacing:1.6px}",
      ".joystick{position:relative;width:142px;height:142px;border:2px solid #83d2bd;border-radius:50%;background:radial-gradient(circle,#183e46 0 29%,#102b32 30% 58%,#0a2026 59%);box-shadow:inset 0 0 18px #0008,0 8px 18px #0006;touch-action:none;cursor:grab;outline:none}",
      ".joystick:focus-visible{outline:3px solid #fff3bc;outline-offset:4px}",
      ".joystick-active{cursor:grabbing;border-color:#f0d17d}",
      ".joystick-cross{position:absolute;inset:14px;border-radius:50%;background:linear-gradient(90deg,transparent 49.5%,#a9d9cc33 50%,transparent 50.5%),linear-gradient(0deg,transparent 49.5%,#a9d9cc33 50%,transparent 50.5%);pointer-events:none}",
      ".joystick-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;transform:translate(-50%,-50%);border:3px solid #ffebb0;border-radius:50%;background:linear-gradient(145deg,#f2d16f,#bb8148);box-shadow:0 7px 14px #0009,inset 0 2px #fff8;pointer-events:none;transition:box-shadow .12s ease}",
      ".joystick-knob span{position:absolute;left:50%;top:9px;width:8px;height:15px;transform:translateX(-50%);border-radius:5px;background:#18343b}",
      ".meme-overlay{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:calc(30 * var(--ui-unit) + env(safe-area-inset-top)) calc(30 * var(--ui-unit) + env(safe-area-inset-right)) calc(50 * var(--ui-unit) + env(safe-area-inset-bottom)) calc(30 * var(--ui-unit) + env(safe-area-inset-left));background:#06161bf2;backdrop-filter:blur(6px);opacity:1;visibility:visible;transition:opacity .25s ease,visibility .25s ease}",
      ".overlay-hidden{opacity:0;visibility:hidden;pointer-events:none}",
      ".meme-card{width:100%;max-width:370px;padding:24px 20px;border:1.5px solid #6fc1ad;border-radius:24px;background:#102d34;text-align:center;box-shadow:0 20px 50px #000b}",
      ".head-preview{width:132px;height:132px;object-fit:contain;filter:drop-shadow(0 9px 10px #0008)}",
      ".overlay-kicker{margin:8px 0 6px;color:#f2d16f;font-size:11px;font-weight:900;letter-spacing:1.8px}",
      ".meme-card h1{margin:0;font-family:var(--font-playful);font-size:calc(28 * var(--ui-unit));font-weight:600;line-height:1.2;letter-spacing:.2px;color:#fff;text-shadow:0 2px 0 #663f33}",
      ".overlay-copy{max-width:29ch;margin:14px auto 20px;color:#c6e8df;font-size:calc(18 * var(--ui-unit));line-height:1.4}",
      ".primary-button,.post-button{width:100%;min-height:54px;padding:10px 16px;border:0;border-radius:13px;background:#f0d17d;color:#17343a;font-size:17px;font-weight:900;box-shadow:0 5px 0 #92763b;cursor:pointer;touch-action:manipulation}",
      ".primary-button:active,.post-button:active{filter:brightness(.92);box-shadow:0 2px 0 #92763b}",
      ".primary-button:focus-visible,.post-button:focus-visible{outline:3px solid #fff;outline-offset:3px}",
      ".post-button{margin-top:11px;border:1px solid #7bcab6;background:#173b43;color:#e9fff8;box-shadow:none}",
      ".primary-button,.post-button,.overlay-kicker,.meme-pickup{font-family:var(--font-playful);font-weight:600}",
      ".meme-hint{font-weight:400;letter-spacing:0}",
      "@media(max-height:700px){.meme-hud{padding-bottom:8px}.meme-controls{padding-top:8px}.joystick{width:116px;height:116px}.joystick-knob{width:48px;height:48px}.meme-controls p{margin-top:4px}.head-preview{width:105px;height:105px}.meme-card{padding-top:18px;padding-bottom:18px}}",
      "@media(prefers-reduced-motion:reduce){.meme-overlay{transition:none}.pickup-pop{animation-duration:.2s}}"
    ].join("");
    document.head.appendChild(style);
  }

  installStyles();
  Promise.all([loadConfig(), Promise.all(MEMES.map(function (meme) { return loadImage(meme.src); }))])
    .then(function (loaded) {
      config = loaded[0];
      images = loaded[1];
      buildInterface();
      prepareRound();
      state = "idle";
      cancelAnimationFrame(animationFrame);
      lastFrame = performance.now();
      animationFrame = requestAnimationFrame(frame);
    });
})();
