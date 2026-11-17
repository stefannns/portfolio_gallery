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

(()=>{(()=>{"use strict";let s=document.getElementById("root"),dt=(t,e,n)=>Math.max(e,Math.min(n,t)),ut=(t,e)=>t+Math.random()*(e-t),pt=t=>t[Math.floor(Math.random()*t.length)],ht=t=>t[t.length-1],H=t=>{for(let e=t.length-1;e>0;e--){let n=Math.floor(Math.random()*(e+1));[t[e],t[n]]=[t[n],t[e]]}return t},I=[],$=[],v=!0,B=!1,c;function h(t,e,n,a){t.addEventListener(e,n,a),I.push(()=>t.removeEventListener(e,n,a))}function N(t,e,n="#faf8f1"){let a=document.createElement("style");a.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(a),s.style.background=n,s.innerHTML='<div class="fit">'+e+"</div>";let i=s.querySelector(".fit");function o(){let r=s.getBoundingClientRect(),l=Math.min(r.width/390,r.height/598);i.style.transform=`translate(${(r.width-390*l)/2}px,${(r.height-598*l)/2}px) scale(${l})`,s.dataset.layout=`${Math.round(r.width)}x${Math.round(r.height)}`}o(),h(window,"resize",o)}function d(t){return s.querySelector(t)}function D(){var t;(t=d(".guide"))==null||t.classList.add("gone")}function k(t){s.dataset.phase=t}function z(){G(),D()}function G(){try{c||(c=new(window.AudioContext||window.webkitAudioContext)),c.state==="suspended"&&c.resume().catch(()=>{})}catch{}}function w(t=450,e=.08,n=.18,a="sine",i=0){if(!(!c||!v))try{let o=c.createOscillator(),r=c.createGain(),l=c.currentTime;o.type=a,o.frequency.setValueAtTime(t,l),i&&o.frequency.exponentialRampToValueAtTime(Math.max(30,i),l+e),r.gain.setValueAtTime(.001,l),r.gain.exponentialRampToValueAtTime(n,l+.006),r.gain.exponentialRampToValueAtTime(.001,l+e),o.connect(r),r.connect(c.destination),o.start(l),o.stop(l+e+.02),o.onended=()=>{o.disconnect(),r.disconnect()}}catch{}}function K(){w(523,.12,.18),setTimeout(()=>w(784,.17,.16),100)}function X(){w(180,.22,.18,"triangle",65)}function Z(t){let e=0;function n(a){if(B)return;let i=Math.min(.035,(a-(e||a))/1e3);e=a,document.hidden||t(v?i:0,a/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function J(){let t=d("canvas.stage"),e=t.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return t.width=390*n,t.height=598*n,e.scale(n,n),{canvas:t,ctx:e}}function Q(t,e=d("canvas.stage")){let n=e.getBoundingClientRect();return{x:(t.clientX-n.left)*390/n.width,y:(t.clientY-n.top)*598/n.height}}function tt(t,e,n,a,i,o){o=Math.min(Math.abs(a)/2,Math.abs(i)/2,o),t.moveTo(e+o,n),t.lineTo(e+a-o,n),t.quadraticCurveTo(e+a,n,e+a,n+o),t.lineTo(e+a,n+i-o),t.quadraticCurveTo(e+a,n+i,e+a-o,n+i),t.lineTo(e+o,n+i),t.quadraticCurveTo(e,n+i,e,n+i-o),t.lineTo(e,n+o),t.quadraticCurveTo(e,n,e+o,n),t.closePath()}function gt(t,e,n,a,i,o,r,l){t.beginPath(),tt(t,e,n,a,i,o),r&&(t.fillStyle=r,t.fill()),l&&(t.strokeStyle=l,t.stroke())}function q(t,e,n,a,i,o){t.beginPath(),t.arc(e,n,Math.max(.01,a),0,Math.PI*2),i&&(t.fillStyle=i,t.fill()),o&&(t.strokeStyle=o,t.stroke())}function R(t,e,n,a,i,o,r=2){t.beginPath(),t.moveTo(e,n),t.lineTo(a,i),t.strokeStyle=o,t.lineWidth=r,t.stroke()}function b(t,e,n,a,i=18,o="#25252a",r="UIBody",l="center"){t.font=`700 ${i}px ${r}`,t.fillStyle=o,t.textAlign=l,t.textBaseline="middle",t.fillText(e,n,a)}let U=[];function A(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(C(e,t))}function mt(t){let e=new Image;return e.onerror=()=>{s.dataset.assetIssue="image"},e.src=A(t),U.push({im:e,path:t}),e}function et(t,e,n,a,i,o){if(!e||!e.width)return;let r=e.videoWidth||e.width,l=e.videoHeight||e.height;if(!r||!l)return;let g=Math.max(i/r,o/l);t.save(),t.beginPath(),t.rect(n,a,i,o),t.clip(),t.drawImage(e,n+(i-r*g)/2,a+(o-l*g)/2,r*g,l*g),t.restore()}function nt(t,e,n,a,i){t.save(),t.beginPath(),t.arc(n,a,i,0,Math.PI*2),t.clip(),et(t,e,n-i,a-i,i*2,i*2),t.restore()}function it(t,e,n,a){let i=d(".modal");if(!i)return;i.hidden=!1,i.querySelector("h2").textContent=t,i.querySelector(".value").textContent=e,i.querySelector("p").textContent=n;let o=i.querySelector("button");o.onclick=()=>{i.hidden=!0,z(),a()},k("result")}function ot(t="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function bt(){let t=d(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let at=[];function E(t){v=t,t||c==null||c.suspend().catch(()=>{});for(let e of at)e(t)}h(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&E(t.data.active===!0)}),h(document,"visibilitychange",()=>{E(!document.hidden)}),h(window,"pagehide",()=>{B=!0,I.splice(0).forEach(t=>t()),$.splice(0).forEach(t=>t()),c==null||c.close().catch(()=>{})});let j={};function C(t,e){return j[t]??e}async function F(t=()=>{}){let e=new AbortController,n=setTimeout(()=>e.abort(),1600);try{let a=await fetch("./game.config.json",{signal:e.signal});if(!a.ok)throw Error("Config unavailable");let i=await a.json();for(let o of["texts","tweaks","images"])for(let r of i[o]||[])j[r.id]=o==="images"?r.path:r.value;for(let o of U){let r=A(o.path);o.im.getAttribute("src")!==r&&(o.im.src=r)}for(let o of s.querySelectorAll('img[src^="./assets/"]'))o.src=A(o.getAttribute("src"));t(),s.dataset.config="loaded"}catch{s.dataset.config="defaults"}finally{clearTimeout(n)}}let u=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],L=()=>{};function rt(){var e,n;function t(a,i){u=a.slice(0,24).map(o=>({nickname:String(o.nickname||"Friend"),avatar:o.avatar,image:null}));for(let o of u){let r;try{r=i?window.tt.createImage():new Image,r.onload=()=>{o.image=r,L()},r.onerror=()=>{o.image=null},r.src=o.avatar}catch{o.image=null}}L()}t(u,!1),s.dataset.friends="sample",!(!((e=window.tt)!=null&&e.getFriendsInfo)||!((n=window.tt)!=null&&n.createImage))&&window.tt.getFriendsInfo({success(a){let i=Array.isArray(a==null?void 0:a.friends)?a.friends.filter(o=>o&&typeof o.avatar=="string"):[];i.length&&(t(i,!0),s.dataset.friends="host")},fail(){s.dataset.friends="sample"}})}function M(t,e,n,a,i,o="#fff"){let r=u[(e%u.length+u.length)%u.length];t.save(),t.shadowColor="#25212d20",t.shadowBlur=6,q(t,n,a,i,o),t.shadowBlur=0,r!=null&&r.image?nt(t,r.image,n,a,Math.max(1,i-2)):(q(t,n,a,Math.max(1,i-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][e%4]),b(t,Array.from((r==null?void 0:r.nickname)||"?")[0],n,a,i*.7,"#fff")),t.restore()}function S(t){var e;return((e=u[(t%u.length+u.length)%u.length])==null?void 0:e.nickname)||"Friend"}function xt(t,e,n,a,i=13){b(t,Array.from(S(e)).slice(0,15).join(""),n,a,i)}rt(),N(".fit{background:#e987b6}.guide{top:105px;font:17px Playful,Arial}.palette{position:absolute;top:28px;right:30px;width:34px;min-height:34px;background:#fff;border:3px solid #191919;box-shadow:3px 3px #191919}.palette i{display:block;width:12px;height:12px;border:2px solid #191919;border-radius:50%;margin:auto;background:#e8c347}.pill{border-radius:0;background:#fff;color:#111;border:3px solid #111;box-shadow:4px 4px #111}.turn{position:absolute;left:30px;right:30px;top:491px;text-align:center;font-weight:700;font-size:14px}.result{border:3px solid #111;box-shadow:6px 6px #111;border-radius:0;background:#fff}.result .value{font-size:30px}",`<canvas class="stage" aria-label="Tic tac toe board"></canvas><div class="guide">Pick a square \xB7 make a row</div><button class="palette" aria-label="Change background color"><i></i></button><div class="turn">Your turn</div><div class="bottom"><button class="pill reset">New game</button></div>${ot()}`,"#e987b6");function st(t){let e=d(".fit"),n=d(".modal");n&&(n.classList.add("host-modal"),s.append(n));let a=document.createElement("style");a.textContent="#root{position:relative;isolation:isolate}#root>.fit{z-index:1;background:transparent}#root .pill,#root .palette{border-color:#282723;color:#282723}#root .pill{box-shadow:3px 4px 0 #282723}#root>.host-modal{position:absolute;inset:0;z-index:30;display:block;padding:0;background:#22242c33}#root>.host-modal>.result{position:absolute;left:50%;top:calc(50% - var(--modal-shift,10px));width:320px;max-width:none;max-height:518px;overflow-y:auto;transform:translate(-50%,-50%) scale(var(--game-fit-scale,1));transform-origin:center}",document.head.append(a);function i(){let o=s.getBoundingClientRect(),r=Math.min(o.width/390,o.height/598),l=(o.width-390*r)/2,g=(o.height-598*r)/2;e.style.transform=`translate(${l}px,${g}px) scale(${r})`,s.style.setProperty("--game-fit-scale",String(r)),s.style.setProperty("--modal-shift",`${10*r}px`),t==="felt"?(s.style.backgroundImage=`radial-gradient(circle ${380*r}px at ${l+195*r}px ${g+280*r}px, #36674f88 ${50*r}px, #102e2244 ${380*r}px)`,s.style.backgroundRepeat="no-repeat",s.style.backgroundSize="auto",s.style.backgroundPosition="0 0"):(s.style.backgroundImage=`url("${String(C("PAPER_BACKDROP","./assets/paper-print-v1.svg"))}")`,s.style.backgroundRepeat="repeat",s.style.backgroundSize=`${256*r}px ${256*r}px`,s.style.backgroundPosition=`${l}px ${g}px`)}if(i(),h(window,"resize",i),typeof ResizeObserver=="function"){let o=new ResizeObserver(i);o.observe(s),$.push(()=>o.disconnect())}return i}let V=st("paper"),{canvas:lt,ctx:f}=J(),O=["#e987b6","#efc848","#78bba7","#8b9de1"],T=0,p=Array(9).fill(0),m=1,x="ready",y=0,ft=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];function Y(t){for(let e of ft)if(t[e[0]]&&e.every(n=>t[n]===t[e[0]]))return t[e[0]];return t.every(Boolean)?3:0}function _(t,e){let n=Y(t);if(n)return n===2?10:n===1?-10:0;let a=[];for(let i=0;i<9;i++)t[i]||(t[i]=e,a.push(_(t,e===2?1:2)),t[i]=0);return e===2?Math.max(...a):Math.min(...a)}function ct(){let t=Y(p);return t?(x="result",t===1?K():t===2&&X(),it(t===1?"You win!":t===2?S(1)+" wins":"A draw",t===3?"Try again":"Three in a row","A tiny game. A proper rivalry.",P),!0):!1}function W(t,e){p[t]||x==="result"||(z(),p[t]=e,x="playing",w(500-e*70,.05,.13),s.dataset.moves=p.filter(Boolean).length,!ct()&&(m=e===1?2:1,d(".turn").textContent=m===1?"Your turn":S(1)+" is thinking\u2026",m===2&&(y=.4),k("playing")))}function P(){p=Array(9).fill(0),m=1,x="ready",y=0,d(".turn").textContent="Your turn",k("ready")}h(lt,"pointerdown",t=>{let e=Q(t);m!==1||e.x<45||e.x>345||e.y<171||e.y>471||W(Math.floor((e.y-171)/100)*3+Math.floor((e.x-45)/100),1)}),h(d(".reset"),"click",()=>{z(),P()}),h(d(".palette"),"click",()=>{T=(T+1)%O.length,s.style.backgroundColor=O[T],V()}),P(),Z(t=>{if(y>0&&(y-=t,y<=0&&m===2&&x!=="result")){let e=-1/0,n=-1;for(let a of H([...Array(9).keys()]))if(!p[a]){p[a]=2;let i=_(p,1);p[a]=0,i>e&&(e=i,n=a)}n>=0&&W(n,2)}f.clearRect(0,0,390,598),M(f,0,68,66,19,"#151515"),M(f,1,322,66,19,"#151515"),b(f,"YOU",108,66,11,"#242424"),b(f,"VS",195,66,10),f.fillStyle="#191919",f.fillRect(50,177,303,303),f.fillStyle="#fff",f.fillRect(45,171,300,300),f.strokeStyle="#191919",f.lineWidth=3,f.strokeRect(45,171,300,300);for(let e=1;e<3;e++)R(f,45+e*100,171,45+e*100,471,"#191919",3),R(f,45,171+e*100,345,171+e*100,"#191919",3);p.forEach((e,n)=>{if(!e)return;let a=95+n%3*100,i=221+Math.floor(n/3)*100;M(f,e-1,a,i,29,"#161616"),b(f,e===1?"\xD7":"\u25CB",a+32,i+30,18)})}),F(()=>{d(".guide")&&(d(".guide").textContent=String(C("GUIDE","Pick a square \xB7 make three in a row")))}),F(V)})();(()=>{let s=document.createElement("style");s.dataset.batch3Ui="20261116",s.textContent=`
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

.guide{font-size:18px}.palette{top:auto;bottom:54px;right:34px;width:44px;height:44px;min-height:44px;padding:0}
.palette i{width:16px;height:16px}.turn{top:476px;font-size:14px;line-height:1.4}
.bottom{bottom:54px}.bottom .pill{min-height:44px;font-size:16px}
`,document.head.append(s)})();})();
