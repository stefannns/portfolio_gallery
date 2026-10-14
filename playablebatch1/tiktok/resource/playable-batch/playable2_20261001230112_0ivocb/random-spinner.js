(function () {
  "use strict";

  var root = document.getElementById("root");
  var palette = ["#1e5d68", "#d88957", "#34796d", "#8e4d76", "#d7aa45", "#5573a8"];
  var audioContext = null;

  function randomInt(max) {
    if (window.crypto && window.crypto.getRandomValues) {
      var value = new Uint32Array(1);
      window.crypto.getRandomValues(value);
      return value[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function playSelectionSound() {
    try {
      if (navigator.vibrate) navigator.vibrate(16);
      var audio = audioContext;
      if (!audio || audio.state !== "running") return;
      var oscillator = audio.createOscillator();
      var gain = audio.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(440, audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(700, audio.currentTime + 0.16);
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.05, audio.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.24);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.25);
    } catch (_) {}
  }

  function wheelGradient(count) {
    var step = 360 / count;
    var stops = [];
    for (var index = 0; index < count; index += 1) {
      stops.push(palette[index % palette.length] + " " + (index * step) + "deg " + ((index + 1) * step) + "deg");
    }
    return "conic-gradient(from " + (-step / 2) + "deg," + stops.join(",") + ")";
  }

  function buildLabels(options) {
    var step = 360 / options.length;
    return options.map(function (label, index) {
      var angle = index * step;
      var safeLabel = document.createElement("span");
      safeLabel.textContent = label;
      return '<span style="transform:rotate(' + angle + 'deg) translateY(var(--label-offset)) rotate(' + (-angle) + 'deg)">' + safeLabel.innerHTML + "</span>";
    }).join("");
  }

  function makeQuestionSpinner(section) {
    if (section.dataset.answerSpinnerReady === "true") return;

    var optionButtons = Array.prototype.slice.call(section.querySelectorAll("button"));
    if (optionButtons.length < 2) return;

    section.dataset.answerSpinnerReady = "true";
    var options = optionButtons.map(function (button) {
      return button.textContent.trim();
    });
    var nativeOptions = optionButtons[0].parentElement;
    nativeOptions.hidden = true;
    nativeOptions.classList.add("answer-spinner-native-options");
    nativeOptions.setAttribute("aria-hidden", "true");
    optionButtons.forEach(function (button) {
      button.tabIndex = -1;
      button.setAttribute("aria-hidden", "true");
    });

    var panel = document.createElement("div");
    panel.className = "answer-spinner-panel";
    panel.innerHTML = [
      '<div class="answer-spinner-wrap" aria-hidden="true">',
      '<div class="answer-spinner-pointer"></div>',
      '<div class="answer-spinner-wheel">',
      buildLabels(options),
      '<div class="answer-spinner-hub"></div>',
      '</div>',
      '</div>',
      '<div class="answer-spinner-result" aria-live="polite">The wheel will choose for you</div>',
      '<button class="answer-spinner-button" type="button">SPIN FOR AN ANSWER</button>'
    ].join("");
    nativeOptions.insertAdjacentElement("afterend", panel);

    var wheel = panel.querySelector(".answer-spinner-wheel");
    var result = panel.querySelector(".answer-spinner-result");
    var spinButton = panel.querySelector(".answer-spinner-button");
    var spinning = false;
    var rotation = 0;
    wheel.style.background = wheelGradient(options.length);

    spinButton.addEventListener("click", function () {
      if (spinning) return;
      spinning = true;
      try {
        var AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (AudioCtor) {
          audioContext = audioContext || new AudioCtor();
          if (audioContext.state === "suspended") audioContext.resume().catch(function () {});
        }
      } catch (_) {}

      var selected = randomInt(options.length);
      var step = 360 / options.length;
      var turns = 5 + randomInt(3);
      var landing = ((360 - selected * step) % 360 + 360) % 360;
      var current = ((rotation % 360) + 360) % 360;
      rotation += turns * 360 + ((landing - current + 360) % 360);
      var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var spinDuration = reducedMotion ? 350 : 2200;

      spinButton.disabled = true;
      spinButton.textContent = "SPINNING…";
      result.textContent = "Choosing a random answer…";
      wheel.style.transitionDuration = spinDuration + "ms";
      result.classList.remove("answer-spinner-result-selected");
      wheel.style.transform = "rotate(" + rotation + "deg)";

      window.setTimeout(function () {
        result.textContent = options[selected];
        result.classList.add("answer-spinner-result-selected");
        playSelectionSound();

        if (/^not yet$/i.test(options[selected])) {
          result.textContent = "Not yet born — spin again to begin";
          spinButton.textContent = "SPIN AGAIN";
          spinButton.disabled = false;
          spinning = false;
          return;
        }

        window.setTimeout(function () {
          optionButtons[selected].click();
        }, reducedMotion ? 180 : 520);
      }, spinDuration);
    });

    var footerHint = Array.prototype.slice.call(root.querySelectorAll("footer span")).find(function (node) {
      return /choose one answer/i.test(node.textContent);
    });
    if (footerHint) footerHint.textContent = "Spin the wheel to discover each answer";

    window.setTimeout(function () {
      spinButton.focus({ preventScroll: true });
    }, 0);
  }

  function scan() {
    var sections = root.querySelectorAll("section");
    var foundFate = false;
    for (var index = 0; index < sections.length; index += 1) {
      var section = sections[index];
      if (section.textContent.indexOf("YOUR FATE") === -1) {
        makeQuestionSpinner(section);
      } else {
        foundFate = true;
        section.classList.add("fate-result-panel");
      }
    }
    var main = root.querySelector("main");
    if (main) main.classList.toggle("answer-spinner-fate", foundFate);
  }

  function installStyles() {
    var style = document.createElement("style");
    style.textContent = [
      ".answer-spinner-native-options{display:none!important}",
      "#root>main{gap:clamp(6px,1.2vh,12px)!important}",
      "#root>main>header{min-height:48px!important}",
      "#root>main>header>img{width:46px!important;height:46px!important;flex:0 0 46px!important}",
      "#root>main>header>h1{font-size:clamp(26px,7vw,36px)!important}",
      "#root>main>div:nth-of-type(2){overflow:hidden!important}",
      ".answer-spinner-panel{display:flex;flex-direction:column;align-items:center;width:100%;margin-top:0}",
      ".answer-spinner-wrap{--wheel-size:min(55vw,29vh,205px);--label-offset:-62px;position:relative;width:var(--wheel-size);aspect-ratio:1;margin:0 auto 8px;filter:drop-shadow(0 7px 12px #0008)}",
      ".answer-spinner-pointer{position:absolute;z-index:3;top:-6px;left:50%;width:0;height:0;transform:translateX(-50%);border-left:14px solid transparent;border-right:14px solid transparent;border-top:28px solid #fff1b7;filter:drop-shadow(0 3px 2px #0008)}",
      ".answer-spinner-wheel{position:absolute;inset:0;border:6px solid #f0d17d;border-radius:50%;box-sizing:border-box;box-shadow:inset 0 0 0 4px #09262d,0 0 0 2px #fff3;transition:transform 2.2s cubic-bezier(.12,.7,.08,1);will-change:transform}",
      ".answer-spinner-wheel span{position:absolute;left:50%;top:50%;width:72px;min-height:26px;margin-left:-36px;margin-top:-13px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:clamp(8px,1.2vh,10px);font-weight:900;line-height:1.1;letter-spacing:.1px;text-align:center;text-shadow:0 2px 3px #000c;overflow-wrap:anywhere}",
      ".answer-spinner-hub{position:absolute;left:50%;top:50%;width:34px;height:34px;transform:translate(-50%,-50%);border:4px solid #fff0ba;border-radius:50%;background:#15333b;box-shadow:0 3px 8px #000b}",
      ".answer-spinner-result{display:flex;align-items:center;justify-content:center;width:100%;min-height:36px;margin:0 0 7px;padding:6px 9px;box-sizing:border-box;border:1px solid #72b7aa;border-radius:11px;background:#0a222a;color:#c7e8df;font-size:12px;font-weight:800;line-height:1.2;text-align:center;overflow-wrap:anywhere}",
      ".answer-spinner-result-selected{border-color:#f0d17d;background:#294347;color:#fff1b7}",
      ".answer-spinner-button{width:100%;min-height:48px;padding:8px 12px;border:0;border-radius:13px;background:#efd17d;color:#183439;font-size:clamp(12px,2.1vh,16px);font-weight:900;letter-spacing:.2px;box-shadow:0 4px 0 #92763b;cursor:pointer;touch-action:manipulation;transition:filter .12s ease,box-shadow .12s ease}",
      ".answer-spinner-button:active:not(:disabled){filter:brightness(.92);box-shadow:0 2px 0 #92763b}",
      ".answer-spinner-button:focus-visible{outline:3px solid #fff;outline-offset:3px}",
      ".answer-spinner-button:disabled{cursor:default;opacity:.7;box-shadow:0 2px 0 #92763b}",
      "@media (max-height:700px){#root>main>header{min-height:44px!important}#root>main>header>img{width:42px!important;height:42px!important;flex-basis:42px!important}.fate-enter:not(.fate-result-panel){display:grid!important;grid-template-columns:40% minmax(0,1fr);grid-template-rows:auto auto 1fr;column-gap:9px;align-items:start;padding:12px!important}.fate-enter:not(.fate-result-panel)>div:first-child{grid-column:1/-1;margin-bottom:5px!important}.fate-enter:not(.fate-result-panel)>h2{grid-column:1;grid-row:2;font-size:clamp(22px,5.7vw,28px)!important;line-height:1.03!important;margin:0 0 6px!important;overflow-wrap:anywhere}.fate-enter:not(.fate-result-panel)>p{grid-column:1;grid-row:3;font-size:clamp(11px,2.7vw,13px)!important;line-height:1.25!important;margin:0!important}.answer-spinner-panel{grid-column:2;grid-row:2/4;align-self:start}.answer-spinner-wrap{--wheel-size:min(34vw,25vh,138px);margin-bottom:5px}.answer-spinner-result{min-height:32px;margin-bottom:5px;padding:4px 6px;font-size:11px}.answer-spinner-button{min-height:44px;padding:5px 6px;font-size:12px;line-height:1.1}.fate-result-panel{padding:12px!important}.fate-result-panel>h2{font-size:clamp(27px,7vw,36px)!important;margin:4px 0 6px!important}.fate-result-panel>p{font-size:12px!important;line-height:1.25!important;margin:0 0 9px!important}.fate-result-panel>button{min-height:44px!important}.answer-spinner-fate>footer{display:none!important}}",
      "@media (max-height:520px){.answer-spinner-wrap{--wheel-size:min(28vw,20vh,112px)}.answer-spinner-wheel span{width:60px;margin-left:-30px;font-size:8px}.answer-spinner-hub{width:26px;height:26px}.fate-enter:not(.fate-result-panel)>h2{font-size:22px!important}.fate-result-panel>p{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.fate-result-panel>h2{font-size:27px!important}}",
      "@media (max-height:700px){.answer-spinner-wrap{--label-offset:-40px}}",
      "@media (max-height:520px){.answer-spinner-wrap{--label-offset:-30px}}",
      "@media (max-height:700px){.fate-result-panel{display:grid!important;grid-template-columns:minmax(0,.84fr) minmax(0,1.16fr);column-gap:10px;row-gap:4px;align-items:center}.fate-result-panel>div:first-child,.fate-result-panel>h2{grid-column:1/-1}.fate-result-panel>div:nth-of-type(2){grid-column:1;grid-row:3;font-size:11px!important;margin:0!important}.fate-result-panel>div:nth-of-type(3){grid-column:1;grid-row:4;height:12px!important}.fate-result-panel>div:nth-of-type(4){grid-column:1;grid-row:5;font-size:27px!important;margin:0!important}.fate-result-panel>p{grid-column:2;grid-row:3/6;font-size:11px!important;line-height:1.22!important;margin:0!important;overflow-wrap:anywhere}.fate-result-panel>button:first-of-type{grid-column:1;grid-row:6;font-size:14px!important}.fate-result-panel>button:first-of-type:last-of-type{grid-column:1/-1}.fate-result-panel>button:nth-of-type(2){grid-column:2;grid-row:6;margin-top:0!important;font-size:13px!important}}",
      "@media (max-height:520px){.fate-result-panel{grid-template-columns:minmax(0,.65fr) minmax(0,1.35fr);padding:10px!important;row-gap:2px}.fate-result-panel>p{display:block!important;-webkit-line-clamp:unset!important;overflow:visible!important;font-size:11px!important;line-height:1.15!important}.fate-result-panel>h2{font-size:23px!important}.fate-result-panel>div:nth-of-type(4){font-size:23px!important}}",
      "@media (prefers-reduced-motion:reduce){.answer-spinner-wheel{transition-duration:.35s}}"
    ].join("");
    document.head.appendChild(style);
  }

  installStyles();
  new MutationObserver(scan).observe(root, { childList: true, subtree: true });
  scan();
})();
