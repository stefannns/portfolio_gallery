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

(()=>{document.documentElement.lang="it";(()=>{"use strict";let f=document.getElementById("root"),B=(t,e,n)=>Math.max(e,Math.min(n,t)),ot=(t,e)=>t+Math.random()*(e-t),Wt=t=>t[Math.floor(Math.random()*t.length)],Zt=t=>t[t.length-1],Jt=t=>{for(let e=t.length-1;e>0;e--){let n=Math.floor(Math.random()*(e+1));[t[e],t[n]]=[t[n],t[e]]}return t},at=[],st=[],M=!0,A=!1,p;function x(t,e,n,o){t.addEventListener(e,n,o),at.push(()=>t.removeEventListener(e,n,o))}function Ct(t,e,n="#faf8f1"){let o=document.createElement("style");o.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(o),f.style.background=n,f.innerHTML='<div class="fit">'+e+"</div>";let a=f.querySelector(".fit");function i(){let s=f.getBoundingClientRect(),r=Math.min(s.width/390,s.height/598);a.style.transform=`translate(${(s.width-390*r)/2}px,${(s.height-598*r)/2}px) scale(${r})`,f.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}i(),x(window,"resize",i)}function h(t){return f.querySelector(t)}function kt(){var t;(t=h(".guide"))==null||t.classList.add("gone")}function Z(t){f.dataset.phase=t}function D(){Tt(),kt()}function Tt(){try{p||(p=new(window.AudioContext||window.webkitAudioContext)),p.state==="suspended"&&p.resume().catch(()=>{})}catch{}}function I(t=450,e=.08,n=.18,o="sine",a=0){if(!(!p||!M))try{let i=p.createOscillator(),s=p.createGain(),r=p.currentTime;i.type=o,i.frequency.setValueAtTime(t,r),a&&i.frequency.exponentialRampToValueAtTime(Math.max(30,a),r+e),s.gain.setValueAtTime(.001,r),s.gain.exponentialRampToValueAtTime(n,r+.006),s.gain.exponentialRampToValueAtTime(.001,r+e),i.connect(s),s.connect(p.destination),i.start(r),i.stop(r+e+.02),i.onended=()=>{i.disconnect(),s.disconnect()}}catch{}}function At(){I(523,.12,.18),setTimeout(()=>I(784,.17,.16),100)}function It(){I(180,.22,.18,"triangle",65)}function Pt(t){let e=0;function n(o){if(A)return;let a=Math.min(.035,(o-(e||o))/1e3);e=o,document.hidden||t(M?a:0,o/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function St(){let t=h("canvas.stage"),e=t.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return t.width=390*n,t.height=598*n,e.scale(n,n),{canvas:t,ctx:e}}function zt(t,e=h("canvas.stage")){let n=e.getBoundingClientRect();return{x:(t.clientX-n.left)*390/n.width,y:(t.clientY-n.top)*598/n.height}}function _t(t,e,n,o,a,i){i=Math.min(Math.abs(o)/2,Math.abs(a)/2,i),t.moveTo(e+i,n),t.lineTo(e+o-i,n),t.quadraticCurveTo(e+o,n,e+o,n+i),t.lineTo(e+o,n+a-i),t.quadraticCurveTo(e+o,n+a,e+o-i,n+a),t.lineTo(e+i,n+a),t.quadraticCurveTo(e,n+a,e,n+a-i),t.lineTo(e,n+i),t.quadraticCurveTo(e,n,e+i,n),t.closePath()}function J(t,e,n,o,a,i,s,r){t.beginPath(),_t(t,e,n,o,a,i),s&&(t.fillStyle=s,t.fill()),r&&(t.strokeStyle=r,t.stroke())}function C(t,e,n,o,a,i){t.beginPath(),t.arc(e,n,Math.max(.01,o),0,Math.PI*2),a&&(t.fillStyle=a,t.fill()),i&&(t.strokeStyle=i,t.stroke())}function N(t,e,n,o,a,i,s=2){t.beginPath(),t.moveTo(e,n),t.lineTo(o,a),t.strokeStyle=i,t.lineWidth=s,t.stroke()}function rt(t,e,n,o,a=18,i="#25252a",s="UIBody",r="center"){t.font=`700 ${a}px ${s}`,t.fillStyle=i,t.textAlign=r,t.textBaseline="middle",t.fillText(e,n,o)}let lt=[];function Q(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(ut(e,t))}function Qt(t){let e=new Image;return e.onerror=()=>{f.dataset.assetIssue="image"},e.src=Q(t),lt.push({im:e,path:t}),e}function Et(t,e,n,o,a,i){if(!e||!e.width)return;let s=e.videoWidth||e.width,r=e.videoHeight||e.height;if(!s||!r)return;let c=Math.max(a/s,i/r);t.save(),t.beginPath(),t.rect(n,o,a,i),t.clip(),t.drawImage(e,n+(a-s*c)/2,o+(i-r*c)/2,s*c,r*c),t.restore()}function Rt(t,e,n,o,a){t.save(),t.beginPath(),t.arc(n,o,a,0,Math.PI*2),t.clip(),Et(t,e,n-a,o-a,a*2,a*2),t.restore()}function Ut(t,e,n,o){let a=h(".modal");if(!a)return;a.hidden=!1,a.querySelector("h2").textContent=t,a.querySelector(".value").textContent=e,a.querySelector("p").textContent=n;let i=a.querySelector("button");i.onclick=()=>{a.hidden=!0,D(),o()},Z("result")}function Bt(t="Gioca ancora"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function te(){let t=h(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let ct=[];function ft(t){M=t,t||p==null||p.suspend().catch(()=>{});for(let e of ct)e(t)}x(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&ft(t.data.active===!0)}),x(document,"visibilitychange",()=>{ft(!document.hidden)}),x(window,"pagehide",()=>{A=!0,at.splice(0).forEach(t=>t()),st.splice(0).forEach(t=>t()),p==null||p.close().catch(()=>{})});let dt={};function ut(t,e){return dt[t]??e}async function qt(t=()=>{}){let e=new AbortController,n=setTimeout(()=>e.abort(),1600);try{let o=await fetch("./game.config.json",{signal:e.signal});if(!o.ok)throw Error("Configurazione non disponibile");let a=await o.json();for(let i of["texts","tweaks","images"])for(let s of a[i]||[])dt[s.id]=i==="images"?s.path:s.value;for(let i of lt){let s=Q(i.path);i.im.getAttribute("src")!==s&&(i.im.src=s)}for(let i of f.querySelectorAll('img[src^="./assets/"]'))i.src=Q(i.getAttribute("src"));t(),f.dataset.config="loaded"}catch{f.dataset.config="defaults"}finally{clearTimeout(n)}}let y=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],pt=()=>{};function Ft(){var e,n;function t(o,a){y=o.slice(0,24).map(i=>({nickname:String(i.nickname||"Amico"),avatar:i.avatar,image:null}));for(let i of y){let s;try{s=a?window.tt.createImage():new Image,s.onload=()=>{i.image=s,pt()},s.onerror=()=>{i.image=null},s.src=i.avatar}catch{i.image=null}}pt()}t(y,!1),f.dataset.friends="sample",!(!((e=window.tt)!=null&&e.getFriendsInfo)||!((n=window.tt)!=null&&n.createImage))&&window.tt.getFriendsInfo({success(o){let a=Array.isArray(o==null?void 0:o.friends)?o.friends.filter(i=>i&&typeof i.avatar=="string"):[];a.length&&(t(a,!0),f.dataset.friends="host")},fail(){f.dataset.friends="sample"}})}function Ot(t,e,n,o,a,i="#fff"){let s=y[(e%y.length+y.length)%y.length];t.save(),t.shadowColor="#25212d20",t.shadowBlur=6,C(t,n,o,a,i),t.shadowBlur=0,s!=null&&s.image?Rt(t,s.image,n,o,Math.max(1,a-2)):(C(t,n,o,Math.max(1,a-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][e%4]),rt(t,Array.from((s==null?void 0:s.nickname)||"?")[0],n,o,a*.7,"#fff")),t.restore()}function $t(t){var e;return((e=y[(t%y.length+y.length)%y.length])==null?void 0:e.nickname)||"Amico"}function ee(t,e,n,o,a=13){rt(t,Array.from($t(e)).slice(0,15).join(""),n,o,a)}Ft(),Ct(".shot-power{position:absolute;top:0;left:0;width:30px;height:96px;display:grid;place-items:center;z-index:7;pointer-events:none}.power-track{position:relative;width:9px;height:56px;border:1px solid #e0d4b550;border-radius:5px;background:#d9ceb025;overflow:hidden}.power-fill{position:absolute;inset:0;background:linear-gradient(to top,#62d879 0%,#e6dc59 46%,#f5a340 72%,#f15b4f 100%);clip-path:inset(100% 0 0)}.shot-power.at-max .power-track{border-color:#f8ac9a}.fit{background:#252b26;color:#e0d4b5}.hud{font-size:18px;top:34px;font-family:Georgia,serif}.guide{top:75px;font-size:14px;color:#d2c8ac;font-weight:500}.result{background:#eee4c9;color:#363729;border:5px solid #63513a;border-radius:8px}.pill{background:#355d4d}.bottom{bottom:18px}.reset{background:transparent;color:#cdbd9b;border:1px solid #b8a47a55;border-radius:50%;width:35px;min-height:35px;font-size:21px}",`<canvas class="stage" aria-label="Tavolo da biliardo con gli amici"></canvas><div class="hud"><span class="pocketed">0 / 6</span><span class="shots">0 / 10</span></div><div class="shot-power" role="meter" aria-label="Potenza del tiro" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><div class="power-track"><div class="power-fill"></div></div></div><div class="guide">Trascina indietro e rilascia</div><div class="bottom"><button class="reset" aria-label="Ricomincia la partita">\u21BB</button></div>${Bt()}`,"#252b26");let{canvas:k,ctx:l}=St(),u=[],P=0,S=0,b="ready",m=null,v=!1,tt=0,q=[],T=null,F=null,j=!1,G=8,ht=70,mt=104,gt=806,Lt=1050,yt=26.2,Dt=yt*Math.sqrt(3)/2,xt=t=>B((t-G)/(ht-G),0,1),Nt=t=>mt+(gt-mt)*t+(Lt-gt)*t**3,z=h(".shot-power"),bt=h(".power-fill");function jt(t){let o=[];for(let a of[37,-37,57,-57,77,-77])for(let i of[0,-30,30]){let s=B(t.x+a-15,52,308),r=B(t.y-96/2+i,132,404),c=Math.abs(a)*.03+Math.abs(i)*.05;for(let d of u){let g=B(d.x,s,s+30),R=B(d.y,r,r+96),U=Math.hypot(d.x-g,d.y-R)-d.r-5;U<0&&(c+=(d.cue?1e4:100)+U*U)}o.push({x:s,y:r,score:c})}return o.reduce((a,i)=>i.score<a.score?i:a)}function _(){let t=E(),e=!!t&&M&&!v&&b!=="result";z.hidden=!e;let n=e&&m?xt(Math.hypot(t.x-m.x,t.y-m.y)):0,o="inset("+((1-n)*100).toFixed(1)+"% 0 0)",a=String(Math.round(n*100));if(bt.style.clipPath!==o&&(bt.style.clipPath=o),z.getAttribute("aria-valuenow")!==a&&z.setAttribute("aria-valuenow",a),z.classList.toggle("at-max",n>=.999),e){let i=jt(t),s=`translate(${i.x.toFixed(1)}px,${i.y.toFixed(1)}px)`;z.style.transform!==s&&(z.style.transform=s)}}function w(){let t=T;m=null,T=null,F=null,j=!1,_();try{t!==null&&k.hasPointerCapture(t)&&k.releasePointerCapture(t)}catch{}}let vt=18,Gt=14,Ht=29,Kt=20,Vt=t=>t.cue?Kt:Ht,wt=[[47,126],[343,126],[47,315],[343,315],[47,504],[343,504]],H=document.createElement("canvas");H.width=300,H.height=380;let K=H.getContext("2d");K.fillStyle="#1e5144",K.fillRect(0,0,300,380);for(let t=0;t<18e3;t++)K.fillStyle=Math.random()<.5?"#37655128":"#112b2325",K.fillRect(ot(0,300),ot(0,380),1,1);function et(){u=[{x:195,y:420,vx:0,vy:0,cue:!0,r:13}];let t=0;for(let e=0;e<3;e++)for(let n=0;n<=e;n++)u.push({x:195+(n-e/2)*yt,y:266-e*Dt,vx:0,vy:0,r:13,type:t++});P=0,S=0,b="ready",v=!1,w(),q=[],h(".pocketed").textContent="0 / 6",h(".shots").textContent="0 / 10",Z("ready")}function Mt(t){b="result",w(),_(),t?At():It(),Ut(t?"Tavolo completato":"Bei tiri!",S+" / 6",`${P} tiri \xB7 ${S===6?"Tutti gli amici sono in buca.":"Un\u2019altra partita?"}`,et)}function E(){return u.find(t=>t.cue)}function Yt(){return u.some(t=>Math.hypot(t.vx,t.vy)>4)}function nt(t){if(!Number.isFinite(t.clientX)||!Number.isFinite(t.clientY))return null;let e=zt(t);return Number.isFinite(e.x)&&Number.isFinite(e.y)?e:null}function Xt(t){if(t.pointerId!==T||!m)return;if(!M||A||document.hidden||v||b==="result"){w();return}if(t.pointerType==="mouse"&&t.buttons===0){V(t,!0);return}let e=nt(t);if(!e)return;m=e;let n=E();n&&F&&Math.hypot(e.x-F.x,e.y-F.y)>=3&&Math.hypot(n.x-e.x,n.y-e.y)>=G&&(j=!0),t.preventDefault(),_()}function V(t,e=!1){if(t.pointerId!==T||!m)return;if(!M||A||document.hidden||v||b==="result"){w();return}let n=E(),o=e?m:nt(t)||m,a=j;if(!n){w();return}let i=n.x-o.x,s=n.y-o.y,r=Math.hypot(i,s);if(w(),r<G||e&&!a)return;t.preventDefault(),D();let c=Nt(xt(r));n.vx=i/r*c,n.vy=s/r*c,P++,h(".shots").textContent=P+" / 10",v=!0,tt=0,b="playing",Z("playing"),_(),I(170,.06,.19,"triangle",80),f.dataset.shots=P}x(k,"pointerdown",t=>{if(!M||A||document.hidden||v||b==="result"||T!==null||t.button!==0)return;let e=nt(t),n=E();if(!(!e||!n||Math.hypot(e.x-n.x,e.y-n.y)>65)){m=e,F=e,j=!1,T=t.pointerId;try{k.setPointerCapture(t.pointerId)}catch{}t.preventDefault(),D(),_()}}),x(window,"pointermove",Xt,{capture:!0,passive:!1}),x(window,"pointerup",t=>V(t),{capture:!0,passive:!1}),x(window,"pointercancel",t=>V(t,!0),{capture:!0,passive:!1}),x(k,"lostpointercapture",t=>{if(!(t.pointerId!==T||!m)){if(!M||A||document.hidden||v||b==="result"){w();return}try{if(k.setPointerCapture(t.pointerId),k.hasPointerCapture(t.pointerId))return}catch{}V(t,!0)}}),ct.push(t=>{t||w()}),st.push(w),x(h(".reset"),"click",()=>{D(),et()}),et();let Y=0;Pt(t=>{if(Y=Math.max(0,Y-t),v&&b!=="result"){tt+=t;let o=u.reduce((i,s)=>Math.max(i,Math.hypot(s.vx,s.vy)),0),a=Math.max(4,Math.ceil(o*t/4));for(let i=0;i<a;i++){let s=t/a;for(let r of[...u]){r.x+=r.vx*s,r.y+=r.vy*s;let c=Math.exp(-1.05*s);r.vx*=c,r.vy*=c;let d=wt.find(([g,R])=>Math.hypot(r.x-g,r.y-R)<Vt(r));if(d){q.push({x:d[0],y:d[1],life:.35}),u=u.filter(g=>g!==r),r.cue||(S++,h(".pocketed").textContent=S+" / 6",I(220,.1,.13,"sine",90));continue}r.x<60&&(r.x=60,r.vx=Math.abs(r.vx)*.85),r.x>330&&(r.x=330,r.vx=-Math.abs(r.vx)*.85),r.y<138&&(r.y=138,r.vy=Math.abs(r.vy)*.85),r.y>492&&(r.y=492,r.vy=-Math.abs(r.vy)*.85)}for(let r=0;r<u.length;r++)for(let c=r+1;c<u.length;c++){let d=u[r],g=u[c],R=g.x-d.x,U=g.y-d.y,O=Math.hypot(R,U);if(O>=26||O<.001)continue;let $=R/O,L=U/O,X=(26-O)/2+.01;d.x-=$*X,d.y-=L*X,g.x+=$*X,g.y+=L*X;let it=(g.vx-d.vx)*$+(g.vy-d.vy)*L;if(it<0){let W=-it*.96;d.vx-=W*$,d.vy-=W*L,g.vx+=W*$,g.vy+=W*L,Y===0&&Math.abs(it)>35&&(I(1100,.025,.08,"triangle"),Y=.05)}}}if(tt>.3&&!Yt()){v=!1;for(let i of u)i.vx=0,i.vy=0;if(S===6)Mt(!0);else if(P>=10)Mt(!1);else if(!E()){let i={x:195,y:420,vx:0,vy:0,r:13,cue:!0};for(;u.some(s=>Math.hypot(s.x-i.x,s.y-i.y)<30)&&i.y<480;)i.y+=15;u.push(i)}}}_(),l.fillStyle="#252b26",l.fillRect(0,0,390,598),l.shadowColor="#0009",l.shadowBlur=16,l.shadowOffsetY=7,J(l,23,104,344,422,17,"#4c3827","#8f7952"),l.shadowBlur=0,l.shadowOffsetY=0;let e=l.createLinearGradient(25,0,365,0);e.addColorStop(0,"#8a6842"),e.addColorStop(.3,"#4d3929"),e.addColorStop(.7,"#59422b"),e.addColorStop(1,"#9c8056"),J(l,28,109,334,412,14,e),J(l,40,119,310,390,9,"#315a49"),l.drawImage(H,48,127,294,378),N(l,195,137,195,497,"#aac0a609",1);for(let o of[170,222,274,356,408,460])for(let a of[32,357])l.save(),l.translate(a,o),l.rotate(Math.PI/4),l.fillStyle="#c9bd9a",l.fillRect(-2,-2,4,4),l.restore();for(let[o,a]of wt)C(l,o,a,vt,"#171a15","#5a5139"),C(l,o,a,Gt,"#0b1210");for(let o of u)l.save(),l.shadowColor="#06130c88",l.shadowBlur=5,l.shadowOffsetY=3,o.cue?C(l,o.x,o.y,13,"#e9e8da","#e1e1d2"):Ot(l,o.type,o.x,o.y,13,"#e5e1d1"),l.restore(),C(l,o.x-3,o.y-4,3,"#ffffff44");let n=E();if(m&&n){let o=n.x-m.x,a=n.y-m.y,i=Math.max(1,Math.hypot(o,a)),s=o/i,r=a/i,c=Math.min(i,ht);l.save(),l.setLineDash([3,6]),N(l,n.x+s*18,n.y+r*18,n.x+s*150,n.y+r*150,"#e9e7c680",1),l.restore(),N(l,n.x-s*(18+c*.3),n.y-r*(18+c*.3),n.x-s*(130+c*.3),n.y-r*(130+c*.3),"#bfac74",4),N(l,n.x-s*(18+c*.3),n.y-r*(18+c*.3),n.x-s*(30+c*.3),n.y-r*(30+c*.3),"#e8e4d6",3)}for(let o of q)o.life-=t,l.globalAlpha=o.life/.35,C(l,o.x,o.y,vt+1-o.life*5,null,"#b9cda5"),l.globalAlpha=1;q=q.filter(o=>o.life>0)}),qt(()=>{h(".guide")&&(h(".guide").textContent=String(ut("GUIDE","Trascina indietro dalla battente e rilascia")))})})();(()=>{let f=document.createElement("style");f.dataset.batch3Ui="20261116",f.textContent=`
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

.hud{font:700 28px/1.2 Georgia,serif;top:30px}
.guide{top:150px;font:400 18px/1.4 UIBody,system-ui,sans-serif;color:#eee2c6}
.bottom{top:30px;bottom:auto;justify-content:center;pointer-events:none}
.bottom .reset{pointer-events:auto;width:44px;height:44px;min-height:44px;padding:0;font-size:24px;border-color:#d0bd8b99}
.result h2{font-family:Georgia,serif}
`,document.head.append(f)})();})();
