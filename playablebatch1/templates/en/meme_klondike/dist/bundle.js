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

(()=>{(()=>{"use strict";let r=document.getElementById("root"),xt=(t,e,n)=>Math.max(e,Math.min(n,t)),bt=(t,e)=>t+Math.random()*(e-t),yt=t=>t[Math.floor(Math.random()*t.length)],$=t=>t[t.length-1],ot=t=>{for(let e=t.length-1;e>0;e--){let n=Math.floor(Math.random()*(e+1));[t[e],t[n]]=[t[n],t[e]]}return t},Y=[],D=[],O=!0,J=!1,d;function h(t,e,n,s){t.addEventListener(e,n,s),Y.push(()=>t.removeEventListener(e,n,s))}function it(t,e,n="#faf8f1"){let s=document.createElement("style");s.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(s),r.style.background=n,r.innerHTML='<div class="fit">'+e+"</div>";let i=r.querySelector(".fit");function o(){let a=r.getBoundingClientRect(),f=Math.min(a.width/390,a.height/598);i.style.transform=`translate(${(a.width-390*f)/2}px,${(a.height-598*f)/2}px) scale(${f})`,r.dataset.layout=`${Math.round(a.width)}x${Math.round(a.height)}`}o(),h(window,"resize",o)}function p(t){return r.querySelector(t)}function st(){var t;(t=p(".guide"))==null||t.classList.add("gone")}function U(t){r.dataset.phase=t}function A(){at(),st()}function at(){try{d||(d=new(window.AudioContext||window.webkitAudioContext)),d.state==="suspended"&&d.resume().catch(()=>{})}catch{}}function I(t=450,e=.08,n=.18,s="sine",i=0){if(!(!d||!O))try{let o=d.createOscillator(),a=d.createGain(),f=d.currentTime;o.type=s,o.frequency.setValueAtTime(t,f),i&&o.frequency.exponentialRampToValueAtTime(Math.max(30,i),f+e),a.gain.setValueAtTime(.001,f),a.gain.exponentialRampToValueAtTime(n,f+.006),a.gain.exponentialRampToValueAtTime(.001,f+e),o.connect(a),a.connect(d.destination),o.start(f),o.stop(f+e+.02),o.onended=()=>{o.disconnect(),a.disconnect()}}catch{}}function rt(){I(523,.12,.18),setTimeout(()=>I(784,.17,.16),100)}function vt(){I(180,.22,.18,"triangle",65)}function lt(t){let e=0;function n(s){if(J)return;let i=Math.min(.035,(s-(e||s))/1e3);e=s,document.hidden||t(O?i:0,s/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function ft(){let t=p("canvas.stage"),e=t.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return t.width=390*n,t.height=598*n,e.scale(n,n),{canvas:t,ctx:e}}function R(t,e=p("canvas.stage")){let n=e.getBoundingClientRect();return{x:(t.clientX-n.left)*390/n.width,y:(t.clientY-n.top)*598/n.height}}function K(t,e,n,s,i,o){o=Math.min(Math.abs(s)/2,Math.abs(i)/2,o),t.moveTo(e+o,n),t.lineTo(e+s-o,n),t.quadraticCurveTo(e+s,n,e+s,n+o),t.lineTo(e+s,n+i-o),t.quadraticCurveTo(e+s,n+i,e+s-o,n+i),t.lineTo(e+o,n+i),t.quadraticCurveTo(e,n+i,e,n+i-o),t.lineTo(e,n+o),t.quadraticCurveTo(e,n,e+o,n),t.closePath()}function S(t,e,n,s,i,o,a,f){t.beginPath(),K(t,e,n,s,i,o),a&&(t.fillStyle=a,t.fill()),f&&(t.strokeStyle=f,t.stroke())}function wt(t,e,n,s,i,o){t.beginPath(),t.arc(e,n,Math.max(.01,s),0,Math.PI*2),i&&(t.fillStyle=i,t.fill()),o&&(t.strokeStyle=o,t.stroke())}function kt(t,e,n,s,i,o,a=2){t.beginPath(),t.moveTo(e,n),t.lineTo(s,i),t.strokeStyle=o,t.lineWidth=a,t.stroke()}function P(t,e,n,s,i=18,o="#25252a",a="UIBody",f="center"){t.font=`700 ${i}px ${a}`,t.fillStyle=o,t.textAlign=f,t.textBaseline="middle",t.fillText(e,n,s)}let N=[];function L(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(V(e,t))}function G(t){let e=new Image;return e.onerror=()=>{r.dataset.assetIssue="image"},e.src=L(t),N.push({im:e,path:t}),e}function Q(t,e,n,s,i,o){if(!e||!e.width)return;let a=e.videoWidth||e.width,f=e.videoHeight||e.height;if(!a||!f)return;let y=Math.max(i/a,o/f);t.save(),t.beginPath(),t.rect(n,s,i,o),t.clip(),t.drawImage(e,n+(i-a*y)/2,s+(o-f*y)/2,a*y,f*y),t.restore()}function zt(t,e,n,s,i){t.save(),t.beginPath(),t.arc(n,s,i,0,Math.PI*2),t.clip(),Q(t,e,n-i,s-i,i*2,i*2),t.restore()}function ut(t,e,n,s){let i=p(".modal");if(!i)return;i.hidden=!1,i.querySelector("h2").textContent=t,i.querySelector(".value").textContent=e,i.querySelector("p").textContent=n;let o=i.querySelector("button");o.onclick=()=>{i.hidden=!0,A(),s()},U("result")}function ct(t="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function Ct(){let t=p(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let dt=[];function X(t){O=t,t||d==null||d.suspend().catch(()=>{});for(let e of dt)e(t)}h(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&X(t.data.active===!0)}),h(document,"visibilitychange",()=>{X(!document.hidden)}),h(window,"pagehide",()=>{J=!0,Y.splice(0).forEach(t=>t()),D.splice(0).forEach(t=>t()),d==null||d.close().catch(()=>{})});let Z={};function V(t,e){return Z[t]??e}async function pt(t=()=>{}){let e=new AbortController,n=setTimeout(()=>e.abort(),1600);try{let s=await fetch("./game.config.json",{signal:e.signal});if(!s.ok)throw Error("Config unavailable");let i=await s.json();for(let o of["texts","tweaks","images"])for(let a of i[o]||[])Z[a.id]=o==="images"?a.path:a.value;for(let o of N){let a=L(o.path);o.im.getAttribute("src")!==a&&(o.im.src=a)}for(let o of r.querySelectorAll('img[src^="./assets/"]'))o.src=L(o.getAttribute("src"));t(),r.dataset.config="loaded"}catch{r.dataset.config="defaults"}finally{clearTimeout(n)}}it(".fit{background:#205143;color:#ece9d7}.hud{font:16px Georgia,serif;color:#e8e2c4}.guide{top:162px;color:#d4e1d1;font-size:13px;font-weight:500}.tools{position:absolute;bottom:28px;left:30px;right:30px;display:flex;justify-content:center;gap:18px}.tools button{background:transparent;border:1px solid #b4cdb059;color:#e8e5cd;border-radius:20px;font-size:13px;padding:8px 18px}.result{background:#f6efd9;color:#2b493d}.pill{background:#2e6754}",`<canvas class="stage" aria-label="Klondike solitaire"></canvas><div class="hud"><span class="moves">0 moves</span><span class="foundation-count">0 / 52</span></div><div class="guide">Alternate colors \xB7 aces go home</div><div class="tools"><button class="undo">Undo</button><button class="new-game">New deal</button></div>${ct("Deal again")}`,"#205143");function ht(t){let e=p(".fit"),n=p(".modal");n&&(n.classList.add("host-modal"),r.append(n));let s=document.createElement("style");s.textContent="#root{position:relative;isolation:isolate}#root>.fit{z-index:1;background:transparent}#root>.host-modal{position:absolute;inset:0;z-index:30;display:block;padding:0;background:#22242c33}#root>.host-modal>.result{position:absolute;left:50%;top:calc(50% - var(--modal-shift,10px));width:320px;max-width:none;max-height:518px;overflow-y:auto;transform:translate(-50%,-50%) scale(var(--game-fit-scale,1));transform-origin:center}",document.head.append(s);function i(){let o=r.getBoundingClientRect(),a=Math.min(o.width/390,o.height/598),f=(o.width-390*a)/2,y=(o.height-598*a)/2;e.style.transform=`translate(${f}px,${y}px) scale(${a})`,r.style.setProperty("--game-fit-scale",String(a)),r.style.setProperty("--modal-shift",`${10*a}px`),t==="felt"?(r.style.backgroundImage=`radial-gradient(circle ${380*a}px at ${f+195*a}px ${y+280*a}px, #36674f88 ${50*a}px, #102e2244 ${380*a}px)`,r.style.backgroundRepeat="no-repeat",r.style.backgroundSize="auto",r.style.backgroundPosition="0 0"):(r.style.backgroundImage=`url("${String(V("PAPER_BACKDROP","./assets/paper-print-v1.svg"))}")`,r.style.backgroundRepeat="repeat",r.style.backgroundSize=`${256*a}px ${256*a}px`,r.style.backgroundPosition=`${f}px ${y}px`)}if(i(),h(window,"resize",i),typeof ResizeObserver=="function"){let o=new ResizeObserver(i);o.observe(r),D.push(()=>o.disconnect())}return i}let Mt=ht("felt"),{canvas:k,ctx:l}=ft(),gt=[G("./assets/meme-1.webp"),G("./assets/meme-2.webp"),G("./assets/meme-3.webp")],_=["\u2660","\u2665","\u2663","\u2666"],m=[],g=[],x=[],b=[],u=null,c=null,v=0,w=[],z=43,C=62;function B(t){return t.s===1||t.s===3}function W(){let t=ot(Array.from({length:52},(e,n)=>({r:n%13+1,s:Math.floor(n/13),up:!1})));x=Array.from({length:7},()=>[]);for(let e=0;e<7;e++)for(let n=0;n<=e;n++){let s=t.pop();s.up=n===e,x[e].push(s)}m=t,g=[],b=[[],[],[],[]],u=null,c=null,v=0,w=[],q(),U("ready")}function tt(){w.push(JSON.stringify({stock:m,waste:g,tableau:x,foundations:b,moves:v})),w.length>80&&w.shift()}function q(){let t=b.reduce((e,n)=>e+n.length,0);p(".moves").textContent=v+" moves",p(".foundation-count").textContent=t+" / 52",p(".undo").disabled=!w.length,r.dataset.moves=v,r.dataset.cards=t,t===52&&(rt(),ut("A very satisfying ending","52 / 52","You brought every card home.",W))}function E(t){return t.kind==="waste"?g:t.kind==="foundation"?b[t.col]:x[t.col]}function M(t){return E(t).slice(t.index)}function et(t){let e=x[t],n=e.filter(a=>!a.up).length,s=e.length-n,i=Math.min(23,Math.max(9,(330-n*12-C)/Math.max(1,s-1))),o=204;return e.map(a=>{let f=o;return o+=a.up?i:12,f})}function F(t){if(t.y>=96&&t.y<=158){if(t.x>=28&&t.x<=71)return{kind:"stock"};if(t.x>=77&&t.x<=120&&g.length)return{kind:"waste",col:0,index:g.length-1};for(let e=0;e<4;e++)if(t.x>=172+e*47&&t.x<=215+e*47)return{kind:"foundation",col:e,index:Math.max(0,b[e].length-1)}}for(let e=0;e<7;e++){let n=28+e*48;if(t.x<n||t.x>n+z)continue;let s=et(e);for(let i=s.length-1;i>=0;i--)if(t.y>=s[i]&&t.y<=s[i]+C)return{kind:"tableau",col:e,index:i};if(!s.length&&t.y>=204&&t.y<=266)return{kind:"tableau",col:e,index:0}}return null}function j(t){return t.length&&t.every((e,n)=>e.up&&(n===0||t[n-1].r===e.r+1&&B(t[n-1])!==B(e)))}function H(t,e){if(!t||!e||e.kind==="stock"||e.kind==="waste"||t.kind===e.kind&&t.col===e.col)return!1;let n=M(t);if(!j(n))return!1;let s=E(e),i=s[s.length-1],o=n[0];if(e.kind==="foundation"){if(n.length!==1||o.s!==e.col||o.r!==(i?i.r+1:1))return!1}else if(i?!i.up||i.r!==o.r+1||B(i)===B(o):o.r!==13)return!1;tt(),E(t).splice(t.index,n.length),s.push(...n);let a=$(E(t));return a&&!a.up&&(a.up=!0),u=null,v++,A(),I(430,.05,.1),q(),U("playing"),!0}function nt(t){if(!t||t.kind==="stock")return!1;let e=M(t);return e.length===1&&H(t,{kind:"foundation",col:e[0].s,index:0})}function mt(){if(tt(),m.length){let t=m.pop();t.up=!0,g.push(t)}else g.length&&(m=g.reverse().map(t=>({...t,up:!1})),g=[]);v++,u=null,A(),I(360,.05,.09),q(),U("playing")}h(k,"pointerdown",t=>{let e=R(t),n=F(e);if(n){if(n.kind==="stock"){mt();return}c={ref:n,start:e,last:e,moved:!1},k.setPointerCapture(t.pointerId)}}),h(k,"pointermove",t=>{c&&(c.last=R(t),Math.hypot(c.last.x-c.start.x,c.last.y-c.start.y)>7&&(c.moved=!0))}),h(k,"pointerup",t=>{if(!c)return;let e=c;c=null;let n=F(R(t));e.moved?(n&&H(e.ref,n),u=null):u?H(u,n)||(u.kind===e.ref.kind&&u.col===e.ref.col&&u.index===e.ref.index&&nt(e.ref),u=j(M(e.ref))?e.ref:null):j(M(e.ref))&&(u=e.ref)}),h(k,"pointercancel",()=>c=null),h(k,"dblclick",t=>nt(F(R(t)))),h(p(".undo"),"click",()=>{if(!w.length)return;({stock:m,waste:g,tableau:x,foundations:b,moves:v}=JSON.parse(w.pop())),u=null,c=null,A(),q()}),h(p(".new-game"),"click",()=>{A(),W()}),W();function T(t,e,n,s=!1){if(l.save(),l.shadowColor="#071b143b",l.shadowBlur=2,l.shadowOffsetY=2,S(l,e,n,z,C,4,t.up?"#f5f0dd":"#d2c3ab","#123e31"),l.shadowBlur=0,l.shadowOffsetY=0,t.up){let i=B(t)?"#b04b3e":"#25352d",o={1:"A",11:"J",12:"Q",13:"K"}[t.r]||t.r;P(l,o,e+7,n+10,11,i,"Georgia","left"),P(l,_[t.s],e+11,n+24,10,i,"UIBody"),P(l,_[t.s],e+25,n+40,22,i,"UIBody")}else l.save(),l.beginPath(),K(l,e+2,n+2,z-4,C-4,3),l.clip(),Q(l,gt[(t.r+t.s)%3],e+2,n+2,z-4,C-4),l.restore();s&&(l.lineWidth=2,S(l,e-1,n-1,z+2,C+2,4,null,"#f1cd74")),l.restore()}lt(()=>{l.clearRect(0,0,390,598),S(l,28,96,43,62,4,"#164433","#72957866"),P(l,"\u21BB",49,127,24,"#92ad91","UIBody"),m.length&&T($(m),28,96),g.length&&T($(g),77,96,(u==null?void 0:u.kind)==="waste");for(let t=0;t<4;t++)S(l,172+t*47,96,43,62,4,"#174735","#72957855"),P(l,_[t],193+t*47,128,20,"#6a9078","UIBody"),b[t].length&&T($(b[t]),172+t*47,96,(u==null?void 0:u.kind)==="foundation"&&u.col===t);for(let t=0;t<7;t++){let e=et(t);x[t].length||S(l,28+t*48,204,43,62,4,"#194836","#72957844"),x[t].forEach((n,s)=>T(n,28+t*48,e[s],(u==null?void 0:u.kind)==="tableau"&&u.col===t&&s>=u.index))}if(c!=null&&c.moved&&j(M(c.ref))){let t=M(c.ref);l.globalAlpha=.85,t.forEach((e,n)=>T(e,c.last.x-z/2,c.last.y-15+n*17)),l.globalAlpha=1}}),pt(()=>{p(".guide")&&(p(".guide").textContent=String(V("GUIDE","Build alternating runs \xB7 send aces home")))})})();(()=>{let r=document.createElement("style");r.dataset.batch3Ui="20261116",r.textContent=`
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

.hud{font:700 28px/1.2 Georgia,serif;color:#f2ead1}
.guide{top:164px;font:400 18px/1.4 UIBody,system-ui,sans-serif;color:#e7efdf}
.tools{bottom:50px;gap:14px}.tools button{font:700 16px/1.3 UIBody,system-ui,sans-serif;min-height:44px;padding:10px 20px;border-color:#b4cdb099}
.result h2{font-family:Georgia,serif}
`,document.head.append(r)})();})();
