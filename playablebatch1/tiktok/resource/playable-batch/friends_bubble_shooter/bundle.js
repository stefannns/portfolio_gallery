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

(()=>{document.documentElement.lang="it";(()=>{"use strict";let l=document.getElementById("root"),Me=(e,t,n)=>Math.max(t,Math.min(n,e)),Z=(e,t)=>e+Math.random()*(t-e),ze=e=>e[Math.floor(Math.random()*e.length)],Ce=e=>e[e.length-1],Ae=e=>{for(let t=e.length-1;t>0;t--){let n=Math.floor(Math.random()*(t+1));[e[t],e[n]]=[e[n],e[t]]}return e},D=[],$=[],B=!0,V=!1,h;function y(e,t,n,a){e.addEventListener(t,n,a),D.push(()=>e.removeEventListener(t,n,a))}function J(e,t,n="#faf8f1"){let a=document.createElement("style");a.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(a),l.style.background=n,l.innerHTML='<div class="fit">'+t+"</div>";let r=l.querySelector(".fit");function i(){let o=l.getBoundingClientRect(),s=Math.min(o.width/390,o.height/598);r.style.transform=`translate(${(o.width-390*s)/2}px,${(o.height-598*s)/2}px) scale(${s})`,l.dataset.layout=`${Math.round(o.width)}x${Math.round(o.height)}`}i(),y(window,"resize",i)}function m(e){return l.querySelector(e)}function ee(){var e;(e=m(".guide"))==null||e.classList.add("gone")}function q(e){l.dataset.phase=e}function R(){te(),ee()}function te(){try{h||(h=new(window.AudioContext||window.webkitAudioContext)),h.state==="suspended"&&h.resume().catch(()=>{})}catch{}}function z(e=450,t=.08,n=.18,a="sine",r=0){if(!(!h||!B))try{let i=h.createOscillator(),o=h.createGain(),s=h.currentTime;i.type=a,i.frequency.setValueAtTime(e,s),r&&i.frequency.exponentialRampToValueAtTime(Math.max(30,r),s+t),o.gain.setValueAtTime(.001,s),o.gain.exponentialRampToValueAtTime(n,s+.006),o.gain.exponentialRampToValueAtTime(.001,s+t),i.connect(o),o.connect(h.destination),i.start(s),i.stop(s+t+.02),i.onended=()=>{i.disconnect(),o.disconnect()}}catch{}}function ne(){z(523,.12,.18),setTimeout(()=>z(784,.17,.16),100)}function oe(){z(180,.22,.18,"triangle",65)}function ie(e){let t=0;function n(a){if(V)return;let r=Math.min(.035,(a-(t||a))/1e3);t=a,document.hidden||e(B?r:0,a/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function ae(){let e=m("canvas.stage"),t=e.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return e.width=390*n,e.height=598*n,t.scale(n,n),{canvas:e,ctx:t}}function _(e,t=m("canvas.stage")){let n=t.getBoundingClientRect();return{x:(e.clientX-n.left)*390/n.width,y:(e.clientY-n.top)*598/n.height}}function re(e,t,n,a,r,i){i=Math.min(Math.abs(a)/2,Math.abs(r)/2,i),e.moveTo(t+i,n),e.lineTo(t+a-i,n),e.quadraticCurveTo(t+a,n,t+a,n+i),e.lineTo(t+a,n+r-i),e.quadraticCurveTo(t+a,n+r,t+a-i,n+r),e.lineTo(t+i,n+r),e.quadraticCurveTo(t,n+r,t,n+r-i),e.lineTo(t,n+i),e.quadraticCurveTo(t,n,t+i,n),e.closePath()}function se(e,t,n,a,r,i,o,s){e.beginPath(),re(e,t,n,a,r,i),o&&(e.fillStyle=o,e.fill()),s&&(e.strokeStyle=s,e.stroke())}function F(e,t,n,a,r,i){e.beginPath(),e.arc(t,n,Math.max(.01,a),0,Math.PI*2),r&&(e.fillStyle=r,e.fill()),i&&(e.strokeStyle=i,e.stroke())}function O(e,t,n,a,r,i,o=2){e.beginPath(),e.moveTo(t,n),e.lineTo(a,r),e.strokeStyle=i,e.lineWidth=o,e.stroke()}function H(e,t,n,a,r=18,i="#25252a",o="UIBody",s="center"){e.font=`700 ${r}px ${o}`,e.fillStyle=i,e.textAlign=s,e.textBaseline="middle",e.fillText(t,n,a)}let W=[];function E(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(U(t,e))}function Pe(e){let t=new Image;return t.onerror=()=>{l.dataset.assetIssue="image"},t.src=E(e),W.push({im:t,path:e}),t}function le(e,t,n,a,r,i){if(!t||!t.width)return;let o=t.videoWidth||t.width,s=t.videoHeight||t.height;if(!o||!s)return;let f=Math.max(r/o,i/s);e.save(),e.beginPath(),e.rect(n,a,r,i),e.clip(),e.drawImage(t,n+(r-o*f)/2,a+(i-s*f)/2,o*f,s*f),e.restore()}function pe(e,t,n,a,r){e.save(),e.beginPath(),e.arc(n,a,r,0,Math.PI*2),e.clip(),le(e,t,n-r,a-r,r*2,r*2),e.restore()}function ce(e,t,n,a){let r=m(".modal");if(!r)return;r.hidden=!1,r.querySelector("h2").textContent=e,r.querySelector(".value").textContent=t,r.querySelector("p").textContent=n;let i=r.querySelector("button");i.onclick=()=>{r.hidden=!0,R(),a()},q("result")}function de(e="Rigioca"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function Te(){let e=m(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let fe=[];function X(e){B=e,e||h==null||h.suspend().catch(()=>{});for(let t of fe)t(e)}y(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&X(e.data.active===!0)}),y(document,"visibilitychange",()=>{X(!document.hidden)}),y(window,"pagehide",()=>{V=!0,D.splice(0).forEach(e=>e()),$.splice(0).forEach(e=>e()),h==null||h.close().catch(()=>{})});let Y={};function U(e,t){return Y[e]??t}async function ue(e=()=>{}){let t=new AbortController,n=setTimeout(()=>t.abort(),1600);try{let a=await fetch("./game.config.json",{signal:t.signal});if(!a.ok)throw Error("Configurazione non disponibile");let r=await a.json();for(let i of["texts","tweaks","images"])for(let o of r[i]||[])Y[o.id]=i==="images"?o.path:o.value;for(let i of W){let o=E(i.path);i.im.getAttribute("src")!==o&&(i.im.src=o)}for(let i of l.querySelectorAll('img[src^="./assets/"]'))i.src=E(i.getAttribute("src"));e(),l.dataset.config="loaded"}catch{l.dataset.config="defaults"}finally{clearTimeout(n)}}let g=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],G=()=>{};function he(){var t,n;function e(a,r){g=a.slice(0,24).map(i=>({nickname:String(i.nickname||"Amico"),avatar:i.avatar,image:null}));for(let i of g){let o;try{o=r?window.tt.createImage():new Image,o.onload=()=>{i.image=o,G()},o.onerror=()=>{i.image=null},o.src=i.avatar}catch{i.image=null}}G()}e(g,!1),l.dataset.friends="sample",!(!((t=window.tt)!=null&&t.getFriendsInfo)||!((n=window.tt)!=null&&n.createImage))&&window.tt.getFriendsInfo({success(a){let r=Array.isArray(a==null?void 0:a.friends)?a.friends.filter(i=>i&&typeof i.avatar=="string"):[];r.length&&(e(r,!0),l.dataset.friends="host")},fail(){l.dataset.friends="sample"}})}function T(e,t,n,a,r,i="#fff"){let o=g[(t%g.length+g.length)%g.length];e.save(),e.shadowColor="#25212d20",e.shadowBlur=6,F(e,n,a,r,i),e.shadowBlur=0,o!=null&&o.image?pe(e,o.image,n,a,Math.max(1,r-2)):(F(e,n,a,Math.max(1,r-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][t%4]),H(e,Array.from((o==null?void 0:o.nickname)||"?")[0],n,a,r*.7,"#fff")),e.restore()}function ge(e){var t;return((t=g[(e%g.length+g.length)%g.length])==null?void 0:t.nickname)||"Amico"}function Ie(e,t,n,a,r=13){H(e,Array.from(ge(t)).slice(0,15).join(""),n,a,r)}he();function me(){let e=m(".fit"),t=m(".modal"),n="#e1ebef";l.classList.add("printed-paper"),l.style.position="relative",l.style.isolation="isolate",document.body.style.backgroundColor=n,l.style.backgroundColor=n,e.style.background="transparent",e.style.zIndex="1",t&&l.append(t);let a=document.createElement("style");a.textContent=`#root.printed-paper{color:#282723}
 #root.printed-paper .fit{background:transparent}
 #root.printed-paper .guide,#root.printed-paper .hud,#root.printed-paper .count,#root.printed-paper .question,#root.printed-paper .next,#root.printed-paper .round{color:#282723}
 #root.printed-paper .pill,#root.printed-paper .tilt-enable{background:#fffbee;color:#282723;border:2px solid #282723;border-radius:10px;box-shadow:2px 3px 0 #28272326}
 #root.printed-paper .bottom .reset{background:#fffbee;color:#282723;border:2px solid #282723;box-shadow:2px 3px 0 #28272326}
 #root.printed-paper>.modal{z-index:30;background:#28272345}
 #root.printed-paper>.modal>.result{width:320px;max-width:320px;max-height:var(--paper-result-height);transform:scale(var(--paper-scale));background:#fffbee;color:#282723;border:2px solid #282723;border-radius:12px;box-shadow:4px 5px 0 #28272333}
 #root.printed-paper .result h2,#root.printed-paper .result .value{color:#282723}
 #root.printed-paper .answers button{background:#fffbee;color:#282723;border:2px solid #282723;border-radius:10px;box-shadow:2px 3px 0 #28272326}
 #root.printed-paper .card{border:2px solid #282723;box-shadow:3px 4px 0 #28272326}
 #root.printed-paper .award-label,#root.printed-paper .award-title,#root.printed-paper .award-sub{color:#51463c}`,document.head.append(a),$.push(()=>a.remove());function r(){let i=l.getBoundingClientRect();if(!i.width||!i.height)return;let o=Math.min(i.width/390,i.height/598),s=(i.width-390*o)/2,f=(i.height-598*o)/2;e.style.transform=`translate(${s}px,${f}px) scale(${o})`;let v=String(U("PAPER_BACKDROP","./assets/paper-print-v1.svg"));l.style.backgroundImage=`url("${v.replace(/"/g,"%22")}")`,l.style.backgroundRepeat="repeat",l.style.backgroundSize=`${256*o}px ${256*o}px`,l.style.setProperty("--paper-scale",String(o)),l.style.setProperty("--paper-result-height",`${Math.max(220,i.height/o-80)}px`),t&&(t.style.padding=`${30*o}px ${30*o}px ${50*o}px`)}if(r(),y(window,"resize",r),typeof ResizeObserver<"u"){let i=new ResizeObserver(r);i.observe(l),$.push(()=>i.disconnect())}return r}J(".fit{background:transparent}.guide{top:76px;font-size:16px;color:#768899}.hud{top:27px;color:#64768d;font-family:Playful,Arial}.result{background:#fff4fa}.pill{background:#8c83b8}.bottom{bottom:20px}",`<canvas class="stage" aria-label="Bolle degli amici"></canvas><div class="hud center"><span class="score">0</span></div><div class="guide">Mira \xB7 rilascia \xB7 abbina tre</div><div class="bottom"><button class="capability reset" aria-label="Ricomincia">\u21BB</button></div>${de()}`,"#e1ebef");let be=me(),{canvas:C,ctx:d}=ae(),c=[],p=null,w={x:195,y:200},k=!1,I=0,S=0,A=0,P="ready",M=[],x=20,ye=39,K=138,N=43,xe=37;function b(e,t){return{x:ye+t*N+e%2*N/2,y:K+e*xe}}function ve(e,t){return c.find(n=>n.r===e&&n.c===t)}function Q(e){return c.filter(t=>t!==e&&Math.hypot(b(t.r,t.c).x-b(e.r,e.c).x,b(t.r,t.c).y-b(e.r,e.c).y)<45)}function j(){c=[];for(let e=0;e<4;e++)for(let t=0;t<(e%2?7:8);t++)c.push({r:e,c:t,type:Math.floor(Math.random()*Math.min(4,g.length))});p=null,I=0,S=0,A=0,P="ready",M=[],m(".score").textContent="0",q("ready")}function we(){let e=[];for(let o=0;o<10;o++)for(let s=0;s<(o%2?7:8);s++){if(ve(o,s))continue;let f=b(o,s);(o===0||c.some(v=>Math.hypot(b(v.r,v.c).x-f.x,b(v.r,v.c).y-f.y)<45))&&e.push({r:o,c:s,d:Math.hypot(f.x-p.x,f.y-p.y)})}e.sort((o,s)=>o.d-s.d);let t=e[0];if(!t){L(!1);return}let n={r:t.r,c:t.c,type:p.type};c.push(n),p=null;let a=[],r=[n],i=new Set;for(;r.length;){let o=r.pop();i.has(o)||(i.add(o),a.push(o),r.push(...Q(o).filter(s=>s.type===n.type)))}if(a.length>=3){let o=new Set(a);c=c.filter(u=>!o.has(u));let s=new Set,f=c.filter(u=>u.r===0);for(;f.length;){let u=f.pop();s.has(u)||(s.add(u),f.push(...Q(u)))}let v=c.filter(u=>!s.has(u));c=c.filter(u=>s.has(u));for(let u of[...a,...v]){let ke=b(u.r,u.c);M.push({...ke,type:u.type,vy:Z(40,100),life:.5})}S+=(a.length+v.length)*10,m(".score").textContent=S,A=0,z(700,.1,.15)}else A++;if(A>=5){for(let o of c)o.r++;for(let o=0;o<8;o++)c.push({r:0,c:o,type:Math.floor(Math.random()*Math.min(4,g.length))});A=0}I=Math.floor(Math.random()*Math.min(4,g.length)),l.dataset.bubbles=c.length,c.length?c.some(o=>b(o.r,o.c).y>450)&&L(!1):L(!0)}function L(e){P="result",e?ne():oe(),ce(e?"Tutto libero!":"Quasi!",S,e?"Hai liberato tutte le bolle degli amici.":"Tieni le bolle sopra la linea.",j)}y(C,"pointerdown",e=>{if(p||P==="result")return;let t=_(e);t.y>535||t.y<102||(k=!0,w=t,C.setPointerCapture(e.pointerId))}),y(C,"pointermove",e=>{k&&(w=_(e))}),y(C,"pointerup",()=>{if(!k)return;k=!1,R();let e=w.x-195,t=Math.min(-50,w.y-506),n=Math.hypot(e,t);p={x:195,y:506,vx:e/n*450,vy:t/n*450,type:I},P="playing",q("playing"),z(300,.06,.13,"sine",450)}),y(C,"pointercancel",()=>k=!1),y(m(".reset"),"click",()=>{R(),j()}),j(),ie(e=>{if(p&&P!=="result")for(let n=0;n<4&&p;n++)p.x+=p.vx*e/4,p.y+=p.vy*e/4,p.x<x+21&&(p.x=x+21,p.vx=Math.abs(p.vx)),p.x>369-x&&(p.x=369-x,p.vx=-Math.abs(p.vx)),(p.y<=K||c.some(a=>{let r=b(a.r,a.c);return Math.hypot(p.x-r.x,p.y-r.y)<x*2-2}))&&we();for(let t of M)t.life-=e,t.y+=t.vy*e,t.vy+=500*e;M=M.filter(t=>t.life>0),d.clearRect(0,0,390,598),d.save(),d.setLineDash([3,5]),O(d,30,461,360,461,"#b1bdc9",1),d.restore();for(let t of c){let n=b(t.r,t.c);T(d,t.type,n.x,n.y,x,"#fcfcff")}for(let t of M)d.globalAlpha=t.life*2,T(d,t.type,t.x,t.y,x),d.globalAlpha=1;if(T(d,I,195,506,x,"#fff"),p&&T(d,p.type,p.x,p.y,x),k){let t=w.x-195,n=Math.min(-50,w.y-506),a=Math.hypot(t,n);d.save(),d.setLineDash([2,8]),O(d,195,481,195+t/a*120,506+n/a*120,"#8395ad",3),d.restore()}se(d,148,525,94,5,3,"#a4bdd0")}),ue(()=>{be(),m(".guide")&&(m(".guide").textContent=String(U("GUIDE","Mira \xB7 rilascia \xB7 abbina tre amici")))})})();(()=>{let l=document.createElement("style");l.dataset.batch3Ui="20261116",l.textContent=`
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

.guide{top:76px;font-size:18px;color:#53677f}
.bottom{top:30px;bottom:auto;justify-content:flex-end;pointer-events:none}
.bottom .reset{pointer-events:auto;width:44px;height:44px;padding:0;border-radius:50%;font-size:24px;background:#fff;color:#64768d;border:1px solid #7d94b666}
`,document.head.append(l)})();})();
