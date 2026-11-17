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

(()=>{var Ee=Object.create;var Ae=Object.defineProperty;var De=Object.getOwnPropertyDescriptor;var ke=Object.getOwnPropertyNames;var Re=Object.getPrototypeOf,Le=Object.prototype.hasOwnProperty;var Fe=(B,H)=>()=>(H||B((H={exports:{}}).exports,H),H.exports);var be=(B,H,v,e)=>{if(H&&typeof H=="object"||typeof H=="function")for(let f of ke(H))!Le.call(B,f)&&f!==v&&Ae(B,f,{get:()=>H[f],enumerable:!(e=De(H,f))||e.enumerable});return B};var Ve=(B,H,v)=>(v=B!=null?Ee(Re(B)):{},be(H||!B||!B.__esModule?Ae(v,"default",{value:B,enumerable:!0}):v,B));var Ie=Fe((xe,Ce)=>{(function(H,v){typeof xe=="object"&&typeof Ce=="object"?Ce.exports=v():typeof define=="function"&&define.amd?define("Matter",[],v):typeof xe=="object"?xe.Matter=v():H.Matter=v()})(xe,function(){return function(B){var H={};function v(e){if(H[e])return H[e].exports;var f=H[e]={i:e,l:!1,exports:{}};return B[e].call(f.exports,f,f.exports,v),f.l=!0,f.exports}return v.m=B,v.c=H,v.d=function(e,f,s){v.o(e,f)||Object.defineProperty(e,f,{enumerable:!0,get:s})},v.r=function(e){typeof Symbol<"u"&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})},v.t=function(e,f){if(f&1&&(e=v(e)),f&8||f&4&&typeof e=="object"&&e&&e.__esModule)return e;var s=Object.create(null);if(v.r(s),Object.defineProperty(s,"default",{enumerable:!0,value:e}),f&2&&typeof e!="string")for(var r in e)v.d(s,r,(function(p){return e[p]}).bind(null,r));return s},v.n=function(e){var f=e&&e.__esModule?function(){return e.default}:function(){return e};return v.d(f,"a",f),f},v.o=function(e,f){return Object.prototype.hasOwnProperty.call(e,f)},v.p="",v(v.s=20)}([function(B,H){var v={};B.exports=v,function(){v._baseDelta=1e3/60,v._nextId=0,v._seed=0,v._nowStartTime=+new Date,v._warnedOnce={},v._decomp=null,v.extend=function(f,s){var r,p,n;typeof s=="boolean"?(r=2,n=s):(r=1,n=!0);for(var c=r;c<arguments.length;c++){var o=arguments[c];if(o)for(var t in o)n&&o[t]&&o[t].constructor===Object&&(!f[t]||f[t].constructor===Object)?(f[t]=f[t]||{},v.extend(f[t],n,o[t])):f[t]=o[t]}return f},v.clone=function(f,s){return v.extend({},s,f)},v.keys=function(f){if(Object.keys)return Object.keys(f);var s=[];for(var r in f)s.push(r);return s},v.values=function(f){var s=[];if(Object.keys){for(var r=Object.keys(f),p=0;p<r.length;p++)s.push(f[r[p]]);return s}for(var n in f)s.push(f[n]);return s},v.get=function(f,s,r,p){s=s.split(".").slice(r,p);for(var n=0;n<s.length;n+=1)f=f[s[n]];return f},v.set=function(f,s,r,p,n){var c=s.split(".").slice(p,n);return v.get(f,s,0,-1)[c[c.length-1]]=r,r},v.shuffle=function(f){for(var s=f.length-1;s>0;s--){var r=Math.floor(v.random()*(s+1)),p=f[s];f[s]=f[r],f[r]=p}return f},v.choose=function(f){return f[Math.floor(v.random()*f.length)]},v.isElement=function(f){return typeof HTMLElement<"u"?f instanceof HTMLElement:!!(f&&f.nodeType&&f.nodeName)},v.isArray=function(f){return Object.prototype.toString.call(f)==="[object Array]"},v.isFunction=function(f){return typeof f=="function"},v.isPlainObject=function(f){return typeof f=="object"&&f.constructor===Object},v.isString=function(f){return toString.call(f)==="[object String]"},v.clamp=function(f,s,r){return f<s?s:f>r?r:f},v.sign=function(f){return f<0?-1:1},v.now=function(){if(typeof window<"u"&&window.performance){if(window.performance.now)return window.performance.now();if(window.performance.webkitNow)return window.performance.webkitNow()}return Date.now?Date.now():new Date-v._nowStartTime},v.random=function(f,s){return f=typeof f<"u"?f:0,s=typeof s<"u"?s:1,f+e()*(s-f)};var e=function(){return v._seed=(v._seed*9301+49297)%233280,v._seed/233280};v.colorToNumber=function(f){return f=f.replace("#",""),f.length==3&&(f=f.charAt(0)+f.charAt(0)+f.charAt(1)+f.charAt(1)+f.charAt(2)+f.charAt(2)),parseInt(f,16)},v.logLevel=1,v.log=function(){console&&v.logLevel>0&&v.logLevel<=3&&console.log.apply(console,["matter-js:"].concat(Array.prototype.slice.call(arguments)))},v.info=function(){console&&v.logLevel>0&&v.logLevel<=2&&console.info.apply(console,["matter-js:"].concat(Array.prototype.slice.call(arguments)))},v.warn=function(){console&&v.logLevel>0&&v.logLevel<=3&&console.warn.apply(console,["matter-js:"].concat(Array.prototype.slice.call(arguments)))},v.warnOnce=function(){var f=Array.prototype.slice.call(arguments).join(" ");v._warnedOnce[f]||(v.warn(f),v._warnedOnce[f]=!0)},v.deprecated=function(f,s,r){f[s]=v.chain(function(){v.warnOnce("\u{1F505} deprecated \u{1F505}",r)},f[s])},v.nextId=function(){return v._nextId++},v.indexOf=function(f,s){if(f.indexOf)return f.indexOf(s);for(var r=0;r<f.length;r++)if(f[r]===s)return r;return-1},v.map=function(f,s){if(f.map)return f.map(s);for(var r=[],p=0;p<f.length;p+=1)r.push(s(f[p]));return r},v.topologicalSort=function(f){var s=[],r=[],p=[];for(var n in f)!r[n]&&!p[n]&&v._topologicalSort(n,r,p,f,s);return s},v._topologicalSort=function(f,s,r,p,n){var c=p[f]||[];r[f]=!0;for(var o=0;o<c.length;o+=1){var t=c[o];r[t]||s[t]||v._topologicalSort(t,s,r,p,n)}r[f]=!1,s[f]=!0,n.push(f)},v.chain=function(){for(var f=[],s=0;s<arguments.length;s+=1){var r=arguments[s];r._chained?f.push.apply(f,r._chained):f.push(r)}var p=function(){for(var n,c=new Array(arguments.length),o=0,t=arguments.length;o<t;o++)c[o]=arguments[o];for(o=0;o<f.length;o+=1){var a=f[o].apply(n,c);typeof a<"u"&&(n=a)}return n};return p._chained=f,p},v.chainPathBefore=function(f,s,r){return v.set(f,s,v.chain(r,v.get(f,s)))},v.chainPathAfter=function(f,s,r){return v.set(f,s,v.chain(v.get(f,s),r))},v.setDecomp=function(f){v._decomp=f},v.getDecomp=function(){var f=v._decomp;try{!f&&typeof window<"u"&&(f=window.decomp),!f&&typeof global<"u"&&(f=global.decomp)}catch{f=null}return f}}()},function(B,H){var v={};B.exports=v,function(){v.create=function(e){var f={min:{x:0,y:0},max:{x:0,y:0}};return e&&v.update(f,e),f},v.update=function(e,f,s){e.min.x=1/0,e.max.x=-1/0,e.min.y=1/0,e.max.y=-1/0;for(var r=0;r<f.length;r++){var p=f[r];p.x>e.max.x&&(e.max.x=p.x),p.x<e.min.x&&(e.min.x=p.x),p.y>e.max.y&&(e.max.y=p.y),p.y<e.min.y&&(e.min.y=p.y)}s&&(s.x>0?e.max.x+=s.x:e.min.x+=s.x,s.y>0?e.max.y+=s.y:e.min.y+=s.y)},v.contains=function(e,f){return f.x>=e.min.x&&f.x<=e.max.x&&f.y>=e.min.y&&f.y<=e.max.y},v.overlaps=function(e,f){return e.min.x<=f.max.x&&e.max.x>=f.min.x&&e.max.y>=f.min.y&&e.min.y<=f.max.y},v.translate=function(e,f){e.min.x+=f.x,e.max.x+=f.x,e.min.y+=f.y,e.max.y+=f.y},v.shift=function(e,f){var s=e.max.x-e.min.x,r=e.max.y-e.min.y;e.min.x=f.x,e.max.x=f.x+s,e.min.y=f.y,e.max.y=f.y+r}}()},function(B,H){var v={};B.exports=v,function(){v.create=function(e,f){return{x:e||0,y:f||0}},v.clone=function(e){return{x:e.x,y:e.y}},v.magnitude=function(e){return Math.sqrt(e.x*e.x+e.y*e.y)},v.magnitudeSquared=function(e){return e.x*e.x+e.y*e.y},v.rotate=function(e,f,s){var r=Math.cos(f),p=Math.sin(f);s||(s={});var n=e.x*r-e.y*p;return s.y=e.x*p+e.y*r,s.x=n,s},v.rotateAbout=function(e,f,s,r){var p=Math.cos(f),n=Math.sin(f);r||(r={});var c=s.x+((e.x-s.x)*p-(e.y-s.y)*n);return r.y=s.y+((e.x-s.x)*n+(e.y-s.y)*p),r.x=c,r},v.normalise=function(e){var f=v.magnitude(e);return f===0?{x:0,y:0}:{x:e.x/f,y:e.y/f}},v.dot=function(e,f){return e.x*f.x+e.y*f.y},v.cross=function(e,f){return e.x*f.y-e.y*f.x},v.cross3=function(e,f,s){return(f.x-e.x)*(s.y-e.y)-(f.y-e.y)*(s.x-e.x)},v.add=function(e,f,s){return s||(s={}),s.x=e.x+f.x,s.y=e.y+f.y,s},v.sub=function(e,f,s){return s||(s={}),s.x=e.x-f.x,s.y=e.y-f.y,s},v.mult=function(e,f){return{x:e.x*f,y:e.y*f}},v.div=function(e,f){return{x:e.x/f,y:e.y/f}},v.perp=function(e,f){return f=f===!0?-1:1,{x:f*-e.y,y:f*e.x}},v.neg=function(e){return{x:-e.x,y:-e.y}},v.angle=function(e,f){return Math.atan2(f.y-e.y,f.x-e.x)},v._temp=[v.create(),v.create(),v.create(),v.create(),v.create(),v.create()]}()},function(B,H,v){var e={};B.exports=e;var f=v(2),s=v(0);(function(){e.create=function(r,p){for(var n=[],c=0;c<r.length;c++){var o=r[c],t={x:o.x,y:o.y,index:c,body:p,isInternal:!1};n.push(t)}return n},e.fromPath=function(r,p){var n=/L?\s*([-\d.e]+)[\s,]*([-\d.e]+)*/ig,c=[];return r.replace(n,function(o,t,a){c.push({x:parseFloat(t),y:parseFloat(a)})}),e.create(c,p)},e.centre=function(r){for(var p=e.area(r,!0),n={x:0,y:0},c,o,t,a=0;a<r.length;a++)t=(a+1)%r.length,c=f.cross(r[a],r[t]),o=f.mult(f.add(r[a],r[t]),c),n=f.add(n,o);return f.div(n,6*p)},e.mean=function(r){for(var p={x:0,y:0},n=0;n<r.length;n++)p.x+=r[n].x,p.y+=r[n].y;return f.div(p,r.length)},e.area=function(r,p){for(var n=0,c=r.length-1,o=0;o<r.length;o++)n+=(r[c].x-r[o].x)*(r[c].y+r[o].y),c=o;return p?n/2:Math.abs(n)/2},e.inertia=function(r,p){for(var n=0,c=0,o=r,t,a,i=0;i<o.length;i++)a=(i+1)%o.length,t=Math.abs(f.cross(o[a],o[i])),n+=t*(f.dot(o[a],o[a])+f.dot(o[a],o[i])+f.dot(o[i],o[i])),c+=t;return p/6*(n/c)},e.translate=function(r,p,n){n=typeof n<"u"?n:1;var c=r.length,o=p.x*n,t=p.y*n,a;for(a=0;a<c;a++)r[a].x+=o,r[a].y+=t;return r},e.rotate=function(r,p,n){if(p!==0){var c=Math.cos(p),o=Math.sin(p),t=n.x,a=n.y,i=r.length,l,d,x,C;for(C=0;C<i;C++)l=r[C],d=l.x-t,x=l.y-a,l.x=t+(d*c-x*o),l.y=a+(d*o+x*c);return r}},e.contains=function(r,p){for(var n=p.x,c=p.y,o=r.length,t=r[o-1],a,i=0;i<o;i++){if(a=r[i],(n-t.x)*(a.y-t.y)+(c-t.y)*(t.x-a.x)>0)return!1;t=a}return!0},e.scale=function(r,p,n,c){if(p===1&&n===1)return r;c=c||e.centre(r);for(var o,t,a=0;a<r.length;a++)o=r[a],t=f.sub(o,c),r[a].x=c.x+t.x*p,r[a].y=c.y+t.y*n;return r},e.chamfer=function(r,p,n,c,o){typeof p=="number"?p=[p]:p=p||[8],n=typeof n<"u"?n:-1,c=c||2,o=o||14;for(var t=[],a=0;a<r.length;a++){var i=r[a-1>=0?a-1:r.length-1],l=r[a],d=r[(a+1)%r.length],x=p[a<p.length?a:p.length-1];if(x===0){t.push(l);continue}var C=f.normalise({x:l.y-i.y,y:i.x-l.x}),w=f.normalise({x:d.y-l.y,y:l.x-d.x}),u=Math.sqrt(2*Math.pow(x,2)),h=f.mult(s.clone(C),x),m=f.normalise(f.mult(f.add(C,w),.5)),g=f.sub(l,f.mult(m,u)),S=n;n===-1&&(S=Math.pow(x,.32)*1.75),S=s.clamp(S,c,o),S%2===1&&(S+=1);for(var P=Math.acos(f.dot(C,w)),y=P/S,I=0;I<S;I++)t.push(f.add(f.rotate(h,y*I),g))}return t},e.clockwiseSort=function(r){var p=e.mean(r);return r.sort(function(n,c){return f.angle(p,n)-f.angle(p,c)}),r},e.isConvex=function(r){var p=0,n=r.length,c,o,t,a;if(n<3)return null;for(c=0;c<n;c++)if(o=(c+1)%n,t=(c+2)%n,a=(r[o].x-r[c].x)*(r[t].y-r[o].y),a-=(r[o].y-r[c].y)*(r[t].x-r[o].x),a<0?p|=1:a>0&&(p|=2),p===3)return!1;return p!==0?!0:null},e.hull=function(r){var p=[],n=[],c,o;for(r=r.slice(0),r.sort(function(t,a){var i=t.x-a.x;return i!==0?i:t.y-a.y}),o=0;o<r.length;o+=1){for(c=r[o];n.length>=2&&f.cross3(n[n.length-2],n[n.length-1],c)<=0;)n.pop();n.push(c)}for(o=r.length-1;o>=0;o-=1){for(c=r[o];p.length>=2&&f.cross3(p[p.length-2],p[p.length-1],c)<=0;)p.pop();p.push(c)}return p.pop(),n.pop(),p.concat(n)}})()},function(B,H,v){var e={};B.exports=e;var f=v(3),s=v(2),r=v(7),p=v(0),n=v(1),c=v(11);(function(){e._timeCorrection=!0,e._inertiaScale=4,e._nextCollidingGroupId=1,e._nextNonCollidingGroupId=-1,e._nextCategory=1,e._baseDelta=1e3/60,e.create=function(t){var a={id:p.nextId(),type:"body",label:"Body",parts:[],plugin:{},angle:0,vertices:f.fromPath("L 0 0 L 40 0 L 40 40 L 0 40"),position:{x:0,y:0},force:{x:0,y:0},torque:0,positionImpulse:{x:0,y:0},constraintImpulse:{x:0,y:0,angle:0},totalContacts:0,speed:0,angularSpeed:0,velocity:{x:0,y:0},angularVelocity:0,isSensor:!1,isStatic:!1,isSleeping:!1,motion:0,sleepThreshold:60,density:.001,restitution:0,friction:.1,frictionStatic:.5,frictionAir:.01,collisionFilter:{category:1,mask:4294967295,group:0},slop:.05,timeScale:1,render:{visible:!0,opacity:1,strokeStyle:null,fillStyle:null,lineWidth:null,sprite:{xScale:1,yScale:1,xOffset:0,yOffset:0}},events:null,bounds:null,chamfer:null,circleRadius:0,positionPrev:null,anglePrev:0,parent:null,axes:null,area:0,mass:0,inertia:0,deltaTime:16.666666666666668,_original:null},i=p.extend(a,t);return o(i,t),i},e.nextGroup=function(t){return t?e._nextNonCollidingGroupId--:e._nextCollidingGroupId++},e.nextCategory=function(){return e._nextCategory=e._nextCategory<<1,e._nextCategory};var o=function(t,a){a=a||{},e.set(t,{bounds:t.bounds||n.create(t.vertices),positionPrev:t.positionPrev||s.clone(t.position),anglePrev:t.anglePrev||t.angle,vertices:t.vertices,parts:t.parts||[t],isStatic:t.isStatic,isSleeping:t.isSleeping,parent:t.parent||t}),f.rotate(t.vertices,t.angle,t.position),c.rotate(t.axes,t.angle),n.update(t.bounds,t.vertices,t.velocity),e.set(t,{axes:a.axes||t.axes,area:a.area||t.area,mass:a.mass||t.mass,inertia:a.inertia||t.inertia});var i=t.isStatic?"#14151f":p.choose(["#f19648","#f5d259","#f55a3c","#063e7b","#ececd1"]),l=t.isStatic?"#555":"#ccc",d=t.isStatic&&t.render.fillStyle===null?1:0;t.render.fillStyle=t.render.fillStyle||i,t.render.strokeStyle=t.render.strokeStyle||l,t.render.lineWidth=t.render.lineWidth||d,t.render.sprite.xOffset+=-(t.bounds.min.x-t.position.x)/(t.bounds.max.x-t.bounds.min.x),t.render.sprite.yOffset+=-(t.bounds.min.y-t.position.y)/(t.bounds.max.y-t.bounds.min.y)};e.set=function(t,a,i){var l;typeof a=="string"&&(l=a,a={},a[l]=i);for(l in a)if(Object.prototype.hasOwnProperty.call(a,l))switch(i=a[l],l){case"isStatic":e.setStatic(t,i);break;case"isSleeping":r.set(t,i);break;case"mass":e.setMass(t,i);break;case"density":e.setDensity(t,i);break;case"inertia":e.setInertia(t,i);break;case"vertices":e.setVertices(t,i);break;case"position":e.setPosition(t,i);break;case"angle":e.setAngle(t,i);break;case"velocity":e.setVelocity(t,i);break;case"angularVelocity":e.setAngularVelocity(t,i);break;case"speed":e.setSpeed(t,i);break;case"angularSpeed":e.setAngularSpeed(t,i);break;case"parts":e.setParts(t,i);break;case"centre":e.setCentre(t,i);break;default:t[l]=i}},e.setStatic=function(t,a){for(var i=0;i<t.parts.length;i++){var l=t.parts[i];a?(l.isStatic||(l._original={restitution:l.restitution,friction:l.friction,mass:l.mass,inertia:l.inertia,density:l.density,inverseMass:l.inverseMass,inverseInertia:l.inverseInertia}),l.restitution=0,l.friction=1,l.mass=l.inertia=l.density=1/0,l.inverseMass=l.inverseInertia=0,l.positionPrev.x=l.position.x,l.positionPrev.y=l.position.y,l.anglePrev=l.angle,l.angularVelocity=0,l.speed=0,l.angularSpeed=0,l.motion=0):l._original&&(l.restitution=l._original.restitution,l.friction=l._original.friction,l.mass=l._original.mass,l.inertia=l._original.inertia,l.density=l._original.density,l.inverseMass=l._original.inverseMass,l.inverseInertia=l._original.inverseInertia,l._original=null),l.isStatic=a}},e.setMass=function(t,a){var i=t.inertia/(t.mass/6);t.inertia=i*(a/6),t.inverseInertia=1/t.inertia,t.mass=a,t.inverseMass=1/t.mass,t.density=t.mass/t.area},e.setDensity=function(t,a){e.setMass(t,a*t.area),t.density=a},e.setInertia=function(t,a){t.inertia=a,t.inverseInertia=1/t.inertia},e.setVertices=function(t,a){a[0].body===t?t.vertices=a:t.vertices=f.create(a,t),t.axes=c.fromVertices(t.vertices),t.area=f.area(t.vertices),e.setMass(t,t.density*t.area);var i=f.centre(t.vertices);f.translate(t.vertices,i,-1),e.setInertia(t,e._inertiaScale*f.inertia(t.vertices,t.mass)),f.translate(t.vertices,t.position),n.update(t.bounds,t.vertices,t.velocity)},e.setParts=function(t,a,i){var l;for(a=a.slice(0),t.parts.length=0,t.parts.push(t),t.parent=t,l=0;l<a.length;l++){var d=a[l];d!==t&&(d.parent=t,t.parts.push(d))}if(t.parts.length!==1){if(i=typeof i<"u"?i:!0,i){var x=[];for(l=0;l<a.length;l++)x=x.concat(a[l].vertices);f.clockwiseSort(x);var C=f.hull(x),w=f.centre(C);e.setVertices(t,C),f.translate(t.vertices,w)}var u=e._totalProperties(t);t.area=u.area,t.parent=t,t.position.x=u.centre.x,t.position.y=u.centre.y,t.positionPrev.x=u.centre.x,t.positionPrev.y=u.centre.y,e.setMass(t,u.mass),e.setInertia(t,u.inertia),e.setPosition(t,u.centre)}},e.setCentre=function(t,a,i){i?(t.positionPrev.x+=a.x,t.positionPrev.y+=a.y,t.position.x+=a.x,t.position.y+=a.y):(t.positionPrev.x=a.x-(t.position.x-t.positionPrev.x),t.positionPrev.y=a.y-(t.position.y-t.positionPrev.y),t.position.x=a.x,t.position.y=a.y)},e.setPosition=function(t,a,i){var l=s.sub(a,t.position);i?(t.positionPrev.x=t.position.x,t.positionPrev.y=t.position.y,t.velocity.x=l.x,t.velocity.y=l.y,t.speed=s.magnitude(l)):(t.positionPrev.x+=l.x,t.positionPrev.y+=l.y);for(var d=0;d<t.parts.length;d++){var x=t.parts[d];x.position.x+=l.x,x.position.y+=l.y,f.translate(x.vertices,l),n.update(x.bounds,x.vertices,t.velocity)}},e.setAngle=function(t,a,i){var l=a-t.angle;i?(t.anglePrev=t.angle,t.angularVelocity=l,t.angularSpeed=Math.abs(l)):t.anglePrev+=l;for(var d=0;d<t.parts.length;d++){var x=t.parts[d];x.angle+=l,f.rotate(x.vertices,l,t.position),c.rotate(x.axes,l),n.update(x.bounds,x.vertices,t.velocity),d>0&&s.rotateAbout(x.position,l,t.position,x.position)}},e.setVelocity=function(t,a){var i=t.deltaTime/e._baseDelta;t.positionPrev.x=t.position.x-a.x*i,t.positionPrev.y=t.position.y-a.y*i,t.velocity.x=(t.position.x-t.positionPrev.x)/i,t.velocity.y=(t.position.y-t.positionPrev.y)/i,t.speed=s.magnitude(t.velocity)},e.getVelocity=function(t){var a=e._baseDelta/t.deltaTime;return{x:(t.position.x-t.positionPrev.x)*a,y:(t.position.y-t.positionPrev.y)*a}},e.getSpeed=function(t){return s.magnitude(e.getVelocity(t))},e.setSpeed=function(t,a){e.setVelocity(t,s.mult(s.normalise(e.getVelocity(t)),a))},e.setAngularVelocity=function(t,a){var i=t.deltaTime/e._baseDelta;t.anglePrev=t.angle-a*i,t.angularVelocity=(t.angle-t.anglePrev)/i,t.angularSpeed=Math.abs(t.angularVelocity)},e.getAngularVelocity=function(t){return(t.angle-t.anglePrev)*e._baseDelta/t.deltaTime},e.getAngularSpeed=function(t){return Math.abs(e.getAngularVelocity(t))},e.setAngularSpeed=function(t,a){e.setAngularVelocity(t,p.sign(e.getAngularVelocity(t))*a)},e.translate=function(t,a,i){e.setPosition(t,s.add(t.position,a),i)},e.rotate=function(t,a,i,l){if(!i)e.setAngle(t,t.angle+a,l);else{var d=Math.cos(a),x=Math.sin(a),C=t.position.x-i.x,w=t.position.y-i.y;e.setPosition(t,{x:i.x+(C*d-w*x),y:i.y+(C*x+w*d)},l),e.setAngle(t,t.angle+a,l)}},e.scale=function(t,a,i,l){var d=0,x=0;l=l||t.position;for(var C=0;C<t.parts.length;C++){var w=t.parts[C];f.scale(w.vertices,a,i,l),w.axes=c.fromVertices(w.vertices),w.area=f.area(w.vertices),e.setMass(w,t.density*w.area),f.translate(w.vertices,{x:-w.position.x,y:-w.position.y}),e.setInertia(w,e._inertiaScale*f.inertia(w.vertices,w.mass)),f.translate(w.vertices,{x:w.position.x,y:w.position.y}),C>0&&(d+=w.area,x+=w.inertia),w.position.x=l.x+(w.position.x-l.x)*a,w.position.y=l.y+(w.position.y-l.y)*i,n.update(w.bounds,w.vertices,t.velocity)}t.parts.length>1&&(t.area=d,t.isStatic||(e.setMass(t,t.density*d),e.setInertia(t,x))),t.circleRadius&&(a===i?t.circleRadius*=a:t.circleRadius=null)},e.update=function(t,a){a=(typeof a<"u"?a:1e3/60)*t.timeScale;var i=a*a,l=e._timeCorrection?a/(t.deltaTime||a):1,d=1-t.frictionAir*(a/p._baseDelta),x=(t.position.x-t.positionPrev.x)*l,C=(t.position.y-t.positionPrev.y)*l;t.velocity.x=x*d+t.force.x/t.mass*i,t.velocity.y=C*d+t.force.y/t.mass*i,t.positionPrev.x=t.position.x,t.positionPrev.y=t.position.y,t.position.x+=t.velocity.x,t.position.y+=t.velocity.y,t.deltaTime=a,t.angularVelocity=(t.angle-t.anglePrev)*d*l+t.torque/t.inertia*i,t.anglePrev=t.angle,t.angle+=t.angularVelocity;for(var w=0;w<t.parts.length;w++){var u=t.parts[w];f.translate(u.vertices,t.velocity),w>0&&(u.position.x+=t.velocity.x,u.position.y+=t.velocity.y),t.angularVelocity!==0&&(f.rotate(u.vertices,t.angularVelocity,t.position),c.rotate(u.axes,t.angularVelocity),w>0&&s.rotateAbout(u.position,t.angularVelocity,t.position,u.position)),n.update(u.bounds,u.vertices,t.velocity)}},e.updateVelocities=function(t){var a=e._baseDelta/t.deltaTime,i=t.velocity;i.x=(t.position.x-t.positionPrev.x)*a,i.y=(t.position.y-t.positionPrev.y)*a,t.speed=Math.sqrt(i.x*i.x+i.y*i.y),t.angularVelocity=(t.angle-t.anglePrev)*a,t.angularSpeed=Math.abs(t.angularVelocity)},e.applyForce=function(t,a,i){var l={x:a.x-t.position.x,y:a.y-t.position.y};t.force.x+=i.x,t.force.y+=i.y,t.torque+=l.x*i.y-l.y*i.x},e._totalProperties=function(t){for(var a={mass:0,area:0,inertia:0,centre:{x:0,y:0}},i=t.parts.length===1?0:1;i<t.parts.length;i++){var l=t.parts[i],d=l.mass!==1/0?l.mass:1;a.mass+=d,a.area+=l.area,a.inertia+=l.inertia,a.centre=s.add(a.centre,s.mult(l.position,d))}return a.centre=s.div(a.centre,a.mass),a}})()},function(B,H,v){var e={};B.exports=e;var f=v(0);(function(){e.on=function(s,r,p){for(var n=r.split(" "),c,o=0;o<n.length;o++)c=n[o],s.events=s.events||{},s.events[c]=s.events[c]||[],s.events[c].push(p);return p},e.off=function(s,r,p){if(!r){s.events={};return}typeof r=="function"&&(p=r,r=f.keys(s.events).join(" "));for(var n=r.split(" "),c=0;c<n.length;c++){var o=s.events[n[c]],t=[];if(p&&o)for(var a=0;a<o.length;a++)o[a]!==p&&t.push(o[a]);s.events[n[c]]=t}},e.trigger=function(s,r,p){var n,c,o,t,a=s.events;if(a&&f.keys(a).length>0){p||(p={}),n=r.split(" ");for(var i=0;i<n.length;i++)if(c=n[i],o=a[c],o){t=f.clone(p,!1),t.name=c,t.source=s;for(var l=0;l<o.length;l++)o[l].apply(s,[t])}}}})()},function(B,H,v){var e={};B.exports=e;var f=v(5),s=v(0),r=v(1),p=v(4);(function(){e.create=function(n){return s.extend({id:s.nextId(),type:"composite",parent:null,isModified:!1,bodies:[],constraints:[],composites:[],label:"Composite",plugin:{},cache:{allBodies:null,allConstraints:null,allComposites:null}},n)},e.setModified=function(n,c,o,t){if(n.isModified=c,c&&n.cache&&(n.cache.allBodies=null,n.cache.allConstraints=null,n.cache.allComposites=null),o&&n.parent&&e.setModified(n.parent,c,o,t),t)for(var a=0;a<n.composites.length;a++){var i=n.composites[a];e.setModified(i,c,o,t)}},e.add=function(n,c){var o=[].concat(c);f.trigger(n,"beforeAdd",{object:c});for(var t=0;t<o.length;t++){var a=o[t];switch(a.type){case"body":if(a.parent!==a){s.warn("Composite.add: skipped adding a compound body part (you must add its parent instead)");break}e.addBody(n,a);break;case"constraint":e.addConstraint(n,a);break;case"composite":e.addComposite(n,a);break;case"mouseConstraint":e.addConstraint(n,a.constraint);break}}return f.trigger(n,"afterAdd",{object:c}),n},e.remove=function(n,c,o){var t=[].concat(c);f.trigger(n,"beforeRemove",{object:c});for(var a=0;a<t.length;a++){var i=t[a];switch(i.type){case"body":e.removeBody(n,i,o);break;case"constraint":e.removeConstraint(n,i,o);break;case"composite":e.removeComposite(n,i,o);break;case"mouseConstraint":e.removeConstraint(n,i.constraint);break}}return f.trigger(n,"afterRemove",{object:c}),n},e.addComposite=function(n,c){return n.composites.push(c),c.parent=n,e.setModified(n,!0,!0,!1),n},e.removeComposite=function(n,c,o){var t=s.indexOf(n.composites,c);if(t!==-1){var a=e.allBodies(c);e.removeCompositeAt(n,t);for(var i=0;i<a.length;i++)a[i].sleepCounter=0}if(o)for(var i=0;i<n.composites.length;i++)e.removeComposite(n.composites[i],c,!0);return n},e.removeCompositeAt=function(n,c){return n.composites.splice(c,1),e.setModified(n,!0,!0,!1),n},e.addBody=function(n,c){return n.bodies.push(c),e.setModified(n,!0,!0,!1),n},e.removeBody=function(n,c,o){var t=s.indexOf(n.bodies,c);if(t!==-1&&(e.removeBodyAt(n,t),c.sleepCounter=0),o)for(var a=0;a<n.composites.length;a++)e.removeBody(n.composites[a],c,!0);return n},e.removeBodyAt=function(n,c){return n.bodies.splice(c,1),e.setModified(n,!0,!0,!1),n},e.addConstraint=function(n,c){return n.constraints.push(c),e.setModified(n,!0,!0,!1),n},e.removeConstraint=function(n,c,o){var t=s.indexOf(n.constraints,c);if(t!==-1&&e.removeConstraintAt(n,t),o)for(var a=0;a<n.composites.length;a++)e.removeConstraint(n.composites[a],c,!0);return n},e.removeConstraintAt=function(n,c){return n.constraints.splice(c,1),e.setModified(n,!0,!0,!1),n},e.clear=function(n,c,o){if(o)for(var t=0;t<n.composites.length;t++)e.clear(n.composites[t],c,!0);return c?n.bodies=n.bodies.filter(function(a){return a.isStatic}):n.bodies.length=0,n.constraints.length=0,n.composites.length=0,e.setModified(n,!0,!0,!1),n},e.allBodies=function(n){if(n.cache&&n.cache.allBodies)return n.cache.allBodies;for(var c=[].concat(n.bodies),o=0;o<n.composites.length;o++)c=c.concat(e.allBodies(n.composites[o]));return n.cache&&(n.cache.allBodies=c),c},e.allConstraints=function(n){if(n.cache&&n.cache.allConstraints)return n.cache.allConstraints;for(var c=[].concat(n.constraints),o=0;o<n.composites.length;o++)c=c.concat(e.allConstraints(n.composites[o]));return n.cache&&(n.cache.allConstraints=c),c},e.allComposites=function(n){if(n.cache&&n.cache.allComposites)return n.cache.allComposites;for(var c=[].concat(n.composites),o=0;o<n.composites.length;o++)c=c.concat(e.allComposites(n.composites[o]));return n.cache&&(n.cache.allComposites=c),c},e.get=function(n,c,o){var t,a;switch(o){case"body":t=e.allBodies(n);break;case"constraint":t=e.allConstraints(n);break;case"composite":t=e.allComposites(n).concat(n);break}return t?(a=t.filter(function(i){return i.id.toString()===c.toString()}),a.length===0?null:a[0]):null},e.move=function(n,c,o){return e.remove(n,c),e.add(o,c),n},e.rebase=function(n){for(var c=e.allBodies(n).concat(e.allConstraints(n)).concat(e.allComposites(n)),o=0;o<c.length;o++)c[o].id=s.nextId();return n},e.translate=function(n,c,o){for(var t=o?e.allBodies(n):n.bodies,a=0;a<t.length;a++)p.translate(t[a],c);return n},e.rotate=function(n,c,o,t){for(var a=Math.cos(c),i=Math.sin(c),l=t?e.allBodies(n):n.bodies,d=0;d<l.length;d++){var x=l[d],C=x.position.x-o.x,w=x.position.y-o.y;p.setPosition(x,{x:o.x+(C*a-w*i),y:o.y+(C*i+w*a)}),p.rotate(x,c)}return n},e.scale=function(n,c,o,t,a){for(var i=a?e.allBodies(n):n.bodies,l=0;l<i.length;l++){var d=i[l],x=d.position.x-t.x,C=d.position.y-t.y;p.setPosition(d,{x:t.x+x*c,y:t.y+C*o}),p.scale(d,c,o)}return n},e.bounds=function(n){for(var c=e.allBodies(n),o=[],t=0;t<c.length;t+=1){var a=c[t];o.push(a.bounds.min,a.bounds.max)}return r.create(o)}})()},function(B,H,v){var e={};B.exports=e;var f=v(4),s=v(5),r=v(0);(function(){e._motionWakeThreshold=.18,e._motionSleepThreshold=.08,e._minBias=.9,e.update=function(p,n){for(var c=n/r._baseDelta,o=e._motionSleepThreshold,t=0;t<p.length;t++){var a=p[t],i=f.getSpeed(a),l=f.getAngularSpeed(a),d=i*i+l*l;if(a.force.x!==0||a.force.y!==0){e.set(a,!1);continue}var x=Math.min(a.motion,d),C=Math.max(a.motion,d);a.motion=e._minBias*x+(1-e._minBias)*C,a.sleepThreshold>0&&a.motion<o?(a.sleepCounter+=1,a.sleepCounter>=a.sleepThreshold/c&&e.set(a,!0)):a.sleepCounter>0&&(a.sleepCounter-=1)}},e.afterCollisions=function(p){for(var n=e._motionSleepThreshold,c=0;c<p.length;c++){var o=p[c];if(o.isActive){var t=o.collision,a=t.bodyA.parent,i=t.bodyB.parent;if(!(a.isSleeping&&i.isSleeping||a.isStatic||i.isStatic)&&(a.isSleeping||i.isSleeping)){var l=a.isSleeping&&!a.isStatic?a:i,d=l===a?i:a;!l.isStatic&&d.motion>n&&e.set(l,!1)}}}},e.set=function(p,n){var c=p.isSleeping;n?(p.isSleeping=!0,p.sleepCounter=p.sleepThreshold,p.positionImpulse.x=0,p.positionImpulse.y=0,p.positionPrev.x=p.position.x,p.positionPrev.y=p.position.y,p.anglePrev=p.angle,p.speed=0,p.angularSpeed=0,p.motion=0,c||s.trigger(p,"sleepStart")):(p.isSleeping=!1,p.sleepCounter=0,c&&s.trigger(p,"sleepEnd"))}})()},function(B,H,v){var e={};B.exports=e;var f=v(3),s=v(9);(function(){var r=[],p={overlap:0,axis:null},n={overlap:0,axis:null};e.create=function(c,o){return{pair:null,collided:!1,bodyA:c,bodyB:o,parentA:c.parent,parentB:o.parent,depth:0,normal:{x:0,y:0},tangent:{x:0,y:0},penetration:{x:0,y:0},supports:[null,null],supportCount:0}},e.collides=function(c,o,t){if(e._overlapAxes(p,c.vertices,o.vertices,c.axes),p.overlap<=0||(e._overlapAxes(n,o.vertices,c.vertices,o.axes),n.overlap<=0))return null;var a=t&&t.table[s.id(c,o)],i;a?i=a.collision:(i=e.create(c,o),i.collided=!0,i.bodyA=c.id<o.id?c:o,i.bodyB=c.id<o.id?o:c,i.parentA=i.bodyA.parent,i.parentB=i.bodyB.parent),c=i.bodyA,o=i.bodyB;var l;p.overlap<n.overlap?l=p:l=n;var d=i.normal,x=i.tangent,C=i.penetration,w=i.supports,u=l.overlap,h=l.axis,m=h.x,g=h.y,S=o.position.x-c.position.x,P=o.position.y-c.position.y;m*S+g*P>=0&&(m=-m,g=-g),d.x=m,d.y=g,x.x=-g,x.y=m,C.x=m*u,C.y=g*u,i.depth=u;var y=e._findSupports(c,o,d,1),I=0;if(f.contains(c.vertices,y[0])&&(w[I++]=y[0]),f.contains(c.vertices,y[1])&&(w[I++]=y[1]),I<2){var M=e._findSupports(o,c,d,-1);f.contains(o.vertices,M[0])&&(w[I++]=M[0]),I<2&&f.contains(o.vertices,M[1])&&(w[I++]=M[1])}return I===0&&(w[I++]=y[0]),i.supportCount=I,i},e._overlapAxes=function(c,o,t,a){var i=o.length,l=t.length,d=o[0].x,x=o[0].y,C=t[0].x,w=t[0].y,u=a.length,h=Number.MAX_VALUE,m=0,g,S,P,y,I,M;for(I=0;I<u;I++){var E=a[I],k=E.x,b=E.y,F=d*k+x*b,O=C*k+w*b,z=F,G=O;for(M=1;M<i;M+=1)y=o[M].x*k+o[M].y*b,y>z?z=y:y<F&&(F=y);for(M=1;M<l;M+=1)y=t[M].x*k+t[M].y*b,y>G?G=y:y<O&&(O=y);if(S=z-O,P=G-F,g=S<P?S:P,g<h&&(h=g,m=I,g<=0))break}c.axis=a[m],c.overlap=h},e._findSupports=function(c,o,t,a){var i=o.vertices,l=i.length,d=c.position.x,x=c.position.y,C=t.x*a,w=t.y*a,u=i[0],h=u,m=C*(d-h.x)+w*(x-h.y),g,S,P;for(P=1;P<l;P+=1)h=i[P],S=C*(d-h.x)+w*(x-h.y),S<m&&(m=S,u=h);return g=i[(l+u.index-1)%l],m=C*(d-g.x)+w*(x-g.y),h=i[(u.index+1)%l],C*(d-h.x)+w*(x-h.y)<m?(r[0]=u,r[1]=h,r):(r[0]=u,r[1]=g,r)}})()},function(B,H,v){var e={};B.exports=e;var f=v(16);(function(){e.create=function(s,r){var p=s.bodyA,n=s.bodyB,c={id:e.id(p,n),bodyA:p,bodyB:n,collision:s,contacts:[f.create(),f.create()],contactCount:0,separation:0,isActive:!0,isSensor:p.isSensor||n.isSensor,timeCreated:r,timeUpdated:r,inverseMass:0,friction:0,frictionStatic:0,restitution:0,slop:0};return e.update(c,s,r),c},e.update=function(s,r,p){var n=r.supports,c=r.supportCount,o=s.contacts,t=r.parentA,a=r.parentB;s.isActive=!0,s.timeUpdated=p,s.collision=r,s.separation=r.depth,s.inverseMass=t.inverseMass+a.inverseMass,s.friction=t.friction<a.friction?t.friction:a.friction,s.frictionStatic=t.frictionStatic>a.frictionStatic?t.frictionStatic:a.frictionStatic,s.restitution=t.restitution>a.restitution?t.restitution:a.restitution,s.slop=t.slop>a.slop?t.slop:a.slop,s.contactCount=c,r.pair=s;var i=n[0],l=o[0],d=n[1],x=o[1];(x.vertex===i||l.vertex===d)&&(o[1]=l,o[0]=l=x,x=o[1]),l.vertex=i,x.vertex=d},e.setActive=function(s,r,p){r?(s.isActive=!0,s.timeUpdated=p):(s.isActive=!1,s.contactCount=0)},e.id=function(s,r){return s.id<r.id?s.id.toString(36)+":"+r.id.toString(36):r.id.toString(36)+":"+s.id.toString(36)}})()},function(B,H,v){var e={};B.exports=e;var f=v(3),s=v(2),r=v(7),p=v(1),n=v(11),c=v(0);(function(){e._warming=.4,e._torqueDampen=1,e._minLength=1e-6,e.create=function(o){var t=o;t.bodyA&&!t.pointA&&(t.pointA={x:0,y:0}),t.bodyB&&!t.pointB&&(t.pointB={x:0,y:0});var a=t.bodyA?s.add(t.bodyA.position,t.pointA):t.pointA,i=t.bodyB?s.add(t.bodyB.position,t.pointB):t.pointB,l=s.magnitude(s.sub(a,i));t.length=typeof t.length<"u"?t.length:l,t.id=t.id||c.nextId(),t.label=t.label||"Constraint",t.type="constraint",t.stiffness=t.stiffness||(t.length>0?1:.7),t.damping=t.damping||0,t.angularStiffness=t.angularStiffness||0,t.angleA=t.bodyA?t.bodyA.angle:t.angleA,t.angleB=t.bodyB?t.bodyB.angle:t.angleB,t.plugin={};var d={visible:!0,lineWidth:2,strokeStyle:"#ffffff",type:"line",anchors:!0};return t.length===0&&t.stiffness>.1?(d.type="pin",d.anchors=!1):t.stiffness<.9&&(d.type="spring"),t.render=c.extend(d,t.render),t},e.preSolveAll=function(o){for(var t=0;t<o.length;t+=1){var a=o[t],i=a.constraintImpulse;a.isStatic||i.x===0&&i.y===0&&i.angle===0||(a.position.x+=i.x,a.position.y+=i.y,a.angle+=i.angle)}},e.solveAll=function(o,t){for(var a=c.clamp(t/c._baseDelta,0,1),i=0;i<o.length;i+=1){var l=o[i],d=!l.bodyA||l.bodyA&&l.bodyA.isStatic,x=!l.bodyB||l.bodyB&&l.bodyB.isStatic;(d||x)&&e.solve(o[i],a)}for(i=0;i<o.length;i+=1)l=o[i],d=!l.bodyA||l.bodyA&&l.bodyA.isStatic,x=!l.bodyB||l.bodyB&&l.bodyB.isStatic,!d&&!x&&e.solve(o[i],a)},e.solve=function(o,t){var a=o.bodyA,i=o.bodyB,l=o.pointA,d=o.pointB;if(!(!a&&!i)){a&&!a.isStatic&&(s.rotate(l,a.angle-o.angleA,l),o.angleA=a.angle),i&&!i.isStatic&&(s.rotate(d,i.angle-o.angleB,d),o.angleB=i.angle);var x=l,C=d;if(a&&(x=s.add(a.position,l)),i&&(C=s.add(i.position,d)),!(!x||!C)){var w=s.sub(x,C),u=s.magnitude(w);u<e._minLength&&(u=e._minLength);var h=(u-o.length)/u,m=o.stiffness>=1||o.length===0,g=m?o.stiffness*t:o.stiffness*t*t,S=o.damping*t,P=s.mult(w,h*g),y=(a?a.inverseMass:0)+(i?i.inverseMass:0),I=(a?a.inverseInertia:0)+(i?i.inverseInertia:0),M=y+I,E,k,b,F,O;if(S>0){var z=s.create();b=s.div(w,u),O=s.sub(i&&s.sub(i.position,i.positionPrev)||z,a&&s.sub(a.position,a.positionPrev)||z),F=s.dot(b,O)}a&&!a.isStatic&&(k=a.inverseMass/y,a.constraintImpulse.x-=P.x*k,a.constraintImpulse.y-=P.y*k,a.position.x-=P.x*k,a.position.y-=P.y*k,S>0&&(a.positionPrev.x-=S*b.x*F*k,a.positionPrev.y-=S*b.y*F*k),E=s.cross(l,P)/M*e._torqueDampen*a.inverseInertia*(1-o.angularStiffness),a.constraintImpulse.angle-=E,a.angle-=E),i&&!i.isStatic&&(k=i.inverseMass/y,i.constraintImpulse.x+=P.x*k,i.constraintImpulse.y+=P.y*k,i.position.x+=P.x*k,i.position.y+=P.y*k,S>0&&(i.positionPrev.x+=S*b.x*F*k,i.positionPrev.y+=S*b.y*F*k),E=s.cross(d,P)/M*e._torqueDampen*i.inverseInertia*(1-o.angularStiffness),i.constraintImpulse.angle+=E,i.angle+=E)}}},e.postSolveAll=function(o){for(var t=0;t<o.length;t++){var a=o[t],i=a.constraintImpulse;if(!(a.isStatic||i.x===0&&i.y===0&&i.angle===0)){r.set(a,!1);for(var l=0;l<a.parts.length;l++){var d=a.parts[l];f.translate(d.vertices,i),l>0&&(d.position.x+=i.x,d.position.y+=i.y),i.angle!==0&&(f.rotate(d.vertices,i.angle,a.position),n.rotate(d.axes,i.angle),l>0&&s.rotateAbout(d.position,i.angle,a.position,d.position)),p.update(d.bounds,d.vertices,a.velocity)}i.angle*=e._warming,i.x*=e._warming,i.y*=e._warming}}},e.pointAWorld=function(o){return{x:(o.bodyA?o.bodyA.position.x:0)+(o.pointA?o.pointA.x:0),y:(o.bodyA?o.bodyA.position.y:0)+(o.pointA?o.pointA.y:0)}},e.pointBWorld=function(o){return{x:(o.bodyB?o.bodyB.position.x:0)+(o.pointB?o.pointB.x:0),y:(o.bodyB?o.bodyB.position.y:0)+(o.pointB?o.pointB.y:0)}},e.currentLength=function(o){var t=(o.bodyA?o.bodyA.position.x:0)+(o.pointA?o.pointA.x:0),a=(o.bodyA?o.bodyA.position.y:0)+(o.pointA?o.pointA.y:0),i=(o.bodyB?o.bodyB.position.x:0)+(o.pointB?o.pointB.x:0),l=(o.bodyB?o.bodyB.position.y:0)+(o.pointB?o.pointB.y:0),d=t-i,x=a-l;return Math.sqrt(d*d+x*x)}})()},function(B,H,v){var e={};B.exports=e;var f=v(2),s=v(0);(function(){e.fromVertices=function(r){for(var p={},n=0;n<r.length;n++){var c=(n+1)%r.length,o=f.normalise({x:r[c].y-r[n].y,y:r[n].x-r[c].x}),t=o.y===0?1/0:o.x/o.y;t=t.toFixed(3).toString(),p[t]=o}return s.values(p)},e.rotate=function(r,p){if(p!==0)for(var n=Math.cos(p),c=Math.sin(p),o=0;o<r.length;o++){var t=r[o],a;a=t.x*n-t.y*c,t.y=t.x*c+t.y*n,t.x=a}}})()},function(B,H,v){var e={};B.exports=e;var f=v(3),s=v(0),r=v(4),p=v(1),n=v(2);(function(){e.rectangle=function(c,o,t,a,i){i=i||{};var l={label:"Rectangle Body",position:{x:c,y:o},vertices:f.fromPath("L 0 0 L "+t+" 0 L "+t+" "+a+" L 0 "+a)};if(i.chamfer){var d=i.chamfer;l.vertices=f.chamfer(l.vertices,d.radius,d.quality,d.qualityMin,d.qualityMax),delete i.chamfer}return r.create(s.extend({},l,i))},e.trapezoid=function(c,o,t,a,i,l){l=l||{},i>=1&&s.warn("Bodies.trapezoid: slope parameter must be < 1."),i*=.5;var d=(1-i*2)*t,x=t*i,C=x+d,w=C+x,u;i<.5?u="L 0 0 L "+x+" "+-a+" L "+C+" "+-a+" L "+w+" 0":u="L 0 0 L "+C+" "+-a+" L "+w+" 0";var h={label:"Trapezoid Body",position:{x:c,y:o},vertices:f.fromPath(u)};if(l.chamfer){var m=l.chamfer;h.vertices=f.chamfer(h.vertices,m.radius,m.quality,m.qualityMin,m.qualityMax),delete l.chamfer}return r.create(s.extend({},h,l))},e.circle=function(c,o,t,a,i){a=a||{};var l={label:"Circle Body",circleRadius:t};i=i||25;var d=Math.ceil(Math.max(10,Math.min(i,t)));return d%2===1&&(d+=1),e.polygon(c,o,d,t,s.extend({},l,a))},e.polygon=function(c,o,t,a,i){if(i=i||{},t<3)return e.circle(c,o,a,i);for(var l=2*Math.PI/t,d="",x=l*.5,C=0;C<t;C+=1){var w=x+C*l,u=Math.cos(w)*a,h=Math.sin(w)*a;d+="L "+u.toFixed(3)+" "+h.toFixed(3)+" "}var m={label:"Polygon Body",position:{x:c,y:o},vertices:f.fromPath(d)};if(i.chamfer){var g=i.chamfer;m.vertices=f.chamfer(m.vertices,g.radius,g.quality,g.qualityMin,g.qualityMax),delete i.chamfer}return r.create(s.extend({},m,i))},e.fromVertices=function(c,o,t,a,i,l,d,x){var C=s.getDecomp(),w,u,h,m,g,S,P,y,I,M,E;for(w=!!(C&&C.quickDecomp),a=a||{},h=[],i=typeof i<"u"?i:!1,l=typeof l<"u"?l:.01,d=typeof d<"u"?d:10,x=typeof x<"u"?x:.01,s.isArray(t[0])||(t=[t]),M=0;M<t.length;M+=1)if(S=t[M],m=f.isConvex(S),g=!m,g&&!w&&s.warnOnce("Bodies.fromVertices: Install the 'poly-decomp' library and use Common.setDecomp or provide 'decomp' as a global to decompose concave vertices."),m||!w)m?S=f.clockwiseSort(S):S=f.hull(S),h.push({position:{x:c,y:o},vertices:S});else{var k=S.map(function(W){return[W.x,W.y]});C.makeCCW(k),l!==!1&&C.removeCollinearPoints(k,l),x!==!1&&C.removeDuplicatePoints&&C.removeDuplicatePoints(k,x);var b=C.quickDecomp(k);for(P=0;P<b.length;P++){var F=b[P],O=F.map(function(W){return{x:W[0],y:W[1]}});d>0&&f.area(O)<d||h.push({position:f.centre(O),vertices:O})}}for(P=0;P<h.length;P++)h[P]=r.create(s.extend(h[P],a));if(i){var z=5;for(P=0;P<h.length;P++){var G=h[P];for(y=P+1;y<h.length;y++){var K=h[y];if(p.overlaps(G.bounds,K.bounds)){var X=G.vertices,Y=K.vertices;for(I=0;I<G.vertices.length;I++)for(E=0;E<K.vertices.length;E++){var ie=n.magnitudeSquared(n.sub(X[(I+1)%X.length],Y[E])),_=n.magnitudeSquared(n.sub(X[I],Y[(E+1)%Y.length]));ie<z&&_<z&&(X[I].isInternal=!0,Y[E].isInternal=!0)}}}}}return h.length>1?(u=r.create(s.extend({parts:h.slice(0)},a)),r.setPosition(u,{x:c,y:o}),u):h[0]}})()},function(B,H,v){var e={};B.exports=e;var f=v(0),s=v(8);(function(){e.create=function(r){var p={bodies:[],collisions:[],pairs:null};return f.extend(p,r)},e.setBodies=function(r,p){r.bodies=p.slice(0)},e.clear=function(r){r.bodies=[],r.collisions=[]},e.collisions=function(r){var p=r.pairs,n=r.bodies,c=n.length,o=e.canCollide,t=s.collides,a=r.collisions,i=0,l,d;for(n.sort(e._compareBoundsX),l=0;l<c;l++){var x=n[l],C=x.bounds,w=x.bounds.max.x,u=x.bounds.max.y,h=x.bounds.min.y,m=x.isStatic||x.isSleeping,g=x.parts.length,S=g===1;for(d=l+1;d<c;d++){var P=n[d],y=P.bounds;if(y.min.x>w)break;if(!(u<y.min.y||h>y.max.y)&&!(m&&(P.isStatic||P.isSleeping))&&o(x.collisionFilter,P.collisionFilter)){var I=P.parts.length;if(S&&I===1){var M=t(x,P,p);M&&(a[i++]=M)}else for(var E=g>1?1:0,k=I>1?1:0,b=E;b<g;b++)for(var F=x.parts[b],C=F.bounds,O=k;O<I;O++){var z=P.parts[O],y=z.bounds;if(!(C.min.x>y.max.x||C.max.x<y.min.x||C.max.y<y.min.y||C.min.y>y.max.y)){var M=t(F,z,p);M&&(a[i++]=M)}}}}}return a.length!==i&&(a.length=i),a},e.canCollide=function(r,p){return r.group===p.group&&r.group!==0?r.group>0:(r.mask&p.category)!==0&&(p.mask&r.category)!==0},e._compareBoundsX=function(r,p){return r.bounds.min.x-p.bounds.min.x}})()},function(B,H,v){var e={};B.exports=e;var f=v(0);(function(){e.create=function(s){var r={};return s||f.log("Mouse.create: element was undefined, defaulting to document.body","warn"),r.element=s||document.body,r.absolute={x:0,y:0},r.position={x:0,y:0},r.mousedownPosition={x:0,y:0},r.mouseupPosition={x:0,y:0},r.offset={x:0,y:0},r.scale={x:1,y:1},r.wheelDelta=0,r.button=-1,r.pixelRatio=parseInt(r.element.getAttribute("data-pixel-ratio"),10)||1,r.sourceEvents={mousemove:null,mousedown:null,mouseup:null,mousewheel:null},r.mousemove=function(p){var n=e._getRelativeMousePosition(p,r.element,r.pixelRatio),c=p.changedTouches;c&&(r.button=0,p.preventDefault()),r.absolute.x=n.x,r.absolute.y=n.y,r.position.x=r.absolute.x*r.scale.x+r.offset.x,r.position.y=r.absolute.y*r.scale.y+r.offset.y,r.sourceEvents.mousemove=p},r.mousedown=function(p){var n=e._getRelativeMousePosition(p,r.element,r.pixelRatio),c=p.changedTouches;c?(r.button=0,p.preventDefault()):r.button=p.button,r.absolute.x=n.x,r.absolute.y=n.y,r.position.x=r.absolute.x*r.scale.x+r.offset.x,r.position.y=r.absolute.y*r.scale.y+r.offset.y,r.mousedownPosition.x=r.position.x,r.mousedownPosition.y=r.position.y,r.sourceEvents.mousedown=p},r.mouseup=function(p){var n=e._getRelativeMousePosition(p,r.element,r.pixelRatio),c=p.changedTouches;c&&p.preventDefault(),r.button=-1,r.absolute.x=n.x,r.absolute.y=n.y,r.position.x=r.absolute.x*r.scale.x+r.offset.x,r.position.y=r.absolute.y*r.scale.y+r.offset.y,r.mouseupPosition.x=r.position.x,r.mouseupPosition.y=r.position.y,r.sourceEvents.mouseup=p},r.mousewheel=function(p){r.wheelDelta=Math.max(-1,Math.min(1,p.wheelDelta||-p.detail)),p.preventDefault(),r.sourceEvents.mousewheel=p},e.setElement(r,r.element),r},e.setElement=function(s,r){s.element=r,r.addEventListener("mousemove",s.mousemove,{passive:!0}),r.addEventListener("mousedown",s.mousedown,{passive:!0}),r.addEventListener("mouseup",s.mouseup,{passive:!0}),r.addEventListener("wheel",s.mousewheel,{passive:!1}),r.addEventListener("touchmove",s.mousemove,{passive:!1}),r.addEventListener("touchstart",s.mousedown,{passive:!1}),r.addEventListener("touchend",s.mouseup,{passive:!1})},e.clearSourceEvents=function(s){s.sourceEvents.mousemove=null,s.sourceEvents.mousedown=null,s.sourceEvents.mouseup=null,s.sourceEvents.mousewheel=null,s.wheelDelta=0},e.setOffset=function(s,r){s.offset.x=r.x,s.offset.y=r.y,s.position.x=s.absolute.x*s.scale.x+s.offset.x,s.position.y=s.absolute.y*s.scale.y+s.offset.y},e.setScale=function(s,r){s.scale.x=r.x,s.scale.y=r.y,s.position.x=s.absolute.x*s.scale.x+s.offset.x,s.position.y=s.absolute.y*s.scale.y+s.offset.y},e._getRelativeMousePosition=function(s,r,p){var n=r.getBoundingClientRect(),c=document.documentElement||document.body.parentNode||document.body,o=window.pageXOffset!==void 0?window.pageXOffset:c.scrollLeft,t=window.pageYOffset!==void 0?window.pageYOffset:c.scrollTop,a=s.changedTouches,i,l;return a?(i=a[0].pageX-n.left-o,l=a[0].pageY-n.top-t):(i=s.pageX-n.left-o,l=s.pageY-n.top-t),{x:i/(r.clientWidth/(r.width||r.clientWidth)*p),y:l/(r.clientHeight/(r.height||r.clientHeight)*p)}}})()},function(B,H,v){var e={};B.exports=e;var f=v(0);(function(){e._registry={},e.register=function(s){if(e.isPlugin(s)||f.warn("Plugin.register:",e.toString(s),"does not implement all required fields."),s.name in e._registry){var r=e._registry[s.name],p=e.versionParse(s.version).number,n=e.versionParse(r.version).number;p>n?(f.warn("Plugin.register:",e.toString(r),"was upgraded to",e.toString(s)),e._registry[s.name]=s):p<n?f.warn("Plugin.register:",e.toString(r),"can not be downgraded to",e.toString(s)):s!==r&&f.warn("Plugin.register:",e.toString(s),"is already registered to different plugin object")}else e._registry[s.name]=s;return s},e.resolve=function(s){return e._registry[e.dependencyParse(s).name]},e.toString=function(s){return typeof s=="string"?s:(s.name||"anonymous")+"@"+(s.version||s.range||"0.0.0")},e.isPlugin=function(s){return s&&s.name&&s.version&&s.install},e.isUsed=function(s,r){return s.used.indexOf(r)>-1},e.isFor=function(s,r){var p=s.for&&e.dependencyParse(s.for);return!s.for||r.name===p.name&&e.versionSatisfies(r.version,p.range)},e.use=function(s,r){if(s.uses=(s.uses||[]).concat(r||[]),s.uses.length===0){f.warn("Plugin.use:",e.toString(s),"does not specify any dependencies to install.");return}for(var p=e.dependencies(s),n=f.topologicalSort(p),c=[],o=0;o<n.length;o+=1)if(n[o]!==s.name){var t=e.resolve(n[o]);if(!t){c.push("\u274C "+n[o]);continue}e.isUsed(s,t.name)||(e.isFor(t,s)||(f.warn("Plugin.use:",e.toString(t),"is for",t.for,"but installed on",e.toString(s)+"."),t._warned=!0),t.install?t.install(s):(f.warn("Plugin.use:",e.toString(t),"does not specify an install function."),t._warned=!0),t._warned?(c.push("\u{1F536} "+e.toString(t)),delete t._warned):c.push("\u2705 "+e.toString(t)),s.used.push(t.name))}c.length>0&&f.info(c.join("  "))},e.dependencies=function(s,r){var p=e.dependencyParse(s),n=p.name;if(r=r||{},!(n in r)){s=e.resolve(s)||s,r[n]=f.map(s.uses||[],function(o){e.isPlugin(o)&&e.register(o);var t=e.dependencyParse(o),a=e.resolve(o);return a&&!e.versionSatisfies(a.version,t.range)?(f.warn("Plugin.dependencies:",e.toString(a),"does not satisfy",e.toString(t),"used by",e.toString(p)+"."),a._warned=!0,s._warned=!0):a||(f.warn("Plugin.dependencies:",e.toString(o),"used by",e.toString(p),"could not be resolved."),s._warned=!0),t.name});for(var c=0;c<r[n].length;c+=1)e.dependencies(r[n][c],r);return r}},e.dependencyParse=function(s){if(f.isString(s)){var r=/^[\w-]+(@(\*|[\^~]?\d+\.\d+\.\d+(-[0-9A-Za-z-+]+)?))?$/;return r.test(s)||f.warn("Plugin.dependencyParse:",s,"is not a valid dependency string."),{name:s.split("@")[0],range:s.split("@")[1]||"*"}}return{name:s.name,range:s.range||s.version}},e.versionParse=function(s){var r=/^(\*)|(\^|~|>=|>)?\s*((\d+)\.(\d+)\.(\d+))(-[0-9A-Za-z-+]+)?$/;r.test(s)||f.warn("Plugin.versionParse:",s,"is not a valid version or range.");var p=r.exec(s),n=Number(p[4]),c=Number(p[5]),o=Number(p[6]);return{isRange:!!(p[1]||p[2]),version:p[3],range:s,operator:p[1]||p[2]||"",major:n,minor:c,patch:o,parts:[n,c,o],prerelease:p[7],number:n*1e8+c*1e4+o}},e.versionSatisfies=function(s,r){r=r||"*";var p=e.versionParse(r),n=e.versionParse(s);if(p.isRange){if(p.operator==="*"||s==="*")return!0;if(p.operator===">")return n.number>p.number;if(p.operator===">=")return n.number>=p.number;if(p.operator==="~")return n.major===p.major&&n.minor===p.minor&&n.patch>=p.patch;if(p.operator==="^")return p.major>0?n.major===p.major&&n.number>=p.number:p.minor>0?n.minor===p.minor&&n.patch>=p.patch:n.patch===p.patch}return s===r||s==="*"}})()},function(B,H){var v={};B.exports=v,function(){v.create=function(e){return{vertex:e,normalImpulse:0,tangentImpulse:0}}}()},function(B,H,v){var e={};B.exports=e;var f=v(7),s=v(18),r=v(13),p=v(19),n=v(5),c=v(6),o=v(10),t=v(0),a=v(4);(function(){e._deltaMax=1e3/60,e.create=function(i){i=i||{};var l={positionIterations:6,velocityIterations:4,constraintIterations:2,enableSleeping:!1,events:[],plugin:{},gravity:{x:0,y:1,scale:.001},timing:{timestamp:0,timeScale:1,lastDelta:0,lastElapsed:0,lastUpdatesPerFrame:0}},d=t.extend(l,i);return d.world=i.world||c.create({label:"World"}),d.pairs=i.pairs||p.create(),d.detector=i.detector||r.create(),d.detector.pairs=d.pairs,d.grid={buckets:[]},d.world.gravity=d.gravity,d.broadphase=d.grid,d.metrics={},d},e.update=function(i,l){var d=t.now(),x=i.world,C=i.detector,w=i.pairs,u=i.timing,h=u.timestamp,m;l>e._deltaMax&&t.warnOnce("Matter.Engine.update: delta argument is recommended to be less than or equal to",e._deltaMax.toFixed(3),"ms."),l=typeof l<"u"?l:t._baseDelta,l*=u.timeScale,u.timestamp+=l,u.lastDelta=l;var g={timestamp:u.timestamp,delta:l};n.trigger(i,"beforeUpdate",g);var S=c.allBodies(x),P=c.allConstraints(x);for(x.isModified&&(r.setBodies(C,S),c.setModified(x,!1,!1,!0)),i.enableSleeping&&f.update(S,l),e._bodiesApplyGravity(S,i.gravity),l>0&&e._bodiesUpdate(S,l),n.trigger(i,"beforeSolve",g),o.preSolveAll(S),m=0;m<i.constraintIterations;m++)o.solveAll(P,l);o.postSolveAll(S);var y=r.collisions(C);p.update(w,y,h),i.enableSleeping&&f.afterCollisions(w.list),w.collisionStart.length>0&&n.trigger(i,"collisionStart",{pairs:w.collisionStart,timestamp:u.timestamp,delta:l});var I=t.clamp(20/i.positionIterations,0,1);for(s.preSolvePosition(w.list),m=0;m<i.positionIterations;m++)s.solvePosition(w.list,l,I);for(s.postSolvePosition(S),o.preSolveAll(S),m=0;m<i.constraintIterations;m++)o.solveAll(P,l);for(o.postSolveAll(S),s.preSolveVelocity(w.list),m=0;m<i.velocityIterations;m++)s.solveVelocity(w.list,l);return e._bodiesUpdateVelocities(S),w.collisionActive.length>0&&n.trigger(i,"collisionActive",{pairs:w.collisionActive,timestamp:u.timestamp,delta:l}),w.collisionEnd.length>0&&n.trigger(i,"collisionEnd",{pairs:w.collisionEnd,timestamp:u.timestamp,delta:l}),e._bodiesClearForces(S),n.trigger(i,"afterUpdate",g),i.timing.lastElapsed=t.now()-d,i},e.merge=function(i,l){if(t.extend(i,l),l.world){i.world=l.world,e.clear(i);for(var d=c.allBodies(i.world),x=0;x<d.length;x++){var C=d[x];f.set(C,!1),C.id=t.nextId()}}},e.clear=function(i){p.clear(i.pairs),r.clear(i.detector)},e._bodiesClearForces=function(i){for(var l=i.length,d=0;d<l;d++){var x=i[d];x.force.x=0,x.force.y=0,x.torque=0}},e._bodiesApplyGravity=function(i,l){var d=typeof l.scale<"u"?l.scale:.001,x=i.length;if(!(l.x===0&&l.y===0||d===0))for(var C=0;C<x;C++){var w=i[C];w.isStatic||w.isSleeping||(w.force.y+=w.mass*l.y*d,w.force.x+=w.mass*l.x*d)}},e._bodiesUpdate=function(i,l){for(var d=i.length,x=0;x<d;x++){var C=i[x];C.isStatic||C.isSleeping||a.update(C,l)}},e._bodiesUpdateVelocities=function(i){for(var l=i.length,d=0;d<l;d++)a.updateVelocities(i[d])}})()},function(B,H,v){var e={};B.exports=e;var f=v(3),s=v(0),r=v(1);(function(){e._restingThresh=2,e._restingThreshTangent=Math.sqrt(6),e._positionDampen=.9,e._positionWarming=.8,e._frictionNormalMultiplier=5,e._frictionMaxStatic=Number.MAX_VALUE,e.preSolvePosition=function(p){var n,c,o,t=p.length;for(n=0;n<t;n++)c=p[n],c.isActive&&(o=c.contactCount,c.collision.parentA.totalContacts+=o,c.collision.parentB.totalContacts+=o)},e.solvePosition=function(p,n,c){var o,t,a,i,l,d,x,C,w=e._positionDampen*(c||1),u=s.clamp(n/s._baseDelta,0,1),h=p.length;for(o=0;o<h;o++)t=p[o],!(!t.isActive||t.isSensor)&&(a=t.collision,i=a.parentA,l=a.parentB,d=a.normal,t.separation=a.depth+d.x*(l.positionImpulse.x-i.positionImpulse.x)+d.y*(l.positionImpulse.y-i.positionImpulse.y));for(o=0;o<h;o++)t=p[o],!(!t.isActive||t.isSensor)&&(a=t.collision,i=a.parentA,l=a.parentB,d=a.normal,C=t.separation-t.slop*u,(i.isStatic||l.isStatic)&&(C*=2),i.isStatic||i.isSleeping||(x=w/i.totalContacts,i.positionImpulse.x+=d.x*C*x,i.positionImpulse.y+=d.y*C*x),l.isStatic||l.isSleeping||(x=w/l.totalContacts,l.positionImpulse.x-=d.x*C*x,l.positionImpulse.y-=d.y*C*x))},e.postSolvePosition=function(p){for(var n=e._positionWarming,c=p.length,o=f.translate,t=r.update,a=0;a<c;a++){var i=p[a],l=i.positionImpulse,d=l.x,x=l.y,C=i.velocity;if(i.totalContacts=0,d!==0||x!==0){for(var w=0;w<i.parts.length;w++){var u=i.parts[w];o(u.vertices,l),t(u.bounds,u.vertices,C),u.position.x+=d,u.position.y+=x}i.positionPrev.x+=d,i.positionPrev.y+=x,d*C.x+x*C.y<0?(l.x=0,l.y=0):(l.x*=n,l.y*=n)}}},e.preSolveVelocity=function(p){var n=p.length,c,o;for(c=0;c<n;c++){var t=p[c];if(!(!t.isActive||t.isSensor)){var a=t.contacts,i=t.contactCount,l=t.collision,d=l.parentA,x=l.parentB,C=l.normal,w=l.tangent;for(o=0;o<i;o++){var u=a[o],h=u.vertex,m=u.normalImpulse,g=u.tangentImpulse;if(m!==0||g!==0){var S=C.x*m+w.x*g,P=C.y*m+w.y*g;d.isStatic||d.isSleeping||(d.positionPrev.x+=S*d.inverseMass,d.positionPrev.y+=P*d.inverseMass,d.anglePrev+=d.inverseInertia*((h.x-d.position.x)*P-(h.y-d.position.y)*S)),x.isStatic||x.isSleeping||(x.positionPrev.x-=S*x.inverseMass,x.positionPrev.y-=P*x.inverseMass,x.anglePrev-=x.inverseInertia*((h.x-x.position.x)*P-(h.y-x.position.y)*S))}}}}},e.solveVelocity=function(p,n){var c=n/s._baseDelta,o=c*c,t=o*c,a=-e._restingThresh*c,i=e._restingThreshTangent,l=e._frictionNormalMultiplier*c,d=e._frictionMaxStatic,x=p.length,C,w,u,h;for(u=0;u<x;u++){var m=p[u];if(!(!m.isActive||m.isSensor)){var g=m.collision,S=g.parentA,P=g.parentB,y=g.normal.x,I=g.normal.y,M=g.tangent.x,E=g.tangent.y,k=m.inverseMass,b=m.friction*m.frictionStatic*l,F=m.contacts,O=m.contactCount,z=1/O,G=S.position.x-S.positionPrev.x,K=S.position.y-S.positionPrev.y,X=S.angle-S.anglePrev,Y=P.position.x-P.positionPrev.x,ie=P.position.y-P.positionPrev.y,_=P.angle-P.anglePrev;for(h=0;h<O;h++){var W=F[h],te=W.vertex,$=te.x-S.position.x,ue=te.y-S.position.y,ne=te.x-P.position.x,ee=te.y-P.position.y,q=G-ue*X,Me=K+$*X,Se=Y-ee*_,we=ie+ne*_,ce=q-Se,Q=Me-we,J=y*ce+I*Q,Z=M*ce+E*Q,ve=m.separation+J,ae=Math.min(ve,1);ae=ve<0?0:ae;var pe=ae*b;Z<-pe||Z>pe?(w=Z>0?Z:-Z,C=m.friction*(Z>0?1:-1)*t,C<-w?C=-w:C>w&&(C=w)):(C=Z,w=d);var le=$*I-ue*y,re=ne*I-ee*y,fe=z/(k+S.inverseInertia*le*le+P.inverseInertia*re*re),oe=(1+m.restitution)*J*fe;if(C*=fe,J<a)W.normalImpulse=0;else{var me=W.normalImpulse;W.normalImpulse+=oe,W.normalImpulse>0&&(W.normalImpulse=0),oe=W.normalImpulse-me}if(Z<-i||Z>i)W.tangentImpulse=0;else{var de=W.tangentImpulse;W.tangentImpulse+=C,W.tangentImpulse<-w&&(W.tangentImpulse=-w),W.tangentImpulse>w&&(W.tangentImpulse=w),C=W.tangentImpulse-de}var se=y*oe+M*C,ge=I*oe+E*C;S.isStatic||S.isSleeping||(S.positionPrev.x+=se*S.inverseMass,S.positionPrev.y+=ge*S.inverseMass,S.anglePrev+=($*ge-ue*se)*S.inverseInertia),P.isStatic||P.isSleeping||(P.positionPrev.x-=se*P.inverseMass,P.positionPrev.y-=ge*P.inverseMass,P.anglePrev-=(ne*ge-ee*se)*P.inverseInertia)}}}}})()},function(B,H,v){var e={};B.exports=e;var f=v(9),s=v(0);(function(){e.create=function(r){return s.extend({table:{},list:[],collisionStart:[],collisionActive:[],collisionEnd:[]},r)},e.update=function(r,p,n){var c=f.update,o=f.create,t=f.setActive,a=r.table,i=r.list,l=i.length,d=l,x=r.collisionStart,C=r.collisionEnd,w=r.collisionActive,u=p.length,h=0,m=0,g=0,S,P,y;for(y=0;y<u;y++)S=p[y],P=S.pair,P?(P.isActive&&(w[g++]=P),c(P,S,n)):(P=o(S,n),a[P.id]=P,x[h++]=P,i[d++]=P);for(d=0,l=i.length,y=0;y<l;y++)P=i[y],P.timeUpdated>=n?i[d++]=P:(t(P,!1,n),P.collision.bodyA.sleepCounter>0&&P.collision.bodyB.sleepCounter>0?i[d++]=P:(C[m++]=P,delete a[P.id]));i.length!==d&&(i.length=d),x.length!==h&&(x.length=h),C.length!==m&&(C.length=m),w.length!==g&&(w.length=g)},e.clear=function(r){return r.table={},r.list.length=0,r.collisionStart.length=0,r.collisionActive.length=0,r.collisionEnd.length=0,r}})()},function(B,H,v){var e=B.exports=v(21);e.Axes=v(11),e.Bodies=v(12),e.Body=v(4),e.Bounds=v(1),e.Collision=v(8),e.Common=v(0),e.Composite=v(6),e.Composites=v(22),e.Constraint=v(10),e.Contact=v(16),e.Detector=v(13),e.Engine=v(17),e.Events=v(5),e.Grid=v(23),e.Mouse=v(14),e.MouseConstraint=v(24),e.Pair=v(9),e.Pairs=v(19),e.Plugin=v(15),e.Query=v(25),e.Render=v(26),e.Resolver=v(18),e.Runner=v(27),e.SAT=v(28),e.Sleeping=v(7),e.Svg=v(29),e.Vector=v(2),e.Vertices=v(3),e.World=v(30),e.Engine.run=e.Runner.run,e.Common.deprecated(e.Engine,"run","Engine.run \u27A4 use Matter.Runner.run(engine) instead")},function(B,H,v){var e={};B.exports=e;var f=v(15),s=v(0);(function(){e.name="matter-js",e.version="0.20.0",e.uses=[],e.used=[],e.use=function(){f.use(e,Array.prototype.slice.call(arguments))},e.before=function(r,p){return r=r.replace(/^Matter./,""),s.chainPathBefore(e,r,p)},e.after=function(r,p){return r=r.replace(/^Matter./,""),s.chainPathAfter(e,r,p)}})()},function(B,H,v){var e={};B.exports=e;var f=v(6),s=v(10),r=v(0),p=v(4),n=v(12),c=r.deprecated;(function(){e.stack=function(o,t,a,i,l,d,x){for(var C=f.create({label:"Stack"}),w=o,u=t,h,m=0,g=0;g<i;g++){for(var S=0,P=0;P<a;P++){var y=x(w,u,P,g,h,m);if(y){var I=y.bounds.max.y-y.bounds.min.y,M=y.bounds.max.x-y.bounds.min.x;I>S&&(S=I),p.translate(y,{x:M*.5,y:I*.5}),w=y.bounds.max.x+l,f.addBody(C,y),h=y,m+=1}else w+=l}u+=S+d,w=o}return C},e.chain=function(o,t,a,i,l,d){for(var x=o.bodies,C=1;C<x.length;C++){var w=x[C-1],u=x[C],h=w.bounds.max.y-w.bounds.min.y,m=w.bounds.max.x-w.bounds.min.x,g=u.bounds.max.y-u.bounds.min.y,S=u.bounds.max.x-u.bounds.min.x,P={bodyA:w,pointA:{x:m*t,y:h*a},bodyB:u,pointB:{x:S*i,y:g*l}},y=r.extend(P,d);f.addConstraint(o,s.create(y))}return o.label+=" Chain",o},e.mesh=function(o,t,a,i,l){var d=o.bodies,x,C,w,u,h;for(x=0;x<a;x++){for(C=1;C<t;C++)w=d[C-1+x*t],u=d[C+x*t],f.addConstraint(o,s.create(r.extend({bodyA:w,bodyB:u},l)));if(x>0)for(C=0;C<t;C++)w=d[C+(x-1)*t],u=d[C+x*t],f.addConstraint(o,s.create(r.extend({bodyA:w,bodyB:u},l))),i&&C>0&&(h=d[C-1+(x-1)*t],f.addConstraint(o,s.create(r.extend({bodyA:h,bodyB:u},l)))),i&&C<t-1&&(h=d[C+1+(x-1)*t],f.addConstraint(o,s.create(r.extend({bodyA:h,bodyB:u},l))))}return o.label+=" Mesh",o},e.pyramid=function(o,t,a,i,l,d,x){return e.stack(o,t,a,i,l,d,function(C,w,u,h,m,g){var S=Math.min(i,Math.ceil(a/2)),P=m?m.bounds.max.x-m.bounds.min.x:0;if(!(h>S)){h=S-h;var y=h,I=a-1-h;if(!(u<y||u>I)){g===1&&p.translate(m,{x:(u+(a%2===1?1:-1))*P,y:0});var M=m?u*P:0;return x(o+M+u*l,w,u,h,m,g)}}})},e.newtonsCradle=function(o,t,a,i,l){for(var d=f.create({label:"Newtons Cradle"}),x=0;x<a;x++){var C=1.9,w=n.circle(o+x*(i*C),t+l,i,{inertia:1/0,restitution:1,friction:0,frictionAir:1e-4,slop:1}),u=s.create({pointA:{x:o+x*(i*C),y:t},bodyB:w});f.addBody(d,w),f.addConstraint(d,u)}return d},c(e,"newtonsCradle","Composites.newtonsCradle \u27A4 moved to newtonsCradle example"),e.car=function(o,t,a,i,l){var d=p.nextGroup(!0),x=20,C=-a*.5+x,w=a*.5-x,u=0,h=f.create({label:"Car"}),m=n.rectangle(o,t,a,i,{collisionFilter:{group:d},chamfer:{radius:i*.5},density:2e-4}),g=n.circle(o+C,t+u,l,{collisionFilter:{group:d},friction:.8}),S=n.circle(o+w,t+u,l,{collisionFilter:{group:d},friction:.8}),P=s.create({bodyB:m,pointB:{x:C,y:u},bodyA:g,stiffness:1,length:0}),y=s.create({bodyB:m,pointB:{x:w,y:u},bodyA:S,stiffness:1,length:0});return f.addBody(h,m),f.addBody(h,g),f.addBody(h,S),f.addConstraint(h,P),f.addConstraint(h,y),h},c(e,"car","Composites.car \u27A4 moved to car example"),e.softBody=function(o,t,a,i,l,d,x,C,w,u){w=r.extend({inertia:1/0},w),u=r.extend({stiffness:.2,render:{type:"line",anchors:!1}},u);var h=e.stack(o,t,a,i,l,d,function(m,g){return n.circle(m,g,C,w)});return e.mesh(h,a,i,x,u),h.label="Soft Body",h},c(e,"softBody","Composites.softBody \u27A4 moved to softBody and cloth examples")})()},function(B,H,v){var e={};B.exports=e;var f=v(9),s=v(0),r=s.deprecated;(function(){e.create=function(p){var n={buckets:{},pairs:{},pairsList:[],bucketWidth:48,bucketHeight:48};return s.extend(n,p)},e.update=function(p,n,c,o){var t,a,i,l=c.world,d=p.buckets,x,C,w=!1;for(t=0;t<n.length;t++){var u=n[t];if(!(u.isSleeping&&!o)&&!(l.bounds&&(u.bounds.max.x<l.bounds.min.x||u.bounds.min.x>l.bounds.max.x||u.bounds.max.y<l.bounds.min.y||u.bounds.min.y>l.bounds.max.y))){var h=e._getRegion(p,u);if(!u.region||h.id!==u.region.id||o){(!u.region||o)&&(u.region=h);var m=e._regionUnion(h,u.region);for(a=m.startCol;a<=m.endCol;a++)for(i=m.startRow;i<=m.endRow;i++){C=e._getBucketId(a,i),x=d[C];var g=a>=h.startCol&&a<=h.endCol&&i>=h.startRow&&i<=h.endRow,S=a>=u.region.startCol&&a<=u.region.endCol&&i>=u.region.startRow&&i<=u.region.endRow;!g&&S&&S&&x&&e._bucketRemoveBody(p,x,u),(u.region===h||g&&!S||o)&&(x||(x=e._createBucket(d,C)),e._bucketAddBody(p,x,u))}u.region=h,w=!0}}}w&&(p.pairsList=e._createActivePairsList(p))},r(e,"update","Grid.update \u27A4 replaced by Matter.Detector"),e.clear=function(p){p.buckets={},p.pairs={},p.pairsList=[]},r(e,"clear","Grid.clear \u27A4 replaced by Matter.Detector"),e._regionUnion=function(p,n){var c=Math.min(p.startCol,n.startCol),o=Math.max(p.endCol,n.endCol),t=Math.min(p.startRow,n.startRow),a=Math.max(p.endRow,n.endRow);return e._createRegion(c,o,t,a)},e._getRegion=function(p,n){var c=n.bounds,o=Math.floor(c.min.x/p.bucketWidth),t=Math.floor(c.max.x/p.bucketWidth),a=Math.floor(c.min.y/p.bucketHeight),i=Math.floor(c.max.y/p.bucketHeight);return e._createRegion(o,t,a,i)},e._createRegion=function(p,n,c,o){return{id:p+","+n+","+c+","+o,startCol:p,endCol:n,startRow:c,endRow:o}},e._getBucketId=function(p,n){return"C"+p+"R"+n},e._createBucket=function(p,n){var c=p[n]=[];return c},e._bucketAddBody=function(p,n,c){var o=p.pairs,t=f.id,a=n.length,i;for(i=0;i<a;i++){var l=n[i];if(!(c.id===l.id||c.isStatic&&l.isStatic)){var d=t(c,l),x=o[d];x?x[2]+=1:o[d]=[c,l,1]}}n.push(c)},e._bucketRemoveBody=function(p,n,c){var o=p.pairs,t=f.id,a;n.splice(s.indexOf(n,c),1);var i=n.length;for(a=0;a<i;a++){var l=o[t(c,n[a])];l&&(l[2]-=1)}},e._createActivePairsList=function(p){var n,c=p.pairs,o=s.keys(c),t=o.length,a=[],i;for(i=0;i<t;i++)n=c[o[i]],n[2]>0?a.push(n):delete c[o[i]];return a}})()},function(B,H,v){var e={};B.exports=e;var f=v(3),s=v(7),r=v(14),p=v(5),n=v(13),c=v(10),o=v(6),t=v(0),a=v(1);(function(){e.create=function(i,l){var d=(i?i.mouse:null)||(l?l.mouse:null);d||(i&&i.render&&i.render.canvas?d=r.create(i.render.canvas):l&&l.element?d=r.create(l.element):(d=r.create(),t.warn("MouseConstraint.create: options.mouse was undefined, options.element was undefined, may not function as expected")));var x=c.create({label:"Mouse Constraint",pointA:d.position,pointB:{x:0,y:0},length:.01,stiffness:.1,angularStiffness:1,render:{strokeStyle:"#90EE90",lineWidth:3}}),C={type:"mouseConstraint",mouse:d,element:null,body:null,constraint:x,collisionFilter:{category:1,mask:4294967295,group:0}},w=t.extend(C,l);return p.on(i,"beforeUpdate",function(){var u=o.allBodies(i.world);e.update(w,u),e._triggerEvents(w)}),w},e.update=function(i,l){var d=i.mouse,x=i.constraint,C=i.body;if(d.button===0){if(x.bodyB)s.set(x.bodyB,!1),x.pointA=d.position;else for(var w=0;w<l.length;w++)if(C=l[w],a.contains(C.bounds,d.position)&&n.canCollide(C.collisionFilter,i.collisionFilter))for(var u=C.parts.length>1?1:0;u<C.parts.length;u++){var h=C.parts[u];if(f.contains(h.vertices,d.position)){x.pointA=d.position,x.bodyB=i.body=C,x.pointB={x:d.position.x-C.position.x,y:d.position.y-C.position.y},x.angleB=C.angle,s.set(C,!1),p.trigger(i,"startdrag",{mouse:d,body:C});break}}}else x.bodyB=i.body=null,x.pointB=null,C&&p.trigger(i,"enddrag",{mouse:d,body:C})},e._triggerEvents=function(i){var l=i.mouse,d=l.sourceEvents;d.mousemove&&p.trigger(i,"mousemove",{mouse:l}),d.mousedown&&p.trigger(i,"mousedown",{mouse:l}),d.mouseup&&p.trigger(i,"mouseup",{mouse:l}),r.clearSourceEvents(l)}})()},function(B,H,v){var e={};B.exports=e;var f=v(2),s=v(8),r=v(1),p=v(12),n=v(3);(function(){e.collides=function(c,o){for(var t=[],a=o.length,i=c.bounds,l=s.collides,d=r.overlaps,x=0;x<a;x++){var C=o[x],w=C.parts.length,u=w===1?0:1;if(d(C.bounds,i))for(var h=u;h<w;h++){var m=C.parts[h];if(d(m.bounds,i)){var g=l(m,c);if(g){t.push(g);break}}}}return t},e.ray=function(c,o,t,a){a=a||1e-100;for(var i=f.angle(o,t),l=f.magnitude(f.sub(o,t)),d=(t.x+o.x)*.5,x=(t.y+o.y)*.5,C=p.rectangle(d,x,l,a,{angle:i}),w=e.collides(C,c),u=0;u<w.length;u+=1){var h=w[u];h.body=h.bodyB=h.bodyA}return w},e.region=function(c,o,t){for(var a=[],i=0;i<c.length;i++){var l=c[i],d=r.overlaps(l.bounds,o);(d&&!t||!d&&t)&&a.push(l)}return a},e.point=function(c,o){for(var t=[],a=0;a<c.length;a++){var i=c[a];if(r.contains(i.bounds,o))for(var l=i.parts.length===1?0:1;l<i.parts.length;l++){var d=i.parts[l];if(r.contains(d.bounds,o)&&n.contains(d.vertices,o)){t.push(i);break}}}return t}})()},function(B,H,v){var e={};B.exports=e;var f=v(4),s=v(0),r=v(6),p=v(1),n=v(5),c=v(2),o=v(14);(function(){var t,a;typeof window<"u"&&(t=window.requestAnimationFrame||window.webkitRequestAnimationFrame||window.mozRequestAnimationFrame||window.msRequestAnimationFrame||function(u){window.setTimeout(function(){u(s.now())},1e3/60)},a=window.cancelAnimationFrame||window.mozCancelAnimationFrame||window.webkitCancelAnimationFrame||window.msCancelAnimationFrame),e._goodFps=30,e._goodDelta=1e3/60,e.create=function(u){var h={engine:null,element:null,canvas:null,mouse:null,frameRequestId:null,timing:{historySize:60,delta:0,deltaHistory:[],lastTime:0,lastTimestamp:0,lastElapsed:0,timestampElapsed:0,timestampElapsedHistory:[],engineDeltaHistory:[],engineElapsedHistory:[],engineUpdatesHistory:[],elapsedHistory:[]},options:{width:800,height:600,pixelRatio:1,background:"#14151f",wireframeBackground:"#14151f",wireframeStrokeStyle:"#bbb",hasBounds:!!u.bounds,enabled:!0,wireframes:!0,showSleeping:!0,showDebug:!1,showStats:!1,showPerformance:!1,showBounds:!1,showVelocity:!1,showCollisions:!1,showSeparations:!1,showAxes:!1,showPositions:!1,showAngleIndicator:!1,showIds:!1,showVertexNumbers:!1,showConvexHulls:!1,showInternalEdges:!1,showMousePosition:!1}},m=s.extend(h,u);return m.canvas&&(m.canvas.width=m.options.width||m.canvas.width,m.canvas.height=m.options.height||m.canvas.height),m.mouse=u.mouse,m.engine=u.engine,m.canvas=m.canvas||d(m.options.width,m.options.height),m.context=m.canvas.getContext("2d"),m.textures={},m.bounds=m.bounds||{min:{x:0,y:0},max:{x:m.canvas.width,y:m.canvas.height}},m.controller=e,m.options.showBroadphase=!1,m.options.pixelRatio!==1&&e.setPixelRatio(m,m.options.pixelRatio),s.isElement(m.element)&&m.element.appendChild(m.canvas),m},e.run=function(u){(function h(m){u.frameRequestId=t(h),i(u,m),e.world(u,m),u.context.setTransform(u.options.pixelRatio,0,0,u.options.pixelRatio,0,0),(u.options.showStats||u.options.showDebug)&&e.stats(u,u.context,m),(u.options.showPerformance||u.options.showDebug)&&e.performance(u,u.context,m),u.context.setTransform(1,0,0,1,0,0)})()},e.stop=function(u){a(u.frameRequestId)},e.setPixelRatio=function(u,h){var m=u.options,g=u.canvas;h==="auto"&&(h=x(g)),m.pixelRatio=h,g.setAttribute("data-pixel-ratio",h),g.width=m.width*h,g.height=m.height*h,g.style.width=m.width+"px",g.style.height=m.height+"px"},e.setSize=function(u,h,m){u.options.width=h,u.options.height=m,u.bounds.max.x=u.bounds.min.x+h,u.bounds.max.y=u.bounds.min.y+m,u.options.pixelRatio!==1?e.setPixelRatio(u,u.options.pixelRatio):(u.canvas.width=h,u.canvas.height=m)},e.lookAt=function(u,h,m,g){g=typeof g<"u"?g:!0,h=s.isArray(h)?h:[h],m=m||{x:0,y:0};for(var S={min:{x:1/0,y:1/0},max:{x:-1/0,y:-1/0}},P=0;P<h.length;P+=1){var y=h[P],I=y.bounds?y.bounds.min:y.min||y.position||y,M=y.bounds?y.bounds.max:y.max||y.position||y;I&&M&&(I.x<S.min.x&&(S.min.x=I.x),M.x>S.max.x&&(S.max.x=M.x),I.y<S.min.y&&(S.min.y=I.y),M.y>S.max.y&&(S.max.y=M.y))}var E=S.max.x-S.min.x+2*m.x,k=S.max.y-S.min.y+2*m.y,b=u.canvas.height,F=u.canvas.width,O=F/b,z=E/k,G=1,K=1;z>O?K=z/O:G=O/z,u.options.hasBounds=!0,u.bounds.min.x=S.min.x,u.bounds.max.x=S.min.x+E*G,u.bounds.min.y=S.min.y,u.bounds.max.y=S.min.y+k*K,g&&(u.bounds.min.x+=E*.5-E*G*.5,u.bounds.max.x+=E*.5-E*G*.5,u.bounds.min.y+=k*.5-k*K*.5,u.bounds.max.y+=k*.5-k*K*.5),u.bounds.min.x-=m.x,u.bounds.max.x-=m.x,u.bounds.min.y-=m.y,u.bounds.max.y-=m.y,u.mouse&&(o.setScale(u.mouse,{x:(u.bounds.max.x-u.bounds.min.x)/u.canvas.width,y:(u.bounds.max.y-u.bounds.min.y)/u.canvas.height}),o.setOffset(u.mouse,u.bounds.min))},e.startViewTransform=function(u){var h=u.bounds.max.x-u.bounds.min.x,m=u.bounds.max.y-u.bounds.min.y,g=h/u.options.width,S=m/u.options.height;u.context.setTransform(u.options.pixelRatio/g,0,0,u.options.pixelRatio/S,0,0),u.context.translate(-u.bounds.min.x,-u.bounds.min.y)},e.endViewTransform=function(u){u.context.setTransform(u.options.pixelRatio,0,0,u.options.pixelRatio,0,0)},e.world=function(u,h){var m=s.now(),g=u.engine,S=g.world,P=u.canvas,y=u.context,I=u.options,M=u.timing,E=r.allBodies(S),k=r.allConstraints(S),b=I.wireframes?I.wireframeBackground:I.background,F=[],O=[],z,G={timestamp:g.timing.timestamp};if(n.trigger(u,"beforeRender",G),u.currentBackground!==b&&w(u,b),y.globalCompositeOperation="source-in",y.fillStyle="transparent",y.fillRect(0,0,P.width,P.height),y.globalCompositeOperation="source-over",I.hasBounds){for(z=0;z<E.length;z++){var K=E[z];p.overlaps(K.bounds,u.bounds)&&F.push(K)}for(z=0;z<k.length;z++){var X=k[z],Y=X.bodyA,ie=X.bodyB,_=X.pointA,W=X.pointB;Y&&(_=c.add(Y.position,X.pointA)),ie&&(W=c.add(ie.position,X.pointB)),!(!_||!W)&&(p.contains(u.bounds,_)||p.contains(u.bounds,W))&&O.push(X)}e.startViewTransform(u),u.mouse&&(o.setScale(u.mouse,{x:(u.bounds.max.x-u.bounds.min.x)/u.options.width,y:(u.bounds.max.y-u.bounds.min.y)/u.options.height}),o.setOffset(u.mouse,u.bounds.min))}else O=k,F=E,u.options.pixelRatio!==1&&u.context.setTransform(u.options.pixelRatio,0,0,u.options.pixelRatio,0,0);!I.wireframes||g.enableSleeping&&I.showSleeping?e.bodies(u,F,y):(I.showConvexHulls&&e.bodyConvexHulls(u,F,y),e.bodyWireframes(u,F,y)),I.showBounds&&e.bodyBounds(u,F,y),(I.showAxes||I.showAngleIndicator)&&e.bodyAxes(u,F,y),I.showPositions&&e.bodyPositions(u,F,y),I.showVelocity&&e.bodyVelocity(u,F,y),I.showIds&&e.bodyIds(u,F,y),I.showSeparations&&e.separations(u,g.pairs.list,y),I.showCollisions&&e.collisions(u,g.pairs.list,y),I.showVertexNumbers&&e.vertexNumbers(u,F,y),I.showMousePosition&&e.mousePosition(u,u.mouse,y),e.constraints(O,y),I.hasBounds&&e.endViewTransform(u),n.trigger(u,"afterRender",G),M.lastElapsed=s.now()-m},e.stats=function(u,h,m){for(var g=u.engine,S=g.world,P=r.allBodies(S),y=0,I=55,M=44,E=0,k=0,b=0;b<P.length;b+=1)y+=P[b].parts.length;var F={Part:y,Body:P.length,Cons:r.allConstraints(S).length,Comp:r.allComposites(S).length,Pair:g.pairs.list.length};h.fillStyle="#0e0f19",h.fillRect(E,k,I*5.5,M),h.font="12px Arial",h.textBaseline="top",h.textAlign="right";for(var O in F){var z=F[O];h.fillStyle="#aaa",h.fillText(O,E+I,k+8),h.fillStyle="#eee",h.fillText(z,E+I,k+26),E+=I}},e.performance=function(u,h){var m=u.engine,g=u.timing,S=g.deltaHistory,P=g.elapsedHistory,y=g.timestampElapsedHistory,I=g.engineDeltaHistory,M=g.engineUpdatesHistory,E=g.engineElapsedHistory,k=m.timing.lastUpdatesPerFrame,b=m.timing.lastDelta,F=l(S),O=l(P),z=l(I),G=l(M),K=l(E),X=l(y),Y=X/F||0,ie=Math.round(F/b),_=1e3/F||0,W=4,te=12,$=60,ue=34,ne=10,ee=69;h.fillStyle="#0e0f19",h.fillRect(0,50,te*5+$*6+22,ue),e.status(h,ne,ee,$,W,S.length,Math.round(_)+" fps",_/e._goodFps,function(q){return S[q]/F-1}),e.status(h,ne+te+$,ee,$,W,I.length,b.toFixed(2)+" dt",e._goodDelta/b,function(q){return I[q]/z-1}),e.status(h,ne+(te+$)*2,ee,$,W,M.length,k+" upf",Math.pow(s.clamp(G/ie||1,0,1),4),function(q){return M[q]/G-1}),e.status(h,ne+(te+$)*3,ee,$,W,E.length,K.toFixed(2)+" ut",1-k*K/e._goodFps,function(q){return E[q]/K-1}),e.status(h,ne+(te+$)*4,ee,$,W,P.length,O.toFixed(2)+" rt",1-O/e._goodFps,function(q){return P[q]/O-1}),e.status(h,ne+(te+$)*5,ee,$,W,y.length,Y.toFixed(2)+" x",Y*Y*Y,function(q){return(y[q]/S[q]/Y||0)-1})},e.status=function(u,h,m,g,S,P,y,I,M){u.strokeStyle="#888",u.fillStyle="#444",u.lineWidth=1,u.fillRect(h,m+7,g,1),u.beginPath(),u.moveTo(h,m+7-S*s.clamp(.4*M(0),-2,2));for(var E=0;E<g;E+=1)u.lineTo(h+E,m+7-(E<P?S*s.clamp(.4*M(E),-2,2):0));u.stroke(),u.fillStyle="hsl("+s.clamp(25+95*I,0,120)+",100%,60%)",u.fillRect(h,m-7,4,4),u.font="12px Arial",u.textBaseline="middle",u.textAlign="right",u.fillStyle="#eee",u.fillText(y,h+g,m-5)},e.constraints=function(u,h){for(var m=h,g=0;g<u.length;g++){var S=u[g];if(!(!S.render.visible||!S.pointA||!S.pointB)){var P=S.bodyA,y=S.bodyB,I,M;if(P?I=c.add(P.position,S.pointA):I=S.pointA,S.render.type==="pin")m.beginPath(),m.arc(I.x,I.y,3,0,2*Math.PI),m.closePath();else{if(y?M=c.add(y.position,S.pointB):M=S.pointB,m.beginPath(),m.moveTo(I.x,I.y),S.render.type==="spring")for(var E=c.sub(M,I),k=c.perp(c.normalise(E)),b=Math.ceil(s.clamp(S.length/5,12,20)),F,O=1;O<b;O+=1)F=O%2===0?1:-1,m.lineTo(I.x+E.x*(O/b)+k.x*F*4,I.y+E.y*(O/b)+k.y*F*4);m.lineTo(M.x,M.y)}S.render.lineWidth&&(m.lineWidth=S.render.lineWidth,m.strokeStyle=S.render.strokeStyle,m.stroke()),S.render.anchors&&(m.fillStyle=S.render.strokeStyle,m.beginPath(),m.arc(I.x,I.y,3,0,2*Math.PI),m.arc(M.x,M.y,3,0,2*Math.PI),m.closePath(),m.fill())}}},e.bodies=function(u,h,m){var g=m,S=u.engine,P=u.options,y=P.showInternalEdges||!P.wireframes,I,M,E,k;for(E=0;E<h.length;E++)if(I=h[E],!!I.render.visible){for(k=I.parts.length>1?1:0;k<I.parts.length;k++)if(M=I.parts[k],!!M.render.visible){if(P.showSleeping&&I.isSleeping?g.globalAlpha=.5*M.render.opacity:M.render.opacity!==1&&(g.globalAlpha=M.render.opacity),M.render.sprite&&M.render.sprite.texture&&!P.wireframes){var b=M.render.sprite,F=C(u,b.texture);g.translate(M.position.x,M.position.y),g.rotate(M.angle),g.drawImage(F,F.width*-b.xOffset*b.xScale,F.height*-b.yOffset*b.yScale,F.width*b.xScale,F.height*b.yScale),g.rotate(-M.angle),g.translate(-M.position.x,-M.position.y)}else{if(M.circleRadius)g.beginPath(),g.arc(M.position.x,M.position.y,M.circleRadius,0,2*Math.PI);else{g.beginPath(),g.moveTo(M.vertices[0].x,M.vertices[0].y);for(var O=1;O<M.vertices.length;O++)!M.vertices[O-1].isInternal||y?g.lineTo(M.vertices[O].x,M.vertices[O].y):g.moveTo(M.vertices[O].x,M.vertices[O].y),M.vertices[O].isInternal&&!y&&g.moveTo(M.vertices[(O+1)%M.vertices.length].x,M.vertices[(O+1)%M.vertices.length].y);g.lineTo(M.vertices[0].x,M.vertices[0].y),g.closePath()}P.wireframes?(g.lineWidth=1,g.strokeStyle=u.options.wireframeStrokeStyle,g.stroke()):(g.fillStyle=M.render.fillStyle,M.render.lineWidth&&(g.lineWidth=M.render.lineWidth,g.strokeStyle=M.render.strokeStyle,g.stroke()),g.fill())}g.globalAlpha=1}}},e.bodyWireframes=function(u,h,m){var g=m,S=u.options.showInternalEdges,P,y,I,M,E;for(g.beginPath(),I=0;I<h.length;I++)if(P=h[I],!!P.render.visible)for(E=P.parts.length>1?1:0;E<P.parts.length;E++){for(y=P.parts[E],g.moveTo(y.vertices[0].x,y.vertices[0].y),M=1;M<y.vertices.length;M++)!y.vertices[M-1].isInternal||S?g.lineTo(y.vertices[M].x,y.vertices[M].y):g.moveTo(y.vertices[M].x,y.vertices[M].y),y.vertices[M].isInternal&&!S&&g.moveTo(y.vertices[(M+1)%y.vertices.length].x,y.vertices[(M+1)%y.vertices.length].y);g.lineTo(y.vertices[0].x,y.vertices[0].y)}g.lineWidth=1,g.strokeStyle=u.options.wireframeStrokeStyle,g.stroke()},e.bodyConvexHulls=function(u,h,m){var g=m,S,P,y,I,M;for(g.beginPath(),y=0;y<h.length;y++)if(S=h[y],!(!S.render.visible||S.parts.length===1)){for(g.moveTo(S.vertices[0].x,S.vertices[0].y),I=1;I<S.vertices.length;I++)g.lineTo(S.vertices[I].x,S.vertices[I].y);g.lineTo(S.vertices[0].x,S.vertices[0].y)}g.lineWidth=1,g.strokeStyle="rgba(255,255,255,0.2)",g.stroke()},e.vertexNumbers=function(u,h,m){var g=m,S,P,y;for(S=0;S<h.length;S++){var I=h[S].parts;for(y=I.length>1?1:0;y<I.length;y++){var M=I[y];for(P=0;P<M.vertices.length;P++)g.fillStyle="rgba(255,255,255,0.2)",g.fillText(S+"_"+P,M.position.x+(M.vertices[P].x-M.position.x)*.8,M.position.y+(M.vertices[P].y-M.position.y)*.8)}}},e.mousePosition=function(u,h,m){var g=m;g.fillStyle="rgba(255,255,255,0.8)",g.fillText(h.position.x+"  "+h.position.y,h.position.x+5,h.position.y-5)},e.bodyBounds=function(u,h,m){var g=m,S=u.engine,P=u.options;g.beginPath();for(var y=0;y<h.length;y++){var I=h[y];if(I.render.visible)for(var M=h[y].parts,E=M.length>1?1:0;E<M.length;E++){var k=M[E];g.rect(k.bounds.min.x,k.bounds.min.y,k.bounds.max.x-k.bounds.min.x,k.bounds.max.y-k.bounds.min.y)}}P.wireframes?g.strokeStyle="rgba(255,255,255,0.08)":g.strokeStyle="rgba(0,0,0,0.1)",g.lineWidth=1,g.stroke()},e.bodyAxes=function(u,h,m){var g=m,S=u.engine,P=u.options,y,I,M,E;for(g.beginPath(),I=0;I<h.length;I++){var k=h[I],b=k.parts;if(k.render.visible)if(P.showAxes)for(M=b.length>1?1:0;M<b.length;M++)for(y=b[M],E=0;E<y.axes.length;E++){var F=y.axes[E];g.moveTo(y.position.x,y.position.y),g.lineTo(y.position.x+F.x*20,y.position.y+F.y*20)}else for(M=b.length>1?1:0;M<b.length;M++)for(y=b[M],E=0;E<y.axes.length;E++)g.moveTo(y.position.x,y.position.y),g.lineTo((y.vertices[0].x+y.vertices[y.vertices.length-1].x)/2,(y.vertices[0].y+y.vertices[y.vertices.length-1].y)/2)}P.wireframes?(g.strokeStyle="indianred",g.lineWidth=1):(g.strokeStyle="rgba(255, 255, 255, 0.4)",g.globalCompositeOperation="overlay",g.lineWidth=2),g.stroke(),g.globalCompositeOperation="source-over"},e.bodyPositions=function(u,h,m){var g=m,S=u.engine,P=u.options,y,I,M,E;for(g.beginPath(),M=0;M<h.length;M++)if(y=h[M],!!y.render.visible)for(E=0;E<y.parts.length;E++)I=y.parts[E],g.arc(I.position.x,I.position.y,3,0,2*Math.PI,!1),g.closePath();for(P.wireframes?g.fillStyle="indianred":g.fillStyle="rgba(0,0,0,0.5)",g.fill(),g.beginPath(),M=0;M<h.length;M++)y=h[M],y.render.visible&&(g.arc(y.positionPrev.x,y.positionPrev.y,2,0,2*Math.PI,!1),g.closePath());g.fillStyle="rgba(255,165,0,0.8)",g.fill()},e.bodyVelocity=function(u,h,m){var g=m;g.beginPath();for(var S=0;S<h.length;S++){var P=h[S];if(P.render.visible){var y=f.getVelocity(P);g.moveTo(P.position.x,P.position.y),g.lineTo(P.position.x+y.x,P.position.y+y.y)}}g.lineWidth=3,g.strokeStyle="cornflowerblue",g.stroke()},e.bodyIds=function(u,h,m){var g=m,S,P;for(S=0;S<h.length;S++)if(h[S].render.visible){var y=h[S].parts;for(P=y.length>1?1:0;P<y.length;P++){var I=y[P];g.font="12px Arial",g.fillStyle="rgba(255,255,255,0.5)",g.fillText(I.id,I.position.x+10,I.position.y-10)}}},e.collisions=function(u,h,m){var g=m,S=u.options,P,y,I,M,E,k,b;for(g.beginPath(),k=0;k<h.length;k++)if(P=h[k],!!P.isActive)for(y=P.collision,b=0;b<P.contactCount;b++){var F=P.contacts[b],O=F.vertex;g.rect(O.x-1.5,O.y-1.5,3.5,3.5)}for(S.wireframes?g.fillStyle="rgba(255,255,255,0.7)":g.fillStyle="orange",g.fill(),g.beginPath(),k=0;k<h.length;k++)if(P=h[k],!!P.isActive&&(y=P.collision,P.contactCount>0)){var z=P.contacts[0].vertex.x,G=P.contacts[0].vertex.y;P.contactCount===2&&(z=(P.contacts[0].vertex.x+P.contacts[1].vertex.x)/2,G=(P.contacts[0].vertex.y+P.contacts[1].vertex.y)/2),y.bodyB===y.supports[0].body||y.bodyA.isStatic===!0?g.moveTo(z-y.normal.x*8,G-y.normal.y*8):g.moveTo(z+y.normal.x*8,G+y.normal.y*8),g.lineTo(z,G)}S.wireframes?g.strokeStyle="rgba(255,165,0,0.7)":g.strokeStyle="orange",g.lineWidth=1,g.stroke()},e.separations=function(u,h,m){var g=m,S=u.options,P,y,I,M,E,k,b;for(g.beginPath(),k=0;k<h.length;k++)if(P=h[k],!!P.isActive){y=P.collision,M=y.bodyA,E=y.bodyB;var F=1;!E.isStatic&&!M.isStatic&&(F=.5),E.isStatic&&(F=0),g.moveTo(E.position.x,E.position.y),g.lineTo(E.position.x-y.penetration.x*F,E.position.y-y.penetration.y*F),F=1,!E.isStatic&&!M.isStatic&&(F=.5),M.isStatic&&(F=0),g.moveTo(M.position.x,M.position.y),g.lineTo(M.position.x+y.penetration.x*F,M.position.y+y.penetration.y*F)}S.wireframes?g.strokeStyle="rgba(255,165,0,0.5)":g.strokeStyle="orange",g.stroke()},e.inspector=function(u,h){var m=u.engine,g=u.selected,S=u.render,P=S.options,y;if(P.hasBounds){var I=S.bounds.max.x-S.bounds.min.x,M=S.bounds.max.y-S.bounds.min.y,E=I/S.options.width,k=M/S.options.height;h.scale(1/E,1/k),h.translate(-S.bounds.min.x,-S.bounds.min.y)}for(var b=0;b<g.length;b++){var F=g[b].data;switch(h.translate(.5,.5),h.lineWidth=1,h.strokeStyle="rgba(255,165,0,0.9)",h.setLineDash([1,2]),F.type){case"body":y=F.bounds,h.beginPath(),h.rect(Math.floor(y.min.x-3),Math.floor(y.min.y-3),Math.floor(y.max.x-y.min.x+6),Math.floor(y.max.y-y.min.y+6)),h.closePath(),h.stroke();break;case"constraint":var O=F.pointA;F.bodyA&&(O=F.pointB),h.beginPath(),h.arc(O.x,O.y,10,0,2*Math.PI),h.closePath(),h.stroke();break}h.setLineDash([]),h.translate(-.5,-.5)}u.selectStart!==null&&(h.translate(.5,.5),h.lineWidth=1,h.strokeStyle="rgba(255,165,0,0.6)",h.fillStyle="rgba(255,165,0,0.1)",y=u.selectBounds,h.beginPath(),h.rect(Math.floor(y.min.x),Math.floor(y.min.y),Math.floor(y.max.x-y.min.x),Math.floor(y.max.y-y.min.y)),h.closePath(),h.stroke(),h.fill(),h.translate(-.5,-.5)),P.hasBounds&&h.setTransform(1,0,0,1,0,0)};var i=function(u,h){var m=u.engine,g=u.timing,S=g.historySize,P=m.timing.timestamp;g.delta=h-g.lastTime||e._goodDelta,g.lastTime=h,g.timestampElapsed=P-g.lastTimestamp||0,g.lastTimestamp=P,g.deltaHistory.unshift(g.delta),g.deltaHistory.length=Math.min(g.deltaHistory.length,S),g.engineDeltaHistory.unshift(m.timing.lastDelta),g.engineDeltaHistory.length=Math.min(g.engineDeltaHistory.length,S),g.timestampElapsedHistory.unshift(g.timestampElapsed),g.timestampElapsedHistory.length=Math.min(g.timestampElapsedHistory.length,S),g.engineUpdatesHistory.unshift(m.timing.lastUpdatesPerFrame),g.engineUpdatesHistory.length=Math.min(g.engineUpdatesHistory.length,S),g.engineElapsedHistory.unshift(m.timing.lastElapsed),g.engineElapsedHistory.length=Math.min(g.engineElapsedHistory.length,S),g.elapsedHistory.unshift(g.lastElapsed),g.elapsedHistory.length=Math.min(g.elapsedHistory.length,S)},l=function(u){for(var h=0,m=0;m<u.length;m+=1)h+=u[m];return h/u.length||0},d=function(u,h){var m=document.createElement("canvas");return m.width=u,m.height=h,m.oncontextmenu=function(){return!1},m.onselectstart=function(){return!1},m},x=function(u){var h=u.getContext("2d"),m=window.devicePixelRatio||1,g=h.webkitBackingStorePixelRatio||h.mozBackingStorePixelRatio||h.msBackingStorePixelRatio||h.oBackingStorePixelRatio||h.backingStorePixelRatio||1;return m/g},C=function(u,h){var m=u.textures[h];return m||(m=u.textures[h]=new Image,m.src=h,m)},w=function(u,h){var m=h;/(jpg|gif|png)$/.test(h)&&(m="url("+h+")"),u.canvas.style.background=m,u.canvas.style.backgroundSize="contain",u.currentBackground=h}})()},function(B,H,v){var e={};B.exports=e;var f=v(5),s=v(17),r=v(0);(function(){e._maxFrameDelta=1e3/15,e._frameDeltaFallback=1e3/60,e._timeBufferMargin=1.5,e._elapsedNextEstimate=1,e._smoothingLowerBound=.1,e._smoothingUpperBound=.9,e.create=function(n){var c={delta:16.666666666666668,frameDelta:null,frameDeltaSmoothing:!0,frameDeltaSnapping:!0,frameDeltaHistory:[],frameDeltaHistorySize:100,frameRequestId:null,timeBuffer:0,timeLastTick:null,maxUpdates:null,maxFrameTime:33.333333333333336,lastUpdatesDeferred:0,enabled:!0},o=r.extend(c,n);return o.fps=0,o},e.run=function(n,c){return n.timeBuffer=e._frameDeltaFallback,function o(t){n.frameRequestId=e._onNextFrame(n,o),t&&n.enabled&&e.tick(n,c,t)}(),n},e.tick=function(n,c,o){var t=r.now(),a=n.delta,i=0,l=o-n.timeLastTick;if((!l||!n.timeLastTick||l>Math.max(e._maxFrameDelta,n.maxFrameTime))&&(l=n.frameDelta||e._frameDeltaFallback),n.frameDeltaSmoothing){n.frameDeltaHistory.push(l),n.frameDeltaHistory=n.frameDeltaHistory.slice(-n.frameDeltaHistorySize);var d=n.frameDeltaHistory.slice(0).sort(),x=n.frameDeltaHistory.slice(d.length*e._smoothingLowerBound,d.length*e._smoothingUpperBound),C=p(x);l=C||l}n.frameDeltaSnapping&&(l=1e3/Math.round(1e3/l)),n.frameDelta=l,n.timeLastTick=o,n.timeBuffer+=n.frameDelta,n.timeBuffer=r.clamp(n.timeBuffer,0,n.frameDelta+a*e._timeBufferMargin),n.lastUpdatesDeferred=0;var w=n.maxUpdates||Math.ceil(n.maxFrameTime/a),u={timestamp:c.timing.timestamp};f.trigger(n,"beforeTick",u),f.trigger(n,"tick",u);for(var h=r.now();a>0&&n.timeBuffer>=a*e._timeBufferMargin;){f.trigger(n,"beforeUpdate",u),s.update(c,a),f.trigger(n,"afterUpdate",u),n.timeBuffer-=a,i+=1;var m=r.now()-t,g=r.now()-h,S=m+e._elapsedNextEstimate*g/i;if(i>=w||S>n.maxFrameTime){n.lastUpdatesDeferred=Math.round(Math.max(0,n.timeBuffer/a-e._timeBufferMargin));break}}c.timing.lastUpdatesPerFrame=i,f.trigger(n,"afterTick",u),n.frameDeltaHistory.length>=100&&(n.lastUpdatesDeferred&&Math.round(n.frameDelta/a)>w?r.warnOnce("Matter.Runner: runner reached runner.maxUpdates, see docs."):n.lastUpdatesDeferred&&r.warnOnce("Matter.Runner: runner reached runner.maxFrameTime, see docs."),typeof n.isFixed<"u"&&r.warnOnce("Matter.Runner: runner.isFixed is now redundant, see docs."),(n.deltaMin||n.deltaMax)&&r.warnOnce("Matter.Runner: runner.deltaMin and runner.deltaMax were removed, see docs."),n.fps!==0&&r.warnOnce("Matter.Runner: runner.fps was replaced by runner.delta, see docs."))},e.stop=function(n){e._cancelNextFrame(n)},e._onNextFrame=function(n,c){if(typeof window<"u"&&window.requestAnimationFrame)n.frameRequestId=window.requestAnimationFrame(c);else throw new Error("Matter.Runner: missing required global window.requestAnimationFrame.");return n.frameRequestId},e._cancelNextFrame=function(n){if(typeof window<"u"&&window.cancelAnimationFrame)window.cancelAnimationFrame(n.frameRequestId);else throw new Error("Matter.Runner: missing required global window.cancelAnimationFrame.")};var p=function(n){for(var c=0,o=n.length,t=0;t<o;t+=1)c+=n[t];return c/o||0}})()},function(B,H,v){var e={};B.exports=e;var f=v(8),s=v(0),r=s.deprecated;(function(){e.collides=function(p,n){return f.collides(p,n)},r(e,"collides","SAT.collides \u27A4 replaced by Collision.collides")})()},function(B,H,v){var e={};B.exports=e;var f=v(1),s=v(0);(function(){e.pathToVertices=function(r,p){typeof window<"u"&&!("SVGPathSeg"in window)&&s.warn("Svg.pathToVertices: SVGPathSeg not defined, a polyfill is required.");var n,c,o,t,a,i,l,d,x,C,w=[],u,h,m=0,g=0,S=0;p=p||15;var P=function(I,M,E){var k=E%2===1&&E>1;if(!x||I!=x.x||M!=x.y){x&&k?(u=x.x,h=x.y):(u=0,h=0);var b={x:u+I,y:h+M};(k||!x)&&(x=b),w.push(b),g=u+I,S=h+M}},y=function(I){var M=I.pathSegTypeAsLetter.toUpperCase();if(M!=="Z"){switch(M){case"M":case"L":case"T":case"C":case"S":case"Q":g=I.x,S=I.y;break;case"H":g=I.x;break;case"V":S=I.y;break}P(g,S,I.pathSegType)}};for(e._svgPathToAbsolute(r),o=r.getTotalLength(),i=[],n=0;n<r.pathSegList.numberOfItems;n+=1)i.push(r.pathSegList.getItem(n));for(l=i.concat();m<o;){if(C=r.getPathSegAtLength(m),a=i[C],a!=d){for(;l.length&&l[0]!=a;)y(l.shift());d=a}switch(a.pathSegTypeAsLetter.toUpperCase()){case"C":case"T":case"S":case"Q":case"A":t=r.getPointAtLength(m),P(t.x,t.y,0);break}m+=p}for(n=0,c=l.length;n<c;++n)y(l[n]);return w},e._svgPathToAbsolute=function(r){for(var p,n,c,o,t,a,i=r.pathSegList,l=0,d=0,x=i.numberOfItems,C=0;C<x;++C){var w=i.getItem(C),u=w.pathSegTypeAsLetter;if(/[MLHVCSQTA]/.test(u))"x"in w&&(l=w.x),"y"in w&&(d=w.y);else switch("x1"in w&&(c=l+w.x1),"x2"in w&&(t=l+w.x2),"y1"in w&&(o=d+w.y1),"y2"in w&&(a=d+w.y2),"x"in w&&(l+=w.x),"y"in w&&(d+=w.y),u){case"m":i.replaceItem(r.createSVGPathSegMovetoAbs(l,d),C);break;case"l":i.replaceItem(r.createSVGPathSegLinetoAbs(l,d),C);break;case"h":i.replaceItem(r.createSVGPathSegLinetoHorizontalAbs(l),C);break;case"v":i.replaceItem(r.createSVGPathSegLinetoVerticalAbs(d),C);break;case"c":i.replaceItem(r.createSVGPathSegCurvetoCubicAbs(l,d,c,o,t,a),C);break;case"s":i.replaceItem(r.createSVGPathSegCurvetoCubicSmoothAbs(l,d,t,a),C);break;case"q":i.replaceItem(r.createSVGPathSegCurvetoQuadraticAbs(l,d,c,o),C);break;case"t":i.replaceItem(r.createSVGPathSegCurvetoQuadraticSmoothAbs(l,d),C);break;case"a":i.replaceItem(r.createSVGPathSegArcAbs(l,d,w.r1,w.r2,w.angle,w.largeArcFlag,w.sweepFlag),C);break;case"z":case"Z":l=p,d=n;break}(u=="M"||u=="m")&&(p=l,n=d)}}})()},function(B,H,v){var e={};B.exports=e;var f=v(6),s=v(0);(function(){e.create=f.create,e.add=f.add,e.remove=f.remove,e.clear=f.clear,e.addComposite=f.addComposite,e.addBody=f.addBody,e.addConstraint=f.addConstraint})()}])})});var j=Ve(Ie());(()=>{"use strict";let B=document.getElementById("root"),H=(A,T,D)=>Math.max(T,Math.min(D,A)),v=(A,T)=>A+Math.random()*(T-A),e=A=>A[Math.floor(Math.random()*A.length)],f=A=>A[A.length-1],s=A=>{for(let T=A.length-1;T>0;T--){let D=Math.floor(Math.random()*(T+1));[A[T],A[D]]=[A[D],A[T]]}return A},r=[],p=[],n=!0,c=!1,o;function t(A,T,D,R){A.addEventListener(T,D,R),r.push(()=>A.removeEventListener(T,D,R))}function a(A,T,D="#faf8f1"){let R=document.createElement("style");R.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+A,document.head.append(R),B.style.background=D,B.innerHTML='<div class="fit">'+T+"</div>";let V=B.querySelector(".fit");function L(){let U=B.getBoundingClientRect(),N=Math.min(U.width/390,U.height/598);V.style.transform=`translate(${(U.width-390*N)/2}px,${(U.height-598*N)/2}px) scale(${N})`,B.dataset.layout=`${Math.round(U.width)}x${Math.round(U.height)}`}L(),t(window,"resize",L)}function i(A){return B.querySelector(A)}function l(){var A;(A=i(".guide"))==null||A.classList.add("gone")}function d(A){B.dataset.phase=A}function x(){C(),l()}function C(){try{o||(o=new(window.AudioContext||window.webkitAudioContext)),o.state==="suspended"&&o.resume().catch(()=>{})}catch{}}function w(A=450,T=.08,D=.18,R="sine",V=0){if(!(!o||!n))try{let L=o.createOscillator(),U=o.createGain(),N=o.currentTime;L.type=R,L.frequency.setValueAtTime(A,N),V&&L.frequency.exponentialRampToValueAtTime(Math.max(30,V),N+T),U.gain.setValueAtTime(.001,N),U.gain.exponentialRampToValueAtTime(D,N+.006),U.gain.exponentialRampToValueAtTime(.001,N+T),L.connect(U),U.connect(o.destination),L.start(N),L.stop(N+T+.02),L.onended=()=>{L.disconnect(),U.disconnect()}}catch{}}function u(){w(523,.12,.18),setTimeout(()=>w(784,.17,.16),100)}function h(){w(180,.22,.18,"triangle",65)}function m(A){let T=0;function D(R){if(c)return;let V=Math.min(.035,(R-(T||R))/1e3);T=R,document.hidden||A(n?V:0,R/1e3),requestAnimationFrame(D)}requestAnimationFrame(D)}function g(){let A=i("canvas.stage"),T=A.getContext("2d"),D=Math.min(2,window.devicePixelRatio||1);return A.width=390*D,A.height=598*D,T.scale(D,D),{canvas:A,ctx:T}}function S(A,T=i("canvas.stage")){let D=T.getBoundingClientRect();return{x:(A.clientX-D.left)*390/D.width,y:(A.clientY-D.top)*598/D.height}}function P(A,T,D,R,V,L){L=Math.min(Math.abs(R)/2,Math.abs(V)/2,L),A.moveTo(T+L,D),A.lineTo(T+R-L,D),A.quadraticCurveTo(T+R,D,T+R,D+L),A.lineTo(T+R,D+V-L),A.quadraticCurveTo(T+R,D+V,T+R-L,D+V),A.lineTo(T+L,D+V),A.quadraticCurveTo(T,D+V,T,D+V-L),A.lineTo(T,D+L),A.quadraticCurveTo(T,D,T+L,D),A.closePath()}function y(A,T,D,R,V,L,U,N){A.beginPath(),P(A,T,D,R,V,L),U&&(A.fillStyle=U,A.fill()),N&&(A.strokeStyle=N,A.stroke())}function I(A,T,D,R,V,L){A.beginPath(),A.arc(T,D,Math.max(.01,R),0,Math.PI*2),V&&(A.fillStyle=V,A.fill()),L&&(A.strokeStyle=L,A.stroke())}function M(A,T,D,R,V,L,U=2){A.beginPath(),A.moveTo(T,D),A.lineTo(R,V),A.strokeStyle=L,A.lineWidth=U,A.stroke()}function E(A,T,D,R,V=18,L="#25252a",U="UIBody",N="center"){A.font=`700 ${V}px ${U}`,A.fillStyle=L,A.textAlign=N,A.textBaseline="middle",A.fillText(T,D,R)}let k=[];function b(A){let T=A.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(W(T,A))}function F(A){let T=new Image;return T.onerror=()=>{B.dataset.assetIssue="image"},T.src=b(A),k.push({im:T,path:A}),T}function O(A,T,D,R,V,L){if(!T||!T.width)return;let U=T.videoWidth||T.width,N=T.videoHeight||T.height;if(!U||!N)return;let he=Math.max(V/U,L/N);A.save(),A.beginPath(),A.rect(D,R,V,L),A.clip(),A.drawImage(T,D+(V-U*he)/2,R+(L-N*he)/2,U*he,N*he),A.restore()}function z(A,T,D,R,V){A.save(),A.beginPath(),A.arc(D,R,V,0,Math.PI*2),A.clip(),O(A,T,D-V,R-V,V*2,V*2),A.restore()}function G(A,T,D,R){let V=i(".modal");if(!V)return;V.hidden=!1,V.querySelector("h2").textContent=A,V.querySelector(".value").textContent=T,V.querySelector("p").textContent=D;let L=V.querySelector("button");L.onclick=()=>{V.hidden=!0,x(),R()},d("result")}function K(A="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${A}</button></section></div>`}function X(){let A=i(".flash");A&&(A.classList.remove("fire"),A.offsetWidth,A.classList.add("fire"))}let Y=[];function ie(A){n=A,A||o==null||o.suspend().catch(()=>{});for(let T of Y)T(A)}t(window,"message",A=>{var T;A.source===parent&&((T=A.data)==null?void 0:T.type)==="playable-active"&&ie(A.data.active===!0)}),t(document,"visibilitychange",()=>{ie(!document.hidden)}),t(window,"pagehide",()=>{c=!0,r.splice(0).forEach(A=>A()),p.splice(0).forEach(A=>A()),o==null||o.close().catch(()=>{})});let _={};function W(A,T){return _[A]??T}async function te(A=()=>{}){let T=new AbortController,D=setTimeout(()=>T.abort(),1600);try{let R=await fetch("./game.config.json",{signal:T.signal});if(!R.ok)throw Error("Config unavailable");let V=await R.json();for(let L of["texts","tweaks","images"])for(let U of V[L]||[])_[U.id]=L==="images"?U.path:U.value;for(let L of k){let U=b(L.path);L.im.getAttribute("src")!==U&&(L.im.src=U)}for(let L of B.querySelectorAll('img[src^="./assets/"]'))L.src=b(L.getAttribute("src"));A(),B.dataset.config="loaded"}catch{B.dataset.config="defaults"}finally{clearTimeout(D)}}let $=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],ue=()=>{};function ne(){var T,D;function A(R,V){$=R.slice(0,24).map(L=>({nickname:String(L.nickname||"Friend"),avatar:L.avatar,image:null}));for(let L of $){let U;try{U=V?window.tt.createImage():new Image,U.onload=()=>{L.image=U,ue()},U.onerror=()=>{L.image=null},U.src=L.avatar}catch{L.image=null}}ue()}A($,!1),B.dataset.friends="sample",!(!((T=window.tt)!=null&&T.getFriendsInfo)||!((D=window.tt)!=null&&D.createImage))&&window.tt.getFriendsInfo({success(R){let V=Array.isArray(R==null?void 0:R.friends)?R.friends.filter(L=>L&&typeof L.avatar=="string"):[];V.length&&(A(V,!0),B.dataset.friends="host")},fail(){B.dataset.friends="sample"}})}function ee(A,T,D,R,V,L="#fff"){let U=$[(T%$.length+$.length)%$.length];A.save(),A.shadowColor="#25212d20",A.shadowBlur=6,I(A,D,R,V,L),A.shadowBlur=0,U!=null&&U.image?z(A,U.image,D,R,Math.max(1,V-2)):(I(A,D,R,Math.max(1,V-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][T%4]),E(A,Array.from((U==null?void 0:U.nickname)||"?")[0],D,R,V*.7,"#fff")),A.restore()}function q(A){var T;return((T=$[(A%$.length+$.length)%$.length])==null?void 0:T.nickname)||"Friend"}function Me(A,T,D,R,V=13){E(A,Array.from(q(T)).slice(0,15).join(""),D,R,V)}ne();function Se(){let A=i(".fit"),T=i(".modal"),D="#dce9de";B.classList.add("printed-paper"),B.style.position="relative",B.style.isolation="isolate",document.body.style.backgroundColor=D,B.style.backgroundColor=D,A.style.background="transparent",A.style.zIndex="1",T&&B.append(T);let R=document.createElement("style");R.textContent=`#root.printed-paper{color:#282723}
 #root.printed-paper .fit{background:transparent}
 #root.printed-paper .guide,#root.printed-paper .hud,#root.printed-paper .count,#root.printed-paper .question,#root.printed-paper .next,#root.printed-paper .round{color:#282723}
 #root.printed-paper .pill,#root.printed-paper .tilt-enable{background:#fffbee;color:#282723;border:2px solid #282723;border-radius:10px;box-shadow:2px 3px 0 #28272326}
 #root.printed-paper .bottom .reset{background:#fffbee;color:#282723;border:2px solid #282723;box-shadow:2px 3px 0 #28272326}
 #root.printed-paper>.modal{z-index:30;background:#28272345}
 #root.printed-paper>.modal>.result{width:320px;max-width:320px;max-height:var(--paper-result-height);transform:scale(var(--paper-scale));background:#fffbee;color:#282723;border:2px solid #282723;border-radius:12px;box-shadow:4px 5px 0 #28272333}
 #root.printed-paper .result h2,#root.printed-paper .result .value{color:#282723}
 #root.printed-paper .answers button{background:#fffbee;color:#282723;border:2px solid #282723;border-radius:10px;box-shadow:2px 3px 0 #28272326}
 #root.printed-paper .card{border:2px solid #282723;box-shadow:3px 4px 0 #28272326}
 #root.printed-paper .award-label,#root.printed-paper .award-title,#root.printed-paper .award-sub{color:#51463c}`,document.head.append(R),p.push(()=>R.remove());function V(){let L=B.getBoundingClientRect();if(!L.width||!L.height)return;let U=Math.min(L.width/390,L.height/598),N=(L.width-390*U)/2,he=(L.height-598*U)/2;A.style.transform=`translate(${N}px,${he}px) scale(${U})`;let Te=String(W("PAPER_BACKDROP","./assets/paper-print-v1.svg"));B.style.backgroundImage=`url("${Te.replace(/"/g,"%22")}")`,B.style.backgroundRepeat="repeat",B.style.backgroundSize=`${256*U}px ${256*U}px`,B.style.setProperty("--paper-scale",String(U)),B.style.setProperty("--paper-result-height",`${Math.max(220,L.height/U-80)}px`),T&&(T.style.padding=`${30*U}px ${30*U}px ${50*U}px`)}if(V(),t(window,"resize",V),typeof ResizeObserver<"u"){let L=new ResizeObserver(V);L.observe(B),p.push(()=>L.disconnect())}return V}a(".fit{background:transparent}.hud{font-family:Playful,Arial;color:#42736c}.guide{top:91px;font-size:16px;color:#5d8277}.result{background:#eff5e9}.pill{background:#4b8077}.next{position:absolute;top:130px;right:45px;font-size:9px;font-weight:700;letter-spacing:1px;color:#69857a}.bottom{bottom:25px}",`<canvas class="stage" aria-label="Drop and merge friend avatars"></canvas><div class="hud center"><span class="score">0</span></div><div class="guide">Drop a friend \xB7 match two to merge</div><div class="next">NEXT</div><div class="bottom"><button class="capability reset" aria-label="Reset game">\u21BB</button></div>${K()}`,"#dce9de");let we=Se(),{canvas:ce,ctx:Q}=g(),J=j.default.Engine.create({gravity:{x:0,y:1.2}});J.positionIterations=10,J.velocityIterations=8;let Z=[],ve=[],ae=new Set,pe=0,le=195,re=0,fe=0,oe="ready",me=0,de=0,se=[19,28,39,53,69,86,105],ge=5;function ye(A,T,D){let R=j.default.Bodies.circle(A,T,se[D],{restitution:.25,friction:.25,frictionStatic:.4,frictionAir:.002,density:.0015});return R.level=D,R.born=J.timing.timestamp,Z.push(R),j.default.World.add(J.world,R),R}function Pe(){j.default.World.clear(J.world,!1),j.default.Engine.clear(J),Z=[],ve=[],ae.clear(),pe=0,le=195,re=0,fe=0,oe="ready",de=0;let A=[j.default.Bodies.rectangle(25,337,16,340,{isStatic:!0}),j.default.Bodies.rectangle(365,337,16,340,{isStatic:!0}),j.default.Bodies.rectangle(195,505,350,16,{isStatic:!0})];j.default.World.add(J.world,A),ye(124,472,0),ye(234,463,1),i(".score").textContent="0",d("ready")}j.default.Events.on(J,"collisionStart",A=>{for(let T of A.pairs){let D=T.bodyA,R=T.bodyB;D.level===void 0||R.level===void 0||D.level!==R.level||D.level>=ge||ae.has(D.id)||ae.has(R.id)||(ae.add(D.id),ae.add(R.id),ve.push([D,R]))}});function Be(){fe>0||oe==="result"||(x(),oe="playing",d("playing"),ye(H(le,35+se[re],355-se[re]),150,re),re=Math.random()<.72?0:1,fe=.6,w(340,.05,.11,"triangle"),B.dataset.drops=String(Number(B.dataset.drops||0)+1))}t(ce,"pointerdown",A=>{let T=S(A);T.y<105||T.y>500||(le=H(T.x,55,335),ce.setPointerCapture(A.pointerId),B.dataset.aiming="true")}),t(ce,"pointermove",A=>{B.dataset.aiming==="true"&&(le=H(S(A).x,55,335))}),t(ce,"pointerup",()=>{B.dataset.aiming==="true"&&(B.dataset.aiming="false",Be())}),t(ce,"pointercancel",()=>B.dataset.aiming="false"),t(i(".reset"),"click",()=>{x(),Pe()}),Pe(),m(A=>{if(fe=Math.max(0,fe-A),oe!=="result"){for(me+=A;me>=1/120;)j.default.Engine.update(J,1e3/120),me-=1/120;for(let[D,R]of ve.splice(0)){if(!Z.includes(D)||!Z.includes(R))continue;let V=(D.position.x+R.position.x)/2,L=(D.position.y+R.position.y)/2;j.default.World.remove(J.world,[D,R]),Z=Z.filter(N=>N!==D&&N!==R);let U=ye(V,L,D.level+1);j.default.Body.setVelocity(U,{x:(D.velocity.x+R.velocity.x)*.2,y:-.7}),pe+=2**(D.level+2),i(".score").textContent=pe,w(470+D.level*100,.09,.14),ae.delete(D.id),ae.delete(R.id)}de=Z.some(D=>J.timing.timestamp-D.born>1600&&D.position.y-se[D.level]<191&&D.speed<1.1)?de+A:0,de>1.2&&(oe="result",h(),G("Full of friends",pe,"Keep matching to make a little more room.",Pe))}Q.clearRect(0,0,390,598),y(Q,31,165,328,340,10,"#f5faf650","#a0bdb0"),Q.save(),Q.setLineDash([4,5]),M(Q,38,192,352,192,"#abaf9e",1),Q.restore(),ee(Q,re,321,144,11,"#fff"),oe!=="result"&&fe<=0&&(Q.globalAlpha=.75,ee(Q,re,le,137,se[re],"#fff"),Q.globalAlpha=1,Q.save(),Q.setLineDash([3,6]),M(Q,le,159,le,190,"#87aaa0",1),Q.restore());for(let T of Z)Q.save(),Q.translate(T.position.x,T.position.y),Q.rotate(T.angle),ee(Q,T.level,0,0,se[T.level],["#fff","#e3e9c5","#e2c5c5","#c3d2e5","#e4cd9b","#b8d5c3"][T.level]),Q.restore();B.dataset.balls=Z.length}),p.push(()=>{j.default.Events.off(J),j.default.World.clear(J.world,!1),j.default.Engine.clear(J)}),te(()=>{we(),i(".guide")&&(i(".guide").textContent=String(W("GUIDE","Drop a friend \xB7 match two to merge")))})})();(()=>{let B=document.createElement("style");B.dataset.batch3Ui="20261116",B.textContent=`
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

.guide{top:91px;font-size:18px;color:#3c6558}.next{font-size:12px;letter-spacing:.8px;color:#456c5e;top:127px}
.bottom{top:30px;bottom:auto;justify-content:flex-end;pointer-events:none}
.bottom .reset{pointer-events:auto;width:44px;height:44px;min-height:44px;padding:0;border-radius:50%;font-size:24px;background:#f6fbf7;color:#42736c;border:1px solid #648b7e66}
`,document.head.append(B)})();})();
