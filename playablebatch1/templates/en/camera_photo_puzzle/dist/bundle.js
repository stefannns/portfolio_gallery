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

(()=>{(()=>{"use strict";let l=document.getElementById("root"),ct=(t,e,o)=>Math.max(e,Math.min(o,t)),ut=(t,e)=>t+Math.random()*(e-t),ft=t=>t[Math.floor(Math.random()*t.length)],ht=t=>t[t.length-1],G=t=>{for(let e=t.length-1;e>0;e--){let o=Math.floor(Math.random()*(e+1));[t[e],t[o]]=[t[o],t[e]]}return t},N=[],P=[],q=!0,w=!1,d;function c(t,e,o,i){t.addEventListener(e,o,i),N.push(()=>t.removeEventListener(e,o,i))}function Q(t,e,o="#faf8f1"){let i=document.createElement("style");i.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(i),l.style.background=o,l.innerHTML='<div class="fit">'+e+"</div>";let n=l.querySelector(".fit");function a(){let s=l.getBoundingClientRect(),p=Math.min(s.width/390,s.height/598);n.style.transform=`translate(${(s.width-390*p)/2}px,${(s.height-598*p)/2}px) scale(${p})`,l.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}a(),c(window,"resize",a)}function r(t){return l.querySelector(t)}function tt(){var t;(t=r(".guide"))==null||t.classList.add("gone")}function S(t){l.dataset.phase=t}function L(){Y(),tt()}function Y(){try{d||(d=new(window.AudioContext||window.webkitAudioContext)),d.state==="suspended"&&d.resume().catch(()=>{})}catch{}}function M(t=450,e=.08,o=.18,i="sine",n=0){if(!(!d||!q))try{let a=d.createOscillator(),s=d.createGain(),p=d.currentTime;a.type=i,a.frequency.setValueAtTime(t,p),n&&a.frequency.exponentialRampToValueAtTime(Math.max(30,n),p+e),s.gain.setValueAtTime(.001,p),s.gain.exponentialRampToValueAtTime(o,p+.006),s.gain.exponentialRampToValueAtTime(.001,p+e),a.connect(s),s.connect(d.destination),a.start(p),a.stop(p+e+.02),a.onended=()=>{a.disconnect(),s.disconnect()}}catch{}}function et(){M(523,.12,.18),setTimeout(()=>M(784,.17,.16),100)}function gt(){M(180,.22,.18,"triangle",65)}function ot(t){let e=0;function o(i){if(w)return;let n=Math.min(.035,(i-(e||i))/1e3);e=i,document.hidden||t(q?n:0,i/1e3),requestAnimationFrame(o)}requestAnimationFrame(o)}function mt(){let t=r("canvas.stage"),e=t.getContext("2d"),o=Math.min(2,window.devicePixelRatio||1);return t.width=390*o,t.height=598*o,e.scale(o,o),{canvas:t,ctx:e}}function bt(t,e=r("canvas.stage")){let o=e.getBoundingClientRect();return{x:(t.clientX-o.left)*390/o.width,y:(t.clientY-o.top)*598/o.height}}function nt(t,e,o,i,n,a){a=Math.min(Math.abs(i)/2,Math.abs(n)/2,a),t.moveTo(e+a,o),t.lineTo(e+i-a,o),t.quadraticCurveTo(e+i,o,e+i,o+a),t.lineTo(e+i,o+n-a),t.quadraticCurveTo(e+i,o+n,e+i-a,o+n),t.lineTo(e+a,o+n),t.quadraticCurveTo(e,o+n,e,o+n-a),t.lineTo(e,o+a),t.quadraticCurveTo(e,o,e+a,o),t.closePath()}function xt(t,e,o,i,n,a,s,p){t.beginPath(),nt(t,e,o,i,n,a),s&&(t.fillStyle=s,t.fill()),p&&(t.strokeStyle=p,t.stroke())}function yt(t,e,o,i,n,a){t.beginPath(),t.arc(e,o,Math.max(.01,i),0,Math.PI*2),n&&(t.fillStyle=n,t.fill()),a&&(t.strokeStyle=a,t.stroke())}function vt(t,e,o,i,n,a,s=2){t.beginPath(),t.moveTo(e,o),t.lineTo(i,n),t.strokeStyle=a,t.lineWidth=s,t.stroke()}function wt(t,e,o,i,n=18,a="#25252a",s="UIBody",p="center"){t.font=`700 ${n}px ${s}`,t.fillStyle=a,t.textAlign=p,t.textBaseline="middle",t.fillText(e,o,i)}let _=[];function B(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String($(e,t))}function it(t){let e=new Image;return e.onerror=()=>{l.dataset.assetIssue="image"},e.src=B(t),_.push({im:e,path:t}),e}function F(t,e,o,i,n,a){if(!e)return!1;let s=e.videoWidth||e.naturalWidth||e.width,p=e.videoHeight||e.naturalHeight||e.height;if(!s||!p)return!1;let E=Math.max(n/s,a/p);return t.save(),t.beginPath(),t.rect(o,i,n,a),t.clip(),t.drawImage(e,o+(n-s*E)/2,i+(a-p*E)/2,s*E,p*E),t.restore(),!0}function zt(t,e,o,i,n){t.save(),t.beginPath(),t.arc(o,i,n,0,Math.PI*2),t.clip(),F(t,e,o-n,i-n,n*2,n*2),t.restore()}function at(t,e,o,i){let n=r(".modal");if(!n)return;n.hidden=!1,n.querySelector("h2").textContent=t,n.querySelector(".value").textContent=e,n.querySelector("p").textContent=o;let a=n.querySelector("button");a.onclick=()=>{n.hidden=!0,L(),i()},S("result")}function st(t="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function Ct(){let t=r(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let rt=[];function V(t){q=t,t||d==null||d.suspend().catch(()=>{});for(let e of rt)e(t)}c(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&V(t.data.active===!0)}),c(document,"visibilitychange",()=>{V(!document.hidden)}),c(window,"pagehide",()=>{w=!0,N.splice(0).forEach(t=>t()),P.splice(0).forEach(t=>t()),d==null||d.close().catch(()=>{})});let X={};function $(t,e){return X[t]??e}async function lt(t=()=>{}){let e=new AbortController,o=setTimeout(()=>e.abort(),1600);try{let i=await fetch("./game.config.json",{signal:e.signal});if(!i.ok)throw Error("Config unavailable");let n=await i.json();for(let a of["texts","tweaks","images"])for(let s of n[a]||[])X[s.id]=a==="images"?s.path:s.value;for(let a of _){let s=B(a.path);a.im.getAttribute("src")!==s&&(a.im.src=s)}for(let a of l.querySelectorAll('img[src^="./assets/"]'))a.src=B(a.getAttribute("src"));t(),l.dataset.config="loaded"}catch{l.dataset.config="defaults"}finally{clearTimeout(o)}}Q(".fit{background:#fff}.blob{position:absolute;width:230px;height:230px;border-radius:50%;background:#f9de83;right:-85px;top:-85px}.lavender{position:absolute;width:230px;height:220px;border-radius:50%;background:#e5ddf5;left:-100px;bottom:-100px}.guide{top:85px;font-family:Playful,Arial;font-size:18px}.capability{padding:10px 12px;font-size:14px}.puzzle{position:absolute;left:55px;top:146px;width:280px;height:280px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:4px;touch-action:none}.puzzle.is-loading{pointer-events:none}.puzzle-placeholder{grid-area:1/1/4/4;display:grid;place-items:center;text-align:center;padding:24px;background:#f3f0f7;border-radius:12px;font-size:15px;line-height:1.5;color:#655d70}.tile{padding:0;position:relative;overflow:hidden;border-radius:9px;box-shadow:0 2px 2px #25252a18;background:#f0ece1;min-height:0}.tile canvas{display:block;width:100%;height:100%;pointer-events:none}.tile.selected{outline:3px solid #6464c8;z-index:2}.tile.dragging{opacity:.6;transform:scale(.96)}.hud{font-size:28px;color:#514b5b;top:30px}.photo-status{top:432px;bottom:auto;font-size:12px;color:#655d70;line-height:1.4}.bottom{bottom:50px;display:grid;grid-template-columns:1fr 1fr;gap:8px}.result{background:#f3f0fb}.result button{background:#4c497b}",`<div class="hud"><span class="moves">0 moves</span><span class="time">0s</span></div><div class="guide">Swap pieces to solve your photo</div><div class="puzzle" aria-label="Photo puzzle"></div><div class="status photo-status" role="status" aria-live="polite">Loading the cat photo\u2026</div><input id="puzzle-photo-input" type="file" accept="image/*" hidden><div class="bottom"><button class="capability photo-upload" aria-controls="puzzle-photo-input">Upload photo</button><button class="capability shuffle" aria-label="Shuffle pieces" disabled>\u21BB Shuffle</button></div>${st()}`,"#fff");let m=null,H=!1,g=!1,C=0,u=G([...Array(9).keys()]),b=-1,z=0,k=0,j=!1,y=!1,f=null,T=r("#puzzle-photo-input"),I=r(".photo-upload"),x=r(".photo-status"),U=new Set,pt=new URLSearchParams(location.search).get("lang")==="it"||document.documentElement.lang==="it",h=(t,e)=>pt?e:t;I.textContent=h("Upload photo","Carica foto"),r(".shuffle").textContent=h("\u21BB Shuffle","\u21BB Mescola");function J(t){let e=t.naturalWidth||t.width,o=t.naturalHeight||t.height;if(!e||!o)throw Error("No image pixels");let i=document.createElement("canvas");i.width=i.height=600;let n=i.getContext("2d");if(n.fillStyle="#fff",n.fillRect(0,0,600,600),!F(n,t,0,0,600,600))throw Error("Image could not be fitted");return i}function v(){let t=r(".puzzle");if(t.replaceChildren(),!m){let e=document.createElement("div");e.className="puzzle-placeholder",e.textContent=h("Upload a photo to make your puzzle","Carica una foto per creare il puzzle"),t.append(e);return}u.forEach((e,o)=>{let i=document.createElement("button");i.className="tile"+(o===b?" selected":""),i.dataset.slot=o,i.setAttribute("aria-label",`Puzzle piece ${e+1}`);let n=document.createElement("canvas");n.width=n.height=200;let a=m.width/3;n.getContext("2d").drawImage(m,e%3*a,Math.floor(e/3)*a,a,a,0,0,200,200),i.append(n),t.append(i)}),l.dataset.moves=z,l.dataset.solved=String(y)}function A(t=m){t&&(m=t,u=G([...Array(9).keys()]),u.every((e,o)=>e===o)&&([u[0],u[1]]=[u[1],u[0]]),b=-1,z=0,k=0,j=!1,y=!1,f=null,r(".moves").textContent="0 moves",r(".time").textContent="0s",v(),r(".shuffle").disabled=g,S("ready"))}function D(t,e){t===e||y||g||([u[t],u[e]]=[u[e],u[t]],z++,j=!0,L(),b=-1,r(".moves").textContent=`${z} moves`,M(500,.05,.12),y=u.every((o,i)=>o===i),v(),S("playing"),y&&(et(),at("Picture perfect!",Math.max(100,1e3-z*12-Math.round(k)*2),`${z} moves \xB7 ${Math.ceil(k)} seconds`,A)))}c(r(".puzzle"),"pointerdown",t=>{let e=t.target.closest(".tile");!e||y||g||(f={x:t.clientX,y:t.clientY,slot:Number(e.dataset.slot)},e.setPointerCapture(t.pointerId))}),c(r(".puzzle"),"pointermove",t=>{var e;f&&Math.hypot(t.clientX-f.x,t.clientY-f.y)>8&&((e=r(`.tile[data-slot="${f.slot}"]`))==null||e.classList.add("dragging"))}),c(r(".puzzle"),"pointerup",t=>{if(!f)return;let e=f;f=null;let o=r(".puzzle").getBoundingClientRect(),i=Math.floor((t.clientX-o.left)/(o.width/3)),n=Math.floor((t.clientY-o.top)/(o.height/3)),a=i+n*3;Math.hypot(t.clientX-e.x,t.clientY-e.y)>8?i>=0&&i<3&&n>=0&&n<3?D(e.slot,a):v():b>=0&&b!==e.slot?D(b,e.slot):(b=e.slot,v())});for(let t of["pointercancel","lostpointercapture"])c(r(".puzzle"),t,()=>{f&&(f=null,v())});async function dt(t){if(!t)return;if(!(t.type.startsWith("image/")||!t.type&&/\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i.test(t.name))||!t.size){x.textContent=h("Choose an image file. Your current puzzle is unchanged.","Scegli un file immagine. Il puzzle attuale non cambia.");return}if(t.size>30*1024*1024){x.textContent=h("This photo is too large. Choose a smaller image.","La foto \xE8 troppo grande. Scegli un\u2019immagine pi\xF9 piccola.");return}let o=++C;g=!0,f=null,b=-1,I.disabled=!0,r(".shuffle").disabled=!0,r(".puzzle").classList.add("is-loading"),x.textContent=h("Opening your photo\u2026","Apertura della foto\u2026");let i=URL.createObjectURL(t);U.add(i);try{let n=new Image;if(n.decoding="async",await new Promise((s,p)=>{n.onload=s,n.onerror=()=>p(Error("Image cannot be decoded")),n.src=i}),w||o!==C)return;let a=J(n);H=!0,g=!1,r(".modal").hidden=!0,A(a),l.dataset.photoSource="uploaded",x.textContent=h("Your photo is ready. Swap two pieces to solve it.","La tua foto \xE8 pronta. Scambia due tessere per risolverla.")}catch{!w&&o===C&&(x.textContent=h("Could not open that photo. Try a JPG, PNG or WebP.","Impossibile aprire la foto. Prova un file JPG, PNG o WebP."))}finally{URL.revokeObjectURL(i),U.delete(i),!w&&o===C&&(g=!1,I.disabled=!1,r(".shuffle").disabled=!m,r(".puzzle").classList.remove("is-loading"),v())}}c(I,"click",()=>{Y(),T.click()}),c(T,"change",()=>{var e;let t=(e=T.files)==null?void 0:e[0];T.value="",t&&dt(t)}),c(r(".shuffle"),"click",()=>{!m||g||(L(),A())}),P.push(()=>{C++;for(let t of U)URL.revokeObjectURL(t);U.clear()});let O=it("./assets/sample-photo.webp");c(O,"load",()=>{if(!(w||H||g))try{A(J(O)),l.dataset.photoSource="default",x.textContent=h("Cat photo ready \xB7 upload your own photo anytime","Foto del gatto pronta \xB7 puoi caricare la tua foto")}catch{x.textContent=h("Upload a photo to start","Carica una foto per iniziare")}}),c(O,"error",()=>{m||(x.textContent=h("Upload a photo to start","Carica una foto per iniziare"))}),v(),S("loading"),ot(t=>{j&&!y&&!g&&(k+=t,r(".time").textContent=Math.floor(k)+"s")});function W(){let t=l.getBoundingClientRect(),e=Math.min(t.width/390,t.height/598);l.style.position="relative",l.style.backgroundColor="#f4d467",l.style.backgroundImage="url("+JSON.stringify(String($("PAPER_BACKDROP","./assets/paper-print-v1.svg")))+")",l.style.backgroundSize=256*e+"px "+256*e+"px",l.style.backgroundRepeat="repeat",l.style.setProperty("--paper-scale",String(e)),l.dataset.backgroundTheme="graphic-paper"}let K=document.createElement("style");K.textContent="html,body{background:#f4d467}#root>.fit{background:transparent!important}#root .hud,#root .guide{color:#282723}.photo-status{color:#4b442c!important}.tile{border:1.5px solid #282723;border-radius:6px;box-shadow:none}.tile.selected{outline:3px solid #282723;outline-offset:1px}.bottom .capability{border:2px solid #282723;border-radius:6px;background:#fffbea;color:#282723;box-shadow:0 3px 0 #28272326}.bottom .capability:active{box-shadow:none}.puzzle-placeholder{background:#fffbea;color:#282723;border:2px solid #282723}#root>.modal{position:absolute;inset:0;padding:0;z-index:30;background:#28272355;display:grid;place-items:center}#root>.modal>.result{width:320px;max-width:none;max-height:calc((100vh - 80px*var(--paper-scale))/var(--paper-scale));transform:scale(var(--paper-scale));transform-origin:center;border:2px solid #282723;border-radius:10px;background:#fffbea;color:#282723;box-shadow:3px 5px 0 #28272326}#root>.modal .result button{border:2px solid #282723;border-radius:6px;background:#f4d467;color:#282723;box-shadow:0 3px 0 #28272326}",document.head.append(K);let R=r(".modal");if(R){l.append(R);let t=()=>{r(".fit").inert=!R.hidden},e=new MutationObserver(t);e.observe(R,{attributes:!0,attributeFilter:["hidden"]}),t(),P.push(()=>e.disconnect())}let Z=new ResizeObserver(W);Z.observe(l),P.push(()=>Z.disconnect()),W(),lt(()=>{W(),r(".guide")&&(r(".guide").textContent=String($("GUIDE","Swap pieces to solve your photo")))})})();(()=>{let l=document.createElement("style");l.dataset.batch3Ui="20261116",l.textContent=`
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

.guide{top:85px;font-size:18px;line-height:1.4}
.puzzle{left:55px;top:146px;width:280px;height:280px;gap:4px}
.hud{font-size:28px;top:30px;color:#514b5b}
.bottom{display:grid;grid-template-columns:1fr 1fr;gap:8px;bottom:50px}
.bottom .capability{width:100%;font-size:14px;min-height:44px;padding:10px 12px}
.photo-status{top:432px;bottom:auto;font-size:12px;color:#655d70;line-height:1.4}
`,document.head.append(l)})();})();
