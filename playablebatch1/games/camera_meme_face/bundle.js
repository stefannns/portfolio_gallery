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

(()=>{(()=>{"use strict";let r=document.getElementById("root"),ne=(e,t,o)=>Math.max(t,Math.min(o,e)),ae=(e,t)=>e+Math.random()*(t-e),se=e=>e[Math.floor(Math.random()*e.length)],re=e=>e[e.length-1],le=e=>{for(let t=e.length-1;t>0;t--){let o=Math.floor(Math.random()*(t+1));[e[t],e[o]]=[e[o],e[t]]}return e},$=[],P=[],k=!0,E=!1,p;function h(e,t,o,i){e.addEventListener(t,o,i),$.push(()=>e.removeEventListener(t,o,i))}function Y(e,t,o="#faf8f1"){let i=document.createElement("style");i.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(i),r.style.background=o,r.innerHTML='<div class="fit">'+t+"</div>";let a=r.querySelector(".fit");function n(){let s=r.getBoundingClientRect(),l=Math.min(s.width/390,s.height/598);a.style.transform=`translate(${(s.width-390*l)/2}px,${(s.height-598*l)/2}px) scale(${l})`,r.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}n(),h(window,"resize",n)}function c(e){return r.querySelector(e)}function G(){var e;(e=c(".guide"))==null||e.classList.add("gone")}function v(e){r.dataset.phase=e}function S(){L(),G()}function L(){try{p||(p=new(window.AudioContext||window.webkitAudioContext)),p.state==="suspended"&&p.resume().catch(()=>{})}catch{}}function y(e=450,t=.08,o=.18,i="sine",a=0){if(!(!p||!k))try{let n=p.createOscillator(),s=p.createGain(),l=p.currentTime;n.type=i,n.frequency.setValueAtTime(e,l),a&&n.frequency.exponentialRampToValueAtTime(Math.max(30,a),l+t),s.gain.setValueAtTime(.001,l),s.gain.exponentialRampToValueAtTime(o,l+.006),s.gain.exponentialRampToValueAtTime(.001,l+t),n.connect(s),s.connect(p.destination),n.start(l),n.stop(l+t+.02),n.onended=()=>{n.disconnect(),s.disconnect()}}catch{}}function ce(){y(523,.12,.18),setTimeout(()=>y(784,.17,.16),100)}function pe(){y(180,.22,.18,"triangle",65)}function J(e){let t=0;function o(i){if(E)return;let a=Math.min(.035,(i-(t||i))/1e3);t=i,document.hidden||e(k?a:0,i/1e3),requestAnimationFrame(o)}requestAnimationFrame(o)}function de(){let e=c("canvas.stage"),t=e.getContext("2d"),o=Math.min(2,window.devicePixelRatio||1);return e.width=390*o,e.height=598*o,t.scale(o,o),{canvas:e,ctx:t}}function ue(e,t=c("canvas.stage")){let o=t.getBoundingClientRect();return{x:(e.clientX-o.left)*390/o.width,y:(e.clientY-o.top)*598/o.height}}function O(e,t,o,i,a,n){n=Math.min(Math.abs(i)/2,Math.abs(a)/2,n),e.moveTo(t+n,o),e.lineTo(t+i-n,o),e.quadraticCurveTo(t+i,o,t+i,o+n),e.lineTo(t+i,o+a-n),e.quadraticCurveTo(t+i,o+a,t+i-n,o+a),e.lineTo(t+n,o+a),e.quadraticCurveTo(t,o+a,t,o+a-n),e.lineTo(t,o+n),e.quadraticCurveTo(t,o,t+n,o),e.closePath()}function fe(e,t,o,i,a,n,s,l){e.beginPath(),O(e,t,o,i,a,n),s&&(e.fillStyle=s,e.fill()),l&&(e.strokeStyle=l,e.stroke())}function he(e,t,o,i,a,n){e.beginPath(),e.arc(t,o,Math.max(.01,i),0,Math.PI*2),a&&(e.fillStyle=a,e.fill()),n&&(e.strokeStyle=n,e.stroke())}function me(e,t,o,i,a,n,s=2){e.beginPath(),e.moveTo(t,o),e.lineTo(i,a),e.strokeStyle=n,e.lineWidth=s,e.stroke()}function ge(e,t,o,i,a=18,n="#25252a",s="UIBody",l="center"){e.font=`700 ${a}px ${s}`,e.fillStyle=n,e.textAlign=l,e.textBaseline="middle",e.fillText(t,o,i)}let F=[];function A(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(B(t,e))}function I(e){let t=new Image;return t.onerror=()=>{r.dataset.assetIssue="image"},t.src=A(e),F.push({im:t,path:e}),t}function q(e,t,o,i,a,n){if(!t)return!1;let s=t.videoWidth||t.naturalWidth||t.width,l=t.videoHeight||t.naturalHeight||t.height;if(!s||!l)return!1;let d=Math.max(a/s,n/l);return e.save(),e.beginPath(),e.rect(o,i,a,n),e.clip(),e.drawImage(t,o+(a-s*d)/2,i+(n-l*d)/2,s*d,l*d),e.restore(),!0}function xe(e,t,o,i,a){e.save(),e.beginPath(),e.arc(o,i,a,0,Math.PI*2),e.clip(),q(e,t,o-a,i-a,a*2,a*2),e.restore()}function be(e,t,o,i){let a=c(".modal");if(!a)return;a.hidden=!1,a.querySelector("h2").textContent=e,a.querySelector(".value").textContent=t,a.querySelector("p").textContent=o;let n=a.querySelector("button");n.onclick=()=>{a.hidden=!0,S(),i()},v("result")}function ve(e="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function K(){let e=c(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let N=[];function V(e){k=e,e||p==null||p.suspend().catch(()=>{});for(let t of N)t(e)}h(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&V(e.data.active===!0)}),h(document,"visibilitychange",()=>{V(!document.hidden)}),h(window,"pagehide",()=>{E=!0,$.splice(0).forEach(e=>e()),P.splice(0).forEach(e=>e()),p==null||p.close().catch(()=>{})});let W={};function B(e,t){return W[e]??t}async function X(e=()=>{}){let t=new AbortController,o=setTimeout(()=>t.abort(),1600);try{let i=await fetch("./game.config.json",{signal:t.signal});if(!i.ok)throw Error("Config unavailable");let a=await i.json();for(let n of["texts","tweaks","images"])for(let s of a[n]||[])W[s.id]=n==="images"?s.path:s.value;for(let n of F){let s=A(n.path);n.im.getAttribute("src")!==s&&(n.im.src=s)}for(let n of r.querySelectorAll('img[src^="./assets/"]'))n.src=A(n.getAttribute("src"));e(),r.dataset.config="loaded"}catch{r.dataset.config="defaults"}finally{clearTimeout(o)}}let g=null,C="user",x=!1,z=0,U=!1,Z=new URLSearchParams(location.search).get("lang")==="it"||document.documentElement.lang==="it",u=(e,t)=>Z?t:e;function T(){let e=c("video.preview");return U&&(g!=null&&g.getVideoTracks().some(t=>t.readyState==="live"&&t.enabled))&&(e==null?void 0:e.readyState)>=2&&e.videoWidth>0&&e.videoHeight>0?e:null}function w(e,t){r.dataset.camera=e;let o=c(".cam-status"),i=c(".cam-enable");o&&(o.textContent=t),i&&(i.disabled=!1,i.setAttribute("aria-pressed",String(e==="enabled")),i.textContent=x?u("Connecting\u2026 \xB7 Cancel","Connessione\u2026 \xB7 Annulla"):e==="enabled"?u("Camera on \xB7 Stop","Fotocamera attiva \xB7 Stop"):u("Enable camera","Attiva fotocamera"));for(let a of r.querySelectorAll(".shutter,.cam-capture"))a.disabled=!T()}function b(){z++,U=!1,x=!1;let e=g;g=null,e==null||e.getTracks().forEach(o=>o.stop());let t=c("video.preview");t&&(t.pause(),t.srcObject=null),w("idle",u("Enable your camera to take a photo","Attiva la fotocamera per scattare una foto"))}async function H(){var o;if(x)return;b();let e=++z;x=!0,w("requesting",u("Waiting for your camera\u2026","In attesa della fotocamera\u2026"));let t;try{if(!((o=navigator.mediaDevices)!=null&&o.getUserMedia))throw Error("Camera API unavailable");if(t=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:C}},audio:!1}),E||!k||e!==z){t.getTracks().forEach(n=>n.stop());return}g=t;let i=c("video.preview");i.muted=!0,i.playsInline=!0,i.srcObject=t;let a;try{await Promise.race([i.play(),new Promise((n,s)=>{a=setTimeout(()=>s(Error("Camera playback did not start")),7e3)})])}finally{clearTimeout(a)}if(await new Promise((n,s)=>{let l,d=()=>{clearTimeout(l),i.removeEventListener("loadeddata",m),i.removeEventListener("canplay",m)},m=()=>{i.readyState>=2&&i.videoWidth>0&&i.videoHeight>0&&(d(),n())};i.addEventListener("loadeddata",m),i.addEventListener("canplay",m),l=setTimeout(()=>{d(),s(Error("No camera frame received"))},7e3),m()}),E||!k||e!==z){t.getTracks().forEach(n=>n.stop());return}U=!0,x=!1;for(let n of t.getVideoTracks())h(n,"ended",()=>{g===t&&(b(),w("unavailable",u("Camera disconnected \xB7 try again","Fotocamera scollegata \xB7 riprova")))});w("enabled",u("Camera ready \xB7 take a photo","Fotocamera pronta \xB7 scatta una foto"))}catch(i){if(t==null||t.getTracks().forEach(n=>n.stop()),e!==z)return;b();let a=(i==null?void 0:i.name)==="NotAllowedError"||(i==null?void 0:i.name)==="SecurityError";w("unavailable",a?u("Camera access is blocked \xB7 allow it and retry","Accesso alla fotocamera bloccato \xB7 consenti e riprova"):u("No camera image received \xB7 try again","Nessuna immagine dalla fotocamera \xB7 riprova"))}}function Q(e=600,t=800,o=!0){let i=T();if(!i)return null;let a=document.createElement("canvas");a.width=e,a.height=t;let n=a.getContext("2d");return o&&C==="user"&&(n.translate(e,0),n.scale(-1,1)),q(n,i,0,0,e,t)?a:null}function ee(e,t="#f0ede5"){let o=e.getContext("2d"),i=e.width,a=e.height;o.fillStyle=t,o.fillRect(0,0,i,a);let n=T();if(n){o.save(),C==="user"&&(o.translate(i,0),o.scale(-1,1)),q(o,n,0,0,i,a),o.restore();return}o.save(),o.translate(i/2,a/2-8);let s=Math.min(i,a)/160;o.scale(s,s),o.strokeStyle="#767268",o.lineWidth=3,o.lineJoin="round",o.beginPath(),O(o,-29,-19,58,38,6),o.stroke(),o.beginPath(),o.arc(0,0,10,0,Math.PI*2),o.stroke(),o.beginPath(),o.moveTo(-17,-19),o.lineTo(-12,-27),o.lineTo(12,-27),o.lineTo(17,-19),o.stroke(),o.restore(),o.fillStyle="#68645b",o.font=`500 ${Math.max(15,i/23)}px UIBody,Arial`,o.textAlign="center",o.textBaseline="middle",o.fillText(x?u("Connecting\u2026","Connessione\u2026"):u("Your camera image","La tua fotocamera"),i/2,a/2+Math.min(i,a)*.25)}function te(){var t;(t=c("video.preview"))==null||t.setAttribute("aria-hidden","true");let e=document.createElement("style");e.textContent='.preview{display:block!important;position:absolute!important;width:1px!important;height:1px!important;left:0;bottom:0;opacity:.001;pointer-events:none}.cam-enable[aria-pressed="true"]{border-color:#47754b;background:#edf5e9;color:#315b35}',document.head.append(e),h(c(".cam-enable"),"click",()=>{L(),g||x?b():H()}),c(".cam-flip")&&h(c(".cam-flip"),"click",()=>{C=C==="user"?"environment":"user",b(),H()}),N.push(o=>{o||b()}),P.push(b),w("idle",u("Enable your camera to take a photo","Attiva la fotocamera per scattare una foto"))}function _(){let e=String(B("PAPER_BACKDROP","./assets/paper-print-v1.svg"));r.style.backgroundColor="#e9e0c7",r.style.backgroundImage="url("+JSON.stringify(e)+")",r.style.backgroundSize="256px 256px",r.style.backgroundRepeat="repeat"}function oe(){_();let e=document.createElement("style");e.textContent=`#root{position:relative;isolation:isolate;color:#282723}
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
 #root .pose-pair .meme-reference,#root .pose-pair .live{border:2px solid #282723;border-radius:7px;box-shadow:3px 4px 0 #2827231e}#root .shutter{box-shadow:inset 0 0 0 5px #e9e0c7}#root .pair canvas,#root .pair img{border:1px solid #28272340;border-radius:3px}`,document.head.append(e);let t=r.querySelector(".fit"),o=t.querySelector(".comparison,.strip-view,.modal");if(!o)return;let i=document.createElement("div"),a=document.createElement("div");i.className="paper-overlay",a.className="paper-result-fit",i.hidden=o.hidden,a.append(o),i.append(a),r.append(i),o.setAttribute("role","dialog"),o.setAttribute("aria-modal","true");function n(){i.hidden=o.hidden,t.inert=!o.hidden}let s=new MutationObserver(n);s.observe(o,{attributes:!0,attributeFilter:["hidden"]});function l(){let m=r.getBoundingClientRect(),R=Math.min(m.width/390,m.height/598),D=`translate(${(m.width-390*R)/2}px,${(m.height-598*R)/2}px) scale(${R})`;a.style.transform=D,t.style.transform=D}n(),l(),h(window,"resize",l);let d=typeof ResizeObserver=="function"?new ResizeObserver(l):null;d==null||d.observe(r),P.push(()=>{s.disconnect(),d==null||d.disconnect()})}Y("body{color:#292922}.fit{background:#e6e4dc}.eyebrow{position:absolute;top:58px;width:100%;text-align:center;letter-spacing:2.5px;font-size:10px}.meme-reference{position:absolute;left:78px;top:95px;width:234px;height:165px;object-fit:cover;border:8px solid #faf9f1;box-shadow:0 2px 7px #4442;transform:rotate(-3deg)}.live{position:absolute;left:78px;top:294px;width:234px;height:160px;border:8px solid #faf9f1;box-shadow:0 2px 7px #4442;transform:rotate(2deg);background:#d2cfc4;overflow:hidden}.live canvas{width:100%;height:100%;object-fit:cover}.preview{display:none}.guide{top:272px;font-size:16px}.shutter{position:absolute;left:168px;top:480px;border:3px solid #292922;background:#fff;width:54px;height:54px;border-radius:50%;box-shadow:inset 0 0 0 5px #e6e4dc}.cam-status{bottom:122px;font-size:11px}.bottom{bottom:18px}.comparison{position:absolute;inset:80px 30px 105px;z-index:15;background:#f9f7ef;padding:22px 14px;box-shadow:0 4px 20px #0002;text-align:center}.comparison[hidden]{display:none}.comparison h2{font-size:24px;margin:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:24px 0}.pair canvas,.pair img{width:100%;height:205px;object-fit:cover}.pair small{display:block;text-transform:uppercase;letter-spacing:2px;font-size:9px;margin:8px}.countdown{position:absolute;top:350px;width:100%;text-align:center;z-index:12;font-size:60px;font-weight:800;color:white;text-shadow:0 2px 5px #0008}",'<div class="eyebrow">MAKE THAT FACE</div><div class="pose-pair"><img class="meme-reference" alt="Expression to imitate" src="./assets/meme-1.webp"><div class="guide">Match the face \xB7 take a selfie</div><div class="live"><canvas class="selfie" width="400" height="400"></canvas><div class="countdown"></div></div></div><video class="preview" playsinline autoplay muted></video><div class="status cam-status">Enable your camera to take a photo</div><div class="bottom"><button class="shutter" aria-label="Take selfie"></button><button class="capability cam-enable">Enable camera</button></div><section class="comparison" hidden><div class="smallcaps">Challenge complete</div><h2>Your mimic</h2><div class="pair"><div><small>Original</small><img alt="Original expression"></div><div><small>You</small><canvas width="320" height="320"></canvas></div></div><button class="pill next">Next expression</button></section><div class="flash"></div>',"#e6e4dc"),oe();let M=0,f=-1,j=!1,ie=[I("./assets/meme-1.webp"),I("./assets/meme-2.webp"),I("./assets/meme-3.webp")];te(),h(c(".shutter"),"click",()=>{j||f>=0||!T()||(S(),f=3,v("countdown"),y(550,.06,.12))}),h(c(".next"),"click",()=>{S(),M=(M+1)%3,j=!1,c(".comparison").hidden=!0,c(".meme-reference").src=A(`./assets/meme-${M+1}.webp`),v("ready")}),J(e=>{if(ee(c(".selfie"),"#f0ede5"),f>=0){if(!T()){f=-1,c(".countdown").textContent="",v("ready");return}let t=Math.ceil(f);if(f-=e,c(".countdown").textContent=f>0?Math.ceil(f):"",Math.ceil(f)<t&&f>0&&y(550,.05,.1),f<=0){f=-1;let o=Q(320,320);if(!o)return;j=!0,K(),y(120,.08,.18,"triangle",70),c(".pair canvas").getContext("2d").drawImage(o,0,0),c(".pair img").src=ie[M].src,c(".comparison").hidden=!1,v("comparison")}}}),v("ready"),X(()=>{_(),c(".guide")&&(c(".guide").textContent=String(B("GUIDE","Match the expression \xB7 take a selfie")))})})();(()=>{let r=document.createElement("style");r.dataset.batch3Ui="20261116",r.textContent=`
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
`,document.head.append(r)})();(()=>{let r=document.createElement("style");r.textContent=".pose-pair{position:absolute;left:30px;right:30px;top:88px;bottom:128px;display:grid;grid-template-rows:minmax(0,1fr) auto minmax(0,1fr);justify-items:center;gap:10px}.pose-pair .meme-reference,.pose-pair .live{position:relative;inset:auto;display:block;width:auto;height:100%;max-width:100%;aspect-ratio:1;border:0;border-radius:8px;object-fit:cover;transform:none;box-shadow:0 2px 7px #4442}.pose-pair .live canvas{width:100%;height:100%;object-fit:cover}.pose-pair .guide{position:static;inset:auto;width:100%;margin:0;font-size:17px;line-height:1.35}.live .countdown{position:absolute;inset:0;display:grid;place-items:center;font-size:54px;pointer-events:none}.bottom{bottom:50px;gap:16px;min-height:54px}.bottom .shutter{position:static;inset:auto;flex:0 0 54px;width:54px;height:54px;min-height:54px;margin:0}.bottom .cam-enable{max-width:235px}.cam-status{top:54px;font-size:12px;line-height:1.3}.pair canvas,.pair img{height:auto;aspect-ratio:1;object-fit:cover}",document.head.append(r)})();})();
