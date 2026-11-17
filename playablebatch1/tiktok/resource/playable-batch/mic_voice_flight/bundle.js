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

(()=>{(()=>{"use strict";let c=document.getElementById("root"),et=(t,e,n)=>Math.max(e,Math.min(n,t)),xt=(t,e)=>t+Math.random()*(e-t),Ut=t=>t[Math.floor(Math.random()*t.length)],Dt=t=>t[t.length-1],Wt=t=>{for(let e=t.length-1;e>0;e--){let n=Math.floor(Math.random()*(e+1));[t[e],t[n]]=[t[n],t[e]]}return t},ot=[],$=[],I=!0,q=!1,v;function m(t,e,n,s){t.addEventListener(e,n,s),ot.push(()=>t.removeEventListener(e,n,s))}function yt(t,e,n="#faf8f1"){let s=document.createElement("style");s.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(s),c.style.background=n,c.innerHTML='<div class="fit">'+e+"</div>";let i=c.querySelector(".fit");function o(){let a=c.getBoundingClientRect(),r=Math.min(a.width/390,a.height/598);i.style.transform=`translate(${(a.width-390*r)/2}px,${(a.height-598*r)/2}px) scale(${r})`,c.dataset.layout=`${Math.round(a.width)}x${Math.round(a.height)}`}o(),m(window,"resize",o)}function f(t){return c.querySelector(t)}function vt(){var t;(t=f(".guide"))==null||t.classList.add("gone")}function N(t){c.dataset.phase=t}function j(){K(),vt()}function K(){try{v||(v=new(window.AudioContext||window.webkitAudioContext)),v.state==="suspended"&&v.resume().catch(()=>{})}catch{}}function F(t=450,e=.08,n=.18,s="sine",i=0){if(!(!v||!I))try{let o=v.createOscillator(),a=v.createGain(),r=v.currentTime;o.type=s,o.frequency.setValueAtTime(t,r),i&&o.frequency.exponentialRampToValueAtTime(Math.max(30,i),r+e),a.gain.setValueAtTime(.001,r),a.gain.exponentialRampToValueAtTime(n,r+.006),a.gain.exponentialRampToValueAtTime(.001,r+e),o.connect(a),a.connect(v.destination),o.start(r),o.stop(r+e+.02),o.onended=()=>{o.disconnect(),a.disconnect()}}catch{}}function $t(){F(523,.12,.18),setTimeout(()=>F(784,.17,.16),100)}function wt(){F(180,.22,.18,"triangle",65)}function Mt(t){let e=0;function n(s){if(q)return;let i=Math.min(.035,(s-(e||s))/1e3);e=s,document.hidden||t(I?i:0,s/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function jt(){let t=f("canvas.stage"),e=t.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return t.width=390*n,t.height=598*n,e.scale(n,n),{canvas:t,ctx:e}}function Ft(t,e=f("canvas.stage")){let n=e.getBoundingClientRect();return{x:(t.clientX-n.left)*390/n.width,y:(t.clientY-n.top)*598/n.height}}function kt(t,e,n,s,i,o){o=Math.min(Math.abs(s)/2,Math.abs(i)/2,o),t.moveTo(e+o,n),t.lineTo(e+s-o,n),t.quadraticCurveTo(e+s,n,e+s,n+o),t.lineTo(e+s,n+i-o),t.quadraticCurveTo(e+s,n+i,e+s-o,n+i),t.lineTo(e+o,n+i),t.quadraticCurveTo(e,n+i,e,n+i-o),t.lineTo(e,n+o),t.quadraticCurveTo(e,n,e+o,n),t.closePath()}function Vt(t,e,n,s,i,o,a,r){t.beginPath(),kt(t,e,n,s,i,o),a&&(t.fillStyle=a,t.fill()),r&&(t.strokeStyle=r,t.stroke())}function Yt(t,e,n,s,i,o){t.beginPath(),t.arc(e,n,Math.max(.01,s),0,Math.PI*2),i&&(t.fillStyle=i,t.fill()),o&&(t.strokeStyle=o,t.stroke())}function Ot(t,e,n,s,i,o,a=2){t.beginPath(),t.moveTo(e,n),t.lineTo(s,i),t.strokeStyle=o,t.lineWidth=a,t.stroke()}function Xt(t,e,n,s,i=18,o="#25252a",a="UIBody",r="center"){t.font=`700 ${i}px ${a}`,t.fillStyle=o,t.textAlign=r,t.textBaseline="middle",t.fillText(e,n,s)}let nt=[];function Z(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(st(e,t))}function V(t){let e=new Image;return e.onerror=()=>{c.dataset.assetIssue="image"},e.src=Z(t),nt.push({im:e,path:t}),e}function Ct(t,e,n,s,i,o){if(!e||!e.width)return;let a=e.videoWidth||e.width,r=e.videoHeight||e.height;if(!a||!r)return;let l=Math.max(i/a,o/r);t.save(),t.beginPath(),t.rect(n,s,i,o),t.clip(),t.drawImage(e,n+(i-a*l)/2,s+(o-r*l)/2,a*l,r*l),t.restore()}function Gt(t,e,n,s,i){t.save(),t.beginPath(),t.arc(n,s,i,0,Math.PI*2),t.clip(),Ct(t,e,n-i,s-i,i*2,i*2),t.restore()}function zt(t,e,n,s){let i=f(".modal");if(!i)return;i.hidden=!1,i.querySelector("h2").textContent=t,i.querySelector(".value").textContent=e,i.querySelector("p").textContent=n;let o=i.querySelector("button");o.onclick=()=>{i.hidden=!0,j(),s()},N("result")}function Tt(t="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function _t(){let t=f(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let J=[];function it(t){I=t,t||v==null||v.suspend().catch(()=>{});for(let e of J)e(t)}m(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&it(t.data.active===!0)}),m(document,"visibilitychange",()=>{it(!document.hidden)}),m(window,"pagehide",()=>{q=!0,ot.splice(0).forEach(t=>t()),$.splice(0).forEach(t=>t()),v==null||v.close().catch(()=>{})});let at={};function st(t,e){return at[t]??e}async function St(t=()=>{}){let e=new AbortController,n=setTimeout(()=>e.abort(),1600);try{let s=await fetch("./game.config.json",{signal:e.signal});if(!s.ok)throw Error("Config unavailable");let i=await s.json();for(let o of["texts","tweaks","images"])for(let a of i[o]||[])at[a.id]=o==="images"?a.path:a.value;for(let o of nt){let a=Z(o.path);o.im.getAttribute("src")!==a&&(o.im.src=a)}for(let o of c.querySelectorAll('img[src^="./assets/"]'))o.src=Z(o.getAttribute("src"));t(),c.dataset.config="loaded"}catch{c.dataset.config="defaults"}finally{clearTimeout(n)}}let d=null,h=null,S=null,U=null,D=!1,H=!1,T="",rt=()=>{};function P(){d==null||d.getTracks().forEach(t=>t.stop()),d=null,h==null||h.close().catch(()=>{}),h=S=U=null,D=!1}async function lt(){var t;if(!D){D=!0;try{if(!((t=navigator.mediaDevices)!=null&&t.getUserMedia))throw Error("No microphone");if(d=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!0,noiseSuppression:!0,autoGainControl:!1}}),q||!I||T==="hold"){P();return}h=new(window.AudioContext||window.webkitAudioContext),await h.resume();let e=h.createMediaStreamSource(d);S=h.createAnalyser(),S.fftSize=1024,e.connect(S),U=new Float32Array(S.fftSize),f(".mic-enable").textContent="Mic on",f(".mic-status").textContent="Listening \xB7 Space or hold also works",c.dataset.microphone="enabled"}catch{D=!1,f(".mic-enable").textContent="Enable microphone",f(".mic-status").textContent="Mic unavailable \xB7 hold the button to play",c.dataset.microphone="unavailable"}}}function At(){if(H)return .9;if(!S||!I)return 0;S.getFloatTimeDomainData(U);let t=0;for(let e of U)t+=e*e;return et((Math.sqrt(t/U.length)-.012)*14,0,1)}function Pt(){m(f(".mic-enable"),"click",()=>{K(),lt()});let t=f(".voice-hold");m(t,"pointerdown",e=>{e.preventDefault(),j(),Q("hold"),H=!0,t.setPointerCapture(e.pointerId)});for(let e of["pointerup","pointercancel","lostpointercapture"])m(t,e,()=>H=!1);m(window,"keydown",e=>{e.code==="Space"&&!e.repeat&&(e.preventDefault(),j(),Q("hold"),H=!0)}),m(window,"keyup",e=>{e.code==="Space"&&(H=!1)}),J.push(e=>{if(e){if(h==null||h.resume().catch(()=>{}),d)for(let n of d.getTracks())n.enabled=!0}else if(H=!1,h==null||h.suspend().catch(()=>{}),d)for(let n of d.getTracks())n.enabled=!1}),$.push(P),It()}function Bt(t="Hold to try"){return`<div class="status mic-status">Use your voice \xB7 or hold to try</div><div class="bottom"><button class="capability mic-enable">Enable microphone</button><button class="capability voice-hold">${t}</button></div>`}function Q(t){T=t,t==="hold"&&(d||D)&&P(),rt()}function It(){let t=f(".mic-enable"),e=f(".voice-hold"),n=t.parentElement,s=f(".mic-status"),i=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it"),o=document.createElement("style");o.textContent="#root .bottom.voice-mode-selected{display:flex!important;justify-content:center!important;align-items:center!important}#root .bottom.voice-mode-selected>.capability{flex:0 1 auto!important;width:auto!important;min-width:150px;max-width:260px}#root .bottom>.capability[hidden]{display:none!important}",document.head.append(o);function a(){q||(t.hidden=T==="hold",e.hidden=T==="voice",n.classList.toggle("voice-mode-selected",!!T),c.dataset.voiceControl=T||"choice",T==="hold"&&(s.textContent=i?"Tieni premuto \xB7 o premi Spazio":"Hold the button \xB7 or press Space"))}rt=a,m(t,"click",()=>Q("voice"),{capture:!0});let r=new MutationObserver(()=>{let l=c.dataset.microphone;T==="voice"&&["unavailable","error","off"].includes(l)&&(T=""),T==="hold"&&d&&P(),a()});r.observe(c,{attributes:!0,attributeFilter:["data-microphone"]}),$.push(()=>r.disconnect()),a()}function qt(){let t=f(".mic-enable"),e=f(".mic-status"),i=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it")?{idle:"Mic spento",requesting:"Connessione\u2026",active:"Mic attivo",paused:"Mic in pausa",start:"Attiva microfono",stop:"Disattiva microfono",listening:"In ascolto \xB7 tocca per disattivare",fallback:"Usa la voce o tieni premuto",unavailable:"Non disponibile \xB7 usa il pulsante"}:{idle:"Mic off",requesting:"Connecting\u2026",active:"Mic on",paused:"Mic paused",start:"Start microphone",stop:"Stop microphone",listening:"Listening \xB7 tap to turn off",fallback:"Use your voice \xB7 or hold to try",unavailable:"Mic unavailable \xB7 hold the button to play"},o=document.createElement("style");o.textContent=".bottom .capability.mic-enable{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;flex:1 1 174px}.mic-enable .mic-icon{width:18px;height:18px;flex:none}.mic-enable .mic-record-dot{width:10px;height:10px;flex:none;background:currentColor;border-radius:50%}.bottom .capability.mic-enable.is-listening{background:#d94646;border-color:#d94646;color:#fff;box-shadow:0 2px 8px #bd333326}.mic-enable .mic-button-label{white-space:nowrap}",document.head.append(o);let a=!1,r=!1,l="",g=null,M=null;function y(){var w;let u=((w=d==null?void 0:d.getAudioTracks)==null?void 0:w.call(d))||[];return I&&!!S&&(h==null?void 0:h.state)==="running"&&u.some(z=>z.readyState==="live"&&z.enabled&&!z.muted)}function x(){var W;if(q)return;let u=y(),w=!!((W=d==null?void 0:d.getAudioTracks)!=null&&W.call(d).some(B=>B.readyState==="live")),z=a?"requesting":u?"active":w?"paused":r?"unavailable":"idle";if(t.disabled=a,t.setAttribute("aria-pressed",String(u)),t.classList.toggle("is-listening",u),t.setAttribute("aria-label",w?i.stop:i.start),t.dataset.micState=z,c.dataset.microphone=u?"enabled":z==="idle"?"off":z,z!==l){let B=u?'<span class="mic-record-dot" aria-hidden="true"></span>':'<svg class="mic-icon" viewBox="0 0 16 16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="M6 1h4v1h1v7h-1v1H6V9H5V2h1zM3 7h1v3h1v1h6v-1h1V7h1v4h-1v1H9v2h3v1H4v-1h3v-2H4v-1H3z"/></svg>',_=a?i.requesting:u?i.active:w?i.paused:i.idle;t.innerHTML=B+'<span class="mic-button-label">'+_+"</span>",e.textContent=u?i.listening:r?i.unavailable:i.fallback,l=z}}function A(){if(d&&g!==d){g=d;for(let u of d.getAudioTracks())m(u,"ended",()=>{P(),r=!1,x()}),m(u,"mute",x),m(u,"unmute",x)}h&&M!==h&&(M=h,m(h,"statechange",x))}m(t,"click",async u=>{if(u.preventDefault(),u.stopImmediatePropagation(),!(a||q)){if(d){P(),r=!1,x();return}if(K(),r=!1,a=!0,x(),await lt(),a=!1,q||!I){P(),x();return}(!d||!h||!S)&&(P(),r=!0),A(),l="",x()}},{capture:!0}),J.push(()=>{Promise.resolve().then(()=>{A(),x()})}),A(),x()}function Et(){let t=f("canvas.stage"),e=t.getContext("2d"),n=f(".fit"),s={left:0,top:0,right:390,bottom:598};c.style.position="relative",c.style.isolation="isolate",c.prepend(t),n.style.background="transparent",n.style.zIndex="1",Object.assign(t.style,{position:"absolute",inset:"0",width:"100%",height:"100%",zIndex:"0",pointerEvents:"none"});function i(){let o=c.getBoundingClientRect();if(!o.width||!o.height)return;let a=Math.min(2,window.devicePixelRatio||1),r=Math.min(o.width/390,o.height/598),l=(o.width-390*r)/2,g=(o.height-598*r)/2,M=Math.round(o.width*a),y=Math.round(o.height*a);(t.width!==M||t.height!==y)&&(t.width=M,t.height=y),e.setTransform(a*r,0,0,a*r,a*l,a*g),e.imageSmoothingEnabled=!1,Object.assign(s,{left:-l/r,top:-g/r,right:(o.width-l)/r,bottom:(o.height-g)/r}),n.style.transform=`translate(${l}px,${g}px) scale(${r})`}if(i(),m(window,"resize",i),typeof ResizeObserver<"u"){let o=new ResizeObserver(i);o.observe(c),$.push(()=>o.disconnect())}return{canvas:t,ctx:e,bounds:s}}yt(".fit{background:#93c7c3}.guide{top:186px;font-family:Playful,Arial;color:#fff;text-shadow:0 2px #36776c80}.hud{color:#fff;font-family:Playful,Arial;text-shadow:0 3px #36776c80}.result{background:#fff0c8}.result h2{font-family:Playful,Arial}.result .value{color:#b46c38}.pill{background:#bc783e}.capability{color:#325b52;border-color:#59998d55}",`<canvas class="stage" aria-label="Voice flight"></canvas><div class="hud center"><span class="score">0</span></div><div class="guide">Make a sound to fly \xB7 quiet to fall</div>${Bt("Hold to fly")}${Tt()}`,"#93c7c3");let{canvas:Y,ctx:b,bounds:p}=Et(),R="ready",k={y:300,v:0},L=[],tt=0,O=0,X=0,ct=0,E={sky:V("./assets/pixel-v2/sky-hills.webp"),ground:V("./assets/pixel-v2/grass-ground.webp"),bird:V("./assets/pixel-v2/bird-flap.webp"),pipe:V("./assets/pixel-v2/garden-pipe.webp")},C={groundOpaqueY:9,groundBodyY:26,groundFill:"#c28b46",birdPanelWidth:110,birdBodyDiameter:42,birdFrames:[{eyeBox:[60,47,71,60],yellowBox:[35,38,74,76],anchorX:55.5,anchorY:58.5,bodyDiameter:42},{eyeBox:[61,47,72,60],yellowBox:[36,38,75,76],anchorX:56.5,anchorY:58.5,bodyDiameter:42}],pipeCap:{x:0,y:0,w:52,h:23},pipeBody:{x:7,y:28,w:39,h:16}},dt=0,pt="",ut=null,ft=null;Object.values(E).forEach(t=>m(t,"load",()=>{dt++}));let G=t=>t.complete&&t.naturalWidth>0;function Ht(){let t=[Y.width,Y.height,p.left,p.top,p.right,p.bottom,dt].join("/");if(t===pt)return;pt=t;let e=b.getTransform(),n=()=>{let r=document.createElement("canvas");r.width=Y.width,r.height=Y.height;let l=r.getContext("2d");return l.setTransform(e.a,e.b,e.c,e.d,e.e,e.f),l.imageSmoothingEnabled=!1,{im:r,brush:l}},s=n(),i=n();ut=s.im,ft=i.im;let o=p.right-p.left;if(s.brush.fillStyle="#39c5e7",s.brush.fillRect(p.left,p.top,o,p.bottom-p.top),G(E.sky)){let r=E.sky,l=498-p.top,g=Math.max(o/r.naturalWidth,l/r.naturalHeight),M=r.naturalWidth*g,y=r.naturalHeight*g;s.brush.drawImage(r,(p.left+p.right-M)/2,498-y,M,y)}let a=i.brush;if(a.fillStyle=C.groundFill,a.fillRect(p.left,498,o,Math.max(0,p.bottom-498)),G(E.ground)){let r=E.ground,l=256,g=l/r.naturalWidth,M=C.groundOpaqueY,y=C.groundBodyY,x=498-M*g,A=y*g,u=x+A;a.save(),a.beginPath(),a.rect(p.left,495,o,Math.max(0,p.bottom-495)),a.clip();for(let w=Math.floor(p.left/l)*l;w<p.right;w+=l){a.drawImage(r,0,0,r.naturalWidth,y,w,x,l,A);let z=r.naturalHeight-y,W=z*g;for(let B=u;B<p.bottom;B+=W){let _=Math.min(W,p.bottom-B);a.drawImage(r,0,y,r.naturalWidth,_/g,w,B,l,_)}}a.restore()}}function ht(t){b.save(),b.setTransform(1,0,0,1,0,0),b.drawImage(t,0,0),b.restore()}function gt(t,e,n,s=!1){let i=E.pipe;if(!G(i)||n<=0)return;let o=C.pipeCap,a=C.pipeBody;if(!o.w||!a.w)return;let r=62,l=54,g=o.h*r/o.w,M=l/a.w,y=Math.max(0,g-2),x=Math.max(0,n-y);b.save(),s?(b.translate(t+27,e+n),b.scale(1,-1),b.translate(-27,0)):b.translate(t,e);let A=a.h*M;for(let u=0;u<x;u+=A){let w=Math.min(A,x-u);b.drawImage(i,a.x,a.y,a.w,w/M,0,y+u,l,w)}b.drawImage(i,o.x,o.y,o.w,o.h,-4,0,r,g),b.restore()}function Rt(){var l;let t=E.bird;if(!G(t)||!C.birdBodyDiameter)return;let e=C.birdPanelWidth||t.naturalWidth/2,n=Math.sin(ct)>=0?0:1,s=(l=C.birdFrames)==null?void 0:l[n],o=36/((s==null?void 0:s.bodyDiameter)||C.birdBodyDiameter),a=(s==null?void 0:s.anchorX)??C.birdAnchorX,r=(s==null?void 0:s.anchorY)??C.birdAnchorY;b.save(),b.translate(100,Math.round(k.y)),b.drawImage(t,n*e,0,e,t.naturalHeight,-a*o,-r*o,e*o,t.naturalHeight*o),b.restore()}function Lt(){Ht(),ht(ut);for(let t of L)gt(t.x,p.top,t.gap-82-p.top,!0),gt(t.x,t.gap+82,500-t.gap-82);ht(ft),Rt()}function mt(){R="ready",k={y:300,v:0},L=[{x:390,gap:270,passed:!1}],O=1.8,tt=0,X=0,f(".score").textContent="0",N("ready")}function bt(){R==="playing"&&(R="result",wt(),zt("Game over",X,"Pipes passed",mt))}Pt(),qt(),mt(),Mt((t,e)=>{let n=At();if(n>.12&&R==="ready"&&(R="playing",j(),N("playing")),R==="playing"){tt+=t,ct+=t*(n>.1?20:5),k.v+=(n>.1?-600*n:450)*t,k.v=et(k.v,-210,280),k.y+=k.v*t,O-=t,O<=0&&(L.push({x:430,gap:xt(205,335),passed:!1}),O=1.65);let s=Math.min(170,110+tt*1.3);for(let i of L)i.x-=s*t,!i.passed&&i.x+54<100&&(i.passed=!0,X++,f(".score").textContent=X,F(760,.07,.12)),i.x<118&&i.x+54>82&&(k.y-13<i.gap-82||k.y+13>i.gap+82)&&bt();L=L.filter(i=>i.x>-70),(k.y<70||k.y>484)&&bt()}Lt()}),St(()=>{f(".guide")&&(f(".guide").textContent=String(st("GUIDE","Make a sound to fly \xB7 quiet to fall")))})})();(()=>{let c=document.createElement("style");c.dataset.batch3Ui="20261116",c.textContent=`
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
.hud{font-family:Playful,UIBody,sans-serif;font-size:28px}.mic-status{color:#284f49}.capability{color:#284f49;background:#fffaf0}`,document.head.append(c)})();(()=>{let c=document.createElement("style");c.textContent=`
 @font-face{font-family:FlightPixel;src:url('./assets/ui/Silkscreen-Regular.ttf') format('truetype');font-weight:400;font-style:normal;font-display:swap}
 html,body,#root,.fit,.guide,.hud,.mic-status,.capability,.pill,.result,.result h2,.result p,.result .value,button{font-family:FlightPixel,monospace!important;font-weight:400!important}
 canvas{image-rendering:pixelated}
 .hud{font-size:28px;line-height:1.25;color:#fff;text-shadow:-2px -2px #172c38,2px -2px #172c38,-2px 2px #172c38,2px 2px #172c38,0 3px #172c38}
 .guide{font-size:18px;line-height:1.45;color:#fff!important;text-shadow:-2px 0 #172c38,2px 0 #172c38,0 -2px #172c38,0 2px #172c38,-2px -2px #172c38,2px -2px #172c38,-2px 2px #172c38,2px 2px #172c38}
 .mic-status{font-size:12px;line-height:1.5;color:#fff!important;text-shadow:-1px 0 #172c38,1px 0 #172c38,0 -1px #172c38,0 1px #172c38,-1px -1px #172c38,1px -1px #172c38,-1px 1px #172c38,1px 1px #172c38}
 .bottom{gap:8px;align-items:stretch}
 .bottom .capability,.pill{font-size:14px!important;line-height:1.4;min-height:44px;border:3px solid #183b3d;border-radius:0;background:#fff1c9;color:#183b3d;box-shadow:3px 3px 0 #183b3d;padding:9px 10px}
 .bottom .capability:active,.pill:active{transform:translate(2px,2px);box-shadow:1px 1px 0 #183b3d}
 .bottom .capability.mic-enable{flex:1 1 174px;gap:6px}
 .bottom .capability.mic-enable.is-listening{background:#d94646;border-color:#183b3d;color:#fff;box-shadow:3px 3px 0 #183b3d}
 .mic-enable .mic-icon{width:16px;height:16px;shape-rendering:crispEdges}
 .mic-enable .mic-record-dot{width:8px;height:8px;border-radius:0;clip-path:polygon(25% 0,75% 0,75% 25%,100% 25%,100% 75%,75% 75%,75% 100%,25% 100%,25% 75%,0 75%,0 25%,25% 25%)}
 .result{background:#fff1c9;border:4px solid #183b3d;border-radius:0;box-shadow:6px 6px 0 #183b3d;color:#183b3d}
 .result h2{font-size:24px;line-height:1.35}.result p{font-size:13px;line-height:1.7}
 .result .value{font-size:48px;color:#3b7d42;text-shadow:2px 2px #b3d483}
 .result .pill{font-size:14px!important;background:#b5e27c;color:#183b3d}
 button:focus-visible{outline:3px solid #fff;outline-offset:4px}
 `,document.head.append(c)})();})();
