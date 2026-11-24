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

(()=>{document.documentElement.lang="it";(()=>{"use strict";let l=document.getElementById("root"),oe=(e,t,n)=>Math.max(t,Math.min(n,e)),Ae=(e,t)=>e+Math.random()*(t-e),ae=e=>e[Math.floor(Math.random()*e.length)],Me=e=>e[e.length-1],Pe=e=>{for(let t=e.length-1;t>0;t--){let n=Math.floor(Math.random()*(t+1));[e[t],e[n]]=[e[n],e[t]]}return e},N=[],V=[],B=!0,O=!1,p;function m(e,t,n,a){e.addEventListener(t,n,a),N.push(()=>e.removeEventListener(t,n,a))}function se(e,t,n="#faf8f1"){let a=document.createElement("style");a.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(a),l.style.background=n,l.innerHTML='<div class="fit">'+t+"</div>";let o=l.querySelector(".fit");function i(){let s=l.getBoundingClientRect(),c=Math.min(s.width/390,s.height/598);o.style.transform=`translate(${(s.width-390*c)/2}px,${(s.height-598*c)/2}px) scale(${c})`,l.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}i(),m(window,"resize",i)}function d(e){return l.querySelector(e)}function re(){var e;(e=d(".guide"))==null||e.classList.add("gone")}function S(e){l.dataset.phase=e}function T(){le(),re()}function le(){try{p||(p=new(window.AudioContext||window.webkitAudioContext)),p.state==="suspended"&&p.resume().catch(()=>{})}catch{}}function I(e=450,t=.08,n=.18,a="sine",o=0){if(!(!p||!B))try{let i=p.createOscillator(),s=p.createGain(),c=p.currentTime;i.type=a,i.frequency.setValueAtTime(e,c),o&&i.frequency.exponentialRampToValueAtTime(Math.max(30,o),c+t),s.gain.setValueAtTime(.001,c),s.gain.exponentialRampToValueAtTime(n,c+.006),s.gain.exponentialRampToValueAtTime(.001,c+t),i.connect(s),s.connect(p.destination),i.start(c),i.stop(c+t+.02),i.onended=()=>{i.disconnect(),s.disconnect()}}catch{}}function ce(){I(523,.12,.18),setTimeout(()=>I(784,.17,.16),100)}function Be(){I(180,.22,.18,"triangle",65)}function fe(e){let t=0;function n(a){if(O)return;let o=Math.min(.035,(a-(t||a))/1e3);t=a,document.hidden||e(B?o:0,a/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function de(){let e=d("canvas.stage"),t=e.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return e.width=390*n,e.height=598*n,t.scale(n,n),{canvas:e,ctx:t}}function Te(e,t=d("canvas.stage")){let n=t.getBoundingClientRect();return{x:(e.clientX-n.left)*390/n.width,y:(e.clientY-n.top)*598/n.height}}function pe(e,t,n,a,o,i){i=Math.min(Math.abs(a)/2,Math.abs(o)/2,i),e.moveTo(t+i,n),e.lineTo(t+a-i,n),e.quadraticCurveTo(t+a,n,t+a,n+i),e.lineTo(t+a,n+o-i),e.quadraticCurveTo(t+a,n+o,t+a-i,n+o),e.lineTo(t+i,n+o),e.quadraticCurveTo(t,n+o,t,n+o-i),e.lineTo(t,n+i),e.quadraticCurveTo(t,n,t+i,n),e.closePath()}function Ue(e,t,n,a,o,i,s,c){e.beginPath(),pe(e,t,n,a,o,i),s&&(e.fillStyle=s,e.fill()),c&&(e.strokeStyle=c,e.stroke())}function A(e,t,n,a,o,i){e.beginPath(),e.arc(t,n,Math.max(.01,a),0,Math.PI*2),o&&(e.fillStyle=o,e.fill()),i&&(e.strokeStyle=i,e.stroke())}function qe(e,t,n,a,o,i,s=2){e.beginPath(),e.moveTo(t,n),e.lineTo(a,o),e.strokeStyle=i,e.lineWidth=s,e.stroke()}function U(e,t,n,a,o=18,i="#25252a",s="UIBody",c="center"){e.font=`700 ${o}px ${s}`,e.fillStyle=i,e.textAlign=c,e.textBaseline="middle",e.fillText(t,n,a)}let D=[];function q(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(Y(t,e))}function Ee(e){let t=new Image;return t.onerror=()=>{l.dataset.assetIssue="image"},t.src=q(e),D.push({im:t,path:e}),t}function ue(e,t,n,a,o,i){if(!t||!t.width)return;let s=t.videoWidth||t.width,c=t.videoHeight||t.height;if(!s||!c)return;let y=Math.max(o/s,i/c);e.save(),e.beginPath(),e.rect(n,a,o,i),e.clip(),e.drawImage(t,n+(o-s*y)/2,a+(i-c*y)/2,s*y,c*y),e.restore()}function _(e,t,n,a,o){e.save(),e.beginPath(),e.arc(n,a,o,0,Math.PI*2),e.clip(),ue(e,t,n-o,a-o,o*2,o*2),e.restore()}function he(e,t,n,a){let o=d(".modal");if(!o)return;o.hidden=!1,o.querySelector("h2").textContent=e,o.querySelector(".value").textContent=t,o.querySelector("p").textContent=n;let i=o.querySelector("button");i.onclick=()=>{o.hidden=!0,T(),a()},S("result")}function ge(e="Gioca ancora"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function Re(){let e=d(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let W=[];function H(e){B=e,e||p==null||p.suspend().catch(()=>{});for(let t of W)t(e)}m(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&H(e.data.active===!0)}),m(document,"visibilitychange",()=>{H(!document.hidden)}),m(window,"pagehide",()=>{O=!0,N.splice(0).forEach(e=>e()),V.splice(0).forEach(e=>e()),p==null||p.close().catch(()=>{})});let X={};function Y(e,t){return X[e]??t}async function me(e=()=>{}){let t=new AbortController,n=setTimeout(()=>t.abort(),1600);try{let a=await fetch("./game.config.json",{signal:t.signal});if(!a.ok)throw Error("Configurazione non disponibile");let o=await a.json();for(let i of["texts","tweaks","images"])for(let s of o[i]||[])X[s.id]=i==="images"?s.path:s.value;for(let i of D){let s=q(i.path);i.im.getAttribute("src")!==s&&(i.im.src=s)}for(let i of l.querySelectorAll('img[src^="./assets/"]'))i.src=q(i.getAttribute("src"));e(),l.dataset.config="loaded"}catch{l.dataset.config="defaults"}finally{clearTimeout(n)}}let h=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],Z=()=>{};function xe(){var t,n;function e(a,o){h=a.slice(0,24).map(i=>({nickname:String(i.nickname||"Amico"),avatar:i.avatar,image:null}));for(let i of h){let s;try{s=o?window.tt.createImage():new Image,s.onload=()=>{i.image=s,Z()},s.onerror=()=>{i.image=null},s.src=i.avatar}catch{i.image=null}}Z()}e(h,!1),l.dataset.friends="sample",!(!((t=window.tt)!=null&&t.getFriendsInfo)||!((n=window.tt)!=null&&n.createImage))&&window.tt.getFriendsInfo({success(a){let o=Array.isArray(a==null?void 0:a.friends)?a.friends.filter(i=>i&&typeof i.avatar=="string"):[];o.length&&(e(o,!0),l.dataset.friends="host")},fail(){l.dataset.friends="sample"}})}function ye(e,t,n,a,o,i="#fff"){let s=h[(t%h.length+h.length)%h.length];e.save(),e.shadowColor="#25212d20",e.shadowBlur=6,A(e,n,a,o,i),e.shadowBlur=0,s!=null&&s.image?_(e,s.image,n,a,Math.max(1,o-2)):(A(e,n,a,Math.max(1,o-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][t%4]),U(e,Array.from((s==null?void 0:s.nickname)||"?")[0],n,a,o*.7,"#fff")),e.restore()}function be(e){var t;return((t=h[(e%h.length+h.length)%h.length])==null?void 0:t.nickname)||"Amico"}function ve(e,t,n,a,o=13){U(e,Array.from(be(t)).slice(0,15).join(""),n,a,o)}xe(),se(".fit{background:#fff}canvas.stage{position:absolute;z-index:3;pointer-events:none}.vision-copy{position:absolute;left:30px;right:30px;top:90px;z-index:6;display:flex;flex-direction:column;align-items:center;gap:24px;text-align:center;pointer-events:none}.question{position:static;margin:0;font-size:20px;line-height:1.4;font-weight:700;color:#55465c}.guide{top:160px;font-size:15px;font-weight:500;color:#aaa0ac}.orb{position:absolute;left:65px;top:218px;width:260px;height:260px;object-fit:contain;pointer-events:none}.fog{position:absolute;left:65px;top:218px;width:260px;height:260px;touch-action:none;z-index:5;opacity:1;transition:opacity .5s ease-out}.fog.revealed{opacity:0;pointer-events:none}.prediction{position:static;margin:0;font-size:14px;line-height:1.4;color:#5d4969;overflow-wrap:anywhere}.prediction:empty{display:none}.next-vision{position:absolute;left:50%;transform:translateX(-50%);bottom:24px;white-space:nowrap;background:#4b4355}.count{position:absolute;right:30px;top:33px;color:#8e8696;font-size:14px}.result{background:#faf7ff}.result .value{font-size:28px}.result p{white-space:pre-line}",`<canvas class="stage" aria-label="La sfera del futuro"></canvas><div class="count">1 / 3</div><div class="vision-copy"><div class="question">Chi avr\xE0 fortuna oggi?</div><div class="prediction" aria-live="polite"></div></div><div class="guide">Strofina e scopri chi c\u2019\xE8</div><img class="orb" src="./assets/crystal.webp" alt="Sfera di cristallo"><canvas class="fog" width="436" height="436" aria-label="Rimuovi la nebbia"></canvas><button class="pill next-vision" disabled>Prossima visione</button>${ge()}`,"#fff");function we(){let e=d(".modal"),t=d(".result"),n=document.createElement("div");n.className="fortune-result-fit",n.append(t),e.append(n),e.classList.add("fortune-overlay"),l.append(e),l.style.position="relative";let a=document.createElement("style");a.textContent="#root>.modal.fortune-overlay{position:absolute;inset:0;width:100%;height:100%;padding:0;overflow:hidden}#root .fortune-result-fit{width:390px;height:598px;display:grid;place-items:center;padding:30px 30px 50px;transform:scale(var(--fortune-result-scale,1));transform-origin:center;pointer-events:auto}",document.head.append(a);function o(){let i=l.getBoundingClientRect();l.style.setProperty("--fortune-result-scale",String(Math.min(i.width/390,i.height/598)))}if(o(),m(window,"resize",o),typeof ResizeObserver<"u"){let i=new ResizeObserver(o);i.observe(l),V.push(()=>i.disconnect())}}we();let{ctx:E}=de(),u=d(".fog"),r=u.getContext("2d"),f=u.width,b=0,k=0,R="",v=!1,w=!1,g=null,L=[],M=0,z=!1,j=-1,x={cx:317.54,cy:254.28,radius:238,feather:4,artSize:640};function G(e){let t=f/x.artSize;e.beginPath(),e.arc(x.cx*t,x.cy*t,x.radius*t,0,Math.PI*2),e.closePath()}let $=document.createElement("canvas");$.width=$.height=f;let P=$.getContext("2d");G(P),P.fillStyle="#fff",P.fill();let F=P.getImageData(0,0,f,f).data,C=[];for(let e=3;e<F.length;e+=4)F[e]>=128&&C.push(e);let K=new Uint8Array(C.length);function Ce(){r.globalCompositeOperation="source-over",r.clearRect(0,0,f,f),r.save(),G(r),r.clip();let e=f/x.artSize,t=x.cx*e,n=x.cy*e,a=x.radius*e,o=r.createRadialGradient(t-a*.35,n-a*.4,a*.05,t,n,a*1.12);o.addColorStop(0,"#eee8f0"),o.addColorStop(.6,"#d8d0e3"),o.addColorStop(1,"#b5a8c9"),r.fillStyle=o,r.fillRect(0,0,f,f);let i=r.createRadialGradient(t,n,a-x.feather*e,t,n,a);i.addColorStop(0,"#fff"),i.addColorStop(1,"#fff0"),r.globalCompositeOperation="destination-in",r.fillStyle=i,r.fillRect(0,0,f,f),r.restore();let s=r.getImageData(0,0,f,f).data;C.forEach((c,y)=>{K[y]=s[c]}),M=0,z=!1,j=-1,l.dataset.mistCoverage="0.0000"}function J(e){let t=u.getBoundingClientRect();return{x:(e.clientX-t.left)*f/t.width,y:(e.clientY-t.top)*f/t.height}}function Q(e){let t=Math.floor(e.x),n=Math.floor(e.y);return t>=0&&t<f&&n>=0&&n<f&&F[(n*f+t)*4+3]>=128}function ke(){v||(v=!0,w=!1,g=null,u.classList.add("revealed"),u.setAttribute("aria-hidden","true"),d(".prediction").textContent=R,d(".next-vision").disabled=!1,L.push({friend:h[k],prediction:R,index:k}),I(640,.3,.1,"sine",900),S("revealed"))}function ee(){if(!z||v)return;z=!1;let e=r.getImageData(0,0,f,f).data,t=0;for(let n=0;n<C.length;n++){let a=K[n];a&&(t+=oe(1-e[C[n]]/a,0,1))}M=t/C.length,l.dataset.mistCoverage=M.toFixed(4),M>=.6&&ke()}function te(e){let t=J(e);if(!Q(t)){g=null;return}r.save(),G(r),r.clip(),r.globalCompositeOperation="destination-out",r.strokeStyle="#000",r.fillStyle="#000",r.lineCap="round",r.lineWidth=58,g?(r.beginPath(),r.moveTo(g.x,g.y),r.lineTo(t.x,t.y),r.stroke()):(r.beginPath(),r.arc(t.x,t.y,29,0,Math.PI*2),r.fill()),r.restore(),g=t,z=!0}let ze=["Chi avr\xE0 fortuna oggi?","Chi ricever\xE0 una sorpresa?","Chi inizier\xE0 un\u2019avventura?"],Se=["\xC8 in arrivo una piccola coincidenza felice.","Un messaggio inatteso porter\xE0 un sorriso.","Un desiderio si avvicina alla realt\xE0.","Una buona idea arriver\xE0 al momento giusto.","Un volto noto porter\xE0 una buona notizia."];function ne(){k=Math.floor(Math.random()*h.length),R=ae(Se),v=!1,w=!1,g=null,u.style.transition="none",u.classList.remove("revealed"),u.removeAttribute("aria-hidden"),d(".count").textContent=b+1+" / 3",d(".question").textContent=ze[b],d(".prediction").textContent="",d(".next-vision").disabled=!0,d(".next-vision").textContent=b===2?"Vedi le visioni":"Prossima visione",Ce(),u.offsetWidth,u.style.removeProperty("transition"),S("ready")}function ie(){b=0,L=[],ne()}m(u,"pointerdown",e=>{v||!Q(J(e))||(T(),S("wiping"),w=!0,g=null,u.setPointerCapture(e.pointerId),te(e))}),m(u,"pointermove",e=>{w&&!v&&te(e)});for(let e of["pointerup","pointercancel","lostpointercapture"])m(u,e,()=>{ee(),w=!1,g=null});W.push(e=>{e||(w=!1,g=null)});function Ie(){he("Le tue visioni","","",ie);let e=d(".result");e.classList.add("fortune-summary");let t=e.querySelector(".fortune-list");t||(t=document.createElement("ol"),t.className="fortune-list",e.querySelector("button").before(t)),t.replaceChildren();for(let n of L){let a=document.createElement("li");a.className="fortune-row";let o=document.createElement("canvas");o.className="fortune-avatar",o.width=96,o.height=96,o.setAttribute("role","img"),o.setAttribute("aria-label",n.friend.nickname);let i=o.getContext("2d");A(i,48,48,47,"#e5daed"),n.friend.image?_(i,n.friend.image,48,48,44):(A(i,48,48,44,["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][n.index%4]),U(i,Array.from(n.friend.nickname||"?")[0],48,48,32,"#fff"));let s=document.createElement("div");s.className="fortune-copy";let c=document.createElement("strong");c.className="fortune-name",c.textContent=n.friend.nickname;let y=document.createElement("p");y.textContent=n.prediction,s.append(c,y),a.append(o,s),t.append(a)}}m(d(".next-vision"),"click",()=>{T(),b===2?(Ie(),ce()):(b++,ne())}),ie(),fe((e,t)=>{z&&t-j>=.05&&(j=t,ee()),E.clearRect(0,0,390,598),ye(E,k,195,304,30,"#fff"),ve(E,k,195,351,14)}),me(()=>{d(".guide")&&(d(".guide").textContent=String(Y("GUIDE","Strofina e scopri chi c\u2019\xE8")))})})();(()=>{let l=document.createElement("style");l.dataset.batch3Ui="20261116",l.textContent=`
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
`,document.head.append(l)})();(()=>{let l=document.createElement("style");l.textContent=`
/* A readable three-row keepsake instead of the generic numeric result. */
.result.fortune-summary{display:flex;flex-direction:column;gap:18px;width:330px;max-width:100%;max-height:100%;padding:24px 20px;background:#faf7ff;border:2px solid #65566d;border-radius:18px;box-shadow:4px 5px 0 #65566d22;text-align:left;overflow-y:auto}
.result.fortune-summary h2{margin:0;font:700 24px/1.25 Playful,UIBody,sans-serif;text-align:center;overflow-wrap:anywhere;text-wrap:balance}
.result.fortune-summary>.value,.result.fortune-summary>p{display:none}
.fortune-list{display:flex;flex-direction:column;gap:0;margin:0;padding:0;list-style:none}
.fortune-row{display:grid;grid-template-columns:48px minmax(0,1fr);gap:12px;align-items:start;padding:14px 0;border-bottom:1px solid #65566d26}
.fortune-row:first-child{padding-top:0}.fortune-row:last-child{padding-bottom:0;border-bottom:0}
.fortune-avatar{display:block;width:48px;height:48px;margin-top:2px}
.fortune-copy{min-width:0}.fortune-name{display:block;margin:0 0 4px;font:700 16px/1.3 UIBody,sans-serif;color:#45364e;overflow-wrap:anywhere}
.result.fortune-summary .fortune-row p{margin:0;font:400 14px/1.5 UIBody,sans-serif;color:#65566d;white-space:normal;overflow-wrap:anywhere}
.result.fortune-summary>.pill{align-self:center;margin:2px 0 0;min-height:44px;max-width:100%;padding:11px 28px;background:#4b4355;color:#fff;border-radius:10px;font:700 16px/1.3 Playful,UIBody,sans-serif;white-space:normal}
#root[data-phase="result"] .count,#root[data-phase="result"] .vision-copy,#root[data-phase="result"] .guide,#root[data-phase="result"] .next-vision{visibility:hidden}
`,document.head.append(l)})();})();
