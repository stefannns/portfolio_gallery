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

(()=>{(()=>{"use strict";let c=document.getElementById("root"),dt=(t,e,o)=>Math.max(e,Math.min(o,t)),G=(t,e)=>t+Math.random()*(e-t),Rt=t=>t[Math.floor(Math.random()*t.length)],Ut=t=>t[t.length-1],jt=t=>{for(let e=t.length-1;e>0;e--){let o=Math.floor(Math.random()*(e+1));[t[e],t[o]]=[t[o],t[e]]}return t},et=[],O=[],z=!0,S=!1,p;function h(t,e,o,a){t.addEventListener(e,o,a),et.push(()=>t.removeEventListener(e,o,a))}function ut(t,e,o="#faf8f1"){let a=document.createElement("style");a.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(a),c.style.background=o,c.innerHTML='<div class="fit">'+e+"</div>";let n=c.querySelector(".fit");function i(){let s=c.getBoundingClientRect(),r=Math.min(s.width/390,s.height/598);n.style.transform=`translate(${(s.width-390*r)/2}px,${(s.height-598*r)/2}px) scale(${r})`,c.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}i(),h(window,"resize",i)}function u(t){return c.querySelector(t)}function ft(){var t;(t=u(".guide"))==null||t.classList.add("gone")}function U(t){c.dataset.phase=t}function H(){W(),ft()}function W(){try{p||(p=new(window.AudioContext||window.webkitAudioContext)),p.state==="suspended"&&p.resume().catch(()=>{})}catch{}}function _(t=450,e=.08,o=.18,a="sine",n=0){if(!(!p||!z))try{let i=p.createOscillator(),s=p.createGain(),r=p.currentTime;i.type=a,i.frequency.setValueAtTime(t,r),n&&i.frequency.exponentialRampToValueAtTime(Math.max(30,n),r+e),s.gain.setValueAtTime(.001,r),s.gain.exponentialRampToValueAtTime(o,r+.006),s.gain.exponentialRampToValueAtTime(.001,r+e),i.connect(s),s.connect(p.destination),i.start(r),i.stop(r+e+.02),i.onended=()=>{i.disconnect(),s.disconnect()}}catch{}}function Lt(){_(523,.12,.18),setTimeout(()=>_(784,.17,.16),100)}function pt(){_(180,.22,.18,"triangle",65)}function ht(t){let e=0;function o(a){if(S)return;let n=Math.min(.035,(a-(e||a))/1e3);e=a,document.hidden||t(z?n:0,a/1e3),requestAnimationFrame(o)}requestAnimationFrame(o)}function $t(){let t=u("canvas.stage"),e=t.getContext("2d"),o=Math.min(2,window.devicePixelRatio||1);return t.width=390*o,t.height=598*o,e.scale(o,o),{canvas:t,ctx:e}}function Dt(t,e=u("canvas.stage")){let o=e.getBoundingClientRect();return{x:(t.clientX-o.left)*390/o.width,y:(t.clientY-o.top)*598/o.height}}function gt(t,e,o,a,n,i){i=Math.min(Math.abs(a)/2,Math.abs(n)/2,i),t.moveTo(e+i,o),t.lineTo(e+a-i,o),t.quadraticCurveTo(e+a,o,e+a,o+i),t.lineTo(e+a,o+n-i),t.quadraticCurveTo(e+a,o+n,e+a-i,o+n),t.lineTo(e+i,o+n),t.quadraticCurveTo(e,o+n,e,o+n-i),t.lineTo(e,o+i),t.quadraticCurveTo(e,o,e+i,o),t.closePath()}function T(t,e,o,a,n,i,s,r){t.beginPath(),gt(t,e,o,a,n,i),s&&(t.fillStyle=s,t.fill()),r&&(t.strokeStyle=r,t.stroke())}function Vt(t,e,o,a,n,i){t.beginPath(),t.arc(e,o,Math.max(.01,a),0,Math.PI*2),n&&(t.fillStyle=n,t.fill()),i&&(t.strokeStyle=i,t.stroke())}function mt(t,e,o,a,n,i,s=2){t.beginPath(),t.moveTo(e,o),t.lineTo(a,n),t.strokeStyle=i,t.lineWidth=s,t.stroke()}function bt(t,e,o,a,n=18,i="#25252a",s="UIBody",r="center"){t.font=`700 ${n}px ${s}`,t.fillStyle=i,t.textAlign=r,t.textBaseline="middle",t.fillText(e,o,a)}let nt=[];function N(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(at(e,t))}function K(t){let e=new Image;return e.onerror=()=>{c.dataset.assetIssue="image"},e.src=N(t),nt.push({im:e,path:t}),e}function yt(t,e,o,a,n,i){if(!e||!e.width)return;let s=e.videoWidth||e.width,r=e.videoHeight||e.height;if(!s||!r)return;let b=Math.max(n/s,i/r);t.save(),t.beginPath(),t.rect(o,a,n,i),t.clip(),t.drawImage(e,o+(n-s*b)/2,a+(i-r*b)/2,s*b,r*b),t.restore()}function Ot(t,e,o,a,n){t.save(),t.beginPath(),t.arc(o,a,n,0,Math.PI*2),t.clip(),yt(t,e,o-n,a-n,n*2,n*2),t.restore()}function vt(t,e,o,a){let n=u(".modal");if(!n)return;n.hidden=!1,n.querySelector("h2").textContent=t,n.querySelector(".value").textContent=e,n.querySelector("p").textContent=o;let i=n.querySelector("button");i.onclick=()=>{n.hidden=!0,H(),a()},U("result")}function xt(t="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function Ht(){let t=u(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let X=[];function ot(t){z=t,t||p==null||p.suspend().catch(()=>{});for(let e of X)e(t)}h(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&ot(t.data.active===!0)}),h(document,"visibilitychange",()=>{ot(!document.hidden)}),h(window,"pagehide",()=>{S=!0,et.splice(0).forEach(t=>t()),O.splice(0).forEach(t=>t()),p==null||p.close().catch(()=>{})});let it={};function at(t,e){return it[t]??e}async function wt(t=()=>{}){let e=new AbortController,o=setTimeout(()=>e.abort(),1600);try{let a=await fetch("./game.config.json",{signal:e.signal});if(!a.ok)throw Error("Config unavailable");let n=await a.json();for(let i of["texts","tweaks","images"])for(let s of n[i]||[])it[s.id]=i==="images"?s.path:s.value;for(let i of nt){let s=N(i.path);i.im.getAttribute("src")!==s&&(i.im.src=s)}for(let i of c.querySelectorAll('img[src^="./assets/"]'))i.src=N(i.getAttribute("src"));t(),c.dataset.config="loaded"}catch{c.dataset.config="defaults"}finally{clearTimeout(o)}}let l=null,f=null,x=null,j=null,L=!1,q=!1,y="",st=()=>{};function M(){l==null||l.getTracks().forEach(t=>t.stop()),l=null,f==null||f.close().catch(()=>{}),f=x=j=null,L=!1}async function rt(){var t;if(!L){L=!0;try{if(!((t=navigator.mediaDevices)!=null&&t.getUserMedia))throw Error("No microphone");if(l=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!0,noiseSuppression:!0,autoGainControl:!1}}),S||!z||y==="hold"){M();return}f=new(window.AudioContext||window.webkitAudioContext),await f.resume();let e=f.createMediaStreamSource(l);x=f.createAnalyser(),x.fftSize=1024,e.connect(x),j=new Float32Array(x.fftSize),u(".mic-enable").textContent="Mic on",u(".mic-status").textContent="Listening \xB7 Space or hold also works",c.dataset.microphone="enabled"}catch{L=!1,u(".mic-enable").textContent="Enable microphone",u(".mic-status").textContent="Mic unavailable \xB7 hold the button to play",c.dataset.microphone="unavailable"}}}function kt(){if(q)return .9;if(!x||!z)return 0;x.getFloatTimeDomainData(j);let t=0;for(let e of j)t+=e*e;return dt((Math.sqrt(t/j.length)-.012)*14,0,1)}function Mt(){h(u(".mic-enable"),"click",()=>{W(),rt()});let t=u(".voice-hold");h(t,"pointerdown",e=>{e.preventDefault(),H(),Y("hold"),q=!0,t.setPointerCapture(e.pointerId)});for(let e of["pointerup","pointercancel","lostpointercapture"])h(t,e,()=>q=!1);h(window,"keydown",e=>{e.code==="Space"&&!e.repeat&&(e.preventDefault(),H(),Y("hold"),q=!0)}),h(window,"keyup",e=>{e.code==="Space"&&(q=!1)}),X.push(e=>{if(e){if(f==null||f.resume().catch(()=>{}),l)for(let o of l.getTracks())o.enabled=!0}else if(q=!1,f==null||f.suspend().catch(()=>{}),l)for(let o of l.getTracks())o.enabled=!1}),O.push(M),zt()}function Ct(t="Hold to try"){return`<div class="status mic-status">Use your voice \xB7 or hold to try</div><div class="bottom"><button class="capability mic-enable">Enable microphone</button><button class="capability voice-hold">${t}</button></div>`}function Y(t){y=t,t==="hold"&&(l||L)&&M(),st()}function zt(){let t=u(".mic-enable"),e=u(".voice-hold"),o=t.parentElement,a=u(".mic-status"),n=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it"),i=document.createElement("style");i.textContent="#root .bottom.voice-mode-selected{display:flex!important;justify-content:center!important;align-items:center!important}#root .bottom.voice-mode-selected>.capability{flex:0 1 auto!important;width:auto!important;min-width:150px;max-width:260px}#root .bottom>.capability[hidden]{display:none!important}",document.head.append(i);function s(){S||(t.hidden=y==="hold",e.hidden=y==="voice",o.classList.toggle("voice-mode-selected",!!y),c.dataset.voiceControl=y||"choice",y==="hold"&&(a.textContent=n?"Tieni premuto \xB7 o premi Spazio":"Hold the button \xB7 or press Space"))}st=s,h(t,"click",()=>Y("voice"),{capture:!0});let r=new MutationObserver(()=>{let b=c.dataset.microphone;y==="voice"&&["unavailable","error","off"].includes(b)&&(y=""),y==="hold"&&l&&M(),s()});r.observe(c,{attributes:!0,attributeFilter:["data-microphone"]}),O.push(()=>r.disconnect()),s()}function St(){let t=u(".mic-enable"),e=u(".mic-status"),n=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it")?{idle:"Attiva microfono",requesting:"Connessione\u2026",active:"Microfono attivo",paused:"Microfono in pausa",start:"Attiva microfono",stop:"Disattiva microfono",listening:"In ascolto \xB7 tocca per disattivare",fallback:"Usa la voce o tieni premuto",unavailable:"Non disponibile \xB7 usa il pulsante"}:{idle:"Start microphone",requesting:"Connecting\u2026",active:"Mic on",paused:"Mic paused",start:"Start microphone",stop:"Stop microphone",listening:"Listening \xB7 tap to turn off",fallback:"Use your voice \xB7 or hold to try",unavailable:"Mic unavailable \xB7 hold the button to play"},i=document.createElement("style");i.textContent=".bottom .capability.mic-enable{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;flex:1 1 174px}.mic-enable .mic-icon{width:18px;height:18px;flex:none}.mic-enable .mic-record-dot{width:10px;height:10px;flex:none;background:currentColor;border-radius:50%}.bottom .capability.mic-enable.is-listening{background:#d94646;border-color:#d94646;color:#fff;box-shadow:0 2px 8px #bd333326}.mic-enable .mic-button-label{white-space:nowrap}",document.head.append(i);let s=!1,r=!1,b="",B=null,V=null;function F(){var R;let m=((R=l==null?void 0:l.getAudioTracks)==null?void 0:R.call(l))||[];return z&&!!x&&(f==null?void 0:f.state)==="running"&&m.some(k=>k.readyState==="live"&&k.enabled&&!k.muted)}function v(){var ct;if(S)return;let m=F(),R=!!((ct=l==null?void 0:l.getAudioTracks)!=null&&ct.call(l).some(tt=>tt.readyState==="live")),k=s?"requesting":m?"active":R?"paused":r?"unavailable":"idle";if(t.disabled=s,t.setAttribute("aria-pressed",String(m)),t.classList.toggle("is-listening",m),t.setAttribute("aria-label",R?n.stop:n.start),t.dataset.micState=k,c.dataset.microphone=m?"enabled":k==="idle"?"off":k,k!==b){let tt=m?'<span class="mic-record-dot" aria-hidden="true"></span>':'<svg class="mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>',Et=s?n.requesting:m?n.active:R?n.paused:n.idle;t.innerHTML=tt+'<span class="mic-button-label">'+Et+"</span>",e.textContent=m?n.listening:r?n.unavailable:n.fallback,b=k}}function Q(){if(l&&B!==l){B=l;for(let m of l.getAudioTracks())h(m,"ended",()=>{M(),r=!1,v()}),h(m,"mute",v),h(m,"unmute",v)}f&&V!==f&&(V=f,h(f,"statechange",v))}h(t,"click",async m=>{if(m.preventDefault(),m.stopImmediatePropagation(),!(s||S)){if(l){M(),r=!1,v();return}if(W(),r=!1,s=!0,v(),await rt(),s=!1,S||!z){M(),v();return}(!l||!f||!x)&&(M(),r=!0),Q(),b="",v()}},{capture:!0}),X.push(()=>{Promise.resolve().then(()=>{Q(),v()})}),Q(),v()}function Tt(){let t=u("canvas.stage"),e=t.getContext("2d"),o=u(".fit"),a={left:0,top:0,right:390,bottom:598};c.style.position="relative",c.style.isolation="isolate",c.prepend(t),o.style.background="transparent",o.style.zIndex="1",Object.assign(t.style,{position:"absolute",inset:"0",width:"100%",height:"100%",zIndex:"0",pointerEvents:"none"});function n(){let i=c.getBoundingClientRect();if(!i.width||!i.height)return;let s=Math.min(2,window.devicePixelRatio||1),r=Math.min(i.width/390,i.height/598),b=(i.width-390*r)/2,B=(i.height-598*r)/2,V=Math.round(i.width*s),F=Math.round(i.height*s);(t.width!==V||t.height!==F)&&(t.width=V,t.height=F),e.setTransform(s*r,0,0,s*r,s*b,s*B),Object.assign(a,{left:-b/r,top:-B/r,right:(i.width-b)/r,bottom:(i.height-B)/r}),o.style.transform=`translate(${b}px,${B}px) scale(${r})`}if(n(),h(window,"resize",n),typeof ResizeObserver<"u"){let i=new ResizeObserver(n);i.observe(c),O.push(()=>i.disconnect())}return{canvas:t,ctx:e,bounds:a}}ut(".fit{background:#e9e2c8}.guide{top:106px;font:17px Playful,Arial;color:#565c3d}.hud{font-size:17px;color:#5e5a3d;font-family:Playful,Arial}.capability{border-color:#8f733c55;background:#fff6da}.mic-status{color:#72583f}.result{background:#fff3d5}.result h2{font-family:Playful,Arial}.pill{background:#847443}",`<canvas class="stage" aria-label="Karate timing challenge"></canvas><div class="hud center"><span class="round-label">1 board</span></div><div class="guide">Shout at the peak</div>${Ct("Hold to shout")}${xt()}`,"#e9e2c8");let{ctx:d,bounds:g}=Tt(),At=K("./assets/karate-ready.webp"),It=K("./assets/karate-chop.webp"),A=K("./assets/dojo-interior-v1.webp");function Pt(){if(d.fillStyle="#e9e2c8",d.fillRect(g.left,g.top,g.right-g.left,g.bottom-g.top),!A.width){d.fillStyle="#d0a367",d.fillRect(g.left,435,g.right-g.left,Math.max(0,g.bottom-435));return}let t=A.height*.755,e=Math.max((g.right-g.left)/A.width,(435-g.top)/t,(g.bottom-435)/(A.height-t)),o=A.width*e,a=A.height*e;d.drawImage(A,(g.left+g.right-o)/2,435-t*e,o,a)}let w=1,Z=0,I=0,J=0,P="ready",C=0,$=!0,D=0,E=[];function lt(){w=1,Z=0,I=0,J=0,P="ready",C=0,$=!0,E=[],D=0,u(".round-label").textContent="1 board",U("ready")}function Bt(){if(!p)return;let t=p.createBufferSource(),e=p.createGain(),o=p.createBuffer(1,p.sampleRate*.13,p.sampleRate),a=o.getChannelData(0);for(let n=0;n<a.length;n++)a[n]=(Math.random()*2-1)*Math.exp(-n/a.length*15);t.buffer=o,e.gain.value=.28,t.connect(e),e.connect(p.destination),t.start(),t.onended=()=>{t.disconnect(),e.disconnect()}}function qt(){if(!$||P==="result"||C>0)return;H(),$=!1,D=.43,P="playing";let t=Math.min(.92,.69+w*.025);if(I>=t){Bt(),Z+=w,C=1.05;for(let e=0;e<w*5;e++)E.push({x:275,y:360-w*8,vx:G(-160,160),vy:G(-180,-70),r:G(0,6)});U("hit")}else C=.8,P="failed",pt(),U("miss")}Mt(),St(),lt(),ht(t=>{let e=kt();J+=t,I=(Math.sin(J*(2.4+w*.13))+1)/2,e<.1&&($=!0),e>.3&&$&&qt(),D=Math.max(0,D-t),C>0&&(C-=t,C<=0&&(P==="failed"?(P="result",vt("Try your timing",Z,"Boards broken",lt)):(w++,u(".round-label").textContent=w+" boards",U("playing"))));for(let n of E)n.x+=n.vx*t,n.y+=n.vy*t,n.vy+=600*t,n.r+=t*3;E=E.filter(n=>n.y<560),Pt(),T(d,48,160,294,17,8,"#acb98c","#786b43");let o=d.createLinearGradient(48,0,342,0);o.addColorStop(0,"#b7d59d"),o.addColorStop(.8,"#e8ce84"),o.addColorStop(1,"#dd8a54"),T(d,50,162,290*I,13,6,o),d.fillStyle="#5e5534",d.beginPath(),d.moveTo(48+I*294,151),d.lineTo(43+I*294,144),d.lineTo(53+I*294,144),d.fill(),bt(d,"PEAK",329,195,12,"#8b6a38"),T(d,235,375,12,90,2,"#6b4b2f","#44311e"),T(d,321,375,12,90,2,"#6b4b2f","#44311e"),T(d,222,367,124,14,2,"#b27b46","#765533");for(let n=0;n<w&&n<12;n++)C>0&&P!=="failed"||(T(d,223,359-n*7,124,6,1,"#e1b37a","#946637"),mt(d,232,361-n*7,333,361-n*7,"#f6d7a155",1));let a=D>0?It:At;a.width&&d.drawImage(a,22,258,218,218);for(let n of E)d.save(),d.translate(n.x,n.y),d.rotate(n.r),T(d,-12,-3,24,6,1,"#d6a56d","#916332"),d.restore()}),wt(()=>{u(".guide")&&(u(".guide").textContent=String(at("GUIDE","Shout at the peak")))})})();(()=>{let c=document.createElement("style");c.dataset.batch3Ui="20261116",c.textContent=`
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
.hud{font-family:Playful,UIBody,sans-serif;font-size:28px}.guide{font-size:18px;top:100px}.mic-status{color:#5c402a}`,document.head.append(c)})();})();
