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

(()=>{(()=>{"use strict";let c=document.getElementById("root"),et=(t,e,i)=>Math.max(e,Math.min(i,t)),xt=(t,e)=>t+Math.random()*(e-t),Ut=t=>t[Math.floor(Math.random()*t.length)],Wt=t=>t[t.length-1],Ft=t=>{for(let e=t.length-1;e>0;e--){let i=Math.floor(Math.random()*(e+1));[t[e],t[i]]=[t[i],t[e]]}return t},nt=[],D=[],I=!0,q=!1,w;function m(t,e,i,r){t.addEventListener(e,i,r),nt.push(()=>t.removeEventListener(e,i,r))}function yt(t,e,i="#faf8f1"){let r=document.createElement("style");r.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(r),c.style.background=i,c.innerHTML='<div class="fit">'+e+"</div>";let o=c.querySelector(".fit");function n(){let a=c.getBoundingClientRect(),s=Math.min(a.width/390,a.height/598);o.style.transform=`translate(${(a.width-390*s)/2}px,${(a.height-598*s)/2}px) scale(${s})`,c.dataset.layout=`${Math.round(a.width)}x${Math.round(a.height)}`}n(),m(window,"resize",n)}function u(t){return c.querySelector(t)}function vt(){var t;(t=u(".guide"))==null||t.classList.add("gone")}function N(t){c.dataset.phase=t}function $(){K(),vt()}function K(){try{w||(w=new(window.AudioContext||window.webkitAudioContext)),w.state==="suspended"&&w.resume().catch(()=>{})}catch{}}function O(t=450,e=.08,i=.18,r="sine",o=0){if(!(!w||!I))try{let n=w.createOscillator(),a=w.createGain(),s=w.currentTime;n.type=r,n.frequency.setValueAtTime(t,s),o&&n.frequency.exponentialRampToValueAtTime(Math.max(30,o),s+e),a.gain.setValueAtTime(.001,s),a.gain.exponentialRampToValueAtTime(i,s+.006),a.gain.exponentialRampToValueAtTime(.001,s+e),n.connect(a),a.connect(w.destination),n.start(s),n.stop(s+e+.02),n.onended=()=>{n.disconnect(),a.disconnect()}}catch{}}function $t(){O(523,.12,.18),setTimeout(()=>O(784,.17,.16),100)}function wt(){O(180,.22,.18,"triangle",65)}function Mt(t){let e=0;function i(r){if(q)return;let o=Math.min(.035,(r-(e||r))/1e3);e=r,document.hidden||t(I?o:0,r/1e3),requestAnimationFrame(i)}requestAnimationFrame(i)}function Ot(){let t=u("canvas.stage"),e=t.getContext("2d"),i=Math.min(2,window.devicePixelRatio||1);return t.width=390*i,t.height=598*i,e.scale(i,i),{canvas:t,ctx:e}}function jt(t,e=u("canvas.stage")){let i=e.getBoundingClientRect();return{x:(t.clientX-i.left)*390/i.width,y:(t.clientY-i.top)*598/i.height}}function kt(t,e,i,r,o,n){n=Math.min(Math.abs(r)/2,Math.abs(o)/2,n),t.moveTo(e+n,i),t.lineTo(e+r-n,i),t.quadraticCurveTo(e+r,i,e+r,i+n),t.lineTo(e+r,i+o-n),t.quadraticCurveTo(e+r,i+o,e+r-n,i+o),t.lineTo(e+n,i+o),t.quadraticCurveTo(e,i+o,e,i+o-n),t.lineTo(e,i+n),t.quadraticCurveTo(e,i,e+n,i),t.closePath()}function Vt(t,e,i,r,o,n,a,s){t.beginPath(),kt(t,e,i,r,o,n),a&&(t.fillStyle=a,t.fill()),s&&(t.strokeStyle=s,t.stroke())}function Yt(t,e,i,r,o,n){t.beginPath(),t.arc(e,i,Math.max(.01,r),0,Math.PI*2),o&&(t.fillStyle=o,t.fill()),n&&(t.strokeStyle=n,t.stroke())}function Gt(t,e,i,r,o,n,a=2){t.beginPath(),t.moveTo(e,i),t.lineTo(r,o),t.strokeStyle=n,t.lineWidth=a,t.stroke()}function Xt(t,e,i,r,o=18,n="#25252a",a="UIBody",s="center"){t.font=`700 ${o}px ${a}`,t.fillStyle=n,t.textAlign=s,t.textBaseline="middle",t.fillText(e,i,r)}let it=[];function Z(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(st(e,t))}function j(t){let e=new Image;return e.onerror=()=>{c.dataset.assetIssue="image"},e.src=Z(t),it.push({im:e,path:t}),e}function Ct(t,e,i,r,o,n){if(!e||!e.width)return;let a=e.videoWidth||e.width,s=e.videoHeight||e.height;if(!a||!s)return;let l=Math.max(o/a,n/s);t.save(),t.beginPath(),t.rect(i,r,o,n),t.clip(),t.drawImage(e,i+(o-a*l)/2,r+(n-s*l)/2,a*l,s*l),t.restore()}function _t(t,e,i,r,o){t.save(),t.beginPath(),t.arc(i,r,o,0,Math.PI*2),t.clip(),Ct(t,e,i-o,r-o,o*2,o*2),t.restore()}function zt(t,e,i,r){let o=u(".modal");if(!o)return;o.hidden=!1,o.querySelector("h2").textContent=t,o.querySelector(".value").textContent=e,o.querySelector("p").textContent=i;let n=o.querySelector("button");n.onclick=()=>{o.hidden=!0,$(),r()},N("result")}function At(t="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function Nt(){let t=u(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let J=[];function ot(t){I=t,t||w==null||w.suspend().catch(()=>{});for(let e of J)e(t)}m(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&ot(t.data.active===!0)}),m(document,"visibilitychange",()=>{ot(!document.hidden)}),m(window,"pagehide",()=>{q=!0,nt.splice(0).forEach(t=>t()),D.splice(0).forEach(t=>t()),w==null||w.close().catch(()=>{})});let at={};function st(t,e){return at[t]??e}async function St(t=()=>{}){let e=new AbortController,i=setTimeout(()=>e.abort(),1600);try{let r=await fetch("./game.config.json",{signal:e.signal});if(!r.ok)throw Error("Config unavailable");let o=await r.json();for(let n of["texts","tweaks","images"])for(let a of o[n]||[])at[a.id]=n==="images"?a.path:a.value;for(let n of it){let a=Z(n.path);n.im.getAttribute("src")!==a&&(n.im.src=a)}for(let n of c.querySelectorAll('img[src^="./assets/"]'))n.src=Z(n.getAttribute("src"));t(),c.dataset.config="loaded"}catch{c.dataset.config="defaults"}finally{clearTimeout(i)}}let d=null,h=null,S=null,U=null,W=!1,H=!1,A="",rt=()=>{};function P(){d==null||d.getTracks().forEach(t=>t.stop()),d=null,h==null||h.close().catch(()=>{}),h=S=U=null,W=!1}async function lt(){var t;if(!W){W=!0;try{if(!((t=navigator.mediaDevices)!=null&&t.getUserMedia))throw Error("No microphone");if(d=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!0,noiseSuppression:!0,autoGainControl:!1}}),q||!I||A==="hold"){P();return}h=new(window.AudioContext||window.webkitAudioContext),await h.resume();let e=h.createMediaStreamSource(d);S=h.createAnalyser(),S.fftSize=1024,e.connect(S),U=new Float32Array(S.fftSize),u(".mic-enable").textContent="Mic on",u(".mic-status").textContent="Listening \xB7 Space or hold also works",c.dataset.microphone="enabled"}catch{W=!1,u(".mic-enable").textContent="Enable microphone",u(".mic-status").textContent="Mic unavailable \xB7 hold the button to play",c.dataset.microphone="unavailable"}}}function Tt(){if(H)return .9;if(!S||!I)return 0;S.getFloatTimeDomainData(U);let t=0;for(let e of U)t+=e*e;return et((Math.sqrt(t/U.length)-.012)*14,0,1)}function Pt(){m(u(".mic-enable"),"click",()=>{K(),lt()});let t=u(".voice-hold");m(t,"pointerdown",e=>{e.preventDefault(),$(),Q("hold"),H=!0,t.setPointerCapture(e.pointerId)});for(let e of["pointerup","pointercancel","lostpointercapture"])m(t,e,()=>H=!1);m(window,"keydown",e=>{e.code==="Space"&&!e.repeat&&(e.preventDefault(),$(),Q("hold"),H=!0)}),m(window,"keyup",e=>{e.code==="Space"&&(H=!1)}),J.push(e=>{if(e){if(h==null||h.resume().catch(()=>{}),d)for(let i of d.getTracks())i.enabled=!0}else if(H=!1,h==null||h.suspend().catch(()=>{}),d)for(let i of d.getTracks())i.enabled=!1}),D.push(P),It()}function Bt(t="Hold to try"){return`<div class="status mic-status" hidden></div><div class="bottom"><button class="capability mic-enable">Enable microphone</button><button class="capability voice-hold">${t}</button></div>`}function Q(t){A=t,t==="hold"&&(d||W)&&P(),rt()}function It(){let t=u(".mic-enable"),e=u(".voice-hold"),i=t.parentElement,r=u(".mic-status"),o=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it"),n=document.createElement("style");n.textContent="#root .bottom.voice-mode-selected{display:flex!important;justify-content:center!important;align-items:center!important}#root .bottom.voice-mode-selected>.capability{flex:0 1 auto!important;width:auto!important;min-width:150px;max-width:260px}#root .bottom>.capability[hidden]{display:none!important}",document.head.append(n);function a(){q||(t.hidden=A==="hold",e.hidden=A==="voice",i.classList.toggle("voice-mode-selected",!!A),c.dataset.voiceControl=A||"choice",A==="hold"&&(r.textContent="",r.hidden=!0))}rt=a,m(t,"click",()=>Q("voice"),{capture:!0});let s=new MutationObserver(()=>{let l=c.dataset.microphone;A==="voice"&&["unavailable","error","off"].includes(l)&&(A=""),A==="hold"&&d&&P(),a()});s.observe(c,{attributes:!0,attributeFilter:["data-microphone"]}),D.push(()=>s.disconnect()),a()}function qt(){let t=u(".mic-enable"),e=u(".mic-status"),o=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it")?{idle:"Mic spento",requesting:"Connessione\u2026",active:"Mic attivo",paused:"Mic in pausa",start:"Attiva microfono",stop:"Disattiva microfono",listening:"",fallback:"",unavailable:"Non disponibile \xB7 usa il pulsante"}:{idle:"Mic off",requesting:"Connecting\u2026",active:"Mic on",paused:"Mic paused",start:"Start microphone",stop:"Stop microphone",listening:"",fallback:"",unavailable:"Mic unavailable \xB7 hold the button to play"},n=document.createElement("style");n.textContent=".bottom .capability.mic-enable{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;flex:1 1 174px}.mic-enable .mic-icon{width:18px;height:18px;flex:none}.mic-enable .mic-record-dot{width:10px;height:10px;flex:none;background:currentColor;border-radius:50%}.bottom .capability.mic-enable.is-listening{background:#d94646;border-color:#d94646;color:#fff;box-shadow:0 2px 8px #bd333326}.mic-enable .mic-button-label{white-space:nowrap}",document.head.append(n);let a=!1,s=!1,l="",g=null,x=null;function v(){var M;let p=((M=d==null?void 0:d.getAudioTracks)==null?void 0:M.call(d))||[];return I&&!!S&&(h==null?void 0:h.state)==="running"&&p.some(z=>z.readyState==="live"&&z.enabled&&!z.muted)}function y(){var F;if(q)return;let p=v(),M=!!((F=d==null?void 0:d.getAudioTracks)!=null&&F.call(d).some(B=>B.readyState==="live")),z=a?"requesting":p?"active":M?"paused":s?"unavailable":"idle";if(t.disabled=a,t.setAttribute("aria-pressed",String(p)),t.classList.toggle("is-listening",p),t.setAttribute("aria-label",M?o.stop:o.start),t.dataset.micState=z,c.dataset.microphone=p?"enabled":z==="idle"?"off":z,z!==l){let B=p?'<span class="mic-record-dot" aria-hidden="true"></span>':'<svg class="mic-icon" viewBox="0 0 16 16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="M6 1h4v1h1v7h-1v1H6V9H5V2h1zM3 7h1v3h1v1h6v-1h1V7h1v4h-1v1H9v2h3v1H4v-1h3v-2H4v-1H3z"/></svg>',_=a?o.requesting:p?o.active:M?o.paused:o.idle;t.innerHTML=B+'<span class="mic-button-label">'+_+"</span>",e.textContent=p?o.listening:s?o.unavailable:o.fallback,l=z}}function T(){if(d&&g!==d){g=d;for(let p of d.getAudioTracks())m(p,"ended",()=>{P(),s=!1,y()}),m(p,"mute",y),m(p,"unmute",y)}h&&x!==h&&(x=h,m(h,"statechange",y))}m(t,"click",async p=>{if(p.preventDefault(),p.stopImmediatePropagation(),!(a||q)){if(d){P(),s=!1,y();return}if(K(),s=!1,a=!0,y(),await lt(),a=!1,q||!I){P(),y();return}(!d||!h||!S)&&(P(),s=!0),T(),l="",y()}},{capture:!0}),J.push(()=>{Promise.resolve().then(()=>{T(),y()})}),T(),y()}function Et(){let t=u("canvas.stage"),e=t.getContext("2d"),i=u(".fit"),r={left:0,top:0,right:390,bottom:598};c.style.position="relative",c.style.isolation="isolate",c.prepend(t),i.style.background="transparent",i.style.zIndex="1",Object.assign(t.style,{position:"absolute",inset:"0",width:"100%",height:"100%",zIndex:"0",pointerEvents:"none"});function o(){let n=c.getBoundingClientRect();if(!n.width||!n.height)return;let a=Math.min(2,window.devicePixelRatio||1),s=Math.min(n.width/390,n.height/598),l=(n.width-390*s)/2,g=(n.height-598*s)/2,x=Math.round(n.width*a),v=Math.round(n.height*a);(t.width!==x||t.height!==v)&&(t.width=x,t.height=v),e.setTransform(a*s,0,0,a*s,a*l,a*g),e.imageSmoothingEnabled=!1,Object.assign(r,{left:-l/s,top:-g/s,right:(n.width-l)/s,bottom:(n.height-g)/s}),i.style.transform=`translate(${l}px,${g}px) scale(${s})`}if(o(),m(window,"resize",o),typeof ResizeObserver<"u"){let n=new ResizeObserver(o);n.observe(c),D.push(()=>n.disconnect())}return{canvas:t,ctx:e,bounds:r}}function Ht(t){let e=u(t==="camera"?".cam-status":".mic-status");if(!e)return;let i=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it");e.setAttribute("role","status"),e.setAttribute("aria-live","polite");function r(){var g;let s="";if(t==="camera")["requesting","unavailable"].includes(c.dataset.camera)&&(s=e.textContent);else{let x=((g=u(".mic-enable"))==null?void 0:g.dataset.micState)||c.dataset.microphone;x==="requesting"?s=i?"Consenti l\u2019accesso al microfono":"Allow microphone access":["unavailable","error"].includes(x)&&(s=i?"Microfono non disponibile":"Microphone unavailable")}e.textContent!==s&&(e.textContent=s);let l=!s.trim();e.hidden!==l&&(e.hidden=l)}let o=new MutationObserver(r);o.observe(e,{childList:!0,characterData:!0,subtree:!0});let n=new MutationObserver(r);n.observe(c,{attributes:!0,attributeFilter:[t==="camera"?"data-camera":"data-microphone"]});let a=u(".mic-enable");a&&n.observe(a,{attributes:!0,attributeFilter:["data-mic-state"]}),r(),D.push(()=>{o.disconnect(),n.disconnect()})}yt(".fit{background:#93c7c3}.guide{top:186px;font-family:Playful,Arial;color:#fff;text-shadow:0 2px #36776c80}.hud{color:#fff;font-family:Playful,Arial;text-shadow:0 3px #36776c80}.result{background:#fff0c8}.result h2{font-family:Playful,Arial}.result .value{color:#b46c38}.pill{background:#bc783e}.capability{color:#325b52;border-color:#59998d55}",`<canvas class="stage" aria-label="Voice flight"></canvas><div class="hud center"><span class="score">0</span></div><div class="guide">Make a sound to fly \xB7 quiet to fall</div>${Bt("Hold to fly")}${At()}`,"#93c7c3"),Ht("microphone");let{canvas:V,ctx:b,bounds:f}=Et(),L="ready",k={y:300,v:0},R=[],tt=0,Y=0,G=0,ct=0,E={sky:j("./assets/pixel-v2/sky-hills.webp"),ground:j("./assets/pixel-v2/grass-ground.webp"),bird:j("./assets/pixel-v2/bird-flap.webp"),pipe:j("./assets/pixel-v2/garden-pipe.webp")},C={groundOpaqueY:9,groundBodyY:26,groundFill:"#c28b46",birdPanelWidth:110,birdBodyDiameter:42,birdFrames:[{eyeBox:[60,47,71,60],yellowBox:[35,38,74,76],anchorX:55.5,anchorY:58.5,bodyDiameter:42},{eyeBox:[61,47,72,60],yellowBox:[36,38,75,76],anchorX:56.5,anchorY:58.5,bodyDiameter:42}],pipeCap:{x:0,y:0,w:52,h:23},pipeBody:{x:7,y:28,w:39,h:16}},dt=0,ut="",ft=null,pt=null;Object.values(E).forEach(t=>m(t,"load",()=>{dt++}));let X=t=>t.complete&&t.naturalWidth>0;function Lt(){let t=[V.width,V.height,f.left,f.top,f.right,f.bottom,dt].join("/");if(t===ut)return;ut=t;let e=b.getTransform(),i=()=>{let s=document.createElement("canvas");s.width=V.width,s.height=V.height;let l=s.getContext("2d");return l.setTransform(e.a,e.b,e.c,e.d,e.e,e.f),l.imageSmoothingEnabled=!1,{im:s,brush:l}},r=i(),o=i();ft=r.im,pt=o.im;let n=f.right-f.left;if(r.brush.fillStyle="#39c5e7",r.brush.fillRect(f.left,f.top,n,f.bottom-f.top),X(E.sky)){let s=E.sky,l=498-f.top,g=Math.max(n/s.naturalWidth,l/s.naturalHeight),x=s.naturalWidth*g,v=s.naturalHeight*g;r.brush.drawImage(s,(f.left+f.right-x)/2,498-v,x,v)}let a=o.brush;if(a.fillStyle=C.groundFill,a.fillRect(f.left,498,n,Math.max(0,f.bottom-498)),X(E.ground)){let s=E.ground,l=256,g=l/s.naturalWidth,x=C.groundOpaqueY,v=C.groundBodyY,y=498-x*g,T=v*g,p=y+T;a.save(),a.beginPath(),a.rect(f.left,495,n,Math.max(0,f.bottom-495)),a.clip();for(let M=Math.floor(f.left/l)*l;M<f.right;M+=l){a.drawImage(s,0,0,s.naturalWidth,v,M,y,l,T);let z=s.naturalHeight-v,F=z*g;for(let B=p;B<f.bottom;B+=F){let _=Math.min(F,f.bottom-B);a.drawImage(s,0,v,s.naturalWidth,_/g,M,B,l,_)}}a.restore()}}function ht(t){b.save(),b.setTransform(1,0,0,1,0,0),b.drawImage(t,0,0),b.restore()}function gt(t,e,i,r=!1){let o=E.pipe;if(!X(o)||i<=0)return;let n=C.pipeCap,a=C.pipeBody;if(!n.w||!a.w)return;let s=62,l=54,g=n.h*s/n.w,x=l/a.w,v=Math.max(0,g-2),y=Math.max(0,i-v);b.save(),r?(b.translate(t+27,e+i),b.scale(1,-1),b.translate(-27,0)):b.translate(t,e);let T=a.h*x;for(let p=0;p<y;p+=T){let M=Math.min(T,y-p);b.drawImage(o,a.x,a.y,a.w,M/x,0,v+p,l,M)}b.drawImage(o,n.x,n.y,n.w,n.h,-4,0,s,g),b.restore()}function Rt(){var l;let t=E.bird;if(!X(t)||!C.birdBodyDiameter)return;let e=C.birdPanelWidth||t.naturalWidth/2,i=Math.sin(ct)>=0?0:1,r=(l=C.birdFrames)==null?void 0:l[i],n=36/((r==null?void 0:r.bodyDiameter)||C.birdBodyDiameter),a=(r==null?void 0:r.anchorX)??C.birdAnchorX,s=(r==null?void 0:r.anchorY)??C.birdAnchorY;b.save(),b.translate(100,Math.round(k.y)),b.drawImage(t,i*e,0,e,t.naturalHeight,-a*n,-s*n,e*n,t.naturalHeight*n),b.restore()}function Dt(){Lt(),ht(ft);for(let t of R)gt(t.x,f.top,t.gap-82-f.top,!0),gt(t.x,t.gap+82,500-t.gap-82);ht(pt),Rt()}function mt(){L="ready",k={y:300,v:0},R=[{x:390,gap:270,passed:!1}],Y=1.8,tt=0,G=0,u(".score").textContent="0",N("ready")}function bt(){L==="playing"&&(L="result",wt(),zt("Game over",G,"Pipes passed",mt))}Pt(),qt(),mt(),Mt((t,e)=>{let i=Tt();if(i>.12&&L==="ready"&&(L="playing",$(),N("playing")),L==="playing"){tt+=t,ct+=t*(i>.1?20:5),k.v+=(i>.1?-600*i:450)*t,k.v=et(k.v,-210,280),k.y+=k.v*t,Y-=t,Y<=0&&(R.push({x:430,gap:xt(205,335),passed:!1}),Y=1.65);let r=Math.min(170,110+tt*1.3);for(let o of R)o.x-=r*t,!o.passed&&o.x+54<100&&(o.passed=!0,G++,u(".score").textContent=G,O(760,.07,.12)),o.x<118&&o.x+54>82&&(k.y-13<o.gap-82||k.y+13>o.gap+82)&&bt();R=R.filter(o=>o.x>-70),(k.y<70||k.y>484)&&bt()}Dt()}),St(()=>{u(".guide")&&(u(".guide").textContent=String(st("GUIDE","Make a sound to fly \xB7 quiet to fall")))})})();(()=>{let c=document.createElement("style");c.dataset.batch3Ui="20261116",c.textContent=`
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
