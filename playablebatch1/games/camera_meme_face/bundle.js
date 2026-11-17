/**
 * @file sfx.js
 * @description H5 Playable 静态音效控制运行时（全局 window.SFX）。
 *
 * 职责（前置静态化，免除业务代码手写 Web Audio 样板）：
 * 1. 全局首次手势自动解锁 AudioContext（capture 阶段监听 pointerdown / touchstart / keydown）；
 * 2. 注册期静默预拉取字节 + 利用 suspended AudioContext 提前预解码缓存 AudioBuffer（首次点击零延迟发声）；
 * 3. 解码期自动计算活跃采样 RMS 与 Peak，静态归一每条音效增益（拉齐不同素材音量并防削波）；
 * 4. 同 Key 重触发 15ms 快速淡出防叠音（Monophonic Retrigger）、高频触发节流（默认 90ms）、
 *    结果音单次锁（playOnce / { once: true } + reset）、切后台自动停播；
 * 5. 素材缺失 / 解码失败 / 显式 'buzzer' 时，自动回退内置 Web Audio OscillatorNode 蜂鸣器
 *    （按成功/失败/不同材质 key 哈希分流音高，保证听感统一且不重样）。
 */
(function (global) {
  'use strict';

  if (global.SFX && global.SFX.__isStaticSfxRuntime) {
    return;
  }

  var TARGET_RMS_ACTION = 0.14;
  var TARGET_RMS_RESULT = 0.17;
  var GAIN_MIN = 0.25;
  var GAIN_MAX = 2.8;
  var PEAK_LIMIT = 0.90;
  var DEFAULT_MIN_GAP_MS = 90;
  var RETRIGGER_FADE_S = 0.015;
  var VOICE_GAIN_SCALE = 1.0;

  var POSITIVE_RE = /(?:^|[^a-z])(win|won|victory|success|succeed|clear|cleared|pass|passed|correct|right|goal|complete|completed|reward|levelup|level_up|cheer|confirm|bingo)(?:$|[^a-z])/i;
  var NEGATIVE_RE = /(?:^|[^a-z])(fail|failed|failure|lose|lost|gameover|game_over|over|wrong|error|err|miss|missed|bad|dead|crash|penalty|timeout|alarm)(?:$|[^a-z])/i;
  var PENTATONIC_HZ = [293.66, 329.63, 392.00, 440.00, 493.88, 523.25];

  function isResultKey(key, url) {
    var text = String(key || '') + ' ' + String(url || '');
    return POSITIVE_RE.test(text) || NEGATIVE_RE.test(text);
  }

  function hashKey(str) {
    var s = String(str || 'tap');
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul ? Math.imul(h, 16777619) : (h * 16777619) | 0;
    }
    return Math.abs(h);
  }

  function computeNormGain(audioBuffer, isResult) {
    try {
      if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') {
        return 1.0;
      }
      var ch = audioBuffer.getChannelData(0);
      var len = ch ? ch.length : 0;
      if (!len) return 1.0;
      var sumSq = 0;
      var active = 0;
      var peak = 0;
      var step = len > 48000 ? Math.max(1, Math.floor(len / 24000)) : 1;
      for (var i = 0; i < len; i += step) {
        var v = Math.abs(ch[i]);
        if (v > peak) peak = v;
        if (v > 0.005) {
          sumSq += v * v;
          active++;
        }
      }
      if (peak < 0.001 || active === 0) return 1.0;
      var rms = Math.sqrt(sumSq / active);
      var sr = (typeof audioBuffer.sampleRate === 'number' && audioBuffer.sampleRate > 0)
        ? audioBuffer.sampleRate
        : 24000;
      var activeDur = (active * step) / sr;
      var target = isResult ? TARGET_RMS_RESULT : TARGET_RMS_ACTION;
      if (!isResult && activeDur > 0 && activeDur < 0.25) {
        var boost = Math.min(1.6, Math.sqrt(0.25 / Math.max(0.06, activeDur)));
        target = target * boost;
      }
      var gain = target / rms;
      var minGain = (!isResult && activeDur > 0 && activeDur < 0.25) ? 0.58 : GAIN_MIN;
      if (gain < minGain) gain = minGain;
      if (gain > GAIN_MAX) gain = GAIN_MAX;
      if (gain * peak > PEAK_LIMIT) {
        gain = PEAK_LIMIT / peak;
      }
      return gain;
    } catch (e) {
      return 1.0;
    }
  }

  var activeSources = [];
  var activeByKey = {};

  function fadeOutVoice(ctx, voice) {
    if (!voice || !voice.src) return;
    try {
      if (voice.gainNode && voice.gainNode.gain && ctx && typeof ctx.currentTime === 'number') {
        var t = ctx.currentTime;
        var g = voice.gainNode.gain;
        if (typeof g.cancelScheduledValues === 'function') {
          g.cancelScheduledValues(t);
        }
        if (typeof g.setValueAtTime === 'function') {
          g.setValueAtTime(Math.max(0.0001, g.value || 0.1), t);
        }
        if (typeof g.linearRampToValueAtTime === 'function') {
          g.linearRampToValueAtTime(0.0001, t + RETRIGGER_FADE_S);
        }
        try {
          voice.src.stop(t + RETRIGGER_FADE_S + 0.002);
          return;
        } catch (e2) {}
      }
      voice.src.stop();
    } catch (e) {}
  }

  function trackSource(key, src, gainNode) {
    var voice = { key: key || '', src: src, gainNode: gainNode || null };
    activeSources.push(src);
    if (key) {
      activeByKey[key] = voice;
    }
    src.onended = function () {
      var idx = activeSources.indexOf(src);
      if (idx !== -1) activeSources.splice(idx, 1);
      if (key && activeByKey[key] === voice) {
        delete activeByKey[key];
      }
    };
  }

  var SFX = {
    __isStaticSfxRuntime: true,
    ready: false,
    muted: false,
    ctx: null,
    urls: {},
    buffers: {},
    gains: {},
    configGains: {},
    rawBytes: {},
    fallbackKeys: {},
    lastPlay: {},
    playedOnce: {},
    nonGestureCount: {},
    activeByKey: activeByKey,

    _ensureCtx: function () {
      if (this.ctx) return this.ctx;
      try {
        var AudioCtx = global.AudioContext || global.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      } catch (e) {}
      return this.ctx;
    },

    register: function (map) {
      if (!map) return this;
      var self = this;
      if (Array.isArray(map)) {
        for (var i = 0; i < map.length; i++) {
          var item = map[i];
          if (item && item.id && (item.path || item.url)) {
            var k = String(item.id);
            self.urls[k] = String(item.path || item.url);
            if (typeof item.gain === 'number' && isFinite(item.gain)) {
              self.configGains[k] = Math.max(0.1, Math.min(3.0, item.gain));
            }
          }
        }
      } else if (typeof map === 'object') {
        var keys = Object.keys(map);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var val = map[key];
          // Older generated code sometimes copied a schema placeholder
          // literally as ``SFX.register({ key: './assets/sfx_x.mp3' })``.
          // Register the path as its own playable key so the clip still gets
          // prefetched; callers in those artifacts play the same path directly.
          // New code must use a semantic property such as ``{ click: path }``.
          if (key === 'key' && typeof val === 'string' && val) {
            self.urls[val] = val;
            continue;
          }
          if (typeof val === 'string' && val) {
            self.urls[key] = val;
          } else if (val && typeof val === 'object' && (val.path || val.url)) {
            self.urls[key] = String(val.path || val.url);
            if (typeof val.gain === 'number' && isFinite(val.gain)) {
              self.configGains[key] = Math.max(0.1, Math.min(3.0, val.gain));
            }
          }
        }
      }
      this._ensureCtx();
      var allKeys = Object.keys(self.urls);
      for (var m = 0; m < allKeys.length; m++) {
        var regKey = allKeys[m];
        self._prefetch(regKey);
        if (self.ctx) {
          self.load(regKey);
        }
      }
      return this;
    },

    init: function (map) {
      if (map) this.register(map);
      return this.unlock();
    },

    fromConfig: function (rawConfig) {
      if (rawConfig && rawConfig.sounds) {
        this.register(rawConfig.sounds);
      }
      return this;
    },

    _prefetch: function (key) {
      var url = this.urls[key];
      if (!url || this.rawBytes[key] || this.buffers[key] || this.fallbackKeys[key]) {
        return;
      }
      if (url === 'buzzer' || url.indexOf('buzzer:') === 0) {
        this.fallbackKeys[key] = true;
        return;
      }
      if (typeof fetch !== 'function') return;
      var self = this;
      try {
        this.rawBytes[key] = fetch(url)
          .then(function (res) {
            if (!res || !res.ok) {
              self.fallbackKeys[key] = true;
              return null;
            }
            return res.arrayBuffer();
          })
          .catch(function () {
            self.fallbackKeys[key] = true;
            return null;
          });
      } catch (e) {
        this.fallbackKeys[key] = true;
      }
    },

    unlock: function () {
      var self = this;
      try {
        var ctx = this._ensureCtx();
        if (!ctx) return Promise.resolve(false);
        var p = (ctx.state === 'suspended' && typeof ctx.resume === 'function')
          ? ctx.resume()
          : Promise.resolve();
        this.ready = true;
        var keys = Object.keys(this.urls);
        for (var i = 0; i < keys.length; i++) {
          this.load(keys[i]);
        }
        return Promise.resolve(p).then(function () {
          self.ready = true;
          return true;
        }).catch(function () {
          return false;
        });
      } catch (e) {
        this.ready = false;
        return Promise.resolve(false);
      }
    },

    ensure: function () {
      return this.unlock();
    },

    load: function (key) {
      var self = this;
      var ctx = this._ensureCtx();
      if (!ctx || this.buffers[key] || this.fallbackKeys[key]) {
        return Promise.resolve();
      }
      var url = this.urls[key];
      if (!url) return Promise.resolve();
      if (url === 'buzzer' || url.indexOf('buzzer:') === 0) {
        this.fallbackKeys[key] = true;
        return Promise.resolve();
      }
      this._prefetch(key);
      var bytePromise = this.rawBytes[key];
      if (!bytePromise) {
        this.fallbackKeys[key] = true;
        return Promise.resolve();
      }
      return bytePromise.then(function (ab) {
        var decodeCtx = self.ctx || self._ensureCtx();
        if (!ab || !decodeCtx) {
          self.fallbackKeys[key] = true;
          return;
        }
        if (self.buffers[key]) return;
        var copy = ab.slice ? ab.slice(0) : ab;
        return decodeCtx.decodeAudioData(copy).then(function (buf) {
          self.buffers[key] = buf;
          var norm = computeNormGain(buf, isResultKey(key, url));
          var cfgGain = self.configGains[key] || 1.0;
          self.gains[key] = norm * cfgGain;
        }).catch(function () {
          self.fallbackKeys[key] = true;
        });
      }).catch(function () {
        self.fallbackKeys[key] = true;
      });
    },

    play: function (keyOrUrl, opts) {
      if (this.muted) return;
      var key = String(keyOrUrl || '');
      if (!key) return;
      var options = opts || {};

      if (!this.urls[key] && (key.indexOf('./assets/') === 0 || key.indexOf('assets/') === 0)) {
        var map = {};
        map[key] = key.indexOf('./') === 0 ? key : './' + key;
        this.register(map);
      }

      var isGenericBuzzer = (key === 'buzzer');
      if (options.once && !isGenericBuzzer && this.playedOnce[key]) {
        return;
      }

      var burstCount = (this.nonGestureCount[key] || 0) + 1;
      if (burstCount > 6) {
        return;
      }

      var minGapMs = typeof options.minGapMs === 'number'
        ? options.minGapMs
        : (isGenericBuzzer ? 45 : (burstCount >= 2 ? 220 : DEFAULT_MIN_GAP_MS));
      var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      var last = this.lastPlay[key];
      if (typeof last === 'number' && now - last < minGapMs) {
        return;
      }
      this.lastPlay[key] = now;
      this.nonGestureCount[key] = burstCount;
      if (options.once && !isGenericBuzzer) {
        this.playedOnce[key] = true;
      }

      if (!this.ready || !this.ctx) {
        this.unlock();
      }
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
        this.ctx.resume().catch(function () {});
      }

      var buf = this.buffers[key];
      if (buf) {
        this._playBuffer(key, buf, options);
        return;
      }

      if (this.fallbackKeys[key] || key === 'buzzer' || !this.urls[key]) {
        this.playBuzzer(key, options);
        return;
      }

      var self = this;
      this.load(key).then(function () {
        if (self.muted) return;
        if (self.buffers[key]) {
          self._playBuffer(key, self.buffers[key], options);
        } else if (self.fallbackKeys[key]) {
          self.playBuzzer(key, options);
        }
      });
    },

    playOnce: function (key, opts) {
      var merged = {};
      if (opts && typeof opts === 'object') {
        var ks = Object.keys(opts);
        for (var i = 0; i < ks.length; i++) merged[ks[i]] = opts[ks[i]];
      }
      merged.once = true;
      this.play(key, merged);
    },

    _playBuffer: function (key, buf, options) {
      try {
        if (!options || options.overlap !== true) {
          var prevVoice = activeByKey[key];
          if (prevVoice) {
            delete activeByKey[key];
            fadeOutVoice(this.ctx, prevVoice);
          }
        }
        var src = this.ctx.createBufferSource();
        var gainNode = this.ctx.createGain();
        var baseGain = (typeof this.gains[key] === 'number' ? this.gains[key] : 1.0) * VOICE_GAIN_SCALE;
        if ((this.nonGestureCount[key] || 0) >= 4) {
          baseGain *= 0.65;
        }
        var rate = typeof options.rate === 'number' && isFinite(options.rate)
          ? Math.max(0.5, Math.min(2.0, options.rate))
          : 1.0;
        src.playbackRate.value = rate;
        gainNode.gain.value = Math.max(0.04, Math.min(2.2, baseGain));
        src.buffer = buf;
        src.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        trackSource(key, src, gainNode);
        src.start(0);
      } catch (e) {}
    },

    playBuzzer: function (key, opts) {
      if (this.muted) return;
      if (!this.ctx) this.unlock();
      if (!this.ctx) return;
      try {
        var ctx = this.ctx;
        var t0 = ctx.currentTime;
        var text = String(key || '') + ' ' + String(this.urls[key] || '');
        var trackKey = (key === 'buzzer') ? '' : key;
        var scale = VOICE_GAIN_SCALE;
        if (NEGATIVE_RE.test(text)) {
          this._synthNote(trackKey, 246.94, t0, 0.13, 'triangle', 0.18 * scale);
          this._synthNote('', 185.00, t0 + 0.12, 0.20, 'triangle', 0.18 * scale);
        } else if (POSITIVE_RE.test(text)) {
          this._synthNote(trackKey, 523.25, t0, 0.11, 'triangle', 0.18 * scale);
          this._synthNote('', 659.25, t0 + 0.10, 0.20, 'triangle', 0.18 * scale);
        } else {
          var freq = (opts && typeof opts.freq === 'number')
            ? opts.freq
            : PENTATONIC_HZ[hashKey(key) % PENTATONIC_HZ.length];
          this._synthNote(trackKey, freq, t0, 0.12, 'triangle', 0.16 * scale);
        }
      } catch (e) {}
    },

    _synthNote: function (key, freq, startTime, duration, type, peakGain) {
      try {
        var ctx = this.ctx;
        if (key && activeByKey[key]) {
          var prev = activeByKey[key];
          delete activeByKey[key];
          fadeOutVoice(ctx, prev);
        }
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        var dur = Math.max(0.06, duration || 0.12);
        var pk = peakGain || 0.16;
        osc.type = type || 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(pk, startTime + 0.008);
        gain.gain.setValueAtTime(pk * 0.82, startTime + Math.min(0.045, dur * 0.4));
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        trackSource(key, osc, gain);
        osc.start(startTime);
        osc.stop(startTime + dur + 0.01);
      } catch (e) {}
    },

    reset: function () {
      this.playedOnce = {};
      this.lastPlay = {};
      this.nonGestureCount = {};
    },

    stopAll: function () {
      var copy = activeSources.slice();
      activeSources.length = 0;
      var keys = Object.keys(activeByKey);
      for (var k = 0; k < keys.length; k++) {
        delete activeByKey[keys[k]];
      }
      for (var i = 0; i < copy.length; i++) {
        try { copy[i].stop(); } catch (e) {}
      }
    },

    setMuted: function (muted) {
      this.muted = !!muted;
      if (this.muted) this.stopAll();
    }
  };

  function bindGlobalUnlock() {
    if (typeof window === 'undefined') return;
    try {
      if (global.navigator && global.navigator.mediaDevices && typeof global.navigator.mediaDevices.getUserMedia === 'function') {
        var origGetUserMedia = global.navigator.mediaDevices.getUserMedia.bind(global.navigator.mediaDevices);
        global.navigator.mediaDevices.getUserMedia = function (constraints) {
          if (constraints && constraints.audio) {
            VOICE_GAIN_SCALE = 0.52;
          }
          return origGetUserMedia(constraints);
        };
      }
    } catch (e) {}
    if (!window.addEventListener) return;
    var events = ['pointerdown', 'touchstart', 'mousedown', 'keydown'];
    function onFirstGesture() {
      SFX.unlock();
      for (var i = 0; i < events.length; i++) {
        window.removeEventListener(events[i], onFirstGesture, true);
      }
    }
    for (var i = 0; i < events.length; i++) {
      window.addEventListener(events[i], onFirstGesture, true);
    }
    var gestureResetEvents = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'click'];
    function onUserGesture() {
      SFX.nonGestureCount = {};
    }
    for (var j = 0; j < gestureResetEvents.length; j++) {
      window.addEventListener(gestureResetEvents[j], onUserGesture, true);
    }
    var lastDragResetAt = 0;
    function onActiveDrag(ev) {
      if (ev && ev.type === 'pointermove' && !ev.buttons && ev.pointerType !== 'touch') {
        return;
      }
      var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (now - lastDragResetAt < 1200) return;
      lastDragResetAt = now;
      var keys = Object.keys(SFX.nonGestureCount);
      for (var k = 0; k < keys.length; k++) {
        if (SFX.nonGestureCount[keys[k]] > 1) {
          SFX.nonGestureCount[keys[k]] = 1;
        }
      }
    }
    window.addEventListener('pointermove', onActiveDrag, true);
    window.addEventListener('touchmove', onActiveDrag, true);
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          SFX.stopAll();
          if (SFX.ctx && SFX.ctx.state === 'running' && typeof SFX.ctx.suspend === 'function') {
            SFX.ctx.suspend().catch(function () {});
          }
        } else if (SFX.ready && SFX.ctx && SFX.ctx.state === 'suspended' && typeof SFX.ctx.resume === 'function') {
          SFX.ctx.resume().catch(function () {});
        }
      });
    }
  }

  bindGlobalUnlock();
  try {
    Object.defineProperty(global, 'SFX', {
      value: SFX,
      writable: false,
      configurable: false,
      enumerable: true
    });
  } catch (e) {
    global.SFX = SFX;
  }
})(typeof window !== 'undefined' ? window : globalThis);

(()=>{(()=>{"use strict";let l=document.getElementById("root"),ae=(e,o,t)=>Math.max(o,Math.min(t,e)),re=(e,o)=>e+Math.random()*(o-e),se=e=>e[Math.floor(Math.random()*e.length)],le=e=>e[e.length-1],ce=e=>{for(let o=e.length-1;o>0;o--){let t=Math.floor(Math.random()*(o+1));[e[o],e[t]]=[e[t],e[o]]}return e},L=[],I=[],C=!0,A=!1,p;function h(e,o,t,i){e.addEventListener(o,t,i),L.push(()=>e.removeEventListener(o,t,i))}function G(e,o,t="#faf8f1"){let i=document.createElement("style");i.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(i),l.style.background=t,l.innerHTML='<div class="fit">'+o+"</div>";let n=l.querySelector(".fit");function a(){let r=l.getBoundingClientRect(),c=Math.min(r.width/390,r.height/598);n.style.transform=`translate(${(r.width-390*c)/2}px,${(r.height-598*c)/2}px) scale(${c})`,l.dataset.layout=`${Math.round(r.width)}x${Math.round(r.height)}`}a(),h(window,"resize",a)}function s(e){return l.querySelector(e)}function J(){var e;(e=s(".guide"))==null||e.classList.add("gone")}function v(e){l.dataset.phase=e}function B(){O(),J()}function O(){try{p||(p=new(window.AudioContext||window.webkitAudioContext)),p.state==="suspended"&&p.resume().catch(()=>{})}catch{}}function y(e=450,o=.08,t=.18,i="sine",n=0){if(!(!p||!C))try{let a=p.createOscillator(),r=p.createGain(),c=p.currentTime;a.type=i,a.frequency.setValueAtTime(e,c),n&&a.frequency.exponentialRampToValueAtTime(Math.max(30,n),c+o),r.gain.setValueAtTime(.001,c),r.gain.exponentialRampToValueAtTime(t,c+.006),r.gain.exponentialRampToValueAtTime(.001,c+o),a.connect(r),r.connect(p.destination),a.start(c),a.stop(c+o+.02),a.onended=()=>{a.disconnect(),r.disconnect()}}catch{}}function pe(){y(523,.12,.18),setTimeout(()=>y(784,.17,.16),100)}function de(){y(180,.22,.18,"triangle",65)}function K(e){let o=0;function t(i){if(A)return;let n=Math.min(.035,(i-(o||i))/1e3);o=i,document.hidden||e(C?n:0,i/1e3),requestAnimationFrame(t)}requestAnimationFrame(t)}function ue(){let e=s("canvas.stage"),o=e.getContext("2d"),t=Math.min(2,window.devicePixelRatio||1);return e.width=390*t,e.height=598*t,o.scale(t,t),{canvas:e,ctx:o}}function fe(e,o=s("canvas.stage")){let t=o.getBoundingClientRect();return{x:(e.clientX-t.left)*390/t.width,y:(e.clientY-t.top)*598/t.height}}function F(e,o,t,i,n,a){a=Math.min(Math.abs(i)/2,Math.abs(n)/2,a),e.moveTo(o+a,t),e.lineTo(o+i-a,t),e.quadraticCurveTo(o+i,t,o+i,t+a),e.lineTo(o+i,t+n-a),e.quadraticCurveTo(o+i,t+n,o+i-a,t+n),e.lineTo(o+a,t+n),e.quadraticCurveTo(o,t+n,o,t+n-a),e.lineTo(o,t+a),e.quadraticCurveTo(o,t,o+a,t),e.closePath()}function he(e,o,t,i,n,a,r,c){e.beginPath(),F(e,o,t,i,n,a),r&&(e.fillStyle=r,e.fill()),c&&(e.strokeStyle=c,e.stroke())}function me(e,o,t,i,n,a){e.beginPath(),e.arc(o,t,Math.max(.01,i),0,Math.PI*2),n&&(e.fillStyle=n,e.fill()),a&&(e.strokeStyle=a,e.stroke())}function ge(e,o,t,i,n,a,r=2){e.beginPath(),e.moveTo(o,t),e.lineTo(i,n),e.strokeStyle=a,e.lineWidth=r,e.stroke()}function xe(e,o,t,i,n=18,a="#25252a",r="UIBody",c="center"){e.font=`700 ${n}px ${r}`,e.fillStyle=a,e.textAlign=c,e.textBaseline="middle",e.fillText(o,t,i)}let N=[];function M(e){let o=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(U(o,e))}function q(e){let o=new Image;return o.onerror=()=>{l.dataset.assetIssue="image"},o.src=M(e),N.push({im:o,path:e}),o}function j(e,o,t,i,n,a){if(!o)return!1;let r=o.videoWidth||o.naturalWidth||o.width,c=o.videoHeight||o.naturalHeight||o.height;if(!r||!c)return!1;let d=Math.max(n/r,a/c);return e.save(),e.beginPath(),e.rect(t,i,n,a),e.clip(),e.drawImage(o,t+(n-r*d)/2,i+(a-c*d)/2,r*d,c*d),e.restore(),!0}function be(e,o,t,i,n){e.save(),e.beginPath(),e.arc(t,i,n,0,Math.PI*2),e.clip(),j(e,o,t-n,i-n,n*2,n*2),e.restore()}function ve(e,o,t,i){let n=s(".modal");if(!n)return;n.hidden=!1,n.querySelector("h2").textContent=e,n.querySelector(".value").textContent=o,n.querySelector("p").textContent=t;let a=n.querySelector("button");a.onclick=()=>{n.hidden=!0,B(),i()},v("result")}function ye(e="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function Z(){let e=s(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let V=[];function W(e){C=e,e||p==null||p.suspend().catch(()=>{});for(let o of V)o(e)}h(window,"message",e=>{var o;e.source===parent&&((o=e.data)==null?void 0:o.type)==="playable-active"&&W(e.data.active===!0)}),h(document,"visibilitychange",()=>{W(!document.hidden)}),h(window,"pagehide",()=>{A=!0,L.splice(0).forEach(e=>e()),I.splice(0).forEach(e=>e()),p==null||p.close().catch(()=>{})});let H={};function U(e,o){return H[e]??o}async function X(e=()=>{}){let o=new AbortController,t=setTimeout(()=>o.abort(),1600);try{let i=await fetch("./game.config.json",{signal:o.signal});if(!i.ok)throw Error("Config unavailable");let n=await i.json();for(let a of["texts","tweaks","images"])for(let r of n[a]||[])H[r.id]=a==="images"?r.path:r.value;for(let a of N){let r=M(a.path);a.im.getAttribute("src")!==r&&(a.im.src=r)}for(let a of l.querySelectorAll('img[src^="./assets/"]'))a.src=M(a.getAttribute("src"));e(),l.dataset.config="loaded"}catch{l.dataset.config="defaults"}finally{clearTimeout(t)}}let g=null,z="user",x=!1,T=0,R=!1,Q=new URLSearchParams(location.search).get("lang")==="it"||document.documentElement.lang==="it",u=(e,o)=>Q?o:e;function w(){let e=s("video.preview");return R&&(g!=null&&g.getVideoTracks().some(o=>o.readyState==="live"&&o.enabled))&&(e==null?void 0:e.readyState)>=2&&e.videoWidth>0&&e.videoHeight>0?e:null}function k(e,o){l.dataset.camera=e;let t=s(".cam-status"),i=s(".cam-enable");t&&(t.textContent=o),i&&(i.disabled=!1,i.setAttribute("aria-pressed",String(e==="enabled")),i.textContent=x?u("Connecting\u2026 \xB7 Cancel","Connessione\u2026 \xB7 Annulla"):e==="enabled"?u("Camera on \xB7 Stop","Fotocamera attiva \xB7 Stop"):u("Enable camera","Attiva fotocamera"));for(let n of l.querySelectorAll(".shutter,.cam-capture"))n.disabled=!w();S()}function b(){T++,R=!1,x=!1;let e=g;g=null,e==null||e.getTracks().forEach(t=>t.stop());let o=s("video.preview");o&&(o.pause(),o.srcObject=null),k("idle",u("Enable your camera to take a photo","Attiva la fotocamera per scattare una foto"))}async function _(){var t;if(x)return;b();let e=++T;x=!0,k("requesting",u("Waiting for your camera\u2026","In attesa della fotocamera\u2026"));let o;try{if(!((t=navigator.mediaDevices)!=null&&t.getUserMedia))throw Error("Camera API unavailable");if(o=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:z}},audio:!1}),A||!C||e!==T){o.getTracks().forEach(a=>a.stop());return}g=o;let i=s("video.preview");i.muted=!0,i.playsInline=!0,i.srcObject=o;let n;try{await Promise.race([i.play(),new Promise((a,r)=>{n=setTimeout(()=>r(Error("Camera playback did not start")),7e3)})])}finally{clearTimeout(n)}if(await new Promise((a,r)=>{let c,d=()=>{clearTimeout(c),i.removeEventListener("loadeddata",m),i.removeEventListener("canplay",m)},m=()=>{i.readyState>=2&&i.videoWidth>0&&i.videoHeight>0&&(d(),a())};i.addEventListener("loadeddata",m),i.addEventListener("canplay",m),c=setTimeout(()=>{d(),r(Error("No camera frame received"))},7e3),m()}),A||!C||e!==T){o.getTracks().forEach(a=>a.stop());return}R=!0,x=!1;for(let a of o.getVideoTracks())h(a,"ended",()=>{g===o&&(b(),k("unavailable",u("Camera disconnected \xB7 try again","Fotocamera scollegata \xB7 riprova")))});k("enabled",u("Camera ready \xB7 take a photo","Fotocamera pronta \xB7 scatta una foto"))}catch(i){if(o==null||o.getTracks().forEach(a=>a.stop()),e!==T)return;b();let n=(i==null?void 0:i.name)==="NotAllowedError"||(i==null?void 0:i.name)==="SecurityError";k("unavailable",n?u("Camera access is blocked \xB7 allow it and retry","Accesso alla fotocamera bloccato \xB7 consenti e riprova"):u("No camera image received \xB7 try again","Nessuna immagine dalla fotocamera \xB7 riprova"))}}function ee(e=600,o=800,t=!0){let i=w();if(!i)return null;let n=document.createElement("canvas");n.width=e,n.height=o;let a=n.getContext("2d");return t&&z==="user"&&(a.translate(e,0),a.scale(-1,1)),j(a,i,0,0,e,o)?n:null}function te(e,o="#f0ede5"){let t=e.getContext("2d"),i=e.width,n=e.height;t.fillStyle=o,t.fillRect(0,0,i,n);let a=w();if(a){t.save(),z==="user"&&(t.translate(i,0),t.scale(-1,1)),j(t,a,0,0,i,n),t.restore();return}t.save(),t.translate(i/2,n/2-8);let r=Math.min(i,n)/160;t.scale(r,r),t.strokeStyle="#767268",t.lineWidth=3,t.lineJoin="round",t.beginPath(),F(t,-29,-19,58,38,6),t.stroke(),t.beginPath(),t.arc(0,0,10,0,Math.PI*2),t.stroke(),t.beginPath(),t.moveTo(-17,-19),t.lineTo(-12,-27),t.lineTo(12,-27),t.lineTo(17,-19),t.stroke(),t.restore(),t.fillStyle="#68645b",t.font=`500 ${Math.max(15,i/23)}px UIBody,Arial`,t.textAlign="center",t.textBaseline="middle",t.fillText(x?u("Connecting\u2026","Connessione\u2026"):u("Your camera image","La tua fotocamera"),i/2,n/2+Math.min(i,n)*.25)}function oe(){var o;(o=s("video.preview"))==null||o.setAttribute("aria-hidden","true");let e=document.createElement("style");e.textContent='.preview{display:block!important;position:absolute!important;width:1px!important;height:1px!important;left:0;bottom:0;opacity:.001;pointer-events:none}.cam-enable[aria-pressed="true"]{border-color:#47754b;background:#edf5e9;color:#315b35}',document.head.append(e),h(s(".cam-enable"),"click",()=>{O(),g||x?b():_()}),s(".cam-flip")&&h(s(".cam-flip"),"click",()=>{z=z==="user"?"environment":"user",b(),_()}),V.push(t=>{t||b()}),I.push(b),k("idle",u("Enable your camera to take a photo","Attiva la fotocamera per scattare una foto"))}function D(){let e=String(U("PAPER_BACKDROP","./assets/paper-print-v1.svg"));l.style.backgroundColor="#e9e0c7",l.style.backgroundImage="url("+JSON.stringify(e)+")",l.style.backgroundSize="256px 256px",l.style.backgroundRepeat="repeat"}function ie(){D();let e=document.createElement("style");e.textContent=`#root{position:relative;isolation:isolate;color:#282723}
 #root .fit{background:transparent!important}
 #root .paper-overlay{position:absolute;inset:0;z-index:40;background:#28272338;pointer-events:auto;isolation:isolate}
 #root .paper-overlay[hidden]{display:none!important}
 #root .paper-result-fit{position:absolute;width:390px;height:598px;transform-origin:0 0;font-family:UIBody,system-ui,sans-serif;pointer-events:auto}
 #root .paper-result-fit .modal{background:transparent}
 #root .result,#root .comparison,#root .strip-view{background:#fbf7e9;color:#282723;border:2px solid #282723;border-radius:12px;box-shadow:4px 5px 0 #28272322}
 #root .pill{background:#282723;color:#fff9e9;border:2px solid #282723;box-shadow:0 3px 0 #28272325}
 #root .capability,#root .stop-sugar{color:#282723;background:#fbf7e9;border:2px solid #282723;box-shadow:0 2px 0 #2827231c}
 #root .capability:disabled,#root .pill:disabled{box-shadow:none}
 #root .shutter{border-color:#282723;background:#fbf7e9}
 #root .eyebrow,#root .booth-label,#root .guide{color:#282723}
 #root .cam-status,#root .mic-status,#root .target-label{color:#625c4b}
 #root .pose-pair .meme-reference,#root .pose-pair .live{border:2px solid #282723;border-radius:7px;box-shadow:3px 4px 0 #2827231e}#root .shutter{box-shadow:inset 0 0 0 5px #e9e0c7}#root .pair canvas,#root .pair img{border:1px solid #28272340;border-radius:3px}`,document.head.append(e);let o=l.querySelector(".fit"),t=o.querySelector(".comparison,.strip-view,.modal");if(!t)return;let i=document.createElement("div"),n=document.createElement("div");i.className="paper-overlay",n.className="paper-result-fit",i.hidden=t.hidden,n.append(t),i.append(n),l.append(i),t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true");function a(){i.hidden=t.hidden,o.inert=!t.hidden}let r=new MutationObserver(a);r.observe(t,{attributes:!0,attributeFilter:["hidden"]});function c(){let m=l.getBoundingClientRect(),$=Math.min(m.width/390,m.height/598),Y=`translate(${(m.width-390*$)/2}px,${(m.height-598*$)/2}px) scale(${$})`;n.style.transform=Y,o.style.transform=Y}a(),c(),h(window,"resize",c);let d=typeof ResizeObserver=="function"?new ResizeObserver(c):null;d==null||d.observe(l),I.push(()=>{r.disconnect(),d==null||d.disconnect()})}G("body{color:#292922}.fit{background:#e6e4dc}.eyebrow{position:absolute;top:58px;width:100%;text-align:center;letter-spacing:2.5px;font-size:10px}.meme-reference{position:absolute;left:78px;top:95px;width:234px;height:165px;object-fit:cover;border:8px solid #faf9f1;box-shadow:0 2px 7px #4442;transform:rotate(-3deg)}.live{position:absolute;left:78px;top:294px;width:234px;height:160px;border:8px solid #faf9f1;box-shadow:0 2px 7px #4442;transform:rotate(2deg);background:#d2cfc4;overflow:hidden}.live canvas{width:100%;height:100%;object-fit:cover}.preview{display:none}.guide{top:272px;font-size:16px}.shutter{position:absolute;left:168px;top:480px;border:3px solid #292922;background:#fff;width:54px;height:54px;border-radius:50%;box-shadow:inset 0 0 0 5px #e6e4dc}.cam-status{bottom:122px;font-size:11px}.bottom{bottom:18px}.comparison{position:absolute;inset:80px 30px 105px;z-index:15;background:#f9f7ef;padding:22px 14px;box-shadow:0 4px 20px #0002;text-align:center}.comparison[hidden]{display:none}.comparison h2{font-size:24px;margin:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:24px 0}.pair canvas,.pair img{width:100%;height:205px;object-fit:cover}.pair small{display:block;text-transform:uppercase;letter-spacing:2px;font-size:9px;margin:8px}.countdown{position:absolute;top:350px;width:100%;text-align:center;z-index:12;font-size:60px;font-weight:800;color:white;text-shadow:0 2px 5px #0008}",'<div class="eyebrow">MAKE THAT FACE</div><div class="pose-pair"><img class="meme-reference" alt="Expression to imitate" src="./assets/meme-1.webp"><div class="guide">Match the face \xB7 take a selfie</div><div class="live"><canvas class="selfie" width="400" height="400"></canvas><div class="countdown"></div></div></div><video class="preview" playsinline autoplay muted></video><div class="status cam-status">Enable your camera to take a photo</div><div class="bottom"><button class="capability cam-enable">Enable camera</button><button class="shutter" aria-label="Take photo" hidden disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/></svg><span class="shutter-label">Take photo</span></button></div><section class="comparison" hidden><div class="smallcaps">Challenge complete</div><h2>Your mimic</h2><div class="pair"><div><small>Original</small><img alt="Original expression"></div><div><small>You</small><canvas width="320" height="320"></canvas></div></div><button class="pill next">Next expression</button></section><div class="flash"></div>',"#e6e4dc"),ie();let E=0,f=-1,P=!1;function S(){let e=!!w(),o=s(".cam-enable"),t=s(".shutter");if(!o||!t)return;o.hidden=e,t.hidden=!e,t.disabled=!e||f>=0||P;let i=u("Take photo","Scatta foto"),n=s(".shutter-label");n&&n.textContent!==i&&(n.textContent=i),t.getAttribute("aria-label")!==i&&t.setAttribute("aria-label",i)}let ne=[q("./assets/meme-1.webp"),q("./assets/meme-2.webp"),q("./assets/meme-3.webp")];oe(),h(s(".shutter"),"click",()=>{P||f>=0||!w()||(B(),f=3,S(),v("countdown"),y(550,.06,.12))}),h(s(".next"),"click",()=>{B(),E=(E+1)%3,P=!1,s(".comparison").hidden=!0,s(".meme-reference").src=M(`./assets/meme-${E+1}.webp`),S(),v("ready")}),K(e=>{if(S(),te(s(".selfie"),"#f0ede5"),f>=0){if(!w()){f=-1,s(".countdown").textContent="",v("ready");return}let o=Math.ceil(f);if(f-=e,s(".countdown").textContent=f>0?Math.ceil(f):"",Math.ceil(f)<o&&f>0&&y(550,.05,.1),f<=0){f=-1;let t=ee(320,320);if(!t)return;P=!0,Z(),y(120,.08,.18,"triangle",70),s(".pair canvas").getContext("2d").drawImage(t,0,0),s(".pair img").src=ne[E].src,s(".comparison").hidden=!1,v("comparison")}}}),v("ready"),X(()=>{D(),s(".guide")&&(s(".guide").textContent=String(U("GUIDE","Match the expression \xB7 take a selfie")))})})();(()=>{let l=document.createElement("style");l.dataset.batch3Ui="20261116",l.textContent=`
@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:UIBody;src:url('./assets/ui/Poppins-Bold.woff2') format('woff2');font-weight:600 900;font-style:normal;font-display:swap}
html,body,#root{font-family:UIBody,system-ui,sans-serif;-webkit-text-size-adjust:100%}
button{font-family:UIBody,system-ui,sans-serif;font-size:16px;font-weight:700;line-height:1.3;min-height:44px}
button:focus-visible{outline:3px solid currentColor;outline-offset:4px}
button:disabled{opacity:.55}
[hidden]{display:none!important}
.guide{font-size:18px;line-height:1.4;text-wrap:balance}
.hud{top:30px;left:30px;right:30px;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}
.hud.center{justify-content:center}
.bottom{bottom:50px;left:30px;right:30px;gap:10px}
.bottom .capability{min-height:44px;padding:10px 14px;font-size:14px;line-height:1.25;white-space:normal}
.status{font-size:13px;line-height:1.4;bottom:108px;text-wrap:balance}
.pill{font-size:16px;line-height:1.3;min-height:44px;padding:11px 22px}
.modal{padding:30px 30px 50px}
.result{max-height:100%;overflow-y:auto;padding:28px 22px}
.result h2{font-family:Playful,UIBody,sans-serif;font-size:24px;line-height:1.25;text-wrap:balance;overflow-wrap:anywhere}
.result p{font-size:15px;line-height:1.6;overflow-wrap:anywhere}
.result .value{line-height:1.2;overflow-wrap:anywhere}
.smallcaps{font-size:12px;letter-spacing:1.4px;line-height:1.4}

.fit{font-family:UIBody,system-ui,sans-serif}
.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}
.capability,.pill{font-family:UIBody,system-ui,sans-serif}

.eyebrow{top:30px;font-size:12px;line-height:1.4;letter-spacing:2px}
.meme-reference{top:90px;height:150px}
.guide{top:249px;font-size:18px;line-height:1.4}
.live{top:283px;height:153px}
.shutter{top:450px;width:50px;height:50px;left:170px}
.cam-status{top:62px;bottom:auto;font-size:12px;color:#655f54;line-height:1.4}
.comparison{inset:30px 30px 50px;padding:26px 18px;overflow:auto;border-radius:16px}
.comparison h2{font:600 24px/1.3 Playful,UIBody,sans-serif;margin:10px 0 16px}
.pair{gap:12px;margin:18px 0 24px}.pair canvas,.pair img{height:220px}
.pair small{font-size:12px;letter-spacing:1px;margin:8px 0}
`,document.head.append(l)})();(()=>{let l=document.createElement("style");l.textContent=".pose-pair{position:absolute;left:30px;right:30px;top:88px;bottom:128px;display:grid;grid-template-rows:minmax(0,1fr) auto minmax(0,1fr);justify-items:center;gap:10px}.pose-pair .meme-reference,.pose-pair .live{position:relative;inset:auto;display:block;width:auto;height:100%;max-width:100%;aspect-ratio:1;border:0;border-radius:8px;object-fit:cover;transform:none;box-shadow:0 2px 7px #4442}.pose-pair .live canvas{width:100%;height:100%;object-fit:cover}.pose-pair .guide{position:static;inset:auto;width:100%;margin:0;font-size:17px;line-height:1.35}.live .countdown{position:absolute;inset:0;display:grid;place-items:center;font-size:54px;pointer-events:none}.bottom{bottom:50px;gap:0;min-height:48px;justify-content:center}#root .bottom .shutter,#root .bottom .cam-enable{position:static;inset:auto;flex:0 1 230px;width:230px;max-width:100%;height:auto;min-height:48px;margin:0;padding:10px 18px;font-size:16px;line-height:1.3}#root .bottom .shutter{display:flex;align-items:center;justify-content:center;gap:10px;border:2px solid #282723;border-radius:24px;box-shadow:0 2px 0 #2827231c;background:#fbf7e9;color:#282723}#root .bottom .shutter svg{width:22px;height:22px;flex:none}#root .bottom [hidden]{display:none!important}.cam-status{top:54px;font-size:12px;line-height:1.3}.pair canvas,.pair img{height:auto;aspect-ratio:1;object-fit:cover}",document.head.append(l)})();})();
