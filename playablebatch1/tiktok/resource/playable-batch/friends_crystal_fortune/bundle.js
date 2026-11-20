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

(()=>{(()=>{"use strict";let f=document.getElementById("root"),ie=(e,t,n)=>Math.max(t,Math.min(n,e)),Se=(e,t)=>e+Math.random()*(t-e),oe=e=>e[Math.floor(Math.random()*e.length)],Ie=e=>e[e.length-1],Me=e=>{for(let t=e.length-1;t>0;t--){let n=Math.floor(Math.random()*(t+1));[e[t],e[n]]=[e[n],e[t]]}return e},F=[],ae=[],P=!0,G=!1,p;function x(e,t,n,o){e.addEventListener(t,n,o),F.push(()=>e.removeEventListener(t,n,o))}function se(e,t,n="#faf8f1"){let o=document.createElement("style");o.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(o),f.style.background=n,f.innerHTML='<div class="fit">'+t+"</div>";let a=f.querySelector(".fit");function i(){let s=f.getBoundingClientRect(),l=Math.min(s.width/390,s.height/598);a.style.transform=`translate(${(s.width-390*l)/2}px,${(s.height-598*l)/2}px) scale(${l})`,f.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}i(),x(window,"resize",i)}function d(e){return f.querySelector(e)}function re(){var e;(e=d(".guide"))==null||e.classList.add("gone")}function z(e){f.dataset.phase=e}function T(){le(),re()}function le(){try{p||(p=new(window.AudioContext||window.webkitAudioContext)),p.state==="suspended"&&p.resume().catch(()=>{})}catch{}}function S(e=450,t=.08,n=.18,o="sine",a=0){if(!(!p||!P))try{let i=p.createOscillator(),s=p.createGain(),l=p.currentTime;i.type=o,i.frequency.setValueAtTime(e,l),a&&i.frequency.exponentialRampToValueAtTime(Math.max(30,a),l+t),s.gain.setValueAtTime(.001,l),s.gain.exponentialRampToValueAtTime(n,l+.006),s.gain.exponentialRampToValueAtTime(.001,l+t),i.connect(s),s.connect(p.destination),i.start(l),i.stop(l+t+.02),i.onended=()=>{i.disconnect(),s.disconnect()}}catch{}}function fe(){S(523,.12,.18),setTimeout(()=>S(784,.17,.16),100)}function Ae(){S(180,.22,.18,"triangle",65)}function ce(e){let t=0;function n(o){if(G)return;let a=Math.min(.035,(o-(t||o))/1e3);t=o,document.hidden||e(P?a:0,o/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function de(){let e=d("canvas.stage"),t=e.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return e.width=390*n,e.height=598*n,t.scale(n,n),{canvas:e,ctx:t}}function Pe(e,t=d("canvas.stage")){let n=t.getBoundingClientRect();return{x:(e.clientX-n.left)*390/n.width,y:(e.clientY-n.top)*598/n.height}}function pe(e,t,n,o,a,i){i=Math.min(Math.abs(o)/2,Math.abs(a)/2,i),e.moveTo(t+i,n),e.lineTo(t+o-i,n),e.quadraticCurveTo(t+o,n,t+o,n+i),e.lineTo(t+o,n+a-i),e.quadraticCurveTo(t+o,n+a,t+o-i,n+a),e.lineTo(t+i,n+a),e.quadraticCurveTo(t,n+a,t,n+a-i),e.lineTo(t,n+i),e.quadraticCurveTo(t,n,t+i,n),e.closePath()}function Te(e,t,n,o,a,i,s,l){e.beginPath(),pe(e,t,n,o,a,i),s&&(e.fillStyle=s,e.fill()),l&&(e.strokeStyle=l,e.stroke())}function L(e,t,n,o,a,i){e.beginPath(),e.arc(t,n,Math.max(.01,o),0,Math.PI*2),a&&(e.fillStyle=a,e.fill()),i&&(e.strokeStyle=i,e.stroke())}function Be(e,t,n,o,a,i,s=2){e.beginPath(),e.moveTo(t,n),e.lineTo(o,a),e.strokeStyle=i,e.lineWidth=s,e.stroke()}function V(e,t,n,o,a=18,i="#25252a",s="UIBody",l="center"){e.font=`700 ${a}px ${s}`,e.fillStyle=i,e.textAlign=l,e.textBaseline="middle",e.fillText(t,n,o)}let D=[];function B(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(X(t,e))}function qe(e){let t=new Image;return t.onerror=()=>{f.dataset.assetIssue="image"},t.src=B(e),D.push({im:t,path:e}),t}function ue(e,t,n,o,a,i){if(!t||!t.width)return;let s=t.videoWidth||t.width,l=t.videoHeight||t.height;if(!s||!l)return;let C=Math.max(a/s,i/l);e.save(),e.beginPath(),e.rect(n,o,a,i),e.clip(),e.drawImage(t,n+(a-s*C)/2,o+(i-l*C)/2,s*C,l*C),e.restore()}function he(e,t,n,o,a){e.save(),e.beginPath(),e.arc(n,o,a,0,Math.PI*2),e.clip(),ue(e,t,n-a,o-a,a*2,a*2),e.restore()}function ge(e,t,n,o){let a=d(".modal");if(!a)return;a.hidden=!1,a.querySelector("h2").textContent=e,a.querySelector(".value").textContent=t,a.querySelector("p").textContent=n;let i=a.querySelector("button");i.onclick=()=>{a.hidden=!0,T(),o()},z("result")}function me(e="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function Ue(){let e=d(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let O=[];function _(e){P=e,e||p==null||p.suspend().catch(()=>{});for(let t of O)t(e)}x(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&_(e.data.active===!0)}),x(document,"visibilitychange",()=>{_(!document.hidden)}),x(window,"pagehide",()=>{G=!0,F.splice(0).forEach(e=>e()),ae.splice(0).forEach(e=>e()),p==null||p.close().catch(()=>{})});let N={};function X(e,t){return N[e]??t}async function xe(e=()=>{}){let t=new AbortController,n=setTimeout(()=>t.abort(),1600);try{let o=await fetch("./game.config.json",{signal:t.signal});if(!o.ok)throw Error("Config unavailable");let a=await o.json();for(let i of["texts","tweaks","images"])for(let s of a[i]||[])N[s.id]=i==="images"?s.path:s.value;for(let i of D){let s=B(i.path);i.im.getAttribute("src")!==s&&(i.im.src=s)}for(let i of f.querySelectorAll('img[src^="./assets/"]'))i.src=B(i.getAttribute("src"));e(),f.dataset.config="loaded"}catch{f.dataset.config="defaults"}finally{clearTimeout(n)}}let h=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],Y=()=>{};function ye(){var t,n;function e(o,a){h=o.slice(0,24).map(i=>({nickname:String(i.nickname||"Friend"),avatar:i.avatar,image:null}));for(let i of h){let s;try{s=a?window.tt.createImage():new Image,s.onload=()=>{i.image=s,Y()},s.onerror=()=>{i.image=null},s.src=i.avatar}catch{i.image=null}}Y()}e(h,!1),f.dataset.friends="sample",!(!((t=window.tt)!=null&&t.getFriendsInfo)||!((n=window.tt)!=null&&n.createImage))&&window.tt.getFriendsInfo({success(o){let a=Array.isArray(o==null?void 0:o.friends)?o.friends.filter(i=>i&&typeof i.avatar=="string"):[];a.length&&(e(a,!0),f.dataset.friends="host")},fail(){f.dataset.friends="sample"}})}function be(e,t,n,o,a,i="#fff"){let s=h[(t%h.length+h.length)%h.length];e.save(),e.shadowColor="#25212d20",e.shadowBlur=6,L(e,n,o,a,i),e.shadowBlur=0,s!=null&&s.image?he(e,s.image,n,o,Math.max(1,a-2)):(L(e,n,o,Math.max(1,a-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][t%4]),V(e,Array.from((s==null?void 0:s.nickname)||"?")[0],n,o,a*.7,"#fff")),e.restore()}function H(e){var t;return((t=h[(e%h.length+h.length)%h.length])==null?void 0:t.nickname)||"Friend"}function ve(e,t,n,o,a=13){V(e,Array.from(H(t)).slice(0,15).join(""),n,o,a)}ye(),se(".fit{background:#fff}canvas.stage{position:absolute;z-index:3;pointer-events:none}.vision-copy{position:absolute;left:30px;right:30px;top:90px;z-index:6;display:flex;flex-direction:column;align-items:center;gap:24px;text-align:center;pointer-events:none}.question{position:static;margin:0;font-size:20px;line-height:1.4;font-weight:700;color:#55465c}.guide{top:160px;font-size:15px;font-weight:500;color:#aaa0ac}.orb{position:absolute;left:65px;top:218px;width:260px;height:260px;object-fit:contain;pointer-events:none}.fog{position:absolute;left:65px;top:218px;width:260px;height:260px;touch-action:none;z-index:5;opacity:1;transition:opacity .5s ease-out}.fog.revealed{opacity:0;pointer-events:none}.prediction{position:static;margin:0;font-size:14px;line-height:1.4;color:#5d4969;overflow-wrap:anywhere}.prediction:empty{display:none}.next-vision{position:absolute;left:50%;transform:translateX(-50%);bottom:24px;white-space:nowrap;background:#4b4355}.count{position:absolute;right:30px;top:33px;color:#8e8696;font-size:14px}.result{background:#faf7ff}.result .value{font-size:28px}.result p{white-space:pre-line}",`<canvas class="stage" aria-label="Crystal ball fortune"></canvas><div class="count">1 / 3</div><div class="vision-copy"><div class="question">Who will have a lucky day?</div><div class="prediction" aria-live="polite"></div></div><div class="guide">Wipe to see your friend</div><img class="orb" src="./assets/crystal.webp" alt="Crystal fortune ball"><canvas class="fog" width="436" height="436" aria-label="Wipe away the mist"></canvas><button class="pill next-vision" disabled>Next vision</button>${me()}`,"#fff");let{ctx:q}=de(),u=d(".fog"),r=u.getContext("2d"),c=u.width,y=0,I=0,U="",b=!1,v=!1,g=null,R=[],M=0,k=!1,j=-1,m={cx:317.54,cy:254.28,radius:238,feather:4,artSize:640};function E(e){let t=c/m.artSize;e.beginPath(),e.arc(m.cx*t,m.cy*t,m.radius*t,0,Math.PI*2),e.closePath()}let W=document.createElement("canvas");W.width=W.height=c;let A=W.getContext("2d");E(A),A.fillStyle="#fff",A.fill();let $=A.getImageData(0,0,c,c).data,w=[];for(let e=3;e<$.length;e+=4)$[e]>=128&&w.push(e);let Z=new Uint8Array(w.length);function we(){r.globalCompositeOperation="source-over",r.clearRect(0,0,c,c),r.save(),E(r),r.clip();let e=c/m.artSize,t=m.cx*e,n=m.cy*e,o=m.radius*e,a=r.createRadialGradient(t-o*.35,n-o*.4,o*.05,t,n,o*1.12);a.addColorStop(0,"#eee8f0"),a.addColorStop(.6,"#d8d0e3"),a.addColorStop(1,"#b5a8c9"),r.fillStyle=a,r.fillRect(0,0,c,c);let i=r.createRadialGradient(t,n,o-m.feather*e,t,n,o);i.addColorStop(0,"#fff"),i.addColorStop(1,"#fff0"),r.globalCompositeOperation="destination-in",r.fillStyle=i,r.fillRect(0,0,c,c),r.restore();let s=r.getImageData(0,0,c,c).data;w.forEach((l,C)=>{Z[C]=s[l]}),M=0,k=!1,j=-1,f.dataset.mistCoverage="0.0000"}function K(e){let t=u.getBoundingClientRect();return{x:(e.clientX-t.left)*c/t.width,y:(e.clientY-t.top)*c/t.height}}function J(e){let t=Math.floor(e.x),n=Math.floor(e.y);return t>=0&&t<c&&n>=0&&n<c&&$[(n*c+t)*4+3]>=128}function Ce(){b||(b=!0,v=!1,g=null,u.classList.add("revealed"),u.setAttribute("aria-hidden","true"),d(".prediction").textContent=U,d(".next-vision").disabled=!1,R.push(H(I)+" \u2014 "+U),S(640,.3,.1,"sine",900),z("revealed"))}function Q(){if(!k||b)return;k=!1;let e=r.getImageData(0,0,c,c).data,t=0;for(let n=0;n<w.length;n++){let o=Z[n];o&&(t+=ie(1-e[w[n]]/o,0,1))}M=t/w.length,f.dataset.mistCoverage=M.toFixed(4),M>=.6&&Ce()}function ee(e){let t=K(e);if(!J(t)){g=null;return}r.save(),E(r),r.clip(),r.globalCompositeOperation="destination-out",r.strokeStyle="#000",r.fillStyle="#000",r.lineCap="round",r.lineWidth=58,g?(r.beginPath(),r.moveTo(g.x,g.y),r.lineTo(t.x,t.y),r.stroke()):(r.beginPath(),r.arc(t.x,t.y,29,0,Math.PI*2),r.fill()),r.restore(),g=t,k=!0}let ke=["Who will have a lucky day?","Who is about to get a lovely surprise?","Who will begin a new adventure?"],ze=["A small happy coincidence is on its way.","An unexpected message will make them smile.","Something they have been hoping for gets a little closer.","Their next good idea arrives at the perfect time.","A familiar face will bring a little good news."];function te(){I=Math.floor(Math.random()*h.length),U=oe(ze),b=!1,v=!1,g=null,u.style.transition="none",u.classList.remove("revealed"),u.removeAttribute("aria-hidden"),d(".count").textContent=y+1+" / 3",d(".question").textContent=ke[y],d(".prediction").textContent="",d(".next-vision").disabled=!0,d(".next-vision").textContent=y===2?"See your visions":"Next vision",we(),u.offsetWidth,u.style.removeProperty("transition"),z("ready")}function ne(){y=0,R=[],te()}x(u,"pointerdown",e=>{b||!J(K(e))||(T(),z("wiping"),v=!0,g=null,u.setPointerCapture(e.pointerId),ee(e))}),x(u,"pointermove",e=>{v&&!b&&ee(e)});for(let e of["pointerup","pointercancel","lostpointercapture"])x(u,e,()=>{Q(),v=!1,g=null});O.push(e=>{e||(v=!1,g=null)}),x(d(".next-vision"),"click",()=>{T(),y===2?(ge("Your little predictions","3 visions",R.join(`

`),ne),fe()):(y++,te())}),ne(),ce((e,t)=>{k&&t-j>=.05&&(j=t,Q()),q.clearRect(0,0,390,598),be(q,I,195,304,30,"#fff"),ve(q,I,195,351,14)}),xe(()=>{d(".guide")&&(d(".guide").textContent=String(X("GUIDE","Wipe to see your friend")))})})();(()=>{let f=document.createElement("style");f.dataset.batch3Ui="20261116",f.textContent=`
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

.count{top:30px;left:30px;right:30px;text-align:center;font:600 28px/1.2 Playful,UIBody,sans-serif;color:#6e5c7c}
.question{position:static;font:700 20px/1.4 UIBody,system-ui,sans-serif;color:#55465c}
.guide{top:157px;font:400 18px/1.4 UIBody,system-ui,sans-serif;color:#746778}
.orb{left:65px;top:218px;width:260px;height:260px}
.fog{left:65px;top:218px;width:260px;height:260px}
.prediction{position:static;font-size:14px;line-height:1.4;color:#5d4969}
.next-vision{bottom:50px;min-height:44px;font-size:16px}
`,document.head.append(f)})();})();
