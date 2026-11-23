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

(()=>{document.documentElement.lang="it";(()=>{"use strict";let r=document.getElementById("root"),mt=(t,e,n)=>Math.max(e,Math.min(n,t)),yt=(t,e)=>t+Math.random()*(e-t),bt=t=>t[Math.floor(Math.random()*t.length)],xt=t=>t[t.length-1],Y=t=>{for(let e=t.length-1;e>0;e--){let n=Math.floor(Math.random()*(e+1));[t[e],t[n]]=[t[n],t[e]]}return t},q=[],U=[],M=!0,_=!1,c;function x(t,e,n,i){t.addEventListener(e,n,i),q.push(()=>t.removeEventListener(e,n,i))}function Z(t,e,n="#faf8f1"){let i=document.createElement("style");i.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(i),r.style.background=n,r.innerHTML='<div class="fit">'+e+"</div>";let a=r.querySelector(".fit");function o(){let s=r.getBoundingClientRect(),l=Math.min(s.width/390,s.height/598);a.style.transform=`translate(${(s.width-390*l)/2}px,${(s.height-598*l)/2}px) scale(${l})`,r.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}o(),x(window,"resize",o)}function d(t){return r.querySelector(t)}function J(){var t;(t=d(".guide"))==null||t.classList.add("gone")}function I(t){r.dataset.phase=t}function B(){Q(),J()}function Q(){try{c||(c=new(window.AudioContext||window.webkitAudioContext)),c.state==="suspended"&&c.resume().catch(()=>{})}catch{}}function C(t=450,e=.08,n=.18,i="sine",a=0){if(!(!c||!M))try{let o=c.createOscillator(),s=c.createGain(),l=c.currentTime;o.type=i,o.frequency.setValueAtTime(t,l),a&&o.frequency.exponentialRampToValueAtTime(Math.max(30,a),l+e),s.gain.setValueAtTime(.001,l),s.gain.exponentialRampToValueAtTime(n,l+.006),s.gain.exponentialRampToValueAtTime(.001,l+e),o.connect(s),s.connect(c.destination),o.start(l),o.stop(l+e+.02),o.onended=()=>{o.disconnect(),s.disconnect()}}catch{}}function tt(){C(523,.12,.18),setTimeout(()=>C(784,.17,.16),100)}function et(){C(180,.22,.18,"triangle",65)}function nt(t){let e=0;function n(i){if(_)return;let a=Math.min(.035,(i-(e||i))/1e3);e=i,document.hidden||t(M?a:0,i/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function it(){let t=d("canvas.stage"),e=t.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return t.width=390*n,t.height=598*n,e.scale(n,n),{canvas:t,ctx:e}}function ot(t,e=d("canvas.stage")){let n=e.getBoundingClientRect();return{x:(t.clientX-n.left)*390/n.width,y:(t.clientY-n.top)*598/n.height}}function at(t,e,n,i,a,o){o=Math.min(Math.abs(i)/2,Math.abs(a)/2,o),t.moveTo(e+o,n),t.lineTo(e+i-o,n),t.quadraticCurveTo(e+i,n,e+i,n+o),t.lineTo(e+i,n+a-o),t.quadraticCurveTo(e+i,n+a,e+i-o,n+a),t.lineTo(e+o,n+a),t.quadraticCurveTo(e,n+a,e,n+a-o),t.lineTo(e,n+o),t.quadraticCurveTo(e,n,e+o,n),t.closePath()}function vt(t,e,n,i,a,o,s,l){t.beginPath(),at(t,e,n,i,a,o),s&&(t.fillStyle=s,t.fill()),l&&(t.strokeStyle=l,t.stroke())}function j(t,e,n,i,a,o){t.beginPath(),t.arc(e,n,Math.max(.01,i),0,Math.PI*2),a&&(t.fillStyle=a,t.fill()),o&&(t.strokeStyle=o,t.stroke())}function L(t,e,n,i,a,o,s=2){t.beginPath(),t.moveTo(e,n),t.lineTo(i,a),t.strokeStyle=o,t.lineWidth=s,t.stroke()}function z(t,e,n,i,a=18,o="#25252a",s="UIBody",l="center"){t.font=`700 ${a}px ${s}`,t.fillStyle=o,t.textAlign=l,t.textBaseline="middle",t.fillText(e,n,i)}let O=[];function P(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(R(e,t))}function wt(t){let e=new Image;return e.onerror=()=>{r.dataset.assetIssue="image"},e.src=P(t),O.push({im:e,path:t}),e}function st(t,e,n,i,a,o){if(!e||!e.width)return;let s=e.videoWidth||e.width,l=e.videoHeight||e.height;if(!s||!l)return;let b=Math.max(a/s,o/l);t.save(),t.beginPath(),t.rect(n,i,a,o),t.clip(),t.drawImage(e,n+(a-s*b)/2,i+(o-l*b)/2,s*b,l*b),t.restore()}function rt(t,e,n,i,a){t.save(),t.beginPath(),t.arc(n,i,a,0,Math.PI*2),t.clip(),st(t,e,n-a,i-a,a*2,a*2),t.restore()}function lt(t,e,n,i){let a=d(".modal");if(!a)return;a.hidden=!1,a.querySelector("h2").textContent=t,a.querySelector(".value").textContent=e,a.querySelector("p").textContent=n;let o=a.querySelector("button");o.onclick=()=>{a.hidden=!0,B(),i()},I("result")}function ft(t="Gioca ancora"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function kt(){let t=d(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let ct=[];function D(t){M=t,t||c==null||c.suspend().catch(()=>{});for(let e of ct)e(t)}x(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&D(t.data.active===!0)}),x(document,"visibilitychange",()=>{D(!document.hidden)}),x(window,"pagehide",()=>{_=!0,q.splice(0).forEach(t=>t()),U.splice(0).forEach(t=>t()),c==null||c.close().catch(()=>{})});let V={};function R(t,e){return V[t]??e}async function F(t=()=>{}){let e=new AbortController,n=setTimeout(()=>e.abort(),1600);try{let i=await fetch("./game.config.json",{signal:e.signal});if(!i.ok)throw Error("Configurazione non disponibile");let a=await i.json();for(let o of["texts","tweaks","images"])for(let s of a[o]||[])V[s.id]=o==="images"?s.path:s.value;for(let o of O){let s=P(o.path);o.im.getAttribute("src")!==s&&(o.im.src=s)}for(let o of r.querySelectorAll('img[src^="./assets/"]'))o.src=P(o.getAttribute("src"));t(),r.dataset.config="loaded"}catch{r.dataset.config="defaults"}finally{clearTimeout(n)}}let p=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],A=()=>{};function dt(){var n;let t="./assets/img_user_avatar_default_3x.png";function e(i,a){p=i.slice(0,24).map((o,s)=>({nickname:typeof o.nickname=="string"&&o.nickname.trim()?o.nickname.trim():"nickname"+(s+1),avatar:typeof o.avatar=="string"&&o.avatar.trim()?o.avatar:t,image:null}));for(let o of p){let s=function(l,b=!1){var X;let k;try{k=a&&typeof((X=window.tt)==null?void 0:X.createImage)=="function"?window.tt.createImage():new Image}catch{k=new Image}k.onload=()=>{o.image=k,A()},k.onerror=()=>{!b&&l!==t?s(t,!0):(o.image=null,A())},k.src=l};s(o.avatar,o.avatar===t)}A()}e(p,!1),r.dataset.friends="sample",typeof((n=window.tt)==null?void 0:n.getFriendsInfo)=="function"&&window.tt.getFriendsInfo({success(i){let a=Array.isArray(i==null?void 0:i.friends)?i.friends.filter(o=>o&&typeof o=="object"):[];a.length&&(e(a,!0),r.dataset.friends="host",A())},fail(i){r.dataset.friends="sample",console.warn("Profili amici non disponibili",(i==null?void 0:i.errMsg)||(i==null?void 0:i.message)||"")}})}function $(t,e,n,i,a,o="#fff"){let s=p[(e%p.length+p.length)%p.length];t.save(),t.shadowColor="#25212d20",t.shadowBlur=6,j(t,n,i,a,o),t.shadowBlur=0,s!=null&&s.image?rt(t,s.image,n,i,Math.max(1,a-2)):(j(t,n,i,Math.max(1,a-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][e%4]),z(t,Array.from((s==null?void 0:s.nickname)||"?")[0],n,i,a*.7,"#fff")),t.restore()}function S(t){var e;return((e=p[(t%p.length+p.length)%p.length])==null?void 0:e.nickname)||"Amico"}function zt(t,e,n,i,a=13){z(t,Array.from(S(e)).slice(0,15).join(""),n,i,a)}dt(),Z(".fit{background:#e987b6}.guide{top:90px;font:17px Playful,Arial}.pill{border-radius:0;background:#fff;color:#111;border:3px solid #111;box-shadow:4px 4px #111}.turn{position:absolute;left:30px;right:30px;top:456px;text-align:center;font-weight:700;font-size:14px}.result{border:3px solid #111;box-shadow:6px 6px #111;border-radius:0;background:#fff}.result .value{font-size:30px}",`<canvas class="stage" aria-label="Tabellone del tris"></canvas><div class="guide">Scegli una casella e fai tris</div><div class="opponent-name" aria-label="Avversario"></div><div class="turn">Tocca a te</div><div class="bottom"><button class="pill reset">Nuova partita</button></div>${ft()}`,"#e987b6");function pt(t){let e=d(".fit"),n=d(".modal");n&&(n.classList.add("host-modal"),r.append(n));let i=document.createElement("style");i.textContent="#root{position:relative;isolation:isolate}#root>.fit{z-index:1;background:transparent}#root .pill{border-color:#282723;color:#282723}#root .pill{box-shadow:3px 4px 0 #282723}#root>.host-modal{position:absolute;inset:0;z-index:30;display:block;padding:0;background:#22242c33}#root>.host-modal>.result{position:absolute;left:50%;top:calc(50% - var(--modal-shift,10px));width:320px;max-width:none;max-height:518px;overflow-y:auto;transform:translate(-50%,-50%) scale(var(--game-fit-scale,1));transform-origin:center}",document.head.append(i);function a(){let o=r.getBoundingClientRect(),s=Math.min(o.width/390,o.height/598),l=(o.width-390*s)/2,b=(o.height-598*s)/2;e.style.transform=`translate(${l}px,${b}px) scale(${s})`,r.style.setProperty("--game-fit-scale",String(s)),r.style.setProperty("--modal-shift",`${10*s}px`),t==="felt"?(r.style.backgroundImage=`radial-gradient(circle ${380*s}px at ${l+195*s}px ${b+280*s}px, #36674f88 ${50*s}px, #102e2244 ${380*s}px)`,r.style.backgroundRepeat="no-repeat",r.style.backgroundSize="auto",r.style.backgroundPosition="0 0"):(r.style.backgroundImage=`url("${String(R("PAPER_BACKDROP","./assets/paper-print-v1.svg"))}")`,r.style.backgroundRepeat="repeat",r.style.backgroundSize=`${256*s}px ${256*s}px`,r.style.backgroundPosition=`${l}px ${b}px`)}if(a(),x(window,"resize",a),typeof ResizeObserver=="function"){let o=new ResizeObserver(a);o.observe(r),U.push(()=>o.disconnect())}return a}let ut=pt("paper"),{canvas:N,ctx:f}=it(),g=Array(9).fill(0),v=1,w="ready",T=0,u=45,h=143,m=300,y=100;function W(){let t=S(1),e=d(".opponent-name");e&&(e.textContent=t,e.title=t,e.setAttribute("aria-label","Avversario: "+t)),N.setAttribute("aria-label","Tris: tu contro "+t),v===2&&w!=="result"&&(d(".turn").textContent=t+" sta pensando\u2026")}A=W,W();let ht=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];function H(t){for(let e of ht)if(t[e[0]]&&e.every(n=>t[n]===t[e[0]]))return t[e[0]];return t.every(Boolean)?3:0}function G(t,e){let n=H(t);if(n)return n===2?10:n===1?-10:0;let i=[];for(let a=0;a<9;a++)t[a]||(t[a]=e,i.push(G(t,e===2?1:2)),t[a]=0);return e===2?Math.max(...i):Math.min(...i)}function gt(){let t=H(g);return t?(w="result",t===1?tt():t===2&&et(),lt(t===1?"Hai vinto!":t===2?S(1)+" vince":"Pareggio",t===3?"Riprova":"Tre in fila","Una piccola sfida, una grande rivalit\xE0.",E),!0):!1}function K(t,e){g[t]||w==="result"||(B(),g[t]=e,w="playing",C(500-e*70,.05,.13),r.dataset.moves=g.filter(Boolean).length,!gt()&&(v=e===1?2:1,d(".turn").textContent=v===1?"Tocca a te":S(1)+" sta pensando\u2026",v===2&&(T=.4),I("playing")))}function E(){g=Array(9).fill(0),v=1,w="ready",T=0,d(".turn").textContent="Tocca a te",I("ready")}x(N,"pointerdown",t=>{let e=ot(t);v!==1||e.x<u||e.x>=u+m||e.y<h||e.y>=h+m||K(Math.floor((e.y-h)/y)*3+Math.floor((e.x-u)/y),1)}),x(d(".reset"),"click",()=>{B(),E()}),E(),nt(t=>{if(T>0&&(T-=t,T<=0&&v===2&&w!=="result")){let e=-1/0,n=-1;for(let i of Y([...Array(9).keys()]))if(!g[i]){g[i]=2;let a=G(g,1);g[i]=0,a>e&&(e=a,n=i)}n>=0&&K(n,2)}f.clearRect(0,0,390,598),$(f,0,68,66,19,"#151515"),$(f,1,322,66,19,"#151515"),z(f,"TU",108,66,18,"#242424"),z(f,"VS",195,66,18),f.fillStyle="#191919",f.fillRect(u+5,h+6,m+3,m+3),f.fillStyle="#fff",f.fillRect(u,h,m,m),f.strokeStyle="#191919",f.lineWidth=3,f.strokeRect(u,h,m,m);for(let e=1;e<3;e++)L(f,u+e*y,h,u+e*y,h+m,"#191919",3),L(f,u,h+e*y,u+m,h+e*y,"#191919",3);g.forEach((e,n)=>{if(!e)return;let i=u+y/2+n%3*y,a=h+y/2+Math.floor(n/3)*y;$(f,e-1,i,a,29,"#161616"),z(f,e===1?"\xD7":"\u25CB",i+32,a+30,18)})}),F(()=>{d(".guide")&&(d(".guide").textContent=String(R("GUIDE","Scegli una casella e fai tris")))}),F(ut)})();(()=>{let r=document.createElement("style");r.dataset.batch3Ui="20261116",r.textContent=`
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

.guide{font-size:20px;line-height:1.25}.opponent-name{position:absolute;top:55px;left:213px;width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;font:600 18px/1.25 UIBody,system-ui,sans-serif;color:#242424;pointer-events:none}.turn{top:456px;font-size:14px;line-height:1.4}
.bottom{bottom:66px}.bottom .pill{min-height:44px;font-size:16px}
`,document.head.append(r)})();})();
