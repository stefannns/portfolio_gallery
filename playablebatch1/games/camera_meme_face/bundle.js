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

(()=>{(()=>{"use strict";let c=document.getElementById("root"),kt=(t,e,o)=>Math.max(e,Math.min(o,t)),Mt=(t,e)=>t+Math.random()*(e-t),Ct=t=>t[Math.floor(Math.random()*t.length)],zt=t=>t[t.length-1],Tt=t=>{for(let e=t.length-1;e>0;e--){let o=Math.floor(Math.random()*(e+1));[t[e],t[o]]=[t[o],t[e]]}return t},G=[],U=[],S=!0,j=!1,h;function x(t,e,o,a){t.addEventListener(e,o,a),G.push(()=>t.removeEventListener(e,o,a))}function rt(t,e,o="#faf8f1"){let a=document.createElement("style");a.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(a),c.style.background=o,c.innerHTML='<div class="fit">'+e+"</div>";let n=c.querySelector(".fit");function i(){let r=c.getBoundingClientRect(),l=Math.min(r.width/390,r.height/598);n.style.transform=`translate(${(r.width-390*l)/2}px,${(r.height-598*l)/2}px) scale(${l})`,c.dataset.layout=`${Math.round(r.width)}x${Math.round(r.height)}`}i(),x(window,"resize",i)}function s(t){return c.querySelector(t)}function st(){var t;(t=s(".guide"))==null||t.classList.add("gone")}function C(t){c.dataset.phase=t}function N(){J(),st()}function J(){try{h||(h=new(window.AudioContext||window.webkitAudioContext)),h.state==="suspended"&&h.resume().catch(()=>{})}catch{}}function z(t=450,e=.08,o=.18,a="sine",n=0){if(!(!h||!S))try{let i=h.createOscillator(),r=h.createGain(),l=h.currentTime;i.type=a,i.frequency.setValueAtTime(t,l),n&&i.frequency.exponentialRampToValueAtTime(Math.max(30,n),l+e),r.gain.setValueAtTime(.001,l),r.gain.exponentialRampToValueAtTime(o,l+.006),r.gain.exponentialRampToValueAtTime(.001,l+e),i.connect(r),r.connect(h.destination),i.start(l),i.stop(l+e+.02),i.onended=()=>{i.disconnect(),r.disconnect()}}catch{}}function At(){z(523,.12,.18),setTimeout(()=>z(784,.17,.16),100)}function St(){z(180,.22,.18,"triangle",65)}function lt(t){let e=0;function o(a){if(j)return;let n=Math.min(.035,(a-(e||a))/1e3);e=a,document.hidden||t(S?n:0,a/1e3),requestAnimationFrame(o)}requestAnimationFrame(o)}function Et(){let t=s("canvas.stage"),e=t.getContext("2d"),o=Math.min(2,window.devicePixelRatio||1);return t.width=390*o,t.height=598*o,e.scale(o,o),{canvas:t,ctx:e}}function It(t,e=s("canvas.stage")){let o=e.getBoundingClientRect();return{x:(t.clientX-o.left)*390/o.width,y:(t.clientY-o.top)*598/o.height}}function K(t,e,o,a,n,i){i=Math.min(Math.abs(a)/2,Math.abs(n)/2,i),t.moveTo(e+i,o),t.lineTo(e+a-i,o),t.quadraticCurveTo(e+a,o,e+a,o+i),t.lineTo(e+a,o+n-i),t.quadraticCurveTo(e+a,o+n,e+a-i,o+n),t.lineTo(e+i,o+n),t.quadraticCurveTo(e,o+n,e,o+n-i),t.lineTo(e,o+i),t.quadraticCurveTo(e,o,e+i,o),t.closePath()}function Pt(t,e,o,a,n,i,r,l){t.beginPath(),K(t,e,o,a,n,i),r&&(t.fillStyle=r,t.fill()),l&&(t.strokeStyle=l,t.stroke())}function qt(t,e,o,a,n,i){t.beginPath(),t.arc(e,o,Math.max(.01,a),0,Math.PI*2),n&&(t.fillStyle=n,t.fill()),i&&(t.strokeStyle=i,t.stroke())}function Bt(t,e,o,a,n,i,r=2){t.beginPath(),t.moveTo(e,o),t.lineTo(a,n),t.strokeStyle=i,t.lineWidth=r,t.stroke()}function Ut(t,e,o,a,n=18,i="#25252a",r="UIBody",l="center"){t.font=`700 ${n}px ${r}`,t.fillStyle=i,t.textAlign=l,t.textBaseline="middle",t.fillText(e,o,a)}let Z=[];function R(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(Y(e,t))}function W(t){let e=new Image;return e.onerror=()=>{c.dataset.assetIssue="image"},e.src=R(t),Z.push({im:e,path:t}),e}function $(t,e,o,a,n,i){if(!e)return!1;let r=e.videoWidth||e.naturalWidth||e.width,l=e.videoHeight||e.naturalHeight||e.height;if(!r||!l)return!1;let m=Math.max(n/r,i/l);return t.save(),t.beginPath(),t.rect(o,a,n,i),t.clip(),t.drawImage(e,o+(n-r*m)/2,a+(i-l*m)/2,r*m,l*m),t.restore(),!0}function jt(t,e,o,a,n){t.save(),t.beginPath(),t.arc(o,a,n,0,Math.PI*2),t.clip(),$(t,e,o-n,a-n,n*2,n*2),t.restore()}function Rt(t,e,o,a){let n=s(".modal");if(!n)return;n.hidden=!1,n.querySelector("h2").textContent=t,n.querySelector(".value").textContent=e,n.querySelector("p").textContent=o;let i=n.querySelector("button");i.onclick=()=>{n.hidden=!0,N(),a()},C("result")}function $t(t="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function ct(){let t=s(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let X=[];function Q(t){S=t,t||h==null||h.suspend().catch(()=>{});for(let e of X)e(t)}x(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&Q(t.data.active===!0)}),x(document,"visibilitychange",()=>{Q(!document.hidden)}),x(window,"pagehide",()=>{j=!0,G.splice(0).forEach(t=>t()),U.splice(0).forEach(t=>t()),h==null||h.close().catch(()=>{})});let tt={};function Y(t,e){return tt[t]??e}async function pt(t=()=>{}){let e=new AbortController,o=setTimeout(()=>e.abort(),1600);try{let a=await fetch("./game.config.json",{signal:e.signal});if(!a.ok)throw Error("Config unavailable");let n=await a.json();for(let i of["texts","tweaks","images"])for(let r of n[i]||[])tt[r.id]=i==="images"?r.path:r.value;for(let i of Z){let r=R(i.path);i.im.getAttribute("src")!==r&&(i.im.src=r)}for(let i of c.querySelectorAll('img[src^="./assets/"]'))i.src=R(i.getAttribute("src"));t(),c.dataset.config="loaded"}catch{c.dataset.config="defaults"}finally{clearTimeout(o)}}let b=null,E="user",v=!1,I=0,H=!1,dt=new URLSearchParams(location.search).get("lang")==="it"||document.documentElement.lang==="it",d=(t,e)=>dt?e:t;function T(){let t=s("video.preview");return H&&(b!=null&&b.getVideoTracks().some(e=>e.readyState==="live"&&e.enabled))&&(t==null?void 0:t.readyState)>=2&&t.videoWidth>0&&t.videoHeight>0?t:null}function A(t,e){c.dataset.camera=t;let o=s(".cam-status"),a=s(".cam-enable");o&&(o.textContent=e),a&&(a.disabled=!1,a.setAttribute("aria-pressed",String(t==="enabled")),a.textContent=v?d("Connecting\u2026 \xB7 Cancel","Connessione\u2026 \xB7 Annulla"):t==="enabled"?d("Camera on \xB7 Stop","Fotocamera attiva \xB7 Stop"):d("Enable camera","Attiva fotocamera"));for(let n of c.querySelectorAll(".shutter,.cam-capture"))n.disabled=!T();L()}function w(){I++,H=!1,v=!1;let t=b;b=null,t==null||t.getTracks().forEach(o=>o.stop());let e=s("video.preview");e&&(e.pause(),e.srcObject=null),A("idle",d("Enable your camera to take a photo","Attiva la fotocamera per scattare una foto"))}async function et(){var o;if(v)return;w();let t=++I;v=!0,A("requesting",d("Waiting for your camera\u2026","In attesa della fotocamera\u2026"));let e;try{if(!((o=navigator.mediaDevices)!=null&&o.getUserMedia))throw Error("Camera API unavailable");if(e=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:E}},audio:!1}),j||!S||t!==I){e.getTracks().forEach(i=>i.stop());return}b=e;let a=s("video.preview");a.muted=!0,a.playsInline=!0,a.srcObject=e;let n;try{await Promise.race([a.play(),new Promise((i,r)=>{n=setTimeout(()=>r(Error("Camera playback did not start")),7e3)})])}finally{clearTimeout(n)}if(await new Promise((i,r)=>{let l,m=()=>{clearTimeout(l),a.removeEventListener("loadeddata",u),a.removeEventListener("canplay",u)},u=()=>{a.readyState>=2&&a.videoWidth>0&&a.videoHeight>0&&(m(),i())};a.addEventListener("loadeddata",u),a.addEventListener("canplay",u),l=setTimeout(()=>{m(),r(Error("No camera frame received"))},7e3),u()}),j||!S||t!==I){e.getTracks().forEach(i=>i.stop());return}H=!0,v=!1;for(let i of e.getVideoTracks())x(i,"ended",()=>{b===e&&(w(),A("unavailable",d("Camera disconnected \xB7 try again","Fotocamera scollegata \xB7 riprova")))});A("enabled",d("Camera ready \xB7 take a photo","Fotocamera pronta \xB7 scatta una foto"))}catch(a){if(e==null||e.getTracks().forEach(i=>i.stop()),t!==I)return;w();let n=(a==null?void 0:a.name)==="NotAllowedError"||(a==null?void 0:a.name)==="SecurityError";A("unavailable",n?d("Camera access is blocked \xB7 allow it and retry","Accesso alla fotocamera bloccato \xB7 consenti e riprova"):d("No camera image received \xB7 try again","Nessuna immagine dalla fotocamera \xB7 riprova"))}}function ut(t=600,e=800,o=!0){let a=T();if(!a)return null;let n=document.createElement("canvas");n.width=t,n.height=e;let i=n.getContext("2d");return o&&E==="user"&&(i.translate(t,0),i.scale(-1,1)),$(i,a,0,0,t,e)?n:null}function ft(t,e="#f0ede5"){let o=t.getContext("2d"),a=t.width,n=t.height;o.fillStyle=e,o.fillRect(0,0,a,n);let i=T();if(i){o.save(),E==="user"&&(o.translate(a,0),o.scale(-1,1)),$(o,i,0,0,a,n),o.restore();return}o.save(),o.translate(a/2,n/2-8);let r=Math.min(a,n)/160;o.scale(r,r),o.strokeStyle="#767268",o.lineWidth=3,o.lineJoin="round",o.beginPath(),K(o,-29,-19,58,38,6),o.stroke(),o.beginPath(),o.arc(0,0,10,0,Math.PI*2),o.stroke(),o.beginPath(),o.moveTo(-17,-19),o.lineTo(-12,-27),o.lineTo(12,-27),o.lineTo(17,-19),o.stroke(),o.restore(),o.fillStyle="#68645b",o.font=`500 ${Math.max(15,a/23)}px UIBody,Arial`,o.textAlign="center",o.textBaseline="middle",o.fillText(v?d("Connecting\u2026","Connessione\u2026"):d("Your camera image","La tua fotocamera"),a/2,n/2+Math.min(a,n)*.25)}function mt(){var e;(e=s("video.preview"))==null||e.setAttribute("aria-hidden","true");let t=document.createElement("style");t.textContent='.preview{display:block!important;position:absolute!important;width:1px!important;height:1px!important;left:0;bottom:0;opacity:.001;pointer-events:none}.cam-enable[aria-pressed="true"]{border-color:#47754b;background:#edf5e9;color:#315b35}',document.head.append(t),x(s(".cam-enable"),"click",()=>{J(),b||v?w():et()}),s(".cam-flip")&&x(s(".cam-flip"),"click",()=>{E=E==="user"?"environment":"user",w(),et()}),X.push(o=>{o||w()}),U.push(w),A("idle",d("Enable your camera to take a photo","Attiva la fotocamera per scattare una foto"))}function ot(){let t=String(Y("PAPER_BACKDROP","./assets/paper-print-v1.svg"));c.style.backgroundColor="#e9e0c7",c.style.backgroundImage="url("+JSON.stringify(t)+")",c.style.backgroundSize="256px 256px",c.style.backgroundRepeat="repeat"}function ht(){ot();let t=document.createElement("style");t.textContent=`#root{position:relative;isolation:isolate;color:#282723}
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
 #root .pose-pair .meme-reference,#root .pose-pair .live{border:2px solid #282723;border-radius:7px;box-shadow:3px 4px 0 #2827231e}#root .shutter{box-shadow:inset 0 0 0 5px #e9e0c7}#root .pair canvas,#root .pair img{border:1px solid #28272340;border-radius:3px}`,document.head.append(t);let e=c.querySelector(".fit"),o=e.querySelector(".comparison,.strip-view,.modal");if(!o)return;let a=document.createElement("div"),n=document.createElement("div");a.className="paper-overlay",n.className="paper-result-fit",a.hidden=o.hidden,n.append(o),a.append(n),c.append(a),o.setAttribute("role","dialog"),o.setAttribute("aria-modal","true");function i(){a.hidden=o.hidden,e.inert=!o.hidden}let r=new MutationObserver(i);r.observe(o,{attributes:!0,attributeFilter:["hidden"]});function l(){let u=c.getBoundingClientRect(),f=Math.min(u.width/390,u.height/598),O=`translate(${(u.width-390*f)/2}px,${(u.height-598*f)/2}px) scale(${f})`;n.style.transform=O,e.style.transform=O}i(),l(),x(window,"resize",l);let m=typeof ResizeObserver=="function"?new ResizeObserver(l):null;m==null||m.observe(c),U.push(()=>{r.disconnect(),m==null||m.disconnect()})}rt("body{color:#292922}.fit{background:#e6e4dc}.eyebrow{position:absolute;top:58px;width:100%;text-align:center;letter-spacing:2.5px;font-size:10px}.meme-reference{position:absolute;left:78px;top:95px;width:234px;height:165px;object-fit:cover;border:8px solid #faf9f1;box-shadow:0 2px 7px #4442;transform:rotate(-3deg)}.live{position:absolute;left:78px;top:294px;width:234px;height:160px;border:8px solid #faf9f1;box-shadow:0 2px 7px #4442;transform:rotate(2deg);background:#d2cfc4;overflow:hidden}.live canvas{width:100%;height:100%;object-fit:cover}.preview{display:none}.guide{top:272px;font-size:16px}.shutter{position:absolute;left:168px;top:480px;border:3px solid #292922;background:#fff;width:54px;height:54px;border-radius:50%;box-shadow:inset 0 0 0 5px #e6e4dc}.cam-status{bottom:122px;font-size:11px}.bottom{bottom:18px}.comparison{position:absolute;inset:80px 30px 105px;z-index:15;background:#f9f7ef;padding:22px 14px;box-shadow:0 4px 20px #0002;text-align:center}.comparison[hidden]{display:none}.comparison h2{font-size:24px;margin:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:24px 0}.pair canvas,.pair img{width:100%;height:205px;object-fit:cover}.pair small{display:block;text-transform:uppercase;letter-spacing:2px;font-size:9px;margin:8px}.countdown{position:absolute;top:350px;width:100%;text-align:center;z-index:12;font-size:60px;font-weight:800;color:white;text-shadow:0 2px 5px #0008}",'<div class="eyebrow">MAKE THAT FACE</div><div class="pose-pair"><img class="meme-reference" alt="Expression to imitate" src="./assets/meme-1.webp"><div class="guide">Match the face \xB7 take a selfie</div><div class="live"><canvas class="selfie" width="400" height="400"></canvas><div class="countdown"></div></div></div><video class="preview" playsinline autoplay muted></video><div class="status cam-status">Enable your camera to take a photo</div><div class="bottom"><button class="capability cam-enable">Enable camera</button><button class="shutter" aria-label="Take photo" hidden disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/></svg><span class="shutter-label">Take photo</span></button></div><section class="comparison" hidden aria-labelledby="meme-result-title"><header><div class="smallcaps">Challenge complete</div><h2 id="meme-result-title">Your mimic</h2></header><div class="match-summary"><div class="match-value" data-ready="false" aria-live="polite" aria-atomic="true"><strong class="match-number">\u2014</strong><span class="match-percent-sign">%</span></div><div class="match-label">Visual match</div></div><div class="pair"><div><small>Original</small><img alt="Original expression"></div><div><small>You</small><canvas width="320" height="320" aria-label="Your captured photo"></canvas></div></div><p class="match-method">Color \xB7 contrast \xB7 shape</p><button class="pill next">Next</button></section><div class="flash"></div>',"#e6e4dc"),ht();function gt(t,e=32,o=32){let a=e*o,n=new Float64Array(a),i=new Float64Array(12),r=new Float64Array(64),l=new Uint16Array(64),m=new Float64Array(64),u=0,f=0;for(let p=0;p<a;p++){let k=t[p*4],M=t[p*4+1],B=t[p*4+2],y=.2126*k+.7152*M+.0722*B;n[p]=y,u+=y,f+=y*y,i[Math.min(3,k>>6)]+=1/a,i[4+Math.min(3,M>>6)]+=1/a,i[8+Math.min(3,B>>6)]+=1/a;let D=p%e,_=Math.floor(p/e),V=Math.floor(_*8/o)*8+Math.floor(D*8/e);r[V]+=y,l[V]++}u/=a;let O=Math.sqrt(Math.max(0,f/a-u*u)),it=0;for(let p=0;p<64;p++)r[p]/=Math.max(1,l[p]),it+=(r[p]-u)**2;let vt=Math.max(6,Math.sqrt(it/64));for(let p=0;p<64;p++)r[p]=Math.max(-2.5,Math.min(2.5,(r[p]-u)/vt));for(let p=1;p<o-1;p++)for(let k=1;k<e-1;k++){let M=p*e+k,B=n[M+1]-n[M-1],y=n[M+e]-n[M-e],D=Math.hypot(B,y),_=(Math.atan2(y,B)+Math.PI)%Math.PI,V=Math.min(3,Math.floor(_/Math.PI*4)),wt=Math.floor(p*4/o)*4+Math.floor(k*4/e);m[wt*4+V]+=D}return{mean:u,deviation:O,blocks:r,edges:m,colors:i}}function xt(t,e){let o=Math.max(0,1-Math.abs(t.mean-e.mean)/255),a=0;for(let f=0;f<12;f++)a+=Math.min(t.colors[f],e.colors[f]);if(a/=3,t.deviation<4&&e.deviation<4)return Math.round(100*(.6*o+.4*a));if(t.deviation<4||e.deviation<4)return Math.round(100*(.25*o+.15*a));let n=0,i=0,r=0,l=0;for(let f=0;f<64;f++)n+=Math.abs(t.blocks[f]-e.blocks[f]),i+=t.edges[f]*e.edges[f],r+=t.edges[f]**2,l+=e.edges[f]**2;let m=Math.max(0,1-n/128),u=r&&l?Math.min(1,i/Math.sqrt(r*l)):0;return Math.round(100*Math.max(0,Math.min(1,(.65*m+.25*u+.1*a)*(.75+.25*o))))}function at(t){let e=document.createElement("canvas");e.width=e.height=32;let o=e.getContext("2d",{willReadFrequently:!0});if(!$(o,t,0,0,32,32))throw Error("Image not ready");return gt(o.getImageData(0,0,32,32).data)}let F=0;async function bt(t,e){let o=++F,a=s(".match-value"),n=s(".match-number"),i=s(".match-label");a.dataset.ready="false",n.textContent="\u2014",i.textContent=d("Visual match","Somiglianza visiva"),delete c.dataset.matchScore;try{if(!e.complete||!e.naturalWidth)if(typeof e.decode=="function")await e.decode();else throw Error("Reference is still loading");let r=xt(at(t),at(e));if(o!==F||!q)return;n.textContent=String(r),a.dataset.ready="true",c.dataset.matchScore=String(r)}catch{o===F&&(i.textContent=d("Visual match unavailable","Confronto non disponibile"))}}function yt(){let t=document.createElement("style");t.textContent=`#root .comparison{left:30px;right:30px;top:50%;bottom:auto;transform:translateY(-50%);width:auto;max-height:calc(100% - 80px);padding:18px;display:flex;flex-direction:column;align-items:stretch;gap:10px;overflow-y:auto;text-align:center}
 #root .comparison[hidden]{display:none!important}
 #root .comparison .smallcaps{font-size:11px;line-height:1.4;letter-spacing:1.4px}
 #root .comparison h2{font:600 24px/1.25 Playful,UIBody,sans-serif;margin:4px 0 0;text-wrap:balance;overflow-wrap:anywhere}
 #root .comparison .match-summary{display:flex;align-items:center;justify-content:center;gap:12px;min-height:50px}
 #root .comparison .match-value{white-space:nowrap;font:700 46px/1 UIBody,system-ui,sans-serif;letter-spacing:-2px;font-variant-numeric:tabular-nums}
 #root .comparison .match-percent-sign{font-size:23px;letter-spacing:0;margin-left:1px}
 #root .comparison .match-value[data-ready="false"] .match-percent-sign{visibility:hidden}
 #root .comparison .match-label{max-width:130px;text-align:left;font:600 14px/1.35 UIBody,system-ui,sans-serif;text-wrap:balance}
 #root .comparison .pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin:0}
 #root .comparison .pair>div{min-width:0}
 #root .comparison .pair small{margin:0 0 6px;font:600 12px/1.3 UIBody,system-ui,sans-serif;letter-spacing:.5px;overflow-wrap:anywhere}
 #root .comparison .pair img,#root .comparison .pair canvas{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:cover}
 #root .comparison .match-method{margin:0;font:400 11px/1.4 UIBody,system-ui,sans-serif;color:#625c4b;text-wrap:balance}
 #root .comparison .next{align-self:center;min-width:180px;max-width:100%;min-height:44px;margin:2px 0 0;padding:10px 20px;white-space:normal}`,document.head.append(t),U.push(()=>t.remove()),s(".comparison .smallcaps").textContent=d("Challenge complete","Sfida completata"),s(".comparison h2").textContent=d("Your mimic","La tua imitazione"),s(".match-label").textContent=d("Visual match","Somiglianza visiva"),s(".match-method").textContent=d("Color \xB7 contrast \xB7 shape","Colore \xB7 contrasto \xB7 forma");let e=s(".comparison .pair").querySelectorAll("small");e[0].textContent=d("Original","Originale"),e[1].textContent=d("You","Tu"),s(".comparison .next").textContent=d("Next","Avanti")}yt();let P=0,g=-1,q=!1;function L(){let t=!!T(),e=s(".cam-enable"),o=s(".shutter");if(!e||!o)return;e.hidden=t,o.hidden=!t,o.disabled=!t||g>=0||q;let a=d("Take photo","Scatta foto"),n=s(".shutter-label");n&&n.textContent!==a&&(n.textContent=a),o.getAttribute("aria-label")!==a&&o.setAttribute("aria-label",a)}let nt=[W("./assets/meme-1.webp"),W("./assets/meme-2.webp"),W("./assets/meme-3.webp")];mt(),x(s(".shutter"),"click",()=>{q||g>=0||!T()||(N(),g=3,L(),C("countdown"),z(550,.06,.12))}),x(s(".next"),"click",()=>{N(),F++,P=(P+1)%3,q=!1,s(".comparison").hidden=!0,s(".meme-reference").src=R(`./assets/meme-${P+1}.webp`),L(),C("ready")}),lt(t=>{if(L(),ft(s(".selfie"),"#f0ede5"),g>=0){if(!T()){g=-1,s(".countdown").textContent="",C("ready");return}let e=Math.ceil(g);if(g-=t,s(".countdown").textContent=g>0?Math.ceil(g):"",Math.ceil(g)<e&&g>0&&z(550,.05,.1),g<=0){g=-1;let o=ut(320,320);if(!o)return;q=!0,ct(),z(120,.08,.18,"triangle",70),s(".pair canvas").getContext("2d").drawImage(o,0,0),s(".pair img").src=nt[P].src,s(".comparison").hidden=!1,bt(o,nt[P]),s(".next").focus({preventScroll:!0}),C("comparison")}}}),C("ready"),pt(()=>{ot(),s(".guide")&&(s(".guide").textContent=String(Y("GUIDE","Match the expression \xB7 take a selfie")))})})();(()=>{let c=document.createElement("style");c.dataset.batch3Ui="20261116",c.textContent=`
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
`,document.head.append(c)})();(()=>{let c=document.createElement("style");c.textContent=".pose-pair{position:absolute;left:30px;right:30px;top:88px;bottom:128px;display:grid;grid-template-rows:minmax(0,1fr) auto minmax(0,1fr);justify-items:center;gap:10px}.pose-pair .meme-reference,.pose-pair .live{position:relative;inset:auto;display:block;width:auto;height:100%;max-width:100%;aspect-ratio:1;border:0;border-radius:8px;object-fit:cover;transform:none;box-shadow:0 2px 7px #4442}.pose-pair .live canvas{width:100%;height:100%;object-fit:cover}.pose-pair .guide{position:static;inset:auto;width:100%;margin:0;font-size:17px;line-height:1.35}.live .countdown{position:absolute;inset:0;display:grid;place-items:center;font-size:54px;pointer-events:none}.bottom{bottom:50px;gap:0;min-height:48px;justify-content:center}#root .bottom .shutter,#root .bottom .cam-enable{position:static;inset:auto;flex:0 1 230px;width:230px;max-width:100%;height:auto;min-height:48px;margin:0;padding:10px 18px;font-size:16px;line-height:1.3}#root .bottom .shutter{display:flex;align-items:center;justify-content:center;gap:10px;border:2px solid #282723;border-radius:24px;box-shadow:0 2px 0 #2827231c;background:#fbf7e9;color:#282723}#root .bottom .shutter svg{width:22px;height:22px;flex:none}#root .bottom [hidden]{display:none!important}.cam-status{top:54px;font-size:12px;line-height:1.3}.pair canvas,.pair img{height:auto;aspect-ratio:1;object-fit:cover}",document.head.append(c)})();})();
