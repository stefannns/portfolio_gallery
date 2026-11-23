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

(()=>{document.documentElement.lang="it";(()=>{"use strict";let l=document.getElementById("root"),ut=(t,e,o)=>Math.max(e,Math.min(o,t)),ft=(t,e)=>t+Math.random()*(e-t),ht=t=>t[Math.floor(Math.random()*t.length)],gt=t=>t[t.length-1],W=t=>{for(let e=t.length-1;e>0;e--){let o=Math.floor(Math.random()*(e+1));[t[e],t[o]]=[t[o],t[e]]}return t},G=[],C=[],q=!0,w=!1,d;function c(t,e,o,n){t.addEventListener(e,o,n),G.push(()=>t.removeEventListener(e,o,n))}function tt(t,e,o="#faf8f1"){let n=document.createElement("style");n.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(n),l.style.background=o,l.innerHTML='<div class="fit">'+e+"</div>";let i=l.querySelector(".fit");function a(){let s=l.getBoundingClientRect(),p=Math.min(s.width/390,s.height/598);i.style.transform=`translate(${(s.width-390*p)/2}px,${(s.height-598*p)/2}px) scale(${p})`,l.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}a(),c(window,"resize",a)}function r(t){return l.querySelector(t)}function et(){var t;(t=r(".guide"))==null||t.classList.add("gone")}function M(t){l.dataset.phase=t}function B(){_(),et()}function _(){try{d||(d=new(window.AudioContext||window.webkitAudioContext)),d.state==="suspended"&&d.resume().catch(()=>{})}catch{}}function S(t=450,e=.08,o=.18,n="sine",i=0){if(!(!d||!q))try{let a=d.createOscillator(),s=d.createGain(),p=d.currentTime;a.type=n,a.frequency.setValueAtTime(t,p),i&&a.frequency.exponentialRampToValueAtTime(Math.max(30,i),p+e),s.gain.setValueAtTime(.001,p),s.gain.exponentialRampToValueAtTime(o,p+.006),s.gain.exponentialRampToValueAtTime(.001,p+e),a.connect(s),s.connect(d.destination),a.start(p),a.stop(p+e+.02),a.onended=()=>{a.disconnect(),s.disconnect()}}catch{}}function ot(){S(523,.12,.18),setTimeout(()=>S(784,.17,.16),100)}function mt(){S(180,.22,.18,"triangle",65)}function it(t){let e=0;function o(n){if(w)return;let i=Math.min(.035,(n-(e||n))/1e3);e=n,document.hidden||t(q?i:0,n/1e3),requestAnimationFrame(o)}requestAnimationFrame(o)}function bt(){let t=r("canvas.stage"),e=t.getContext("2d"),o=Math.min(2,window.devicePixelRatio||1);return t.width=390*o,t.height=598*o,e.scale(o,o),{canvas:t,ctx:e}}function xt(t,e=r("canvas.stage")){let o=e.getBoundingClientRect();return{x:(t.clientX-o.left)*390/o.width,y:(t.clientY-o.top)*598/o.height}}function nt(t,e,o,n,i,a){a=Math.min(Math.abs(n)/2,Math.abs(i)/2,a),t.moveTo(e+a,o),t.lineTo(e+n-a,o),t.quadraticCurveTo(e+n,o,e+n,o+a),t.lineTo(e+n,o+i-a),t.quadraticCurveTo(e+n,o+i,e+n-a,o+i),t.lineTo(e+a,o+i),t.quadraticCurveTo(e,o+i,e,o+i-a),t.lineTo(e,o+a),t.quadraticCurveTo(e,o,e+a,o),t.closePath()}function yt(t,e,o,n,i,a,s,p){t.beginPath(),nt(t,e,o,n,i,a),s&&(t.fillStyle=s,t.fill()),p&&(t.strokeStyle=p,t.stroke())}function vt(t,e,o,n,i,a){t.beginPath(),t.arc(e,o,Math.max(.01,n),0,Math.PI*2),i&&(t.fillStyle=i,t.fill()),a&&(t.strokeStyle=a,t.stroke())}function wt(t,e,o,n,i,a,s=2){t.beginPath(),t.moveTo(e,o),t.lineTo(n,i),t.strokeStyle=a,t.lineWidth=s,t.stroke()}function zt(t,e,o,n,i=18,a="#25252a",s="UIBody",p="center"){t.font=`700 ${i}px ${s}`,t.fillStyle=a,t.textAlign=p,t.textBaseline="middle",t.fillText(e,o,n)}let N=[];function L(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String($(e,t))}function at(t){let e=new Image;return e.onerror=()=>{l.dataset.assetIssue="image"},e.src=L(t),N.push({im:e,path:t}),e}function V(t,e,o,n,i,a){if(!e)return!1;let s=e.videoWidth||e.naturalWidth||e.width,p=e.videoHeight||e.naturalHeight||e.height;if(!s||!p)return!1;let E=Math.max(i/s,a/p);return t.save(),t.beginPath(),t.rect(o,n,i,a),t.clip(),t.drawImage(e,o+(i-s*E)/2,n+(a-p*E)/2,s*E,p*E),t.restore(),!0}function kt(t,e,o,n,i){t.save(),t.beginPath(),t.arc(o,n,i,0,Math.PI*2),t.clip(),V(t,e,o-i,n-i,i*2,i*2),t.restore()}function st(t,e,o,n){let i=r(".modal");if(!i)return;i.hidden=!1,i.querySelector("h2").textContent=t,i.querySelector(".value").textContent=e,i.querySelector("p").textContent=o;let a=i.querySelector("button");a.onclick=()=>{i.hidden=!0,B(),n()},M("result")}function rt(t="Rigioca"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function Pt(){let t=r(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let lt=[];function H(t){q=t,t||d==null||d.suspend().catch(()=>{});for(let e of lt)e(t)}c(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&H(t.data.active===!0)}),c(document,"visibilitychange",()=>{H(!document.hidden)}),c(window,"pagehide",()=>{w=!0,G.splice(0).forEach(t=>t()),C.splice(0).forEach(t=>t()),d==null||d.close().catch(()=>{})});let X={};function $(t,e){return X[t]??e}async function pt(t=()=>{}){let e=new AbortController,o=setTimeout(()=>e.abort(),1600);try{let n=await fetch("./game.config.json",{signal:e.signal});if(!n.ok)throw Error("Configurazione non disponibile");let i=await n.json();for(let a of["texts","tweaks","images"])for(let s of i[a]||[])X[s.id]=a==="images"?s.path:s.value;for(let a of N){let s=L(a.path);a.im.getAttribute("src")!==s&&(a.im.src=s)}for(let a of l.querySelectorAll('img[src^="./assets/"]'))a.src=L(a.getAttribute("src"));t(),l.dataset.config="loaded"}catch{l.dataset.config="defaults"}finally{clearTimeout(o)}}tt(".fit{background:#fff}.blob{position:absolute;width:230px;height:230px;border-radius:50%;background:#f9de83;right:-85px;top:-85px}.lavender{position:absolute;width:230px;height:220px;border-radius:50%;background:#e5ddf5;left:-100px;bottom:-100px}.guide{top:85px;font-family:Playful,Arial;font-size:18px}.capability{padding:10px 12px;font-size:14px}.puzzle{position:absolute;left:55px;top:146px;width:280px;height:280px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:4px;touch-action:none}.puzzle.is-loading{pointer-events:none}.puzzle-placeholder{grid-area:1/1/4/4;display:grid;place-items:center;text-align:center;padding:24px;background:#f3f0f7;border-radius:12px;font-size:15px;line-height:1.5;color:#655d70}.tile{padding:0;position:relative;overflow:hidden;border-radius:9px;box-shadow:0 2px 2px #25252a18;background:#f0ece1;min-height:0}.tile canvas{display:block;width:100%;height:100%;pointer-events:none}.tile.selected{outline:3px solid #6464c8;z-index:2}.tile.dragging{opacity:.6;transform:scale(.96)}.hud{font-size:28px;color:#514b5b;top:30px}.photo-status{top:432px;bottom:auto;font-size:12px;color:#655d70;line-height:1.4}.bottom{bottom:50px;display:grid;grid-template-columns:1fr 1fr;gap:8px}.result{background:#f3f0fb}.result button{background:#4c497b}",`<div class="hud"><span class="moves">0 mosse</span><span class="time">0s</span></div><div class="guide">Scambia i pezzi e ricomponi la foto</div><div class="puzzle" aria-label="Puzzle fotografico"></div><div class="status photo-status" role="status" aria-live="polite" hidden></div><input id="puzzle-photo-input" type="file" accept="image/*" hidden><div class="bottom"><button class="capability photo-upload" aria-controls="puzzle-photo-input">Carica foto</button><button class="capability shuffle" aria-label="Mescola i pezzi" disabled>\u21BB Mescola</button></div>${rt()}`,"#fff");let m=null,Y=!1,h=!1,k=0,u=W([...Array(9).keys()]),b=-1,z=0,P=0,j=!1,y=!1,f=null,I=r("#puzzle-photo-input"),A=r(".photo-upload"),J=r(".photo-status"),T=new Set,dt=!0,g=(t,e)=>dt?e:t;function x(t=""){J.textContent=t,J.hidden=!t}A.textContent=g("Carica foto","Carica foto"),r(".shuffle").textContent=g("\u21BB Mescola","\u21BB Mescola");function D(t){let e=t.naturalWidth||t.width,o=t.naturalHeight||t.height;if(!e||!o)throw Error("L\u2019immagine \xE8 vuota");let n=document.createElement("canvas");n.width=n.height=600;let i=n.getContext("2d");if(i.fillStyle="#fff",i.fillRect(0,0,600,600),!V(i,t,0,0,600,600))throw Error("Impossibile adattare l\u2019immagine");return n}function v(){let t=r(".puzzle");if(t.replaceChildren(),!m){let e=document.createElement("div");e.className="puzzle-placeholder",e.innerHTML='<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="7" width="34" height="30" rx="4"/><circle cx="15" cy="17" r="4"/><path d="m7 33 11-10 6 5 6-8 8 13"/></svg>',e.setAttribute("aria-label",g("Anteprima foto","Anteprima foto")),t.append(e);return}u.forEach((e,o)=>{let n=document.createElement("button");n.className="tile"+(o===b?" selected":""),n.dataset.slot=o,n.setAttribute("aria-label",`Pezzo del puzzle ${e+1}`);let i=document.createElement("canvas");i.width=i.height=200;let a=m.width/3;i.getContext("2d").drawImage(m,e%3*a,Math.floor(e/3)*a,a,a,0,0,200,200),n.append(i),t.append(n)}),l.dataset.moves=z,l.dataset.solved=String(y)}function R(t=m){t&&(m=t,u=W([...Array(9).keys()]),u.every((e,o)=>e===o)&&([u[0],u[1]]=[u[1],u[0]]),b=-1,z=0,P=0,j=!1,y=!1,f=null,r(".moves").textContent="0 mosse",r(".time").textContent="0s",v(),r(".shuffle").disabled=h,M("ready"))}function K(t,e){t===e||y||h||([u[t],u[e]]=[u[e],u[t]],z++,j=!0,B(),b=-1,r(".moves").textContent=`${z} mosse`,S(500,.05,.12),y=u.every((o,n)=>o===n),v(),M("playing"),y&&(ot(),st("Foto ricomposta!",Math.max(100,1e3-z*12-Math.round(P)*2),`${z} mosse \xB7 ${Math.ceil(P)} secondi`,R)))}c(r(".puzzle"),"pointerdown",t=>{let e=t.target.closest(".tile");!e||y||h||(f={x:t.clientX,y:t.clientY,slot:Number(e.dataset.slot)},e.setPointerCapture(t.pointerId))}),c(r(".puzzle"),"pointermove",t=>{var e;f&&Math.hypot(t.clientX-f.x,t.clientY-f.y)>8&&((e=r(`.tile[data-slot="${f.slot}"]`))==null||e.classList.add("dragging"))}),c(r(".puzzle"),"pointerup",t=>{if(!f)return;let e=f;f=null;let o=r(".puzzle").getBoundingClientRect(),n=Math.floor((t.clientX-o.left)/(o.width/3)),i=Math.floor((t.clientY-o.top)/(o.height/3)),a=n+i*3;Math.hypot(t.clientX-e.x,t.clientY-e.y)>8?n>=0&&n<3&&i>=0&&i<3?K(e.slot,a):v():b>=0&&b!==e.slot?K(b,e.slot):(b=e.slot,v())});for(let t of["pointercancel","lostpointercapture"])c(r(".puzzle"),t,()=>{f&&(f=null,v())});async function ct(t){if(!t)return;if(!(t.type.startsWith("image/")||!t.type&&/\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i.test(t.name))||!t.size){x(g("Scegli un file immagine. Il puzzle attuale non cambia.","Scegli un file immagine. Il puzzle attuale non cambia."));return}if(t.size>30*1024*1024){x(g("La foto \xE8 troppo grande. Scegli un\u2019immagine pi\xF9 piccola.","La foto \xE8 troppo grande. Scegli un\u2019immagine pi\xF9 piccola."));return}let o=++k;h=!0,f=null,b=-1,A.disabled=!0,r(".shuffle").disabled=!0,r(".puzzle").classList.add("is-loading"),x(g("Apertura della foto\u2026","Apertura della foto\u2026"));let n=URL.createObjectURL(t);T.add(n);try{let i=new Image;if(i.decoding="async",await new Promise((s,p)=>{i.onload=s,i.onerror=()=>p(Error("Impossibile leggere l\u2019immagine")),i.src=n}),w||o!==k)return;let a=D(i);Y=!0,h=!1,r(".modal").hidden=!0,R(a),l.dataset.photoSource="uploaded",x()}catch{!w&&o===k&&x(g("Impossibile aprire la foto. Prova un file JPG, PNG o WebP.","Impossibile aprire la foto. Prova un file JPG, PNG o WebP."))}finally{URL.revokeObjectURL(n),T.delete(n),!w&&o===k&&(h=!1,A.disabled=!1,r(".shuffle").disabled=!m,r(".puzzle").classList.remove("is-loading"),v())}}c(A,"click",()=>{_(),I.click()}),c(I,"change",()=>{var e;let t=(e=I.files)==null?void 0:e[0];I.value="",t&&ct(t)}),c(r(".shuffle"),"click",()=>{!m||h||(B(),R())}),C.push(()=>{k++;for(let t of T)URL.revokeObjectURL(t);T.clear()});let F=at("./assets/sample-photo.webp");c(F,"load",()=>{if(!(w||Y||h))try{R(D(F)),l.dataset.photoSource="default",x()}catch{x(g("Foto non disponibile","Foto non disponibile"))}}),c(F,"error",()=>{m||x(g("Foto non disponibile","Foto non disponibile"))}),v(),M("loading"),it(t=>{j&&!y&&!h&&(P+=t,r(".time").textContent=Math.floor(P)+"s")});function O(){let t=l.getBoundingClientRect(),e=Math.min(t.width/390,t.height/598);l.style.position="relative",l.style.backgroundColor="#f4d467",l.style.backgroundImage="url("+JSON.stringify(String($("PAPER_BACKDROP","./assets/paper-print-v1.svg")))+")",l.style.backgroundSize=256*e+"px "+256*e+"px",l.style.backgroundRepeat="repeat",l.style.setProperty("--paper-scale",String(e)),l.dataset.backgroundTheme="graphic-paper"}let Z=document.createElement("style");Z.textContent="html,body{background:#f4d467}#root>.fit{background:transparent!important}#root .hud,#root .guide{color:#282723}.photo-status{color:#4b442c!important}.tile{border:1.5px solid #282723;border-radius:6px;box-shadow:none}.tile.selected{outline:3px solid #282723;outline-offset:1px}.bottom .capability{border:2px solid #282723;border-radius:6px;background:#fffbea;color:#282723;box-shadow:0 3px 0 #28272326}.bottom .capability:active{box-shadow:none}.puzzle-placeholder{background:#fffbea;color:#282723;border:2px solid #282723}#root>.modal{position:absolute;inset:0;padding:0;z-index:30;background:#28272355;display:grid;place-items:center}#root>.modal>.result{width:320px;max-width:none;max-height:calc((100vh - 80px*var(--paper-scale))/var(--paper-scale));transform:scale(var(--paper-scale));transform-origin:center;border:2px solid #282723;border-radius:10px;background:#fffbea;color:#282723;box-shadow:3px 5px 0 #28272326}#root>.modal .result button{border:2px solid #282723;border-radius:6px;background:#f4d467;color:#282723;box-shadow:0 3px 0 #28272326}",document.head.append(Z);let U=r(".modal");if(U){l.append(U);let t=()=>{r(".fit").inert=!U.hidden},e=new MutationObserver(t);e.observe(U,{attributes:!0,attributeFilter:["hidden"]}),t(),C.push(()=>e.disconnect())}let Q=new ResizeObserver(O);Q.observe(l),C.push(()=>Q.disconnect()),O(),pt(()=>{O(),r(".guide")&&(r(".guide").textContent=String($("GUIDE","Scambia i pezzi e ricomponi la foto")))})})();(()=>{let l=document.createElement("style");l.dataset.batch3Ui="20261116",l.textContent=`
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
