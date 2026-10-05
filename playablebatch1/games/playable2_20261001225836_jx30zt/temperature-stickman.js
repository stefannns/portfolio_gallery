(function () {
  "use strict";

  var root = document.getElementById("root");
  var heat = 50;
  var fed = 0;
  var drag = null;
  var reactionTimer = 0;

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
      '<circle cx="90" cy="36" r="29" fill="#fbfaf4"/>' +
      '<path d="M90 65 90 155M75 88 68 165 109 165 104 88M74 94 50 151M104 94 130 151M80 165 73 252M102 165 108 252M73 252q-14 6-25 4M108 252q14 6 25 4"/>' +
      '<ellipse cx="48" cy="156" rx="5" ry="9"/><ellipse cx="132" cy="156" rx="5" ry="9"/>' +
      '<path class="mouth" d="M80 48q10 12 20 0"/>' +
      '</g><circle cx="80" cy="31" r="3.4"/><circle cx="100" cy="31" r="3.4"/></svg>';
  }

  function render() {
    root.innerHTML = [
      '<main class="temperature-game">',
      '<div class="temperature-track" role="meter" aria-label="Stickman temperature" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">',
      '<span class="cold-label">COLD</span><span class="hot-label">HOT</span><div class="temperature-marker"></div>',
      '</div>',
      '<h1>Spicy Stickman</h1>',
      '<div class="reaction" aria-live="polite">Feed him! ↓</div>',
      stickmanSvg(),
      '<div class="food-controls">',
      '<button class="food-button ice-button" type="button" data-food="ice" aria-label="Drag ice cream to feed">' + foodSvg("ice", 92) + '<span>COOL</span></button>',
      '<button class="food-button chili-button" type="button" data-food="chili" aria-label="Drag chili pepper to feed">' + foodSvg("chili", 92) + '<span>HEAT</span></button>',
      '</div>',
      '<button class="reset-button" type="button" hidden>Reset</button>',
      '<div class="drag-food" aria-hidden="true"></div>',
      '</main>'
    ].join("");

    root.querySelectorAll(".food-button").forEach(function (button) {
      button.addEventListener("pointerdown", startDrag);
    });
    root.querySelector(".reset-button").addEventListener("click", reset);
    root.addEventListener("pointermove", moveDrag);
    root.addEventListener("pointerup", endDrag);
    root.addEventListener("pointercancel", cancelDrag);
    updateTemperature();
  }

  function positionFromEvent(event) {
    var bounds = root.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      width: bounds.width,
      height: bounds.height
    };
  }

  function startDrag(event) {
    event.preventDefault();
    var button = event.currentTarget;
    var point = positionFromEvent(event);
    drag = { kind: button.dataset.food, pointerId: event.pointerId, source: button };
    button.setPointerCapture(event.pointerId);
    button.classList.add("food-dragging");
    var ghost = root.querySelector(".drag-food");
    ghost.innerHTML = foodSvg(drag.kind, 92);
    ghost.classList.add("drag-visible");
    moveGhost(point.x, point.y);
  }

  function moveDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    var point = positionFromEvent(event);
    moveGhost(point.x, point.y);
  }

  function moveGhost(x, y) {
    var ghost = root.querySelector(".drag-food");
    ghost.style.left = x + "px";
    ghost.style.top = y + "px";
  }

  function finishDrag() {
    if (!drag) return;
    drag.source.classList.remove("food-dragging");
    root.querySelector(".drag-food").classList.remove("drag-visible");
    drag = null;
  }

  function endDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    var point = positionFromEvent(event);
    var hitsMouth = Math.abs(point.x - point.width / 2) < Math.max(50, point.width * 0.17) &&
      Math.abs(point.y - point.height * 0.39) < Math.max(65, point.height * 0.11);
    var kind = drag.kind;
    if (drag.source.hasPointerCapture(event.pointerId)) drag.source.releasePointerCapture(event.pointerId);
    finishDrag();
    if (hitsMouth) feed(kind);
  }

  function cancelDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishDrag();
  }

  function feed(kind) {
    heat = Math.max(0, Math.min(100, heat + (kind === "chili" ? 17 : -17)));
    fed += 1;
    updateTemperature();
    showReaction(kind === "chili" ? "Spicy! 🔥" : "So cool! ❄️", kind);
    root.querySelector(".reset-button").hidden = false;
    if (navigator.vibrate) navigator.vibrate(20);
  }

  function updateTemperature() {
    var meter = root.querySelector(".temperature-track");
    meter.setAttribute("aria-valuenow", String(heat));
    root.querySelector(".temperature-marker").style.left = "calc(" + heat + "% - 4px)";
    root.querySelector(".stickman").style.filter = heat < 34 ? "drop-shadow(0 0 10px #83cdf0)" : heat > 66 ? "drop-shadow(0 0 10px #e76e75)" : "none";
  }

  function showReaction(message, kind) {
    var reaction = root.querySelector(".reaction");
    reaction.textContent = message;
    reaction.className = "reaction reaction-pop " + kind;
    clearTimeout(reactionTimer);
    reactionTimer = window.setTimeout(function () {
      reaction.textContent = "Feed him! ↓";
      reaction.className = "reaction";
    }, 1100);
  }

  function reset() {
    heat = 50;
    fed = 0;
    updateTemperature();
    root.querySelector(".reaction").textContent = "Feed him! ↓";
    root.querySelector(".reaction").className = "reaction";
    root.querySelector(".reset-button").hidden = true;
  }

  function installStyles() {
    var style = document.createElement("style");
    style.textContent = [
      "*{box-sizing:border-box}",
      "html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}",
      "body{background:#f9f6ec;color:#1d2731;font-family:Arial,system-ui,sans-serif;overscroll-behavior:none}",
      "button{font:inherit}",
      ".temperature-game{position:relative;width:100%;max-width:520px;height:100%;margin:0 auto;overflow:hidden;background:#f9f6ec;touch-action:none;user-select:none}",
      ".temperature-track{position:absolute;top:max(40px,calc(env(safe-area-inset-top) + 20px));left:25px;right:25px;height:18px;border:2px solid #1d2731;border-radius:10px;background:linear-gradient(90deg,#9bd4fa,#f3eee8,#e8899c);box-shadow:0 3px 8px #0002}",
      ".temperature-marker{position:absolute;top:-2px;bottom:-2px;width:8px;border-radius:3px;background:#202020;box-shadow:0 0 0 2px #fff8}",
      ".cold-label,.hot-label{position:absolute;top:22px;font-size:9px;font-weight:900;letter-spacing:1.2px}.cold-label{left:2px;color:#3888b5}.hot-label{right:2px;color:#b63d52}",
      ".temperature-game h1{position:absolute;top:max(68px,calc(env(safe-area-inset-top) + 48px));left:25px;right:25px;margin:0;text-align:center;font-size:clamp(27px,7vw,36px);line-height:1.05}",
      ".reaction{position:absolute;top:max(113px,calc(env(safe-area-inset-top) + 93px));left:25px;right:25px;min-height:27px;text-align:center;font-size:19px;font-weight:800}",
      ".reaction.ice{color:#3e91bd}.reaction.chili{color:#c43e55}.reaction-pop{animation:reaction-pop .3s ease}",
      "@keyframes reaction-pop{0%{transform:scale(.75);opacity:.2}100%{transform:scale(1);opacity:1}}",
      ".stickman{position:absolute;width:min(48vw,190px);height:39%;left:50%;top:25%;transform:translateX(-50%);overflow:visible;transition:filter .25s ease}",
      ".food-controls{position:absolute;left:25px;right:25px;bottom:max(46px,calc(env(safe-area-inset-bottom) + 26px));display:flex;align-items:flex-end;justify-content:space-between}",
      ".food-button{width:104px;min-height:120px;padding:4px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;border:0;border-radius:18px;background:transparent;color:#34424b;font-weight:900;font-size:10px;letter-spacing:1px;cursor:grab;touch-action:none;transition:opacity .12s ease,background .12s ease}",
      ".food-button:active{background:#fff8}.food-button:focus-visible{outline:3px solid #222;outline-offset:2px}.food-dragging{opacity:.35}",
      ".reset-button{position:absolute;left:50%;bottom:max(40px,calc(env(safe-area-inset-bottom) + 20px));transform:translateX(-50%);min-width:88px;min-height:48px;padding:8px 15px;border:1px solid #c8cbd0;border-radius:12px;background:#fff;color:#333;font-weight:800;box-shadow:0 3px 10px #0001;cursor:pointer;touch-action:manipulation}",
      ".reset-button:focus-visible{outline:3px solid #222;outline-offset:2px}",
      ".drag-food{position:absolute;z-index:5;display:none;transform:translate(-50%,-55%);pointer-events:none;filter:drop-shadow(0 6px 6px #0004)}.drag-visible{display:block}",
      "@media(max-width:360px){.food-button{width:88px}.reset-button{min-width:76px}}",
      "@media(max-height:620px){.temperature-track{top:max(28px,calc(env(safe-area-inset-top) + 12px))}.temperature-game h1{top:max(54px,calc(env(safe-area-inset-top) + 38px))}.reaction{top:max(92px,calc(env(safe-area-inset-top) + 76px))}.stickman{top:23%;height:38%}.food-controls{bottom:max(26px,calc(env(safe-area-inset-bottom) + 12px))}.food-button{min-height:102px}.food-button svg{height:78px}.reset-button{bottom:max(28px,calc(env(safe-area-inset-bottom) + 12px))}}",
      "@media(prefers-reduced-motion:reduce){.reaction-pop{animation:none}.stickman{transition:none}}"
    ].join("");
    document.head.appendChild(style);
  }

  installStyles();
  render();
})();
