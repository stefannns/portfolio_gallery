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

(()=>{document.documentElement.lang="it";(()=>{"use strict";let c=document.getElementById("root"),wt=(t,e,o)=>Math.max(e,Math.min(o,t)),kt=(t,e)=>t+Math.random()*(e-t),St=t=>t[Math.floor(Math.random()*t.length)],Ct=t=>t[t.length-1],Mt=t=>{for(let e=t.length-1;e>0;e--){let o=Math.floor(Math.random()*(e+1));[t[e],t[o]]=[t[o],t[e]]}return t},N=[],M=[],T=!0,A=!1,u;function h(t,e,o,i){t.addEventListener(e,o,i),N.push(()=>t.removeEventListener(e,o,i))}function lt(t,e,o="#faf8f1"){let i=document.createElement("style");i.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(i),c.style.background=o,c.innerHTML='<div class="fit">'+e+"</div>";let a=c.querySelector(".fit");function n(){let s=c.getBoundingClientRect(),l=Math.min(s.width/390,s.height/598);a.style.transform=`translate(${(s.width-390*l)/2}px,${(s.height-598*l)/2}px) scale(${l})`,c.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}n(),h(window,"resize",n)}function r(t){return c.querySelector(t)}function ct(){var t;(t=r(".guide"))==null||t.classList.add("gone")}function x(t){c.dataset.phase=t}function q(){Z(),ct()}function Z(){try{u||(u=new(window.AudioContext||window.webkitAudioContext)),u.state==="suspended"&&u.resume().catch(()=>{})}catch{}}function B(t=450,e=.08,o=.18,i="sine",a=0){if(!(!u||!T))try{let n=u.createOscillator(),s=u.createGain(),l=u.currentTime;n.type=i,n.frequency.setValueAtTime(t,l),a&&n.frequency.exponentialRampToValueAtTime(Math.max(30,a),l+e),s.gain.setValueAtTime(.001,l),s.gain.exponentialRampToValueAtTime(o,l+.006),s.gain.exponentialRampToValueAtTime(.001,l+e),n.connect(s),s.connect(u.destination),n.start(l),n.stop(l+e+.02),n.onended=()=>{n.disconnect(),s.disconnect()}}catch{}}function dt(){B(523,.12,.18),setTimeout(()=>B(784,.17,.16),100)}function Tt(){B(180,.22,.18,"triangle",65)}function pt(t){let e=0;function o(i){if(A)return;let a=Math.min(.035,(i-(e||i))/1e3);e=i,document.hidden||t(T?a:0,i/1e3),requestAnimationFrame(o)}requestAnimationFrame(o)}function At(){let t=r("canvas.stage"),e=t.getContext("2d"),o=Math.min(2,window.devicePixelRatio||1);return t.width=390*o,t.height=598*o,e.scale(o,o),{canvas:t,ctx:e}}function It(t,e=r("canvas.stage")){let o=e.getBoundingClientRect();return{x:(t.clientX-o.left)*390/o.width,y:(t.clientY-o.top)*598/o.height}}function V(t,e,o,i,a,n){n=Math.min(Math.abs(i)/2,Math.abs(a)/2,n),t.moveTo(e+n,o),t.lineTo(e+i-n,o),t.quadraticCurveTo(e+i,o,e+i,o+n),t.lineTo(e+i,o+a-n),t.quadraticCurveTo(e+i,o+a,e+i-n,o+a),t.lineTo(e+n,o+a),t.quadraticCurveTo(e,o+a,e,o+a-n),t.lineTo(e,o+n),t.quadraticCurveTo(e,o,e+n,o),t.closePath()}function zt(t,e,o,i,a,n,s,l){t.beginPath(),V(t,e,o,i,a,n),s&&(t.fillStyle=s,t.fill()),l&&(t.strokeStyle=l,t.stroke())}function Pt(t,e,o,i,a,n){t.beginPath(),t.arc(e,o,Math.max(.01,i),0,Math.PI*2),a&&(t.fillStyle=a,t.fill()),n&&(t.strokeStyle=n,t.stroke())}function Bt(t,e,o,i,a,n,s=2){t.beginPath(),t.moveTo(e,o),t.lineTo(i,a),t.strokeStyle=n,t.lineWidth=s,t.stroke()}function H(t,e,o,i,a=18,n="#25252a",s="UIBody",l="center"){t.font=`700 ${a}px ${s}`,t.fillStyle=n,t.textAlign=l,t.textBaseline="middle",t.fillText(e,o,i)}let W=[];function U(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(L(e,t))}function Et(t){let e=new Image;return e.onerror=()=>{c.dataset.assetIssue="image"},e.src=U(t),W.push({im:e,path:t}),e}function R(t,e,o,i,a,n){if(!e)return!1;let s=e.videoWidth||e.naturalWidth||e.width,l=e.videoHeight||e.naturalHeight||e.height;if(!s||!l)return!1;let p=Math.max(a/s,n/l);return t.save(),t.beginPath(),t.rect(o,i,a,n),t.clip(),t.drawImage(e,o+(a-s*p)/2,i+(n-l*p)/2,s*p,l*p),t.restore(),!0}function $t(t,e,o,i,a){t.save(),t.beginPath(),t.arc(o,i,a,0,Math.PI*2),t.clip(),R(t,e,o-a,i-a,a*2,a*2),t.restore()}function qt(t,e,o,i){let a=r(".modal");if(!a)return;a.hidden=!1,a.querySelector("h2").textContent=t,a.querySelector(".value").textContent=e,a.querySelector("p").textContent=o;let n=a.querySelector("button");n.onclick=()=>{a.hidden=!0,q(),i()},x("result")}function Ut(t="Rigioca"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function ut(){let t=r(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let _=[];function G(t){T=t,t||u==null||u.suspend().catch(()=>{});for(let e of _)e(t)}h(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&G(t.data.active===!0)}),h(document,"visibilitychange",()=>{G(!document.hidden)}),h(window,"pagehide",()=>{A=!0,N.splice(0).forEach(t=>t()),M.splice(0).forEach(t=>t()),u==null||u.close().catch(()=>{})});let Q={};function L(t,e){return Q[t]??e}async function ft(t=()=>{}){let e=new AbortController,o=setTimeout(()=>e.abort(),1600);try{let i=await fetch("./game.config.json",{signal:e.signal});if(!i.ok)throw Error("Configurazione non disponibile");let a=await i.json();for(let n of["texts","tweaks","images"])for(let s of a[n]||[])Q[s.id]=n==="images"?s.path:s.value;for(let n of W){let s=U(n.path);n.im.getAttribute("src")!==s&&(n.im.src=s)}for(let n of c.querySelectorAll('img[src^="./assets/"]'))n.src=U(n.getAttribute("src"));t(),c.dataset.config="loaded"}catch{c.dataset.config="defaults"}finally{clearTimeout(o)}}let m=null,I="user",y=!1,z=0,O=!1,J=!0,d=(t,e)=>J?e:t;function w(){let t=r("video.preview");return O&&(m!=null&&m.getVideoTracks().some(e=>e.readyState==="live"&&e.enabled))&&(t==null?void 0:t.readyState)>=2&&t.videoWidth>0&&t.videoHeight>0?t:null}function k(t,e){c.dataset.camera=t;let o=r(".cam-status"),i=r(".cam-enable");o&&(o.textContent=e),i&&(i.disabled=!1,i.setAttribute("aria-pressed",String(t==="enabled")),i.textContent=y?d("Connessione\u2026 \xB7 Annulla","Connessione\u2026 \xB7 Annulla"):t==="enabled"?d("Fotocamera attiva \xB7 Interrompi","Fotocamera attiva \xB7 Interrompi"):d("Attiva fotocamera","Attiva fotocamera"));for(let a of c.querySelectorAll(".shutter,.cam-capture"))a.disabled=!w()}function b(){z++,O=!1,y=!1;let t=m;m=null,t==null||t.getTracks().forEach(o=>o.stop());let e=r("video.preview");e&&(e.pause(),e.srcObject=null),k("idle",d("Attiva la fotocamera per scattare una foto","Attiva la fotocamera per scattare una foto"))}async function K(){var o;if(y)return;b();let t=++z;y=!0,k("requesting",d("In attesa della fotocamera\u2026","In attesa della fotocamera\u2026"));let e;try{if(!((o=navigator.mediaDevices)!=null&&o.getUserMedia))throw Error("Fotocamera non disponibile");if(e=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:I}},audio:!1}),A||!T||t!==z){e.getTracks().forEach(n=>n.stop());return}m=e;let i=r("video.preview");i.muted=!0,i.playsInline=!0,i.srcObject=e;let a;try{await Promise.race([i.play(),new Promise((n,s)=>{a=setTimeout(()=>s(Error("La fotocamera non si \xE8 avviata")),7e3)})])}finally{clearTimeout(a)}if(await new Promise((n,s)=>{let l,p=()=>{clearTimeout(l),i.removeEventListener("loadeddata",f),i.removeEventListener("canplay",f)},f=()=>{i.readyState>=2&&i.videoWidth>0&&i.videoHeight>0&&(p(),n())};i.addEventListener("loadeddata",f),i.addEventListener("canplay",f),l=setTimeout(()=>{p(),s(Error("Nessuna immagine ricevuta dalla fotocamera"))},7e3),f()}),A||!T||t!==z){e.getTracks().forEach(n=>n.stop());return}O=!0,y=!1;for(let n of e.getVideoTracks())h(n,"ended",()=>{m===e&&(b(),k("unavailable",d("Fotocamera scollegata \xB7 riprova","Fotocamera scollegata \xB7 riprova")))});k("enabled",d("Fotocamera pronta \xB7 scatta una foto","Fotocamera pronta \xB7 scatta una foto"))}catch(i){if(e==null||e.getTracks().forEach(n=>n.stop()),t!==z)return;b();let a=(i==null?void 0:i.name)==="NotAllowedError"||(i==null?void 0:i.name)==="SecurityError";k("unavailable",a?d("Accesso alla fotocamera bloccato \xB7 consenti e riprova","Accesso alla fotocamera bloccato \xB7 consenti e riprova"):d("Nessuna immagine dalla fotocamera \xB7 riprova","Nessuna immagine dalla fotocamera \xB7 riprova"))}}function ht(t=600,e=800,o=!0){let i=w();if(!i)return null;let a=document.createElement("canvas");a.width=t,a.height=e;let n=a.getContext("2d");return o&&I==="user"&&(n.translate(t,0),n.scale(-1,1)),R(n,i,0,0,t,e)?a:null}function mt(t,e="#f0ede5"){let o=t.getContext("2d"),i=t.width,a=t.height;o.fillStyle=e,o.fillRect(0,0,i,a);let n=w();if(n){o.save(),I==="user"&&(o.translate(i,0),o.scale(-1,1)),R(o,n,0,0,i,a),o.restore();return}o.save(),o.translate(i/2,a/2-8);let s=Math.min(i,a)/160;o.scale(s,s),o.strokeStyle="#767268",o.lineWidth=3,o.lineJoin="round",o.beginPath(),V(o,-29,-19,58,38,6),o.stroke(),o.beginPath(),o.arc(0,0,10,0,Math.PI*2),o.stroke(),o.beginPath(),o.moveTo(-17,-19),o.lineTo(-12,-27),o.lineTo(12,-27),o.lineTo(17,-19),o.stroke(),o.restore()}function gt(){var e;(e=r("video.preview"))==null||e.setAttribute("aria-hidden","true");let t=document.createElement("style");t.textContent='.preview{display:block!important;position:absolute!important;width:1px!important;height:1px!important;left:0;bottom:0;opacity:.001;pointer-events:none}.cam-enable[aria-pressed="true"]{border-color:#47754b;background:#edf5e9;color:#315b35}',document.head.append(t),h(r(".cam-enable"),"click",()=>{Z(),m||y?b():K()}),r(".cam-flip")&&h(r(".cam-flip"),"click",()=>{I=I==="user"?"environment":"user",b(),K()}),_.push(o=>{o||b()}),M.push(b),k("idle",d("Attiva la fotocamera per scattare una foto","Attiva la fotocamera per scattare una foto"))}function X(){let t=String(L("PAPER_BACKDROP","./assets/paper-print-v1.svg"));c.style.backgroundColor="#efd77b",c.style.backgroundImage="url("+JSON.stringify(t)+")",c.style.backgroundSize="256px 256px",c.style.backgroundRepeat="repeat"}function bt(){X();let t=document.createElement("style");t.textContent=`#root{position:relative;isolation:isolate;color:#282723}
 #root .fit{background:transparent!important}
 #root .paper-overlay{position:absolute;inset:0;z-index:40;background:transparent;pointer-events:auto;isolation:isolate}
 #root .paper-overlay[hidden]{display:none!important}
 #root .paper-result-fit{position:absolute;width:390px;height:598px;transform-origin:0 0;font-family:UIBody,system-ui,sans-serif;pointer-events:auto}
 #root .paper-result-fit .modal{background:transparent}
 #root .result,#root .comparison{background:#fff4c7;color:#282723;border:2px solid #282723;border-radius:12px;box-shadow:4px 5px 0 #28272322}
 #root .pill{background:#282723;color:#fff9e9;border:2px solid #282723;box-shadow:0 3px 0 #28272325}
 #root .capability,#root .stop-sugar{color:#282723;background:#fff4c7;border:2px solid #282723;box-shadow:0 2px 0 #2827231c}
 #root .capability:disabled,#root .pill:disabled{box-shadow:none}
 #root .shutter{border-color:#282723;background:#fff4c7}
 #root .eyebrow,#root .booth-label,#root .guide{color:#282723}
 #root .cam-status,#root .mic-status,#root .target-label{color:#625c4b}
 #root .live-booth{border-color:#282723;border-radius:10px;box-shadow:4px 5px 0 #28272325}#root .doodles{opacity:.72}#root .shutter{box-shadow:inset 0 0 0 5px #fff4c7,inset 0 0 0 7px #282723}#root .strip-view{padding:0}#root .strip-view canvas{filter:drop-shadow(2px 3px 0 #28272328)}`,document.head.append(t);let e=c.querySelector(".fit"),o=e.querySelector(".comparison,.strip-view,.modal");if(!o)return;let i=document.createElement("div"),a=document.createElement("div");i.className="paper-overlay",a.className="paper-result-fit",i.hidden=o.hidden,a.append(o),i.append(a),c.append(i),o.setAttribute("role","dialog"),o.setAttribute("aria-modal","true");function n(){i.hidden=o.hidden,e.inert=!o.hidden,e.style.visibility=o.hidden?"visible":"hidden"}let s=new MutationObserver(n);s.observe(o,{attributes:!0,attributeFilter:["hidden"]});function l(){let f=c.getBoundingClientRect(),C=Math.min(f.width/390,f.height/598),rt=`translate(${(f.width-390*C)/2}px,${(f.height-598*C)/2}px) scale(${C})`;a.style.transform=rt,e.style.transform=rt}n(),l(),h(window,"resize",l);let p=typeof ResizeObserver=="function"?new ResizeObserver(l):null;p==null||p.observe(c),M.push(()=>{s.disconnect(),p==null||p.disconnect()})}let Y="M-7 0C-2-10 10-10 15-1C12 9-2 9-7 0ZM-7 0-15-7-14 7ZM-1-7 2-12 6-8",tt="M0-13C17-14 18 13 1 14C-17 15-18-12 0-13ZM-7 4Q0 13 7 3";function et(t,e,o=1){return`<g transform="translate(${t} ${e}) scale(${o})"><path d="${Y}"/><circle cx="9" cy="-2" r="1.2" fill="#282723" stroke="none"/></g>`}function ot(t,e,o=1){return`<g transform="translate(${t} ${e}) scale(${o})"><path d="${tt}"/><g fill="#282723" stroke="none"><circle cx="-5" cy="-3" r="1.25"/><circle cx="5" cy="-3" r="1.25"/></g></g>`}function it(t,e,o=1){return`<g transform="translate(${t} ${e}) scale(${o})"><path d="M-3-6C-12-19 4-22 3-8C15-20 23-4 8-2C24 4 10 19 4 6C2 23-15 18-7 4C-23 5-24-12-9-8Q-6-8-3-6Z"/><path d="M3 5q-2 10 1 17m-1-5q10-7 11-2-4 7-11 2"/><circle r="3.7"/></g>`}function at(t,e,o=1){return`<g transform="translate(${t} ${e}) scale(${o})"><path d="M-10 13Q-20-5 9-15Q21 4-10 13ZM-11 16 6-10M-7 9-11 0M-3 3 7 2"/></g>`}function nt(t,e,o,i,a=1){t.save(),t.translate(o,i),t.scale(a,a),t.strokeStyle="#282723",t.fillStyle="#282723",t.lineWidth=1.8,t.lineCap="round",t.lineJoin="round",t.stroke(new Path2D(e==="fish"?Y:tt));for(let[n,s]of e==="fish"?[[9,-2]]:[[-5,-3],[5,-3]])t.beginPath(),t.arc(n,s,1.25,0,Math.PI*2),t.fill();t.restore()}function vt(t){let e=r(t==="camera"?".cam-status":".mic-status");if(!e)return;let o=!0;e.setAttribute("role","status"),e.setAttribute("aria-live","polite");function i(){var f;let l="";if(t==="camera")["requesting","unavailable"].includes(c.dataset.camera)&&(l=e.textContent);else{let C=((f=r(".mic-enable"))==null?void 0:f.dataset.micState)||c.dataset.microphone;C==="requesting"?l="Consenti l\u2019accesso al microfono":["unavailable","error"].includes(C)&&(l="Microfono non disponibile")}e.textContent!==l&&(e.textContent=l);let p=!l.trim();e.hidden!==p&&(e.hidden=p)}let a=new MutationObserver(i);a.observe(e,{childList:!0,characterData:!0,subtree:!0});let n=new MutationObserver(i);n.observe(c,{attributes:!0,attributeFilter:[t==="camera"?"data-camera":"data-microphone"]});let s=r(".mic-enable");s&&n.observe(s,{attributes:!0,attributeFilter:["data-mic-state"]}),i(),M.push(()=>{a.disconnect(),n.disconnect()})}lt(`#root .booth-label{position:absolute;left:30px;right:30px;top:30px;text-align:center;font:24px/1.3 Playful,UIBody,sans-serif;transform:none}
#root .doodles{position:absolute;inset:0;width:100%;height:100%;z-index:10;pointer-events:none;opacity:.75}
#root .live-booth{position:absolute;left:39px;top:118px;width:312px;height:293px;background:#eee9dd;border:4px solid #282723;transform:none;border-radius:10px;overflow:hidden;box-shadow:4px 5px 0 #28272325}
#root .live-booth canvas{display:block;width:100%;height:100%;filter:grayscale(1)}
#root .guide{top:432px;left:30px;right:30px;margin:0;font:400 18px/1.35 UIBody,system-ui,sans-serif}
#root .countdown{position:absolute;left:39px;top:118px;width:312px;height:293px;display:grid;place-items:center;pointer-events:none;text-align:center;font:70px/1 Playful,UIBody,sans-serif;color:#fff;text-shadow:2px 2px #28272388}
#root .cam-status{top:77px;bottom:auto;left:30px;right:30px;font:400 12px/1.4 UIBody,system-ui,sans-serif;color:#625c4b;margin:0}
#root .bottom{left:30px;right:30px;bottom:50px;display:grid;grid-template-columns:minmax(0,1fr);gap:0;align-items:center;justify-items:center;min-height:58px}
#root .bottom .capability{grid-area:1/1;width:230px;max-width:100%;min-width:0;min-height:48px;padding:8px 14px;font-size:14px;line-height:1.3}
#root .bottom .shutter{position:relative;grid-area:1/1;left:auto;bottom:auto;display:flex;align-items:center;justify-content:center;gap:10px;width:230px;max-width:100%;height:58px;min-height:58px;padding:8px 14px;border:2px solid #282723;border-radius:24px;background:#fff4c7;color:#282723;box-shadow:0 2px 0 #28272325;font:700 16px/1.3 UIBody,system-ui,sans-serif}#root .shutter svg{width:23px;height:23px;flex:none;pointer-events:none}
#root .strip-view{position:absolute;inset:30px 30px 50px;z-index:15;display:grid;grid-template-rows:minmax(0,1fr) auto minmax(18px,auto);gap:12px;align-items:center;justify-items:center;background:transparent;border:0;border-radius:0;padding:0;box-shadow:none}
#root .strip-view[hidden]{display:none}
#root .strip-view .strip{position:relative;z-index:1;align-self:center;height:100%;max-height:100%;width:auto;max-width:100%;min-height:0;min-width:0;object-fit:contain;filter:drop-shadow(2px 3px 0 #28272328)}
#root .strip-actions{position:relative;z-index:1;display:grid;grid-template-columns:1.15fr 1fr;gap:12px;width:100%}
#root .strip-actions .pill{position:static;min-width:0;min-height:48px;margin:0;padding:10px 8px;font:700 14px/1.3 UIBody,system-ui,sans-serif}
#root .save-status{position:relative;z-index:1;min-height:18px;margin:0;width:100%;color:#625c4b;text-align:center;font:400 12px/1.4 UIBody,system-ui,sans-serif;overflow-wrap:anywhere}
#root .strip-doodles{position:absolute;inset:0;width:100%;height:100%;z-index:2;opacity:.7;pointer-events:none}
.preview{display:none}`,`<div class="booth-label">FOTO E SCARABOCCHI</div><svg class="doodles" viewBox="0 0 390 598" fill="none" stroke="#282723" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${et(18,215)}${ot(20,342)}${it(371,199,.65)}${at(373,341,.68)}<path d="M4 94q10-2 11-13 2 11 12 14-11 1-13 12-1-11-10-13ZM366 94q9-2 11-13 0 12 10 14-11 1-13 12-1-10-8-13ZM24 467q8-1 9-9 2 8 9 10-8 1-10 9-1-8-8-10ZM358 464l5-8 1 10 10 3-10 3-2 8-2-9-8-4Z"/></svg><div class="live-booth"><canvas width="640" height="600" aria-label="Anteprima della fotocamera"></canvas></div><video class="preview" playsinline autoplay muted></video><div class="guide">Mettiti in posa per tre foto</div><div class="countdown" aria-live="polite"></div><div class="status cam-status" hidden></div><div class="bottom"><button class="capability cam-enable">Attiva fotocamera</button><button class="shutter" aria-label="Scatta tre foto" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5 7 7l1.6-3h6.7L17 7l3.4.4.2 12-17.2.2Z"/><path d="M16.6 12.7c.2 6.1-9.4 6.1-9.2.1-.1-6 9.3-6.2 9.2-.1Z"/></svg><span class="shutter-label">Scatta foto</span></button></div><div class="strip-view" hidden aria-label="Le tue foto"><svg class="strip-doodles" viewBox="0 0 330 518" fill="none" stroke="#282723" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${et(43,128,1.35)}${ot(285,318,1.3)}${it(283,142,.8)}${at(44,331,.95)}<path d="M23 224q9-1 10-12 2 10 12 13-11 1-13 12-1-10-9-13ZM286 232l5-9 2 10 10 3-10 3-2 10-2-10-9-4Z"/></svg><canvas class="strip" width="720" height="2100" role="img" aria-label="La tua striscia di tre foto"></canvas><div class="strip-actions"><button class="pill save-strip">Salva immagine</button><button class="pill retake">Riscatta</button></div><p class="save-status" role="status" aria-live="polite"></p></div><div class="flash"></div>`,"#efd77b"),vt("camera"),bt();let g="ready",S=0,v=[],P=!1,E=0,$;function F(t,e=""){let o=r(".save-strip");P=t==="saving",o.disabled=P,o.setAttribute("aria-busy",String(P)),o.textContent=P?d("Saving\u2026","Salvataggio\u2026"):d("Salva immagine","Salva immagine"),r(".save-status").textContent=e,c.dataset.save=t}function j(){E++,clearTimeout($),F("ready")}function xt(){var i;if(P||g!=="result"||v.length!==3)return;let t=++E,e=!1;function o(a,n){e||t!==E||A||(e=!0,clearTimeout($),F(a,n))}F("saving",d("Salvataggio delle tue foto\u2026","Salvataggio delle tue foto\u2026"));try{let a=r(".strip").toDataURL("image/png");if(!a.startsWith("data:image/"))throw Error("Nessuna foto da salvare");let n="doodle-booth-"+Date.now();if(typeof((i=window.tt)==null?void 0:i.saveDataURL)=="function")$=setTimeout(()=>o("error",d("Nessuna conferma. Puoi riprovare.","Nessuna conferma. Puoi riprovare.")),15e3),window.tt.saveDataURL({dataURL:a,filename:n,extension:"png",saveToAlbum:"image",success(){o("saved",d("Salvata nelle tue foto.","Salvata nelle tue foto."))},fail(s){console.warn("[photo-booth] Save failed:",(s==null?void 0:s.message)||"Non disponibile"),o("error",d("Impossibile salvare. Controlla i permessi e riprova.","Impossibile salvare. Controlla i permessi e riprova."))},complete(){e||o("error",d("Nessuna conferma. Puoi riprovare.","Nessuna conferma. Puoi riprovare."))}});else{let s=document.createElement("a");s.href=a,s.download=n+".png",s.hidden=!0,document.body.append(s),s.click(),s.remove(),o("downloaded",d("Download avviato. Controlla i download.","Download avviato. Controlla i download."))}}catch(a){console.warn("[photo-booth] Export failed:",(a==null?void 0:a.message)||"Non disponibile"),o("error",d("Impossibile salvare questa immagine. Riprova.","Impossibile salvare questa immagine. Riprova."))}}h(r(".save-strip"),"click",xt),M.push(()=>{E++,clearTimeout($)}),r(".retake").textContent=d("Riscatta","Riscatta"),r(".strip-view").setAttribute("aria-label",d("Le tue foto","Le tue foto")),r(".shutter").setAttribute("aria-label",d("Scatta tre foto","Scatta tre foto")),j();let st="";function D(){let t=!!w(),e=g==="shooting",o=String(t)+":"+String(e);if(st===o)return;st=o;let i=r(".cam-enable"),a=r(".shutter");i.hidden=t,a.hidden=!t,a.disabled=!t||e,a.setAttribute("aria-busy",String(e)),r(".shutter-label").textContent=e?d("Scatto in corso\u2026","Scatto in corso\u2026"):d("Scatta foto","Scatta foto")}gt(),D(),r(".guide").textContent=d("Mettiti in posa per tre foto","Mettiti in posa per tre foto"),h(r(".shutter"),"click",()=>{g!=="ready"||!w()||(q(),v=[],S=3,g="shooting",D(),x("shooting"))}),h(r(".retake"),"click",()=>{j(),q(),r(".strip-view").hidden=!0,g="ready",x("ready")});function yt(){let t=r(".strip"),e=t.getContext("2d");e.setTransform(2,0,0,2,0,0),e.fillStyle="#fffdf3",e.fillRect(0,0,360,1050),v.forEach((o,i)=>{e.save(),e.filter="grayscale(1) contrast(1.1)",e.drawImage(o,20,20+i*316,320,300),e.restore()}),e.strokeStyle="#262323",e.lineWidth=2,e.strokeRect(9,9,342,1032),H(e,"PICCOLI MOMENTI FELICI",180,989,14,"#292724","UIBody"),H(e,new Date().toLocaleDateString(J?"it-IT":"en-US",{month:"short",day:"numeric",year:"numeric"}),180,1015,11,"#666","UIBody"),nt(e,"fish",42,991,1.2),nt(e,"face",321,996,1.05),j(),r(".strip-view").hidden=!1,g="result",x("result"),dt()}pt(t=>{if(D(),mt(r(".live-booth canvas"),"#eee9dd"),g==="shooting"){if(!w()){g="ready",v=[],r(".countdown").textContent="",x("ready");return}if(S-=t,r(".countdown").textContent=S>0?Math.ceil(S):"",S<=0){let e=ht(640,600);if(!e)return;v.push(e),ut(),B(100,.08,.18,"triangle",60),c.dataset.shots=v.length,v.length===3?yt():S=2.2}}}),x("ready"),ft(()=>{if(X(),r(".guide")){let t=String(L("GUIDE","Mettiti in posa per tre foto"));r(".guide").textContent=t==="Mettiti in posa per tre foto"?d(t,"Mettiti in posa per tre foto"):t}})})();(()=>{let c=document.createElement("style");c.dataset.batch3Ui="20261116",c.textContent=`
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

.booth-label{top:30px;font-size:24px;line-height:1.3}
.guide{top:414px;font:400 18px/1.4 UIBody,system-ui,sans-serif}
.shutter{bottom:100px;min-height:52px}
.cam-status{top:78px;bottom:auto;font-size:12px;color:#655e50}
.strip-view{inset:30px 30px 50px;flex-direction:column;gap:14px}
.strip-view canvas{max-height:calc(100% - 68px);height:auto;max-width:100%;width:auto}
.retake{position:static;min-height:44px;flex:none;margin:0}
`,document.head.append(c)})();})();
