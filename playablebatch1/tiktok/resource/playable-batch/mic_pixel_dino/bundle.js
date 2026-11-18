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

(()=>{(()=>{"use strict";let c=document.getElementById("root"),se=(e,t,o)=>Math.max(t,Math.min(o,e)),le=(e,t)=>e+Math.random()*(t-e),Z=e=>e[Math.floor(Math.random()*e.length)],ze=e=>e[e.length-1],Ae=e=>{for(let t=e.length-1;t>0;t--){let o=Math.floor(Math.random()*(t+1));[e[t],e[o]]=[e[o],e[t]]}return e},J=[],L=[],M=!0,C=!1,m;function h(e,t,o,a){e.addEventListener(t,o,a),J.push(()=>e.removeEventListener(t,o,a))}function re(e,t,o="#faf8f1"){let a=document.createElement("style");a.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(a),c.style.background=o,c.innerHTML='<div class="fit">'+t+"</div>";let n=c.querySelector(".fit");function i(){let s=c.getBoundingClientRect(),l=Math.min(s.width/390,s.height/598);n.style.transform=`translate(${(s.width-390*l)/2}px,${(s.height-598*l)/2}px) scale(${l})`,c.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}i(),h(window,"resize",i)}function u(e){return c.querySelector(e)}function ce(){var e;(e=u(".guide"))==null||e.classList.add("gone")}function D(e){c.dataset.phase=e}function j(){F(),ce()}function F(){try{m||(m=new(window.AudioContext||window.webkitAudioContext)),m.state==="suspended"&&m.resume().catch(()=>{})}catch{}}function $(e=450,t=.08,o=.18,a="sine",n=0){if(!(!m||!M))try{let i=m.createOscillator(),s=m.createGain(),l=m.currentTime;i.type=a,i.frequency.setValueAtTime(e,l),n&&i.frequency.exponentialRampToValueAtTime(Math.max(30,n),l+t),s.gain.setValueAtTime(.001,l),s.gain.exponentialRampToValueAtTime(o,l+.006),s.gain.exponentialRampToValueAtTime(.001,l+t),i.connect(s),s.connect(m.destination),i.start(l),i.stop(l+t+.02),i.onended=()=>{i.disconnect(),s.disconnect()}}catch{}}function Te(){$(523,.12,.18),setTimeout(()=>$(784,.17,.16),100)}function ue(){$(180,.22,.18,"triangle",65)}function fe(e){let t=0;function o(a){if(C)return;let n=Math.min(.035,(a-(t||a))/1e3);t=a,document.hidden||e(M?n:0,a/1e3),requestAnimationFrame(o)}requestAnimationFrame(o)}function de(){let e=u("canvas.stage"),t=e.getContext("2d"),o=Math.min(2,window.devicePixelRatio||1);return e.width=390*o,e.height=598*o,t.scale(o,o),{canvas:e,ctx:t}}function Pe(e,t=u("canvas.stage")){let o=t.getBoundingClientRect();return{x:(e.clientX-o.left)*390/o.width,y:(e.clientY-o.top)*598/o.height}}function pe(e,t,o,a,n,i){i=Math.min(Math.abs(a)/2,Math.abs(n)/2,i),e.moveTo(t+i,o),e.lineTo(t+a-i,o),e.quadraticCurveTo(t+a,o,t+a,o+i),e.lineTo(t+a,o+n-i),e.quadraticCurveTo(t+a,o+n,t+a-i,o+n),e.lineTo(t+i,o+n),e.quadraticCurveTo(t,o+n,t,o+n-i),e.lineTo(t,o+i),e.quadraticCurveTo(t,o,t+i,o),e.closePath()}function Re(e,t,o,a,n,i,s,l){e.beginPath(),pe(e,t,o,a,n,i),s&&(e.fillStyle=s,e.fill()),l&&(e.strokeStyle=l,e.stroke())}function Ie(e,t,o,a,n,i){e.beginPath(),e.arc(t,o,Math.max(.01,a),0,Math.PI*2),n&&(e.fillStyle=n,e.fill()),i&&(e.strokeStyle=i,e.stroke())}function qe(e,t,o,a,n,i,s=2){e.beginPath(),e.moveTo(t,o),e.lineTo(a,n),e.strokeStyle=i,e.lineWidth=s,e.stroke()}function Ue(e,t,o,a,n=18,i="#25252a",s="UIBody",l="center"){e.font=`700 ${n}px ${s}`,e.fillStyle=i,e.textAlign=l,e.textBaseline="middle",e.fillText(t,o,a)}let K=[];function O(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(te(t,e))}function Ee(e){let t=new Image;return t.onerror=()=>{c.dataset.assetIssue="image"},t.src=O(e),K.push({im:t,path:e}),t}function he(e,t,o,a,n,i){if(!t||!t.width)return;let s=t.videoWidth||t.width,l=t.videoHeight||t.height;if(!s||!l)return;let g=Math.max(n/s,i/l);e.save(),e.beginPath(),e.rect(o,a,n,i),e.clip(),e.drawImage(t,o+(n-s*g)/2,a+(i-l*g)/2,s*g,l*g),e.restore()}function Be(e,t,o,a,n){e.save(),e.beginPath(),e.arc(o,a,n,0,Math.PI*2),e.clip(),he(e,t,o-n,a-n,n*2,n*2),e.restore()}function me(e,t,o,a){let n=u(".modal");if(!n)return;n.hidden=!1,n.querySelector("h2").textContent=e,n.querySelector(".value").textContent=t,n.querySelector("p").textContent=o;let i=n.querySelector("button");i.onclick=()=>{n.hidden=!0,j(),a()},D("result")}function ge(e="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function Le(){let e=u(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let W=[];function Q(e){M=e,e||m==null||m.suspend().catch(()=>{});for(let t of W)t(e)}h(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&Q(e.data.active===!0)}),h(document,"visibilitychange",()=>{Q(!document.hidden)}),h(window,"pagehide",()=>{C=!0,J.splice(0).forEach(e=>e()),L.splice(0).forEach(e=>e()),m==null||m.close().catch(()=>{})});let ee={};function te(e,t){return ee[e]??t}async function be(e=()=>{}){let t=new AbortController,o=setTimeout(()=>t.abort(),1600);try{let a=await fetch("./game.config.json",{signal:t.signal});if(!a.ok)throw Error("Config unavailable");let n=await a.json();for(let i of["texts","tweaks","images"])for(let s of n[i]||[])ee[s.id]=i==="images"?s.path:s.value;for(let i of K){let s=O(i.path);i.im.getAttribute("src")!==s&&(i.im.src=s)}for(let i of c.querySelectorAll('img[src^="./assets/"]'))i.src=O(i.getAttribute("src"));e(),c.dataset.config="loaded"}catch{c.dataset.config="defaults"}finally{clearTimeout(o)}}let r=null,f=null,y=null,R=null,I=!1,A=!1,b="",ne=()=>{};function w(){r==null||r.getTracks().forEach(e=>e.stop()),r=null,f==null||f.close().catch(()=>{}),f=y=R=null,I=!1}async function ie(){var e;if(!I){I=!0;try{if(!((e=navigator.mediaDevices)!=null&&e.getUserMedia))throw Error("No microphone");if(r=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!0,noiseSuppression:!0,autoGainControl:!1}}),C||!M||b==="hold"){w();return}f=new(window.AudioContext||window.webkitAudioContext),await f.resume();let t=f.createMediaStreamSource(r);y=f.createAnalyser(),y.fftSize=1024,t.connect(y),R=new Float32Array(y.fftSize),u(".mic-enable").textContent="Mic on",u(".mic-status").textContent="Listening \xB7 Space or hold also works",c.dataset.microphone="enabled"}catch{I=!1,u(".mic-enable").textContent="Enable microphone",u(".mic-status").textContent="Mic unavailable \xB7 hold the button to play",c.dataset.microphone="unavailable"}}}function xe(){if(A)return .9;if(!y||!M)return 0;y.getFloatTimeDomainData(R);let e=0;for(let t of R)e+=t*t;return se((Math.sqrt(e/R.length)-.012)*14,0,1)}function ye(){h(u(".mic-enable"),"click",()=>{F(),ie()});let e=u(".voice-hold");h(e,"pointerdown",t=>{t.preventDefault(),j(),G("hold"),A=!0,e.setPointerCapture(t.pointerId)});for(let t of["pointerup","pointercancel","lostpointercapture"])h(e,t,()=>A=!1);h(window,"keydown",t=>{t.code==="Space"&&!t.repeat&&(t.preventDefault(),j(),G("hold"),A=!0)}),h(window,"keyup",t=>{t.code==="Space"&&(A=!1)}),W.push(t=>{if(t){if(f==null||f.resume().catch(()=>{}),r)for(let o of r.getTracks())o.enabled=!0}else if(A=!1,f==null||f.suspend().catch(()=>{}),r)for(let o of r.getTracks())o.enabled=!1}),L.push(w),we()}function ve(e="Hold to try"){return`<div class="status mic-status" hidden></div><div class="bottom"><button class="capability mic-enable">Enable microphone</button><button class="capability voice-hold">${e}</button></div>`}function G(e){b=e,e==="hold"&&(r||I)&&w(),ne()}function we(){let e=u(".mic-enable"),t=u(".voice-hold"),o=e.parentElement,a=u(".mic-status"),n=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it"),i=document.createElement("style");i.textContent="#root .bottom.voice-mode-selected{display:flex!important;justify-content:center!important;align-items:center!important}#root .bottom.voice-mode-selected>.capability{flex:0 1 auto!important;width:auto!important;min-width:150px;max-width:260px}#root .bottom>.capability[hidden]{display:none!important}",document.head.append(i);function s(){C||(e.hidden=b==="hold",t.hidden=b==="voice",o.classList.toggle("voice-mode-selected",!!b),c.dataset.voiceControl=b||"choice",b==="hold"&&(a.textContent="",a.hidden=!0))}ne=s,h(e,"click",()=>G("voice"),{capture:!0});let l=new MutationObserver(()=>{let g=c.dataset.microphone;b==="voice"&&["unavailable","error","off"].includes(g)&&(b=""),b==="hold"&&r&&w(),s()});l.observe(c,{attributes:!0,attributeFilter:["data-microphone"]}),L.push(()=>l.disconnect()),s()}function Me(){let e=u(".mic-enable"),t=u(".mic-status"),n=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it")?{idle:"Mic spento",requesting:"Connessione\u2026",active:"Mic attivo",paused:"Mic in pausa",start:"Attiva microfono",stop:"Disattiva microfono",listening:"",fallback:"",unavailable:"Non disponibile \xB7 usa il pulsante"}:{idle:"Mic off",requesting:"Connecting\u2026",active:"Mic on",paused:"Mic paused",start:"Start microphone",stop:"Stop microphone",listening:"",fallback:"",unavailable:"Mic unavailable \xB7 hold the button to play"},i=document.createElement("style");i.textContent=".bottom .capability.mic-enable{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;flex:1 1 174px}.mic-enable .mic-icon{width:18px;height:18px;flex:none}.mic-enable .mic-record-dot{width:10px;height:10px;flex:none;background:currentColor;border-radius:50%}.bottom .capability.mic-enable.is-listening{background:#d94646;border-color:#d94646;color:#fff;box-shadow:0 2px 8px #bd333326}.mic-enable .mic-button-label{white-space:nowrap}",document.head.append(i);let s=!1,l=!1,g="",E=null,B=null;function ke(){var P;let p=((P=r==null?void 0:r.getAudioTracks)==null?void 0:P.call(r))||[];return M&&!!y&&(f==null?void 0:f.state)==="running"&&p.some(v=>v.readyState==="live"&&v.enabled&&!v.muted)}function x(){var ae;if(C)return;let p=ke(),P=!!((ae=r==null?void 0:r.getAudioTracks)!=null&&ae.call(r).some(Y=>Y.readyState==="live")),v=s?"requesting":p?"active":P?"paused":l?"unavailable":"idle";if(e.disabled=s,e.setAttribute("aria-pressed",String(p)),e.classList.toggle("is-listening",p),e.setAttribute("aria-label",P?n.stop:n.start),e.dataset.micState=v,c.dataset.microphone=p?"enabled":v==="idle"?"off":v,v!==g){let Y=p?'<span class="mic-record-dot" aria-hidden="true"></span>':'<svg class="mic-icon" viewBox="0 0 16 16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="M6 1h4v1h1v7h-1v1H6V9H5V2h1zM3 7h1v3h1v1h6v-1h1V7h1v4h-1v1H9v2h3v1H4v-1h3v-2H4v-1H3z"/></svg>',Se=s?n.requesting:p?n.active:P?n.paused:n.idle;e.innerHTML=Y+'<span class="mic-button-label">'+Se+"</span>",t.textContent=p?n.listening:l?n.unavailable:n.fallback,g=v}}function X(){if(r&&E!==r){E=r;for(let p of r.getAudioTracks())h(p,"ended",()=>{w(),l=!1,x()}),h(p,"mute",x),h(p,"unmute",x)}f&&B!==f&&(B=f,h(f,"statechange",x))}h(e,"click",async p=>{if(p.preventDefault(),p.stopImmediatePropagation(),!(s||C)){if(r){w(),l=!1,x();return}if(F(),l=!1,s=!0,x(),await ie(),s=!1,C||!M){w(),x();return}(!r||!f||!y)&&(w(),l=!0),X(),g="",x()}},{capture:!0}),W.push(()=>{Promise.resolve().then(()=>{X(),x()})}),X(),x()}function Ce(e){let t=u(e==="camera"?".cam-status":".mic-status");if(!t)return;let o=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it");t.setAttribute("role","status"),t.setAttribute("aria-live","polite");function a(){var E;let l="";if(e==="camera")["requesting","unavailable"].includes(c.dataset.camera)&&(l=t.textContent);else{let B=((E=u(".mic-enable"))==null?void 0:E.dataset.micState)||c.dataset.microphone;B==="requesting"?l=o?"Consenti l\u2019accesso al microfono":"Allow microphone access":["unavailable","error"].includes(B)&&(l=o?"Microfono non disponibile":"Microphone unavailable")}t.textContent!==l&&(t.textContent=l);let g=!l.trim();t.hidden!==g&&(t.hidden=g)}let n=new MutationObserver(a);n.observe(t,{childList:!0,characterData:!0,subtree:!0});let i=new MutationObserver(a);i.observe(c,{attributes:!0,attributeFilter:[e==="camera"?"data-camera":"data-microphone"]});let s=u(".mic-enable");s&&i.observe(s,{attributes:!0,attributeFilter:["data-mic-state"]}),a(),L.push(()=>{n.disconnect(),i.disconnect()})}re(".fit{background:#fff;color:#292929}.hud{font:24px monospace;justify-content:flex-end}.guide{top:200px;font:18px monospace}.capability{font-family:monospace;border-radius:0;border:2px solid #333}.status{font-family:monospace;font-size:10px}.result{background:#fff;border:3px solid #333;border-radius:0;box-shadow:7px 7px #3333}.result h2{font-family:monospace}.result .value{font:38px monospace}.pill{border-radius:0;background:#292929;font-family:monospace}",`<canvas class="stage" aria-label="Pixel dinosaur voice jump"></canvas><div class="hud"><span class="score">00000</span></div><div class="guide">Make a sound to jump</div>${ve("Hold to jump")}${ge("Run again")}`,"#fff"),Ce("microphone");let{ctx:d}=de(),k="ready",S=0,q=0,z=210,U=0,_=0,V=1.4,T=[],H=!0,N=["00000001111110","00000001110110","00000001111110","00000001110000","10000001111100","11000011100000","11100111111000","01111111101000","00111111100000","00011111000000","00001101000000","00001001000000"];function oe(){k="ready",S=0,q=0,z=210,U=0,V=1.4,T=[],H=!0,u(".score").textContent="00000",D("ready")}ye(),Me(),fe((e,t)=>{let o=xe();if(o<.12&&(H=!0),o>.32&&H&&S<=.1&&k!=="result"&&(j(),H=!1,q=440,k==="ready"&&(k="playing",D("playing")),$(340,.08,.1,"square",550)),k==="playing"){U+=z*e,z=Math.min(450,z+e*5),_=(_+z*e)%40,q-=1150*e,S=Math.max(0,S+q*e),S===0&&(q=0),V-=e,V<=0&&(T.push({x:440,w:Z([15,22,30]),h:Z([32,40,48])}),V=le(1.1,1.6)*210/z+.35);for(let n of T)n.x-=z*e,n.x<119&&n.x+n.w>84&&S<n.h-8&&(k="result",ue(),me("Game over",Math.floor(U/20).toString().padStart(5,"0"),"A little louder. A little earlier.",oe));T=T.filter(n=>n.x>-40),u(".score").textContent=Math.floor(U/20).toString().padStart(5,"0"),c.dataset.distance=Math.floor(U)}d.fillStyle="#fff",d.fillRect(0,0,390,598),d.fillStyle="#e2e2df";for(let[n,i]of[[32,140],[260,235],[350,110]])d.fillRect(n,i,36,2),d.fillRect(n+7,i-9,22,2),d.fillRect(n+5,i-7,2,7),d.fillRect(n+29,i-7,2,7);d.fillStyle="#4b4b49",d.fillRect(0,451,390,2);for(let n=-_;n<390;n+=40)d.fillRect(n,460+n%3*3,8,1);let a=414-S;for(let n=0;n<N.length;n++)for(let i=0;i<N[n].length;i++)if(N[n][i]==="1"){if(n>9&&k==="playing"&&Math.sin(t*16)>0&&i>6)continue;d.fillRect(73+i*3,a+n*3,3,3)}for(let n of T)d.fillRect(n.x+n.w*.4,451-n.h,n.w*.26,n.h),d.fillRect(n.x,451-n.h*.7,n.w*.25,n.h*.4),d.fillRect(n.x,451-n.h*.35,n.w*.5,5),d.fillRect(n.x+n.w*.8,451-n.h*.8,n.w*.2,n.h*.5),d.fillRect(n.x+n.w*.6,451-n.h*.4,n.w*.4,5)}),oe(),be(()=>{u(".guide")&&(u(".guide").textContent=String(te("GUIDE","Make a sound to jump")))})})();(()=>{let c=document.createElement("style");c.dataset.batch3Ui="20261116",c.textContent=`
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

@font-face{font-family:UIPixel;src:url('./assets/ui/Silkscreen-Regular.ttf') format('truetype');font-display:swap}
.hud{justify-content:center;font:400 28px/1.25 UIPixel,monospace}
.guide{font:400 18px/1.5 UIPixel,monospace}
.bottom{gap:8px}.bottom .capability{font:400 13px/1.4 UIPixel,monospace;padding:9px 9px}
.status{font:400 12px/1.5 UIPixel,monospace;color:#555}
.result h2,.result .value{font-family:UIPixel,monospace}.pill{font-family:UIPixel,monospace;font-size:14px}
`,document.head.append(c)})();})();
