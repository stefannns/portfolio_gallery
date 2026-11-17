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

(()=>{(()=>{"use strict";let l=document.getElementById("root"),gt=(t,e,n)=>Math.max(e,Math.min(n,t)),mt=(t,e)=>t+Math.random()*(e-t),bt=t=>t[Math.floor(Math.random()*t.length)],yt=t=>t[t.length-1],xt=t=>{for(let e=t.length-1;e>0;e--){let n=Math.floor(Math.random()*(e+1));[t[e],t[n]]=[t[n],t[e]]}return t},j=[],F=[],M=!0,W=!1,d;function b(t,e,n,i){t.addEventListener(e,n,i),j.push(()=>t.removeEventListener(e,n,i))}function G(t,e,n="#faf8f1"){let i=document.createElement("style");i.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(i),l.style.background=n,l.innerHTML='<div class="fit">'+e+"</div>";let a=l.querySelector(".fit");function o(){let r=l.getBoundingClientRect(),s=Math.min(r.width/390,r.height/598);a.style.transform=`translate(${(r.width-390*s)/2}px,${(r.height-598*s)/2}px) scale(${s})`,l.dataset.layout=`${Math.round(r.width)}x${Math.round(r.height)}`}o(),b(window,"resize",o)}function h(t){return l.querySelector(t)}function K(){var t;(t=h(".guide"))==null||t.classList.add("gone")}function S(t){l.dataset.phase=t}function T(){X(),K()}function X(){try{d||(d=new(window.AudioContext||window.webkitAudioContext)),d.state==="suspended"&&d.resume().catch(()=>{})}catch{}}function C(t=450,e=.08,n=.18,i="sine",a=0){if(!(!d||!M))try{let o=d.createOscillator(),r=d.createGain(),s=d.currentTime;o.type=i,o.frequency.setValueAtTime(t,s),a&&o.frequency.exponentialRampToValueAtTime(Math.max(30,a),s+e),r.gain.setValueAtTime(.001,s),r.gain.exponentialRampToValueAtTime(n,s+.006),r.gain.exponentialRampToValueAtTime(.001,s+e),o.connect(r),r.connect(d.destination),o.start(s),o.stop(s+e+.02),o.onended=()=>{o.disconnect(),r.disconnect()}}catch{}}function Z(){C(523,.12,.18),setTimeout(()=>C(784,.17,.16),100)}function J(){C(180,.22,.18,"triangle",65)}function Q(t){let e=0;function n(i){if(W)return;let a=Math.min(.035,(i-(e||i))/1e3);e=i,document.hidden||t(M?a:0,i/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function tt(){let t=h("canvas.stage"),e=t.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return t.width=390*n,t.height=598*n,e.scale(n,n),{canvas:t,ctx:e}}function et(t,e=h("canvas.stage")){let n=e.getBoundingClientRect();return{x:(t.clientX-n.left)*390/n.width,y:(t.clientY-n.top)*598/n.height}}function nt(t,e,n,i,a,o){o=Math.min(Math.abs(i)/2,Math.abs(a)/2,o),t.moveTo(e+o,n),t.lineTo(e+i-o,n),t.quadraticCurveTo(e+i,n,e+i,n+o),t.lineTo(e+i,n+a-o),t.quadraticCurveTo(e+i,n+a,e+i-o,n+a),t.lineTo(e+o,n+a),t.quadraticCurveTo(e,n+a,e,n+a-o),t.lineTo(e,n+o),t.quadraticCurveTo(e,n,e+o,n),t.closePath()}function ot(t,e,n,i,a,o,r,s){t.beginPath(),nt(t,e,n,i,a,o),r&&(t.fillStyle=r,t.fill()),s&&(t.strokeStyle=s,t.stroke())}function x(t,e,n,i,a,o){t.beginPath(),t.arc(e,n,Math.max(.01,i),0,Math.PI*2),a&&(t.fillStyle=a,t.fill()),o&&(t.strokeStyle=o,t.stroke())}function wt(t,e,n,i,a,o,r=2){t.beginPath(),t.moveTo(e,n),t.lineTo(i,a),t.strokeStyle=o,t.lineWidth=r,t.stroke()}function A(t,e,n,i,a=18,o="#25252a",r="UIBody",s="center"){t.font=`700 ${a}px ${r}`,t.fillStyle=o,t.textAlign=s,t.textBaseline="middle",t.fillText(e,n,i)}let L=[];function $(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(B(e,t))}function vt(t){let e=new Image;return e.onerror=()=>{l.dataset.assetIssue="image"},e.src=$(t),L.push({im:e,path:t}),e}function it(t,e,n,i,a,o){if(!e||!e.width)return;let r=e.videoWidth||e.width,s=e.videoHeight||e.height;if(!r||!s)return;let p=Math.max(a/r,o/s);t.save(),t.beginPath(),t.rect(n,i,a,o),t.clip(),t.drawImage(e,n+(a-r*p)/2,i+(o-s*p)/2,r*p,s*p),t.restore()}function at(t,e,n,i,a){t.save(),t.beginPath(),t.arc(n,i,a,0,Math.PI*2),t.clip(),it(t,e,n-a,i-a,a*2,a*2),t.restore()}function V(t,e,n,i){let a=h(".modal");if(!a)return;a.hidden=!1,a.querySelector("h2").textContent=t,a.querySelector(".value").textContent=e,a.querySelector("p").textContent=n;let o=a.querySelector("button");o.onclick=()=>{a.hidden=!0,T(),i()},S("result")}function rt(t="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function kt(){let t=h(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let st=[];function Y(t){M=t,t||d==null||d.suspend().catch(()=>{});for(let e of st)e(t)}b(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&Y(t.data.active===!0)}),b(document,"visibilitychange",()=>{Y(!document.hidden)}),b(window,"pagehide",()=>{W=!0,j.splice(0).forEach(t=>t()),F.splice(0).forEach(t=>t()),d==null||d.close().catch(()=>{})});let _={};function B(t,e){return _[t]??e}async function lt(t=()=>{}){let e=new AbortController,n=setTimeout(()=>e.abort(),1600);try{let i=await fetch("./game.config.json",{signal:e.signal});if(!i.ok)throw Error("Config unavailable");let a=await i.json();for(let o of["texts","tweaks","images"])for(let r of a[o]||[])_[r.id]=o==="images"?r.path:r.value;for(let o of L){let r=$(o.path);o.im.getAttribute("src")!==r&&(o.im.src=r)}for(let o of l.querySelectorAll('img[src^="./assets/"]'))o.src=$(o.getAttribute("src"));t(),l.dataset.config="loaded"}catch{l.dataset.config="defaults"}finally{clearTimeout(n)}}let g=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],D=()=>{};function ft(){var e,n;function t(i,a){g=i.slice(0,24).map(o=>({nickname:String(o.nickname||"Friend"),avatar:o.avatar,image:null}));for(let o of g){let r;try{r=a?window.tt.createImage():new Image,r.onload=()=>{o.image=r,D()},r.onerror=()=>{o.image=null},r.src=o.avatar}catch{o.image=null}}D()}t(g,!1),l.dataset.friends="sample",!(!((e=window.tt)!=null&&e.getFriendsInfo)||!((n=window.tt)!=null&&n.createImage))&&window.tt.getFriendsInfo({success(i){let a=Array.isArray(i==null?void 0:i.friends)?i.friends.filter(o=>o&&typeof o.avatar=="string"):[];a.length&&(t(a,!0),l.dataset.friends="host")},fail(){l.dataset.friends="sample"}})}function q(t,e,n,i,a,o="#fff"){let r=g[(e%g.length+g.length)%g.length];t.save(),t.shadowColor="#25212d20",t.shadowBlur=6,x(t,n,i,a,o),t.shadowBlur=0,r!=null&&r.image?at(t,r.image,n,i,Math.max(1,a-2)):(x(t,n,i,Math.max(1,a-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][e%4]),A(t,Array.from((r==null?void 0:r.nickname)||"?")[0],n,i,a*.7,"#fff")),t.restore()}function R(t){var e;return((e=g[(t%g.length+g.length)%g.length])==null?void 0:e.nickname)||"Friend"}function zt(t,e,n,i,a=13){A(t,Array.from(R(e)).slice(0,15).join(""),n,i,a)}ft(),G(".fit{background:#94bedb}.guide{top:106px;font-size:17px;font-family:Playful,Arial}.turn{position:absolute;top:142px;left:30px;right:30px;text-align:center;font-size:13px;font-weight:700;color:#20252a}.pill{border-radius:6px;border:2.5px solid #20252a;box-shadow:3px 4px #36556b66;background:transparent;color:#20252a}.result{border:2.5px solid #20252a;border-radius:8px;background:#fffdf7;box-shadow:5px 6px #36556b66}.result .value{font-size:28px}.result .pill{background:#94bedb}",`<canvas class="stage" aria-label="Connect four board"></canvas><div class="guide">Drop your photo \xB7 connect four</div><div class="turn">Your turn</div><div class="bottom"><button class="pill reset">New game</button></div>${rt()}`,"#94bedb");function ct(t){let e=h(".fit"),n=h(".modal");n&&(n.classList.add("host-modal"),l.append(n));let i=document.createElement("style");i.textContent="#root{position:relative;isolation:isolate;color:#20252a}#root>.fit{z-index:1;background:transparent}#root .pill,#root .palette{border-color:#20252a;color:#20252a}#root .pill{box-shadow:3px 4px 0 #36556b66;font-family:Playful,UIBody,sans-serif;font-size:18px}#root>.host-modal{position:absolute;inset:0;z-index:30;display:block;padding:0;background:#20252a38}#root>.host-modal>.result{position:absolute;left:50%;top:calc(50% - var(--modal-shift,10px));width:320px;max-width:none;max-height:518px;overflow-y:auto;transform:translate(-50%,-50%) scale(var(--game-fit-scale,1));transform-origin:center}",document.head.append(i);function a(){let o=l.getBoundingClientRect(),r=Math.min(o.width/390,o.height/598),s=(o.width-390*r)/2,p=(o.height-598*r)/2;e.style.transform=`translate(${s}px,${p}px) scale(${r})`,l.style.setProperty("--game-fit-scale",String(r)),l.style.setProperty("--modal-shift",`${10*r}px`),t==="felt"?(l.style.backgroundImage=`radial-gradient(circle ${380*r}px at ${s+195*r}px ${p+280*r}px, #36674f88 ${50*r}px, #102e2244 ${380*r}px)`,l.style.backgroundRepeat="no-repeat",l.style.backgroundSize="auto",l.style.backgroundPosition="0 0"):(l.style.backgroundImage=`url("${String(B("PAPER_BACKDROP","./assets/paper-print-v1.svg"))}")`,l.style.backgroundRepeat="repeat",l.style.backgroundSize=`${256*r}px ${256*r}px`,l.style.backgroundPosition=`${s}px ${p}px`)}if(a(),b(window,"resize",a),typeof ResizeObserver=="function"){let o=new ResizeObserver(a);o.observe(l),F.push(()=>o.disconnect())}return a}let ut=ct("paper"),{canvas:dt,ctx:f}=tt(),c=Array.from({length:6},()=>Array(7).fill(0)),y=1,w="ready",u=null,U=[],v=0,m=45,E=37.5,k=181;function O(t,e){for(let n=0;n<6;n++)for(let i=0;i<7;i++)for(let[a,o]of[[1,0],[0,1],[1,1],[1,-1]]){let r=[];for(let s=0;s<4;s++){let p=n+a*s,P=i+o*s;if(p<0||p>=6||P<0||P>=7||t[p][P]!==e)break;r.push([p,P])}if(r.length===4)return r}return null}function z(t,e){for(let n=5;n>=0;n--)if(!t[n][e])return n;return-1}function pt(){let t=[3,2,4,1,5,0,6].filter(i=>z(c,i)>=0);for(let i of[2,1])for(let a of t){let o=z(c,a);c[o][a]=i;let r=O(c,i);if(c[o][a]=0,r)return a}let e=-1/0,n=t[0];for(let i of t){let a=z(c,i);c[a][i]=2;let o=4-Math.abs(3-i);for(let r of t){let s=z(c,r);s<0||(c[s][r]=1,O(c,1)&&(o-=100),c[s][r]=0)}c[a][i]=0,o>e&&(e=o,n=i)}return n}function I(){c=Array.from({length:6},()=>Array(7).fill(0)),y=1,w="ready",u=null,v=0,U=[],h(".turn").textContent="Your turn",S("ready")}function H(t,e){let n=z(c,t);n<0||w==="result"||u||(u={col:t,row:n,who:e,y:k-35,vy:0},T(),w="playing",S("playing"))}function ht(){let t=u;c[t.row][t.col]=t.who,u=null,C(330,.07,.16,"triangle");let e=O(c,t.who);if(e){U=e,w="result",t.who===1?Z():J(),V(t.who===1?"You connected four!":R(1)+" wins","4 in a row","Another round?",I);return}if(c.every(n=>n.every(Boolean))){w="result",V("A perfect tie","Draw","One more?",I);return}y=t.who===1?2:1,h(".turn").textContent=y===1?"Your turn":R(1)+" is thinking\u2026",y===2&&(v=.45),l.dataset.turn=y}b(dt,"pointerdown",t=>{let e=et(t);if(y!==1||u||e.y<k||e.y>k+270)return;let n=Math.floor((e.x-E)/m);n>=0&&n<7&&H(n,1)}),b(h(".reset"),"click",()=>{T(),I()}),I();function N(t,e,n){q(f,t-1,e,n,18,t===1?"#fffdf7":"#20252a"),f.save(),f.lineWidth=1.4,x(f,e,n,18,null,"#20252a"),f.restore()}Q(t=>{if(v>0&&(v-=t,v<=0&&y===2&&w!=="result"&&H(pt(),2)),u){u.vy+=1500*t,u.y+=u.vy*t;let e=k+u.row*m+m/2;u.y>=e&&(u.y=e,ht())}f.clearRect(0,0,390,598),q(f,0,65,67,20,"#20252a"),q(f,1,325,67,20,"#20252a"),A(f,"YOU",99,67,13,"#20252a","Playful","left"),A(f,"VS",195,67,15,"#20252a","Playful"),f.save(),f.lineWidth=2.5,f.shadowColor="#36556b66",f.shadowOffsetX=5,f.shadowOffsetY=6,ot(f,30,174,330,284,6,"#fffdf7","#20252a"),f.restore();for(let e=0;e<6;e++)for(let n=0;n<7;n++){let i=E+n*m+m/2,a=k+e*m+m/2;f.save(),f.globalCompositeOperation="destination-out",x(f,i,a,18,"#000"),f.restore(),f.save(),f.lineWidth=1.6,x(f,i,a,18,null,"#20252a"),f.restore(),c[e][n]&&N(c[e][n],i,a),U.some(([o,r])=>o===e&&r===n)&&(f.save(),f.lineWidth=2.8,x(f,i,a,21,null,"#20252a"),f.restore())}u&&N(u.who,E+u.col*m+m/2,u.y)}),lt(()=>{ut(),h(".guide")&&(h(".guide").textContent=String(B("GUIDE","Drop your photo \xB7 connect four")))})})();(()=>{let l=document.createElement("style");l.dataset.batch3Ui="20261116",l.textContent=`
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
.guide{font-size:18px}.turn{font-size:14px;line-height:1.4;top:143px}.pill{min-height:44px;font-size:16px}.bottom{bottom:54px}`,document.head.append(l)})();})();
